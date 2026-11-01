"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
const authClient = createAuthClient();
export function LoginButton() {
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="primary-action"
        onClick={async () => {
          const result = await authClient.signIn.social({
            provider: "google",
            callbackURL: "/admin",
          });
          if (result.error) setError("로그인을 시작하지 못했습니다.");
        }}
      >
        Google로 로그인
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function SignOut() {
  return (
    <button
      className="quiet-button"
      onClick={async () => {
        await authClient.signOut();
        window.location.assign("/admin");
      }}
    >
      로그아웃
    </button>
  );
}
export function AdminControls({
  id,
  version,
  visible,
}: {
  id: string;
  version: string;
  visible: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  async function send(action: string, fields: Record<string, string> = {}) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          briefingId: id,
          baseVersion: version,
          action,
          ...fields,
        }),
      });
      const data = await r.json();
      setMessage(r.ok ? "요청을 반영했습니다." : data.error);
      if (r.ok) router.refresh();
    } catch {
      setMessage(
        "요청 결과를 확인하지 못했습니다. 새로고침 후 상태를 확인하세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-controls">
      <div className="button-row">
        {version && (
          <button
            disabled={busy}
            onClick={() => send(visible ? "hide" : "restore")}
          >
            {visible ? "비공개로 전환" : "공개 복구"}
          </button>
        )}
        <button disabled={busy} onClick={() => send("retry")}>
          실패 작업 재시도
        </button>
      </div>
      {version && (
        <details>
          <summary>근거를 포함한 오류 정정 요청</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send("correct", {
                issue: String(f.get("issue")),
                reason: String(f.get("reason")),
                evidenceUrl: String(f.get("evidenceUrl")),
              });
            }}
          >
            <label>
              잘못된 항목
              <textarea name="issue" required maxLength={2000} />
            </label>
            <label>
              정정 이유
              <textarea name="reason" required maxLength={2000} />
            </label>
            <label>
              확인 근거 URL
              <input
                name="evidenceUrl"
                type="url"
                required
                placeholder="https://"
              />
            </label>
            <p className="meta">
              수정본 검증 전에는 현재 버전이 유지됩니다. 새 정보는 다음 회차에
              반영합니다.
            </p>
            <button className="primary-action" disabled={busy}>
              정정 요청 저장
            </button>
          </form>
        </details>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
