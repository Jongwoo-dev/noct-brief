import Link from "next/link";
import { notFound } from "next/navigation";
import { detail, neighbors } from "@/lib/queries";
import { kst, earlyClose, sessionLabel } from "@/lib/calendar";
import { Chart } from "@/components/chart";
import { UiIcon } from "@/components/ui-icon";
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
}: {
  claim: Content["draft"]["summary"][number];
  content: Content;
}) {
  return (
    <div className="claim">
      <span className={`claim-kind ${claim.kind}`}>
        {kindLabel[claim.kind]}
      </span>
      <p>{claim.text}</p>
      {claim.limitation && <p className="limitation">{claim.limitation}</p>}
      <div className="source-links">
        {claim.sourceIds.map((id) => (
          <a href={`#source-${id}`} key={id}>
            <UiIcon name="forward" />{" "}
            {content.bundle.sources.find((s) => s.id === id)?.publisher}
          </a>
        ))}
      </div>
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
    title: b?.content.draft.title ?? "브리핑을 찾을 수 없습니다",
    robots: b?.content.sample ? { index: false, follow: false } : undefined,
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
  const c = b.content;
  const { older, newer } = await neighbors(id, b.targetAt);
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
        <div className="article-meta">
          <span>자료 기준 {kst(c.bundle.cutoffAt)} KST</span>
          <span>발행 {kst(b.publishedAt)} KST</span>
          {b.correctedAt && (
            <a href="#corrections">정정 {kst(b.correctedAt)} KST</a>
          )}
        </div>
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
      <div className="article-grid">
        <aside className="toc">
          <details open>
            <summary>이 글의 목차</summary>
            <nav>
              <a href="#summary">핵심 요약</a>
              {c.draft.sections.map((s, i) => (
                <a key={s.id} href={`#${s.id}`}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                </a>
              ))}
              {c.bundle.events.length > 0 && (
                <a href="#event-results">예정과 결과</a>
              )}
              <a href="#sources">출처 목록</a>
              {b.corrections.length > 0 && <a href="#corrections">정정 이력</a>}
            </nav>
          </details>
        </aside>
        <article className="article-body">
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
                <span className="summary-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Claim claim={p} content={c} />
              </div>
            ))}
          </section>
          {c.reduced &&
            !c.draft.sections.length &&
            c.bundle.observations.length > 0 && (
              <section className="article-section">
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
                            <a href={`#source-${o.sourceId}`}>출처</a>
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
                {String(i + 1).padStart(2, "0")} / {s.type.toUpperCase()}
              </div>
              <h2>{s.title}</h2>
              {s.claims.map((p) => (
                <Claim key={p.id} claim={p} content={c} />
              ))}
              {s.chartIds.map((id) => (
                <Chart
                  key={id}
                  chart={c.charts.find((g) => g.id === id)!}
                  content={c}
                />
              ))}
            </section>
          ))}
          {c.bundle.events.length > 0 && (
            <section id="event-results" className="article-section">
              <p className="eyebrow">WHAT TO WATCH</p>
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
                  <p>{e.result}</p>
                  <p className="limitation">확인점 · {e.watch}</p>
                  <a className="source-links" href={`#source-${e.sourceId}`}>
                    출처 확인 ↗
                  </a>
                </div>
              ))}
            </section>
          )}
          <section id="sources" className="article-section sources">
            <p className="eyebrow">THE EVIDENCE</p>
            <h2>출처와 확인 범위</h2>
            <p className="meta">
              조사 범위 {kst(c.bundle.coverageStart)} ~ {kst(c.bundle.cutoffAt)}{" "}
              KST
            </p>
            <ol>
              {c.bundle.sources.map((s) => (
                <li key={s.id} id={`source-${s.id}`}>
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
                </li>
              ))}
            </ol>
          </section>
          {b.corrections.length > 0 && (
            <section id="corrections" className="article-section">
              <h2>정정 이력</h2>
              {b.corrections.map((r, i) => (
                <div key={i}>
                  <p className="meta">{kst(r.at)} KST</p>
                  <p>{r.change}</p>
                  <p>이유: {r.reason}</p>
                </div>
              ))}
            </section>
          )}
          <nav className="article-neighbors" aria-label="인접 브리핑">
            {older && (
              <Link href={`/briefings/${older.id}`}>
                <small>← 이전 발행</small>
                {older.content.draft.title}
              </Link>
            )}
            {newer && (
              <Link href={`/briefings/${newer.id}`}>
                <small>다음 발행 →</small>
                {newer.content.draft.title}
              </Link>
            )}
          </nav>
        </article>
      </div>
    </main>
  );
}
