import "server-only";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { readConfig, authConfigured } from "./config";
import { pool, assertDatabase } from "./db";
let instance: ReturnType<typeof betterAuth> | undefined;
export function getAuth() {
  const c = readConfig();
  if (!authConfigured(c)) return null;
  const options: BetterAuthOptions = {
    database: pool(),
    baseURL: c.BETTER_AUTH_URL,
    secret: c.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(c.BETTER_AUTH_URL).origin],
    socialProviders: {
      google: {
        clientId: c.GOOGLE_CLIENT_ID,
        clientSecret: c.GOOGLE_CLIENT_SECRET,
        disableDefaultScope: true,
        scope: ["openid", "email", "profile"],
        accessType: "online",
        includeGrantedScopes: false,
        prompt: "select_account",
        mapProfileToUser: async (profile) => {
          if (
            !profile.sub ||
            !profile.email_verified ||
            (c.ADMIN_GOOGLE_SUB && profile.sub !== c.ADMIN_GOOGLE_SUB)
          )
            throw new APIError("FORBIDDEN", {
              message: "관리자 계정만 허용됩니다.",
            });
          return {
            name: profile.name,
            email: profile.email,
            emailVerified: profile.email_verified,
          };
        },
      },
    },
    account: {
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    advanced: { useSecureCookies: c.APP_ENV === "production" },
  };
  return (instance ??= betterAuth(options));
}
export async function identity(headers: Headers) {
  const c = readConfig();
  const auth = getAuth();
  if (!auth) return null;
  await assertDatabase(pool(), c.APP_ENV, c.DATA_MODE);
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const result = await pool().query(
    'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=\'google\'',
    [session.user.id],
  );
  const sub = result.rows[0]?.accountId as string | undefined;
  return sub
    ? {
        sub,
        admin: !!c.ADMIN_GOOGLE_SUB && c.ADMIN_GOOGLE_SUB === sub,
      }
    : null;
}
