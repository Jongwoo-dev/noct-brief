import type { Content } from "./contract";
import type { JobState } from "./repository";
import { z } from "zod";

export type AdminJob = {
  id: string;
  kind: "initial" | "correction";
  state: JobState;
  attempt: number;
  errorCode: string | null;
  createdAt: string;
  nextAt: string;
  baseVersion: string | null;
  cutoffAt: string | null;
  missing: string[];
  model: string;
  usage: unknown;
};
export type AdminEdition = {
  id: string;
  date: string;
  session: "pre" | "post";
  targetAt: string;
  publishedAt: string | null;
  visible: boolean;
  version: string;
  title: string | null;
  versionCount: number;
  job: AdminJob | null;
};
export type AdminVersion = {
  id: string;
  createdAt: string;
  reason: string | null;
  change: string | null;
  content: Content;
};
export type AdminNotice = {
  briefing_id: string | null;
  kind: string;
  status: string;
  attempts: number;
};
export const stateLabels: Record<JobState, string> = {
  queued: "처리 대기",
  collecting: "자료 확인 중",
  submitting: "생성 요청 중",
  generating: "작성 중",
  validating: "검증 중",
  ready: "발행 시각 대기",
  waiting_data: "콜 자료 대기",
  retry_wait: "자동 재시도 대기",
  failed: "확인 필요",
  published: "처리 완료",
};
export function adminActions(edition: Pick<AdminEdition, "version" | "job">) {
  const j = edition.job;
  const active = !!j && !["failed", "published"].includes(j.state);
  const unknown = j?.errorCode === "SUBMISSION_UNKNOWN";
  const stale = j?.kind === "correction" && j.baseVersion !== edition.version;
  return {
    retry: !!j && j.state === "failed" && !unknown && !stale,
    correct: !!edition.version && !active && !unknown,
    visibility: !!edition.version,
  };
}
export const adminErrors: Record<string, string> = {
  COMMAND_REPLAY: "이미 처리한 요청입니다. 새로고침해 현재 상태를 확인하세요.",
  BRIEFING_NOT_FOUND: "회차를 찾을 수 없습니다.",
  VERSION_CONFLICT: "보고서 버전이 바뀌었습니다. 새로고침 후 다시 확인하세요.",
  JOB_CONFLICT: "작업 상태가 바뀌었습니다. 새로고침 후 다시 확인하세요.",
  ACTIVE_JOB: "이미 처리 중인 작업이 있습니다. 완료 후 다시 요청하세요.",
  SUBMISSION_UNKNOWN:
    "외부 요청의 접수 여부를 확인해야 합니다. 중복 과금을 막기 위해 재요청을 중단했습니다.",
  RETRY_NOT_AVAILABLE: "지금 재시도할 수 있는 실패 작업이 없습니다.",
  EVIDENCE_REQUIRED:
    "잘못된 항목, 정정 이유, HTTPS 근거 주소를 모두 입력하세요.",
};
export function errorExplanation(code: string | null) {
  if (!code) return null;
  if (adminErrors[code]) return adminErrors[code];
  if (/SPEND_LIMIT|USAGE_LIMIT|CREDIT_BALANCE/.test(code))
    return "API 지출 한도 또는 잔액을 확인한 뒤 재시도하세요.";
  if (code === "DATA_PROVIDER_NOT_CONFIGURED")
    return "자료 수집 경로가 연결되지 않았습니다. 자료를 준비한 뒤 재시도하세요.";
  if (code === "CORRECTION_EVIDENCE_REQUIRED")
    return "정정 근거가 포함된 자료 묶음이 필요합니다. 현재 보고서는 유지됩니다.";
  if (code === "HTTP_429")
    return "외부 서비스의 호출 제한에 도달했습니다. 처리 상태와 다음 시각을 확인하세요.";
  return "작업을 완료하지 못했습니다. 원인을 확인한 뒤 가능한 작업을 선택하세요.";
}
export const adminFilters = {
  all: "전체",
  attention: "확인 필요",
  progress: "처리 중",
  stored: "보관된 보고서",
} as const;
export type AdminFilter = keyof typeof adminFilters;
export function adminSearch(
  params: Record<string, string | string[] | undefined>,
) {
  const rawFilter = typeof params.filter === "string" ? params.filter : "all";
  const filter = Object.hasOwn(adminFilters, rawFilter)
    ? (rawFilter as AdminFilter)
    : "all";
  const parsedDate = z.iso.date().safeParse(params.date);
  const number = Number(params.page);
  return {
    filter,
    date: parsedDate.success ? parsedDate.data : "",
    page:
      Number.isSafeInteger(number) && number > 0 ? Math.min(number, 100000) : 1,
  };
}
export function matchesAdminFilter(b: AdminEdition, filter: AdminFilter) {
  if (filter === "attention") return b.job?.state === "failed";
  if (filter === "progress")
    return !!b.job && !["failed", "published"].includes(b.job.state);
  if (filter === "stored") return !!b.version;
  return true;
}
