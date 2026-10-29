"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { downloadVerifiedExport } from "@/lib/client/workspace-files";
import { describeError } from "@/lib/contract/errors";
import {
  inertStream,
  type ComputeDownload,
  type ComputeReceipt as Receipt,
} from "@/lib/tool-activity";

const PRE: CSSProperties = {
  maxHeight: 240,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  maxWidth: "100%",
  margin: 0,
  fontSize: 12,
};
const WRAP: CSSProperties = { overflowWrap: "anywhere", minWidth: 0 };

/** Untrusted output as a plain text node — never Markdown or HTML. */
function Stream({ label, value }: { label: string; value: string }) {
  if (value === "") return <p className="small muted">{label}: (empty)</p>;
  const { text, clipped } = inertStream(value);
  return (
    <div style={WRAP}>
      <p className="small muted">{label}</p>
      <pre style={PRE}>{text}</pre>
      {clipped ? (
        <p className="small muted">Display clipped; the receipt holds more.</p>
      ) : null}
    </div>
  );
}

/**
 * Honest view of one validated compute.python receipt. A clean run is still
 * only a record that code ran — it does not verify the user's goal.
 */
export function ComputeReceipt({
  ws,
  receipt,
  onInvalidate,
}: {
  ws: string;
  receipt: Receipt;
  /** Withdraw this receipt (output and file controls) after a failed download. */
  onInvalidate: (reason: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // The parent remounts this per workspace+run+refresh; a download that
  // settles after unmount is never offered or reported.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function download(d: ComputeDownload) {
    setBusy(d.exportId);
    try {
      const bytes = await downloadVerifiedExport(ws, d.exportId, {
        kind: "generated_blob",
        blob_id: d.blobId,
        sha256: d.sha256,
        byte_length: d.byteLength,
        mime_type: d.mimeType,
      });
      if (!alive.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: d.mimeType }));
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = d.filename;
        a.rel = "noopener";
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (e) {
      if (!alive.current) return;
      // Any failure (404/refusal, changed source, hash mismatch, transport)
      // withdraws the whole receipt rather than leaving it looking current.
      const x = describeError(e);
      onInvalidate(`${x.title}. ${x.nextAction}`);
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  if (receipt.kind !== "run")
    return (
      <div className="stack-sm" style={WRAP} data-testid="compute-receipt">
        {receipt.kind === "unavailable" ? (
          receipt.omissions.length > 0 ? (
            <p className="small muted">{receipt.omissions.join("; ")}</p>
          ) : null
        ) : (
          <p className="small">{receipt.reason}</p>
        )}
      </div>
    );

  const r = receipt.run;
  return (
    <div className="stack-sm" style={WRAP} data-testid="compute-receipt">
      <p className="small muted">
        {receipt.ok
          ? "The code ran and exited cleanly. That is a record of execution, not a check that the result is right."
          : "The computation did not complete successfully; its output and any files it left are kept as diagnostics, not results."}
      </p>
      <Stream label="Output (stdout)" value={r.stdout} />
      {r.stderr !== "" ? (
        <Stream label="Errors (stderr)" value={r.stderr} />
      ) : null}
      {r.downloads.length > 0 ? (
        <ul className="stack-sm" style={{ listStyle: "none", padding: 0 }}>
          {r.downloads.map((d) => (
            <li key={d.exportId} style={WRAP}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={() => void download(d)}
              >
                {busy === d.exportId
                  ? "Checking…"
                  : `Download ${d.filename}${receipt.ok ? "" : " (diagnostic)"}`}
              </button>
              <p className="small muted" style={WRAP}>
                {d.byteLength} bytes · sha256 {d.sha256}
                {d.sandboxSha256 !== d.sha256
                  ? ` · original sandbox output sha256 ${d.sandboxSha256} (made safe before download)`
                  : null}
              </p>
              {d.omissions.length > 0 ? (
                <p className="small muted">{d.omissions.join("; ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {r.omissions.length > 0 ? (
        <p className="small muted">Not shown: {r.omissions.join("; ")}</p>
      ) : null}
      <details className="ids-details">
        <summary className="small">Run receipt</summary>
        <dl className="small muted" style={WRAP}>
          <dt>Status</dt>
          <dd>
            {r.status}, exit {r.exitCode ?? "none"}, {r.elapsedMs} ms
          </dd>
          <dt>Profile</dt>
          <dd>
            {r.profile} · {r.runtimeVersion} · sha256 {r.profileSha256}
          </dd>
          <dt>Image</dt>
          <dd>{r.image}</dd>
          <dt>Code sha256</dt>
          <dd>{r.codeSha256}</dd>
          <dt>Resources</dt>
          <dd>
            CPU {r.resources.cpuUsec} µs · peak memory{" "}
            {r.resources.memoryPeakBytes} bytes · processes{" "}
            {r.resources.pidsPeak} · OOM kills {r.resources.oomKill}
          </dd>
          {r.inputs.map((i) => (
            <div key={`${i.name}:${i.sha256}`}>
              <dt>Input {i.name}</dt>
              <dd>
                {i.bytes} bytes · sha256 {i.sha256}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
