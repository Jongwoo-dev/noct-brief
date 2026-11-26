import { z } from "zod";
import { nextTradingClose } from "./calendar";
import { ContentSchema, validateContent, type Draft } from "./contract";
import { formatMarketTime, formatSourcePublication } from "./report-time";
import { reviewIssues } from "./report-trial";

const trialRecord = z.object({
  visibility: z.literal("private"),
  content: ContentSchema,
  review: z.unknown().optional(),
  costs: z.array(z.object({ stage: z.string(), model: z.string() })).optional(),
});

type Claim = Draft["summary"][number];
type Point = { label: string; value: number };
type ReadingAssets = {
  css: string;
  shellCss: string;
  font: Buffer;
  fontLicense: string;
  logo: Buffer;
};

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function modelLabel(model: string) {
  const match = /^gpt-([\d.]+)-(astra|sol)$/.exec(model);
  return match
    ? `GPT-${match[1]} ${match[2] === "astra" ? "Astra" : "Sol"}`
    : model;
}

function reviewStatus({ content, review }: z.infer<typeof trialRecord>) {
  const incomplete = { label: "근거 검사 미완료", issues: [] };
  if (review === undefined) return incomplete;

  let issues: string[];
  try {
    validateContent(content, "private_trial");
    issues = reviewIssues(content.draft, content.bundle, review);
  } catch {
    return incomplete;
  }
  if (issues.length) return { label: "근거 검사 보완 필요", issues };
  return { label: "근거 검사 통과", issues };
}

const chartValue = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 20,
});
const changeValue = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 20,
  signDisplay: "always",
});
const axisValue = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function barChart(points: Point[], unit: string, alt: string) {
  const maximum = Math.max(...points.map(({ value }) => Math.abs(value)));
  const rise = Math.max(0, ...points.map(({ value }) => value));
  const maxWidth = Math.min(68, 25 / (rise / (maximum || 1)));
  const rows = points.map(({ label, value }) => {
    const negative = value < 0;
    const side = negative ? "right:25%" : "left:75%";
    const color = negative ? "var(--report-down)" : "var(--report-up)";
    const tone = negative ? "negative" : "positive";
    const width = ((Math.abs(value) / (maximum || 1)) * maxWidth).toFixed(2);
    const formatted =
      changeValue.format(value) + (unit === "%" ? "%" : ` ${unit}`);
    return `<li><span>${escapeHtml(label)}</span><span class="sector-track" aria-hidden="true"><i style="${side};width:${width}%;background:${color}"></i></span><b class="${tone}">${escapeHtml(formatted)}</b></li>`;
  });
  return `<ul class="sector-list" role="list" aria-label="${escapeHtml(alt)}">${rows.join("")}</ul>`;
}

