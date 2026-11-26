import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";
import {
  parseResearchDossier,
  researchCases,
  researchRequest,
  researchVersion,
  researchWindow,
  type ResearchDossier,
} from "../lib/research-trial";

const date = "2026-11-20";
const zone = "America/New_York";
const clock = (value: string) => ({
  value,
  zone,
  precision: "minute" as const,
});
const dateOnly = (value: string) => ({
  value,
  zone,
  precision: "date" as const,
});

function dossier(): ResearchDossier {
  const url = "https://exchange.example.com/session-summary";
  return {
    date,
    sources: [
      {
        id: "s1",
        url,
        title: "시장 안내",
        publisher: "시험용 기관",
        type: "official",
        access: "direct_read",
        publishedAt: clock("2026-11-20T19:30-05:00"),
        updatedAt: null,
        availability: {
          status: "confirmed_as_of",
          knownAt: clock("2026-11-20T19:30-05:00"),
          versionEvidence: {
            url,
            description: "마감 시각 표기가 있는 시험 원본",
          },
        },
        supportingFacts: ["정규장 관측과 다음 장까지 공지된 일정"],
      },
    ],
    facts: [
      {
        id: "f1",
        category: "indices",
        role: "current",
        kind: "documented_fact",
        text: "가상 지수의 정규장 마감은 7.4% 하락했다.",
        sourceIds: ["s1"],
        observedAt: clock("2026-11-20T16:00-05:00"),
        occurredAt: null,
        period: date,
        observation: {
          instrument: "가상 지수",
          instrumentType: "index",
          value: -7.4,
          unit: "%",
          comparison: "전 거래일 종가 대비",
          session: "regular",
        },
        attribution: null,
        importance: "시장 가격의 방향을 알려준다.",
        caveats: [],
      },
    ],
    upcomingEvents: [
      {
        id: "e1",
        title: "시험 예정 행사",
        description: "다음 거래일 폐장 시각에 시작하는 대화",
        importance: "경제 상황에 관한 발언을 확인한다.",
        scheduledAt: clock("2026-11-23T16:00-05:00"),
        scheduledSession: null,
        knownAt: clock("2026-11-20T19:30-05:00"),
        sourceIds: ["s1"],
      },
    ],
    coverage: [
      {
        domain: "markets",
        status: "partial",
        searches: ["markets"],
        missingReason: "확산과 업종에 대한 근거 미확인",
      },
      {
        domain: "macro",
        status: "unconfirmed",
        searches: ["macro"],
        missingReason: "원본 미확인",
      },
      {
        domain: "catalysts",
        status: "unconfirmed",
        searches: ["catalysts"],
        missingReason: "원본 미확인",
      },
      {
        domain: "after_hours",
        status: "unconfirmed",
        searches: ["after hours"],
        missingReason: "원본 미확인",
      },
      {
        domain: "schedule",
        status: "covered",
        searches: ["calendar"],
        missingReason: null,
      },
    ],
    unresolvedConflicts: [],
    limitations: ["일부 정규장 자료와 시간외 관측값을 확인하지 못했다."],
  };
}

const parse = (value: ResearchDossier) =>
  parseResearchDossier(JSON.stringify(value), date);

