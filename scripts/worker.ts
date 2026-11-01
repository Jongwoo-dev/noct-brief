import "./env";
import { runTick } from "../lib/scheduler";
import { pool } from "../lib/db";
try {
  await runTick(process.argv.includes("--sample"));
  console.log("작업 처리 완료");
} catch {
  console.error("작업 처리 실패. 환경 설정과 관리 화면을 확인하세요.");
  process.exitCode = 1;
} finally {
  await pool().end();
}
