import { runTick } from "./scheduler";

const server = globalThis as typeof globalThis & {
  stopNoctPublishing?: () => void;
};

export function startPublishingSchedule() {
  if (server.stopNoctPublishing) return server.stopNoctPublishing;

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await runTick();
    } catch {
      console.error("예약 발행 점검 실패. 다음 주기에 다시 확인합니다.");
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, 60_000);
  timer.unref();
  function stop() {
    if (server.stopNoctPublishing !== stop) return;
    clearInterval(timer);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    delete server.stopNoctPublishing;
  }
  server.stopNoctPublishing = stop;
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  void tick();
  return stop;
}
