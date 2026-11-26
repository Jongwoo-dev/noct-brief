import "./env";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import pg from "pg";
import { schedule } from "../lib/calendar";
import { readConfig } from "../lib/config";
import { BundleSchema, DraftSchema, type Draft } from "../lib/contract";
import {
  ResponsesGenerator,
  responseText,
  type DraftJob,
} from "../lib/providers";
import {
  assertTrialModel,
  generatePrivateTrial,
  type TrialStage,
  checkTrialInput,
  combinedTrialVariant,
  combinedV1TrialVariant,
  reserveCost,
  trialEditionKey,
  trialEditorialGuide,
  trialRequest,
  usageCost,
} from "../lib/report-trial";
import { savedRepair, trialCall } from "../lib/trial-ledger";
import { migrate } from "./migrate";
import { pairedTimePolicy } from "../lib/report-time";

const [date, session, file, ...flags] = process.argv.slice(2);
const latestCombined = flags.includes("--combined");
const legacyCombined = flags.includes("--combined-v1");
const combined = legacyCombined
  ? combinedV1TrialVariant
  : latestCombined
    ? combinedTrialVariant
    : undefined;
const quality = !!combined || flags.includes("--quality");
const pairedTimes = !!combined || flags.includes("--paired-times");
const run = flags.includes("--run");
const solComparisonModel = "gpt-6.1-sol";
const qualityVersion = "quality-v2";
if (
  !date ||
  (session !== "pre" && session !== "post") ||
  !file ||
  flags.some(
    (flag) =>
      ![
        "--quality",
        "--paired-times",
        "--combined",
        "--combined-v1",
        "--run",
      ].includes(flag),
  ) ||
  new Set(flags).size !== flags.length ||
  (legacyCombined && latestCombined) ||
  ((quality || pairedTimes) && session !== "post")
)
  throw new Error(
    "사용법: npm run report:trial -- YYYY-MM-DD pre|post BUNDLE.json [--quality] [--paired-times] [--combined|--combined-v1] [--run]",
  );
const config = readConfig();
if (config.APP_ENV !== "local") throw new Error("로컬 전용 시험입니다.");
const slot = schedule(date, session);
const guide = quality
  ? trialEditorialGuide(
      await readFile("docs/PRODUCT_SPEC.md", "utf8"),
      combined,
    )
  : undefined;
const verificationModel =
  config.OPENAI_VERIFICATION_MODEL || config.OPENAI_MODEL;
const trialVariant =
  combined ??
  [quality ? qualityVersion : "", pairedTimes ? pairedTimePolicy : ""]
    .filter(Boolean)
    .join("-");
const trialKey = trialEditionKey(
  slot.id,
  config.OPENAI_MODEL,
  verificationModel,
  trialVariant || undefined,
);
const bundle = BundleSchema.parse(JSON.parse(await readFile(file, "utf8")));
if (Date.parse(bundle.cutoffAt) !== Date.parse(slot.targetAt))
  throw new Error("대상 회차와 자료 마감 시각 불일치");
