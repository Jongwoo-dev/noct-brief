import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import type { Config } from "../lib/config";
import { dueSlots, schedule } from "../lib/calendar";
import { assertDatabase } from "../lib/db";
import { adminDetail, adminOverview } from "../lib/admin-queries";
import { checkBackupAge, drainNotifications } from "../lib/notifications";
import { Repository, type Job } from "../lib/repository";
import { backupDatabase } from "./ops/backup";

const exec = promisify(execFile);
type Check = (label: string) => void;

async function recoveryPolicy(db: pg.Pool, check: Check) {
  const repo = new Repository(db, "sample");
  const config: Job["config"] = {
    mode: "sample",
    model: "sample",
    promptVersion: "test",
    reasoning: "medium",
    maxOutputTokens: 8000,
  };
  const before = new Date("2026-12-01T00:15:00Z"); // Monday 19:15 ET, post is preparing.
  const slots = dueSlots(before, new Date("2026-11-25T10:00:00Z"));
  const older = "2026-11-25-post",
    current = "2026-11-27-post",
    next = "2026-11-30-post";
  const pre = schedule("2026-11-30", "pre");
  const absentPre = schedule("2026-11-27", "pre");
  const bundledPre = schedule("2026-11-25", "pre");
  const progress = (await adminOverview(db, "progress", "", 1)).counts.progress;
  for (const slot of [pre, bundledPre]) {
    await db.query(
      "INSERT INTO briefings(id,us_trading_date,session,target_at) VALUES($1,$2,$3,$4)",
      [slot.id, slot.date, slot.session, slot.targetAt],
    );
  }
  await db.query(
    `INSERT INTO jobs(id,briefing_id,kind,dedupe_key,state,next_at,config,payload,created_at)
     VALUES(gen_random_uuid(),$1,'initial',$1,'generating',$2,$3,'{"responseId":"resp_preserved"}',$2)`,
    [pre.id, pre.targetAt, config],
  );
  const overview = await adminOverview(db, "progress", pre.date, 1);
  assert.equal(overview.total, 0);
  assert.equal(overview.counts.progress, progress);
  assert.equal((await adminDetail(db, pre.id))?.edition.job?.state, "stopped");
  assert.equal((await adminDetail(db, pre.id))?.jobs[0].state, "stopped");
  await assert.rejects(
    () => repo.ensureSlot(absentPre.date, "pre"),
    /PRE_PUBLICATION_ENDED/,
  );
  await assert.rejects(
    () => repo.enqueue(absentPre.date, "pre", config, before),
    /PRE_PUBLICATION_ENDED/,
  );
  await assert.rejects(
    () => repo.enqueue(pre.date, "pre", config, before),
    /PRE_PUBLICATION_ENDED/,
  );
  assert.equal(await repo.publicDetail(pre.id), null);
  assert.ok(!(await repo.delays(before)).some((row) => row.id === pre.id));
  assert.notEqual(
    (await repo.claim("legacy-test", before))?.briefing_id,
    pre.id,
  );
  await repo.enqueue("2026-11-25", "post", config, before);
  await db.query("UPDATE jobs SET state='submitting' WHERE briefing_id=$1", [
    older,
  ]);
  await Promise.all([
    repo.reconcileSchedule([...slots, absentPre], config, before),
    repo.reconcileSchedule(slots, config, before),
  ]);
  const states = async () =>
    (
      await db.query(
        "SELECT b.id,b.missed_at,j.state,j.error_code FROM briefings b JOIN jobs j ON j.briefing_id=b.id WHERE b.id=ANY($1::text[])",
        [[older, current, next]],
      )
    ).rows;
  const rows = await states();
  assert.equal(
    (await db.query("SELECT id FROM briefings WHERE id=$1", [absentPre.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await db.query("SELECT id FROM jobs WHERE briefing_id=$1", [
        bundledPre.id,
      ])
    ).rowCount,
    0,
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT state,payload->>'responseId' AS response FROM jobs WHERE briefing_id=$1",
        [pre.id],
      )
    ).rows[0],
    { state: "generating", response: "resp_preserved" },
  );
  await db.query("UPDATE jobs SET state='submitting' WHERE briefing_id=$1", [
    pre.id,
  ]);
  const attention = await adminOverview(db, "attention", pre.date, 1);
  assert.equal(attention.editions[0].job?.state, "failed");
  assert.equal(attention.editions[0].job?.errorCode, "SUBMISSION_UNKNOWN");
  await db.query(
    "UPDATE jobs SET state='failed',error_code='HTTP_429' WHERE briefing_id=$1",
    [pre.id],
  );
  await assert.rejects(
    repo.adminCommand(
      {
        id: crypto.randomUUID(),
        action: "retry",
        briefingId: pre.id,
        baseVersion: "",
      },
      config,
      before,
    ),
    /PRE_PUBLICATION_ENDED/,
  );
  assert.equal(await repo.missedDetail(pre.id), null);
  check(
    "장전 신규 반입·등록·예약·재시도·작업 실행 차단 및 기존 접수 기록 보존",
  );
  assert.equal(
    rows.find((r) => r.id === older).error_code,
    "SUBMISSION_UNKNOWN",
  );
  assert.ok(rows.find((r) => r.id === older).missed_at);
  assert.ok(
    [current, next].every((id) =>
      rows.some((r) => r.id === id && !r.missed_at && r.state === "queued"),
    ),
  );
  const originalTime = schedule("2026-11-27", "post").targetAt;
  for (const cutoffAt of [originalTime, before.toISOString()]) {
    await db.query(
      "INSERT INTO collection_bundles(briefing_id,revision,collected_at,bundle) VALUES($1,gen_random_uuid(),$2,$3)",
      [current, cutoffAt, { cutoffAt }],
    );
  }
  assert.equal(
    (await repo.latestBundle(current, new Date(originalTime)))?.cutoffAt,
    originalTime,
  );
  assert.ok(await repo.missedDetail(older));
  assert.equal(await repo.publicDetail(older), null);
  assert.equal(
    (
      await repo.publicArchive({
        date: "2026-11-25",
        dateWindow: { limit: 6, offset: 0 },
      })
    ).length,
    1,
  );
  assert.ok(!(await repo.delays(before)).some((r) => r.id === older));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM notification_outbox WHERE kind='missed_editions'",
      )
    ).rows[0].n,
    1,
  );
  const command = (action: "hide" | "restore" | "retry") =>
    repo.adminCommand(
      { id: crypto.randomUUID(), briefingId: older, baseVersion: "", action },
      config,
      before,
    );
  await assert.rejects(command("retry"), /RETRY_NOT_AVAILABLE/);
  await db.query(
    `UPDATE jobs SET state='generating',payload='{"responseId":"resp_saved"}' WHERE briefing_id=$1`,
    [current],
  );
  await command("hide");
  await repo.reconcileSchedule(slots, config, before);
  const resumed = (
    await db.query(
      "SELECT state,payload->>'responseId' AS response FROM jobs WHERE briefing_id=$1",
      [current],
    )
  ).rows[0];
  assert.deepEqual(resumed, { state: "generating", response: "resp_saved" });
  assert.equal(await repo.missedDetail(older), null);
  await command("restore");
  assert.ok(await repo.missedDetail(older));
  assert.equal(await repo.missedDetail("2026-11-24-pre"), null); // previously hidden, versioned
  const atTarget = new Date(schedule("2026-11-30", "post").targetAt);
  await repo.reconcileSchedule([], config, atTarget);
  assert.ok(await repo.missedDetail(current));
  assert.equal(await repo.missedDetail(next), null);
  check(
    "재시작 시 최신 도래 회차만 재개·준비 회차 분리·동시 복구·안내 공개/숨김·접수 불명 보존",
  );
  const hidden = schedule("2026-11-24", "pre");
  const earlier = await repo.ensureSlot("2026-11-13", "post");
  await repo.reconcileSchedule(
    [earlier, hidden],
    config,
    new Date(hidden.targetAt),
  );
  assert.ok(await repo.missedDetail(earlier.id));
  assert.equal(await repo.publicDetail(hidden.id), null);
  assert.equal(await repo.missedDetail(hidden.id), null);
  assert.equal(
    (await db.query("SELECT id FROM jobs WHERE briefing_id=$1", [hidden.id]))
      .rowCount,
    0,
  );
  check(
    "최신 도래 회차가 이미 발행 후 비공개이면 앞선 회차 발행·기존 회차 재등록 없음",
  );
}

