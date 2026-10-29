/**
 * A14 correction (independent review R1–R3): a scope fence that lands after a
 * request was dispatched keeps its outcome unknown and its exact command; a
 * late body, digest or stream frame never publishes or downloads anything;
 * an explicit proxy identity-preflight failure fences the page at once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const { transport } = vi.hoisted(() => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  return { transport };
});

// As products.test: an absolute base so the generated client can build
// requests under Node; everything else is the actual generated client.
vi.mock("../../contracts/src/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../contracts/src/client")>();
  return {
    ...actual,
    workagentClient: (_base: string, bearer: string, requestId: () => string) =>
      actual.workagentClient("http://races.test/api/domain", bearer, requestId),
  };
});
import { ApiError } from "@/lib/contract/errors";
import {
  fenceScope,
  scopeState,
  scopedFetch,
  scopedSession,
} from "@/lib/client/session-scope";
import * as batch2 from "@/lib/client/batch2-api";
import { call, documentApi, setFetch } from "@/lib/client/batch2-api";
import { memoryDocStore } from "@/lib/client/doc-store";
import { newEntry, stageBytes, uploadAll } from "@/lib/client/documents";
import { stagedController } from "@/lib/client/staged-documents";
import { subscribeWork } from "@/lib/client/work-stream";
import { bindTestScope, proxyScope, withBackendSession } from "./scope-helper";
import type { DocumentMetadata } from "@/lib/contract/batch2";

const enc = (s: string) => new TextEncoder().encode(s);
const tick = () => new Promise((r) => setImmediate(r));
async function until(done: () => boolean) {
  for (let i = 0; i < 10_000 && !done(); i++) await tick();
  expect(done()).toBe(true);
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await tick();
};
/** A response whose headers arrive now and whose body arrives later. */
function held(headers: Record<string, string> = {}, status = 200) {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  return {
    res: new Response(body, { status, headers }),
    send(b: string | Uint8Array, close = true) {
      ctl.enqueue(typeof b === "string" ? enc(b) : b);
      if (close) ctl.close();
    },
  };
}
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => (resolve = a));
  return { promise, resolve };
};
const pdf = enc("%PDF-1.7\nprivate-A\n%%EOF");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const dest = { workspace_id: "ws", conversation_id: "cv" };
/**
 * The generated client captures `fetch` when its module loads, so these
 * tests load it fresh over the stubbed transport, in a page bound to a
 * proven test scope (as the products reload test does).
 */
async function freshGenerated() {
  vi.resetModules();
  const s = await import("@/lib/client/session-scope");
  await s.probeSession((async () =>
    Response.json({
      principal_id: "test-human",
      scope_id: "c".repeat(64),
    })) as unknown as typeof fetch);
  const { conversationApi } = await import("@/lib/client/real-api");
  const { productApi } = await import("@/lib/client/products");
  return { s, conversationApi, productApi };
}

afterEach(() => {
  setFetch((...a) => fetch(...a));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", transport);
  transport.mockReset();
});

describe("R1: a fence after dispatch keeps the outcome unknown", () => {
  it("a late committed upload keeps its exact identity under A and replays it", async () => {
    const store = memoryDocStore();
    const scope = "scope:v1:A:ws:conversation:cv";
    const doc = await stageBytes("a.pdf", "", pdf);
    const receipt = {
      document_id: "d1",
      sha256: doc.sha256,
      filename: doc.filename,
      mime_type: doc.mime_type,
      status: "extracted",
    };
    const first = stagedController(store, () => {});
    first.open(scope);
    await until(() => !first.view.restoring);
    const o = first.origin()!;
    await first.persist(o, [newEntry(doc)]);
    const bodies: string[] = [];
    let release!: (r: Response) => void;
    setFetch((async (_u: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return new Promise<Response>((r) => (release = r));
    }) as never);
    const p = uploadAll(dest, first.view.docs, (n) => first.persist(o, n));
    await until(() => bodies.length === 1);
    fenceScope(); // a session recheck lands while the upload is in flight
    first.open(null); // the gate unmounts the page
    release(Response.json(receipt));
    const e = (await p.catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.isAmbiguousWrite).toBe(true);
    // A returns (same scope): the exact command is restored, outcome unknown.
    await bindTestScope();
    const again = stagedController(store, () => {});
    again.open(scope);
    await until(() => !again.view.restoring);
    const [kept] = again.view.docs;
    expect(kept!.state).toBe("unknown");
    const sent = JSON.parse(bodies[0]!);
    expect(kept!.upload).toMatchObject({
      command_id: sent.command_id,
      request_id: sent.request_id,
    });
    expect(kept!.doc.sha256).toBe(sha(pdf));
    setFetch((async (_u: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return Response.json(receipt);
    }) as never);
    const o2 = again.origin()!;
    await uploadAll(dest, again.view.docs, (n) => again.persist(o2, n));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]); // identical bytes, ids and payload
  });

  it("generated-client writes fenced after dispatch are unknown, not unsent", async () => {
    const { s, conversationApi } = await freshGenerated();
    let release!: (r: Response) => void;
    transport.mockImplementation(
      () => new Promise<Response>((r) => (release = r)),
    );
    const p = conversationApi.send("w", "c", {
      command_id: "cmd-1",
      expected_work_version: 1,
      text: "exact",
    } as never);
    await until(() => transport.mock.calls.length === 1);
    s.fenceScope();
    release(Response.json({ ok: true }));
    await expect(p).rejects.toMatchObject({ code: "transport" });
  });
});

