import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComputeReceipt } from "@/components/ComputeReceipt";
import {
  computeReceipt,
  inertNotes,
  NOTES_DISPLAY_CHARS,
  TRUNCATED_MARK,
  DOWNLOAD_WITHDRAWN,
  receiptKey,
  withdrawReceipt,
  type Withdrawn,
  inertStream,
  scopedRequests,
  STREAM_DISPLAY_CHARS,
  toolAttemptRow,
  type ToolAttemptView,
  type ToolObservationV1,
} from "@/lib/tool-activity";

const H = (c: string) => c.repeat(64);
const WS = "ws1";

const SRC = [
  { kind: "workspace_file", id: "f1", version: "v1", sha256: H("f") },
];
const RUN_SCOPE = { kind: "run_scope", id: "r1", version: "1", sha256: H("9") };
const BLOB_REF = {
  kind: "generated_blob",
  id: "b1",
  version: "e1",
  sha256: H("c"),
};

const manifest = (over: Record<string, unknown> = {}) => ({
  exporter_version: "compute-python-v1",
  export_id: "e1",
  workspace_id: WS,
  conversation_id: "c1",
  run_id: "r1",
  tool_attempt_id: "a1",
  code_sha256: H("a"),
  profile_sha256: H("b"),
  input_refs: SRC,
  format: "csv",
  filename: "totals.csv",
  blob: {
    kind: "generated_blob",
    blob_id: "b1",
    sha256: H("c"),
    byte_length: 12,
    mime_type: "text/csv",
  },
  created_at: "2026-10-28T10:00:01Z",
  annotations: "explicit_omissions",
  omissions: ["Generated output: no independent correctness guarantee"],
  sandbox_sha256: H("d"),
  ...over,
});

const result = (over: Record<string, unknown> = {}) => ({
  version: 1,
  profile: "python-analysis-v1",
  profile_sha256: H("b"),
  runtime_version: "3.12",
  image: "img@sha256:" + H("e"),
  status: "succeeded",
  exit_code: 0,
  code_sha256: H("a"),
  inputs: [{ name: "data.csv", sha256: H("f"), bytes: 40 }],
  stdout: "42\n",
  stderr: "",
  elapsed_ms: 310,
  resources: {
    cpu_usec: 1000,
    memory_peak_bytes: 2048,
    oom_kill: 0,
    pids_peak: 1,
  },
  omissions: [],
  outputs: [manifest()],
  cleanup_verified: true,
  ...over,
});

const attempt = (
  output: unknown,
  over: Partial<ToolAttemptView> = {},
  obs: Record<string, unknown> = {},
): ToolAttemptView =>
  ({
    attempt_id: "a1",
    call_id: "c1",
    capability_id: "compute.python",
    run_id: "r1",
    state: "observed",
    observation: {
      schema_version: "tool-observation/v1",
      attempt_id: "a1",
      call_id: "c1",
      run_id: "r1",
      capability_id: "compute.python",
      status: "observed",
      output,
      input_refs: [RUN_SCOPE, ...SRC],
      source_refs: SRC,
      output_refs: [BLOB_REF],
      cost: {
        basis: "estimated",
        billed_cost_usd: null,
        category: "compute",
        cpu_ms: 1,
        elapsed_ms: 310,
        observed_cost_usd: null,
        observed_units: 1,
        reserved_cost_usd: "0.0010",
        reserved_units: 1,
        unit: "call",
      },
      omissions: [],
      truncated: false,
      error: null,
      started_at: "2026-10-28T10:00:00Z",
      ended_at: "2026-10-28T10:00:01Z",
      ...obs,
    } as unknown as ToolObservationV1,
    ...over,
  }) as ToolAttemptView;

const NO_FILES = { output_refs: [] };

const out = (r: unknown) => ({
  capability: "compute_python",
  version: "1",
  result: r,
});

