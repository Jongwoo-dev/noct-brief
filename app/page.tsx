import Link from "next/link";
import { publicData, archive } from "@/lib/queries";
import { DateTime } from "luxon";
import { upcoming, kst, sessionLabel } from "@/lib/calendar";
import { BriefingCard } from "@/components/briefing-card";
import { UiIcon } from "@/components/ui-icon";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { sample, now, list, delays } = await publicData();
  const next = upcoming(now)[0];
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") &&
    DateTime.fromISO(params.date!).isValid
      ? params.date
      : "";
  const session = ["pre", "post"].includes(params.session ?? "")
    ? params.session
    : "";
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.page) || 1)),
  );
  const latest = list[0];
  const filtered = await archive({
    date,
    session,
    page,
    excludeId: latest?.id,
  });
  const pageLink = (p: number) =>
    `/?${new URLSearchParams({ date: date ?? "", session: session ?? "", page: String(p) })}#archive`;
  return (
    <main id="main" className="home">
      <section className="intro">
        <div>
          <h1>미국 증시 브리핑</h1>
        </div>
        <section className="schedule" aria-label="다음 발행 안내">
          <div className="schedule-label">
            <UiIcon name="calendar" />
            다음 발행
          </div>
          {next ? (
            <div>
              <strong>
                {sessionLabel(next.session)} · {kst(next.targetAt)} KST 예정
              </strong>
              <small>
                대상 미국 거래일 {next.date}
                {next.earlyClose ? " · 조기 폐장일 (13:00 ET)" : ""}
              </small>
            </div>
          ) : (
            <p>공식 거래일 달력 확인이 필요해 다음 일정은 미정입니다.</p>
          )}
        </section>
      </section>
      {sample && (
        <aside className="sample-banner">
          <span className="badge">
            <UiIcon name="info" />
            가상 데이터
          </span>
          <p>
            화면 확인용 샘플입니다. 실제 시황이 아닙니다.
            {!process.env.DATABASE_URL &&
              " 발행 예정은 샘플 기준 시각으로 표시합니다."}
          </p>
        </aside>
      )}
      {delays.map((d) => (
        <aside className="delay" key={d.id}>
          <strong>
            미국 {d.us_trading_date} {sessionLabel(d.session)} · 발행 지연
          </strong>
          <p>
            {d.state === "waiting_data"
              ? "주요 어닝콜 자료를 확인하고 있습니다. 자료 대기는 목표 시각부터 최대 한 시간입니다."
              : "발행이 지연되고 있습니다. 확인되는 대로 상태를 안내하겠습니다."}
          </p>
        </aside>
      ))}
      {latest ? (
        <section className="latest-feature" aria-label="최신 브리핑">
          <BriefingCard briefing={latest} />
        </section>
      ) : (
        <div className="empty">
          <h2>첫 브리핑을 준비하고 있습니다.</h2>
          <p>공개된 글은 이곳에서 확인하실 수 있습니다.</p>
        </div>
      )}
      <section id="archive" className="archive">
        <div className="archive-toolbar">
          <div className="section-heading">
            <div>
              <h2>지난 브리핑</h2>
              <p className="meta">미국 거래일 기준</p>
            </div>
          </div>
          <form
            key={`${date ?? ""}:${session ?? ""}`}
            className="filters"
            action="/#archive"
          >
            <label>
              미국 거래일
              <input type="date" name="date" defaultValue={date} />
            </label>
            <label>
              브리핑
              <select name="session" defaultValue={session}>
                <option value="">전체</option>
                <option value="pre">장전</option>
                <option value="post">장후</option>
              </select>
            </label>
            <button type="submit">적용</button>
            {(date || session) && <Link href="/#archive">초기화</Link>}
          </form>
        </div>
        <div className="archive-list">
          {filtered.days.length ? (
            filtered.days.map((day) => (
              <section
                className="archive-day"
                key={day.date}
                aria-labelledby={`day-${day.date}`}
              >
                <h3 className="archive-date" id={`day-${day.date}`}>
                  <strong>{day.date.slice(5).replace("-", ".")}</strong>
                  <span>{day.date.slice(0, 4)} · 미국 거래일</span>
                </h3>
                <div className="archive-editions">
                  {day.briefings.map((b) => (
                    <article key={b.id}>
                      <span className="archive-session">
                        <UiIcon name={b.content.session} />
                        {sessionLabel(b.content.session)}
                      </span>
                      <div className="archive-body">
                        <h4>
                          <Link href={`/briefings/${b.id}`}>
                            {b.content.draft.title}
                          </Link>
                        </h4>
                        <p>
                          {kst(b.publishedAt)} KST 발행
                          {b.content.bundle.missing.length > 0 &&
                            " · 일부 자료 미반영"}
                          {b.correctedAt && " · 정정됨"}
                        </p>
                      </div>
                      <span className="archive-arrow" aria-hidden="true">
                        <UiIcon name="forward" />
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="empty">
              <p>
                {date || session
                  ? "조건에 맞는 지난 브리핑이 없습니다."
                  : page > 1
                    ? "이 페이지에 지난 브리핑이 없습니다."
                    : "아직 지난 브리핑이 없습니다."}
              </p>
              {(date || session) && <Link href="/#archive">필터 초기화</Link>}
            </div>
          )}
        </div>
        <nav className="pagination" aria-label="지난 글 페이지">
          {page > 1 && <Link href={pageLink(page - 1)}>← 이전</Link>}
          {filtered.hasMore && (
            <Link href={pageLink(page + 1)}>이전 회차 더 보기 →</Link>
          )}
        </nav>
      </section>
    </main>
  );
}
