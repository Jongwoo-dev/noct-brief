import { z } from "zod";
const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const schema = z.object({
  APP_ENV: z.enum(["local", "production"]).default("local"),
  DATA_MODE: z.enum(["sample", "live"]).default("sample"),
  AUTO_PUBLISH_ENABLED: flag,
  AUTO_BACKUP_ENABLED: flag,
  TELEGRAM_ENABLED: flag,
  EXTERNAL_CALLS_ENABLED: flag,
  DATABASE_URL: z.string().default(""),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  BETTER_AUTH_SECRET: z.string().default(""),
  ADMIN_GOOGLE_SUB: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default(""),
  OPENAI_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(24000)
    .default(8000),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  MARKET_DATA_PROVIDER: z.string().default(""),
  MARKET_DATA_API_KEY: z.string().default(""),
});
export type Config = z.infer<typeof schema>;
export function readConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `설정 확인 필요: ${[...new Set(parsed.error.issues.map((i) => i.path[0]))].join(", ")}`,
    );
  const c = parsed.data;
  if (
    c.APP_ENV === "production" &&
    (c.DATA_MODE !== "live" ||
      !c.DATABASE_URL ||
      !c.BETTER_AUTH_URL.startsWith("https://"))
  )
    throw new Error(
      "운영 필수 설정 확인: DATA_MODE, DATABASE_URL, BETTER_AUTH_URL",
    );
  if (
    c.APP_ENV !== "production" &&
    (c.AUTO_PUBLISH_ENABLED || c.AUTO_BACKUP_ENABLED || c.TELEGRAM_ENABLED)
  )
    throw new Error(
      "로컬에서는 자동 발행·자동 백업·운영 알림을 활성화할 수 없습니다.",
    );
  if (c.DATABASE_URL) {
    let u: URL;
    try {
      u = new URL(c.DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(u.protocol)) throw new Error();
    } catch {
      throw new Error("DATABASE_URL 형식을 확인하세요.");
    }
    if (c.APP_ENV === "local") {
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
        !u.pathname.endsWith("_local")
      )
        throw new Error(
          "로컬 DB는 loopback 주소와 _local DB 이름이 필요합니다.",
        );
    }
  }
  if (c.AUTO_PUBLISH_ENABLED && !c.EXTERNAL_CALLS_ENABLED)
    throw new Error("자동 발행 설정 확인: EXTERNAL_CALLS_ENABLED");
  if (c.TELEGRAM_ENABLED && (!c.TELEGRAM_BOT_TOKEN || !c.TELEGRAM_CHAT_ID))
    throw new Error("알림 설정 확인: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID");
  return c;
}
export function authConfigured(c: Config) {
  return !!(
    c.DATABASE_URL &&
    c.GOOGLE_CLIENT_ID &&
    c.GOOGLE_CLIENT_SECRET &&
    c.BETTER_AUTH_SECRET.length >= 32
  );
}
export function requireExternal(c: Config) {
  if (!c.EXTERNAL_CALLS_ENABLED || c.DATA_MODE !== "live")
    throw new Error("외부 호출은 명시적 활성화가 필요합니다.");
}
