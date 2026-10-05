import type { conversationApi } from "./real-api";
import { attachment } from "./products";

export type PendingOperation = {
  filename: string;
  payload: Parameters<typeof conversationApi.send>[2];
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** Persist before admission. Storage failure must not create an unretryable write. */
export function operationJournal(storage: Storage, ws: string, cid: string) {
  const key = `workagent:operation:${JSON.stringify([ws, cid])}`;
  return {
    read(): PendingOperation | null {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw) as PendingOperation;
      const p = value?.payload;
      if (
        typeof value.filename !== "string" ||
        !p ||
        typeof p.command_id !== "string" ||
        !p.command_id ||
        typeof p.request_id !== "string" ||
        !p.request_id ||
        !Number.isSafeInteger(p.expected_work_version) ||
        typeof p.text !== "string" ||
        !p.operation ||
        !["run_wasm", "reconcile_csv"].includes(p.operation.kind)
      )
        throw new Error(
          "Stored operation cannot be read safely. Do not submit a replacement until its outcome is resolved.",
        );
      return value;
    },
    keep(value: PendingOperation) {
      storage.setItem(key, JSON.stringify(value));
    },
    clear(expected: PendingOperation) {
      // A response from an unmounted composer must not erase a newer attempt.
      // Read/compare/remove is synchronous within this tab's session storage.
      if (storage.getItem(key) !== JSON.stringify(expected)) return false;
      storage.removeItem(key);
      return true;
    },
  };
}

/** New selection, operator change, or unmount invalidates every older completion. */
export function attachmentReader() {
  let generation = 0;
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    invalidate() {
      generation += 1;
      pending = false;
    },
    async read(file: File, kind: "reconcile_csv" | "run_wasm") {
      const ticket = ++generation;
      pending = true;
      try {
        const content = await attachment(file, kind);
        return ticket === generation ? { content, filename: file.name } : null;
      } catch (error) {
        if (ticket === generation) throw error;
        return null;
      } finally {
        if (ticket === generation) pending = false;
      }
    },
  };
}
