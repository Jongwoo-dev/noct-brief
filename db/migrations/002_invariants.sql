ALTER TABLE briefing_versions ADD CONSTRAINT briefing_version_pair UNIQUE(briefing_id,id);
ALTER TABLE briefings DROP CONSTRAINT current_version_fk;
ALTER TABLE briefings ADD CONSTRAINT current_version_fk FOREIGN KEY(id,current_version_id) REFERENCES briefing_versions(briefing_id,id);
ALTER TABLE jobs ADD CONSTRAINT known_job_state CHECK(state IN ('queued','collecting','submitting','generating','validating','ready','waiting_data','retry_wait','failed','published'));
CREATE FUNCTION reject_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'briefing versions are immutable'; END;
$$;
CREATE TRIGGER immutable_briefing_versions BEFORE UPDATE OR DELETE ON briefing_versions FOR EACH ROW EXECUTE FUNCTION reject_version_mutation();
