-- Candidate forward migration; installed application requires explicit approval.
-- Scope: one relation predicate and two exact-current publication predicates.
-- No table/data/grant changes, receipt rewrites, trigger removal or backfill.
-- Requires products.py receipt-before-current-pointer ordering. Frozen input
-- targets/read receipts keep their original revision and hash. New reads still
-- require saved_work_target_permitted's exact CURRENT target; this predicate is
-- only for validating already-consumed material during atomic settlement.
-- Existing membership, grant, lease, generation, source, memory, tool and
-- responsibility checks are unchanged. Responsibility advancement is excluded.
-- Unknown/legacy producer provenance and any human revision fail closed.
--
-- Validate candidate on fresh disposable PostgreSQL, ordinary restricted
-- role, full immutable migration chain; run focused same-turn/targeted-edit and
-- human race cases. Exercise the predicate and both callers with raw SQL under
-- that role (including NULL, foreign run/conversation, forged/missing receipt,
-- broken ancestry, human save/accept, changed protected note, revocation).
-- Predecessor catalog reconciled against all 89 source migration checksums.
-- Observation guard: guard_general_observations -> guard_general_observation.
-- Rollout: pause admission and DRAIN all old-schema in-flight work under its
-- compatible old executor BEFORE installing checklist schema and this migration.
-- Old prepared requests / nullable selections cannot resume on the new executor.
-- Preserve historical saved bodies, receipts and grants; never rewrite them.
-- Rollback: stop new advancement admissions, drain/settle in-flight runs using
-- the compatible executor, then restore only these two predicates from their
-- checked predecessor definitions in a forward migration. Retain all revisions
-- and receipts. Old readers remain compatible; old executors cannot resume a run
-- whose frozen base has advanced. No installed-data operation is authorized here.

CREATE FUNCTION publication_own_draft_descendant(r runs, target jsonb)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE art artifacts; original revisions; v revisions; parent revisions;
        ids text[] := ARRAY[]::text[]; cursor_id text; last_number bigint;
        binding jsonb; stage jsonb; observed jsonb; selected_base revisions;
        selected_operation jsonb;
