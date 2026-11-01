"use client";
import type { components } from "../../../../contracts/src/client";
import { client, meta, unwrap } from "./real-api";

export type CheckpointPage = components["schemas"]["RunCheckpointPage"];
export type OutputPage = components["schemas"]["ResponsibilityOutputPage"];

// Cursors name only a currently authorized item, never a hidden scan position.
export async function checkpointPage(ws: string, cid: string, signal?: AbortSignal,
  after?: string, limit = 25): Promise<CheckpointPage> {
  signal?.throwIfAborted();
  const page = await unwrap(client.GET("/v1/workspaces/{workspace_id}/conversations/{conversation_id}/checkpoints", {
    params: { path: { workspace_id: ws, conversation_id: cid }, header: meta(), query: { after, limit } }, signal,
  }));
  signal?.throwIfAborted();
  return page;
}

export async function responsibilityOutputPage(ws: string, aid: string, signal?: AbortSignal,
  after?: string, limit = 25): Promise<OutputPage> {
  signal?.throwIfAborted();
  const page = await unwrap(client.GET("/v1/workspaces/{workspace_id}/assignments/{assignment_id}/responsibility/outputs", {
    params: { path: { workspace_id: ws, assignment_id: aid }, header: meta(), query: { after, limit } }, signal,
  }));
  signal?.throwIfAborted();
  return page;
}
