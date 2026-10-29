import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/contract/errors";
import {
  MemoryCommandJournal,
  memoryScopeKey,
  type MemoryTransport,
} from "@/lib/client/memory-commands";
import type { MemoryCommand } from "@/lib/client/memory";
import {
  bindingMatches,
  clearIfSubmitted,
  correctionBody,
  correctionRebased,
  emptyRememberForm,
  maskForgotten,
  purgeForgotten,
  isAccessLoss,
  projectScopeId,
  sourceRefText,
  readbackMatches,
  rememberBody,
  renderable,
  withInspection,
  type CorrectionDraft,
  type MemoryInspection,
  type MemoryReceipt,
  type MemoryRevision,
  type RecalledMemory,
} from "@/lib/memory-contract";

/**
 * B3.1b memory command journal and view helpers. All data below are
 * SYNTHETIC FIXTURES (no server, no provider): shapes follow the canonical
 * backend memory/models.py DTOs as generated into contracts/src/schema.d.ts.
 */

const ENV = {
  schema_version: "workagent/v1" as const,
  request_id: "req-fixture-1",
  command_id: "cmd-fixture-1",
};

// FIXTURE: an active revision with payload.
const rev = (over: Partial<MemoryRevision> = {}): MemoryRevision =>
  ({
    memory_id: "mem-fixture-1",
    revision_id: "rev-fixture-1",
    workspace_id: "ws-fixture",
    owner_id: "owner-fixture",
    kind: "fact",
    scope_kind: "task",
    scope_id: "conv-fixture",
    subject_key: "release_day",
    predicate_key: "fact",
    content: "FIXTURE: releases ship on Thursdays",
    content_sha256: "a".repeat(64),
    status: "active",
    origin: "human_explicit",
    source_refs: [],
    evidence_ids: [],
    proposed_by_run_id: null,
    reviewed_by_principal_id: null,
    confidence_label: "explicit",
    confidence_basis: "Explicit human statement",
    valid_from: "2026-10-28T00:00:00Z",
    valid_until: null,
    recorded_at: "2026-10-28T00:00:00Z",
    expires_at: null,
    supersedes_revision_id: null,
    exception_to_revision_id: null,
    contradiction_group_id: null,
    applicability: "",
    access_generation: 1,
    ...over,
  }) as MemoryRevision;

// FIXTURE: the server's cleared payload after forget.
const forgotten = (): MemoryRevision =>
  rev({
    revision_id: "rev-fixture-2",
    status: "forgotten",
    subject_key: null,
    predicate_key: null,
    content: null,
    content_sha256: null,
    confidence_basis: null,
    applicability: null,
  });

const inspection = (current: MemoryRevision): MemoryInspection =>
  ({ current, revisions: [current], notice: "fixture" }) as MemoryInspection;

const receiptOf = (r: MemoryRevision): MemoryReceipt => ({
  memory_id: r.memory_id,
  revision_id: r.revision_id,
  status: r.status,
});

const transportErr = () =>
  new ApiError({ code: "transport", status: 0, message: "lost" });
const staleErr = () =>
  new ApiError({ code: "version_conflict", status: 409, message: "stale" });

const forgetCmd = (): MemoryCommand => ({
  op: "forget",
  memoryId: "mem-fixture-1",
  body: { ...ENV, expected_revision_id: "rev-fixture-1" },
});

function fakeTransport(
  send: MemoryTransport["send"],
  inspect: MemoryTransport["inspect"] = async () => inspection(forgotten()),
) {
  return { send: vi.fn(send), inspect: vi.fn(inspect) };
}

/** Storage that fails the test if anything is written to it. */
const tripwire = () => ({
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(() => null),
  length: 0,
});
let saved: { s: unknown; l: unknown };
let session: ReturnType<typeof tripwire>;
let local: ReturnType<typeof tripwire>;
beforeEach(() => {
  saved = { s: globalThis.sessionStorage, l: globalThis.localStorage };
  session = tripwire();
  local = tripwire();
  Object.defineProperty(globalThis, "sessionStorage", {
    value: session,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: local,
    configurable: true,
  });
});
afterEach(() => {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: saved.s,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: saved.l,
    configurable: true,
  });
  expect(session.setItem).not.toHaveBeenCalled();
  expect(local.setItem).not.toHaveBeenCalled();
});

