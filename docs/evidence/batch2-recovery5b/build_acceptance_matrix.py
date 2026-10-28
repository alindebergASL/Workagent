"""Reconcile every controlling acceptance row without converting gaps to passes."""
from pathlib import Path
import json,re,collections,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent
# These are our own retained JUnit files, not untrusted uploaded XML.
suites=['docs/evidence/batch2-recovery4/final-backend-core.xml','docs/evidence/batch2-recovery4/final-backend-seams.xml','docs/evidence/batch2-recovery5a/journey-tests.xml','docs/evidence/batch2-recovery5b/frontend-stop-final.xml']
tests=[]
for p in suites:
 for c in ET.parse(ROOT/p).iter('testcase'):
  if all(c.find(k) is None for k in ['failure','error','skipped']):tests.append({'report':p,'name':c.attrib.get('name'),'class':c.attrib.get('classname')})
# ID, acceptance status, test-name search, actual additional evidence, exact remainder.
entries=[
('A01','PENDING','natural|source.free|ordinary','../batch2-recovery4/final-backend-seams.xml','Current-candidate empty-Home paired TUI/browser useful live question not run; existing controlled service evidence is not that journey.'),
('A02','PENDING','attachment|comparison','../batch2-recovery5a/acceptance-scope.md','Unfamiliar multi-file comparison and live task-quality rubric on this candidate are absent.'),
('A03','PASS','review|human.notes','review.json;baseline.json;../batch2-recovery5a/accepted-readback.json','None for the synthetic note-preservation/explicit-consent mechanism; not a live quality grade.'),
('A04','PENDING','sanitize|escape|bom|crlf','../batch2-recovery5a/acceptance-scope.md','Hostile code/log actual terminal no-marker/process-side-effect journey not newly recorded; sanitizer and retained-byte tests are supporting only.'),
('A05','PENDING','attachment|range|context','../batch2-recovery4/final-backend-seams.xml','Need matched over-inline-limit file journey with chunk/range receipts, context manifest and result attribution; normal PDF extraction is not this case.'),
('A06','PENDING','unsupported|binary|zip','baseline.json','PDF is supported by controlling B2.5 expansion, not a valid refusal target. Unsupported format zero-POST browser/TUI draft-retention journey still needed.'),
('A07','PENDING','successor|eight.steps','../batch2-recovery5a/acceptance-scope.md','Deterministic successor/shared accounting checks pass; useful live task continuing across a real slice boundary is unavailable.'),
('A08','PENDING','dependency|stale.source','../batch2-recovery5a/dependency-historical-truth.json;review.json','Actual human correction/historical truth verified; two unattended provider waves with context bindings and useful output remain absent.'),
('A09','PENDING','queue.*isolation|revoked.*queue|blocked.*queue','../batch2-recovery4/final-backend-core.xml','Isolated queue mechanics tested; two independent responsibilities with slow-provider fairness/visit-time trajectory not established.'),
('A10','PENDING','responsibility|sustained','pty-return-status.txt','Closed-UI worker-only scheduled check-in on this candidate not performed. Historical STATUS trajectories are replay evidence only.'),
('A11','PASS','draft|detach|restart','../batch2-recovery5a/acceptance-scope.md;pty-return-conversation.txt','Actual TUI process boundary and retained queued server work demonstrated; no productive unattended-model claim.'),
('A12','PASS','event|restart|reconnect','upload-final/restart.json;../batch2-recovery5a/api-after-restart.json','Real API restart/SSE→poll→SSE reconnect retains exact cursor and drafts; deterministic event reducers cover duplicates/versions.'),
('A13','PASS','commit.prefix|rollback|delayed.transaction','../batch2-recovery5a/journey-tests.xml','Real restricted-PG commit/rollback/barrier mechanism evidence reused; backend hashes unchanged.'),
('A14','PENDING','cursor|generation|revok','upload-final/unknown.json;../batch2-recovery5a/revocation-proof.json','Server refusal/reset and revoked conversation browser isolation pass; real browser principal/endpoint swap with durable cache and active revocation midstream still not proven.'),
('A15','PASS','SSE|stream|frame|parser|stale.version','frontend-stop-final.xml','Current deterministic parser/reducer fixtures cover bounded frame and stale versions; not live provider evidence.'),
('A16','PASS','lost.ack|command.conflict|cas','../batch2-recovery5a/exact-replay-proof.json;../batch2-recovery5a/conflict-proof.json;upload-final/replay.json','Actual socket message lost ACK, exact command replay/counts and conflict-preserved draft in predecessor; actual browser upload replay complements this, not a claim of Home message-ACK testing.'),
('A17','PASS','attachment.replay|file.*delet|retained.bytes','../batch2-recovery5a/acceptance-scope.md;upload-final/stage.json;upload-final/replay.json','True retained-file replay after original deletion in predecessor; actual browser ArrayBuffer hashes survive process/API restart.'),
('A18','PASS','queue|supersed','post-restart-controls/controls.json;upload-final/replay.json;../batch2-recovery5a/queue-readback.json','Exact browser queue creates no run; normal new message supersedes earlier queued run. Current backend fences unchanged.'),
('A19','PASS','queue.cancel.admit.race','../batch2-recovery5a/journey-tests.xml;post-restart-controls/controls.json','Actual restricted-PG cancel/admit race plus explicit browser cancel readback; no manual simultaneous click claim.'),
('A20','PENDING','stop|pause|resume|takeover|cancel','post-restart-controls/controls.json;../batch2-recovery5a/acceptance-scope.md','STOP/queue/conversation-open separation proven; complete pause/resume/takeover/conversation-cancel paired lifecycle matrix not reconciled.'),
('A21','PENDING','unknown|before.send|dispatch','../batch2-recovery4/final-backend-seams.xml','Deterministic ledger counters exist; all controlling hard-kill provider boundaries with persisted ledger before/after restart not explicitly bound.'),
('A22','PENDING','known|observe|receipt|recover','../batch2-recovery4/final-backend-seams.xml','Exact-known-provider-ID worker-kill recovery with unchanged create count/read reservations still needs explicit current-candidate proof.'),
('A23','PENDING','retained|effect|receipt','../batch2-recovery4/final-backend-core.xml','Retained receipt mechanics tested; effect-commit→ACK/history hard-kill cutpoint and unique effect count not newly bound.'),
('A24','PASS','cancelled.*receipt|late.*response|cancelled.*result','../batch2-recovery4/final-backend-seams.xml;../batch2-recovery5a/journey-tests.xml','Deterministic cancelled-run trusted-receipt retention/no-publication mechanics; no real business effect.'),
('A25','PENDING','lease|stale.worker|fence','../batch2-recovery4/final-backend-core.xml','Lease/STOP fence tests pass; explicit cross-process replacement/late capability evidence for full row needs reconciliation, not inferred from names.'),
('A26','PENDING','budget|grant|authority|successor','../batch2-recovery4/final-backend-seams.xml;installed-ledger-corrected.json','Supporting deterministic refusal tests retained; enumerate admission+dispatch+successor expiry boundaries with zero-call/accounting assertions before closing full row.'),
('A27','PENDING','progress|malformed|rejection','../batch2-recovery5a/acceptance-scope.md','No-progress park mechanics present; complete malformed/persistent-rejection trace plus useful UI next action not bound.'),
('A28','PENDING','review|removed.*count|older|stale.base','review.json;../batch2-recovery5a/accepted-readback.json','Current/older and stale base/consent mechanisms supported; >20-removal display/sample plus concurrent newest-candidate consent reset in actual paired UI still missing.'),
('A29','PASS','seen|attention|dedup','post-restart-controls/controls.json;pty-return-status.txt','Browser Mark seen, terminal0attention, pending proposals remain; deterministic replay uniqueness tests complement actual readback.'),
('A30','PENDING','composer|draft|query|typing','upload-final/restart.json;../batch2-recovery5a/acceptance-scope.md','Slow/erroring API draft preservation shown; long-transcript key/render/selection/query matched latency benchmark still absent.'),
('A31','PASS','status|outcome|histor','review.json;pty-return-status.txt','Accepted current version and stopped execution remain distinct from blocked responsibility and timestamped unverified earlier observation.'),
('A32','PASS','cross|current|draft','baseline.json;review.json;pty-return-conversation.txt;pty-return-status.txt;pty-return-body.txt','Same-work current revision7 accepted in browser is reread in actual terminal with identical cell/notes, status and attention; independent prior draft/conflict target safety evidence retained.'),
('A33','PENDING','checkpoint.*hash|incompatible|generation|reconstruct','../batch2-recovery5a/journey-tests.xml','Hash/scope/checkpoint refusals supported; explicit incompatible-runtime-upgrade fixture with pinned hashes/zero I/O needs binding.'),
('A34','PENDING','migration|prefix|checksum','../batch2-recovery5a/database-proof.json;../batch2-recovery4/final-backend-core.xml','49checksum/additive/no-op migration evidence retained; full feature-flag rollback old-work/budget hash equivalence not demonstrated.'),
('A35','PENDING','notes|multiline','../../BATCH_2_3_EXECUTION.md;baseline.json','Historical five-note17-line/ten-note structured editor real-stack proof retained as replay; this current paired fixture has2notes, so full exact candidate5/10-note web/TUI readback remains pending.'),
('P1','PASS','contract|review','source-and-gates.json;independent-correction-review.md;../batch2-recovery4/final-results.json','Exact dirty feature candidate bound by602hashes; unchanged canonical/generated contracts reused. Not committed/published or installed.'),
('P2','PASS','histor|revision','review.json;pty-return-status.txt','Browser accepted current facts; earlier observation timestamp and unresolved goal preserved.'),
('P3','PASS','document.*restart|original|process.restart','baseline.json;upload-final/restart.json;upload-final/replay.json;../batch2-recovery5a/document-restart-replay.json','All3 originals/extractions retained across predecessor API restart and browser readback; subsequent current API/browser restart exact PDF replay, no resupply.'),
('P4','PENDING','ocr|scan|empty.page|coverage','baseline.json;../batch2-recovery4/final-backend-core.xml','Actual XLSX unsupported-format/formula omissions visible; scanned/image-only current browser/TUI limitations journey still absent.'),
('P5','PASS','confinement|sandbox|cpu|network|zip|dtd','../../BATCH_2_RECOVERY_2_HANDOFF.md;../batch2-recovery4/final-backend-core.xml','Current backend unchanged: isolated CPU/wall/network/escape/parser tests retained. No arbitrary upload was executed in browser.'),
('P6','PENDING','human.notes|review','review.json;../../../STATUS.md','Inferior synthetic proposal retained and not accepted; historical planning negative grade preserved. Current live planning-quality rerun/grade not supplied.'),
('P7','PENDING','successor|boundary|eight.steps','post-restart-controls/controls.json;../batch2-recovery5a/acceptance-scope.md','STOP is explicit durable state; positive real turn-limit trajectory with admitted successor or evidence-backed boundary stop remains unproven live.'),
('P8','PENDING','timing|latency','../../../STATUS.md','Prior negative timing retained as historical replay; current matched phase timing and human intervention comparison missing.')]
requirements={}
for p in ['docs/plans/2026-10-23-workagent/batch-2/IMPLEMENTATION.md','docs/plans/2026-10-23-workagent-next-two-batches.md']:
 for line in (ROOT/p).read_text().splitlines():
  parts=[x.strip() for x in line.split('|')]
  if len(parts)>3 and re.fullmatch(r'A\d{2}|P[1-8]',parts[1]):requirements[parts[1]]={'case':parts[2],'required':parts[3],'source':p,'evidence_required':parts[4] if len(parts)>4 else parts[3]}
