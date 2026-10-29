/**
 * View mapping for the generated ToolAttemptView/ToolObservationV1 shapes.
 * Everything shown is what the adapter recorded; nothing here claims model
 * execution (verification_scope is adapter_execution_only).
 */
import type { components } from "../../../contracts/src/client";
import { githubReceipt, isGitHubAttempt } from "./github-receipt";

type S = components["schemas"];
export type ToolAttemptView = S["ToolAttemptView"];
export type ToolObservationV1 = S["ToolObservationV1"];

export interface ToolAttemptRow {
  attemptId: string;
  capability: string;
  /** Short human state; outcome_unknown stays visibly unknown, never retried. */
  stateLabel: string;
  tone: "ok" | "failed" | "unknown" | "pending";
  started: string | null;
  ended: string | null;
  costLine: string | null;
  omissions: string[];
  truncated: boolean;
  errorLabel: string | null;
}

const STATE_LABELS: Record<ToolAttemptView["state"], string> = {
  reserved: "Reserved",
  dispatched: "Dispatched",
  // Observed means a receipt was recorded — not that the work succeeded.
  observed: "Receipt recorded",
  failed: "Failed",
  cost_only: "Cost recorded, output not kept",
  outcome_unknown: "Outcome unknown — not retried automatically",
};

const ERROR_LABELS: Record<string, string> = {
  adapter_failed: "The tool itself failed",
  invalid_output: "The tool returned output that failed validation",
  authority_changed: "Authority changed before the call finished",
  outcome_unknown: "The outcome could not be confirmed",
};

export function toolAttemptRow(
  attempt: ToolAttemptView,
  ws?: string,
): ToolAttemptRow {
  const base = baseRow(attempt);
  if (ws !== undefined && isGitHubAttempt(attempt)) {
    // A recorded receipt for a rate-limited/unavailable call is not success.
    const g = githubReceipt(attempt, ws);
    return {
      ...base,
      stateLabel: g.headline,
      tone:
        g.kind === "withheld"
          ? base.tone
          : g.kind === "result" && g.ok
            ? "ok"
            : g.kind === "result" &&
                (g.status === "not_found" || g.status === "denied")
              ? "failed"
              : "unknown",
    };
  }
  if (!isComputeAttempt(attempt) || ws === undefined) return base;
  const c = computeReceipt(attempt, ws);
  return {
    ...base,
    stateLabel: c.headline,
    tone:
      c.kind === "run" && c.ok
        ? "ok"
        : c.kind === "unverified" ||
            c.kind === "unavailable" ||
            (c.kind === "run" && c.run.status === "unavailable")
          ? "unknown"
          : c.kind === "withheld"
            ? base.tone
            : "failed",
  };
}

function baseRow(attempt: ToolAttemptView): ToolAttemptRow {
  const o = attempt.observation;
  return {
    attemptId: attempt.attempt_id,
    capability: attempt.capability_id,
    stateLabel: STATE_LABELS[attempt.state],
    tone:
      attempt.state === "observed"
        ? "ok"
        : attempt.state === "failed" || attempt.state === "cost_only"
          ? "failed"
          : attempt.state === "outcome_unknown"
            ? "unknown"
            : "pending",
    started: o?.started_at ?? null,
    ended: o?.ended_at ?? null,
    costLine: o ? costLine(o.cost) : null,
    omissions: o?.omissions ?? [],
    truncated: o?.truncated ?? false,
    errorLabel: o?.error ? (ERROR_LABELS[o.error.code] ?? o.error.code) : null,
  };
}

/** Reserved vs observed cost stay distinct; an unknown basis says so. */
export function costLine(cost: S["ToolCostV1"]): string {
  const unit = cost.unit === "call" ? "call" : "ms";
  const reserved = `reserved ${cost.reserved_cost_usd} USD (${cost.reserved_units} ${unit})`;
  if (cost.observed_cost_usd != null)
    return `${reserved}; observed ${cost.observed_cost_usd} USD (${cost.basis})`;
  if (cost.basis === "unknown") return `${reserved}; observed cost unknown`;
  return `${reserved}; basis ${cost.basis}`;
}

