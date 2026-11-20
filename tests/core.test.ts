import { describe, it, expect } from "vitest";
import { schedule, tradingDay, upcoming, kst, dueSlots } from "../lib/calendar";
import { readConfig } from "../lib/config";
import { samples, sampleContent } from "../data/samples";
import { validateContent, safeUrl } from "../lib/contract";
import { equalSecret, sameOrigin } from "../lib/security";
import { expiredBackups } from "../scripts/ops/backup-policy";
describe("거래일과 시간", () => {
  it("DST 전환 전후 장전·장후 한국 시각", () => {
    expect(kst(schedule("2026-03-06", "pre").targetAt)).toContain("21:30");
    expect(kst(schedule("2026-03-09", "pre").targetAt)).toContain("20:30");
    expect(kst(schedule("2026-10-30", "post").targetAt)).toContain("08:30");
    expect(kst(schedule("2026-11-02", "post").targetAt)).toContain("09:30");
  });
  it("금요일 장후는 한국 토요일", () =>
    expect(kst(schedule("2026-10-23", "post").targetAt)).toContain(
      "24일 (토)",
    ));
  it("휴장·주말·달력 밖 구분", () => {
    expect(tradingDay("2026-11-26")).toBe(false);
    expect(tradingDay("2026-10-25")).toBe(false);
    expect(tradingDay("2028-01-03")).toBe(null);
    expect(tradingDay("2026-02-30")).toBe(null);
  });
  it("임시 휴장은 미래 회차 계산에서 차단 가능", () =>
    expect(tradingDay("2026-10-27", ["2026-10-27"])).toBe(false));
  it("조기 폐장에도 발행 시각 유지", () => {
    const s = schedule("2026-11-27", "post");
    expect(s.earlyClose).toBe(true);
    expect(s.closeAt).toContain("18:00");
    expect(s.targetAt).toContain("00:30");
  });
  it("휴일 이후 다음 장전과 미정 처리", () => {
    expect(upcoming(new Date("2026-11-26T04:00:00Z"))[0].date).toBe(
      "2026-11-27",
    );
    expect(upcoming(new Date("2028-01-01T12:00:00Z"))).toHaveLength(0);
  });
  it("주말 회차를 만들지 않고 지난 미실행 회차 복구", () => {
    const r = dueSlots(
      new Date("2026-10-26T11:15:00Z"),
      new Date("2026-10-23T23:00:00Z"),
    );
    expect(r.map((s) => s.id)).toEqual(["2026-10-23-post", "2026-10-26-pre"]);
  });
});
describe("콘텐츠 경계", () => {
  it.each(samples.map((s) => [s.id, s.content]))("대표 샘플 %s", (_, content) =>
    expect(() => validateContent(content, "sample")).not.toThrow(),
  );
  it("가상 내용을 실제 모드에서 거부", () =>
    expect(() => validateContent(samples[0].content, "live")).toThrow());
  it("허구 출처와 수치 거부", () => {
    let c = structuredClone(samples[0].content);
    c.draft.summary[0].sourceIds = ["invented"];
    expect(() => validateContent(c, "sample")).toThrow("근거");
    c = structuredClone(samples[0].content);
    c.draft.summary[0].text = "지수가 9783.21 올랐습니다";
    expect(() => validateContent(c, "sample")).toThrow("수치");
  });
  it("미래 정보 소급 거부", () => {
    const c = sampleContent("2026-10-26", "pre");
    c.bundle.events[0].status = "released";
    c.bundle.events[0].occurredAt = "2026-10-26T20:00:00Z";
    expect(() => validateContent(c, "sample")).toThrow("사건");
  });
  it("차트 단위 충돌 거부", () => {
    const c = structuredClone(samples[0].content);
    c.charts[0].unit = "USD";
    expect(() => validateContent(c, "sample")).toThrow("단위");
  });
  it("해석 한계 누락 거부", () => {
    const c = structuredClone(samples[0].content);
    c.draft.summary[0].limitation = "";
    expect(() => validateContent(c, "sample")).toThrow("한계");
  });
  it.each([
    "javascript:alert(1)",
    "https://127.0.0.1",
    "https://169.254.169.254/latest",
    "https://[::1]",
    "https://user:password@example.com",
    "https://foo.internal",
  ])("위험 URL %s", (url) => expect(safeUrl(url)).toBe(false));
});
describe("환경·권한", () => {
  it("문자열 false를 끔으로 처리", () =>
    expect(readConfig({ TELEGRAM_ENABLED: "false" }).TELEGRAM_ENABLED).toBe(
      false,
    ));
  it("운영 누락과 잘못된 boolean을 거부", () => {
    expect(() => readConfig({ APP_ENV: "production" })).toThrow();
    expect(() => readConfig({ TELEGRAM_ENABLED: "0" })).toThrow();
  });
  it("로컬 자동 발행과 운영 DB 연결 거부", () => {
    expect(() => readConfig({ AUTO_PUBLISH_ENABLED: "true" })).toThrow();
    expect(() =>
      readConfig({ DATABASE_URL: "postgresql://a:b@remote.example/db_local" }),
    ).toThrow();
    expect(() =>
      readConfig({ DATABASE_URL: "postgresql://a:b@localhost/prod" }),
    ).toThrow();
  });
  it("예약 비밀키 누락·오류 거부", () => {
    expect(equalSecret("x", "")).toBe(false);
    expect(equalSecret("x", "y")).toBe(false);
    expect(equalSecret("x", "x")).toBe(true);
  });
  it("교차 출처 및 비JSON 변경 요청 거부", () => {
    expect(
      sameOrigin(
        new Headers({
          origin: "https://evil.example",
          "content-type": "application/json",
        }),
        "https://noct.example",
      ),
    ).toBe(false);
    expect(
      sameOrigin(
        new Headers({
          origin: "https://noct.example",
          "content-type": "text/plain",
        }),
        "https://noct.example",
      ),
    ).toBe(false);
    expect(
      sameOrigin(
        new Headers({
          origin: "https://noct.example",
          "content-type": "application/json",
        }),
        "https://noct.example",
      ),
    ).toBe(true);
  });
});
describe("백업 보관", () => {
  it("14일보다 오래된 지정 덤프만 선택", () => {
    expect(
      expiredBackups(
        [
          "noct-db/noct-2026-10-01T07-00-00Z.dump",
          "noct-db/noct-2026-02-30T07-00-00Z.dump",
          "noct-db/noct-2026-10-13T07-00-00Z.dump",
          "noct-db/noct-2026-10-27T07-00-00Z.dump",
          "other/noct-2026-10-01T07-00-00Z.dump",
          "noct-db/important.dump",
        ],
        new Date("2026-10-27T07:00:00Z"),
      ),
    ).toEqual(["noct-db/noct-2026-10-01T07-00-00Z.dump"]);
  });
});
