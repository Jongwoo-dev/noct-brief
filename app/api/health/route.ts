import { readConfig } from "@/lib/config";
import { pool, assertDatabase } from "@/lib/db";
export async function GET() {
  try {
    const c = readConfig();
    if (c.DATABASE_URL) await assertDatabase(pool(), c.APP_ENV, c.DATA_MODE);
    return Response.json(
      { status: "ok", mode: c.DATA_MODE },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
