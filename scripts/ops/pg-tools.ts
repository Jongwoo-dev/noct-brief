import { existsSync } from "node:fs";
import { resolve } from "node:path";
export function pgTool(name: "pg_dump" | "pg_restore") {
  const filename = process.platform === "win32" ? `${name}.exe` : name;
  if (process.env.PG_CLIENT_BIN)
    return resolve(process.env.PG_CLIENT_BIN, filename);
  const local = resolve(".local/pg-client/bin", filename);
  return existsSync(local) ? local : filename;
}
