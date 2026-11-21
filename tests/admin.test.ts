import { describe, expect, it } from "vitest";
import { adminActions, adminSearch } from "../lib/admin";
describe("administrator action boundaries", () => {
  const failed = {
    version: "",
    job: {
      kind: "initial",
      state: "failed",
      errorCode: "HTTP_429",
      baseVersion: null,
    },
  } as const;
  const correction = {
    version: "stored",
    job: {
      kind: "correction",
      state: "collecting",
      errorCode: null,
      baseVersion: "stored",
    },
  } as const;
  it("allows retry only for a failed resumable job", () => {
    expect(adminActions(failed).retry).toBe(true);
    for (const state of ["ready", "published"] as const) {
      expect(
        adminActions({ ...failed, job: { ...failed.job, state } }).retry,
      ).toBe(false);
    }
  });
  it("blocks a new correction as well as retry while submission is unknown", () => {
    const edition = {
      version: "stored",
      job: { ...failed.job, errorCode: "SUBMISSION_UNKNOWN" },
    };
    expect(adminActions(edition)).toEqual({
      retry: false,
      correct: false,
      visibility: true,
    });
  });
  it("keeps visibility controls during correction but blocks duplicate correction", () => {
    expect(adminActions(correction)).toEqual({
      retry: false,
      correct: false,
      visibility: true,
    });
  });
  it("does not offer retry for a correction based on an old version", () => {
    const edition = {
      ...correction,
      job: { ...correction.job, state: "failed" as const, baseVersion: "old" },
    };
    expect(adminActions(edition).retry).toBe(false);
  });
  it("keeps the missed notice visible to administration and disallows retry", () => {
    expect(
      adminActions({ ...failed, missedAt: "2026-10-28T20:00:00Z" }),
    ).toEqual({
      retry: false,
      correct: false,
      visibility: true,
    });
  });
  it("rejects malformed dates, inherited filter names and unsafe page offsets", () => {
    expect(
      adminSearch({ date: "2026-02-31", filter: "toString", page: "Infinity" }),
    ).toEqual({ date: "", filter: "all", page: 1 });
    expect(
      adminSearch({ date: "2026-11-18", filter: "stored", page: "2" }),
    ).toEqual({ date: "2026-11-18", filter: "stored", page: 2 });
  });
});
