import "./env";
import { randomUUID } from "node:crypto";
import { pool, assertDatabase, transaction } from "../lib/db";
import { readConfig } from "../lib/config";
import { sampleContent, samples } from "../data/samples";
import { schedule } from "../lib/calendar";
import { validateContent, type Content } from "../lib/contract";
import { jobConfig } from "../lib/runtime";
const c = readConfig();
if (c.APP_ENV !== "local" || c.DATA_MODE !== "sample")
  throw new Error("로컬 샘플 전용 명령입니다.");
await assertDatabase(pool(), "local", "sample");
const config = jobConfig();
type CorrectionCase = "HTTP_429" | "SUBMISSION_UNKNOWN" | "ready";
const editions: { content: Content; correction?: CorrectionCase }[] = [
  ...samples.map(({ content }) => ({ content })),
  { content: sampleContent("2026-10-29", "pre"), correction: "HTTP_429" },
  {
    content: sampleContent("2026-10-30", "pre"),
    correction: "SUBMISSION_UNKNOWN",
  },
  { content: sampleContent("2026-11-02", "pre"), correction: "ready" },
];
try {
  await transaction(pool(), async (tx) => {
    for (const { content, correction } of editions) {
      const slot = schedule(content.date, content.session);
      const inserted = await tx.query(
        `INSERT INTO briefings(id,us_trading_date,session,target_at,published_at,visible)
       VALUES($1,$2,$3,$4,$4,$5) ON CONFLICT DO NOTHING`,
        [slot.id, slot.date, slot.session, slot.targetAt, !correction],
      );
      if (!inserted.rowCount) continue;
      const baseVersion = randomUUID();
      await tx.query(
        "INSERT INTO briefing_versions(id,briefing_id,content,created_at,config,validated) VALUES($1,$2,$3,$4,$5,true)",
        [
          baseVersion,
          slot.id,
          validateContent(content, "sample"),
          slot.targetAt,
          config,
        ],
      );
      await tx.query("UPDATE briefings SET current_version_id=$1 WHERE id=$2", [
        baseVersion,
        slot.id,
      ]);
      if (!correction) continue;
      const ready = correction === "ready";
      const createdAt = new Date(
        Date.parse(slot.targetAt) + 60_000,
      ).toISOString();
      const change = "제목에 정정 표기를 추가했습니다.";
      const payload = {
        baseVersion,
        reason: "로컬 관리자 정정 흐름 확인용 가상 요청",
        issue: "제목의 정정 표기",
        evidenceUrl: content.bundle.sources[0].url,
        bundle: content.bundle,
        content: ready
          ? validateContent(
              {
                ...content,
                generatedAt: createdAt,
                draft: {
                  ...content.draft,
                  title: `[정정] ${content.draft.title}`,
                },
              },
              "sample",
            )
          : content,
        ...(ready && { change }),
      };
      await tx.query(
        `INSERT INTO jobs(id,briefing_id,kind,dedupe_key,state,error_code,attempt,next_at,created_at,config,payload)
       VALUES($1,$2,'correction',$3,$4,$5,$6,$7,$7,$8,$9)`,
        [
          randomUUID(),
          slot.id,
          `sample:correction:${slot.id}`,
          ready ? "ready" : "failed",
          ready ? null : correction,
          correction === "HTTP_429" ? 3 : 0,
          createdAt,
          config,
          payload,
        ],
      );
    }
  });
} finally {
  await pool().end();
}
console.log("가상 브리핑 저장 완료");
