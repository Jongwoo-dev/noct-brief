import type { PublicBriefing } from "./contract";

export const ARCHIVE_DAYS_PER_PAGE = 6;

// Input contains public, filtered editions. A trading date stays on one page.
export function archivePage(rows: PublicBriefing[], page = 1) {
  const grouped = new Map<string, PublicBriefing[]>();
  for (const row of rows) {
    const date = row.content.date;
    grouped.set(date, [...(grouped.get(date) ?? []), row]);
  }
  const groups = [...grouped]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, briefings]) => ({
      date,
      briefings: briefings.sort((a, b) =>
        a.content.session === b.content.session
          ? 0
          : a.content.session === "pre"
            ? -1
            : 1,
      ),
    }));
  const start = (page - 1) * ARCHIVE_DAYS_PER_PAGE;
  return {
    days: groups.slice(start, start + ARCHIVE_DAYS_PER_PAGE),
    hasMore: groups.length > start + ARCHIVE_DAYS_PER_PAGE,
  };
}
