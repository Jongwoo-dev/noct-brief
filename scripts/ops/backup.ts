import "../env";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, stat, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readConfig } from "../../lib/config";
import { pool } from "../../lib/db";
import { drainNotifications } from "../../lib/notifications";
import { expiredBackups } from "./backup-policy";
import { pgTool } from "./pg-tools";
const exec = promisify(execFile),
  c = readConfig();
if (c.APP_ENV !== "production" || !process.env.BACKUP_BUCKET)
  throw new Error("운영 환경과 BACKUP_BUCKET 설정이 필요합니다.");
const bucket = process.env.BACKUP_BUCKET;
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
  throw new Error("백업 저장소 이름 확인 필요");
const now = new Date(),
  name = `noct-${now.toISOString().slice(0, 19).replaceAll(":", "-")}Z.dump`,
  key = `noct-db/${name}`;
const dir = await mkdtemp(join(tmpdir(), "noct-backup-")),
  file = join(dir, name);
const u = new URL(c.DATABASE_URL),
  pgEnv = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1),
  };
try {
  await exec(
    pgTool("pg_dump"),
    ["--format=custom", "--no-owner", "--no-acl", "--file", file],
    { env: pgEnv, maxBuffer: 1048576 },
  );
  await exec(pgTool("pg_restore"), ["--list", file]);
  const size = (await stat(file)).size;
  if (size < 100) throw new Error("EMPTY_BACKUP");
  const hash = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  await exec("aws", [
    "s3api",
    "put-object",
    "--bucket",
    bucket,
    "--key",
    key,
    "--body",
    file,
    "--server-side-encryption",
    "AES256",
    "--metadata",
    `sha256=${hash}`,
  ]);
  const head = JSON.parse(
    (
      await exec("aws", [
        "s3api",
        "head-object",
        "--bucket",
        bucket,
        "--key",
        key,
      ])
    ).stdout,
  );
  if (head.ContentLength !== size || head.Metadata?.sha256 !== hash)
    throw new Error("UPLOAD_VERIFICATION_FAILED");
  const listing = JSON.parse(
    (
      await exec("aws", [
        "s3api",
        "list-objects-v2",
        "--bucket",
        bucket,
        "--prefix",
        "noct-db/",
      ])
    ).stdout,
  );
  // Expire only owned dump names, and only after today's external copy is confirmed.
  for (const old of expiredBackups(
    (listing.Contents ?? []).map((o: { Key: string }) => o.Key),
    now,
  ))
    await exec("aws", [
      "s3api",
      "delete-object",
      "--bucket",
      bucket,
      "--key",
      old,
    ]);
  await pool().query(
    "INSERT INTO app_settings(key,value) VALUES('last_backup',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [now.toISOString()],
  );
  console.log("DB 외부 백업·보관 정책 처리 완료");
} catch {
  await pool()
    .query(
      "INSERT INTO notification_outbox(id,dedupe_key,kind,message,next_at) VALUES(gen_random_uuid(),$1,'backup','DB 외부 백업 실패. 최근 성공 시각을 확인하세요.',$2) ON CONFLICT DO NOTHING",
      [`backup:${now.toISOString().slice(0, 10)}`, now],
    )
    .catch(() => {});
  await drainNotifications(pool(), c).catch(() => {});
  console.error(
    "DB 백업 실패. 비밀 값을 제외한 로컬 시스템 상태를 확인하세요.",
  );
  process.exitCode = 1;
} finally {
  await unlink(file).catch(() => {});
  await rmdir(dir).catch(() => {});
  await pool().end();
}
