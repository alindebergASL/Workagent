-- Add content-free erasure cardinality without rewriting historical receipts.
DO $$ DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('forget_memory(text,text,text,text,text)'::regprocedure);
 IF position('RETURN result;' in definition)=0 THEN RAISE EXCEPTION '071 forget predecessor drift'; END IF;
 EXECUTE replace(definition,'RETURN result;',
   'RETURN result || jsonb_build_object(''erased_memory_items'',cardinality(ids));');
END $$;
