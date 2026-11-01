import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import EmbeddedPostgres from "embedded-postgres";
import { resolve } from "node:path";
const base = resolve(".local/postgres");
await mkdir(base, { recursive: true });
const credentialFile = resolve(".local/db-password");
let password: string;
try {
  password = await readFile(credentialFile, "utf8");
} catch {
  password = randomBytes(32).toString("hex");
  await writeFile(credentialFile, password, { mode: 0o600 });
}
const pg = new EmbeddedPostgres({
  databaseDir: base,
  user: "noct",
  password,
  port: 55432,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
try {
  await access(resolve(base, "PG_VERSION"));
} catch {
  await pg.initialise();
}
await pg.start();
const client = pg.getPgClient("postgres", "127.0.0.1");
await client.connect();
if (
  !(
    await client.query(
      "SELECT 1 FROM pg_database WHERE datname='noct_brief_local'",
    )
  ).rowCount
)
  await client.query("CREATE DATABASE noct_brief_local");
await client.end();
let env = "";
try {
  env = await readFile(".env.local", "utf8");
} catch {
  env = await readFile(".env.example", "utf8");
}
if (!/^DATABASE_URL=.+$/m.test(env)) {
  const databaseLine = `DATABASE_URL=postgresql://noct:${password}@127.0.0.1:55432/noct_brief_local`;
  env = /^DATABASE_URL=/m.test(env)
    ? env.replace(/^DATABASE_URL=.*$/m, databaseLine)
    : `${env.trimEnd()}\n${databaseLine}\n`;
  await writeFile(".env.local", env, { mode: 0o600 });
}
console.log(
  "개발 PostgreSQL 준비 완료 · 127.0.0.1:55432 · 이 프로세스를 유지하세요. 비밀 값은 출력하지 않습니다.",
);
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 60000);
