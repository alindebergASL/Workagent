-- Bound alpha stop DISPLAY only; keep full immutable selection/staging receipts.
-- SQL017/018 remain immutable. Legacy publication semantics and receipt guards
-- are unchanged; all callers of general_publication_text share this exact rule.
CREATE FUNCTION alpha_stop_display(reason text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN length(reason)>10000
   THEN left(reason,10000-length(marker)) || marker ELSE reason END
 FROM (SELECT E'\n[Stop display shortened; full stop text is retained in turn details.]' AS marker) bounds;
$$;

CREATE OR REPLACE FUNCTION general_publication_text(stage jsonb, final jsonb, config jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN config->'responses'->>'runtime_extension'='general-alpha-v1' THEN
   CASE WHEN stage->>'terminal_outcome'='answered' THEN stage->'decision'->>'text'
        WHEN stage->>'terminal_outcome' IN ('blocked','waiting_for_user','step_limit','budget_limit') THEN alpha_stop_display(stage->>'reason')
        ELSE alpha_explanation_text(final->'value'->>'text',stage->>'reason') END
 ELSE CASE WHEN stage->'output'->>'kind'='artifact_draft' OR
   (config->'responses'->>'policy_version'='adaptive-local-v1' AND
    (stage->>'terminal_outcome' IN ('needs_validation','blocked','waiting_for_user','step_limit') OR
     (stage->>'terminal_outcome'='completed' AND stage->'verification'->'automatic'->>'passed'='true')))
   THEN stage->>'reason' ELSE final->'value'->>'text' END END;
$$;
