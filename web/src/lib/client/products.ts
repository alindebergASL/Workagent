import type { components } from "../../../../contracts/src/client";
import { all, client, command, meta, unwrap } from "./real-api";
import { ApiError } from "@/lib/contract/errors";
export type S = components["schemas"];
export type ProductBody = S["TableBody"] | S["ToolBody"] | S["FileBody"];
export type Operation = NonNullable<S["PostMessage"]["operation"]>;

export function isProduct(body: S["Revision"]["body"]): body is ProductBody {
  return "kind" in body;
}
/** Never promote a stale, unrelated or proposed observation to current output. */
export function currentObservation(
  artifact: S["Artifact"],
  read: S["ObservationReadback"] | null,
) {
  if (!read || !read.current_scope || read.binding_state !== "current_revision")
    return false;
  const o = read.observation;
  return (
    (o.revision_id
      ? o.revision_id === artifact.current_revision_id
      : Boolean(o.proposal_id)) &&
    o.workspace_id === artifact.workspace_id &&
    o.artifact_id === artifact.id &&
    o.conversation_id === artifact.conversation_id &&
    o.body_hash === artifact.current_revision.body_hash
  );
}
/** Latest proposal/history and saved verification are independent facts. */
export async function resolveObservations(
  artifact: S["Artifact"],
  references: S["ProductResult"][],
  read: (id: string) => Promise<S["ObservationReadback"]>,
) {
  const ids = [
    ...new Set(
      references
        .filter((p) => p.artifact_id === artifact.id)
        .map((p) => p.observation_id)
        .reverse(),
    ),
  ];
  let latest: S["ObservationReadback"] | null = null;
  let current: S["ObservationReadback"] | null = null;
  for (const id of ids) {
    const observation = await read(id);
    latest ??= observation;
    if (currentObservation(artifact, observation)) {
      current = observation;
      break;
    }
  }
  return { latest, current };
}
export function formInputs(values: string, labels: string) {
  const parts = values.trim() ? values.split(",").map((x) => x.trim()) : [];
  const names = labels.trim() ? labels.split(",").map((x) => x.trim()) : [];
  if (parts.length !== names.length)
    throw new Error(
      "Provide up to eight integer values and one label per value, separated by commas.",
    );
  return fieldInputs(parts.map((value, i) => ({ label: names[i]!, value })));
}
/**
 * One input per field, as people edit them. Same bounds as the contract: at
 * most eight, whole numbers within ±1,000,000,000, non-empty labels. Existing
 * field names are kept so a saved form keeps its identity.
 */
