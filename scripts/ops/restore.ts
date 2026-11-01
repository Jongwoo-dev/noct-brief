import "../env";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readConfig } from "../../lib/config";
import { pgTool } from "./pg-tools";
const c = readConfig(),
  file = process.argv[2],
  target = process.env.RESTORE_DATABASE_URL;
if (!file || !target || process.env.CONFIRM_RESTORE !== "empty-database")
  throw new Error(
    "분리된 빈 DB와 CONFIRM_RESTORE=empty-database, 백업 파일을 지정하세요.",
  );
if (target === c.DATABASE_URL)
  throw new Error("사용 중인 앱 DB에 직접 복원할 수 없습니다.");
const { default: pg } = await import("pg");
const db = new pg.Pool({ connectionString: target });
try {
  if (
    (
      await db.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1",
      )
    ).rowCount
  )
    throw new Error("복원 DB가 비어 있지 않습니다.");
} finally {
  await db.end();
}
const u = new URL(target);
await promisify(execFile)(
  pgTool("pg_restore"),
  [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    "--dbname",
    u.pathname.slice(1),
    file,
  ],
  {
    env: {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || "5432",
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
    },
  },
).catch(() => {
  throw new Error("복원 실패. 비밀 값은 출력하지 않습니다.");
});
console.log("분리 DB 복원 완료. 데이터·권한 검증 후 전환하세요.");
