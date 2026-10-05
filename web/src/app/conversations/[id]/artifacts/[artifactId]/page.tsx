"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useWorkspace } from "@/lib/client/workspace";
import { useResource } from "@/lib/client/hooks";
import { conversationApi } from "@/lib/client/real-api";
import {
  currentObservation,
  resolveObservations,
  formInputs,
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
  | { kind: "run"; id: string; version: number; operation: Operation };
type Draft = { base: string; body: ProductBody; pending: Pending | null };
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
            />
          }
          agent={
            <ConversationPeek
              conversation={resource.data.conversation}
              artifactId={artifactId}
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
}: {
  ws: string;
  cid: string;
  data: Data;
  stale: boolean;
  refresh: () => Promise<unknown>;
}) {
  const router = useRouter();
  const artifact = data.artifact;
  const key = `workagent:product:${ws}:${cid}:${artifact.id}`;
  const [draft, setDraft] = useState<Draft>(() => readDraft(key, artifact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty =
    JSON.stringify(draft.body) !==
    JSON.stringify(artifact.current_revision.body);
  const changed = draft.base !== artifact.current_revision_id;
  const verified =
    currentObservation(artifact, data.observations.current) && !stale;
  const [inputReset, setInputReset] = useState(0);
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
    if (busy) return;
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
            {kindLabel} · calculated locally, no model involved
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

      {pendingProposals.map((p) => (
        <section
          key={p.id}
          className="card decision-card product-proposal"
          data-testid="product-proposal"
          aria-labelledby={`proposal-${p.id}`}
        >
          <p className="eyebrow-caps">Waiting for you</p>
          <h2 id={`proposal-${p.id}`}>A proposed version is ready</h2>
          <p className="small">{p.reason}</p>
          {isProduct(p.body) ? (
            <>
              {p.body.kind === "table" ? (
                <p className="decision-question">
                  {tableSummary(p.body).headline}
                </p>
              ) : null}
              <details className="ids-details">
                <summary>See the proposed version</summary>
                <ProductView body={p.body} />
                {p.body.kind !== "file" ? (
                  <p className="small">
                    Your notes kept: {(p.body.notes ?? []).join("; ") || "none"}
                  </p>
                ) : null}
              </details>
            </>
          ) : null}
          <div className="row">
            <button
              className="btn btn-on-soft"
              disabled={
                locked ||
                dirty ||
                p.base_revision_id !== artifact.current_revision_id
              }
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
          </div>
          {p.base_revision_id !== artifact.current_revision_id ? (
            <p role="status" className="small">
              Your saved version changed since this was proposed, so it can’t
              replace it.
            </p>
          ) : dirty ? (
            <p className="small">Save or discard your changes first.</p>
          ) : null}
        </section>
      ))}

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
                  key={`${draft.base}:${inputReset}`}
                  body={draft.body}
                  update={(body) => keep({ ...draft, body })}
                />
                <details className="disclosure tool-code" open>
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
                disabled={locked}
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
                setInputReset((n) => n + 1);
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
  const output = read?.observation.output;
  const where =
    !read || current
      ? null
      : read.binding_state === "pending_proposal"
        ? "This result is for the proposed version below."
        : "This result is from an earlier version.";
  return (
    <section className="card result-card" aria-labelledby="result-title">
      <h2 id="result-title" className="sr-only">
        Result
      </h2>
      {body.kind === "table" ? (
        (() => {
          const t = tableSummary(body);
          return (
            <>
              <p className="result-headline">{t.headline}</p>
              {t.calculated && t.reportedTotal && t.calculatedTotal ? (
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
              "Not run yet."
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
function ToolInputs({
  body,
  update,
}: {
  body: S["ToolBody"];
  update: (b: S["ToolBody"]) => void;
}) {
  const [labels, setLabels] = useState(
    body.input_form.map((f) => f.label).join(","),
  );
  const [values, setValues] = useState(body.arguments.join(","));
  const [error, setError] = useState("");
  return (
    <div className="stack">
      <p className="small">
        Saved inputs:{" "}
        {body.input_form
          .map((f, i) => `${f.label}: ${body.arguments[i]}`)
          .join(" · ")}
      </p>
      <label className="field">
        <span>Input labels (comma-separated)</span>
        <input value={labels} onChange={(e) => setLabels(e.target.value)} />
      </label>
      <label className="field">
        <span>Integer inputs (comma-separated)</span>
        <input value={values} onChange={(e) => setValues(e.target.value)} />
      </label>
      <button
        className="btn btn-sm tool-apply"
        type="button"
        onClick={() => {
          try {
            update({ ...body, ...formInputs(values, labels) });
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid inputs");
          }
        }}
      >
        Apply input form to draft
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
