import { z } from "zod";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const time = z.iso.datetime({ offset: true });
const text = z.string().min(1).max(4000);
export function safeUrl(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !/^(localhost|.*\.local|.*\.internal|\[|\d)/i.test(u.hostname)
    );
  } catch {
    return false;
  }
}
const source = z.object({
  id,
  title: text,
  publisher: text,
  url: z.string().refine(safeUrl),
  publishedAt: time,
  checkedAt: time,
  method: z.enum(["official", "licensed", "sample"]),
  rights: z.enum(["approved", "sample", "unverified"]),
  excerpt: z.string().max(2000),
  retention: text,
});
const observation = z.object({
  id,
  sourceId: id,
  name: text,
  kind: z.enum(["index", "etf", "future", "yield", "sector", "economic"]),
  symbol: text,
  value: z.number(),
  unit: text,
  currency: z.string(),
  period: text,
  observedAt: time,
  comparison: text,
});
const event = z.object({
  id,
  sourceId: id,
  title: text,
  scheduledAt: time,
  occurredAt: time.nullable(),
  firstObservedAt: time,
  status: z.enum(["scheduled", "released", "postponed", "unconfirmed"]),
  result: z.string(),
  watch: z.string(),
});
const chart = z.object({
  id,
  kind: z.enum(["line", "bar"]),
  title: text,
  unit: text,
  period: text,
  basis: text,
  sourceIds: z.array(id).min(1),
  alt: text,
  series: z
    .array(
      z.object({
        name: text,
        points: z.array(z.object({ label: text, observationId: id })).min(1),
      }),
    )
    .min(1)
    .max(1),
});
export const BundleSchema = z.object({
  cutoffAt: time,
  coverageStart: time,
  sources: z.array(source),
  observations: z.array(observation),
  events: z.array(event),
  missing: z.array(text),
  pendingCalls: z.array(text),
  charts: z.array(chart).optional(),
});
export type Bundle = z.infer<typeof BundleSchema>;
const claim = z.object({
  id,
  text,
  kind: z.enum(["fact", "source_interpretation", "ai_inference"]),
  sourceIds: z.array(id).min(1),
  observationIds: z.array(id),
  eventIds: z.array(id),
  limitation: z.string().max(2000),
});
export const DraftSchema = z.object({
  title: text,
  summary: z.array(claim).max(8),
  sections: z
    .array(
      z.object({
        id,
        type: z.enum(["market", "events", "earnings", "outlook", "trend"]),
        title: text,
        claims: z.array(claim).min(1),
        chartIds: z.array(id),
      }),
    )
    .max(10),
});
export type Draft = z.infer<typeof DraftSchema>;

