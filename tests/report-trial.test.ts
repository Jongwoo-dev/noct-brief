import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sampleContent } from "../data/samples";
import { BundleSchema, eventTimeLabel, validateContent } from "../lib/contract";
import { generatePrivateTrial } from "../lib/report-trial";
import {
  usageCost,
  reserveCost,
  checkBudget,
  reviewItems,
  reviewIssues,
  checkTrialInput,
  combinedTrialVariant,
  combinedV1TrialVariant,
  trialEditionKey,
  trialEditorialGuide,
  trialRequest,
} from "../lib/report-trial";
import type { DraftJob } from "../lib/providers";
import { pairedTimePolicy } from "../lib/report-time";

const content = sampleContent("2026-10-26", "post");
const job: DraftJob = {
  kind: "initial",
  us_trading_date: content.date,
  session: "post",
  config: {
    model: "gpt-6.2-astra",
    reasoning: "medium",
    mode: "live",
    maxOutputTokens: 8000,
    promptVersion: "test",
  },
  payload: {},
};
const usage = {
  input_tokens: 12000,
  output_tokens: 1000,
  input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000 },
};
it("모델별 표준 요금에 일반 입력·캐시 읽기·30분 쓰기·출력을 한 번씩 계산", () => {
  expect(usageCost("gpt-6-astra", usage)).toBe(151500);
  expect(usageCost("gpt-6.1-sol", usage)).toBe(29900);
  expect(usageCost("gpt-6.2-astra", usage)).toBe(119600);
  expect(usageCost("gpt-6.2-sol", usage)).toBe(29900);
  expect(() => usageCost("unknown", usage)).toThrow();
  expect(() => usageCost("gpt-6.2-sol", {})).toThrow();
  expect(() =>
    usageCost("gpt-6.2-sol", { ...usage, input_tokens: 4 }),
  ).toThrow();
});
it.each(["gpt-6.1-sol", "gpt-6-astra"])(
  "%s 선택이 작성·보정·검증 요청과 비용 예약에 적용됨",
  (model) => {
    const selectedJob = { ...job, config: { ...job.config, model } };
    for (const stage of ["draft", "repair", "verify", "recheck"] as const) {
      const request = trialRequest(
        selectedJob,
        content.bundle,
        stage,
        content.draft,
      );
      expect(request.model).toBe(model);
      expect(request.reasoning.effort).toBe("medium");
      expect(request.service_tier).toBe("default");
      expect(reserveCost(request)).toBeGreaterThan(
        model === "gpt-6-astra" ? 400000 : 80000,
      );
    }
  },
);
it("분리 모델을 작성·보정 및 검증·재검증에 각각 사용합니다", () => {
  const generationModel = "gpt-6-astra";
  const verificationModel = "gpt-6.2-sol";
  const selectedJob = {
    ...job,
    config: { ...job.config, model: generationModel },
  };
  for (const stage of ["draft", "repair", "verify", "recheck"] as const) {
    const body = trialRequest(
      selectedJob,
      content.bundle,
      stage,
      content.draft,
      undefined,
      undefined,
      verificationModel,
    );
    expect(body.model).toBe(
      stage === "draft" || stage === "repair"
        ? generationModel
        : verificationModel,
    );
    expect(body.service_tier).toBe("default");
    expect(reserveCost(body)).toBeGreaterThan(
      body.model === generationModel ? 400000 : 80000,
    );
  }
  const draft = trialRequest(selectedJob, content.bundle, "draft");
  expect(() => reserveCost({ ...draft, input: "x".repeat(100000) })).toThrow();
});
it("동일 모델의 시험 키는 보존하고 새 분리 모델 조합은 따로 기록", () => {
  const edition = "2026-11-20-post";
  const writer = "gpt-6-astra";
  const verifier = "gpt-6.2-sol";
  expect(trialEditionKey(edition, writer, writer)).toBe(edition);
  expect(trialEditionKey(edition, writer, writer, "quality-v2")).toBe(
    edition + "/quality-v2-gpt-6-astra",
  );
  expect(trialEditionKey(edition, writer, verifier)).toBe(
    edition + "/mixed-gpt-6-astra-verify-gpt-6.2-sol",
  );
  expect(trialEditionKey(edition, writer, verifier, "quality-v2")).toBe(
    edition + "/quality-v2-gpt-6-astra-verify-gpt-6.2-sol",
  );
  expect(trialEditionKey(edition, writer, verifier, combinedTrialVariant)).toBe(
    edition + "/combined-v2-kst-original-v1-gpt-6-astra-verify-gpt-6.2-sol",
  );
  expect(
    trialEditionKey(edition, writer, verifier, combinedV1TrialVariant),
  ).toBe(
    edition + "/combined-v1-kst-original-v1-gpt-6-astra-verify-gpt-6.2-sol",
  );
});

