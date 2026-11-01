-- A denied legacy publication has no target effect. Admit only the exact
-- material-free feedback already validated by 075; do not expand saved-work
-- eligibility or change any execution, authority, binding or discovery checks.
DO $$ DECLARE definition text;
 old text=$q$    AND NOT coalesce(saved_work_target_permitted(NEW.attempt_id,NEW.phase,decision->'target',true),false)$q$;
BEGIN
 definition=pg_get_functiondef('public.guard_saved_discovery()'::regprocedure);
 -- Pin the complete 076 predecessor, including its unchanged 035 body. Checking
 -- just the replacement fragment could silently accept drift elsewhere.
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>
    '9d3035aa8942a1e2bcc3960f1ceddd70e52b84f9c13256bf287321a3b8b05253'
    OR (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'gateway target rejection predecessor drift'; END IF;
 EXECUTE replace(definition,old,
   $q$    AND NOT gateway_publication_rejection(NEW.attempt_id,NEW.phase,NEW.data)
    AND NOT coalesce(saved_work_target_permitted(NEW.attempt_id,NEW.phase,decision->'target',true),false)$q$);
END $$;
