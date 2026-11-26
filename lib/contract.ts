import { z } from "zod";
import {
  kstDate,
  marketSessionBounds,
  marketSessionLabel,
  nextTradingClose,
} from "./calendar";
import {
  evidenceTimeUpperBound,
  formatSourceTime,
  isDateOnly,
  matchesOriginalTime,
  pairedTimePolicy,
  type EvidenceTimeRole,
  type OriginalTime,
} from "./report-time";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const time = z.iso.datetime({ offset: true });
const dateOrTime = z.union([time, z.iso.date()]);
const text = z.string().min(1).max(4000);
const originalTime = z.object({
  timestamp: z.string().max(75),
  zone: z.string().max(100).optional(),
});
const invalidOriginalTime =
  "원문 표기와 자료 시각이 일치하지 않거나 시간대를 확인할 수 없습니다.";
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
const source = z
  .object({
    id,
    title: text,
    publisher: text,
    url: z.string().refine(safeUrl),
    publishedAt: dateOrTime,
    checkedAt: time,
    version: z
      .object({
        availableAt: dateOrTime,
        evidenceUrl: z.string().refine(safeUrl),
      })
      .optional(),
    method: z.enum(["official", "licensed", "sample", "web"]),
    rights: z.enum(["approved", "sample", "unverified", "private_only"]),
    excerpt: z.string().max(2000),
    retention: text,
    publishedOriginalTime: originalTime.optional(),
  })
  .refine(
    (s) =>
      !s.publishedOriginalTime ||
      matchesOriginalTime(s.publishedAt, s.publishedOriginalTime),
    {
      message: invalidOriginalTime,
      path: ["publishedOriginalTime"],
    },
  );
const observation = z
  .object({
    id,
    sourceId: id,
    name: text,
    kind: z.enum([
      "index",
      "etf",
      "stock",
      "future",
      "yield",
      "sector",
      "economic",
    ]),
    symbol: text,
    value: z.number(),
    unit: text,
    currency: z.string(),
    period: text,
    observedAt: time,
    comparison: text,
    observedOriginalTime: originalTime.optional(),
  })
  .refine(
    (o) =>
      !o.observedOriginalTime ||
      matchesOriginalTime(o.observedAt, o.observedOriginalTime),
    {
      message: invalidOriginalTime,
      path: ["observedOriginalTime"],
    },
  );
