ALTER TABLE report_trial_calls DROP CONSTRAINT report_trial_calls_stage_check;
ALTER TABLE report_trial_calls ADD CONSTRAINT report_trial_calls_stage_check
  CHECK (stage IN ('draft', 'verify', 'repair', 'recheck', 'research'));
