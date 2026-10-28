import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Review R3/R4 regressions: replay and remount races in WorkspaceFiles.
 *
 * The actual component handlers (FileCreator / FileEditor), the actual
 * usePendingCommand journal hook and the actual file-draft storage module are
 * transpiled from source and driven on a minimal controlled React hook
 * scheduler, with synthetic transport and in-memory per-tab storage — the
 * same technique as the review's reproductions. No DOM or server is involved.
 *
 * Run against another source tree (e.g. unpatched main, for the RED record):
 *   WF_RACES_SRC_ROOT=/path/to/web/src vitest run test/workspace-files-races.test.ts
 */

const ROOT = process.env.WF_RACES_SRC_ROOT
  ? path.resolve(process.env.WF_RACES_SRC_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

/* ------------------------------------------------------------------ */
/* Synthetic contract pieces                                          */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  status: number;
  code: string;
  isAmbiguousWrite: boolean;
  constructor(
    message: string,
    opts: { status?: number; code?: string; ambiguous?: boolean } = {},
  ) {
    super(message);
    this.status = opts.status ?? 500;
    this.code = opts.code ?? "error";
    this.isAmbiguousWrite = opts.ambiguous ?? false;
  }
}

/**
 * Checked indexed access: each fixture asserts how many calls/effects exist
 * before indexing, so a missing entry is a test failure, not `undefined`.
 */
function nth<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined)
    throw new Error(`expected entry ${i} of ${items.length}`);
  return item;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* ------------------------------------------------------------------ */
/* Minimal controlled hook scheduler                                  */
/* ------------------------------------------------------------------ */

interface EffectRec {
  fn: () => void | (() => void);
  deps?: unknown[];
  cleanup?: (() => void) | void;
}
interface Instance {
  component: (props: Record<string, unknown>) => unknown;
  props: Record<string, unknown>;
  slots: unknown[];
  cursor: number;
  effects: EffectRec[];
  newEffects: EffectRec[];
  tree: unknown;
  dirty: boolean;
  mounted: boolean;
}

