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
  listMemory,
  readMemoryScopeBinding,
  memoryUsage,
  sendMemoryCommand,
  type MemoryCommand,
} from "@/lib/client/memory";
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

/**
 * Busy, not disabled: a disabled button drops keyboard focus to the page, so
 * a pressed control stays focusable and ignores presses until it can act.
 */
function held(unavailable: boolean, act: () => void) {
  return {
    "aria-disabled": unavailable || undefined,
    onClick: () => {
      if (!unavailable) act();
    },
  };
}

/** Per-memory human forms, kept across unrelated refreshes and failures. */
interface ItemForm {
  correct?: CorrectionDraft;
  narrowTo?: MemoryScopeKind;
  confirmForget?: boolean;
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
  const [forms, setForms] = useState<Record<string, ItemForm>>({});
  const [line, setLine] = useState<{ id: string | null; text: string } | null>(
    null,
  );
  /** Form whose write (send + readback) is running: "remember" or a memory id. */
  const [writing, setWriting] = useState<string | null>(null);
  const liveKey = useRef(key);
  const listSeq = useRef(0);
  /** An item acted on from the keyboard: where focus goes if it leaves. */
  const restore = useRef<{ id: string; index: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const viewGroup = useRef<HTMLDivElement>(null);
  /** Kind of each item seen, to name an outcome after the item has gone. */
  const lineKinds = useRef<Record<string, string>>({});
  for (const it of items ?? [])
    lineKinds.current[it.revision.memory_id] =
      `${KIND_LABEL[it.revision.kind]} memory`;
  /** Memories with a forget receipt on this page: never shown with payload. */
  const forgottenIds = useRef(new Set<string>());
  liveKey.current = key;

  // Everything shown belongs to exactly this key; a key change drops it all.
  useEffect(() => {
    setItems(null);
    setUsage(null);
    setForms({});
    setForm(emptyRememberForm());
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
    listSeq.current++;
    setAccessLost(true);
    setItems(null);
    setUsage(null);
    setForms({});
    setBinding(undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!key) return;
    const asked = key;
    // Only the newest list applies: an older read (possibly fetched before
    // a forget) must never land on top of a newer readback.
    const mine = ++listSeq.current;
    try {
      const page = await listMemory(
        ws,
        cid,
        view === "candidate" ? "candidate" : undefined,
      );
      if (liveKey.current !== asked || listSeq.current !== mine) return;
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
      if (liveKey.current !== asked || listSeq.current !== mine) return;
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

  // An item acted on from the keyboard that left the list (accepted,
  // rejected, forgotten, expired, narrowed away) hands focus to the next
  // item, else the one before, else the view switch; never the page top.
  useEffect(() => {
    const r = restore.current;
    if (!r || !items) return;
    if (items.some((it) => it.revision.memory_id === r.id)) {
      // Written and read again, still listed: focus stayed where it was.
      if (!writing) restore.current = null;
      return;
    }
    restore.current = null;
    const rows = list.current?.children;
    const next = rows?.length
      ? (rows[Math.min(r.index, rows.length - 1)] as HTMLElement)
      : viewGroup.current?.querySelector<HTMLElement>("[aria-pressed=true]");
    next?.focus();
  }, [items, writing]);

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

  const pending = journal?.pending ?? null;
  const dirty =
    form.content.trim() !== "" ||
    Object.values(forms).some((f) => f.correct?.content);
  useLeaveGuard(dirty || pending !== null);

  const dropForm = useCallback(
    (id: string) =>
      setForms((f) => {
        const rest = { ...f };
        delete rest[id];
        return rest;
      }),
    [],
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
    (o: CommandOutcome, memoryId: string | null): Promise<void> | void => {
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
        return refresh();
      } else if (o.kind === "unverified") {
        // Readback failed or disagreed: pause changes until a fresh list.
        setListStale(true);
        return refresh();
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
      const li = memoryId
        ? list.current?.querySelector<HTMLElement>(
            `[data-memory-id="${CSS.escape(memoryId)}"]`,
          )
        : null;
      if (memoryId && li?.contains(document.activeElement))
        restore.current = {
          id: memoryId,
          index: [...(list.current?.children ?? [])].indexOf(li),
        };
      setWriting(target);
      try {
        const o = await journal.submit(cmd);
        if (o.kind === "verified" || o.kind === "unverified") after?.();
        await settle(o, memoryId);
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
  const problem = rememberProblem(form);
  const busy = pending !== null || listStale || accessLost;

  const lineItem =
    line?.id != null
      ? items?.find((it) => it.revision.memory_id === line.id)
      : undefined;
  /** The outcome's item has left this list: say which kind it was. */
  const lineGone =
    line?.id != null && !lineItem
      ? (lineKinds.current[line.id] ?? "Memory")
      : "";
  const lineShownHere = !!line?.text && (line.id === null || !lineItem);

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

      {/* One always-mounted live region announces every outcome. It's shown
          here when it belongs to no listed item (a new memory, or one that
          has left the list); otherwise it's shown on the item itself. */}
      <p
        className={lineShownHere ? "small" : "sr-only"}
        role="status"
        data-testid="memory-outcome"
      >
        {line?.text && lineGone && line.id ? `${lineGone}: ` : ""}
        {line?.text ?? ""}
      </p>
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
            () =>
              setForm((cur) =>
                clearIfSubmitted(cur, sent, emptyRememberForm()),
              ),
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
              onChange={(e) =>
                setForm({ ...form, kind: e.target.value as MemoryKind })
              }
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
              <label key={s} className="row small memory-choice">
                <input
                  type="radio"
                  name={`memory-scope-${cid}`}
                  checked={form.scope_kind === s}
                  disabled={
                    writing === "remember" || (s === "work_area" && !workAreaId)
                  }
                  onChange={() => setForm({ ...form, scope_kind: s })}
                />
                <span>{SCOPE_LABEL[s]}</span>
              </label>
            ))}
          </fieldset>
        </div>
        {form.scope_kind === "user" ? (
          <p className="hint">
            This applies across your work in this whole workspace. Use it only
            for deliberate general preferences.
          </p>
        ) : null}
        {form.kind === "procedure" ? (
          <p className="small muted">
            Procedures are saved as suggestions and used only after you review
            them below.
          </p>
        ) : null}
        <button
          className="btn btn-primary btn-sm"
          type="submit"
          aria-disabled={
            !!problem || !rememberScopeId || busy || !!writing || undefined
          }
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

      <div
        className="row"
        role="group"
        aria-label="Show"
        style={{ gap: 8 }}
        ref={viewGroup}
      >
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
        loadError ? null : (
          <p className="small muted">Loading…</p>
        )
      ) : items.length === 0 ? (
        <p className="small muted">
          {view === "candidate"
            ? "Nothing is waiting for review."
            : "Nothing is remembered for this conversation."}
        </p>
      ) : (
        <ul
          className="stack-sm"
          style={{ listStyle: "none", padding: 0 }}
          ref={list}
        >
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
                className="card stack-sm memory-item"
                data-testid="memory-item"
                data-memory-id={r.memory_id}
                tabIndex={-1}
                aria-labelledby={`memory-${r.memory_id}`}
              >
                {erased ? (
                  <p className="small muted" id={`memory-${r.memory_id}`}>
                    Forgotten. Its content has been erased.
                  </p>
                ) : (
                  <p
                    style={{ whiteSpace: "pre-wrap" }}
                    id={`memory-${r.memory_id}`}
                  >
                    {r.content}
                  </p>
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
                    ) : (
                      <li>No linked source</li>
                    )}
                    {usedLast ? <li>Used in the latest answer</li> : null}
                  </ul>
                </details>

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
                        aria-describedby={`memory-${r.memory_id}`}
                        {...held(
                          busy,
                          () =>
                            void submit(
                              {
                                op: "review",
                                memoryId: r.memory_id,
                                body: { ...cas(r.revision_id), decision: d },
                              },
                              r.memory_id,
                            ),
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {r.status === "active" || r.status === "contested" ? (
                  <ItemControls
                    describedBy={`memory-${r.memory_id}`}
                    f={f}
                    setF={setF}
                    busy={busy || !!writing}
                    locked={writing === r.memory_id}
                    currentRevisionId={r.revision_id}
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
                  <p className="small" aria-hidden="true">
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
  describedBy,
  f,
  setF,
  busy,
  locked,
  currentRevisionId,
  narrowOptions,
  onCorrect,
  onNarrow,
  onExpire,
  onForget,
}: {
  /** The memory's own text: gives each repeated button its item. */
  describedBy: string;
  f: ItemForm;
  setF: (f: ItemForm) => void;
  busy: boolean;
  /** This item's write is in flight (send + readback): its fields are locked. */
  locked: boolean;
  currentRevisionId: string;
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
  // Opening or closing the confirmation or the correction keeps the
  // keyboard beside it: into the step that opened, back to what opened it.
  const mode = c ? "correct" : f.confirmForget ? "confirm" : "idle";
  const root = useRef<HTMLDivElement>(null);
  const was = useRef(mode);
  useEffect(() => {
    const from = was.current;
    was.current = mode;
    if (from === mode) return;
    const a = document.activeElement;
    if (a && a !== document.body && !root.current?.contains(a)) return;
    const at = (sel: string) =>
      root.current?.querySelector<HTMLElement>(sel)?.focus();
    if (mode === "confirm") at("[data-forget-confirm]");
    else if (mode === "correct") at("textarea");
    else at(from === "confirm" ? "[data-forget-open]" : "[data-correct-open]");
  }, [mode]);
  return (
    <div className="stack-sm" ref={root}>
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
                className="btn btn-sm btn-quiet btn-wrap"
                {...held(locked, () =>
                  setF({ ...f, correct: { ...c, base: currentRevisionId } }),
                )}
              >
                Correct the current version instead
              </button>
            </div>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              aria-describedby={describedBy}
              {...held(busy || rebased || !c.content.trim() || tempBad, () =>
                onCorrect(c),
              )}
            >
              Save correction
            </button>
            <button
              className="btn btn-sm btn-quiet"
              {...held(locked, () => setF({ ...f, correct: undefined }))}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : f.confirmForget ? (
        <div className="hint stack-sm">
          <p>
            Forget erases this memory’s content. It can’t unsend earlier
            requests, and it doesn’t delete source documents, saved outputs or
            records of what was already sent.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm btn-primary"
              data-forget-confirm
              aria-describedby={describedBy}
              {...held(busy, onForget)}
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
            data-correct-open
            aria-describedby={describedBy}
            {...held(busy, () =>
              setF({
                ...f,
                correct: {
                  base: currentRevisionId,
                  content: "",
                  mode: "permanent",
                  from: "",
                  until: "",
                },
              }),
            )}
          >
            Correct
          </button>
          {narrowOptions.map((to) => (
            <button
              key={to}
              className="btn btn-sm btn-quiet btn-wrap"
              aria-describedby={describedBy}
              {...held(busy, () => onNarrow(to))}
            >
              Limit to {SCOPE_LABEL[to].toLowerCase()}
            </button>
          ))}
          <button
            className="btn btn-sm btn-quiet"
            aria-describedby={describedBy}
            {...held(busy, onExpire)}
          >
            Expire
          </button>
          <button
            className="btn btn-sm btn-quiet"
            data-forget-open
            aria-describedby={describedBy}
            {...held(busy, () => setF({ ...f, confirmForget: true }))}
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
