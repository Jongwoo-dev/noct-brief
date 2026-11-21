import "../env";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, stat, unlink, rmdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type pg from "pg";
import { readConfig, type Config } from "../../lib/config";
import { assertDatabase, pool } from "../../lib/db";
import { drainNotifications } from "../../lib/notifications";
import { expiredBackups } from "./backup-policy";
import { pgTool, pgDestination } from "./pg-tools";
const exec = promisify(execFile);

export async function backupDatabase(
  db: pg.Pool,
  c: Config,
  bucket: string,
  aws: (args: string[]) => Promise<string>,
  now = new Date(),
) {
  await assertDatabase(db, c.APP_ENV, c.DATA_MODE);
  const name = `noct-${now.toISOString().slice(0, 19).replaceAll(":", "-")}Z.dump`;
  const key = `noct-db/${name}`;
  let dir: string | undefined;
  try {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
      throw new Error("백업 저장소 이름 확인 필요");
    const pgEnv = pgDestination(c.DATABASE_URL).env;
    dir = await mkdtemp(join(tmpdir(), "noct-backup-"));
    const file = join(dir, name);
    await exec(
      pgTool("pg_dump"),
      ["--format=custom", "--no-owner", "--no-acl", "--file", file],
      { env: pgEnv, maxBuffer: 1048576 },
    );
    await exec(pgTool("pg_restore"), ["--list", file]);
    const size = (await stat(file)).size;
    if (size < 100) throw new Error("EMPTY_BACKUP");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    const hash = digest.digest("hex");
    await aws([
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
      await aws(["s3api", "head-object", "--bucket", bucket, "--key", key]),
    );
    if (head.ContentLength !== size || head.Metadata?.sha256 !== hash)
      throw new Error("UPLOAD_VERIFICATION_FAILED");
    const listing = JSON.parse(
      await aws([
        "s3api",
        "list-objects-v2",
        "--bucket",
        bucket,
        "--prefix",
        "noct-db/",
      ]),
    );
    // Expire only owned dump names, and only after today's external copy is confirmed.
    for (const old of expiredBackups(
      (listing.Contents ?? []).map((o: { Key: string }) => o.Key),
      now,
    ))
      await aws(["s3api", "delete-object", "--bucket", bucket, "--key", old]);
    await db.query(
      "INSERT INTO app_settings(key,value) VALUES('last_backup',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value WHERE app_settings.value::timestamptz < EXCLUDED.value::timestamptz",
      [now.toISOString()],
    );
  } catch {
    await db.query(
      "INSERT INTO notification_outbox(id,dedupe_key,kind,message,next_at) VALUES(gen_random_uuid(),$1,'backup','DB 외부 백업 실패. 최근 성공 시각을 확인하세요.',$2) ON CONFLICT DO NOTHING",
      [`backup:${now.toISOString().slice(0, 10)}`, now],
    );
    await drainNotifications(db, c, "backup");
    throw new Error("DB 백업 실패");
  } finally {
    if (dir) {
      await unlink(join(dir, name)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
      await rmdir(dir);
    }
  }
}

async function runScheduledBackup() {
  const c = readConfig();
  if (!c.AUTO_BACKUP_ENABLED) return;
  const db = pool();
  try {
    await backupDatabase(
      db,
      c,
      process.env.BACKUP_BUCKET ?? "",
      async (args) => (await exec("aws", args)).stdout,
    );
    console.log("DB 외부 백업·보관 정책 처리 완료");
  } catch {
    console.error(
      "DB 백업 실패. 비밀 값을 제외한 로컬 시스템 상태를 확인하세요.",
    );
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runScheduledBackup();
