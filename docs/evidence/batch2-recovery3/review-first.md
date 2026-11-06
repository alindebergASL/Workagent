# Independent combined B2 web review — HOLD

- Reviewer/model: Astra, `gpt-6-astra` (OpenAI Codex), independent reviewer; no implementation ownership.
- Candidate: actual dirty/untracked working tree at `/home/ubuntu/workagent-continuation-20261026`, branch `hermes/b2-conversational-client`, HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d` (confirmed again at end). Reviewed `git diff -- web` AND `git ls-files --others --exclude-standard web`; not an old lane snapshot.
- Scope: combined document staging/store/upload/reply/Home/UI wiring, per-message mapping, checkpoint controls/latest-run selection, proxy, work-state/stream support, and tests; included the fresh `products.ts`, `real-api.ts`, `post-message-types.test.ts` repair and generated Input/Output definitions.
- Verdict: **HOLD**. Durable bytes do not yet imply durable command identity, and async staging/restoration does not consistently fail closed across scope or storage failures.

## Material findings

### R1 — P1: Unknown upload identity is not durable; retries can become new effects

**Locations:** `web/src/lib/client/documents.ts:146-165, 207-220, 240-258`; `web/src/lib/client/doc-store.ts:22-35, 55-69`; `web/src/lib/client/staged-documents.ts:62-80`.

The IndexedDB record contains bytes/state/ref but no upload command/request IDs or upload destination. IDs exist only in `sessionStorage`. When that session disappears, restored `unknown` entries call `journal()` and mint fresh IDs. If session storage throws, even a second retry in the *same page* mints fresh IDs: the comment claiming an in-memory replay fallback is not backed by an in-memory journal.

**Reproduction:** stage a PDF, let an upload return an ambiguous transport error after possible server commit, then close the client and reopen the same conversation with the IndexedDB record retained but a new sessionStorage. Send again: identical bytes, different `command_id`. Alternatively make sessionStorage get/set throw and retry without closing the page. Both identity failures were executed against the current actual functions in an in-memory Node harness (results below). Backend source confirms command-ID replay, not content-hash deduplication: `backend/workagent/documents.py:46-63` allocates/inserts a new document for a fresh command.

There is also a reload crash window on successful uploads: `uploadStaged` drops the journal at line 217 before `uploadAll` writes the confirmed ref, and `setDocs` does not await durability. Reload in that window can restore a ref-less entry with no surviving IDs. Home additionally stores its create/send continuation only in sessionStorage (`Composer.tsx:192-233`), while confirmed document refs survive in Home's IndexedDB draft; reopening can create another conversation then reuse refs scoped to the old one (`documents.ts:240`), producing an authorization refusal rather than successful recovery.

**Required invariant:** persist the exact upload envelope/identity and destination with the staged generation before dispatch, retain it until a durable matching receipt exists, and refuse fresh dispatch when that durability cannot be established. A closed client or storage error must never silently turn an unknown attempt into a new command.

### R2 — P1: An old asynchronous file read can be persisted into the newly selected workspace/draft

**Locations:** `web/src/lib/client/staged-documents.ts:25-30, 62-68, 85-97`; `web/src/components/Composer.tsx:595-617`; `web/src/lib/client/conversation-reply.ts:185-193`; actual unkeyed Home mount `web/src/app/page.tsx:382-387`.

`setDocs` is stable across scope changes and selects `scopeRef.current` **when the async operation finishes**, not the scope that initiated it. The post-persistence scope check is too late: it protects only the completion update, not the write. Both picker callers await `stageFile` and then call that setter with a captured old `docs` array; neither captures/rechecks the originating scope/generation.

**Reproduction:** on Home in workspace A, select a file whose `arrayBuffer()` is delayed, switch the destination to B while it is being read, allow B's restoration to finish, then resolve the file read. The same Composer stays mounted. The old callback writes A's selected file (and potentially A's captured existing entries) into B's IndexedDB scope and displays it in B; sending in B uploads those bytes there. This is source-established, not browser-exercised. The same setter design also affects late upload/update completions across a reused conversation component.

**Required invariant:** bind staging/update/delete callbacks to an immutable originating scope plus generation; discard or retain late results only in that original scope. Checking only the current scope after the write is insufficient.

### R3 — P1: Restoration failure/corruption enables a text-only send; restoration can also overwrite a new selection

**Locations:** `web/src/lib/client/staged-documents.ts:32-54`; `web/src/lib/client/doc-store.ts:125-136`; `web/src/lib/client/conversation-reply.ts:182-193, 224-248, 264-277`; `web/src/components/Composer.tsx:396-435, 589-617, 725-731`.

A failed read or corrupt record leaves `docs` empty (or partial), sets only an error string, and clears `restoring`. Send/Queue gates check `restoring` but not an unresolved recovery error. Conversation replies have no durable expected-document manifest before upload/send. Therefore a warning that documents could not be read does not prevent sending the draft without those documents. A fresh Home start likewise snapshots the now-empty list as its intended documents.

**Reproduction:** retain an unsent reply and a staged PDF, reload, make `DocStore.list()` reject (or damage the stored bytes so `fromRecord` reports corruption), wait for restoration to finish, then Send or Queue. The command proceeds without the original document refs; no explicit removal/acknowledgement was required. The record may remain on disk, but that does not preserve the intended submitted message.

There is a separate readiness race within the same restoration path: neither picker is locked by `staged.restoring`. Delay `store.list()`, select a new document while restoring, then resolve the original empty list. `setDocsState(list)` at line 41 overwrites the new selection; it can remain on disk but vanish from the visible/sent draft. Existing tests exercise the memory-store functions, not this hook/call-site ordering.

For an already pending Home start, a missing/corrupt expected document is detected, but its prescribed recovery is unavailable: the error asks to attach the same file again (`Composer.tsx:426-433`), while `Boolean(chat.current)` locks the picker (`:589-594`).

**Required invariant:** unresolved restoration failure/corruption must block dispatch until explicit recovery/removal, and selection must be disabled until restoration settles or merged with generation-safe ordering. Preserve an expected attachment manifest and a usable recovery action.

### R4 — P2: Latest-run fencing can be defeated by a stale snapshot winning over fresher conversation state

**Locations:** `web/src/app/conversations/[id]/page.tsx:358-368, 692-702`; `web/src/lib/client/work-state.ts:194-200`; `web/src/lib/batch2-view.ts:49-55`; `web/src/components/Batch2Controls.tsx:321-337`.

The pure `continueTarget` check correctly refuses a checkpoint when given a different latest run. But its call site always prefers any non-null snapshot run over the newest request in the thread, without comparing work versions or checking `work.stale`. Snapshot, conversation and checkpoints are independently refreshed. A failed snapshot refresh intentionally retains the older snapshot.

**Reproduction:** snapshot says run R1 and its checkpoint is continuable; another client advances the conversation to terminal R2. Let the conversation refresh succeed while snapshot/checkpoint refresh fails or lags. With no in-flight turn, the UI still passes R1 as `latestRunId`, offers R1's checkpoint and combines it with the newer conversation work version. The latest-run helper tests do not exercise this composition.

**Required invariant:** withhold a new Continue until its latest-run evidence and checkpoint belong to a current compatible canonical read; stale snapshot state must not override a demonstrably newer thread. Exact replay of an existing uncertain Continue is a different case and should remain distinguished. This finding is about the web fence/truthful control, **not** a claim that backend authorization/checkpoint validation can be bypassed.

## What checked out / nonblocking limits

- Exact binary conversion is sound on the exercised path: canonical base64 -> `ArrayBuffer` record -> rehashed restoration preserved bytes including `00`, `ff`, `80`, `fe`. IndexedDB writes wait for transaction completion rather than request success (`doc-store.ts:165-199`). **The actual browser/IndexedDB adapter was not exercised.** Memory adapter tests are not browser persistence proof.
- Store keys distinguish provided principal/workspace/draft values; exact-generation deletion and ref matching are present. This does not repair R2. Actual `PRINCIPAL` is the fixed real-mode `local-human` (`api.ts:9`), so no generalized multi-principal/session-isolation claim is warranted beyond the current local fixture model.
- Confirmed per-message document metadata is mapped from each message, not the conversation-wide list (`real-api.ts:929, 971-993`; page `:424-431`). Extracted text is excluded from that projection and rendered as inert text when explicitly opened. Minor robustness gap: `messageDocuments` does not guard null array members or validate status membership; current generated server records are well-formed, so not a separate blocker here.
- The **three-file Input/Output repair is directionally correct**: `products.ts:8` and `real-api.ts:1085,1094` use `PostMessage-Input`; generated request routes use Input and queued intent uses Output. `document_refs` now passes structurally without the removed unsafe cast. `post-message-types.test.ts:18-35` checks operation/PublishArtifact input identity. Its runtime all-true assertion is not itself a typecheck: fresh full TypeScript validation remains the parent's responsibility. No new type-repair defect identified by source review.
- The proxy still confines loopback configuration and origin/client headers, applies the larger bound only to document upload, forwards raw binary originals with attachment/nosniff metadata, and checks download bounds. Browser `original()` verifies bytes against the document's hash. No new material proxy issue found in this read-only review.
- Work stream uses abort/scope checks, bounded deduplication, opaque cursors and canonical invalidation; unknown outcomes remain visible. Existing tests cover pure/parser/controlled stream boundaries. No claim of actual browser stream/reconnect UX verification.
- Additional nonblocking completeness issue: `documentApi.list` (`batch2-api.ts:206-209`) ignores pagination; backend `list_documents` returns a default page of 25 plus `next_cursor` (`backend/workagent/documents.py:72-79`). With more documents, message links can point to missing displayed rows. Do not present that list as exhaustive without paging.

## Executed evidence and boundaries

Read-only Node execution transpiled the actual current TypeScript modules in memory, injected a controlled failing upload callback and a memory DocStore; no network or backend was invoked. Exit code 0, exact output:

```text
PASS actual byte roundtrip through memoryDocStore including 00/ff/80/fe (NOT IndexedDB/browser proof)
REPRO closed-client recovery: identical restored bytes get DIFFERENT upload command_id
REPRO unavailable storage: same-page unknown retry gets DIFFERENT upload command_id
```

`git diff --check -- web` passed. No full suite, build, service, browser, provider call, database maintenance, credential access, or implementation edit performed. Existing targeted tests were read, not rerun; hook/scope/checkpoint findings above are source-level reproductions requiring implementation-owner regression tests and downstream browser proof. Prior backend document security-review evidence is unchanged; the tiny backend source read here established replay and list semantics only.

Only report artifact created: `.local/recovery3/review-first.md`.
