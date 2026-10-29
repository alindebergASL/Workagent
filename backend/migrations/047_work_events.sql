-- Metadata projections only. Canonical records, authority and receipts are unchanged.
-- Deliberately no projection -> domain FKs: their implicit KEY SHARE locks at
-- deferred-trigger time would violate domain-before-head lock ordering. Only
-- trusted triggers populate these projections from existing canonical rows.
CREATE TABLE work_event_heads (
 workspace_id text PRIMARY KEY,
 baseline_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 position bigint NOT NULL DEFAULT 0 CHECK(position>=0),
 retained_floor bigint NOT NULL DEFAULT 0 CHECK(retained_floor>=0)
);
INSERT INTO work_event_heads(workspace_id) SELECT id FROM workspaces;
CREATE TABLE work_events (
 workspace_id text NOT NULL, position bigint NOT NULL,
 event_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 type text NOT NULL CHECK(type IN ('conversation.changed','message.created','run.changed',
   'artifact.changed','revision.created','proposal.changed','responsibility.changed',
   'receipt.recorded','audit.recorded')),
 conversation_id text NOT NULL, run_id text, artifact_id text, proposal_id text,
 assignment_id text, revision_id text,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason_code text NOT NULL CHECK(reason_code IN ('material_change','created','state_changed',
   'receipt_retained','cancelled_unapplied','review_required')),
 material_key text NOT NULL,
 PRIMARY KEY(workspace_id,position)
);
CREATE INDEX work_events_conversation ON work_events(workspace_id,conversation_id,position);
CREATE TABLE work_event_projection (
 workspace_id text NOT NULL, source_table text NOT NULL, source_id text NOT NULL,
 material_hash text NOT NULL, PRIMARY KEY(workspace_id,source_table,source_id)
);
CREATE TABLE work_attention_seen (
 workspace_id text NOT NULL, principal_id text NOT NULL, conversation_id text NOT NULL,
 position bigint NOT NULL CHECK(position>=0), event_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,principal_id,conversation_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id)
);
-- Initial admission chronology survives later observed_at/lease changes.
CREATE TABLE work_run_chronology (
 workspace_id text NOT NULL, run_id text NOT NULL, admitted_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,run_id)
);
INSERT INTO work_run_chronology
 SELECT r.workspace_id,r.id,coalesce(
   (SELECT min((m.data->>'created_at')::timestamptz) FROM conversation_messages m
     WHERE m.workspace_id=r.workspace_id AND m.run_id=r.id),
   (r.data->>'observed_at')::timestamptz) FROM runs r;
CREATE TABLE work_responsibility_observations (
 workspace_id text NOT NULL, assignment_id text NOT NULL, outcome_hash text NOT NULL,
 observed_at timestamptz, PRIMARY KEY(workspace_id,assignment_id)
);
-- Existing prose has no reliable observation timestamp. Do not invent one.
INSERT INTO work_responsibility_observations
 SELECT workspace_id,id,md5(responsibility_lifecycle->>'current_outcome'),NULL
 FROM assignments WHERE responsibility_lifecycle IS NOT NULL;

CREATE FUNCTION work_event_capture() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 n jsonb := to_jsonb(NEW); old_row jsonb; material jsonb; old_material jsonb; previous_hash text; fingerprint text;
 ws text; cid text; rid text; aid text; pid text; job text; revision text;
 src_key text; event_type text; reason text := 'material_change'; seq bigint;
