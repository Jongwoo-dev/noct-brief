import { describe, expect, it } from "vitest";
import { sampleContent } from "../data/samples";
import {
  BundleSchema,
  evidenceTimeReferences,
  validateContent,
} from "../lib/contract";
import {
  generatePrivateTrial,
  reviewItems,
  trialRequest,
} from "../lib/report-trial";
import {
  formatKoreaTime,
  formatMarketTime,
  formatSourcePublication,
  formatSourceTime,
  matchesOriginalTime,
  pairedTimePolicy,
} from "../lib/report-time";
import type { DraftJob } from "../lib/providers";

describe("보고서 시각의 기준", () => {
  it.each([
    ["2026-03-07T00:30:00Z", "2026-03-07 09:30 KST", "EST"],
    ["2026-03-09T23:30:00Z", "2026-03-10 08:30 KST", "EDT"],
    ["2026-10-30T23:30:00Z", "2026-10-31 08:30 KST", "EDT"],
    ["2026-11-03T00:30:00Z", "2026-11-03 09:30 KST", "EST"],
    ["2027-01-01T00:30:00Z", "2027-01-01 09:30 KST", "EST"],
  ])("시장 기준은 날짜별 DST를 적용합니다 (%s)", (iso, kst, eastern) => {
    expect(formatMarketTime(iso)).toMatch(
      new RegExp(`^${kst} \\(.+ ${eastern}\\)$`),
    );
    expect(formatKoreaTime(iso)).toBe(kst);
  });
  it("입력의 원문 시각과 저장된 UTC를 구분합니다", () => {
    const recorded = "2026-11-20T19:16:00Z";
    expect(formatSourceTime(recorded)).toBe(
      "2026-11-21 04:16 KST (2026-11-20 19:16 UTC)",
    );
    expect(formatSourceTime("2026-11-20T14:16:00-05:00")).toBe(
      "2026-11-21 04:16 KST (2026-11-20 19:16 UTC)",
    );
    expect(
      formatSourceTime(recorded, { timestamp: "2026-11-20T14:16:00-05:00" }),
    ).toBe("2026-11-21 04:16 KST (2026-11-20 14:16 UTC-05:00)");
    expect(
      formatSourceTime(recorded, {
        timestamp: "2026-11-20T14:16",
        zone: "America/New_York",
      }),
    ).toBe("2026-11-21 04:16 KST (2026-11-20 14:16 EST)");
    expect(
      formatSourceTime("2026-11-20T23:02:00Z", {
        timestamp: "2026-11-20T18:02:00-05:00",
        zone: "America/New_York",
      }),
    ).toBe("2026-11-21 08:02 KST (2026-11-20 18:02 EST)");
    expect(formatSourceTime("2026-11-20")).toBe("시각 미확인");
    expect(formatSourcePublication("2026-11-20")).toBe(
      "2026-11-20 (게시 시각 미확인)",
    );
    expect(formatSourcePublication(recorded)).toBe(formatSourceTime(recorded));
    expect(formatSourceTime("2026-11-20T14:16")).toBe("시각 미확인");
    expect(
      formatSourceTime(recorded, {
        timestamp: "2026-11-20T12:16",
        zone: "America/New_York",
      }),
    ).toBe("원문 시각 불일치");
  });
  it("시간대 미상·서머타임 결락·중복을 추정하지 않고 일치하는 명시 오프셋을 사용합니다", () => {
    const zone = "America/New_York";
    expect(
      matchesOriginalTime("2026-03-08T07:30:00Z", {
        timestamp: "2026-03-08T02:30",
        zone,
      }),
    ).toBe(false);
    expect(
      matchesOriginalTime("2026-11-01T05:30:00Z", {
        timestamp: "2026-11-01T01:30",
        zone,
      }),
    ).toBe(false);
    expect(
      matchesOriginalTime("2026-11-01T05:30:00Z", {
        timestamp: "2026-11-01T01:30",
      }),
    ).toBe(false);
    expect(
      matchesOriginalTime("2026-11-01T05:30:00Z", {
        timestamp: "2026-11-01",
        zone,
      }),
    ).toBe(false);
    expect(
      matchesOriginalTime("2026-11-01T05:30:00Z", {
        timestamp: "2026-11-01T01:30-04:00",
        zone,
      }),
    ).toBe(true);
    expect(
      matchesOriginalTime("2026-11-01T06:30:00Z", {
        timestamp: "2026-11-01T01:30-05:00",
        zone,
      }),
    ).toBe(true);
    expect(
      matchesOriginalTime("2026-11-01T05:30:00Z", {
        timestamp: "2026-11-01T01:30-05:00",
        zone,
      }),
    ).toBe(false);
    expect(
      matchesOriginalTime("2026-11-20T18:30:00Z", {
        timestamp: "2026-11-20T14:30-04:00",
        zone,
      }),
    ).toBe(false);
  });
});

