"use client";
import { useEffect, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import { usePendingCommand } from "@/lib/client/pending-command";
import { conversationApi } from "@/lib/client/real-api";
import { ApiError } from "@/lib/contract/errors";
import {
  attachmentsProblem,
  readAttachment,
  type ExactTarget,
  type MessageAttachment,
} from "@/lib/contract/natural";

function readKept(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function keep(key: string, text: string): void {
  try {
    if (text) sessionStorage.setItem(key, text);
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the in-memory text still exists */
  }
}

function readKeptFiles(key: string): MessageAttachment[] {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as MessageAttachment[]) : [];
  } catch {
    return [];
  }
}
function keepFiles(key: string, files: MessageAttachment[]): void {
  try {
    if (files.length) sessionStorage.setItem(key, JSON.stringify(files));
    else sessionStorage.removeItem(key);
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
}: {
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
  }>(wsId ? `workagent:pending:${wsId}:conversation:${cid}:send` : null);
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

  /** Files can change only while no send is in doubt or in flight. */
  const filesLocked = !attach || Boolean(cmd.current) || sending;
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
    !sending &&
    !held &&
    (Boolean(cmd.current) || Boolean(text.trim()));

  const send = async () => {
    if (!canSend || !wsId || version === null) return;
    setSending(true);
    setError(null);
    const sentText = text;
    const sentFiles = files;
    const attempt = cmd.current ?? {
      command_id: newCommandId(),
      expected_work_version: version,
      text: text.trim(),
      ...(attach || target !== undefined
        ? { attachments: attach ? files : [], target: target ?? null }
        : {}),
    };
    try {
      if (!cmd.current) cmd.set(attempt);
      await conversationApi.send(wsId, cid, attempt);
      if (cmd.clear(attempt)) {
        setText((current) => (current === sentText ? "" : current));
        setFiles((current) => (sameFiles(current, sentFiles) ? [] : current));
        await refresh();
      }
    } catch (e) {
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

  return {
    text,
    setText,
    sending,
    error,
    send,
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
