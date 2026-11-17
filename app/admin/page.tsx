import Link from "next/link";
import { headers } from "next/headers";
import { identity, getAuth } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { runtime } from "@/lib/runtime";
import { adminOverview } from "@/lib/admin-queries";
import { adminSearch } from "@/lib/admin";
import { LoginButton, SignOut } from "@/components/admin-controls";
import { AdminDashboard } from "@/components/admin-dashboard";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "브리핑 운영",
  robots: { index: false, follow: false },
};
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = readConfig(),
    sample = c.APP_ENV === "local" && c.DATA_MODE === "sample";
  const user = await identity(await headers());
  if (!user)
    return (
      <main id="main" className="home admin-login">
        <p className="eyebrow">NOCT CONTROL</p>
        <h1>브리핑 운영</h1>
        <p>
          보고서의 처리 상태와 발행·보관 이력을 확인합니다.
          <br />
          등록된 운영자 Google 계정으로 로그인해 주세요.
        </p>
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
        {sample && (
          <Link className="admin-preview-link" href="/admin/preview">
            가상 자료로 관리자 화면 둘러보기 →
          </Link>
        )}
      </main>
    );
  if (!user.admin)
    return (
      <main id="main" className="home admin-login">
        <h1>관리자 권한이 없습니다.</h1>
        <p>
          본인 계정 최초 등록 시 아래 검증된 Google 식별자를 환경 설정의
          ADMIN_GOOGLE_SUB에 등록한 뒤 다시 로그인하세요.
        </p>
        <code>{user.sub}</code>
        <p>식별자 확인만으로 관리자 권한을 부여하지 않습니다.</p>
        <SignOut />
      </main>
    );
  const { filter, date, page } = adminSearch(await searchParams),
    { db } = await runtime();
  return (
    <AdminDashboard
      {...await adminOverview(db, filter, date, page)}
      filter={filter}
      date={date}
      page={page}
      sample={sample}
    />
  );
}
