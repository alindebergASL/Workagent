import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/contract/errors";
import type { UploadBody } from "@/lib/client/batch2-api";
import type { DocumentDetail } from "@/lib/contract/batch2";
import {
  draftScope,
  memoryDocStore,
  StorageFailed,
  toRecord,
  type DocStore,
} from "@/lib/client/doc-store";
import {
  entryProblem,
  expectedDocumentsMissing,
  newEntry,
  ReconcileRequired,
  stageBytes,
  uploadAll,
  type StagedEntry,
} from "@/lib/client/documents";
import {
  stagedController,
  type StagedView,
} from "@/lib/client/staged-documents";
import { checkpointsCurrent, continueLatestRun } from "@/lib/batch2-view";
import {
  currentFor,
  nextEvidence,
  noEvidence,
  type Evidence,
  type FreshnessEvent,
} from "@/lib/client/resource-freshness";
import {
  afterHomeStartError,
  clearHomeChat,
  NotKept,
  readHomeChat,
  runHomeStart,
  sameStart,
  saveHomeChat,
  leaveHome,
  selectHome,
  settlesHere,
  type HomeSelection,
  type HomeChat,
} from "@/lib/client/home-start";

const pdf = (tag: string) =>
  new TextEncoder().encode(`%PDF-1.7\n${tag}\nÿ\u0000`);
const A = draftScope("p", "wsA", "home");
const B = draftScope("p", "wsB", "home");
const dest = { workspace_id: "ws", conversation_id: "cv" };
const lost = () =>
  new ApiError({ code: "transport", status: 0, message: "lost" });
const detailFor = (b: UploadBody) =>
  ({
    document_id: `doc-${b.sha256.slice(0, 6)}`,
    sha256: b.sha256,
    filename: b.filename,
    mime_type: b.mime_type,
    status: "extracted",
  }) as DocumentDetail;
const tick = () => new Promise((r) => setImmediate(r));
/** Waits (bounded) until `done`; deterministic, never a timed sleep. */
async function until(done: () => boolean) {
  for (let i = 0; i < 10_000 && !done(); i++) await tick();
  expect(done()).toBe(true);
}
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};
/** A controller as a mounted page would hold it, opened on `scope`. */
async function page(store: DocStore, scope: string) {
  const views: StagedView[] = [];
  const ctl = stagedController(store, (v) => views.push(v));
  ctl.open(scope);
  await until(() => !ctl.view.restoring);
  return ctl;
}
const fileOf = (name: string, bytes: Uint8Array, read?: Promise<void>) =>
  ({
    name,
    type: "",
    size: bytes.length,
    arrayBuffer: async () => {
      await read;
      return bytes.slice().buffer;
    },
  }) as unknown as File;