function fixture() {
  const content = sampleContent("2026-10-26", "post");
  content.timePolicy = pairedTimePolicy;
  content.charts = [];
  const source = content.bundle.sources[0];
  source.publishedAt = "2026-10-26T22:08:00Z";
  source.publishedOriginalTime = {
    timestamp: "2026-10-26T18:08:00-04:00",
    zone: "America/New_York",
  };
  const observation = content.bundle.observations[0];
  observation.observedAt = "2026-10-26T22:02:00Z";
  observation.observedOriginalTime = {
    timestamp: "2026-10-26T18:02:00-04:00",
    zone: "America/New_York",
  };
  const event = content.bundle.events[0];
  event.scheduledAt = "2026-10-26T21:57:00Z";
  event.occurredAt = "2026-10-26T22:00:00Z";
  event.occurredOriginalTime = { timestamp: "2026-10-26T22:00:00Z" };
  const p = {
    ...content.draft.summary[0],
    kind: "fact" as const,
    limitation: "",
    observationIds: [observation.id],
    eventIds: [event.id],
  };
  content.draft.summary = [p];
  content.draft.sections = [];
  const published = formatSourceTime(
    source.publishedAt,
    source.publishedOriginalTime,
    "게시",
  );
  const observed = formatSourceTime(
    observation.observedAt,
    observation.observedOriginalTime,
    "관측",
  );
  const scheduled = formatSourceTime(
    event.scheduledAt,
    event.scheduledOriginalTime,
    "예정",
  );
  const occurred = formatSourceTime(
    event.occurredAt,
    event.occurredOriginalTime,
    "발생",
  );
  return {
    content,
    source,
    observation,
    p,
    published,
    observed,
    scheduled,
    occurred,
  };
}

