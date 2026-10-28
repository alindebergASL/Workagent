/** UI view adapter over the generated workagent/v1 client, not a second wire contract. */
import {
  workagentClient,
  type components,
} from "../../../../contracts/src/client";
import { ApiError } from "@/lib/contract/errors";
import {
  turnProgress,
  type ExactTarget,
  type MessageAttachment,
} from "@/lib/contract/natural";
import { assignmentSummary, lifecycleOf } from "./assignment-summary";
import { hasManagedGroup, recommendationFrom } from "./recommendation";
import type * as V from "@/lib/contract/types";
import { commandPayloadCache } from "./command-cache";
import type { ExtractionStatus } from "@/lib/contract/batch2";
import { savedBody, viewBlocks } from "@/lib/document-blocks";
import {
  assertScope,
  boundScope,
  captureScope,
  fenceScope,
  fencedOutcome,
  identityUnconfirmed,
  SCOPE_HEADER,
  scopeRefused,
} from "./session-scope";
const stablePayload = commandPayloadCache();
type S = components["schemas"];
const rid = () => crypto.randomUUID();
export const meta = () => ({
  "x-schema-version": "workagent/v1" as const,
  "x-request-id": rid(),
});
export const command = (id: string) => ({
  schema_version: "workagent/v1" as const,
  request_id: rid(),
  command_id: id,
});
// The server-side loopback proxy injects its private local bearer. None reaches JS.
export const client = workagentClient("/api/domain", "", rid);
client.use({
  onRequest({ request }) {
    request.headers.set("X-Workagent-Client", "local-ui");
    // Nothing is sent without this page's bound scope (see session-scope).
    const scope = boundScope();
    if (!scope) throw scopeRefused();
    request.headers.set(SCOPE_HEADER, scope);
    return request;
  },
  onResponse({ request, response }) {
    if (identityUnconfirmed(response)) {
      // The proxy couldn't confirm identity and forwarded nothing.
      fenceScope();
      void response.body?.cancel().catch(() => undefined);
      throw scopeRefused();
    }
    if (boundScope() !== request.headers.get(SCOPE_HEADER)) {
      // Sent, then fenced: outcome unknown, result never shown.
      void response.body?.cancel().catch(() => undefined);
      throw fencedOutcome();
    }
    if (response.status === 401) fenceScope();
    return response;
  },
});

export async function unwrap<T>(
  promise: Promise<{
    data?: T;
    error?: S["ErrorEnvelope"];
    response: Response;
  }>,
): Promise<T> {
  // The body is parsed inside `promise`, after the middleware's header check:
  // a result whose page was fenced meanwhile is never returned.
  const scope = captureScope();
  let result;
  try {
    result = await promise;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof ApiError) throw e; // refused locally by the scope fence
    throw new ApiError({
      code: "transport",
      status: 0,
      message: "Could not reach the local service.",
    });
  }
  assertScope(scope);
  if (result.error || !result.response.ok || result.data === undefined) {
    const e = result.error;
    throw new ApiError({
      code:
        result.response.status >= 500 ? "transport" : (e?.code ?? "transport"),
      status: result.response.status,
      message: e?.message ?? "Could not confirm the request.",
      requestId: e?.request_id,
      nextAction: e?.next_action,
      details: e?.details,
    });
  }
  return result.data;
}
export async function all<T>(
  fetchPage: (
    cursor?: string,
  ) => Promise<{ items: T[]; next_cursor?: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (!page.next_cursor) return items;
    if (seen.has(page.next_cursor))
      throw new ApiError({
        code: "transport",
        status: 0,
        message: "Pagination did not advance; reload.",
      });
    seen.add(page.next_cursor);
    cursor = page.next_cursor;
  }
}
const list = <T>(
  items: T[],
  observed_at = new Date().toISOString(),
): V.ListResult<T> => ({ items, next_cursor: null, observed_at });
/** One assignment record as the service returns it, with no joins. */
export const rawAssignment = (ws: string, id: string, signal?: AbortSignal) =>
  unwrap(
    client.GET("/v1/workspaces/{workspace_id}/assignments/{assignment_id}", {
      params: { path: { workspace_id: ws, assignment_id: id }, header: meta() },
      signal,
    }),
  );
const rawArtifact = (
  ws: string,
  id: string,
  revision_id?: string | null,
  signal?: AbortSignal,
) =>
  unwrap(
    client.GET("/v1/workspaces/{workspace_id}/artifacts/{artifact_id}", {
      params: {
        path: { workspace_id: ws, artifact_id: id },
        header: meta(),
        query: { revision_id: revision_id ?? undefined },
      },
      signal,
    }),
  );