async function scheduler(db: pg.Pool, c: Config, check: Check) {
  const run = (...args: string[]) =>
    exec(process.execPath, ["--import", "tsx", "scripts/worker.ts", ...args], {
      env: { ...process.env, DATABASE_URL: c.DATABASE_URL },
    });
  const marker = async () =>
    (
      await db.query(
        "SELECT value FROM app_settings WHERE key='last_scheduler'",
      )
    ).rows[0]?.value;
  await assert.rejects(run(), /작업 처리 실패/);
  assert.equal(await marker(), undefined);
  check("로컬 CLI 자동 실행 차단·성공 시각 미기록");
  const prior = new Date(Date.now() - 45 * 86400000).toISOString();
  await db.query(
    "INSERT INTO app_settings(key,value) VALUES('last_scheduler',$1)",
    [prior],
  );
  // Simulate an interruption at the checkpoint after the worker has queued its jobs.
  await db.query(`ALTER TABLE app_settings ADD CONSTRAINT interrupt_checkpoint
    CHECK (key <> 'last_scheduler' OR value = '${prior}')`);
  await assert.rejects(run("--sample"), /작업 처리 실패/);
  assert.equal(await marker(), prior);
  await db.query(
    "ALTER TABLE app_settings DROP CONSTRAINT interrupt_checkpoint",
  );
  await run("--sample");
  const resumed = new Date(await marker());
  assert.ok(resumed.getTime() > Date.parse(prior));
  const slots = dueSlots(resumed, new Date(resumed.getTime() - 31 * 86400000));
  const scheduled = await db.query(
    `SELECT b.id,b.current_version_id,j.id AS job
    FROM briefings b LEFT JOIN jobs j ON j.briefing_id=b.id AND j.kind='initial'
    WHERE b.id=ANY($1::text[])`,
    [slots.map((s) => s.id)],
  );
  assert.equal(scheduled.rowCount, slots.length);
  assert.ok(scheduled.rows.every((r) => r.current_version_id || r.job));
  // A tick started earlier can finish after a later tick saved its timestamp.
  const newer = new Date(Date.now() + 300000).toISOString();
  await db.query(
    "UPDATE app_settings SET value=$1 WHERE key='last_scheduler'",
    [newer],
  );
  await run("--sample");
  assert.equal(await marker(), newer);
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM jobs WHERE kind='initial' GROUP BY briefing_id HAVING count(*)>1",
      )
    ).rowCount,
    0,
  );
  check("분리 DB의 CLI 재시작·누락 회차 회복·재실행 중복 방지·완료 시각 갱신");
}

