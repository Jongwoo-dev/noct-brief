import { afterEach, expect, it, vi } from "vitest";
import { startPublishingSchedule } from "../lib/publishing-schedule";
import { runTick } from "../lib/scheduler";
import { register } from "../instrumentation";

vi.mock("../lib/scheduler", () => ({ runTick: vi.fn() }));
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(runTick).mockReset();
});

it("서버 시작 때 즉시 실행하고 중복 등록·작업 중 겹침을 막으며 오류 뒤 다음 분에 재개한다", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(runTick)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("test"))
    .mockResolvedValue(undefined);
  stop = startPublishingSchedule();
  expect(startPublishingSchedule()).toBe(stop);
  await vi.advanceTimersByTimeAsync(120000);
  expect(runTick).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(120000);
  expect(runTick).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(runTick).toHaveBeenCalledTimes(3);
});

it("등록은 명시적으로 활성화한 운영 Node 서버에서만 한다", async () => {
  vi.useFakeTimers();
  for (const [key, value] of Object.entries({
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    APP_ENV: "production",
    DATA_MODE: "live",
    DATABASE_URL: "postgresql://localhost/test",
    BETTER_AUTH_URL: "https://example.invalid",
    AUTO_PUBLISH_ENABLED: "true",
    EXTERNAL_CALLS_ENABLED: "true",
  }))
    vi.stubEnv(key, value);
  for (const [key, value] of [
    ["NEXT_PHASE", "phase-production-build"],
    ["NODE_ENV", "development"],
    ["NEXT_RUNTIME", "edge"],
    ["AUTO_PUBLISH_ENABLED", "false"],
  ]) {
    const orig = process.env[key];
    vi.stubEnv(key, value);
    await register();
    expect(runTick).not.toHaveBeenCalled();
    vi.stubEnv(key, orig);
  }
  await register();
  stop = startPublishingSchedule();
  expect(runTick).toHaveBeenCalledTimes(1);
});
