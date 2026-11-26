import { describe, it, expect } from "vitest";
import {
  schedule,
  tradingDay,
  upcoming,
  kst,
  dueSlots,
  latestDueSlot,
  nextTradingClose,
} from "../lib/calendar";
import { readConfig } from "../lib/config";
import { samples, sampleContent } from "../data/samples";
import {
  BundleSchema,
  validateContent,
  safeUrl,
  upcomingEvents,
  eventTimeLabel,
  isUpcomingSection,
} from "../lib/contract";
import { sameOrigin } from "../lib/security";
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
  it("휴일 이후 다음 장후와 미정 처리", () => {
    expect(upcoming(new Date("2026-11-26T04:00:00Z"))[0].id).toBe(
      "2026-11-27-post",
    );
    expect(upcoming(new Date("2028-01-01T12:00:00Z"))).toHaveLength(0);
  });
  it("주말 회차를 만들지 않고 지난 미실행 회차 복구", () => {
    const r = dueSlots(
      new Date("2026-10-26T11:15:00Z"),
      new Date("2026-10-23T23:00:00Z"),
    );
    expect(r.map((s) => s.id)).toEqual(["2026-10-23-post"]);
    expect(latestDueSlot(new Date("2026-10-26T23:29:59Z"))?.id).toBe(
      "2026-10-23-post",
    );
    expect(latestDueSlot(new Date("2026-10-26T23:30:00Z"))?.id).toBe(
      "2026-10-26-post",
    );
  });
  it("예정 범위는 휴장·주말을 지나 다음 거래일 실제 폐장까지", () => {
    expect(nextTradingClose("2026-11-25")).toBe("2026-11-27T18:00:00.000Z");
    expect(nextTradingClose("2026-11-27")).toBe("2026-11-30T21:00:00.000Z");
    expect(nextTradingClose("2026-10-30")).toBe("2026-11-02T21:00:00.000Z");
    expect(nextTradingClose("2027-12-31")).toBeUndefined();
  });
  it("마감 당시 확인된 미래 일정만 거래일 폐장까지 시각 순으로 안내", () => {
    const { bundle } = sampleContent("2026-11-25", "post");
    const event = {
      ...bundle.events[0],
      occurredAt: null,
      status: "scheduled" as const,
    };
    bundle.events = [
      { ...event, id: "close", scheduledAt: "2026-11-27T18:00:00Z" },
      { ...event, id: "after-close", scheduledAt: "2026-11-27T18:00:01Z" },
      { ...event, id: "holiday", scheduledAt: "2026-11-26T16:00:00Z" },
      { ...event, id: "past", scheduledAt: bundle.cutoffAt },
      {
        ...event,
        id: "unconfirmed",
        status: "unconfirmed",
        scheduledAt: "2026-11-27T16:00:00Z",
      },
      {
        ...event,
        id: "late-source",
        firstObservedAt: "2026-11-26T01:00:00Z",
        scheduledAt: "2026-11-27T17:00:00Z",
      },
    ];
    expect(
      upcomingEvents("2026-11-25", bundle).events.map((item) => item.id),
    ).toEqual(["holiday", "close"]);
  });
  it("장전·정규장 범위만 확인한 일정은 시분 없이 표시", () => {
    const { bundle } = sampleContent("2026-11-25", "post");
    const event = {
      ...bundle.events[0],
      scheduledAt: null,
      occurredAt: null,
      status: "scheduled" as const,
    };
    const pre = {
      ...event,
      id: "next-pre",
      scheduledWindow: { date: "2026-11-27", session: "pre" as const },
    };
    const regular = {
      ...event,
      id: "next-regular",
      scheduledWindow: { date: "2026-11-27", session: "regular" as const },
    };
    const overlapping = {
      ...event,
      id: "overlapping",
      scheduledWindow: { date: "2026-11-25", session: "post" as const },
    };
    const outside = {
      ...event,
      id: "outside",
      scheduledWindow: { date: "2026-11-27", session: "post" as const },
    };
    const unknown = {
      ...event,
      id: "unknown",
      scheduledWindow: { date: "2028-01-03", session: "pre" as const },
    };
    const parsed = BundleSchema.parse({
      ...bundle,
      events: [outside, regular, pre],
    });
    expect(upcomingEvents("2026-11-25", parsed)).toEqual({
      calendarKnown: true,
      uncertain: false,
      events: [pre, regular],
    });
    for (const item of [overlapping, unknown]) {
      expect(
        upcomingEvents("2026-11-25", { ...parsed, events: [item] }),
      ).toEqual({
        calendarKnown: true,
        uncertain: true,
        events: [],
      });
    }
    expect(upcomingEvents("2027-12-31", parsed)).toMatchObject({
      calendarKnown: false,
      events: [],
    });
    expect(eventTimeLabel(pre)).toBe(
      "11월 27일 (금) KST (원문 미국 동부 2026-11-27 장전)",
    );
    expect(eventTimeLabel(regular)).toBe(
      "11월 27일 (금)~11월 28일 (토) KST (원문 미국 동부 2026-11-27 정규장)",
    );
    expect(eventTimeLabel(bundle.events[0])).toMatch(
      /21:30 KST \(2026-11-25 12:30 UTC\)/,
    );
    expect(BundleSchema.parse(bundle).events).toEqual(bundle.events);
    for (const bad of [
      event,
      { ...pre, scheduledAt: bundle.events[0].scheduledAt },
    ]) {
      expect(BundleSchema.safeParse({ ...bundle, events: [bad] }).success).toBe(
        false,
      );
    }
  });
  it("예정 일정만 근거로 쓰는 구역을 본문의 혼합 해석과 구분", () => {
    const { draft } = sampleContent("2026-11-25", "post");
    const section = {
      ...draft.sections[0],
      type: "events" as const,
      chartIds: [],
      claims: [{ ...draft.sections[0].claims[0], eventIds: ["next-pre"] }],
    };
    const ids = new Set(["next-pre"]);
    expect(isUpcomingSection(section, ids)).toBe(true);
    expect(isUpcomingSection(section, new Set())).toBe(false);
    expect(
      isUpcomingSection(
        {
          ...section,
          claims: [...section.claims, draft.sections[0].claims[1]],
        },
        ids,
      ),
    ).toBe(false);
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
  it("연도와 함께 인용한 영문 월 이름은 같은 한국어 달에만 대응한다", () => {
    const c = structuredClone(samples[0].content);
    const source = c.bundle.sources[0];
    source.excerpt = "October 2026: unchanged in 46 states.";
    const claim = {
      ...c.draft.summary[0],
      sourceIds: [source.id],
      observationIds: [],
      eventIds: [],
      limitation: "",
      kind: "fact" as const,
      text: "10월에 46개 주에서 변화가 없었다.",
    };
    c.draft = { title: "지역 고용", summary: [claim], sections: [] };
    expect(() => validateContent(c, "sample")).not.toThrow();
    for (const text of [
      "11월에 변화가 없었다.",
      "10월에 10% 증가했다.",
      "110월 조사",
    ]) {
      claim.text = text;
      expect(() => validateContent(c, "sample")).toThrow("수치");
    }
  });
  it("시각은 직접 인용한 출처의 같은 시간대와 시·분 쌍에만 대응한다", () => {
    const c = structuredClone(samples[0].content);
    const [cited] = c.bundle.sources;
    cited.excerpt =
      "14:29 ET 장중 3.6% 하락. 17:36 ET 보도, 18:02 ET 관측. " +
      "2개 기록의 18번과 36번 항목. 미 동부시간 09:45, 한국시간 23:45 발표 예정. " +
      "10:21 UTC 기록과 11:22 UTC+9 기록.";
    c.bundle.sources.push({
      ...cited,
      id: "uncited-clock",
      excerpt: "19:05 ET 관측.",
    });
    const text =
      "미 동부시간 오후 2시 29분 장중 3.6% 하락했고, 오후5시36분에 보도됐다. " +
      "미 동부시간 오전 9시 45분, 한국시간 오후 11시 45분 발표를 지켜볼 일이다. " +
      "UTC+9 11:22 기록도 있다.";
    const limitation =
      "시간외 자료는 18시 2분과 오후 6시 2분 관측값에 한정된다.";
    const claim = {
      ...c.draft.summary[0],
      sourceIds: [cited.id],
      observationIds: [],
      eventIds: [],
      kind: "ai_inference" as const,
      text,
      limitation,
    };
    c.draft = { title: "관측 시각", summary: [claim], sections: [] };
    expect(validateContent(c, "sample").draft.summary[0]).toEqual(claim);

    for (const unsupported of [
      "오후 7시 5분", // Only in the uncited source.
      "18:36 ET", // Both numbers are also present separately in the cited excerpt.
      "오후 6시 36분",
      "18시 36분",
      "오전 2시 29분",
      "한국시간 18:02",
      "한국시간 오후 6시 2분",
      "한국시간으로 오후 2시 29분",
      "오후 2시 29분(한국시간)",
      "오후 2시 29분(미국 서부시간)",
      "UTC 18:02",
      "14:29 (UTC)",
      "14:29 CET",
      "UTC+9 14:29",
      "14:29 (UTC+09:00)",
      "14:29 GMT+9",
      "UTC+9 10:21",
      "11:22 UTC",
      "17% 상승",
      "6% 상승",
    ]) {
      claim.limitation = unsupported;
      expect(() => validateContent(c, "sample"), unsupported).toThrow(
        "입력 근거에 없는 수치",
      );
    }
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
  it("자동 백업은 기본 꺼짐이며 로컬 활성화를 거부한다", () => {
    expect(readConfig({}).AUTO_BACKUP_ENABLED).toBe(false);
    expect(() => readConfig({ AUTO_BACKUP_ENABLED: "true" })).toThrow("로컬");
  });
  it("운영 자동 발행은 외부 호출 활성화가 필요", () => {
    const env = {
      APP_ENV: "production",
      DATA_MODE: "live",
      BETTER_AUTH_URL: "https://noct.example",
      DATABASE_URL: "postgres://localhost/noct_test",
      AUTO_PUBLISH_ENABLED: "true",
    };
    expect(() => readConfig(env)).toThrow("EXTERNAL_CALLS_ENABLED");
    expect(
      readConfig({ ...env, EXTERNAL_CALLS_ENABLED: "true" })
        .AUTO_PUBLISH_ENABLED,
    ).toBe(true);
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