export function fieldInputs(
  fields: { name?: string; label: string; value: string }[],
) {
  if (fields.length > 8)
    throw new Error("A tool can take at most eight inputs.");
  const labels = fields.map((f) => f.label.trim());
  const values = fields.map((f) => f.value.trim());
  if (labels.some((x) => !x || x.length > 120))
    throw new Error("Give every input a name (up to 120 characters).");
  if (values.some((x) => !/^-?\d+$/.test(x)))
    throw new Error("Inputs must be whole numbers.");
  const arguments_ = values.map(Number);
  if (
    arguments_.some((x) => !Number.isSafeInteger(x) || Math.abs(x) > 1000000000)
  )
    throw new Error(
      "Inputs must be whole numbers between -1000000000 and 1000000000.",
    );
  const used = new Set<string>();
  const names = fields.map((f, i) => {
    let name = f.name && !used.has(f.name) ? f.name : `input_${i + 1}`;
    for (let n = i + 1; used.has(name); n++) name = `input_${n + 1}`;
    used.add(name);
    return name;
  });
  return {
    arguments: arguments_,
    input_form: labels.map((label, i) => ({
      name: names[i]!,
      label,
      type: "integer" as const,
      minimum: -1000000000 as const,
      maximum: 1000000000 as const,
    })),
  };
}
export async function attachment(
  file: File,
  kind: "reconcile_csv" | "run_wasm",
) {
  const bound = kind === "run_wasm" ? 16000 : 200000;
  if (file.size > bound || file.size === 0)
    throw new Error(`Choose a nonempty UTF-8 file of at most ${bound} bytes.`);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await file.arrayBuffer(),
  );
}
export const productApi = {
  get: (ws: string, aid: string, signal?: AbortSignal) =>
    unwrap(
      client.GET("/v1/workspaces/{workspace_id}/artifacts/{artifact_id}", {
        params: {
          path: { workspace_id: ws, artifact_id: aid },
          header: meta(),
        },
        signal,
      }),
    ),
  proposals: (ws: string, aid: string, signal?: AbortSignal) =>
    all((cursor) =>
      unwrap(
        client.GET(
          "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/proposals",
          {
            params: {
              path: { workspace_id: ws, artifact_id: aid },
              header: meta(),
              query: { limit: 100, cursor },
            },
            signal,
          },
        ),
      ),
    ),
  history: async (ws: string, aid: string, signal?: AbortSignal) =>
    (
      await all((cursor) =>
        unwrap(
          client.GET(
            "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/history",
            {
              params: {
                path: { workspace_id: ws, artifact_id: aid },
                header: meta(),
                query: { limit: 100, cursor },
              },
              signal,
            },
          ),
        ),
      )
    ).sort((a, b) => a.revision_number - b.revision_number),
  observe: (ws: string, oid: string, signal?: AbortSignal) =>
    unwrap(
      client.GET(
        "/v1/workspaces/{workspace_id}/observations/{observation_id}",
        {
          params: {
            path: { workspace_id: ws, observation_id: oid },
            header: meta(),
          },
          signal,
        },
      ),
    ),
  save: (
    ws: string,
    aid: string,
    id: string,
    base: string,
    body: ProductBody,
  ) =>
    unwrap(
      client.POST(
        "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/save",
        {
          params: { path: { workspace_id: ws, artifact_id: aid } },
          body: { ...command(id), expected_current_revision_id: base, body },
        },
      ),
    ),
  accept: (ws: string, pid: string, id: string, base: string) =>
    unwrap(
      client.POST(
        "/v1/workspaces/{workspace_id}/proposals/{proposal_id}/accept",
        {
          params: { path: { workspace_id: ws, proposal_id: pid } },
          body: { ...command(id), expected_current_revision_id: base },
        },
      ),
    ),
  dismiss: (
    ws: string,
    pid: string,
    id: string,
    base: string,
    resolution: "keep_current" | "dismiss",
  ) =>
    unwrap(
      client.POST(
        "/v1/workspaces/{workspace_id}/proposals/{proposal_id}/dismiss",
        {
          params: { path: { workspace_id: ws, proposal_id: pid } },
          body: {
            ...command(id),
            expected_current_revision_id: base,
            resolution,
          },
        },
      ),
    ),
  async download(ws: string, artifact: S["Artifact"]) {
    const result = await client.GET(
      "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/download",
      {
        params: {
          path: { workspace_id: ws, artifact_id: artifact.id },
          header: meta(),
          query: { revision_id: artifact.current_revision_id },
        },
        parseAs: "blob",
      },
    );
    if (!result.response.ok || !result.data)
      throw new ApiError({
        code: "transport",
        status: result.response.status,
        message:
          "Download could not be authorized or confirmed. Refresh saved state.",
      });
    const blob = result.data;
    const bytes = await blob.arrayBuffer();
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== result.response.headers.get("x-content-sha256"))
      throw new Error(
        "Downloaded content digest did not match. No file was saved.",
      );
    const body = artifact.current_revision.body;
    if (!isProduct(body)) throw new Error("Not a downloadable product.");
    const filename =
      body.kind === "file"
        ? body.filename
        : body.kind === "table"
          ? "reconciled.csv"
          : `tool-${body.entrypoint}.wat`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
