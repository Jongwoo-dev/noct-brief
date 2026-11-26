import "./env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import { resolve, join } from "node:path";
import pg from "pg";
import { readConfig } from "../lib/config";
import { ResponsesGenerator } from "../lib/providers";
import {
  researchCases,
  researchRequest,
  researchVersion,
  researchWindow,
  parseResearchDossier,
} from "../lib/research-trial";
import {
  researchCall,
  researchHash,
  researchReservation,
  researchUsageCost,
  researchBudgetTotals,
  researchResponseText,
} from "../lib/research-ledger";
import { migrate } from "./migrate";
import { researchReading } from "../lib/research-reading";

const [date, ...flags] = process.argv.slice(2);
if (
  !date ||
  new Set(flags).size !== flags.length ||
  flags.some((f) => !["--matrix", "--run"].includes(f))
)
  throw new Error(
    "사용법: npm run research:trial -- YYYY-MM-DD [--matrix] [--run]",
  );
const config = readConfig();
if (config.APP_ENV !== "local") throw new Error("로컬 비공개 수집 시험입니다.");
const window = researchWindow(date);
const cases = flags.includes("--matrix")
  ? researchCases
  : [
      {
        model: config.OPENAI_RESEARCH_MODEL,
        effort: config.OPENAI_RESEARCH_REASONING_EFFORT,
      },
    ];