describe("compute receipts", () => {
  it("a clean run offers the scoped download but is labelled as execution only", () => {
    const c = computeReceipt(attempt(out(result())), WS);
    expect(c.kind).toBe("run");
    if (c.kind !== "run") return;
    expect(c.ok).toBe(true);
    expect(c.headline).toBe("Ran to completion (exit 0)");
    expect(c.run.downloads).toHaveLength(1);
    expect(c.run.downloads[0]?.sha256).toBe(H("c"));
    expect(c.run.downloads[0]?.filename).toBe("totals.csv");
    expect(Object.isFrozen(c.run)).toBe(true);
  });

  it("observed attempt with failed nonzero result is not Completed", () => {
    const a = attempt(
      out(result({ status: "failed", exit_code: 1, stderr: "Traceback" })),
    );
    const row = toolAttemptRow(a, WS);
    expect(row.stateLabel).toBe("Computation failed (exit 1)");
    expect(row.tone).toBe("failed");
    // Files a failed run left are retained diagnostics: offered, never success.
    const c = computeReceipt(a, WS);
    expect(c.kind).toBe("run");
    if (c.kind !== "run") return;
    expect(c.ok).toBe(false);
    expect(c.run.downloads.map((d) => d.filename)).toEqual(["totals.csv"]);
  });

  it("exposes the original sandbox hash next to the download hash", () => {
    const c = computeReceipt(attempt(out(result())), WS);
    expect(c.kind === "run" && c.run.downloads[0]?.sandboxSha256).toBe(H("d"));
  });

  it("limits are named honestly", () => {
    for (const [status, label] of [
      ["wall_limit", "wall-clock limit"],
      ["cpu_limit", "CPU limit"],
      ["output_limit", "output limit"],
    ])
      expect(
        toolAttemptRow(attempt(out(result({ status, exit_code: null }))), WS)
          .stateLabel,
      ).toContain(label);
  });

  it("status/exit mismatch is unverified, never success", () => {
    for (const r of [
      result({ exit_code: 3 }),
      result({ exit_code: null }),
      result({ status: "failed", exit_code: 0 }),
    ]) {
      const row = toolAttemptRow(attempt(out(r)), WS);
      expect(row.stateLabel).toBe("Receipt recorded — result unverified");
      expect(row.tone).toBe("unknown");
    }
  });

  it("binds the observation to the enclosing attempt", () => {
    for (const obs of [
      { attempt_id: "a2" },
      { call_id: "c2" },
      { run_id: "r2" },
      { capability_id: "research.search" },
      { schema_version: "tool-observation/v2" },
    ])
      expect(computeReceipt(attempt(out(result()), {}, obs), WS).kind).toBe(
        "unverified",
      );
    expect(
      computeReceipt(attempt(out(result()), { capability_id: "x.y" }), WS).kind,
    ).toBe("unverified");
  });

  it("generated files must cite this run's code, profile and inputs", () => {
    for (const m of [
      manifest({ code_sha256: H("1") }),
      manifest({ profile_sha256: H("2") }),
      manifest({ input_refs: [] }),
      manifest({ input_refs: [{ ...SRC[0], version: "v2" }] }),
      manifest({ input_refs: [{ ...SRC[0], extra: 1 }] }),
      manifest({ sandbox_sha256: "x" }),
    ])
      expect(
        computeReceipt(attempt(out(result({ outputs: [m] }))), WS).kind,
      ).toBe("unverified");
  });

  it("observation refs must be canonical and ordered", () => {
    const other = {
      kind: "workspace_file",
      id: "f2",
      version: "v1",
      sha256: H("8"),
    };
    for (const obs of [
      { input_refs: SRC },
      { input_refs: [{ ...RUN_SCOPE, id: "r9" }, ...SRC] },
      { input_refs: [RUN_SCOPE, other, ...SRC], source_refs: [...SRC, other] },
      { output_refs: [] },
      { output_refs: [{ ...BLOB_REF, sha256: H("7") }] },
      { source_refs: [{ ...SRC[0], id: "bad id" }] },
    ])
      expect(computeReceipt(attempt(out(result()), {}, obs), WS).kind).toBe(
        "unverified",
      );
  });

  it("file MIME and suffix must match the format", () => {
    const blob = manifest().blob;
    for (const m of [
      manifest({ blob: { ...blob, mime_type: "text/html" } }),
      manifest({ blob: { ...blob, mime_type: "application/json" } }),
      manifest({ filename: "totals.json" }),
      manifest({
        format: "markdown",
        filename: "notes.md",
        blob: { ...blob, mime_type: "text/csv" },
      }),
    ])
      expect(
        computeReceipt(attempt(out(result({ outputs: [m] }))), WS).kind,
      ).toBe("unverified");
    const md = manifest({
      format: "markdown",
      filename: "notes.md",
      blob: { ...blob, mime_type: "text/markdown" },
    });
    expect(
      computeReceipt(attempt(out(result({ outputs: [md] }))), WS).kind,
    ).toBe("run");
  });

  it("uses the backend Id pattern", () => {
    for (const id of ["-lead", "a b", "x".repeat(129), ""])
      expect(
        computeReceipt(
          attempt(out(result()), {}, { source_refs: [{ ...SRC[0], id }] }),
          WS,
        ).kind,
      ).toBe("unverified");
    const ok = "A1_.:-" + "x".repeat(122);
    const refs = [{ ...SRC[0], id: ok }];
    expect(
      computeReceipt(
        attempt(
          out(result({ outputs: [manifest({ input_refs: refs })] })),
          {},
          {
            source_refs: refs,
            input_refs: [RUN_SCOPE, ...refs],
          },
        ),
        WS,
      ).kind,
    ).toBe("run");
  });

  it("short unavailable form reports no receipt without claiming nothing ran", () => {
    const c = computeReceipt(
      attempt(
        out({
          status: "unavailable",
          omissions: ["isolation service unavailable; no host fallback"],
          outputs: [],
        }),
        {},
        NO_FILES,
      ),
      WS,
    );
    expect(c.kind).toBe("unavailable");
    expect(c.headline).toBe("Compute unavailable — no execution receipt");
    expect(c.headline).not.toMatch(/nothing ran/i);
    expect(
      toolAttemptRow(
        attempt(
          out({ status: "unavailable", omissions: [], outputs: [] }),
          {},
          NO_FILES,
        ),
        WS,
      ).tone,
    ).toBe("unknown");
  });

  it("a full receipt with status unavailable never claims nothing ran", () => {
    const a = attempt(
      out(
        result({
          status: "unavailable",
          exit_code: 0,
          stdout: "partial work\n",
          outputs: [],
        }),
      ),
      {},
      NO_FILES,
    );
    const c = computeReceipt(a, WS);
    expect(c.kind).toBe("run");
    if (c.kind !== "run") return;
    expect(c.ok).toBe(false);
    expect(c.headline).not.toMatch(/nothing ran/i);
    expect(c.headline).toContain("outcome uncertain");
    expect(c.run.stdout).toBe("partial work\n");
    const row = toolAttemptRow(a, WS);
    expect(row.tone).toBe("unknown");
    expect(row.stateLabel).not.toMatch(/nothing ran|completed|succeeded/i);
  });

  it("missing or malformed results are unverified", () => {
    for (const o of [
      null,
      {},
      out(null),
      out(result({ cleanup_verified: false })),
      out(result({ code_sha256: "nope" })),
      out(result({ status: "great" })),
      out(result({ stdout: 5 })),
      out({ status: "unavailable", omissions: [], outputs: [manifest()] }),
      { capability: "other", version: "1", result: result() },
    ])
      expect(computeReceipt(attempt(o), WS).kind).toBe("unverified");
  });

  it("refuses manifests outside the read scope", () => {
    for (const m of [
      manifest({ workspace_id: "ws2" }),
      manifest({ run_id: "r2" }),
      manifest({ tool_attempt_id: "a9" }),
      manifest({ filename: "../x.csv" }),
      manifest({ filename: "x.html" }),
    ])
      expect(
        computeReceipt(attempt(out(result({ outputs: [m] }))), WS).kind,
      ).toBe("unverified");
  });

  it("cost_only and unknown attempts expose no result even if output exists", () => {
    for (const state of [
      "cost_only",
      "outcome_unknown",
      "failed",
      "dispatched",
    ] as const) {
      const c = computeReceipt(attempt(out(result()), { state }), WS);
      expect(c.kind).toBe("withheld");
    }
  });

  it("attacker output stays inert text with visible bidi controls", () => {
    const evil = "<img src=x onerror=alert(1)>[click](javascript:x)‮txt.exe";
    const c = computeReceipt(attempt(out(result({ stdout: evil }))), WS);
    expect(c.kind === "run" && c.run.stdout).toBe(evil);
    const s = inertStream(evil);
    expect(s.text).toContain("<img src=x onerror=alert(1)>");
    expect(s.text).not.toContain("‮");
    expect(s.text).toContain("\\u202e");
    const big = inertStream("x".repeat(STREAM_DISPLAY_CHARS + 5));
    expect(big.clipped).toBe(true);
    expect(big.text.length).toBe(STREAM_DISPLAY_CHARS);
  });

  it.each([
    ["zero-width space", "\u200b", "\\u200b"],
    ["zero-width non-joiner", "\u200c", "\\u200c"],
    ["zero-width joiner", "\u200d", "\\u200d"],
    ["word joiner", "\u2060", "\\u2060"],
    ["invisible plus", "\u2064", "\\u2064"],
    ["byte order mark", "\ufeff", "\\ufeff"],
    ["tag A", "\u{e0041}", "\\u{e0041}"],
    ["cancel tag", "\u{e007f}", "\\u{e007f}"],
    ["NUL", "\u0000", "\\u0000"],
    ["escape", "\u001b", "\\u001b"],
    ["vertical tab", "\u000b", "\\u000b"],
    ["form feed", "\u000c", "\\u000c"],
    ["DEL", "\u007f", "\\u007f"],
    ["RLO", "\u202e", "\\u202e"],
  ])("makes %s visible", (_, c, shown) => {
    const { text } = inertStream(`a${c}b`);
    expect(text).toBe(`a${shown}b`);
  });

  it("keeps tab, newline, carriage return and ordinary text as is", () => {
    const plain = "a\tb\nc\r\nd é 日本 😀";
    expect(inertStream(plain).text).toBe(plain);
  });

  it("never splits a surrogate pair at the display cap", () => {
    const s = "x".repeat(STREAM_DISPLAY_CHARS - 1) + "😀tail";
    const { text, clipped } = inertStream(s);
    expect(clipped).toBe(true);
    expect(text).toBe("x".repeat(STREAM_DISPLAY_CHARS - 1));
  });

  it("joins notes inertly and caps them with a clear marker", () => {
    expect(inertNotes(["a\u200bb", "c"])).toBe("a\\u200bb; c");
    const long = inertNotes(["y".repeat(NOTES_DISPLAY_CHARS + 50)]);
    expect(long.endsWith(TRUNCATED_MARK)).toBe(true);
    expect(long.length).toBe(NOTES_DISPLAY_CHARS + TRUNCATED_MARK.length);
  });
});

