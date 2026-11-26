import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { samples } from "../data/samples";
import Briefing from "../app/briefings/[id]/page";
import { detail, neighbors } from "../lib/queries";

vi.mock("@/lib/queries", () => ({ detail: vi.fn(), neighbors: vi.fn() }));

const escape = (text: string) =>
  renderToStaticMarkup(createElement("span", null, text)).slice(6, -7);

beforeEach(() => {
  vi.mocked(neighbors).mockResolvedValue({ older: null, newer: null });
});

test.each(samples)(
  "keeps the contents and citation targets of $id",
  async (report) => {
    vi.mocked(detail).mockResolvedValue(report);
    const html = renderToStaticMarkup(
      await Briefing({ params: Promise.resolve({ id: report.id }) }),
    );
    expect(html).toContain(escape(report.content.draft.title));
    expect(html).toContain("가상 데이터");
    for (const claim of [
      ...report.content.draft.summary,
      ...report.content.draft.sections.flatMap((section) => section.claims),
    ]) {
      expect(html).toContain(escape(claim.text));
      if (claim.limitation) expect(html).toContain(escape(claim.limitation));
      for (const sourceId of claim.sourceIds) {
        expect(html).toContain(`href="#source-${sourceId}"`);
        expect(html).toContain(`id="source-${sourceId}"`);
      }
    }
    for (const chart of report.content.charts.filter((chart) =>
      report.content.draft.sections.some((section) =>
        section.chartIds.includes(chart.id),
      ),
    )) {
      expect(html).toContain(escape(chart.alt));
      expect(html).toContain(`${escape(chart.title)} 값 표`);
    }
    for (const missing of report.content.bundle.missing)
      expect(html).toContain(escape(missing));
    if (report.content.session === "pre")
      expect(html).not.toContain('id="market-results"');
  },
);

test("keeps multiline scheduled claims, corrections and adjacent published reports", async () => {
  const report = structuredClone(samples[0]);
  const claim = structuredClone(report.content.draft.summary[0]);
  claim.id = "scheduled-claim";
  claim.text =
    "2026-10-27 23:00 KST (2026-10-27 10:00 EDT) | 발표 일정\n확인할 내용과 주목할 이유";
  report.content.draft.sections.push({
    id: "upcoming",
    type: "outlook",
    title: "예정 안내",
    claims: [claim],
    chartIds: [],
  });
  report.corrections = [
    { at: report.publishedAt, change: "표시 정정", reason: "근거 대조" },
  ];
  vi.mocked(detail).mockResolvedValue(report);
  vi.mocked(neighbors).mockResolvedValue({ older: samples[1], newer: null });
  const html = renderToStaticMarkup(
    await Briefing({ params: Promise.resolve({ id: report.id }) }),
  );
  expect(html).toContain("2026-10-27 23:00 KST (2026-10-27 10:00 EDT)");
  expect(html).toContain("발표 일정");
  expect(html).toContain("확인할 내용과 주목할 이유");
  expect(html).toContain('role="list"');
  expect(html).toContain('id="corrections"');
  expect(html).toContain("표시 정정");
  expect(html).toContain("근거 대조");
  expect(html).toContain(`/briefings/${samples[1].id}`);
});

test("keeps a missed edition as a notice without inventing report content", async () => {
  const report = samples[0];
  vi.mocked(detail).mockResolvedValue({
    id: report.id,
    date: report.content.date,
    session: report.content.session,
    targetAt: report.targetAt,
  });
  const html = renderToStaticMarkup(
    await Briefing({ params: Promise.resolve({ id: report.id }) }),
  );
  expect(html).toContain("브리핑 미발행 안내");
  expect(html).toContain("발행 예정 시각");
  expect(html).not.toContain(escape(report.content.draft.title));
});
