-- Opt-in standing execution, not recall/data authority or a budget reset.
-- Historical grant JSON, admissions, reservations and receipts are unchanged.
-- Existing runtimes upgraded from before 028 need read-only lineage for scope
-- checks; do not rely on dev_db's fresh-install blanket SELECT grant.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='responses_events'
     AND privilege_type='INSERT' AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP
   EXECUTE format('GRANT SELECT ON general_grant_continuations TO %I',r.grantee);
 END LOOP;
END $$;
CREATE FUNCTION general_execution_scope_permits(gid text, cid text) RETURNS boolean
LANGUAGE sql STABLE AS $$
 WITH RECURSIVE lineage(id) AS (
   SELECT gid UNION ALL
   SELECT l.predecessor_id FROM general_grant_continuations l JOIN lineage a ON l.successor_id=a.id
 )
 SELECT coalesce((SELECT
   g.data->'responses'->'conversation_ids' ? cid OR
   (g.data->'responses'->>'admission_policy'='principal-workspace-v1'
    AND cv.data->>'owner_id'=g.principal_id
    AND cv.data->'selected_source_refs'='[]'::jsonb
    -- Unrelated historical scopes still win. Only an explicit owner-installed
    -- successor may take over its ancestors' conversations for *new* runs.
    AND NOT EXISTS (SELECT 1 FROM provider_grants old
      WHERE old.workspace_id=g.workspace_id AND old.principal_id=g.principal_id
        AND old.data->>'profile'='general-responses-v1'
        AND old.data->'responses'->'conversation_ids' ? cid
        AND old.id NOT IN (SELECT id FROM lineage)))
 FROM provider_grants g JOIN conversations cv ON cv.workspace_id=g.workspace_id AND cv.id=cid
 WHERE g.id=gid AND g.data->>'profile'='general-responses-v1'),false)
$$;

-- Keep one source of truth for all SQL send/publication/admission gates. Exact
-- substitutions fail the migration on drift rather than silently missing a gate.
DO $$
DECLARE item text[]; definition text;
BEGIN
 FOREACH item SLICE 1 IN ARRAY ARRAY[
   ['guard_general_admission()', 'g.data->''responses''->''conversation_ids'' ? r.conversation_id', 'general_execution_scope_permits(g.id,r.conversation_id)'],
   ['guard_responses_event()', 'grantrow.data->''responses''->''conversation_ids'' ? r.conversation_id', 'general_execution_scope_permits(grantrow.id,r.conversation_id)'],
   ['guard_responsibility_admission()', 'g.data->''responses''->''conversation_ids'' ? r.conversation_id', 'general_execution_scope_permits(g.id,r.conversation_id)'],
   ['guard_general_message()', 'g.data->''responses''->''conversation_ids'' ? NEW.conversation_id', 'general_execution_scope_permits(g.id,NEW.conversation_id)'],
   ['require_general_publication_authority_pre_context(runs)', 'g.data->''responses''->''conversation_ids'' ? cv.id', 'general_execution_scope_permits(g.id,cv.id)']
 ] LOOP
   definition=pg_get_functiondef(item[1]::regprocedure);
   IF position(item[2] in definition)=0 THEN RAISE EXCEPTION 'standing gate migration drift: %',item[1]; END IF;
   EXECUTE replace(definition,item[2],item[3]);
 END LOOP;
END $$;

