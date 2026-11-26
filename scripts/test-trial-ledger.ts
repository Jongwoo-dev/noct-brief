import assert from "node:assert/strict";
import type pg from "pg";
import { sampleContent } from "../data/samples";
import { readConfig } from "../lib/config";
import { ResponsesGenerator, type DraftJob } from "../lib/providers";
import { trialRequest } from "../lib/report-trial";
import { reserveTrialCall, trialCall } from "../lib/trial-ledger";

export async function checkTrialLedger(
  db: pg.Pool,
  check: (s: string) => void,
) {
  const c = sampleContent("2026-10-26", "post");
  const job: DraftJob = {
    us_trading_date: c.date,
    session: c.session,
    kind: "initial",
    payload: {},
    config: {
      mode: "live",
      model: "gpt-6.2-astra",
      reasoning: "medium",
      maxOutputTokens: 8000,
      promptVersion: "test",
    },
  };
  const config = readConfig({
    DATA_MODE: "live",
    EXTERNAL_CALLS_ENABLED: "true",
    OPENAI_API_KEY: "fake-key",
    OPENAI_MODEL: job.config.model,
  });
  const draft = trialRequest(job, c.bundle, "draft");
  const edition = "test-trial";
  let posts = 0,
    gets = 0;
  const api = new ResponsesGenerator(config, async (_url, init) => {
    if (init?.method === "POST") {
      posts++;
      return Response.json({ id: "resp_trial_mock" });
    }
    gets++;
    return Response.json({
      id: "resp_trial_mock",
      status: "completed",
      service_tier: "default",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(c.draft) }] },
      ],
      usage: {
        input_tokens: 90,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 10,
      },
    });
  });
  await trialCall(db, api, edition, "draft", draft);
  await trialCall(db, api, edition, "draft", draft);
  assert.equal(posts, 1);
  assert.equal(gets, 1);
  assert.equal(
    (
      await db.query(
        "SELECT cost_microusd FROM report_trial_calls WHERE edition=$1",
        [edition],
      )
    ).rows[0].cost_microusd,
    1120,
  );
  check("비공개 시험 완료 응답 재사용·사용량 정산");
  await trialCall(db, api, edition, "draft", draft, false);
  await assert.rejects(
    () => reserveTrialCall(db, edition, "verify", draft, false),
    /장전 시험/,
  );
  await assert.rejects(
    () =>
      reserveTrialCall(
        db,
        edition,
        "draft",
        { ...draft, model: "gpt-6-astra" },
        false,
      ),
    /기존 시험 요청/,
  );
  assert.equal(posts, 1);
  assert.equal(gets, 1);
  const verify = trialRequest(
    job,
    c.bundle,
    "verify",
    c.draft,
    undefined,
    undefined,
    "gpt-6.2-sol",
  );
  const pending = await Promise.allSettled([
    reserveTrialCall(db, edition, "verify", verify),
    reserveTrialCall(db, edition, "verify", verify),
  ]);
  assert.equal(pending.filter((p) => p.status === "fulfilled").length, 1);
  await assert.rejects(
    () => reserveTrialCall(db, edition, "verify", verify),
    /접수/,
  );
  await db.query(
    "UPDATE report_trial_calls SET reservation_microusd=9999999 WHERE edition=$1 AND stage='verify'",
    [edition],
  );
  await assert.rejects(
    () => reserveTrialCall(db, edition, "repair", draft),
    /edition/,
  );
  await assert.rejects(
    () =>
      reserveTrialCall(db, edition + "/quality-v1-gpt-6.2-sol", "draft", draft),
    /edition/,
  );
  // A submitted ID can be retrieved even when no budget remains for another POST.
  await db.query(
    "UPDATE report_trial_calls SET response_id='resp_resume' WHERE edition=$1 AND stage='verify'",
    [edition],
  );
  const resumeApi = new ResponsesGenerator(config, async (_url, init) => {
    assert.equal(init?.method, "GET");
    return Response.json({
      id: "resp_resume",
      service_tier: "default",
      status: "incomplete",
      usage: {
        input_tokens: 50,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 2,
      },
    });
  });
  assert.equal(
    (await trialCall(db, resumeApi, edition, "verify", verify, false)).status,
    "incomplete",
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT model,cost_microusd FROM report_trial_calls WHERE edition=$1 AND stage='verify'",
        [edition],
      )
    ).rows[0],
    { model: "gpt-6.2-sol", cost_microusd: 120 },
  );
  check("장전은 기존 접수 응답만 조회하고 단계의 모델로 비용 정산");
  check("동시 제출·접수 불명·한도 초과 차단, 기존 ID 조회·미완료 비용 보존");
  const transient = new ResponsesGenerator(
    config,
    async () => new Response("", { status: 401 }),
  );
  await assert.rejects(
    () => trialCall(db, transient, edition, "repair", draft),
    /HTTP_401/,
  );
  assert.equal(
    (await reserveTrialCall(db, edition, "repair", draft)).submit,
    true,
  );
  check("명시적 접수 거절 정산과 재실행");
}
