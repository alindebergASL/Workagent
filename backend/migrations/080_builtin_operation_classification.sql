-- Existing built-ins keep their dedicated authority/receipt guards. Only the
-- common operation classifier changes; adapter observation requirements do not.
DO $$ DECLARE definition text;
 old text=$q$OR NEW.data->'decision'->>'kind' NOT IN ('reply','stop',$q$;
 replacement text=$q$OR NEW.data->'decision'->>'kind' NOT IN ('reply','stop','read_result','read_attachment','read_saved_work','discover_saved_work','search_work_context','record_responsibility','advance_responsibility',$q$;
BEGIN
 definition=pg_get_functiondef('public.guard_tool_consumption()'::regprocedure);
 -- Pin all current079 bytes, including the075 rejection exception, workspace
 -- lock, current tool authority and separate exact adapter-observation block.
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>
    '15638668e2384d8a151b193762d69d9ff52b2e7624d2f2d76d90a08ff55a6567'
    OR (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'builtin classification predecessor drift'; END IF;
 EXECUTE replace(definition,old,replacement);
END $$;
