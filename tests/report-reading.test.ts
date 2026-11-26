import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Content } from "../lib/contract";
import { renderReportReading } from "../lib/report-reading";

const assets = {
  css: readFileSync(
    new URL("../templates/report-reading.css", import.meta.url),
    "utf8",
  ),
  shellCss: readFileSync(
    new URL("../templates/report-reading-standalone.css", import.meta.url),
    "utf8",
  ),
  font: Buffer.from("font"),
  fontLicense: "SIL OPEN FONT LICENSE",
  logo: Buffer.from("logo"),
};

const claim = {
  id: "test-claim",
  kind: "fact",
  text: '본문 <b>그대로</b> & "따옴표"',
  limitation: "자료 확인 <한계>",
  sourceIds: ["source"],
  observationIds: [],
  eventIds: [],
} as const;

function record() {
  const content: Content = {
    schemaVersion: 1,
    marketScope: "us_market",
    date: "2026-11-20",
    session: "post",
    sample: false,
    generatedAt: "2026-11-21T01:00:00Z",
    bundle: {
      cutoffAt: "2026-11-21T00:30:00Z",
      coverageStart: "2026-11-20T00:00:00Z",
      sources: [
        {
          id: "source",
          title: "자료 & 근거",
          publisher: "기관",
          url: "https://example.com/source?a=1&b=2",
          publishedAt: "2026-11-20T14:00:00Z",
          checkedAt: "2026-11-20T17:00:00Z",
          method: "official",
          rights: "private_only",
          excerpt: "시험 내용",
          retention: "시험용",
        },
      ],
      observations: [],
      events: [],
      missing: [],
      pendingCalls: [],
    },
    draft: {
      title: "제목 <원문>",
      summary: [
        {
          ...claim,
          sourceIds: [...claim.sourceIds],
          observationIds: [],
          eventIds: [],
        },
      ],
      sections: [],
    },
    charts: [],
    reduced: false,
  };
  return { visibility: "private", content };
}

describe("private report reading HTML", () => {
  it("preserves source text as escaped text and preserves citation targets", () => {
    const html = renderReportReading(record(), assets);
    expect(html).toContain('<h1 class="report-title">제목 &lt;원문&gt;</h1>');
    expect(html).toContain(
      "본문 &lt;b&gt;그대로&lt;/b&gt; &amp; &quot;따옴표&quot;",
    );
    expect(html).toContain('<p class="note">자료 확인 &lt;한계&gt;</p>');
    expect(html).toContain('<a href="https://example.com/source?a=1&amp;b=2"');
    expect(html).toContain("기관 · 자료 &amp; 근거</a>");
  });

  it("embeds the shared report CSS unchanged and confines inline assets to the standalone shell", () => {
    const html = renderReportReading(record(), assets);
    expect(assets.css.match(/^\S.*\{$/gm)).toEqual([".report-reading {"]);
    expect(assets.css).not.toMatch(
      /@font-face|data:font\/|__PRETENDARD_WOFF2__/,
    );
    expect(html).toContain(`<style>${assets.css}\n`);
    expect(html).toContain('<main class="report-reading">');
    expect(html).toContain("data:font/woff2;base64,Zm9udA==");
    expect(html).toContain("data:image/svg+xml;base64,bG9nbw==");
    expect(html).toContain("SIL OPEN FONT LICENSE");
    expect(html).not.toContain("__PRETENDARD_WOFF2__");
  });

  it("rejects an unsafe citation before rendering", () => {
    const input = record();
    input.content.bundle.sources[0].url = "javascript:void(0)";
    expect(() => renderReportReading(input, assets)).toThrow();
  });

  it("requires a complete set of supported findings to display a pass", () => {
    const input = record();
    const findings = ["title", "summary/0"].map((item) => ({
      item,
      verdict: "supported",
      sourceIds: ["source"],
      reason: "근거 일치",
    }));
    for (const review of [
      undefined,
      { findings: [] },
      { findings: findings.slice(1) },
    ]) {
      expect(renderReportReading({ ...input, review }, assets)).toContain(
        "근거 검사 미완료",
      );
    }
    expect(
      renderReportReading({ ...input, review: { findings } }, assets),
    ).toContain("근거 검사 통과");
    findings[1].verdict = "unsupported";
    expect(
      renderReportReading({ ...input, review: { findings } }, assets),
    ).toContain("근거 검사 보완 필요");
  });
});
