-- Last dispatcher denial is diagnostic only, never work/receipt/retry authority.
-- Keep admission identity, acknowledgement and all request journals unchanged.
ALTER TABLE run_dispatches ADD COLUMN failure_reason text
 CHECK (failure_reason IN ('source_changed','source_unavailable','version_conflict',
   'not_found_or_not_authorized','budget_exhausted','connection_required',
   'authority_unavailable','internal_error'));
ALTER TABLE run_dispatches ADD COLUMN failure_checked_at timestamptz;

CREATE OR REPLACE FUNCTION protect_dispatch_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
 (to_jsonb(NEW)-ARRAY['acknowledged_at','failure_reason','failure_checked_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['acknowledged_at','failure_reason','failure_checked_at'])
 OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at)
 THEN RAISE EXCEPTION 'immutable dispatch admission'; END IF;
 RETURN NEW;
END;
$$;
