import Link from "next/link";
import { kst, sessionLabel } from "@/lib/calendar";
import {
  adminFilters,
  errorExplanation,
  stateLabels,
  type AdminEdition,
  type AdminFilter,
  type AdminJob,
  type AdminVersion,
  type AdminNotice,
} from "@/lib/admin";
import type { VersionInfo } from "@/lib/admin-queries";
import { safeUrl } from "@/lib/contract";
import {
  AdminControls,
  RefreshAdmin,
  SampleTools,
  SignOut,
} from "./admin-controls";
import { Chart } from "./chart";
import { UiIcon } from "./ui-icon";
import { SourceReferences } from "./source-references";

function Status({ edition }: { edition: AdminEdition }) {
  return (
    <div className="admin-statuses">
      <span className={`admin-status ${edition.visible ? "is-public" : ""}`}>
        {edition.missedAt
          ? edition.visible
            ? "미발행 안내 공개"
            : "미발행 안내 비공개"
          : edition.version
            ? edition.visible
              ? "공개 중"
              : "비공개 보관"
            : "미발행"}
      </span>
      {edition.job && (
        <span
          className={`admin-status ${edition.job.state === "failed" ? "needs-attention" : ""}`}
        >
          {edition.job.kind === "correction" ? "정정 · " : ""}
          {edition.missedAt && edition.job.errorCode === "EDITION_SUPERSEDED"
            ? "마감"
            : stateLabels[edition.job.state]}
        </span>
      )}
    </div>
  );
}
function Header({
  preview,
  title,
  description,
}: {
  preview: boolean;
  title: string;
  description: string;
}) {
  return (
    <>
      <header className="admin-heading">
        <div>
          <p className="eyebrow">NOCT CONTROL</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="button-row">
          <RefreshAdmin />
          {!preview && <SignOut />}
        </div>
      </header>
      {preview && (
        <aside className="sample-banner">
          <span className="badge">관리자 화면 시연</span>
          <p>
            고정된 가상 자료입니다. 실제 계정·저장 데이터·발행 상태에는 영향을
            주지 않습니다.
          </p>
        </aside>
      )}
    </>
  );
}
export function AdminDashboard({
  editions,
  counts,
  total,
  filter,
  date,
  page,
  lastScheduler,
  sample,
  preview = false,
  notices = [],
}: {
  editions: AdminEdition[];
  counts: {
    total: number;
    attention: number;
    progress: number;
    stored: number;
  };
  total: number;
  filter: AdminFilter;
  date: string;
  page: number;
  lastScheduler: string | null;
  sample: boolean;
  preview?: boolean;
  notices?: AdminNotice[];
}) {
  const base = preview ? "/admin/preview" : "/admin";
  const url = (selected: AdminFilter, n = 1) =>
    `${base}?${new URLSearchParams({ filter: selected, ...(date ? { date } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;
  return (
    <main id="main" className="home admin">
      <Header
        preview={preview}
        title="브리핑 운영"
        description="처리 상태를 확인하고, 발행된 보고서와 수정 이력을 관리합니다."
      />
      <div className="admin-overview">
        {(["attention", "progress", "stored"] as const).map((key) => (
          <Link
            key={key}
            className={
              key === "attention" && counts[key] ? "has-attention" : ""
            }
            href={url(key)}
          >
            <span>{adminFilters[key]}</span>
            <strong>
              {counts[key]}
              <small>회차</small>
            </strong>
          </Link>
        ))}
      </div>
      <p className="admin-scheduler">
        {sample ? "로컬 샘플 · 수동 처리" : "실제 자료 모드"}
        <span>
          마지막 예약 실행{" "}
          {lastScheduler ? `${kst(lastScheduler)} KST` : "기록 없음"}
        </span>
      </p>
      {sample && <SampleTools preview={preview} />}
      <section aria-labelledby="editions-heading" className="admin-editions">
        <div className="section-heading">
          <h2 id="editions-heading">회차별 관리</h2>
          <span className="meta">{total}개 회차 · 시각 KST</span>
        </div>
        <div className="admin-toolbar">
          <nav aria-label="관리 상태 필터">
            {Object.entries(adminFilters).map(([key, label]) => (
              <Link
                key={key}
                href={url(key as AdminFilter)}
                aria-current={filter === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <form action={base}>
            <input type="hidden" name="filter" value={filter} />
            <label>
              미국 거래일
              <input type="date" name="date" defaultValue={date} key={date} />
            </label>
            <button>조회</button>
            {date && <Link href={`${base}?filter=${filter}`}>초기화</Link>}
          </form>
        </div>
        {editions.length ? (
          <div className="admin-edition-list">
            {editions.map((b) => (
              <article className="admin-edition" key={b.id}>
                <div className="admin-edition-date">
                  <span>{b.date}</span>
                  <span className="session-label">
                    <UiIcon name={b.session} />
                    {sessionLabel(b.session)}
                  </span>
                </div>
                <div className="admin-edition-body">
                  <Status edition={b} />
                  <h3>
                    <Link
                      href={
                        preview
                          ? `${base}?id=${b.id}`
                          : `/admin/briefings/${b.id}`
                      }
                    >
                      {b.title ?? `${sessionLabel(b.session)} 브리핑 준비`}
                    </Link>
                  </h3>
                  {b.job?.errorCode && (
                    <p className="admin-error-summary">
                      {errorExplanation(b.job.errorCode)}
                    </p>
                  )}
                  <p className="meta">
                    발행 목표 {kst(b.targetAt)}
                    {b.version
                      ? ` · 보관 버전 ${b.versionCount}개`
                      : " · 저장된 발행본 없음"}
                  </p>
                </div>
                <Link
                  className="admin-open"
                  href={
                    preview ? `${base}?id=${b.id}` : `/admin/briefings/${b.id}`
                  }
                  aria-label={`${b.date} ${sessionLabel(b.session)} 상세 관리`}
                >
                  상세 관리 <UiIcon name="forward" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty">
            <h3>조건에 맞는 회차가 없습니다.</h3>
            <p>
              필터를 바꾸거나{" "}
              {sample
                ? "더미 리포트 테스트에서 회차를 등록하세요."
                : "다음 예약 실행을 확인하세요."}
            </p>
          </div>
        )}
        {total > 20 && (
          <nav className="admin-pagination" aria-label="관리 목록 페이지">
            {page > 1 && <Link href={url(filter, page - 1)}>이전</Link>}
            <span>
              {page} / {Math.ceil(total / 20)}
            </span>
            {page * 20 < total && (
              <Link href={url(filter, page + 1)}>다음</Link>
            )}
          </nav>
        )}
      </section>
      <details className="admin-job-history">
        <summary>예외 알림 · 최근 {notices.length}건</summary>
        {notices.length ? (
          <ul>
            {notices.map((n, i) => (
              <li key={i}>
                {n.briefing_id ? (
                  <Link href={`/admin/briefings/${n.briefing_id}`}>
                    {n.briefing_id}
                  </Link>
                ) : (
                  "운영 알림"
                )}
                <span>
                  {(
                    {
                      failed: "작업 실패",
                      delay: "발행 지연",
                      missed_editions: "미발행 회차 마감",
                      backup: "DB 백업 실패",
                      backup_stale: "DB 백업 26시간 미갱신",
                      submission_unknown: "접수 확인 필요",
                    } as Record<string, string>
                  )[n.kind] ?? "운영 확인 필요"}{" "}
                  ·{" "}
                  {(
                    {
                      sent: "발송 완료",
                      pending: "발송 대기",
                      failed: "발송 실패",
                    } as Record<string, string>
                  )[n.status] ?? n.status}{" "}
                  · 실패 {n.attempts}회
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">알림 기록이 없습니다.</p>
        )}
      </details>
    </main>
  );
}

function JobDetails({ job }: { job: AdminJob }) {
  return (
    <>
      <dl className="admin-facts">
        <div>
          <dt>현재 단계</dt>
          <dd>{stateLabels[job.state]}</dd>
        </div>
        <div>
          <dt>재시도 횟수</dt>
          <dd>{job.attempt}회</dd>
        </div>
        <div>
          <dt>다음 처리</dt>
          <dd>
            {["failed", "published"].includes(job.state)
              ? "예약 없음"
              : `${kst(job.nextAt)} KST`}
          </dd>
        </div>
        <div>
          <dt>자료 기준</dt>
          <dd>{job.cutoffAt ? `${kst(job.cutoffAt)} KST` : "확보 전"}</dd>
        </div>
      </dl>
      {job.errorCode && (
        <aside className="data-notice">
          <p>{errorExplanation(job.errorCode)}</p>
          <small>오류 코드 · {job.errorCode}</small>
        </aside>
      )}
      {job.missing.length > 0 && (
        <aside className="data-notice">
          <strong>미확보 자료</strong>
          <ul>
            {job.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </aside>
      )}
      <details className="admin-technical">
        <summary>작성 설정·사용량</summary>
        <p className="meta">모델 · {job.model}</p>
        <pre>
          {job.usage ? JSON.stringify(job.usage, null, 2) : "사용량 기록 없음"}
        </pre>
      </details>
    </>
  );
}
function StoredReport({ version }: { version: AdminVersion }) {
  const c = version.content;
  const claim = (p: (typeof c.draft.summary)[number]) => (
    <div className="admin-report-claim" key={p.id}>
      <small>
        {
          {
            fact: "확인한 사실",
            source_interpretation: "출처의 해석",
            ai_inference: "가능한 해석",
          }[p.kind]
        }
      </small>
      <p>
        {p.text}{" "}
        <SourceReferences
          sourceIds={p.sourceIds}
          content={c}
          referenceId={`stored-claim-${p.id}`}
        />
      </p>
      {p.limitation && <p className="limitation">{p.limitation}</p>}
    </div>
  );
  return (
    <article className="admin-stored-report" aria-label="보관된 보고서 내용">
      <h2>{c.draft.title}</h2>
      <p className="meta">
        자료 기준 {kst(c.bundle.cutoffAt)} KST{c.sample ? " · 가상 데이터" : ""}
        {c.reduced ? " · 축소본" : ""}
      </p>
      {c.bundle.missing.length > 0 && (
        <aside className="data-notice">
          <strong>일부 자료 미반영</strong>
          <ul>
            {c.bundle.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </aside>
      )}
      <section>
        <h3>핵심 요약</h3>
        {c.draft.summary.map(claim)}
      </section>
      {c.draft.sections.map((s) => (
        <section key={s.id}>
          <h3>{s.title}</h3>
          {s.claims.map(claim)}
        </section>
      ))}
      {c.charts.map((chart) => (
        <Chart
          key={chart.id}
          chart={chart}
          content={c}
          referenceId={`stored-${chart.id}`}
        />
      ))}
      {c.bundle.events.length > 0 && (
        <section>
          <h3>예정과 결과</h3>
          {c.bundle.events.map((e) => (
            <p key={e.id}>
              <strong>{e.title}</strong> · {kst(e.scheduledAt)} KST
              <br />
              {e.result || e.watch}
            </p>
          ))}
        </section>
      )}
      {c.reduced && (
        <section>
          <h3>확인한 수치</h3>
          {c.bundle.observations.map((o) => (
            <p key={o.id}>
              {o.name} · {o.value} {o.unit}
            </p>
          ))}
        </section>
      )}
      <section>
        <h3>출처와 확인 범위</h3>
        <ol>
          {c.bundle.sources.map((s) => (
            <li key={s.id} id={`source-${s.id}`}>
              {safeUrl(s.url) ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              ) : (
                s.title
              )}
              <p className="meta">
                {s.publisher} · 확인 {kst(s.checkedAt)} KST
              </p>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
export function AdminEditionDetail({
  edition,
  versions,
  selected,
  jobs,
  preview = false,
}: {
  edition: AdminEdition;
  versions: VersionInfo[];
  selected: AdminVersion | null;
  jobs: AdminJob[];
  preview?: boolean;
}) {
  const base = preview
    ? `/admin/preview?id=${edition.id}`
    : `/admin/briefings/${edition.id}`;
  return (
    <main id="main" className="home admin admin-detail">
      <Link className="back" href={preview ? "/admin/preview" : "/admin"}>
        <UiIcon name="back" />
        운영 목록
      </Link>
      <Header
        preview={preview}
        title={`${edition.date} ${sessionLabel(edition.session)}`}
        description={edition.title ?? "아직 저장된 발행본이 없습니다."}
      />
      <Status edition={edition} />
      <dl className="admin-facts">
        <div>
          <dt>발행 목표</dt>
          <dd>{kst(edition.targetAt)} KST</dd>
        </div>
        <div>
          <dt>최초 발행</dt>
          <dd>
            {edition.publishedAt ? `${kst(edition.publishedAt)} KST` : "미발행"}
          </dd>
        </div>
        <div>
          <dt>보관</dt>
          <dd>{edition.versionCount}개 버전</dd>
        </div>
      </dl>
      <div className="admin-detail-grid">
        <section className="admin-process">
          <h2>최근 처리</h2>
          {edition.job ? (
            <JobDetails job={edition.job} />
          ) : (
            <p>작업 기록이 없습니다.</p>
          )}
          <AdminControls key={edition.id} edition={edition} preview={preview} />
        </section>
        <section className="admin-history">
          <h2>보관된 보고서</h2>
          <p className="meta">
            이전 버전도 그대로 보관합니다. 버전 조회는 공개 내용을 바꾸지
            않습니다.
          </p>
          {versions.length ? (
            <ol>
              {versions.map((v, i) => (
                <li key={v.id}>
                  <Link
                    href={`${base}${preview ? "&" : "?"}version=${v.id}`}
                    aria-current={selected?.id === v.id ? "page" : undefined}
                  >
                    <strong>
                      {versions.length - i}번째 버전
                      {edition.version === v.id ? " · 현재" : ""}
                    </strong>
                    <span>{kst(v.createdAt)} KST</span>
                  </Link>
                  <p>{v.reason || "최초 발행"}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p>
              {edition.missedAt
                ? `미발행 마감 · ${kst(edition.missedAt)} KST`
                : "검증·발행을 마치면 여기에 보관됩니다."}
            </p>
          )}
          {!preview && edition.visible && (
            <Link className="admin-open" href={`/briefings/${edition.id}`}>
              공개 화면 보기 <UiIcon name="forward" />
            </Link>
          )}
        </section>
      </div>
      {jobs.length > 0 && (
        <details className="admin-job-history">
          <summary>작업 이력 · 최근 {jobs.length}건</summary>
          <ol>
            {jobs.map((j) => (
              <li key={j.id}>
                <strong>
                  {j.kind === "correction" ? "정정" : "최초 생성"} ·{" "}
                  {stateLabels[j.state]}
                </strong>
                <span>
                  {kst(j.createdAt)} KST · 재시도 {j.attempt}회
                </span>
                {j.errorCode && <p>{errorExplanation(j.errorCode)}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {selected ? (
        <>
          <div className="admin-version-heading">
            <h2>
              {selected.id === edition.version ? "현재 보관본" : "이전 보관본"}
            </h2>
            <span className="meta">저장 {kst(selected.createdAt)} KST</span>
          </div>
          {selected.reason && (
            <p className="admin-version-reason">
              정정 이유 · {selected.reason}
              {selected.change ? ` / ${selected.change}` : ""}
            </p>
          )}
          <StoredReport version={selected} />
        </>
      ) : (
        !edition.missedAt && (
          <div className="admin-empty">
            저장된 보고서가 없습니다. 현재 처리 상태를 확인해 주세요.
          </div>
        )
      )}
    </main>
  );
}