const rawSources = (ws: string, signal?: AbortSignal) =>
  all((cursor) =>
    unwrap(
      client.GET("/v1/workspaces/{workspace_id}/sources", {
        params: {
          path: { workspace_id: ws },
          header: meta(),
          query: { limit: 100, cursor },
        },
        signal,
      }),
    ),
  );
const rawHistory = (ws: string, id: string, signal?: AbortSignal) =>
  all((cursor) =>
    unwrap(
      client.GET(
        "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/history",
        {
          params: {
            path: { workspace_id: ws, artifact_id: id },
            header: meta(),
            query: { limit: 100, cursor },
          },
          signal,
        },
      ),
    ),
  );
const rawProposals = (ws: string, id: string, signal?: AbortSignal) =>
  all((cursor) =>
    unwrap(
      client.GET(
        "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/proposals",
        {
          params: {
            path: { workspace_id: ws, artifact_id: id },
            header: meta(),
            query: { limit: 100, cursor },
          },
          signal,
        },
      ),
    ),
  );
const rawRun = (ws: string, id: string, signal?: AbortSignal) =>
  unwrap(
    client.GET("/v1/workspaces/{workspace_id}/runs/{run_id}", {
      params: { path: { workspace_id: ws, run_id: id }, header: meta() },
      signal,
    }),
  );
const toSource = (
  s: S["Source"] | S["SourceDetail"],
  used: string[] = [],
): V.SourceDetail => ({
  id: s.id,
  title: s.title,
  version: s.external_version,
  observed_at: s.observed_at,
  surface: "Selected source",
  excerpt: "content" in s ? JSON.stringify(s.content, null, 2) : null,
  used_by_artifact_ids: used,
});
function toBlocks(body: S["Revision"]["body"]): V.Block[] {
  if (!("blocks" in body))
    throw new ApiError({
      code: "unsupported_operation",
      status: 422,
      message:
        "Open this product from its conversation, not the document editor.",
    });
  return viewBlocks(body.blocks);
}
const toRevision = (r: S["Revision"], current: string): V.Revision => ({
  id: r.id,
  artifact_id: r.artifact_id,
  parent_revision_id: r.parent_revision_id,
  sequence: r.revision_number,
  author: {
    kind: r.author_kind === "worker" ? "agent" : "human",
    // How the worker ran is per-run provenance, not part of the author's name.
    name: r.author_kind === "worker" ? "Workagent" : "You",
  },
  created_at: r.created_at ?? "",
  status: r.id === current ? "accepted" : "superseded",
  body: toBlocks(r.body),
  body_hash: r.body_hash,
  source_dependencies: r.source_dependencies.map((s) => ({
    source_id: s.source_id,
    version: s.external_version,
  })),
  note: null,
});
function toProposal(
  p: S["Proposal"],
  a: S["Artifact"],
  history: S["Revision"][],
): V.Proposal {
  const stale =
    p.status === "pending" && p.base_revision_id !== a.current_revision_id;
  return {
    id: p.id,
    artifact_id: p.artifact_id,
    base_revision_id: p.base_revision_id,
    base_sequence:
      history.find((r) => r.id === p.base_revision_id)?.revision_number ?? 1,
    status:
      p.status === "pending"
        ? stale
          ? "conflicted"
          : "proposed"
        : p.status === "dismissed"
          ? "declined"
          : "accepted",
    author: { kind: "agent", name: "Workagent" },
    reason: p.reason,
    created_at: p.created_at ?? "",
    updated_at: p.created_at ?? "",
    body: toBlocks(p.body),
    body_hash: p.body_hash,
    conflict: stale
      ? {
          current_revision_id: a.current_revision_id,
          observed_at: a.observed_at ?? "",
        }
      : null,
    resolved_by_revision_id: p.accepted_revision_id ?? null,
  };
}
function kind(title: string): V.ArtifactKind {
  return /checklist/i.test(title)
    ? "checklist"
    : /analysis/i.test(title)
      ? "analysis"
      : "plan";
}
async function artifactView(
  raw: S["Artifact"],
  signal?: AbortSignal,
): Promise<V.Artifact> {
  if (!raw.assignment_id)
    throw new ApiError({
      code: "unsupported_operation",
      status: 422,
      message: "This product belongs to a conversation.",
    });
  const [assignment, history, proposals, sources] = await Promise.all([
    rawAssignment(raw.workspace_id, raw.assignment_id, signal),
    rawHistory(raw.workspace_id, raw.id, signal),
    rawProposals(raw.workspace_id, raw.id, signal),
    rawSources(raw.workspace_id, signal),
  ]);
  const pending = proposals
    .filter((p) => p.status === "pending")
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
  let proposal: V.Proposal | null = pending
    ? toProposal(pending, raw, history)
    : null;
  // Pending run is durable backend state, not invented client progress.
  if (!proposal) {
    const runs = await Promise.all(
      (assignment.run_ids ?? []).map((id) =>
        rawRun(raw.workspace_id, id, signal),
      ),
    );
    const run = runs.find(
      (r) =>
        r.artifact_id === raw.id &&
        (r.state === "queued" || r.state === "running"),
    );
    if (run && run.base_revision_id)
      proposal = {
        id: `run:${run.id}`,
        artifact_id: raw.id,
        base_revision_id: run.base_revision_id,
        base_sequence:
          history.find((r) => r.id === run.base_revision_id)?.revision_number ??
          1,
        status: "generating",
        author: { kind: "agent", name: "Workagent" },
        reason: run.instruction ?? "Revision requested",
        created_at: run.observed_at ?? "",
        updated_at: run.observed_at ?? "",
        body: null,
        body_hash: null,
        conflict: null,
        resolved_by_revision_id: null,
      };
  }
  const selected = raw.requested_revision ?? raw.current_revision;
  return {
    id: raw.id,
    workspace_id: raw.workspace_id,
    assignment_id: raw.assignment_id,
    title: selected.body.title,
    kind: kind(selected.body.title),
    state:
      proposal?.status === "generating"
        ? "generating"
        : proposal
          ? "needs_review"
          : "ready",
    partial: assignment.state === "partial",
    accepted_revision_id: raw.current_revision_id,
    approved_revision_id:
      selected.id === raw.current_revision_id &&
      proposals.some(
        (p) =>
          p.status === "accepted" && p.accepted_revision_id === selected.id,
      )
        ? selected.id
        : null,
    accepted_revision: toRevision(selected, raw.current_revision_id),
    pending_proposal: proposal,
    observed_at: raw.observed_at ?? "",
    source_refs: selected.source_dependencies.map((ref) => ({
      id: ref.source_id,
      title:
        sources.find((s) => s.id === ref.source_id)?.title ?? ref.source_id,
      version: ref.external_version,
      observed_at: ref.observed_at,
      surface: "Selected source",
    })),
  };
}
/**
 * Legacy assignment-owned work only. An older service may still project a
 * responsibility's conversation-owned outputs into the legacy `artifact_ids`;
 * those are canonically the conversation's and are surfaced by the rich
 * responsibility read, so they are left out here rather than failing the
 * whole assignment view through the legacy adapter.
 */
