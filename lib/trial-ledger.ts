import { createHash } from "node:crypto";
import type pg from "pg";
import { transaction } from "./db";
import {
  checkBudget,
  reserveCost,
  usageCost,
  type trialRequest,
  type TrialStage,
} from "./report-trial";
import { ProviderError, ResponsesGenerator } from "./providers";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

type TrialBody = ReturnType<typeof trialRequest>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => [key, canonical(v)]),
  );
}
export async function reserveTrialCall(
  db: pg.Pool,
  edition: string,
  stage: TrialStage,
  body: TrialBody,
  allowSubmit = true,
) {
  const cost = reserveCost(body);
  const hash = createHash("sha256")
    .update(
      JSON.stringify(canonical({ ...body, input: JSON.parse(body.input) })),
    )
    .digest("hex");
  return transaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(710029)");
    const args = [edition, stage];
    const old = (
      await tx.query(
        "SELECT * FROM report_trial_calls WHERE edition=$1 AND stage=$2",
        args,
      )
    ).rows[0];
    if (old && !old.rejected) {
      if (old.request_hash !== hash)
        throw new Error(
          "기존 시험 요청과 입력·모델이 다릅니다. 기존 회차 기록을 확인하세요.",
        );
      if (!old.response_id)
        throw new Error(
          "접수 확인 중이거나 접수 불명입니다. 중복 제출을 중단합니다.",
        );
      return { submit: false, id: String(old.response_id), result: old.result };
    }
    if (!allowSubmit)
      throw new Error("장전 시험은 이미 접수된 응답만 조회할 수 있습니다.");
    const totals = (
      await tx.query(
        `SELECT
      COALESCE(sum(n) FILTER (WHERE split_part(edition,'/',1)=split_part($1,'/',1)),0)::int AS edition,
      COALESCE(sum(n) FILTER (WHERE (started_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date),0)::int AS day,
      COALESCE(sum(n),0)::int AS total
      FROM (SELECT edition,started_at,COALESCE(cost_microusd,reservation_microusd) AS n FROM report_trial_calls) t`,
        [edition],
      )
    ).rows[0];
    checkBudget(
      { edition: totals.edition, day: totals.day, total: totals.total },
      cost,
      edition,
    );
    await tx.query(
      `INSERT INTO report_trial_calls(edition,stage,request_hash,model,reservation_microusd) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(edition,stage) DO UPDATE SET started_at=now(),finished_at=NULL,request_hash=EXCLUDED.request_hash,model=EXCLUDED.model,
      reservation_microusd=EXCLUDED.reservation_microusd,rejected=false,cost_microusd=NULL WHERE report_trial_calls.rejected`,
      [...args, hash, body.model, cost],
    );
    return { submit: true, id: "", result: null };
  });
}
const terminal = z.object({
  id: z.string(),
  status: z.string(),
  usage: z.unknown(),
  output: z
    .array(
      z.object({
        content: z
          .array(z.object({ type: z.string(), text: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
});
export async function trialCall(
  db: pg.Pool,
  api: ResponsesGenerator,
  edition: string,
  stage: TrialStage,
  body: TrialBody,
  allowSubmit = true,
) {
  const entry = await reserveTrialCall(db, edition, stage, body, allowSubmit);
  const args = [edition, stage];
  if (entry.result) return terminal.parse(entry.result);
  let id = entry.id;
  if (entry.submit) {
    try {
      id = (await api.submitBody(body)).id;
    } catch (e) {
      if (
        e instanceof ProviderError &&
        !e.ambiguous &&
        (/^HTTP_4\d\d$/.test(e.code) || /(?:EXCEEDED|EXHAUSTED)$/.test(e.code))
      )
        await db.query(
          "UPDATE report_trial_calls SET rejected=true,finished_at=now(),cost_microusd=0 WHERE edition=$1 AND stage=$2",
          args,
        );
      throw e;
    }
    await db.query(
      "UPDATE report_trial_calls SET response_id=$3 WHERE edition=$1 AND stage=$2",
      [...args, id],
    );
  }
  return settleTrialCall(db, api, edition, stage, id, body.model);
}
export async function savedRepair(
  db: pg.Pool,
  api: ResponsesGenerator,
  edition: string,
) {
  const row = (
    await db.query(
      "SELECT result,response_id,model FROM report_trial_calls WHERE edition=$1 AND stage='repair' AND NOT rejected",
      [edition],
    )
  ).rows[0];
  if (!row) return;
  if (row.result) return terminal.parse(row.result);
  if (!row.response_id) throw new Error("보정 접수 여부를 확인해야 합니다.");
  return settleTrialCall(
    db,
    api,
    edition,
    "repair",
    row.response_id,
    row.model,
  );
}
async function settleTrialCall(
  db: pg.Pool,
  api: ResponsesGenerator,
  edition: string,
  stage: TrialStage,
  id: string,
  model: string,
) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await api.retrieve(id);
    if (result.id !== id) throw new Error("응답 ID 불일치");
    if (["queued", "in_progress"].includes(result.status)) {
      await delay(2500);
      continue;
    }
    const saved = terminal.parse(result);
    // If usage is absent or the service changed its pricing tier, keep the reservation.
    if (result.service_tier !== "default")
      throw new Error("Standard 응답 요금제 확인 필요");
    if (
      !["completed", "failed", "cancelled", "incomplete"].includes(saved.status)
    )
      throw new Error("알 수 없는 응답 상태");
    const cost = usageCost(model, saved.usage);
    await db.query(
      "UPDATE report_trial_calls SET result=$3,finished_at=COALESCE(finished_at,now()),cost_microusd=$4 WHERE edition=$1 AND stage=$2",
      [edition, stage, JSON.stringify(saved), cost],
    );
    return saved;
  }
  throw new Error(
    "응답이 처리 중입니다. 같은 명령을 실행하면 저장한 응답 ID로 조회합니다.",
  );
}
