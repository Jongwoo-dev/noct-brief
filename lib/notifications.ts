import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Config } from "./config";
export async function drainNotifications(
  db: pg.Pool,
  c: Config,
  request: typeof fetch = fetch,
  now = new Date(),
) {
  if (c.APP_ENV !== "production" || !c.TELEGRAM_ENABLED)
    return { sent: 0, disabled: true };
  const owner = randomUUID();
  const r = await db.query(
    `WITH selected AS (SELECT id FROM notification_outbox WHERE status='pending' AND next_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ORDER BY next_at LIMIT 5 FOR UPDATE SKIP LOCKED) UPDATE notification_outbox n SET owner=$2,lease_until=$1::timestamptz+interval '60 seconds' FROM selected s WHERE n.id=s.id RETURNING n.*`,
    [now, owner],
  );
  let sent = 0;
  for (const row of r.rows) {
    try {
      const response = await request(
        `https://api.telegram.org/bot${c.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: c.TELEGRAM_CHAT_ID,
            text: `NOCT Brief · ${row.briefing_id ?? "운영"}\n${row.message}\n${c.BETTER_AUTH_URL}/admin`,
            link_preview_options: { is_disabled: true },
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error("DELIVERY_FAILED");
      await db.query(
        "UPDATE notification_outbox SET status='sent',sent_at=$1,owner=NULL,lease_until=NULL WHERE id=$2 AND owner=$3",
        [now, row.id, owner],
      );
      sent++;
    } catch {
      const tries = row.attempts + 1;
      await db.query(
        "UPDATE notification_outbox SET attempts=$1,status=$2,next_at=$3,owner=NULL,lease_until=NULL WHERE id=$4 AND owner=$5",
        [
          tries,
          tries >= 4 ? "failed" : "pending",
          new Date(now.getTime() + [1, 5, 15, 15][tries - 1] * 60000),
          row.id,
          owner,
        ],
      );
    }
  }
  return { sent, disabled: false };
}
