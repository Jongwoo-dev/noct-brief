import "./env";
import { runTick } from "../lib/scheduler";
import { pool } from "../lib/db";
if (!process.argv.includes("--sample"))
  throw new Error("작업 처리 실패. 수동 실행은 로컬 --sample 전용입니다.");
try {
  await runTick(true);
  console.log("작업 처리 완료");
} catch {
  console.error("작업 처리 실패. 환경 설정과 관리 화면을 확인하세요.");
  process.exitCode = 1;
} finally {
  await pool().end();
}