describe("인용 시각을 같은 역할의 한 근거와 대조", () => {
  it("게시·관측·예정·발생 쌍을 각각 허용하며 시각 숫자는 수량 근거가 되지 않습니다", () => {
    const { content, p, published, observed, scheduled, occurred } = fixture();
    p.text = `${published} 자료는 ${observed}의 관측값을 다룹니다. ${scheduled}인 일정은 ${occurred}에 시작됐습니다.`;
    expect(() => validateContent(content, "sample")).not.toThrow();
    expect(evidenceTimeReferences(content.bundle)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "게시", text: published }),
        expect.objectContaining({ role: "관측", text: observed }),
        expect.objectContaining({ role: "예정", text: scheduled }),
        expect.objectContaining({ role: "발생", text: occurred }),
      ]),
    );
    p.text += " 물량은 18개입니다.";
    expect(() => validateContent(content, "sample")).toThrow(
      "입력 근거에 없는 수치",
    );
  });
  it("한 시간·하루·시간대·링크가 틀리거나 두 순간을 섞은 부분을 거부합니다", () => {
    const { content, p, published, observed, occurred } = fixture();
    const cases = [
      observed.replace("07:02 KST", "08:02 KST"),
      observed.replace("2026-10-27", "2026-10-26"),
      observed.replace("EDT", "EST"),
      observed.replace(" (", " (관측 원문 "),
      `${observed.split(" (")[0]} (${published.split(" (")[1]}`,
      observed.replace(" KST ", " 한국시간 "),
      `${observed.split(" (")[1].slice(0, -1)} (${observed.split(" (")[0]})`,
      "2026-10-27 07:02 KST",
      observed.slice(0, -1),
      occurred.replace(" (", " (예정 원문 "),
    ];
    for (const value of cases) {
      p.text = value;
      expect(() => validateContent(content, "sample"), value).toThrow(
        "한국시간·원문 병기",
      );
    }
    p.text = observed;
    p.observationIds = [];
    expect(() => validateContent(content, "sample")).toThrow(
      "한국시간·원문 병기",
    );
  });
  it("정확한 시각에 쓰인 숫자를 인용 수량으로 뒷받침할 수 없습니다", () => {
    const { content, p, source } = fixture();
    source.excerpt = "수치 2개를 확인했다.";
    for (const wording of [
      "미국 동부 오후 2시(현지시각)에 발표했다.",
      "미국 동부 2 p.m.에 발표했다.",
      "오후 두 시에 발표했다.",
      "정오에 발표했다.",
    ]) {
      p.text = wording;
      expect(() => validateContent(content, "sample"), wording).toThrow(
        "한국시간·원문 병기",
      );
    }
    p.text = "수치 2개를 확인했다.";
    expect(() => validateContent(content, "sample")).not.toThrow();
  });
  it("연결하지 않은 다른 출처의 게시 시각을 허용하지 않습니다", () => {
    const { content, source, p, published } = fixture();
    content.bundle.sources.push({ ...source, id: "other-source" });
    source.publishedAt = source.checkedAt;
    delete source.publishedOriginalTime;
    p.text = published;
    expect(() => validateContent(content, "sample")).toThrow(
      "한국시간·원문 병기",
    );
  });
  it("원문 메타의 두 순간이 다르거나 날짜만 있으면 자료로 수락하지 않습니다", () => {
    const { content, source } = fixture();
    const old = { ...source.publishedOriginalTime! };
    for (const timestamp of [
      "2026-10-26",
      "2026-10-26T18:09:00-04:00",
      "2026-10-26T18:08:00-05:00",
    ]) {
      source.publishedOriginalTime = { ...old, timestamp };
      expect(BundleSchema.safeParse(content.bundle).success, timestamp).toBe(
        false,
      );
    }
  });
  it("제목·소제목·차트 필드에서도 잘못된 병기를 허용하지 않습니다", () => {
    const { content, p, observed } = fixture();
    p.text = observed;
    const wrong = observed.replace("07:02 KST", "08:02 KST");
    content.draft.title = wrong;
    expect(() => validateContent(content, "sample")).toThrow(
      "한국시간·원문 병기",
    );
    content.draft.title = observed;
    expect(() => validateContent(content, "sample")).not.toThrow();
    const existing = sampleContent("2026-10-26", "post");
    content.draft.sections = [
      {
        ...existing.draft.sections[0],
        title: wrong,
        claims: [p],
        chartIds: [],
      },
    ];
    expect(() => validateContent(content, "sample")).toThrow(
      "한국시간·원문 병기",
    );
    content.draft.sections[0].title = observed;
    content.charts = existing.charts;
    content.charts[0].period = wrong;
    expect(() => validateContent(content, "sample")).toThrow(
      "한국시간·원문 병기",
    );
  });
  it("옵션 이전 회차의 발췌 시각 검사와 별도 요청 경계를 보존합니다", () => {
    const { content, source, p } = fixture();
    delete content.timePolicy;
    p.text = "18:02 ET 관측에서 확인했습니다.";
    source.excerpt = "18:02 ET 시점의 관측입니다.";
    expect(() => validateContent(content, "sample")).not.toThrow();
    p.text = "23:45 KST (잠정치)에 발표했다.";
    source.excerpt = "23:45 KST에 발표했다.";
    expect(() => validateContent(content, "sample")).not.toThrow();
    const job: DraftJob = {
      kind: "initial",
      session: "post",
      us_trading_date: content.date,
      config: {
        model: "gpt-6-astra",
        mode: "live",
        promptVersion: "noct-post-quality-v2",
        reasoning: "medium",
        maxOutputTokens: 8000,
      },
      payload: {},
    };
    const withPolicy: DraftJob = {
      ...job,
      config: { ...job.config, timePolicy: pairedTimePolicy },
    };
    for (const stage of ["draft", "repair", "verify", "recheck"] as const) {
      const legacy = trialRequest(
        job,
        content.bundle,
        stage,
        content.draft,
        [],
        "작성 기준",
      );
      const updated = trialRequest(
        withPolicy,
        content.bundle,
        stage,
        content.draft,
        [],
        "작성 기준",
      );
      expect(legacy.instructions).not.toContain("timeReferences");
      expect(legacy.input).not.toContain("timeReferences");
      expect(updated.instructions).toContain("timeReferences");
      const input = JSON.parse(updated.input);
      const timeReferences = (stage === "repair" ? input.original : input)
        .timeReferences;
      expect(timeReferences).toContainEqual(
        expect.objectContaining({ role: "관측" }),
      );
      expect(
        timeReferences.map((ref: { text: string }) => ref.text).join(" "),
      ).not.toMatch(/원문|미국 동부|EST UTC|EDT UTC/);
    }
  });
  it("병기 초안에 붙인 의미 검증 피드백을 한 번 보정하고 재검증합니다", async () => {
    const { content, source, p, observed } = fixture();
    source.method = "official";
    source.rights = "approved";
    p.text = `${observed}의 관측으로 확인했습니다.`;
    const job: DraftJob = {
      kind: "initial",
      session: "post",
      us_trading_date: content.date,
      config: {
        model: "gpt-6-astra",
        mode: "live",
        promptVersion: "noct-post-quality-v2-kst-original-v1",
        reasoning: "medium",
        maxOutputTokens: 8000,
        timePolicy: pairedTimePolicy,
      },
      payload: {},
    };
    const stages: string[] = [];
    const result = await generatePrivateTrial(
      job,
      content.bundle,
      async (stage, candidate, issues) => {
        stages.push(stage);
        if (stage === "draft") return content.draft;
        if (stage === "repair") {
          expect(issues?.[0]).toContain("관측 역할");
          return {
            ...content.draft,
            summary: [{ ...p, text: `${observed} 기준의 개별 관측값입니다.` }],
          };
        }
        return {
          findings: reviewItems(candidate!, content.bundle).map((item) => ({
            item: item.item,
            sourceIds: item.sourceIds,
            verdict:
              stage === "verify" && item.item === "summary/0"
                ? "unsupported"
                : "supported",
            reason: "관측 역할 확인",
          })),
        };
      },
    );
    expect(stages).toEqual(["draft", "verify", "repair", "recheck"]);
    expect(result.content.timePolicy).toBe(pairedTimePolicy);
    expect(result.content.draft.summary[0].text).toContain("개별 관측값");
  });
});