const event = z
  .object({
    id,
    sourceId: id,
    title: text,
    scheduledAt: time.nullable(),
    occurredAt: time.nullable(),
    firstObservedAt: dateOrTime,
    status: z.enum(["scheduled", "released", "postponed", "unconfirmed"]),
    result: z.string(),
    watch: z.string(),
    scheduledWindow: z
      .object({
        date: z.iso.date(),
        session: z.enum(["pre", "regular", "post"]),
      })
      .optional(),
    scheduledOriginalTime: originalTime.optional(),
    occurredOriginalTime: originalTime.optional(),
  })
  .refine((e) => (e.scheduledAt === null) === !!e.scheduledWindow, {
    message: "정확한 예정 시각 또는 확인된 거래일·세션 범위가 필요합니다.",
  })
  .refine(
    (e) =>
      !e.scheduledOriginalTime ||
      matchesOriginalTime(e.scheduledAt, e.scheduledOriginalTime),
    {
      message: invalidOriginalTime,
      path: ["scheduledOriginalTime"],
    },
  )
  .refine(
    (e) =>
      !e.occurredOriginalTime ||
      matchesOriginalTime(e.occurredAt, e.occurredOriginalTime),
    {
      message: invalidOriginalTime,
      path: ["occurredOriginalTime"],
    },
  );
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
export function upcomingEvents(date: string, bundle: Bundle) {
  const close = nextTradingClose(date);
  const events: Bundle["events"] = [];
  if (!close) return { events, calendarKnown: false, uncertain: false };
  const cutoff = Date.parse(bundle.cutoffAt);
  const end = Date.parse(close);
  const selected: { event: Bundle["events"][number]; at: number }[] = [];
  let uncertain = false;
  for (const event of bundle.events) {
    if (
      event.status !== "scheduled" ||
      event.occurredAt ||
      evidenceTimeUpperBound(event.firstObservedAt) > cutoff
    )
      continue;
    if (event.scheduledAt) {
      const at = Date.parse(event.scheduledAt);
      if (at > cutoff && at <= end) selected.push({ event, at });
      continue;
    }
    const window = event.scheduledWindow;
    const bounds = window && marketSessionBounds(window.date, window.session);
    if (!bounds) {
      uncertain = true;
      continue;
    }
    if (bounds.end <= cutoff || bounds.start >= end) continue;
    if (bounds.start > cutoff && bounds.end <= end)
      selected.push({ event, at: bounds.start });
    else uncertain = true;
  }
  selected.sort((a, b) => a.at - b.at);
  return {
    events: selected.map(({ event }) => event),
    calendarKnown: true,
    uncertain,
  };
}
export function eventTimeLabel(event: Bundle["events"][number]) {
  if (event.scheduledAt)
    return formatSourceTime(
      event.scheduledAt,
      event.scheduledOriginalTime,
      "예정",
    );
  const window = event.scheduledWindow;
  if (!window) return "예정 시각 미확인";
  const eastern = `미국 동부 ${window.date} ${marketSessionLabel(window.session)}`;
  const bounds = marketSessionBounds(window.date, window.session);
  if (!bounds) return `한국 날짜 미확인 (원문 ${eastern})`;
  const start = kstDate(bounds.start);
  const end = kstDate(bounds.end - 1);
  return `${start === end ? start : `${start}~${end}`} KST (원문 ${eastern})`;
}
type TimeReference = {
  role: EvidenceTimeRole;
  sourceId: string;
  observationId?: string;
  eventId?: string;
  text: string;
};
export function evidenceTimeReferences(bundle: Bundle) {
  const references: TimeReference[] = [];
  function add(
    recorded: string | null,
    original: OriginalTime | undefined,
    role: EvidenceTimeRole,
    ids: Omit<TimeReference, "text" | "role">,
  ) {
    if (!recorded) return;
    const text = formatSourceTime(recorded, original, role);
    if (text !== "시각 미확인" && text !== "원문 시각 불일치")
      references.push({ ...ids, role, text });
  }
  for (const s of bundle.sources)
    add(s.publishedAt, s.publishedOriginalTime, "게시", { sourceId: s.id });
  for (const o of bundle.observations)
    add(o.observedAt, o.observedOriginalTime, "관측", {
      sourceId: o.sourceId,
      observationId: o.id,
    });
  for (const e of bundle.events) {
    const ids = { sourceId: e.sourceId, eventId: e.id };
    add(e.scheduledAt, e.scheduledOriginalTime, "예정", ids);
    add(e.occurredAt, e.occurredOriginalTime, "발생", ids);
  }
  return references;
}
export function hasPrivateResearch(bundle: Bundle) {
  return bundle.sources.some(
    (source) => source.rights === "private_only" || source.method === "web",
  );
}

export function hasDateOnlyEvidence(bundle: Bundle) {
  return (
    bundle.sources.some(
      (source) =>
        isDateOnly(source.publishedAt) ||
        (source.version && isDateOnly(source.version.availableAt)),
    ) || bundle.events.some((event) => isDateOnly(event.firstObservedAt))
  );
}
// checkedAt is when we actually read the excerpt. A later read needs evidence
// for the specific version supplied, even if the article was first published earlier.
export function assertEvidenceAsOf(
  bundle: Bundle,
  now: Date,
  correctionEvidenceUrl?: string,
) {
  const cutoff = Date.parse(bundle.cutoffAt);
  if (Date.parse(bundle.coverageStart) > cutoff || cutoff > now.getTime())
    throw new Error("자료 기준 시각 불일치");
  for (const source of bundle.sources) {
    const published = evidenceTimeUpperBound(source.publishedAt);
    const checked = Date.parse(source.checkedAt);
    const available = source.version
      ? evidenceTimeUpperBound(source.version.availableAt)
      : checked;
    if (published > available || available > checked || checked > now.getTime())
      throw new Error(`출처 게시·확인 시각 불일치: ${source.id}`);
    if (available <= cutoff) continue;
    if (source.url !== correctionEvidenceUrl)
      throw new Error(
        `자료 기준 시각까지 공개된 판본의 근거가 필요합니다: ${source.id}`,
      );
    if (
      bundle.sources.filter((s) => s.url === correctionEvidenceUrl).length !==
        1 ||
      bundle.observations.some((o) => o.sourceId === source.id) ||
      bundle.events.some((e) => e.sourceId === source.id) ||
      bundle.charts?.some((c) => c.sourceIds.includes(source.id))
    )
      throw new Error("사후 정정 근거는 당시 관측 자료와 분리해야 합니다.");
  }
  if (bundle.observations.some((o) => Date.parse(o.observedAt) > cutoff))
    throw new Error("자료 기준 시각 이후 관측값");
  if (
    bundle.events.some(
      (e) =>
        evidenceTimeUpperBound(e.firstObservedAt) > cutoff ||
        (e.occurredAt && Date.parse(e.occurredAt) > cutoff) ||
        (e.status === "released" && !e.occurredAt),
    )
  )
    throw new Error("자료 기준 시각 이후 또는 미확인 사건");
}
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
export function isUpcomingSection(
  section: Draft["sections"][number],
  eventIds: ReadonlySet<string>,
) {
  return (
    !section.chartIds.length &&
    section.claims.length > 0 &&
    section.claims.every(
      (claim) =>
        !claim.observationIds.length &&
        claim.eventIds.length > 0 &&
        claim.eventIds.every((id) => eventIds.has(id)),
    )
  );
}

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
  timePolicy: z.literal(pairedTimePolicy).optional(),
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
const englishMonths = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function normalizeCitedMonths(claim: string, evidence: string) {
  // A translated calendar month can match a dated English source, never a quantity.
  return claim.replace(/(?<![\d.,+-])([1-9]|1[0-2])월/g, (original, month) => {
    const name = englishMonths[Number(month) - 1];
    return new RegExp(`\\b${name}\\s+\\d{4}\\b`, "i").test(evidence)
      ? name
      : original;
  });
}