describe("compute receipt DOM", () => {
  const render = (r: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(ComputeReceipt, {
        ws: WS,
        receipt: computeReceipt(attempt(out(result(r))), WS),
        context: "compute.python, call 2",
        onInvalidate: () => {},
      }),
    );

  it("makes output keyboard reachable and names repeated controls", () => {
    const html = render({ stderr: "warn" });
    expect(html).toMatch(
      /<pre[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="Output \(stdout\), compute.python, call 2"/,
    );
    expect(html).toContain(
      'aria-label="Errors (stderr), compute.python, call 2"',
    );
    expect(html).toContain(
      '<span class="sr-only"> from compute.python, call 2</span>',
    );
    expect(html).toContain(
      'Run receipt<span class="sr-only">, compute.python, call 2</span>',
    );
    // Busy, not disabled, so the button keeps keyboard focus.
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).toContain('data-testid="compute-download-status"');
    expect(html).toMatch(/role="status"/);
  });

  it("shows untrusted metadata inertly", () => {
    const html = render({
      runtime_version: "3.12\u202e",
      image: "img\u200b",
      inputs: [{ name: "d\u0007.csv", sha256: H("f"), bytes: 40 }],
    });
    expect(html).toContain("3.12\\u202e");
    expect(html).toContain("img\\u200b");
    expect(html).toContain("Input d\\u0007.csv");
    expect(html).not.toMatch(/[\u202e\u200b\u0007]/);
  });
});

