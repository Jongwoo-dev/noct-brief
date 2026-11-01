import { getAuth } from "@/lib/auth";
export async function GET(request: Request) {
  const auth = getAuth();
  return auth
    ? auth.handler(request)
    : Response.json(
        { error: "Google 로그인 설정이 필요합니다." },
        { status: 503 },
      );
}
export const POST = GET;
