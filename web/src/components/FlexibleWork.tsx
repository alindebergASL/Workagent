"use client";
import Link from "next/link";
import {
  changeItems,
  yourNotes,
  type ChangeItem,
} from "@/lib/proposal-changes";
import {
  type Acks,
  ackPayload,
  acksFor,
  canAccept,
  candidates,
  reviewOf,
  type ReviewableProposal,
  selectedComparison,
} from "@/lib/proposal-review";
import { ProposalReviewGate } from "./ProposalReviewGate";
import { scopedHref } from "@/lib/scope";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { productApi, type S } from "@/lib/client/products";
import { useLeaveGuard } from "@/lib/client/leave-guard";
import { ApiError } from "@/lib/contract/errors";
import { DocDiff, DocEdit, DocRead } from "@/components/DocBody";
import { countChanges, diffBlocks } from "@/lib/diff";
import { NotesList, useFitHeight } from "@/components/NotesList";
import { ObservedOutput } from "@/components/ObservedOutput";
import { SandboxedView, type ViewActions } from "@/components/SandboxedView";
import {
  noteAuthors,
  savedBody,
  viewBlocks,
  type NoteAuthors,
} from "@/lib/document-blocks";
import {
  addRow,
  bindingStates,
  cellAt,
  cellAuthors,
  cellChanges,
  type CellChange,
  canRemoveRow,
  cellInput,
  cellValue,
  cardLabel,
  changeSummary,
  editsSinceWorkagent,
  plainReason,
  fieldHeading,
  longTextFields,
  rowNameField,
  flexibleKind,
  formatCell,
  isEmptyPayload,
  isFlexible,
  KIND_LABEL,
  LIMITS,
  viewChanges,
  viewChangeSummary,
  pinsVersions,
  notesProblem,
  parseCell,
  rebind,
  removeRow,
  rowName,
  setCell,
  slug,
  rowsAddedRemoved,
  tableChanges,
  unitLegend,
  tableCsv,
  viewActionRequest,
  type CustomView,
  type DocumentBody,
  type FlexibleBody,
  type StructuredTable,
} from "@/lib/flexible";
import { readableTitle } from "@/lib/titles";
import { EarlierVersion, versionAuthor } from "@/components/EarlierVersion";

/** The saved version each bound piece of work is at now, by artifact id. */
export type Bound = Record<
  string,
  { revision_id: string; body_hash: string; title: string } | null
>;

type Pending =
  | { kind: "save"; id: string; base: string; body: FlexibleBody }
  | {
      kind: "accept";
      id: string;
      base: string;
      pid: string;
      acks?: ReturnType<typeof ackPayload>;
    }
  | {
      kind: "dismiss";
      id: string;
      base: string;
      pid: string;
      resolution: "keep_current" | "dismiss";
    };
/** A cell as the person typed it; only an `error` blocks saving. */
type RawCell = { text: string; error?: string };
type Draft = {
  base: string;
  body: FlexibleBody;
  pending: Pending | null;
  raw?: Record<string, RawCell>;
};
const cellKey = (rowId: string, key: string) => `${rowId}\u001f${key}`;

/** The same body in the shape a save sends, so unchanged work isn't "dirty". */
function normal(body: FlexibleBody): FlexibleBody {
  return flexibleKind(body) === "document"
    ? savedBody(
        (body as DocumentBody).title,
        viewBlocks((body as DocumentBody).blocks),
      )
    : body;
}
function readDraft(key: string, artifact: S["Artifact"]): Draft {
  const body = artifact.current_revision.body as FlexibleBody;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      if (d.base && d.body && flexibleKind(d.body) === flexibleKind(body))
        return d;
    }
  } catch {
    /* saved server state is still available */
  }
  return {
    base: artifact.current_revision_id,
    body: structuredClone(body),
    pending: null,
  };
}
/** Problems that would make the service refuse a save, in plain words. */
function draftProblem(draft: Draft): string {
  const bad = Object.values(draft.raw ?? {}).filter((c) => c.error);
  if (bad.length)
    return `Fix ${bad.length === 1 ? "the highlighted value" : `the ${bad.length} highlighted values`} before saving.`;
  const b = draft.body;
  if (flexibleKind(b) === "structured_table") {
    const notes = notesProblem(
      (b as StructuredTable).notes ?? [],
      LIMITS.notes,
    );
    if (notes) return notes;
  }
  if (flexibleKind(b) === "document") {
    const doc = b as DocumentBody;
    if (doc.blocks.some((x) => !x.text.trim()))
      return "Write something in each part, or remove the empty one, before saving.";
    if (doc.blocks.some((x) => x.text.length > LIMITS.blockChars))
      return `Keep each part under ${LIMITS.blockChars.toLocaleString("en")} characters.`;
  }
  if (flexibleKind(b) === "custom_view") {
    const fallback = (b as CustomView).fallback;
    if (!fallback.trim()) return "The readable version can’t be empty.";
    if (fallback.length > LIMITS.fallbackChars)
      return `Keep the readable version under ${LIMITS.fallbackChars.toLocaleString("en")} characters.`;
  }
  return "";
}

/** Download text made in the browser from a saved version. */
function saveText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Self-describing work: a document, a structured table or an agent-made
 * view, rendered from what the saved version says about itself. Saving,
 * proposals and history use the same paths as every other kind of work.
 */