const requests = cases.map((c) => ({
  ...c,
  body: researchRequest(date, {
    ...c,
    maxOutputTokens: config.OPENAI_RESEARCH_MAX_OUTPUT_TOKENS,
    maxToolCalls: config.OPENAI_RESEARCH_MAX_TOOL_CALLS,
  }),
}));
const usd = (value: number) => `$${(value / 1000000).toFixed(6)}`;
const directory = resolve(
  ".local/trial-research",
  `${date}-post-${researchVersion}`,
  flags.includes("--matrix")
    ? "matrix"
    : `single-${requests[0].model}-${requests[0].effort}`,
);
await mkdir(directory, { recursive: true });
// Random labels are assigned once. Evaluators read candidate-*; the case key
// and costs remain separate until evidence findings have been recorded.
const manifestPath = join(
  directory,
  flags.includes("--matrix")
    ? "matrix.json"
    : `single-${requests[0].model}-${requests[0].effort}.json`,
);
const shuffled = [...requests.keys()];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
type Manifest = {
  window: typeof window;
  cases: {
    model: string;
    effort: string;
    label: string;
    requestHash: string;
  }[];
};
const desired: Manifest = {
  window,
  cases: requests.map((c, i) => ({
    model: c.model,
    effort: c.effort,
    label: `${flags.includes("--matrix") ? "candidate" : "single"}-${String.fromCharCode(65 + shuffled[i])}`,
    requestHash: researchHash(c.body),
  })),
};
let manifest: Manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    JSON.stringify(
      manifest.cases.map(({ model, effort, requestHash }) => ({
        model,
        effort,
        requestHash,
      })),
    ) !==
    JSON.stringify(
      desired.cases.map(({ model, effort, requestHash }) => ({
        model,
        effort,
        requestHash,
      })),
    )
  )
    throw new Error(
      "기존 시험 조건이 다릅니다. 이전 요청을 보존하고 새 시험 버전을 정해야 합니다.",
    );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  manifest = desired;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
    flag: "wx",
  });
}
for (const c of requests) {
  const path = join(directory, `${c.model}-${c.effort}-request.json`);
  try {
    await writeFile(path, JSON.stringify(c.body, null, 2), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (
      researchHash(JSON.parse(await readFile(path, "utf8"))) !==
      researchHash(c.body)
    )
      throw new Error("저장 요청과 조건 불일치");
  }
  console.log(
    `${c.model} / ${c.effort} · 추론 포함 출력 ${c.body.max_output_tokens} · 내장 도구 ${c.body.max_tool_calls}회 · 요청 전 예약 추정 ${usd(researchReservation(c.body))}`,
  );
}
console.log(`공통 범위 ${JSON.stringify(window)}`);
console.log(
  "예약액은 웹 컨텍스트 128k 여유분을 둔 추정이며 공급자 측 청구 상한이 아닙니다. 같은 회차·하루·전체 원장에 합산합니다.",
);
if (!flags.includes("--run")) {
  console.log(`무료 사전검사 완료. API·DB 호출 0건. 요청 저장: ${directory}`);
} else {
  if (!config.OPENAI_API_KEY || !config.DATABASE_URL)
    throw new Error("API 키와 로컬 DB 설정이 필요합니다.");
  if (
    Date.parse(window.cutoffAt) > Date.now() ||
    !window.coverageStart ||
    !window.upcomingThrough
  )
    throw new Error(
      "자료 마감이 지난 회차와 확인된 앞뒤 거래 달력이 필요합니다.",
    );
  const u = new URL(config.DATABASE_URL);
  if (u.pathname === "/noct_brief_trial_local")
    throw new Error("앱 DB와 비공개 시험 DB는 분리해야 합니다.");
  u.pathname = "/noct_brief_trial_local";
  const db = new pg.Pool({ connectionString: u.href });
  const outcomes: object[] = [];
  try {
    await migrate(db, "local", "live");
    console.log(
      `실행 전 합산 사용액 ${JSON.stringify(await researchBudgetTotals(db, `${date}-post`))} (microUSD)`,
    );
    // Larger reservations first, settling each actual cost before the next
    // admission. This changes no prompt, tool limit or model condition.
    for (const c of [...requests].sort(
      (a, b) => researchReservation(b.body) - researchReservation(a.body),
    )) {
      const key = `${date}-post/${researchVersion}/${c.model}/${c.effort}`;
      const label = manifest.cases.find(
        (m) => m.model === c.model && m.effort === c.effort,
      )!.label;
      const started = new Date();
      try {
        const api = new ResponsesGenerator({
          ...config,
          OPENAI_MODEL: c.model,
          DATA_MODE: "live",
          EXTERNAL_CALLS_ENABLED: true,
        });
        const response = await researchCall(db, api, key, c.body, (s) =>
          console.log(`${c.model}/${c.effort}: ${s}`),
        );
        const rawPath = join(directory, `${c.model}-${c.effort}-response.json`);
        await writeFile(rawPath, JSON.stringify(response, null, 2));
        let text = "";
        try {
          text = researchResponseText(response);
        } catch {
          /* Preserve terminal failure without pretending it is a dossier. */
        }
        const parsed = parseResearchDossier(text, date);
        if (
          !response.output.some(
            (o) =>
              o.type === "web_search_call" &&
              o.status === "completed" &&
              typeof o.action === "object" &&
              o.action !== null &&
              "type" in o.action &&
              o.action.type === "search",
          )
        )
          parsed.issues.unshift(
            "완료된 웹 검색 활동이 없어 자료수집 성공으로 볼 수 없습니다.",
          );
        let cost: ReturnType<typeof researchUsageCost> | null = null;
        let costIssue: string | null = null;
        try {
          cost = researchUsageCost(c.model, response);
        } catch {
          costIssue = "사용량 또는 단가 확인 필요. 비용 예약액 유지.";
        }
        const timing = {
          retrievedAt: new Date().toISOString(),
          localWaitSeconds: Math.round((Date.now() - started.getTime()) / 1000),
          createdAt: response.created_at ?? null,
          completedAt: response.completed_at ?? null,
        };
        const diagnostic = {
          model: c.model,
          effort: c.effort,
          responseId: response.id,
          status: response.status,
          incompleteDetails: response.incomplete_details ?? null,
          requestHash: researchHash(c.body),
          usage: response.usage,
          cost,
          costIssue,
          timing,
          structuralIssues: parsed.issues,
        };
        await writeFile(
          join(directory, `${c.model}-${c.effort}-diagnostics.json`),
          JSON.stringify(diagnostic, null, 2),
        );
        // All excerpts and facts stay as returned; there is no silent repair.
        const trace = {
          actions: response.output
            .filter((o) => o.type === "web_search_call")
            .map((o) => ({ status: o.status, action: o.action })),
          citations: response.output
            .filter((o) => o.type === "message")
            .flatMap((o) =>
              Array.isArray(o.content)
                ? o.content.flatMap(
                    (content: { annotations?: unknown[] }) =>
                      content.annotations ?? [],
                  )
                : [],
            ),
        };
        await writeFile(
          join(directory, `${label}.json`),
          JSON.stringify(
            {
              label,
              window,
              status: response.status,
              dossier: parsed.dossier,
              structuralIssues: parsed.issues,
              rawText: text,
              trace,
            },
            null,
            2,
          ),
        );
        const reading = researchReading(
          label,
          date,
          response.status,
          parsed.dossier,
          parsed.issues,
        );
        await writeFile(join(directory, `${label}.md`), reading);
        outcomes.push(diagnostic);
        console.log(
          `${c.model}/${c.effort}: ${response.status}, 형식 지적 ${parsed.issues.length}, 비용 ${cost ? usd(cost.totalMicrousd) : "확인 필요"}`,
        );
        if (costIssue || response.status !== "completed" || !parsed.dossier)
          process.exitCode = 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "수집 실패";
        outcomes.push({ model: c.model, effort: c.effort, error: message });
        console.error(`${c.model}/${c.effort}: ${message}`);
        process.exitCode = 1;
        const saved = (
          await db.query(
            "SELECT result,rejected FROM report_trial_calls WHERE edition=$1 AND stage='research'",
            [key],
          )
        ).rows[0];
        if (saved && !saved.rejected && !saved.result) {
          await writeFile(
            join(directory, "outcomes.json"),
            JSON.stringify(outcomes, null, 2),
          );
          console.error(
            "접수 중·처리 중·접수 불명 건이 있어 새 조합 제출을 보류합니다. 같은 명령으로 조회 재개합니다.",
          );
          break;
        }
        // No automatic retry. Admission still checks the shared budget before
        // subsequent independent cases, including unsettled reservations.
      }
      await writeFile(
        join(directory, "outcomes.json"),
        JSON.stringify(outcomes, null, 2),
      );
    }
    console.log(
      `실행 후 합산 사용액 ${JSON.stringify(await researchBudgetTotals(db, `${date}-post`))} (microUSD)`,
    );
  } finally {
    await db.end();
  }
}