describe("R2: late bodies, digests and frames publish nothing", () => {
  it("a delayed JSON body after the fence is not returned", async () => {
    const h = held({ "content-type": "application/json" });
    setFetch((async () => h.res) as never);
    const p = call<{ secret: string }>("/api/domain/v1/workspaces/w/x");
    await settle();
    fenceScope();
    h.send(JSON.stringify({ secret: "A-only" }));
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });

  const meta = {
    document_id: "d1",
    filename: "a.pdf",
    mime_type: "application/pdf",
    sha256: sha(pdf),
  } as DocumentMetadata;

  it("a delayed original body after the fence is not returned", async () => {
    const h = held({ "x-content-sha256": sha(pdf) });
    setFetch((async () => h.res) as never);
    const p = documentApi.original("w", "c", meta);
    await settle();
    fenceScope();
    h.send(pdf);
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });

  it("a delayed original digest after the fence is not returned", async () => {
    setFetch(
      (async () =>
        new Response(pdf, {
          headers: { "x-content-sha256": sha(pdf) },
        })) as never,
    );
    const real = crypto.subtle.digest.bind(crypto.subtle);
    const d = deferred<void>();
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (a, b) => {
      await d.promise;
      return real(a, b);
    });
    const p = documentApi.original("w", "c", meta);
    await settle();
    fenceScope();
    d.resolve();
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });

  it("saving an original after the fence clicks no anchor", async () => {
    const h = held({ "x-content-sha256": sha(pdf) });
    setFetch((async () => h.res) as never);
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor });
    const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const save = (
      batch2 as unknown as {
        saveOriginal: (
          w: string,
          c: string,
          d: DocumentMetadata,
        ) => Promise<void>;
      }
    ).saveOriginal;
    const p = save("w", "c", meta);
    await settle();
    fenceScope();
    h.send(pdf);
    await p.catch(() => null);
    expect(url).not.toHaveBeenCalled();
    expect(anchor.click).not.toHaveBeenCalled();
  });

  const tool = {
    id: "art",
    current_revision_id: "rev",
    current_revision: {
      body: {
        kind: "tool",
        title: "t",
        code: "(module)",
        entrypoint: "run",
        arguments: [],
        input_form: [],
        notes: [],
      },
    },
  } as never;

  it("a generated product download with a late body or digest downloads nothing", async () => {
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor });
    const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const body = enc("(module)");
    const h = held({ "x-content-sha256": sha(body) });
    transport.mockResolvedValueOnce(h.res);
    const one = await freshGenerated();
    const p = one.productApi.download("w", tool);
    await until(() => transport.mock.calls.length === 1);
    await settle();
    one.s.fenceScope();
    h.send(body);
    await expect(p).rejects.toMatchObject({ code: "transport" });
    expect(url).not.toHaveBeenCalled();
    expect(anchor.click).not.toHaveBeenCalled();

    transport.mockResolvedValueOnce(
      new Response(body, { headers: { "x-content-sha256": sha(body) } }),
    );
    const two = await freshGenerated();
    const real = crypto.subtle.digest.bind(crypto.subtle);
    const d = deferred<void>();
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (a, b) => {
      await d.promise;
      return real(a, b);
    });
    const q = two.productApi.download("w", tool);
    await until(() => transport.mock.calls.length === 2);
    await settle();
    two.s.fenceScope();
    d.resolve();
    await expect(q).rejects.toMatchObject({ code: "transport" });
    expect(url).not.toHaveBeenCalled();
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it("an already-open stream applies no frame after the fence", async () => {
    const ev = (i: number) => ({
      event_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      type: "artifact.changed",
      conversation_id: "cv",
      artifact_id: "a",
      run_id: null,
      proposal_id: null,
      assignment_id: null,
      occurred_at: `2026-10-26T00:00:0${i}Z`,
      reason_code: "material_change",
    });
    const frame = (i: number) =>
      `id: c${i}\nevent: work.changed\ndata: ${JSON.stringify(ev(i))}\n\n`;
    const h = held({ "content-type": "text/event-stream" });
    const changes: number[] = [];
    let resets = 0;
    const ac = new AbortController();
    void subscribeWork({
      base: "/api/domain",
      ws: "ws",
      cid: "cv",
      cursor: "c0",
      signal: ac.signal,
      fetch: (async () => h.res) as never,
      sleep: async () => {
        ac.abort();
      },
      onChange: (e) => changes.push(e.length),
      onStatus: () => {},
      onRevoked: () => {},
      onReset: async () => {
        resets++;
        return "c0";
      },
    }).catch(() => null);
    await settle();
    h.send(frame(1), false);
    await until(() => changes.length === 1);
    fenceScope();
    h.send(frame(2), false);
    await settle();
    expect(changes).toHaveLength(1);
    expect(resets).toBe(0);
    ac.abort();
  });
});

