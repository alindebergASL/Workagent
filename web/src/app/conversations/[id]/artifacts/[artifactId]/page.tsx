"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/client/workspace";
import { useResource } from "@/lib/client/hooks";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { conversationApi } from "@/lib/client/real-api";
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
import type { ConversationDetailView } from "@/lib/contract/types";
import {
  columnLabel,
  DERIVED_COLUMNS,
  ROUNDING_LABEL,
  tableSummary,
  toolInputs,
} from "@/lib/product-summary";

type Data = {
  artifact: S["Artifact"];
  conversation: ConversationDetailView;
  proposals: S["Proposal"][];
  history: S["Revision"][];
  observations: Awaited<ReturnType<typeof resolveObservations>>;
  version: number;
  open: boolean;
};
type Pending =
  | { kind: "save"; id: string; base: string; body: ProductBody }
  | { kind: "accept"; id: string; base: string; pid: string }
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
    const raw = sessionStorage.getItem(key);
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
function ProductView({ body }: { body: ProductBody }) {
  if (body.kind === "table")
    return (
      <div
        className="product-scroll"
        tabIndex={0}
        role="region"
        aria-label="Table"
      >
        <table>
          <thead>
            <tr>
              {body.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.rows.map((row, i) => (
              <tr key={i}>
                {body.columns.map((c) => (
                  <td key={c}>{row[c]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <pre className="product-code">
      {body.kind === "tool" ? body.code : body.content}
    </pre>
  );
}
export default function ProductPage() {
  const { id, artifactId } = useParams<{ id: string; artifactId: string }>();
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const [unsaved, setUnsaved] = useState(false);
  const resource = useResource<Data>(
    ws ? `product:${ws}:${id}:${artifactId}` : null,
    async (signal) => {
      const [artifact, conversation, proposals, history] = await Promise.all([
        productApi.get(ws!, artifactId, signal),
        conversationApi.get(ws!, id, signal),
        productApi.proposals(ws!, artifactId, signal),
        productApi.history(ws!, artifactId, signal),
      ]);
      if (
        artifact.conversation_id !== id ||
        !isProduct(artifact.current_revision.body)
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
      return {
        artifact,
        conversation,
        proposals,
        history,
        observations,
        version: conversation.conversation.work_version,
        open: conversation.conversation.state === "open",
      };
    },
  );
  return (
    <div className="doc-page product-page">
      <Link className="back-link" href={`/conversations/${id}`}>
        ← Back to conversation
      </Link>
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
          focusAgent={0}
          document={
            <ProductEditor
              key={`${ws}:${id}:${artifactId}`}
              ws={ws!}
              cid={id}
              data={resource.data}
              stale={resource.reconnecting}
              refresh={resource.refresh}
              onDirtyChange={setUnsaved}
            />
          }
          agent={
            <ConversationPeek
              conversation={resource.data.conversation}
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
}: {
  ws: string;
  cid: string;
  data: Data;
  stale: boolean;
  refresh: () => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const artifact = data.artifact;
  const key = `workagent:product:${ws}:${cid}:${artifact.id}`;
  const [draft, setDraft] = useState<Draft>(() => readDraft(key, artifact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  function keep(next: Draft) {
    setDraft(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      setNotice(
        "Browser storage unavailable. Keep this tab open to retain the draft and retry information.",
      );
    }
  }
  async function submit(action: Pending) {
    if (busy || (!draft.pending && inputsError)) return;
    const exact = draft.pending ?? action;
    keep({ ...draft, pending: exact });
    setBusy(true);
    setError("");
    setNotice("");
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
        setNotice("Your edits are saved. Recalculate or run it to check them.");
      } else if (exact.kind === "accept") {
        const saved = await productApi.accept(
          ws,
          exact.pid,
          exact.id,
          exact.base,
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
        router.push(`/conversations/${cid}`);
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
  const statusText = verified
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
        <h1>{saved.title}</h1>
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

      {pendingProposals.map((p) => {
        const outdated = p.base_revision_id !== artifact.current_revision_id;
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
            <p className="eyebrow-caps">Waiting for you</p>
            <h2 id={`proposal-${p.id}`}>
              {outdated
                ? "This proposal is out of date"
                : "A proposed version is ready"}
            </h2>
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
              {outdated ? null : (
                <button
                  className="btn btn-on-soft"
                  disabled={locked || dirty}
                  onClick={() =>
                    void submit({
                      kind: "accept",
                      id: crypto.randomUUID(),
                      pid: p.id,
                      base: artifact.current_revision_id,
                    })
                  }
                >
                  Apply proposed version
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
                  Edit the raw values or notes. Calculated columns update when
                  you recalculate.
                  <span className="scroll-cue" aria-hidden="true">
                    {" "}
                    Scroll sideways for more columns →
                  </span>
                </p>
                <div
                  className="product-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Editable invoice table"
                >
                  <table>
                    <thead>
                      <tr>
                        {draft.body.columns.map((c) => (
                          <th
                            key={c}
                            scope="col"
                            data-derived={
                              DERIVED_COLUMNS.includes(c) ? "true" : undefined
                            }
                          >
                            {columnLabel(c)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.body.rows.map((row, i) => (
                        <tr
                          key={i}
                          data-discrepancy={
                            row["check"] === "discrepancy" ? "true" : undefined
                          }
                        >
                          {draft.body.kind === "table" &&
                            draft.body.columns.map((c) => (
                              <td
                                key={c}
                                data-derived={
                                  DERIVED_COLUMNS.includes(c)
                                    ? "true"
                                    : undefined
                                }
                              >
                                {DERIVED_COLUMNS.includes(c) ? (
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
                                    value={row[c]}
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
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
            <label className="field">
              <span className="field-label">Your notes (one per line)</span>
              <textarea
                value={(draft.body.notes ?? []).join("\n")}
                onChange={(e) => {
                  if (draft.body.kind !== "file")
                    keep({
                      ...draft,
                      body: {
                        ...draft.body,
                        notes: e.target.value ? e.target.value.split("\n") : [],
                      },
                    });
                }}
              />
            </label>
          </fieldset>
          <div className="row product-actions">
            {dirty ? (
              <button
                className="btn btn-primary"
                disabled={locked || Boolean(inputsError)}
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
            ) : (
              <button
                className="btn btn-primary"
                disabled={locked || changed || !data.open}
                onClick={run}
              >
                {runLabel}
              </button>
            )}
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
            {dirty
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
                {r.author_kind === "human" ? "your edit" : "calculated"}
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
      <p className="small muted" data-testid="proposal-inputs">
        {inputs.map((x) => `${x.label} ${x.value}`).join(" · ")}
      </p>
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
          <p className="small muted">
            {toolInputs(body)
              .map((x) => `${x.label} ${x.value}`)
              .join(" · ")}
          </p>
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
  return (
    <fieldset className="tool-inputs stack-sm">
      <legend className="field-label">Inputs</legend>
      {rows.map((r, i) => (
        <div key={i} className="tool-input-row">
          <input
            aria-label={`Input ${i + 1} name`}
            value={r.label}
            placeholder="Name"
            onChange={(e) =>
              change(
                rows.map((x, n) =>
                  n === i ? { ...x, label: e.target.value } : x,
                ),
              )
            }
          />
          <input
            aria-label={r.label.trim() || `Input ${i + 1} value`}
            inputMode="numeric"
            value={r.value}
            placeholder="0"
            onChange={(e) =>
              change(
                rows.map((x, n) =>
                  n === i ? { ...x, value: e.target.value } : x,
                ),
              )
            }
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
          onClick={() => change([...rows, { name: "", label: "", value: "" }])}
        >
          Add an input
        </button>
      </div>
      {error ? (
        <p role="alert" className="small">
          {error}
        </p>
      ) : (
        <p className="hint">Whole numbers only. Up to eight inputs.</p>
      )}
    </fieldset>
  );
}
