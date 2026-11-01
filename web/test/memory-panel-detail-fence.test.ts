import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";

// Execute the actual component's async closure, not a copied implementation.
// This is pure-handler coverage: no React mount, DOM, or effect scheduling.
// The real view/search handlers already increment listSeq. Holding it fixed
// here isolates the additional view/query fences from that existing defense.
const source = readFileSync(
  new URL("../src/components/MemoryPanel.tsx", import.meta.url),
  "utf8",
);
const file = ts.createSourceFile(
  "MemoryPanel.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let closure: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(file) === "openMemory"
  )
    closure = node.initializer;
  ts.forEachChild(node, visit);
}
visit(file);
if (!closure) throw new Error("MemoryPanel.openMemory was not found");
const executable = ts.transpileModule(`(${closure.getText(file)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  let resolve!: (item: unknown) => void;
  let reject!: (error: unknown) => void;
  const pending = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const setters = {
    setItems: vi.fn(),
    setListLoading: vi.fn(),
    setLoadError: vi.fn(),
    setListStale: vi.fn(),
    setSummaries: vi.fn(),
    setNextCursor: vi.fn(),
    setHasMore: vi.fn(),
    loseAccess: vi.fn(),
  };
  const env = {
    key: "scope",
    ws: "ws",
    cid: "cv",
    view: "current",
    query: "old query",
    liveKey: { current: "scope" },
    listSeq: { current: 0 },
    viewRef: { current: "current" },
    queryRef: { current: "old query" },
    forgottenIds: { current: new Set<string>() },
    readDiscoveredMemory: vi.fn(() => pending),
    renderable: (revision: unknown) => revision,
    maskForgotten: (items: unknown) => items,
    errText: () => "detail failed",
    isAccessLoss: (e: unknown) => e === "denied",
    ...setters,
  };
  const open = runInNewContext(executable, env) as (summary: {
    memory_id: string;
    revision_id: string;
  }) => Promise<void>;
  const task = open({ memory_id: "m", revision_id: "r" });
  expect(env.readDiscoveredMemory).toHaveBeenCalledExactlyOnceWith(
    "ws",
    "cv",
    "m",
    "r",
    undefined,
  );
  expect(setters.setItems).toHaveBeenCalledExactlyOnceWith(null);
  expect(setters.setListLoading).toHaveBeenCalledExactlyOnceWith(true);
  // Only completion writes are asserted below (including finally).
  for (const setter of Object.values(setters)) setter.mockClear();
  return { env, setters, task, resolve, reject };
}

const item = { revision: { content: "old full detail" } };
const axes = ["view", "query", "key", "sequence"] as const;
const outcomes = ["success", "error", "denied"] as const;
for (const axis of axes) {
  for (const outcome of outcomes) {
    it(`ignores stale ${axis} detail ${outcome}, including finally`, async () => {
      const h = harness();
      if (axis === "view") h.env.viewRef.current = "candidate";
      if (axis === "query") h.env.queryRef.current = "new query";
      if (axis === "key") h.env.liveKey.current = "new scope";
      if (axis === "sequence") h.env.listSeq.current++;
      if (outcome === "success") h.resolve(item);
      else h.reject(outcome);
      await h.task;
      for (const setter of Object.values(h.setters))
        expect(setter).not.toHaveBeenCalled();
    });
  }
}

it("applies current detail and clears loading", async () => {
  const h = harness();
  h.resolve(item);
  await h.task;
  expect(h.setters.setItems).toHaveBeenCalledExactlyOnceWith([item]);
  expect(h.setters.setLoadError).toHaveBeenCalledExactlyOnceWith(null);
  expect(h.setters.setListStale).toHaveBeenCalledExactlyOnceWith(false);
  expect(h.setters.setListLoading).toHaveBeenCalledExactlyOnceWith(false);
  expect(h.setters.loseAccess).not.toHaveBeenCalled();
});

it("still clears invalid discovery metadata on a current ordinary error", async () => {
  const h = harness();
  h.reject("error");
  await h.task;
  expect(h.setters.setItems).toHaveBeenCalledExactlyOnceWith([]);
  expect(h.setters.setSummaries).toHaveBeenCalledExactlyOnceWith([]);
  expect(h.setters.setNextCursor).toHaveBeenCalledExactlyOnceWith(null);
  expect(h.setters.setHasMore).toHaveBeenCalledExactlyOnceWith(false);
  expect(h.setters.setListStale).toHaveBeenCalledExactlyOnceWith(true);
  expect(h.setters.setLoadError).toHaveBeenCalledExactlyOnceWith(
    "detail failed",
  );
  expect(h.setters.setListLoading).toHaveBeenCalledExactlyOnceWith(false);
  expect(h.setters.loseAccess).not.toHaveBeenCalled();
});

it("still delegates current denial to the existing purge path", async () => {
  const h = harness();
  h.reject("denied");
  await h.task;
  expect(h.setters.loseAccess).toHaveBeenCalledExactlyOnceWith();
  expect(h.setters.setItems).not.toHaveBeenCalled();
  expect(h.setters.setLoadError).not.toHaveBeenCalled();
});
