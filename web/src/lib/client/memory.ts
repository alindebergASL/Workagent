/**
 * B3.1b memory routes over the generated workagent/v1 client (same instance,
 * scope fencing and unwrap as real-api). Mutations return a content-free
 * receipt; memory-commands verifies by rereading the exact memory. The server-side
 * proxy injects its private local bearer; none reaches JS.
 */
import { client, unwrap, meta } from "./real-api";
import type {
  BindMemoryScope,
  CorrectMemory,
  MemoryCAS,
  MemoryInspection,
  MemoryPage,
  MemoryReceipt,
  MemoryScopeBinding,
  MemoryUsagePage,
  NarrowMemory,
  ProcedureEvidencePage,
  ProposeMemory,
  ProposeProcedureMemory,
  RememberMemory,
  ReviewMemory,
  RollbackMemory,
} from "@/lib/memory-contract";

const ROOT = "/v1/workspaces/{workspace_id}/memory" as const;

/**
 * The server's page for one status view. With no status the server returns
 * active + contested only; candidates are a separate, explicit view.
 */
export async function listMemory(
  ws: string,
  conversation: string,
  status?: "candidate",
  signal?: AbortSignal,
): Promise<MemoryPage> {
  return unwrap(
    client.GET(ROOT, {
      params: {
        path: { workspace_id: ws },
        header: meta(),
        query: status
          ? { conversation_id: conversation, status }
          : { conversation_id: conversation },
      },
      signal,
    }),
  );
}

export async function inspectMemory(
  ws: string,
  memoryId: string,
  signal?: AbortSignal,
): Promise<MemoryInspection> {
  return unwrap(
    client.GET(`${ROOT}/{memory_id}`, {
      params: {
        path: { workspace_id: ws, memory_id: memoryId },
        header: meta(),
      },
      signal,
    }),
  );
}

export async function memoryUsage(
  ws: string,
  runId: string,
  signal?: AbortSignal,
): Promise<MemoryUsagePage> {
  return unwrap(
    client.GET("/v1/workspaces/{workspace_id}/runs/{run_id}/memory-usage", {
      params: { path: { workspace_id: ws, run_id: runId }, header: meta() },
      signal,
    }),
  );
}

/** Every memory write, as the exact route + body that is sent (and replayed). */
export type MemoryCommand =
  | { op: "remember"; body: RememberMemory }
  | { op: "candidates"; body: ProposeMemory | ProposeProcedureMemory }
  | { op: "review"; memoryId: string; body: ReviewMemory }
  | { op: "correct"; memoryId: string; body: CorrectMemory }
  | { op: "narrow"; memoryId: string; body: NarrowMemory }
  | { op: "expire"; memoryId: string; body: MemoryCAS }
  | { op: "forget"; memoryId: string; body: MemoryCAS }
  | { op: "rollback"; memoryId: string; body: RollbackMemory };

/**
 * Observed events in this conversation a person may cite for a lesson.
 * The server derives every reference and digest; ACL applies before counts.
 */
export async function lessonEvidence(
  ws: string,
  conversation: string,
  signal?: AbortSignal,
): Promise<ProcedureEvidencePage> {
  return unwrap(
    client.GET(`${ROOT}/lesson-evidence`, {
      params: {
        path: { workspace_id: ws },
        header: meta(),
        query: { conversation_id: conversation },
      },
      signal,
    }),
  );
}

export async function sendMemoryCommand(
  ws: string,
  cmd: MemoryCommand,
): Promise<MemoryReceipt> {
  switch (cmd.op) {
    case "remember":
      return unwrap(
        client.POST(`${ROOT}/remember`, {
          params: { path: { workspace_id: ws } },
          body: cmd.body,
        }),
      );
    case "candidates":
      return unwrap(
        client.POST(`${ROOT}/candidates`, {
          params: { path: { workspace_id: ws } },
          body: cmd.body,
        }),
      );
    default: {
      const path = { workspace_id: ws, memory_id: cmd.memoryId };
      switch (cmd.op) {
        case "review":
          return unwrap(
            client.POST(`${ROOT}/{memory_id}/review`, {
              params: { path },
              body: cmd.body,
            }),
          );
        case "correct":
          return unwrap(
            client.POST(`${ROOT}/{memory_id}/correct`, {
              params: { path },
              body: cmd.body,
            }),
          );
        case "narrow":
          return unwrap(
            client.POST(`${ROOT}/{memory_id}/narrow`, {
              params: { path },
              body: cmd.body,
            }),
          );
        case "expire":
          return unwrap(
            client.POST(`${ROOT}/{memory_id}/expire`, {
              params: { path },
              body: cmd.body,
            }),
          );
        case "rollback":
          return unwrap(
            client.POST(`${ROOT}/{memory_id}/rollback`, {
              params: { path },
              body: cmd.body,
            }),
          );
        case "forget":
          return unwrap(
            client.POST(`${ROOT}/{memory_id}/forget`, {
              params: { path },
              body: cmd.body,
            }),
          );
      }
    }
  }
}

/** Explicit human link of this conversation to a project's memory. */
export async function bindMemoryScope(
  ws: string,
  body: BindMemoryScope,
): Promise<MemoryScopeBinding> {
  return unwrap(
    client.POST(`${ROOT}/scope-bindings`, {
      params: { path: { workspace_id: ws } },
      body,
    }),
  );
}

/**
 * Exact readback of this conversation's project link (null when unlinked).
 * Requires backend GET /memory/scope-bindings/{conversation_id}.
 */
export async function readMemoryScopeBinding(
  ws: string,
  conversation: string,
  signal?: AbortSignal,
): Promise<MemoryScopeBinding | null> {
  return unwrap(
    client.GET(`${ROOT}/scope-bindings/{conversation_id}`, {
      params: {
        path: { workspace_id: ws, conversation_id: conversation },
        header: meta(),
      },
      signal,
    }),
  );
}
