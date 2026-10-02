/**
 * Stateful mock store. MOCK ONLY: this is the frontend's stand-in until Hermes's
 * generated client and semantic mock arrive. It is server-side state inside
 * the Next.js process, persisted to a JSON file so that restarting the
 * process keeps the demonstration data. It is not durable application
 * persistence and proves nothing about the real database, CAS or recovery.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  Assignment,
  Artifact,
  Proposal,
  Revision,
  SourceDetail,
  Workspace,
} from "@/lib/contract/types";

export interface CommandRecord {
  command_id: string;
  payload_hash: string;
  status: number;
  body: unknown;
}

export interface MockState {
  version: 1;
  workspaces: Workspace[];
  memberships: { principal: string; workspace_id: string }[];
  sources: Record<string, SourceDetail>; // keyed by workspace:source id
  assignments: Record<string, Assignment>;
  artifacts: Record<string, Artifact>;
  revisions: Record<string, Revision>;
  proposals: Record<string, Proposal>;
  // mock-only progression bookkeeping
  runs: Record<
    string,
    {
      assignment_id: string;
      started_at: string;
      materialized_stage: number;
      failed: boolean;
    }
  >;
  proposal_release_at: Record<string, string | null>;
  proposal_instructions: Record<string, string>;
  commands: Record<string, CommandRecord>;
  counters: Record<string, number>;
}

const STATE_DIR =
  process.env["WORKAGENT_MOCK_STATE_DIR"] ??
  path.join(process.cwd(), ".workagent-mock");
const STATE_FILE = path.join(STATE_DIR, "state.json");

type G = typeof globalThis & { __workagentMockState?: MockState };

export function emptyState(): MockState {
  return {
    version: 1,
    workspaces: [],
    memberships: [],
    sources: {},
    assignments: {},
    artifacts: {},
    revisions: {},
    proposals: {},
    runs: {},
    proposal_release_at: {},
    proposal_instructions: {},
    commands: {},
    counters: {},
  };
}

export function loadState(): MockState {
  const g = globalThis as G;
  if (g.__workagentMockState) return g.__workagentMockState;
  let state: MockState | null = null;
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(
        fs.readFileSync(STATE_FILE, "utf8"),
      ) as MockState;
      if (parsed && parsed.version === 1) state = parsed;
    }
  } catch {
    state = null;
  }
  g.__workagentMockState = state ?? emptyState();
  return g.__workagentMockState;
}

export function saveState(state: MockState): void {
  const g = globalThis as G;
  g.__workagentMockState = state;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

export function resetState(): MockState {
  const fresh = emptyState();
  saveState(fresh);
  return fresh;
}

export function nextId(state: MockState, prefix: string): string {
  const n = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = n;
  return `${prefix}_${String(n).padStart(4, "0")}`;
}

export function stateFilePath(): string {
  return STATE_FILE;
}
