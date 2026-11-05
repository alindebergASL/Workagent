-- Explicit optional treatment, not new tool authority or a grant activation.
-- Historical bindings/receipts remain byte-identical. No rows are rewritten.
ALTER FUNCTION require_alpha_budget_binding(jsonb) RENAME TO require_alpha_budget_binding_pre_memory;
CREATE FUNCTION require_alpha_budget_binding(b jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF b ? 'memory_recall' AND (
   b->'memory_recall' NOT IN ('"off"'::jsonb, '"reviewed-v1"'::jsonb)
   OR b->>'continuity_version' IS DISTINCT FROM 'sustained-v1'
   OR b->>'scope_tool_sha256' IS DISTINCT FROM '1073c3bc5d71a3de2126733c224ecd729605965f39917709d56934c868bc7f41')
 THEN RAISE EXCEPTION 'explicit memory treatment requires sustained full-tool schema'; END IF;
 PERFORM require_alpha_budget_binding_pre_memory(b-'memory_recall');
END; $$;