const combinedJob: DraftJob = {
  ...job,
  us_trading_date: "2026-11-25",
  config: {
    ...job.config,
    model: "gpt-6-astra",
    promptVersion: `noct-post-${combinedTrialVariant}`,
    timePolicy: pairedTimePolicy,
  },
};
const combinedV1Job: DraftJob = {
  ...combinedJob,
  config: {
    ...combinedJob.config,
    promptVersion: `noct-post-${combinedV1TrialVariant}`,
  },
};
const spec = readFileSync(
  new URL("../docs/PRODUCT_SPEC.md", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const genericTimeIssue =
  "한국시간·원문 병기의 표기 형식 또는 근거를 확인하세요.";

it.each([
  {
    variant: undefined,
    config: {
      ...combinedJob.config,
      timePolicy: undefined,
      promptVersion: "noct-post-quality-v2",
    },
    hashes: [
      "35adfb922b40bdc4254b63a5cbd72da0a25ed16be42c36354b9c8091c8a4a688",
      "92a9f11e6dceb22e4be2851a327e70fc436cee60afe7293ada25aeead11517fa",
      "9b54cbba285eacfed961ddee7cab7f2c3fd9603f44654f77847308fbc8e378a3",
      "9b54cbba285eacfed961ddee7cab7f2c3fd9603f44654f77847308fbc8e378a3",
    ],
  },
  {
    variant: combinedV1TrialVariant,
    config: combinedV1Job.config,
    hashes: [
      "c736c054bf468476b4e35a8607ae03bc8e6bf72fd46cd2987980fc99fc8edbd0",
      "67e4bef234c854c40b006e348eab2efe5e63281df2079f627cdc96192f17353f",
      "22af7d45704d45e021a65a6b15a0478e7d9472097d5e7959320b63d275da3a8c",
      "22af7d45704d45e021a65a6b15a0478e7d9472097d5e7959320b63d275da3a8c",
    ],
  },
] as const)(
  "이전 $config.promptVersion의 네 단계 요청을 바이트 단위로 재현",
  ({ variant, config, hashes }) => {
    const { bundle, draft } = sampleContent(
      combinedJob.us_trading_date,
      "post",
    );
    const requestJob = { ...combinedJob, config };
    const guide = trialEditorialGuide(spec, variant);
    const requests = (["draft", "repair", "verify", "recheck"] as const).map(
      (stage) =>
        trialRequest(
          requestJob,
          bundle,
          stage,
          draft,
          [genericTimeIssue],
          guide,
          "gpt-6.2-sol",
        ),
    );
    expect(
      requests.map((request) =>
        createHash("sha256").update(JSON.stringify(request)).digest("hex"),
      ),
    ).toEqual(hashes);
  },
);

function combinedFixture() {
  const { bundle, draft, charts } = sampleContent(
    combinedJob.us_trading_date,
    "post",
  );
  bundle.charts = charts;
  bundle.sources[0].method = "web";
  bundle.sources[0].rights = "private_only";
  const event = {
    ...bundle.events[0],
    occurredAt: null,
    status: "scheduled" as const,
  };
  const close = {
    ...event,
    id: "at-close",
    scheduledAt: "2026-11-27T18:00:00Z",
    scheduledOriginalTime: {
      timestamp: "2026-11-27T13:00:00-05:00",
      zone: "America/New_York",
    },
  };
  const holiday = {
    ...event,
    id: "holiday",
    scheduledAt: "2026-11-26T16:00:00Z",
  };
  bundle.events.push(
    close,
    { ...event, id: "after-close", scheduledAt: "2026-11-27T18:00:01Z" },
    holiday,
    { ...event, id: "at-cutoff", scheduledAt: bundle.cutoffAt },
  );
  draft.sections.push({
    id: "upcoming",
    type: "outlook",
    title: "예정 이벤트 안내",
    chartIds: [],
    claims: [holiday, close].map((item) => ({
      id: `claim-${item.id}`,
      text: `${eventTimeLabel(item)}에 경제지표 발표가 예정돼 있습니다.`,
      kind: "fact",
      sourceIds: [item.sourceId],
      observationIds: [],
      eventIds: [item.id],
      limitation: "",
    })),
  });
  return { bundle, draft };
}

it("통합 단계의 입력에만 휴장일을 포함한 다음 조기 폐장까지의 일정이 제공됨", () => {
  const { bundle, draft } = combinedFixture();
  for (const stage of ["draft", "repair", "verify", "recheck"] as const) {
    const body = trialRequest(
      combinedJob,
      bundle,
      stage,
      draft,
      undefined,
      "편집 기준",
      "gpt-6.2-sol",
    );
    const input = JSON.parse(body.input);
    const scope = stage === "repair" ? input.original : input;
    expect(scope.upcoming).toMatchObject({
      after: bundle.cutoffAt,
      through: "2026-11-27T18:00:00.000Z",
      calendarKnown: true,
      uncertain: false,
      events: [
        { id: "holiday" },
        {
          id: "at-close",
          displayTime: "2026-11-28 03:00 KST (2026-11-27 13:00 EST)",
        },
      ],
    });
    expect(scope.timeReferences).toContainEqual(
      expect.objectContaining({ eventId: "at-close", role: "예정" }),
    );
    expect(body.model).toBe(
      stage === "draft" || stage === "repair" ? "gpt-6-astra" : "gpt-6.2-sol",
    );
    const legacyJob = {
      ...combinedJob,
      config: {
        ...combinedJob.config,
        promptVersion: `noct-post-quality-v2-${pairedTimePolicy}`,
      },
    };
    const legacy = trialRequest(legacyJob, bundle, stage, draft);
    const legacyInput = JSON.parse(legacy.input);
    expect(
      stage === "repair" ? legacyInput.original : legacyInput,
    ).not.toHaveProperty("upcoming");
  }
});

it("통합 시험은 순서와 예정 시각이 맞는 주장만 별도 근거 검증에 전달", async () => {
  const { bundle, draft } = combinedFixture();
  const original = structuredClone(draft);
  original.sections.at(-1)!.claims[0].text = "경제지표 발표가 예정돼 있습니다.";
  const stages: string[] = [];
  const result = await generatePrivateTrial(
    combinedJob,
    bundle,
    async (stage, candidate, issues) => {
      stages.push(stage);
      if (stage === "draft") return original;
      if (stage === "repair") {
        expect(issues?.[0]).toContain("예정 시각");
        return draft;
      }
      return {
        findings: reviewItems(candidate!, bundle).map((item) => ({
          item: item.item,
          sourceIds: item.sourceIds,
          verdict: "supported",
          reason: "원문 대조",
        })),
      };
    },
    undefined,
    true,
  );
  expect(stages).toEqual(["draft", "repair", "recheck"]);
  expect(result.content.draft.sections.at(-1)?.id).toBe("upcoming");
});

it("새 통합 작성 지시는 장후 기사 문단과 별도 예정 목록을 구분", () => {
  const { bundle } = combinedFixture();
  const guide = trialEditorialGuide(spec, combinedTrialVariant);
  const body = trialRequest(
    combinedJob,
    bundle,
    "draft",
    undefined,
    undefined,
    guide,
  );
  expect(body.instructions).toContain("`예정 시각 | 이벤트명`");
  expect(body.instructions).toContain("목록 기호나 번호는 넣지 않는다");
  expect(body.instructions).toContain(
    "글자 수·문장 수를 일률적으로 제한하지 않는다",
  );
  expect(body.instructions).toContain(
    "source_interpretation과 ai_inference의 limitation에는 반드시",
  );
  expect(body.instructions).not.toContain(
    "각 claim.text는 읽는 순서대로 이어지는 자연스러운 문단으로 쓴다",
  );
  expect(JSON.parse(body.input).promptVersion).toBe(
    `noct-post-${combinedTrialVariant}`,
  );
});

it.each([
  { field: "text", phrase: "정오 무렵", message: genericTimeIssue },
  {
    field: "text",
    phrase: "2026-11-27 19:00 KST (예정 원문 2026-11-27 05:00 EST)",
    message: genericTimeIssue,
  },
  {
    field: "limitation",
    phrase: "2026-11-28 03:00 KST (2026-11-27 13:00 EST)",
    message: "한국시간·원문 병기의 날짜·시간대·연결 근거 불일치",
  },
] as const)(
  "통합 v2 $field 보정에 문제 표현을 전달하고 v1 메시지는 보존",
  async ({ field, phrase, message }) => {
    const { bundle, draft } = combinedFixture();
    const candidate = structuredClone(draft);
    const claim = candidate.summary[0];
    claim[field] = `${phrase} 발표 내용을 확인했습니다.`;
    for (const version of [
      combinedV1TrialVariant,
      combinedTrialVariant,
    ] as const) {
      const v2 = version === combinedTrialVariant;
      const testJob = v2 ? combinedJob : combinedV1Job;
      const stages: string[] = [];
      await generatePrivateTrial(
        testJob,
        bundle,
        async (stage, draftToReview, issues) => {
          stages.push(stage);
          if (stage === "draft") return candidate;
          if (stage === "repair") {
            const body = trialRequest(
              testJob,
              bundle,
              stage,
              draftToReview,
              issues,
              trialEditorialGuide(spec, version),
            );
            expect(JSON.parse(body.input).issues).toEqual([
              v2
                ? `주장 ${claim.id}.${field}에 있는 “${phrase}”. ${message}`
                : message,
            ]);
            if (v2)
              expect(body.instructions).toContain(
                "issues에 적힌 항목과 표현을 후보에서 찾아 실제로 고친다",
              );
            return draft;
          }
          return {
            findings: reviewItems(draftToReview!, bundle).map((item) => ({
              item: item.item,
              sourceIds: item.sourceIds,
              verdict: "supported",
              reason: "원문 대조",
            })),
          };
        },
        undefined,
        true,
      );
      expect(stages).toEqual(["draft", "repair", "recheck"]);
    }
  },
);

it("개별 종목 시세의 시각·비교 기준을 관측값으로 보존", () => {
  const { bundle } = combinedFixture();
  const stock = {
    ...bundle.observations[0],
    kind: "stock" as const,
    symbol: "TEST",
    observedAt: "2026-11-25T23:02:00Z",
    observedOriginalTime: {
      timestamp: "2026-11-25T18:02:00-05:00",
      zone: "America/New_York",
    },
    comparison: "정규장 종가 대비",
  };
  const parsed = BundleSchema.parse({ ...bundle, observations: [stock] });
  expect(parsed.observations).toEqual([stock]);
  expect(
    JSON.parse(trialRequest(combinedJob, parsed, "draft").input).timeReferences,
  ).toContainEqual({
    observationId: stock.id,
    sourceId: stock.sourceId,
    role: "관측",
    text: "2026-11-26 08:02 KST (2026-11-25 18:02 EST)",
  });
});
it.each(["edition", "day", "total"] as const)(
  "진행 중 금액을 포함한 %s 한도 경계",
  (key) => {
    const used = { edition: 0, day: 0, total: 0 };
    used[key] =
      { edition: 10000000, day: 30000000, total: 100000000 }[key] - 17;
    expect(() => checkBudget(used, 17)).not.toThrow();
    expect(() => checkBudget(used, 18)).toThrow();
  },
);
it("제목·요약·섹션·차트 일부만 검사하거나 연결되지 않은 근거를 반환하면 중단", () => {
  const items = reviewItems(content.draft, content.bundle);
  const findings = items.map((i) => ({
    item: i.item,
    verdict: "supported",
    sourceIds: i.sourceIds,
    reason: "지정 근거로 확인",
  }));
  const test = (f: unknown) =>
    reviewIssues(content.draft, content.bundle, { findings: f });
  expect(test(findings)).toEqual([]);
  expect(() => test(findings.slice(1))).toThrow();
  expect(() => test([...findings.slice(1), findings[1]])).toThrow();
  expect(() =>
    test([{ ...findings[0], sourceIds: ["bad"] }, ...findings.slice(1)]),
  ).toThrow();
  expect(
    test([
      { ...findings[0], verdict: "conflict", reason: "기간 오류" },
      ...findings.slice(1),
    ]),
  ).toEqual(["title: 기간 오류"]);
});
it("비공개 시험도 샘플 자료·기준 뒤에 공개된 출처를 유료 호출 전에 거부", () => {
  expect(() => checkTrialInput(job, content.bundle, new Date())).toThrow();
  const b = structuredClone(content.bundle);
  b.sources[0].publishedAt = "2040-01-01T01:00:00Z";
  expect(() => checkTrialInput(job, b, new Date())).toThrow("기준 시각");
});
it("비공개 품질 시험의 웹 근거는 일반 발행용 검사를 통과하지 않는다", () => {
  const bundle = structuredClone(content.bundle);
  bundle.sources = bundle.sources.map((source) => ({
    ...source,
    method: "web",
    rights: "private_only",
  }));
  const now = new Date("2026-11-22T00:00:00Z");
  expect(() => checkTrialInput(job, bundle, now, true)).not.toThrow();
  expect(() => checkTrialInput(job, bundle, now)).toThrow("공개 권한");
  bundle.sources[0].rights = "unverified";
  expect(() => checkTrialInput(job, bundle, now, true)).toThrow("비공개");
});
it("하락률 표기만 동치로 처리하고 다른 부호·단위·수치는 거절", () => {
  const example = structuredClone(content);
  const source = example.bundle.sources[0];
  const claim = example.draft.summary[0];
  example.draft.sections = [];
  example.draft.summary = [claim];
  Object.assign(claim, {
    sourceIds: [source.id],
    observationIds: [],
    eventIds: [],
    limitation: "",
    kind: "fact",
    text: "종가 기준 -14.01%",
  });
  source.excerpt = "종가 기준 14.01% 하락.";
  expect(() => validateContent(example, "sample")).not.toThrow();
  for (const excerpt of [
    "14.01% 상승",
    "14.01%포인트 하락",
    "114.01% 하락",
    "14.01%",
  ]) {
    source.excerpt = excerpt;
    expect(() => validateContent(example, "sample")).toThrow(
      "근거에 없는 수치",
    );
  }
});

it.each([true, false])(
  "근거 충돌 보정 뒤 모든 항목을 별도 재검사하고 두 번째 실패는 종료 (%s)",
  async (resolved) => {
    const bundle = structuredClone(content.bundle);
    bundle.charts = structuredClone(content.charts);
    // Only simulated provider I/O in this test. No sample is accepted by the live input gate.
    bundle.sources = bundle.sources.map((s) => ({
      ...s,
      method: "official",
      rights: "approved",
    }));
    const stages: string[] = [];
    const run = generatePrivateTrial(
      job,
      bundle,
      async (stage, candidate, issues) => {
        stages.push(stage);
        if (stage === "draft") return content.draft;
        if (stage === "repair") {
          expect(issues?.[0]).toContain("기간");
          return { ...candidate!, title: "보정한 제목" };
        }
        const findings = reviewItems(candidate!, bundle).map((item) => ({
          item: item.item,
          sourceIds: item.sourceIds,
          verdict:
            item.item === "title" && (stage === "verify" || !resolved)
              ? "conflict"
              : "supported",
          reason: "기간 대조",
        }));
        return { findings };
      },
    );
    if (resolved) expect((await run).content.draft.title).toBe("보정한 제목");
    else await expect(run).rejects.toThrow("보정 후");
    expect(stages).toEqual(["draft", "verify", "repair", "recheck"]);
  },
);

it("작성 입력을 확인한 뒤 저장된 보정본을 직접 재검증한다", async () => {
  const bundle = structuredClone(content.bundle);
  bundle.charts = content.charts;
  bundle.sources = bundle.sources.map((s) => ({
    ...s,
    method: "official",
    rights: "approved",
  }));
  const repair = { ...content.draft, title: "이미 보정한 제목" };
  const stages: string[] = [];
  const result = await generatePrivateTrial(
    job,
    bundle,
    async (stage, candidate) => {
      stages.push(stage);
      if (stage === "draft") return content.draft;
      expect(candidate).toEqual(repair);
      return {
        findings: reviewItems(repair, bundle).map((i) => ({
          item: i.item,
          sourceIds: i.sourceIds,
          verdict: "supported",
          reason: "원문 대조",
        })),
      };
    },
    async () => repair,
  );
  expect(stages).toEqual(["draft", "recheck"]);
  expect(result.content.draft.title).toBe(repair.title);
});
