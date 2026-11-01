import "./env";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const parsed = new URL(base);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname))
  throw new Error("HTTP 검증은 로컬 주소만 허용합니다.");
const home = await fetch(base);
assert.equal(home.status, 200);
const homeBody = await home.text();
assert.match(homeBody, /가상 데이터/);
for (const path of ["favicon.ico", "icon.svg", "apple-icon.png"]) {
  assert.ok(homeBody.includes(`/${path}?`), `Missing icon metadata: ${path}`);
  const response = await fetch(`${base}/${path}`);
  assert.equal(response.status, 200);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    await readFile(`app/${path}`),
    `Served icon differs from source: ${path}`,
  );
}
for (const path of ["brand/noct-mark.svg", "licenses/lucide.txt"]) {
  const response = await fetch(`${base}/${path}`);
  assert.equal(response.status, 200);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    await readFile(`public/${path}`),
  );
}
const empty = await fetch(`${base}/?date=2026-01-01&session=pre`);
assert.match(await empty.text(), /조건에 맞는 지난 브리핑이 없습니다/);
const missing = await fetch(`${base}/briefings/not-a-real-id`);
assert.ok([200, 404].includes(missing.status));
const missingBody = await missing.text();
assert.match(missingBody, /공개된 브리핑을 찾을 수 없습니다/);
assert.match(missingBody, /noindex/);
for (const origin of ["https://foreign.example", "http://localhost:3000"]) {
  const r = await fetch(`${base}/api/admin/command`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: "better-auth.session_token=forged",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
}
assert.equal(
  (
    await fetch(`${base}/api/internal/tick`, {
      method: "POST",
      headers: { authorization: "Bearer forged" },
    })
  ).status,
  403,
);
assert.equal((await fetch(`${base}/api/health`)).status, 200);
const admin = await fetch(`${base}/admin`);
const body = await admin.text();
assert.doesNotMatch(body, /실패 작업 재시도|정정 요청 저장/);
console.log(
  "HTTP: home, icons and brand assets, empty filter, missing detail, cross-origin, forged session, disabled scheduler, health, admin gate passed.",
);
