import type { components } from "../../../../contracts/src/client";

type S = components["schemas"];

/**
 * Natural-language admission (docs/GENERAL_RESPONSES_CONTRACT.md). Shapes
 * come from the generated client; this module only adds the client-side
 * checks for the stated limits.
 */
export type MessageAttachment = S["AttachmentInput"];
/** The exact saved version a reply is about, from the current readback. */
export type ExactTarget = S["ExactTarget"];

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
 * Per-turn progress on the model path. Read-only: none of it is work, and a
 * retained local result is only saved when its publication is confirmed.
 */
export type TurnProgress = Partial<
  Pick<
    S["TurnState"],
    | "provider_observation"
    | "evidence_origin"
    | "retained_local_result"
    | "adaptive"
    | "response_steps"
  >
>;

/**
 * The progress fields of a model-path turn. Controlled test turns carry the
 * same fields but say nothing a person needs; they keep their "Test reply"
 * label instead.
 */
export function turnProgress(
  turn: S["TurnState"] | undefined,
): TurnProgress | undefined {
  if (!turn || turn.profile !== "general-responses-v1") return undefined;
  return {
    provider_observation: turn.provider_observation,
    evidence_origin: turn.evidence_origin,
    retained_local_result: turn.retained_local_result ?? null,
    ...(turn.adaptive
      ? { adaptive: turn.adaptive, response_steps: turn.response_steps }
      : {}),
  };
}
