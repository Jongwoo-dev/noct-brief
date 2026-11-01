import pg from "pg";
import { readConfig } from "./config";
const globalDb = globalThis as unknown as { noctPool?: pg.Pool };
export function pool() {
  const c = readConfig();
  if (!c.DATABASE_URL) throw new Error("DATABASE_URL 설정이 필요합니다.");
  return (globalDb.noctPool ??= new pg.Pool({
    connectionString: c.DATABASE_URL,
    max: 6,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  }));
}
export async function assertDatabase(db: pg.Pool, env: string, mode?: string) {
  const r = await db.query(
    "SELECT value FROM app_settings WHERE key='environment'",
  );
  if (r.rows[0]?.value !== env)
    throw new Error(
      "DB 환경 표식 불일치. 마이그레이션 대상 환경을 확인하세요.",
    );
  if (mode) {
    const r = await db.query(
      "SELECT value FROM app_settings WHERE key='data_mode'",
    );
    if (r.rows[0]?.value !== mode)
      throw new Error(
        "DB 데이터 모드 불일치. 별도 DB와 마이그레이션 설정을 확인하세요.",
      );
  }
}
export async function transaction<T>(
  db: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const v = await fn(client);
    await client.query("COMMIT");
    return v;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
