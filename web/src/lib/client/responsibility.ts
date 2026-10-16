"use client";
import type { components } from "../../../../contracts/src/client";
import { ApiError } from "@/lib/contract/errors";
import { API_MODE } from "./api";
import { useRef } from "react";
import { useResource } from "./hooks";
import { client, command, meta, rawAssignment, unwrap } from "./real-api";

type S = components["schemas"];
export type Responsibility = S["ResponsibilityDetail"];
export type ResponsibilityOperation = S["ControlResponsibility"]["operation"];

/** The service's answer for an assignment that has no responsibility. */
const ABSENT = "unsupported_operation";

type Read = { present: false } | { present: true; detail: Responsibility };

/**
 * What is known about an assignment's responsibility right now. Only a
 * current read of the service's documented "none here" answer is absence; a
 * denied or failed read, or an earlier "none here" that can't be re-read, is
 * never treated as absence, so nothing falls back to other controls while
 * the state is unknown.
 */
export type ResponsibilityState =
  | { kind: "loading" }
  | { kind: "absent" }
  | {
      kind: "ready";
      detail: Responsibility;
      observedAt: string | null;
      /** Showing what was last read while a re-read is failing. */
      stale: boolean;
    }
  | { kind: "denied"; error: ApiError }
  | {
      kind: "unknown";
      error: ApiError | null;
      /**
       * When a re-read fails after the service said there was none: when
       * that was read. It may have been activated since, so it is not
       * treated as absence until a fresh read says so.
       */
      lastAbsentAt?: string | null;
    };

const OPEN_POLL_MS = 4000;
const ABSENT_POLL_MS = 15000;

export function isClosed(detail: Responsibility) {
  const s = detail.lifecycle.state;
  return s === "cancelled" || s === "taken_over";
}

/**
 * Reads an assignment's responsibility. Re-reads are read-only and bounded:
 * every few seconds while it is open, slowly while a conversation's
 * assignment has none yet, never once it is closed or the read is denied.
 * The read stops when the route or workspace changes. Nothing here sends a
 * command.
 */
export function useResponsibility(
  ws: string | null,
  assignmentId: string,
  /**
   * Only assignments from a conversation can gain one; null until the
   * assignment is read, and nothing is read before then.
   */
  fromConversation: boolean | null,
) {
  const res = useResource<Read>(
    ws && API_MODE === "real" && fromConversation !== null
      ? `responsibility:${ws}:${assignmentId}`
      : null,
    async (signal) => {
      try {
        const detail = await unwrap(
          client.GET(
            "/v1/workspaces/{workspace_id}/assignments/{assignment_id}/responsibility",
            {
              params: {
                path: { workspace_id: ws!, assignment_id: assignmentId },
                header: meta(),
              },
              signal,
            },
          ),
        );
        return { present: true, detail };
      } catch (e) {
        if (e instanceof ApiError && e.code === ABSENT)
          return { present: false };
        throw e;
      }
    },
    {
      pollMs: (r) => (r && !r.present ? ABSENT_POLL_MS : OPEN_POLL_MS),
      shouldPoll: (r) => {
        if (!r) return false;
        // Slowly while a conversation's assignment has none yet, so an
        // activation shows up without a reload; never for other assignments.
        if (!r.present) return fromConversation === true;
        return !isClosed(r.detail);
      },
    },
  );

  let state: ResponsibilityState;
  if (API_MODE !== "real") state = { kind: "absent" };
  else if (res.data?.present)
    state = {
      kind: "ready",
      detail: res.data.detail,
      observedAt: res.observedAt,
      stale: res.reconnecting,
    };
  else if (res.data && res.reconnecting)
    state = { kind: "unknown", error: null, lastAbsentAt: res.observedAt };
  else if (res.data) state = { kind: "absent" };
  else if (res.error)
    state =
      res.error.code === "not_found_or_not_authorized" ||
      res.error.code === "unauthenticated"
        ? { kind: "denied", error: res.error }
        : { kind: "unknown", error: res.error };
  else state = { kind: "loading" };
  return { state, refresh: res.refresh };
}

export interface ControlIntent {
  command_id: string;
  operation: ResponsibilityOperation;
  expected_work_version: number;
}

/** One steering command, compare-and-swap on the version on screen. */
export function controlResponsibility(
  ws: string,
  assignmentId: string,
  c: ControlIntent,
) {
  return unwrap(
    client.POST(
      "/v1/workspaces/{workspace_id}/assignments/{assignment_id}/responsibility/control",
      {
        params: { path: { workspace_id: ws, assignment_id: assignmentId } },
        body: {
          ...command(c.command_id),
          expected_work_version: c.expected_work_version,
          operation: c.operation,
        },
      },
    ),
  );
}