describe("R1: upload identity is durable before dispatch", () => {
  it("a closed client replays the same command for a restored unknown upload", async () => {
    const store = memoryDocStore();
    const scope = draftScope("p", "ws", "conversation:cv");
    const first = await page(store, scope);
    expect(await first.add([fileOf("a.pdf", pdf("one"))])).toBe("");
    const ids: string[] = [];
    let fail = true;
    const upload = async (_w: string, _c: string, b: UploadBody) => {
      ids.push(b.command_id);
      if (fail) throw lost();
      return detailFor(b);
    };
    const o = first.origin()!;
    await expect(
      uploadAll(dest, first.view.docs, (n) => first.persist(o, n), upload),
    ).rejects.toThrow("lost");
    // The client closes; a new one opens the same draft (no sessionStorage).
    const second = await page(store, scope);
    const [back] = second.view.docs;
    expect(back!.state).toBe("unknown");
    expect(entryProblem(back!, dest)).toBeNull();
    fail = false;
    const o2 = second.origin()!;
    await uploadAll(
      dest,
      second.view.docs,
      (n) => second.persist(o2, n),
      upload,
    );
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it("refuses to dispatch when the identity can't be kept", async () => {
    const d = await stageBytes("a.pdf", "", pdf("one"));
    let called = 0;
    const upload = async (_w: string, _c: string, b: UploadBody) => {
      called += 1;
      return detailFor(b);
    };
    let entries: StagedEntry[] = [newEntry(d)];
    const persist = async (n: StagedEntry[]) => {
      entries = n;
      throw new StorageFailed();
    };
    await expect(uploadAll(dest, entries, persist, upload)).rejects.toThrow(
      StorageFailed,
    );
    expect(called).toBe(0);
    expect(entries[0]!.upload).toBeNull();
    expect(entries[0]!.state).toBe("local");
  });

  it("a lost receipt write still replays the original identity after restart", async () => {
    const inner = memoryDocStore();
    let writes = 0;
    const store: DocStore = {
      ...inner,
      put: async (r) => {
        writes += 1;
        if (writes > 2) throw new StorageFailed(); // receipt write lost
        return inner.put(r);
      },
    };
    const scope = draftScope("p", "ws", "conversation:cv");
    const first = await page(store, scope);
    await first.add([fileOf("a.pdf", pdf("one"))]);
    const ids: string[] = [];
    const upload = async (_w: string, _c: string, b: UploadBody) => {
      ids.push(b.command_id);
      return detailFor(b);
    };
    const o = first.origin()!;
    await uploadAll(dest, first.view.docs, (n) => first.persist(o, n), upload);
    const second = await page(inner, scope);
    expect(second.view.docs[0]!.state).toBe("unknown");
    const o2 = second.origin()!;
    await uploadAll(
      dest,
      second.view.docs,
      (n) => second.persist(o2, n),
      upload,
    );
    expect(ids).toEqual([ids[0], ids[0]]);
  });

  it("an old in-doubt record without identity fails closed until reconciled", async () => {
    const store = memoryDocStore();
    const scope = draftScope("p", "ws", "conversation:cv");
    const d = await stageBytes("a.pdf", "", pdf("one"));
    const legacy = toRecord(scope, { ...newEntry(d), state: "uploading" });
    delete legacy.upload;
    await store.put(legacy);
    const ctl = await page(store, scope);
    const [e] = ctl.view.docs;
    expect(e!.state).toBe("unknown");
    expect(entryProblem(e!, dest)).toMatch(/no longer has its exact command/);
    let called = 0;
    const upload = async (_w: string, _c: string, b: UploadBody) => {
      called += 1;
      return detailFor(b);
    };
    const o = ctl.origin()!;
    await expect(
      uploadAll(dest, ctl.view.docs, (n) => ctl.persist(o, n), upload),
    ).rejects.toThrow(ReconcileRequired);
    expect(called).toBe(0);
    // Explicit recovery keeps the exact bytes as a new local staging.
    await ctl.reattach(o, e!.generation);
    const [fresh] = ctl.view.docs;
    expect(fresh!.doc).toEqual(e!.doc);
    expect(fresh!.state).toBe("local");
    expect([...store.records.keys()]).toEqual([
      `${scope}|${fresh!.generation}`,
    ]);
    await uploadAll(dest, ctl.view.docs, (n) => ctl.persist(o, n), upload);
    expect(called).toBe(1);
  });

  it("never reuses an identity or ref in a different conversation", async () => {
    const d = await stageBytes("a.pdf", "", pdf("one"));
    const bound: StagedEntry = {
      ...newEntry(d),
      state: "uploaded",
      upload: { command_id: "c", request_id: "r", ...dest },
      ref: { document_id: "d1", sha256: d.sha256, status: "extracted" },
    };
    const other = { workspace_id: "ws", conversation_id: "cv2" };
    let called = 0;
    const upload = async (_w: string, _c: string, b: UploadBody) => {
      called += 1;
      return detailFor(b);
    };
    await expect(
      uploadAll(other, [bound], async () => {}, upload),
    ).rejects.toThrow(ReconcileRequired);
    expect(entryProblem(bound, null)).not.toBeNull();
    expect(entryProblem(bound, dest)).toBeNull();
    expect(
      entryProblem({ ...bound, upload: null }, dest), // legacy ref, no identity
    ).not.toBeNull();
    expect(called).toBe(0);
  });
});

describe("R2: late async results stay in their originating scope", () => {
  it("a file read finishing after a workspace switch never lands in the new one", async () => {
    const store = memoryDocStore();
    const ctl = await page(store, A);
    const read = deferred<void>();
    const adding = ctl.add([fileOf("a.pdf", pdf("one"), read.promise)]);
    ctl.open(B);
    await until(() => !ctl.view.restoring);
    read.resolve();
    expect(await adding).toBe("");
    expect(ctl.view.docs).toEqual([]);
    expect(store.records.size).toBe(0);
  });

  it("a late upload update writes to its original draft, not the shown one", async () => {
    const store = memoryDocStore();
    const ctl = await page(store, A);
    await ctl.add([fileOf("a.pdf", pdf("one"))]);
    const o = ctl.origin()!;
    const gate = deferred<void>();
    const upload = async (_w: string, _c: string, b: UploadBody) => {
      await gate.promise;
      return detailFor(b);
    };
    const sending = uploadAll(
      dest,
      ctl.view.docs,
      (n) => ctl.persist(o, n),
      upload,
    );
    await until(() => ctl.view.docs[0]?.state === "uploading");
    ctl.open(B);
    await until(() => !ctl.view.restoring);
    gate.resolve();
    await sending;
    expect(ctl.view.docs).toEqual([]);
    const all = [...store.records.values()];
    expect(all.map((r) => [r.scope, r.state])).toEqual([[A, "uploaded"]]);
  });
});

describe("R3: restoration failures block until explicit recovery", () => {
  it("a read failure blocks sending and adding; recovery is explicit", async () => {
    const inner = memoryDocStore();
    let failing = true;
    const store: DocStore = {
      ...inner,
      list: (s) =>
        failing ? Promise.reject(new StorageFailed()) : inner.list(s),
    };
    const ctl = await page(store, A);
    expect(ctl.view.blocked).toEqual({ kind: "read" });
    expect(await ctl.add([fileOf("a.pdf", pdf("one"))])).toBe("");
    expect(ctl.view.docs).toEqual([]);
    failing = false;
    ctl.retry();
    await until(() => !ctl.view.restoring);
    expect(ctl.view.blocked).toBeNull();
    failing = true;
    ctl.retry();
    await until(() => !ctl.view.restoring);
    expect(ctl.view.blocked).toEqual({ kind: "read" });
    ctl.continueWithout(ctl.origin()!);
    expect(ctl.view.blocked).toBeNull();
  });

  it("a damaged copy blocks until it is explicitly discarded", async () => {
    const store = memoryDocStore();
    const d = await stageBytes("a.pdf", "", pdf("one"));
    const rec = toRecord(A, newEntry(d));
    const view = new Uint8Array(rec.bytes);
    view[9] = view[9]! ^ 1;
    await store.put(rec);
    const ctl = await page(store, A);
    expect(ctl.view.blocked?.kind).toBe("corrupt");
    expect(store.records.size).toBe(1); // kept until the person decides
    await ctl.discardCorrupt(ctl.origin()!);
    expect(ctl.view.blocked).toBeNull();
    expect(store.records.size).toBe(0);
  });

  it("nothing can be added while restoring, so a restore can't erase it", async () => {
    const inner = memoryDocStore();
    const d = await stageBytes("kept.pdf", "", pdf("kept"));
    await inner.put(toRecord(A, newEntry(d)));
    const gate = deferred<void>();
    const store: DocStore = {
      ...inner,
      list: async (s) => {
        await gate.promise;
        return inner.list(s);
      },
    };
    const ctl = stagedController(store, () => {});
    ctl.open(A);
    expect(ctl.view.restoring).toBe(true);
    expect(await ctl.add([fileOf("new.pdf", pdf("new"))])).toBe("");
    gate.resolve();
    await until(() => !ctl.view.restoring);
    expect(ctl.view.docs.map((e) => e.doc.filename)).toEqual(["kept.pdf"]);
    expect(inner.records.size).toBe(1);
  });

  it("a pending Home start detects exactly its expected documents, in any order", async () => {
    const a = newEntry(await stageBytes("a.pdf", "", pdf("a")));
    const b = newEntry(await stageBytes("b.pdf", "", pdf("b")));
    const expected = [a.doc, b.doc];
    expect(expectedDocumentsMissing(expected, [b, a])).toBe(false);
    expect(expectedDocumentsMissing(expected, [a])).toBe(true);
    expect(expectedDocumentsMissing(expected, [])).toBe(true);
  });
});

describe("R4: a fresh Continue needs a current compatible read", () => {
  const base = {
    snapshot: {
      conversation_id: "cv",
      work_version: 5,
      execution: { run_id: "R2" } as { run_id?: string | null },
    },
    snapshotStale: false,
    checkpointsCurrent: true,
    conversationId: "cv",
    conversationVersion: 5,
  };
  it("targets the current exact-version snapshot's run", () => {
    expect(continueLatestRun(base)).toBe("R2");
  });
  it("a successor run with no newer request is still the latest run", () => {
    // The thread's newest request belongs to R2; the snapshot names R3.
    expect(
      continueLatestRun({
        ...base,
        snapshot: { ...base.snapshot, execution: { run_id: "R3" } },
      }),
    ).toBe("R3");
  });
  it("an older snapshot never overrides a newer conversation", () => {
    expect(
      continueLatestRun({
        ...base,
        snapshot: {
          ...base.snapshot,
          work_version: 4,
          execution: { run_id: "R1" },
        },
      }),
    ).toBeNull();
  });
  it("no current run means no Continue (no fallback to an earlier run)", () => {
    for (const execution of [{}, { run_id: null }])
      expect(
        continueLatestRun({
          ...base,
          snapshot: { ...base.snapshot, execution },
        }),
      ).toBeNull();
  });
  it("withholds on a stale or inaccessible snapshot or a failed checkpoint read", () => {
    expect(continueLatestRun({ ...base, snapshotStale: true })).toBeNull();
    expect(
      continueLatestRun({ ...base, checkpointsCurrent: false }),
    ).toBeNull();
    expect(continueLatestRun({ ...base, snapshot: null })).toBeNull();
    expect(
      continueLatestRun({
        ...base,
        snapshot: { ...base.snapshot, conversation_id: "x" },
      }),
    ).toBeNull();
  });
});

describe("R5: device writes apply in the order they were made", () => {
  /** A store whose first put waits for `gate`. */
  function slowFirstPut(gate: Promise<void>) {
    const inner = memoryDocStore();
    let puts = 0;
    const store: DocStore = {
      ...inner,
      put: async (r) => {
        puts += 1;
        if (puts === 1) await gate;
        return inner.put(r);
      },
    };
    return { inner, store };
  }

  it("a delayed earlier write can't resurrect a removed generation", async () => {
    const gate = deferred<void>();
    const { inner, store } = slowFirstPut(gate.promise);
    const ctl = await page(store, A);
    const o = ctl.origin()!;
    const e = newEntry(await stageBytes("a.pdf", "", pdf("one")));
    const writing = ctl.persist(o, [e]);
    const removing = ctl.forget(o, [e.generation]);
    gate.resolve();
    await writing;
    await removing;
    expect(inner.records.size).toBe(0);
  });

  it("a delayed earlier write can't overwrite a later uploaded receipt", async () => {
    const gate = deferred<void>();
    const { inner, store } = slowFirstPut(gate.promise);
    const ctl = await page(store, A);
    const o = ctl.origin()!;
    const e = newEntry(await stageBytes("a.pdf", "", pdf("one")));
    const first = ctl.persist(o, [{ ...e, state: "uploading" }]);
    const second = ctl.persist(o, [{ ...e, state: "uploaded" }]);
    gate.resolve();
    await Promise.all([first, second]);
    expect([...inner.records.values()].map((r) => r.state)).toEqual([
      "uploaded",
    ]);
  });
});

describe("Home start continuation (runHomeStart, as Composer wires it)", () => {
  const storage = (failSetFor?: (k: string) => boolean) => {
    const m = new Map<string, string>();
    return {
      m,
      s: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (failSetFor?.(v)) throw new Error("quota");
          m.set(k, v);
        },
        removeItem: (k: string) => void m.delete(k),
      } as unknown as Storage,
    };
  };
  const chatWith = (workspace: string): HomeChat => ({
    workspace,
    text: "hi",
    create: { command_id: `create-${workspace}`, title: "hi", context_ids: [] },
    conversation: null,
    send: null,
    documents: [{ filename: "a.pdf", sha256: "x" }],
    handover: false,
    uncertain: false,
  });
  const ref = { document_id: "d1", sha256: "x" };

  it("never sends when the send command can't be kept, and replays it exactly", async () => {
    // localStorage accepts everything until the record names a send.
    let refuseSend = true;
    const local = storage((v) => refuseSend && v.includes('"send":{'));
    const session = storage();
    const stores = { local: local.s, session: session.s };
    const c = chatWith("A");
    const sent: string[] = [];
    let creates = 0;
    const deps = {
      save: (x: HomeChat) => saveHomeChat(x.workspace, x, stores),
      create: async () => {
        creates += 1;
        return { id: "cv1", work_version: 1 };
      },
      prepareSend: async () => ({
        command_id: `send-${sent.length}-${Math.random()}`,
        expected_work_version: 1,
        text: "hi",
        document_refs: [ref],
      }),
      send: async (_w: string, _c: string, b: { command_id: string }) => {
        sent.push(b.command_id);
      },
    };
    await expect(runHomeStart(c, deps)).rejects.toThrow(NotKept);
    expect(sent).toEqual([]); // the send never went out
    const kept = afterHomeStartError(c, new NotKept());
    expect(kept?.send).not.toBeNull(); // in-memory identity preserved
    const frozen = kept!.send!.command_id;
    refuseSend = false;
    await runHomeStart(kept!, deps);
    expect(sent).toEqual([frozen]);
    expect(creates).toBe(1);
  });

  it("after a closed session, an unknown send replays the same command", async () => {
    const stores = { local: storage().s, session: storage().s };
    const c = chatWith("A");
    const sent: string[] = [];
    const deps = {
      save: (x: HomeChat) => saveHomeChat(x.workspace, x, stores),
      create: async () => ({ id: "cv1", work_version: 1 }),
      prepareSend: async () => ({
        command_id: crypto.randomUUID(),
        expected_work_version: 1,
        text: "hi",
        document_refs: [ref],
      }),
      send: async (_w: string, _c: string, b: { command_id: string }) => {
        sent.push(b.command_id);
        if (sent.length === 1) throw lost();
      },
    };
    await expect(runHomeStart(c, deps)).rejects.toThrow("lost");
    saveHomeChat("A", afterHomeStartError(c, lost())!, stores);
    // New session: only localStorage survives.
    const reopened = readHomeChat("A", { ...stores, session: storage().s })!;
    expect(reopened.send?.command_id).toBe(sent[0]);
    await runHomeStart(reopened, deps);
    expect(sent).toEqual([sent[0], sent[0]]);
  });

  /**
   * Drives a delayed start in A through the same selection transition and
   * settlement guard the Composer uses, switching Home to B meanwhile.
   */
  async function lateStartAfterSwitch(
    bSaved: { chat: HomeChat | null; assignment: { goal: string } | null },
    outcome: "success" | "error",
  ) {
    const stores = { local: storage().s, session: storage().s };
    // Mount on A, then a start begins in the live selection.
    let sel = selectHome<{ goal: string }>({ workspace: null, epoch: 0 }, "A", {
      chat: null,
      assignment: null,
    });
    let live = sel.selection;
    let shown: HomeChat | null = sel.chat;
    const a = chatWith("A");
    shown = a;
    const began = live;
    const gate = deferred<void>();
    const running = runHomeStart(a, {
      save: (x) => saveHomeChat(a.workspace, x, stores),
      create: async () => {
        await gate.promise;
        if (outcome === "error") throw lost();
        return { id: "cvA", work_version: 1 };
      },
      prepareSend: async () => ({
        command_id: "sendA",
        expected_work_version: 1,
        text: "hi",
      }),
      send: async () => {},
    });
    // The person selects B (the Composer stays mounted).
    sel = selectHome(live, "B", bSaved);
    live = sel.selection;
    shown = sel.chat;
    gate.resolve();
    let settledError: unknown = null;
    try {
      await running;
      clearHomeChat(a.workspace, a.create.command_id, stores);
    } catch (e) {
      settledError = e;
      const next = afterHomeStartError(a, e);
      if (next) saveHomeChat(next.workspace, next, stores);
    }
    return {
      stores,
      sel,
      settles: settlesHere(live, began, shown, a),
      settledError,
    };
  }

  for (const [label, bSaved] of [
    ["no saved record", { chat: null, assignment: null }],
    ["only an assignment", { chat: null, assignment: { goal: "B work" } }],
  ] as const)
    for (const outcome of ["success", "error"] as const)
      it(`B with ${label}: a late A ${outcome} never settles into B`, async () => {
        const r = await lateStartAfterSwitch(bSaved, outcome);
        // Selecting B leaves nothing of A's start current.
        expect(r.sel.chat).toBeNull();
        expect(r.sel.assignment).toEqual(bSaved.assignment);
        expect(r.settles).toBe(false); // no UI clear, error or navigation in B
        // A's own durable record is still handled in A.
        const keptA = readHomeChat("A", r.stores);
        if (outcome === "success") expect(keptA).toBeNull();
        else {
          expect(r.settledError).toBeInstanceOf(ApiError);
          expect(keptA?.uncertain).toBe(true);
          expect(keptA?.create.command_id).toBe("create-A");
        }
        expect(readHomeChat("B", r.stores)).toBeNull();
      });

  it("a start settles only in the selection it began in", () => {
    const a = chatWith("A");
    const s1 = selectHome({ workspace: null, epoch: 0 }, "A", {
      chat: null,
      assignment: null,
    }).selection;
    expect(settlesHere(s1, s1, a, a)).toBe(true);
    // Away and back to A: a new epoch, even with A's restored copy shown.
    const back = selectHome(
      selectHome(s1, "B", { chat: null, assignment: null }).selection,
      "A",
      { chat: a, assignment: null },
    );
    expect(sameStart(back.chat, a)).toBe(true);
    expect(back.chat?.uncertain).toBe(true);
    expect(settlesHere(back.selection, s1, back.chat, a)).toBe(false);
    // A restored start wins over an assignment of the same workspace.
    expect(
      selectHome(s1, "A", { chat: a, assignment: { goal: "x" } }).assignment,
    ).toBeNull();
  });

  /**
   * The Composer's layout-effect lifecycle for one workspace: select on
   * commit, leave on cleanup (switch or unmount).
   */
  const mount = (workspace: string, live: { current: HomeSelection }) => {
    const sel = selectHome(live.current, workspace, {
      chat: null,
      assignment: null,
    });
    live.current = sel.selection;
    return () => {
      live.current = leaveHome(live.current);
    };
  };

  for (const outcome of ["success", "error"] as const)
    it(`a late A ${outcome} after Home unmounts never touches UI or navigates`, async () => {
      const stores = { local: storage().s, session: storage().s };
      const live = { current: { workspace: null, epoch: 0 } as HomeSelection };
      const unmount = mount("A", live);
      const a = chatWith("A");
      const shown: HomeChat | null = a; // the ref still holds A after unmount
      const began = live.current;
      const gate = deferred<void>();
      const running = runHomeStart(a, {
        save: (x) => saveHomeChat(a.workspace, x, stores),
        create: async () => {
          await gate.promise;
          if (outcome === "error") throw lost();
          return { id: "cvA", work_version: 1 };
        },
        prepareSend: async () => ({
          command_id: "sendA",
          expected_work_version: 1,
          text: "hi",
        }),
        send: async () => {},
      });
      unmount(); // navigated away: the cleanup runs at commit
      gate.resolve();
      try {
        await running;
        clearHomeChat(a.workspace, a.create.command_id, stores);
      } catch (e) {
        const next = afterHomeStartError(a, e);
        if (next) saveHomeChat(next.workspace, next, stores);
      }
      expect(settlesHere(live.current, began, shown, a)).toBe(false);
      // Origin-only durable handling still happened in A.
      if (outcome === "success") expect(readHomeChat("A", stores)).toBeNull();
      else expect(readHomeChat("A", stores)?.uncertain).toBe(true);
    });

  it("a switch invalidates at the commit's cleanup, before the new selection", () => {
    const live = { current: { workspace: null, epoch: 0 } as HomeSelection };
    const leaveA = mount("A", live);
    const a = chatWith("A");
    const began = live.current;
    expect(settlesHere(live.current, began, a, a)).toBe(true);
    leaveA(); // cleanup of A's layout effect, still holding A's chat ref
    expect(settlesHere(live.current, began, a, a)).toBe(false);
    mount("B", live);
    expect(settlesHere(live.current, began, a, a)).toBe(false);
  });

  it("a stale clear never removes a different start's record", () => {
    const stores = { local: storage().s, session: storage().s };
    const b = chatWith("B");
    saveHomeChat("B", b, stores);
    clearHomeChat("B", "create-other", stores);
    expect(readHomeChat("B", stores)).toEqual(b);
  });

  it("sent documents are cleared from their own draft's records only", async () => {
    const store = memoryDocStore();
    const ctl = await page(store, A);
    const e = newEntry(await stageBytes("a.pdf", "", pdf("one")));
    const o = ctl.origin()!;
    await ctl.persist(o, [
      {
        ...e,
        state: "uploaded",
        ref: { document_id: "d1", sha256: e.doc.sha256, status: "extracted" },
      },
    ]);
    ctl.open(B);
    await until(() => !ctl.view.restoring);
    await ctl.forgetRefs(o, [{ document_id: "d1", sha256: e.doc.sha256 }]);
    expect(store.records.size).toBe(0);
  });
});

