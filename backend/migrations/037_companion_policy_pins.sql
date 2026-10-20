-- Reviewed companion policy pins for the current alpha policies (composition.POLICY
-- and composition.CONTINUITY_POLICY). Both instruct the model that a human-requested
-- companion custom_view may be created, but 031 pinned only the original policy
-- hash, so every current companion failed 'companion policy not authorized'.
-- Additive: 031's author, scope and binding checks stay; only the accepted pin set
-- widens. The historical pin remains accepted so retained receipts read back.
-- One source of truth: exact substitution fails on drift (same pattern as 033).
DO $$
DECLARE definition text;
 needle text := $n$ IF config->'responses'->>'instructions_sha256' IS DISTINCT FROM
    'd9e01384a363919be4c4436b1ddcd1db6d4b69d4ee42b27e85f85030051c1a47'$n$;
 replacement text := $r$ IF coalesce(config->'responses'->>'instructions_sha256','') NOT IN (
    'd9e01384a363919be4c4436b1ddcd1db6d4b69d4ee42b27e85f85030051c1a47',
    '3d4fbf43f59292fdc9bc13a559383d9669b4879e34bc58bae10785d0418affa4',
    'b41ea3bdddd4f75c4c9ae6f410cffe0b0db40262d3d96cbff358581e722aa4f9')$r$;
BEGIN
 definition=pg_get_functiondef('guard_companion_view_scope()'::regprocedure);
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'companion pin migration drift'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
