import { beforeEach, expect, it, vi } from "vitest";

// Pure hook contract harness: resource scheduling/AbortController behavior is
// separately exercised by client cancellation tests and existing useResource.
const h = vi.hoisted(() => ({
  scope: "scope-a" as string | null,
  position: undefined as
    { identity: string | null; after?: string } | undefined,
  resource: {
    data: { items: [{ id: "old" }], next_after: "old", has_more: true },
    current: true,
    loading: false,
    error: null,
    refresh: vi.fn(),
  },
  useResource: vi.fn(),
}));
vi.mock("react", () => ({
  useSyncExternalStore: () => h.scope,
  useState: (initial: typeof h.position) => {
    if (h.position === undefined) h.position = initial;
    return [
      h.position,
      (value: typeof h.position) => {
        h.position = value;
      },
    ];
  },
}));
vi.mock("../src/lib/client/hooks", () => ({ useResource: h.useResource }));
vi.mock("../src/lib/client/session-scope", () => ({
  boundScope: () => h.scope,
  subscribeScope: vi.fn(),
}));
import { useDiscoveryPage } from "../src/lib/client/discovery-page";

beforeEach(() => {
  h.position = undefined;
  h.scope = "scope-a";
  h.resource = {
    data: { items: [{ id: "old" }], next_after: "old", has_more: true },
    current: true,
    loading: false,
    error: null,
    refresh: vi.fn(),
  };
  h.useResource.mockReset().mockImplementation(() => h.resource);
});
const read = vi.fn(async () => ({
  items: [{ id: "new" }],
  next_after: null,
  has_more: false,
}));

it("advances one authorized cursor without accumulating previous pages", async () => {
  const first = useDiscoveryPage("cv-a", read);
  first.next();
  useDiscoveryPage("cv-a", read);
  expect(h.useResource.mock.lastCall?.[0]).toBe("scope-a:cv-a:old");
  const signal = new AbortController().signal;
  await h.useResource.mock.lastCall?.[1](signal);
  expect(read).toHaveBeenLastCalledWith(signal, "old");
  h.resource.data = { items: [{ id: "new" }], next_after: "", has_more: false };
  expect(useDiscoveryPage("cv-a", read).page?.items).toEqual([{ id: "new" }]);
});

it("route, target and scope changes reset the cursor, including return navigation", () => {
  useDiscoveryPage("assignment-a", read).next();
  useDiscoveryPage("assignment-b", read);
  expect(h.useResource.mock.lastCall?.[0]).toBe("scope-a:assignment-b:first");
  useDiscoveryPage("assignment-a", read);
  expect(h.useResource.mock.lastCall?.[0]).toBe("scope-a:assignment-a:first");
  useDiscoveryPage("assignment-a", read).next();
  h.scope = "scope-b";
  useDiscoveryPage("assignment-a", read);
  expect(h.useResource.mock.lastCall?.[0]).toBe("scope-b:assignment-a:first");
});

it("a revoked, refreshing or failed read withdraws stale items AND cursors", () => {
  h.resource.current = false;
  h.resource.loading = true;
  let state = useDiscoveryPage("cv-a", read);
  expect(state.page).toBeNull();
  state.next();
  expect(h.position?.after).toBeUndefined();
  h.resource.loading = false;
  state = useDiscoveryPage("cv-a", read);
  expect(state.unavailable).toBe(true);
  expect(state.page).toBeNull();
  h.scope = null;
  h.resource.current = true;
  state = useDiscoveryPage("cv-a", read);
  expect(state.page).toBeNull();
  expect(h.useResource.mock.lastCall?.[0]).toBeNull();
  expect(state.unavailable).toBe(true);
});

it("restart withdraws a denied/deleted anchor and refresh works on the first page", () => {
  useDiscoveryPage("cv-a", read).next();
  const second = useDiscoveryPage("cv-a", read);
  expect(second.hasPrevious).toBe(true);
  second.first();
  const first = useDiscoveryPage("cv-a", read);
  expect(first.hasPrevious).toBe(false);
  first.first();
  expect(h.resource.refresh).toHaveBeenCalledOnce();
});
