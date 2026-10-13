-- Opt-in lifecycle is metadata on the authoritative Assignment, not another task,
-- memory, ownership, scheduler, or run table. Historical assignment JSON stays valid.
ALTER TABLE assignments ADD COLUMN responsibility_lifecycle jsonb;
ALTER TABLE assignments ADD COLUMN responsibility_fence bigint NOT NULL DEFAULT 0
    CHECK (responsibility_fence >= 0);
ALTER TABLE assignments ADD COLUMN responsibility_lease jsonb;
ALTER TABLE assignments ADD CONSTRAINT responsibility_lifecycle_shape CHECK (
    responsibility_lifecycle IS NULL OR coalesce((
        conversation_id IS NOT NULL
        AND jsonb_typeof(responsibility_lifecycle) = 'object'
        AND responsibility_lifecycle->>'schema_version' = 'responsibility/v1'
        AND responsibility_lifecycle->>'state' IN
            ('active','waiting_person','waiting_event','blocked','paused','cancelled','taken_over')
        AND responsibility_lifecycle->>'execution_status' = 'not_admitted'
    ), false)
);
CREATE INDEX assignments_responsibility_dependencies ON assignments
    USING gin ((responsibility_lifecycle->'dependencies'))
    WHERE responsibility_lifecycle IS NOT NULL;
CREATE INDEX assignments_responsibility_conversation ON assignments(workspace_id,conversation_id)
    WHERE responsibility_lifecycle IS NOT NULL;
