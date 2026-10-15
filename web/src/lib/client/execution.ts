"use client";
import { API_MODE } from "./api";
import { useResource } from "./hooks";
import { client, unwrap, meta } from "./real-api";
import type { ExecutionStatus } from "@/lib/execution-view";

export const executionApi = {
  get: (ws: string, signal?: AbortSignal) =>
    unwrap(
      client.GET("/v1/workspaces/{workspace_id}/execution", {
        params: { path: { workspace_id: ws }, header: meta() },
        signal,
      }),
    ) as Promise<ExecutionStatus>,
};

/**
 * Whether Workagent can advance work in this workspace, and each recent run's
 * state, as the service last checked. Re-read regularly; it describes
 * liveness, not results.
 */
export function useExecution(ws: string | null | undefined) {
  return useResource<ExecutionStatus>(
    ws && API_MODE !== "mock" ? `execution:${ws}` : null,
    (signal) => executionApi.get(ws!, signal),
    { pollMs: 15000 },
  );
}
