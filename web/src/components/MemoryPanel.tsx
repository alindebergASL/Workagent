"use client";
/**
 * B3.1b Memory, a compact optional section of the conversation shell (next
 * to Files). Shows only the server's page for this workspace+conversation;
 * remembers on explicit request (this conversation by default), reviews
 * candidates, and corrects/narrows/expires/forgets with exact-revision
 * compare-and-swap. Pending commands live in RAM only (memory-commands).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { newCommandId } from "@/lib/client/api";
import { command } from "@/lib/client/real-api";
import { ApiError, describeError } from "@/lib/contract/errors";
import { useLeaveGuard } from "@/lib/client/leave-guard";
import { scopeState, subscribeScope } from "@/lib/client/session-scope";
import { workAreas } from "@/lib/client/work-areas";
import {
  bindMemoryScope,
  inspectMemory,
  lessonEvidence,
  listMemory,
  readMemoryScopeBinding,
  memoryUsage,
  sendMemoryCommand,
  type MemoryCommand,
} from "@/lib/client/memory";
import {
  MemoryReadFence,
  loadEvidence as fencedEvidence,
  loadRestore as fencedRestore,
  restoreSlot,
  EVIDENCE_SLOT,
  type RestoreChooser,
} from "@/lib/client/memory-reads";
import {
  MemoryCommandJournal,
  memoryScopeKey,
  type CommandOutcome,
} from "@/lib/client/memory-commands";
import {
  KIND_LABEL,
  ORIGIN_LABEL,
  SCOPE_LABEL,
  STATUS_LABEL,
  WHY_LABEL,
  emptyRememberForm,
  isErased,
  rememberBody,
  rememberProblem,
  renderable,
  scopeIdFor,
  validityText,
  withInspection,
  emptyProcedureForm,
  evidenceOptionText,
  evidenceRefText,
  isFailureOutcome,
  needsProcedureDetails,
  procedureCandidateBody,
  procedureFormOf,
  procedureOf,
  procedureProblem,
  rollbackBody,
  sameEvidence,
  CONFIDENCE_LABEL,
  reviewedInference,
  PROCEDURE_SCOPES,
  type MemoryRevision,
  type ProcedureEvidence,
  type ProcedureEvidenceOption,
  type ProcedureForm,
  bindingMatches,
  clearIfSubmitted,
  correctionBody,
  correctionRebased,
  isAccessLoss,
  maskForgotten,
  purgeForgotten,
  projectScopeId,
  sourceRefText,
  type BindMemoryScope,
  type CorrectionDraft,
  type MemoryScopeBinding,
  type MemoryKind,
  type MemoryScopeKind,
  type MemoryUsagePage,
  type RecalledMemory,
  type RememberForm,
  type ReviewDecision,
} from "@/lib/memory-contract";

function errText(e: unknown): string {
  if (e instanceof ApiError && e.status === 0 && e.code === "validation_error")
    return e.message;
  const d = describeError(e);
  return `${d.title}. ${d.nextAction}`;
}

function outcomeText(o: CommandOutcome): string | null {
  switch (o.kind) {
    case "verified":
      return `Done. Reread now shows: ${STATUS_LABEL[o.inspection.current.status]}.`;
    case "unverified":
      if (o.receipt.status === "forgotten")
        return o.reason === "failed"
          ? "Forgotten. Its content was removed here; rereading it to confirm failed, so this list may be out of date."
          : "Forgotten. Its content was removed here; rereading hasn’t confirmed it yet.";
      return o.reason === "failed"
        ? "The service accepted this, but rereading it failed. Refresh to see the current state."
        : "The service accepted this, but rereading it didn’t confirm it yet. Refresh to see the current state.";
    case "stale":
      return "This memory changed since you opened it, so nothing was changed. Look at the current version and decide again.";
    case "refused":
      return `Nothing was changed. ${errText(o.error)}`;
    case "unknown":
      return "We couldn’t tell whether this went through. It’s kept here (on this page only) so you can send exactly the same request again.";
    case "blocked":
      return "Resolve the request above before making another change.";
    case "closed":
      return null;
  }
}

/** Per-memory human forms, kept across unrelated refreshes and failures. */
interface ItemForm {
  correct?: CorrectionDraft;
  narrowTo?: MemoryScopeKind;
  confirmForget?: boolean;
  /** Restore an earlier adopted version, pinned to the revision it was opened on. */
  restore?: RestoreChooser;
}