async function notifications(db: pg.Pool, c: Config, check: Check) {
  const start = new Date("2030-01-02T00:00:00Z");
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60000);
  const prod = {
    ...c,
    APP_ENV: "production" as const,
    AUTO_PUBLISH_ENABLED: true,
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: "test-only",
    TELEGRAM_CHAT_ID: "test-only",
  };
  const ok = async () => Response.json({ ok: true });
  while ((await drainNotifications(db, prod, "report", ok, start)).sent > 0) {}
  const repo = new Repository(db, "sample");
  const id = "2026-10-23-pre";
  await repo.notify(id, "retry_test", "모의 발송 오류", start);
  let calls = 0;
  const reject = async () => {
    calls++;
    return Response.json({ ok: false }, { status: 503 });
  };
  for (const [attempt, minute] of [0, 1, 6, 21].entries()) {
    await drainNotifications(
      db,
      prod,
      "report",
      reject,
      new Date(at(minute).getTime() - 1),
    );
    assert.equal(calls, attempt);
    await Promise.all([
      drainNotifications(db, prod, "report", reject, at(minute)),
      drainNotifications(db, prod, "report", reject, at(minute)),
    ]);
    assert.equal(calls, attempt + 1);
  }
  await drainNotifications(db, prod, "report", reject, at(80));
  assert.equal(calls, 4);
  const overview = await adminOverview(db, "all", "", 1);
  assert.ok(
    overview.notices.some(
      (n) =>
        n.kind === "retry_test" && n.status === "failed" && n.attempts === 4,
    ),
  );
  check("모의 전송 동시 실행·1/5/15분 재시도·최종 실패 관리자 조회");
  await repo.notify(id, "recovery_test", "모의 재전송", at(81));
  await drainNotifications(db, prod, "report", reject, at(81));
  assert.equal(
    (await drainNotifications(db, prod, "report", ok, at(82))).sent,
    1,
  );
  assert.equal(
    (await drainNotifications(db, prod, "report", ok, at(83))).sent,
    0,
  );
  check("일시적 전송 실패 후 재전송 성공·발송 완료 건 재전송 억제");
  await checkBackupAge(db, start);
  await checkBackupAge(db, new Date(at(26 * 60).getTime() - 1));
  const countStale = async () =>
    (
      await db.query(
        "SELECT id FROM notification_outbox WHERE kind='backup_stale'",
      )
    ).rowCount;
  assert.equal(await countStale(), 0);
  await checkBackupAge(db, at(26 * 60));
  await checkBackupAge(db, at(27 * 60));
  assert.equal(await countStale(), 1);
  await db.query(
    "INSERT INTO app_settings(key,value) VALUES('last_backup',$1)",
    [at(27 * 60).toISOString()],
  );
  await checkBackupAge(db, at(28 * 60));
  assert.equal(await countStale(), 1);
  await checkBackupAge(db, at(53 * 60));
  assert.equal(await countStale(), 2);
  check("최초 감시와 최근 백업 각각 26시간 경계·중복 억제");
  const backupOnly = {
    ...prod,
    AUTO_PUBLISH_ENABLED: false,
    AUTO_BACKUP_ENABLED: true,
  };
  const retryAt = at(54 * 60);
  await repo.notify(id, "report_scope_test", "리포트 오류 시험", retryAt);
  assert.equal(
    (await drainNotifications(db, prod, "backup", ok, retryAt)).disabled,
    true,
  );
  assert.equal(
    (await drainNotifications(db, backupOnly, "report", ok, retryAt)).disabled,
    true,
  );
  const both = { ...prod, AUTO_BACKUP_ENABLED: true };
  assert.equal(
    (await drainNotifications(db, both, "report", ok, retryAt)).sent,
    1,
  );
  await repo.notify(id, "report_scope_pending", "리포트 재전송 시험", retryAt);
  await drainNotifications(db, backupOnly, "backup", reject, retryAt);
  assert.equal(
    (await drainNotifications(db, backupOnly, "backup", ok, at(54 * 60 + 1)))
      .sent,
    2,
  );
  assert.equal(
    (
      await db.query(
        "SELECT status FROM notification_outbox WHERE kind='report_scope_pending'",
      )
    ).rows[0].status,
    "pending",
  );
  assert.equal(
    (await drainNotifications(db, prod, "report", ok, at(54 * 60 + 1))).sent,
    1,
  );
  check("발행 중지 중 백업 경보만 재전송·백업 중지 중 발행 경보만 전송");
}

