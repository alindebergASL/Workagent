/**
 * Durable staged document snapshots (IndexedDB), so an unsent document
 * survives a reload or an unknown upload exactly.
 *
 * Each staged document is one record holding its exact original bytes
 * (binary, not base64 strings in sessionStorage), its sha256, filename, MIME,
 * upload state and confirmed server ref. Records are scoped by principal,
 * workspace and draft (a conversation's reply box, or Home); no credential is
 * involved. Every staging gets its own generation id: deleting removes only
 * the exact generations confirmed sent or explicitly removed, never anything
 * staged later. A storage failure is reported, never treated as success.
 */
import type { DocumentRef, ExtractionStatus } from "@/lib/contract/batch2";
import { sha256Hex } from "./batch2-api";
import {
  fromBase64,
  toBase64,
  type StagedDocument,
  type StagedEntry,
  type UploadIdentity,
} from "./documents";

export interface StoredDocument {
  /** `${scope}|${generation}` */
  key: string;
  scope: string;
  generation: string;
  staged_at: number;
  filename: string;
  mime_type: string;
  byte_length: number;
  sha256: string;
  bytes: ArrayBuffer;
  state: StagedEntry["state"];
  ref: (DocumentRef & { status: ExtractionStatus }) | null;
  /** Absent on records kept before upload identities were stored. */
  upload?: UploadIdentity | null;
}

export interface DocStore {
  put(record: StoredDocument): Promise<void>;
  list(scope: string): Promise<StoredDocument[]>;
  remove(keys: string[]): Promise<void>;
}

export const draftScope = (principal: string, ws: string, draft: string) =>
  `${principal}:${ws}:${draft}`;

export class StorageFailed extends Error {
  constructor() {
    super(
      "This document couldn’t be kept on this device (storage full or unavailable). It stays attached for now, but would be lost if this page reloads.",
    );
    this.name = "StorageFailed";
  }
}

export function toRecord(scope: string, entry: StagedEntry): StoredDocument {
  const bytes = fromBase64(entry.doc.content_base64);
  return {
    key: `${scope}|${entry.generation}`,
    scope,
    generation: entry.generation,
    staged_at: entry.staged_at,
    filename: entry.doc.filename,
    mime_type: entry.doc.mime_type,
    byte_length: entry.doc.byte_length,
    sha256: entry.doc.sha256,
    bytes: bytes.slice().buffer as ArrayBuffer,
    state: entry.state,
    ref: entry.ref,
    upload: entry.upload,
  };
}

const isIdentity = (u: unknown): u is UploadIdentity =>
  typeof u === "object" &&
  u !== null &&
  (
    ["command_id", "request_id", "workspace_id", "conversation_id"] as const
  ).every((k) => typeof (u as Record<string, unknown>)[k] === "string");

/**
 * Restores a staged entry and re-proves its bytes. A copy whose bytes no
 * longer hash to the recorded sha256 is returned as corrupt, not dropped.
 */
export async function fromRecord(
  r: StoredDocument,
): Promise<{ entry: StagedEntry } | { corrupt: StoredDocument }> {
  const bytes = new Uint8Array(r.bytes);
  if (bytes.length !== r.byte_length || (await sha256Hex(bytes)) !== r.sha256)
    return { corrupt: r };
  const doc: StagedDocument = Object.freeze({
    filename: r.filename,
    mime_type: r.mime_type,
    byte_length: r.byte_length,
    sha256: r.sha256,
    content_base64: toBase64(bytes),
  });
  return {
    entry: {
      doc,
      generation: r.generation,
      staged_at: r.staged_at,
      // An upload that was in flight when the page went away is unknown.
      state: r.state === "uploading" ? "unknown" : r.state,
      ref: r.ref,
      // A malformed or missing identity is never replaced by a fresh one;
      // an unknown upload without it must be reconciled by the person.
      upload: isIdentity(r.upload) ? { ...r.upload } : null,
      durable: true,
    },
  };
}

// ---- operations the hooks compose (tested against memoryDocStore) ----

/** Writes every entry; marks each durable or not. Never drops an entry. */
export async function persistEntries(
  store: DocStore,
  scope: string,
  list: StagedEntry[],
): Promise<{ list: StagedEntry[]; failed: boolean }> {
  let failed = false;
  const out = await Promise.all(
    list.map(async (e) => {
      try {
        await store.put(toRecord(scope, e));
        return { ...e, durable: true };
      } catch {
        failed = true;
        return { ...e, durable: false };
      }
    }),
  );
  return { list: out, failed };
}

export async function restoreEntries(
  store: DocStore,
  scope: string,
): Promise<{ list: StagedEntry[]; corrupt: StoredDocument[] }> {
  const list: StagedEntry[] = [];
  const corrupt: StoredDocument[] = [];
  for (const r of await store.list(scope)) {
    const got = await fromRecord(r);
    if ("entry" in got) list.push(got.entry);
    else corrupt.push(got.corrupt);
  }
  return { list, corrupt };
}

/** Deletes exactly these generations in this scope; nothing else. */
export const forgetGenerations = (
  store: DocStore,
  scope: string,
  generations: string[],
) => store.remove(generations.map((g) => `${scope}|${g}`));

// ---- IndexedDB ----

const DB = "workagent-drafts";
const STORE = "documents";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new StorageFailed());
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "key" });
      s.createIndex("scope", "scope");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageFailed());
    req.onblocked = () => reject(new StorageFailed());
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        // Resolve only once the transaction is durable, not on request success.
        t.oncomplete = () => {
          db.close();
          resolve(req ? req.result : undefined);
        };
        t.onerror = t.onabort = () => {
          db.close();
          reject(new StorageFailed());
        };
      }),
  );
}

export const indexedDocStore: DocStore = {
  put: (record) => tx("readwrite", (s) => s.put(record)).then(() => {}),
  list: async (scope) =>
    (
      (await tx<StoredDocument[]>("readonly", (s) =>
        s.index("scope").getAll(scope),
      )) ?? []
    ).sort((a, b) => a.staged_at - b.staged_at),
  remove: (keys) =>
    tx("readwrite", (s) => {
      for (const k of keys) s.delete(k);
    }).then(() => {}),
};

/** In-memory store with the same contract (tests only; never a silent fallback). */
export function memoryDocStore(fail = false): DocStore & {
  records: Map<string, StoredDocument>;
} {
  const records = new Map<string, StoredDocument>();
  return {
    records,
    put: async (r) => {
      if (fail) throw new StorageFailed();
      records.set(r.key, structuredClone(r));
    },
    list: async (scope) =>
      [...records.values()]
        .filter((r) => r.scope === scope)
        .map((r) => structuredClone(r))
        .sort((a, b) => a.staged_at - b.staged_at),
    remove: async (keys) => {
      for (const k of keys) records.delete(k);
    },
  };
}