BEGIN
 -- Runtime can create temporary triggers. Depth/name alone cannot attest origin.
 IF TG_TABLE_SCHEMA<>'public' OR TG_RELID<>to_regclass('public.'||TG_TABLE_NAME)
    OR TG_NAME<>'work_capture_'||TG_TABLE_NAME OR TG_WHEN<>'AFTER' OR TG_LEVEL<>'ROW'
    OR TG_OP NOT IN ('INSERT','UPDATE')
    OR TG_TABLE_NAME NOT IN ('workspaces','conversations','conversation_messages','runs',
      'assignments','artifacts','revisions','proposals','provider_attempts','responses_steps',
      'responses_events','run_dispatches','audit')
 THEN RAISE EXCEPTION 'trusted work projection trigger required'; END IF;
 ws := n->>'workspace_id'; src_key := n->>'id';
 IF TG_TABLE_NAME='workspaces' THEN
   INSERT INTO public.work_event_heads(workspace_id) VALUES(n->>'id') ON CONFLICT DO NOTHING;
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME IN ('responses_events','responses_steps') THEN
   SELECT a.workspace_id,a.run_id INTO ws,rid FROM public.provider_attempts a WHERE a.id=n->>'attempt_id';
   src_key := coalesce(n->>'id',jsonb_build_array(n->>'attempt_id',n->>'phase')::text);
   material := jsonb_build_object('id',src_key,'kind',n->>'kind');
   event_type := 'receipt.recorded'; reason := 'receipt_retained';
   IF n->>'kind'='cancelled_unapplied' THEN reason := 'cancelled_unapplied'; END IF;
   -- Poll reservations alone are not material work transitions.
   IF n->>'kind' IN ('read','cancel') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='provider_attempts' THEN
   rid := n->>'run_id'; event_type := 'receipt.recorded'; reason := 'receipt_retained';
   material := n->'data';
 ELSIF TG_TABLE_NAME='run_dispatches' THEN
   rid := n->>'run_id'; src_key := rid; event_type := 'run.changed';
   material := jsonb_build_object('failure_reason',n->'failure_reason','acknowledged',n->'acknowledged_at' IS NOT NULL AND n->'acknowledged_at'<>'null'::jsonb);
 ELSIF TG_TABLE_NAME='runs' THEN
   rid := src_key; event_type := 'run.changed';
   material := (n->'data') - ARRAY['observed_at','lease_expires_at','fence'];
   IF TG_OP='INSERT' THEN
     INSERT INTO public.work_run_chronology VALUES(ws,rid,(n->'data'->>'observed_at')::timestamptz) ON CONFLICT DO NOTHING;
   END IF;
 ELSIF TG_TABLE_NAME='conversations' THEN
   cid := src_key; event_type := 'conversation.changed';
   material := (n->'data') - ARRAY['updated_at','last_message_preview'];
 ELSIF TG_TABLE_NAME='conversation_messages' THEN
   cid := n->>'conversation_id'; rid := n->>'run_id'; event_type := 'message.created';
   reason := 'created'; material := jsonb_build_object('id',src_key);
 ELSIF TG_TABLE_NAME='assignments' THEN
   job := src_key; event_type := 'responsibility.changed';
   material := jsonb_build_object('data',(n->'data')-'observed_at','lifecycle',n->'responsibility_lifecycle');
   IF n->'responsibility_lifecycle' IS NOT NULL AND n->'responsibility_lifecycle'<>'null'::jsonb THEN
     INSERT INTO public.work_responsibility_observations VALUES
       (ws,job,md5(n->'responsibility_lifecycle'->>'current_outcome'),transaction_timestamp())
       ON CONFLICT(workspace_id,assignment_id) DO UPDATE
       SET outcome_hash=excluded.outcome_hash,observed_at=excluded.observed_at
       WHERE work_responsibility_observations.outcome_hash<>excluded.outcome_hash;
   END IF;
 ELSIF TG_TABLE_NAME='artifacts' THEN
   aid := src_key; event_type := 'artifact.changed'; material := n;
 ELSIF TG_TABLE_NAME='revisions' THEN
   aid := n->>'artifact_id'; revision := src_key; event_type := 'revision.created'; reason := 'created';
   src_key := jsonb_build_array(aid,revision)::text;
   material := jsonb_build_object('id',src_key);
 ELSIF TG_TABLE_NAME='proposals' THEN
   aid := n->>'artifact_id'; pid := src_key; event_type := 'proposal.changed';
   material := jsonb_build_object('id',src_key,'status',n->'data'->>'status');
   IF n->'data'->>'status'='pending' THEN reason := 'review_required'; END IF;
 ELSE
   event_type := 'audit.recorded'; material := jsonb_build_object('id',src_key);
   SELECT id INTO cid FROM public.conversations WHERE workspace_id=ws AND id=n->>'object_id';
   SELECT id INTO rid FROM public.runs WHERE workspace_id=ws AND id=n->>'object_id';
   SELECT id INTO aid FROM public.artifacts WHERE workspace_id=ws AND id=n->>'object_id';
   SELECT id,artifact_id INTO pid,aid FROM public.proposals WHERE workspace_id=ws AND id=n->>'object_id';
   -- SELECT INTO with no row clears its targets; resolve artifact again.
   IF aid IS NULL THEN SELECT id INTO aid FROM public.artifacts WHERE workspace_id=ws AND id=n->>'object_id'; END IF;
   SELECT id INTO job FROM public.assignments WHERE workspace_id=ws AND id=n->>'object_id';
 END IF;
 -- A first heartbeat after migration must not fabricate historical activity.
 IF TG_OP='UPDATE' THEN
   old_row := to_jsonb(OLD);
   old_material := CASE TG_TABLE_NAME
     WHEN 'runs' THEN (old_row->'data') - ARRAY['observed_at','lease_expires_at','fence']
     WHEN 'conversations' THEN (old_row->'data') - ARRAY['updated_at','last_message_preview']
     WHEN 'assignments' THEN jsonb_build_object('data',(old_row->'data')-'observed_at','lifecycle',old_row->'responsibility_lifecycle')
     WHEN 'provider_attempts' THEN old_row->'data'
     WHEN 'run_dispatches' THEN jsonb_build_object('failure_reason',old_row->'failure_reason','acknowledged',old_row->'acknowledged_at' IS NOT NULL AND old_row->'acknowledged_at'<>'null'::jsonb)
     WHEN 'artifacts' THEN old_row
     WHEN 'proposals' THEN jsonb_build_object('id',src_key,'status',old_row->'data'->>'status')
     ELSE NULL END;
   IF old_material IS NOT DISTINCT FROM material THEN RETURN NEW; END IF;
 END IF;
 IF rid IS NOT NULL THEN
   SELECT coalesce(cid,r.conversation_id),coalesce(job,r.assignment_id),coalesce(aid,r.data->>'artifact_id'),
          coalesce(pid,r.data->>'proposal_id') INTO cid,job,aid,pid
     FROM public.runs r WHERE r.workspace_id=ws AND r.id=rid;
 END IF;
 IF aid IS NOT NULL THEN
   SELECT coalesce(cid,a.conversation_id),coalesce(job,a.assignment_id) INTO cid,job
     FROM public.artifacts a WHERE a.workspace_id=ws AND a.id=aid;
 END IF;
 IF job IS NOT NULL THEN
   SELECT coalesce(cid,a.conversation_id) INTO cid FROM public.assignments a WHERE a.workspace_id=ws AND a.id=job;
 END IF;
 IF cid IS NULL THEN RETURN NEW; END IF;
 -- All domain reads precede this lock. Nothing below acquires domain row locks.
 INSERT INTO public.work_event_heads(workspace_id) VALUES(ws) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.work_event_heads WHERE workspace_id=ws FOR UPDATE;
 fingerprint := md5(material::text);
 SELECT material_hash INTO previous_hash FROM public.work_event_projection
   WHERE workspace_id=ws AND source_table=TG_TABLE_NAME AND work_event_projection.source_id=src_key;
 IF previous_hash=fingerprint THEN RETURN NEW; END IF;
 INSERT INTO public.work_event_projection VALUES(ws,TG_TABLE_NAME,src_key,fingerprint)
   ON CONFLICT(workspace_id,source_table,source_id) DO UPDATE SET material_hash=excluded.material_hash;
 UPDATE public.work_event_heads SET position=position+1 WHERE workspace_id=ws RETURNING position INTO seq;
 INSERT INTO public.work_events(workspace_id,position,type,conversation_id,run_id,artifact_id,
   proposal_id,assignment_id,revision_id,reason_code,material_key)
 VALUES(ws,seq,event_type,cid,rid,aid,pid,job,revision,reason,TG_TABLE_NAME||':'||src_key||':'||fingerprint);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION work_event_capture() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['workspaces','conversations','conversation_messages','runs','assignments',
   'artifacts','revisions','proposals','provider_attempts','responses_steps','responses_events','run_dispatches','audit'] LOOP
   EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_event_capture()', 'work_capture_'||tab,tab);
 END LOOP;
