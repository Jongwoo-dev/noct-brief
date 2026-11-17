import { z } from "zod";
import { identity } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { sameOrigin } from "@/lib/security";
import { runtime, jobConfig } from "@/lib/runtime";
import { safeUrl } from "@/lib/contract";
import { adminErrors } from "@/lib/admin";
const commandSchema = z.object({
  id: z.uuid(),
  action: z.enum(["hide", "restore", "retry", "correct"]),
  briefingId: z.string().regex(/^\d{4}-\d{2}-\d{2}-(pre|post)$/),
  baseVersion: z.string().max(100),
  reason: z.string().max(2000).optional(),
  issue: z.string().max(2000).optional(),
  evidenceUrl: z.string().refine(safeUrl).optional(),
  jobId: z.uuid().optional(),
});
export async function POST(request: Request) {
  if (!sameOrigin(request.headers, readConfig().BETTER_AUTH_URL))
    return Response.json(
      { error: "요청 출처를 확인할 수 없습니다." },
      { status: 403 },
    );
  if (!(await identity(request.headers))?.admin)
    return Response.json(
      { error: "관리자 권한이 필요합니다." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > 12000)
    return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  try {
    const text = await request.text();
    if (text.length > 12000) throw new Error("REQUEST_LIMIT");
    const command = commandSchema.parse(JSON.parse(text));
    if (
      command.action === "correct" &&
      (!command.issue?.trim() ||
        !command.reason?.trim() ||
        !command.evidenceUrl)
    )
      throw new Error("EVIDENCE_REQUIRED");
    if (command.action === "retry" && !command.jobId)
      throw new Error("JOB_CONFLICT");
    const { repo } = await runtime();
    await repo.adminCommand(command, jobConfig(), new Date());
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && adminErrors[error.message]
            ? adminErrors[error.message]
            : "요청을 적용하지 못했습니다. 입력과 현재 상태를 확인하고 새로고침하세요.",
      },
      { status: 409 },
    );
  }
}
