/**
 * Natural-language admission, mirrored from the backend contract posted on
 * PR #9 (comment 6022411897) until the generated client carries it. Shapes
 * and limits here are copied, not designed: replace with the generated types
 * when they land and flag any difference rather than adapting silently.
 */
export interface MessageAttachment {
  filename: string;
  mime_type: "text/csv" | "text/plain";
  /** Inline UTF-8 text. The server assigns ref, length and hash. */
  content: string;
}

/** The exact saved version a reply is about, from the current readback. */
export interface ExactTarget {
  artifact_id: string;
  revision_id: string;
  body_hash: string;
}

export const ATTACHMENT_LIMITS = {
  count: 2,
  totalBytes: 200000,
  filename: /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(csv|txt)$/,
} as const;

const utf8 = new TextEncoder();

/** Read one chosen file as an attachment, or explain why it can't be one. */
export async function readAttachment(file: File): Promise<MessageAttachment> {
  if (!ATTACHMENT_LIMITS.filename.test(file.name))
    throw new Error(
      "Use a .csv or .txt file whose name has only letters, numbers, - or _.",
    );
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  if (file.size > ATTACHMENT_LIMITS.totalBytes)
    throw new Error(`${file.name} is larger than 200 KB.`);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error(`${file.name} isn’t plain UTF-8 text.`);
  }
  if (content.includes("\u0000"))
    throw new Error(`${file.name} contains a NUL character.`);
  return {
    filename: file.name,
    mime_type: file.name.endsWith(".csv") ? "text/csv" : "text/plain",
    content,
  };
}

/** Whether a set of attachments fits the admission limits together. */
export function attachmentsProblem(list: MessageAttachment[]): string | null {
  if (list.length > ATTACHMENT_LIMITS.count) return "Attach at most two files.";
  const total = list.reduce((n, a) => n + utf8.encode(a.content).length, 0);
  if (total > ATTACHMENT_LIMITS.totalBytes)
    return "Attachments can total at most 200 KB.";
  return null;
}

/**
 * Per-turn progress on the model path (same contract). Read-only: none of
 * it is work, and a retained local result is never a saved product.
 */
export interface TurnProgress {
  provider_observation?:
    "not_observed" | "pending" | "received" | "outcome_unknown" | "invalid";
  evidence_origin?:
    | "unverified"
    | "synthetic_provider_receipt"
    | "live_provider_receipt"
    | "controlled_transport";
  retained_local_result?: {
    status: "reply" | "observed" | "rejected";
    published: boolean;
    reason?: string | null;
    output?: { kind?: string; value?: string } | null;
  } | null;
}

/** Pick the progress fields from a turn record, if the backend sent any. */
export function turnProgress(raw: unknown): TurnProgress | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const p: TurnProgress = {};
  if (typeof t["provider_observation"] === "string")
    p.provider_observation = t[
      "provider_observation"
    ] as TurnProgress["provider_observation"];
  if (typeof t["evidence_origin"] === "string")
    p.evidence_origin = t["evidence_origin"] as TurnProgress["evidence_origin"];
  if (
    t["retained_local_result"] &&
    typeof t["retained_local_result"] === "object"
  )
    p.retained_local_result = t[
      "retained_local_result"
    ] as TurnProgress["retained_local_result"];
  return Object.keys(p).length ? p : undefined;
}
