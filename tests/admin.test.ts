import { describe, expect, it } from "vitest";
import { adminActions, adminSearch, matchesAdminFilter } from "../lib/admin";
import { adminSamples } from "../data/admin-samples";
describe("administrator action boundaries", () => {
  const samples = adminSamples();
  it("allows retry only for a failed resumable job", () => {
    expect(adminActions(samples[1].edition).retry).toBe(true);
    expect(adminActions(samples[0].edition).retry).toBe(false);
    expect(adminActions(samples[3].edition).retry).toBe(false);
  });
  it("blocks a new correction as well as retry while submission is unknown", () => {
    const edition = { ...samples[4].edition, version: "stored" };
    expect(adminActions(edition)).toEqual({
      retry: false,
      correct: false,
      visibility: true,
    });
  });
  it("keeps visibility controls during correction but blocks duplicate correction", () => {
    expect(adminActions(samples[2].edition)).toEqual({
      retry: false,
      correct: false,
      visibility: true,
    });
  });
  it("does not offer retry for a correction based on an old version", () => {
    const edition = structuredClone(samples[2].edition);
    edition.job!.state = "failed";
    edition.job!.baseVersion = "old";
    expect(adminActions(edition).retry).toBe(false);
  });
  it("includes private reports in storage and active corrections in processing", () => {
    expect(matchesAdminFilter(samples[3].edition, "stored")).toBe(true);
    expect(matchesAdminFilter(samples[2].edition, "progress")).toBe(true);
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
