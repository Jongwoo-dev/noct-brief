import { getAuth } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { pool, assertDatabase } from "@/lib/db";
import { sameOrigin } from "@/lib/security";
export async function GET(request: Request) {
  const auth = getAuth();
  if (!auth)
    return Response.json(
      { error: "Google 로그인 설정이 필요합니다." },
      { status: 503 },
    );
  const c = readConfig();
  await assertDatabase(pool(), c.APP_ENV, c.DATA_MODE);
  return auth.handler(request);
}
export async function POST(request: Request) {
  if (!sameOrigin(request.headers, readConfig().BETTER_AUTH_URL))
    return Response.json(
      { error: "요청 출처를 확인할 수 없습니다." },
      { status: 403 },
    );
  return GET(request);
}
