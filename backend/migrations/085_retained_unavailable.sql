-- Unsupported legacy receipt projections are body-free unavailable, not a
-- recursive read or a permission override. Keep all current/source authority,
-- selected-target validation and supported-material target restrictions intact.
DO $migration$
DECLARE definition text; needle text;
BEGIN
 definition=pg_get_functiondef('public.retained_tool_result_material(runs,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'5e3294b30df594574dec58118a98ae1e1eb92b6bf170bc67eb8a005b70bb1092'
 THEN RAISE EXCEPTION '085 retained material predecessor drift'; END IF;
 needle=$q$ IF target IS NOT NULL AND NOT coalesce(selected->'target'=target OR selected->>'kind'='fetch_public_url' OR selected->>'section'='target',false)$q$;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle)
 THEN RAISE EXCEPTION '085 retained material splice drift'; END IF;
 EXECUTE replace(definition,needle,$q$ IF NOT coalesce(event->'capability_result'->>'capability' IN ('read_saved_work','inspect_json','fetch_public_url')
    OR (event->'capability_result'->>'capability'='read_context' AND selected->>'section' IN ('attachments','target','work_area'))
    OR event->>'status'='observed',false)
 THEN RETURN NULL; END IF;
$q$||needle);
END $migration$;
