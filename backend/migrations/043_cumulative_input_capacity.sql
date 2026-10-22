-- Match 256 existing generation slots to 50,000-token input reservations.
-- This changes only the configurable token ceiling: no grant, request, receipt,
-- monetary cap, generation count or historical accounting row is rewritten.
DO $$
DECLARE definition text; needle text := 'WHEN ''input_limit'' THEN 5120000 ELSE'; matches integer;
BEGIN
 definition=pg_get_functiondef('require_scoped_alpha_budget_binding(jsonb)'::regprocedure);
 matches=(length(definition)-length(replace(definition,needle,'')))/length(needle);
 IF matches<>1 THEN RAISE EXCEPTION 'cumulative input migration drift'; END IF;
 EXECUTE replace(definition,needle,'WHEN ''input_limit'' THEN 12800000 ELSE');
END $$;
