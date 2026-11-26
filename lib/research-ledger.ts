import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";
import { z } from "zod";
import { transaction } from "./db";
import { checkBudget } from "./report-trial";
import { ProviderError, type ResponsesGenerator } from "./providers";

export type ResearchRequestBody = {
  model: string;
  max_output_tokens: number;
  max_tool_calls: number;
  [key: string]: unknown;
};
const rates: Record<string, { input: number; output: number; read: number }> = {
  "gpt-6.2-sol": { input: 2, output: 10, read: 0.1 },
  "gpt-6-astra": { input: 10, output: 50, read: 1 },
};
const count = z.number().int().nonnegative();
const usageSchema = z.object({
  input_tokens: count,
  output_tokens: count,
  input_tokens_details: z.object({
    cached_tokens: count,
    cache_write_tokens: count,
  }),
});
export const researchResponseSchema = z.looseObject({
  id: z.string().regex(/^resp_[a-zA-Z0-9_-]+$/),
  status: z.string(),
  model: z.string(),
  output: z.array(z.looseObject({ type: z.string() })),
  usage: z.unknown(),
  service_tier: z.string().optional(),
});
export type ResearchResponse = z.infer<typeof researchResponseSchema>;
export function researchResponseText(response: ResearchResponse) {
  const messages = response.output.filter((o) => o.type === "message");
  const message =
    messages.findLast((o) => o.phase === "final_answer") ??
    messages.findLast((o) => o.phase !== "commentary");
  if (!message) return "";
  const contents = z
    .array(z.looseObject({ type: z.string(), text: z.string().optional() }))
    .parse(message.content);
  return contents
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
}
function rate(model: string) {
  const p = rates[model];
  if (!p) throw new Error("수집 시험 단가가 등록되지 않은 모델입니다.");
  return p;
}
export function researchHash(body: object) {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, canonical(x)]),
      );
    return v;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
}
// Hosted web context cannot be capped to an exact number of tokens. This is a
// conservative admission allowance, NOT a provider-enforced billing ceiling.
export function researchReservation(body: ResearchRequestBody) {
  const p = rate(body.model);
  const inputAllowance =
    Buffer.byteLength(JSON.stringify(body)) + 4096 + 128000;
  const long = inputAllowance > 272000;
  return Math.ceil(
    inputAllowance * p.input * 1.25 * (long ? 2 : 1) +
      body.max_output_tokens * p.output * (long ? 1.5 : 1) +
      body.max_tool_calls * 10000,
  );
}
export function researchUsageCost(model: string, response: ResearchResponse) {
  if (response.service_tier !== "default")
    throw new Error("Standard 응답 요금제 확인 필요");
  if (response.model !== model) throw new Error("요청과 실제 응답 모델 불일치");
  const u = usageSchema.parse(response.usage);
  const p = rate(model);
  const read = u.input_tokens_details.cached_tokens;
  const write = u.input_tokens_details.cache_write_tokens;
  const ordinary = u.input_tokens - read - write;
  if (ordinary < 0) throw new Error("수집 입력 사용량 불일치");
  const long = u.input_tokens > 272000;
  const inputCost = ordinary * p.input + read * p.read + write * p.input * 1.25;
  const standardTokenMicrousd = Math.ceil(
    inputCost + u.output_tokens * p.output,
  );
  // Hosted tool loops can aggregate input usage. Public docs do not establish
  // whether this aggregate is the context length used for the pricing tier.
  // Keep the conservative amount for admission, and disclose both estimates.
  const tokenMicrousd = long
    ? Math.ceil(inputCost * 2 + u.output_tokens * p.output * 1.5)
    : standardTokenMicrousd;
  const actions = { search: 0, open_page: 0, find_in_page: 0 };
  for (const item of response.output) {
    if (item.type !== "web_search_call") continue;
    const action = z
      .object({ type: z.enum(["search", "open_page", "find_in_page"]) })
      .parse(item.action);
    actions[action.type]++;
  }
  const reportedSearches = z
    .object({ web_search: z.object({ num_requests: count }) })
    .safeParse(response.tool_usage);
  const billedSearches = reportedSearches.success
    ? reportedSearches.data.web_search.num_requests
    : actions.search;
  const searchMicrousd = billedSearches * 10000;
  return {
    tokenMicrousd,
    searchMicrousd,
    totalMicrousd: tokenMicrousd + searchMicrousd,
    standardTotalMicrousd: standardTokenMicrousd + searchMicrousd,
    billedSearches,
    searchCountBasis: reportedSearches.success
      ? "tool_usage"
      : "trace_estimate",
    actions,
    longContext: long,
    longContextConfirmed: false,
    basis:
      "API usage와 공개 단가로 환산. 청구서 대조 전. 검색 내용 토큰은 중복 가산하지 않음." +
      (long
        ? " 도구 반복의 합산 입력이 272k를 넘어 장문 배수를 보수적으로 적용했으나 실제 적용 여부는 미확인. standardTotalMicrousd와 함께 비교."
        : ""),
  };
}
export async function researchBudgetTotals(db: pg.Pool, edition: string) {
  const row = (
    await db.query(
      `SELECT
      COALESCE(sum(n) FILTER (WHERE split_part(edition,'/',1)=split_part($1,'/',1)),0)::int AS edition,
      COALESCE(sum(n) FILTER (WHERE (started_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date),0)::int AS day,
      COALESCE(sum(n),0)::int AS total
      FROM (SELECT edition,started_at,COALESCE(cost_microusd,reservation_microusd) AS n FROM report_trial_calls) t`,
      [edition],
    )
  ).rows[0];
  return {
    edition: Number(row.edition),
    day: Number(row.day),
    total: Number(row.total),
  };
}
export async function reserveResearchCall(
  db: pg.Pool,
  edition: string,
  body: ResearchRequestBody,
) {
  return transaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(710029)");
    const old = (
      await tx.query(
        "SELECT * FROM report_trial_calls WHERE edition=$1 AND stage='research'",
        [edition],
      )
    ).rows[0];
    const hash = researchHash(body);
    if (old) {
      if (old.request_hash !== hash)
        throw new Error(
          "기존 수집 요청과 조건이 다릅니다. 기존 결과를 덮어쓰지 않습니다.",
        );
      if (old.rejected)
        throw new Error(
          "이미 거절된 수집 요청입니다. 자동 재제출하지 않습니다.",
        );
      if (!old.response_id)
        throw new Error(
          "수집 요청이 접수 중 또는 접수 불명입니다. 중복 제출하지 않습니다.",
        );
      return {
        submit: false,
        id: String(old.response_id),
        result: old.result as unknown,
      };
    }
    const priorCost = Number(
      (
        await tx.query(
          "SELECT COALESCE(max(cost_microusd),0)::int AS n FROM report_trial_calls WHERE stage='research' AND model=$2 AND split_part(edition,'/',1)=split_part($1,'/',1)",
          [edition, body.model],
        )
      ).rows[0].n,
    );
    // A completed comparable request is stronger evidence than the initial
    // web-context allowance. Never reserve less than its observed cost.
    const reservation = Math.max(researchReservation(body), priorCost);
    const totals = await researchBudgetTotals(
      tx as unknown as pg.Pool,
      edition,
    );
    checkBudget(totals, reservation, edition);
    await tx.query(
      "INSERT INTO report_trial_calls(edition,stage,request_hash,model,reservation_microusd) VALUES($1,'research',$2,$3,$4)",
      [edition, hash, body.model, reservation],
    );
    return { submit: true, id: "", result: null };
  });
}
export async function researchCall(
  db: pg.Pool,
  api: ResponsesGenerator,
  edition: string,
  body: ResearchRequestBody,
  onProgress: (status: string) => void = () => {},
) {
  const entry = await reserveResearchCall(db, edition, body);
  async function settle(raw: unknown) {
    const result = researchResponseSchema.parse(raw);
    let cost: number | null = null;
    try {
      cost = researchUsageCost(body.model, result).totalMicrousd;
    } catch {
      onProgress("사용량·단가 확인 필요: 원응답과 비용 예약액을 유지합니다.");
    }
    await db.query(
      "UPDATE report_trial_calls SET result=$2,finished_at=COALESCE(finished_at,now()),cost_microusd=COALESCE($3,cost_microusd) WHERE edition=$1 AND stage='research'",
      [edition, JSON.stringify(raw), cost],
    );
    return result;
  }
  if (entry.result) return settle(entry.result);
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
          "UPDATE report_trial_calls SET rejected=true,finished_at=now(),cost_microusd=0 WHERE edition=$1 AND stage='research'",
          [edition],
        );
      throw e;
    }
    await db.query(
      "UPDATE report_trial_calls SET response_id=$2 WHERE edition=$1 AND stage='research'",
      [edition, id],
    );
  }
  onProgress(`응답 접수 ${id}`);
  for (let attempt = 0; attempt < 240; attempt++) {
    // Explicitly request the complete source inventory when resuming too.
    const raw = await api.call(
      `/${encodeURIComponent(id)}?include%5B%5D=web_search_call.action.sources`,
      { method: "GET" },
    );
    const result = researchResponseSchema.parse(raw);
    if (result.id !== id) throw new Error("수집 응답 ID 불일치");
    if (["queued", "in_progress"].includes(result.status)) {
      if (attempt % 6 === 0)
        onProgress(
          `${result.status} · 현재 공개된 도구 기록 ${result.output.filter((o) => o.type === "web_search_call").length}건 (실제 총사용량은 완료 후 확인)`,
        );
      await delay(5000);
      continue;
    }
    // Save raw output, annotations, tool actions and terminal error/incomplete
    // details even if parsing, accounting or evidence validation fails later.
    await settle(raw);
    if (
      !["completed", "failed", "cancelled", "incomplete"].includes(
        result.status,
      )
    )
      throw new Error("알 수 없는 수집 응답 상태");
    return result;
  }
  throw new Error(
    "수집이 진행 중입니다. 동일 명령으로 기존 응답을 조회할 수 있습니다. 새 유료 요청은 제출하지 않습니다.",
  );
}