export function FlexibleEditor({
  ws,
  cid,
  artifact,
  proposals,
  history,
  observations,
  bound,
  open,
  origin,
  stale,
  refresh,
  onDirtyChange,
  focusRevision,
  onAskForChange,
}: {
  ws: string;
  cid: string;
  /** An earlier version a conversation link opened, if any. */
  focusRevision?: string | null;
  /**
   * Brings the conversation beside this work forward, ready to ask for a
   * different change. Nothing is sent and the proposal stays as it is.
   */
  onAskForChange?: (suggestion?: string) => void;
  artifact: S["Artifact"];
  proposals: S["Proposal"][];
  history: S["Revision"][];
  observations: S["ObservationReadback"][];
  bound: Bound;
  open: boolean;
  origin: string;
  stale: boolean;
  refresh: () => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const key = `workagent:product:${ws}:${cid}:${artifact.id}`;
  const saved = artifact.current_revision.body as FlexibleBody;
  const kind = flexibleKind(saved)!;
  const [draft, setDraft] = useState<Draft>(() => readDraft(key, artifact));
  // A draft must be for this kind of work. If the editor is shown other
  // work without remounting, re-read before anything renders with it.
  if (flexibleKind(draft.body) !== kind) setDraft(readDraft(key, artifact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const problem = draftProblem(draft);
  const dirty =
    Boolean(draft.raw && Object.keys(draft.raw).length && problem) ||
    JSON.stringify(normal(draft.body)) !== JSON.stringify(normal(saved));
  const changed = draft.base !== artifact.current_revision_id;
  // Who added each kept note: from the saved history, and the person for a
  // note they've added or reworded in this draft.
  const savedNoteAuthors = useMemo(
    () => noteAuthors(artifact.current_revision, history),
    [artifact.current_revision, history],
  );
  // Values the person changed since Workagent's latest version: what it
  // worked out from them hasn't been recalculated, and says so.
  const edited = useMemo(
    () =>
      editsSinceWorkagent(
        artifact.current_revision,
        history,
        new Set(
          proposals
            .map((p) => p.accepted_revision_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    [artifact.current_revision, history, proposals],
  );
  const savedCellAuthors = useMemo(
    () => cellAuthors(artifact.current_revision, history),
    [artifact.current_revision, history],
  );
  const draftNoteAuthors = useMemo(() => {
    if (kind !== "document") return savedNoteAuthors;
    const saved = new Map(
      (artifact.current_revision.body as DocumentBody).blocks.map((b) => [
        b.block_id,
        b.text,
      ]),
    );
    const out = { ...savedNoteAuthors };
    for (const b of (draft.body as DocumentBody).blocks)
      if (b.kind === "protected_note" && saved.get(b.block_id) !== b.text)
        out[b.block_id] = "human";
    return out;
  }, [kind, savedNoteAuthors, draft.body, artifact.current_revision.body]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useLeaveGuard(dirty || Boolean(draft.pending));

  /** Journals the draft; false when the browser refused to store it. */
  function keep(next: Draft): boolean {
    setDraft(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
      return true;
    } catch {
      setNotice(
        "Browser storage unavailable. Keep this tab open to retain the draft and retry information.",
      );
      return false;
    }
  }
  const fresh = (a: S["Artifact"]): Draft => ({
    base: a.current_revision_id,
    body: structuredClone(a.current_revision.body as FlexibleBody),
    pending: null,
  });
  async function submit(action: Pending, done?: string) {
    if (busy || (!draft.pending && action.kind === "save" && problem)) return;
    const exact = draft.pending ?? action;
    const journaled = keep({ ...draft, pending: exact });
    setBusy(true);
    setError("");
    // A storage failure was just reported by keep(); do not erase that warning.
    if (journaled) setNotice("");
    try {
      if (exact.kind === "save") {
        const next = await productApi.save(
          ws,
          artifact.id,
          exact.id,
          exact.base,
          exact.body,
        );
        if (!isFlexible(next.current_revision.body))
          throw new Error("Unexpected response.");
        keep(fresh(next));
        setNotice(done ?? "Your edits are saved.");
      } else if (exact.kind === "accept") {
        const next = await productApi.accept(
          ws,
          exact.pid,
          exact.id,
          exact.base,
          exact.acks,
        );
        if (!isFlexible(next.current_revision.body))
          throw new Error("Unexpected response.");
        keep(fresh(next));
        setNotice("The proposed version is now your saved version.");
      } else {
        await productApi.dismiss(
          ws,
          exact.pid,
          exact.id,
          exact.base,
          exact.resolution,
        );
        keep({ ...draft, pending: null });
        setNotice(
          exact.resolution === "keep_current"
            ? "Kept your saved version. The proposal is closed."
            : "Proposal dismissed. Your saved version is unchanged.",
        );
      }
      await refresh();
    } catch (e) {
      if (
        !(e instanceof ApiError && e.isAmbiguousWrite) &&
        !(e instanceof TypeError)
      )
        keep({ ...draft, pending: null });
      setError(e instanceof Error ? e.message : "Could not confirm that.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || Boolean(draft.pending) || stale;
  // Ctrl/Cmd+S saves unsaved edits, the same explicit save as the button,
  // instead of the browser's "save page".
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveRef.current = () => {
      if (!dirty || locked || problem) return;
      void submit({
        kind: "save",
        id: crypto.randomUUID(),
        base: draft.base,
        body: structuredClone(draft.body),
      });
    };
  });
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty]);
  const pendingProposals = proposals.filter((p) => p.status === "pending");
  // One latest candidate for the saved version; earlier ones stay reachable
  // but secondary, and out-of-date ones can only be dismissed.
  const cand = candidates(
    pendingProposals as (S["Proposal"] & ReviewableProposal)[],
    artifact.current_revision_id,
  );
  const [acks, setAcks] = useState<Record<string, Acks>>({});
  // The proposal whose changes the person asked to review, for the saved
  // version it was chosen on; otherwise Changes opens on the latest.
  const [reviewing, setReviewing] = useState<{ id: string; base: string }>();
  const reviewingId =
    reviewing?.base === artifact.current_revision_id ? reviewing.id : null;
  const byWorkagent = artifact.current_revision.author_kind !== "human";
  // The work reads first; editing is one step away and comes back on its
  // own while anything is unsaved. A view has its own surface instead.
  const tabbed = kind !== "custom_view";
  const modeKey = `${key}:mode`;
  const [chosen, setMode] = useState<WorkMode>(() => {
    if (dirty || draft.pending) return "edit";
    try {
      const m = sessionStorage.getItem(modeKey);
      return m === "edit" || m === "changes" ? m : "result";
    } catch {
      return "result";
    }
  });
  // Changes shows only while something is proposed for this kind of work.
  const comparable = pendingProposals.filter(
    (p) => isFlexible(p.body) && flexibleKind(p.body) === kind,
  );
  const mode: WorkMode =
    chosen === "changes" && !comparable.length ? "result" : chosen;
  const show = (next: WorkMode) => {
    setMode(next);
    try {
      sessionStorage.setItem(modeKey, next);
    } catch {
      /* the choice holds for this page only */
    }
  };
  const editing = !tabbed || mode === "edit";
  return (
    <div className="stack product" data-kind={kind}>
      <header className="stack-sm">
        <h1>{readableTitle(saved.title)}</h1>
        <div className="row product-meta">
          <span className="small muted">
            {KIND_LABEL[kind]} · {origin}
          </span>
          <span className="composer-spacer" />
          <details className="more-menu">
            <summary aria-label="More for this work">⋯</summary>
            <div className="more-menu-list">
              {kind === "structured_table" ? (
                <button
                  className="link-quiet small"
                  onClick={() =>
                    saveText(
                      tableCsv(saved as StructuredTable),
                      `${slug(saved.title, "table")}.csv`,
                      "text/csv",
                    )
                  }
                >
                  Download as CSV
                </button>
              ) : null}
              <button
                className="link-quiet small"
                onClick={() => void refresh()}
              >
                Check for updates
              </button>
            </div>
          </details>
        </div>
      </header>

      {focusRevision ? (
        <EarlierVersion
          revisionId={focusRevision}
          current={artifact.current_revision}
          history={history}
          proposals={proposals}
          workHref={scopedHref(
            `/conversations/${cid}/artifacts/${artifact.id}`,
            ws,
          )}
          render={(body) =>
            isFlexible(body) ? <ReadOnly body={body} /> : null
          }
        />
      ) : null}
      {stale ? (
        <p role="alert" className="notice-line">
          Connection lost. Showing what was last read; changes are paused until
          it reconnects.
        </p>
      ) : null}
      {changed ? (
        <p role="alert" className="notice-line">
          The saved version changed. Your draft is kept; discard it to see the
          new version, or save to compare.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice-line">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice-line">
          {notice}
        </p>
      ) : null}

      {(() => {
        const renderCard = (p: S["Proposal"] & ReviewableProposal) => {
          const outdated = p.base_revision_id !== artifact.current_revision_id;
          const review = outdated
            ? null
            : reviewOf(p, saved, cand.latest?.id ?? null);
          const given = review ? acksFor(acks[p.id], review) : null;
          const earlier = Boolean(review && !review.isLatest);
          const proposed = isFlexible(p.body) ? p.body : null;
          const tableProposal = Boolean(
            proposed &&
            flexibleKind(proposed) === "structured_table" &&
            kind === "structured_table",
          );
          const cellCount = tableProposal
            ? cellChanges(saved as StructuredTable, proposed as StructuredTable)
                .length
            : 0;
          const docParts =
            proposed &&
            !outdated &&
            flexibleKind(proposed) === "document" &&
            kind === "document"
              ? documentProposalParts(
                  saved as DocumentBody,
                  proposed as DocumentBody,
                  savedNoteAuthors,
                  artifact.current_revision.author_kind === "human",
                )
              : null;
          // A proposal that renames the work is named, so it's clear which
          // version is proposed while the saved one keeps its own title.
          const proposedTitle = (proposed as { title?: string } | null)?.title;
          const proposedName =
            proposedTitle &&
            proposedTitle !== (saved as { title?: string }).title
              ? readableTitle(proposedTitle)
              : null;
          return (
            <section
              key={p.id}
              className={`card decision-card product-proposal${earlier ? " proposal-earlier" : ""}`}
              data-testid="product-proposal"
              data-candidate={
                outdated ? "outdated" : earlier ? "earlier" : "latest"
              }
              aria-labelledby={`proposal-${p.id}`}
            >
              <p className="eyebrow-caps">
                {earlier ? "Earlier proposal" : "Waiting for you"}
              </p>
              <h2 id={`proposal-${p.id}`}>
                {outdated
                  ? "This proposal is out of date"
                  : earlier
                    ? "An earlier proposed version"
                    : cand.earlier.length
                      ? "The latest proposed version"
                      : "A proposed version is ready"}
              </h2>
              {earlier ? (
                <p className="small" role="note">
                  A later proposal was made for the same saved version.
                </p>
              ) : null}
              {outdated ? (
                <p className="decision-question" role="status">
                  It was made from an earlier saved version, so it can’t replace
                  your current one. Dismiss it, or ask for a new one in the
                  conversation.
                </p>
              ) : null}
              {proposedName ? (
                <p className="proposal-name" data-testid="proposal-name">
                  Proposed: <strong>{proposedName}</strong>
                </p>
              ) : null}
              {p.reason ? (
                <p className="small">{plainReason(p.reason)}</p>
              ) : null}
              {tableProposal ? (
                <>
                  <p
                    className="decision-question"
                    data-testid="proposal-changes"
                  >
                    {changeSummary(
                      tableChanges(
                        saved as StructuredTable,
                        proposed as StructuredTable,
                      ),
                    )}
                  </p>
                  {/* The Changes tab shows the same cells; not twice. */}
                  {outdated ||
                  cellCount > 3 ||
                  (tabbed && mode === "changes") ? null : (
                    <TableProposalCells
                      saved={saved as StructuredTable}
                      proposed={proposed as StructuredTable}
                      authors={savedCellAuthors}
                    />
                  )}
                </>
              ) : null}
              {docParts?.summary}
              {proposed &&
              flexibleKind(proposed) === "custom_view" &&
              kind === "custom_view" ? (
                <ViewProposal
                  saved={saved as CustomView}
                  proposed={proposed as CustomView}
                  bound={bound}
                />
              ) : null}
              {review && given ? (
                <ProposalReviewGate
                  review={review}
                  acks={given}
                  disabled={locked || dirty}
                  setAcks={(next) => setAcks((a) => ({ ...a, [p.id]: next }))}
                />
              ) : null}
              <div className="row proposal-decision">
                {outdated || !review || !given ? null : (
                  <button
                    className={earlier ? "btn btn-quiet" : "btn btn-on-soft"}
                    disabled={locked || dirty || !canAccept(review, given)}
                    data-testid="apply-proposal"
                    onClick={() =>
                      void submit({
                        kind: "accept",
                        id: crypto.randomUUID(),
                        pid: p.id,
                        base: artifact.current_revision_id,
                        acks: ackPayload(review, given),
                      })
                    }
                  >
                    {earlier
                      ? "Apply this earlier version"
                      : "Apply proposed version"}
                  </button>
                )}
                <button
                  className="btn btn-quiet"
                  disabled={locked}
                  onClick={() =>
                    void submit({
                      kind: "dismiss",
                      id: crypto.randomUUID(),
                      pid: p.id,
                      base: artifact.current_revision_id,
                      resolution: outdated ? "dismiss" : "keep_current",
                    })
                  }
                >
                  {outdated ? "Dismiss proposal" : "Keep my current version"}
                </button>
                {onAskForChange ? (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => onAskForChange()}
                    data-testid="ask-for-change"
                  >
                    Ask for a different change
                  </button>
                ) : null}
              </div>
              {!outdated && dirty ? (
                <p className="small">Save or discard your changes first.</p>
              ) : null}
              {tabbed &&
              mode !== "changes" &&
              proposed &&
              flexibleKind(proposed) === kind ? (
                // The full comparison is its own tab, so the decision here
                // stays short however much changed.
                <button
                  type="button"
                  className="link-quiet small"
                  data-testid="review-changes"
                  onClick={() => {
                    setReviewing({
                      id: p.id,
                      base: artifact.current_revision_id,
                    });
                    show("changes");
                    document
                      .getElementById("work-tab-changes")
                      ?.scrollIntoView({ block: "start" });
                  }}
                >
                  Review the changes
                </button>
              ) : null}
            </section>
          );
        };
        return (
          <>
            {cand.latest ? renderCard(cand.latest) : null}
            {cand.earlier.length ? (
              <details className="ids-details" data-testid="earlier-proposals">
                <summary>
                  {plural(cand.earlier.length, "earlier proposal")} for this
                  version
                </summary>
                <div className="stack-sm">{cand.earlier.map(renderCard)}</div>
              </details>
            ) : null}
            {cand.outdated.map(renderCard)}
          </>
        );
      })()}

      {kind === "custom_view" ? (
        <ViewSurface
          ws={ws}
          cid={cid}
          artifact={artifact}
          view={saved as CustomView}
          bound={bound}
          open={open}
          stale={stale}
          refresh={refresh}
          canRebind={!locked && !dirty && !changed}
          rebindNow={() =>
            void submit(
              {
                kind: "save",
                id: crypto.randomUUID(),
                base: artifact.current_revision_id,
                body: rebind(saved as CustomView, bound),
              },
              "The view now reads the latest saved versions.",
            )
          }
        />
      ) : null}

      {tabbed ? (
        <WorkTabs
          mode={mode}
          show={show}
          dirty={dirty}
          changes={comparable.length}
        />
      ) : null}
      {tabbed && mode === "changes" ? (
        <section
          className="work-result stack"
          role="tabpanel"
          id="work-panel-changes"
          aria-labelledby="work-tab-changes"
          data-testid="work-changes"
        >
          {(() => {
            // The chosen (or else latest) comparison shows; others are one
            // step away. Choosing an earlier one keeps its warning.
            const first = selectedComparison(
              comparable,
              reviewingId,
              cand.latest?.id ?? null,
            );
            const rest = comparable.filter((p) => p !== first);
            const compare = (p: S["Proposal"]) => {
              const proposed = p.body as FlexibleBody;
              const rows =
                kind === "structured_table"
                  ? rowsAddedRemoved(
                      saved as StructuredTable,
                      proposed as StructuredTable,
                    )
                  : null;
              const outdated =
                p.base_revision_id !== artifact.current_revision_id;
              return (
                <div
                  key={p.id}
                  className="stack-sm proposal-compare"
                  data-testid="proposal-compare"
                  data-proposal-id={p.id}
                >
                  {p === first ? (
                    <h3 className="small" data-testid="compare-title">
                      {outdated
                        ? "Proposal from an earlier saved version"
                        : p.id === cand.latest?.id
                          ? "Latest proposal"
                          : "Earlier proposal you chose to review"}
                      {proposed.title ? ` · ${proposed.title}` : ""}
                    </h3>
                  ) : null}
                  {p.id !== cand.latest?.id && !outdated ? (
                    <p className="small" role="note">
                      An earlier proposal for this saved version.
                    </p>
                  ) : null}
                  {outdated ? (
                    <p className="small" role="status">
                      Made from an earlier saved version, so it can’t replace
                      your current one.
                    </p>
                  ) : null}
                  {kind === "structured_table" ? (
                    <TableProposalCells
                      saved={saved as StructuredTable}
                      proposed={proposed as StructuredTable}
                      authors={savedCellAuthors}
                    />
                  ) : kind === "document" ? (
                    documentProposalParts(
                      saved as DocumentBody,
                      proposed as DocumentBody,
                      savedNoteAuthors,
                      artifact.current_revision.author_kind === "human",
                    ).diff
                  ) : null}
                  {rows?.removed.length ? (
                    <p className="small" data-testid="proposal-removed-rows">
                      Takes out {rows.removed.map((n) => `“${n}”`).join(", ")}.
                    </p>
                  ) : null}
                  <details
                    className="ids-details"
                    // Rows, columns or notes added or taken away aren't in
                    // the value-by-value list: the whole version shows them.
                    open={
                      (kind === "structured_table" &&
                        !cellChanges(
                          saved as StructuredTable,
                          proposed as StructuredTable,
                        ).length) ||
                      undefined
                    }
                  >
                    <summary>The whole proposed version</summary>
                    <ReadOnly
                      body={proposed}
                      added={rows?.added}
                      authors={proposedNoteAuthors(
                        saved,
                        proposed,
                        savedNoteAuthors,
                      )}
                    />
                  </details>
                </div>
              );
            };
            return (
              <>
                {first ? compare(first) : null}
                {rest.length ? (
                  <details className="ids-details">
                    <summary>
                      {plural(rest.length, "other proposal")} to compare
                    </summary>
                    <div className="stack">{rest.map(compare)}</div>
                  </details>
                ) : null}
              </>
            );
          })()}
        </section>
      ) : null}
      {tabbed && mode === "result" ? (
        <section
          className="work-result"
          role="tabpanel"
          id="work-panel-result"
          aria-labelledby="work-tab-result"
        >
          {edited &&
          !pendingProposals.some(
            (p) => p.base_revision_id === artifact.current_revision_id,
          ) ? (
            <p className="notice-line small" data-testid="maybe-stale">
              You changed {plural(edited.cells.size, "value")} since Workagent’s
              last version. Anything it worked out from them, such as totals or
              notes, hasn’t been recalculated.
              {onAskForChange && open ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="link-quiet"
                    data-testid="ask-recheck"
                    onClick={() => onAskForChange(RECHECK)}
                  >
                    Ask Workagent to recheck
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          <ReadOnly
            body={saved}
            authors={savedNoteAuthors}
            edited={edited?.cells}
          />
          {dirty ? (
            <p className="small unsaved-note" role="status">
              Your edits aren’t saved yet.{" "}
              <button
                type="button"
                className="link-quiet"
                onClick={() => show("edit")}
              >
                Continue editing
              </button>
            </p>
          ) : null}
        </section>
      ) : null}
      {editing ? (
        <WorkingCopy
          view={kind === "custom_view"}
          dirty={dirty}
          tabbed={tabbed}
        >
          <fieldset disabled={locked} className="stack">
            {kind === "structured_table" ? (
              <TableEditor
                saved={saved as StructuredTable}
                body={draft.body as StructuredTable}
                raw={draft.raw ?? {}}
                update={(body, raw) => keep({ ...draft, body, raw })}
                updateNotes={(notes) =>
                  keep({
                    ...draft,
                    body: { ...(draft.body as StructuredTable), notes },
                  })
                }
              />
            ) : kind === "document" ? (
              <DocEdit
                addable
                blocks={viewBlocks(
                  (draft.body as DocumentBody).blocks,
                  draftNoteAuthors,
                )}
                disabled={locked}
                onChange={(blocks) =>
                  keep({
                    ...draft,
                    body: savedBody((draft.body as DocumentBody).title, blocks),
                  })
                }
              />
            ) : (
              <label className="field">
                <span className="field-label">Readable version</span>
                <textarea
                  aria-label="Readable version"
                  rows={5}
                  value={(draft.body as CustomView).fallback}
                  onChange={(e) =>
                    keep({
                      ...draft,
                      body: {
                        ...(draft.body as CustomView),
                        fallback: e.target.value,
                      },
                    })
                  }
                />
                <span className="hint">
                  Shown if the view can’t run, and to anyone who prefers text.
                </span>
              </label>
            )}
          </fieldset>
          {problem && dirty ? (
            <p role="alert" className="small" data-testid="draft-problem">
              {problem}
            </p>
          ) : null}
          <div
            className={`row product-actions${dirty ? " unsaved-bar" : ""}`}
            data-testid={dirty ? "unsaved-bar" : undefined}
          >
            {dirty ? (
              // Kept in view while anything is unsaved, however long the work.
              <span className="small unsaved-note" role="status">
                Your changes are not saved yet.
              </span>
            ) : null}
            {dirty ? (
              <button
                className="btn btn-primary"
                disabled={locked || Boolean(problem)}
                aria-keyshortcuts="Control+S Meta+S"
                title="Save my edits (Ctrl+S or ⌘S)"
                onClick={() =>
                  void submit({
                    kind: "save",
                    id: crypto.randomUUID(),
                    base: draft.base,
                    body: structuredClone(draft.body),
                  })
                }
              >
                Save my edits
              </button>
            ) : null}
            {dirty || changed ? (
              <button
                className="btn btn-quiet"
                disabled={locked}
                onClick={() => keep(fresh(artifact))}
              >
                Discard my changes
              </button>
            ) : null}
          </div>
          <p className="hint">
            {dirty
              ? "Save to keep your changes. Saving doesn’t change anything else."
              : open
                ? "Ask in the conversation to change or extend this."
                : "This conversation has ended."}
          </p>
        </WorkingCopy>
      ) : null}
      {draft.pending ? (
        <button
          className="btn btn-primary"
          disabled={busy || stale}
          onClick={() => void submit(draft.pending!)}
        >
          Retry same {draft.pending.kind}
        </button>
      ) : null}

      <details className="disclosure" data-testid="how-prepared">
        <summary>How this was prepared</summary>
        <div className="disclosure-body stack">
          {kind === "structured_table" ? (
            <p className="small result-headline">
              {plural((saved as StructuredTable).rows.length, "row")} ·{" "}
              {plural((saved as StructuredTable).fields.length, "column")}
            </p>
          ) : null}
          {kind === "custom_view" ? null : (
            <p className="small" data-testid="product-verification">
              {byWorkagent
                ? "Draft made by Workagent. Its shape was checked; what it says hasn’t been verified."
                : "Saved by you. Nothing checks this automatically."}
            </p>
          )}
          {observations.length ? (
            <details className="ids-details">
              <summary>How this was checked</summary>
              <div className="stack">
                {observations.map((read) => (
                  <ObservedOutput
                    key={read.observation.id}
                    artifact={artifact}
                    read={read}
                    stale={stale}
                  />
                ))}
              </div>
            </details>
          ) : null}
          <details className="ids-details">
            <summary>Saved history</summary>
            <div className="stack">
              {history.map((r) => (
                <details key={r.id} className="ids-details">
                  <summary>
                    Version {r.revision_number} · {versionAuthor(r, proposals)}
                    {r.id === artifact.current_revision_id ? " · current" : ""}
                  </summary>
                  {isFlexible(r.body) ? (
                    <ReadOnly body={r.body} authors={noteAuthors(r, history)} />
                  ) : null}
                  <p className="ids">
                    {r.id} · {r.body_hash}
                  </p>
                </details>
              ))}
            </div>
          </details>
        </div>
      </details>
    </div>
  );
}

type WorkMode = "result" | "edit" | "changes";

/**
 * Result, Edit and (while something is proposed) Changes: the work as it
 * reads, the place to change it, and the full comparison.
 */
function WorkTabs({
  mode,
  show,
  dirty,
  changes,
}: {
  mode: WorkMode;
  show: (m: WorkMode) => void;
  dirty: boolean;
  changes: number;
}) {
  const tabs: { key: WorkMode; label: string }[] = [
    { key: "result", label: "Result" },
    { key: "edit", label: "Edit" },
    ...(changes
      ? [{ key: "changes" as const, label: `Changes · ${changes}` }]
      : []),
  ];
  return (
    <div
      className="tabs work-tabs"
      role="tablist"
      aria-label="Show"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const at = tabs.findIndex((t) => t.key === mode);
        const step = e.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(at + step + tabs.length) % tabs.length]!.key;
        show(next);
        document.getElementById(`work-tab-${next}`)?.focus();
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`work-tab-${t.key}`}
          className="tab"
          aria-selected={mode === t.key}
          aria-controls={`work-panel-${t.key}`}
          tabIndex={mode === t.key ? 0 : -1}
          onClick={() => show(t.key)}
        >
          {t.label}
          {t.key === "edit" && dirty ? (
            <span
              className="tab-dot"
              title="Not saved yet"
              aria-hidden="true"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Where people edit. A view's only editable part is its readable version,
 * so for a view that sits behind one disclosure (open while unsaved).
 */
function WorkingCopy({
  view,
  dirty,
  tabbed = false,
  children,
}: {
  view: boolean;
  dirty: boolean;
  /** Shown as the Edit tab's panel. */
  tabbed?: boolean;
  children: React.ReactNode;
}) {
  const body = tabbed ? (
    <section
      className="stack product-work"
      role="tabpanel"
      id="work-panel-edit"
      aria-labelledby="work-tab-edit"
    >
      {children}
    </section>
  ) : (
    <section className="stack product-work" aria-label="Your working copy">
      {children}
    </section>
  );
  if (!view) return body;
  return (
    <details className="disclosure" open={dirty || undefined}>
      <summary>Edit the readable version</summary>
      <div className="disclosure-body">{body}</div>
    </details>
  );
}

/**
 * A proposed view, part by part against the saved one. Code and data
 * sources are shown as text, never run, so what would change is visible
 * before anyone applies it.
 */
function ViewProposal({
  saved,
  proposed,
  bound,
}: {
  saved: CustomView;
  proposed: CustomView;
  bound: Bound;
}) {
  const c = viewChanges(saved, proposed);
  const reads = (v: CustomView) =>
    (v.bindings ?? []).map(
      (b) =>
        `${b.name}: ${bound[b.artifact_id]?.title ?? `saved work ${b.artifact_id}`} · version ${b.revision_id}`,
    );
  const asks = (v: CustomView) =>
    (v.actions ?? []).map((a) => `${a.name}: reads ${a.binding}`);
  const pair = (label: string, before: string[], after: string[]) => (
    <div className="stack-sm view-compare" key={label}>
      <h3 className="small">{label}</h3>
      <div className="view-compare-cols">
        <div>
          <p className="small muted">Saved</p>
          <pre className="product-code">{before.join("\n") || "—"}</pre>
        </div>
        <div>
          <p className="small muted">Proposed</p>
          <pre className="product-code">{after.join("\n") || "—"}</pre>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <p className="decision-question" data-testid="proposal-changes">
        {viewChangeSummary(c)}
      </p>
      <details className="ids-details" data-testid="view-compare">
        <summary>Compare with your saved view</summary>
        <div className="stack">
          {c.bindings
            ? pair("What it reads", reads(saved), reads(proposed))
            : null}
          {c.actions
            ? pair("What it can ask for", asks(saved), asks(proposed))
            : null}
          {c.code.map((k) =>
            pair(
              `Code (${k.toUpperCase()})`,
              [saved.source[k] ?? ""],
              [proposed.source[k] ?? ""],
            ),
          )}
          {c.fallback
            ? pair("Readable version", [saved.fallback], [proposed.fallback])
            : null}
          {c.title ? pair("Title", [saved.title], [proposed.title]) : null}
          {!c.bindings &&
          !c.actions &&
          !c.code.length &&
          !c.fallback &&
          !c.title ? (
            <p className="small">
              The proposed view is the same as your saved one.
            </p>
          ) : null}
          <p className="hint">
            Shown as text only. The proposed view runs only after you apply it.
          </p>
        </div>
      </details>
    </>
  );
}

/** Any version, read-only. A view reads as its readable version here. */
/**
 * An agent-made view running beside the rest of a project's work. It reads
 * only its exact bindings through the service, as on its own page; anything
 * that would save (pointing it at newer versions) stays there.
 */
export function InPlaceView({
  ws,
  cid,
  artifact,
  bound,
  open,
  refresh,
}: {
  ws: string;
  cid: string;
  artifact: S["Artifact"];
  bound: Bound;
  open: boolean;
  refresh: () => Promise<unknown>;
}) {
  return (
    <ViewSurface
      inPlace
      ws={ws}
      cid={cid}
      artifact={artifact}
      view={artifact.current_revision.body as CustomView}
      bound={bound}
      open={open}
      stale={false}
      refresh={refresh}
      canRebind={false}
      rebindNow={() => {}}
    />
  );
}

const draftKey = (ws: string, cid: string, aid: string) =>
  `workagent:product:${ws}:${cid}:${aid}`;
const rebindKey = (ws: string, cid: string, aid: string) =>
  `workagent:view-rebind:${ws}:${cid}:${aid}`;
type Exact = { id: string; base: string; body: FlexibleBody };
const unconfirmed = (e: unknown) =>
  (e instanceof ApiError && e.isAmbiguousWrite) || e instanceof TypeError;
function store(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function stored<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Beside a view running in place: the saved tables it reads, changed through
 * the app's own table editor, never through the view. "Save and update the
 * view" saves the table (a person's version, checked against the version it
 * was based on) and then points the view at it, so the view reads the new
 * values; each step is replayed exactly if its answer is lost. Drafts are the
 * same ones the work's own page keeps.
 */
export function ViewInputs({
  ws,
  cid,
  view,
  tables,
  bound,
  open,
  refresh,
}: {
  ws: string;
  cid: string;
  /** The view, as last read. */
  view: S["Artifact"];
  /** What it reads, at the versions saved now. */
  bound: Bound;
  /** The structured tables it reads, as last read, that have editable values. */
  tables: S["Artifact"][];
  open: boolean;
  refresh: () => Promise<unknown>;
}) {
  const vKey = rebindKey(ws, cid, view.id);
  const [rebinding, setRebinding] = useState<Exact | null>(() =>
    stored<Exact>(vKey),
  );
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{
    tone: "done" | "problem";
    text: string;
  } | null>(null);
  const viewBody = view.current_revision.body as CustomView;
  const pinned = pinsVersions(viewBody);
  useLeaveGuard(Boolean(rebinding));
  const states = bindingStates(viewBody, bound);
  const behind = states.some((x) => x.state === "changed");
  const missing = states.some((x) => x.state === "unavailable");

  /** Point the view at a newly saved table; replayed exactly if unconfirmed. */
  async function rebindView(
    exact: Exact,
    done = "The view now reads the latest saved versions.",
  ) {
    store(vKey, exact);
    setRebinding(exact);
    try {
      await productApi.save(ws, view.id, exact.id, exact.base, exact.body);
      store(vKey, null);
      setRebinding(null);
      setOutcome({ tone: "done", text: done });
    } catch (e) {
      if (!unconfirmed(e)) {
        store(vKey, null);
        setRebinding(null);
      }
      setOutcome({
        tone: "problem",
        text: unconfirmed(e)
          ? "Your change is saved. Updating the view wasn’t confirmed; try again, and the same update is sent."
          : `Your change is saved, but the view couldn’t be updated${
              e instanceof Error && e.message ? `: ${e.message}` : "."
            } Open the view to point it at the latest saved versions.`,
      });
    }
  }

  async function saved(table: S["Artifact"]) {
    if (pinned) {
      setOutcome({
        tone: "done",
        text: "Saved. This view was written for the earlier version, so it can’t read the new one; ask in the conversation for an updated view.",
      });
      return;
    }
    await rebindView(
      {
        id: crypto.randomUUID(),
        base: view.current_revision_id,
        body: rebind(viewBody, {
          [table.id]: {
            revision_id: table.current_revision_id,
            body_hash: table.current_revision.body_hash,
          },
        }),
      },
      "Saved. The view now reads your change.",
    );
  }

  if (!tables.length && !(behind && !pinned && !missing && !rebinding))
    return null;
  return (
    <section
      className="stack-sm view-inputs"
      aria-label="Change what this view reads"
      data-testid="view-inputs"
    >
      {pinned ? (
        <p className="small muted" data-testid="view-inputs-pinned">
          This view was written for the versions it reads now, so a change saved
          here won’t show in it until you ask for an updated view.
        </p>
      ) : null}
      {tables.map((t) => (
        <ViewInput
          key={t.id}
          ws={ws}
          cid={cid}
          table={t}
          open={open}
          busy={busy || Boolean(rebinding)}
          setBusy={setBusy}
          onStart={() => setOutcome(null)}
          onSaved={saved}
          onProblem={(text) => setOutcome({ tone: "problem", text })}
          refresh={refresh}
          label={pinned ? "Save my change" : "Save and update the view"}
        />
      ))}
      {behind && !pinned && !missing && !rebinding ? (
        <div className="row wrap">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !open}
            onClick={async () => {
              setBusy(true);
              setOutcome(null);
              await rebindView({
                id: crypto.randomUUID(),
                base: view.current_revision_id,
                body: rebind(viewBody, bound),
              });
              await refresh();
              setBusy(false);
            }}
          >
            Use the latest saved versions
          </button>
        </div>
      ) : null}
      {rebinding ? (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setOutcome(null);
            await rebindView(rebinding);
            await refresh();
            setBusy(false);
          }}
        >
          Update the view again
        </button>
      ) : null}
      {outcome ? (
        <p
          role={outcome.tone === "problem" ? "alert" : "status"}
          className="notice-line small"
          data-testid="view-inputs-outcome"
        >
          {outcome.text}
        </p>
      ) : null}
    </section>
  );
}

function ViewInput({
  ws,
  cid,
  table,
  open,
  busy,
  setBusy,
  onStart,
  onSaved,
  onProblem,
  refresh,
  label,
}: {
  ws: string;
  cid: string;
  table: S["Artifact"];
  label: string;
  open: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onStart: () => void;
  onSaved: (table: S["Artifact"]) => Promise<void>;
  onProblem: (text: string) => void;
  refresh: () => Promise<unknown>;
}) {
  const key = draftKey(ws, cid, table.id);
  const saved = table.current_revision.body as StructuredTable;
  const [draft, setDraft] = useState<Draft>(() => readDraft(key, table));
  const problem = draftProblem(draft);
  const dirty =
    Boolean(draft.raw && Object.keys(draft.raw).length && problem) ||
    JSON.stringify(normal(draft.body)) !== JSON.stringify(normal(saved));
  const changed = draft.base !== table.current_revision_id;
  useLeaveGuard(dirty || Boolean(draft.pending));
  function keep(next: Draft) {
    setDraft(next);
    store(key, next);
  }
  const fresh = (a: S["Artifact"]): Draft => ({
    base: a.current_revision_id,
    body: structuredClone(a.current_revision.body as FlexibleBody),
    pending: null,
  });
  // The values as saved at the draft's base, when known: a draft the person
  // hasn't touched follows a newer saved version instead of standing in for it.
  const [untouched, setUntouched] = useState<string | null>(() =>
    draft.base === table.current_revision_id
      ? JSON.stringify(normal(saved))
      : null,
  );
  useEffect(() => {
    if (draft.base === table.current_revision_id || draft.pending) return;
    if (
      untouched !== null &&
      !Object.keys(draft.raw ?? {}).length &&
      JSON.stringify(normal(draft.body)) === untouched
    ) {
      keep(fresh(table));
      setUntouched(JSON.stringify(normal(saved)));
    }
    // Only a newly read version can make an untouched draft out of date.
  }, [table.current_revision_id]);
  async function save() {
    if (busy || (!draft.pending && problem)) return;
    const exact =
      draft.pending?.kind === "save"
        ? draft.pending
        : {
            kind: "save" as const,
            id: crypto.randomUUID(),
            base: draft.base,
            body: structuredClone(draft.body),
          };
    keep({ ...draft, pending: exact });
    setBusy(true);
    onStart();
    try {
      const next = await productApi.save(
        ws,
        table.id,
        exact.id,
        exact.base,
        exact.body,
      );
      keep(fresh(next));
      setUntouched(
        JSON.stringify(normal(next.current_revision.body as FlexibleBody)),
      );
      await onSaved(next);
    } catch (e) {
      if (!unconfirmed(e)) keep({ ...draft, pending: null });
      onProblem(
        unconfirmed(e)
          ? "Saving wasn’t confirmed. Your change is kept; try again, and the same save is sent."
          : e instanceof ApiError && e.status === 409
            ? "This was changed elsewhere since you started. Your change is kept; discard it to see the new values."
            : `Couldn’t save${e instanceof Error && e.message ? `: ${e.message}` : "."} Your change is kept.`,
      );
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  const title = readableTitle(saved.title);
  // A few values are shown ready to change; a bigger table opens on request,
  // or is open while it holds a change.
  const cells =
    saved.rows.length * saved.fields.filter((f) => f.editable).length;
  const [openNow, setOpenNow] = useState(
    () => cells <= 4 || dirty || Boolean(draft.pending),
  );
  return (
    <details
      className="stack-sm view-input"
      data-artifact={table.id}
      open={openNow || dirty || Boolean(draft.pending)}
      onToggle={(e) => setOpenNow(e.currentTarget.open)}
    >
      <summary className="small">
        <strong>Change {title}</strong>
      </summary>
      {changed ? (
        <p role="status" className="small muted">
          {title} was saved again since you started; your change is kept.
        </p>
      ) : null}
      <fieldset
        disabled={busy || !open || Boolean(draft.pending)}
        className="stack-sm"
      >
        <legend className="sr-only">Change {title}</legend>
        <TableEditor
          valuesOnly
          saved={saved}
          body={draft.body as StructuredTable}
          raw={draft.raw ?? {}}
          update={(body, raw) => keep({ ...draft, body, raw })}
          updateNotes={() => {}}
        />
      </fieldset>
      {problem && dirty ? (
        <p role="alert" className="small">
          {problem}
        </p>
      ) : null}
      <div className="row wrap">
        {draft.pending && draft.pending.kind !== "save" ? (
          <p className="small muted">
            A change on this work’s own page is waiting to be confirmed; open it
            there to finish.
          </p>
        ) : draft.pending ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy || !open}
            onClick={() => void save()}
          >
            Try saving again
          </button>
        ) : dirty ? (
          <>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy || !open || Boolean(problem)}
              onClick={() => void save()}
            >
              {label}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              disabled={busy}
              onClick={() => keep(fresh(table))}
            >
              Discard my change
            </button>
          </>
        ) : changed ? (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => keep(fresh(table))}
          >
            Show the saved values
          </button>
        ) : null}
      </div>
    </details>
  );
}

/**
 * Each value a proposed table would change, saved value to proposed one; a
 * value the person set themselves is marked, and said first.
 */
export function TableProposalCells({
  saved,
  proposed,
  authors,
}: {
  saved: StructuredTable;
  proposed: StructuredTable;
  authors: Record<string, "human" | "worker">;
}) {
  const changes = cellChanges(saved, proposed);
  // Notes the proposal leaves out are changes too, said in full.
  const kept = new Set(proposed.notes ?? []);
  const lostNotes = (saved.notes ?? []).filter((n) => !kept.has(n));
  const notesLine = lostNotes.length ? (
    <div className="small" data-testid="proposal-removed-notes">
      <p>
        It removes {plural(lostNotes.length, "note")} from the saved version:
      </p>
      <ul className="proposal-removed">
        {lostNotes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  ) : null;
  if (!changes.length) return notesLine;
  const yours = (c: CellChange) => authors[cellAt(c.rowId, c.key)] === "human";
  const theirs = changes.filter(yours);
  const shown = [...theirs, ...changes.filter((c) => !yours(c))].slice(0, 12);
  if (changes.length === 1) {
    // One value: the saved and proposed values side by side.
    const c = changes[0]!;
    return (
      <div className="stack-sm" data-testid="saved-proposed">
        <p className="small">
          {c.row} · {c.field}
          {yours(c) ? <span className="muted"> (your value)</span> : null}
        </p>
        <div className="saved-proposed">
          <p className="sp-saved">
            <span className="small muted">Saved</span>{" "}
            <strong>{c.before}</strong>
          </p>
          <span aria-hidden="true">→</span>
          <p className="sp-proposed">
            <span className="small muted">Proposed</span>{" "}
            <strong>{c.after}</strong>
          </p>
        </div>
        {yours(c) ? (
          <p className="small" data-testid="proposal-replaces-yours">
            It changes a value you set yourself. Applying it replaces it.
          </p>
        ) : null}
        {notesLine}
      </div>
    );
  }
  return (
    <div className="stack-sm">
      {theirs.length ? (
        <p className="small" data-testid="proposal-replaces-yours">
          {theirs.length === 1
            ? "It changes a value you set yourself."
            : `It changes ${theirs.length} values you set yourself.`}{" "}
          Applying it replaces {theirs.length === 1 ? "it" : "them"}.
        </p>
      ) : null}
      <ul className="small proposal-cells" data-testid="proposal-cell-changes">
        {shown.map((c) => (
          <li key={cellAt(c.rowId, c.key)} data-yours={yours(c) || undefined}>
            {c.row} · {c.field}: {c.before} → <strong>{c.after}</strong>
            {yours(c) ? <span className="muted"> (your value)</span> : null}
          </li>
        ))}
      </ul>
      {changes.length > shown.length ? (
        <p className="small muted">…and {changes.length - shown.length} more</p>
      ) : null}
      {notesLine}
    </div>
  );
}

/**
 * What a proposed version of a document would change in the saved one,
 * exactly: what it adds and what it takes out, beside each other. When the
 * saved version is the person's own, it says that applying it replaces it.
 */
/**
 * A proposed document against the saved one: a one-line summary (and when it
 * replaces the person's own edit) for the decision, and the full comparison
 * for whoever wants it, kept apart so the decision stays near the top.
 */
const SHOWN_ITEMS = 4;
const clip = (t: string, n = 90) =>
  t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;

/** One change, in plain words, quoting what the proposal says. */
function changeLine(it: ChangeItem): string {
  switch (it.kind) {
    case "added":
      return `Adds “${clip(it.text)}”`;
    case "removed":
      return `Takes out “${clip(it.text)}”`;
    case "rewritten":
      return `Rewrites a part as “${clip(it.text)}”`;
    case "checked":
      return `Marks “${clip(it.text)}” done`;
    case "unchecked":
      return `Marks “${clip(it.text)}” not done`;
  }
}

function documentProposalParts(
  saved: DocumentBody,
  proposed: DocumentBody,
  savedAuthors: NoteAuthors,
  yours: boolean,
): { summary: React.ReactNode; diff: React.ReactNode | null } {
  const ops = diffBlocks(
    viewBlocks(saved.blocks, savedAuthors),
    viewBlocks(
      proposed.blocks,
      proposedNoteAuthors(saved, proposed, savedAuthors),
    ),
  );
  const { added, removed } = countChanges(ops);
  const titleChanged = saved.title !== proposed.title;
  if (!added && !removed && !titleChanged)
    return {
      summary: (
        <p className="small muted" data-testid="proposal-changes">
          It reads the same as your saved version.
        </p>
      ),
      diff: null,
    };
  const parts = (n: number) => `${n} part${n === 1 ? "" : "s"}`;
  const items = changeItems(ops);
  const notes = yourNotes(saved.blocks, proposed.blocks, savedAuthors);
  return {
    summary: (
      <div className="stack-sm" data-testid="proposal-doc-changes">
        <p className="decision-question" data-testid="proposal-changes">
          {[
            titleChanged ? `renames it “${readableTitle(proposed.title)}”` : "",
            added ? `adds or rewrites ${parts(added)}` : "",
            removed ? `takes out or replaces ${parts(removed)}` : "",
          ]
            .filter(Boolean)
            .join("; ")
            .replace(/^./, (c) => c.toUpperCase())}
          .
        </p>
        {items.length ? (
          <ul className="proposal-items" data-testid="proposal-items">
            {items.slice(0, SHOWN_ITEMS).map((it, i) => (
              <li key={i} data-kind={it.kind}>
                {changeLine(it)}
              </li>
            ))}
          </ul>
        ) : null}
        {items.length > SHOWN_ITEMS ? (
          <p className="small muted">
            {items.length - SHOWN_ITEMS === 1
              ? "1 more change"
              : `${items.length - SHOWN_ITEMS} more changes`}{" "}
            in the full comparison.
          </p>
        ) : null}
        {notes.total ? (
          <p className="small" data-testid="proposal-your-notes">
            {notes.kept === notes.total
              ? notes.total === 1
                ? "Your note is kept as you wrote it."
                : "Your notes are kept as you wrote them."
              : `Applying this changes ${notes.total - notes.kept} of your notes.`}
          </p>
        ) : null}
        {yours && removed ? (
          <p className="small" data-testid="proposal-replaces-yours">
            Your saved version is your own edit. Applying this replaces the
            parts marked as only in your version.
          </p>
        ) : null}
      </div>
    ),
    diff:
      added || removed ? (
        <DocDiff
          ops={ops}
          labels={{
            added: "Only in the proposal",
            removed: "Only in your saved version",
            tone: "compare",
          }}
        />
      ) : null,
  };
}

/**
 * In a proposed version, a kept note as saved keeps who added it; a new or
 * reworded one is the proposer's (Workagent's).
 */
function proposedNoteAuthors(
  saved: FlexibleBody,
  proposed: FlexibleBody,
  savedAuthors: NoteAuthors,
): NoteAuthors | undefined {
  if (flexibleKind(proposed) !== "document") return undefined;
  const before = new Map(
    flexibleKind(saved) === "document"
      ? (saved as DocumentBody).blocks.map((b) => [b.block_id, b.text])
      : [],
  );
  const out: NoteAuthors = {};
  for (const b of (proposed as DocumentBody).blocks) {
    if (b.kind !== "protected_note") continue;
    if (before.get(b.block_id) !== b.text) out[b.block_id] = "worker";
    else if (savedAuthors[b.block_id])
      out[b.block_id] = savedAuthors[b.block_id]!;
  }
  return out;
}

/** What "Ask Workagent to recheck" puts in the reply box; nothing is sent. */
const RECHECK =
  "I changed some values in this table. Please recheck anything worked out from them and propose corrections.";

export function ReadOnly({
  body,
  authors,
  edited,
  added,
}: {
  body: FlexibleBody;
  /** Who added each kept note, where known. */
  authors?: NoteAuthors;
  /** Table cells the person changed since Workagent's latest version. */
  edited?: Set<string>;
  /** Rows a proposed table adds to the saved one, marked as new. */
  added?: Set<string>;
}) {
  const kind = flexibleKind(body);
  if (kind === "structured_table")
    return (
      <TableRead body={body as StructuredTable} edited={edited} added={added} />
    );
  if (kind === "document")
    return (
      <DocRead blocks={viewBlocks((body as DocumentBody).blocks, authors)} />
    );
  return <p className="view-fallback">{(body as CustomView).fallback}</p>;
}

function TableRead({
  body,
  edited,
  added,
}: {
  body: StructuredTable;
  edited?: Set<string>;
  added?: Set<string>;
}) {
  const longText = longTextFields(body);
  const nameKey = rowNameField(body)?.key;
  // "New" goes on the row's name, or its first cell: a word, not a colour.
  const labelKey = nameKey ?? body.fields[0]?.key;
  return (
    <>
      <UnitLegend fields={body.fields} />
      <div
        className="product-scroll flex-table"
        tabIndex={0}
        role="region"
        aria-label={body.title}
      >
        <table className={tableClass(longText, body.fields.length)}>
          <thead>
            <tr>
              {body.fields.map((f) => (
                <th
                  key={f.key}
                  scope="col"
                  data-type={f.type}
                  data-long={longText.has(f.key) ? "true" : undefined}
                >
                  {fieldHeading(f)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.rows.map((r) => (
              <tr
                key={r.row_id}
                data-added={added?.has(r.row_id) ? "true" : undefined}
              >
                {body.fields.map((f) => (
                  <td
                    key={f.key}
                    data-type={f.type}
                    data-label={cardLabel(f)}
                    data-name={f.key === nameKey ? "true" : undefined}
                    data-long={longText.has(f.key) ? "true" : undefined}
                    data-edited={
                      edited?.has(cellAt(r.row_id, f.key)) ? "true" : undefined
                    }
                  >
                    {added?.has(r.row_id) && f.key === labelKey ? (
                      <>
                        <span className="row-new" data-testid="row-new">
                          New
                        </span>
                        <span className="sr-only">: </span>
                      </>
                    ) : null}
                    {formatCell(f, cellValue(r, f.key))}
                    {edited?.has(cellAt(r.row_id, f.key)) ? (
                      <span className="sr-only"> (changed by you)</span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {body.notes?.length ? <TableNotes notes={body.notes} /> : null}
      </div>
    </>
  );
}

/**
 * On a phone, the long units a table's row cards leave out of their labels,
 * said once above the cards. Wider screens carry them in the column
 * headings, so this shows only on a phone. `id` names each unit for the
 * boxes measured in it.
 */
function UnitLegend({
  fields,
  id,
}: {
  fields: StructuredTable["fields"];
  id?: string;
}) {
  const legend = unitLegend(fields);
  const units = id ? fields.filter((f) => f.unit?.trim()) : [];
  if (!legend.length && !units.length) return null;
  return (
    <>
      {legend.length ? (
        <p className="small unit-legend" data-testid="unit-legend">
          {legend.map((u, i) => (
            <span key={u.unit}>
              {i ? " · " : ""}
              {u.labels.join(", ")}: {u.unit}
            </span>
          ))}
        </p>
      ) : null}
      {units.map((f) => (
        <span key={f.key} id={`${id}-unit-${fieldIndex(fields, f)}`} hidden>
          In {f.unit!.trim()}
        </span>
      ))}
    </>
  );
}
const fieldIndex = (
  fields: StructuredTable["fields"],
  f: StructuredTable["fields"][number],
) => fields.findIndex((x) => x.key === f.key);

/** A table's notes: the first few, and the rest a step away. */
function TableNotes({ notes }: { notes: string[] }) {
  const SHOWN = 3;
  return (
    <div className="table-notes-wrap">
      <ul className="small table-notes">
        {notes.slice(0, SHOWN).map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      {notes.length > SHOWN ? (
        <details className="ids-details table-notes-more">
          <summary>
            {notes.length - SHOWN === 1
              ? "One more note"
              : `${notes.length - SHOWN} more notes`}
          </summary>
          <ul className="small table-notes">
            {notes.slice(SHOWN).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Whether a table's long fields go on their own line under each row. */
const splitLong = (long: Set<string>, columns: number) =>
  long.size > 0 && columns >= 4;

/** A table's layout class: long text takes the room; many columns share it. */
const tableClass = (long: Set<string>, columns: number) =>
  long.size ? (columns >= 4 ? "has-long many" : "has-long") : undefined;

/**
 * Whether a scrolling region is wider inside than it shows, re-measured as
 * it or its content resizes. While it is, some columns are out of view.
 */
function useOverflows(
  ref: React.RefObject<HTMLElement | null>,
  content: unknown,
): boolean {
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOver(el.scrollWidth > el.clientWidth + 1);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    if (el.firstElementChild) seen.observe(el.firstElementChild);
    return () => seen.disconnect();
  }, [ref, content]);
  return over;
}

/**
 * A long text value, edited where it can be read whole. It stays one value;
 * Enter doesn't start a new line.
 */
function LongTextCell({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (text: string) => void;
  "aria-label": string;
  "aria-invalid"?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useFitHeight(ref, value);
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      value={value}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
    />
  );
}

/**
 * Edit a table by its declared fields: each cell gets the input its type
 * calls for, read-only cells stay as text, and a value the service would
 * refuse is kept as typed and marked, never saved.
 */
function TableEditor({
  saved,
  body,
  raw,
  update,
  updateNotes,
  valuesOnly = false,
}: {
  saved: StructuredTable;
  body: StructuredTable;
  raw: Record<string, RawCell>;
  update: (body: StructuredTable, raw: Record<string, RawCell>) => void;
  updateNotes: (notes: string[]) => void;
  /** Only the values can change here: no rows added or removed, no notes. */
  valuesOnly?: boolean;
}) {
  const savedRows = new Set(saved.rows.map((r) => r.row_id));
  const readOnly = body.fields.some((f) => !f.editable);
  const errors = Object.entries(raw).filter(([, c]) => c.error);
  const longText = longTextFields(saved);
  const nameKey = rowNameField(body)?.key;
  const unitsId = useId();
  const regionRef = useRef<HTMLDivElement>(null);
  // The last row removed, so one click puts it back where it was, with what
  // the person had typed in it.
  const [removedRow, setRemovedRow] = useState<{
    row: S["TableRow"];
    at: number;
    name: string;
    typed: typeof raw;
  } | null>(null);
  const restorable =
    removedRow && !body.rows.some((r) => r.row_id === removedRow.row.row_id)
      ? removedRow
      : null;
  const undoRemove = () => {
    if (!restorable) return;
    const at = Math.min(restorable.at, body.rows.length);
    update(
      {
        ...body,
        rows: [
          ...body.rows.slice(0, at),
          restorable.row,
          ...body.rows.slice(at),
        ],
      },
      { ...raw, ...restorable.typed },
    );
    setRemovedRow(null);
    setFocusRow(at);
  };
  // After a row is removed the cursor goes to the row that takes its place
  // (or the one before), else to Add a row; never to the top of the page.
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const addRowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusRow === null) return;
    const rows = regionRef.current?.querySelectorAll<HTMLElement>(
      "tbody > tr:not(.long-row)",
    );
    const tr = rows?.[Math.min(focusRow, rows.length - 1)];
    const target =
      tr?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      ) ?? addRowRef.current;
    target?.focus();
    setFocusRow(null);
  }, [focusRow, body]);
  const overflows = useOverflows(regionRef, body);
  function edit(rowId: string, key: string, text: string) {
    const field = body.fields.find((f) => f.key === key)!;
    const parsed = parseCell(field, text);
    const k = cellKey(rowId, key);
    if ("error" in parsed)
      update(body, { ...raw, [k]: { text, error: parsed.error } });
    else
      update(setCell(body, rowId, key, parsed.value), {
        ...raw,
        [k]: { text },
      });
  } // With many columns, a long field goes on its own full-width line under
  // its row: every column fits and the long text reads whole.
  const below = splitLong(longText, body.fields.length)
    ? body.fields.filter((f) => longText.has(f.key))
    : [];
  const inline = body.fields.filter((f) => !below.includes(f));
  const columnSize = (key: string) =>
    Math.min(
      32,
      Math.max(
        10,
        ...body.rows.map((r) => {
          const typed = raw[cellKey(r.row_id, key)]?.text;
          return (typed ?? cellInput(cellValue(r, key))).length + 2;
        }),
      ),
    );
  /** One editable cell of a row; `wide` spans a long field under the row. */
  function cellFor(
    r: S["TableRow"],
    i: number,
    name: string,
    f: StructuredTable["fields"][number],
    wide?: number,
  ) {
    const value = cellValue(r, f.key);
    const k = cellKey(r.row_id, f.key);
    const typed = raw[k];
    // The cell that names its row is labelled by position:
    // its own text would rename it while the person types.
    const label =
      f.key === nameKey ? `Row ${i + 1} ${f.label}` : `${name} ${f.label}`;
    const locked = !f.editable && savedRows.has(r.row_id);
    const inputProps = {
      "aria-label": label,
      // The unit, which a phone's card label may leave to the line above.
      "aria-describedby": f.unit?.trim()
        ? `${unitsId}-unit-${fieldIndex(body.fields, f)}`
        : undefined,
      "aria-invalid": typed?.error ? true : undefined,
      value: typed?.text ?? cellInput(value),
    };
    return (
      <td
        key={f.key}
        data-type={f.type}
        data-label={cardLabel(f)}
        data-name={f.key === nameKey ? "true" : undefined}
        data-wide={
          f.type === "text" && columnSize(f.key) > 14 ? "true" : undefined
        }
        data-derived={f.editable ? undefined : "true"}
        data-long={longText.has(f.key) ? "true" : undefined}
        colSpan={wide}
      >
        {wide ? (
          // Under its row there's no column heading: name it here. An
          // editable box already carries the name; a read-only value doesn't.
          <span className="long-label" aria-hidden={locked ? undefined : true}>
            {fieldHeading(f)}
          </span>
        ) : null}
        {locked ? (
          formatCell(f, value)
        ) : f.type === "boolean" || f.type === "enum" ? (
          <select
            aria-label={label}
            value={cellInput(value)}
            onChange={(e) => edit(r.row_id, f.key, e.target.value)}
          >
            <option value="">—</option>
            {(f.type === "boolean"
              ? [
                  ["yes", "Yes"],
                  ["no", "No"],
                ]
              : (f.enum ?? []).map((x) => [x, x])
            ).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        ) : longText.has(f.key) ? (
          // Long text wraps where it can be read, but stays
          // one value: Enter doesn't start a new line.
          <LongTextCell
            {...inputProps}
            onChange={(text) => edit(r.row_id, f.key, text)}
          />
        ) : (
          <input
            {...inputProps}
            // Short text is as wide as its column's longest value
            // (within bounds), the same on every row.
            size={f.type === "text" ? columnSize(f.key) : undefined}
            inputMode={
              f.type === "integer"
                ? "numeric"
                : f.type === "decimal"
                  ? "decimal"
                  : undefined
            }
            onChange={(e) => edit(r.row_id, f.key, e.target.value)}
          />
        )}
      </td>
    );
  }

  return (
    <>
      <p className="hint table-hint">
        {valuesOnly
          ? "Change a value, then save."
          : "Edit any value, then save."}
        {readOnly ? " Shaded columns can’t be edited." : ""}
        {overflows ? (
          // Said whenever the table is wider than the space it has, not only
          // on narrow screens: some columns are out of view.
          <span className="scroll-cue on" data-testid="table-scroll-cue">
            {" "}
            Scroll sideways for more columns →
          </span>
        ) : null}
      </p>
      <UnitLegend fields={body.fields} id={unitsId} />
      <div
        className="product-scroll flex-table"
        tabIndex={0}
        role="region"
        aria-label="Editable table"
        ref={regionRef}
        data-overflow={overflows ? "true" : undefined}
      >
        <table className={tableClass(longText, body.fields.length)}>
          <thead>
            <tr>
              {inline.map((f) => (
                <th
                  key={f.key}
                  scope="col"
                  data-type={f.type}
                  data-derived={f.editable ? undefined : "true"}
                  data-long={longText.has(f.key) ? "true" : undefined}
                >
                  {fieldHeading(f)}
                </th>
              ))}
              <th scope="col" className="row-actions">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {body.rows.map((r, i) => {
              const name = rowName(body, r, i + 1);
              return (
                <Fragment key={r.row_id}>
                  <tr className={below.length ? "has-below" : undefined}>
                    {inline.map((f) => cellFor(r, i, name, f))}
                    <td data-label="" className="row-actions">
                      {!valuesOnly && canRemoveRow(saved, body, r.row_id) ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-quiet"
                          aria-label={`Remove ${name}`}
                          onClick={() => {
                            const next = { ...raw };
                            const typed: typeof raw = {};
                            for (const f of body.fields) {
                              const k = cellKey(r.row_id, f.key);
                              if (raw[k]) typed[k] = raw[k];
                              delete next[k];
                            }
                            setRemovedRow({ row: r, at: i, name, typed });
                            update(removeRow(body, r.row_id), next);
                            setFocusRow(i);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {below.length ? (
                    <tr className="long-row">
                      {below.map((f) =>
                        cellFor(r, i, name, f, inline.length + 1),
                      )}
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Always present, so what changes inside it is announced. */}
      <div role="status">
        {restorable ? (
          <p className="small undo-line" data-testid="undo-remove">
            Removed “{restorable.name}”.{" "}
            <button type="button" className="link-quiet" onClick={undoRemove}>
              Undo
            </button>
          </p>
        ) : null}
      </div>
      {errors.length ? (
        <ul className="small cell-errors" role="alert">
          {errors.map(([k, c]) => {
            const [rowId, key] = k.split("\u001f");
            const n = body.rows.findIndex((r) => r.row_id === rowId);
            const row = body.rows[n];
            const field = body.fields.find((f) => f.key === key);
            return row && field ? (
              <li key={k}>
                {rowName(body, row, n + 1)} · {field.label}: {c.error}
              </li>
            ) : null;
          })}
        </ul>
      ) : null}
      {valuesOnly ? null : (
        <>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              ref={addRowRef}
              disabled={body.rows.length >= 200}
              onClick={() =>
                update(addRow(body, `row-${crypto.randomUUID()}`), raw)
              }
            >
              Add a row
            </button>
          </div>
          <NotesList
            notes={body.notes ?? []}
            max={LIMITS.notes}
            onChange={updateNotes}
          />
        </>
      )}
    </>
  );
}

/**
 * An agent-made view of saved work. The trusted shell says what it reads and
 * whether that is still current, answers only the actions the saved view
 * declares, and reports failures itself rather than trusting the view to.
 */
function ViewSurface({
  ws,
  cid,
  artifact,
  view,
  bound,
  open,
  stale,
  refresh,
  canRebind,
  rebindNow,
  inPlace = false,
}: {
  ws: string;
  cid: string;
  artifact: S["Artifact"];
  view: CustomView;
  bound: Bound;
  open: boolean;
  stale: boolean;
  refresh: () => Promise<unknown>;
  canRebind: boolean;
  rebindNow: () => void;
  /**
   * Shown beside other work (a project page): it runs and reads as here, but
   * pointing it at newer versions, its readable version and its source stay
   * on the work's own page.
   */
  inPlace?: boolean;
}) {
  // A failed read clears when a read works again; a refused request stays,
  // because the view did ask for something it may not have.
  const [problem, setProblem] = useState("");
  const [refusal, setRefusal] = useState("");
  const states = bindingStates(view, bound);
  const behind = states.some((s) => s.state === "changed");
  const missing = states.some((s) => s.state === "unavailable");
  const pinned = pinsVersions(view);
  const revision = artifact.current_revision;
  const actions: ViewActions = {};
  for (const a of view.actions ?? [])
    actions[a.name] = async (payload) => {
      if (!isEmptyPayload(payload)) {
        setRefusal("The view asked for something it isn’t allowed to.");
        throw new Error("refused");
      }
      try {
        const result = await productApi.viewAction(
          ws,
          artifact.id,
          viewActionRequest(revision, view, a.name, crypto.randomUUID()),
        );
        setProblem("");
        return result;
      } catch (e) {
        if (e instanceof ApiError && e.status === 422)
          setRefusal("The view asked for something it isn’t allowed to.");
        else
          setProblem(
            e instanceof ApiError && e.status === 404
              ? "The view couldn’t read your saved work. It, or what it reads, has changed since it was made, or your access has. Anything it shows may be out of date."
              : "The view couldn’t reach your saved work. Anything it shows may be out of date.",
          );
        if (e instanceof ApiError && e.status === 404) void refresh();
        throw e;
      }
    };
  const readable = (
    <details className="disclosure" open={false}>
      <summary>Readable version</summary>
      <div className="disclosure-body">
        <p className="view-fallback">{view.fallback}</p>
      </div>
    </details>
  );
  return (
    <section className="stack view-surface" aria-label={view.title}>
      <div className="stack-sm view-trust">
        {/* One line: who made it, what it reads and whether that's current,
            and what it can't do. */}
        <p className="small view-trust-line" data-testid="product-verification">
          Made by Workagent
          {inPlace ? (
            // Beside other work, what it reads is named once, above, with
            // links that open it in place; here only whether that's current.
            <span
              className="view-binding"
              data-state={
                behind ? "changed" : missing ? "unavailable" : "current"
              }
            >
              {behind
                ? " · what it reads changed since this view was made"
                : missing
                  ? " · something it reads isn’t available"
                  : states.length
                    ? " · reads the current saved version"
                    : ""}
            </span>
          ) : null}
          {(inPlace ? [] : states).map(({ binding, state }, i) => (
            <span
              key={binding.name}
              className="view-binding"
              data-state={state}
            >
              {i ? ", " : " · reads "}
              {state === "unavailable" ? (
                // Nothing to open: a link would only lead to "not available".
                readableTitle(bound[binding.artifact_id]?.title ?? "saved work")
              ) : (
                <Link
                  href={scopedHref(
                    `/conversations/${cid}/artifacts/${binding.artifact_id}`,
                    ws,
                  )}
                >
                  {readableTitle(
                    bound[binding.artifact_id]?.title ?? "saved work",
                  )}
                </Link>
              )}
              {state === "current"
                ? " · current saved version"
                : state === "changed"
                  ? " · changed since this view was made"
                  : " · not available"}
            </span>
          ))}{" "}
          · can’t change your work or reach the internet · not verified
        </p>
        {behind ? (
          <div className="notice-line stack-sm" role="status">
            <p>
              What this view reads has been saved since it was made, so it can’t
              read it any more.
            </p>
            {pinned ? (
              <p data-testid="view-pinned">
                This view was written for that earlier version, so it can’t
                simply be pointed at the new one. Ask in the conversation for an
                updated view.
              </p>
            ) : missing || inPlace ? null : (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canRebind || stale || !open}
                  onClick={rebindNow}
                >
                  Use the latest saved versions
                </button>
              </div>
            )}
          </div>
        ) : null}
        {!open ? (
          <p className="notice-line" role="status">
            This conversation has ended, so the view can’t read saved work.
          </p>
        ) : null}
        {/* A refused read is already explained when the work moved on. */}
        {problem && !behind ? (
          <p className="notice-line" role="alert" data-testid="view-problem">
            {problem}
          </p>
        ) : null}
        {refusal ? (
          <p className="notice-line" role="alert" data-testid="view-refusal">
            {refusal}
          </p>
        ) : null}
      </div>
      <SandboxedView
        key={`${revision.id}:${revision.body_hash}`}
        title={view.title}
        source={view.source}
        data={{}}
        actions={actions}
        fallback={<p className="view-fallback">{view.fallback}</p>}
        caption={false}
      />
      {inPlace ? null : readable}
      {inPlace ? null : (
        <details className="disclosure">
          <summary>View source</summary>
          <div className="disclosure-body stack-sm">
            <p className="hint">
              Kept as text and only ever run inside the isolated frame above.
            </p>
            {(["html", "css", "js"] as const).map((part) =>
              view.source[part] ? (
                <pre key={part} className="product-code" aria-label={part}>
                  {view.source[part]}
                </pre>
              ) : null,
            )}
          </div>
        </details>
      )}
    </section>
  );
}
