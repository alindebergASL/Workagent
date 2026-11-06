"use client";
import { useEffect, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import { scopedSession } from "@/lib/client/session-scope";
import { usePendingCommand } from "@/lib/client/pending-command";
import { conversationApi } from "@/lib/client/real-api";
import { postMessageBody, queueApi } from "@/lib/client/batch2-api";
import { entryProblem, uploadAll } from "@/lib/client/documents";
import { useStagedDocuments, type Origin } from "@/lib/client/staged-documents";
import type { DocumentRef, PostMessageBody } from "@/lib/contract/batch2";
import { ApiError } from "@/lib/contract/errors";
import {
  attachmentsProblem,
  readAttachment,
  type ExactTarget,
  type MessageAttachment,
} from "@/lib/contract/natural";

function readKept(key: string): string {
  try {
    return scopedSession.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function keep(key: string, text: string): void {
  try {
    if (text) scopedSession.setItem(key, text);
    else scopedSession.removeItem(key);
  } catch {
    /* storage unavailable: the in-memory text still exists */
  }
}

/**
 * Moves an unsent message to Home's composer for this workspace, so ending a
 * conversation never loses it. Home's own draft wins if it has one.
 */
export function carryDraftHome(wsId: string, text: string): boolean {
  const key = `workagent:composer-draft:${wsId}`;
  if (!text.trim() || readKept(key).trim()) return false;
  keep(key, text);
  return readKept(key) === text;
}

function readKeptFiles(key: string): MessageAttachment[] {
  try {
    const raw = scopedSession.getItem(key);
    return raw ? (JSON.parse(raw) as MessageAttachment[]) : [];
  } catch {
    return [];
  }
}
function keepFiles(key: string, files: MessageAttachment[]): void {
  try {
    if (files.length) scopedSession.setItem(key, JSON.stringify(files));
    else scopedSession.removeItem(key);
  } catch {
    /* storage unavailable: the in-memory files still exist */
  }
}
const sameFiles = (a: MessageAttachment[], b: MessageAttachment[]) =>
  a.length === b.length &&
  a.every(
    (f, i) =>
      f.filename === b[i]!.filename &&
      f.mime_type === b[i]!.mime_type &&
      f.content === b[i]!.content,
  );

/**
 * Replying to one conversation, wherever the reply box is shown. The draft,
 * its attached files and any unconfirmed send are keyed by conversation, so
 * the full thread and the pane beside the work share them: an unconfirmed
 * send started in one can only be replayed exactly (same words, files and
 * target), from either. Sending is a compare-and-swap on the version last
 * seen.
 */
export function useConversationReply({
  wsId,
  cid,
  version,
  refresh,
  target,
  attach = false,
  held = false,
  documents = false,
  onQueued,
}: {
  /** PDF/DOCX/XLSX originals may be attached (B2.5). */
  documents?: boolean;
  /** Called after a message is confirmed queued, to re-read the queue. */
  onQueued?: () => void;
  wsId: string | null;
  cid: string;
  /**
   * The exact saved version this reply is about (natural admission only).
   * Frozen into the attempt, so a replay names the same version.
   */
  target?: ExactTarget | null;
  /** Files may be attached (natural admission only). */
  attach?: boolean;
  /** The conversation's work version as last read; null until loaded. */
  version: number | null;
  refresh: () => Promise<unknown>;
  /**
   * Sending is held (for example, the conversation can't be re-read right
   * now). Checked when a send is admitted, so no button, key or retry path
   * can send while it is held; the draft and any unconfirmed send are kept.
   */
  held?: boolean;
}) {
  const draftKey = `workagent:conversation:${cid}`;
  const filesKey = `${draftKey}:files`;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<MessageAttachment[]>([]);
  const [fileError, setFileError] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cmd = usePendingCommand<{
    command_id: string;
    expected_work_version: number;
    text: string;
    attachments?: MessageAttachment[];
    target?: ExactTarget | null;
    document_refs?: DocumentRef[];
  }>(wsId ? `workagent:pending:${wsId}:conversation:${cid}:send` : null);
  // Queue later is its own exact command: the full body is journalled so a
  // retry after an unknown outcome sends identical bytes.
  const queueCmd = usePendingCommand<PostMessageBody>(
    wsId ? `workagent:pending:${wsId}:conversation:${cid}:queue` : null,
  );
  const [queueing, setQueueing] = useState(false);
  // Staged originals are kept as exact binary snapshots on this device
  // (IndexedDB), scoped to this conversation's draft, so a reload or an
  // unknown upload restores them. Once uploaded, their refs also travel
  // inside the frozen command.
  const staged = useStagedDocuments(wsId, `conversation:${cid}`, documents);
  const { docs, ctl } = staged;
  const dest = wsId ? { workspace_id: wsId, conversation_id: cid } : null;
  const problems = docs.map((e) => entryProblem(e, dest));
  /** Restored, readable and reconciled: nothing staged is in question. */
  const docsReady = staged.ready && problems.every((p) => !p);
  const [pickError, setDocError] = useState("");
  const docError = pickError || staged.storeError;
  useEffect(() => {
    const kept = readKept(draftKey);
    if (kept) setText((v) => v || kept);
  }, [draftKey]);
  useEffect(() => keep(draftKey, text), [draftKey, text]);
  useEffect(() => {
    if (!attach) return;
    const kept = readKeptFiles(filesKey);
    if (kept.length) setFiles((v) => (v.length ? v : kept));
  }, [filesKey, attach]);
  useEffect(() => {
    if (attach) keepFiles(filesKey, files);
  }, [filesKey, files, attach]);
  // A send restored from before a reload shows its exact words and files,
  // locked.
  const restored = cmd.restored ? cmd.current : null;
  useEffect(() => {
    if (!restored) return;
    setText(restored.text);
    if (restored.attachments) setFiles(restored.attachments);
  }, [restored]);
  const restoredQueue = queueCmd.restored ? queueCmd.current : null;
  useEffect(() => {
    if (!restoredQueue) return;
    setText(restoredQueue.text);
    if (restoredQueue.attachments) setFiles(restoredQueue.attachments);
  }, [restoredQueue]);

  const busy = sending || queueing;
  const frozen = Boolean(cmd.current) || Boolean(queueCmd.current);
  /** Files can change only while no send is in doubt or in flight. */
  const filesLocked = !attach || frozen || busy;
  // Nothing can be picked until restoration settles (or while it is blocked).
  const docsLocked = !documents || frozen || busy || !staged.ready;
  const addDocuments = async (list: FileList | File[] | null) => {
    if (docsLocked || !list || !list.length) return;
    // Bound to the draft it was picked in; a late read never lands elsewhere.
    setDocError(await ctl.add([...list]));
  };
  const removeDocument = (index: number) => {
    const gone = docs[index];
    const o = ctl.origin();
    // A document needing reconciliation can always be removed explicitly.
    if (!gone || !o || (docsLocked && !problems[index])) return;
    void ctl.forget(o, [gone.generation]);
    setDocError("");
  };
  const reattachDocument = (index: number) => {
    const gone = docs[index];
    const o = ctl.origin();
    if (!gone || !o || frozen || busy || !problems[index]) return;
    void ctl.reattach(o, gone.generation).catch(() => {});
  };
  const addFiles = async (list: FileList | File[] | null) => {
    if (filesLocked || !list || !list.length) return;
    try {
      const read = await Promise.all([...list].map(readAttachment));
      const next = [...files, ...read];
      const problem = attachmentsProblem(next);
      if (problem) throw new Error(problem);
      setFiles(next);
      setFileError("");
    } catch (e) {
      setFileError(
        e instanceof Error ? e.message : "That file can’t be attached.",
      );
    }
  };
  const removeFile = (index: number) => {
    if (filesLocked) return;
    setFiles((list) => list.filter((_, n) => n !== index));
    setFileError("");
  };

  const canSend =
    Boolean(wsId) &&
    version !== null &&
    !busy &&
    docsReady &&
    !held &&
    !queueCmd.current &&
    (Boolean(cmd.current) || Boolean(text.trim()));
  const canQueue =
    Boolean(wsId) &&
    version !== null &&
    !busy &&
    docsReady &&
    !held &&
    !cmd.current &&
    (Boolean(queueCmd.current) || Boolean(text.trim()));

  /** Uploads staged originals once; refs are confirmed server receipts. */
  const documentRefs = async (o: Origin | null): Promise<DocumentRef[]> => {
    if (!docs.length || !dest) return [];
    if (!o) throw new Error("Attached documents aren’t available here.");
    // Every write lands in the draft the send started from.
    return uploadAll(dest, docs, (next) => ctl.persist(o, next));
  };
  const clearSent = (
    sentText: string,
    sentFiles: MessageAttachment[],
    refs: DocumentRef[] | undefined,
    o: Origin | null,
  ) => {
    setText((current) => (current === sentText ? "" : current));
    setFiles((current) => (sameFiles(current, sentFiles) ? [] : current));
    // Only the exact generations this confirmed command carried are removed.
    if (o && refs?.length) void ctl.forgetRefs(o, refs);
  };

  const send = async () => {
    if (!canSend || !wsId || version === null) return;
    setSending(true);
    setError(null);
    const sentText = text;
    const sentFiles = files;
    const origin = ctl.origin();
    let attempt = cmd.current;
    try {
      if (!attempt) {
        const document_refs = await documentRefs(origin);
        // Exact human text; trim only decides whether there is anything to send.
        attempt = {
          command_id: newCommandId(),
          expected_work_version: version,
          text,
          ...(attach || target !== undefined
            ? { attachments: attach ? files : [], target: target ?? null }
            : {}),
          ...(document_refs.length ? { document_refs } : {}),
        };
        cmd.set(attempt);
      }
      await conversationApi.send(wsId, cid, attempt);
      if (cmd.clear(attempt)) {
        clearSent(sentText, sentFiles, attempt.document_refs, origin);
        await refresh();
      }
    } catch (e) {
      if (!attempt) {
        // The upload itself failed: nothing was sent; everything stays.
        setError(e);
        return;
      }
      if (!(e instanceof ApiError && e.isAmbiguousWrite)) {
        const cleared = cmd.clear(attempt);
        if (cleared && e instanceof ApiError && e.isVersionConflict)
          await refresh();
      }
      setError(e);
    } finally {
      setSending(false);
    }
  };

  /** Queue later: kept by the server and run after the current work settles. */
  const queue = async () => {
    if (!canQueue || !wsId || version === null) return;
    setQueueing(true);
    setError(null);
    const sentText = text;
    const sentFiles = files;
    const origin = ctl.origin();
    let attempt = queueCmd.current;
    try {
      if (!attempt) {
        const document_refs = await documentRefs(origin);
        attempt = postMessageBody({
          command_id: newCommandId(),
          expected_work_version: version,
          text,
          ...(attach || target !== undefined
            ? { attachments: attach ? files : [], target: target ?? null }
            : {}),
          document_refs,
        });
        queueCmd.set(attempt);
      }
      await queueApi.queue(wsId, cid, attempt);
      if (queueCmd.clear(attempt)) {
        clearSent(sentText, sentFiles, attempt.document_refs, origin);
        onQueued?.();
      }
    } catch (e) {
      if (attempt && !(e instanceof ApiError && e.isAmbiguousWrite)) {
        const cleared = queueCmd.clear(attempt);
        if (cleared && e instanceof ApiError && e.isVersionConflict)
          await refresh();
      }
      setError(e);
    } finally {
      setQueueing(false);
    }
  };

  return {
    text,
    setText,
    sending,
    error,
    send,
    queue,
    queueing,
    canQueue,
    /** A queue request's outcome is unknown; only its exact replay is offered. */
    queueUncertain: Boolean(queueCmd.current) && !queueing,
    docs,
    docError,
    addDocuments,
    removeDocument,
    docsLocked,
    /** Per staged document: why it must be reconciled first (or null). */
    docProblems: problems,
    reattachDocument,
    /** Explicit recovery for a blocked restoration of kept documents. */
    docRecovery: staged.recovery,
    /** Files attached to the draft; frozen with an unconfirmed send. */
    files,
    fileError,
    addFiles,
    removeFile,
    filesLocked,
    /** Whether a send would be admitted right now, by any path. */
    canSend,
    /** An earlier send's outcome is unknown; only an exact replay is offered. */
    uncertain: Boolean(cmd.current) && !sending,
    /**
     * The saved version an unconfirmed send is about (null: none), frozen
     * with it; undefined when no send is in doubt.
     */
    pendingTarget: cmd.current ? (cmd.current.target ?? null) : undefined,
  };
}
