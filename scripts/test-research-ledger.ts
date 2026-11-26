import "./env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { readConfig } from "../lib/config";
import { migrate } from "./migrate";
import { researchRequest } from "../lib/research-trial";
import {
  reserveResearchCall,
  researchCall,
  researchBudgetTotals,
  researchHash,
} from "../lib/research-ledger";
import type { ResponsesGenerator } from "../lib/providers";

const c = readConfig();
if (c.APP_ENV !== "local" || !c.DATABASE_URL)
  throw new Error("로컬 DB가 필요합니다.");
const u = new URL(c.DATABASE_URL);
u.pathname = "/postgres";
const admin = new pg.Client({ connectionString: u.href });
const name = `noct_research_test_${randomBytes(5).toString("hex")}_local`;
if (!/^noct_research_test_[a-f0-9]+_local$/.test(name))
  throw new Error("격리 DB 이름 확인 실패");
await admin.connect();
let db: pg.Pool | undefined;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  u.pathname = `/${name}`;
  db = new pg.Pool({ connectionString: u.href });
  await migrate(db, "local", "live");
  const body = researchRequest("2026-11-20", {
    model: "gpt-6.2-sol",
    effort: "high",
  });
  const calls = await Promise.allSettled([
    reserveResearchCall(db, "race-post/research", body),
    reserveResearchCall(db, "race-post/research", body),
  ]);
  assert.equal(calls.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(calls.filter((r) => r.status === "rejected").length, 1);
  await assert.rejects(
    reserveResearchCall(db, "race-post/research", body),
    /접수/,
  );

  let submits = 0;
  let retrieves = 0;
  const raw = {
    id: "resp_research_mock",
    status: "completed",
    model: body.model,
    service_tier: "default",
    usage: {
      input_tokens: 10000,
      output_tokens: 2000,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
    output: [
      {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          sources: [{ url: "https://example.com/source" }],
        },
      },
      {
        type: "message",
        phase: "final_answer",
        content: [
          {
            type: "output_text",
            text: "{}",
            annotations: [
              { type: "url_citation", url: "https://example.com/source" },
            ],
          },
        ],
      },
    ],
  };
  const fake = {
    async submitBody() {
      submits++;
      return { id: raw.id };
    },
    async call() {
      retrieves++;
      return raw;
    },
  } as unknown as ResponsesGenerator;
  const key = "2026-11-20-post/research-test";
  await researchCall(db, fake, key, body);
  assert.equal(submits, 1);
  const saved = (
    await db.query("SELECT * FROM report_trial_calls WHERE edition=$1", [key])
  ).rows[0];
  assert.equal(saved.cost_microusd, 50000);
  assert.equal(
    saved.result.output[0].action.sources[0].url,
    "https://example.com/source",
  );
  await db.query(
    "UPDATE report_trial_calls SET cost_microusd=NULL WHERE edition=$1",
    [key],
  );
  await researchCall(db, fake, key, body);
  assert.equal(submits, 1);
  assert.equal(retrieves, 1);
  assert.equal(
    (
      await db.query(
        "SELECT cost_microusd FROM report_trial_calls WHERE edition=$1",
        [key],
      )
    ).rows[0].cost_microusd,
    50000,
  );
  await assert.rejects(
    reserveResearchCall(db, key, { ...body, reasoning: { effort: "xhigh" } }),
    /조건이 다릅니다/,
  );

  await db.query(
    "INSERT INTO report_trial_calls(edition,stage,request_hash,model,reservation_microusd,cost_microusd) VALUES('budget-post/old-report','draft',$1,$2,10000000,10000000)",
    [researchHash(body), body.model],
  );
  await assert.rejects(
    reserveResearchCall(db, "budget-post/new-research", body),
    /비용 한도/,
  );
  const totals = await researchBudgetTotals(db, key);
  assert.equal(totals.edition, 50000);
  await db.query(
    "INSERT INTO report_trial_calls(edition,stage,request_hash,model,reservation_microusd,cost_microusd) VALUES('floor-post/prior','research',$1,$2,1000000,2000000)",
    [researchHash(body), body.model],
  );
  await reserveResearchCall(db, "floor-post/next", body);
  assert.equal(
    (
      await db.query(
        "SELECT reservation_microusd FROM report_trial_calls WHERE edition='floor-post/next'",
      )
    ).rows[0].reservation_microusd,
    2000000,
  );
  console.log(
    "격리 DB: 동시 제출 차단·접수 불명 차단·원문 메타데이터 보존·재개 정산·요청 변경 차단·기존 보고서 비용 합산·직전 비용을 반영한 예약 통과. API 호출 0건.",
  );
} finally {
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}
