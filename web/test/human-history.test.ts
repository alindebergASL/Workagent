import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { transport } = vi.hoisted(() => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  return { transport };
});
vi.mock("../../contracts/src/client", async (original) => {
  const actual = await original<typeof import("../../contracts/src/client")>();
  return {
    ...actual,
    workagentClient: (_base: string, bearer: string, rid: () => string) =>
      actual.workagentClient("http://history.test/api/domain", bearer, rid),
  };
});
import {
  checkpointPage,
  responsibilityOutputPage,
  type CheckpointPage,
} from "../src/lib/client/human-history";
import {
  __resetScopeForTests,
  bindMockIdentity,
  fenceScope,
} from "../src/lib/client/session-scope";
import {
  CheckpointHistoryItems,
  HistoryNavigation,
} from "../src/components/HumanHistory";
import { continueTarget, continueView } from "../src/lib/batch2-view";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const cp = (i: number): CheckpointPage["items"][number] => ({
  checkpoint_id: `cp-${i}`,
  checkpoint_hash: "0".repeat(64),
  workspace_id: "ws",
  conversation_id: "cv",
  run_id: "run",
  assignment_id: null,
  phase: "final",
  checkpoint_kind: "settlement",
  created_at: "2026-01-01T00:00:00Z",
  continuation_supported: true,
  data: {
    schema_version: "run-checkpoint/v1",
    principal_id: "human",
    access_generation: 1,
    run_fence: 0,
    conversation_work_version: 1,
    assignment_work_version: null,
    assignment_fence: null,
    configuration_sha256: "0".repeat(64),
    runtime_sha256: "0".repeat(64),
    scope_fingerprint: "0".repeat(64),
    context_sha256: null,
    intent_message_id: "intent",
    intent_sha256: "0".repeat(64),
    latest_human_intent_id: "intent",
    last_observed_phase: "final",
    steps: [],
    pending_proposal_ids: [],
    waiting: "none",
    next_safe_action: "continue_slice",
  },
});

beforeEach(() => {
  transport.mockReset();
  __resetScopeForTests();
  bindMockIdentity();
});

describe("generated typed human discovery clients", () => {
  it.each(["outputs", "checkpoints"])(
    "walks beyond 100 %s without auto-draining or hidden caps",
    async (kind) => {
      const source = Array.from({ length: 137 }, (_, i) =>
        kind === "outputs"
          ? {
              artifact_id: `art-${i}`,
              revision_id: `revision-${i}`,
              title: `Saved ${i}`,
              conversation_id: "cv",
              assignment_id: null,
            }
          : cp(136 - i),
      );
      const key = kind === "outputs" ? "artifact_id" : "checkpoint_id";
      const id = (item: object) =>
        (item as Record<string, unknown>)[key] as string;
      transport.mockImplementation((request: Request) => {
        const url = new URL(request.url);
        expect(request.method).toBe("GET");
        expect(request.headers.get("x-workagent-scope")).toBe("0".repeat(64));
        expect(url.pathname).toContain(
          kind === "outputs"
            ? "/assignments/assignment/responsibility/outputs"
            : "/conversations/cv/checkpoints",
        );
        const start = url.searchParams.get("after");
        const offset = start ? source.findIndex((r) => id(r) === start) + 1 : 0;
        const limit = Number(url.searchParams.get("limit"));
        const items = source.slice(offset, offset + limit);
        const more = offset + limit < source.length;
        return Promise.resolve(
          response({
            items,
            has_more: more,
            next_after: more ? id(items.at(-1)!) : null,
          }),
        );
      });
      const ids: string[] = [];
      let after: string | undefined;
      do {
        const page =
          kind === "outputs"
            ? await responsibilityOutputPage(
                "ws",
                "assignment",
                undefined,
                after,
                19,
              )
            : await checkpointPage("ws", "cv", undefined, after, 19);
        ids.push(...page.items.map(id));
        after = page.next_after ?? undefined;
        expect(page.has_more).toBe(Boolean(after));
      } while (after);
      expect(ids).toEqual(source.map(id));
      expect(new Set(ids).size).toBe(137);
      expect(transport).toHaveBeenCalledTimes(8);
    },
  );

  it.each([checkpointPage, responsibilityOutputPage])(
    "refuses denied anchors without a stale page",
    async (read) => {
      transport.mockResolvedValue(
        response(
          { code: "not_found_or_not_authorized", message: "Not available" },
          404,
        ),
      );
      await expect(
        read("ws", "target", undefined, "denied"),
      ).rejects.toMatchObject({ code: "not_found_or_not_authorized" });
    },
  );

  it.each([checkpointPage, responsibilityOutputPage])(
    "cancels before dispatch and after a late answer",
    async (read) => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        read("ws", "target", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(transport).not.toHaveBeenCalled();
      const pending = new AbortController();
      let finish!: (r: Response) => void;
      transport.mockImplementation((request: Request) => {
        expect(request.signal.aborted).toBe(false);
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      });
      const result = read("ws", "target", pending.signal);
      await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
      pending.abort();
      finish(response({ items: [], has_more: false, next_after: null }));
      await expect(result).rejects.toMatchObject({ name: "AbortError" });
    },
  );

  it.each([checkpointPage, responsibilityOutputPage])(
    "withdraws a late page after identity revocation",
    async (read) => {
      let finish!: (r: Response) => void;
      transport.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      const result = read("ws", "target");
      await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
      fenceScope();
      finish(response({ items: [cp(1)], has_more: false, next_after: null }));
      await expect(result).rejects.toMatchObject({ code: "transport" });
    },
  );
});

describe("actual component pure rendering", () => {
  it("reaches later pages through explicit controls, and has no invented total", () => {
    const next = vi.fn();
    const props = {
      loading: false,
      unavailable: false,
      hasMore: true,
      hasPrevious: true,
      next,
      first: vi.fn(),
      refresh: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(HistoryNavigation, props));
    expect(html).toContain("Next page");
    expect(html).toContain("From the start");
    expect(html).toContain("More authorized results are available.");
    expect(html).not.toContain("total");
    const element = HistoryNavigation(props);
    const actions = element.props.children[1];
    actions.props.children[2].props.onClick();
    expect(next).toHaveBeenCalledOnce();
    const end = renderToStaticMarkup(
      createElement(HistoryNavigation, { ...props, hasMore: false }),
    );
    expect(end).not.toContain("Next page");
    expect(end).toContain("End of the current authorized listing.");
  });

  it("a failed page is unknown, not an empty/exhausted listing", () => {
    const html = renderToStaticMarkup(
      createElement(HistoryNavigation, {
        loading: false,
        unavailable: true,
        hasMore: false,
        hasPrevious: false,
        next: vi.fn(),
        first: vi.fn(),
        refresh: vi.fn(),
      }),
    );
    expect(html).toContain("could not be confirmed");
    expect(html).toContain("From the start");
    expect(html).not.toContain("End of");
  });

  it("renders >100 history items without offering any replay or Continue command", () => {
    const items = Array.from({ length: 137 }, (_, i) => cp(i));
    const html = renderToStaticMarkup(
      createElement(CheckpointHistoryItems, { items }),
    );
    expect((html.match(/<li>/g) ?? []).length).toBe(137);
    expect(html).not.toContain("<button");
    expect(html).toContain("History only");
    expect(
      continueView(
        continueTarget([{ ...cp(3), continuation_supported: false }], "run"),
      ),
    ).toMatchObject({ kind: "blocked" });
    expect(continueView(continueTarget([cp(136)], "run"))).toEqual({
      kind: "continue",
    });
    expect(continueTarget([cp(136)], "newer-run")).toBeNull();
  });
});
