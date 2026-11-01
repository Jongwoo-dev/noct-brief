import Link from "next/link";
import type { PublicBriefing } from "@/lib/contract";
import { kst, sessionLabel } from "@/lib/calendar";
import { UiIcon } from "./ui-icon";
export function BriefingCard({ briefing }: { briefing: PublicBriefing }) {
  const b = briefing;
  const summary = b.content.draft.summary[0]?.text;
  const readLink = (
    <Link
      className="read-link"
      href={`/briefings/${b.id}`}
      aria-label={`${b.content.draft.title} 읽기`}
    >
      브리핑 읽기 <UiIcon name="forward" />
    </Link>
  );
  return (
    <article className="briefing-card primary">
      <div className="card-heading">
        <span className="card-status">
          <UiIcon name={b.content.session} />
          최신 {sessionLabel(b.content.session)} 브리핑
        </span>
        <time className="card-date" dateTime={b.content.date}>
          미국 {b.content.date}
        </time>
      </div>
      <h2>
        <Link href={`/briefings/${b.id}`}>{b.content.draft.title}</Link>
      </h2>
      <p className="card-summary">
        {summary ?? "확인 가능한 자료가 적어 핵심 요약 없이 발행했습니다."}
      </p>
      {b.content.bundle.missing.length > 0 && (
        <p className="notice-inline">일부 자료 미반영</p>
      )}
      <div className="card-bottom">
        {readLink}
        <p className="card-published">
          <time dateTime={b.publishedAt}>{kst(b.publishedAt)} KST</time> 발행
        </p>
      </div>
    </article>
  );
}
