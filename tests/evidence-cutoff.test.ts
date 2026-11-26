import { describe, expect, it, vi } from "vitest";
import { sampleContent } from "../data/samples";
import {
  assertEvidenceAsOf,
  BundleSchema,
  evidenceTimeReferences,
  upcomingEvents,
  validateContent,
  type Bundle,
} from "../lib/contract";
import { draftRequest, type DraftJob } from "../lib/providers";
import { checkTrialInput, trialRequest } from "../lib/report-trial";
import type { Repository } from "../lib/repository";
import { Worker } from "../lib/worker";

const cutoff = "2026-11-20T19:30:00-05:00";
const sameTime = "2026-11-21T00:30:00Z";
const later = "2026-11-21T00:30:01Z";
const now = new Date("2026-11-22T00:00:00Z");
const sample = sampleContent("2026-11-20", "post");
const job: DraftJob = {
  us_trading_date: sample.date,
  session: "post",
  kind: "initial",
  payload: {},
  config: {
    mode: "live",
    model: "gpt-6.2-astra",
    promptVersion: "test",
    reasoning: "medium",
    maxOutputTokens: 8000,
  },
};
function evidence(): Bundle {
  return {
    coverageStart: "2026-11-20T12:00:00Z",
    cutoffAt: cutoff,
    sources: [
      {
        ...sample.bundle.sources[0],
        url: "https://www.bls.gov/release",
        method: "official",
        rights: "approved",
        publishedAt: "2026-11-20T15:00:00Z",
        checkedAt: sameTime,
      },
    ],
    observations: [],
    events: [],
    pendingCalls: [],
    missing: [],
  };
}
describe("과거 회차의 자료 기준 시각", () => {
  it("마감 정각은 허용하고 1초 뒤에 읽은 가변 원문은 거부한다", () => {
    const b = evidence();
    expect(() => checkTrialInput(job, b, now)).not.toThrow();
    b.sources[0].checkedAt = later;
    expect(() => checkTrialInput(job, b, now)).toThrow("판본");
    const version = {
      availableAt: sameTime,
      evidenceUrl: "https://www.bls.gov/archive/dated-release",
    };
    b.sources[0].version = version;
    expect(() => checkTrialInput(job, b, now)).not.toThrow();
    version.availableAt = later;
    expect(() => checkTrialInput(job, b, now)).toThrow("판본");
    version.availableAt = "2026-11-20T14:00:00Z";
    expect(() => checkTrialInput(job, b, now)).toThrow("시각 불일치");
    version.availableAt = "2026-11-22T00:00:01Z";
    expect(() => checkTrialInput(job, b, now)).toThrow("시각 불일치");
  });
  it("게시일과 판본 날짜는 가장 늦은 시간대의 날짜 경계가 지났을 때만 사용한다", () => {
    const b = evidence();
    const source = b.sources[0];
    source.publishedAt = "2026-11-19";
    source.checkedAt = later;
    source.version = { availableAt: "2026-11-19", evidenceUrl: source.url };
    b.coverageStart = "2026-11-19T00:00:00Z";
    b.cutoffAt = "2026-11-20T12:00:00Z";
    expect(BundleSchema.parse(b).sources[0]).toEqual(source);
    expect(() => checkTrialInput(job, b, now, true)).not.toThrow();
    expect(() => checkTrialInput(job, b, now)).toThrow("날짜만");
    expect(() => validateContent({ ...sample, bundle: b }, "sample")).toThrow(
      "날짜만",
    );
    expect(evidenceTimeReferences(b)).toEqual([]);

    b.cutoffAt = "2026-11-20T11:59:59.999Z";
    expect(() => checkTrialInput(job, b, now, true)).toThrow("기준 시각");
    b.cutoffAt = sameTime;
    source.version.availableAt = "2026-11-20";
    expect(() => assertEvidenceAsOf(b, now)).toThrow("시각 불일치");
    source.checkedAt = "2026-11-21T12:00:00Z";
    expect(() => assertEvidenceAsOf(b, now)).toThrow("판본");
  });
  it("처음 알려진 날짜를 보존하고 마감에 걸친 날짜의 예정 사건은 제외한다", () => {
    const b = evidence();
    const event = {
      ...sample.bundle.events[0],
      sourceId: b.sources[0].id,
      scheduledAt: "2026-11-23T14:45:00Z",
      occurredAt: null,
      firstObservedAt: "2026-11-19",
      status: "scheduled" as const,
      result: "",
    };
    b.events = [event];
    expect(BundleSchema.parse(b).events[0].firstObservedAt).toBe("2026-11-19");
    expect(() => checkTrialInput(job, b, now, true)).not.toThrow();
    expect(() => checkTrialInput(job, b, now)).toThrow("날짜만");
    expect(upcomingEvents(sample.date, b).events).toEqual([event]);

    event.firstObservedAt = "2026-11-20";
    expect(() => assertEvidenceAsOf(b, now)).toThrow("사건");
    expect(upcomingEvents(sample.date, b).events).toEqual([]);
    event.scheduledAt = "2026-11-23";
    expect(BundleSchema.safeParse(b).success).toBe(false);
  });
  it("관측값과 발표 결과는 마감까지, 이미 알려진 미래 일정은 예정으로 사용한다", () => {
    const b = evidence();
    const sourceId = b.sources[0].id;
    b.observations = [
      { ...sample.bundle.observations[0], sourceId, observedAt: later },
    ];
    expect(() => assertEvidenceAsOf(b, now)).toThrow("관측값");
    b.observations[0].observedAt = sameTime;
    b.events = [
      {
        ...sample.bundle.events[0],
        sourceId,
        scheduledAt: later,
        firstObservedAt: sameTime,
        occurredAt: null,
        status: "scheduled",
        result: "",
      },
    ];
    expect(() => assertEvidenceAsOf(b, now)).not.toThrow();
    b.events[0].firstObservedAt = later;
    expect(() => assertEvidenceAsOf(b, now)).toThrow("사건");
    Object.assign(b.events[0], {
      firstObservedAt: sameTime,
      status: "released",
      occurredAt: later,
    });
    expect(() => assertEvidenceAsOf(b, now)).toThrow("사건");
  });
  it("동일한 발췌의 판본 확인은 유료 요청을 바꾸지 않고, 발췌 변경은 반영한다", () => {
    const b = evidence();
    const initial = trialRequest(job, b, "draft");
    b.sources[0].version = {
      availableAt: sameTime,
      evidenceUrl: "https://www.bls.gov/archive/dated-release",
    };
    expect(trialRequest(job, b, "draft")).toEqual(initial);
    b.sources[0].excerpt += " changed";
    expect(trialRequest(job, b, "draft")).not.toEqual(initial);
  });
  it("관리자가 지정한 사후 정정 근거는 원회차의 모델 입력과 구분한다", () => {
    const b = evidence();
    const notice = {
      ...b.sources[0],
      id: "erratum",
      url: "https://www.bls.gov/erratum",
      publishedAt: later,
      checkedAt: later,
    };
    b.sources.push(notice);
    expect(() => assertEvidenceAsOf(b, now)).toThrow("판본");
    expect(() => assertEvidenceAsOf(b, now, notice.url)).not.toThrow();
    const correction = {
      ...job,
      kind: "correction" as const,
      payload: { evidenceUrl: notice.url, content: sample },
    };
    const input = JSON.parse(draftRequest(correction, b).input);
    expect(input.bundle.sources).toEqual([b.sources[0]]);
    expect(input.correction.subsequentEvidence).toEqual(notice);
    b.observations = [
      {
        ...sample.bundle.observations[0],
        sourceId: notice.id,
        observedAt: sameTime,
      },
    ];
    expect(() => assertEvidenceAsOf(b, now, notice.url)).toThrow("분리");
  });
  it.each(["queued", "validating"])(
    "예약 작업 %s 단계에서 판본이 불명확하면 작성·보정 호출 전에 멈춘다",
    async (state) => {
      const b = evidence();
      b.sources[0].checkedAt = later;
      const queued = {
        ...job,
        state,
        target_at: new Date(cutoff),
        payload: state === "queued" ? {} : { bundle: b },
        attempt: 0,
      };
      const repo = {
        claim: vi.fn().mockResolvedValue(queued),
        previousCutoff: vi.fn().mockResolvedValue(b.coverageStart),
        fail: vi.fn(),
        markSubmitting: vi.fn(),
      };
      const generator = { submit: vi.fn(), poll: vi.fn() };
      await new Worker(
        repo as unknown as Repository,
        { collect: vi.fn().mockResolvedValue(b), refresh: vi.fn() },
        generator,
      ).tick(now);
      expect(repo.fail).toHaveBeenCalledWith(
        queued,
        "EDITION_EVIDENCE_UNAVAILABLE",
        now,
      );
      expect(repo.markSubmitting).not.toHaveBeenCalled();
      expect(generator.submit).not.toHaveBeenCalled();
    },
  );
});
