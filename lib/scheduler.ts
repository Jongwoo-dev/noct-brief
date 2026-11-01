import { runtime, jobConfig } from "./runtime";
import { dueSlots } from "./calendar";
import { drainNotifications } from "./notifications";
export async function runTick(manualSample = false) {
  const { c, db, repo, worker } = await runtime();
  if (
    manualSample
      ? c.APP_ENV !== "local" || c.DATA_MODE !== "sample"
      : c.APP_ENV !== "production" || !c.AUTO_PUBLISH_ENABLED
  )
    throw new Error("실행 환경 또는 자동 발행 설정을 확인하세요.");
  const now = new Date();
  const last = (
    await db.query("SELECT value FROM app_settings WHERE key='last_scheduler'")
  ).rows[0]?.value;
  // Recover missed slots for up to 31 days; no invented historical content is generated without a collected bundle.
  const since = last
    ? new Date(
        Math.max(Date.parse(last) - 3600000, now.getTime() - 31 * 86400000),
      )
    : new Date(now.getTime() - 12 * 3600000);
  for (const slot of dueSlots(now, since))
    await repo.enqueue(slot.date, slot.session, jobConfig(), now);
  for (let i = 0; i < 8; i++)
    if ((await worker.tick(new Date())) === "idle") break;
  await worker.detectDelays(now);
  if (c.APP_ENV === "production") {
    await db.query(
      "INSERT INTO app_settings(key,value) VALUES('backup_monitor_since',$1) ON CONFLICT DO NOTHING",
      [now.toISOString()],
    );
    const backup = (
      await db.query(
        "SELECT value FROM app_settings WHERE key IN ('last_backup','backup_monitor_since') ORDER BY CASE WHEN key='last_backup' THEN 0 ELSE 1 END LIMIT 1",
      )
    ).rows[0]?.value;
    if (backup && now.getTime() - Date.parse(backup) > 26 * 3600000)
      await db.query(
        "INSERT INTO notification_outbox(id,dedupe_key,kind,message,next_at) VALUES(gen_random_uuid(),$1,'backup_stale','DB 외부 백업 성공 기록이 하루 이상 갱신되지 않았습니다.',$2) ON CONFLICT DO NOTHING",
        [`backup_stale:${backup}`, now],
      );
  }
  await drainNotifications(db, c);
  await db.query(
    "INSERT INTO app_settings(key,value) VALUES('last_scheduler',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [now.toISOString()],
  );
}
