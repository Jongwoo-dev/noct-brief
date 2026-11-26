import "./env";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  assertEvidenceAsOf,
  BundleSchema,
  hasDateOnlyEvidence,
  hasPrivateResearch,
} from "../lib/contract";
import { runtime } from "../lib/runtime";
const [date, session, file, flag, sourceId, ...extra] = process.argv.slice(2);
if (
  !date ||
  !["pre", "post"].includes(session) ||
  !file ||
  (flag !== undefined && (flag !== "--correction-source" || !sourceId)) ||
  extra.length
)
  throw new Error(
    "사용법: npx tsx scripts/import-bundle.ts YYYY-MM-DD pre|post FILE [--correction-source SOURCE_ID]",
  );
const bundle = BundleSchema.parse(JSON.parse(await readFile(file, "utf8")));
if (hasDateOnlyEvidence(bundle))
  throw new Error("날짜만 확인된 근거는 비공개 시험에서만 사용할 수 있습니다.");
if (hasPrivateResearch(bundle))
  throw new Error("비공개 품질 시험 자료는 앱 DB에 반입할 수 없습니다.");
const { repo, db, c } = await runtime();
if (
  c.DATA_MODE === "live" &&
  bundle.sources.some((s) => s.rights !== "approved" || s.method === "sample")
)
  throw new Error("공개 권한이 확인된 자료만 반입할 수 있습니다.");
if (c.DATA_MODE === "live") {
  const correctionSource = sourceId
    ? bundle.sources.find((s) => s.id === sourceId)
    : undefined;
  if (sourceId && !correctionSource)
    throw new Error("정정 근거 ID를 찾을 수 없습니다.");
  assertEvidenceAsOf(bundle, new Date(), correctionSource?.url);
}
const slot = await repo.ensureSlot(date, session as "pre" | "post");
await db.query(
  "INSERT INTO collection_bundles(briefing_id,revision,collected_at,bundle) VALUES($1,$2,$3,$4)",
  [slot.id, randomUUID(), new Date(), bundle],
);
await db.end();
console.log("근거 묶음 반입 완료. 자동 공개 승인을 뜻하지 않습니다.");
