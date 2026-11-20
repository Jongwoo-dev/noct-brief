import "../env";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { readConfig } from "../../lib/config";
import { pgDestination, pgTool } from "./pg-tools";

const c = readConfig(),
  file = process.argv[2],
  target = process.env.RESTORE_DATABASE_URL;
if (
  !file ||
  !target ||
  !c.DATABASE_URL ||
  process.env.CONFIRM_RESTORE !== "empty-database"
)
  throw new Error(
    "앱 DB와 분리된 빈 DB, CONFIRM_RESTORE=empty-database, 백업 파일을 지정하세요.",
  );
const destination = pgDestination(target);
const source = pgDestination(c.DATABASE_URL);
const canonicalHost = (host: string) =>
  ["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase())
    ? "localhost"
    : host.toLowerCase();
if (
  destination.database === source.database &&
  canonicalHost(destination.env.PGHOST) === canonicalHost(source.env.PGHOST) &&
  destination.env.PGPORT === source.env.PGPORT
)
  throw new Error("사용 중인 앱 DB에 직접 복원할 수 없습니다.");
const client = new pg.Client({ connectionString: target });
try {
  await client.connect();
  const {
    rows: [state],
  } = await client.query(`
    SELECT current_database() AS name,
      NOT pg_try_advisory_lock(710028) OR EXISTS (
        SELECT FROM pg_stat_activity WHERE datname=current_database()
        AND pid<>pg_backend_pid()
      ) AS busy,
      EXISTS (SELECT FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')
      OR EXISTS (SELECT FROM pg_depend WHERE refclassid='pg_namespace'::regclass AND refobjid=to_regnamespace('public'))
      OR EXISTS (SELECT FROM pg_largeobject_metadata)
      OR EXISTS (SELECT FROM pg_extension WHERE extname<>'plpgsql')
      -- Also catch user-owned objects outside a schema (e.g. publications).
      -- Bootstrap catalog objects have OIDs below FirstNormalObjectId (16384).
      OR EXISTS (SELECT FROM pg_shdepend WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
                 AND objid >= 16384 AND deptype='o') AS occupied
  `);
  if (state.name !== destination.database || state.busy)
    throw new Error("다른 연결이 있거나 복원 대상을 확인할 수 없습니다.");
  if (state.occupied) throw new Error("복원 DB가 비어 있지 않습니다.");
  await promisify(execFile)(
    pgTool("pg_restore"),
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-acl",
      "--dbname",
      destination.database,
      "--",
      file,
    ],
    { env: destination.env },
  );
} catch (error) {
  // Child process errors and invalid connection strings can contain credentials.
  const message = error instanceof Error ? error.message : "";
  console.error(
    [
      "다른 연결이 있거나 복원 대상을 확인할 수 없습니다.",
      "복원 DB가 비어 있지 않습니다.",
    ].includes(message)
      ? message
      : "복원 실패. 대상 DB와 백업 파일을 확인하세요.",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
if (!process.exitCode)
  console.log("분리 DB 복원 완료. 데이터·권한 검증 후 전환하세요.");
