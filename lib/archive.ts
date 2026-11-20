import type { PublicBriefing } from "./contract";

export type ArchiveEntry = {
  id: string;
  date: string;
  session: "pre" | "post";
  targetAt: string;
  publishedAt: string | null;
  correctedAt: string | null;
  title: string;
  missing: boolean;
};
export function archiveEntry(b: PublicBriefing): ArchiveEntry {
  return {
    id: b.id,
    date: b.content.date,
    session: b.content.session,
    targetAt: b.targetAt,
    publishedAt: b.publishedAt,
    correctedAt: b.correctedAt,
    title: b.content.draft.title,
    missing: b.content.bundle.missing.length > 0,
  };
}

export const ARCHIVE_DAYS_PER_PAGE = 6;

// Input contains public, filtered editions. A trading date stays on one page.
export function archivePage(rows: ArchiveEntry[], page = 1) {
  const grouped = new Map<string, ArchiveEntry[]>();
  for (const row of rows) {
    const date = row.date;
    grouped.set(date, [...(grouped.get(date) ?? []), row]);
  }
  const groups = [...grouped]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, briefings]) => ({
      date,
      briefings: briefings.sort((a, b) =>
        a.session === b.session ? 0 : a.session === "pre" ? -1 : 1,
      ),
    }));
  const start = (page - 1) * ARCHIVE_DAYS_PER_PAGE;
  return {
    days: groups.slice(start, start + ARCHIVE_DAYS_PER_PAGE),
    hasMore: groups.length > start + ARCHIVE_DAYS_PER_PAGE,
  };
}
