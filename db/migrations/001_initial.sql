CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE briefings (
 id text PRIMARY KEY, us_trading_date date NOT NULL, session text NOT NULL CHECK(session IN ('pre','post')),
 market_scope text NOT NULL DEFAULT 'us_market' CHECK(market_scope='us_market'), target_at timestamptz NOT NULL,
 current_version_id uuid, visible boolean NOT NULL DEFAULT false, published_at timestamptz, corrected_at timestamptz,
 UNIQUE(us_trading_date,session,market_scope)
);
CREATE TABLE briefing_versions (
 id uuid PRIMARY KEY, briefing_id text NOT NULL REFERENCES briefings(id), content jsonb NOT NULL,
 created_at timestamptz NOT NULL, previous_id uuid REFERENCES briefing_versions(id), reason text, change text,
 config jsonb NOT NULL, validated boolean NOT NULL DEFAULT false
);
ALTER TABLE briefings ADD CONSTRAINT current_version_fk FOREIGN KEY(current_version_id) REFERENCES briefing_versions(id);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, briefing_id text NOT NULL REFERENCES briefings(id), kind text NOT NULL CHECK(kind IN ('initial','correction')),
 dedupe_key text UNIQUE NOT NULL, state text NOT NULL, stage text NOT NULL DEFAULT 'collecting', attempt integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL, lease_until timestamptz, owner text, fence integer NOT NULL DEFAULT 0,
 payload jsonb NOT NULL DEFAULT '{}', config jsonb NOT NULL, error_code text, created_at timestamptz NOT NULL
);
CREATE INDEX jobs_due ON jobs(next_at) WHERE state NOT IN ('published','failed');
CREATE UNIQUE INDEX one_correction ON jobs(briefing_id) WHERE kind='correction' AND state NOT IN ('published','failed');
CREATE TABLE evidence (id text NOT NULL, revision text NOT NULL, metadata jsonb NOT NULL, PRIMARY KEY(id,revision));
CREATE TABLE events (id text NOT NULL, revision text NOT NULL, data jsonb NOT NULL, first_observed_at timestamptz NOT NULL, PRIMARY KEY(id,revision));
CREATE TABLE collection_bundles (briefing_id text NOT NULL REFERENCES briefings(id), revision uuid PRIMARY KEY, collected_at timestamptz NOT NULL, bundle jsonb NOT NULL);
CREATE TABLE notification_outbox (
 id uuid PRIMARY KEY, dedupe_key text UNIQUE NOT NULL, briefing_id text REFERENCES briefings(id), kind text NOT NULL,
 message text NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL, sent_at timestamptz, lease_until timestamptz, owner text
);
CREATE TABLE admin_commands (id uuid PRIMARY KEY, action text NOT NULL, briefing_id text NOT NULL REFERENCES briefings(id), created_at timestamptz NOT NULL);
CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL, image text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
CREATE TABLE session (id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);
CREATE INDEX session_user_idx ON session("userId");
CREATE TABLE account (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL, UNIQUE("providerId","accountId"));
CREATE INDEX account_user ON account("userId");
CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz, "updatedAt" timestamptz);
