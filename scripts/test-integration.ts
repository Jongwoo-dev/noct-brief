import "./env";
import pg from "pg";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readConfig } from "../lib/config";
import { migrate } from "./migrate";
import { Repository, type Job } from "../lib/repository";
import { dueSlots, schedule, type Session } from "../lib/calendar";
import { Worker } from "../lib/worker";
import { sampleContent } from "../data/samples";
import {
  ProviderError,
  type Collector,
  type Generator,
} from "../lib/providers";
import { drainNotifications } from "../lib/notifications";
import { assertDatabase } from "../lib/db";
import { checkOperationalFlows } from "./test-operations";
import { checkTrialLedger } from "./test-trial-ledger";
import { adminDetail, adminOverview } from "../lib/admin-queries";
import { pairedTimePolicy } from "../lib/report-time";
const c = readConfig();
if (c.APP_ENV !== "local" || c.DATA_MODE !== "sample" || !c.DATABASE_URL)
  throw new Error("npm run db:local로 전용 로컬 DB를 준비하세요.");
const name = `noct_test_${randomUUID().replaceAll("-", "")}_local`,
  url = new URL(c.DATABASE_URL);
url.pathname = "/postgres";
const admin = new pg.Pool({ connectionString: url.toString() });
await admin.query(`CREATE DATABASE "${name}"`);
url.pathname = `/${name}`;
const db = new pg.Pool({ connectionString: url.toString(), max: 8 });
let checks = 0;
const check = (label: string) => {
  checks++;
  console.log(`PASS ${label}`);
};
const config: Job["config"] = {
  mode: "sample",
  model: "sample",
  reasoning: "medium",
  maxOutputTokens: 8000,
  promptVersion: "noct-v1",
};
const pairedConfig: Job["config"] = {
  ...config,
  promptVersion: "noct-v2-kst-original",
  timePolicy: pairedTimePolicy,
};
const repo = new Repository(db, "sample");
const now = () => new Date(Date.now() + 5000);
async function storeEdition(date: string, session: Session) {
  const slot = schedule(date, session);
  const version = randomUUID();
  await db.query(
    "INSERT INTO briefings(id,us_trading_date,session,target_at) VALUES($1,$2,$3,$4)",
    [slot.id, date, session, slot.targetAt],
  );
  await db.query(
    "INSERT INTO briefing_versions(id,briefing_id,content,created_at,config,validated) VALUES($1,$2,$3,$4,$5,true)",
    [version, slot.id, sampleContent(date, session), slot.targetAt, config],
  );
  await db.query(
    "UPDATE briefings SET current_version_id=$1,visible=true,published_at=$2 WHERE id=$3",
    [version, slot.targetAt, slot.id],
  );
}
function providers(date: string, session: "pre" | "post", pending = false) {
  const content = sampleContent(date, session);
  let submits = 0;
  const collector: Collector = {
    async collect(job, coverage) {
      job.payload.content = structuredClone(content);
      return {
        ...structuredClone(content.bundle),
        coverageStart: new Date(
          Math.min(
            Date.parse(coverage),
            Date.parse(content.bundle.coverageStart),
          ),
        ).toISOString(),
        pendingCalls: pending ? ["가상 기업 콜"] : [],
      };
    },
    async refresh(_job, bundle) {
      return bundle;
    },
  };
  const generator: Generator = {
    async submit() {
      submits++;
      return { id: "resp_sample" };
    },
    async poll() {
      return { status: "done", draft: content.draft, usage: { sample: true } };
    },
  };
  return { collector, generator, submits: () => submits };
}
async function finish(w: Worker, start: Date, steps = 6) {
  for (let i = 0; i < steps; i++)
    await w.tick(new Date(start.getTime() + i * 16000));
}
try {
  await migrate(db, "local");
  await migrate(db, "local");
  await assertDatabase(db, "local");
  await assert.rejects(() => assertDatabase(db, "production"));
  check("마이그레이션 재실행과 환경 표식");
  await checkTrialLedger(db, check);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      repo.enqueue("2026-10-26", "post", pairedConfig, now()),
    ),
  );
  assert.equal(
    (await db.query("SELECT count(*) FROM jobs")).rows[0].count,
    "1",
  );
  check("중복 예약 유일 제약");
  const p = providers("2026-10-26", "post"),
    w = new Worker(repo, p.collector, p.generator);
  await finish(w, now());
  assert.equal((await repo.publicList()).length, 1);
  assert.equal(p.submits(), 1);
  assert.equal(
    (await repo.publicDetail("2026-10-26-post"))?.content.timePolicy,
    pairedTimePolicy,
  );
  check("수집→생성→검증→트랜잭션 공개");
  await db.query(
    "UPDATE briefings SET visible=false WHERE id='2026-10-26-post'",
  );
  await storeEdition("2026-10-23", "pre");
  const original = (await repo.publicDetail("2026-10-23-pre"))!;
  assert.ok(original);
  assert.equal((await repo.ensureSlot("2026-10-23", "pre")).id, original.id);
  const command = {
    id: randomUUID(),
    briefingId: original.id,
    baseVersion: original.versionId,
    action: "hide" as const,
  };
  await repo.adminCommand(command, config, now());
  assert.equal(await repo.publicDetail(original.id), null);
  assert.equal((await repo.publicList()).length, 0);
  await assert.rejects(
    () => repo.adminCommand(command, config, now()),
    /COMMAND_REPLAY/,
  );
  await repo.adminCommand(
    { ...command, id: randomUUID(), action: "restore" },
    config,
    now(),
  );
  assert.ok(await repo.publicDetail(original.id));
  check("비공개 목록·직접 조회 차단, 복구와 명령 재실행 방지");
  await repo.adminCommand(
    {
      ...command,
      id: randomUUID(),
      action: "correct",
      reason: "샘플 오류 검증",
      issue: "제목의 표현",
      evidenceUrl: "https://example.com/noct-sample",
    },
    pairedConfig,
    now(),
  );
  const correctionConfig = (
    await db.query(
      "SELECT config FROM jobs WHERE briefing_id=$1 AND kind='correction'",
      [original.id],
    )
  ).rows[0].config;
  assert.equal(correctionConfig.promptVersion, "noct-v1");
  assert.equal(correctionConfig.timePolicy, undefined);
  check("신규 회차 시각 정책 저장·기존 원고 정정 시 원래 프롬프트 유지");
  assert.equal(
    (await repo.publicDetail(original.id))!.versionId,
    original.versionId,
  );
  const correction = providers("2026-10-23", "pre");
  const cg: Generator = {
    ...correction.generator,
    async poll() {
      return {
        status: "done",
        draft: {
          ...original.content.draft,
          title: "근거를 재확인한 정정 제목",
        },
      };
    },
  };
  await finish(new Worker(repo, correction.collector, cg), now());
  const revised = (await repo.publicDetail(original.id))!;
  assert.notEqual(revised.versionId, original.versionId);
  assert.equal(
    revised.content.bundle.cutoffAt,
    original.content.bundle.cutoffAt,
  );
  assert.equal(revised.corrections.length, 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM briefing_versions WHERE briefing_id=$1",
        [original.id],
      )
    ).rows[0].count,
    "2",
  );
  await assert.rejects(
    () =>
      repo.adminCommand(
        { ...command, id: randomUUID(), action: "hide" },
        config,
        now(),
      ),
    /VERSION_CONFLICT/,
  );
  check("정정 중 원본 유지·불변 버전·자료 기준 유지·동시 수정 충돌");
  const stored = (await adminDetail(db, original.id, original.versionId))!;
  assert.equal(stored.versions.length, 2);
  assert.equal(
    stored.selected!.content.draft.title,
    original.content.draft.title,
  );
  await repo.adminCommand(
    { ...command, id: randomUUID(), baseVersion: revised.versionId },
    config,
    now(),
  );
  assert.equal(await repo.publicDetail(original.id), null);
  assert.equal(
    (await adminOverview(db, "stored", "2026-10-23", 1)).editions[0].visible,
    false,
  );
  assert.equal(
    (await adminDetail(db, original.id))!.selected!.id,
    revised.versionId,
  );
  assert.equal(
    (await adminDetail(db, original.id, randomUUID()))!.selected,
    null,
  );
  check("관리자 비공개 보관본·이전 버전 조회와 회차별 버전 제한");
  const correctionCommand = {
    id: randomUUID(),
    action: "correct" as const,
    briefingId: original.id,
    baseVersion: revised.versionId,
    issue: "가상 정정 재시도 검증",
    reason: "검사 전용",
    evidenceUrl: "https://example.com/noct-sample",
  };
  await repo.adminCommand(correctionCommand, config, now());
  const failedCorrection = (await adminDetail(db, original.id))!.edition.job!
    .id;
  await db.query(
    "UPDATE jobs SET state='failed',error_code='CORRECTION_EVIDENCE_REQUIRED' WHERE id=$1",
    [failedCorrection],
  );
  await repo.adminCommand(
    {
      id: randomUUID(),
      action: "retry",
      briefingId: original.id,
      baseVersion: revised.versionId,
      jobId: failedCorrection,
    },
    config,
    now(),
  );
  assert.equal(
    (await adminDetail(db, original.id))!.edition.job!.state,
    "collecting",
  );
  await assert.rejects(
    () =>
      repo.adminCommand(
        { ...correctionCommand, id: randomUUID() },
        config,
        now(),
      ),
    /ACTIVE_JOB/,
  );
  await db.query("UPDATE jobs SET state='failed' WHERE id=$1", [
    failedCorrection,
  ]);
  await repo.adminCommand(
    { ...correctionCommand, id: randomUUID() },
    config,
    new Date(now().getTime() + 1000),
  );
  const newest = (await adminDetail(db, original.id))!.edition.job!.id;
  await db.query("UPDATE jobs SET state='failed' WHERE id=$1", [newest]);
  await assert.rejects(
    () =>
      repo.adminCommand(
        {
          id: randomUUID(),
          action: "retry",
          briefingId: original.id,
          baseVersion: revised.versionId,
          jobId: failedCorrection,
        },
        config,
        now(),
      ),
    /JOB_CONFLICT/,
  );
  await repo.adminCommand(
    {
      id: randomUUID(),
      action: "retry",
      briefingId: original.id,
      baseVersion: revised.versionId,
      jobId: newest,
    },
    config,
    now(),
  );
  assert.equal(
    (await db.query("SELECT state FROM jobs WHERE id=$1", [failedCorrection]))
      .rows[0].state,
    "failed",
  );
  const resumed = providers("2026-10-23", "pre");
  await finish(new Worker(repo, resumed.collector, resumed.generator), now());
  assert.equal(resumed.submits(), 1);
  assert.equal(await repo.publicDetail(original.id), null);
  const afterRetry = (await adminDetail(db, original.id))!;
  assert.equal(afterRetry.versions.length, 3);
  assert.equal(afterRetry.edition.visible, false);
  await repo.adminCommand(
    {
      ...command,
      id: randomUUID(),
      action: "restore",
      baseVersion: afterRetry.edition.version,
    },
    config,
    now(),
  );
  check(
    "최신 실패 작업만 재개·원본 재발행 방지·중복 정정 차단·정정 후 비공개 유지",
  );
  await repo.enqueue("2026-10-23", "post", config, now());
  const claimed = await Promise.all([
    repo.claim("a", now()),
    repo.claim("b", now()),
  ]);
  assert.equal(claimed.filter(Boolean).length, 1);
  const stale = claimed.find(Boolean)!;
  await db.query(
    "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [stale.id],
  );
  const fresh = (await repo.claim("c", now()))!;
  await assert.rejects(() => repo.save(stale, "failed", now()), /LEASE_LOST/);
  await repo.markSubmitting(fresh);
  await db.query(
    "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [fresh.id],
  );
  await db.query(
    "ALTER TABLE notification_outbox ADD CONSTRAINT interrupt_outbox CHECK (kind <> 'submission_unknown')",
  );
  await assert.rejects(() => w.tick(now()), /interrupt_outbox/);
  assert.equal(
    (await db.query("SELECT state FROM jobs WHERE id=$1", [fresh.id])).rows[0]
      .state,
    "submitting",
  );
  await db.query(
    "ALTER TABLE notification_outbox DROP CONSTRAINT interrupt_outbox",
  );
  await db.query(
    "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [fresh.id],
  );
  await w.tick(now());
  assert.equal(
    (await db.query("SELECT error_code FROM jobs WHERE id=$1", [fresh.id]))
      .rows[0].error_code,
    "SUBMISSION_UNKNOWN",
  );
  assert.equal(p.submits(), 1);
  check("접수 중단 후 재시작·실패 알림 저장 오류 롤백·재제출 방지");
  check("동시 작업자 단일 잠금·만료 후 fencing");
  await repo.enqueue("2026-10-22", "post", config, now());
  const unknown = providers("2026-10-22", "post");
  unknown.generator.submit = async () => {
    throw new ProviderError("SUBMISSION_UNKNOWN", false, 0, true);
  };
  await new Worker(repo, unknown.collector, unknown.generator).tick(now());
  assert.equal(
    (
      await db.query(
        "SELECT error_code FROM jobs WHERE briefing_id='2026-10-22-post'",
      )
    ).rows[0].error_code,
    "SUBMISSION_UNKNOWN",
  );
  await assert.rejects(
    () =>
      repo.adminCommand(
        {
          id: randomUUID(),
          action: "retry",
          briefingId: "2026-10-22-post",
          baseVersion: "",
        },
        config,
        now(),
      ),
    /RETRY_NOT_AVAILABLE/,
  );
  check("외부 접수 불명 자동·수동 중복 요청 차단");
  await repo.enqueue("2026-10-27", "post", config, now());
  const retry = providers("2026-10-27", "post");
  retry.generator.submit = async () => {
    throw new ProviderError("HTTP_429", true, 180);
  };
  const rw = new Worker(repo, retry.collector, retry.generator);
  await rw.tick(now());
  let r = (
    await db.query("SELECT * FROM jobs WHERE briefing_id='2026-10-27-post'")
  ).rows[0];
  assert.equal(r.state, "retry_wait");
  assert.equal(r.attempt, 1);
  assert.ok(r.next_at.getTime() > Date.now() + 175000);
  for (let i = 0; i < 3; i++) {
    await rw.tick(new Date(r.next_at.getTime() + 1000));
    r = (
      await db.query("SELECT * FROM jobs WHERE briefing_id='2026-10-27-post'")
    ).rows[0];
  }
  assert.equal(r.state, "failed");
  check("429 Retry-After·최대 세 번 재시도·영구 실패");
  // Move only this test slot's target into the future to exercise early-ready publication and the waiting deadline against the real DB clock.
  await repo.enqueue("2026-10-21", "post", config, now());
  const wait = providers("2026-10-21", "post", true);
  const waiting = new Worker(repo, wait.collector, wait.generator);
  const target = new Date(Date.now() + 3600000);
  await db.query(
    "UPDATE briefings SET target_at=$1 WHERE id='2026-10-21-post'",
    [target],
  );
  await waiting.tick(now());
  r = (await db.query("SELECT * FROM jobs WHERE briefing_id='2026-10-21-post'"))
    .rows[0];
  assert.equal(r.state, "waiting_data");
  assert.equal(wait.submits(), 0);
  await waiting.detectDelays(new Date(target.getTime() + 20 * 60000));
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM notification_outbox WHERE briefing_id='2026-10-21-post'",
      )
    ).rows[0].count,
    "0",
  );
  await waiting.detectDelays(new Date(target.getTime() + 60 * 60000));
  assert.equal(
    (
      await db.query(
        "SELECT id FROM notification_outbox WHERE dedupe_key='2026-10-21-post:delay'",
      )
    ).rowCount,
    1,
  );
  await waiting.tick(new Date(target.getTime() + 61 * 60000));
  await finish(waiting, new Date(target.getTime() + 62 * 60000));
  const limited = (await repo.publicDetail("2026-10-21-post"))!;
  assert.ok(
    limited.content.bundle.missing.some((s) => s.includes("콜 자료 미반영")),
  );
  assert.equal(wait.submits(), 1);
  check("콜 대기·무변경 재생성 억제·장애 알림 제외·한 시간 후 축소 공개");
  await db.query(
    "UPDATE briefings SET target_at=$1 WHERE id='2026-10-21-post'",
    [schedule("2026-10-21", "post").targetAt],
  );
  await repo.enqueue("2026-10-20", "post", config, now());
  const early = providers("2026-10-20", "post"),
    ew = new Worker(repo, early.collector, early.generator);
  const future = new Date(Date.now() + 3600000);
  await db.query(
    "UPDATE briefings SET target_at=$1 WHERE id='2026-10-20-post'",
    [future],
  );
  await finish(ew, now(), 4);
  assert.equal(await repo.publicDetail("2026-10-20-post"), null);
  await ew.detectDelays(new Date(future.getTime() + 15 * 60000 - 1));
  const delayCount = async () =>
    (
      await db.query(
        "SELECT id FROM notification_outbox WHERE dedupe_key='2026-10-20-post:delay'",
      )
    ).rowCount;
  assert.equal(await delayCount(), 0);
  await ew.detectDelays(new Date(future.getTime() + 15 * 60000));
  await ew.detectDelays(new Date(future.getTime() + 16 * 60000));
  assert.equal(await delayCount(), 1);
  check("기술 지연 15분 경계·콜 대기 60분 경계·반복 경보 억제");
  await ew.tick(new Date(future.getTime() + 1000));
  assert.ok(await repo.publicDetail("2026-10-20-post"));
  check("미리 준비된 글의 목표 시각 이전 노출 방지");
  await db.query(
    "UPDATE briefings SET target_at=$1 WHERE id='2026-10-20-post'",
    [schedule("2026-10-20", "post").targetAt],
  );
  await assert.rejects(() =>
    db.query("UPDATE briefing_versions SET reason='changed' WHERE id=$1", [
      original.versionId,
    ]),
  );
  await repo.enqueue("2026-10-19", "post", config, now());
  const repair = providers("2026-10-19", "post");
  const invalidDraft = structuredClone(
    sampleContent("2026-10-19", "post").draft,
  );
  invalidDraft.summary[0].text = "근거 없는 수치 987654321";
  repair.generator.poll = async () => ({ status: "done", draft: invalidDraft });
  await finish(new Worker(repo, repair.collector, repair.generator), now(), 10);
  assert.equal(repair.submits(), 2);
  assert.equal(
    (await repo.publicDetail("2026-10-19-post"))!.content.reduced,
    true,
  );
  check("DB 버전 불변 제약·한 번 보정 후 검증 실패 축소본 공개");
  await repo.enqueue("2026-10-16", "post", config, now());
  const update = providers("2026-10-16", "post");
  const first = update.collector.collect;
  update.collector.collect = async (...args) => ({
    ...(await first(...args)),
    missing: ["확인 중인 자료"],
  });
  let refreshed = false;
  update.collector.refresh = async (_job, bundle) => {
    if (refreshed) return bundle;
    refreshed = true;
    return { ...bundle, missing: ["갱신 확인 후에도 미확보한 자료"] };
  };
  await finish(new Worker(repo, update.collector, update.generator), now(), 12);
  assert.equal(update.submits(), 2);
  assert.deepEqual(
    (await repo.publicDetail("2026-10-16-post"))!.content.bundle.missing,
    ["갱신 확인 후에도 미확보한 자료"],
  );
  check("누락 자료가 있는 글도 공개 직전 변경 자료 반영");
  await repo.notify(original.id, "test", "가상 실패 알림", now());
  await repo.notify(original.id, "test", "가상 실패 알림", now());
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM notification_outbox WHERE dedupe_key=$1",
        [`${original.id}:test`],
      )
    ).rows[0].count,
    "1",
  );
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return Response.json({ ok: true });
  };
  await drainNotifications(db, c, "report", request, now());
  assert.equal(calls, 0);
  const prod = {
    ...c,
    APP_ENV: "production" as const,
    AUTO_PUBLISH_ENABLED: true,
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: "test-only",
    TELEGRAM_CHAT_ID: "test-only",
  };
  await drainNotifications(
    db,
    prod,
    "report",
    request,
    new Date(Date.now() + 86400000),
  );
  assert.ok(calls > 0);
  check("예외 알림 중복 억제·로컬 발송 차단·모의 전송");
  // Public archive fixtures are written only to this test-created isolated database.
  const archiveDates = [
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-23",
    "2026-11-24",
  ];
  for (const date of archiveDates) {
    for (const session of ["pre", "post"] as const) {
      await storeEdition(date, session);
    }
  }
  const firstDays = await repo.publicArchive({
    dateWindow: { limit: 6, offset: 0 },
  });
  const nextDay = await repo.publicArchive({
    dateWindow: { limit: 1, offset: 6 },
  });
  assert.equal(firstDays.length, 12);
  assert.equal(new Set(firstDays.map((b) => b.date)).size, 6);
  assert.deepEqual(
    nextDay.map((b) => b.id),
    ["2026-11-16-pre", "2026-11-16-post"],
  );
  assert.equal(new Set([...firstDays, ...nextDay].map((b) => b.id)).size, 14);
  const preDays = await repo.publicArchive({
    session: "pre",
    dateWindow: { limit: 6, offset: 0 },
  });
  assert.equal(preDays.length, 6);
  assert.ok(preDays.every((b) => b.session === "pre"));
  assert.equal(
    (
      await repo.publicArchive({
        date: "2026-11-24",
        dateWindow: { limit: 7, offset: 0 },
      })
    ).length,
    2,
  );
  const featuredId = (await repo.publicList({ limit: 1 }))[0].id;
  assert.equal(featuredId, "2026-11-24-post");
  const archiveWithoutFeatured = await repo.publicArchive({
    excludeId: featuredId,
    dateWindow: { limit: 6, offset: 0 },
  });
  const nextWithoutFeatured = await repo.publicArchive({
    excludeId: featuredId,
    dateWindow: { limit: 1, offset: 6 },
  });
  assert.equal(archiveWithoutFeatured.length, 11);
  assert.equal(archiveWithoutFeatured[0].id, "2026-11-24-pre");
  assert.deepEqual(
    nextWithoutFeatured.map((b) => b.id),
    ["2026-11-16-pre", "2026-11-16-post"],
  );
  const archiveIds = [...archiveWithoutFeatured, ...nextWithoutFeatured].map(
    (b) => b.id,
  );
  assert.equal(new Set(archiveIds).size, 13);
  assert.ok(!archiveIds.includes(featuredId));
  const postWithoutFeatured = await repo.publicArchive({
    session: "post",
    excludeId: featuredId,
    dateWindow: { limit: 6, offset: 0 },
  });
  assert.deepEqual(
    postWithoutFeatured.map((b) => b.date),
    [
      "2026-11-23",
      "2026-11-20",
      "2026-11-19",
      "2026-11-18",
      "2026-11-17",
      "2026-11-16",
    ],
  );
  assert.equal(
    (
      await repo.publicArchive({
        date: "2026-11-24",
        session: "post",
        excludeId: featuredId,
        dateWindow: { limit: 7, offset: 0 },
      })
    ).length,
    0,
  );
  assert.equal(
    (await repo.publicList({ excludeId: featuredId, limit: 1 }))[0].id,
    "2026-11-24-pre",
  );
  check("메인 회차 제외·같은 날 이전 회차 유지·제외 후 거래일 페이지 계산");
  await db.query(
    "UPDATE briefings SET visible=false WHERE id='2026-11-24-pre'",
  );
  await assert.rejects(
    () => repo.enqueue("2026-11-24", "pre", config, now()),
    /PRE_PUBLICATION_ENDED/,
  );
  assert.equal(
    (await db.query("SELECT id FROM jobs WHERE briefing_id='2026-11-24-pre'"))
      .rowCount,
    0,
  );
  const unvalidatedVersion = randomUUID();
  await db.query(
    "INSERT INTO briefing_versions(id,briefing_id,content,created_at,config,validated) VALUES($1,'2026-11-24-post',$2,now(),$3,false)",
    [unvalidatedVersion, sampleContent("2026-11-24", "post"), config],
  );
  await db.query(
    "UPDATE briefings SET current_version_id=$1 WHERE id='2026-11-24-post'",
    [unvalidatedVersion],
  );
  const publicDays = await repo.publicArchive({
    dateWindow: { limit: 6, offset: 0 },
  });
  assert.equal(publicDays.length, 12);
  assert.ok(publicDays.every((b) => b.date !== "2026-11-24"));
  assert.equal(
    (
      await repo.publicArchive({
        date: "2026-11-24",
        dateWindow: { limit: 7, offset: 0 },
      })
    ).length,
    0,
  );
  check("거래일 페이지 경계·세션/날짜 필터·비공개 및 미검증 버전 제외");
  const backlogEnd = new Date("2026-06-30T12:00:00Z");
  const juneStart = new Date("2026-06-01T00:00:00Z");
  const backlog = [
    ...dueSlots(
      new Date("2026-05-30T12:00:00Z"),
      new Date("2026-05-01T00:00:00Z"),
    ),
    ...dueSlots(backlogEnd, juneStart),
  ];
  assert.ok(backlog.length > 30);
  for (const { date, session } of backlog) await repo.ensureSlot(date, session);
  await w.detectDelays(new Date("2026-07-01T12:00:00Z"));
  assert.equal(
    (
      await db.query(
        "SELECT id FROM notification_outbox WHERE kind='delay' AND briefing_id=ANY($1::text[])",
        [backlog.map((s) => s.id)],
      )
    ).rowCount,
    backlog.length,
  );
  check("30회를 초과하는 누락 회차도 지연 알림 등록");
  await checkOperationalFlows(
    db,
    admin,
    { ...c, DATABASE_URL: url.toString() },
    check,
  );
  console.log(
    `Integration: ${checks} checks passed (local PostgreSQL; external services mocked).`,
  );
} finally {
  await db.end();
  await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
