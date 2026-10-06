"use client";
import { useEffect, useRef, useState } from "react";
import { formInputs, type Operation } from "@/lib/client/products";
import {
  attachmentReader,
  operationJournal,
  type PendingOperation,
} from "@/lib/client/operation-state";
import { conversationApi } from "@/lib/client/real-api";
import { ApiError } from "@/lib/contract/errors";

/** Explicit human operator selection; no frontend execution or inference. */
type Props = {
  ws: string;
  cid: string;
  version: number;
  refresh: () => Promise<unknown>;
};
export function OperationComposer(props: Props) {
  return (
    <ScopedOperationComposer
      key={JSON.stringify([props.ws, props.cid])}
      {...props}
    />
  );
}
function ScopedOperationComposer({ ws, cid, version, refresh }: Props) {
  const [kind, setKind] = useState<"reconcile_csv" | "run_wasm">(
    "reconcile_csv",
  );
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("");
  const [values, setValues] = useState("3,1250");
  const [labels, setLabels] = useState("Quantity,Unit price cents");
  const [entrypoint, setEntrypoint] = useState("total");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState(false);
  const [reader] = useState(attachmentReader);
  const journal = useRef<ReturnType<typeof operationJournal> | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    try {
      journal.current = operationJournal(sessionStorage, ws, cid);
      const saved = journal.current.read();
      setPending(saved);
      if (saved) {
        setFilename(saved.filename);
        const operation = saved.payload.operation!;
        setKind(operation.kind);
        if (operation.kind === "run_wasm") {
          setEntrypoint(operation.entrypoint ?? "total");
          setValues(operation.arguments.join(","));
          setLabels(operation.input_form.map((field) => field.label).join(","));
        }
      }
      setReady(true);
    } catch {
      setError(
        "Operation retry storage unavailable. Restore browser storage and reload before submitting.",
      );
    }
    return () => reader.invalidate();
  }, [ws, cid, reader]);
  async function run() {
    if (inFlight.current || reader.pending || !ready || !journal.current)
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    let exact = pending;
    try {
      if (!exact) {
        const operation: Operation =
          kind === "reconcile_csv"
            ? { kind, input_csv: content, rounding: "ROUND_HALF_UP" }
            : {
                kind,
                code: content,
                entrypoint,
                ...formInputs(values, labels),
              };
        exact = {
          filename,
          payload: {
            command_id: crypto.randomUUID(),
            request_id: crypto.randomUUID(),
            expected_work_version: version,
            text: `Run the explicitly attached ${filename} with the selected ${kind} operator.`,
            operation,
          },
        };
      }
      // The exact input bytes and identity survive both navigation and reload.
      journal.current.keep(exact);
      setPending(exact);
      await conversationApi.send(ws, cid, exact.payload);
      if (journal.current.clear(exact)) {
        setPending(null);
        setContent("");
        setFilename("");
      }
    } catch (e) {
      if (
        exact &&
        e instanceof ApiError &&
        !e.isAmbiguousWrite &&
        e.code !== "command_conflict"
      ) {
        try {
          if (journal.current.clear(exact)) setPending(null);
        } catch {
          // Retain the exact attempt if its durable record could not be cleared.
        }
      }
      setError(e instanceof Error ? e.message : "Could not confirm operation.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    await refresh();
  }
  return (
    <details className="card card-quiet product-composer">
      <summary>Run a local operation</summary>
      <p className="small muted">
        Controlled local execution, not a model reply. CSV reconciliation or
        import-free integer WebAssembly only. No external effects.
      </p>
      <fieldset disabled={!ready || busy || Boolean(pending)} className="stack">
        <label className="field">
          <span>Operation</span>
          <select
            aria-label="Operation"
            value={kind}
            onChange={(e) => {
              reader.invalidate();
              setReading(false);
              setKind(e.target.value as typeof kind);
              setContent("");
              setFilename("");
            }}
          >
            <option value="reconcile_csv">Reconcile invoice CSV</option>
            <option value="run_wasm">Run a WebAssembly tool</option>
          </select>
        </label>
        <label className="field">
          <span>Attach {kind === "reconcile_csv" ? "CSV" : "WAT"} file</span>
          <input
            key={kind}
            type="file"
            accept={kind === "reconcile_csv" ? ".csv" : ".wat"}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setContent("");
              setFilename("");
              setError("");
              reader.invalidate();
              setReading(Boolean(file));
              if (!file) return;
              try {
                const result = await reader.read(file, kind);
                if (!result) return;
                setContent(result.content);
                setFilename(result.filename);
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Attachment rejected.",
                );
              } finally {
                setReading(reader.pending);
              }
            }}
          />
        </label>
        {kind === "run_wasm" ? (
          <>
            <label className="field">
              <span>Entrypoint</span>
              <input
                value={entrypoint}
                onChange={(e) => setEntrypoint(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Input labels (comma-separated)</span>
              <input
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Integer inputs (comma-separated)</span>
              <input
                value={values}
                onChange={(e) => setValues(e.target.value)}
              />
            </label>
          </>
        ) : (
          <p className="hint">
            Required columns: id, quantity, unit_price, reported_total. Other
            columns are retained. Up to 500 rows / 200000 bytes.
          </p>
        )}
      </fieldset>
      {reading ? <p role="status">Reading attachment…</p> : null}
      {pending ? (
        <p role="status">
          Outcome not yet resolved. Inputs are locked; retry sends the saved
          exact operation.
        </p>
      ) : null}
      {filename ? <p className="hint">Attached: {filename}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button
        className="btn btn-primary"
        disabled={!ready || busy || reading || (!content && !pending)}
        onClick={() => void run()}
      >
        {busy
          ? "Submitting…"
          : pending
            ? "Retry same operation"
            : "Run attached input"}
      </button>
    </details>
  );
}