// "14.01% 하락" is also written "-14.01%". A magnitude with no direction,
// a rise, or a percentage-point change does not support that conversion.
function normalizeCitedLosses(claim: string, evidence: string) {
  const losses = new Set(
    Array.from(
      evidence.matchAll(/(?<![\d.,+\-])(\d+(?:\.\d+)?)%\s*하락/g),
      (match) => match[1],
    ),
  );
  return claim.replace(
    /(?<![\d.,+\-])-(\d+(?:\.\d+)?)%(?!\s*(?:포인트|p\b))/gi,
    (original, magnitude: string) =>
      losses.has(magnitude) ? magnitude + "%" : original,
  );
}

// Recognize other zone labels as distinct keys without converting between zones.
const clockZone =
  String.raw`(?:(?:미(?:국)?\s*)?(?:동부|서부|중부|산악)\s*(?:시간|표준시)|(?:한국|일본|중국|유럽)\s*(?:시간|표준시)|` +
  String.raw`(?<![A-Za-z])(?:(?:UTC|GMT)(?:\s*[+-]\s*\d{1,2}(?::?\d{2})?)?|[A-Z]{1,3}T)(?![A-Za-z]))`;
const clockTime = new RegExp(
  String.raw`(?<![\d:])(?:\(?\s*(${clockZone})\)?(?:\s*기준)?(?:으로|로)?\s*)?` +
    String.raw`(?:(오전|오후)\s*)?([01]?\d|2[0-3])(?::([0-5]\d)(?![\d:])|\s*시\s*([0-5]?\d)\s*분(?!간))` +
    String.raw`(?:\s*\(?\s*(${clockZone})\)?)?`,
  "g",
);

function clockZoneKey(label: string) {
  const zone = label.replace(/\s/g, "");
  if (zone.startsWith("한국")) return "KST";
  if (zone.endsWith("동부시간")) return "ET";
  if (zone.endsWith("동부표준시")) return "EST";
  return zone;
}

function separateClockTimes(text: string) {
  const times: (string | null)[] = [];
  const otherText = text.replace(
    clockTime,
    (_original, prefix, period, hours, colonMinutes, koreanMinutes, suffix) => {
      const hour = Number(hours);
      if (
        (period && (hour < 1 || hour > 12)) ||
        (prefix && suffix && clockZoneKey(prefix) !== clockZoneKey(suffix))
      ) {
        times.push(null);
      } else {
        // Unlabelled times in the US market report use market time.
        const zone = clockZoneKey(prefix ?? suffix ?? "ET");
        const hour24 = period
          ? (hour % 12) + (period === "오후" ? 12 : 0)
          : hour;
        times.push(
          [zone, hour24, Number(colonMinutes ?? koreanMinutes)].join(":"),
        );
      }
      return " ";
    },
  );
  return { times, otherText };
}

const pairedClock =
  /(?<![\d-])\d{4}-\d{2}-\d{2} \d{2}:\d{2} KST \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} [^()\r\n]+\)/g;
