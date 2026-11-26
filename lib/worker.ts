import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  assertEvidenceAsOf,
  hasDateOnlyEvidence,
  hasPrivateResearch,
  validateContent,
  reducedContent,
  type Bundle,
} from "./contract";
import { Repository, type Job } from "./repository";
import { tradingDay } from "./calendar";
import {
  contentFromDraft,
  ProviderError,
  type Collector,
  type Generator,
} from "./providers";
const digest = (b: Bundle) =>
  createHash("sha256").update(JSON.stringify(b)).digest("hex");
const plus = (d: Date, minutes: number) =>
  new Date(d.getTime() + minutes * 60000);
function assertGenerationEvidence(job: Job, bundle: Bundle, now: Date) {
  if (hasDateOnlyEvidence(bundle) || hasPrivateResearch(bundle))
    throw new ProviderError("EDITION_EVIDENCE_UNAVAILABLE");
  if (job.config.mode !== "live") return;
  try {
    assertEvidenceAsOf(
      bundle,
      now,
      job.kind === "correction" ? job.payload.evidenceUrl : undefined,
    );
  } catch {
    throw new ProviderError("EDITION_EVIDENCE_UNAVAILABLE");
  }
  if (
    !bundle.sources.length ||
    bundle.sources.some((s) => s.rights !== "approved" || s.method === "sample")
  )
    throw new ProviderError("EDITION_EVIDENCE_UNAVAILABLE");
}
export class Worker {
  constructor(
    private repo: Repository,
    private collector: Collector,
    private generator: Generator,
  ) {}
  async tick(now = new Date()) {
    const job = await this.repo.claim(randomUUID(), now);
    if (!job) return "idle";
    try {
      await this.step(job, now);
    } catch (error) {
      if (error instanceof Error && error.message === "LEASE_LOST")
        return "lease_lost";
      const e =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              error instanceof Error &&
                ["VERSION_CONFLICT", "ALREADY_PUBLISHED"].includes(
                  error.message,
                )
                ? error.message
                : "VALIDATION_OR_STORAGE_ERROR",
            );
      if (e.ambiguous || job.state === "submitting") {
        await this.repo.fail(job, "SUBMISSION_UNKNOWN", now);
      } else if (e.retryable && job.attempt < 3) {
        const minutes = Math.max(
          [1, 5, 15][job.attempt],
          e.retryAfterSeconds / 60,
        );
        await this.repo.save(
          job,
          "retry_wait",
          plus(now, minutes),
          job.payload,
          e.code,
          job.attempt + 1,
        );
      } else if (
        job.kind === "initial" &&
        job.payload.bundle &&
        [
          "GENERATION_INCOMPLETE",
          "GENERATION_REFUSED",
          "INVALID_DRAFT",
          "VALIDATION_OR_STORAGE_ERROR",
        ].includes(e.code) &&
        job.state !== "ready"
      ) {
        const bundle = {
          ...job.payload.bundle,
          missing: [
            ...job.payload.bundle.missing,
            "생성 또는 검증에 실패해 확인한 자료만 담은 축소본입니다.",
          ],
        };
        const content = reducedContent(
          job.us_trading_date,
          job.session,
          bundle,
          job.config.mode === "sample",
          now.toISOString(),
          job.config.timePolicy,
        );
        try {
          validateContent(content, job.config.mode);
          await this.repo.save(
            job,
            "ready",
            new Date(Math.max(now.getTime(), job.target_at.getTime())),
            { ...job.payload, bundle, content },
            e.code,
          );
        } catch {
          await this.repo.fail(job, e.code, now);
        }
      } else await this.repo.fail(job, e.code, now);
    }
    return "processed";
  }
  private async step(job: Job, now: Date) {
    if (job.kind === "initial" && tradingDay(job.us_trading_date) !== true)
      throw new ProviderError("CALENDAR_UNCONFIRMED_OR_CLOSED");
    const deadline = plus(job.target_at, 60);
    const save = (state: Parameters<Repository["save"]>[1], next = now) =>
      this.repo.save(job, state, next);
    if (job.state === "submitting")
      throw new ProviderError("SUBMISSION_UNKNOWN", false, 0, true);
    if (
      ["queued", "collecting", "waiting_data", "retry_wait"].includes(job.state)
    ) {
      if (job.state === "retry_wait" && job.payload.responseId) {
        await save("generating");
        return;
      }
      const coverage = await this.repo.previousCutoff(
        job.briefing_id,
        job.target_at,
      );
      const bundle = job.payload.bundle
        ? await this.collector.refresh(job, job.payload.bundle, now)
        : await this.collector.collect(job, coverage, now);
      if (
        Date.parse(bundle.coverageStart) > Date.parse(coverage) &&
        job.kind === "initial"
      )
        throw new ProviderError("COVERAGE_GAP");
      job.payload.bundle = bundle;
      if (
        bundle.pendingCalls.length &&
        now < deadline &&
        job.kind === "initial"
      ) {
        await save(
          "waiting_data",
          new Date(
            Math.min(
              deadline.getTime(),
              Math.max(job.target_at.getTime(), plus(now, 10).getTime()),
            ),
          ),
        );
        return;
      }
      if (bundle.pendingCalls.length) {
        bundle.missing = [
          ...new Set([
            ...bundle.missing,
            ...bundle.pendingCalls.map((c) => `${c} · 콜 자료 미반영`),
          ]),
        ];
        bundle.pendingCalls = [];
      }
      assertGenerationEvidence(job, bundle, now);
      // Persist the submission boundary before sending a billable request. A crash here needs operator reconciliation.
      await this.repo.markSubmitting(job);
      const result = await this.generator.submit(job, bundle);
      job.payload.responseId = result.id;
      await save("generating", plus(now, 0.1));
      return;
    }
    if (job.state === "generating") {
      const result = await this.generator.poll(job.payload.responseId!);
      if (result.status === "pending") {
        await save("generating", plus(now, 0.25));
        return;
      }
      job.payload.usage = result.usage;
      job.payload.content = contentFromDraft(
        job,
        job.payload.bundle!,
        result.draft!,
        now,
      );
      await save("validating");
      return;
    }
    if (job.state === "validating") {
      assertGenerationEvidence(job, job.payload.bundle!, now);
      try {
        validateContent(job.payload.content, job.config.mode);
      } catch {
        if ((job.payload.repairCount ?? 0) >= 1)
          throw new ProviderError("INVALID_DRAFT");
        job.payload.repairCount = 1;
        await this.repo.markSubmitting(job);
        const repaired = await this.generator.submit(job, job.payload.bundle!);
        job.payload.responseId = repaired.id;
        await save("generating", plus(now, 0.1));
        return;
      }
      if (job.kind === "correction")
        job.payload.change = `정정 요청 항목: ${job.payload.issue}`;
      await save(
        "ready",
        new Date(Math.max(now.getTime(), job.target_at.getTime())),
      );
      return;
    }
    if (job.state === "ready") {
      if (job.kind === "initial") {
        const refreshed = await this.collector.refresh(
          job,
          job.payload.bundle!,
          now,
        );
        if (now >= deadline && refreshed.pendingCalls.length) {
          refreshed.missing = [
            ...new Set([
              ...refreshed.missing,
              ...refreshed.pendingCalls.map((c) => `${c} · 콜 자료 미반영`),
            ]),
          ];
          refreshed.pendingCalls = [];
        }
        if (digest(refreshed) !== digest(job.payload.bundle!)) {
          job.payload.bundle = refreshed;
          delete job.payload.responseId;
          await save("collecting");
          return;
        }
      }
      await this.repo.publish(job, job.payload.content!, now);
    }
  }
  async detectDelays(now = new Date()) {
    await this.repo.db.query(
      `INSERT INTO notification_outbox(id,dedupe_key,briefing_id,kind,message,next_at)
       SELECT gen_random_uuid(),b.id || ':delay',b.id,'delay','목표 시각 이후 기술적 발행 지연이 이어지고 있습니다.',$1
       FROM briefings b LEFT JOIN jobs j ON j.briefing_id=b.id AND j.kind='initial'
       WHERE b.session='post' AND b.published_at IS NULL AND b.missed_at IS NULL AND b.target_at <= $1::timestamptz - interval '15 minutes'
         AND (j.state IS DISTINCT FROM 'waiting_data' OR b.target_at <= $1::timestamptz - interval '1 hour')
         AND NOT EXISTS (SELECT 1 FROM notification_outbox n WHERE n.dedupe_key=b.id || ':delay')
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [now],
    );
  }
}
