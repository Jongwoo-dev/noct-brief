import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="home empty">
      <p className="eyebrow">NOT AVAILABLE</p>
      <h1>공개된 브리핑을 찾을 수 없습니다.</h1>
      <p>주소를 확인하거나 목록에서 다른 브리핑을 선택해 주세요.</p>
      <Link href="/">브리핑 목록으로 →</Link>
    </main>
  );
}
