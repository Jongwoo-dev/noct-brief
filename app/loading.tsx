export default function Loading() {
  return (
    <main id="main" className="home" aria-busy="true">
      <p className="eyebrow">브리핑을 불러오는 중입니다</p>
      <div className="skeleton tall" />
      <div className="skeleton" />
      <div className="skeleton" />
    </main>
  );
}