export function MemoryPanel({
  ws,
  cid,
  isWorkArea,
  workVersion,
  runId,
}: {
  ws: string;
  cid: string;
  /** This conversation is itself a project (conversation.work_area set). */
  isWorkArea: boolean;
  /** Current conversation work_version, for an explicit project link. */
  workVersion: number;
  /** Latest run, for "used in the last answer". */
  runId: string | null;
}) {
  const scope = useSyncExternalStore(subscribeScope, scopeState, scopeState);
  const identity = scope.status === "ready" ? scope.scope_id : null;
  const ownerId = scope.status === "ready" ? scope.principal_id : null;
  const key = memoryScopeKey(identity, ws, cid);

  const journal = useMemo(
    () =>
      key
        ? new MemoryCommandJournal(key, {
            send: (c) => sendMemoryCommand(ws, c),
            inspect: (id) => inspectMemory(ws, id),
          })
        : null,
    // ws/cid are inside key.
    [key],
  );
  /** Evidence/history reads: fenced by authorization epoch and read identity. */
  // A new fence per key: a scope change invalidates every earlier read.
  const fence = useMemo(() => new MemoryReadFence(), [key]);
  useEffect(() => () => fence.revoke(), [fence]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!journal) return;
    const off = journal.subscribe(() => bump((n) => n + 1));
    return () => {
      off();
      journal.close();
    };
  }, [journal]);

  const [items, setItems] = useState<RecalledMemory[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Which server view is shown; never merged or counted locally. */
  const [view, setView] = useState<"current" | "candidate">("current");
  const viewRef = useRef(view);
  viewRef.current = view;
  /** Last refresh failed: what's shown may be out of date; changes pause. */
  const [listStale, setListStale] = useState(false);
  /** Access to this view was refused: nothing from the server is shown. */
  const [accessLost, setAccessLost] = useState(false);
  /** Read-back project link; undefined until read (or if unreadable). */
  const [binding, setBinding] = useState<MemoryScopeBinding | null | undefined>(
    undefined,
  );
  const workAreaId = projectScopeId({ id: cid, isWorkArea }, binding);
  const [usage, setUsage] = useState<MemoryUsagePage | null>(null);
  const [form, setForm] = useState<RememberForm>(emptyRememberForm);
  const [proc, setProc] = useState<ProcedureForm>(emptyProcedureForm);
  const [chosen, setChosen] = useState<ProcedureEvidence[]>([]);
  const [evidence, setEvidence] = useState<
    ProcedureEvidenceOption[] | { error: string } | null
  >(null);
  const [forms, setForms] = useState<Record<string, ItemForm>>({});
  const [line, setLine] = useState<{ id: string | null; text: string } | null>(
    null,
  );
  /** Form whose write (send + readback) is running: "remember" or a memory id. */
  const [writing, setWriting] = useState<string | null>(null);
  const liveKey = useRef(key);
  const listSeq = useRef(0);
  /** Memories with a forget receipt on this page: never shown with payload. */
  const forgottenIds = useRef(new Set<string>());
  liveKey.current = key;

  // Everything shown belongs to exactly this key; a key change drops it all.
  useEffect(() => {
    setItems(null);
    setUsage(null);
    setForms({});
    setForm(emptyRememberForm());
    setProc(emptyProcedureForm());
    setChosen([]);
    setEvidence(null);
    setLine(null);
    setWriting(null);
    forgottenIds.current = new Set();
    setLoadError(null);
    setListStale(false);
    setAccessLost(false);
    setBinding(undefined);
  }, [key]);

  /** Refused access: drop every server payload and the forms built on it. */
  const loseAccess = useCallback(() => {
    // No evidence/history read started before this is ever applied.
    fence.revoke();
    listSeq.current++;
    setAccessLost(true);
    setItems(null);
    setUsage(null);
    setForms({});
    setBinding(undefined);
    setEvidence(null);
    setChosen([]);
  }, [fence]);

  const refresh = useCallback(async () => {
    if (!key) return;
    const asked = key;
    // A refresh captured for a view the person has since left never runs,
    // and never applies: it must not fence or replace the newer view's list.
    const askedView = view;
    if (viewRef.current !== askedView) return;
    // Only the newest list applies: an older read (possibly fetched before
    // a forget) must never land on top of a newer readback.
    const mine = ++listSeq.current;
    try {
      const page = await listMemory(
        ws,
        cid,
        view === "candidate" ? "candidate" : undefined,
      );
      if (
        liveKey.current !== asked ||
        listSeq.current !== mine ||
        viewRef.current !== askedView
      )
        return;
      setItems(
        maskForgotten(
          page.items.map((it) => ({
            ...it,
            revision: renderable(it.revision),
          })),
          forgottenIds.current,
        ),
      );
      setHasMore(page.has_more);
      setLoadError(null);
      setListStale(false);
      setAccessLost(false);
    } catch (e) {
      if (
        liveKey.current !== asked ||
        listSeq.current !== mine ||
        viewRef.current !== askedView
      )
        return;
      setLoadError(errText(e));
      if (isAccessLoss(e)) loseAccess();
      // Otherwise keep what was shown and every form, marked out of date;
      // changes stay paused until a refresh succeeds.
      else setListStale(true);
    }
    if (!isWorkArea)
      readMemoryScopeBinding(ws, cid).then(
        (b) => liveKey.current === asked && setBinding(b),
        // Unreadable (or route missing): never treated as linked.
        () => liveKey.current === asked && setBinding(undefined),
      );
  }, [key, ws, cid, view, isWorkArea, loseAccess]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!key || !runId) return;
    const asked = key;
    const ac = new AbortController();
    memoryUsage(ws, runId, ac.signal).then(
      (u) => liveKey.current === asked && setUsage(u),
      () => liveKey.current === asked && setUsage(null),
    );
    return () => ac.abort();
  }, [key, ws, runId]);

  // Observed events a person can cite, only while proposing a procedure.
  const proposing = form.kind === "procedure";
  const loadEvidence = useCallback(
    () =>
      fencedEvidence(
        fence,
        (signal) => lessonEvidence(ws, cid, signal),
        {
          loading: () => setEvidence(null),
          loaded: (offered) => {
            setEvidence(offered);
            // Only references the server still offers stay chosen.
            setChosen((cur) =>
              cur.filter((c) =>
                offered.some((o) => sameEvidence(o.evidence, c)),
              ),
            );
          },
          failed: (message) => setEvidence({ error: message }),
          denied: loseAccess,
        },
        errText,
      ),
    [fence, ws, cid, loseAccess],
  );
  useEffect(() => {
    if (!proposing) return;
    loadEvidence();
    // Leaving the proposal drops whichever evidence read is current now,
    // including a Retry that replaced the initial one.
    return () => fence.cancel(EVIDENCE_SLOT);
  }, [proposing, loadEvidence, fence]);

  const openRestore = useCallback(
    (memoryId: string, base: string) =>
      fencedRestore(
        fence,
        memoryId,
        base,
        (signal) => inspectMemory(ws, memoryId, signal),
        {
          set: (restore) =>
            setForms((all) => ({
              ...all,
              [memoryId]: { ...all[memoryId], restore },
            })),
          denied: loseAccess,
        },
        errText,
      ),
    [fence, ws, loseAccess],
  );

  const pending = journal?.pending ?? null;
  const dirty =
    form.content.trim() !== "" ||
    Object.values(forms).some((f) => f.correct?.content);
  useLeaveGuard(dirty || pending !== null);

  const dropForm = useCallback(
    (id: string) => {
      fence.cancel(restoreSlot(id));
      setForms((f) => {
        const rest = { ...f };
        delete rest[id];
        return rest;
      });
    },
    [fence],
  );

  // A definite forget receipt purges at once, before the readback: the entry
  // and its forms lose their payload and every older read in flight is fenced.
  useEffect(() => {
    if (!journal) return;
    return journal.onReceipt((receipt, cmd) => {
      if (receipt.status !== "forgotten" && cmd.op !== "forget") return;
      forgottenIds.current.add(receipt.memory_id);
      listSeq.current++;
      dropForm(receipt.memory_id);
      setItems((cur) => (cur ? purgeForgotten(cur, receipt) : cur));
    });
  }, [journal, dropForm]);

  const settle = useCallback(
    (o: CommandOutcome, memoryId: string | null) => {
      if (o.kind === "closed") return;
      if (
        (o.kind === "refused" && isAccessLoss(o.error)) ||
        (o.kind === "unverified" && o.reason === "denied")
      ) {
        loseAccess();
        return;
      }
      // Outcome unknown: what's shown may be out of date until a reread.
      if (o.kind === "unknown") setListStale(true);
      setLine({ id: memoryId, text: outcomeText(o) ?? "" });
      if (o.kind === "verified") {
        const ins = o.inspection;
        const id = ins.current.memory_id;
        if (isErased(ins.current) || ins.current.status !== "active")
          // Nothing of an erased/retired item's former payload stays in forms.
          dropForm(id);
        listSeq.current++;
        setItems((cur) =>
          cur && cur.some((it) => it.revision.memory_id === id)
            ? maskForgotten(withInspection(cur, ins), forgottenIds.current)
            : cur,
        );
        void refresh();
      } else if (o.kind === "unverified") {
        // Readback failed or disagreed: pause changes until a fresh list.
        setListStale(true);
        void refresh();
      } else if (o.kind === "stale" && memoryId) {
        // Show the current version; no automatic rebase. The person's form
        // text (and the revision it was written against) is kept as typed
        // unless the current version was erased.
        const asked = liveKey.current;
        const seq = listSeq.current;
        void inspectMemory(ws, memoryId).then(
          (ins) => {
            if (liveKey.current !== asked || listSeq.current !== seq) return;
            if (isErased(ins.current)) dropForm(memoryId);
            setItems((cur) =>
              cur
                ? maskForgotten(withInspection(cur, ins), forgottenIds.current)
                : cur,
            );
          },
          (e) => {
            if (liveKey.current === asked && isAccessLoss(e)) loseAccess();
          },
        );
      }
    },
    [refresh, ws, dropForm, loseAccess],
  );

  const submit = useCallback(
    async (cmd: MemoryCommand, memoryId: string | null, after?: () => void) => {
      if (!journal) return;
      // The submitting form stays locked through send and readback.
      const target = memoryId ?? "remember";
      setWriting(target);
      try {
        const o = await journal.submit(cmd);
        if (o.kind === "verified" || o.kind === "unverified") after?.();
        settle(o, memoryId);
      } finally {
        setWriting((w) => (w === target ? null : w));
      }
    },
    [journal, settle],
  );

  const cas = (revisionId: string) => ({
    ...command(newCommandId()),
    expected_revision_id: revisionId,
  });

  const rememberScopeId = ownerId
    ? scopeIdFor(form.scope_kind, { conversationId: cid, workAreaId, ownerId })
    : null;
  const problem =
    rememberProblem(form) ??
    (proposing ? procedureProblem(proc, chosen) : null);
  const busy = pending !== null || listStale || accessLost;

  if (!key) return null;

  return (
    <details className="card card-quiet stack-sm" data-testid="memory-panel">
      <summary>Memory</summary>

      {pending ? (
        <div
          className="hint stack-sm"
          role="status"
          data-testid="memory-pending"
        >
          {pending.state === "sending" ? (
            <p>Sending…</p>
          ) : (
            <>
              <p>
                We couldn’t tell whether your last memory change went through.
                Other changes are paused until you decide. Leaving or reloading
                this page discards it.
              </p>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() =>
                    void journal!
                      .replay()
                      .then((o) =>
                        settle(
                          o,
                          "memoryId" in pending.cmd
                            ? pending.cmd.memoryId
                            : null,
                        ),
                      )
                  }
                >
                  Send exactly the same request again
                </button>
                <button
                  className="btn btn-sm btn-quiet"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Stop tracking this request? It may already have been applied; check the list before changing it again.",
                      )
                    ) {
                      journal!.abandon();
                      void refresh();
                    }
                  }}
                >
                  Stop tracking it
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {line && line.id === null ? (
        <p className="small" role="status">
          {line.text}
        </p>
      ) : null}
      {loadError ? (
        <p className="hint" role="alert">
          Couldn’t refresh memory. {loadError}
        </p>
      ) : null}

      <form
        className="stack-sm"
        aria-label="Remember something"
        onSubmit={(e) => {
          e.preventDefault();
          if (problem || !rememberScopeId || busy || writing) return;
          const sent = form;
          const sentProc = proc;
          const sentChosen = chosen;
          const after = () => {
            setForm((cur) => clearIfSubmitted(cur, sent, emptyRememberForm()));
            setProc((cur) =>
              clearIfSubmitted(cur, sentProc, emptyProcedureForm()),
            );
            setChosen((cur) => clearIfSubmitted(cur, sentChosen, []));
          };
          if (proposing) {
            // Always a candidate: nothing is used until a person accepts it.
            void submit(
              {
                op: "candidates",
                body: procedureCandidateBody(
                  form,
                  proc,
                  chosen,
                  [],
                  rememberScopeId,
                  command(newCommandId()),
                ),
              },
              null,
              after,
            );
            return;
          }
          const { route, body } = rememberBody(
            form,
            rememberScopeId,
            command(newCommandId()),
          );
          void submit(
            route === "remember"
              ? { op: "remember", body }
              : { op: "candidates", body },
            null,
            after,
          );
        }}
      >
        <label className="field">
          <span className="field-label">Remember</span>
          <textarea
            rows={2}
            value={form.content}
            maxLength={4000}
            disabled={writing === "remember"}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </label>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <label className="field">
            <span className="field-label">Kind</span>
            <select
              value={form.kind}
              disabled={writing === "remember"}
              onChange={(e) => {
                const kind = e.target.value as MemoryKind;
                setForm({
                  ...form,
                  kind,
                  // A procedure never defaults to all work in the workspace.
                  scope_kind:
                    kind === "procedure" &&
                    !PROCEDURE_SCOPES.includes(form.scope_kind)
                      ? "task"
                      : form.scope_kind,
                });
              }}
            >
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="field" style={{ border: 0, padding: 0 }}>
            <legend className="field-label">Applies to</legend>
            {(["task", "work_area", "user"] as const).map((s) => (
              <label key={s} className="row small">
                <input
                  type="radio"
                  name={`memory-scope-${cid}`}
                  checked={form.scope_kind === s}
                  disabled={
                    writing === "remember" ||
                    (s === "work_area" && !workAreaId) ||
                    (proposing && !PROCEDURE_SCOPES.includes(s))
                  }
                  onChange={() => setForm({ ...form, scope_kind: s })}
                />
                {SCOPE_LABEL[s]}
              </label>
            ))}
          </fieldset>
        </div>
        {proposing ? (
          <p className="small muted">
            A procedure is a lesson from specific work, so it stays with this
            conversation or a project you’ve linked. It can’t apply to all your
            work, so it doesn’t leak into unrelated tasks.
          </p>
        ) : null}
        {form.scope_kind === "user" ? (
          <p className="hint">
            This applies across your work in this whole workspace. Use it only
            for deliberate general preferences.
          </p>
        ) : null}
        {proposing && !accessLost ? (
          <div className="stack-sm" data-testid="memory-procedure-proposal">
            <p className="small muted">
              You’re proposing a lesson from what happened here. It’s saved as a
              suggestion and isn’t used in future work until you accept it
              below. Nothing is extracted automatically.
            </p>
            <EvidencePicker
              options={evidence}
              chosen={chosen}
              disabled={writing === "remember"}
              onRetry={() => void loadEvidence()}
              onToggle={(ev, on) =>
                setChosen((cur) =>
                  on
                    ? [...cur.filter((c) => !sameEvidence(c, ev)), { ...ev }]
                    : cur.filter((c) => !sameEvidence(c, ev)),
                )
              }
            />
            <ProcedureFields
              value={proc}
              disabled={writing === "remember"}
              onChange={setProc}
            />
            {problem && form.content.trim() ? (
              <p className="small muted">{problem}</p>
            ) : null}
          </div>
        ) : null}
        <button
          className="btn btn-primary btn-sm"
          type="submit"
          disabled={!!problem || !rememberScopeId || busy || !!writing}
        >
          {form.kind === "procedure" ? "Save for review" : "Remember"}
        </button>
      </form>

      {accessLost ? (
        <p className="hint" role="alert" data-testid="memory-access-lost">
          Memory isn’t available here right now, so nothing is shown.
        </p>
      ) : null}
      {listStale && !accessLost ? (
        <p className="hint" role="status">
          This list may be out of date. Changes are paused until it refreshes.{" "}
          <button
            className="btn btn-sm btn-quiet"
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </p>
      ) : null}

      {!isWorkArea && !accessLost ? (
        <ProjectLink
          ws={ws}
          cid={cid}
          workVersion={workVersion}
          binding={binding}
          onRead={(b) => {
            if (liveKey.current !== key) return;
            setBinding(b);
            void refresh();
          }}
          onAccessLoss={loseAccess}
        />
      ) : null}

      <div className="row" role="group" aria-label="Show" style={{ gap: 8 }}>
        {(
          [
            ["current", "In use"],
            ["candidate", "Waiting for review"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            className={`btn btn-sm ${view === v ? "btn-primary" : "btn-quiet"}`}
            aria-pressed={view === v}
            onClick={() => {
              if (view === v) return;
              listSeq.current++;
              viewRef.current = v;
              setItems(null);
              setHasMore(false);
              setView(v);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {accessLost ? null : items === null ? (
        <p className="small muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="small muted">
          Nothing is remembered for this conversation.
        </p>
      ) : (
        <ul className="stack-sm" style={{ listStyle: "none", padding: 0 }}>
          {items.map((it) => {
            const r = it.revision;
            const f = forms[r.memory_id] ?? {};
            const setF = (next: ItemForm) =>
              setForms((all) => ({ ...all, [r.memory_id]: next }));
            const erased = isErased(r);
            const usedLast = usage?.items.some((u) =>
              u.entries.some(
                (e) =>
                  e.memory_id === r.memory_id &&
                  e.revision_id === r.revision_id,
              ),
            );
            return (
              <li
                key={r.memory_id}
                className="card stack-sm"
                data-testid="memory-item"
                aria-label={`${KIND_LABEL[r.kind]} memory`}
              >
                {erased ? (
                  <p className="small muted">
                    Forgotten. Its content has been erased.
                  </p>
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{r.content}</p>
                )}
                <p className="small muted">
                  {KIND_LABEL[r.kind]} · {SCOPE_LABEL[r.scope_kind]} ·{" "}
                  {STATUS_LABEL[r.status]}
                  {it.unresolved_conflict
                    ? " · Conflicts with another memory"
                    : ""}
                </p>
                <details>
                  <summary className="small">Why this is here</summary>
                  <ul className="small muted">
                    <li>{WHY_LABEL[it.why]}</li>
                    <li>{ORIGIN_LABEL[r.origin]}</li>
                    <li>Confidence: {CONFIDENCE_LABEL[r.confidence_label]}</li>
                    {reviewedInference(r) ? (
                      <li>
                        You accepted this, which adopts it for use. It is still
                        an inference: accepting it didn’t test that it works.
                      </li>
                    ) : null}
                    {r.confidence_basis ? (
                      <li>Basis: {r.confidence_basis}</li>
                    ) : null}
                    {r.applicability ? (
                      <li>Applies when: {r.applicability}</li>
                    ) : null}
                    <li>Valid: {validityText(r)}</li>
                    {r.source_refs?.length ? (
                      <li>
                        Where this came from (a reference, not an instruction):
                        <ul>
                          {r.source_refs.map((ref, i) => (
                            <li key={i}>{sourceRefText(ref)}</li>
                          ))}
                        </ul>
                      </li>
                    ) : r.kind === "procedure" && procedureOf(r) ? (
                      <li>
                        No file or source selected; this rests only on the
                        observations it cites.
                      </li>
                    ) : (
                      <li>No linked source</li>
                    )}
                    {usedLast ? <li>Used in the latest answer</li> : null}
                  </ul>
                  <ProcedureFacts r={r} />
                </details>
                {r.kind === "procedure" && !erased ? (
                  <ProcedureWarnings r={r} />
                ) : null}

                {r.status === "candidate" && !erased ? (
                  <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                    {(
                      [
                        ["accept", "Accept"],
                        ["dispute", "Dispute"],
                        ["reject", "Reject"],
                      ] as [ReviewDecision, string][]
                    ).map(([d, label]) => (
                      <button
                        key={d}
                        className={`btn btn-sm ${d === "accept" ? "btn-primary" : "btn-quiet"}`}
                        disabled={
                          busy || (d === "accept" && needsProcedureDetails(r))
                        }
                        onClick={() =>
                          void submit(
                            {
                              op: "review",
                              memoryId: r.memory_id,
                              body: { ...cas(r.revision_id), decision: d },
                            },
                            r.memory_id,
                          )
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {r.status === "active" || r.status === "contested" ? (
                  <ItemControls
                    f={f}
                    setF={setF}
                    busy={busy || !!writing}
                    locked={writing === r.memory_id}
                    currentRevisionId={r.revision_id}
                    procedureStart={
                      r.kind === "procedure" && procedureOf(r)
                        ? {
                            procedure: procedureFormOf(r, procedureOf(r)),
                            keep: {
                              evidence: procedureOf(r)!.evidence,
                              source_refs: r.source_refs ?? [],
                            },
                          }
                        : null
                    }
                    canRestore={
                      r.kind === "procedure" && r.status === "active" && !erased
                    }
                    onOpenRestore={() =>
                      openRestore(r.memory_id, r.revision_id)
                    }
                    onCloseRestore={() =>
                      fence.cancel(restoreSlot(r.memory_id))
                    }
                    onRestore={(base, target) =>
                      void submit(
                        {
                          op: "rollback",
                          memoryId: r.memory_id,
                          // CAS against the revision the chooser was opened on.
                          body: rollbackBody(
                            command(newCommandId()),
                            base,
                            target,
                          ),
                        },
                        r.memory_id,
                        () =>
                          setForms((all) => {
                            const cur = all[r.memory_id];
                            if (!cur) return all;
                            return {
                              ...all,
                              [r.memory_id]: { ...cur, restore: undefined },
                            };
                          }),
                      )
                    }
                    narrowOptions={
                      r.scope_kind === "user"
                        ? workAreaId
                          ? ["work_area", "task"]
                          : ["task"]
                        : r.scope_kind === "work_area"
                          ? ["task"]
                          : []
                    }
                    onCorrect={(c) =>
                      void submit(
                        {
                          op: "correct",
                          memoryId: r.memory_id,
                          // CAS against the draft's pinned base revision.
                          body: correctionBody(c, command(newCommandId())),
                        },
                        r.memory_id,
                        () =>
                          setForms((all) => {
                            const cur = all[r.memory_id];
                            if (!cur) return all;
                            return {
                              ...all,
                              [r.memory_id]: {
                                ...cur,
                                correct: clearIfSubmitted(
                                  cur.correct,
                                  c,
                                  undefined,
                                ),
                              },
                            };
                          }),
                      )
                    }
                    onNarrow={(to) => {
                      const sid = scopeIdFor(to, {
                        conversationId: cid,
                        workAreaId,
                        ownerId: ownerId ?? "",
                      });
                      if (!sid) return;
                      void submit(
                        {
                          op: "narrow",
                          memoryId: r.memory_id,
                          body: {
                            ...cas(r.revision_id),
                            scope_kind: to,
                            scope_id: sid,
                          },
                        },
                        r.memory_id,
                      );
                    }}
                    onExpire={() =>
                      void submit(
                        {
                          op: "expire",
                          memoryId: r.memory_id,
                          body: cas(r.revision_id),
                        },
                        r.memory_id,
                      )
                    }
                    onForget={() =>
                      void submit(
                        {
                          op: "forget",
                          memoryId: r.memory_id,
                          body: cas(r.revision_id),
                        },
                        r.memory_id,
                      )
                    }
                  />
                ) : null}
                {line && line.id === r.memory_id ? (
                  <p className="small" role="status">
                    {line.text}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {hasMore ? (
        <p className="small muted">More memories exist than are shown here.</p>
      ) : null}
    </details>
  );
}

function ItemControls({
  f,
  setF,
  busy,
  locked,
  currentRevisionId,
  procedureStart,
  canRestore,
  onOpenRestore,
  onCloseRestore,
  onRestore,
  narrowOptions,
  onCorrect,
  onNarrow,
  onExpire,
  onForget,
}: {
  f: ItemForm;
  setF: (f: ItemForm) => void;
  busy: boolean;
  /** This item's write is in flight (send + readback): its fields are locked. */
  locked: boolean;
  currentRevisionId: string;
  /** Procedures: details to edit; evidence/sources are kept as they are. */
  procedureStart: Pick<CorrectionDraft, "procedure" | "keep"> | null;
  canRestore: boolean;
  onOpenRestore: () => void;
  /** Closing the chooser drops its read: a late answer can't reopen it. */
  onCloseRestore: () => void;
  onRestore: (base: string, target: string) => void;
  narrowOptions: MemoryScopeKind[];
  onCorrect: (c: NonNullable<ItemForm["correct"]>) => void;
  onNarrow: (to: MemoryScopeKind) => void;
  onExpire: () => void;
  onForget: () => void;
}) {
  const c = f.correct;
  const tempBad =
    c?.mode === "temporary" &&
    (!c.from || !c.until || new Date(c.until) <= new Date(c.from));
  const rebased = !!c && correctionRebased(c, currentRevisionId);
  const procBad =
    !!c?.procedure &&
    !!c.keep &&
    procedureProblem(c.procedure, c.keep.evidence) !== null;
  const rs = f.restore;
  const restoreRebased = !!rs && rs.base !== currentRevisionId;
  return (
    <div className="stack-sm">
      {c ? (
        <div className="stack-sm">
          <label className="field">
            <span className="field-label">Corrected text</span>
            <textarea
              rows={2}
              maxLength={4000}
              value={c.content}
              disabled={locked}
              onChange={(e) =>
                setF({ ...f, correct: { ...c, content: e.target.value } })
              }
            />
          </label>
          <label className="row small">
            <input
              type="checkbox"
              checked={c.mode === "temporary"}
              disabled={locked}
              onChange={(e) =>
                setF({
                  ...f,
                  correct: {
                    ...c,
                    mode: e.target.checked ? "temporary" : "permanent",
                  },
                })
              }
            />
            Only for a period
          </label>
          {c.procedure ? (
            <>
              <ProcedureFields
                value={c.procedure}
                disabled={locked}
                fixedContext
                onChange={(procedure) =>
                  setF({ ...f, correct: { ...c, procedure } })
                }
              />
              <p className="small muted">
                The observations and sources this procedure is based on are kept
                with the correction.
              </p>
            </>
          ) : null}
          {c.mode === "temporary" ? (
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <label className="field">
                <span className="field-label">From</span>
                <input
                  type="datetime-local"
                  value={c.from}
                  disabled={locked}
                  onChange={(e) =>
                    setF({ ...f, correct: { ...c, from: e.target.value } })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">Until</span>
                <input
                  type="datetime-local"
                  value={c.until}
                  disabled={locked}
                  onChange={(e) =>
                    setF({ ...f, correct: { ...c, until: e.target.value } })
                  }
                />
              </label>
            </div>
          ) : null}
          {rebased ? (
            <div className="hint stack-sm" role="alert">
              <p>
                This memory changed after you started this correction. Check the
                current version above before saving over it.
              </p>
              <button
                className="btn btn-sm btn-quiet"
                disabled={locked}
                onClick={() =>
                  setF({ ...f, correct: { ...c, base: currentRevisionId } })
                }
              >
                Correct the current version instead
              </button>
            </div>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={
                busy || rebased || !c.content.trim() || tempBad || procBad
              }
              onClick={() => onCorrect(c)}
            >
              Save correction
            </button>
            <button
              className="btn btn-sm btn-quiet"
              disabled={locked}
              onClick={() => setF({ ...f, correct: undefined })}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : rs ? (
        <div className="hint stack-sm" data-testid="memory-restore">
          <p>
            Restoring makes an earlier version you accepted the current one
            again, as a new version. Earlier versions and records of past use
            stay as they were. Suggestions you haven’t reviewed can’t be
            restored.
          </p>
          {rs.error ? (
            <p role="alert">{rs.error}</p>
          ) : rs.targets === null ? (
            <p className="small muted">Loading earlier versions…</p>
          ) : rs.targets.length === 0 ? (
            <p className="small muted">
              No earlier accepted version can be restored. To undo the first
              acceptance, use Expire.
            </p>
          ) : (
            <fieldset
              className="field stack-sm"
              style={{ border: 0, padding: 0 }}
            >
              <legend className="field-label">Version to restore</legend>
              {rs.targets.map((t) => (
                <label
                  key={t.revision_id}
                  className="row small"
                  style={{ alignItems: "flex-start", gap: 8 }}
                >
                  <input
                    type="radio"
                    name={`memory-restore-${rs.base}`}
                    checked={rs.choice === t.revision_id}
                    disabled={locked}
                    onChange={() =>
                      setF({ ...f, restore: { ...rs, choice: t.revision_id } })
                    }
                  />
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                    {new Date(t.recorded_at).toLocaleString()} ·{" "}
                    {STATUS_LABEL[t.status]}
                    <br />
                    <span className="muted">{t.content}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {restoreRebased ? (
            <p role="alert">
              This memory changed after you opened this. Close it and look at
              the current version first.
            </p>
          ) : null}
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy || restoreRebased || !rs.choice}
              onClick={() => onRestore(rs.base, rs.choice)}
            >
              Restore this version
            </button>
            <button
              className="btn btn-sm btn-quiet"
              disabled={locked}
              onClick={() => {
                onCloseRestore();
                setF({ ...f, restore: undefined });
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : f.confirmForget ? (
        <div className="hint stack-sm" role="alert">
          <p>
            Forget erases this memory’s content. It can’t unsend earlier
            requests, and it doesn’t delete source documents, saved outputs or
            records of what was already sent.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={onForget}
            >
              Forget it
            </button>
            <button
              className="btn btn-sm btn-quiet"
              onClick={() => setF({ ...f, confirmForget: false })}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button
            className="btn btn-sm btn-quiet"
            disabled={busy}
            onClick={() =>
              setF({
                ...f,
                correct: {
                  base: currentRevisionId,
                  content: "",
                  mode: "permanent",
                  from: "",
                  until: "",
                  ...(procedureStart ?? {}),
                },
              })
            }
          >
            Correct
          </button>
          {canRestore ? (
            <button
              className="btn btn-sm btn-quiet"
              disabled={busy}
              onClick={onOpenRestore}
            >
              Restore an earlier version…
            </button>
          ) : null}
          {narrowOptions.map((to) => (
            <button
              key={to}
              className="btn btn-sm btn-quiet"
              disabled={busy}
              onClick={() => onNarrow(to)}
            >
              Limit to {SCOPE_LABEL[to].toLowerCase()}
            </button>
          ))}
          <button
            className="btn btn-sm btn-quiet"
            disabled={busy}
            onClick={onExpire}
          >
            Expire
          </button>
          <button
            className="btn btn-sm btn-quiet"
            disabled={busy}
            onClick={() => setF({ ...f, confirmForget: true })}
          >
            Forget…
          </button>
        </div>
      )}
    </div>
  );
}

type AreaRow = Awaited<ReturnType<typeof workAreas.list>>[number];

/**
 * Explicit human link of this conversation to one named project the person
 * can see. Confirmed only by rereading the link; never inferred from owning
 * both. An unknown outcome keeps the exact request for a deliberate resend.
 */
function ProjectLink({
  ws,
  cid,
  workVersion,
  binding,
  onRead,
  onAccessLoss,
}: {
  ws: string;
  cid: string;
  workVersion: number;
  binding: MemoryScopeBinding | null | undefined;
  onRead: (b: MemoryScopeBinding | null) => void;
  onAccessLoss: () => void;
}) {
  const [areas, setAreas] = useState<AreaRow[] | null>(null);
  const [choice, setChoice] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** Exact request whose outcome is unknown (RAM only). */
  const [unknown, setUnknown] = useState<BindMemoryScope | null>(null);
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);

  const title = (id: string) => {
    const a = areas?.find((x) => x.id === id);
    return a ? (a.work_area?.title ?? a.title) : "a project";
  };

  const load = () => {
    setOpen(true);
    workAreas.list(ws).then(
      (rows) =>
        live.current &&
        setAreas(
          rows.filter(
            (r) => r.work_area && r.id !== cid && r.state !== "cancelled",
          ),
        ),
      (e) => {
        if (!live.current) return;
        if (isAccessLoss(e)) onAccessLoss();
        else setMsg(`Couldn’t load your projects. ${errText(e)}`);
      },
    );
  };

  const send = async (body: BindMemoryScope) => {
    setSending(true);
    setMsg(null);
    try {
      await bindMemoryScope(ws, body);
    } catch (e) {
      if (!live.current) return;
      setSending(false);
      if (e instanceof ApiError && e.isAmbiguousWrite) {
        setUnknown(body);
        setMsg("We couldn’t tell whether the link was saved.");
      } else {
        setUnknown(null);
        if (isAccessLoss(e)) onAccessLoss();
        else if (e instanceof ApiError && e.isVersionConflict)
          setMsg(
            "This conversation changed since the page loaded. Reload, then link again.",
          );
        else setMsg(`Not linked. ${errText(e)}`);
      }
      return;
    }
    setUnknown(null);
    try {
      const read = await readMemoryScopeBinding(ws, cid);
      if (!live.current) return;
      onRead(read);
      setMsg(
        bindingMatches(body, read)
          ? `Linked to ${title(body.work_area_id)}. Reread confirms it.`
          : "The link was accepted, but rereading didn’t confirm it yet.",
      );
      if (bindingMatches(body, read)) setOpen(false);
    } catch {
      if (live.current)
        setMsg(
          "The link was accepted, but it couldn’t be reread to confirm it.",
        );
    } finally {
      if (live.current) setSending(false);
    }
  };

  return (
    <div className="stack-sm small" data-testid="memory-project-link">
      <p className="muted">
        {binding
          ? `Linked to ${title(binding.work_area_id)}. Project memories can be used here.`
          : "Not linked to a project. Only this conversation’s memories (and your general preferences) are used."}
      </p>
      {unknown ? (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={sending}
            onClick={() => void send(unknown)}
          >
            Send the same link request again
          </button>
          <button
            className="btn btn-sm btn-quiet"
            disabled={sending}
            onClick={() => setUnknown(null)}
          >
            Stop tracking it
          </button>
        </div>
      ) : !binding && !open ? (
        <button className="btn btn-sm btn-quiet" onClick={load}>
          Link to a project…
        </button>
      ) : !binding && open ? (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <label className="field">
            <span className="field-label">Project</span>
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">
                {areas === null ? "Loading…" : "Choose a project"}
              </option>
              {(areas ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.work_area?.title ?? a.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-sm btn-primary"
            disabled={!choice || sending}
            onClick={() =>
              void send({
                ...command(newCommandId()),
                conversation_id: cid,
                work_area_id: choice,
                expected_work_version: workVersion,
              })
            }
          >
            Link
          </button>
          <button
            className="btn btn-sm btn-quiet"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {msg ? <p role="status">{msg}</p> : null}
    </div>
  );
}

/** Plain fields for a procedure; matching words are a secondary detail. */
export function ProcedureFields({
  value,
  disabled,
  fixedContext = false,
  onChange,
}: {
  value: ProcedureForm;
  disabled: boolean;
  /** Correction: applicability and basis are shown, not editable or sent. */
  fixedContext?: boolean;
  onChange: (v: ProcedureForm) => void;
}) {
  const field = (
    k: keyof ProcedureForm,
    label: string,
    hint?: string,
    rows = 2,
  ) => (
    <label className="field">
      <span className="field-label">{label}</span>
      {hint ? <span className="small muted">{hint}</span> : null}
      <textarea
        rows={rows}
        maxLength={2000}
        value={value[k]}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, [k]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="stack-sm">
      {fixedContext ? (
        <div className="small" data-testid="memory-procedure-fixed">
          <p>
            <span className="field-label">When it applies</span>{" "}
            {value.applicability}
          </p>
          <p>
            <span className="field-label">What it’s based on</span>{" "}
            {value.confidence_basis}
          </p>
          <p className="muted">
            These stay as you reviewed them. To change them, propose the
            procedure again.
          </p>
        </div>
      ) : (
        <>
          {field(
            "applicability",
            "When it applies",
            "The kind of work and the effect you expect.",
          )}
          {field(
            "confidence_basis",
            "What it’s based on",
            "What you saw happen, not how sure the assistant sounded.",
          )}
        </>
      )}
      {field(
        "counterexamples",
        "Limits and cases where it doesn’t apply",
        "One per line, part of when it applies. Include checks that must never be skipped.",
        3,
      )}
      {field("validation_notes", "What was checked vs. still a guess")}
      <details>
        <summary className="small">Matching words</summary>
        <div className="stack-sm">
          {field(
            "retrieval_terms",
            "Use when a request mentions",
            "One word or phrase per line. Only your requests are matched.",
          )}
          {field(
            "excluded_terms",
            "Never use when a request mentions",
            "One per line, e.g. an incompatible version.",
          )}
        </div>
      </details>
    </div>
  );
}

/** Real observed events, chosen by reference; nothing is typed by hand. */
export function EvidencePicker({
  options,
  chosen,
  disabled,
  onToggle,
  onRetry,
}: {
  options: ProcedureEvidenceOption[] | { error: string } | null;
  chosen: readonly ProcedureEvidence[];
  disabled: boolean;
  onToggle: (ev: ProcedureEvidence, on: boolean) => void;
  onRetry: () => void;
}) {
  return (
    <fieldset
      className="field stack-sm"
      style={{ border: 0, padding: 0, minWidth: 0 }}
      data-testid="memory-evidence-picker"
    >
      <legend className="field-label">What happened that supports it</legend>
      {options === null ? (
        <p className="small muted">Loading what happened here…</p>
      ) : "error" in options ? (
        <p className="small" role="alert">
          Couldn’t load what happened here. {options.error}{" "}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={onRetry}
          >
            Try again
          </button>
        </p>
      ) : options.length === 0 ? (
        <p className="small muted">
          Nothing in this conversation can be cited yet.
        </p>
      ) : (
        <>
          <p className="small muted">
            Citing something records that it happened. It doesn’t show the
            lesson works.
          </p>
          {options.map((o) => {
            const on = chosen.some((c) => sameEvidence(c, o.evidence));
            const failed = isFailureOutcome(o.outcome, o.operational_outcome);
            return (
              <label
                key={`${o.evidence.kind}:${o.evidence.event_id}`}
                className="row small"
                style={{ alignItems: "flex-start", gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={(e) => onToggle(o.evidence, e.target.checked)}
                />
                <span
                  style={{ minWidth: 0, overflowWrap: "anywhere" }}
                  data-outcome={failed ? "failed" : undefined}
                >
                  {evidenceOptionText(o)}
                </span>
              </label>
            );
          })}
        </>
      )}
    </fieldset>
  );
}

/** Inspection of a procedure's details: exact references, never content. */
export function ProcedureFacts({ r }: { r: MemoryRevision }) {
  const p = procedureOf(r);
  if (!p) return null;
  return (
    <ul
      className="small muted"
      style={{ overflowWrap: "anywhere" }}
      data-testid="memory-procedure-facts"
    >
      {p.counterexamples.length ? (
        <li>
          Doesn’t apply when (part of when it applies, as reviewed):
          <ul>
            {p.counterexamples.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </li>
      ) : null}
      {p.validation_notes ? (
        <li>Checked vs. guessed: {p.validation_notes}</li>
      ) : null}
      <li>
        Based on (references, not instructions):
        <ul>
          {p.evidence.map((e, i) => (
            <li key={i}>{evidenceRefText(e)}</li>
          ))}
        </ul>
      </li>
      {p.retrieval_terms.length ? (
        <li>Used when a request mentions: {p.retrieval_terms.join(", ")}</li>
      ) : null}
      {p.excluded_terms?.length ? (
        <li>Never when a request mentions: {p.excluded_terms.join(", ")}</li>
      ) : null}
    </ul>
  );
}

export function ProcedureWarnings({ r }: { r: MemoryRevision }) {
  const p = procedureOf(r);
  const notes: string[] = [];
  if (!p)
    notes.push(
      "This procedure has no supporting observations recorded, so it can’t be accepted or used. Propose it again citing what happened.",
    );
  if (r.status === "candidate")
    notes.push(
      r.origin === "agent_inferred"
        ? "A suggested lesson, not yet checked by you. It isn’t used in any work until you accept it. Accepting adopts it; it stays marked as inferred and isn’t a test that it works."
        : "Not used in any work until you accept it.",
    );
  if (p && p.evidence.every((e) => e.kind === "human_message"))
    notes.push("Based only on what you said, not on an observed result.");
  if (p && (r.source_refs?.length ?? 0) > 0)
    notes.push(
      "Depends on the sources listed. If one is withdrawn, this stops being used.",
    );
  if (!notes.length) return null;
  return (
    <ul className="hint small" data-testid="memory-procedure-warnings">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
