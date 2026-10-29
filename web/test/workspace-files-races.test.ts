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
    message: string | { message: string; status?: number; code?: string },
    opts: { status?: number; code?: string; ambiguous?: boolean } = {},
  ) {
    // Also accepts the real ApiError's object form used by production code.
    if (typeof message === "object") {
      opts = { status: message.status, code: message.code };
      message = message.message;
    }
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
    // Canonical work snapshot the citations binding is read from.
    snapshotReply: { conversation_id: "c1", artifacts: [] } as unknown,
    snapshotFails: null as unknown,
    snapshotCalls: [] as Record<string, unknown>[],
    exportCalls: [] as {
      raw: string;
      d: ReturnType<typeof deferred<unknown>>;
    }[],
    importCalls: [] as {
      cid: string;
      raw: string;
      d: ReturnType<typeof deferred<unknown>>;
    }[],
    downloads: 0,
    listItems: [] as unknown[],
    listFails: null as unknown,
  };

  const React = {
    useState<T>(init: T | (() => T)) {
      const inst = world.current!;
      const i = inst.cursor++;
      if (!(i in inst.slots))
        inst.slots[i] = typeof init === "function" ? (init as () => T)() : init;
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
    useMemo<T>(fn: () => T, deps: unknown[]) {
      const inst = world.current!;
      const i = inst.cursor++;
      const prev = inst.slots[i] as { deps: unknown[]; value: T } | undefined;
      if (
        prev &&
        prev.deps.length === deps.length &&
        prev.deps.every((d, j) => Object.is(d, deps[j]))
      )
        return prev.value;
      const value = fn();
      inst.slots[i] = { deps, value };
      return value;
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
    mimeForFilename: (f: string) => (f.endsWith(".txt") ? "text/plain" : null),
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
      schema_version: "workagent/v1",
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
    listFiles: async () => {
      if (world.listFails) throw world.listFails;
      return JSON.parse(JSON.stringify({ items: world.listItems }));
    },
    compareVersions: () => {
      throw new Error("not exercised");
    },
    requestExport: (
      _ws: string,
      _fid: string,
      body: Record<string, unknown>,
    ) => {
      const d = deferred<unknown>();
      world.exportCalls.push({ raw: JSON.stringify(body), d });
      return d.promise;
    },
    importOfficeDraft: (
      _ws: string,
      cid: string,
      body: Record<string, unknown>,
    ) => {
      const d = deferred<unknown>();
      world.importCalls.push({ cid, raw: JSON.stringify(body), d });
      return d.promise;
    },
    downloadVerifiedExport: async () => {
      world.downloads++;
      throw new Error("download not exercised");
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
    "./ResearchSources": { ResearchSources: () => null, ArtifactCitations },
    "@/lib/client/real-api": {
      meta: () => ({ "x-schema-version": "workagent/v1" }),
      client: {
        GET: (route: string, opts: { params: Record<string, unknown> }) => {
          world.snapshotCalls.push({ route, ...opts.params });
          return Promise.resolve(
            world.snapshotFails
              ? { error: world.snapshotFails }
              : { data: JSON.parse(JSON.stringify(world.snapshotReply)) },
          );
        },
      },
      unwrap: async (p: Promise<{ data?: unknown; error?: unknown }>) => {
        const r = await p;
        if (r.error) throw r.error;
        return r.data;
      },
    },
    "@/lib/contract/work-events": {
      parseWorkSnapshot: (raw: unknown) => Object.freeze(raw),
    },
  };

  const real: Record<string, string> = {
    "@/lib/file-draft": "lib/file-draft.ts",
    "@/lib/client/pending-command": "lib/client/pending-command.ts",
    "@/lib/office-export": "lib/office-export.ts",
    "./FileExport": "components/FileExport.tsx",
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
  const exp = load("components/FileExport.tsx");
  return {
    world,
    mount,
    unmount,
    settle,
    FileExport: exp.FileExport as Instance["component"],
    WorkspaceFiles: mod.WorkspaceFiles as Instance["component"],
    EditableCopyAction: exp.EditableCopyAction as Instance["component"],
    FileCreator: mod.FileCreator as Instance["component"],
    FileEditor: mod.FileEditor as Instance["component"],
  };
}

/** Marker for the citations consumer; the synthetic jsx never calls it. */
function ArtifactCitations(): null {
  return null;
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
  conversation_id: "c1",
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
    expect(JSON.parse(w.world.store.get(CREATE_KEY)!).command_id).toBe(cmdB);
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
      const props = {
        ws: "ws1",
        file: editorFile,
        workVersion: 7,
        refreshList: noRefresh,
      };
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
        current: {
          workspace_file_id: "wf1",
          version_id: "v2",
          sha256: "sha-first edit",
        },
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
    expect(JSON.parse(w.world.store.get(CREATE_KEY) ?? "{}").command_id).toBe(
      cmdB,
    );
    expect(JSON.parse(w.world.store.get(NEW_KEY) ?? "{}").filename).toBe(
      "b.txt",
    );

    // B's own success then resolves exactly B.
    nth(w.world.createCalls, 2).d.resolve({});
    await w.settle();
    expect(w.world.store.has(CREATE_KEY)).toBe(false);
    expect(w.world.store.has(NEW_KEY)).toBe(false);
    expect(maybeButton(m2, /New file/)).not.toBeNull();
    expect(w.world.createCalls).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */
/* B3.2a: the working-file editor's citations consumer                */
/* ------------------------------------------------------------------ */

function citationsOf(inst: Instance): Node[] {
  return [...walk(inst.tree)].filter((n) => n.type === ArtifactCitations);
}
const artifact = (rev: string, body: string) => ({
  id: "art1",
  title: "research-conclusion.txt",
  kind: "file",
  current_revision_id: rev,
  body_hash: body,
});

describe("working-file editor citations (files.create_draft consumer)", () => {
  it("mounts ArtifactCitations on the exact saved artifact/revision/body hash", async () => {
    const w = makeWorld();
    w.world.snapshotReply = {
      conversation_id: "c1",
      artifacts: [
        { ...artifact("other-rev", "other-body"), id: "art-other" },
        artifact("v1", "body-v1"),
      ],
    };
    const ed = w.mount(w.FileEditor, {
      ws: "ws1",
      file: editorFile,
      workVersion: 7,
      refreshList: noRefresh,
    });
    await w.settle();
    expect(w.world.snapshotCalls).toEqual([
      {
        route: "/v1/workspaces/{workspace_id}/work-snapshot",
        path: { workspace_id: "ws1" },
        query: { conversation_id: "c1" },
        header: { "x-schema-version": "workagent/v1" },
      },
    ]);
    const cites = citationsOf(ed);
    expect(cites).toHaveLength(1);
    expect(nth(cites, 0).props).toMatchObject({
      ws: "ws1",
      artifactId: "art1",
      revisionId: "v1",
      bodyHash: "body-v1",
    });
    expect(field(ed, "textarea").props.value).toBe("original");
  });

  it("dirty text never rebinds citations, and a metadata refresh leaves the human edit untouched", async () => {
    const w = makeWorld();
    w.world.snapshotReply = {
      conversation_id: "c1",
      artifacts: [artifact("v1", "body-v1")],
    };
    const ed = w.mount(w.FileEditor, {
      ws: "ws1",
      file: editorFile,
      workVersion: 7,
      refreshList: noRefresh,
    });
    await w.settle();
    fire(field(ed, "textarea"), "unsaved human words");
    await w.settle();
    expect(nth(citationsOf(ed), 0).props.revisionId).toBe("v1");
    expect(textOf(ed.tree)).toMatch(/describe the last saved version/);

    // A list refresh delivers fresh metadata (same version, then a moved
    // head); the mounted editor keeps the exact human text and its binding.
    w.world.versions.v2 = "someone else's newer save";
    w.world.snapshotReply = {
      conversation_id: "c1",
      artifacts: [artifact("v2", "body-v2")],
    };
    for (const current of [
      editorFile.current,
      { workspace_file_id: "wf1", version_id: "v2", sha256: "hash-v2" },
    ]) {
      ed.props = { ...ed.props, file: { ...editorFile, current } };
      ed.dirty = true;
      await w.settle();
      expect(field(ed, "textarea").props.value).toBe("unsaved human words");
      const cites = citationsOf(ed);
      expect(cites).toHaveLength(1);
      expect(nth(cites, 0).props).toMatchObject({
        revisionId: "v1",
        bodyHash: "body-v1",
      });
    }
    expect(w.world.snapshotCalls).toHaveLength(1);
  });

  it("binds nothing when the snapshot head is not the saved version or the read is refused", async () => {
    const moved = makeWorld();
    moved.world.snapshotReply = {
      conversation_id: "c1",
      artifacts: [artifact("v2", "body-v2")],
    };
    const a = moved.mount(moved.FileEditor, {
      ws: "ws1",
      file: editorFile,
      workVersion: 7,
      refreshList: noRefresh,
    });
    await moved.settle();
    expect(citationsOf(a)).toHaveLength(0);

    const refused = makeWorld();
    refused.world.snapshotFails = new ApiError("Not found", {
      status: 404,
      code: "not_found",
    });
    const b = refused.mount(refused.FileEditor, {
      ws: "ws1",
      file: editorFile,
      workVersion: 7,
      refreshList: noRefresh,
    });
    await refused.settle();
    expect(citationsOf(b)).toHaveLength(0);
    expect(field(b, "textarea").props.value).toBe("original");
  });

  it("a save rebinds to the newly saved revision's exact body hash", async () => {
    const w = makeWorld();
    w.world.snapshotReply = {
      conversation_id: "c1",
      artifacts: [artifact("v1", "body-v1")],
    };
    const ed = w.mount(w.FileEditor, {
      ws: "ws1",
      file: editorFile,
      workVersion: 7,
      refreshList: noRefresh,
    });
    await w.settle();
    fire(field(ed, "textarea"), "saved human words");
    await w.settle();
    click(button(ed, /^Save$/));
    await w.settle();
    w.world.versions.v2 = "saved human words";
    w.world.snapshotReply = {
      conversation_id: "c1",
      artifacts: [artifact("v2", "body-v2")],
    };
    nth(w.world.editCalls, 0).d.resolve({
      current: {
        workspace_file_id: "wf1",
        version_id: "v2",
        sha256: "sha-saved human words",
      },
    });
    await w.settle();
    const cites = citationsOf(ed);
    expect(cites).toHaveLength(1);
    expect(nth(cites, 0).props).toMatchObject({
      artifactId: "art1",
      revisionId: "v2",
      bodyHash: "body-v2",
    });
    expect(field(ed, "textarea").props.value).toBe("saved human words");
  });
});

/* ------------------------------------------------------------------ */
/* B3.2b office exports and editable copies                           */
/* ------------------------------------------------------------------ */

const EXPORT_KEY = "workagent:file-export:wf1";
const csvFile = { ...editorFile, filename: "sales.csv", mime_type: "text/csv" };
const SAVED_CSV = "region,amount,rep\nNorth,10,a\nSouth,5,b\nNorth,2,c\n";
const savedRef = {
  workspace_file_id: "wf1",
  version_id: "v1",
  sha256: "hash-v1",
};
const cell = (
  address: string,
  kind: string,
  value: string | boolean | null,
) => ({
  address,
  kind,
  value,
  cached_value: null,
});
const WORKBOOK = JSON.stringify({
  office_version: "office-v1",
  kind: "workbook",
  sheets: [
    {
      name: "Data",
      cells: [
        cell("A1", "string", "region"),
        cell("B1", "string", "amount"),
        cell("A2", "string", "North"),
        cell("B2", "number", "10"),
        cell("A3", "string", "South"),
        cell("B3", "number", "2.5"),
      ],
    },
  ],
  annotations: ["checked by a human"],
});
const jsonFile = {
  ...editorFile,
  filename: "office.json",
  mime_type: "application/json",
};

function selects(inst: Instance): Node[] {
  return [...walk(inst.tree)].filter((n) => n.type === "select");
}
function inputs(inst: Instance): Node[] {
  return [...walk(inst.tree)].filter((n) => n.type === "input");
}
function optionValues(sel: Node): string[] {
  return [...walk(sel.props.children)]
    .filter((n) => n.type === "option")
    .map((n) => String(n.props.value));
}
/** Hook-free presentational children (ExportResult) are expanded inline. */
function* walkDeep(node: unknown): Generator<Node> {
  for (const n of walk(node)) {
    yield n;
    if (typeof n.type === "function" && n.type.name === "ExportResult")
      yield* walkDeep((n.type as (p: unknown) => unknown)(n.props));
  }
}
function byTestId(inst: Instance, id: string): Node | null {
  for (const n of walkDeep(inst.tree))
    if (n.props?.["data-testid"] === id) return n;
  return null;
}
function alertText(inst: Instance): string {
  return [...walk(inst.tree)]
    .filter((n) => n.props?.role === "alert")
    .map(textOf)
    .join(" ");
}
const exportButton = (inst: Instance) =>
  button(inst, /Export saved version|Retry the same export|Exporting/);

const MIMES: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  pdf: "application/pdf",
};
function manifestFor(body: Record<string, unknown>, over: object = {}) {
  const spec = body.chart_spec as Record<string, unknown> | undefined;
  return {
    export_id: "e1",
    workspace_id: "ws1",
    conversation_id: "c1",
    artifact_id: "a1",
    revision_id: body.version_id,
    input_sha256: body.sha256,
    workspace_file_id: "wf1",
    source_snapshot_id: null,
    format: body.format,
    filename: `export.${body.format}`,
    blob: {
      kind: "generated_blob",
      blob_id: "b1",
      sha256: "digest-1",
      byte_length: 42,
      mime_type: MIMES[body.format as string],
    },
    created_at: "2026-10-29T00:00:00Z",
    annotations: "explicit_omissions",
    omissions: ["Chart pixels omit input annotations and source details"],
    exporter_version: "office-exports-v1",
    fidelity:
      "Editable values and plain paragraphs; constrained layout; no office-suite fidelity.",
    provenance: null,
    chart: spec
      ? {
          computation_version: "decimal-grouped-v1",
          input_sha256: body.sha256,
          null_handling: "reject",
          decimal_precision: 160,
          rounding: "ROUND_HALF_EVEN",
          spec,
          rows: [
            { category: "North", value: "12", count: 2 },
            { category: "South", value: "5", count: 1 },
          ],
        }
      : null,
    ...over,
  };
}

async function mountExport(
  w: ReturnType<typeof makeWorld>,
  opts: { file?: object; text?: string; dirty?: boolean } = {},
): Promise<Instance> {
  const inst = w.mount(w.FileExport, {
    ws: "ws1",
    file: opts.file ?? csvFile,
    saved: savedRef,
    savedText: opts.text ?? SAVED_CSV,
    dirty: opts.dirty ?? false,
    workVersion: 7,
    openFile: async () => {},
  });
  await w.settle();
  return inst;
}

async function choosePngChart(w: ReturnType<typeof makeWorld>, inst: Instance) {
  fire(nth(selects(inst), 0), "png");
  await w.settle();
  fire(nth(inputs(inst), 0), "Sales by region");
  await w.settle();
}

describe("office export choices and chart parameters (B3.2b)", () => {
  it("offers every canonical format; png enables only for a valid chart on a saved table", async () => {
    const w = makeWorld();
    const txt = await mountExport(w, { file: editorFile, text: "plain words" });
    expect(optionValues(nth(selects(txt), 0))).toEqual([
      "txt",
      "markdown",
      "csv",
      "json",
      "docx",
      "xlsx",
      "pdf",
      "png",
    ]);
    for (const f of ["docx", "xlsx", "pdf"]) {
      fire(nth(selects(txt), 0), f);
      await w.settle();
      expect(Boolean(exportButton(txt).props.disabled)).toBe(false);
    }
    fire(nth(selects(txt), 0), "png");
    await w.settle();
    expect(Boolean(exportButton(txt).props.disabled)).toBe(true);
    expect(textOf(byTestId(txt, "export-problem"))).toMatch(
      /saved CSV or a single-sheet workbook/,
    );

    const csv = await mountExport(w);
    fire(nth(selects(csv), 0), "png");
    await w.settle();
    const [, cat, agg, val] = selects(csv);
    expect(optionValues(cat!)).toEqual(["region", "amount", "rep"]);
    expect(optionValues(agg!)).toEqual(["sum", "count", "mean"]);
    expect(optionValues(val!)).toEqual(["", "amount"]);
    expect(Boolean(exportButton(csv).props.disabled)).toBe(true);
    expect(textOf(byTestId(csv, "export-problem"))).toMatch(/title/);
    fire(nth(inputs(csv), 0), "Sales");
    await w.settle();
    expect(Boolean(exportButton(csv).props.disabled)).toBe(false);
    fire(nth(selects(csv), 2), "count");
    await w.settle();
    expect(selects(csv)).toHaveLength(3);
    click(exportButton(csv));
    await w.settle();
    expect(JSON.parse(nth(w.world.exportCalls, 0).raw).chart_spec).toEqual({
      category_column: "region",
      value_column: null,
      aggregation: "count",
      title: "Sales",
      x_label: "region",
      y_label: "amount",
    });
  });

  it("charts a typed office-v1 workbook; generic JSON and formula sheets are refused before sending", async () => {
    const w = makeWorld();
    const wb = await mountExport(w, { file: jsonFile, text: WORKBOOK });
    await choosePngChart(w, wb);
    expect(optionValues(nth(selects(wb), 1))).toEqual(["region", "amount"]);
    click(exportButton(wb));
    await w.settle();
    expect(
      JSON.parse(nth(w.world.exportCalls, 0).raw).chart_spec,
    ).toMatchObject({
      category_column: "region",
      value_column: "amount",
      aggregation: "sum",
    });

    for (const [text, msg] of [
      [
        JSON.stringify([{ region: "N", amount: 1 }]),
        /typed office-v1 workbook/,
      ],
      [
        WORKBOOK.replace(
          '"kind":"number","value":"10"',
          '"kind":"formula","value":"=1+1"',
        ),
        /formula/,
      ],
      [
        WORKBOOK.replace('"value":"North"', '"value":""').replace(
          '"kind":"string","value":""',
          '"kind":"blank","value":null',
        ),
        /Every row needs a “region” value/,
      ],
    ] as const) {
      // A fresh tab: the workbook export above is still journaled in `w`.
      const fresh = makeWorld();
      const inst = await mountExport(fresh, { file: jsonFile, text });
      fire(nth(selects(inst), 0), "png");
      await fresh.settle();
      // A refused table shows no chart controls; a refused column still
      // shows them, so give it a title to prove the column is what blocks.
      const title = inputs(inst)[0];
      if (title) {
        fire(title, "T");
        await fresh.settle();
        fire(nth(selects(inst), 1), "region");
      }
      await fresh.settle();
      expect(Boolean(exportButton(inst).props.disabled)).toBe(true);
      expect(textOf(byTestId(inst, "export-problem"))).toMatch(msg);
    }
    expect(w.world.exportCalls).toHaveLength(1);
  });

  it("exports the exact SAVED version while an unsaved edit stays, and shows the computed chart", async () => {
    const w = makeWorld();
    const inst = await mountExport(w, { dirty: true });
    expect(textOf(byTestId(inst, "export-saved-only"))).toMatch(
      /not your unsaved edit/,
    );
    expect(textOf(exportButton(inst))).toBe("Export saved version v1");
    await choosePngChart(w, inst);
    click(exportButton(inst));
    await w.settle();
    const raw = nth(w.world.exportCalls, 0).raw;
    const body = JSON.parse(raw);
    expect(body).toMatchObject({
      version_id: "v1",
      sha256: "hash-v1",
      format: "png",
    });
    expect(body).not.toHaveProperty("content");
    expect(w.world.store.get(EXPORT_KEY)).toBe(raw);
    nth(w.world.exportCalls, 0).d.resolve(
      manifestFor(body, {
        provenance: {
          source_snapshot_id: "snap1",
          original_sha256: "orig-hash",
          extraction_sha256: "ext-hash",
          parser_version: "office-import-v1",
          transformation_version: "office-v1",
        },
      }),
    );
    await w.settle();
    expect(w.world.store.get(EXPORT_KEY)).toBeUndefined();
    const result = byTestId(inst, "export-result")!;
    expect(result.props["data-format"]).toBe("png");
    expect(textOf(byTestId(inst, "export-digest"))).toBe("digest-1");
    const details = textOf(result);
    expect(details).toMatch(/image\/png/);
    expect(details).toMatch(
      /Disclosed in this export as omitted: Chart pixels omit input annotations/,
    );
    expect(details).toMatch(/no office-suite fidelity/);
    expect(details).toMatch(
      /sum of amount by region, computed by the exporter \(decimal-grouped-v1/,
    );
    expect(details).toMatch(/from input\s+SHA-256 hash-v1/);
    expect(details).toMatch(/160-digit\s+decimals, ROUND_HALF_EVEN rounding/);
    expect(details).toMatch(/North122/);
    expect(textOf(byTestId(inst, "export-provenance"))).toMatch(
      /snap1.*orig-hash/,
    );
    expect(details).not.toMatch(/validated|understood/i);
    expect(
      [...walkDeep(inst.tree)].some(
        (n) => n.type === "button" && /Download/.test(textOf(n)),
      ),
    ).toBe(true);
  });

  it("long IDs, hashes and MIME types in export details wrap inside a narrow viewport", async () => {
    const w = makeWorld();
    const inst = await mountExport(w, { file: jsonFile, text: WORKBOOK });
    await choosePngChart(w, inst);
    click(exportButton(inst));
    await w.settle();
    const body = JSON.parse(nth(w.world.exportCalls, 0).raw);
    const long = "f".repeat(64);
    nth(w.world.exportCalls, 0).d.resolve(
      manifestFor(body, {
        revision_id: body.version_id,
        blob: {
          kind: "generated_blob",
          blob_id: "b",
          sha256: long,
          byte_length: 9,
          mime_type: "image/png",
        },
        provenance: {
          source_snapshot_id: "s".repeat(40),
          original_sha256: long,
          extraction_sha256: long,
          parser_version: "p",
          transformation_version: "office-v1",
        },
      }),
    );
    await w.settle();
    const nodes = [...walkDeep(inst.tree)];
    const wraps = (n: Node) => {
      const st = n.props.style as Record<string, unknown> | undefined;
      return (
        st?.minWidth === 0 &&
        st?.overflowWrap === "anywhere" &&
        st?.maxWidth === "100%"
      );
    };
    for (const type of ["details", "dl", "dd", "table"]) {
      const of = nodes.filter((n) => n.type === type);
      expect(of.length, type).toBeGreaterThan(0);
      for (const n of of) expect(wraps(n), type).toBe(true);
    }
    expect(wraps(byTestId(inst, "export-result")!)).toBe(true);
    expect(wraps(byTestId(inst, "export-digest")!)).toBe(true);
    expect(wraps(byTestId(inst, "export-provenance")!)).toBe(true);
    const chart = byTestId(inst, "export-chart-details")!;
    expect(wraps(chart)).toBe(true);
    expect((chart.props.style as Record<string, unknown>).overflowX).toBe(
      "auto",
    );
  });

  it.each([
    ["format", { format: "pdf" }, /Requested png but the export is pdf/],
    ["version", { revision_id: "v0" }, /different saved version/],
    ["hash", { input_sha256: "other" }, /different saved version/],
    ["file", { workspace_file_id: "wf9" }, /different file/],
    [
      "mime",
      {
        blob: {
          kind: "generated_blob",
          blob_id: "b",
          sha256: "d",
          byte_length: 1,
          mime_type: "image/jpeg",
        },
      },
      /type \(image\/jpeg\)/,
    ],
    ["chart missing", { chart: null }, /did not report the chart/],
    [
      "chart input hash",
      {
        chart: {
          computation_version: "decimal-grouped-v1",
          input_sha256: "not-the-saved-csv",
          null_handling: "reject",
          decimal_precision: 160,
          rounding: "ROUND_HALF_EVEN",
          rows: [{ category: "North", value: "12", count: 2 }],
          spec: {
            category_column: "region",
            value_column: "amount",
            aggregation: "sum",
            title: "Sales by region",
            x_label: "region",
            y_label: "amount",
          },
        },
      },
      /computed from different input than the saved version/,
    ],
    [
      "chart differs",
      {
        chart: {
          computation_version: "decimal-grouped-v1",
          input_sha256: "x",
          null_handling: "reject",
          rows: [{ category: "a", value: "1", count: 1 }],
          spec: {
            category_column: "rep",
            value_column: "amount",
            aggregation: "sum",
            title: "Sales by region",
            x_label: "region",
            y_label: "amount",
          },
        },
      },
      /different chart settings/,
    ],
  ])(
    "a %s readback mismatch offers nothing and does not retry",
    async (_n, over, msg) => {
      const w = makeWorld();
      const inst = await mountExport(w);
      await choosePngChart(w, inst);
      click(exportButton(inst));
      await w.settle();
      const body = JSON.parse(nth(w.world.exportCalls, 0).raw);
      nth(w.world.exportCalls, 0).d.resolve(manifestFor(body, over));
      await w.settle();
      expect(byTestId(inst, "export-result")).toBeNull();
      expect(maybeButton(inst, /Download/)).toBeNull();
      expect(alertText(inst)).toMatch(msg);
      expect(w.world.exportCalls).toHaveLength(1);
      // The refused answer leaves the exact command journaled (unresolved).
      expect(w.world.store.get(EXPORT_KEY)).toBe(
        nth(w.world.exportCalls, 0).raw,
      );
    },
  );

  it("an ambiguous export replays the exact stored body (chart_spec included) even after controls change", async () => {
    const w = makeWorld();
    const inst = await mountExport(w);
    await choosePngChart(w, inst);
    click(exportButton(inst));
    await w.settle();
    const first = nth(w.world.exportCalls, 0).raw;
    nth(w.world.exportCalls, 0).d.reject(
      new ApiError("timeout", { status: 504, ambiguous: true }),
    );
    await w.settle();
    expect(w.world.store.get(EXPORT_KEY)).toBe(first);
    expect(Boolean(nth(selects(inst), 0).props.disabled)).toBe(true);
    expect(w.world.exportCalls).toHaveLength(1);
    expect(textOf(byTestId(inst, "export-held"))).toMatch(
      /chart “Sales by region”/,
    );
    click(button(inst, /Retry the same export/));
    await w.settle();
    expect(nth(w.world.exportCalls, 1).raw).toBe(first);
    nth(w.world.exportCalls, 1).d.reject(new ApiError("bad", { status: 422 }));
    await w.settle();
    expect(w.world.store.get(EXPORT_KEY)).toBe(first);
  });

  it("a definite refusal of a never-ambiguous export resolves it; the next export is fresh", async () => {
    const w = makeWorld();
    const inst = await mountExport(w);
    click(exportButton(inst));
    await w.settle();
    nth(w.world.exportCalls, 0).d.reject(new ApiError("bad", { status: 422 }));
    await w.settle();
    expect(w.world.store.get(EXPORT_KEY)).toBeUndefined();
    click(exportButton(inst));
    await w.settle();
    const a = JSON.parse(nth(w.world.exportCalls, 0).raw);
    const b = JSON.parse(nth(w.world.exportCalls, 1).raw);
    expect(b.command_id).not.toBe(a.command_id);
    expect(b).not.toHaveProperty("chart_spec");
  });

  it("after a reload, a stored chart export and a legacy export replay byte-for-byte", async () => {
    for (const stored of [
      {
        schema_version: "workagent/v1",
        request_id: "r-old",
        command_id: "c-old",
        version_id: "v0",
        sha256: "hash-v0",
        format: "png",
        chart_spec: {
          category_column: "rep",
          value_column: null,
          aggregation: "count",
          title: "Old",
          x_label: "",
          y_label: "",
        },
      },
      {
        schema_version: "workagent/v1",
        request_id: "r-legacy",
        command_id: "c-legacy",
        version_id: "v0",
        sha256: "hash-v0",
        format: "txt",
      },
    ]) {
      const w = makeWorld();
      const raw = JSON.stringify(stored);
      w.world.store.set(EXPORT_KEY, raw);
      const inst = await mountExport(w);
      expect(textOf(byTestId(inst, "export-held"))).toMatch(
        /recovered after a reload/,
      );
      expect(w.world.exportCalls).toHaveLength(0);
      click(button(inst, /Retry the same export/));
      await w.settle();
      expect(nth(w.world.exportCalls, 0).raw).toBe(raw);
    }
  });

  it.each([
    ["unknown format", { format: "docm" }],
    ["png without chart_spec", { format: "png" }],
    [
      "non-png with chart_spec",
      {
        format: "pdf",
        chart_spec: {
          category_column: "a",
          value_column: null,
          aggregation: "count",
          title: "t",
          x_label: "",
          y_label: "",
        },
      },
    ],
    [
      "bad aggregation",
      {
        format: "png",
        chart_spec: {
          category_column: "a",
          value_column: null,
          aggregation: "median",
          title: "t",
          x_label: "",
          y_label: "",
        },
      },
    ],
  ])(
    "an unreadable stored export (%s) is never sent; it can only be discarded",
    async (_n, over) => {
      const w = makeWorld();
      w.world.store.set(
        EXPORT_KEY,
        JSON.stringify({
          schema_version: "workagent/v1",
          request_id: "r",
          command_id: "c",
          version_id: "v0",
          sha256: "h",
          ...over,
        }),
      );
      const inst = await mountExport(w);
      expect(Boolean(exportButton(inst).props.disabled)).toBe(true);
      expect(w.world.exportCalls).toHaveLength(0);
      click(button(inst, /Discard that stored request/));
      await w.settle();
      expect(w.world.store.get(EXPORT_KEY)).toBeUndefined();
      expect(Boolean(exportButton(inst).props.disabled)).toBe(false);
    },
  );

  it("the editor hands export its verified SAVED ref and text, never the unsaved edit; source snapshots get the panel too", async () => {
    const w = makeWorld();
    const openFile = async () => {};
    const ed = w.mount(w.FileEditor, {
      ws: "ws1",
      file: editorFile,
      workVersion: 7,
      refreshList: noRefresh,
      openFile,
    });
    await w.settle();
    fire(field(ed, "textarea"), "unsaved human words");
    await w.settle();
    const node = [...walk(ed.tree)].find((n) => n.type === w.FileExport)!;
    expect(node.props.saved).toEqual(editorFile.current);
    expect(node.props.savedText).toBe("original");
    expect(node.props.dirty).toBe(true);
    expect(node.props.workVersion).toBe(7);
    expect(node.props.openFile).toBe(openFile);
    expect(field(ed, "textarea").props.value).toBe("unsaved human words");

    const src = w.mount(w.FileEditor, {
      ws: "ws1",
      file: {
        ...editorFile,
        editable: false,
        storage: "source_snapshot",
        mime_type: FORMAT_DOCX,
      },
      workVersion: 7,
      refreshList: noRefresh,
    });
    await w.settle();
    const srcNode = [...walk(src.tree)].find((n) => n.type === w.FileExport)!;
    expect(srcNode.props.savedText).toBe("original");
    expect(srcNode.props.file).toMatchObject({ mime_type: FORMAT_DOCX });
  });
});

const FORMAT_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("editable office-v1 copy of an immutable source (B3.2b)", () => {
  const docx = {
    ...editorFile,
    workspace_file_id: "src1",
    filename: "brief.docx",
    mime_type: FORMAT_DOCX,
    editable: false,
    storage: "source_snapshot",
    current: {
      workspace_file_id: "src1",
      version_id: "sv1",
      sha256: "src-hash",
    },
  };
  const KEY = "workagent:office-draft:ws1:c1:src1";
  const copy = {
    ...editorFile,
    workspace_id: "ws1",
    workspace_file_id: "copy1",
    filename: "office.json",
    mime_type: "application/json",
    editable: true,
    storage: "artifact_revision",
    office_provenance: {
      // Exactly the requested source: snapshot id = version id, extraction
      // sha256 = version sha256 of the source-snapshot file.
      source_snapshot_id: "sv1",
      original_sha256: "orig",
      extraction_sha256: "src-hash",
      parser_version: "p1",
      transformation_version: "office-v1",
    },
  };
  const mountCopy = (
    w: ReturnType<typeof makeWorld>,
    file: object,
    opened: string[] = [],
    openFails: unknown[] = [],
  ) =>
    w.mount(w.EditableCopyAction, {
      ws: "ws1",
      file,
      workVersion: 3,
      openFile: async (target: { workspace_file_id: string }) => {
        const fail = openFails.shift();
        if (fail) throw fail;
        opened.push(target.workspace_file_id);
      },
    });

  it("images are never claimed understood; editable files get no copy action", () => {
    const w = makeWorld();
    const img = mountCopy(w, { ...docx, mime_type: "image/png" });
    expect(textOf(byTestId(img, "image-not-read"))).toMatch(
      /No OCR or vision processor/,
    );
    expect(maybeButton(img, /editable copy/)).toBeNull();
    expect(mountCopy(w, csvFile).tree).toBeNull();
    expect(mountCopy(w, copy).tree).toBeNull();
  });

  it("a PDF source offers a text-layer-only copy without any OCR claim", async () => {
    const w = makeWorld();
    const opened: string[] = [];
    const pdf = mountCopy(
      w,
      { ...docx, filename: "report.pdf", mime_type: "application/pdf" },
      opened,
    );
    const text = textOf(pdf.tree);
    expect(text).toMatch(/This PDF is an unchanged original/);
    expect(text).toMatch(/text layer only; there is no OCR/);
    expect(text).toMatch(
      /scanned page without text is refused rather than read/,
    );
    expect(text).not.toMatch(/understood|recogni[sz]ed/i);
    click(button(pdf, /Create editable copy/));
    await w.settle();
    expect(JSON.parse(nth(w.world.importCalls, 0).raw).source).toEqual(
      docx.current,
    );
    nth(w.world.importCalls, 0).d.resolve(copy);
    await w.settle();
    expect(opened).toEqual(["copy1"]);
  });

  it("imports the exact source version, replays an unknown outcome exactly, then opens the new copy", async () => {
    const w = makeWorld();
    const opened: string[] = [];
    const inst = mountCopy(w, docx, opened);
    expect(textOf(inst.tree)).toMatch(
      /Styles, comments,\s+layout and embedded images are not carried over/,
    );
    click(button(inst, /Create editable copy/));
    await w.settle();
    const call = nth(w.world.importCalls, 0);
    expect(call.cid).toBe("c1");
    const body = JSON.parse(call.raw);
    expect(body).toEqual({
      schema_version: "workagent/v1",
      request_id: body.request_id,
      command_id: body.command_id,
      expected_work_version: 3,
      source: docx.current,
    });
    expect(w.world.store.get(KEY)).toBe(call.raw);
    call.d.reject(new ApiError("timeout", { status: 504, ambiguous: true }));
    await w.settle();
    expect(opened).toEqual([]);
    click(button(inst, /Retry the same copy/));
    await w.settle();
    expect(nth(w.world.importCalls, 1).raw).toBe(call.raw);
    nth(w.world.importCalls, 1).d.resolve(copy);
    await w.settle();
    expect(opened).toEqual(["copy1"]);
    expect(w.world.store.get(KEY)).toBeUndefined();
  });

  it.each([
    ["the original itself", { workspace_file_id: "src1" }, /original source/],
    ["a read-only file", { editable: false }, /editable working copy/],
    ["a non-JSON file", { mime_type: "text/plain" }, /office-v1 JSON/],
    ["no provenance", { office_provenance: null }, /which original/],
    [
      "another workspace",
      { workspace_id: "ws9" },
      /different workspace or conversation/,
    ],
    [
      "another conversation",
      { conversation_id: "c9" },
      /different workspace or conversation/,
    ],
    [
      "another snapshot",
      {
        office_provenance: {
          ...copy.office_provenance,
          source_snapshot_id: "sv0",
        },
      },
      /different source snapshot/,
    ],
    [
      "another extraction",
      {
        office_provenance: {
          ...copy.office_provenance,
          extraction_sha256: "other",
        },
      },
      /different source snapshot/,
    ],
  ])(
    "an import answer naming %s is refused and nothing opens",
    async (_n, over, msg) => {
      const w = makeWorld();
      const opened: string[] = [];
      const inst = mountCopy(w, docx, opened);
      click(button(inst, /Create editable copy/));
      await w.settle();
      const sent = nth(w.world.importCalls, 0).raw;
      nth(w.world.importCalls, 0).d.resolve({ ...copy, ...over });
      await w.settle();
      expect(opened).toEqual([]);
      expect(alertText(inst)).toMatch(msg);
      // Refused answers stay unresolved: command and answer remain journaled
      // and a retry re-checks the known answer without another POST.
      expect(w.world.store.get(KEY)).toBe(sent);
      expect(w.world.store.get(`${KEY}:result`)).toBeDefined();
      click(button(inst, /Open the created copy/));
      await w.settle();
      expect(w.world.importCalls).toHaveLength(1);
      expect(opened).toEqual([]);
      expect(alertText(inst)).toMatch(msg);
    },
  );

  it("a restored unreadable copy request is never sent; only discard is offered", async () => {
    const w = makeWorld();
    w.world.store.set(
      KEY,
      JSON.stringify({
        schema_version: "workagent/v1",
        request_id: "r",
        command_id: "c",
      }),
    );
    const inst = mountCopy(w, docx);
    await w.settle();
    expect(Boolean(button(inst, /Create editable copy/).props.disabled)).toBe(
      true,
    );
    click(button(inst, /Discard that stored request/));
    await w.settle();
    expect(w.world.importCalls).toHaveLength(0);
    expect(Boolean(button(inst, /Create editable copy/).props.disabled)).toBe(
      false,
    );
  });
});

describe("editable copy acknowledged-result journal (review finding 1)", () => {
  const docx = {
    ...editorFile,
    workspace_file_id: "src1",
    filename: "brief.docx",
    mime_type: FORMAT_DOCX,
    editable: false,
    storage: "source_snapshot",
    current: {
      workspace_file_id: "src1",
      version_id: "sv1",
      sha256: "src-hash",
    },
  };
  const KEY = "workagent:office-draft:ws1:c1:src1";
  const copy = {
    ...editorFile,
    workspace_id: "ws1",
    workspace_file_id: "copy1",
    filename: "office.json",
    mime_type: "application/json",
    editable: true,
    storage: "artifact_revision",
    current: {
      workspace_file_id: "copy1",
      version_id: "cv1",
      sha256: "copy-hash",
    },
    office_provenance: {
      source_snapshot_id: "sv1",
      original_sha256: "orig",
      extraction_sha256: "src-hash",
      parser_version: "p1",
      transformation_version: "office-v1",
    },
  };
  const body = {
    schema_version: "workagent/v1",
    request_id: "req-old",
    command_id: "cmd-old",
    expected_work_version: 3,
    source: docx.current,
  };

  function mountWith(
    w: ReturnType<typeof makeWorld>,
    openFile: (t: { workspace_file_id: string }) => Promise<void>,
  ) {
    return w.mount(w.EditableCopyAction, {
      ws: "ws1",
      file: docx,
      workVersion: 3,
      openFile,
    });
  }

  it("a failed open keeps command AND result; retry reopens the known copy without another POST or command", async () => {
    const w = makeWorld();
    const targets: unknown[] = [];
    let failures = 2;
    const inst = mountWith(w, async (t) => {
      targets.push(t);
      if (failures-- > 0)
        throw new ApiError("list unavailable", { status: 503 });
    });
    click(button(inst, /Create editable copy/));
    await w.settle();
    const sent = nth(w.world.importCalls, 0).raw;
    nth(w.world.importCalls, 0).d.resolve(copy);
    await w.settle();
    expect(alertText(inst)).toMatch(
      /retry opens that same copy without creating another/,
    );
    expect(w.world.store.get(KEY)).toBe(sent);
    expect(
      JSON.parse(w.world.store.get(`${KEY}:result`)!).workspace_file_id,
    ).toBe("copy1");
    expect(textOf(byTestId(inst, "copy-known"))).toMatch(
      /office\.json was created/,
    );
    for (let i = 0; i < 2; i++) {
      click(button(inst, /Open the created copy/));
      await w.settle();
    }
    expect(w.world.importCalls).toHaveLength(1);
    expect(w.world.cmdSeq).toBe(1);
    expect(targets).toHaveLength(3);
    for (const t of targets) expect(t).toEqual(copy);
    expect(w.world.store.get(KEY)).toBeUndefined();
    expect(w.world.store.get(`${KEY}:result`)).toBeUndefined();
  });

  it("after a reload a stored command+result opens without any POST", async () => {
    const w = makeWorld();
    w.world.store.set(KEY, JSON.stringify(body));
    w.world.store.set(`${KEY}:result`, JSON.stringify(copy));
    const opened: string[] = [];
    const inst = mountWith(
      w,
      async (t) => void opened.push(t.workspace_file_id),
    );
    await w.settle();
    click(button(inst, /Open the created copy/));
    await w.settle();
    expect(w.world.importCalls).toHaveLength(0);
    expect(w.world.cmdSeq).toBe(0);
    expect(opened).toEqual(["copy1"]);
    expect(w.world.store.get(KEY)).toBeUndefined();
  });

  it("a stored result without its command is never acted on; discard clears both", async () => {
    const w = makeWorld();
    w.world.store.set(`${KEY}:result`, JSON.stringify(copy));
    const opened: string[] = [];
    const inst = mountWith(
      w,
      async (t) => void opened.push(t.workspace_file_id),
    );
    await w.settle();
    expect(Boolean(button(inst, /Create editable copy/).props.disabled)).toBe(
      true,
    );
    click(button(inst, /Discard that stored request/));
    await w.settle();
    expect(w.world.store.get(`${KEY}:result`)).toBeUndefined();
    expect(opened).toEqual([]);
    expect(w.world.importCalls).toHaveLength(0);
  });

  it("a late answer after remount records nothing; the live mount replays the same command", async () => {
    const w = makeWorld();
    const opened: string[] = [];
    const a = mountWith(w, async (t) => void opened.push(t.workspace_file_id));
    click(button(a, /Create editable copy/));
    await w.settle();
    w.unmount(a);
    const b = mountWith(w, async (t) => void opened.push(t.workspace_file_id));
    await w.settle();
    nth(w.world.importCalls, 0).d.resolve(copy);
    await w.settle();
    expect(w.world.store.get(`${KEY}:result`)).toBeUndefined();
    expect(opened).toEqual([]);
    click(button(b, /Retry the same copy/));
    await w.settle();
    expect(nth(w.world.importCalls, 1).raw).toBe(
      nth(w.world.importCalls, 0).raw,
    );
    nth(w.world.importCalls, 1).d.resolve(copy);
    await w.settle();
    expect(opened).toEqual(["copy1"]);
  });

  it("WorkspaceFiles.openFile propagates list failures and refuses an absent or moved target", async () => {
    const w = makeWorld();
    w.world.listItems = [docx];
    const ws = w.mount(w.WorkspaceFiles, {
      ws: "ws1",
      cid: "c1",
      workVersion: 3,
    });
    await w.settle();
    click(button(ws, /brief\.docx/));
    await w.settle();
    const editor = () =>
      [...walk(ws.tree)].find((n) => n.type === w.FileEditor)!;
    const openFile = editor().props.openFile as (t: unknown) => Promise<void>;

    w.world.listFails = new ApiError("down", { status: 503 });
    await expect(openFile(copy)).rejects.toThrow();
    w.world.listFails = null;
    await expect(openFile(copy)).rejects.toThrow(/not in the file list/);
    w.world.listItems = [
      docx,
      { ...copy, current: { ...copy.current, sha256: "moved" } },
    ];
    await expect(openFile(copy)).rejects.toThrow(/different version/);
    await w.settle();
    expect(
      (editor().props.file as { workspace_file_id: string }).workspace_file_id,
    ).toBe("src1");

    w.world.listItems = [docx, copy];
    await openFile(copy);
    await w.settle();
    expect(
      (editor().props.file as { workspace_file_id: string }).workspace_file_id,
    ).toBe("copy1");
  });
});

/* ------------------------------------------------------------------ */
/* Real-CSS narrow layout (320 / 390) of the actual rendered trees     */
/* ------------------------------------------------------------------ */

const STYLES = ["globals", "agent-first", "foundations", "products", "phone"]
  .map((n) => fs.readFileSync(path.join(ROOT, `styles/${n}.css`), "utf8"))
  .join("\n");

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const esc = (t: string) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const UNITLESS = new Set([
  "flex",
  "flexGrow",
  "flexShrink",
  "opacity",
  "zIndex",
  "lineHeight",
  "fontWeight",
]);

/**
 * Serializes a harness tree to HTML. Function components are mounted for
 * real (effects settled) unless an already-driven instance is supplied.
 */
async function toHtml(
  w: ReturnType<typeof makeWorld>,
  node: unknown,
  use: Map<unknown, Instance>,
): Promise<string> {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number")
    return esc(String(node));
  if (Array.isArray(node))
    return (await Promise.all(node.map((c) => toHtml(w, c, use)))).join("");
  const n = node as Node;
  if (typeof n.type === "function") {
    let inst = use.get(n.type);
    if (!inst) {
      inst = w.mount(n.type as Instance["component"], n.props);
      await w.settle();
    }
    return toHtml(w, inst.tree, use);
  }
  if (typeof n.type !== "string") return toHtml(w, n.props.children, use);
  let attrs = "";
  for (const [k, v] of Object.entries(n.props)) {
    if (
      k === "children" ||
      k === "key" ||
      k.startsWith("on") ||
      v == null ||
      v === false
    )
      continue;
    if (k === "style") {
      const css = Object.entries(v as Record<string, unknown>)
        .map(
          ([p, x]) =>
            `${kebab(p)}:${typeof x === "number" && x !== 0 && !UNITLESS.has(p) ? `${x}px` : x}`,
        )
        .join(";");
      attrs += ` style="${esc(css)}"`;
    } else if (k === "value" && n.type !== "input") continue;
    else
      attrs += ` ${k === "className" ? "class" : k}${v === true ? "" : `="${esc(String(v))}"`}`;
  }
  const inner =
    n.type === "textarea"
      ? esc(String(n.props.value ?? ""))
      : await toHtml(w, n.props.children, use);
  return ["input", "br"].includes(n.type)
    ? `<${n.type}${attrs}>`
    : `<${n.type}${attrs}>${inner}</${n.type}>`;
}

describe("Files and export at 320px / 390px with the real stylesheets", () => {
  const LONG_FILE =
    "Quarterly_operations_review_with_appendix_and_regional_breakdowns_v12.docx";
  const XLSX =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("no Files/editor/export descendant extends past the Files card; the document never scrolls sideways", async () => {
    const w = makeWorld();
    const docxSrc = {
      ...editorFile,
      workspace_id: "ws1",
      workspace_file_id: "src1",
      filename: LONG_FILE,
      mime_type: FORMAT_DOCX,
      editable: false,
      storage: "source_snapshot",
      current: {
        workspace_file_id: "src1",
        version_id: "snapshot_0123456789abcdef0123456789",
        sha256: "e".repeat(64),
      },
    };
    const xlsxSrc = {
      ...docxSrc,
      workspace_file_id: "src2",
      filename: "Regional_sales_workbook_2026_final.xlsx",
      mime_type: XLSX,
    };
    const csv = {
      ...csvFile,
      workspace_id: "ws1",
      filename: "sales_by_region_and_representative.csv",
    };
    w.world.listItems = [docxSrc, xlsxSrc, csv];
    w.world.versions["snapshot_0123456789abcdef0123456789"] =
      "Extracted paragraph text\n" + "x".repeat(120);
    const section = w.mount(w.WorkspaceFiles, {
      ws: "ws1",
      cid: "c1",
      workVersion: 3,
    });
    await w.settle();
    click(button(section, /Quarterly_operations/));
    await w.settle();

    // A chart export with a long result, driven for real, replaces the
    // editor's FileExport in the serialized page.
    const chartExport = await mountExport(w, { file: csv });
    await choosePngChart(w, chartExport);
    click(exportButton(chartExport));
    await w.settle();
    const b = JSON.parse(nth(w.world.exportCalls, 0).raw);
    nth(w.world.exportCalls, 0).d.resolve(
      manifestFor(b, {
        filename: "sales_by_region_and_representative_chart_export_final.png",
        provenance: {
          source_snapshot_id: "snapshot_0123456789abcdef0123456789",
          original_sha256: "a".repeat(64),
          extraction_sha256: "e".repeat(64),
          parser_version: "office-import-v1",
          transformation_version: "office-v1",
        },
      }),
    );
    await w.settle();

    const files = await toHtml(w, section.tree, new Map());
    const chart = await toHtml(w, chartExport.tree, new Map());
    const body = (inner: string) =>
      `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${STYLES}</style></head>` +
      `<body style="margin:0"><div style="padding:0 33px">${inner}</div></body></html>`;
    // The chart export sits inside a real editor card shape (same classes/styles).
    const editorCard =
      /<div class="card stack-sm" aria-label="File [^"]*" style="[^"]*">/.exec(
        files,
      )![0];
    const pages = {
      files: body(files),
      chart: body(
        `<section class="card card-quiet stack-sm" style="${/aria-labelledby="wfiles-title" style="([^"]*)"/.exec(files)![1]}">${editorCard}${chart}</div></section>`,
      ),
    };
    expect(files).toContain(FORMAT_DOCX);
    expect(chart).toContain("export-chart-details");

    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    try {
      for (const width of [320, 390]) {
        for (const [name, html] of Object.entries(pages)) {
          const page = await browser.newPage({
            viewport: { width, height: 800 },
          });
          await page.setContent(html);
          await page.evaluate(() =>
            document
              .querySelectorAll("details")
              .forEach((d) => (d.open = true)),
          );
          const m = await page.evaluate(() => {
            const card = document
              .querySelector("section.card")!
              .getBoundingClientRect();
            const out: string[] = [];
            for (const el of document.querySelectorAll("section.card *")) {
              const r = el.getBoundingClientRect();
              if (
                r.width > 0 &&
                (r.right > card.right + 0.5 || r.left < card.left - 0.5)
              )
                out.push(
                  `${el.tagName.toLowerCase()}.${el.className} right=${r.right.toFixed(1)} "${(el.textContent ?? "").slice(0, 40)}"`,
                );
            }
            return {
              scroll: document.documentElement.scrollWidth,
              cardRight: card.right,
              out,
            };
          });
          expect(m.out, `${name}@${width}`).toEqual([]);
          expect(m.scroll, `${name}@${width} scrollWidth`).toBeLessThanOrEqual(
            width,
          );
          expect(m.cardRight, `${name}@${width}`).toBeLessThanOrEqual(
            width - 33 + 0.5,
          );
          // Control: the same markup without the component styles overflows,
          // proving the grid/flex min-content culprit and test sensitivity.
          if (width === 320 && name === "files") {
            await page.setContent(
              html.replace(/ style="[^"]*"/g, (s) =>
                s.includes("padding:0 33px") || s.includes("margin:0") ? s : "",
              ),
            );
            const bare = await page.evaluate(
              () => document.documentElement.scrollWidth,
            );
            expect(bare, "unstyled control overflows").toBeGreaterThan(320);
          }
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }, 60000);
});
