import type { components } from "../../../../contracts/src/client";
import { all, client, command, meta, unwrap } from "./real-api";
export type WorkArea = components["schemas"]["WorkAreaMetadata"];
export type AreaInput = Pick<WorkArea, "title" | "goal" | "kind">;
export const areaHref = (ws: string, id: string) =>
  `/spaces/${encodeURIComponent(ws)}/work/${encodeURIComponent(id)}`;
export const workAreas = {
  list(ws: string, signal?: AbortSignal) {
    return all((cursor) =>
      unwrap(
        client.GET("/v1/workspaces/{workspace_id}/work-areas", {
          params: {
            path: { workspace_id: ws },
            header: meta(),
            query: { cursor, limit: 100 },
          },
          signal,
        }),
      ),
    );
  },
  async create(ws: string, input: AreaInput, commandId: string) {
    const saved = await unwrap(
      client.POST("/v1/workspaces/{workspace_id}/work-areas", {
        params: { path: { workspace_id: ws } },
        body: { ...command(commandId), ...input, selected_source_refs: [] },
      }),
    );
    await this.get(ws, saved.id);
    return saved;
  },
  get(ws: string, id: string) {
    return unwrap(
      client.GET("/v1/workspaces/{workspace_id}/work-areas/{conversation_id}", {
        params: {
          path: { workspace_id: ws, conversation_id: id },
          header: meta(),
        },
      }),
    );
  },
  async promote(
    ws: string,
    id: string,
    version: number,
    input: AreaInput,
    commandId: string,
  ) {
    await unwrap(
      client.POST(
        "/v1/workspaces/{workspace_id}/work-areas/{conversation_id}",
        {
          params: { path: { workspace_id: ws, conversation_id: id } },
          body: {
            ...command(commandId),
            ...input,
            expected_work_version: version,
          },
        },
      ),
    );
    return this.get(ws, id);
  },
};
