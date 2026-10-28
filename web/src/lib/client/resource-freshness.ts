/**
 * Whether a resource's shown data is a current read of the key now
 * requested: false from the moment a replacement read starts until a read
 * that is still the newest succeeds, and false whenever the evidence belongs
 * to another key (from the first render after a key change, before any
 * effect runs). A failed or superseded read never makes it current; cached
 * data shown while reconnecting is not current.
 */
export type FreshnessEvent =
  | { kind: "reset" }
  | { kind: "start" }
  | { kind: "success"; superseded: boolean }
  | { kind: "failure"; superseded: boolean }
  /** Data replaced by a mutation's own server response. */
  | { kind: "set" };

/** Freshness evidence and the key it was read for. */
export interface Evidence {
  readonly key: string | null;
  readonly current: boolean;
}

export const noEvidence: Evidence = { key: null, current: false };

/** `key`: the key the event's read (or reset/set) belongs to. */
export function nextEvidence(
  prev: Evidence,
  key: string | null,
  e: FreshnessEvent,
): Evidence {
  switch (e.kind) {
    case "reset":
    case "start":
      return { key, current: false };
    case "success":
      return e.superseded ? prev : { key, current: true };
    case "failure":
      return e.superseded ? prev : { key, current: false };
    case "set":
      return { key, current: true };
  }
}

/** What the hook reports for the key requested in this render. */
export const currentFor = (evidence: Evidence, requested: string | null) =>
  requested !== null && evidence.key === requested && evidence.current;
