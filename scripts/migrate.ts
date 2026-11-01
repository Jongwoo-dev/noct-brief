import "./env";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type pg from "pg";
import { pathToFileURL } from "node:url";
import { pool, transaction } from "../lib/db";
import { readConfig } from "../lib/config";
export async function migrate(
  db: pg.Pool,
  env: string,
  mode: string = "sample",
) {
  await transaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(710027)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("db/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(`db/migrations/${name}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const old = (
        await tx.query("SELECT checksum FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).rows[0];
      if (old) {
        if (old.checksum !== checksum)
          throw new Error(`적용된 마이그레이션 변경: ${name}`);
        continue;
      }
      await tx.query(sql);
      await tx.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
    }
    const marker = (
      await tx.query("SELECT value FROM app_settings WHERE key='environment'")
    ).rows[0]?.value;
    if (marker && marker !== env) throw new Error("DB 환경 불일치");
    await tx.query(
      "INSERT INTO app_settings(key,value) VALUES('environment',$1) ON CONFLICT DO NOTHING",
      [env],
    );
    const dataMode = (
      await tx.query("SELECT value FROM app_settings WHERE key='data_mode'")
    ).rows[0]?.value;
    if (dataMode && dataMode !== mode) throw new Error("DB 데이터 모드 불일치");
    await tx.query(
      "INSERT INTO app_settings(key,value) VALUES('data_mode',$1) ON CONFLICT DO NOTHING",
      [mode],
    );
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const c = readConfig();
  if (
    c.APP_ENV === "production" &&
    process.env.CONFIRM_PRODUCTION_MIGRATION !== "production"
  )
    throw new Error("운영 마이그레이션은 백업과 별도 승인이 필요합니다.");
  await migrate(pool(), c.APP_ENV, c.DATA_MODE);
  await pool().end();
  console.log("마이그레이션 완료");
}
