"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { WorkspaceScope } from "@/lib/client/workspace";
import { scopedHref } from "@/lib/scope";
import { ScopedRecord } from "@/components/ScopedRecord";
import { useResource } from "@/lib/client/hooks";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { conversationApi } from "@/lib/client/real-api";
import { scopedSession } from "@/lib/client/session-scope";
import {
  currentObservation,
  resolveObservations,
  fieldInputs,
  isProduct,
  productApi,
  type ProductBody,
  type Operation,
  type S,
} from "@/lib/client/products";
import { ApiError } from "@/lib/contract/errors";
import { ErrorNotice } from "@/components/ui";
import { ConversationPeek } from "@/components/ConversationPeek";
import { ObservedOutput } from "@/components/ObservedOutput";
import { WorkSurface } from "@/components/WorkSurface";
import { ProductView } from "@/components/ProductView";
import { areaHref } from "@/lib/client/work-areas";
import { FlexibleEditor, type Bound } from "@/components/FlexibleWork";
import { NotesList } from "@/components/NotesList";
import {
  flexibleKind,
  isFlexible,
  notesProblem,
  type CustomView,
} from "@/lib/flexible";
import type { ConversationDetailView } from "@/lib/contract/types";
import {
  isReconciliation,
  ROUNDING_LABEL,
  tableColumns,
  tableSummary,
  toolInputs,
} from "@/lib/product-summary";
import { readableTitle } from "@/lib/titles";
import {
  type Acks,
  ackPayload,
  acksFor,
  canAccept,
  candidates,
  reviewOf,
  type ReviewableProposal,
} from "@/lib/proposal-review";
import { ProposalReviewGate } from "@/components/ProposalReviewGate";
import { EarlierVersion, versionAuthor } from "@/components/EarlierVersion";

type Data = {
  artifact: S["Artifact"];
  conversation: ConversationDetailView;
  proposals: S["Proposal"][];
  history: S["Revision"][];
  observations: Awaited<ReturnType<typeof resolveObservations>>;
  version: number;
  open: boolean;
  /** For an agent-made view: where each piece of work it reads is now. */
  bound: Bound;
};
type Pending =
  | { kind: "save"; id: string; base: string; body: ProductBody }
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
    }
  | { kind: "run"; id: string; version: number; operation: Operation };
type InputRows = Parameters<typeof fieldInputs>[0];
type Draft = {
  base: string;
  body: ProductBody;
  pending: Pending | null;
  // UI-only raw edits: invalid values never enter the contractual Body.
  toolInputs?: InputRows;
};
/** The service's limit on a saved table's or tool's notes. */
const PRODUCT_NOTES = 30;
function inputError(draft: Draft): string {
  if (draft.body.kind !== "tool" || !draft.toolInputs) return "";
  try {
    const parsed = fieldInputs(draft.toolInputs);
    if (
      JSON.stringify(parsed.arguments) !==
        JSON.stringify(draft.body.arguments) ||
      JSON.stringify(parsed.input_form) !==
        JSON.stringify(draft.body.input_form)
    )
      return "Change or discard these unapplied inputs before continuing.";
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "Check the inputs.";
  }
}
/**
 * Where this work came from, from records only: who saved the current
 * version, whether the message that produced it was a controlled test, and
 * whether a local run was recorded. Never claims or denies a model by default.
 */
