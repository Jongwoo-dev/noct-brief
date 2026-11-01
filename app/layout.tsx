import type { Metadata } from "next";
import Link from "next/link";
import { UiIcon } from "@/components/ui-icon";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "NOCT Brief · 녹 브리프", template: "%s · NOCT Brief" },
  description: "미국 증시의 흐름을 읽는 장전·장후 브리핑",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="preload"
          href="/fonts/pretendard/PretendardVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <a className="skip" href="#main">
          본문으로 이동
        </a>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="NOCT Brief 홈">
            <img
              className="brand-mark"
              src="/brand/noct-mark.svg"
              width="28"
              height="28"
              alt=""
            />
            NOCT<span>Brief</span>
          </Link>
          <nav aria-label="주 탐색">
            <Link href="/#archive">
              지난 브리핑 <UiIcon name="forward" />
            </Link>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <Link className="brand small" href="/">
            <img
              className="brand-mark"
              src="/brand/noct-mark.svg"
              width="28"
              height="28"
              alt=""
            />
            NOCT<span>Brief</span>
          </Link>
          <p>
            미국 시장을 차분하게, 근거와 함께.
            <br />
            <span>
              정보 제공을 위한 브리핑입니다. 해석에는 불확실성이 있습니다.
            </span>
          </p>
          <Link href="/admin">관리자</Link>
        </footer>
      </body>
    </html>
  );
}
