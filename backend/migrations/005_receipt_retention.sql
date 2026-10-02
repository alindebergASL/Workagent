-- Receipt retention is a distinct, write-only capability, not continuation authority.
-- Legacy attempts get no fabricated capability or evidence attestation.
ALTER TABLE provider_attempts
 ADD COLUMN receipt_key_hash text CHECK (receipt_key_hash ~ '^[0-9a-f]{64}$'),
 ADD COLUMN evidence_origin text NOT NULL DEFAULT 'unverified'
   CHECK (evidence_origin IN ('unverified','synthetic_provider_receipt')),
 ADD COLUMN abandonment_reason text CHECK (abandonment_reason = 'unsent_abandoned');

CREATE FUNCTION protect_receipt_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.receipt_key_hash IS DISTINCT FROM OLD.receipt_key_hash
 OR NEW.evidence_origin IS DISTINCT FROM OLD.evidence_origin
 THEN RAISE EXCEPTION 'immutable receipt capability and evidence origin'; END IF;
 -- Tighten 004: ambiguity may NEVER be reclassified as definitely unsent.
 IF NEW.data->>'state'='failed' AND OLD.data->>'state'<>'prepared'
 THEN RAISE EXCEPTION 'only definitely unsent attempts may be abandoned'; END IF;
 IF NEW.abandonment_reason IS DISTINCT FROM OLD.abandonment_reason AND NOT
   (OLD.data->>'state'='prepared' AND NEW.data->>'state'='failed'
    AND OLD.abandonment_reason IS NULL AND NEW.abandonment_reason='unsent_abandoned')
 THEN RAISE EXCEPTION 'immutable abandonment reason'; END IF;
 IF NEW.data->>'state'='failed' AND NEW.abandonment_reason IS NULL
 THEN RAISE EXCEPTION 'abandonment reason required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER protect_receipt_retention BEFORE UPDATE ON provider_attempts
 FOR EACH ROW EXECUTE FUNCTION protect_receipt_retention();
