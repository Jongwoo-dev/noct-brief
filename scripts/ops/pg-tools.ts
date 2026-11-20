import { existsSync } from "node:fs";
import { resolve } from "node:path";
// Use the same explicit destination for the DB checks and PostgreSQL utilities.
// Keep credentials out of argv and reject connection overrides we cannot carry across.
export function pgDestination(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const database = decodeURI(url.pathname.slice(1));
    const host = decodeURIComponent(url.hostname.replace(/^\[|\]$/g, ""));
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !host ||
      !database ||
      url.hash ||
      /[=/\0]/.test(database)
    )
      throw new Error();
    const env = { ...process.env };
    delete env.PGHOSTADDR;
    delete env.PGSERVICE;
    const options = new Map([
      ["sslmode", "PGSSLMODE"],
      ["sslcert", "PGSSLCERT"],
      ["sslkey", "PGSSLKEY"],
      ["sslrootcert", "PGSSLROOTCERT"],
      ["application_name", "PGAPPNAME"],
      ["connect_timeout", "PGCONNECT_TIMEOUT"],
    ]);
    for (const [key, value] of url.searchParams) {
      const variable = options.get(key);
      if (!variable) throw new Error();
      env[variable] = value;
    }
    const port = url.port || process.env.PGPORT || "5432";
    return {
      database,
      env: {
        ...env,
        PGHOST: host,
        PGPORT: port,
        PGDATABASE: database,
        PGUSER: decodeURIComponent(url.username) || process.env.PGUSER,
        PGPASSWORD: decodeURIComponent(url.password) || process.env.PGPASSWORD,
      },
    };
  } catch {
    throw new Error("PostgreSQL 도구의 DB 주소 또는 연결 옵션을 확인하세요.");
  }
}
export function pgTool(name: "pg_dump" | "pg_restore") {
  const filename = process.platform === "win32" ? `${name}.exe` : name;
  if (process.env.PG_CLIENT_BIN)
    return resolve(process.env.PG_CLIENT_BIN, filename);
  const local = resolve(".local/pg-client/bin", filename);
  return existsSync(local) ? local : filename;
}
