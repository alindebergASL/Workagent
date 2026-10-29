/**
 * B3.2a research reads over the generated workagent/v1 client (same instance,
 * scope fencing and unwrap as real-api). Read-only: capture happens through
 * the existing conversational model operations; there is no search setup,
 * processor credential or arbitrary execution route here.
 */
import { client, unwrap, meta } from "./real-api";
import type {
  ArtifactClaims,
  ResearchSnapshotPage,
  SourceSnapshot,
} from "@/lib/research-contract";

export const SNAPSHOT_PAGE_LIMIT = 25;

export async function listResearchSnapshots(
  ws: string,
  conversation: string,
  after: string | null,
  signal?: AbortSignal,
): Promise<ResearchSnapshotPage> {
  return unwrap(
    client.GET(
      "/v1/workspaces/{workspace_id}/work-areas/{conversation_id}/research/snapshots",
      {
        params: {
          path: { workspace_id: ws, conversation_id: conversation },
          header: meta(),
          query: {
            limit: SNAPSHOT_PAGE_LIMIT,
            ...(after ? { after } : {}),
          },
        },
        signal,
      },
    ),
  );
}

export async function getResearchSnapshot(
  ws: string,
  snapshotId: string,
  signal?: AbortSignal,
): Promise<SourceSnapshot> {
  return unwrap(
    client.GET(
      "/v1/workspaces/{workspace_id}/research/snapshots/{snapshot_id}",
      {
        params: {
          path: { workspace_id: ws, snapshot_id: snapshotId },
          header: meta(),
        },
        signal,
      },
    ),
  );
}

/** Claims bound to one exact revision and body hash, never the moving head. */
export async function getArtifactClaims(
  ws: string,
  artifactId: string,
  revisionId: string,
  bodyHash: string,
  signal?: AbortSignal,
): Promise<ArtifactClaims> {
  return unwrap(
    client.GET(
      "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/revisions/{revision_id}/research/claims",
      {
        params: {
          path: {
            workspace_id: ws,
            artifact_id: artifactId,
            revision_id: revisionId,
          },
          header: meta(),
          query: { body_hash: bodyHash },
        },
        signal,
      },
    ),
  );
}