function originText(
  conversation: ConversationDetailView,
  artifact: S["Artifact"],
  lead: S["ObservationReadback"] | null | undefined,
): string {
  const source = conversation.messages
    .filter((m) => m.products?.some((x) => x.artifact_id === artifact.id))
    .at(-1);
  const parts: string[] = [];
  if (artifact.current_revision.author_kind === "human")
    parts.push("last saved by you");
  else if (source?.origin === "controlled_transport")
    parts.push("made in a controlled test run, no model");
  else parts.push("made by Workagent");
  if (lead) parts.push("results calculated locally");
  return parts.join(" · ");
}
function readDraft(key: string, artifact: S["Artifact"]): Draft {
  const body = artifact.current_revision.body;
  if (!isProduct(body)) throw new Error("Not a typed product.");
  try {
    const raw = scopedSession.getItem(key);
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      if (d.base && d.body?.kind === body.kind) return d;
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
export default function ProductPage() {
  return (
    <ScopedRecord>{(scope) => <ProductPageView scope={scope} />}</ScopedRecord>
  );
}

function ProductPageView({ scope }: { scope: WorkspaceScope }) {
  const { id, artifactId } = useParams<{ id: string; artifactId: string }>();
  const focusRevision = useSearchParams().get("revision");
  const ws = scope.wsId ?? undefined;
  const [unsaved, setUnsaved] = useState(false);
  // "Ask for a different change": bring the conversation forward (on a phone
  // it switches panes) and put the cursor in its reply box, about this work.
  // The box takes focus only once its pane shows, so try for a few frames.
  const [askForChange, setAskForChange] = useState(0);
  // A request the work suggests (recheck after edits): filled in, not sent.
  const [suggestion, setSuggestion] = useState<{ text: string; n: number }>();
  useEffect(() => {
    if (!askForChange) return;
    let frames = 0;
    let handle = 0;
    const tryFocus = () => {
      const box = document.getElementById("peek-reply");
      box?.focus();
      if (document.activeElement !== box && ++frames < 10)
        handle = requestAnimationFrame(tryFocus);
    };
    handle = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(handle);
  }, [askForChange]);
  const resource = useResource<Data>(
    ws ? `product:${ws}:${id}:${artifactId}` : null,
    async (signal) => {
      const [artifact, conversation, proposals, history] = await Promise.all([
        productApi.get(ws!, artifactId, signal),
        conversationApi.get(ws!, id, signal),
        productApi.proposals(ws!, artifactId, signal),
        productApi.history(ws!, artifactId, signal),
      ]);
      const body = artifact.current_revision.body;
      if (
        artifact.conversation_id !== id ||
        !(isProduct(body) || isFlexible(body))
      )
        throw new ApiError({
          code: "not_found_or_not_authorized",
          status: 404,
          message: "This product does not belong to this conversation.",
        });
      const observations = await resolveObservations(
        artifact,
        conversation.messages.flatMap((m) => m.products ?? []),
        (oid) => productApi.observe(ws!, oid, signal),
      );
      // A view's bindings are checked against what each bound piece of
      // work is now; anything unreadable counts as unavailable.
      const bound: Bound = {};
      if (flexibleKind(body) === "custom_view")
        await Promise.all(
          ((body as CustomView).bindings ?? []).map(async (b) => {
            try {
              const a = await productApi.get(ws!, b.artifact_id, signal);
              bound[b.artifact_id] =
                a.conversation_id === id
                  ? {
                      revision_id: a.current_revision_id,
                      body_hash: a.current_revision.body_hash,
                      title: a.current_revision.body.title,
                    }
                  : null;
            } catch (e) {
              if (signal.aborted) throw e;
              bound[b.artifact_id] = null;
            }
          }),
        );
      return {
        artifact,
        conversation,
        proposals,
        history,
        observations,
        version: conversation.conversation.work_version,
        open: conversation.conversation.state === "open",
        bound,
      };
    },
  );
  return (
    <div className="doc-page product-page">
      {resource.data?.conversation.conversation.work_area && ws ? (
        // Back to the project with this work still chosen, as the person
        // left it.
        <Link
          className="back-link"
          href={`${areaHref(ws, id)}?work=${encodeURIComponent(artifactId)}`}
        >
          ← {resource.data.conversation.conversation.work_area.title}
        </Link>
      ) : (
        <Link
          className="back-link"
          href={scopedHref(`/conversations/${id}`, ws)}
        >
          ← Back to conversation
        </Link>
      )}
      {resource.error ? <ErrorNotice error={resource.error} /> : null}
      {!resource.data ? (
        resource.error ? (
          <div role="status">
            <p>
              Authorized product unavailable. No saved state could be confirmed.
            </p>
            <button className="btn" onClick={() => void resource.refresh()}>
              Retry product read
            </button>
          </div>
        ) : (
          <p>Loading authorized product…</p>
        )
      ) : (
        <WorkSurface
          focusAgent={askForChange}
          title={readableTitle(
            (resource.data.artifact.current_revision.body as { title?: string })
              .title ?? "",
          )}
          document={
            isProduct(resource.data.artifact.current_revision.body) ? (
              <ProductEditor
                key={`${ws}:${id}:${artifactId}`}
                ws={ws!}
                cid={id}
                data={resource.data}
                stale={resource.reconnecting}
                refresh={resource.refresh}
                onDirtyChange={setUnsaved}
                focusRevision={focusRevision}
              />
            ) : (
              <FlexibleEditor
                focusRevision={focusRevision}
                key={`${ws}:${id}:${artifactId}`}
                ws={ws!}
                cid={id}
                artifact={resource.data.artifact}
                proposals={resource.data.proposals}
                history={resource.data.history}
                observations={[
                  resource.data.observations.current,
                  resource.data.observations.latest,
                ].filter(
                  (r, i, all): r is S["ObservationReadback"] =>
                    Boolean(r) &&
                    all.findIndex(
                      (o) => o?.observation.id === r?.observation.id,
                    ) === i,
                )}
                bound={resource.data.bound ?? {}}
                open={resource.data.open}
                origin={originText(
                  resource.data.conversation,
                  resource.data.artifact,
                  null,
                )}
                stale={resource.reconnecting}
                refresh={resource.refresh}
                onDirtyChange={setUnsaved}
                onAskForChange={(text) => {
                  if (text)
                    setSuggestion((s) => ({ text, n: (s?.n ?? 0) + 1 }));
                  setAskForChange((n) => n + 1);
                }}
              />
            )
          }
          agent={
            <ConversationPeek
              conversation={resource.data.conversation}
              suggest={suggestion}
              artifactId={artifactId}
              wsId={ws!}
              refreshWork={resource.refresh}
              target={
                CAPABILITIES.naturalAdmission
                  ? {
                      artifact_id: resource.data.artifact.id,
                      revision_id: resource.data.artifact.current_revision_id,
                      body_hash:
                        resource.data.artifact.current_revision.body_hash,
                    }
                  : undefined
              }
              unsavedEdits={unsaved}
            />
          }
        />
      )}
    </div>
  );
}
function ProductEditor({
  ws,
  cid,
  data,
  stale,
  refresh,
  onDirtyChange,
  focusRevision,
}: {
  ws: string;
  cid: string;
  data: Data;
  stale: boolean;
  refresh: () => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
  /** An earlier version a conversation link opened, if any. */
  focusRevision?: string | null;
}) {
  const router = useRouter();
  const artifact = data.artifact;
  const key = `workagent:product:${ws}:${cid}:${artifact.id}`;
  const [draft, setDraft] = useState<Draft>(() => readDraft(key, artifact));
  const [busy, setBusy] = useState(false);
  const [acks, setAcks] = useState<Record<string, Acks>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const notesError =
    draft.body.kind === "file"
      ? ""
      : notesProblem(draft.body.notes ?? [], PRODUCT_NOTES);
  const inputsError = inputError(draft);
  const dirty =
    Boolean(inputsError) ||
    JSON.stringify(draft.body) !==
      JSON.stringify(artifact.current_revision.body);
  const changed = draft.base !== artifact.current_revision_id;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const verified =
    currentObservation(artifact, data.observations.current) && !stale;

  const observations = [
    data.observations.current,
    data.observations.latest,
  ].filter(
    (read, index, all): read is S["ObservationReadback"] =>
      Boolean(read) &&
      all.findIndex(
        (other) => other?.observation.id === read?.observation.id,
      ) === index,
  );
  /** Journals the draft; false when the browser refused to store it. */
  function keep(next: Draft): boolean {
    setDraft(next);
    try {
      scopedSession.setItem(key, JSON.stringify(next));
      return true;
    } catch {
      setNotice(
        "Browser storage unavailable. Keep this tab open to retain the draft and retry information.",
      );
      return false;
    }
  }
  async function submit(action: Pending) {
    if (
      busy ||
      (!draft.pending &&
        (inputsError || (action.kind === "save" && notesError)))
    )
      return;
    const exact = draft.pending ?? action;
    const journaled = keep({ ...draft, pending: exact });
    setBusy(true);
    setError("");
    // A storage failure was just reported by keep(); do not erase that warning.
    if (journaled) setNotice("");
    try {
      if (exact.kind === "save") {
        const saved = await productApi.save(
          ws,
          artifact.id,
          exact.id,
          exact.base,
          exact.body,
        );
        if (!isProduct(saved.current_revision.body))
          throw new Error("Unexpected document response.");
        keep({
          base: saved.current_revision_id,
          body: saved.current_revision.body,
          pending: null,
        });
        setNotice(
          exact.body.kind === "table" && !isReconciliation(exact.body)
            ? "Your edits are saved."
            : "Your edits are saved. Recalculate or run it to check them.",
        );
      } else if (exact.kind === "accept") {
        const saved = await productApi.accept(
          ws,
          exact.pid,
          exact.id,
          exact.base,
          exact.acks,
        );
        if (!isProduct(saved.current_revision.body))
          throw new Error("Unexpected document response.");
        keep({
          base: saved.current_revision_id,
          body: saved.current_revision.body,
          pending: null,
        });
        setNotice("The proposed version is now your saved version.");
      } else if (exact.kind === "dismiss") {
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
      } else {
        await conversationApi.send(ws, cid, {
          command_id: exact.id,
          expected_work_version: exact.version,
          text: "Run the saved product with its explicit inputs; preserve my human notes and propose the result.",
          operation: exact.operation,
        });
        keep({ ...draft, pending: null });
        router.push(scopedHref(`/conversations/${cid}`, ws));
      }
      await refresh();
    } catch (e) {
      if (
        !(e instanceof ApiError && e.isAmbiguousWrite) &&
        !(e instanceof TypeError)
      )
        keep({ ...draft, pending: null });
      setError(e instanceof Error ? e.message : "Could not confirm operation.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  function run() {
    const b = draft.body;
    if (b.kind === "file") return;
    const target = { artifact_id: artifact.id, base_revision_id: draft.base };
    const operation: Operation =
      b.kind === "table"
        ? { kind: "reconcile_csv", ...target, rounding: b.rounding }
        : {
            kind: "run_wasm",
            ...target,
            entrypoint: b.entrypoint,
            arguments: b.arguments,
            input_form: b.input_form,
          };
    void submit({
      kind: "run",
      id: crypto.randomUUID(),
      version: data.version,
      operation,
    });
  }
  const locked = busy || Boolean(draft.pending) || stale;
  const saved = artifact.current_revision.body as ProductBody;
  const pendingProposals = data.proposals.filter((p) => p.status === "pending");
  // The verified result for this saved version, else the latest output with
  // its own binding said plainly. Nothing is promoted to "checked".
  const lead = data.observations.current ?? data.observations.latest;
  const leadIsCurrent = Boolean(verified);
  // Only a tool or a reconciliation table has an operation that can check it.
  const reconciles =
    draft.body.kind === "table" && isReconciliation(draft.body);
  const checkable = draft.body.kind === "tool" || reconciles;
  const statusText = !checkable
    ? dirty
      ? "Your changes aren’t saved yet."
      : "Saved. Nothing checks this table automatically."
    : verified
      ? dirty
        ? "Your unsaved changes haven’t been checked yet."
        : "Checked against this saved version."
      : "This saved version hasn’t been checked yet.";
  const runLabel =
    draft.body.kind === "table" ? "Recalculate saved rows" : "Run saved tool";
  const kindLabel =
    draft.body.kind === "table"
      ? "Table"
      : draft.body.kind === "tool"
        ? "Runnable tool"
        : "File";
  return (
    <div className="stack product">
      <header className="stack-sm">
        <h1>{readableTitle(saved.title)}</h1>
        <div className="row product-meta">
          <span className="small muted">
            {kindLabel} · {originText(data.conversation, artifact, lead)}
          </span>
          <span className="composer-spacer" />
          <button
            className="link-quiet small"
            disabled={busy || stale}
            onClick={() =>
              void productApi
                .download(ws, artifact)
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "Download failed"),
                )
            }
          >
            Download saved file
          </button>
          <button className="link-quiet small" onClick={() => void refresh()}>
            Check for updates
          </button>
        </div>
      </header>

      {focusRevision ? (
        <EarlierVersion
          revisionId={focusRevision}
          current={artifact.current_revision}
          history={data.history}
          proposals={data.proposals}
          workHref={scopedHref(
            `/conversations/${cid}/artifacts/${artifact.id}`,
            ws,
          )}
          render={(body) =>
            isProduct(body) ? <ProductView body={body} /> : null
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

      <ResultCard
        body={saved}
        read={lead}
        current={leadIsCurrent}
        status={statusText}
        verified={Boolean(verified) && !dirty}
      />

      {(() => {
        // The latest candidate first; earlier ones labelled and gated.
        const c = candidates(
          pendingProposals as ((typeof pendingProposals)[number] &
            ReviewableProposal)[],
          artifact.current_revision_id,
        );
        return [...(c.latest ? [c.latest] : []), ...c.earlier, ...c.outdated];
      })().map((p) => {
        const outdated = p.base_revision_id !== artifact.current_revision_id;
        const review = outdated
          ? null
          : reviewOf(
              p as typeof p & ReviewableProposal,
              artifact.current_revision.body,
              candidates(
                pendingProposals as (typeof p & ReviewableProposal)[],
                artifact.current_revision_id,
              ).latest?.id ?? null,
            );
        const given = review ? acksFor(acks[p.id], review) : null;
        const earlier = Boolean(review && !review.isLatest);
        // The run bound to exactly this proposed version, if any.
        const proposedRun = stale
          ? undefined
          : observations.find((read) => {
              const o = read.observation;
              return (
                read.current_scope &&
                read.binding_state === "pending_proposal" &&
                o.proposal_id === p.id &&
                o.workspace_id === ws &&
                o.conversation_id === cid &&
                o.artifact_id === artifact.id &&
                o.body_hash === p.body_hash
              );
            });
        return (
          <section
            key={p.id}
            className="card decision-card product-proposal"
            data-testid="product-proposal"
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
            <p className="small">{p.reason}</p>
            {isProduct(p.body) ? (
              <>
                {p.body.kind === "table" ? (
                  <p className="decision-question">
                    {
                      tableSummary(
                        p.body,
                        proposedRun?.observation.output.kind ===
                          "reconcile_csv",
                      ).headline
                    }
                  </p>
                ) : p.body.kind === "tool" ? (
                  <ProposedToolResult body={p.body} read={proposedRun} />
                ) : null}
                <details className="ids-details">
                  <summary>See the proposed version</summary>
                  <ProductView body={p.body} />
                  {p.body.kind !== "file" ? (
                    <p className="small">
                      Your notes kept:{" "}
                      {(p.body.notes ?? []).join("; ") || "none"}
                    </p>
                  ) : null}
                </details>
              </>
            ) : null}
            {review && given ? (
              <ProposalReviewGate
                review={review}
                acks={given}
                disabled={locked || dirty}
                setAcks={(next) => setAcks((a) => ({ ...a, [p.id]: next }))}
              />
            ) : null}
            <div className="row">
              {isProduct(p.body) ? (
                <button
                  className="btn btn-quiet"
                  disabled={busy || stale}
                  onClick={() =>
                    void productApi
                      .download(ws, artifact, p)
                      .catch((e) =>
                        setError(
                          e instanceof Error ? e.message : "Download failed",
                        ),
                      )
                  }
                >
                  Download proposed file
                </button>
              ) : null}
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
            </div>
            {!outdated && dirty ? (
              <p className="small">Save or discard your changes first.</p>
            ) : null}
          </section>
        );
      })}

      {draft.body.kind === "file" ? (
        <ProductView body={draft.body} />
      ) : (
        <section className="stack product-work" aria-label="Your working copy">
          <fieldset disabled={locked} className="stack">
            {draft.body.kind === "table" ? (
              <>
                <p className="hint table-hint">
                  {reconciles
                    ? "Edit the raw values or notes. Calculated columns update when you recalculate."
                    : "Edit any cell, then save."}
                  <span className="scroll-cue" aria-hidden="true">
                    {" "}
                    Scroll sideways for more columns →
                  </span>
                </p>
                <div
                  className="product-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Editable table"
                >
                  <table>
                    <thead>
                      <tr>
                        {tableColumns(draft.body).map((c) => (
                          <th
                            key={c.key}
                            scope="col"
                            data-derived={c.derived ? "true" : undefined}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.body.rows.map((row, i) => (
                        <tr
                          key={i}
                          data-discrepancy={
                            reconciles && row["check"] === "discrepancy"
                              ? "true"
                              : undefined
                          }
                        >
                          {draft.body.kind === "table" &&
                            tableColumns(draft.body).map(
                              ({ key: c, derived }) => (
                                <td
                                  key={c}
                                  data-derived={derived ? "true" : undefined}
                                >
                                  {derived ? (
                                    <span
                                      className={
                                        dirty
                                          ? "derived derived-stale"
                                          : "derived"
                                      }
                                      title={
                                        dirty
                                          ? "Not recalculated since your changes"
                                          : undefined
                                      }
                                    >
                                      {c === "check"
                                        ? row[c] === "discrepancy"
                                          ? "Doesn’t match"
                                          : row[c] === "matched"
                                            ? "Matches"
                                            : row[c]
                                        : row[c]}
                                    </span>
                                  ) : (
                                    <input
                                      aria-label={`Row ${i + 1} ${c}`}
                                      value={row[c] ?? ""}
                                      onChange={(e) => {
                                        if (draft.body.kind !== "table") return;
                                        const rows = draft.body.rows.map(
                                          (r, n) =>
                                            n === i
                                              ? { ...r, [c]: e.target.value }
                                              : r,
                                        );
                                        keep({
                                          ...draft,
                                          body: { ...draft.body, rows },
                                        });
                                      }}
                                    />
                                  )}
                                </td>
                              ),
                            )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {reconciles ? (
                  <label className="field">
                    <span className="field-label">Rounding</span>
                    <select
                      aria-label="Rounding"
                      value={draft.body.rounding}
                      onChange={(e) => {
                        if (draft.body.kind === "table")
                          keep({
                            ...draft,
                            body: {
                              ...draft.body,
                              rounding: e.target
                                .value as S["TableBody"]["rounding"],
                            },
                          });
                      }}
                    >
                      <option value="ROUND_HALF_UP">
                        {ROUNDING_LABEL.ROUND_HALF_UP}
                      </option>
                      <option value="ROUND_HALF_EVEN">
                        {ROUNDING_LABEL.ROUND_HALF_EVEN}
                      </option>
                    </select>
                  </label>
                ) : null}
              </>
            ) : (
              <>
                <ToolInputs
                  rows={
                    draft.toolInputs ??
                    draft.body.input_form.map((f, i) => ({
                      name: f.name,
                      label: f.label,
                      value: String(
                        draft.body.kind === "tool"
                          ? (draft.body.arguments[i] ?? "")
                          : "",
                      ),
                    }))
                  }
                  error={inputsError}
                  update={(rows) => {
                    if (draft.body.kind !== "tool") return;
                    let body = draft.body;
                    try {
                      body = { ...body, ...fieldInputs(rows) };
                    } catch {
                      // Keep invalid raw input, but never admit it into Body.
                    }
                    keep({ ...draft, body, toolInputs: rows });
                  }}
                />
                <details className="disclosure tool-code">
                  <summary>Tool code</summary>
                  <div className="disclosure-body stack">
                    <label className="field">
                      <span className="field-label">
                        WebAssembly text (WAT)
                      </span>
                      <textarea
                        className="product-code"
                        rows={8}
                        value={draft.body.code}
                        onChange={(e) => {
                          if (draft.body.kind === "tool")
                            keep({
                              ...draft,
                              body: { ...draft.body, code: e.target.value },
                            });
                        }}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Entrypoint</span>
                      <input
                        value={draft.body.entrypoint}
                        onChange={(e) => {
                          if (draft.body.kind === "tool")
                            keep({
                              ...draft,
                              body: {
                                ...draft.body,
                                entrypoint: e.target.value,
                              },
                            });
                        }}
                      />
                    </label>
                    <p className="hint">
                      Whole-number inputs and result only; the tool can’t read
                      files or reach the network. Saving code doesn’t run it.
                    </p>
                  </div>
                </details>
              </>
            )}
            <NotesList
              label="Your notes"
              notes={draft.body.notes ?? []}
              max={PRODUCT_NOTES}
              onChange={(notes) => {
                if (draft.body.kind !== "file")
                  keep({ ...draft, body: { ...draft.body, notes } });
              }}
            />
            {notesError ? (
              <p role="alert" className="small">
                {notesError}
              </p>
            ) : null}
          </fieldset>
          <div className="row product-actions">
            {dirty ? (
              <button
                className="btn btn-primary"
                disabled={locked || Boolean(inputsError || notesError)}
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
            ) : checkable ? (
              <button
                className="btn btn-primary"
                disabled={locked || changed || !data.open}
                onClick={run}
              >
                {runLabel}
              </button>
            ) : null}
            <button
              className="btn btn-quiet"
              disabled={locked}
              onClick={() => {
                if (isProduct(artifact.current_revision.body))
                  keep({
                    base: artifact.current_revision_id,
                    body: structuredClone(artifact.current_revision.body),
                    pending: null,
                  });
              }}
            >
              Discard my changes
            </button>
          </div>
          <p className="hint">
            {!checkable
              ? dirty
                ? "Save to keep your changes."
                : "Ask in the conversation to change or extend this table."
              : dirty
                ? `Save first, then ${draft.body.kind === "table" ? "recalculate" : "run it"} to check your changes.`
                : !data.open
                  ? "This conversation has ended, so nothing new can run."
                  : draft.body.kind === "table"
                    ? "Recalculating proposes a new version for you to apply; your notes are kept."
                    : "Running proposes a new version with the result for you to apply; your notes are kept."}
          </p>
        </section>
      )}
      {draft.pending ? (
        <button
          className="btn btn-primary"
          disabled={busy || stale}
          onClick={() => void submit(draft.pending!)}
        >
          Retry same {draft.pending.kind}
        </button>
      ) : null}

      {observations.length ? (
        <details className="disclosure">
          <summary>How this was checked</summary>
          <div className="disclosure-body stack">
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

      <details className="disclosure">
        <summary>Saved history and original input</summary>
        <div className="disclosure-body stack">
          {data.history.map((r) => (
            <section key={r.id} className="stack-sm">
              <h3>
                Version {r.revision_number} ·{" "}
                {r.author_kind === "human"
                  ? versionAuthor(r, data.proposals)
                  : "calculated"}
                {r.id === artifact.current_revision_id ? " · current" : ""}
              </h3>
              {isProduct(r.body) ? (
                <>
                  <ProductView body={r.body} />
                  {r.body.kind === "table" ? (
                    <details>
                      <summary>Original attached CSV</summary>
                      <pre className="product-code">{r.body.source_csv}</pre>
                    </details>
                  ) : null}
                </>
              ) : null}
              <p className="ids">
                {r.id} · {r.body_hash}
              </p>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}

/** The result first: what was found, then whether it applies to this saved version. */
/**
 * What a proposed tool version returned, with the inputs it was run with,
 * labelled by that same proposed version. Never the saved inputs.
 */
function ProposedToolResult({
  body,
  read,
}: {
  body: S["ToolBody"];
  read: S["ObservationReadback"] | undefined;
}) {
  const output = read?.observation.output;
  if (output?.kind !== "run_wasm")
    return <p className="decision-question">Not run yet.</p>;
  const inputs = output.arguments.map((value, i) => ({
    label: body.input_form[i]?.label ?? `Input ${i + 1}`,
    value,
  }));
  return (
    <>
      <p className="decision-question" data-testid="proposal-result">
        Returns <strong>{output.value}</strong>
      </p>
      <ul className="small muted result-inputs" data-testid="proposal-inputs">
        {inputs.map((x, i) => (
          <li key={i}>
            {x.label}: {x.value}
          </li>
        ))}
      </ul>
    </>
  );
}
function ResultCard({
  body,
  read,
  current,
  status,
  verified,
}: {
  body: ProductBody;
  read: S["ObservationReadback"] | null;
  current: boolean;
  status: string;
  verified: boolean;
}) {
  // Only a run of this saved version leads here; a proposal's own result
  // is shown on its card, with its own inputs.
  const output = current ? read?.observation.output : undefined;
  const earlier =
    read && !current && read.binding_state === "historical"
      ? read.observation.output
      : undefined;
  const where =
    earlier?.kind === "run_wasm"
      ? `An earlier version returned ${earlier.value}.`
      : earlier
        ? "The last check was on an earlier version."
        : null;
  return (
    <section className="card result-card" aria-labelledby="result-title">
      <h2 id="result-title" className="sr-only">
        Result
      </h2>
      {body.kind === "table" ? (
        (() => {
          const checked =
            current && read?.observation.output.kind === "reconcile_csv";
          const t = tableSummary(body, checked);
          return (
            <>
              <p className="result-headline">{t.headline}</p>
              {checked &&
              t.calculated &&
              t.reportedTotal &&
              t.calculatedTotal ? (
                <dl className="result-figures">
                  <div>
                    <dt>Reported total</dt>
                    <dd>{t.reportedTotal}</dd>
                  </div>
                  <div>
                    <dt>Calculated</dt>
                    <dd>{t.calculatedTotal}</dd>
                  </div>
                  {t.mismatches.length ? (
                    <div>
                      <dt>Rows off</dt>
                      <dd>{t.mismatches.map((m) => m.id).join(", ")}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </>
          );
        })()
      ) : body.kind === "tool" ? (
        <>
          <p className="result-headline">
            {output?.kind === "run_wasm" ? (
              <>
                Returns <strong>{output.value}</strong>
              </>
            ) : (
              "Not run on this saved version yet."
            )}
          </p>
          <ul className="small muted result-inputs">
            {toolInputs(body).map((x, i) => (
              <li key={i}>
                {x.label}: {x.value}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="result-headline">{body.filename}</p>
      )}
      {where ? <p className="small">{where}</p> : null}
      <p className="result-status" data-verified={verified ? "true" : "false"}>
        <span className="dot" aria-hidden="true" />
        <span role="status" data-testid="product-verification">
          {status}
        </span>
      </p>
    </section>
  );
}
/**
 * The tool's inputs, one field each: a name and a whole-number value. Valid
 * edits go straight into the draft (so Save and Discard cover them); an
 * invalid edit is persisted separately from Body and blocks all new actions.
 */
function ToolInputs({
  rows,
  error,
  update,
}: {
  rows: InputRows;
  error: string;
  update: (rows: InputRows) => void;
}) {
  const change = update;
  // Opens by itself when there's something to fix; otherwise it's the
  // person's to open and close.
  const [shown, setShown] = useState(Boolean(error));
  useEffect(() => {
    if (error) setShown(true);
  }, [error]);
  const set = (i: number, patch: Partial<InputRows[number]>) =>
    change(rows.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  // People change values; renaming, adding or removing inputs changes the
  // tool itself, so that sits behind its own disclosure.
  return (
    <fieldset className="tool-inputs stack-sm">
      <legend className="field-label">Inputs</legend>
      {rows.map((r, i) => (
        <label key={i} className="tool-input">
          <span className="tool-input-label">
            {r.label.trim() || `Input ${i + 1}`}
          </span>
          <input
            aria-label={r.label.trim() || `Input ${i + 1} value`}
            inputMode="numeric"
            value={r.value}
            placeholder="0"
            onChange={(e) => set(i, { value: e.target.value })}
          />
        </label>
      ))}
      {error ? (
        <p role="alert" className="small">
          {error}
        </p>
      ) : (
        <p className="hint">Whole numbers only.</p>
      )}
      <details
        className="disclosure tool-structure"
        open={shown}
        onToggle={(e) => setShown(e.currentTarget.open)}
      >
        <summary>Change the inputs</summary>
        <div className="disclosure-body stack-sm">
          <p className="hint">
            Rename, add or remove what the tool asks for. Up to eight inputs.
          </p>
          {rows.map((r, i) => (
            <div key={i} className="tool-input-row">
              <input
                aria-label={`Input ${i + 1} name`}
                value={r.label}
                placeholder="Name"
                onChange={(e) => set(i, { label: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                aria-label={`Remove input ${i + 1}`}
                onClick={() => change(rows.filter((_, n) => n !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={rows.length >= 8}
              onClick={() =>
                change([...rows, { name: "", label: "", value: "" }])
              }
            >
              Add an input
            </button>
          </div>
        </div>
      </details>
    </fieldset>
  );
}