describe("R3: proxy identity-preflight failure fences at once", () => {
  const BEARER = "y".repeat(40);
  const scopeHeader = () => proxyScope(BEARER, "http://127.0.0.1:8000");
  const proxyReq = (method: string) =>
    [
      {
        method,
        headers: new Headers({
          host: "127.0.0.1:3000",
          "x-workagent-client": "local-ui",
          "x-workagent-scope": scopeHeader(),
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        }),
        nextUrl: { search: "" },
        body: method === "POST" ? new Blob(["{}"]).stream() : null,
        signal: new AbortController().signal,
      } as never,
      { params: Promise.resolve({ path: ["v1", "workspaces", "w", "x"] }) },
    ] as const;

  it("the proxy marks failed or malformed preflight and forwards nothing", async () => {
    vi.stubEnv("LOCAL_TEST_MODE", "true");
    vi.stubEnv("LOCAL_BEARER_TOKEN", BEARER);
    const route = await import("@/app/api/domain/[...path]/route");
    for (const upstream of [
      async () => {
        throw new TypeError("timeout");
      },
      async () => Response.json({ principal_id: "x", scope_id: "short" }),
    ]) {
      const f = vi.fn(upstream as (url: string) => Promise<Response>);
      vi.stubGlobal("fetch", f);
      for (const m of ["GET", "POST"] as const) {
        const res = await route[m](...proxyReq(m));
        expect(res.headers.get("x-workagent-identity")).toBe("unconfirmed");
        expect(
          f.mock.calls.filter(([u]) => !String(u).endsWith("/v1/session")),
        ).toHaveLength(0);
      }
    }
    // An ordinary upstream 503 is forwarded unmarked.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        withBackendSession(async () =>
          Response.json({ code: "internal_error" }, { status: 503 }),
        ),
      ),
    );
    const res = await route.GET(...proxyReq("GET"));
    expect(res.status).toBe(503);
    expect(res.headers.get("x-workagent-identity")).toBeNull();
    vi.unstubAllEnvs();
  });

  const unconfirmed = () =>
    Response.json(
      { code: "connection_required", message: "Access couldn’t be confirmed." },
      { status: 503, headers: { "x-workagent-identity": "unconfirmed" } },
    );

  it("both transports fence immediately; ordinary 503 does not", async () => {
    const m = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    });
    scopedSession.setItem("workagent:composer-draft:ws", "A draft");
    await scopedFetch("/api/domain/v1/workspaces", {}, (async () =>
      Response.json({}, { status: 503 })) as never);
    expect(scopeState().status).toBe("ready");
    await scopedFetch("/api/domain/v1/workspaces", {}, (async () =>
      unconfirmed()) as never).catch(() => null);
    expect(scopeState().status).toBe("changed");
    expect(scopedSession.getItem("workagent:composer-draft:ws")).toBeNull();
    expect([...m.values()]).toEqual(["A draft"]); // kept, hidden

    transport.mockResolvedValueOnce(unconfirmed());
    const g = await freshGenerated();
    const e = await g.conversationApi
      .send("w", "c", {
        command_id: "cmd-2",
        expected_work_version: 1,
        text: "x",
      } as never)
      .catch((x: unknown) => x);
    expect(transport).toHaveBeenCalledTimes(1); // no automatic retry
    expect(g.s.scopeState().status).toBe("changed");
    expect(e).toBeInstanceOf(g.s.ScopeRefused); // proxy forwarded nothing
  });

  it("a pending upload refused by preflight keeps its exact identity", async () => {
    const store = memoryDocStore();
    const scope = "scope:v1:A:ws:home";
    const doc = await stageBytes("a.pdf", "", pdf);
    const ctl = stagedController(store, () => {});
    ctl.open(scope);
    await until(() => !ctl.view.restoring);
    const o = ctl.origin()!;
    await ctl.persist(o, [newEntry(doc)]);
    const bodies: string[] = [];
    setFetch((async (_u: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return unconfirmed();
    }) as never);
    await uploadAll(dest, ctl.view.docs, (n) => ctl.persist(o, n)).catch(
      () => null,
    );
    expect(scopeState().status).toBe("changed");
    const kept = await store.list(scope);
    expect(kept[0]!.upload?.command_id).toBe(JSON.parse(bodies[0]!).command_id);
    expect(sha(new Uint8Array(kept[0]!.bytes))).toBe(sha(pdf));
    expect(bodies).toHaveLength(1); // no automatic retry
  });
});
