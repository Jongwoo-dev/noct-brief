import { sampleContent } from "./samples";
import { schedule } from "../lib/calendar";
import type { AdminEdition, AdminJob, AdminVersion } from "../lib/admin";
import type { JobState } from "../lib/repository";

// Fixed UI fixtures only. Never inserted into the real administrator's database.
export function adminSamples() {
  const cases: {
    date: string;
    session: "pre" | "post";
    state: JobState;
    stored?: boolean;
    hidden?: boolean;
    error?: string;
  }[] = [
    { date: "2026-10-27", session: "post", state: "ready" },
    { date: "2026-10-27", session: "pre", state: "failed", error: "HTTP_429" },
    { date: "2026-10-26", session: "post", state: "collecting", stored: true },
    {
      date: "2026-10-26",
      session: "pre",
      state: "published",
      stored: true,
      hidden: true,
    },
    {
      date: "2026-10-23",
      session: "post",
      state: "failed",
      error: "SUBMISSION_UNKNOWN",
    },
    { date: "2026-10-23", session: "pre", state: "published", stored: true },
  ];
  return cases.map((item, i) => {
    const slot = schedule(item.date, item.session),
      content = sampleContent(item.date, item.session);
    const version = `sample-version-${i}`;
    const job: AdminJob = {
      id: `sample-job-${i}`,
      kind:
        item.stored && item.state === "collecting" ? "correction" : "initial",
      state: item.state,
      attempt: item.error ? 3 : 0,
      errorCode: item.error ?? null,
      createdAt: content.generatedAt,
      nextAt: slot.targetAt,
      baseVersion: item.stored ? version : null,
      cutoffAt: content.bundle.cutoffAt,
      missing: [],
      model: "sample",
      usage: { sample: true },
    };
    const edition: AdminEdition = {
      id: slot.id,
      date: item.date,
      session: item.session,
      targetAt: slot.targetAt,
      publishedAt: item.stored ? slot.targetAt : null,
      visible: !!item.stored && !item.hidden,
      version: item.stored ? version : "",
      title: item.stored ? content.draft.title : null,
      versionCount: item.stored ? 2 : 0,
      job,
    };
    const versions: AdminVersion[] = item.stored
      ? [
          {
            id: version,
            createdAt: content.generatedAt,
            reason: "가상 자료의 표현을 명확히 정정",
            change: "요약 표현 확인",
            content,
          },
          {
            id: `${version}-previous`,
            createdAt: slot.targetAt,
            reason: null,
            change: null,
            content: {
              ...content,
              draft: {
                ...content.draft,
                title: `${content.draft.title} · 이전 표현`,
              },
            },
          },
        ]
      : [];
    return { edition, versions, selected: versions[0] ?? null, jobs: [job] };
  });
}
