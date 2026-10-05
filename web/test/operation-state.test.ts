import { describe, it, expect, vi } from "vitest";
import {
  operationJournal,
  attachmentReader,
  type PendingOperation,
} from "../src/lib/client/operation-state";

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
function delayedFile(name: string) {
  let resolve!: (value: ArrayBuffer) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ArrayBuffer>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    file: { name, size: 10, arrayBuffer: () => promise } as File,
    resolve: (value: string) => resolve(new TextEncoder().encode(value).buffer),
    reject,
  };
}
const attempt: PendingOperation = {
  filename: "exact.csv",
  payload: {
    command_id: "same-command",
    request_id: "same-request",
    expected_work_version: 7,
    text: "Explicit operation",
    operation: {
      kind: "reconcile_csv",
      input_csv: "id,quantity,unit_price,reported_total\r\nA,1,1.00,1.00\r\n",
      rounding: "ROUND_HALF_UP",
    },
  },
};

describe("operation recovery and attachment generations", () => {
  it("reload/navigation keeps exact payload and identity scoped to workspace/conversation until resolved", () => {
    const disk = storage();
    operationJournal(disk, "w", "c").keep(attempt);
    const reloaded = operationJournal(disk, "w", "c");
    expect(reloaded.read()).toEqual(attempt);
    expect(operationJournal(disk, "other", "c").read()).toBeNull();
    expect(operationJournal(disk, "w", "other").read()).toBeNull();
    expect(JSON.stringify(reloaded.read()?.payload)).toBe(
      JSON.stringify(attempt.payload),
    );
    expect(reloaded.clear(attempt)).toBe(true);
    expect(operationJournal(disk, "w", "c").read()).toBeNull();
  });
  it("late completion cannot clear a newer unresolved attempt or changed payload", () => {
    const disk = storage();
    const old = operationJournal(disk, "w", "c");
    old.keep(attempt);
    const remounted = operationJournal(disk, "w", "c");
    expect(remounted.clear(attempt)).toBe(true);
    const next = structuredClone(attempt);
    next.payload.command_id = "new-command";
    next.payload.request_id = "new-request";
    remounted.keep(next);
    expect(old.clear(attempt)).toBe(false);
    expect(remounted.read()).toEqual(next);
    const changed = structuredClone(next);
    changed.payload.text = "different payload, same identity";
    expect(old.clear(changed)).toBe(false);
    expect(remounted.read()).toEqual(next);
    expect(remounted.clear(next)).toBe(true);
    expect(old.clear(next)).toBe(false);
  });
  it("fails closed on corrupt or unavailable retry storage", () => {
    const disk = storage();
    disk.getItem = () => "{}";
    expect(() => operationJournal(disk, "w", "c").read()).toThrow();
    disk.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    expect(() => operationJournal(disk, "w", "c").keep(attempt)).toThrow(
      "quota",
    );
  });
  it("older A cannot overwrite newer B even when it completes last", async () => {
    const reader = attachmentReader();
    const a = delayedFile("A.csv"),
      b = delayedFile("B.csv");
    const first = reader.read(a.file, "reconcile_csv");
    const second = reader.read(b.file, "reconcile_csv");
    expect(reader.pending).toBe(true);
    b.resolve("B bytes");
    expect(await second).toEqual({ filename: "B.csv", content: "B bytes" });
    expect(reader.pending).toBe(false);
    a.resolve("A bytes");
    expect(await first).toBeNull();
  });
  it("old completion cannot clear the newer pending read", async () => {
    const reader = attachmentReader();
    const a = delayedFile("A.csv"),
      b = delayedFile("B.csv");
    const first = reader.read(a.file, "reconcile_csv");
    const second = reader.read(b.file, "reconcile_csv");
    a.resolve("A bytes");
    expect(await first).toBeNull();
    expect(reader.pending).toBe(true);
    b.resolve("B bytes");
    await second;
    expect(reader.pending).toBe(false);
  });
  it("operator change/unmount invalidates old success and old error", async () => {
    for (const fail of [false, true]) {
      const reader = attachmentReader();
      const a = delayedFile("A.csv");
      const first = reader.read(a.file, "reconcile_csv");
      reader.invalidate();
      if (fail) a.reject(new Error("stale rejection"));
      else a.resolve("A bytes");
      expect(await first).toBeNull();
      expect(reader.pending).toBe(false);
    }
  });
});