describe("command envelopes", () => {
  it("remember defaults to this conversation and carries the exact envelope, no conversation_id", () => {
    const f = {
      ...emptyRememberForm(),
      content: "FIXTURE: prefers metric units",
    };
    expect(f.scope_kind).toBe("task");
    const { route, body } = rememberBody(f, "conv-fixture", ENV);
    expect(route).toBe("remember");
    expect(body).toMatchObject({
      ...ENV,
      scope_kind: "task",
      scope_id: "conv-fixture",
    });
    expect(body).not.toHaveProperty("conversation_id");
    expect(body.subject_key).toMatch(/^[a-z0-9][a-z0-9_.:-]*$/);
  });

  it("procedures always go to candidates, never active", () => {
    const f = {
      ...emptyRememberForm(),
      kind: "procedure" as const,
      content: "FIXTURE: steps",
    };
    expect(rememberBody(f, "conv-fixture", ENV).route).toBe("candidates");
  });
});

describe("unknown outcome and replay", () => {
  it("keeps the exact command, blocks fresh writes, and replays only on request", async () => {
    let fail = true;
    const t = fakeTransport(async () => {
      if (fail) throw transportErr();
      return receiptOf(forgotten());
    });
    const j = new MemoryCommandJournal("k", t);
    const cmd = forgetCmd();
    expect((await j.submit(cmd)).kind).toBe("unknown");
    expect(j.pending?.cmd).toBe(cmd);
    expect(j.pending?.state).toBe("unknown");

    // A fresh write is refused, not queued; nothing is sent.
    expect((await j.submit(forgetCmd())).kind).toBe("blocked");
    expect(t.send).toHaveBeenCalledTimes(1);

    fail = false;
    const o = await j.replay();
    expect(o.kind).toBe("verified");
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.send.mock.calls[1]![0]).toBe(cmd); // same object, same envelope
    expect(j.pending).toBeNull();
  });

  it("abandoning is explicit and only for an unknown command", async () => {
    const t = fakeTransport(async () => {
      throw transportErr();
    });
    const j = new MemoryCommandJournal("k", t);
    expect(j.abandon()).toBe(false);
    await j.submit(forgetCmd());
    expect(j.abandon()).toBe(true);
    expect(j.pending).toBeNull();
    expect(t.send).toHaveBeenCalledTimes(1);
  });
});

describe("stale compare-and-swap", () => {
  it("is a definite refusal with no automatic rebase", async () => {
    const t = fakeTransport(async () => {
      throw staleErr();
    });
    const j = new MemoryCommandJournal("k", t);
    const o = await j.submit(forgetCmd());
    expect(o.kind).toBe("stale");
    expect(j.pending).toBeNull();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.inspect).not.toHaveBeenCalled();
  });
});

describe("readback", () => {
  it("reports success only when the reread shows the receipt's revision", async () => {
    const t = fakeTransport(
      async () => receiptOf(forgotten()),
      async () => inspection(rev()), // reread still shows the old revision
    );
    const o = await new MemoryCommandJournal("k", t).submit(forgetCmd());
    expect(o.kind).toBe("unverified");
    expect(t.send).toHaveBeenCalledTimes(1); // a definite receipt is never resent
  });

  it("a failed reread after a receipt is unverified, not unknown", async () => {
    const t = fakeTransport(
      async () => receiptOf(forgotten()),
      async () => {
        throw transportErr();
      },
    );
    const j = new MemoryCommandJournal("k", t);
    expect((await j.submit(forgetCmd())).kind).toBe("unverified");
    expect(j.pending).toBeNull();
  });

  it("readbackMatches compares id, revision and status", () => {
    expect(
      readbackMatches(receiptOf(forgotten()), inspection(forgotten())),
    ).toBe(true);
    expect(readbackMatches(receiptOf(forgotten()), inspection(rev()))).toBe(
      false,
    );
  });
});

