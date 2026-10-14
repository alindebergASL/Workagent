import type { components } from "../../../../contracts/src/client";
import contract from "../../../../contracts/message-attachments.json";

type S = components["schemas"];

/**
 * Natural-language admission (docs/GENERAL_RESPONSES_CONTRACT.md). Shapes
 * come from the generated client; this module only adds the client-side
 * checks for the stated limits.
 */
export type MessageAttachment = S["AttachmentInput"];
/** The exact saved version a reply is about, from the current readback. */
export type ExactTarget = S["ExactTarget"];

/**
 * The service's published admission rules for message attachments
 * (contracts/message-attachments.json). Every check below reads them; none
 * is a separate frontend rule. Files are inert text: nothing in them is run,
 * rendered or followed.
 */
export const ATTACHMENT_LIMITS = {
  count: contract.count,
  totalBytes: contract.total_bytes,
  fileBytes: contract.file_bytes,
  filenameMaxLength: contract.filename_max_length,
  filename: new RegExp(contract.filename_pattern),
  extensions: contract.extensions,
} as const;

/** File-picker hint from the published extensions; not authoritative. */
export const ATTACH_ACCEPT = contract.extensions.map((e) => `.${e}`).join(",");

const utf8 = new TextEncoder();
const kb = (n: number) => `${Math.round(n / 1000)} KB`;

/** The MIME type the service requires for an admitted filename. */
export function attachmentMime(
  filename: string,
): MessageAttachment["mime_type"] {
  return (
    filename.endsWith(".csv") ? contract.csv_mime : contract.other_mime
  ) as MessageAttachment["mime_type"];
}

/** Why a filename can't be attached, or null if it can. */
export function filenameProblem(name: string): string | null {
  if (
    name.length > ATTACHMENT_LIMITS.filenameMaxLength ||
    !ATTACHMENT_LIMITS.filename.test(name)
  )
    return `Attach a text or code file (such as .txt, .csv, .md, .py or .ts) whose name has only letters, numbers, dots, - or _, at most ${ATTACHMENT_LIMITS.filenameMaxLength} characters.`;
  return null;
}

/**
 * Read one chosen file as an attachment, or explain why it can't be one.
 * The content is the file's UTF-8 text exactly as saved: a byte order mark
 * and line endings are kept, nothing is normalised, so the service's hash
 * and byte count describe the file's own bytes.
 */
export async function readAttachment(file: File): Promise<MessageAttachment> {
  const nameProblem = filenameProblem(file.name);
  if (nameProblem) throw new Error(nameProblem);
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  if (file.size > ATTACHMENT_LIMITS.fileBytes)
    throw new Error(
      `${file.name} is larger than ${kb(ATTACHMENT_LIMITS.fileBytes)}.`,
    );
  let content: string;
  try {
    content = new TextDecoder(contract.encoding, {
      fatal: true,
      ignoreBOM: contract.preserve_bom,
    }).decode(await file.arrayBuffer());
  } catch {
    throw new Error(`${file.name} isn’t plain UTF-8 text.`);
  }
  if (!content) throw new Error(`${file.name} is empty.`);
  if (contract.forbidden_characters.some((c) => content.includes(c)))
    throw new Error(`${file.name} contains a NUL character.`);
  return {
    filename: file.name,
    mime_type: attachmentMime(file.name),
    content,
  };
}

/** Whether a set of attachments fits the admission limits together. */
export function attachmentsProblem(list: MessageAttachment[]): string | null {
  if (list.length > ATTACHMENT_LIMITS.count)
    return `Attach at most ${ATTACHMENT_LIMITS.count === 2 ? "two" : ATTACHMENT_LIMITS.count} files.`;
  const total = list.reduce((n, a) => n + utf8.encode(a.content).length, 0);
  if (total > ATTACHMENT_LIMITS.totalBytes)
    return `Attachments can total at most ${kb(ATTACHMENT_LIMITS.totalBytes)}.`;
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
    | "explanation"
    | "responsibility_recording"
  >
>;

/** The service's immutable receipt for a responsibility a turn recorded. */
export type RecordingReceipt = S["ResponsibilityMutationResult"];

/**
 * The responsibilities a turn recorded, from the service's typed receipts
 * only (the turn's own and each step's), one per assignment. Never inferred
 * from what the reply says.
 */
export function recordedResponsibilities(
  progress?: TurnProgress,
): RecordingReceipt[] {
  const all = [
    progress?.responsibility_recording ?? null,
    ...(progress?.adaptive?.steps ?? []).map((s) =>
      "mutation_result" in s ? (s.mutation_result ?? null) : null,
    ),
  ].filter((r): r is RecordingReceipt => Boolean(r));
  const seen = new Set<string>();
  return all.filter((r) =>
    seen.has(r.assignment_id) ? false : (seen.add(r.assignment_id), true),
  );
}

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
    explanation: turn.explanation ?? null,
    responsibility_recording: turn.responsibility_recording ?? null,
    ...(turn.adaptive
      ? { adaptive: turn.adaptive, response_steps: turn.response_steps }
      : {}),
  };
}