describe("research request", () => {
  it("keeps independent research defaults without changing generation settings", () => {
    const defaults = readConfig({});
    expect(defaults).toMatchObject({
      OPENAI_RESEARCH_MODEL: "gpt-6.2-sol",
      OPENAI_RESEARCH_REASONING_EFFORT: "high",
      OPENAI_RESEARCH_MAX_OUTPUT_TOKENS: 32000,
      OPENAI_RESEARCH_MAX_TOOL_CALLS: 40,
      OPENAI_REASONING_EFFORT: "medium",
      OPENAI_MAX_OUTPUT_TOKENS: 10000,
    });
    expect(
      readConfig({ OPENAI_RESEARCH_REASONING_EFFORT: "xhigh" }),
    ).toMatchObject({ OPENAI_RESEARCH_REASONING_EFFORT: "xhigh" });
    expect(() => readConfig({ OPENAI_REASONING_EFFORT: "xhigh" })).toThrow();
    expect(() =>
      readConfig({ OPENAI_RESEARCH_MAX_TOOL_CALLS: "81" }),
    ).toThrow();
  });

  it("sends only the common research task and calendar across four cases", () => {
    const requests = researchCases.map((entry) => researchRequest(date, entry));
    expect(
      requests.map(({ model, reasoning }) => [model, reasoning.effort]),
    ).toEqual([
      ["gpt-6.2-sol", "high"],
      ["gpt-6.2-sol", "xhigh"],
      ["gpt-6-astra", "high"],
      ["gpt-6-astra", "xhigh"],
    ]);
    const common = requests.map(
      ({ model: _model, reasoning: _reasoning, ...rest }) => rest,
    );
    for (const body of common.slice(1)) expect(body).toEqual(common[0]);
    expect(common[0]).toMatchObject({
      background: true,
      store: true,
      service_tier: "default",
      max_output_tokens: 32000,
      max_tool_calls: 40,
      tools: [{ type: "web_search", search_context_size: "medium" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
    });
    expect(JSON.parse(common[0].input)).toEqual({
      researchVersion,
      ...researchWindow(date),
    });
    expect(
      researchRequest(date, {
        ...researchCases[0],
        maxOutputTokens: 4000,
        maxToolCalls: 12,
      }),
    ).toMatchObject({ max_output_tokens: 4000, max_tool_calls: 12 });
  });

  it("computes holidays, early closes, weekends and DST using trading dates", () => {
    expect(researchWindow(date)).toEqual({
      date,
      zone,
      coverageStart: "2026-11-20T00:30:00.000Z",
      regularCloseAt: "2026-11-20T21:00:00.000Z",
      cutoffAt: "2026-11-21T00:30:00.000Z",
      upcomingThrough: "2026-11-23T21:00:00.000Z",
    });
    expect(researchWindow("2026-11-25").upcomingThrough).toBe(
      "2026-11-27T18:00:00.000Z",
    );
    expect(researchWindow("2026-11-27")).toMatchObject({
      regularCloseAt: "2026-11-27T18:00:00.000Z",
      cutoffAt: "2026-11-28T00:30:00.000Z",
      coverageStart: "2026-11-26T00:30:00.000Z",
    });
    expect(researchWindow("2026-10-30")).toMatchObject({
      cutoffAt: "2026-10-30T23:30:00.000Z",
      upcomingThrough: "2026-11-02T21:00:00.000Z",
    });
    expect(() => researchWindow("2026-11-26")).toThrow();
    expect(researchWindow("2027-12-31").upcomingThrough).toBeNull();
  });
});

describe("research dossier audit", () => {
  it("keeps cutoff-time sources, next close events and honestly missing data", () => {
    const value = dossier();
    expect(parse(value)).toEqual({ dossier: value, issues: [] });
    value.facts[0].observedAt = dateOnly(date);
    value.upcomingEvents[0].scheduledAt = dateOnly("2026-11-21");
    expect(parse(value)).toEqual({ dossier: value, issues: [] });
    value.upcomingEvents[0].scheduledAt = dateOnly("2026-11-23");
    value.upcomingEvents[0].scheduledSession = "regular";
    expect(parse(value)).toEqual({ dossier: value, issues: [] });
  });

  it("flags unproven and post-cutoff versions, observations, and schedule updates", () => {
    const value = dossier();
    value.sources[0].availability.knownAt = dateOnly(date);
    value.sources[0].updatedAt = clock("2026-11-20T19:31-05:00");
    value.facts[0].observedAt = clock("2026-11-20T19:31-05:00");
    value.upcomingEvents[0].knownAt = clock("2026-11-20T19:31-05:00");
    value.upcomingEvents[0].scheduledAt = clock("2026-11-23T16:01-05:00");
    const result = parse(value);
    expect(result.dossier).toEqual(value);
    expect(result.issues.join("\n")).toContain("인용 판본을 마감까지");
    expect(result.issues.join("\n")).toContain("마감 시점 직접 근거");
    expect(result.issues.join("\n")).toContain("마감 뒤일 수 있는 실제 관측");
    expect(result.issues.join("\n")).toContain("마감까지 공지됐는지");
    expect(result.issues.join("\n")).toContain("전체 시각 범위");
  });

  it("rejects timing inferred from a date or an offset that disagrees with the source zone", () => {
    const value = dossier();
    value.facts[0].category = "after_hours";
    value.facts[0].observation!.session = "post";
    value.facts[0].observedAt = dateOnly(date);
    value.upcomingEvents[0].scheduledAt = clock("2026-11-23T15:00-04:00");
    expect(parse(value).issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("시간외 관측 구간"),
        expect.stringContaining("시각·정밀도·시간대"),
      ]),
    );
  });

  it("flags pre-market prices labeled as regular-session observations", () => {
    const value = dossier();
    value.facts[0].observedAt = clock("2026-11-20T08:00-05:00");
    expect(parse(value).issues).toContainEqual(
      expect.stringContaining("정규장 관측 날짜 또는 세션"),
    );
  });

  it("reports duplicate and missing references, snippets, and incomplete coverage", () => {
    const value = dossier();
    value.sources.push({ ...value.sources[0], access: "search_snippet" });
    value.facts[0].sourceIds = ["s1", "s1", "missing"];
    value.coverage.pop();
    value.coverage[0].searches = [];
    value.coverage[0].missingReason = null;
    expect(parse(value).issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ID가 중복"),
        expect.stringContaining("직접 확인 내용"),
        expect.stringContaining("중복 출처 연결"),
        expect.stringContaining("출처 missing"),
        expect.stringContaining("기록된 검색"),
        expect.stringContaining("미확인 이유"),
        expect.stringContaining("조사 범위 schedule가 누락"),
      ]),
    );
  });

  it("does not coerce an incomplete JSON response or allow future result fields", () => {
    const value = dossier();
    Object.assign(value.upcomingEvents[0], { result: "가상 실제치" });
    expect(parse(value)).toMatchObject({
      dossier: null,
      issues: [expect.stringContaining("upcomingEvents.0")],
    });
    expect(parseResearchDossier("{", date)).toMatchObject({ dossier: null });
  });
});
