import "./env";
import { randomUUID } from "node:crypto";
import { pool, assertDatabase, transaction } from "../lib/db";
import { readConfig } from "../lib/config";
import { samples } from "../data/samples";
import { Repository } from "../lib/repository";
import { validateContent } from "../lib/contract";
const c = readConfig();
if (c.APP_ENV !== "local" || c.DATA_MODE !== "sample")
  throw new Error("로컬 샘플 전용 명령입니다.");
await assertDatabase(pool(), "local");
const repo = new Repository(pool(), "sample");
for (const b of samples) {
  validateContent(b.content, "sample");
  await repo.ensureSlot(b.content.date, b.content.session);
  await transaction(pool(), async (tx) => {
    const row = (
      await tx.query(
        "SELECT current_version_id FROM briefings WHERE id=$1 FOR UPDATE",
        [b.id],
      )
    ).rows[0];
    if (row.current_version_id) return;
    const id = randomUUID();
    await tx.query(
      "INSERT INTO briefing_versions(id,briefing_id,content,created_at,config,validated) VALUES($1,$2,$3,$4,$5,true)",
      [
        id,
        b.id,
        b.content,
        b.publishedAt,
        { mode: "sample", model: "sample", promptVersion: "noct-v1" },
      ],
    );
    await tx.query(
      "UPDATE briefings SET current_version_id=$1,visible=true,published_at=$2 WHERE id=$3",
      [id, b.publishedAt, b.id],
    );
  });
}
await pool().end();
console.log("가상 브리핑 저장 완료");
