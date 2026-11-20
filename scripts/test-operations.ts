import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import type { Config } from "../lib/config";
import { dueSlots } from "../lib/calendar";
import { assertDatabase } from "../lib/db";
import { adminOverview } from "../lib/admin-queries";
import { checkBackupAge, drainNotifications } from "../lib/notifications";
import { Repository } from "../lib/repository";
import { backupDatabase } from "./ops/backup";

const exec = promisify(execFile);
type Check = (label: string) => void;

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
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: "test-only",
    TELEGRAM_CHAT_ID: "test-only",
  };
  const ok = async () => Response.json({ ok: true });
  while ((await drainNotifications(db, prod, ok, start)).sent > 0) {}
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
      reject,
      new Date(at(minute).getTime() - 1),
    );
    assert.equal(calls, attempt);
    await Promise.all([
      drainNotifications(db, prod, reject, at(minute)),
      drainNotifications(db, prod, reject, at(minute)),
    ]);
    assert.equal(calls, attempt + 1);
  }
  await drainNotifications(db, prod, reject, at(80));
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
  await drainNotifications(db, prod, reject, at(81));
  assert.equal((await drainNotifications(db, prod, ok, at(82))).sent, 1);
  assert.equal((await drainNotifications(db, prod, ok, at(83))).sent, 0);
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
      const query = `SELECT b.id,b.current_version_id,b.visible,v.id AS version,v.previous_id
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
  await scheduler(db, c, check);
  await notifications(db, c, check);
  await backupRestore(db, admin, c, check);
}
