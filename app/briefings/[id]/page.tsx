import Link from "next/link";
import { notFound } from "next/navigation";
import { detail, neighbors } from "@/lib/queries";
import { kst, earlyClose, sessionLabel } from "@/lib/calendar";
import { Chart } from "@/components/chart";
import { UiIcon } from "@/components/ui-icon";
import {
  CitationProvider,
  SourceReturnLink,
} from "@/components/citation-navigation";
import { SourceReferences } from "@/components/source-references";
import type { Content } from "@/lib/contract";
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
}: {
  claim: Content["draft"]["summary"][number];
  content: Content;
  number?: number;
  referenceId: string;
}) {
  return (
    <div className="claim">
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
      <p>
        {claim.text}
        <SourceReferences
          sourceIds={claim.sourceIds}
          content={content}
          referenceId={referenceId}
        />
      </p>
      {claim.limitation && <p className="limitation">{claim.limitation}</p>}
    </div>
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
      <main id="main" className="detail-page">
        <Link className="back" href="/#archive">
          <UiIcon name="back" /> 지난 브리핑
        </Link>
        <header className="article-header">
          <div className="eyebrow">
            <span className="session-label">
              <UiIcon name={b.session} />
              {sessionLabel(b.session)} 브리핑
            </span>{" "}
            미국 {b.date}
          </div>
          <h1>브리핑 미발행 안내</h1>
          <p>
            다음 정규 회차의 발행 시각까지 이 브리핑을 발행하지 못해 해당 회차를
            마감했습니다.
          </p>
          <dl className="article-meta">
            <div>
              <dt>발행 예정 시각</dt>
              <dd>
                <time dateTime={b.targetAt}>{kst(b.targetAt)} KST</time>
              </dd>
            </div>
          </dl>
        </header>
      </main>
    );
  const c = b.content;
  const { older, newer } = await neighbors(id, b.targetAt);
  const contents = (
    <nav aria-label="이 글의 목차">
      <a href="#summary">핵심 요약</a>
      {c.draft.sections.map((s, i) => (
        <a key={s.id} href={`#${s.id}`}>
          <span>{String(i + 1).padStart(2, "0")}</span>
          {s.title}
        </a>
      ))}
      {c.reduced &&
        !c.draft.sections.length &&
        c.bundle.observations.length > 0 && (
          <a href="#observations">확인한 수치</a>
        )}
      {c.bundle.events.length > 0 && <a href="#event-results">예정과 결과</a>}
      <a href="#sources">출처와 확인 범위</a>
      {b.corrections.length > 0 && <a href="#corrections">정정 이력</a>}
    </nav>
  );
  return (
    <main id="main" className="detail-page">
      <Link className="back" href="/">
        <UiIcon name="back" /> 브리핑 목록
      </Link>
      <header className="article-header">
        <div className="eyebrow">
          <span className="session-label">
            <UiIcon name={c.session} />
            {sessionLabel(c.session)} 브리핑
          </span>{" "}
          <span>미국 {c.date}</span>
        </div>
        <h1>{c.draft.title}</h1>
        <dl className="article-meta">
          <div>
            <dt>자료 기준</dt>
            <dd>
              <time dateTime={c.bundle.cutoffAt}>
                {kst(c.bundle.cutoffAt)} KST
              </time>
            </dd>
          </div>
          <div>
            <dt>발행</dt>
            <dd>
              <time dateTime={b.publishedAt}>{kst(b.publishedAt)} KST</time>
            </dd>
          </div>
          {b.correctedAt && (
            <div>
              <dt>정정</dt>
              <dd>
                <a href="#corrections">
                  <time dateTime={b.correctedAt}>{kst(b.correctedAt)} KST</time>
                  <UiIcon name="forward" />
                </a>
              </dd>
            </div>
          )}
        </dl>
        {earlyClose(c.date) && (
          <p className="meta">조기 폐장일 · 정규장 종료 13:00 ET</p>
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
          <section className="summary-block" id="summary">
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
          <article className="article-body" aria-label="브리핑 본문">
            {c.reduced &&
              !c.draft.sections.length &&
              c.bundle.observations.length > 0 && (
                <section className="article-section" id="observations">
                  <h2>확인한 수치</h2>
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
                              {kst(o.observedAt)} KST
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
            {c.draft.sections.map((s, i) => (
              <section id={s.id} className="article-section" key={s.id}>
                <div className="section-number">
                  {String(i + 1).padStart(2, "0")} ·{" "}
                  {
                    {
                      market: "시장 현황",
                      events: "주요 사건",
                      earnings: "실적·어닝콜",
                      outlook: "다음 확인점",
                      trend: "흐름 점검",
                    }[s.type]
                  }
                </div>
                <h2>{s.title}</h2>
                {s.claims.map((p, claimIndex) => (
                  <Claim
                    key={p.id}
                    claim={p}
                    content={c}
                    referenceId={`section-${s.id}-${claimIndex}`}
                  />
                ))}
                {s.chartIds.map((id) => (
                  <Chart
                    key={id}
                    chart={c.charts.find((g) => g.id === id)!}
                    content={c}
                    referenceId={`chart-${s.id}-${id}`}
                  />
                ))}
              </section>
            ))}
            {c.bundle.events.length > 0 && (
              <section id="event-results" className="article-section">
                <h2>예정과 결과</h2>
                {c.bundle.events.map((e) => (
                  <div className="event" key={e.id}>
                    <p className="meta">
                      {kst(e.scheduledAt)} KST ·{" "}
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
                    <p className="limitation">확인점 · {e.watch}</p>
                  </div>
                ))}
              </section>
            )}
            <section
              id="sources"
              className="article-section article-appendix sources"
            >
              <h2>출처와 확인 범위</h2>
              <p className="meta">
                조사 범위 {kst(c.bundle.coverageStart)} ~{" "}
                {kst(c.bundle.cutoffAt)} KST
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
                      발표 {kst(s.publishedAt)} KST
                      <br />
                      확인 {kst(s.checkedAt)} KST
                    </p>
                    <SourceReturnLink sourceId={s.id} />
                  </li>
                ))}
              </ol>
            </section>
            {b.corrections.length > 0 && (
              <section
                id="corrections"
                className="article-section article-appendix"
              >
                <h2>정정 이력</h2>
                {b.corrections.map((r, i) => (
                  <div className="correction-entry" key={i}>
                    <p className="meta">{kst(r.at)} KST</p>
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