async function assignmentArtifacts(
  ws: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<V.Artifact[]> {
  const raws = await Promise.all(
    ids.map((id) => rawArtifact(ws, id, undefined, signal)),
  );
  return Promise.all(
    raws.filter((r) => r.assignment_id).map((r) => artifactView(r, signal)),
  );
}
async function enrichConflict<T>(
  ws: string,
  id: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (e) {
    if (e instanceof ApiError && e.isVersionConflict) {
      // Fresh authorized read; never fabricate returned body from draft/cache.
      const fresh = await artifactView(await rawArtifact(ws, id));
      throw new ApiError({
        code: e.code,
        status: e.status,
        message: e.message,
        requestId: e.requestId,
        nextAction: e.nextAction,
        details: {
          current_revision_id: fresh.accepted_revision_id!,
          current_revision: fresh.accepted_revision ?? undefined,
          proposal: fresh.pending_proposal ?? undefined,
        },
      });
    }
    throw e;
  }
}

export const realApi = {
  async listWorkspaces(
    signal?: AbortSignal,
  ): Promise<V.ListResult<V.Workspace>> {
    const data = await all((cursor) =>
      unwrap(
        client.GET("/v1/workspaces", {
          params: { header: meta(), query: { limit: 100, cursor } },
          signal,
        }),
      ),
    );
    return list(
      data.map((w) => ({
        id: w.id,
        name: w.name,
        kind: w.kind ?? "personal",
        scope_label: "Private · local fixture mode",
        display_time_zone: "UTC",
      })),
    );
  },
  async listSources(ws: string, signal?: AbortSignal) {
    return list((await rawSources(ws, signal)).map((s) => toSource(s)));
  },
  async listAssignments(ws: string, signal?: AbortSignal) {
    return list(
      await Promise.all(
        (
          await all((cursor) =>
            unwrap(
              client.GET("/v1/workspaces/{workspace_id}/assignments", {
                params: {
                  path: { workspace_id: ws },
                  header: meta(),
                  query: { limit: 100, cursor },
                },
                signal,
              }),
            ),
          )
        ).map(async (a) =>
          assignmentSummary(
            a,
            await assignmentArtifacts(ws, a.artifact_ids ?? [], signal),
          ),
        ),
      ),
    );
  },
  async getAssignment(
    ws: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<V.Assignment> {
    const a = await rawAssignment(ws, id, signal);
    const [sources, artifacts, runs] = await Promise.all([
      rawSources(ws, signal),
      assignmentArtifacts(ws, a.artifact_ids ?? [], signal),
      Promise.all((a.run_ids ?? []).map((id) => rawRun(ws, id, signal))),
    ]);
    const initial = runs.find((r) => r.kind === "initial");
    const latest = runs.at(-1);
    // The recommendation comes from the current saved document: the one carrying
    // the managed worker's current group, else the fixture plan.
    const source =
      artifacts.find((x) => hasManagedGroup(x.accepted_revision?.body ?? [])) ??
      artifacts.find((x) => x.kind === "plan");
    const plan = source?.accepted_revision;
    return {
      ...assignmentSummary(a, artifacts),
      created_at: initial?.observed_at ?? a.observed_at ?? "",

      completion_criteria: a.completion_criteria,
      selected_source_refs: a.selected_source_refs.map((ref) => ({
        id: ref.source_id,
        title:
          sources.find((s) => s.id === ref.source_id)?.title ?? ref.source_id,
        version: ref.external_version,
        observed_at: ref.observed_at,
        surface: "Selected source",
      })),
      recommendation:
        plan && source
          ? { ...recommendationFrom(plan.body), artifact_id: source.id }
          : null,
      artifacts: artifacts.map((x) => ({
        id: x.id,
        title: x.title,
        kind: x.kind,
        state: x.state,
        accepted_revision_id: x.accepted_revision_id,
        approved_revision_id: x.approved_revision_id,
        partial: x.partial,
        updated_at: x.accepted_revision?.created_at ?? x.observed_at,
      })),
      activity: artifacts.map((x) => ({
        id: x.id,
        at: x.accepted_revision?.created_at ?? x.observed_at,
        kind: "artifact" as const,
        message: `Saved ${x.title}`,
      })),
      unresolved: a.unresolved ?? [],
      run: latest
        ? {
            run_id: latest.id,
            state:
              latest.state === "queued"
                ? "queued"
                : latest.state === "running"
                  ? "running"
                  : latest.state === "cancelled"
                    ? "failed"
                    : "done",
            last_update_at: latest.observed_at ?? "",
          }
        : null,
    };
  },
  async getAssignmentSources(ws: string, id: string, signal?: AbortSignal) {
    const a = await rawAssignment(ws, id, signal);
    const sources = await Promise.all(
      a.selected_source_refs.map((ref) =>
        unwrap(
          client.GET("/v1/workspaces/{workspace_id}/sources/{source_id}", {
            params: {
              path: { workspace_id: ws, source_id: ref.source_id },
              header: meta(),
            },
            signal,
          }),
        ),
      ),
    );
    const artifacts = (
      await Promise.all(
        (a.artifact_ids ?? []).map((id) =>
          rawArtifact(ws, id, undefined, signal),
        ),
      )
    ).filter((x) => x.assignment_id);
    return list(
      sources.map((source) => {
        const dependencies = new Map<
          string,
          { version: string; observed_at: string; artifact_ids: string[] }
        >();
        for (const ref of a.selected_source_refs.filter(
          (ref) => ref.source_id === source.id,
        ))
          dependencies.set(ref.external_version, {
            version: ref.external_version,
            observed_at: ref.observed_at,
            artifact_ids: [],
          });
        for (const artifact of artifacts)
          for (const ref of artifact.current_revision.source_dependencies.filter(
            (ref) => ref.source_id === source.id,
          )) {
            const entry = dependencies.get(ref.external_version) ?? {
              version: ref.external_version,
              observed_at: ref.observed_at,
              artifact_ids: [],
            };
            entry.artifact_ids.push(artifact.id);
            dependencies.set(ref.external_version, entry);
          }
        return {
          ...toSource(
            source,
            dependencies.get(source.external_version)?.artifact_ids ?? [],
          ),
          observed_dependencies: [...dependencies.values()],
          version_drift: [...dependencies.keys()].some(
            (version) => version !== source.external_version,
          ),
        };
      }),
    );
  },
  async createAssignment(
    ws: string,
    c: V.CreateAssignmentCommand,
  ): Promise<V.CreateAssignmentResult> {
    const body = await stablePayload<S["CreateAssignment"]>(
      `${ws}:create-assignment`,
      c.command_id,
      c,
      async () => {
        const sources = await rawSources(ws);
        const refs = c.selected_source_refs.map((ref) => {
          const source = sources.find((s) => s.id === ref.id);
          if (!source || source.external_version !== ref.version)
            throw new ApiError({
              code: "source_changed",
              status: 409,
              message: "Selected source version changed; refresh sources.",
            });
          return {
            source_id: source.id,
            external_version: ref.version,
            observed_at: source.observed_at,
          };
        });
        return {
          ...command(c.command_id),
          goal: c.goal,
          completion_criteria: c.completion_criteria,
          selected_source_refs: refs,
        };
      },
    );
    const r = await unwrap(
      client.POST("/v1/workspaces/{workspace_id}/assignments", {
        params: { path: { workspace_id: ws } },
        body,
      }),
    );
    return {
      assignment_id: r.assignment.id,
      work_revision: r.assignment.work_version ?? 1,
      run_id: r.run.id,
    };
  },
  async controlAssignment(
    ws: string,
    id: string,
    c: V.ControlAssignmentCommand,
  ): Promise<V.ControlAssignmentResult> {
    const body = await stablePayload<S["ControlAssignment"]>(
      `${ws}:control-assignment:${id}`,
      c.command_id,
      c,
      async () => ({
        ...command(c.command_id),
        // The version the person was looking at: a newer change is a conflict, never overridden.
        expected_work_version: c.expected_work_revision,
        operation: c.operation,
      }),
    );
    const r = await unwrap(
      client.POST(
        "/v1/workspaces/{workspace_id}/assignments/{assignment_id}/control",
        {
          params: { path: { workspace_id: ws, assignment_id: id } },
          body,
        },
      ),
    );
    return {
      work_revision: r.work_version ?? c.expected_work_revision + 1,
      lifecycle: lifecycleOf(r.state),
    };
  },
  async getArtifact(
    ws: string,
    id: string,
    revisionId?: string | null,
    signal?: AbortSignal,
  ) {
    return artifactView(await rawArtifact(ws, id, revisionId, signal), signal);
  },
  async getArtifactHistory(
    ws: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<V.ArtifactHistory> {
    const [a, h, p] = await Promise.all([
      rawArtifact(ws, id, undefined, signal),
      rawHistory(ws, id, signal),
      rawProposals(ws, id, signal),
    ]);
    return {
      artifact_id: id,
      accepted_revision_id: a.current_revision_id,
      revisions: h
        .sort((a, b) => b.revision_number - a.revision_number)
        .map((r) => toRevision(r, a.current_revision_id)),
      proposals: p.map((p) => toProposal(p, a, h)),
    };
  },
  async saveRevision(
    ws: string,
    id: string,
    c: V.SaveRevisionCommand,
  ): Promise<V.SaveRevisionResult> {
    return enrichConflict(ws, id, async () => {
      const base = await rawArtifact(ws, id, c.expected_current_revision_id);
      const r = await unwrap(
        client.POST(
          "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/save",
          {
            params: { path: { workspace_id: ws, artifact_id: id } },
            body: {
              ...command(c.command_id),
              expected_current_revision_id: c.expected_current_revision_id,
              body: savedBody(
                (base.requested_revision ?? base.current_revision).body.title,
                c.body,
              ),
            },
          },
        ),
      );
      // Deliberate human resolution is a human save, NOT acceptance/rebase of old proposal.
      // Dismissal is a separate idempotent command; never hide a partial failure as saved+resolved.
      if (c.resolves_proposal_id)
        await unwrap(
          client.POST(
            "/v1/workspaces/{workspace_id}/proposals/{proposal_id}/dismiss",
            {
              params: {
                path: { workspace_id: ws, proposal_id: c.resolves_proposal_id },
              },
              body: {
                ...command(`resolve:${c.command_id}`),
                expected_current_revision_id: r.current_revision_id,
                resolution: "keep_current",
              },
            },
          ),
        );
      return {
        revision: toRevision(r.current_revision, r.current_revision_id),
        artifact: await artifactView(await rawArtifact(ws, id)),
      };
    });
  },
  async requestRevision(
    ws: string,
    id: string,
    c: V.RequestRevisionCommand,
  ): Promise<V.RequestRevisionResult> {
    const body = await stablePayload<S["RequestRevision"]>(
      `${ws}:request-revision:${id}`,
      c.command_id,
      c,
      async () => {
        const artifact = await rawArtifact(ws, id);
        if (!artifact.assignment_id)
          throw new ApiError({
            code: "unsupported_operation",
            status: 422,
            message: "Use conversation product steering.",
          });
        const assignment = await rawAssignment(ws, artifact.assignment_id);
        return {
          ...command(c.command_id),
          base_revision_id: c.base_revision_id,
          expected_work_version: assignment.work_version ?? 1,
          instruction: c.instruction,
        };
      },
    );
    const r = await unwrap(
      client.POST(
        "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/request-revision",
        {
          params: { path: { workspace_id: ws, artifact_id: id } },
          body,
        },
      ),
    );
    return { proposal_id: `run:${r.run.id}`, run_id: r.run.id };
  },
  async acceptProposal(
    ws: string,
    id: string,
    pid: string,
    c: V.ProposalDecisionCommand,
  ): Promise<V.ProposalDecisionResult> {
    return enrichConflict(ws, id, async () => {
      const r = await unwrap(
        client.POST(
          "/v1/workspaces/{workspace_id}/proposals/{proposal_id}/accept",
          {
            params: { path: { workspace_id: ws, proposal_id: pid } },
            body: {
              ...command(c.command_id),
              expected_current_revision_id: c.expected_current_revision_id,
              // This path has no review step; the service answers
              // review_required when a proposal needs acknowledging.
              acknowledge_removed_content: false,
              acknowledge_older_proposal: false,
            },
          },
        ),
      );
      const [history, proposals] = await Promise.all([
        rawHistory(ws, id),
        rawProposals(ws, id),
      ]);
      const p = proposals.find((p) => p.id === pid);
      if (!p)
        throw new ApiError({
          code: "action_unresolved",
          status: 409,
          message: "Acceptance requires fresh proposal readback.",
        });
      return {
        proposal: toProposal(p, r, history),
        artifact: await artifactView(await rawArtifact(ws, id)),
      };
    });
  },
  async declineProposal(
    ws: string,
    id: string,
    pid: string,
    c: V.ProposalDecisionCommand,
  ): Promise<V.ProposalDecisionResult> {
    return enrichConflict(ws, id, async () => {
      const p = await unwrap(
        client.POST(
          "/v1/workspaces/{workspace_id}/proposals/{proposal_id}/dismiss",
          {
            params: { path: { workspace_id: ws, proposal_id: pid } },
            body: {
              ...command(c.command_id),
              expected_current_revision_id: c.expected_current_revision_id,
              resolution: "keep_current",
            },
          },
        ),
      );
      const [r, h] = await Promise.all([
        rawArtifact(ws, id),
        rawHistory(ws, id),
      ]);
      return { proposal: toProposal(p, r, h), artifact: await artifactView(r) };
    });
  },
};

// ---- conversation (B1) ----

function toConversation(c: S["Conversation"]): V.ConversationSummary {
  return {
    work_area: c.work_area ?? null,
    id: c.id,
    title: c.title,
    state: c.state,
    work_version: c.work_version,
    created_at: c.created_at ?? "",
    context_count: c.selected_source_refs?.length ?? 0,
    updated_at: c.updated_at ?? c.created_at ?? "",
    last_message_preview: c.last_message_preview ?? null,
    model_activation: c.model_activation,
  };
}

/** Run state → turn state. A ready run without a recorded reply is not shown as replied. */
export function turnStateOf(
  run: Pick<S["Run"], "id" | "state">,
  messages: Pick<S["ConversationMessage"], "run_id" | "author_kind">[],
  reported?: S["TurnState"],
): V.TurnState {
  // Cancellation remains authoritative even when an old receipt is unknown.
  if (reported?.state === "cancelled") return "cancelled";
  // A general receipt problem is not an absent local consumer.
  if (reported?.provider_observation === "outcome_unknown")
    return "outcome_unknown";
  if (reported?.provider_observation === "invalid") return "failed";
  if (reported) return reported.state;
  switch (run.state) {
    case "queued":
      return "queued";
    case "running":
      return "responding";
    case "cancelled":
      return "cancelled";
    case "ready":
      return messages.some(
        (m) => m.run_id === run.id && m.author_kind === "assistant",
      )
        ? "replied"
        : "no_reply";
    default:
      return "no_reply";
  }
}

/**
 * A run that published a draft is partial by design (the draft still needs
 * validating), and the service reports it as failed. If the reply carries
 * that draft, the turn did answer: the work itself says what isn't verified.
 */
const DRAFT_KINDS = new Set(["document", "structured_table", "custom_view"]);
export function draftAware(
  state: V.TurnState,
  runId: string,
  messages: Pick<
    S["ConversationMessage"],
    "run_id" | "author_kind" | "result"
  >[],
): V.TurnState {
  if (state !== "failed") return state;
  const products = messages
    .filter((m) => m.run_id === runId && m.author_kind === "assistant")
    .flatMap((m) => m.result?.results ?? [])
    .filter((x) => x.kind !== "text");
  return products.length && products.every((x) => DRAFT_KINDS.has(x.kind))
    ? "replied"
    : state;
}

export function conversationDetail(
  d: S["ConversationDetail"],
): V.ConversationDetailView {
  const messages = [...d.messages].sort((a, b) => a.sequence - b.sequence);
  return {
    conversation: toConversation(d.conversation),
    messages: messages.map((m) => ({
      id: m.id,
      author:
        m.author_kind === "assistant"
          ? "agent"
          : m.author_kind === "system"
            ? "runtime"
            : "person",
      text: m.text,
      created_at: m.created_at ?? "",
      sequence: m.sequence,
      run_id: m.run_id,
      origin: m.evidence_origin,
      products: (m.result?.results ?? []).filter(
        (r): r is S["ProductResult"] => r.kind !== "text",
      ),
      responsibility_origin: m.responsibility_origin ?? null,
      // Names and sizes only; the content is the person's data, not shown.
      attachments: (m.attachments ?? []).map((a) => ({
        filename: a.filename,
        byte_length: a.byte_length,
        sha256: a.sha256,
      })),
      documents: messageDocuments(m),
    })),
    turns: d.runs.map((r) => ({
      run_id: r.id,
      state: draftAware(
        turnStateOf(
          r,
          messages,
          d.turns?.find((t) => t.run_id === r.id),
        ),
        r.id,
        messages,
      ),
      reason:
        d.turns?.find((t) => t.run_id === r.id)?.reason ??
        (r.unresolved ?? []).join("; "),
      stop_reason: r.stop_reason ?? null,
      // Anchored to the request that started this run: the person's own
      // message, or the runtime's continuation request; never another one.
      message_id:
        messages.find(
          (m) =>
            m.run_id === r.id &&
            (m.author_kind === "human" || m.author_kind === "system"),
        )?.id ?? null,
      responsibility_origin:
        d.turns?.find((t) => t.run_id === r.id)?.responsibility_origin ??
        messages.find((m) => m.run_id === r.id && m.author_kind === "system")
          ?.responsibility_origin ??
        null,
      progress: turnProgress(d.turns?.find((t) => t.run_id === r.id)),
    })),
    assignment_ids: d.assignment_ids,
    artifact_ids: d.artifact_ids ?? [],
    // As the service froze it for the latest run; never inferred from size
    // or from the reply's wording.
    attachment_context: (d.attachment_context ?? []).map((a) => ({
      run_id: a.run_id,
      message_id: a.message_id,
      ref: a.ref,
      sha256: a.sha256,
      filename: a.filename,
      body_omitted: a.body_omitted,
      omission_reason: a.omission_reason,
      ranges: (a.chunks ?? []).map((c) => ({
        offset: c.offset,
        next_offset: c.next_offset,
        chunk_sha256: c.chunk_sha256,
      })),
    })),
  };
}

/**
 * Document refs on a message (additive B2.5 field, not yet in the generated
 * type). Metadata only: the snapshot's extracted text is not read into the
 * thread, and an absent field means none.
 */
export function messageDocuments(
  m: object,
): NonNullable<V.ChatMessage["documents"]> {
  const refs = (m as { document_refs?: unknown }).document_refs;
  if (!Array.isArray(refs)) return [];
  return refs.flatMap((r) => {
    const d = r as Record<string, unknown>;
    return typeof d.document_id === "string" &&
      typeof d.sha256 === "string" &&
      typeof d.filename === "string" &&
      typeof d.byte_length === "number" &&
      typeof d.status === "string"
      ? [
          {
            document_id: d.document_id,
            sha256: d.sha256,
            filename: d.filename,
            byte_length: d.byte_length,
            status: d.status as ExtractionStatus,
          },
        ]
      : [];
  });
}

export const conversationApi = {
  async list(ws: string, signal?: AbortSignal) {
    const items = await all((cursor) =>
      unwrap(
        client.GET("/v1/workspaces/{workspace_id}/conversations", {
          params: {
            path: { workspace_id: ws },
            header: meta(),
            query: { limit: 100, cursor },
          },
          signal,
        }),
      ),
    );
    return items.map(toConversation);
  },
  async get(ws: string, id: string, signal?: AbortSignal, workArea = false) {
    return conversationDetail(
      await unwrap(
        client.GET(
          workArea
            ? "/v1/workspaces/{workspace_id}/work-areas/{conversation_id}"
            : "/v1/workspaces/{workspace_id}/conversations/{conversation_id}",
          {
            params: {
              path: { workspace_id: ws, conversation_id: id },
              header: meta(),
            },
            signal,
          },
        ),
      ),
    );
  },
  /** Creating does not send text; the message is a second command. */
  async create(
    ws: string,
    c: {
      command_id: string;
      title: string;
      context_ids: { id: string; version: string }[];
    },
  ): Promise<V.ConversationSummary> {
    const body = await stablePayload<S["CreateConversation"]>(
      `${ws}:create-conversation`,
      c.command_id,
      c,
      async () => {
        const base: S["CreateConversation"] = {
          ...command(c.command_id),
          title: c.title,
        };
        if (!c.context_ids.length) return base;
        const sources = await rawSources(ws);
        return {
          ...base,
          selected_source_refs: c.context_ids.map((ref) => {
            const s = sources.find((x) => x.id === ref.id);
            if (!s || s.external_version !== ref.version)
              throw new ApiError({
                code: "source_changed",
                status: 409,
                message: "Selected source version changed; refresh sources.",
              });
            return {
              source_id: s.id,
              external_version: ref.version,
              observed_at: s.observed_at,
            };
          }),
        };
      },
    );
    return toConversation(
      await unwrap(
        client.POST("/v1/workspaces/{workspace_id}/conversations", {
          params: { path: { workspace_id: ws } },
          body,
        }),
      ),
    );
  },
  async send(
    ws: string,
    id: string,
    c: {
      command_id: string;
      request_id?: string;
      expected_work_version: number;
      text: string;
      operation?: S["PostMessage-Input"]["operation"];
      /** Natural admission only; never combined with an operation. */
      attachments?: MessageAttachment[];
      target?: ExactTarget | null;
      /** Confirmed uploaded originals (B2.5); omitted when none. */
      document_refs?: { document_id: string; sha256: string }[];
    },
  ) {
    const natural = c.attachments !== undefined || c.target !== undefined;
    const body = await stablePayload<S["PostMessage-Input"]>(
      `${ws}:message:${id}`,
      c.command_id,
      c,
      async () => ({
        ...command(c.command_id),
        ...(c.request_id ? { request_id: c.request_id } : {}),
        expected_work_version: c.expected_work_version,
        text: c.text,
        ...(c.operation ? { operation: c.operation } : {}),
        // Mirrors the general-responses contract until it is generated.
        ...(natural
          ? { attachments: c.attachments ?? [], target: c.target ?? null }
          : {}),
        ...(c.document_refs?.length ? { document_refs: c.document_refs } : {}),
      }),
    );
    const r = await unwrap(
      client.POST(
        "/v1/workspaces/{workspace_id}/conversations/{conversation_id}/messages",
        {
          params: { path: { workspace_id: ws, conversation_id: id } },
          body,
        },
      ),
    );
    return {
      conversation: toConversation(r.conversation),
      message_id: r.message.id,
      run_id: r.run.id,
    };
  },
  async cancel(
    ws: string,
    id: string,
    c: { command_id: string; expected_work_version: number },
  ) {
    const body = await stablePayload<S["CancelConversation"]>(
      `${ws}:cancel-conversation:${id}`,
      c.command_id,
      c,
      async () => ({
        ...command(c.command_id),
        expected_work_version: c.expected_work_version,
      }),
    );
    return toConversation(
      await unwrap(
        client.POST(
          "/v1/workspaces/{workspace_id}/conversations/{conversation_id}/cancel",
          {
            params: { path: { workspace_id: ws, conversation_id: id } },
            body,
          },
        ),
      ),
    );
  },
  /** Records a paused, linked assignment. B1 does not execute it. */
  async delegate(
    ws: string,
    id: string,
    c: {
      command_id: string;
      expected_work_version: number;
      goal: string;
      completion_criteria: string[];
    },
  ) {
    const body = await stablePayload<S["DelegateConversation"]>(
      `${ws}:delegate:${id}`,
      c.command_id,
      c,
      async () => ({
        ...command(c.command_id),
        expected_work_version: c.expected_work_version,
        goal: c.goal,
        completion_criteria: c.completion_criteria,
      }),
    );
    const a = await unwrap(
      client.POST(
        "/v1/workspaces/{workspace_id}/conversations/{conversation_id}/delegate",
        {
          params: { path: { workspace_id: ws, conversation_id: id } },
          body,
        },
      ),
    );
    return { assignment_id: a.id };
  },
};
