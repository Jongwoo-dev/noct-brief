import Link from "next/link";
import { notFound } from "next/navigation";
import { detail, neighbors } from "@/lib/queries";
import {
  earlyClose,
  schedule as marketSchedule,
  sessionLabel,
} from "@/lib/calendar";
import {
  formatKoreaTime,
  formatMarketTime,
  formatSourcePublication,
  formatSourceTime,
} from "@/lib/report-time";
import { Chart } from "@/components/chart";
import "@/templates/report-reading.css";
import "../report-page.css";
import { UiIcon } from "@/components/ui-icon";
import {
  CitationProvider,
  SourceReturnLink,
} from "@/components/citation-navigation";
import { SourceReferences } from "@/components/source-references";
import {
  eventTimeLabel,
  isUpcomingSection,
  upcomingEvents,
  type Content,
  type Draft,
} from "@/lib/contract";
export const dynamic = "force-dynamic";
const kindLabel = {
  fact: "확인한 사실",
  source_interpretation: "출처의 해석",
  ai_inference: "가능한 해석",
};
function Claim({
  claim,
  content,
  number,
  referenceId,
  upcoming = false,
}: {
  claim: Content["draft"]["summary"][number];
  content: Content;
  number?: number;
  referenceId: string;
  upcoming?: boolean;
}) {
  const [eventHeading, ...eventLines] = claim.text.split("\n");
  const separator = upcoming ? eventHeading.indexOf(" | ") : -1;
  const event = separator > 0 && separator + 3 < eventHeading.length;
  const Wrapper = upcoming ? "li" : "div";
  return (
    <Wrapper className="claim">
      <div className="claim-heading">
        {number && (
          <span className="summary-number">
            {String(number).padStart(2, "0")}
          </span>
        )}
        <span className={`claim-kind ${claim.kind}`}>
          {kindLabel[claim.kind]}
        </span>
      </div>
      {event && (
        <>
          <p className="schedule-time">{eventHeading.slice(0, separator)}</p>
          <h3>{eventHeading.slice(separator + 3)}</h3>
        </>
      )}
      <p className={upcoming ? "schedule-copy" : undefined}>
        {event ? eventLines.join("\n") : claim.text}
        <SourceReferences
          sourceIds={claim.sourceIds}
          content={content}
          referenceId={referenceId}
        />
      </p>
      {claim.limitation && <p className="note">{claim.limitation}</p>}
    </Wrapper>
  );
}
function DraftSection({
  section,
  index,
  content,
  upcoming = false,
}: {
  section: Draft["sections"][number];
  index: number;
  content: Content;
  upcoming?: boolean;
}) {
  const Heading = upcoming || content.session === "post" ? "h3" : "h2";
  const Claims = upcoming ? "ul" : "div";
  return (
    <section id={section.id} className="section">
      <div className="section-number">
        {String(index + 1).padStart(2, "0")} ·{" "}
        {
          {
            market: "시장 현황",
            events: "주요 사건",
            earnings: "실적·어닝콜",
            outlook: "다음 확인점",
            trend: "흐름 점검",
          }[section.type]
        }
      </div>
      <Heading className="market-topic">{section.title}</Heading>
      <Claims
        className={upcoming ? "schedule" : undefined}
        role={upcoming ? "list" : undefined}
      >
        {section.claims.map((claim, i) => (
          <Claim
            key={claim.id}
            claim={claim}
            content={content}
            referenceId={`section-${section.id}-${i}`}
            upcoming={upcoming}
          />
        ))}
      </Claims>
      {section.chartIds.map((id) => (
        <Chart
          key={id}
          chart={content.charts.find((g) => g.id === id)!}
          content={content}
          referenceId={`chart-${section.id}-${id}`}
        />
      ))}
    </section>
  );
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const b = await detail((await params).id);
  return {
    title: b
      ? "content" in b
        ? b.content.draft.title
        : "브리핑 미발행 안내"
      : "브리핑을 찾을 수 없습니다",
    robots:
      b && (!("content" in b) || b.content.sample)
        ? { index: false, follow: false }
        : undefined,
  };
}
export default async function Briefing({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const b = await detail(id);
  if (!b) notFound();
  if (!("content" in b))
    return (
      <main id="main" className="report-reading report-web">
        <Link className="back" href="/#archive">
          <UiIcon name="back" /> 지난 브리핑
        </Link>
        <header className="article-header reading-copy">
          <div className="eyebrow">
            <span className="session-label">
              <UiIcon name={b.session} />
              {sessionLabel(b.session)} 브리핑
            </span>{" "}
            미국 거래일 {b.date}
          </div>
          <h1 className="report-title">브리핑 미발행 안내</h1>
          <p>
            다음 정규 회차의 발행 시각까지 이 브리핑을 발행하지 못해 해당 회차를
            마감했습니다.
          </p>
          <dl className="article-meta">
            <div>
              <dt>발행 예정 시각</dt>
              <dd>
                <time dateTime={b.targetAt}>
                  {formatMarketTime(b.targetAt)}
                </time>
              </dd>
            </div>
          </dl>
        </header>
      </main>
    );
  const c = b.content;
  const post = c.session === "post";
  const schedule = post ? upcomingEvents(c.date, c.bundle) : null;
  const scheduledIds = new Set(schedule?.events.map((event) => event.id));
  const upcomingSections = c.draft.sections.filter((s) =>
    isUpcomingSection(s, scheduledIds),
  );
  const resultsSections = c.draft.sections.filter(
    (s) => !upcomingSections.includes(s),
  );
  const events = post
    ? c.bundle.events.filter((event) => event.status !== "scheduled")
    : c.bundle.events;
  const eventResultsTitle = post ? "확인한 사건과 결과" : "예정과 결과";
  const { older, newer } = await neighbors(id, b.targetAt);
  const sectionLink = (s: Draft["sections"][number], i: number) => (
    <a key={s.id} href={`#${s.id}`}>
      <span>{String(i + 1).padStart(2, "0")}</span>
      {s.title}
    </a>
  );
  const contents = (
    <nav aria-label="이 글의 목차">
      <a href="#summary">핵심 요약</a>
      {post && <a href="#market-results">장후 결과</a>}
      {resultsSections.map(sectionLink)}
      {c.reduced &&
        !c.draft.sections.length &&
        c.bundle.observations.length > 0 && (
          <a href="#observations">확인한 수치</a>
        )}
      {events.length > 0 && <a href="#event-results">{eventResultsTitle}</a>}
      {post && <a href="#upcoming-events">예정 이벤트</a>}
      {upcomingSections.map((s, i) =>
        sectionLink(s, resultsSections.length + i),
      )}
      <a href="#sources">출처와 확인 범위</a>
      {b.corrections.length > 0 && <a href="#corrections">정정 이력</a>}
    </nav>
  );
  return (
    <main id="main" className="report-reading report-web">
      <Link className="back" href="/">
        <UiIcon name="back" /> 브리핑 목록
      </Link>
      <header className="article-header reading-copy">
        <div className="eyebrow">
          <span className="session-label">
            <UiIcon name={c.session} />
            {sessionLabel(c.session)} 브리핑
          </span>{" "}
          <span>미국 거래일 {c.date}</span>
        </div>
        <h1 className="report-title">{c.draft.title}</h1>
        <dl className="article-meta">
          <div>
            <dt>자료 기준</dt>
            <dd>
              <time dateTime={c.bundle.cutoffAt}>
                {formatMarketTime(c.bundle.cutoffAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt>발행</dt>
            <dd>
              <time dateTime={b.publishedAt}>
                {formatKoreaTime(b.publishedAt)}
              </time>
            </dd>
          </div>
          {b.correctedAt && (
            <div>
              <dt>정정</dt>
              <dd>
                <a href="#corrections">
                  <time dateTime={b.correctedAt}>
                    {formatKoreaTime(b.correctedAt)}
                  </time>
                  <UiIcon name="forward" />
                </a>
              </dd>
            </div>
          )}
        </dl>
        <p className="meta">
          시각은 한국시간(KST)을 먼저 표시합니다. 미국 거래일은 현지 날짜입니다.
        </p>
        {earlyClose(c.date) && (
          <p className="meta">
            조기 폐장일 · 정규장 종료{" "}
            {formatMarketTime(marketSchedule(c.date, c.session).closeAt)}
          </p>
        )}
        {c.sample && (
          <aside className="sample-banner">
            <span className="badge">
              <UiIcon name="info" />
              가상 데이터
            </span>
            <p>사건·수치·출처는 기능 확인용 샘플이며 실제 시황이 아닙니다.</p>
          </aside>
        )}
        {c.bundle.missing.length > 0 && (
          <aside className="data-notice">
            <strong>일부 자료 미반영{c.reduced ? " · 축소 브리핑" : ""}</strong>
            <ul>
              {c.bundle.missing.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </aside>
        )}
      </header>
      <CitationProvider key={id}>
        <div className="article-grid">
          <section className="summary-block reading-copy" id="summary">
            <h2>핵심 요약</h2>
            {!c.draft.summary.length && (
              <p>
                확인 가능한 자료가 부족합니다. 확인하지 못한 수치와 사건은 싣지
                않았습니다.
              </p>
            )}
            {c.draft.summary.map((p, i) => (
              <div className="summary-row" key={p.id}>
                <Claim
                  claim={p}
                  content={c}
                  number={i + 1}
                  referenceId={`summary-${i}`}
                />
              </div>
            ))}
          </section>
          <aside className="toc">
            <div className="toc-desktop">
              <h2>이 글의 목차</h2>
              {contents}
            </div>
            <details className="toc-mobile">
              <summary>이 글의 목차</summary>
              {contents}
            </details>
          </aside>
          <article
            className="article-body reading-copy"
            aria-label="브리핑 본문"
          >
            {post && (
              <h2 className="group-title" id="market-results">
                장후 결과
              </h2>
            )}
            {c.reduced &&
              !c.draft.sections.length &&
              c.bundle.observations.length > 0 && (
                <section className="section" id="observations">
                  <h2 className="section-title">확인한 수치</h2>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>대상 · 종류</th>
                          <th>값 · 단위</th>
                          <th>기준 · 출처</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.bundle.observations.map((o) => (
                          <tr key={o.id}>
                            <th>
                              {o.name}
                              <br />
                              {o.kind} · {o.symbol}
                            </th>
                            <td>
                              {o.value} {o.unit} {o.currency}
                            </td>
                            <td>
                              {o.period}
                              <br />
                              {o.comparison}
                              <br />
                              {formatSourceTime(
                                o.observedAt,
                                o.observedOriginalTime,
                                "관측",
                              )}
                              <br />
                              <SourceReferences
                                sourceIds={[o.sourceId]}
                                content={c}
                                referenceId={`observation-${o.id}`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            {resultsSections.map((s, i) => (
              <DraftSection key={s.id} section={s} index={i} content={c} />
            ))}
            {events.length > 0 && (
              <section id="event-results" className="section">
                <h2 className="section-title">{eventResultsTitle}</h2>
                <ul className="schedule" role="list">
                  {events.map((e) => (
                    <li key={e.id}>
                      <p className="schedule-time">
                        {e.occurredAt
                          ? formatSourceTime(
                              e.occurredAt,
                              e.occurredOriginalTime,
                              "발생",
                            )
                          : eventTimeLabel(e)}{" "}
                        ·{" "}
                        {
                          {
                            scheduled: "예정",
                            released: "발표",
                            postponed: "연기",
                            unconfirmed: "미확인",
                          }[e.status]
                        }
                      </p>
                      <h3>{e.title}</h3>
                      <p>
                        {e.result}
                        <SourceReferences
                          sourceIds={[e.sourceId]}
                          content={c}
                          referenceId={`event-${e.id}`}
                        />
                      </p>
                      <p className="note">확인점 · {e.watch}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {schedule && (
              <section id="upcoming-events" className="section">
                <h2 className="section-title">예정 이벤트</h2>
                {!schedule.calendarKnown ? (
                  <p className="meta">
                    다음 거래일의 정규장 종료 시각을 확인하지 못했습니다.
                  </p>
                ) : schedule.uncertain ? (
                  <p className="meta">
                    일부 일정은 자료 마감 이후부터 다음 거래일 폐장까지의 범위에
                    해당하는지 확인하지 못했습니다.
                  </p>
                ) : (
                  schedule.events.length === 0 && (
                    <p className="meta">
                      다음 거래일 정규장 종료까지 이 브리핑에 담긴 예정 이벤트가
                      없습니다.
                    </p>
                  )
                )}
                <ul className="schedule" role="list">
                  {schedule.events.map((event) => (
                    <li key={event.id}>
                      <p className="schedule-time">
                        {event.scheduledAt ? (
                          <time dateTime={event.scheduledAt}>
                            {eventTimeLabel(event)}
                          </time>
                        ) : (
                          eventTimeLabel(event)
                        )}
                      </p>
                      <h3>
                        {event.title}
                        <SourceReferences
                          sourceIds={[event.sourceId]}
                          content={c}
                          referenceId={`event-${event.id}`}
                        />
                      </h3>
                      {event.result && <p>{event.result}</p>}
                      <p className="note">
                        {event.watch.trim() ||
                          "주목할 이유를 확인하지 못했습니다."}
                      </p>
                    </li>
                  ))}
                </ul>
                {upcomingSections.map((s, i) => (
                  <DraftSection
                    key={s.id}
                    section={s}
                    index={resultsSections.length + i}
                    content={c}
                    upcoming
                  />
                ))}
              </section>
            )}
            <section id="sources" className="section article-appendix sources">
              <h2>출처와 확인 범위</h2>
              <p className="meta">
                조사 범위 {formatMarketTime(c.bundle.coverageStart)} ~{" "}
                {formatMarketTime(c.bundle.cutoffAt)}
              </p>
              <ol>
                {c.bundle.sources.map((s) => (
                  <li key={s.id} id={`source-${s.id}`} tabIndex={-1}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title} ↗
                    </a>
                    <p>
                      {s.publisher}
                      {s.method === "sample" ? " · 가상 자료" : ""}
                    </p>
                    <p className="meta">
                      게시{" "}
                      {formatSourcePublication(
                        s.publishedAt,
                        s.publishedOriginalTime,
                      )}
                      <br />
                      확인 {formatKoreaTime(s.checkedAt)}
                    </p>
                    <SourceReturnLink sourceId={s.id} />
                  </li>
                ))}
              </ol>
            </section>
            {b.corrections.length > 0 && (
              <section id="corrections" className="section article-appendix">
                <h2>정정 이력</h2>
                {b.corrections.map((r, i) => (
                  <div className="correction-entry" key={i}>
                    <p className="meta">{formatKoreaTime(r.at)}</p>
                    <p>{r.change}</p>
                    <p>이유: {r.reason}</p>
                  </div>
                ))}
              </section>
            )}
            <a className="back-to-summary" href="#summary">
              핵심 요약으로 돌아가기 ↑
            </a>
            <nav className="article-neighbors" aria-label="인접 브리핑">
              {older && (
                <Link href={`/briefings/${older.id}`}>
                  <small>← 이전 발행</small>
                  <strong>{older.content.draft.title}</strong>
                  <span>
                    미국 {older.content.date} ·{" "}
                    {sessionLabel(older.content.session)}
                  </span>
                </Link>
              )}
              {newer && (
                <Link href={`/briefings/${newer.id}`}>
                  <small>다음 발행 →</small>
                  <strong>{newer.content.draft.title}</strong>
                  <span>
                    미국 {newer.content.date} ·{" "}
                    {sessionLabel(newer.content.session)}
                  </span>
                </Link>
              )}
            </nav>
          </article>
        </div>
      </CitationProvider>
    </main>
  );
}
