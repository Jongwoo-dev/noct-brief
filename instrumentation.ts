export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (
      process.env.NODE_ENV !== "production" ||
      process.env.NEXT_PHASE === "phase-production-build"
    )
      return;
    const { readConfig } = await import("./lib/config");
    const c = readConfig();
    if (c.APP_ENV !== "production" || !c.AUTO_PUBLISH_ENABLED) return;

    const { startPublishingSchedule } =
      await import("./lib/publishing-schedule");
    startPublishingSchedule();
  }
}
