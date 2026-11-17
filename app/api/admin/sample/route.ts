import { z } from "zod";
import { readConfig } from "@/lib/config";
import { identity } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
import { runtime, jobConfig } from "@/lib/runtime";
import { tradingDay } from "@/lib/calendar";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enqueue"),
    date: z.iso.date(),
    session: z.enum(["pre", "post"]),
  }),
  z.object({ action: z.literal("step") }),
]);
export async function POST(request: Request) {
  const c = readConfig();
  if (c.APP_ENV !== "local" || c.DATA_MODE !== "sample")
    return new Response(null, { status: 404 });
  if (
    !sameOrigin(request.headers, c.BETTER_AUTH_URL) ||
    !(await identity(request.headers))?.admin
  )
    return Response.json(
      { error: "관리자 권한이 필요합니다." },
      { status: 403 },
    );
  try {
    const body = await request.text();
    if (body.length > 1000) throw new Error();
    const command = schema.parse(JSON.parse(body));
    const { repo, worker } = await runtime();
    if (command.action === "enqueue") {
      if (tradingDay(command.date) !== true)
        return Response.json(
          { error: "확인된 미국 거래일을 선택해 주세요." },
          { status: 400 },
        );
      await repo.enqueue(
        command.date,
        command.session,
        jobConfig(),
        new Date(),
      );
      return Response.json({
        message:
          "테스트 회차를 준비했습니다. 대기 작업을 한 단계씩 진행해 주세요. 기존 회차는 그대로 유지됩니다.",
      });
    }
    const result = await worker.tick();
    return Response.json({
      message:
        result === "idle"
          ? "지금 처리할 대기 작업이 없습니다. 다음 처리 시각을 확인하세요."
          : "작업 한 단계를 처리했습니다. 목록에서 현재 상태를 확인하세요.",
    });
  } catch {
    return Response.json(
      {
        error:
          "샘플 작업을 처리하지 못했습니다. 입력과 로컬 DB 상태를 확인하세요.",
      },
      { status: 400 },
    );
  }
}