assert len(entries)==43 and {x[0] for x in entries}=={f'A{x:02}' for x in range(1,36)}|{f'P{x}' for x in range(1,9)}
rows=[]
for id,status,regex,refs,gap in entries:
 paths=refs.split(';')
 for p in paths:assert (OUT/p).exists(),p
 hits=[t for t in tests if re.search(regex,(t['class'] or '')+' '+(t['name'] or ''),re.I)]
 rows.append({'id':id,**requirements[id],'status':status,'evidence_levels':['deterministic_synthetic']+(['replay'] if id in ['A10','A35','P6','P8'] else []),'current_live_provider_evidence':'unavailable/not run','evidence':paths,'supporting_test_index':hits,'scope_or_remaining':gap})
counts=dict(collections.Counter(r['status'] for r in rows))
data={'batch2_complete':False,'publication_gate':'HOLD','rows':rows,'counts':counts,'total':len(rows),'source_manifest':'source-manifest.json','legend':{'deterministic_synthetic':'Real current Chromium/HTTP/PostgreSQL/PTY or explicitly controlled tests, NOT paid/live model proof; individual files distinguish transport/process from in-process cases.','replay':'Historical source live/deterministic evidence, not re-execution on this current candidate.','live':'No product-provider live execution in this card.','unavailable':'Named live/device or remaining deterministic evidence is absent; not a pass.'}}
(OUT/'acceptance-matrix.json').write_text(json.dumps(data,indent=2))
lines=['# Full Batch2 acceptance matrix — HOLD','',f'All {len(rows)} rows retained: '+', '.join(f'{v} {k}' for k,v in counts.items())+'. No row is omitted. A PASS is scoped to its stated deterministic mechanism; this is NOT full acceptance.','', 'Current candidate:602source hashes;481frontend tests; backend/contracts unchanged from recovery4/5a. Current browser uses real API/PostgreSQL with synthetic data and no model worker. Historical live evidence is replay, not current live proof. Physical phone/screen reader and live/overnight trials unavailable.','', '| ID | Case | Status | Evidence | Scope / exact remainder |','|---|---|---|---|---|']
for r in rows:lines.append('| '+ ' | '.join([r['id'],r['case'],r['status'],'; '.join('`'+p+'`' for p in r['evidence']),r['scope_or_remaining']])+' |')
lines+=['','Machine-readable JSON retains verbatim required results/evidence and matching PASS test names/report paths. Test-name matches are supporting indexes, not independent proof of every row assertion. Hard-kill cutpoints, >20 removal UI, principal/endpoint cache swaps, full5/10-note parity and latency still need completion; budget cannot excuse deterministic work. Live usefulness/two waves/closed-UI/turn-boundary trials remain separately authority-bound.']
(OUT/'acceptance-matrix.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'total':len(rows),'counts':counts,'publication_gate':'HOLD'}))
