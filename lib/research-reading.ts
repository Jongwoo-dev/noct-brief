import { DateTime } from "luxon";
import type { ResearchDossier } from "./research-trial";
import { safeUrl } from "./contract";

function prose(value: string) {
  return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function time(
  value: { value: string; zone: string | null; precision: string } | null,
) {
  if (!value) return "미확인";
  if (value.precision === "date")
    return `${value.value} (${value.zone ?? "시간대 미확인"}, 날짜만 확인)`;
  const dt = DateTime.fromISO(value.value, { setZone: true });
  if (!dt.isValid) return prose(value.value);
  const original = value.zone ? dt.setZone(value.zone) : dt.toUTC();
  const stamp =
    value.precision === "second" ? "yyyy-MM-dd HH:mm:ss" : "yyyy-MM-dd HH:mm";
  return `${dt.setZone("Asia/Seoul").toFormat(stamp)} KST (${original.toFormat(stamp)} ${original.offset === 0 ? "UTC" : original.offsetNameShort})`;
}
export function researchReading(
  label: string,
  date: string,
  status: string,
  dossier: ResearchDossier | null,
  issues: string[],
) {
  const lines = [
    `# 자료수집 후보 ${label}`,
    `미국 거래일 ${date} · 실행 상태 ${status}`,
    "평가 전 수집 원출력입니다. 모델의 확인 표시는 독립 검증 결과가 아닙니다.",
  ];
  if (issues.length)
    lines.push(
      "## 자동 검사에서 확인할 항목",
      ...issues.map((i) => `- ${prose(i)}`),
    );
  if (!dossier)
    return [
      ...lines,
      "읽을 수 있는 구조화된 결과가 없습니다. 원응답 JSON과 중단 사유를 확인해야 합니다.",
      "",
    ].join("\n\n");
  const sources = new Map(dossier.sources.map((s) => [s.id, s]));
  const references = (ids: string[]) =>
    ids
      .map((id) => {
        const source = sources.get(id);
        return source && safeUrl(source.url)
          ? `[${prose(id)}](<${source.url}>)`
          : prose(id);
      })
      .join(" · ");
  const categories: Record<string, string> = {
    indices: "주요 지수",
    breadth: "시장의 상승·하락 폭",
    sectors: "업종",
    macro: "경제·금리·정책",
    corporate: "기업 실적·공시",
    major_event: "주요 사건",
    after_hours: "장후 확인 내용",
  };
  for (const [category, title] of Object.entries(categories)) {
    const facts = dossier.facts.filter((f) => f.category === category);
    if (!facts.length) continue;
    lines.push(`## ${title}`);
    for (const f of facts) {
      lines.push(
        `### ${prose(f.id)} · ${f.kind === "attributed_interpretation" ? "출처의 해석" : "사실"}${f.role === "context" ? " · 배경 자료" : ""}`,
        prose(f.text),
        `중요한 이유: ${prose(f.importance)}`,
        `근거: ${references(f.sourceIds)}`,
      );
      if (f.observedAt) lines.push(`관측: ${time(f.observedAt)}`);
      if (f.occurredAt) lines.push(`발생: ${time(f.occurredAt)}`);
      if (f.period) lines.push(`대상 기간: ${prose(f.period)}`);
      if (f.observation)
        lines.push(
          `수치: ${prose(f.observation.instrument)} ${f.observation.value} ${prose(f.observation.unit)} · ${f.observation.session ?? "세션 해당 없음"} · 비교 기준 ${prose(f.observation.comparison ?? "없음/미확인")}`,
        );
      if (f.attribution) lines.push(`해석 주체: ${prose(f.attribution)}`);
      if (f.caveats.length)
        lines.push(`확인할 점: ${f.caveats.map(prose).join(" / ")}`);
    }
  }
  lines.push("## 예정 이벤트");
  if (!dossier.upcomingEvents.length)
    lines.push(
      "확보한 예정 항목 없음. 아래 조사 범위와 미확인 사항을 함께 확인하세요.",
    );
  for (const event of dossier.upcomingEvents)
    lines.push(
      `### ${time(event.scheduledAt)} · ${prose(event.title)}`,
      prose(event.description),
      `주목할 이유: ${prose(event.importance)}`,
      `당시 일정 확인 근거: ${references(event.sourceIds)} · 공개 시점 ${time(event.knownAt)}`,
    );
  lines.push("## 조사 범위");
  for (const c of dossier.coverage)
    lines.push(
      `- ${c.domain}: **${c.status}**${c.missingReason ? ` — ${prose(c.missingReason)}` : ""}\n  사용 검색어: ${c.searches.map(prose).join(" / ")}`,
    );
  if (dossier.unresolvedConflicts.length)
    lines.push(
      "## 해결되지 않은 차이",
      ...dossier.unresolvedConflicts.map(
        (c) => `- ${prose(c.description)} · ${references(c.sourceIds)}`,
      ),
    );
  if (dossier.limitations.length)
    lines.push(
      "## 자료의 한계",
      ...dossier.limitations.map((l) => `- ${prose(l)}`),
    );
  lines.push("## 출처와 판본 확인");
  for (const s of dossier.sources) {
    lines.push(
      `### ${prose(s.id)} · ${prose(s.title)}`,
      `${prose(s.publisher)} · ${s.type} · ${s.access} · ${references([s.id])}`,
      `게시: ${time(s.publishedAt)} · 수정: ${time(s.updatedAt)}`,
      `모델의 판본 확인: ${s.availability.status} · ${time(s.availability.knownAt)}`,
    );
    if (s.availability.versionEvidence)
      lines.push(
        `판본 근거: ${prose(s.availability.versionEvidence.description)} · ${safeUrl(s.availability.versionEvidence.url) ? `[확인 링크](<${s.availability.versionEvidence.url}>)` : "안전하지 않은 URL 생략"}`,
      );
    lines.push(...s.supportingFacts.map((f) => `- ${prose(f)}`));
  }
  return [...lines, ""].join("\n\n");
}