function makeWorld() {
  const store = new Map<string, string>();
  const scopedSession = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };

  const world = {
    store,
    scopedSession,
    instances: [] as Instance[],
    current: null as Instance | null,
    cmdSeq: 0,
    versions: { v1: "original" } as Record<string, string>,
    createCalls: [] as {
      body: Record<string, unknown>;
      d: ReturnType<typeof deferred<unknown>>;
    }[],
    editCalls: [] as {
      body: Record<string, unknown>;
      d: ReturnType<typeof deferred<{ current: Record<string, string> }>>;
    }[],
    hashGate: null as Promise<void> | null,
  };

  const React = {
    useState<T>(init: T | (() => T)) {
      const inst = world.current!;
      const i = inst.cursor++;
      if (!(i in inst.slots))
        inst.slots[i] =
          typeof init === "function" ? (init as () => T)() : init;
      const set = (v: T | ((p: T) => T)) => {
        const prev = inst.slots[i] as T;
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        if (!Object.is(prev, next)) {
          inst.slots[i] = next;
          inst.dirty = true;
        }
      };
      return [inst.slots[i], set];
    },
    useRef<T>(init: T) {
      const inst = world.current!;
      const i = inst.cursor++;
      if (!(i in inst.slots)) inst.slots[i] = { current: init };
      return inst.slots[i];
    },
    useCallback<T>(fn: T) {
      return fn;
    },
    useEffect(fn: EffectRec["fn"], deps?: unknown[]) {
      world.current!.newEffects.push({ fn, deps });
    },
  };

  const Fragment = Symbol("Fragment");
  const jsx = (type: unknown, props: Record<string, unknown> | null) => ({
    type,
    props: props ?? {},
  });
  const jsxRuntime = { Fragment, jsx, jsxs: jsx, jsxDEV: jsx };

  const filesContract = {
    EXPORT_FORMATS: ["txt", "md"],
    toDisplayText: (s: string) => s,
    utf8Length: (s: string) => s.length,
    filenameProblem: () => null,
    contentProblem: () => null,
    mimeForFilename: (f: string) =>
      f.endsWith(".txt") ? "text/plain" : null,
    encodeForSave: (text: string) => ({ content: text, normalizes: false }),
    sha256HexOfText: async (t: string) => {
      if (world.hashGate) await world.hashGate;
      return `sha-${t}`;
    },
    readComplete: async (ref: { version_id: string }) => ({
      last: { has_utf8_bom: false, newline: "lf" },
      text: world.versions[ref.version_id] ?? "",
    }),
  };

  const transport = {
    envelope: (command_id: string) => ({
      request_id: `req-${command_id}`,
      command_id,
    }),
    createFile: (_ws: string, _cid: string, body: Record<string, unknown>) => {
      const d = deferred<unknown>();
      world.createCalls.push({ body: JSON.parse(JSON.stringify(body)), d });
      return d.promise;
    },
    editFile: (_ws: string, _fid: string, body: Record<string, unknown>) => {
      const d = deferred<{ current: Record<string, string> }>();
      world.editCalls.push({ body: JSON.parse(JSON.stringify(body)), d });
      return d.promise;
    },
    readVersion: () => {
      throw new Error("readVersion is unused: readComplete is synthetic");
    },
    listFiles: async () => ({ items: [] }),
    compareVersions: () => {
      throw new Error("not exercised");
    },
    requestExport: () => {
      throw new Error("not exercised");
    },
    downloadVerifiedExport: () => {
      throw new Error("not exercised");
    },
  };

  const stubs: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@/lib/client/api": { newCommandId: () => `cmd-${++world.cmdSeq}` },
    "@/lib/client/session-scope": { scopedSession },
    "./session-scope": { scopedSession },
    "@/lib/contract/errors": {
      ApiError,
      describeError: (e: unknown) => ({
        title: e instanceof Error ? e.message : String(e),
        nextAction: "Retry",
      }),
    },
    "@/lib/files-contract": filesContract,
    "@/lib/client/workspace-files": transport,
  };

  const real: Record<string, string> = {
    "@/lib/file-draft": "lib/file-draft.ts",
    "@/lib/client/pending-command": "lib/client/pending-command.ts",
  };

  const cache = new Map<string, Record<string, unknown>>();
  function load(rel: string): Record<string, unknown> {
    if (cache.has(rel)) return cache.get(rel)!;
    const file = path.join(ROOT, rel);
    let src = fs.readFileSync(file, "utf8");
    if (rel.endsWith("WorkspaceFiles.tsx"))
      src += "\nexport { FileCreator, FileEditor };\n";
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(rel, module.exports);
    const requireShim = (spec: string) => {
      if (spec in stubs) return stubs[spec];
      const realRel = real[spec];
      if (realRel !== undefined) return load(realRel);
      throw new Error(`unexpected import ${spec} from ${rel}`);
    };
    vm.compileFunction(out, ["require", "exports", "module"], {
      filename: file,
    })(requireShim, module.exports, module);
    return module.exports;
  }

  function renderInstance(inst: Instance) {
    if (!inst.mounted) return;
    inst.cursor = 0;
    inst.newEffects = [];
    inst.dirty = false;
    const prev = world.current;
    world.current = inst;
    try {
      inst.tree = inst.component(inst.props);
    } finally {
      world.current = prev;
    }
    const old = inst.effects;
    inst.effects = inst.newEffects;
    inst.effects.forEach((e, i) => {
      const p = old[i];
      const same =
        p &&
        e.deps &&
        p.deps &&
        e.deps.length === p.deps.length &&
        e.deps.every((d, j) => Object.is(d, p.deps![j]));
      if (same) {
        e.cleanup = p.cleanup;
        return;
      }
      if (p?.cleanup) p.cleanup();
      e.cleanup = e.fn();
    });
  }
  function flushSync() {
    for (let n = 0; n < 200; n++) {
      const d = world.instances.find((i) => i.mounted && i.dirty);
      if (!d) return;
      renderInstance(d);
    }
    throw new Error("render did not settle");
  }
  function mount(
    component: Instance["component"],
    props: Instance["props"],
  ): Instance {
    const inst: Instance = {
      component,
      props,
      slots: [],
      cursor: 0,
      effects: [],
      newEffects: [],
      tree: null,
      dirty: false,
      mounted: true,
    };
    world.instances.push(inst);
    renderInstance(inst);
    flushSync();
    return inst;
  }
  function unmount(inst: Instance) {
    inst.mounted = false;
    for (let i = inst.effects.length - 1; i >= 0; i--)
      nth(inst.effects, i).cleanup?.();
  }
  async function settle() {
    for (let k = 0; k < 25; k++) {
      await new Promise((r) => setTimeout(r, 0));
      flushSync();
    }
  }

  const mod = load("components/WorkspaceFiles.tsx");
  return {
    world,
    mount,
    unmount,
    settle,
    FileCreator: mod.FileCreator as Instance["component"],
    FileEditor: mod.FileEditor as Instance["component"],
  };
}

