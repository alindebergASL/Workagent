/**
 * A14: local drafts, staged documents, pending commands and requests are bound
 * to the authenticated session scope the proxy proves, never to a build-time
 * principal string. Unknown identity fails closed; a changed identity fences
 * the page; legacy records stay untouched and unread.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetScopeForTests,
  probeSession,
  scopeState,
  scopedFetch,
  scopedLocal,
  scopedSession,
  stagedScope,
} from "@/lib/client/session-scope";
import { call, setFetch } from "@/lib/client/batch2-api";
import { carryDraftHome } from "@/lib/client/conversation-reply";
import {
  readHomeChat,
  saveHomeChat,
  type HomeChat,
} from "@/lib/client/home-start";

const A = "a".repeat(64);
const B = "b".repeat(64);

class MemStorage implements Storage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

const session = (principal_id: string, scope_id: string) =>
  vi.fn(async () =>
    Response.json({ principal_id, scope_id }, { status: 200 }),
  ) as unknown as typeof fetch;

let ss: MemStorage;
let ls: MemStorage;
beforeEach(() => {
  __resetScopeForTests();
  ss = new MemStorage();
  ls = new MemStorage();
  vi.stubGlobal("sessionStorage", ss);
  vi.stubGlobal("localStorage", ls);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setFetch((...a) => fetch(...a));
});

const DRAFT = "Line one of A's unsent draft\n\n  second line\ttab\n";

describe("authenticated scope identity", () => {
  it("is unknown until the session proves it; storage fails closed", () => {
    expect(scopeState().status).toBe("checking");
    ss.setItem("workagent:composer-draft:ws1", DRAFT); // legacy record
    expect(scopedSession.getItem("workagent:composer-draft:ws1")).toBeNull();
    expect(() => scopedSession.setItem("workagent:x", "y")).toThrow();
    expect(stagedScope("ws1", "home")).toBeNull();
    expect(ss.getItem("workagent:composer-draft:ws1")).toBe(DRAFT);
  });

  it("binds the proven scope and keys records by it, never by a caller string", async () => {
    await probeSession(session("local-human", A));
    expect(scopeState()).toEqual({
      status: "ready",
      principal_id: "local-human",
      scope_id: A,
    });
    scopedSession.setItem("workagent:composer-draft:ws1", DRAFT);
    const raw = [...ss.m.keys()];
    expect(raw).toHaveLength(1);
    expect(raw[0]).toContain(A);
    expect(scopedSession.getItem("workagent:composer-draft:ws1")).toBe(DRAFT);
    expect(stagedScope("ws1", "home")).toContain(A);
    expect(stagedScope("ws1", "home")).not.toContain("local-human:");
  });

  it("legacy unscoped records are neither adopted, relabelled nor deleted", async () => {
    ss.setItem("workagent:composer-draft:ws1", DRAFT);
    ls.setItem("workagent:pending:ws1:home-chat", '{"workspace":"ws1"}');
    await probeSession(session("local-human", A));
    expect(scopedSession.getItem("workagent:composer-draft:ws1")).toBeNull();
    expect(readHomeChat("ws1")).toBeNull();
    // carrying a draft home writes only the scoped key
    expect(carryDraftHome("ws1", "new text")).toBe(true);
    expect(ss.getItem("workagent:composer-draft:ws1")).toBe(DRAFT);
    expect(ls.getItem("workagent:pending:ws1:home-chat")).toBe(
      '{"workspace":"ws1"}',
    );
  });

  it("an identity change fences the page: A's draft is kept but never rendered under B", async () => {
    await probeSession(session("local-human", A));
    scopedSession.setItem("workagent:composer-draft:ws1", DRAFT);
    const chat = { workspace: "ws1", text: DRAFT } as unknown as HomeChat;
    expect(saveHomeChat("ws1", chat)).toBe(true);
    await probeSession(session("recovery5c-other", B));
    expect(scopeState().status).toBe("changed");
    expect(scopedSession.getItem("workagent:composer-draft:ws1")).toBeNull();
    expect(readHomeChat("ws1")).toBeNull();
    expect(stagedScope("ws1", "home")).toBeNull();
    // the original record is retained exactly under A
    const kept = [...ss.m.entries()].filter(([, v]) => v === DRAFT);
    expect(kept).toHaveLength(1);
    expect(kept[0]![0]).toContain(A);
    // a fenced page never re-binds, even to the original scope
    await probeSession(session("local-human", A));
    expect(scopeState().status).toBe("changed");
  });

  it("same authenticated scope on reload recovers the exact draft", async () => {
    await probeSession(session("local-human", A));
    scopedSession.setItem("workagent:composer-draft:ws1", DRAFT);
    __resetScopeForTests(); // a reload: new realm, same storage
    expect(scopedSession.getItem("workagent:composer-draft:ws1")).toBeNull();
    await probeSession(session("local-human", A));
    expect(scopedSession.getItem("workagent:composer-draft:ws1")).toBe(DRAFT);
  });

  it("revocation fails closed and sanitizes reads", async () => {
    await probeSession(session("local-human", A));
    scopedLocal.setItem("workagent:pending:ws1:home-chat", "{}");
    await probeSession(
      vi.fn(async () =>
        Response.json({ code: "unauthenticated" }, { status: 401 }),
      ) as unknown as typeof fetch,
    );
    expect(scopeState().status).not.toBe("ready");
    expect(scopedLocal.getItem("workagent:pending:ws1:home-chat")).toBeNull();
  });

  it("malformed or failed session never binds", async () => {
    await probeSession(session("local-human", "short"));
    expect(scopeState().status).toBe("unavailable");
    await probeSession(
      vi.fn(async () => {
        throw new TypeError("socket");
      }) as unknown as typeof fetch,
    );
    expect(scopeState().status).toBe("unavailable");
  });

  it("a late older probe response cannot override a newer one", async () => {
    let release!: (r: Response) => void;
    const slow = vi.fn(
      () => new Promise<Response>((r) => (release = r)),
    ) as unknown as typeof fetch;
    const first = probeSession(slow);
    await probeSession(session("local-human", A));
    release(Response.json({ principal_id: "x", scope_id: B }));
    await first;
    expect(scopeState()).toMatchObject({ status: "ready", scope_id: A });
  });
});

describe("request-time scope fence", () => {
  it("unknown scope sends nothing", async () => {
    const f = vi.fn();
    await expect(
      scopedFetch("/api/domain/v1/workspaces", {}, f as never),
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("carries the bound scope and refuses after a change without dispatch", async () => {
    await probeSession(session("local-human", A));
    const f = vi.fn(async () => Response.json({}));
    await scopedFetch("/api/domain/v1/workspaces", {}, f as never);
    const headers = new Headers(
      (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers,
    );
    expect(headers.get("x-workagent-scope")).toBe(A);
    await probeSession(session("other", B));
    await expect(
      scopedFetch(
        "/api/domain/v1/workspaces/ws1/conversations/c1/messages",
        { method: "POST", body: "{}" },
        f as never,
      ),
    ).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a stale-scope refusal fences the page", async () => {
    await probeSession(session("local-human", A));
    const f = vi.fn(async () =>
      Response.json({ code: "unauthenticated" }, { status: 401 }),
    );
    await scopedFetch("/api/domain/v1/workspaces", {}, f as never).catch(
      () => null,
    );
    expect(scopeState().status).not.toBe("ready");
  });

  it("pending batch2 commands are not dispatched once the scope changed", async () => {
    await probeSession(session("local-human", A));
    const f = vi.fn(async () => Response.json({ ok: true }));
    setFetch(f as never);
    await call("/api/domain/v1/workspaces/ws1/x", { method: "POST", body: {} });
    expect(
      new Headers(
        (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers,
      ).get("x-workagent-scope"),
    ).toBe(A);
    await probeSession(session("other", B));
    await expect(
      call("/api/domain/v1/workspaces/ws1/x", { method: "POST", body: {} }),
    ).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
