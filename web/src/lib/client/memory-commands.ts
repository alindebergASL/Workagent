/**
 * Memory command journal, held in RAM only.
 *
 * Memory payloads are erasable, so a pending command (which carries the
 * person's words) is never written to localStorage/sessionStorage. Leaving
 * or reloading the page discards it; the panel warns before that happens.
 *
 * Rules:
 *  - One command at a time. While one is sending or its outcome is unknown,
 *    a fresh write is refused (not queued, not replaced).
 *  - An unknown outcome (lost response, page fenced in flight) keeps the
 *    EXACT envelope and body; the only way forward is `replay()`, which
 *    resends that same object, or `abandon()`, a deliberate human choice.
 *    Nothing is ever replayed automatically.
 *  - A stale compare-and-swap is a definite refusal. It is reported as stale
 *    and never rebased onto the newer revision.
 *  - Success is only reported after a readback shows the receipt's exact
 *    revision. A failed readback after a definite receipt is "unverified",
 *    not unknown: the write is not resent. Its reason says whether the
 *    reread was refused (access lost), failed (network) or disagreed.
 *  - Receipt listeners hear a definite receipt as soon as it arrives, before
 *    the readback, so a forget can be purged from view immediately.
 *  - The journal is bound to one scope key (identity + workspace +
 *    conversation). After `close()` no result is delivered.
 */
import { ApiError } from "@/lib/contract/errors";
import type { MemoryCommand } from "./memory";
import {
  isAccessLoss,
  readbackMatches,
  type MemoryInspection,
  type MemoryReceipt,
} from "@/lib/memory-contract";

export interface MemoryTransport {
  send(cmd: MemoryCommand): Promise<MemoryReceipt>;
  inspect(memoryId: string): Promise<MemoryInspection>;
}

export type CommandOutcome =
  | { kind: "verified"; receipt: MemoryReceipt; inspection: MemoryInspection }
  | {
      kind: "unverified";
      receipt: MemoryReceipt;
      /** denied: reread refused (access lost); failed: network/server. */
      reason: "mismatch" | "denied" | "failed";
    }
  | { kind: "stale"; error: ApiError }
  | { kind: "refused"; error: unknown }
  | { kind: "unknown"; error: unknown }
  | { kind: "blocked" }
  | { kind: "closed" };

export interface PendingMemoryCommand {
  readonly cmd: MemoryCommand;
  state: "sending" | "unknown";
}

const isAmbiguous = (e: unknown) => e instanceof ApiError && e.isAmbiguousWrite;
const isStale = (e: unknown) =>
  e instanceof ApiError &&
  (e.code === "version_conflict" || e.code === "decision_stale");

export class MemoryCommandJournal {
  private pendingCmd: PendingMemoryCommand | null = null;
  private closed = false;
  private listeners = new Set<() => void>();
  private receiptListeners = new Set<
    (receipt: MemoryReceipt, cmd: MemoryCommand) => void
  >();

  constructor(
    readonly scopeKey: string,
    private readonly transport: MemoryTransport,
  ) {}

  get pending(): PendingMemoryCommand | null {
    return this.pendingCmd;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called synchronously with each definite receipt, before readback. */
  onReceipt(
    fn: (receipt: MemoryReceipt, cmd: MemoryCommand) => void,
  ): () => void {
    this.receiptListeners.add(fn);
    return () => this.receiptListeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** A fresh command. Refused while another is sending or unresolved. */
  submit(cmd: MemoryCommand): Promise<CommandOutcome> {
    if (this.closed) return Promise.resolve({ kind: "closed" });
    if (this.pendingCmd) return Promise.resolve({ kind: "blocked" });
    this.pendingCmd = { cmd, state: "sending" };
    return this.run(this.pendingCmd);
  }

  /** Resends the exact stored command (same envelope and body object). */
  replay(): Promise<CommandOutcome> {
    if (this.closed) return Promise.resolve({ kind: "closed" });
    const p = this.pendingCmd;
    if (!p || p.state !== "unknown")
      return Promise.resolve({ kind: "blocked" });
    p.state = "sending";
    return this.run(p);
  }

  /** Deliberate human choice to stop tracking an unknown command. */
  abandon(): boolean {
    if (!this.pendingCmd || this.pendingCmd.state !== "unknown") return false;
    this.pendingCmd = null;
    this.emit();
    return true;
  }

  /** Scope changed or the panel unmounted: nothing more is delivered. */
  close() {
    this.closed = true;
    this.pendingCmd = null;
    this.listeners.clear();
    this.receiptListeners.clear();
  }

  private async run(p: PendingMemoryCommand): Promise<CommandOutcome> {
    this.emit();
    let receipt: MemoryReceipt;
    try {
      receipt = await this.transport.send(p.cmd);
    } catch (e) {
      if (this.closed || this.pendingCmd !== p) return { kind: "closed" };
      if (isAmbiguous(e)) {
        p.state = "unknown";
        this.emit();
        return { kind: "unknown", error: e };
      }
      this.pendingCmd = null;
      this.emit();
      return isStale(e)
        ? { kind: "stale", error: e as ApiError }
        : { kind: "refused", error: e };
    }
    if (this.closed || this.pendingCmd !== p) return { kind: "closed" };
    // The write definitely happened; it is never resent from here on.
    this.pendingCmd = null;
    for (const l of this.receiptListeners) l(receipt, p.cmd);
    this.emit();
    try {
      const inspection = await this.transport.inspect(receipt.memory_id);
      if (this.closed) return { kind: "closed" };
      return readbackMatches(receipt, inspection)
        ? { kind: "verified", receipt, inspection }
        : { kind: "unverified", receipt, reason: "mismatch" };
    } catch (e) {
      if (this.closed) return { kind: "closed" };
      return {
        kind: "unverified",
        receipt,
        reason: isAccessLoss(e) ? "denied" : "failed",
      };
    }
  }
}

/** Identity + workspace + conversation: results never cross this key. */
export const memoryScopeKey = (
  identity: string | null,
  ws: string,
  conversation: string,
): string | null =>
  identity ? `${identity}\u0000${ws}\u0000${conversation}` : null;
