-- Named office exports share the safe filename contract of ExportManifest.
-- This changes only admission for NEW rows; retained manifests/pins are untouched.
-- Preserve every existing MIME, provenance, authority, scope and replay predicate.
DO $migration$
DECLARE
 definition text := pg_get_functiondef('guard_office_export()'::regprocedure);
 old_predicate text := $old$OR NEW.data->>'filename' IS DISTINCT FROM 'export.'||(NEW.data->>'format')$old$;
 new_predicate text := $new$OR NOT coalesce(NEW.data->>'filename' ~
   ('^[A-Za-z0-9][A-Za-z0-9_-]{0,80}[.]'||(NEW.data->>'format')||'$'),false)$new$;
BEGIN
 IF (length(definition)-length(replace(definition,old_predicate,'')))/length(old_predicate) <> 1 THEN
   RAISE EXCEPTION 'exact office filename predecessor required';
 END IF;
 EXECUTE replace(definition,old_predicate,new_predicate);
END
$migration$;
