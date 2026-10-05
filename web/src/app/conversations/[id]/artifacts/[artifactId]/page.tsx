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
import { ObservedOutput } from "@/components/ObservedOutput";

type Data = {
  artifact: S["Artifact"];
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
        proposals,
        history,
        observations,
        version: conversation.conversation.work_version,
        open: conversation.conversation.state === "open",
      };
    },
  );
  return (
    <div className="agent-col product-page">
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
        <ProductEditor
          key={`${ws}:${id}:${artifactId}`}
          ws={ws!}
          cid={id}
          data={resource.data}
          stale={resource.reconnecting}
          refresh={resource.refresh}
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
        setNotice("Your edits are saved. Re-run to verify the saved version.");
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
        setNotice("Exact proposed version accepted.");
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
  return (
    <div className="stack">
      <header className="stack-sm">
        <h1>{artifact.current_revision.body.title}</h1>
        <p className="small muted">
          {draft.body.kind} · Controlled local work · No model was called
        </p>
      </header>
      <p role="status" data-testid="product-verification">
        {verified
          ? dirty
            ? "Saved revision verified; your unsaved draft is not verified."
            : "Current saved revision verified"
          : "No current verified result for this saved version"}
      </p>
      {stale ? (
        <p role="alert">
          Connection lost. Previously read state is shown; mutations are
          disabled until refreshed.
        </p>
      ) : null}
      {changed ? (
        <p role="alert">
          The saved version changed. Your draft is retained. Reload the saved
          version or review the conflict before saving.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="row">
        <button className="btn" onClick={() => void refresh()}>
          Refresh saved state
        </button>
        <button
          className="btn"
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
      </div>
      {observations.map((read) => (
        <ObservedOutput
          key={read.observation.id}
          artifact={artifact}
          read={read}
          stale={stale}
        />
      ))}
      {draft.body.kind === "file" ? (
        <ProductView body={draft.body} />
      ) : (
        <>
          <fieldset disabled={locked} className="stack">
            {draft.body.kind === "table" ? (
              <>
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
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.body.rows.map((row, i) => (
                        <tr key={i}>
                          {draft.body.kind === "table" &&
                            draft.body.columns.map((c) => (
                              <td key={c}>
                                {[
                                  "calculated_total",
                                  "difference",
                                  "check",
                                ].includes(c) ? (
                                  row[c]
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
                  <span>Rounding</span>
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
                    <option>ROUND_HALF_UP</option>
                    <option>ROUND_HALF_EVEN</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>WebAssembly text (WAT)</span>
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
                  <span>Entrypoint</span>
                  <input
                    value={draft.body.entrypoint}
                    onChange={(e) => {
                      if (draft.body.kind === "tool")
                        keep({
                          ...draft,
                          body: { ...draft.body, entrypoint: e.target.value },
                        });
                    }}
                  />
                </label>
                <p className="hint">
                  Import-free i64 inputs/return only. Saving code does not
                  execute it.
                </p>
                <ToolInputs
                  key={`${draft.base}:${inputReset}`}
                  body={draft.body}
                  update={(body) => keep({ ...draft, body })}
                />
              </>
            )}
            <label className="field">
              <span>Human notes (one per line)</span>
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
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={locked || !dirty}
              onClick={() =>
                void submit({
                  kind: "save",
                  id: crypto.randomUUID(),
                  base: draft.base,
                  body: structuredClone(draft.body),
                })
              }
            >
              Save human edits
            </button>
            <button
              className="btn"
              disabled={locked || dirty || changed || !data.open}
              onClick={run}
            >
              {draft.body.kind === "table"
                ? "Recalculate saved rows"
                : "Run saved tool"}
            </button>
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
              Discard draft and reload saved version
            </button>
          </div>
        </>
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
      {data.proposals
        .filter((p) => p.status === "pending")
        .map((p) => (
          <section
            key={p.id}
            className="card stack"
            data-testid="product-proposal"
          >
            <h2>Proposed version</h2>
            <p>{p.reason}</p>
            {isProduct(p.body) ? (
              <>
                <ProductView body={p.body} />
                {p.body.kind !== "file" ? (
                  <p>Human notes: {(p.body.notes ?? []).join("; ")}</p>
                ) : null}
              </>
            ) : null}
            <button
              className="btn btn-primary"
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
              Accept exact proposed version
            </button>
            {p.base_revision_id !== artifact.current_revision_id ? (
              <p role="status">
                Saved version changed; this proposal cannot overwrite it.
              </p>
            ) : null}
          </section>
        ))}
      <details>
        <summary>Saved history and original input</summary>
        {data.history.map((r) => (
          <section key={r.id}>
            <h3>
              Revision {r.revision_number} · {r.author_kind}
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
      </details>
    </div>
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
        className="btn"
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