END $$;

-- Current source access, including historical revision/proposal dependencies.
-- Conservative artifact history checks prevent old-event source metadata leaks.
CREATE FUNCTION work_refs_visible(ws text, who text, refs jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(refs,'[]'::jsonb)) ref
   WHERE NOT EXISTS (SELECT 1 FROM public.sources s JOIN public.source_access a
     ON a.workspace_id=s.workspace_id AND a.source_id=s.id
     WHERE s.workspace_id=ws AND s.id=ref->>'source_id' AND a.principal_id=who
       AND a.active AND s.data->'available'='true'::jsonb))
$$;
CREATE FUNCTION work_artifact_visible(ws text, who text, cid text, aid text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public.artifacts a
   LEFT JOIN public.assignments job ON job.workspace_id=a.workspace_id AND job.id=a.assignment_id
   JOIN public.conversations cv ON cv.workspace_id=a.workspace_id AND cv.id=coalesce(a.conversation_id,job.conversation_id)
   WHERE a.workspace_id=ws AND a.id=aid AND cv.id=cid
     AND work_refs_visible(ws,who,coalesce(job.data->'selected_source_refs',cv.data->'selected_source_refs'))
     AND NOT EXISTS (SELECT 1 FROM public.revisions r WHERE r.workspace_id=ws AND r.artifact_id=aid
       AND (NOT work_refs_visible(ws,who,r.data->'source_dependencies') OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(r.data->'source_dependencies') dep WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(coalesce(job.data->'selected_source_refs',cv.data->'selected_source_refs')) selected
           WHERE selected->>'source_id'=dep->>'source_id')))))
