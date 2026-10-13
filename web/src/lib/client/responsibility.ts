"use client";
import type { components } from "../../../../contracts/src/client";
import { ApiError } from "@/lib/contract/errors";
import { API_MODE } from "./api";
import { useResource } from "./hooks";
import { client, command, meta, unwrap } from "./real-api";

type S = components["schemas"];
export type Responsibility = S["ResponsibilityDetail"];
export type ResponsibilityOperation = S["ControlResponsibility"]["operation"];

/** The service's answer for an assignment that has no responsibility. */
const ABSENT = "unsupported_operation";

type Read = { present: false } | { present: true; detail: Responsibility };

/**
 * What is known about an assignment's responsibility right now. Only the
 * service's documented "none here" answer is absence; a denied or failed
 * read is never treated as absence, so nothing falls back to other controls
 * while the state is unknown.
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
  | { kind: "unknown"; error: ApiError };

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
