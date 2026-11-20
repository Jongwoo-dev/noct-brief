import { afterEach, expect, it, vi } from "vitest";
import { runTick } from "../lib/scheduler";
import { runtime } from "../lib/runtime";
import { readConfig } from "../lib/config";

vi.mock("../lib/runtime", () => ({
  runtime: vi.fn(),
  jobConfig: () => ({ mode: "sample" }),
}));
afterEach(() => vi.useRealTimers());

it("첫 예약은 최근 12시간, 장기 중단은 31일까지 회복하고 한 번에 최대 8단계 처리", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-30T12:00:00Z"));
  let last: string | undefined;
  const query = vi.fn(async (sql: string) => ({
    rows: sql.startsWith("SELECT") && last ? [{ value: last }] : [],
  }));
  const enqueue = vi.fn();
  const tick = vi.fn().mockResolvedValue("processed");
  const ctx = {
    c: readConfig({}),
    db: { query },
    repo: { enqueue },
    worker: { tick, detectDelays: vi.fn() },
  };
  vi.mocked(runtime).mockResolvedValue(
    ctx as unknown as Awaited<ReturnType<typeof runtime>>,
  );
  await runTick(true);
  expect(enqueue.mock.calls.map(([date, session]) => [date, session])).toEqual([
    ["2026-11-30", "pre"],
  ]);
  expect(tick).toHaveBeenCalledTimes(8);
  last = "2026-09-01T00:00:00Z";
  enqueue.mockClear();
  tick.mockReset().mockResolvedValue("idle");
  await runTick(true);
  const slots = enqueue.mock.calls.map(
    ([date, session]) => date + "-" + session,
  );
  expect(slots[0]).toBe("2026-10-30-post");
  expect(slots.at(-1)).toBe("2026-11-30-pre");
  expect(slots).not.toContain("2026-11-26-pre");
  expect(tick).toHaveBeenCalledTimes(1);
});
