import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  query: vi.fn(),
  assertDatabase: vi.fn(),
  betterAuth: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("../lib/db", () => ({
  pool: () => ({ query: mocks.query }),
  assertDatabase: mocks.assertDatabase,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({
    APP_ENV: "local",
    DATA_MODE: "sample",
    DATABASE_URL: "postgresql://test:test@localhost/noct_auth_test_local",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_CLIENT_ID: "test-only-client",
    GOOGLE_CLIENT_SECRET: "test-only-client-secret",
    ADMIN_GOOGLE_SUB: "operator-sub",
    AUTO_PUBLISH_ENABLED: "false",
    TELEGRAM_ENABLED: "false",
  }))
    vi.stubEnv(key, value);
  mocks.betterAuth.mockReturnValue({ api: { getSession: mocks.session } });
  mocks.assertDatabase.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("OAuth 설정 누락은 세션이나 DB를 조회하지 않고 닫힘", async () => {
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  const { identity } = await import("../lib/auth");
  expect(await identity(new Headers())).toBeNull();
  expect(mocks.betterAuth).not.toHaveBeenCalled();
  expect(mocks.query).not.toHaveBeenCalled();
});

it("세션이 없거나 Google 연결 계정이 없으면 관리 권한 없음", async () => {
  const { identity } = await import("../lib/auth");
  mocks.session.mockResolvedValue(null);
  expect(await identity(new Headers())).toBeNull();
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ user: { id: "local-user" } });
  mocks.query.mockResolvedValue({ rows: [] });
  expect(await identity(new Headers())).toBeNull();
});

it("허용된 Google sub만 관리자이며 이메일은 권한 판단에 쓰지 않음", async () => {
  const { identity } = await import("../lib/auth");
  mocks.session.mockResolvedValue({
    user: { id: "local-user", email: "operator@example.com" },
  });
  mocks.query.mockResolvedValue({ rows: [{ accountId: "other-sub" }] });
  expect(await identity(new Headers())).toEqual({
    sub: "other-sub",
    admin: false,
  });
  mocks.query.mockResolvedValue({ rows: [{ accountId: "operator-sub" }] });
  expect(await identity(new Headers())).toEqual({
    sub: "operator-sub",
    admin: true,
  });
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.stringContaining("\"providerId\"='google'"),
    ["local-user"],
  );
});

it("최초 로그인은 자동 관리자가 되지 않고 허용 목록 변경도 즉시 적용", async () => {
  vi.stubEnv("ADMIN_GOOGLE_SUB", "");
  const { identity } = await import("../lib/auth");
  mocks.session.mockResolvedValue({ user: { id: "local-user" } });
  mocks.query.mockResolvedValue({ rows: [{ accountId: "operator-sub" }] });
  expect(await identity(new Headers())).toEqual({
    sub: "operator-sub",
    admin: false,
  });
  vi.stubEnv("ADMIN_GOOGLE_SUB", "operator-sub");
  expect((await identity(new Headers()))?.admin).toBe(true);
  vi.stubEnv("ADMIN_GOOGLE_SUB", "replacement-sub");
  expect((await identity(new Headers()))?.admin).toBe(false);
});

it("DB 환경과 데이터 모드가 다르면 세션을 읽기 전에 차단", async () => {
  const { identity } = await import("../lib/auth");
  mocks.assertDatabase.mockRejectedValue(new Error("environment mismatch"));
  await expect(identity(new Headers())).rejects.toThrow("environment mismatch");
  expect(mocks.assertDatabase).toHaveBeenCalledWith(
    expect.anything(),
    "local",
    "sample",
  );
  expect(mocks.session).not.toHaveBeenCalled();
});

it("로그인 범위를 제한하고 OAuth 토큰 암호화와 세션 보호를 유지", async () => {
  const { getAuth } = await import("../lib/auth");
  getAuth();
  const options = mocks.betterAuth.mock.calls[0][0];
  expect(options.socialProviders.google).toMatchObject({
    disableDefaultScope: true,
    scope: ["openid", "email", "profile"],
    accessType: "online",
    includeGrantedScopes: false,
    prompt: "select_account",
  });
  expect(options.account).toEqual({
    accountLinking: { enabled: false },
    encryptOAuthTokens: true,
  });
  expect(options.trustedOrigins).toEqual(["http://localhost:3000"]);
  expect(options.session.cookieCache.enabled).toBe(false);
  const profile = {
    sub: "operator-sub",
    email: "operator@example.com",
    email_verified: true,
    name: "Test operator",
  };
  const map = options.socialProviders.google.mapProfileToUser;
  await expect(map(profile)).resolves.toMatchObject({ emailVerified: true });
  for (const invalid of [
    { ...profile, sub: "other-sub" },
    { ...profile, sub: "" },
    { ...profile, email_verified: false },
  ])
    await expect(map(invalid)).rejects.toThrow("관리자 계정만 허용됩니다.");
});