BEGIN
 IF r.id IS NULL OR r.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
    OR jsonb_typeof(target) IS DISTINCT FROM 'object'
    OR target->>'artifact_id' IS NULL OR target->>'revision_id' IS NULL
    OR target->>'body_hash' IS NULL
    OR EXISTS (SELECT 1 FROM run_configurations rc WHERE rc.workspace_id=r.workspace_id
      AND rc.run_id=r.id AND rc.data ? 'responsibility')
 THEN RETURN false; END IF;
 SELECT * INTO art FROM artifacts WHERE workspace_id=r.workspace_id
   AND id=target->>'artifact_id' AND conversation_id=r.conversation_id;
 SELECT * INTO original FROM revisions WHERE workspace_id=r.workspace_id
   AND artifact_id=art.id AND id=target->>'revision_id'
   AND data->>'body_hash'=target->>'body_hash';
 IF art.id IS NULL OR original.id IS NULL OR art.current_revision_id=original.id
    OR EXISTS (SELECT 1 FROM revisions x WHERE x.workspace_id=r.workspace_id
       AND x.artifact_id=art.id AND (x.data->>'author_kind' IS DISTINCT FROM 'worker'
         OR x.producer_run_id IS NULL))
 THEN RETURN false; END IF;
 -- Collect actual parent ancestry, never infer order from hashes or timestamps.
 cursor_id=art.current_revision_id;
 WHILE cursor_id IS NOT NULL LOOP
   SELECT * INTO v FROM revisions WHERE workspace_id=r.workspace_id
     AND artifact_id=art.id AND id=cursor_id;
   IF v.id IS NULL OR v.id=ANY(ids)
      OR (last_number IS NOT NULL AND v.revision_number<>last_number-1)
      OR v.data->>'id' IS DISTINCT FROM v.id
      OR v.data->>'parent_revision_id' IS DISTINCT FROM v.parent_revision_id
   THEN RETURN false; END IF;
   ids=array_append(ids,v.id); last_number=v.revision_number;
   cursor_id=v.parent_revision_id;
 END LOOP;
 IF NOT original.id=ANY(ids) OR last_number<>1 THEN RETURN false; END IF;
 FOREACH cursor_id IN ARRAY ids LOOP
   EXIT WHEN cursor_id=original.id;
   SELECT * INTO v FROM revisions WHERE workspace_id=r.workspace_id
     AND artifact_id=art.id AND id=cursor_id;
   IF v.producer_run_id IS DISTINCT FROM r.id
      OR v.data->>'author_id' IS DISTINCT FROM r.data->>'principal_id'
      OR v.data->>'body_hash' IS DISTINCT FROM
        encode(sha256(convert_to(acceptance_canonical_json(v.data->'body'),'UTF8')),'hex')
   THEN RETURN false; END IF;
   -- Require the retained local observation AND its exact selection receipt.
   -- A producer_run_id alone is not evidence of an authorized publication.
   SELECT po.data, e.data INTO observed,stage
   FROM product_observations po
   JOIN provider_attempts a ON a.workspace_id=po.workspace_id AND a.run_id=po.run_id
     AND a.id=po.data->'model_selection'->>'attempt_id'
   JOIN responses_events e ON e.attempt_id=a.id AND e.kind='tool_result'
     AND e.data->'binding'=po.data->'model_selection'
   JOIN responses_steps s ON s.attempt_id=e.attempt_id AND s.phase=e.phase
   JOIN responses_events sel ON sel.attempt_id=e.attempt_id AND sel.phase=e.phase AND sel.kind='result'
   WHERE po.workspace_id=r.workspace_id AND po.run_id=r.id AND po.artifact_id=art.id
     AND po.data->>'revision_id'=v.id AND po.data->>'proposal_id' IS NULL
     AND po.data->>'conversation_id'=r.conversation_id
     AND po.data->>'access_generation'=r.data->>'access_generation'
     AND po.data->>'evidence_origin'='local_tool'
     AND po.data->>'body_hash'=v.data->>'body_hash'
     AND e.data->>'status'='observed'
     AND e.data->'decision'->>'kind'='publish_artifact'
     AND e.data->'body'=v.data->'body'
     AND e.data->'output'=po.data->'output'
     AND po.data->'output'->>'kind'='artifact_draft'
     AND e.data->'decision'=sel.data->'value'->'decision'
     AND sel.data->>'state'='function_call'
     AND e.data->'binding'->>'selection_request_sha256'=s.request_sha256
     AND e.data->'binding'->>'selection_request_sha256'=sel.data->>'request_sha256'
     AND e.data->'binding'->>'selection_response_id'=sel.data->>'response_id'
     AND e.data->'binding'->>'decision_sha256'=
       encode(sha256(convert_to(acceptance_canonical_json(sel.data->'value'),'UTF8')),'hex')
     AND po.data->>'operation_hash'=e.data->'binding'->>'operation_hash';
   IF NOT FOUND THEN RETURN false; END IF;
   binding=stage->'binding';
   SELECT * INTO selected_base FROM revisions WHERE workspace_id=r.workspace_id
     AND artifact_id=art.id AND id=observed->>'base_revision_id';
   IF selected_base.id IS NULL
      OR NOT selected_base.id=ANY(ids)
      OR array_position(ids,selected_base.id)<=array_position(ids,v.id)
      OR stage->'decision'->'target' IS DISTINCT FROM jsonb_build_object(
         'artifact_id',art.id,'revision_id',selected_base.id,'body_hash',selected_base.data->>'body_hash')
      OR binding->>'base_hash' IS DISTINCT FROM selected_base.data->>'body_hash'
   THEN RETURN false; END IF;
   -- Reconstruct the exact PublishArtifact serialized by resolve_selection.
   -- Agreement between two stored hashes is not proof of operation identity.
   selected_operation=jsonb_build_object('kind','publish_artifact',
     'artifact_id',art.id,'base_revision_id',selected_base.id,
     'body',stage->'decision'->'body');
   IF binding->>'operation_hash' IS DISTINCT FROM
      encode(sha256(convert_to(acceptance_canonical_json(selected_operation),'UTF8')),'hex')
   THEN RETURN false; END IF;
   SELECT * INTO parent FROM revisions WHERE workspace_id=r.workspace_id
     AND artifact_id=art.id AND id=v.parent_revision_id;
   -- Transcribed human constraints do not become editable because author=worker.
   IF parent.data->'body' ? 'blocks' AND (
      NOT (v.data->'body' ? 'blocks') OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(parent.data->'body'->'blocks') note
        WHERE note->>'kind'='protected_note' AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v.data->'body'->'blocks') kept WHERE kept=note)))
   THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END; $$;

-- Preserve the complete existing authorizers and their invocation order. Only
-- add an exact receipt-bound descendant alternative to the two current checks.
-- Exact occurrence guards abort on drift, rather than silently broadening scope.
DO $$
DECLARE definition text; old text; replacement text;
BEGIN
 definition=pg_get_functiondef('require_general_publication_authority_pre_context(runs)'::regprocedure);
 old=$old$ IF t<>'null'::jsonb AND NOT EXISTS (SELECT 1 FROM artifacts art JOIN revisions rev$old$;
 replacement=$new$ IF t<>'null'::jsonb AND NOT publication_own_draft_descendant(r,t)
    AND NOT EXISTS (SELECT 1 FROM artifacts art JOIN revisions rev$new$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'draft target predecessor drift'; END IF;
 EXECUTE replace(definition,old,replacement);
 definition=pg_get_functiondef('require_saved_read_sources(runs)'::regprocedure);
 old=$old$   IF NOT EXISTS (SELECT 1 FROM artifacts a JOIN revisions rev ON rev.workspace_id=a.workspace_id AND rev.artifact_id=a.id AND rev.id=a.current_revision_id$old$;
 replacement=$new$   IF NOT publication_own_draft_descendant(r,target) AND NOT EXISTS (SELECT 1 FROM artifacts a JOIN revisions rev ON rev.workspace_id=a.workspace_id AND rev.artifact_id=a.id AND rev.id=a.current_revision_id$new$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'draft saved read predecessor drift'; END IF;
 EXECUTE replace(definition,old,replacement);
END; $$;
