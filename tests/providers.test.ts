import { it, expect, vi } from "vitest";
import { ResponsesGenerator } from "../lib/providers";
import { readConfig } from "../lib/config";
import { sampleContent } from "../data/samples";
import type { Job, Repository } from "../lib/repository";
import { Worker } from "../lib/worker";
const config = readConfig({
  EXTERNAL_CALLS_ENABLED: "true",
  DATA_MODE: "live",
  OPENAI_API_KEY: "test-key-not-real",
  OPENAI_MODEL: "test-model",
});
const content = sampleContent("2026-10-26", "post");
const job = {
  config: {
    model: "test-model",
    reasoning: "medium",
    maxOutputTokens: 8000,
    promptVersion: "noct-v1",
  },
  payload: {},
  us_trading_date: "2026-10-26",
  session: "post",
  kind: "initial",
} as Job;
it("외부 비활성에서는 네트워크 호출 없음", async () => {
  const request = vi.fn();
  await expect(
    new ResponsesGenerator(readConfig(), request).submit(job, content.bundle),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("background와 schema, 모델 고정, 결과 usage 회수", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id: "resp_fake" }))
    .mockResolvedValueOnce(
      Response.json({
        status: "completed",
        output: [
          {
            content: [
              { type: "output_text", text: JSON.stringify(content.draft) },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
  const g = new ResponsesGenerator(config, request);
  expect(await g.submit(job, content.bundle)).toEqual({ id: "resp_fake" });
  const sent = JSON.parse(request.mock.calls[0][1].body);
  expect(sent.background).toBe(true);
  expect(sent.store).toBe(true);
  expect(sent.text.format.strict).toBe(true);
  expect(sent.model).toBe("test-model");
  expect((await g.poll("resp_fake")).usage).toEqual({
    input_tokens: 1,
    output_tokens: 2,
  });
});
it("POST 타임아웃은 접수 불명, 자동 재시도 금지", async () => {
  const request = vi.fn().mockRejectedValue(new Error("timeout"));
  await expect(
    new ResponsesGenerator(config, request).submit(job, content.bundle),
  ).rejects.toMatchObject({ ambiguous: true, retryable: false });
  expect(request).toHaveBeenCalledTimes(1);
});
it("429와 Retry-After 구분", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response("", { status: 429, headers: { "Retry-After": "180" } }),
    );
  await expect(
    new ResponsesGenerator(config, request).submit(job, content.bundle),
  ).rejects.toMatchObject({ retryable: true, retryAfterSeconds: 180 });
});
it.each([
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "credit_balance_exhausted",
])("%s는 제출·결과 조회 모두 자동 재시도하지 않음", async (code) => {
  const request = vi
    .fn()
    .mockImplementation(async () =>
      Response.json(
        { error: { code, message: "do not retain provider message" } },
        { status: 429, headers: { "Retry-After": "180" } },
      ),
    );
  const generator = new ResponsesGenerator(config, request);
  for (const operation of [
    () => generator.submit(job, content.bundle),
    () => generator.poll("resp_fake"),
  ])
    await expect(operation()).rejects.toMatchObject({
      code: code.toUpperCase(),
      message: code.toUpperCase(),
      retryable: false,
      ambiguous: false,
      retryAfterSeconds: 0,
    });
  expect(request).toHaveBeenCalledTimes(2);
});
it("일시 호출 제한의 JSON 응답은 Retry-After를 유지", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { error: { code: "rate_limit_exceeded" } },
        { status: 429, headers: { "Retry-After": "180" } },
      ),
    );
  await expect(
    new ResponsesGenerator(config, request).poll("resp_fake"),
  ).rejects.toMatchObject({
    code: "HTTP_429",
    retryable: true,
    retryAfterSeconds: 180,
  });
});
it("비용 한도 응답은 작업 실패로 보존하고 재시도를 예약하지 않음", async () => {
  const now = new Date("2026-10-27T00:00:00Z");
  const runningJob = {
    ...job,
    briefing_id: "test-briefing",
    target_at: new Date("2026-10-26T23:30:00Z"),
    state: "generating",
    attempt: 0,
    payload: { responseId: "resp_fake" },
  };
  const repo = {
    claim: vi.fn().mockResolvedValue(runningJob),
    fail: vi.fn(),
  };
  const request = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { error: { code: "project_spend_limit_exceeded" } },
        { status: 429 },
      ),
    );
  const worker = new Worker(
    repo as unknown as Repository,
    { collect: vi.fn(), refresh: vi.fn() },
    new ResponsesGenerator(config, request),
  );
  expect(await worker.tick(now)).toBe("processed");
  expect(repo.fail).toHaveBeenCalledExactlyOnceWith(
    runningJob,
    "PROJECT_SPEND_LIMIT_EXCEEDED",
    now,
  );
  expect(request).toHaveBeenCalledOnce();
});
it("거부·불완전 응답은 초안으로 사용하지 않음", async () => {
  for (const response of [
    { status: "incomplete" },
    { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
  ])
    await expect(
      new ResponsesGenerator(
        config,
        vi.fn().mockResolvedValue(Response.json(response)),
      ).poll("resp_fake"),
    ).rejects.toThrow();
});