const job: DraftJob = {
  kind: "initial",
  session,
  us_trading_date: date,
  payload: {},
  config: {
    model: config.OPENAI_MODEL,
    mode: "live",
    promptVersion: trialVariant ? `noct-post-${trialVariant}` : "noct-trial-v1",
    ...(pairedTimes ? { timePolicy: pairedTimePolicy } : {}),
    reasoning: config.OPENAI_REASONING_EFFORT,
    maxOutputTokens: config.OPENAI_MAX_OUTPUT_TOKENS,
  },
};
checkTrialInput(job, bundle, new Date(), quality);
const body = trialRequest(job, bundle, "draft", undefined, undefined, guide);
const usd = (n: number) => `$${(n / 1000000).toFixed(6)}`;
// Verify the configured model has a known price before any draft can be submitted.
assertTrialModel(verificationModel);
console.log(
  `회차 ${trialKey} · 작성·보정 ${body.model} · 검증·재검증 ${verificationModel} · 출처 ${bundle.sources.length}건 · 작성 요청 예약액 ${usd(reserveCost(body))}`,
);
if (!run) {
  console.log("사전 검사 완료. 유료 호출 0건.");
} else {
  if (!config.OPENAI_API_KEY || !config.DATABASE_URL)
    throw new Error("OPENAI_API_KEY와 로컬 DATABASE_URL이 필요합니다.");
  const dbUrl = new URL(config.DATABASE_URL);
  const trialDb = "noct_brief_trial_local";
  const allowSubmit = session === "post" && !legacyCombined;
  const legacyReplay =
    "통합 v1은 이미 접수된 요청의 응답만 조회할 수 있습니다.";
  const preReplay = "장전 시험은 이미 접수된 응답만 조회할 수 있습니다.";
  if (dbUrl.pathname === `/${trialDb}`)
    throw new Error("샘플 앱 DB와 시험 DB는 분리해야 합니다.");
  dbUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: dbUrl.href });
  await admin.connect();
  try {
    await admin.query("SELECT pg_advisory_lock(710030)");
    if (
      !(
        await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
          trialDb,
        ])
      ).rowCount
    ) {
      if (!allowSubmit)
        throw new Error(legacyCombined ? legacyReplay : preReplay);
      await admin.query("CREATE DATABASE noct_brief_trial_local");
    }
  } finally {
    await admin.end();
  }
  dbUrl.pathname = `/${trialDb}`;
  const db = new pg.Pool({ connectionString: dbUrl.href });
  const api = new ResponsesGenerator({
    ...config,
    DATA_MODE: "live",
    EXTERNAL_CALLS_ENABLED: true,
  });
  try {
    if (!legacyCombined) await migrate(db, "local", "live");
    const call = async (
      stage: TrialStage,
      candidate?: Draft,
      issues?: string[],
    ) => {
      const stageBody = trialRequest(
        job,
        bundle,
        stage,
        candidate,
        issues,
        guide,
        verificationModel,
      );
      const result = await trialCall(
        db,
        api,
        trialKey,
        stage,
        stageBody,
        allowSubmit,
      ).catch((error: unknown) => {
        if (
          legacyCombined &&
          error instanceof Error &&
          error.message === preReplay
        )
          throw new Error(legacyReplay, { cause: error });
        throw error;
      });
      const cost = usd(usageCost(stageBody.model, result.usage));
      console.log(`${stage} · ${result.status} · 사용량 환산 ${cost}`);
      if (result.status !== "completed")
        throw new Error(`${stage} 응답 종료: ${result.status}`);
      return JSON.parse(responseText(result.output));
    };
    const { content, review } = await generatePrivateTrial(
      job,
      bundle,
      call,
      async () => {
        const result = await savedRepair(db, api, trialKey);
        if (!result) return;
        if (result.status !== "completed")
          throw new Error(`repair 응답 종료: ${result.status}`);
        return DraftSchema.parse(JSON.parse(responseText(result.output)));
      },
      quality,
    );
    const dir = resolve(".local/trial-reports");
    const rows = (
      await db.query<{
        stage: TrialStage;
        model: string;
        usage: unknown;
        cost_microusd: number;
        started_at: Date;
        finished_at: Date;
      }>(
        "SELECT stage,model,result->'usage' AS usage,cost_microusd,started_at,finished_at FROM report_trial_calls WHERE edition=$1 AND result IS NOT NULL ORDER BY started_at",
        [trialKey],
      )
    ).rows;
    const timing = rows.map(({ stage, started_at, finished_at }) => ({
      stage,
      started_at,
      finished_at,
    }));
    const costs = rows.map(({ stage, model, usage, cost_microusd }) => ({
      stage,
      model,
      usage,
      usd: usd(cost_microusd),
      equivalentSolModel: solComparisonModel,
      equivalentSolUsd: usd(usageCost(solComparisonModel, usage)),
    }));
    content.generatedAt = timing
      .findLast((row) => row.stage === "draft" || row.stage === "repair")!
      .finished_at.toISOString();
    await mkdir(dir, { recursive: true });
    const output = join(dir, `${trialKey.replace("/", "-")}.json`),
      tmp = join(dir, `${randomUUID()}.tmp`);
    await writeFile(
      tmp,
      JSON.stringify(
        { visibility: "private", content, review, costs, timing },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await rename(tmp, output);
    console.log(`비공개 검증본 저장 · ${output}`);
    console.log(
      `회차 합계 ${usd(costs.reduce((sum, c) => sum + usageCost(c.model, c.usage), 0))} · 동일 토큰 ${solComparisonModel} 환산 ${usd(costs.reduce((sum, c) => sum + usageCost(solComparisonModel, c.usage), 0))}`,
    );
  } finally {
    await db.end();
  }
}
