import { headers } from "next/headers";
import { identity, getAuth } from "@/lib/auth";
import { runtime } from "@/lib/runtime";
import {
  AdminControls,
  LoginButton,
  SignOut,
} from "@/components/admin-controls";
import { kst } from "@/lib/calendar";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "관리자",
  robots: { index: false, follow: false },
};
export default async function Admin() {
  const user = await identity(await headers());
  if (!user)
    return (
      <main id="main" className="home admin-login">
        <p className="eyebrow">NOCT CONTROL</p>
        <h1>브리핑 운영</h1>
        <p>등록된 운영자 Google 계정으로 로그인해 주세요.</p>
        {getAuth() ? (
          <LoginButton />
        ) : (
          <div className="data-notice">
            <strong>Google 로그인 연결 준비 중</strong>
            <p>
              개발 DB와 로컬 OAuth 설정이 필요합니다.
              <br />
              공개 브리핑은 로그인 없이 읽을 수 있습니다.
            </p>
          </div>
        )}
      </main>
    );
  if (!user.admin)
    return (
      <main id="main" className="home">
        <h1>관리자 권한이 없습니다.</h1>
        <p>
          본인 계정 최초 등록 시 아래 검증된 Google 식별자를 로컬 환경 설정의
          ADMIN_GOOGLE_SUB에 등록한 뒤 다시 로그인하세요.
        </p>
        <code>{user.sub}</code>
        <p>식별자 확인만으로 관리자 권한을 부여하지 않습니다.</p>
        <SignOut />
      </main>
    );
  const { db } = await runtime();
  const rows = (
    await db.query(
      "SELECT b.*,j.state,j.error_code,j.attempt,j.payload,j.config,j.next_at FROM briefings b LEFT JOIN LATERAL (SELECT * FROM jobs WHERE briefing_id=b.id ORDER BY created_at DESC LIMIT 1) j ON true ORDER BY b.target_at DESC LIMIT 60",
    )
  ).rows;
  const last = (
    await db.query("SELECT value FROM app_settings WHERE key='last_scheduler'")
  ).rows[0]?.value;
  const notices = (
    await db.query(
      "SELECT briefing_id,kind,status,attempts FROM notification_outbox ORDER BY next_at DESC LIMIT 20",
    )
  ).rows;
  return (
    <main id="main" className="home admin">
      <div className="section-heading">
        <div>
          <p className="eyebrow">NOCT CONTROL</p>
          <h1>운영 상태</h1>
        </div>
        <SignOut />
      </div>
      <p>마지막 예약 실행 · {last ? `${kst(last)} KST` : "실행 기록 없음"}</p>
      {rows.map((b) => (
        <article className="admin-job" key={b.id}>
          <h2>{b.id}</h2>
          <p>
            {b.visible ? "공개" : "비공개 / 미발행"} · 작업 {b.state ?? "없음"}{" "}
            · 재시도 {b.attempt ?? 0}
          </p>
          <p className="meta">
            목표 {kst(b.target_at.toISOString())} KST · 실제{" "}
            {b.published_at ? kst(b.published_at.toISOString()) : "미발행"}
            <br />
            자료 기준{" "}
            {b.payload?.bundle?.cutoffAt
              ? kst(b.payload.bundle.cutoffAt)
              : "미확인"}
          </p>
          {b.error_code && <p className="notice-inline">{b.error_code}</p>}
          {b.payload?.bundle?.missing?.map((m: string) => (
            <p key={m}>{m}</p>
          ))}
          <details>
            <summary>작성 설정·사용량</summary>
            <pre>
              {JSON.stringify(
                {
                  model: b.config?.model,
                  prompt: b.config?.promptVersion,
                  usage: b.payload?.usage ?? "기록 없음",
                },
                null,
                2,
              )}
            </pre>
          </details>
          <AdminControls
            id={b.id}
            version={b.current_version_id ?? ""}
            visible={b.visible}
          />
        </article>
      ))}
      <h2>예외 알림</h2>
      {notices.length ? (
        <ul>
          {notices.map((n, i) => (
            <li key={i}>
              {n.briefing_id} · {n.kind} · {n.status} · 시도 {n.attempts}
            </li>
          ))}
        </ul>
      ) : (
        <p>알림 기록이 없습니다.</p>
      )}
    </main>
  );
}
