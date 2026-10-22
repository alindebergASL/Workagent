-- NEW sends: 50,000 input + 8,192 output at the unchanged 2.5/10 rates.
-- No grant, monetary ceiling, request, historical event or liability is updated.
-- Empty pre-041 count-send material means the historical 20k policy, NOT 50k.
-- New count-send rows must bind the new policy; direct SQL cannot forge legacy.
CREATE FUNCTION responses_count_input_limit(aid text, step text) RETURNS integer
LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN data='{}'::jsonb THEN 20000
             WHEN data='{"input_token_limit":50000}'::jsonb THEN 50000 END
 FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='count_send'
$$;

-- Preserve the later standing-admission scope/carry changes to these functions.
-- Match each old expression exactly and fail migration on unexpected drift.
DO $$
DECLARE item text[]; definition text; matches integer;
BEGIN
 FOREACH item SLICE 1 IN ARRAY ARRAY[
   ARRAY['guard_responses_event()', 'total_input+20000', 'total_input+50000', '1'],
   ARRAY['guard_responses_event()', 'reserved_input_tokens''<>''20000', 'reserved_input_tokens''<>''50000', '1'],
   ARRAY['guard_responses_event()', '0.131920', '0.206920', '3'],
   ARRAY['guard_responses_material()', 'reserved_input_tokens'' IS DISTINCT FROM ''20000', 'reserved_input_tokens'' IS DISTINCT FROM ''50000', '1'],
   ARRAY['guard_responses_material()', '0.131920', '0.206920', '1'],
   ARRAY['guard_responsibility_admission()', 'input_used+20000', 'input_used+50000', '1'],
   ARRAY['guard_responsibility_admission()', '0.131920', '0.206920', '1'],
   ARRAY['guard_carried_budget_event()', '0.131920', '0.206920', '1'],
   ARRAY['guard_responses_material()',
     ' IF NEW.kind=''count_result'' THEN',
     ' IF NEW.kind=''count_send'' AND NEW.data IS DISTINCT FROM ''{"input_token_limit":50000}''::jsonb
       THEN RAISE EXCEPTION ''count send input policy required''; END IF;
       IF NEW.kind=''count_result'' THEN', '1'],
   ARRAY['guard_responses_material()',
     '(NEW.data->>''input_tokens'')::numeric NOT BETWEEN 0 AND 20000',
     'responses_count_input_limit(NEW.attempt_id,NEW.phase) IS NULL OR
      (NEW.data->>''input_tokens'')::numeric NOT BETWEEN 0 AND responses_count_input_limit(NEW.attempt_id,NEW.phase)', '1'],
   ARRAY['guard_count_problem()',
     'NEW.data->''limit''<>''20000''::jsonb',
     'responses_count_input_limit(NEW.attempt_id,NEW.phase) IS NULL
      OR NEW.data->''limit'' IS DISTINCT FROM to_jsonb(responses_count_input_limit(NEW.attempt_id,NEW.phase))', '1'],
   ARRAY['guard_count_problem()',
     '(NEW.data->>''input_tokens'')::numeric<=20000',
     '(NEW.data->>''input_tokens'')::numeric<=responses_count_input_limit(NEW.attempt_id,NEW.phase)', '1']
 ] LOOP
   definition=pg_get_functiondef(item[1]::regprocedure);
   matches=(length(definition)-length(replace(definition,item[2],'')))/length(item[2]);
   IF matches<>item[4]::integer THEN
     RAISE EXCEPTION 'input ceiling migration drift: % expression %',item[1],item[2];
   END IF;
   EXECUTE replace(definition,item[2],item[3]);
 END LOOP;
END $$;
