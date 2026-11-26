"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { adminActions, type AdminEdition } from "@/lib/admin";
const authClient = createAuthClient();
export function LoginButton() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="primary-action"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await authClient.signIn.social({
              provider: "google",
              callbackURL: "/admin",
              errorCallbackURL: "/admin?error=oauth",
            });
            if (result.error) throw new Error();
          } catch {
            setError("로그인을 시작하지 못했습니다. 다시 시도해 주세요.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "로그인 연결 중…" : "Google로 로그인"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function SignOut() {
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="quiet-button"
        onClick={async () => {
          try {
            const result = await authClient.signOut();
            if (result.error) throw new Error();
            window.location.assign("/admin");
          } catch {
            setError("로그아웃하지 못했습니다. 다시 시도해 주세요.");
          }
        }}
      >
        로그아웃
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function RefreshAdmin() {
  const router = useRouter();
  return (
    <button className="quiet-button" onClick={() => router.refresh()}>
      상태 새로고침
    </button>
  );
}
export function AdminControls({ edition }: { edition: AdminEdition }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false),
    [confirm, setConfirm] = useState(false);
  const pending = useRef(false);
  const router = useRouter();
  const actions = adminActions(edition);
  async function send(action: string, fields: Record<string, string> = {}) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const r = await fetch("/api/admin/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          briefingId: edition.id,
          baseVersion: edition.version,
          jobId: edition.job?.id,
          action,
          ...fields,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setFailed(true);
        setMessage(data.error ?? "요청을 적용하지 못했습니다.");
      } else {
        setMessage(
          action === "retry"
            ? "재시도를 예약했습니다. 다음 처리에서 이어집니다."
            : action === "correct"
              ? "정정 요청을 저장했습니다. 수정본 검증 전까지 현재 보고서는 유지됩니다."
              : edition.missedAt
                ? action === "hide"
                  ? "미발행 안내를 숨겼습니다."
                  : "미발행 안내를 다시 공개했습니다."
                : action === "hide"
                  ? "비공개로 전환했습니다. 보고서와 이력은 보관됩니다."
                  : "보관된 현재 보고서를 다시 공개했습니다.",
        );
        setConfirm(false);
        router.refresh();
      }
    } catch {
      setFailed(true);
      setMessage(
        "요청 결과를 확인하지 못했습니다. 다시 누르기 전에 상태를 새로고침해 주세요.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="admin-controls" aria-label="보고서 관리">
      <h2>관리 작업</h2>
      <div className="button-row">
        {actions.retry && (
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void send("retry")}
          >
            실패 작업 재시도
          </button>
        )}
        {actions.visibility && (
          <button
            disabled={busy}
            aria-expanded={confirm}
            onClick={() => setConfirm(!confirm)}
          >
            {edition.visible ? "비공개로 전환" : "공개 복구"}
          </button>
        )}
      </div>
      {confirm && (
        <div className="admin-confirm">
          <p>
            {edition.missedAt
              ? edition.visible
                ? "이 회차의 미발행 안내를 목록과 직접 주소에서 숨깁니다."
                : "이 회차의 미발행 안내를 다시 공개합니다."
              : edition.visible
                ? "목록과 직접 주소에서 이 보고서를 숨깁니다. 저장된 내용과 정정 이력은 남습니다."
                : "보관된 현재 버전을 다시 공개합니다. 새 보고서를 생성하지 않습니다."}
          </p>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() => void send(edition.visible ? "hide" : "restore")}
            >
              {edition.visible ? "비공개 전환 확인" : "공개 복구 확인"}
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              취소
            </button>
          </div>
        </div>
      )}
      {!actions.retry && !actions.correct && !edition.version && (
        <p className="meta">
          현재 상태에서는 새 작업을 요청할 수 없습니다. 처리 상태와 안내를
          확인하세요.
        </p>
      )}
      {edition.version && (
        <details>
          <summary>오류 정정 요청</summary>
          <p className="meta">
            기존 내용의 오류와 근거를 남기세요. 이후에 생긴 새 정보는 다음
            회차에서 다룹니다. 정정 중에도 현재 공개 여부는 유지됩니다.
          </p>
          {!actions.correct && (
            <p className="notice-inline">
              진행 중인 작업이나 접수 확인이 필요한 요청을 먼저 처리하세요.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send("correct", {
                issue: String(f.get("issue")).trim(),
                reason: String(f.get("reason")).trim(),
                evidenceUrl: String(f.get("evidenceUrl")).trim(),
              });
            }}
          >
            <fieldset disabled={busy || !actions.correct}>
              <label>
                잘못된 항목
                <textarea
                  name="issue"
                  required
                  maxLength={2000}
                  placeholder="어느 문장이나 수치를 확인해야 하나요?"
                />
              </label>
              <label>
                정정 이유
                <textarea
                  name="reason"
                  required
                  maxLength={2000}
                  placeholder="어떤 점이 잘못되었는지 설명해 주세요."
                />
              </label>
              <label>
                확인 근거 URL
                <input
                  name="evidenceUrl"
                  type="url"
                  pattern="https://.*"
                  required
                  maxLength={2000}
                  placeholder="https://"
                />
              </label>
              <button
                className="primary-action"
                disabled={busy || !actions.correct}
              >
                정정 요청 저장
              </button>
            </fieldset>
          </form>
        </details>
      )}
      {busy && <p role="status">요청을 처리하고 있습니다…</p>}
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "notice-inline" : "admin-success"}
        >
          {message}
        </p>
      )}
    </section>
  );
}
export function SampleTools() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef(false);
  const router = useRouter();
  async function run(action: "enqueue" | "step", form?: FormData) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          date: form?.get("date"),
        }),
      });
      const data = await r.json();
      setMessage(r.ok ? data.message : data.error);
      router.refresh();
    } catch {
      setMessage("결과를 확인하지 못했습니다. 상태를 새로고침해 주세요.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="admin-sample-tools">
      <summary>더미 리포트로 발행 흐름 테스트</summary>
      <p>
        내용은 가상 자료이며 저장·검증·발행은 실제 로컬 처리 흐름을 사용합니다.
        외부 API는 호출하지 않습니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run("enqueue", new FormData(e.currentTarget));
        }}
      >
        <label>
          미국 거래일
          <input
            type="date"
            name="date"
            required
            defaultValue="2026-10-28"
            disabled={busy}
          />
        </label>
        <button disabled={busy}>장후 테스트 회차 등록</button>
      </form>
      <div className="button-row">
        <button disabled={busy} onClick={() => void run("step")}>
          대기 작업 한 단계 진행
        </button>
      </div>
      <p className="meta">
        동일 회차는 중복 등록하지 않습니다. 단계 진행은 처리 시각이 된 작업
        하나에 적용되며, 발행 목표 전에는 공개되지 않습니다.
      </p>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