async function backupRestore(
  db: pg.Pool,
  admin: pg.Pool,
  c: Config,
  check: Check,
) {
  const url = new URL(c.DATABASE_URL);
  const sourceName = (await db.query("SELECT current_database() AS name"))
    .rows[0].name as string;
  assert.match(sourceName, /^noct_test_[a-f0-9]{32}_local$/);
  assert.equal(url.pathname, "/" + sourceName);
  const runBackupCLI = (local: boolean, enabled: boolean) =>
    exec(process.execPath, ["--import", "tsx", "scripts/ops/backup.ts"], {
      env: {
        ...process.env,
        APP_ENV: local ? "local" : "production",
        DATA_MODE: local ? "sample" : "live",
        BETTER_AUTH_URL: "https://example.invalid",
        DATABASE_URL: "postgresql://127.0.0.1:1/unavailable_local",
        AUTO_BACKUP_ENABLED: String(enabled),
        AUTO_PUBLISH_ENABLED: "false",
        EXTERNAL_CALLS_ENABLED: "false",
        TELEGRAM_ENABLED: "false",
        BACKUP_BUCKET: "",
      },
    });
  for (const local of [true, false]) {
    const result = await runBackupCLI(local, false);
    assert.equal(result.stdout.trim(), "");
  }
  await assert.rejects(runBackupCLI(true, true), /로컬에서는/);
  check(
    "자동 백업 OFF이면 운영·로컬 CLI가 DB와 버킷 없이 종료하고 로컬 ON은 거부",
  );
  const restored = sourceName + "_restored";
  const dest = new URL(url);
  dest.pathname = "/" + restored;
  const now = new Date("2030-02-01T07:00:00Z");
  const key = "noct-db/noct-2030-02-01T07-00-00Z.dump";
  const old = "noct-db/noct-2030-01-17T07-00-00Z.dump";
  const boundary = "noct-db/noct-2030-01-18T07-00-00Z.dump";
  await mkdir("temp/work", { recursive: true });
  const file = resolve("temp/work", sourceName + ".dump");
  const restore = (target: string, confirm = "empty-database") =>
    exec(
      process.execPath,
      ["--import", "tsx", "scripts/ops/restore.ts", file],
      {
        env: {
          ...process.env,
          DATABASE_URL: c.DATABASE_URL,
          RESTORE_DATABASE_URL: target,
          CONFIRM_RESTORE: confirm,
        },
      },
    );
  let failure = "",
    calls: string[] = [],
    size = 0,
    digest = "";
  const store = async (args: string[]) => {
    const action = args[1];
    calls.push(action);
    const param = (flag: string) => {
      assert.ok(args.includes(flag));
      return args[args.indexOf(flag) + 1];
    };
    assert.equal(param("--bucket"), "test-only");
    if (action === failure) throw new Error("모의 저장소 오류");
    switch (action) {
      case "put-object": {
        assert.equal(param("--key"), key);
        const data = await readFile(param("--body"));
        size = data.length;
        digest = createHash("sha256").update(data).digest("hex");
        assert.equal(param("--metadata"), "sha256=" + digest);
        assert.equal(param("--server-side-encryption"), "AES256");
        if (!failure) await writeFile(file, data, { flag: "wx" });
        return "{}";
      }
      case "head-object":
        assert.equal(param("--key"), key);
        return JSON.stringify({
          ContentLength: size,
          Metadata: { sha256: failure === "mismatch" ? "wrong" : digest },
        });
      case "list-objects-v2":
        assert.equal(param("--prefix"), "noct-db/");
        return JSON.stringify({
          Contents: [key, old, boundary, "noct-db/notes.dump"].map((Key) => ({
            Key,
          })),
        });
      case "delete-object":
        assert.equal(param("--key"), old);
        return "{}";
      default:
        throw new Error("예상 밖의 모의 저장소 명령");
    }
  };
  const lastBackup = async () =>
    (await db.query("SELECT value FROM app_settings WHERE key='last_backup'"))
      .rows[0]?.value;
  const previous = await lastBackup();
  for (const [error, expected] of [
    ["put-object", ["put-object"]],
    ["mismatch", ["put-object", "head-object"]],
    [
      "delete-object",
      ["put-object", "head-object", "list-objects-v2", "delete-object"],
    ],
  ] as const) {
    failure = error;
    calls = [];
    await assert.rejects(
      backupDatabase(db, c, "test-only", store, now),
      /DB 백업 실패/,
    );
    assert.deepEqual(calls, expected);
    assert.equal(await lastBackup(), previous);
  }
  assert.equal(
    (await db.query("SELECT id FROM notification_outbox WHERE kind='backup'"))
      .rowCount,
    1,
  );
  check(
    "백업 업로드·무결성 확인·만료 정리 실패 시 성공 시각 보존과 단일 예외 알림",
  );
  await admin.query(`CREATE DATABASE "${restored}"`);
  try {
    failure = "";
    calls = [];
    await backupDatabase(db, c, "test-only", store, now);
    assert.deepEqual(calls, [
      "put-object",
      "head-object",
      "list-objects-v2",
      "delete-object",
    ]);
    assert.equal(await lastBackup(), now.toISOString());
    check("실제 pg_dump·모의 업로드 검증 뒤 14일 초과분만 정리");
    await assert.rejects(restore(dest.toString(), ""), /CONFIRM_RESTORE/);
    const alias = new URL(url);
    alias.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    alias.searchParams.set("application_name", "restore-check");
    await assert.rejects(restore(alias.toString()), /앱 DB에 직접 복원/);
    const busy = new pg.Client({ connectionString: dest.toString() });
    await busy.connect();
    try {
      await assert.rejects(restore(dest.toString()), /다른 연결/);
      await busy.query("CREATE SCHEMA keep_me");
    } finally {
      await busy.end();
    }
    await assert.rejects(restore(dest.toString()), /비어 있지 않습니다/);
    const prep = new pg.Client({ connectionString: dest.toString() });
    await prep.connect();
    try {
      await prep.query("DROP SCHEMA keep_me");
    } finally {
      await prep.end();
    }
    check(
      "복원 CLI의 명시 확인·앱 DB 별칭·사용 중인 대상·빈 사용자 스키마 차단",
    );
    await restore(dest.toString());
    await assert.rejects(restore(dest.toString()), /비어 있지 않습니다/);
    const copy = new pg.Pool({ connectionString: dest.toString() });
    try {
      await assertDatabase(copy, "local", "sample");
      const query = `SELECT b.id,b.current_version_id,b.visible,b.missed_at,v.id AS version,v.previous_id
        FROM briefings b LEFT JOIN briefing_versions v ON v.briefing_id=b.id ORDER BY b.id,v.id`;
      assert.deepEqual(
        (await copy.query(query)).rows,
        (await db.query(query)).rows,
      );
      const repo = new Repository(copy, "sample");
      assert.ok(await repo.publicDetail("2026-10-23-pre"));
      assert.equal(await repo.publicDetail("2026-11-24-pre"), null);
      assert.equal(await repo.publicDetail("2026-11-24-post"), null);
      assert.deepEqual(
        await repo.publicList(),
        await new Repository(db, "sample").publicList(),
      );
    } finally {
      await copy.end();
    }
    check(
      "운영 복원 CLI로 분리 DB 복원·전체 버전 연결·환경 표식·공개/비공개 조회 대조",
    );
  } finally {
    await admin.query(`DROP DATABASE "${restored}"`);
    await unlink(file).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}

export async function checkOperationalFlows(
  db: pg.Pool,
  admin: pg.Pool,
  c: Config,
  check: Check,
) {
  await recoveryPolicy(db, check);
  await scheduler(db, c, check);
  await notifications(db, c, check);
  await backupRestore(db, admin, c, check);
}
