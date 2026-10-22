-- Durable identity for each exact new-draft selection, independent of random IDs.
-- Existing observations are the mapping; never rewrite historical receipts.
CREATE UNIQUE INDEX product_new_draft_selection_once ON product_observations
 (workspace_id,run_id,(data->'model_selection'))
 WHERE data->'output'->>'kind'='artifact_draft'
   AND data->>'revision_id' IS NOT NULL AND data->>'model_selection' IS NOT NULL;
