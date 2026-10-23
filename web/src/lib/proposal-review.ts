/**
 * Which pending proposal is the latest for the saved version, and what a
 * proposal would remove or replace in it, so a choice that loses content or
 * picks an earlier candidate is never one click away.
 *
 * The service computes this (`review`) across every pending candidate on the
 * current base. Older responses and mocks don't carry it, so the same
 * structural reading runs here; absence is never read as "nothing is lost".
 */

/** What the service says about one proposal, when it says anything. */
export interface ProposalReview {
  latest_pending_proposal_id: string | null;
  is_latest: boolean;
  removed_content: Array<{ path: string; before: string }>;
  removed_content_count: number;
}

/** Fields this module reads from a proposal (generated type or a mock). */
export interface ReviewableProposal {
  id: string;
  status: string;
  base_revision_id: string;
  created_at?: string;
  body: unknown;
  review?: ProposalReview | null;
}

export interface Removed {
  /** A JSON pointer into the saved body, e.g. `/notes/0`. */
  path: string;
  before: string;
}

const epoch = (t: string | undefined): number => {
  const n = t ? Date.parse(t) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Chronological: the instant created_at names, then id. Never page order or
 * string order (offsets differ). A missing or unreadable time sorts first, so
 * it is never taken for the newest.
 */
export function byCreated<P extends ReviewableProposal>(a: P, b: P): number {
  const ta = epoch(a.created_at);
  const tb = epoch(b.created_at);
  const va = !Number.isNaN(ta);
  const vb = !Number.isNaN(tb);
  if (va !== vb) return va ? 1 : -1;
  if (va && ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface Candidates<P extends ReviewableProposal> {
  /** The one latest pending proposal on the current saved version. */
  latest: P | null;
  /** Earlier pending proposals on the same saved version, newest first. */
  earlier: P[];
  /** Pending proposals made from an older saved version. */
  outdated: P[];
}

/**
 * Splits pending proposals into the latest candidate for the saved version,
 * earlier same-base candidates and outdated ones. The service's latest wins
 * when the candidates agree on one that's here. Otherwise the newest by time,
 * id — unless a candidate's time can't be read, when none is called latest
 * and every one needs acknowledging.
 */
export function candidates<P extends ReviewableProposal>(
  proposals: P[],
  currentRevisionId: string,
): Candidates<P> {
  const pending = proposals.filter((p) => p.status === "pending");
  const same = pending
    .filter((p) => p.base_revision_id === currentRevisionId)
    .sort(byCreated);
  const outdated = pending
    .filter((p) => p.base_revision_id !== currentRevisionId)
    .sort(byCreated);
  const named = new Set(
    same
      .map((p) => p.review?.latest_pending_proposal_id)
      .filter((id): id is string => Boolean(id)),
  );
  // Only trust the service's choice when the candidates agree on it.
  const served =
    named.size === 1 ? same.find((p) => named.has(p.id)) : undefined;
  const orderKnown = same.every((p) => !Number.isNaN(epoch(p.created_at)));
  const latest =
    served ?? (orderKnown ? (same[same.length - 1] ?? null) : null);
  const earlier = same.filter((p) => p !== latest).reverse();
  return { latest, earlier, outdated };
}

/**
 * The comparison to open first: the one the person chose to review while it
 * is still pending here, else the latest candidate, else the first. Choosing
 * an earlier one never makes it the latest.
 */
export function selectedComparison<P extends { id: string }>(
  comparable: P[],
  selectedId: string | null,
  latestId: string | null,
): P | undefined {
  return (
    comparable.find((p) => p.id === selectedId) ??
    comparable.find((p) => p.id === latestId) ??
    comparable[0]
  );
}

// Mirrors the service's structural reading (backend proposal_review.py) so a
// response without `review` is judged the same way, not by a narrower check.
const DISPLAY_LIMIT = 20;
const IDENTITIES = ["block_id", "row_id", "field_key", "key", "name"];
// Only known root metadata is derived. User columns may have these same names.
const BODY_METADATA = new Map<unknown, string>([
  ["file", "content_sha256"],
  ["custom_view", "access_generation"],
]);

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const part = (k: string): string => k.replace(/~/g, "~0").replace(/\//g, "~1");

/** Every removed or replaced saved value, complete and unbounded. */
export function localRemovals(saved: unknown, proposed: unknown): Removed[] {
  const out: Removed[] = [];
  const metadata = BODY_METADATA.get(isObj(saved) ? saved.kind : undefined);
  const record = (path: string, v: unknown) =>
    out.push({
      path: path || "/",
      before: typeof v === "string" ? v : stable(v),
    });
  const walk = (old: unknown, now: unknown, path: string): void => {
    if (stable(old) === stable(now)) return;
    if (isObj(old) && isObj(now)) {
      for (const [k, v] of Object.entries(old)) {
        if (!path && k === metadata) continue;
        const child = `${path}/${part(k)}`;
        if (!(k in now)) record(child, v);
        else walk(v, now[k], child);
      }
    } else if (Array.isArray(old) && Array.isArray(now)) {
      const all = [...old, ...now];
      const identity = IDENTITIES.find(
        (key) =>
          old.length > 0 &&
          all.every((x) => isObj(x) && typeof x[key] === "string") &&
          new Set(old.map((x) => (x as Record<string, string>)[key])).size ===
            old.length &&
          new Set(now.map((x) => (x as Record<string, string>)[key])).size ===
            now.length,
      );
      if (identity) {
        const byId = new Map(
          now.map((x) => [(x as Record<string, string>)[identity], x]),
        );
        for (const v of old as Array<Record<string, string>>) {
          const id = String(v[identity]);
          const child = `${path}/${part(id)}`;
          if (!byId.has(id)) record(child, v);
          else walk(v, byId.get(id), child);
        }
      } else {
        // Exact multiset: a reorder loses nothing, a dropped duplicate does.
        const left = new Map<string, number>();
        for (const x of now)
          left.set(stable(x), (left.get(stable(x)) ?? 0) + 1);
        old.forEach((v, i) => {
          const n = left.get(stable(v)) ?? 0;
          if (n) left.set(stable(v), n - 1);
          else record(`${path}/${i}`, v);
        });
      }
    } else if (old !== null && old !== undefined && old !== "") {
      // Only document block text may grow around the exact old string;
      // typed cells, enums and decimals ("10.00" → "110.00") compare exactly.
      const prose =
        path.startsWith("/blocks/") &&
        path.split("/").length === 4 &&
        path.endsWith("/text");
      if (
        prose &&
        typeof old === "string" &&
        typeof now === "string" &&
        now.includes(old)
      )
        return;
      record(path, old);
    }
  };
  walk(saved, proposed, "");
  return out;
}

/**
 * One spelling per saved location: JSON pointer, with legacy `notes[0]`
 * style read as `/notes/0`. Escapes are decoded and re-encoded the same way.
 */
export function canonicalPath(path: string): string {
  const parts = path.startsWith("/")
    ? path
        .slice(1)
        .split("/")
        .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    : path.split(/[.[\]]+/).filter(Boolean);
  return parts.length ? `/${parts.map(part).join("/")}` : "/";
}

/** A readable name for a removed part's path. */
export function removedLabel(path: string): string {
  const top = canonicalPath(path).split("/")[1] ?? "";
  if (top === "notes") return "Note";
  if (top === "rows") return "Row";
  if (top === "blocks") return "Part";
  if (top === "fields") return "Field";
  if (top === "title") return "Title";
  return canonicalPath(path);
}

export interface Review {
  /** Whether this is the latest candidate for the saved version. */
  isLatest: boolean;
  /** Whether the service computed this, rather than the local reading. */
  served: boolean;
  removed: Removed[];
  /** Total removed or replaced, which may exceed the details listed. */
  removedCount: number;
  needsRemovalAck: boolean;
  needsOlderAck: boolean;
  /** Changes whenever the candidate, base or review changes. */
  signature: string;
}

/**
 * The review for one same-base candidate. The service's and the local
 * readings are joined by location, never counted twice; the local entry is
 * kept whole where both name it. The count is the larger complete count.
 */
export function reviewOf(
  p: ReviewableProposal,
  savedBody: unknown,
  latestId: string | null,
): Review {
  const r = p.review ?? null;
  const local = localRemovals(savedBody, p.body);
  const byPath = new Map<string, Removed>();
  for (const l of local) byPath.set(canonicalPath(l.path), l);
  const serverOnly: Removed[] = [];
  for (const x of r?.removed_content ?? [])
    if (!byPath.has(canonicalPath(x.path))) {
      byPath.set(canonicalPath(x.path), x);
      serverOnly.push(x);
    }
  // Both counts are complete (only the listed details are bounded), so the
  // larger is honest; adding them would count the same loss twice.
  const removedCount = Math.max(byPath.size, r ? r.removed_content_count : 0);
  const listed = [...serverOnly, ...local];
  const removed = listed.slice(0, DISPLAY_LIMIT);
  // Latest only when both the ordering here and the service agree.
  const isLatest = p.id === latestId && (!r || r.is_latest);
  return {
    isLatest,
    served: Boolean(r),
    removed,
    removedCount,
    needsRemovalAck: removedCount > 0,
    needsOlderAck: !isLatest,
    signature: JSON.stringify([p.id, p.base_revision_id, latestId, r, removed]),
  };
}

export interface Acks {
  /** The review signature these acknowledgements were given for. */
  signature: string;
  removed: boolean;
  older: boolean;
}

/** Acknowledgements given for a different review no longer count. */
export function acksFor(acks: Acks | undefined, review: Review): Acks {
  return acks && acks.signature === review.signature
    ? acks
    : { signature: review.signature, removed: false, older: false };
}

/** Whether the person has acknowledged every risk this review carries. */
export function canAccept(review: Review, acks: Acks): boolean {
  return (
    acks.signature === review.signature &&
    (!review.needsRemovalAck || acks.removed) &&
    (!review.needsOlderAck || acks.older)
  );
}

/** The acknowledgement flags sent with an accept, only those given. */
export function ackPayload(
  review: Review,
  acks: Acks,
): { acknowledge_removed_content?: true; acknowledge_older_proposal?: true } {
  return {
    ...(review.needsRemovalAck && acks.removed
      ? { acknowledge_removed_content: true as const }
      : {}),
    ...(review.needsOlderAck && acks.older
      ? { acknowledge_older_proposal: true as const }
      : {}),
  };
}
