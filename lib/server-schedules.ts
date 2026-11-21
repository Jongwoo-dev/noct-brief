import { runTick } from "./scheduler";
import { runBackupMonitor } from "./notifications";
import type { Config } from "./config";

const server = globalThis as typeof globalThis & {
  stopNoctSchedules?: () => void;
};

function runEveryMinute(task: () => Promise<void>, errorMessage: string) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await task();
    } catch {
      console.error(errorMessage);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, 60_000);
  timer.unref();
  void tick();
  return timer;
}

export function startServerSchedules(c: Config) {
  if (server.stopNoctSchedules) return server.stopNoctSchedules;
  const timers: NodeJS.Timeout[] = [];
  if (c.AUTO_PUBLISH_ENABLED)
    timers.push(
      runEveryMinute(
        runTick,
        "예약 발행 점검 실패. 다음 주기에 다시 확인합니다.",
      ),
    );
  if (c.AUTO_BACKUP_ENABLED)
    timers.push(
      runEveryMinute(
        () => runBackupMonitor(c),
        "백업 상태 점검 실패. 다음 주기에 다시 확인합니다.",
      ),
    );
  function stop() {
    if (server.stopNoctSchedules !== stop) return;
    for (const timer of timers) clearInterval(timer);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    delete server.stopNoctSchedules;
  }
  server.stopNoctSchedules = stop;
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return stop;
}
