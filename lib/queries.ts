import "server-only";
import { samples, SAMPLE_AS_OF } from "../data/samples";
import { readConfig } from "./config";
import { pool, assertDatabase } from "./db";
import { Repository } from "./repository";
import { archivePage, archiveEntry, ARCHIVE_DAYS_PER_PAGE } from "./archive";
export async function publicData() {
  const c = readConfig();
  if (c.DATA_MODE === "sample" && !c.DATABASE_URL)
    return {
      sample: true,
      now: new Date(SAMPLE_AS_OF),
      list: samples.slice(0, 1),
      delays: [] as {
        id: string;
        us_trading_date: string;
        session: "pre" | "post";
        target_at: Date;
        state: string;
      }[],
    };
  await assertDatabase(pool(), c.APP_ENV, c.DATA_MODE);
  const repo = new Repository(pool(), c.DATA_MODE);
  return {
    sample: c.DATA_MODE === "sample",
    now: new Date(),
    list: await repo.publicList({ limit: 1 }),
    delays: await repo.delays(new Date()),
  };
}
export async function archive(filter: {
  date?: string;
  session?: string;
  page: number;
  excludeId?: string;
}) {
  const c = readConfig();
  if (c.DATA_MODE === "sample" && !c.DATABASE_URL) {
    const rows = samples.filter(
      (b) =>
        b.id !== filter.excludeId &&
        (!filter.date || b.content.date === filter.date) &&
        (!filter.session || b.content.session === filter.session),
    );
    return archivePage(rows.map(archiveEntry), filter.page);
  }
  await assertDatabase(pool(), c.APP_ENV, c.DATA_MODE);
  const rows = await new Repository(pool(), c.DATA_MODE).publicArchive({
    date: filter.date,
    session: filter.session,
    excludeId: filter.excludeId,
    dateWindow: {
      limit: ARCHIVE_DAYS_PER_PAGE + 1,
      offset: (filter.page - 1) * ARCHIVE_DAYS_PER_PAGE,
    },
  });
  return archivePage(rows);
}
export async function neighbors(id: string, targetAt: string) {
  const c = readConfig();
  if (c.DATA_MODE === "sample" && !c.DATABASE_URL) {
    const index = samples.findIndex((b) => b.id === id);
    return {
      older: samples[index + 1] ?? null,
      newer: index > 0 ? samples[index - 1] : null,
    };
  }
  await assertDatabase(pool(), c.APP_ENV, c.DATA_MODE);
  const db = pool(),
    repo = new Repository(db, c.DATA_MODE);
  const older = (
    await db.query(
      "SELECT id FROM briefings WHERE visible AND current_version_id IS NOT NULL AND target_at<$1 ORDER BY target_at DESC LIMIT 1",
      [targetAt],
    )
  ).rows[0]?.id;
  const newer = (
    await db.query(
      "SELECT id FROM briefings WHERE visible AND current_version_id IS NOT NULL AND target_at>$1 ORDER BY target_at ASC LIMIT 1",
      [targetAt],
    )
  ).rows[0]?.id;
  return {
    older: older ? await repo.publicDetail(older) : null,
    newer: newer ? await repo.publicDetail(newer) : null,
  };
}
export async function detail(id: string) {
  const c = readConfig();
  if (c.DATA_MODE === "sample" && !c.DATABASE_URL)
    return samples.find((b) => b.id === id) ?? null;
  await assertDatabase(pool(), c.APP_ENV, c.DATA_MODE);
  const repo = new Repository(pool(), c.DATA_MODE);
  return (await repo.publicDetail(id)) ?? repo.missedDetail(id);
}
