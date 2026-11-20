import { readConfig } from "./config";
import { assertDatabase, pool } from "./db";
import { Repository, type Job } from "./repository";
import {
  ResponsesGenerator,
  ProviderError,
  type Collector,
  type Generator,
} from "./providers";
import { BundleSchema } from "./contract";
import { sampleContent } from "../data/samples";
import { Worker } from "./worker";
export function jobConfig(): Job["config"] {
  const c = readConfig();
  return {
    mode: c.DATA_MODE,
    model: c.DATA_MODE === "sample" ? "sample" : c.OPENAI_MODEL,
    promptVersion: "noct-v1",
    reasoning: c.OPENAI_REASONING_EFFORT,
    maxOutputTokens: c.OPENAI_MAX_OUTPUT_TOKENS,
  };
}
export async function runtime() {
  const c = readConfig(),
    db = pool();
  await assertDatabase(db, c.APP_ENV, c.DATA_MODE);
  const repo = new Repository(db, c.DATA_MODE);
  const collector: Collector = {
    async collect(job, coverage, now) {
      if (c.DATA_MODE === "sample") {
        const content = sampleContent(job.us_trading_date, job.session);
        job.payload.content = content;
        const cutoffAt = new Date(
          Math.min(now.getTime(), Date.parse(content.bundle.cutoffAt)),
        ).toISOString();
        return {
          ...content.bundle,
          coverageStart: coverage,
          cutoffAt,
          sources: content.bundle.sources.map((s) => ({
            ...s,
            publishedAt: cutoffAt,
            checkedAt: cutoffAt,
          })),
          observations: content.bundle.observations.map((o) => ({
            ...o,
            observedAt: cutoffAt,
          })),
          events: content.bundle.events.map((e) => ({
            ...e,
            firstObservedAt: cutoffAt,
          })),
        };
      }
      const input = await repo.latestBundle(
        job.briefing_id,
        job.kind === "initial" ? job.target_at : undefined,
      );
      if (!input)
        throw new ProviderError(
          job.kind === "initial" && now > job.target_at
            ? "EDITION_EVIDENCE_UNAVAILABLE"
            : "DATA_PROVIDER_NOT_CONFIGURED",
        );
      const bundle = BundleSchema.parse(input);
      if (Date.parse(bundle.cutoffAt) > now.getTime())
        throw new ProviderError("FUTURE_DATA");
      if (
        job.kind === "initial" &&
        Date.parse(bundle.cutoffAt) < job.target_at.getTime() - 30 * 60000
      )
        throw new ProviderError("STALE_COLLECTION");
      if (job.kind === "correction") {
        if (
          bundle.cutoffAt !== job.payload.content?.bundle.cutoffAt ||
          !bundle.sources.some((s) => s.url === job.payload.evidenceUrl)
        )
          throw new ProviderError("CORRECTION_EVIDENCE_REQUIRED");
      }
      return bundle;
    },
    async refresh(job, bundle, now) {
      if (c.DATA_MODE === "sample") return bundle;
      // Only an already documented earnings-call wait can extend the original evidence window.
      const limit =
        job.kind === "initial"
          ? new Date(
              Math.max(
                Date.parse(bundle.cutoffAt),
                job.target_at.getTime() +
                  (bundle.pendingCalls.length ? 3600000 : 0),
              ),
            )
          : undefined;
      const input = await repo.latestBundle(job.briefing_id, limit);
      if (!input && job.kind === "initial") return bundle;
      if (!input) throw new ProviderError("DATA_PROVIDER_NOT_CONFIGURED");
      const parsed = BundleSchema.parse(input);
      if (
        job.kind === "initial" &&
        Date.parse(parsed.cutoffAt) < Date.parse(bundle.cutoffAt)
      )
        return bundle;
      if (Date.parse(parsed.cutoffAt) > now.getTime())
        throw new ProviderError("FUTURE_DATA");
      if (
        job.kind === "correction" &&
        (parsed.cutoffAt !== job.payload.content?.bundle.cutoffAt ||
          !parsed.sources.some((s) => s.url === job.payload.evidenceUrl))
      )
        throw new ProviderError("CORRECTION_EVIDENCE_REQUIRED");
      return parsed;
    },
  };
  const generator: Generator =
    c.DATA_MODE === "sample"
      ? {
          async submit(job) {
            return { id: `sample_${job.us_trading_date}_${job.session}` };
          },
          async poll(id) {
            const [, date, session] = id.split("_");
            return {
              status: "done",
              draft: sampleContent(date, session as "pre" | "post").draft,
              usage: { sample: true },
            };
          },
        }
      : new ResponsesGenerator(c);
  return { c, db, repo, worker: new Worker(repo, collector, generator) };
}