describe("forgotten clearing", () => {
  it("replaces the old entry with the cleared readback, dropping old payload", () => {
    const items: RecalledMemory[] = [
      { revision: rev(), why: "task", unresolved_conflict: false },
    ];
    const next = withInspection(items, inspection(forgotten()));
    expect(next[0]!.revision.content).toBeNull();
    expect(JSON.stringify(next)).not.toContain("Thursdays");
  });

  it("never renders payload on a forgotten revision even if a stale copy holds it", () => {
    const mixed = rev({ status: "forgotten" }); // FIXTURE: inconsistent stale copy
    const r = renderable(mixed);
    expect(r.content).toBeNull();
    expect(r.subject_key).toBeNull();
    expect(r.confidence_basis).toBeNull();
    expect(r.source_refs).toEqual([]);
  });
});

describe("scope fencing", () => {
  it("keys differ by identity, workspace and conversation; no identity means no key", () => {
    const a = memoryScopeKey("s1", "ws", "c1");
    expect(a).not.toBe(memoryScopeKey("s2", "ws", "c1"));
    expect(a).not.toBe(memoryScopeKey("s1", "ws2", "c1"));
    expect(a).not.toBe(memoryScopeKey("s1", "ws", "c2"));
    expect(memoryScopeKey(null, "ws", "c1")).toBeNull();
  });

  it("a result arriving after the scope closed is never delivered", async () => {
    let release!: (r: MemoryReceipt) => void;
    const t = fakeTransport(
      () => new Promise<MemoryReceipt>((res) => (release = res)),
    );
    const j = new MemoryCommandJournal("k", t);
    const p = j.submit(forgetCmd());
    j.close();
    release(receiptOf(forgotten()));
    expect((await p).kind).toBe("closed");
    expect(t.inspect).not.toHaveBeenCalled();
    expect((await j.submit(forgetCmd())).kind).toBe("closed");
  });
});

describe("project scope and explicit binding", () => {
  // FIXTURE ids only.
  const link = {
    conversation_id: "conv-fixture",
    work_area_id: "area-fixture",
    work_version: 3,
  };

  it("a work-area conversation uses its own id; others only an explicit read-back link", () => {
    expect(
      projectScopeId({ id: "area-fixture", isWorkArea: true }, undefined),
    ).toBe("area-fixture");
    expect(
      projectScopeId({ id: "conv-fixture", isWorkArea: false }, undefined),
    ).toBeNull();
    expect(
      projectScopeId({ id: "conv-fixture", isWorkArea: false }, null),
    ).toBeNull();
    expect(
      projectScopeId({ id: "conv-fixture", isWorkArea: false }, link),
    ).toBe("area-fixture");
    // A link read for another conversation never grants scope here.
    expect(
      projectScopeId({ id: "conv-other", isWorkArea: false }, link),
    ).toBeNull();
  });

  it("a link is confirmed only by a readback of the exact pair", () => {
    const sent = {
      conversation_id: "conv-fixture",
      work_area_id: "area-fixture",
    };
    expect(bindingMatches(sent, link)).toBe(true);
    expect(bindingMatches(sent, null)).toBe(false);
    expect(bindingMatches(sent, { ...link, work_area_id: "area-other" })).toBe(
      false,
    );
  });
});

describe("access loss and provenance", () => {
  it("distinguishes refused access from a transport failure", () => {
    expect(
      isAccessLoss(
        new ApiError({ code: "unauthenticated", status: 401, message: "x" }),
      ),
    ).toBe(true);
    expect(
      isAccessLoss(
        new ApiError({
          code: "not_found_or_not_authorized",
          status: 404,
          message: "x",
        }),
      ),
    ).toBe(true);
    expect(isAccessLoss(transportErr())).toBe(false);
  });

  it("source lines show identifying fields only, labelled as a reference", () => {
    const line = sourceRefText({
      source_type: "file",
      ref: {
        workspace_file_id: "file-fixture",
        version_id: "v-fixture",
        sha256: "b".repeat(64),
      },
    });
    expect(line).toContain("Saved file");
    expect(line).toContain("workspace_file_id: file-fixture");
    expect(line).toContain("version_id: v-fixture");
    expect(line).toContain("b".repeat(64));
  });
});