$$;
CREATE FUNCTION work_assignment_visible(ws text, who text, cid text, job_id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public.assignments a WHERE a.workspace_id=ws AND a.id=job_id
   AND a.conversation_id=cid AND work_refs_visible(ws,who,a.data->'selected_source_refs')
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(a.responsibility_lifecycle->'dependencies','[]'::jsonb)) dep
     WHERE CASE WHEN dep->>'kind'='artifact_revision'
       THEN NOT work_artifact_visible(ws,who,cid,dep->>'object_id')
       ELSE NOT work_refs_visible(ws,who,jsonb_build_array(jsonb_build_object('source_id',dep->>'object_id')))
         OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.data->'selected_source_refs') selected
           WHERE selected->>'source_id'=dep->>'object_id') END))
$$;
CREATE FUNCTION work_reference_visible(ws text, who text, cid text, aid text, pid text, job text, rid text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (aid IS NULL OR work_artifact_visible(ws,who,cid,aid))
 AND (job IS NULL OR work_assignment_visible(ws,who,cid,job))
 AND (pid IS NULL OR EXISTS (SELECT 1 FROM public.proposals pr
   JOIN public.artifacts a ON a.workspace_id=pr.workspace_id AND a.id=pr.artifact_id
   LEFT JOIN public.assignments j ON j.workspace_id=a.workspace_id AND j.id=a.assignment_id
   JOIN public.conversations cv ON cv.workspace_id=a.workspace_id AND cv.id=coalesce(a.conversation_id,j.conversation_id)
   WHERE pr.workspace_id=ws AND pr.id=pid AND cv.id=cid
     AND work_artifact_visible(ws,who,cid,pr.artifact_id)
     AND work_refs_visible(ws,who,pr.data->'source_dependencies')
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pr.data->'source_dependencies') dep
       WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(j.data->'selected_source_refs',cv.data->'selected_source_refs')) selected
         WHERE selected->>'source_id'=dep->>'source_id'))))
 AND (rid IS NULL OR EXISTS (SELECT 1 FROM public.runs r
   LEFT JOIN public.assignments a ON a.workspace_id=r.workspace_id AND a.id=r.assignment_id
   WHERE r.workspace_id=ws AND r.id=rid AND coalesce(r.conversation_id,a.conversation_id)=cid
     AND (r.assignment_id IS NULL OR work_assignment_visible(ws,who,cid,r.assignment_id))
     AND (r.data->>'artifact_id' IS NULL OR work_artifact_visible(ws,who,cid,r.data->>'artifact_id'))
     AND (r.data->>'proposal_id' IS NULL OR EXISTS (
       SELECT 1 FROM public.proposals pr WHERE pr.workspace_id=ws AND pr.id=r.data->>'proposal_id'
         AND work_artifact_visible(ws,who,cid,pr.artifact_id)
         AND work_refs_visible(ws,who,pr.data->'source_dependencies')))
     AND NOT EXISTS (SELECT 1 FROM public.product_observations ob
       WHERE ob.workspace_id=ws AND ob.run_id=rid AND NOT work_artifact_visible(ws,who,cid,ob.artifact_id))
     AND NOT EXISTS (SELECT 1 FROM public.run_configurations rc,
       LATERAL jsonb_array_elements(coalesce(rc.data->'responsibility'->'observations','[]'::jsonb)) dep
       WHERE rc.workspace_id=ws AND rc.run_id=rid AND CASE WHEN dep->>'kind'='artifact_revision'
         THEN NOT work_artifact_visible(ws,who,cid,dep->>'object_id')
         ELSE NOT work_refs_visible(ws,who,jsonb_build_array(jsonb_build_object('source_id',dep->>'object_id'))) END)))
$$;

-- Existing deployments get the same minimal grants as fresh provisioning.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='commands' AND privilege_type='INSERT'
     AND grantee<>current_user AND grantee<>'PUBLIC' LOOP
   EXECUTE format('REVOKE ALL ON work_event_heads,work_events,work_event_projection,work_run_chronology,work_responsibility_observations,work_attention_seen FROM %I',r.grantee);
   EXECUTE format('GRANT SELECT ON work_event_heads,work_events,work_event_projection,work_run_chronology,work_responsibility_observations,work_attention_seen TO %I',r.grantee);
   EXECUTE format('GRANT INSERT,UPDATE ON work_attention_seen TO %I',r.grantee);
 END LOOP;
END $$;
