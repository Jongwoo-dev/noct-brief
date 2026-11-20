import { randomUUID } from "node:crypto";
import type pg from "pg";
import { transaction } from "./db";
import {
  validateContent,
  type Bundle,
  type Content,
  type PublicBriefing,
} from "./contract";
import { latestDueSlot, schedule, type Session } from "./calendar";
import type { ArchiveEntry } from "./archive";
export type JobState =
  | "queued"
  | "collecting"
  | "submitting"
  | "generating"
  | "validating"
  | "ready"
  | "waiting_data"
  | "retry_wait"
  | "failed"
  | "published";
export type Job = {
  id: string;
  briefing_id: string;
  kind: "initial" | "correction";
  state: JobState;
  stage: string;
  attempt: number;
  fence: number;
  owner: string;
  next_at: Date;
  payload: {
    bundle?: Bundle;
    content?: Content;
    responseId?: string;
    baseVersion?: string;
    reason?: string;
    change?: string;
    evidenceUrl?: string;
    issue?: string;
    repairCount?: number;
    usage?: unknown;
  };
  config: {
    mode: "sample" | "live";
    model: string;
    promptVersion: string;
    reasoning: string;
    maxOutputTokens: number;
  };
  target_at: Date;
  us_trading_date: string;
  session: "pre" | "post";
};
export class Repository {
  constructor(
    public db: pg.Pool,
    public mode: "sample" | "live",
  ) {}
  async ensureSlot(date: string, session: "pre" | "post") {
    const s = schedule(date, session);
    await this.db.query(
      "INSERT INTO briefings(id,us_trading_date,session,target_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [s.id, date, session, s.targetAt],
    );
    return s;
  }
  async enqueue(
    date: string,
    session: "pre" | "post",
    config: Job["config"],
    now: Date,
  ) {
    const s = await this.ensureSlot(date, session);
    await this.db.query(
      `INSERT INTO jobs(id,briefing_id,kind,dedupe_key,state,next_at,config,created_at)
       SELECT $1,id,'initial',id,'queued',$3,$4,$3 FROM briefings
       WHERE id=$2 AND current_version_id IS NULL AND missed_at IS NULL ON CONFLICT DO NOTHING`,
      [randomUUID(), s.id, now, config],
    );
  }
  async reconcileSchedule(
    slots: ReturnType<typeof schedule>[],
    config: Job["config"],
    now: Date,
  ) {
    await transaction(this.db, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(710029)");
      await tx.query(
        `INSERT INTO briefings(id,us_trading_date,session,target_at)
        SELECT id,date,session,"targetAt" FROM jsonb_to_recordset($1::jsonb)
          AS s(id text,date date,session text,"targetAt" timestamptz)
        ON CONFLICT DO NOTHING`,
        [JSON.stringify(slots)],
      );
      await tx.query(
        `INSERT INTO jobs(id,briefing_id,kind,dedupe_key,state,next_at,config,created_at)
        SELECT gen_random_uuid(),id,'initial',id,'queued',$2,$3,$2 FROM briefings
        WHERE (id=ANY($1::text[]) OR target_at <= $2) AND current_version_id IS NULL AND missed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key=briefings.id)
        ON CONFLICT DO NOTHING`,
        [slots.map((s) => s.id), now, config],
      );
      // Calendar time determines the cutoff even when a due briefing has no DB row.
      const closed = await tx.query(
        `WITH superseded AS (
          UPDATE jobs j SET state='failed', error_code=CASE WHEN j.state='submitting' THEN 'SUBMISSION_UNKNOWN'
            ELSE coalesce(j.error_code,'EDITION_SUPERSEDED') END, owner=NULL,lease_until=NULL,fence=fence+1
          FROM briefings b WHERE b.id=j.briefing_id AND j.kind='initial' AND j.state<>'published' AND b.current_version_id IS NULL
            AND b.missed_at IS NULL AND b.target_at < $2
          RETURNING j.briefing_id,j.error_code
        ) UPDATE briefings b SET missed_at=$1,visible=true FROM superseded s
          WHERE b.id=s.briefing_id AND b.current_version_id IS NULL AND b.missed_at IS NULL
          RETURNING b.id,s.error_code`,
        [now, latestDueSlot(now)?.targetAt],
      );
      if (closed.rowCount) {
        const ids = closed.rows.map((r) => String(r.id)).sort();
        await this.notify(
          ids.at(-1)!,
          "missed_editions",
          `이전 미발행 회차 ${ids.length}건을 마감했습니다. 관리 화면에서 회차별 결과를 확인하세요.`,
          now,
          tx,
        );
        for (const row of closed.rows.filter(
          (r) => r.error_code === "SUBMISSION_UNKNOWN",
        ))
          await this.notify(
            row.id,
            "submission_unknown",
            "외부 생성 요청의 접수 여부를 확인하세요.",
            now,
            tx,
          );
      }
    });
  }
  async claim(owner: string, now: Date): Promise<Job | undefined> {
    const r = await this.db.query(
      `WITH candidate AS (SELECT id FROM jobs WHERE state NOT IN ('failed','published') AND next_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ORDER BY next_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE jobs j SET owner=$2,lease_until=$1::timestamptz+interval '90 seconds',fence=fence+1 FROM candidate c,briefings b WHERE j.id=c.id AND b.id=j.briefing_id RETURNING j.*,b.target_at,b.us_trading_date::text,b.session`,
      [now, owner],
    );
    return r.rows[0];
  }
  async save(
    job: Job,
    state: JobState,
    nextAt: Date,
    payload = job.payload,
    errorCode: string | null = null,
    attempt = job.attempt,
    db: pg.Pool | pg.PoolClient = this.db,
  ) {
    const r = await db.query(
      "UPDATE jobs SET state=$1,next_at=$2,payload=$3,error_code=$4,attempt=$5,owner=NULL,lease_until=NULL WHERE id=$6 AND owner=$7 AND fence=$8 AND lease_until>clock_timestamp()",
      [
        state,
        nextAt,
        payload,
        errorCode,
        attempt,
        job.id,
        job.owner,
        job.fence,
      ],
    );
    if (!r.rowCount) throw new Error("LEASE_LOST");
  }
  async markSubmitting(job: Job) {
    const r = await this.db.query(
      "UPDATE jobs SET state='submitting',payload=$1 WHERE id=$2 AND owner=$3 AND fence=$4 AND lease_until>clock_timestamp()",
      [job.payload, job.id, job.owner, job.fence],
    );
    if (!r.rowCount) throw new Error("LEASE_LOST");
  }
  async previousCutoff(id: string, target: Date) {
    const r = await this.db.query(
      "SELECT v.content->'bundle'->>'cutoffAt' AS cutoff FROM briefings b JOIN briefing_versions v ON v.id=b.current_version_id WHERE b.target_at<$1 AND b.id<>$2 ORDER BY b.target_at DESC LIMIT 1",
      [target, id],
    );
    return (
      r.rows[0]?.cutoff ??
      new Date(target.getTime() - 4 * 86400000).toISOString()
    );
  }
  async latestBundle(
    id: string,
    cutoffLimit?: Date,
  ): Promise<Bundle | undefined> {
    const r = await this.db.query(
      `SELECT bundle FROM collection_bundles WHERE briefing_id=$1
        AND ($2::timestamptz IS NULL OR (bundle->>'cutoffAt')::timestamptz <= $2)
        ORDER BY collected_at DESC LIMIT 1`,
      [id, cutoffLimit],
    );
    return r.rows[0]?.bundle;
  }
  async publish(job: Job, content: Content, now: Date) {
    const valid = validateContent(content, this.mode);
    if (
      job.kind === "initial" &&
      valid.bundle.sources.some(
        (s) => Date.parse(s.publishedAt) > Date.parse(valid.bundle.cutoffAt),
      )
    )
      throw new Error("자료 기준 이후 출처를 초기 회차에 소급할 수 없습니다.");
    if (valid.date !== job.us_trading_date || valid.session !== job.session)
      throw new Error("회차 불일치");
    if (now < job.target_at) throw new Error("목표 시각 이전 공개 거부");
    await transaction(this.db, async (tx) => {
      const lock = await tx.query(
        "SELECT id FROM jobs WHERE id=$1 AND owner=$2 AND fence=$3 AND lease_until>clock_timestamp() FOR UPDATE",
        [job.id, job.owner, job.fence],
      );
      if (!lock.rowCount) throw new Error("LEASE_LOST");
      const b = (
        await tx.query("SELECT * FROM briefings WHERE id=$1 FOR UPDATE", [
          job.briefing_id,
        ])
      ).rows[0];
      if (job.kind === "initial" && (b.current_version_id || b.missed_at))
        throw new Error("ALREADY_PUBLISHED");
      if (
        job.kind === "correction" &&
        b.current_version_id !== job.payload.baseVersion
      )
        throw new Error("VERSION_CONFLICT");
      if (job.kind === "correction") {
        const old = (
          await tx.query("SELECT content FROM briefing_versions WHERE id=$1", [
            b.current_version_id,
          ])
        ).rows[0].content as Content;
        if (valid.bundle.cutoffAt !== old.bundle.cutoffAt)
          throw new Error("정정 시 자료 기준 변경 금지");
      }
      const version = randomUUID();
      await tx.query(
        "INSERT INTO briefing_versions(id,briefing_id,content,created_at,previous_id,reason,change,config,validated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)",
        [
          version,
          b.id,
          valid,
          now,
          b.current_version_id,
          job.payload.reason ?? null,
          job.payload.change ?? null,
          job.config,
        ],
      );
      for (const s of valid.bundle.sources)
        await tx.query(
          "INSERT INTO evidence(id,revision,metadata) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [s.id, s.checkedAt, s],
        );
      for (const e of valid.bundle.events)
        await tx.query(
          "INSERT INTO events(id,revision,data,first_observed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [e.id, valid.bundle.cutoffAt, e, e.firstObservedAt],
        );
      await tx.query(
        "UPDATE briefings SET current_version_id=$1,visible=CASE WHEN $4 THEN visible ELSE true END,published_at=COALESCE(published_at,$2),corrected_at=CASE WHEN $4 THEN $2 ELSE NULL END WHERE id=$3",
        [version, now, b.id, job.kind === "correction"],
      );
      await tx.query(
        "UPDATE jobs SET state='published',owner=NULL,lease_until=NULL,payload=$2 WHERE id=$1",
        [job.id, job.payload],
      );
    });
  }
  async publicArchive(filter: {
    date?: string;
    session?: string;
    excludeId?: string;
    dateWindow: { limit: number; offset: number };
  }): Promise<ArchiveEntry[]> {
    const r = await this.db.query(
      `WITH editions AS (
      SELECT b.id,b.us_trading_date::text AS date,b.session,b.target_at,b.missed_at,b.published_at,b.corrected_at,
        v.content->'draft'->>'title' AS title, jsonb_array_length(v.content->'bundle'->'missing')>0 AS missing,
        dense_rank() OVER (ORDER BY b.us_trading_date DESC) AS day_rank
      FROM briefings b LEFT JOIN briefing_versions v ON v.id=b.current_version_id
      WHERE b.visible AND (v.validated OR b.missed_at IS NOT NULL)
        AND ($1::date IS NULL OR b.us_trading_date=$1::date) AND ($2::text IS NULL OR b.session=$2)
        AND ($5::text IS NULL OR b.id<>$5)
    ) SELECT * FROM editions WHERE day_rank>$4 AND day_rank<=$4+$3
      ORDER BY date DESC,CASE WHEN session='pre' THEN 0 ELSE 1 END`,
      [
        filter.date || null,
        filter.session || null,
        filter.dateWindow.limit,
        filter.dateWindow.offset,
        filter.excludeId || null,
      ],
    );
    return r.rows.map((row) => ({
      id: row.id,
      date: row.date,
      session: row.session,
      targetAt: row.target_at.toISOString(),
      publishedAt: row.published_at?.toISOString() ?? null,
      correctedAt: row.corrected_at?.toISOString() ?? null,
      title: row.title ?? "브리핑 미발행 안내",
      missing: !!row.missing,
    }));
  }
  async missedDetail(id: string) {
    const result = await this.db.query<{
      id: string;
      date: string;
      session: Session;
      target_at: Date;
    }>(
      "SELECT id,us_trading_date::text AS date,session,target_at FROM briefings WHERE id=$1 AND visible AND missed_at IS NOT NULL",
      [id],
    );
    const r = result.rows[0];
    return r
      ? {
          id: r.id,
          date: r.date,
          session: r.session,
          targetAt: r.target_at.toISOString(),
        }
      : null;
  }
  async publicList(
    filter: {
      date?: string;
      session?: string;
      excludeId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<PublicBriefing[]> {
    const r = await this.db.query(
      "SELECT b.id,b.current_version_id,b.target_at,b.published_at,b.corrected_at,v.content FROM briefings b JOIN briefing_versions v ON v.id=b.current_version_id WHERE b.visible AND v.validated AND ($1::date IS NULL OR b.us_trading_date=$1::date) AND ($2::text IS NULL OR b.session=$2) AND ($5::text IS NULL OR b.id<>$5) ORDER BY b.target_at DESC LIMIT $3 OFFSET $4",
      [
        filter.date || null,
        filter.session || null,
        filter.limit ?? 20,
        filter.offset ?? 0,
        filter.excludeId || null,
      ],
    );
    return r.rows.map((row) => ({
      id: row.id,
      versionId: row.current_version_id,
      targetAt: row.target_at.toISOString(),
      publishedAt: row.published_at.toISOString(),
      correctedAt: row.corrected_at?.toISOString() ?? null,
      content: row.content,
      corrections: [],
    }));
  }
  async publicDetail(id: string): Promise<PublicBriefing | null> {
    const r = await this.db.query(
      "SELECT b.*,v.content FROM briefings b JOIN briefing_versions v ON v.id=b.current_version_id WHERE b.id=$1 AND b.visible AND v.validated",
      [id],
    );
    if (!r.rowCount) return null;
    const b = r.rows[0];
    const history = await this.db.query(
      "SELECT created_at,reason,change FROM briefing_versions WHERE briefing_id=$1 AND previous_id IS NOT NULL ORDER BY created_at",
      [id],
    );
    return {
      id: b.id,
      versionId: b.current_version_id,
      targetAt: b.target_at.toISOString(),
      publishedAt: b.published_at.toISOString(),
      correctedAt: b.corrected_at?.toISOString() ?? null,
      content: b.content,
      corrections: history.rows.map((h) => ({
        at: h.created_at.toISOString(),
        reason: h.reason,
        change: h.change,
      })),
    };
  }
  async delays(now: Date) {
    return (
      await this.db.query(
        "SELECT b.id,b.us_trading_date::text,b.session,b.target_at,j.state FROM briefings b LEFT JOIN jobs j ON j.briefing_id=b.id AND j.kind='initial' WHERE b.published_at IS NULL AND b.missed_at IS NULL AND b.target_at<$1 ORDER BY b.target_at DESC LIMIT 30",
        [now],
      )
    ).rows;
  }
  async fail(job: Job, code: string, now: Date) {
    const unknown = code === "SUBMISSION_UNKNOWN";
    await transaction(this.db, async (tx) => {
      await this.save(job, "failed", now, job.payload, code, job.attempt, tx);
      await this.notify(
        job.briefing_id,
        unknown ? "submission_unknown" : "failed",
        unknown
          ? "외부 요청 접수 여부를 확인해야 합니다. 자동 재요청을 중단했습니다."
          : `작업 실패: ${code}. 관리 화면에서 확인하세요.`,
        now,
        tx,
      );
    });
  }
  async notify(
    id: string,
    kind: string,
    message: string,
    now: Date,
    db: pg.Pool | pg.PoolClient = this.db,
  ) {
    await db.query(
      "INSERT INTO notification_outbox(id,dedupe_key,briefing_id,kind,message,next_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [randomUUID(), `${id}:${kind}`, id, kind, message, now],
    );
  }
  async adminCommand(
    command: {
      id: string;
      action: "hide" | "restore" | "retry" | "correct";
      briefingId: string;
      baseVersion: string;
      reason?: string;
      issue?: string;
      evidenceUrl?: string;
      jobId?: string;
    },
    config: Job["config"],
    now: Date,
  ) {
    await transaction(this.db, async (tx) => {
      const inserted = await tx.query(
        "INSERT INTO admin_commands(id,action,briefing_id,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",
        [command.id, command.action, command.briefingId, now],
      );
      if (!inserted.rowCount) throw new Error("COMMAND_REPLAY");
      const b = (
        await tx.query("SELECT * FROM briefings WHERE id=$1 FOR UPDATE", [
          command.briefingId,
        ])
      ).rows[0];
      if (!b) throw new Error("BRIEFING_NOT_FOUND");
      if (command.action === "hide" || command.action === "restore") {
        if (
          (!b.current_version_id && !b.missed_at) ||
          (b.current_version_id ?? "") !== command.baseVersion
        )
          throw new Error("VERSION_CONFLICT");
        if (command.action === "restore" && !b.missed_at) {
          const v = (
            await tx.query(
              "SELECT content,validated FROM briefing_versions WHERE id=$1",
              [b.current_version_id],
            )
          ).rows[0];
          if (!v?.validated) throw new Error("검증되지 않은 버전");
          validateContent(v.content, this.mode);
        }
        await tx.query("UPDATE briefings SET visible=$1 WHERE id=$2", [
          command.action === "restore",
          b.id,
        ]);
      } else if (command.action === "retry") {
        if (b.missed_at) throw new Error("RETRY_NOT_AVAILABLE");
        if ((b.current_version_id ?? "") !== command.baseVersion)
          throw new Error("VERSION_CONFLICT");
        const latest = (
          await tx.query(
            "SELECT * FROM jobs WHERE briefing_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
            [b.id],
          )
        ).rows[0];
        if (command.jobId && latest?.id !== command.jobId)
          throw new Error("JOB_CONFLICT");
        if (
          !latest ||
          latest.state !== "failed" ||
          latest.error_code === "SUBMISSION_UNKNOWN"
        )
          throw new Error("RETRY_NOT_AVAILABLE");
        if (
          latest.kind === "correction" &&
          latest.payload.baseVersion !== b.current_version_id
        )
          throw new Error("VERSION_CONFLICT");
        if (
          (
            await tx.query(
              "SELECT 1 FROM jobs WHERE briefing_id=$1 AND state NOT IN ('failed','published') LIMIT 1",
              [b.id],
            )
          ).rowCount
        )
          throw new Error("ACTIVE_JOB");
        // A stored original report is not a newly generated correction. Without a response,
        // resume collection instead of accidentally validating/publishing the old content.
        await tx.query(
          "UPDATE jobs SET state=CASE WHEN payload ? 'responseId' THEN 'generating' ELSE 'collecting' END,attempt=0,error_code=NULL,next_at=$2,owner=NULL,lease_until=NULL WHERE id=$1",
          [latest.id, now],
        );
      } else {
        if (
          !b.current_version_id ||
          b.current_version_id !== command.baseVersion
        )
          throw new Error("VERSION_CONFLICT");
        if (
          !command.issue?.trim() ||
          !command.reason?.trim() ||
          !command.evidenceUrl
        )
          throw new Error("EVIDENCE_REQUIRED");
        if (
          (
            await tx.query(
              "SELECT 1 FROM jobs WHERE briefing_id=$1 AND state NOT IN ('failed','published') LIMIT 1",
              [b.id],
            )
          ).rowCount
        )
          throw new Error("ACTIVE_JOB");
        const latest = (
          await tx.query(
            "SELECT error_code FROM jobs WHERE briefing_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
            [b.id],
          )
        ).rows[0];
        if (latest?.error_code === "SUBMISSION_UNKNOWN")
          throw new Error("SUBMISSION_UNKNOWN");
        const old = (
          await tx.query("SELECT content FROM briefing_versions WHERE id=$1", [
            b.current_version_id,
          ])
        ).rows[0].content;
        await tx.query(
          "INSERT INTO jobs(id,briefing_id,kind,dedupe_key,state,next_at,config,created_at,payload) VALUES($1,$2,'correction',$3,'collecting',$4,$5,$4,$6)",
          [
            randomUUID(),
            b.id,
            command.id,
            now,
            config,
            {
              baseVersion: b.current_version_id,
              reason: command.reason,
              issue: command.issue,
              evidenceUrl: command.evidenceUrl,
              content: old,
            },
          ],
        );
      }
    });
  }
}