const pairMarker =
  /\bKST\s*[(（]\s*\d{4}[-./]|[(（]\s*(?:게시|관측|예정|발생)\s+(?:원문|원본|자료)|[(（]\s*원(?:문|본)\s+\d/u;
const bareClock =
  /(?<![\d:])\d{1,2}:\d{2}|(?<!\d)\d{1,2}\s*시(?=\s|[\d에경은이부까점전후.,()[\]（）]|$)|(?<!\d)(?:1[0-2]|0?[1-9])(?:\.\d{2})?\s*[ap]\.?\s*m\.?(?![a-z])|(?:오전|오후)\s*(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두)\s*시|(?:정오|자정)(?=\s|[에경은이부까전후.,()（）]|$)|\b(?:noon|midnight)\b/iu;
type TimeScope = Pick<
  z.infer<typeof claim>,
  "sourceIds" | "eventIds" | "observationIds"
>;
function timeScope(claims: TimeScope[]): TimeScope {
  return {
    sourceIds: claims.flatMap((item) => item.sourceIds),
    observationIds: claims.flatMap((item) => item.observationIds),
    eventIds: claims.flatMap((item) => item.eventIds),
  };
}

export class TimedTextError extends Error {
  readonly detail: string;

  constructor(message: string, field: string, phrase: string) {
    super(message);
    this.detail = `${field}에 있는 “${phrase}”. ${message}`;
  }
}

function removeSupportedClockPairs(
  value: string,
  scope: TimeScope,
  references: TimeReference[],
  requirePairs: boolean,
  field: string,
) {
  const remaining = value.replace(pairedClock, (pair) => {
    const supported = references.some(
      (ref) =>
        ref.text === pair &&
        scope.sourceIds.includes(ref.sourceId) &&
        (!ref.observationId ||
          scope.observationIds.includes(ref.observationId)) &&
        (!ref.eventId || scope.eventIds.includes(ref.eventId)),
    );
    if (!supported)
      throw new TimedTextError(
        "한국시간·원문 병기의 날짜·시간대·연결 근거 불일치",
        field,
        pair,
      );
    return " ";
  });
  const formatError = "한국시간·원문 병기의 표기 형식 또는 근거를 확인하세요.";
  const marker = pairMarker.exec(remaining);
  if (marker) {
    const prefix =
      remaining
        .slice(0, marker.index)
        .match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*(?:KST\s*)?$/)?.[0] ?? "";
    const suffix =
      remaining
        .slice(marker.index + marker[0].length)
        .match(/^[^)\r\n]*\)/)?.[0] ?? "";
    throw new TimedTextError(formatError, field, prefix + marker[0] + suffix);
  }
  if (!requirePairs) return remaining;
  const bare = bareClock.exec(remaining);
  if (bare) {
    const qualifier =
      remaining
        .slice(bare.index + bare[0].length)
        .match(/^[ \t]*(?:무렵|전후|쯤|경)(?=[\s에은을,.!?)]|$)/u)?.[0] ?? "";
    throw new TimedTextError(formatError, field, bare[0] + qualifier);
  }
  const loose = remaining.match(clockTime)?.[0];
  if (loose) throw new TimedTextError(formatError, field, loose.trim());
  return remaining;
}