-- Validate every explicit budget/pin as before, then the opt-in scope. Neither
-- a missing policy nor an arbitrary policy string can widen historical grants.
ALTER FUNCTION require_alpha_budget_binding(jsonb) RENAME TO require_scoped_alpha_budget_binding;
CREATE FUNCTION require_alpha_budget_binding(b jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE bounded jsonb;
BEGIN
 IF b ? 'admission_policy' THEN
   IF b->'admission_policy' IS DISTINCT FROM '"principal-workspace-v1"'::jsonb
      OR b->'conversation_ids' IS DISTINCT FROM '[]'::jsonb
   THEN RAISE EXCEPTION 'exact standing admission policy required'; END IF;
   IF jsonb_typeof(b->'cost_limit_usd') IS DISTINCT FROM 'string'
      OR coalesce(b->>'cost_limit_usd','') !~ '^(0|[1-9][0-9]?)(\.[0-9]{1,6})?$'
      OR (b->>'cost_limit_usd')::numeric>50.00
   THEN RAISE EXCEPTION 'standing cumulative cost ceiling exceeded'; END IF;
   bounded=(b-'admission_policy') || '{"conversation_ids":["validation-only"]}'::jsonb;
   -- Keep the exact historical schema/pins/types, but use the opted-in ceiling.
   bounded=jsonb_set(bounded,'{cost_limit_usd}',to_jsonb(least((b->>'cost_limit_usd')::numeric,20.00)::text));
   PERFORM require_scoped_alpha_budget_binding(bounded);
 ELSE
   PERFORM require_scoped_alpha_budget_binding(b);
 END IF;
END $$;

DO $$
DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('guard_general_grant()'::regprocedure);
 definition=replace(definition,'DECLARE b jsonb; cid text; alpha boolean;',
     'DECLARE b jsonb; cid text; alpha boolean; standing boolean;');
 definition=replace(definition,'alpha=b ? ''runtime_extension'';',
     'alpha=b ? ''runtime_extension''; standing=coalesce(b->>''admission_policy''=''principal-workspace-v1'',false);
      IF b ? ''admission_policy'' AND NOT standing THEN RAISE EXCEPTION ''unknown admission policy''; END IF;
      IF standing AND NOT alpha THEN RAISE EXCEPTION ''standing alpha binding required''; END IF;');
 definition=replace(definition,'OR coalesce(NEW.data->>''max_runs'','''') !~ ''^([1-9]|10)$''',
     'OR coalesce(NEW.data->>''max_runs'','''') !~ ''^[1-9][0-9]*$''');
 definition=replace(definition,'CASE WHEN b->>''policy_version''=''adaptive-local-v1'' THEN 10 ELSE 4 END',
     'CASE WHEN standing THEN 256 WHEN b->>''policy_version''=''adaptive-local-v1'' THEN 10 ELSE 4 END');
 definition=replace(definition,'jsonb_array_length(b->''conversation_ids'') NOT BETWEEN 1 AND (CASE WHEN alpha THEN 10 ELSE 2 END)',
     '(NOT standing AND jsonb_array_length(b->''conversation_ids'') NOT BETWEEN 1 AND (CASE WHEN alpha THEN 10 ELSE 2 END))');
 -- Explicit standing successors may widen execution only within this existing
 -- principal/workspace and project/route. Historical grant JSON stays intact.
 definition=replace(definition,'OR predecessor.data->''responses''->''conversation_ids'' IS DISTINCT FROM b->''conversation_ids''',
     'OR (NOT standing AND predecessor.data->''responses''->''conversation_ids'' IS DISTINCT FROM b->''conversation_ids'')
      OR (NOT standing AND predecessor.data->''responses''->''admission_policy'' IS DISTINCT FROM b->''admission_policy'')');
 definition=replace(definition,' FOR cid IN SELECT jsonb_array_elements_text(b->''conversation_ids'') LOOP',
     ' IF standing AND TG_OP=''INSERT'' THEN
         IF NOT EXISTS (SELECT 1 FROM memberships WHERE workspace_id=NEW.workspace_id
                        AND principal_id=NEW.principal_id AND active AND role IN (''owner'',''editor''))
         THEN RAISE EXCEPTION ''standing principal membership required''; END IF;
         IF EXISTS (SELECT 1 FROM provider_grants g WHERE g.workspace_id=NEW.workspace_id
             AND g.principal_id=NEW.principal_id AND g.data->>''profile''=''general-responses-v1''
             AND (g.data->''responses''->''project_id'' IS DISTINCT FROM b->''project_id''
               OR g.data->''responses''->''transport_mode'' IS DISTINCT FROM b->''transport_mode''))
         THEN RAISE EXCEPTION ''standing admission cannot reset historical project accounting''; END IF;
         IF EXISTS (SELECT 1 FROM provider_grants g WHERE g.workspace_id=NEW.workspace_id
             AND g.principal_id=NEW.principal_id AND g.data->''responses''->>''admission_policy''=''principal-workspace-v1''
             AND (g.active OR NOT (g.id=ANY(coalesce(lineage,ARRAY[]::text[])))))
         THEN RAISE EXCEPTION ''standing authorization requires explicit inactive lineage''; END IF;
       END IF;
       FOR cid IN SELECT jsonb_array_elements_text(b->''conversation_ids'') LOOP');
 EXECUTE definition;
END $$;

-- Charge historical carry under the explicitly selected cumulative ceiling.
DO $$
DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('guard_carried_budget_event()'::regprocedure);
 IF position('>20.00' in definition)=0 THEN RAISE EXCEPTION 'standing carry migration drift'; END IF;
 EXECUTE replace(definition,'>20.00',
   '>(SELECT CASE WHEN g.data->''responses''->>''admission_policy''=''principal-workspace-v1''
       THEN (g.data->''responses''->>''cost_limit_usd'')::numeric ELSE 20.00 END
       FROM provider_grants g WHERE g.id=gid)');
END $$;