describe("RR1: checkpoint freshness keyed to the read's own key", () => {
  /**
   * Applies events as useResource does (each tagged with the key its read
   * belongs to) and reports what the page passes for the key it requests.
   */
  function resource() {
    let evidence: Evidence = noEvidence;
    let reconnecting = false;
    let error: unknown = null;
    let hasData = false;
    return {
      apply(key: string, e: FreshnessEvent) {
        evidence = nextEvidence(evidence, key, e);
        if (e.kind === "reset") {
          hasData = false;
          reconnecting = false;
          error = null;
        }
        if (e.kind === "success" && !e.superseded) {
          hasData = true;
          reconnecting = false;
          error = null;
        }
        // As useResource: cached data is kept and marked reconnecting.
        if (e.kind === "failure" && !e.superseded) {
          if (hasData) reconnecting = true;
          else error = true;
        }
      },
      /** The fence as rendered for `requested` (the page's current key). */
      fence(requested: string) {
        return continueLatestRun({
          snapshot: {
            conversation_id: "cv",
            work_version: 5,
            execution: { run_id: "R" },
          },
          snapshotStale: false,
          checkpointsCurrent: checkpointsCurrent({
            current: currentFor(evidence, requested),
            reconnecting,
            error,
          }),
          conversationId: "cv",
          conversationVersion: 5,
        });
      },
    };
  }
  const v4 = "checkpoints:ws:cv:4";
  const v5 = "checkpoints:ws:cv:5";

  it("a key change is not current from its first render, with no reset applied", () => {
    const r = resource();
    r.apply(v4, { kind: "start" });
    r.apply(v4, { kind: "success", superseded: false });
    expect(r.fence(v4)).toBe("R");
    // The page now requests v5; no effect (reset/start) has run yet.
    expect(r.fence(v5)).toBeNull();
    // The old key's read answering late changes nothing for v5.
    r.apply(v4, { kind: "success", superseded: true });
    expect(r.fence(v5)).toBeNull();
    r.apply(v5, { kind: "start" });
    expect(r.fence(v5)).toBeNull();
    r.apply(v5, { kind: "success", superseded: false });
    expect(r.fence(v5)).toBe("R");
    expect(r.fence(v4)).toBeNull();
  });

  it("then pending → failed → recovered refresh of the same key", () => {
    const r = resource();
    r.apply(v5, { kind: "start" });
    r.apply(v5, { kind: "success", superseded: false });
    expect(r.fence(v5)).toBe("R");
    r.apply(v5, { kind: "start" }); // replacement read pending
    expect(r.fence(v5)).toBeNull();
    r.apply(v5, { kind: "failure", superseded: false }); // cached data kept
    expect(r.fence(v5)).toBeNull();
    r.apply(v5, { kind: "start" });
    r.apply(v5, { kind: "success", superseded: false });
    expect(r.fence(v5)).toBe("R");
  });

  it("an older superseded read never makes the data current", () => {
    const r = resource();
    r.apply(v5, { kind: "start" }); // read 1
    r.apply(v5, { kind: "start" }); // read 2 supersedes it
    r.apply(v5, { kind: "success", superseded: true }); // read 1 answers late
    expect(r.fence(v5)).toBeNull();
    r.apply(v5, { kind: "failure", superseded: false }); // read 2 fails
    expect(r.fence(v5)).toBeNull();
  });

  it("no key, an error or reconnecting is never current", () => {
    expect(currentFor({ key: null, current: true }, null)).toBe(false);
    expect(
      checkpointsCurrent({ current: true, reconnecting: false, error: {} }),
    ).toBe(false);
    expect(
      checkpointsCurrent({ current: true, reconnecting: true, error: null }),
    ).toBe(false);
  });
});
