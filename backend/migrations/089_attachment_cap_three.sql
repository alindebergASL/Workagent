-- B3.5g P6: raise the human-message attachment count bound 2 -> 3.
-- The bound lives in THREE layers: request validation (message_models.ATTACHMENT_COUNT),
-- readback model (models.py ConversationMessage max_length), and this DB trigger
-- guard_general_message(), which is CREATE OR REPLACE'd across migrations
-- 011/012/015/016/017/020 with jsonb_array_length(NEW.data->'attachments')>2.
-- Per migration-chain amendment discipline (pattern of 052/088): patch the CURRENT
-- function definition by exact preimage, preserving every other gate byte-for-byte.
DO $$
DECLARE d text; old text; replacement text; n integer;
BEGIN
 d=pg_get_functiondef('guard_general_message()'::regprocedure);
 old='jsonb_array_length(NEW.data->''attachments'')>2';
 replacement='jsonb_array_length(NEW.data->''attachments'')>3';
 IF position(old in d)=0 THEN
   RAISE EXCEPTION 'guard_general_message attachment-count preimage not found; refusing to amend';
 END IF;
 -- exactly one occurrence expected in the current definition
 n=(length(d)-length(replace(d,old,'')))/length(old);
 IF n<>1 THEN
   RAISE EXCEPTION 'guard_general_message attachment-count preimage count % (expected 1); refusing to amend', n;
 END IF;
 d=replace(d,old,replacement);
 -- pg_get_functiondef includes the full 'CREATE OR REPLACE FUNCTION ...' header,
 -- so re-executing the definition verbatim is the amendment; no format() wrapping.
 EXECUTE d;
END;
$$;