// ---- B3.1b review corrections (findings 1, 4, 5) ----

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const deniedErr = () =>
  new ApiError({ code: "unauthenticated", status: 401, message: "denied" });

/**
 * Minimal model of the panel's list state wiring (MemoryPanel.tsx): a
 * forget receipt purges at once and bumps the read fence; reads apply only
 * if their fence is still current, and always through maskForgotten.
 */
function viewModel(j: MemoryCommandJournal) {
  const st = {
    items: [
      { revision: rev(), why: "task", unresolved_conflict: false },
    ] as RecalledMemory[],
    seq: 0,
    forgotten: new Set<string>(),
  };
  j.onReceipt((receipt, cmd) => {
    if (receipt.status !== "forgotten" && cmd.op !== "forget") return;
    st.forgotten.add(receipt.memory_id);
    st.seq++;
    st.items = purgeForgotten(st.items, receipt);
  });
  /** Starts a read; returns how to land it later. */
  const read = () => {
    const mine = ++st.seq;
    return (items: RecalledMemory[]) => {
      if (st.seq !== mine) return false;
      st.items = maskForgotten(items, st.forgotten);
      return true;
    };
  };
  return { st, read };
}

const oldPage = (): RecalledMemory[] => [
  { revision: rev(), why: "task", unresolved_conflict: false },
];

describe("finding 1: a forget receipt purges at once", () => {
  it("purges before the readback resolves, while it is still pending", async () => {
    const send = deferred<MemoryReceipt>();
    const insp = deferred<MemoryInspection>();
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(
        () => send.promise,
        () => insp.promise,
      ),
    );
    const vm = viewModel(j);
    const p = j.submit(forgetCmd());
    send.resolve(receiptOf(forgotten()));
    await Promise.resolve();
    await Promise.resolve();
    // Readback still pending: payload already gone.
    expect(JSON.stringify(vm.st.items)).not.toContain("Thursdays");
    expect(vm.st.items[0]!.revision.status).toBe("forgotten");
    insp.resolve(inspection(forgotten()));
    expect((await p).kind).toBe("verified");
  });

  it("a network failure on readback keeps the purge and reports failed, not denied", async () => {
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(
        async () => receiptOf(forgotten()),
        async () => {
          throw transportErr();
        },
      ),
    );
    const vm = viewModel(j);
    const o = await j.submit(forgetCmd());
    expect(o).toMatchObject({ kind: "unverified", reason: "failed" });
    expect(JSON.stringify(vm.st.items)).not.toContain("Thursdays");
  });

  it("a refused readback is reported as access denial", async () => {
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(
        async () => receiptOf(forgotten()),
        async () => {
          throw deniedErr();
        },
      ),
    );
    const vm = viewModel(j);
    const o = await j.submit(forgetCmd());
    expect(o).toMatchObject({ kind: "unverified", reason: "denied" });
    expect(JSON.stringify(vm.st.items)).not.toContain("Thursdays");
  });

  it("a mismatching readback is unverified/mismatch and never resurrects payload", async () => {
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(
        async () => receiptOf(forgotten()),
        async () => inspection(rev()), // lagging replica still has payload
      ),
    );
    const vm = viewModel(j);
    const o = await j.submit(forgetCmd());
    expect(o).toMatchObject({ kind: "unverified", reason: "mismatch" });
    // Even landing that inspection would be masked.
    vm.st.items = maskForgotten(
      withInspection(vm.st.items, inspection(rev())),
      vm.st.forgotten,
    );
    expect(JSON.stringify(vm.st.items)).not.toContain("Thursdays");
  });

  it("order A: a list read started before the receipt, landing after it, is fenced", async () => {
    const send = deferred<MemoryReceipt>();
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(() => send.promise),
    );
    const vm = viewModel(j);
    const landOld = vm.read(); // GET started before forget completes
    const p = j.submit(forgetCmd());
    send.resolve(receiptOf(forgotten()));
    await p;
    expect(landOld(oldPage())).toBe(false);
    expect(JSON.stringify(vm.st.items)).not.toContain("Thursdays");
  });

  it("order B: a read started after the receipt that still carries payload is masked", async () => {
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(async () => receiptOf(forgotten())),
    );
    const vm = viewModel(j);
    await j.submit(forgetCmd());
    const land = vm.read();
    expect(land(oldPage())).toBe(true);
    expect(vm.st.items[0]!.revision.content).toBeNull();
    expect(JSON.stringify(vm.st.items)).not.toContain("Thursdays");
  });

  it("no receipt is heard after close", async () => {
    const send = deferred<MemoryReceipt>();
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(() => send.promise),
    );
    const heard = vi.fn();
    j.onReceipt(heard);
    const p = j.submit(forgetCmd());
    j.close();
    send.resolve(receiptOf(forgotten()));
    expect((await p).kind).toBe("closed");
    expect(heard).not.toHaveBeenCalled();
  });

  it("receipts of non-forget commands do not purge", async () => {
    const active = rev({ revision_id: "rev-fixture-3" });
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(
        async () => receiptOf(active),
        async () => inspection(active),
      ),
    );
    const vm = viewModel(j);
    await j.submit({
      op: "expire",
      memoryId: "mem-fixture-1",
      body: { ...ENV, expected_revision_id: "rev-fixture-1" },
    });
    expect(vm.st.forgotten.size).toBe(0);
    expect(vm.st.items[0]!.revision.content).toContain("Thursdays");
  });
});

