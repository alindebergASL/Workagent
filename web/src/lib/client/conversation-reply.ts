"use client";
import { useEffect, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import { usePendingCommand } from "@/lib/client/pending-command";
import { conversationApi } from "@/lib/client/real-api";
import { ApiError } from "@/lib/contract/errors";

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

/**
 * Replying to one conversation, wherever the reply box is shown. The draft
 * and any unconfirmed send are keyed by conversation, so the full thread and
 * the pane beside the work share them: an unconfirmed send started in one
 * can only be replayed exactly, from either. Sending is a compare-and-swap on
 * the version last seen.
 */
export function useConversationReply({
  wsId,
  cid,
  version,
  refresh,
}: {
  wsId: string | null;
  cid: string;
  /** The conversation's work version as last read; null until loaded. */
  version: number | null;
  refresh: () => Promise<unknown>;
}) {
  const draftKey = `workagent:conversation:${cid}`;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cmd = usePendingCommand<{
    command_id: string;
    expected_work_version: number;
    text: string;
  }>(wsId ? `workagent:pending:${wsId}:conversation:${cid}:send` : null);
  useEffect(() => {
    const kept = readKept(draftKey);
    if (kept) setText((v) => v || kept);
  }, [draftKey]);
  useEffect(() => keep(draftKey, text), [draftKey, text]);
  // A send restored from before a reload shows its exact words, locked.
  const restored = cmd.restored ? cmd.current : null;
  useEffect(() => {
    if (restored) setText(restored.text);
  }, [restored]);

  const send = async () => {
    if (!wsId || version === null || sending) return;
    if (!cmd.current && !text.trim()) return;
    setSending(true);
    setError(null);
    const sentText = text;
    const attempt = cmd.current ?? {
      command_id: newCommandId(),
      expected_work_version: version,
      text: text.trim(),
    };
    try {
      if (!cmd.current) cmd.set(attempt);
      await conversationApi.send(wsId, cid, attempt);
      if (cmd.clear(attempt)) {
        setText((current) => (current === sentText ? "" : current));
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
    /** An earlier send's outcome is unknown; only an exact replay is offered. */
    uncertain: Boolean(cmd.current) && !sending,
  };
}