/**
 * Where one piece of handed-over work stands, read from the service for a
 * list (Home, a Space, a conversation's hand-overs):
 * - ready: its canonical responsibility, current assignment included;
 * - absent: the service says it has none; the assignment record is shown;
 * - denied: this person can't read it;
 * - unknown: it couldn't be read, or an earlier "none" can't be re-read.
 * `stale` marks a ready entry kept from an earlier read while re-reading fails.
 */
export type HoldEntry =
  | { kind: "ready"; detail: Responsibility; stale: boolean }
  | {
      kind: "absent";
      assignment: S["Assignment"];
    }
  | { kind: "denied" }
  | { kind: "unknown"; lastAbsent: boolean };

/** At most this many items are read per list; the rest show their summary. */
export const HOLD_READ_LIMIT = 20;

async function readHold(
  ws: string,
  id: string,
  signal: AbortSignal,
): Promise<HoldEntry> {
  try {
    const detail = await unwrap(
      client.GET(
        "/v1/workspaces/{workspace_id}/assignments/{assignment_id}/responsibility",
        {
          params: {
            path: { workspace_id: ws, assignment_id: id },
            header: meta(),
          },
          signal,
        },
      ),
    );
    return { kind: "ready", detail, stale: false };
  } catch (e) {
    if (signal.aborted) throw e;
    if (!(e instanceof ApiError)) return { kind: "unknown", lastAbsent: false };
    if (
      e.code === "not_found_or_not_authorized" ||
      e.code === "unauthenticated"
    )
      return { kind: "denied" };
    if (e.code !== ABSENT) return { kind: "unknown", lastAbsent: false };
  }
  try {
    return { kind: "absent", assignment: await rawAssignment(ws, id, signal) };
  } catch (e) {
    if (signal.aborted) throw e;
    return e instanceof ApiError &&
      (e.code === "not_found_or_not_authorized" || e.code === "unauthenticated")
      ? { kind: "denied" }
      : { kind: "unknown", lastAbsent: false };
  }
}

/** One piece of handed-over work, in the workspace that holds it. */
export interface HoldRef {
  ws: string;
  id: string;
}

/**
 * One bounded, read-only, workspace-scoped read of where several pieces of
 * handed-over work stand, shared by every list that shows them. A failed
 * re-read keeps what was read as stale (a responsibility) or unknown (an
 * earlier "none"), never as current. It re-reads slowly while any is open
 * and stops when the list or workspace changes.
 */
export function useHolds(ws: string | null, ids: string[]) {
  return useHoldsIn(ws ? ids.map((id) => ({ ws, id })) : []);
}

/**
 * The same read for work held in several workspaces (Home): each item is
 * read in its own workspace, never another's.
 */
export function useHoldsIn(refs: HoldRef[]) {
  const seen = new Map(refs.map((r) => [`${r.ws}/${r.id}`, r]));
  const list = [...seen.keys()]
    .sort()
    .slice(0, HOLD_READ_LIMIT)
    .map((k) => seen.get(k)!);
  const previous = useRef<Record<string, HoldEntry>>({});
  const key =
    API_MODE === "real" && list.length
      ? `holds:${list.map((r) => `${r.ws}/${r.id}`).join(",")}`
      : null;
  // What was read belongs to one workspace and list only.
  const lastKey = useRef(key);
  if (lastKey.current !== key) {
    lastKey.current = key;
    previous.current = {};
  }
  const res = useResource<Record<string, HoldEntry>>(
    key,
    async (signal) => {
      const entries = await Promise.all(
        list.map(async ({ ws, id }) => {
          const next = await readHold(ws, id, signal);
          const before = previous.current[id];
          if (next.kind !== "unknown" || !before) return [id, next] as const;
          if (before.kind === "ready")
            return [id, { ...before, stale: true }] as const;
          if (
            before.kind === "absent" ||
            (before.kind === "unknown" && before.lastAbsent)
          )
            return [
              id,
              { kind: "unknown", lastAbsent: true } as HoldEntry,
            ] as const;
          return [id, next] as const;
        }),
      );
      const out = Object.fromEntries(entries);
      previous.current = out;
      return out;
    },
    {
      pollMs: 15000,
      shouldPoll: (d) =>
        Boolean(d) &&
        Object.values(d!).some(
          (e) =>
            e.kind === "unknown" ||
            (e.kind === "absent" && Boolean(e.assignment.conversation_id)) ||
            (e.kind === "ready" && !isClosed(e.detail)),
        ),
    },
  );
  return { holds: res.data ?? {}, loading: res.loading, refresh: res.refresh };
}

/** A hold's current goal, where it could be read. */
export function holdGoal(e: HoldEntry | undefined): string | undefined {
  if (e?.kind === "ready") return e.detail.assignment.goal;
  if (e?.kind === "absent") return e.assignment.goal;
  return undefined;
}
