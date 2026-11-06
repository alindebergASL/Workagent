/**
 * Starting a conversation from Home: create, upload documents, send. Each
 * step is an exact command frozen in one continuation record, kept under the
 * workspace the start began in (never the one shown later). A start carrying
 * documents is kept beyond this tab (localStorage) and every external step
 * waits until that record is written; if it can't be, the step isn't taken
 * and the in-memory identity is kept for an exact retry.
 */
import { ApiError } from "@/lib/contract/errors";
import type { DocumentRef } from "@/lib/contract/batch2";
import type { MessageAttachment } from "@/lib/contract/natural";
import { scopedLocal, scopedSession } from "./session-scope";

export interface HomeChat {
  workspace: string;
  text: string;
  create: {
    command_id: string;
    title: string;
    context_ids: { id: string; version: string }[];
  };
  conversation: {
    id: string;
    work_version: number;
    activation?: "disabled" | "active" | "revoked";
  } | null;
  send: {
    command_id: string;
    expected_work_version: number;
    text: string;
    attachments?: MessageAttachment[];
    target?: null;
    document_refs?: DocumentRef[];
  } | null;
  /** The documents this message was started with (no bytes). */
  documents?: { filename: string; sha256: string }[];
  handover: boolean;
  uncertain: boolean;
}

type Stores = { session: Storage; local: Storage };
// Kept under this page's authenticated scope; nothing read or written until
// it's proven (see session-scope).
const browser = (): Stores => ({
  session: scopedSession,
  local: scopedLocal,
});

export const homeChatKey = (workspace: string) =>
  `workagent:pending:${workspace}:home-chat`;

const lasting = (c: HomeChat | null) => Boolean(c?.documents?.length);

/** The continuation couldn't be kept, so the next external step wasn't taken. */
export class NotKept extends Error {
  constructor() {
    super(
      "This message and its documents couldn’t be kept on this device, so nothing more was sent. Free some browser storage and try again.",
    );
    this.name = "NotKept";
  }
}

/** Writes `value` under `workspace`; false when a document start wasn't kept. */
export function saveHomeChat(
  workspace: string,
  value: HomeChat,
  stores: Stores = browser(),
): boolean {
  const key = homeChatKey(workspace);
  const [into, other] = lasting(value)
    ? [stores.local, stores.session]
    : [stores.session, stores.local];
  try {
    into.setItem(key, JSON.stringify(value));
    // Verified, not assumed.
    if (into.getItem(key) !== JSON.stringify(value)) return !lasting(value);
  } catch {
    return !lasting(value);
  }
  try {
    other.removeItem(key);
  } catch {
    /* the kept copy is the current one */
  }
  return true;
}

export function readHomeChat(
  workspace: string,
  stores: Stores = browser(),
): HomeChat | null {
  const key = homeChatKey(workspace);
  for (const s of [stores.session, stores.local])
    try {
      const raw = s.getItem(key);
      if (raw) return JSON.parse(raw) as HomeChat;
    } catch {
      /* try the other */
    }
  return null;
}

/** Removes the record only if it is still this exact start's. */
export function clearHomeChat(
  workspace: string,
  createCommandId: string,
  stores: Stores = browser(),
): void {
  const key = homeChatKey(workspace);
  for (const s of [stores.session, stores.local])
    try {
      const raw = s.getItem(key);
      if (
        raw &&
        (JSON.parse(raw) as HomeChat).create.command_id === createCommandId
      )
        s.removeItem(key);
    } catch {
      /* nothing kept here */
    }
}

/** Same start: the same workspace and create command (a restored copy too). */
export const sameStart = (a: HomeChat | null, b: HomeChat) =>
  Boolean(
    a &&
    a.workspace === b.workspace &&
    a.create.command_id === b.create.command_id,
  );

/** Which workspace Home is showing, and which selection of it (epoch). */
export interface HomeSelection {
  readonly workspace: string | null;
  readonly epoch: number;
}

/**
 * Selecting a workspace on Home: a new epoch, and exactly that workspace's
 * own saved start or assignment (or none) becomes current. Nothing from the
 * previously selected workspace stays current, even when nothing is saved.
 */
export function selectHome<A>(
  prev: HomeSelection,
  workspace: string | null,
  saved: { chat: HomeChat | null; assignment: A | null },
): { selection: HomeSelection; chat: HomeChat | null; assignment: A | null } {
  return {
    selection: { workspace, epoch: prev.epoch + 1 },
    // Its outcome is unknown after a reload: only an exact replay is offered.
    chat: saved.chat ? { ...saved.chat, uncertain: true } : null,
    assignment: saved.chat ? null : saved.assignment,
  };
}

/**
 * Leaving a selection (switching workspace or unmounting Home): a new epoch
 * with nothing live, so no earlier start can settle into what follows.
 */
export const leaveHome = (prev: HomeSelection): HomeSelection => ({
  workspace: null,
  epoch: prev.epoch + 1,
});

/**
 * Whether a finished start may update what Home shows: the same selection
 * (workspace and epoch) it began in is still live, and it is still the start
 * shown. Otherwise only its own workspace's saved records are touched.
 */
export const settlesHere = (
  live: HomeSelection,
  began: HomeSelection,
  shown: HomeChat | null,
  c: HomeChat,
) =>
  live.epoch === began.epoch &&
  live.workspace === c.workspace &&
  sameStart(shown, c);

/**
 * Runs the remaining steps of `c` (mutating only `c`). `save` must be bound
 * to `c.workspace`. A document start is kept before create, before uploads
 * and before the final send; when it can't be, NotKept is thrown first.
 */
export async function runHomeStart(
  c: HomeChat,
  deps: {
    save: (c: HomeChat) => boolean;
    create: (
      ws: string,
      body: HomeChat["create"],
    ) => Promise<{
      id: string;
      work_version: number;
      model_activation?: "disabled" | "active" | "revoked";
    }>;
    /** Uploads (bound to the originating draft) and builds the send. */
    prepareSend: (c: HomeChat) => Promise<NonNullable<HomeChat["send"]>>;
    send: (
      ws: string,
      cid: string,
      body: NonNullable<HomeChat["send"]>,
    ) => Promise<unknown>;
  },
): Promise<{ conversationId: string }> {
  const keep = () => {
    if (!deps.save(c) && lasting(c)) throw new NotKept();
  };
  if (!c.conversation) {
    keep();
    const created = await deps.create(c.workspace, c.create);
    c.conversation = {
      id: created.id,
      work_version: created.work_version,
      activation: created.model_activation,
    };
  }
  if (!c.send) {
    keep();
    c.send = await deps.prepareSend(c);
  }
  keep();
  await deps.send(c.workspace, c.conversation.id, c.send);
  return { conversationId: c.conversation.id };
}

/**
 * What a failed step leaves: an unknown outcome or an unkept record keeps
 * the exact commands (only replayed); a refused create discards the start
 * (null); a refused send keeps the conversation for a new send.
 */
export function afterHomeStartError(c: HomeChat, e: unknown): HomeChat | null {
  if (e instanceof NotKept) return c;
  if (e instanceof ApiError && e.isAmbiguousWrite) {
    c.uncertain = true;
    return c;
  }
  if (!c.conversation) return null;
  c.send = null;
  c.uncertain = false;
  return c;
}
