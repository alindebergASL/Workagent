import type { Block } from "@/lib/contract/types";

/**
 * Unsaved-draft backup. A draft lives in component state; this is a per-tab
 * safety copy so an accidental reload does not lose typing before the server
 * acknowledges a save. It is not application persistence, it is keyed by the
 * revision the draft was based on, and it is cleared when access is lost or
 * the save is acknowledged.
 */
export interface DraftRecord {
  artifact_id: string;
  base_revision_id: string;
  body: Block[];
  saved_at: string;
}

function key(artifactId: string): string {
  return `workagent:draft:${artifactId}`;
}

export function readDraft(artifactId: string): DraftRecord | null {
  try {
    const raw = sessionStorage.getItem(key(artifactId));
    return raw ? (JSON.parse(raw) as DraftRecord) : null;
  } catch {
    return null;
  }
}

export function writeDraft(rec: DraftRecord): void {
  try {
    sessionStorage.setItem(key(rec.artifact_id), JSON.stringify(rec));
  } catch {
    /* storage unavailable: the in-memory draft still exists */
  }
}

export function clearDraft(artifactId: string): void {
  try {
    sessionStorage.removeItem(key(artifactId));
  } catch {
    /* ignore */
  }
}
