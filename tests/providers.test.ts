import { it, expect, vi } from "vitest";
import { ResponsesGenerator } from "../lib/providers";
import { readConfig } from "../lib/config";
import { sampleContent } from "../data/samples";
import type { Job } from "../lib/repository";
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