/* ---------------------------------------------------------------------------
 * compute.python receipts. The observation's `output` is an untyped record, so
 * it is validated here field by field and copied into a frozen projection; the
 * original object is never reread. An observed attempt only means a receipt was
 * recorded — the computation itself may have failed, hit a limit or been
 * unavailable, and even a clean run is not verification of the user's goal.
 * ------------------------------------------------------------------------- */

// model_base.Hash / model_base.Id (min 1, max 128).
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
// workspace_file_models.Filename (the compute exporter's text formats).
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(txt|md|markdown|csv|json)$/;
const FORMATS = ["txt", "markdown", "csv", "json"] as const;
type Format = (typeof FORMATS)[number];
// artifact_exports.FORMATS; the exporter derives format from the suffix.
const FORMAT_MIME: Record<Format, string> = {
  txt: "text/plain",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
const SUFFIX_FORMAT: Record<string, Format> = {
  txt: "txt",
  md: "markdown",
  markdown: "markdown",
  csv: "csv",
  json: "json",
};
// sandbox/profiles: STREAM_BYTES, INPUT_BYTES, OUTPUT_FILES; ComputeInput.name.
// A UTF-16 length never exceeds the UTF-8 byte length, so this is a safe bound.
const STREAM_MAX = 128 * 1024;
const INPUT_BYTES = 1024 * 1024;
const MAX_FILES = 8;
const INPUT_NAME_MAX = 80;
// ComputeResult.runtime_version/image and manifest omissions are unbounded in
// the schema (the sandbox client pins exact values); these are display bounds.
const META_MAX = 512;
const STATUSES = [
  "succeeded",
  "failed",
  "wall_limit",
  "cpu_limit",
  "output_limit",
  "cancelled",
  "unavailable",
] as const;
type ComputeStatus = (typeof STATUSES)[number];
/** Display cap per stream; the backend bounds output, this bounds the DOM. */
export const STREAM_DISPLAY_CHARS = 20000;

export interface ComputeDownload {
  exportId: string;
  filename: string;
  format: Format;
  sha256: string;
  /** Hash of the original sandbox bytes before safe rendering (e.g. CSV escaping). */
  sandboxSha256: string;
  byteLength: number;
  mimeType: string;
  blobId: string;
  omissions: string[];
}

export interface RefView {
  kind: string;
  id: string;
  version: string;
  sha256: string;
}

export interface ComputeRun {
  status: ComputeStatus;
  exitCode: number | null;
  profile: string;
  profileSha256: string;
  runtimeVersion: string;
  image: string;
  codeSha256: string;
  inputs: { name: string; sha256: string; bytes: number }[];
  stdout: string;
  stderr: string;
  elapsedMs: number;
  resources: {
    cpuUsec: number;
    memoryPeakBytes: number;
    oomKill: number;
    pidsPeak: number;
  };
  omissions: string[];
  downloads: ComputeDownload[];
}

export type ComputeReceipt =
  /** Missing, malformed or self-contradictory: never presented as success. */
  | { kind: "unverified"; headline: string; reason: string }
  /** Attempt never reached a kept receipt (cost_only, unknown, pending…). */
  | { kind: "withheld"; headline: string; reason: string }
  | { kind: "unavailable"; headline: string; omissions: string[] }
  | { kind: "run"; headline: string; ok: boolean; run: ComputeRun };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 4096): v is string =>
  typeof v === "string" && v.length <= max;
const nat = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const strList = (v: unknown, maxItems: number): string[] | null =>
  Array.isArray(v) && v.length <= maxItems && v.every((s) => str(s, 2000))
    ? [...(v as string[])]
    : null;

class Malformed extends Error {}

