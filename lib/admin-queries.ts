import type pg from "pg";
import type {
  AdminEdition,
  AdminFilter,
  AdminJob,
  AdminVersion,
  AdminNotice,
} from "./admin";

const editionQuery = `SELECT b.id,b.us_trading_date::text AS date,b.session,b.target_at,b.published_at,b.missed_at,b.visible,
  b.current_version_id AS version,v.content->'draft'->>'title' AS title,
  (SELECT count(*)::int FROM briefing_versions WHERE briefing_id=b.id) AS version_count,
  j.id AS job_id,j.kind,j.state,j.attempt,j.error_code,j.created_at,j.next_at,
  j.payload->>'baseVersion' AS base_version,j.payload->'bundle'->>'cutoffAt' AS cutoff_at,
  j.payload->'bundle'->'missing' AS missing,j.config->>'model' AS model,j.payload->'usage' AS usage
  FROM briefings b LEFT JOIN briefing_versions v ON v.id=b.current_version_id
  LEFT JOIN LATERAL (SELECT * FROM jobs WHERE briefing_id=b.id ORDER BY created_at DESC,id DESC LIMIT 1) j ON true`;
type Row = Record<string, any>;
function job(row: Row): AdminJob | null {
  if (!row.job_id) return null;
  return {
    id: row.job_id,
    kind: row.kind,
    state: row.state,
    attempt: row.attempt,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
    nextAt: row.next_at.toISOString(),
    baseVersion: row.base_version ?? null,
    cutoffAt: row.cutoff_at ?? null,
    missing: row.missing ?? [],
    model: row.model ?? "미설정",
    usage: row.usage ?? null,
  };
}
function edition(row: Row): AdminEdition {
  return {
    id: row.id,
    date: row.date,
    session: row.session,
    targetAt: row.target_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
    missedAt: row.missed_at?.toISOString() ?? null,
    visible: row.visible,
    version: row.version ?? "",
    title: row.missed_at ? "브리핑 미발행 안내" : row.title,
    versionCount: row.version_count,
    job: job(row),
  };
}
export async function adminOverview(
  db: pg.Pool,
  filter: AdminFilter,
  date: string,
  page: number,
) {
  const where = `WHERE ($1::date IS NULL OR b.us_trading_date=$1::date) AND
    ($2='all' OR ($2='attention' AND j.state='failed') OR
    ($2='progress' AND j.state NOT IN ('failed','published')) OR ($2='stored' AND b.current_version_id IS NOT NULL))`;
  const [rows, count, summary, last, notices] = await Promise.all([
    db.query(
      `${editionQuery} ${where} ORDER BY b.target_at DESC,b.id LIMIT 20 OFFSET $3`,
      [date || null, filter, (page - 1) * 20],
    ),
    db.query(
      `SELECT count(*)::int AS total FROM (${editionQuery} ${where}) result`,
      [date || null, filter],
    ),
    db.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE state='failed')::int AS attention,
      count(*) FILTER (WHERE state NOT IN ('failed','published'))::int AS progress,
      count(*) FILTER (WHERE version IS NOT NULL)::int AS stored FROM (${editionQuery}) result`),
    db.query("SELECT value FROM app_settings WHERE key='last_scheduler'"),
    db.query(
      "SELECT briefing_id,kind,status,attempts FROM notification_outbox ORDER BY next_at DESC LIMIT 20",
    ),
  ]);
  return {
    editions: rows.rows.map(edition),
    total: count.rows[0].total as number,
    counts: summary.rows[0] as {
      total: number;
      attention: number;
      progress: number;
      stored: number;
    },
    lastScheduler: (last.rows[0]?.value as string) ?? null,
    notices: notices.rows as AdminNotice[],
  };
}
export type VersionInfo = Omit<AdminVersion, "content">;
export async function adminDetail(db: pg.Pool, id: string, version?: string) {
  const result = await db.query(`${editionQuery} WHERE b.id=$1`, [id]);
  if (!result.rowCount) return null;
  const b = edition(result.rows[0]);
  const [history, selected, jobs] = await Promise.all([
    db.query(
      "SELECT id,created_at,reason,change FROM briefing_versions WHERE briefing_id=$1 ORDER BY created_at DESC,id DESC",
      [id],
    ),
    db.query(
      "SELECT id,created_at,reason,change,content FROM briefing_versions WHERE briefing_id=$1 AND id::text=$2",
      [id, version ?? b.version],
    ),
    db.query(
      `SELECT id AS job_id,kind,state,attempt,error_code,created_at,next_at,payload->>'baseVersion' AS base_version,
      payload->'bundle'->>'cutoffAt' AS cutoff_at,payload->'bundle'->'missing' AS missing,config->>'model' AS model,payload->'usage' AS usage
      FROM jobs WHERE briefing_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30`,
      [id],
    ),
  ]);
  const info = (r: Row): VersionInfo => ({
    id: r.id,
    createdAt: r.created_at.toISOString(),
    reason: r.reason,
    change: r.change,
  });
  return {
    edition: b,
    versions: history.rows.map(info),
    selected: selected.rows[0]
      ? ({
          ...info(selected.rows[0]),
          content: selected.rows[0].content,
        } as AdminVersion)
      : null,
    jobs: jobs.rows.map((r) => job(r)!),
  };
}