describe("finding 4: correction drafts keep their CAS base", () => {
  const draft = (): CorrectionDraft => ({
    base: "rev-fixture-1",
    content: "FIXTURE: releases ship on Fridays",
    mode: "permanent",
    from: "",
    until: "",
  });

  it("sends the pinned base even after a refresh shows a newer revision", () => {
    const d = draft();
    const body = correctionBody(d, ENV);
    expect(body.expected_revision_id).toBe("rev-fixture-1");
    expect(correctionRebased(d, "rev-fixture-9")).toBe(true);
    expect(correctionRebased(d, "rev-fixture-1")).toBe(false);
  });

  it("only an explicit re-pin adopts the newer base", () => {
    const repinned = { ...draft(), base: "rev-fixture-9" };
    expect(correctionRebased(repinned, "rev-fixture-9")).toBe(false);
    expect(correctionBody(repinned, ENV).expected_revision_id).toBe(
      "rev-fixture-9",
    );
  });

  it("a stale CAS on the pinned base is a refusal, never retried on the newer one", async () => {
    const t = fakeTransport(async () => {
      throw staleErr();
    });
    const j = new MemoryCommandJournal("k", t);
    const cmd: MemoryCommand = {
      op: "correct",
      memoryId: "mem-fixture-1",
      body: correctionBody(draft(), ENV),
    };
    expect((await j.submit(cmd)).kind).toBe("stale");
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0]![0]).toBe(cmd);
  });
});

describe("finding 5: success clears only the submitted form version", () => {
  it("keeps newer unsent typing in the remember form", () => {
    const sent = { ...emptyRememberForm(), content: "FIXTURE: a" };
    const typed = { ...sent, content: "FIXTURE: a plus more" };
    const empty = emptyRememberForm();
    expect(clearIfSubmitted(sent, sent, empty)).toBe(empty);
    expect(clearIfSubmitted(typed, sent, empty)).toBe(typed);
  });

  it("keeps a newer correction draft when an older one completes", async () => {
    const send = deferred<MemoryReceipt>();
    const active = rev({ revision_id: "rev-fixture-3" });
    const j = new MemoryCommandJournal(
      "k",
      fakeTransport(
        () => send.promise,
        async () => inspection(active),
      ),
    );
    const sent: CorrectionDraft = {
      base: "rev-fixture-1",
      content: "FIXTURE: one",
      mode: "permanent",
      from: "",
      until: "",
    };
    let current: CorrectionDraft | undefined = sent;
    const p = j.submit({
      op: "correct",
      memoryId: "mem-fixture-1",
      body: correctionBody(sent, ENV),
    });
    current = { ...sent, content: "FIXTURE: one, edited during send" };
    send.resolve(receiptOf(active));
    const o = await p;
    expect(o.kind).toBe("verified");
    current = clearIfSubmitted(current, sent, undefined);
    expect(current?.content).toBe("FIXTURE: one, edited during send");
  });
});
