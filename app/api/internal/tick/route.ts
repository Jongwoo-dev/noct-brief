import { readConfig } from "@/lib/config";
import { equalSecret } from "@/lib/security";
import { runTick } from "@/lib/scheduler";
export async function POST(request: Request) {
  const c = readConfig();
  if (c.APP_ENV !== "production" || !c.AUTO_PUBLISH_ENABLED)
    return Response.json({ error: "자동 실행 비활성" }, { status: 403 });
  if (
    !equalSecret(
      request.headers.get("authorization") ?? "",
      `Bearer ${c.CRON_SECRET}`,
    )
  )
    return Response.json({ error: "인증 필요" }, { status: 401 });
  try {
    await runTick();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "예약 처리 실패" }, { status: 503 });
  }
}