export const ContentSchema = z.object({
  schemaVersion: z.literal(1),
  marketScope: z.literal("us_market"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: z.enum(["pre", "post"]),
  sample: z.boolean(),
  generatedAt: time,
  bundle: BundleSchema,
  draft: DraftSchema,
  charts: z.array(chart),
  reduced: z.boolean(),
});
export type Content = z.infer<typeof ContentSchema>;
export type PublicBriefing = {
  id: string;
  versionId: string;
  targetAt: string;
  publishedAt: string;
  correctedAt: string | null;
  content: Content;
  corrections: { at: string; reason: string; change: string }[];
};
export function validateContent(
  input: unknown,
  mode: "sample" | "live",
): Content {
  const c = ContentSchema.parse(input);
  if (c.sample !== (mode === "sample")) throw new Error("데이터 모드 불일치");
  if (!c.reduced && !c.draft.summary.length) throw new Error("요약 누락");
  const sources = new Map(c.bundle.sources.map((s) => [s.id, s]));
  const obs = new Map(c.bundle.observations.map((o) => [o.id, o]));
  const events = new Map(c.bundle.events.map((e) => [e.id, e]));
  const charts = new Map(c.charts.map((g) => [g.id, g]));
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new Error("식별자 중복");
  };
  unique(c.bundle.sources.map((s) => s.id));
  unique(c.bundle.observations.map((o) => o.id));
  unique(c.bundle.events.map((e) => e.id));
  unique(c.charts.map((g) => g.id));
  unique(c.draft.sections.map((s) => s.id));
  if (
    Date.parse(c.bundle.coverageStart) > Date.parse(c.bundle.cutoffAt) ||
    Date.parse(c.bundle.cutoffAt) > Date.parse(c.generatedAt)
  )
    throw new Error("자료 시각 불일치");
  for (const s of sources.values())
    if (mode === "live" && (s.rights !== "approved" || s.method === "sample"))
      throw new Error("공개 권한 미확인");
  if (
    c.bundle.sources.some(
      (s) =>
        Date.parse(s.checkedAt) > Date.parse(c.generatedAt) ||
        Date.parse(s.publishedAt) > Date.parse(s.checkedAt),
    )
  )
    throw new Error("출처 확인 시각 불일치");
  for (const o of obs.values())
    if (
      !sources.has(o.sourceId) ||
      Date.parse(o.observedAt) > Date.parse(c.bundle.cutoffAt)
    )
      throw new Error("수치 출처·시점 불일치");
  for (const e of events.values())
    if (
      !sources.has(e.sourceId) ||
      Date.parse(e.firstObservedAt) > Date.parse(c.bundle.cutoffAt) ||
      (e.occurredAt &&
        Date.parse(e.occurredAt) > Date.parse(c.bundle.cutoffAt)) ||
      (e.status === "released" && !e.occurredAt)
    )
      throw new Error("사건 시점 불일치");
  for (const p of [
    ...c.draft.summary,
    ...c.draft.sections.flatMap((s) => s.claims),
  ]) {
    if (
      p.sourceIds.some((s) => !sources.has(s)) ||
      p.observationIds.some((o) => !obs.has(o)) ||
      p.eventIds.some((e) => !events.has(e))
    )
      throw new Error("존재하지 않는 근거 참조");
    if (p.kind !== "fact" && !p.limitation.trim())
      throw new Error("해석 한계 누락");
    if (
      p.observationIds.some(
        (o) => !p.sourceIds.includes(obs.get(o)!.sourceId),
      ) ||
      p.eventIds.some((e) => !p.sourceIds.includes(events.get(e)!.sourceId))
    )
      throw new Error("수치 근거 연결 불일치");
    const evidenceText =
      p.sourceIds.map((s) => sources.get(s)!.excerpt).join(" ") +
      " " +
      p.observationIds.map((o) => String(obs.get(o)!.value)).join(" ");
    const numericTokens = (value: string) =>
      (value.match(/[-+]?\d+(?:[.,]\d+)*/g) ?? []).map((n) =>
        n.replace(/^\+/, "").replaceAll(",", ""),
      );
    const numbers = numericTokens(p.text + " " + p.limitation);
    const allowed = new Set(numericTokens(evidenceText));
    if (numbers.some((n) => !allowed.has(n)))
      throw new Error("입력 근거에 없는 수치");
  }
  for (const g of charts.values()) {
    if (g.sourceIds.some((s) => !sources.has(s)))
      throw new Error("차트 출처 누락");
    for (const p of g.series.flatMap((s) => s.points)) {
      const o = obs.get(p.observationId);
      if (!o || o.unit !== g.unit || !g.sourceIds.includes(o.sourceId))
        throw new Error("차트 수치·단위·출처 불일치");
    }
  }
  if (c.draft.sections.some((s) => s.chartIds.some((g) => !charts.has(g))))
    throw new Error("차트 참조 누락");
  return c;
}
export function reducedContent(
  date: string,
  session: "pre" | "post",
  bundle: Bundle,
  sample: boolean,
  now: string,
): Content {
  return {
    schemaVersion: 1,
    marketScope: "us_market",
    date,
    session,
    sample,
    generatedAt: now,
    bundle,
    reduced: true,
    charts: [],
    draft: {
      title: "확인한 자료와 다음 확인점",
      summary: bundle.sources.length
        ? [
            {
              id: "limited",
              text: "일부 자료를 확보하지 못해 확인 가능한 범위만 제공합니다. 주된 촉매는 현재 자료만으로 특정하기 어렵습니다.",
              kind: "ai_inference",
              sourceIds: [bundle.sources[0].id],
              observationIds: [],
              eventIds: [],
              limitation: "수집된 자료 범위에 한정된 축소 브리핑입니다.",
            },
          ]
        : [],
      sections: [],
    },
  };
}