/** Canonical copy of a capabilities.models.InputRef; extra fields refused. */
function parseRef(v: unknown, what: string): RefView {
  need(isRec(v), what);
  const r = v as Rec;
  need(Object.keys(r).length === 4, what);
  need(str(r.kind) && ID.test(r.kind), `${what} kind`);
  need(str(r.id) && ID.test(r.id), `${what} id`);
  need(str(r.version) && ID.test(r.version), `${what} version`);
  need(str(r.sha256) && HASH.test(r.sha256), `${what} sha256`);
  return Object.freeze({
    kind: r.kind as string,
    id: r.id as string,
    version: r.version as string,
    sha256: r.sha256 as string,
  });
}
function parseRefs(v: unknown, what: string, max = 100): RefView[] {
  need(Array.isArray(v) && v.length <= max, what);
  return (v as unknown[]).map((x) => parseRef(x, what));
}
const sameRefs = (a: RefView[], b: RefView[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.kind === b[i]!.kind &&
      x.id === b[i]!.id &&
      x.version === b[i]!.version &&
      x.sha256 === b[i]!.sha256,
  );

interface Binding {
  ws: string;
  runId: string;
  attemptId: string;
  /** The call's own refs (observation.source_refs), in order. */
  sourceRefs: RefView[];
}
function need<T>(v: T | null | false | undefined, what: string): T {
  if (v === null || v === false || v === undefined) throw new Malformed(what);
  return v;
}

const LIMIT_LABEL: Record<ComputeStatus, string> = {
  succeeded: "Ran to completion",
  failed: "Computation failed",
  wall_limit: "Stopped: wall-clock limit reached",
  cpu_limit: "Stopped: CPU limit reached",
  output_limit: "Stopped: output limit reached",
  cancelled: "Cancelled",
  // A full receipt with status "unavailable" can follow real execution (the
  // isolation service failed while collecting or cleaning up), so this never
  // claims that nothing ran.
  unavailable: "Isolation service became unavailable — outcome uncertain",
};

function parseDownload(
  m: unknown,
  scope: Binding,
  result: { codeSha256: string; profileSha256: string },
): ComputeDownload {
  need(isRec(m), "output manifest");
  const r = m as Rec;
  need(r.exporter_version === "compute-python-v1", "exporter version");
  need(str(r.export_id) && ID.test(r.export_id), "export id");
  // Read authority: a manifest for another workspace/run/attempt is refused.
  need(r.workspace_id === scope.ws, "output workspace");
  need(r.run_id === scope.runId, "output run");
  need(r.tool_attempt_id === scope.attemptId, "output attempt");
  // Provenance: the manifest must describe this run's code, profile and inputs.
  need(r.code_sha256 === result.codeSha256, "output code hash");
  need(r.profile_sha256 === result.profileSha256, "output profile hash");
  need(
    sameRefs(parseRefs(r.input_refs, "output input ref"), scope.sourceRefs),
    "output inputs",
  );
  need(str(r.sandbox_sha256) && HASH.test(r.sandbox_sha256), "sandbox hash");
  need(str(r.filename) && FILENAME.test(r.filename), "output filename");
  need(FORMATS.includes(r.format as never), "output format");
  const suffix = (r.filename as string).split(".").pop()!;
  need(SUFFIX_FORMAT[suffix] === r.format, "output filename format");
  const b = need(isRec(r.blob) && r.blob, "output blob");
  need(b.kind === "generated_blob", "blob kind");
  need(str(b.blob_id) && ID.test(b.blob_id), "blob id");
  need(str(b.sha256) && HASH.test(b.sha256), "blob sha256");
  need(nat(b.byte_length, 1048576), "blob length");
  need(b.mime_type === FORMAT_MIME[r.format as Format], "blob mime");
  return Object.freeze({
    exportId: r.export_id as string,
    filename: r.filename as string,
    format: r.format as ComputeDownload["format"],
    sha256: b.sha256 as string,
    sandboxSha256: r.sandbox_sha256 as string,
    byteLength: b.byte_length as number,
    mimeType: b.mime_type as string,
    blobId: b.blob_id as string,
    omissions: need(strList(r.omissions, 20), "output omissions"),
  });
}

function parseRun(r: Rec, scope: Binding): ComputeRun {
  need(r.version === 1, "result version");
  need(r.profile === "python-analysis-v1", "profile");
  need(STATUSES.includes(r.status as never), "status");
  need(r.exit_code === null || Number.isSafeInteger(r.exit_code), "exit code");
  for (const k of ["profile_sha256", "code_sha256"] as const)
    need(str(r[k]) && HASH.test(r[k]), k);
  need(str(r.runtime_version, META_MAX) && str(r.image, META_MAX), "runtime");
  need(str(r.stdout, STREAM_MAX) && str(r.stderr, STREAM_MAX), "streams");
  need(nat(r.elapsed_ms, 60000), "elapsed");
  need(r.cleanup_verified === true, "cleanup receipt");
  const res = need(isRec(r.resources) && r.resources, "resources");
  for (const k of ["cpu_usec", "memory_peak_bytes", "oom_kill", "pids_peak"])
    need(nat(res[k]), `resources.${k}`);
  const inputs = need(
    Array.isArray(r.inputs) && r.inputs.length <= MAX_FILES && r.inputs,
    "inputs",
  ).map((i) => {
    need(isRec(i), "input");
    const x = i as Rec;
    need(
      str(x.name, INPUT_NAME_MAX) && str(x.sha256) && HASH.test(x.sha256),
      "input",
    );
    need(nat(x.bytes, INPUT_BYTES), "input bytes");
    return Object.freeze({
      name: x.name as string,
      sha256: x.sha256 as string,
      bytes: x.bytes as number,
    });
  });
  const outs = need(
    Array.isArray(r.outputs) && r.outputs.length <= MAX_FILES && r.outputs,
    "outputs",
  );
  return Object.freeze({
    status: r.status as ComputeStatus,
    exitCode: r.exit_code as number | null,
    profile: r.profile as string,
    profileSha256: r.profile_sha256 as string,
    runtimeVersion: r.runtime_version as string,
    image: r.image as string,
    codeSha256: r.code_sha256 as string,
    inputs: Object.freeze(inputs) as ComputeRun["inputs"],
    stdout: r.stdout as string,
    stderr: r.stderr as string,
    elapsedMs: r.elapsed_ms as number,
    resources: Object.freeze({
      cpuUsec: res.cpu_usec as number,
      memoryPeakBytes: res.memory_peak_bytes as number,
      oomKill: res.oom_kill as number,
      pidsPeak: res.pids_peak as number,
    }),
    omissions: need(strList(r.omissions, 20), "omissions"),
    downloads: Object.freeze(
      outs.map((m) =>
        parseDownload(m, scope, {
          codeSha256: r.code_sha256 as string,
          profileSha256: r.profile_sha256 as string,
        }),
      ),
    ) as ComputeDownload[],
  });
}

export function isComputeAttempt(attempt: ToolAttemptView): boolean {
  return attempt.capability_id === "compute.python";
}

/**
 * Validated, frozen projection of a compute.python attempt. `ws` is the
 * workspace the attempts were read under; manifests outside it are refused.
 */
export function computeReceipt(
  attempt: ToolAttemptView,
  ws: string,
): ComputeReceipt {
  const o = attempt.observation;
  if (attempt.state !== "observed" || o?.status !== "observed") {
    const why =
      attempt.state === "cost_only"
        ? "Cost was recorded but no result was kept, so nothing is downloadable."
        : attempt.state === "outcome_unknown"
          ? "The outcome could not be confirmed; no result is shown or offered."
          : attempt.state === "failed"
            ? "The tool call failed before a result receipt was recorded."
            : "No result receipt has been recorded yet.";
    return Object.freeze({
      kind: "withheld",
      headline: "No computation result",
      reason: why,
    });
  }
  const unverified = (reason: string): ComputeReceipt =>
    Object.freeze({
      kind: "unverified",
      headline: "Receipt recorded — result unverified",
      reason,
    });
  // Identity: the observation must belong to exactly this attempt.
  if (
    o.schema_version !== "tool-observation/v1" ||
    o.capability_id !== "compute.python" ||
    attempt.capability_id !== "compute.python" ||
    o.attempt_id !== attempt.attempt_id ||
    o.call_id !== attempt.call_id ||
    o.run_id !== attempt.run_id
  )
    return unverified(
      "The recorded observation does not match this tool call, so its result is not shown.",
    );
  const out = o.output;
  if (!isRec(out)) return unverified("No computation result was recorded.");
  if (out.capability !== "compute_python" || out.version !== "1")
    return unverified(
      "The recorded result is not a recognised compute receipt.",
    );
  const r = out.result;
  if (!isRec(r)) return unverified("The recorded result is missing.");
  try {
    // The broker records [run_scope, ...call refs] as input_refs and the call
    // refs alone as source_refs; generated files must cite the same refs.
    const sourceRefs = parseRefs(o.source_refs, "source ref");
    const inputRefs = parseRefs(o.input_refs, "input ref");
    need(
      inputRefs.length > 0 &&
        inputRefs[0]!.kind === "run_scope" &&
        inputRefs[0]!.id === attempt.run_id &&
        sameRefs(inputRefs.slice(1), sourceRefs),
      "observation input refs",
    );
    const scope: Binding = {
      ws,
      runId: attempt.run_id,
      attemptId: attempt.attempt_id,
      sourceRefs,
    };
    if (r.status === "unavailable" && !("version" in r)) {
      const omissions = need(strList(r.omissions, 20), "omissions");
      need(Array.isArray(r.outputs) && r.outputs.length === 0, "outputs");
      need(parseRefs(o.output_refs, "output ref").length === 0, "output refs");
      return Object.freeze({
        kind: "unavailable",
        // Short ComputeUnavailable form: no execution receipt exists, but that
        // alone does not prove nothing ran, so no such claim is made.
        headline: "Compute unavailable — no execution receipt",
        omissions,
      });
    }
    const run = parseRun(r, scope);
    // output_refs must list exactly the generated files, in order.
    need(
      sameRefs(
        parseRefs(o.output_refs, "output ref"),
        run.downloads.map((d) => ({
          kind: "generated_blob",
          id: d.blobId,
          version: d.exportId,
          sha256: d.sha256,
        })),
      ),
      "observation output refs",
    );
    if (run.status === "succeeded" && run.exitCode !== 0)
      return unverified(
        `The receipt says the run succeeded but recorded exit code ${run.exitCode ?? "none"}; it is treated as unverified.`,
      );
    if (run.status === "failed" && run.exitCode === 0)
      return unverified(
        "The receipt says the run failed but recorded exit code 0; it is treated as unverified.",
      );
    const ok = run.status === "succeeded";
    const exit =
      run.exitCode === null ? "no exit code" : `exit ${run.exitCode}`;
    return Object.freeze({
      kind: "run",
      ok,
      headline: `${LIMIT_LABEL[run.status]} (${exit})`,
      // Files kept from a failed run are retained diagnostics; the headline
      // still reports the failure.
      run,
    });
  } catch (e) {
    if (e instanceof Malformed)
      return unverified(
        `The recorded result failed validation (${e.message}).`,
      );
    throw e;
  }
}

const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
/**
 * Inert display text for untrusted streams: rendered only as a React text node
 * (never Markdown/HTML). Bidi controls are made visible so output cannot
 * visually reorder itself, and length is capped for the DOM.
 */
export function inertStream(s: string): { text: string; clipped: boolean } {
  const clipped = s.length > STREAM_DISPLAY_CHARS;
  const body = clipped ? s.slice(0, STREAM_DISPLAY_CHARS) : s;
  return {
    text: body.replace(
      BIDI,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ),
    clipped,
  };
}

/**
 * Read-authority guard for on-demand loads: a response is applied only if it
 * belongs to the latest request for the same workspace+run.
 */
export function scopedRequests() {
  let seq = 0;
  let key: string | null = null;
  return {
    begin(ws: string, runId: string) {
      seq += 1;
      key = `${ws}\u0000${runId}`;
      return { seq, key };
    },
    isCurrent(t: { seq: number; key: string }, ws: string, runId: string) {
      return t.seq === seq && t.key === key && t.key === `${ws}\u0000${runId}`;
    },
    invalidate() {
      seq += 1;
      key = null;
    },
  };
}

/**
 * Receipts withdrawn after a failed or refused download, keyed by
 * workspace+run+attempt. A withdrawn receipt shows no output or file controls
 * until an explicit refresh succeeds; any scope change also drops the map.
 */
export type Withdrawn = ReadonlyMap<string, string>;
export const receiptKey = (ws: string, runId: string, attemptId: string) =>
  `${ws}\u0000${runId}\u0000${attemptId}`;
export const DOWNLOAD_WITHDRAWN =
  "A download from this result was refused or failed verification, so its output and files are hidden. Refresh to load the current record.";
export function withdrawReceipt(
  w: Withdrawn,
  key: string,
  reason: string,
): Withdrawn {
  const next = new Map(w);
  next.set(key, reason);
  return next;
}