describe("withdrawn receipts", () => {
  it("are keyed by workspace, run and attempt without mutating prior state", () => {
    const empty: Withdrawn = new Map();
    const k = receiptKey("ws1", "r1", "a1");
    const w = withdrawReceipt(empty, k, "Not found.");
    expect(empty.size).toBe(0);
    expect(w.get(k)).toBe("Not found.");
    expect(w.has(receiptKey("ws2", "r1", "a1"))).toBe(false);
    expect(w.has(receiptKey("ws1", "r2", "a1"))).toBe(false);
    expect(w.has(receiptKey("ws1", "r1", "a2"))).toBe(false);
    // Separator prevents ambiguous concatenation.
    expect(receiptKey("w", "s1r", "a")).not.toBe(receiptKey("ws1", "r", "a"));
    expect(DOWNLOAD_WITHDRAWN).toMatch(/hidden/);
    expect(DOWNLOAD_WITHDRAWN).not.toMatch(/success|complete/i);
  });
});

describe("scoped requests", () => {
  it("drops responses from superseded requests and other scopes", () => {
    const r = scopedRequests();
    const first = r.begin("ws1", "r1");
    const second = r.begin("ws1", "r1");
    expect(r.isCurrent(first, "ws1", "r1")).toBe(false);
    expect(r.isCurrent(second, "ws1", "r1")).toBe(true);
    expect(r.isCurrent(second, "ws1", "r2")).toBe(false);
    r.invalidate();
    expect(r.isCurrent(second, "ws1", "r1")).toBe(false);
    const third = r.begin("ws2", "r1");
    expect(r.isCurrent(third, "ws1", "r1")).toBe(false);
    expect(r.isCurrent(third, "ws2", "r1")).toBe(true);
  });
});
