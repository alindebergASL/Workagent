"use client";
import type { components } from "../../../../contracts/src/client";
import { ApiError } from "@/lib/contract/errors";
import { API_MODE } from "./api";
import { useResource } from "./hooks";
import { client, command, meta, unwrap } from "./real-api";

type S = components["schemas"];
export type Responsibility = S["ResponsibilityDetail"];
export type ResponsibilityOperation = S["ControlResponsibility"]["operation"];

/**
 * The canonical responsibility recorded on an assignment, if it has one. Read
 * only; an assignment without one (or the mock service) reads as null, and
 * the page then shows exactly what it showed before.
 */
export function useResponsibility(ws: string | null, assignmentId: string) {
  return useResource<Responsibility | null>(
    ws && API_MODE === "real" ? `responsibility:${ws}:${assignmentId}` : null,
    async (signal) => {
      try {
        return await unwrap(
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
      } catch (e) {
        if (e instanceof ApiError && e.code === "not_found_or_not_authorized")
          return null;
        throw e;
      }
    },
  );
}

/** One steering command, compare-and-swap on the version on screen. */
export function controlResponsibility(
  ws: string,
  assignmentId: string,
  c: {
    command_id: string;
    operation: ResponsibilityOperation;
    expected_work_version: number;
  },
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
