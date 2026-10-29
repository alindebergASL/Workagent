/**
 * B2.4 (exact stop / checkpoint continue / durable queue) and B2.5 (confined
 * documents) wire shapes.
 *
 * TEMPORARY local adapter mirroring backend checkpoint_models.py and
 * document_models.py until the parent regenerates contracts/src. Only the
 * fields the web reads are typed; nothing here is invented client state.
 */
import type { ExactTarget, MessageAttachment } from "./natural";

export interface DocumentRef {
  document_id: string;
  sha256: string;
}

/** The exact PostMessage body, shared by Send (redirect) and Queue later. */
export interface PostMessageBody {
  schema_version: "workagent/v1";
  request_id: string;
  command_id: string;
  expected_work_version: number;
  text: string;
  attachments?: MessageAttachment[];
  target?: ExactTarget | null;
  /** Omitted when empty, matching the server's legacy-preserving serializer. */
  document_refs?: DocumentRef[];
}

export type QueueState = "pending" | "held" | "admitted" | "cancelled";
export type QueueHoldReason =
  | "work_changed"
  | "scope_changed"
  | "authority_unavailable"
  | "outcome_unknown"
  | "paused";

export interface QueuedMessage {
  id: string;
  conversation_id: string;
  owner_id: string;
  position: number;
  queue_version: number;
  created_at: string;
  intent: PostMessageBody;
  admission_work_version: number;
  access_generation: number;
  dependency_fingerprint: string;
  state: QueueState;
  reason: QueueHoldReason | null;
  run_id: string | null;
}

export type CheckpointWaiting =
  "none" | "person" | "event" | "blocked" | "unknown" | "stopped";
export type NextSafeAction =
  | "resume_phase"
  | "continue_slice"
  | "await_person"
  | "await_event"
  | "reconcile"
  | "stopped"
  | "settled";

export interface RunCheckpoint {
  checkpoint_id: string;
  workspace_id: string;
  run_id: string;
  conversation_id: string;
  assignment_id: string | null;
  phase: string;
  checkpoint_kind:
    "stage" | "publication" | "settlement" | "responsibility" | "stop";
  created_at: string;
  checkpoint_hash: string;
  /**
   * Read projection only (not checkpoint data, not hashed): true when the
   * run's configuration can resume from this checkpoint. Absent on older
   * servers or legacy checkpoints, which never offer a fresh Continue.
   */
  continuation_supported?: boolean;
  data: {
    conversation_work_version: number;
    last_observed_phase: string;
    waiting: CheckpointWaiting;
    next_safe_action: NextSafeAction;
    pending_proposal_ids: string[];
  };
}

export const DOCUMENT_MIMES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type DocumentMime = (typeof DOCUMENT_MIMES)[keyof typeof DOCUMENT_MIMES];
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_REFS = 2;
/** Server Filename pattern (document_models.Filename), max 85 chars. */
export const DOCUMENT_FILENAME =
  /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(pdf|docx|xlsx)$/;

export type ExtractionStatus =
  | "extracted"
  | "truncated"
  | "needs_ocr"
  | "unsupported"
  | "encrypted"
  | "failed"
  | "unavailable";

export interface SheetCoverage {
  name: string;
  state: "visible" | "hidden" | "veryHidden";
  total_rows: number;
  covered_rows: number;
  omitted_rows: number;
  merged_ranges: string[];
}

export interface Coverage {
  omissions: string[];
  total_pages?: number;
  covered_pages?: number;
  omitted_pages?: number;
  empty_pages_needing_ocr?: number[];
  partial_last_page?: boolean;
  total_paragraphs?: number;
  paragraphs_covered?: number;
  omitted_paragraphs?: number;
  total_tables?: number;
  tables_covered?: number;
  omitted_tables?: number;
  partial_last_block?: boolean;
  total_sheets?: number;
  covered_sheets?: number;
  omitted_sheets?: number;
  sheets?: SheetCoverage[];
}

export interface DocumentMetadata extends DocumentRef {
  workspace_id: string;
  conversation_id: string;
  owner_id: string;
  filename: string;
  mime_type: DocumentMime;
  byte_length: number;
  status: ExtractionStatus;
  reason: string;
  parser_version: string;
  text_sha256: string;
  text_bytes: number;
  coverage: Coverage;
}

export interface DocumentDetail extends DocumentMetadata {
  text: string;
}