function lineChart(points: Point[], unit: string, alt: string) {
  const values = points.map(({ value }) => value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const coords = points.map(({ label, value }, index) => ({
    label,
    x: (55 + (index * 480) / Math.max(1, points.length - 1)).toFixed(1),
    y: (20 + (100 * (high - value)) / Math.max(1, high - low)).toFixed(1),
  }));
  const path = coords.map(({ x, y }) => `${x},${y}`).join(" ");
  const labels = coords.map(
    ({ x, label }) =>
      `<text x="${x}" y="148" text-anchor="middle">${escapeHtml(label)}</text>`,
  );
  const cells = points.map(
    ({ label, value }) =>
      `<tr><th scope="row">${escapeHtml(label)}</th><td>${chartValue.format(value)} ${escapeHtml(unit)}</td></tr>`,
  );
  return `<svg class="line" viewBox="0 0 560 155" role="img" aria-label="${escapeHtml(alt)}"><text x="0" y="24">${axisValue.format(high)}</text><text x="0" y="123">${axisValue.format(low)}</text><polyline points="${path}" fill="none" stroke="#b5a9ef" stroke-width="3"/>${labels.join("")}</svg><details><summary>날짜별 종가 보기</summary><table><tbody>${cells.join("")}</tbody></table></details>`;
}

export function renderReportReading(input: unknown, assets: ReadingAssets) {
  const record = trialRecord.parse(input);
  const { content, costs } = record;
  const { bundle, charts, date, draft } = content;
  if (content.session !== "post" || content.sample)
    throw new Error("실제 장후 회차의 비공개 시험 JSON이 필요합니다.");

  const sources = new Map(bundle.sources.map((source) => [source.id, source]));
  const observations = new Map(bundle.observations.map((o) => [o.id, o]));
  const chartById = new Map(charts.map((chart) => [chart.id, chart]));
  const displayedCharts = new Set<string>();
  const upcoming = draft.sections.filter(
    (section) => section.id === "upcoming",
  );
  if (upcoming.length > 1) throw new Error("예정 이벤트 안내 구역 중복");

  function references(ids: string[]) {
    return ids
      .map((id) => {
        const source = sources.get(id);
        if (!source) throw new Error(`출처를 찾을 수 없습니다. (${id})`);
        const published = formatSourcePublication(
          source.publishedAt,
          source.publishedOriginalTime,
        );
        return `<a href="${escapeHtml(source.url)}" rel="noreferrer">${escapeHtml(source.publisher)} · ${escapeHtml(source.title)}</a> <small>게시 ${escapeHtml(published)}</small>`;
      })
      .join(" · ");
  }

  function claimEvidence({ limitation, sourceIds }: Claim) {
    const note = limitation
      ? `<p class="note">${escapeHtml(limitation)}</p>`
      : "";
    return `${note}<details><summary>근거 보기</summary>${references(sourceIds)}</details>`;
  }

  function claim(item: Claim) {
    return `<div class="claim"><p>${escapeHtml(item.text)}</p>${claimEvidence(item)}</div>`;
  }

  function eventItem(item: Claim) {
    const [heading, ...lines] = item.text.split("\n");
    const separator = heading.indexOf(" | ");
    if (separator <= 0 || separator + 3 === heading.length)
      return `<li>${claim(item)}</li>`;

    const time = escapeHtml(heading.slice(0, separator));
    const title = escapeHtml(heading.slice(separator + 3));
    const copy = lines.length
      ? `<p class="schedule-copy">${escapeHtml(lines.join("\n"))}</p>`
      : "";
    return `<li class="claim"><p class="schedule-time">${time}</p><h3>${title}</h3>${copy}${claimEvidence(item)}</li>`;
  }

  function chart(id: string) {
    if (displayedCharts.has(id)) return "";
    const item = chartById.get(id);
    if (!item) throw new Error(`차트를 찾을 수 없습니다. (${id})`);
    displayedCharts.add(id);
    const [series] = item.series; // The shared schema requires exactly one series.
    const points = series.points.map(({ label, observationId }) => {
      const observation = observations.get(observationId);
      if (!observation)
        throw new Error(`관측값을 찾을 수 없습니다. (${observationId})`);
      return { label, value: observation.value };
    });
    const visual =
      item.kind === "bar"
        ? barChart(points, item.unit, item.alt)
        : lineChart(points, item.unit, item.alt);
    return `<figure class="report-chart"><h3>${escapeHtml(item.title)}</h3><p class="unit">${escapeHtml(item.period)} · ${escapeHtml(item.basis)}</p>${visual}<details><summary>차트 출처</summary>${references(item.sourceIds)}</details></figure>`;
  }

  const model = costs?.find(({ stage }) => stage === "draft")?.model;
  const generator = model ? escapeHtml(modelLabel(model)) : "";
  const status = reviewStatus(record);
  const reviewNotes = status.issues.length
    ? `<details class="report-details"><summary>근거 검사 결과</summary>${status.issues.map((issue) => `<p>${escapeHtml(issue)}</p>`).join("")}</details>`
    : "";
  const cutoff = escapeHtml(formatMarketTime(bundle.cutoffAt));
  const close = nextTradingClose(date);
  const range = close
    ? `<p class="schedule-range">자료 마감 뒤부터 ${escapeHtml(formatMarketTime(close))}까지</p>`
    : "";
  const [schedule] = upcoming;
  const results = draft.sections
    .filter((section) => section.id !== "upcoming")
    .map(
      (section) =>
        `<section class="section"><h3 class="market-topic">${escapeHtml(section.title)}</h3>${section.claims.map(claim).join("")}${section.chartIds.map(chart).join("")}</section>`,
    );
  const events = schedule
    ? `<ul class="schedule" role="list">${schedule.claims.map(eventItem).join("")}</ul>${schedule.chartIds.map(chart).join("")}`
    : '<p class="section-copy">보고서에 수록된 예정 이벤트가 없습니다.</p>';
  const limits = [...bundle.missing, ...bundle.pendingCalls];
  const coverage = limits.length
    ? `<details class="report-details provenance"><summary>입력 자료의 확인 범위</summary>${limits.map((limit) => `<p>${escapeHtml(limit)}</p>`).join("")}</details>`
    : "";
  const shellCss = assets.shellCss.replace(
    "__PRETENDARD_WOFF2__",
    assets.font.toString("base64"),
  );
  const logo = assets.logo.toString("base64");
  const fontLicense = assets.fontLicense.replaceAll("-->", "--&gt;");
  const title = escapeHtml(draft.title);

  return [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`,
    `<title>${title} · ${generator ? `${generator} 장후판` : "NOCT Brief"}</title>`,
    `<!-- Pretendard\n${fontLicense}\n--><style>${assets.css}\n${shellCss}</style></head>`,
    `<body><main class="report-reading"><header class="report-masthead"><span class="mast"><img src="data:image/svg+xml;base64,${logo}" alt="">NOCT Brief</span><span>비공개 장후 브리핑 · ${escapeHtml(status.label)}</span></header>`,
    `<article class="reading-copy"><section class="hero"><p class="dateline">${generator ? `<strong>${generator}</strong>` : ""}미국 거래일 ${escapeHtml(date)} 장후</p><h1 class="report-title">${title}</h1><p class="cutoff">자료 마감 ${cutoff}<br>한국시간(KST)을 먼저 표시하고 확인된 원본 시각을 함께 제공합니다.</p>`,
    draft.summary.map(claim).join(""),
    reviewNotes,
    '</section><section aria-labelledby="market-results"><h2 class="group-title" id="market-results">장후 결과</h2>',
    ...results,
    `</section><section class="section"><h2 class="section-title">${escapeHtml(schedule?.title ?? "예정 이벤트 안내")}</h2>${range}${events}</section>`,
    coverage,
    "</article></main></body></html>",
  ].join("\n");
}
