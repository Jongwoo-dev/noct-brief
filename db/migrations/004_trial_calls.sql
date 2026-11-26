CREATE TABLE report_trial_calls (
  edition text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('draft','verify','repair','recheck')),
  request_hash text NOT NULL,
  model text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  response_id text UNIQUE,
  reservation_microusd integer NOT NULL CHECK (reservation_microusd > 0),
  cost_microusd integer CHECK (cost_microusd >= 0),
  rejected boolean NOT NULL DEFAULT false,
  result jsonb,
  PRIMARY KEY (edition, stage)
);
