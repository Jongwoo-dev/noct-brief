import { afterEach, expect, it, vi } from "vitest";
import { startServerSchedules } from "../lib/server-schedules";
import { readConfig } from "../lib/config";
import { runBackupMonitor } from "../lib/notifications";
import { runTick } from "../lib/scheduler";
import { register } from "../instrumentation";

vi.mock("../lib/scheduler", () => ({ runTick: vi.fn() }));
vi.mock("../lib/notifications", () => ({ runBackupMonitor: vi.fn() }));
const production = {
  APP_ENV: "production",
  DATA_MODE: "live",
  DATABASE_URL: "postgresql://localhost/test",
  BETTER_AUTH_URL: "https://example.invalid",
};
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(runTick).mockReset();
  vi.mocked(runBackupMonitor).mockReset();
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
  const c = readConfig({
    ...production,
    AUTO_PUBLISH_ENABLED: "true",
    AUTO_BACKUP_ENABLED: "true",
    EXTERNAL_CALLS_ENABLED: "true",
  });
  stop = startServerSchedules(c);
  expect(startServerSchedules(c)).toBe(stop);
  await vi.advanceTimersByTimeAsync(120000);
  expect(runTick).toHaveBeenCalledTimes(1);
  expect(runBackupMonitor).toHaveBeenCalledTimes(3);
  finish();
  await vi.advanceTimersByTimeAsync(120000);
  expect(runTick).toHaveBeenCalledTimes(3);
  expect(runBackupMonitor).toHaveBeenCalledTimes(5);
  stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(runTick).toHaveBeenCalledTimes(3);
});

it("등록은 명시적으로 활성화한 운영 Node 서버에서만 한다", async () => {
  vi.useFakeTimers();
  for (const [key, value] of Object.entries({
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    ...production,
    AUTO_BACKUP_ENABLED: "false",
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
    expect(runBackupMonitor).not.toHaveBeenCalled();
    vi.stubEnv(key, orig);
  }
  await register();
  expect(runTick).toHaveBeenCalledTimes(1);
  stop = startServerSchedules(readConfig());
  expect(runBackupMonitor).not.toHaveBeenCalled();
});

it("백업만 켠 운영 서버는 모델 사용 없이 백업만 점검하고 종료하면 점검을 멈춘다", async () => {
  vi.useFakeTimers();
  for (const [key, value] of Object.entries({
    ...production,
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    AUTO_PUBLISH_ENABLED: "false",
    AUTO_BACKUP_ENABLED: "true",
    EXTERNAL_CALLS_ENABLED: "false",
  }))
    vi.stubEnv(key, value);
  await register();
  expect(runBackupMonitor).toHaveBeenCalledTimes(1);
  stop = startServerSchedules(readConfig());
  await vi.advanceTimersByTimeAsync(60000);
  expect(runTick).not.toHaveBeenCalled();
  expect(runBackupMonitor).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(runBackupMonitor).toHaveBeenCalledTimes(2);
});