export function validateContent(
  input: unknown,
  mode: "sample" | "live" | "private_trial",
): Content {
  const c = ContentSchema.parse(input);
  const requirePairedTimes = c.timePolicy === pairedTimePolicy;
  const timeReferences = evidenceTimeReferences(c.bundle);
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
  if (mode !== "private_trial" && hasDateOnlyEvidence(c.bundle))
    throw new Error(
      "날짜만 확인된 근거는 비공개 시험에서만 사용할 수 있습니다.",
    );
  if (mode !== "private_trial" && hasPrivateResearch(c.bundle))
    throw new Error("공개 권한 미확인: 비공개 품질 시험 자료");
  for (const s of sources.values()) {
    if (mode === "live" && (s.rights !== "approved" || s.method === "sample"))
      throw new Error("공개 권한 미확인");
    if (
      mode === "private_trial" &&
      (s.method === "sample" ||
        !["approved", "private_only"].includes(s.rights))
    )
      throw new Error("비공개 시험 자료 범위 미확인");
  }
  if (
    c.bundle.sources.some(
      (s) =>
        Date.parse(s.checkedAt) > Date.parse(c.generatedAt) ||
        evidenceTimeUpperBound(s.publishedAt) > Date.parse(s.checkedAt),
    )
  )
    throw new Error("출처 확인 시각 불일치");
  for (const o of obs.values())
    if (
      !sources.has(o.sourceId) ||
      Date.parse(o.observedAt) > Date.parse(c.bundle.cutoffAt)
    )
      throw new Error("수치 출처·시점 불일치");
  for (const e of events.values()) {
    if (
      !sources.has(e.sourceId) ||
      evidenceTimeUpperBound(e.firstObservedAt) >
        Date.parse(c.bundle.cutoffAt) ||
      (e.occurredAt &&
        Date.parse(e.occurredAt) > Date.parse(c.bundle.cutoffAt)) ||
      (e.status === "released" && !e.occurredAt)
    )
      throw new Error("사건 시점 불일치");
    const scope = {
      sourceIds: [e.sourceId],
      eventIds: [e.id],
      observationIds: [],
    };
    for (const field of ["title", "result", "watch"] as const)
      removeSupportedClockPairs(
        e[field],
        scope,
        timeReferences,
        requirePairedTimes,
        `사건 ${e.id}.${field}`,
      );
  }
  const claims = [
    ...c.draft.summary,
    ...c.draft.sections.flatMap((s) => s.claims),
  ];
  for (const p of claims) {
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
    const citedExcerpts = p.sourceIds.map((s) =>
      separateClockTimes(sources.get(s)!.excerpt),
    );
    const allowedTimes = new Set(citedExcerpts.flatMap(({ times }) => times));
    const claimParts = (["text", "limitation"] as const).map((field) =>
      separateClockTimes(
        removeSupportedClockPairs(
          p[field],
          p,
          timeReferences,
          requirePairedTimes,
          `주장 ${p.id}.${field}`,
        ),
      ),
    );
    if (
      claimParts.some(({ times }) =>
        times.some((time) => time === null || !allowedTimes.has(time)),
      )
    )
      throw new Error("입력 근거에 없는 수치");
    // Clock components cannot back a quantity, or borrow digits from one.
    const evidenceText =
      citedExcerpts.map(({ otherText }) => otherText).join(" ") +
      " " +
      p.observationIds.map((o) => String(obs.get(o)!.value)).join(" ");
    const numericTokens = (value: string) =>
      (value.match(/[-+]?\d+(?:[.,]\d+)*/g) ?? []).map((n) =>
        n.replace(/^\+/, "").replaceAll(",", ""),
      );
    const numbers = numericTokens(
      normalizeCitedLosses(
        normalizeCitedMonths(
          claimParts.map(({ otherText }) => otherText).join(" "),
          evidenceText,
        ),
        evidenceText,
      ),
    );
    const allowed = new Set(numericTokens(evidenceText));
    if (numbers.some((n) => !allowed.has(n)))
      throw new Error("입력 근거에 없는 수치");
  }
  removeSupportedClockPairs(
    c.draft.title,
    timeScope(claims),
    timeReferences,
    requirePairedTimes,
    "보고서 제목",
  );
  for (const section of c.draft.sections)
    removeSupportedClockPairs(
      section.title,
      timeScope(section.claims),
      timeReferences,
      requirePairedTimes,
      `본문 ${section.id}.title`,
    );
  for (const g of charts.values()) {
    if (g.sourceIds.some((s) => !sources.has(s)))
      throw new Error("차트 출처 누락");
    const chartPoints = g.series.flatMap((s) => s.points);
    const scope: TimeScope = {
      sourceIds: g.sourceIds,
      observationIds: chartPoints.map((p) => p.observationId),
      eventIds: [],
    };
    for (const field of ["title", "period", "basis", "alt"] as const)
      removeSupportedClockPairs(
        g[field],
        scope,
        timeReferences,
        requirePairedTimes,
        `차트 ${g.id}.${field}`,
      );
    for (const p of chartPoints) {
      const o = obs.get(p.observationId);
      if (!o || o.unit !== g.unit || !g.sourceIds.includes(o.sourceId))
        throw new Error("차트 수치·단위·출처 불일치");
      removeSupportedClockPairs(
        p.label,
        { ...scope, observationIds: [p.observationId] },
        timeReferences,
        requirePairedTimes,
        `차트 ${g.id}의 ${p.observationId}.label`,
      );
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
  timePolicy?: Content["timePolicy"],
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
    ...(timePolicy ? { timePolicy } : {}),
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
