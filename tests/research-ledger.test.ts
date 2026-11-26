import { describe, it, expect } from "vitest";
import { checkBudget } from "../lib/report-trial";
import {
  researchHash,
  researchReservation,
  researchResponseSchema,
  researchUsageCost,
  researchResponseText,
} from "../lib/research-ledger";

const response = researchResponseSchema.parse({
  id: "resp_test",
  status: "completed",
  model: "gpt-6-astra",
  service_tier: "default",
  usage: {
    input_tokens: 12000,
    output_tokens: 1000,
    input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000 },
  },
  output: [
    {
      type: "web_search_call",
      action: {
        type: "search",
        queries: ["a", "b"],
        sources: [{ url: "https://example.com" }],
      },
    },
    {
      type: "web_search_call",
      action: { type: "open_page", url: "https://example.com" },
    },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "{}",
          annotations: [{ type: "url_citation", url: "https://example.com" }],
        },
      ],
    },
  ],
  incomplete_details: null,
});
describe("수집 비용과 원응답 보존", () => {
  it("사용자 승인된 11월 20일 장후만 $15, 다른 회차·하루·누적 한도 유지", () => {
    const used = { edition: 10000000, day: 10000000, total: 10000000 };
    expect(() =>
      checkBudget(
        used,
        4000000,
        "2026-11-20-post/research-v1/gpt-6-astra/high",
      ),
    ).not.toThrow();
    expect(() =>
      checkBudget(used, 4000000, "2026-11-23-post/research-v1"),
    ).toThrow();
    expect(() => checkBudget(used, 5000001, "2026-11-20-post")).toThrow();
    expect(() =>
      checkBudget({ ...used, day: 30000000 }, 1, "2026-11-20-post"),
    ).toThrow();
    expect(() =>
      checkBudget({ ...used, total: 100000000 }, 1, "2026-11-20-post"),
    ).toThrow();
  });
  it("도구 사용 중 commentary를 최종 JSON에 붙이지 않음", () => {
    const r = {
      ...response,
      output: [
        {
          type: "message",
          phase: "commentary",
          content: [{ type: "output_text", text: "조사 중" }],
        },
        {
          type: "message",
          phase: "final_answer",
          content: [{ type: "output_text", text: '{"date":"2026-11-20"}' }],
        },
      ],
    };
    expect(researchResponseText(r)).toBe('{"date":"2026-11-20"}');
  });
  it("검색어·열람 수와 유료 search action을 구분하고 캐시 사용량을 한 번 계산", () => {
    const cost = researchUsageCost("gpt-6-astra", response);
    expect(cost.tokenMicrousd).toBe(151500);
    expect(cost.searchMicrousd).toBe(10000);
    expect(cost.actions).toEqual({ search: 1, open_page: 1, find_in_page: 0 });
    expect(response.output[0].action).toHaveProperty("sources");
    expect(response.output[2].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ annotations: expect.any(Array) }),
      ]),
    );
  });
  it("공식 청구 대상 검색 집계를 trace보다 우선함", () => {
    const cost = researchUsageCost("gpt-6-astra", {
      ...response,
      tool_usage: { web_search: { num_requests: 0 } },
    });
    expect(cost.actions.search).toBe(1);
    expect(cost.billedSearches).toBe(0);
    expect(cost.searchMicrousd).toBe(0);
    expect(cost.searchCountBasis).toBe("tool_usage");
  });
  it("272k 초과 합산 입력은 장문 가정과 기본 환산액을 함께 보존", () => {
    const r = {
      ...response,
      usage: {
        input_tokens: 300000,
        output_tokens: 1000,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      },
    };
    const cost = researchUsageCost("gpt-6-astra", r);
    expect(cost.totalMicrousd).toBe(6085000);
    expect(cost.standardTotalMicrousd).toBe(3060000);
    expect(cost.longContextConfirmed).toBe(false);
  });
  it("사용량 없는 실패와 모르는 도구 유형을 무료로 정산하지 않음", () => {
    expect(() =>
      researchUsageCost("gpt-6-astra", { ...response, usage: null }),
    ).toThrow();
    expect(() =>
      researchUsageCost("gpt-6-astra", {
        ...response,
        output: [{ type: "web_search_call", action: { type: "unknown" } }],
      }),
    ).toThrow();
    expect(() => researchUsageCost("gpt-6.2-sol", response)).toThrow();
  });
  it("필드 순서가 달라도 같은 요청이며 모델·강도 변경은 구분", () => {
    expect(researchHash({ a: 1, b: { x: 2, y: 3 } })).toBe(
      researchHash({ b: { y: 3, x: 2 }, a: 1 }),
    );
    expect(researchHash({ model: "gpt-6-astra", effort: "high" })).not.toBe(
      researchHash({ model: "gpt-6-astra", effort: "xhigh" }),
    );
    expect(
      researchReservation({
        model: "gpt-6-astra",
        max_output_tokens: 32000,
        max_tool_calls: 40,
      }),
    ).toBeGreaterThan(3600000);
  });
});
