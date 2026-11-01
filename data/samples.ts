import type { Bundle, Content, PublicBriefing } from "../lib/contract";
import { schedule } from "../lib/calendar";
export const SAMPLE_AS_OF = "2026-10-27T10:45:00.000Z";
export function sampleContent(
  date: string,
  session: "pre" | "post",
  scenario: "quiet" | "event" | "earnings" | "missing" = "quiet",
): Content {
  const slot = schedule(date, session);
  const cutoffAt = new Date(
    Date.parse(slot.targetAt) - 5 * 60000,
  ).toISOString();
  const sourceId = "sample-market";
  const bundle: Bundle = {
    cutoffAt,
    coverageStart: new Date(Date.parse(cutoffAt) - 3 * 86400000).toISOString(),
    sources: [
      {
        id: sourceId,
        title: "NOCT 가상 시장 데이터",
        publisher: "NOCT Brief 개발 샘플",
        url: "https://example.com/noct-sample",
        publishedAt: cutoffAt,
        checkedAt: cutoffAt,
        method: "sample",
        rights: "sample",
        excerpt:
          "가상 비교 값: 100, 100.4, 99.8, 101.2, 102.1, 101.4, 0.8, -0.6, 0.3, 1.2, -0.2. 실제 시세·발표가 아닙니다.",
        retention: "직접 작성한 가상 데이터",
      },
    ],
    observations: [],
    events: [
      {
        id: "sample-inflation",
        sourceId,
        title: "가상 물가 지표 발표",
        scheduledAt: `${date}T12:30:00.000Z`,
        occurredAt: session === "post" ? `${date}T12:30:00.000Z` : null,
        firstObservedAt: cutoffAt,
        status: session === "post" ? "released" : "scheduled",
        result:
          session === "post"
            ? "가상 결과: 예상 범위 안에서 발표. 실제 발표가 아닙니다."
            : "발표 전 · 실제 일정이 아닙니다.",
        watch: "지표의 세부 구성과 금리 반응이 같은 방향인지 확인합니다.",
      },
    ],
    missing:
      scenario === "missing"
        ? [
            "가상 기업 A의 콜 전문 미확보. 실적 보도자료 확인 범위만 반영했습니다.",
          ]
        : [],
    pendingCalls: [],
  };
  const line = [100, 100.4, 99.8, 101.2, 102.1, 101.4];
  line.forEach((value, i) =>
    bundle.observations.push({
      id: `day-${i}`,
      sourceId,
      name: "가상 미국 대형주 지수",
      kind: "index",
      symbol: "SAMPLE-US",
      value,
      unit: "기준값",
      currency: "",
      period: "가상 6개 거래일",
      observedAt: cutoffAt,
      comparison: "첫날=100으로 정규화",
    }),
  );
  [
    ["기술", 1.2],
    ["금융", 0.8],
    ["산업재", 0.3],
    ["헬스케어", -0.2],
    ["에너지", -0.6],
  ].forEach(([name, value], i) =>
    bundle.observations.push({
      id: `sector-${i}`,
      sourceId,
      name: String(name),
      kind: "sector",
      symbol: `SAMPLE-${i}`,
      value: Number(value),
      unit: "%",
      currency: "",
      period: "가상 정규장",
      observedAt: cutoffAt,
      comparison: "가상 전일 종가 대비",
    }),
  );
  const claim = (
    id: string,
    text: string,
    kind: "fact" | "ai_inference" = "fact",
    limitation = "",
  ) => ({
    id,
    text,
    kind,
    sourceIds: [sourceId],
    observationIds: [] as string[],
    eventIds: [] as string[],
    limitation,
  });
  const titles = {
    quiet: "기술·금융은 상승, 에너지는 하락",
    event: "물가 발표 대기, 다음 확인점은 금리 반응",
    earnings: "기업 투자 계획, 수요 기대와 실제 집행의 간극",
    missing: "기술·금융 상승, 기업 A 콜은 미반영",
  };
  const summaries = {
    quiet:
      "업종별 등락을 비교하고 상승이 시장 전반으로 확산됐는지 살펴봅니다. 주된 촉매는 아직 특정하지 못했습니다.",
    event:
      "물가 지표의 세부 항목과 발표 뒤 금리 반응을 함께 봅니다. 지표 둔화가 금리 하락을 보장하지는 않습니다.",
    earnings:
      "장후 투자 계획이 수요 기대에 주는 의미를 짚습니다. 실제 집행이나 공급업체 매출로 확정된 내용은 아닙니다.",
    missing:
      "기업 A의 콜 전문은 확보하지 못했습니다. 실적 보도자료의 확인 범위와 업종별 등락만 담았습니다.",
  };
  const market = {
    id: "market",
    type: "market" as const,
    title: "시장의 온도",
    claims: [
      claim(
        "breadth",
        "가상 시장에서는 기술·금융 업종이 상승하고 에너지 업종은 하락했습니다.",
      ),
      claim(
        "cause",
        "지수 상승만으로 시장 전체에 매수세가 확산됐다고 단정하기는 어렵습니다.",
        "ai_inference",
        "업종별 움직임을 비교한 해석이며 실제 투자자의 거래 동기를 확인한 것은 아닙니다.",
      ),
    ],
    chartIds: ["daily", "sectors"],
  };
  const outlook = {
    id: "outlook",
    type: "outlook" as const,
    title: "다음으로 확인할 것",
    claims: [
      {
        ...claim(
          "watch",
          "물가 지표가 둔화하더라도 금리가 같은 방향으로 움직이는지 함께 봐야 합니다. 세부 항목이나 정책 해석에 따라 반응은 달라질 수 있습니다.",
          "ai_inference",
          "조건부 시나리오이며 시장 방향을 예측하거나 보장하지 않습니다.",
        ),
        eventIds: ["sample-inflation"],
      },
    ],
    chartIds: [],
  };
  const earnings = {
    id: "earnings",
    type: "earnings" as const,
    title: "실적과 어닝콜 · 정규장 이후",
    claims: [
      claim(
        "call",
        "가상 기업의 투자 계획은 수요 기대를 뒷받침하지만, 실제 집행이나 공급업체 매출로 확정된 것은 아닙니다.",
        "ai_inference",
        "가상 실적 상황을 설명하는 샘플입니다. 장후 정보를 정규장 움직임의 원인으로 소급하지 않습니다.",
      ),
    ],
    chartIds: [],
  };
  return {
    schemaVersion: 1,
    marketScope: "us_market",
    date,
    session,
    sample: true,
    generatedAt: slot.targetAt,
    bundle,
    reduced: scenario === "missing",
    draft: {
      title: titles[scenario],
      summary: [
        claim(
          "summary-1",
          summaries[scenario],
          "ai_inference",
          "이 글의 사건과 수치는 기능 검증용 가상 자료입니다.",
        ),
        claim(
          "summary-2",
          "확인된 움직임과 가능한 해석을 구분하고, 다음 판단을 바꿀 조건을 살펴봅니다.",
          "ai_inference",
          "현재 자료만으로 주된 촉매를 특정하지 못했습니다.",
        ),
      ],
      sections:
        scenario === "earnings"
          ? [earnings, market, outlook]
          : scenario === "event"
            ? [outlook, market]
            : [market, outlook],
    },
    charts: [
      {
        id: "daily",
        kind: "line",
        title: "일별 흐름",
        unit: "기준값",
        period: "가상 6개 거래일",
        basis: "첫날=100 · 실제 지수 수익률이 아닙니다",
        sourceIds: [sourceId],
        alt: "가상 지수는 첫날 대비 상승했지만 마지막 날에는 전날보다 낮아졌습니다.",
        series: [
          {
            name: "가상 미국 대형주 지수",
            points: line.map((_, i) => ({
              label: `D${i + 1}`,
              observationId: `day-${i}`,
            })),
          },
        ],
      },
      {
        id: "sectors",
        kind: "bar",
        title: "섹터의 온도 차",
        unit: "%",
        period: "가상 정규장",
        basis: "가상 전일 종가 대비",
        sourceIds: [sourceId],
        alt: "기술·금융·산업재 상승, 헬스케어·에너지 하락을 나타낸 가상 비교입니다.",
        series: [
          {
            name: "가상 섹터",
            points: bundle.observations
              .filter((o) => o.kind === "sector")
              .map((o) => ({ label: o.name, observationId: o.id })),
          },
        ],
      },
    ],
  };
}
export const samples: PublicBriefing[] = (
  [
    ["2026-10-26", "post", "earnings"],
    ["2026-10-26", "pre", "event"],
    ["2026-10-23", "post", "missing"],
    ["2026-10-23", "pre", "quiet"],
  ] as const
).map(([date, session, scenario]) => ({
  id: `${date}-${session}`,
  versionId: `sample-${date}-${session}`,
  targetAt: schedule(date, session).targetAt,
  publishedAt: schedule(date, session).targetAt,
  correctedAt: null,
  content: sampleContent(date, session, scenario),
  corrections: [],
}));
