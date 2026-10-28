"use client";
import { useEffect, useRef } from "react";
import { parseWorkSnapshot } from "@/lib/contract/work-events";
import type { SnapshotRead } from "@/lib/latest-note";
import { API_BASE, API_MODE } from "./api";
import { useResource } from "./hooks";
import { scopedFetch } from "./session-scope";
import { workHeaders } from "./work-stream";

/**
 * One read of a conversation's work snapshot, only for the time an
 * observation was recorded. Read-only; any failure, or a snapshot for
 * another conversation, is simply unavailable.
 */
export async function readWorkSnapshot(
  ws: string,
  cid: string,
  signal?: AbortSignal,
) {
  const res = await scopedFetch(
    `${API_BASE}/v1/workspaces/${encodeURIComponent(ws)}/work-snapshot?${new URLSearchParams({ conversation_id: cid })}`,
    { headers: workHeaders(), cache: "no-store", signal },
  );
  if (!res.ok) throw new Error(`work snapshot: HTTP ${res.status}`);
  const snapshot = parseWorkSnapshot(await res.json());
  if (snapshot.conversation_id !== cid)
    throw new Error("work snapshot: another conversation");
  return snapshot;
}

/**
 * The snapshot for one conversation, re-read whenever `basis` (the
 * responsibility record's own text) changes, so a newer note on the record
 * is never hidden behind an older observation.
 */
export function useSnapshotRead(
  ws: string | null,
  cid: string | null | undefined,
  basis: string,
): SnapshotRead {
  const on = API_MODE === "real" && Boolean(ws && cid);
  const res = useResource(on ? `work-snapshot:${ws}:${cid}` : null, (signal) =>
    readWorkSnapshot(ws!, cid!, signal),
  );
  const { refresh } = res;
  const seen = useRef(basis);
  useEffect(() => {
    if (seen.current === basis) return;
    seen.current = basis;
    if (on) void refresh();
  }, [basis, on, refresh]);
  if (!on) return { kind: "unavailable" };
  if (res.data) return { kind: "ready", snapshot: res.data };
  if (res.error) return { kind: "unavailable" };
  return { kind: "loading" };
}