/* ------------------------------------------------------------------ */
/* Tree queries                                                       */
/* ------------------------------------------------------------------ */

type Node = { type: unknown; props: Record<string, unknown> };
function* walk(node: unknown): Generator<Node> {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) yield* walk(c);
    return;
  }
  const n = node as Node;
  yield n;
  yield* walk(n.props?.children);
}
function textOf(node: unknown): string {
  let out = "";
  const rec = (n: unknown): void => {
    if (n == null || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") {
      out += n;
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(rec);
      return;
    }
    if (typeof n === "object") rec((n as Node).props?.children);
  };
  rec(node);
  return out;
}
function button(inst: Instance, re: RegExp): Node {
  for (const n of walk(inst.tree))
    if (n.type === "button" && re.test(textOf(n))) return n;
  throw new Error(`button not found: ${re}`);
}
function maybeButton(inst: Instance, re: RegExp): Node | null {
  for (const n of walk(inst.tree))
    if (n.type === "button" && re.test(textOf(n))) return n;
  return null;
}
function field(inst: Instance, type: "input" | "textarea"): Node {
  for (const n of walk(inst.tree))
    if (n.type === type && n.props?.type !== "checkbox") return n;
  throw new Error(`${type} not found`);
}
function fire(node: Node, value: string) {
  (node.props.onChange as (e: unknown) => void)({ target: { value } });
}
function click(node: Node) {
  expect(Boolean(node.props.disabled)).toBe(false);
  (node.props.onClick as () => void)();
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const NEWER = "second newer human edit";
const editorFile = {
  workspace_file_id: "wf1",
  filename: "notes.txt",
  mime_type: "text/plain",
  byte_length: 8,
  editable: true,
  current: { workspace_file_id: "wf1", version_id: "v1", sha256: "hash-v1" },
};
const SAVE_KEY = "workagent:file-save:wf1";
const DRAFT_KEY = "workagent:file-draft:wf1";
const CREATE_KEY = "workagent:file-create:ws1:c1";
const NEW_KEY = "workagent:file-new:ws1:c1";
const noRefresh = async () => {};

describe("workspace files replay/remount races (R3/R4)", () => {
  it("R3: an unresolved save's exact replay never deletes newer human edits", async () => {
    const w = makeWorld();
    const ed = w.mount(w.FileEditor, {
      ws: "ws1",
      file: editorFile,
      workVersion: 7,
      refreshList: noRefresh,
    });
    await w.settle();

    fire(field(ed, "textarea"), "first edit");
    await w.settle();
    click(button(ed, /^Save$/));
    await w.settle();
    expect(w.world.editCalls).toHaveLength(1);
    // The response is lost: the outcome is ambiguous and the envelope stays.
    nth(w.world.editCalls, 0).d.reject(
      new ApiError("The save outcome is unknown", {
        status: 504,
        code: "upstream_timeout",
        ambiguous: true,
      }),
    );
    await w.settle();
    const journal = w.world.store.get(SAVE_KEY);
    expect(journal).toBeDefined();
    expect(JSON.parse(journal!).content).toBe("first edit");

    // Either the editor refuses newer edits while the envelope is unresolved,
    // or those newer edits must survive the exact replay's acknowledgement.
    const ta = field(ed, "textarea");
    const blocked = Boolean(ta.props.disabled);
    if (!blocked) {
      fire(ta, NEWER);
      await w.settle();
    }

    click(button(ed, /Retry the same save/));
    await w.settle();
    expect(w.world.editCalls).toHaveLength(2);
    // The replay carries the exact old envelope, not a rebuilt one.
    expect(nth(w.world.editCalls, 1).body.content).toBe("first edit");
    expect(nth(w.world.editCalls, 1).body.command_id).toBe(
      nth(w.world.editCalls, 0).body.command_id,
    );
    w.world.versions.v2 = "first edit";
    nth(w.world.editCalls, 1).d.resolve({
      current: {
        workspace_file_id: "wf1",
        version_id: "v2",
        sha256: "sha-first edit",
      },
    });
    await w.settle();

    expect(w.world.store.get(SAVE_KEY)).toBeUndefined();
    if (blocked) {
      // Nothing newer existed; the acknowledged generation is cleared.
      expect(w.world.store.get(DRAFT_KEY)).toBeUndefined();
    } else {
      // The newer human text survives: still in the editor or kept as a
      // recoverable draft. Replaying "first edit" must not erase it.
      const draftRaw = w.world.store.get(DRAFT_KEY);
      const editorText = field(ed, "textarea").props.value;
      const survived =
        editorText === NEWER ||
        (draftRaw !== undefined && JSON.parse(draftRaw).content === NEWER);
      expect(survived).toBe(true);
    }
  });

  it("R3: reload restores the exact envelope; a preexisting newer draft survives its replay", async () => {
    const w = makeWorld();
    const bodyA = {
      request_id: "req-cmd-A",
      command_id: "cmd-A",
      expected_work_version: 7,
      base_version_id: "v1",
      base_sha256: "hash-v1",
      content: "first edit",
      sha256: "sha-first edit",
    };
    w.world.store.set(SAVE_KEY, JSON.stringify(bodyA));
    w.world.store.set(
      DRAFT_KEY,
      JSON.stringify({
        workspace_file_id: "wf1",
        base_version_id: "v1",
        base_sha256: "hash-v1",
        content: NEWER,
        saved_at: "2026-10-28T00:00:00Z",
      }),
    );

    // "Reload": a fresh mount over the same per-tab storage.
    const ed = w.mount(w.FileEditor, {
      ws: "ws1",
      file: editorFile,
      workVersion: 7,
      refreshList: noRefresh,
    });
    await w.settle();
    // Both the journaled envelope and the newer draft text persisted.
    expect(field(ed, "textarea").props.value).toBe(NEWER);
    click(button(ed, /Retry the same save/));
    await w.settle();
    expect(w.world.editCalls).toHaveLength(1);
    expect(nth(w.world.editCalls, 0).body.command_id).toBe("cmd-A");
    expect(nth(w.world.editCalls, 0).body.content).toBe("first edit");
    w.world.versions.v2 = "first edit";
    nth(w.world.editCalls, 0).d.resolve({
      current: {
        workspace_file_id: "wf1",
        version_id: "v2",
        sha256: "sha-first edit",
      },
    });
    await w.settle();

    // Completion clears only the matching generation: the journal resolves,
    // the newer draft is preserved.
    expect(w.world.store.get(SAVE_KEY)).toBeUndefined();
    const draftRaw = w.world.store.get(DRAFT_KEY);
    expect(draftRaw).toBeDefined();
    expect(JSON.parse(draftRaw!).content).toBe(NEWER);

    // After another reload the preserved draft is still offered, never
    // silently applied to the moved head.
    w.unmount(ed);
    const ed2 = w.mount(w.FileEditor, {
      ws: "ws1",
      file: {
        ...editorFile,
        current: {
          workspace_file_id: "wf1",
          version_id: "v2",
          sha256: "sha-first edit",
        },
      },
      workVersion: 8,
      refreshList: noRefresh,
    });
    await w.settle();
    expect(maybeButton(ed2, /Load that draft anyway/)).not.toBeNull();
    expect(JSON.parse(w.world.store.get(DRAFT_KEY)!).content).toBe(NEWER);
  });

  it("R4: a late create-A completion cannot clear a newer unresolved create B", async () => {
    const w = makeWorld();
    const props = {
      ws: "ws1",
      cid: "c1",
      workVersion: 7,
      refreshList: noRefresh,
    };
    const m1 = w.mount(w.FileCreator, props);
    await w.settle();
    click(button(m1, /New file/));
    await w.settle();
    fire(field(m1, "input"), "a.txt");
    // Discrete input events: React renders the first before the next fires.
    await w.settle();
    fire(field(m1, "textarea"), "alpha");
    await w.settle();
    click(button(m1, /Create file/));
    await w.settle();
    expect(w.world.createCalls).toHaveLength(1);
    const cmdA = nth(w.world.createCalls, 0).body.command_id;
    expect(w.world.store.has(CREATE_KEY)).toBe(true);

    // Navigate away and back while A's response is still in flight.
    w.unmount(m1);
    const m2 = w.mount(w.FileCreator, props);
    await w.settle();
    click(button(m2, /Retry the same create/));
    await w.settle();
    expect(w.world.createCalls).toHaveLength(2);
    expect(nth(w.world.createCalls, 1).body.command_id).toBe(cmdA);
    // The replay of A succeeds and resolves A's journal.
    nth(w.world.createCalls, 1).d.resolve({});
    await w.settle();
    expect(w.world.store.get(CREATE_KEY)).toBeUndefined();

    // Create B; its outcome stays unknown.
    click(button(m2, /New file/));
    await w.settle();
    fire(field(m2, "input"), "b.txt");
    await w.settle();
    fire(field(m2, "textarea"), "bravo");
    await w.settle();
    click(button(m2, /Create file/));
    await w.settle();
    expect(w.world.createCalls).toHaveLength(3);
    const cmdB = nth(w.world.createCalls, 2).body.command_id as string;
    expect(cmdB).not.toBe(cmdA);

    // A's original delayed response finally lands at the dead first mount.
    nth(w.world.createCalls, 0).d.resolve({});
    await w.settle();

    // B's journal and draft are untouched: its exact replay identity remains.
    const journal = w.world.store.get(CREATE_KEY);
    expect(journal).toBeDefined();
    expect(JSON.parse(journal!).command_id).toBe(cmdB);
    const draft = w.world.store.get(NEW_KEY);
    expect(draft).toBeDefined();
    expect(JSON.parse(draft!).filename).toBe("b.txt");

    // After a reload, exactly B is restored for replay.
    w.unmount(m2);
    const m3 = w.mount(w.FileCreator, props);
    await w.settle();
    expect(maybeButton(m3, /Retry the same create/)).not.toBeNull();
    expect(field(m3, "textarea").props.value).toBe("bravo");
    expect(
      JSON.parse(w.world.store.get(CREATE_KEY)!).command_id,
    ).toBe(cmdB);
  });

  it("R4: a pre-send hash still running when the mount dies never journals a command", async () => {
    const w = makeWorld();
    const gate = deferred<void>();
    w.world.hashGate = gate.promise;
    const props = {
      ws: "ws1",
      cid: "c1",
      workVersion: 7,
      refreshList: noRefresh,
    };
    const m1 = w.mount(w.FileCreator, props);
    await w.settle();
    click(button(m1, /New file/));
    await w.settle();
    fire(field(m1, "input"), "a.txt");
    // Discrete input events: React renders the first before the next fires.
    await w.settle();
    fire(field(m1, "textarea"), "alpha");
    await w.settle();
    click(button(m1, /Create file/));
    await w.settle();
    // Still hashing: nothing journaled, nothing sent.
    expect(w.world.store.has(CREATE_KEY)).toBe(false);
    expect(w.world.createCalls).toHaveLength(0);

    w.unmount(m1);
    gate.resolve();
    await w.settle();

    // The dead mount neither journals a command nor sends the request.
    expect(w.world.store.has(CREATE_KEY)).toBe(false);
    expect(w.world.createCalls).toHaveLength(0);
  });

  for (const order of ["old A first", "live replay first"] as const)
    it(`R4: create A sent, remounted and replayed; ${order} — both successes resolve A`, async () => {
      const w = makeWorld();
      const props = { ws: "ws1", cid: "c1", workVersion: 7, refreshList: noRefresh };
      const m1 = w.mount(w.FileCreator, props);
      await w.settle();
      click(button(m1, /New file/));
      await w.settle();
      fire(field(m1, "input"), "a.txt");
      await w.settle();
      fire(field(m1, "textarea"), "alpha");
      await w.settle();
      click(button(m1, /Create file/));
      await w.settle();
      expect(w.world.createCalls).toHaveLength(1);

      w.unmount(m1);
      const m2 = w.mount(w.FileCreator, props);
      await w.settle();
      click(button(m2, /Retry the same create/));
      await w.settle();
      expect(w.world.createCalls).toHaveLength(2);
      const original = nth(w.world.createCalls, 0);
      const replay = nth(w.world.createCalls, 1);
      // The replay is the exact journaled envelope.
      expect(replay.body).toEqual(original.body);

      const [first, second] =
        order === "old A first" ? [original, replay] : [replay, original];
      first.d.resolve({});
      await w.settle();
      if (order === "old A first") {
        // The dead mount resolved nothing: the live replay still owns A.
        expect(w.world.store.has(CREATE_KEY)).toBe(true);
        expect(w.world.store.has(NEW_KEY)).toBe(true);
      }
      second.d.resolve({});
      await w.settle();

      expect(w.world.store.has(CREATE_KEY)).toBe(false);
      expect(w.world.store.has(NEW_KEY)).toBe(false);
      expect(maybeButton(m2, /Retry the same create/)).toBeNull();
      expect(maybeButton(m2, /New file/)).not.toBeNull();
      // No fresh command was ever generated for A.
      expect(w.world.createCalls).toHaveLength(2);

      // A later reload finds nothing to replay.
      w.unmount(m2);
      const m3 = w.mount(w.FileCreator, props);
      await w.settle();
      expect(maybeButton(m3, /Retry the same create/)).toBeNull();
    });

  for (const order of ["old A first", "live replay first"] as const)
    it(`R3/R4: save A sent, remounted and replayed; ${order} — both acks resolve A`, async () => {
      const w = makeWorld();
      const props = { ws: "ws1", file: editorFile, workVersion: 7, refreshList: noRefresh };
      const ed1 = w.mount(w.FileEditor, props);
      await w.settle();
      fire(field(ed1, "textarea"), "first edit");
      await w.settle();
      click(button(ed1, /^Save$/));
      await w.settle();
      expect(w.world.editCalls).toHaveLength(1);
      expect(w.world.store.has(SAVE_KEY)).toBe(true);

      w.unmount(ed1);
      const ed2 = w.mount(w.FileEditor, props);
      await w.settle();
      click(button(ed2, /Retry the same save/));
      await w.settle();
      expect(w.world.editCalls).toHaveLength(2);
      const original = nth(w.world.editCalls, 0);
      const replay = nth(w.world.editCalls, 1);
      expect(replay.body).toEqual(original.body);

      w.world.versions.v2 = "first edit";
      const ack = {
        current: { workspace_file_id: "wf1", version_id: "v2", sha256: "sha-first edit" },
      };
      const [first, second] =
        order === "old A first" ? [original, replay] : [replay, original];
      first.d.resolve(ack);
      await w.settle();
      if (order === "old A first") {
        // The dead mount resolved nothing: the live replay still owns A.
        expect(w.world.store.has(SAVE_KEY)).toBe(true);
        expect(w.world.store.has(DRAFT_KEY)).toBe(true);
      }
      second.d.resolve(ack);
      await w.settle();

      expect(w.world.store.has(SAVE_KEY)).toBe(false);
      // The acknowledged generation's draft is cleared; nothing newer existed.
      expect(w.world.store.has(DRAFT_KEY)).toBe(false);
      expect(maybeButton(ed2, /Retry the same save/)).toBeNull();
      expect(field(ed2, "textarea").props.value).toBe("first edit");
      expect(w.world.editCalls).toHaveLength(2);
    });

  it("R4: old A success after remount never touches a newer unresolved create B", async () => {
    const w = makeWorld();
    const props = { ws: "ws1", cid: "c1", workVersion: 7, refreshList: noRefresh };
    const m1 = w.mount(w.FileCreator, props);
    await w.settle();
    click(button(m1, /New file/));
    await w.settle();
    fire(field(m1, "input"), "a.txt");
    await w.settle();
    fire(field(m1, "textarea"), "alpha");
    await w.settle();
    click(button(m1, /Create file/));
    await w.settle();
    const cmdA = nth(w.world.createCalls, 0).body.command_id;

    w.unmount(m1);
    const m2 = w.mount(w.FileCreator, props);
    await w.settle();
    click(button(m2, /Retry the same create/));
    await w.settle();
    nth(w.world.createCalls, 1).d.resolve({});
    await w.settle();
    click(button(m2, /New file/));
    await w.settle();
    fire(field(m2, "input"), "b.txt");
    await w.settle();
    fire(field(m2, "textarea"), "bravo");
    await w.settle();
    click(button(m2, /Create file/));
    await w.settle();
    const cmdB = nth(w.world.createCalls, 2).body.command_id;
    expect(cmdB).not.toBe(cmdA);

    // The dead mount's original A fails definitively after B was journaled.
    nth(w.world.createCalls, 0).d.reject(
      new ApiError("refused", { status: 409, code: "conflict" }),
    );
    await w.settle();
    expect(JSON.parse(w.world.store.get(CREATE_KEY) ?? "{}").command_id).toBe(cmdB);
    expect(JSON.parse(w.world.store.get(NEW_KEY) ?? "{}").filename).toBe("b.txt");

    // B's own success then resolves exactly B.
    nth(w.world.createCalls, 2).d.resolve({});
    await w.settle();
    expect(w.world.store.has(CREATE_KEY)).toBe(false);
    expect(w.world.store.has(NEW_KEY)).toBe(false);
    expect(maybeButton(m2, /New file/)).not.toBeNull();
    expect(w.world.createCalls).toHaveLength(3);
  });
});
