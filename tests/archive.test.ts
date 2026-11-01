import { describe, expect, it } from "vitest";
import { archivePage } from "../lib/archive";
import { samples } from "../data/samples";

function editions() {
  return [16, 17, 18, 19, 20, 23, 24].flatMap((day, i) =>
    (["post", "pre"] as const).map((session) => ({
      ...samples[0],
      id: `day-${i}-${session}`,
      content: {
        ...samples[0].content,
        date: `2026-11-${day}`,
        session,
      },
    })),
  );
}

describe("거래일별 아카이브", () => {
  it("최신 거래일부터 묶고 같은 날은 장전→장후로 읽는다", () => {
    const result = archivePage(editions().reverse());
    expect(result.days.map((d) => d.date)).toEqual([
      "2026-11-24",
      "2026-11-23",
      "2026-11-20",
      "2026-11-19",
      "2026-11-18",
      "2026-11-17",
    ]);
    expect(
      result.days.every(
        (d) => d.briefings.map((b) => b.content.session).join() === "pre,post",
      ),
    ).toBe(true);
  });
  it("페이지 경계에서 같은 날짜의 두 회차를 나누거나 중복하지 않는다", () => {
    const rows = editions();
    const first = archivePage(rows),
      second = archivePage(rows, 2);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect(second.days).toHaveLength(1);
    const ids = [...first.days, ...second.days].flatMap((d) =>
      d.briefings.map((b) => b.id),
    );
    expect(ids).toHaveLength(rows.length);
    expect(new Set(ids).size).toBe(rows.length);
  });
  it("한 세션이나 일부 회차만 있어도 가짜 항목을 만들지 않는다", () => {
    const rows = editions().filter((b) => b.content.session === "pre");
    const result = archivePage(rows);
    expect(result.days).toHaveLength(6);
    expect(result.days.every((d) => d.briefings.length === 1)).toBe(true);
    expect(result.hasMore).toBe(true);
  });
  it("빈 결과와 마지막 페이지 다음을 빈 목록으로 표시한다", () => {
    expect(archivePage([])).toEqual({ days: [], hasMore: false });
    expect(archivePage(editions(), 3)).toEqual({ days: [], hasMore: false });
  });
});
