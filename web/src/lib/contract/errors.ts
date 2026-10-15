import type { ErrorCode, ErrorEnvelope, VersionConflictDetails } from "./types";

export class ApiError extends Error {
  readonly code: ErrorCode | "transport";
  readonly status: number;
  readonly requestId: string | null;
  readonly nextAction: string | null;
  readonly details: ErrorEnvelope["error"]["details"] | null;

  constructor(args: {
    code: ErrorCode | "transport";
    status: number;
    message: string;
    requestId?: string | null;
    nextAction?: string | null;
    details?: ErrorEnvelope["error"]["details"] | null;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.status = args.status;
    this.requestId = args.requestId ?? null;
    this.nextAction = args.nextAction ?? null;
    this.details = args.details ?? null;
  }

  get isVersionConflict(): boolean {
    return this.code === "version_conflict";
  }

  get versionConflict(): VersionConflictDetails | null {
    if (this.code !== "version_conflict" || !this.details) return null;
    const d = this.details as Partial<VersionConflictDetails>;
    return typeof d.current_revision_id === "string"
      ? (d as VersionConflictDetails)
      : null;
  }

  /** A transport failure means the write may or may not have happened. */
  get isAmbiguousWrite(): boolean {
    return this.code === "transport";
  }
}

/**
 * Copy for a refused message send. The service answers a send it won't admit
 * with a generic refusal; what it means depends on whether model answers are
 * turned on for the conversation. Every refusal here is definite: nothing
 * was sent and the draft stays.
 */
export function describeSendError(
  err: unknown,
  activation?: "disabled" | "active" | "revoked",
): { title: string; nextAction: string } {
  if (err instanceof ApiError) {
    const turnedOff =
      activation === "revoked" &&
      (err.code === "unsupported_operation" ||
        err.code === "action_unresolved");
    if (turnedOff)
      return {
        title: "Answers are turned off for this conversation",
        nextAction:
          "Nothing was sent, and your message is kept here. What’s already in this conversation stays as it is.",
      };
    if (err.code === "unsupported_operation")
      return activation === "active"
        ? {
            title: "This message can’t be sent in this conversation",
            nextAction: "Nothing was sent, and your message is kept here.",
          }
        : {
            title: "Workagent isn’t set up to answer here yet",
            nextAction:
              "Nothing was sent, and your message is kept here. It can be sent once answers are turned on.",
          };
    if (err.code === "action_unresolved")
      return {
        title: "An earlier request here hasn’t been resolved",
        nextAction:
          "Nothing new was sent, and your message is kept here. A new message can be added once that request is resolved.",
      };
  }
  return describeError(err);
}

/** Plain-language copy for each contract error. Never reveals existence of a protected record. */
export function describeError(err: unknown): {
  title: string;
  nextAction: string;
} {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "not_found_or_not_authorized":
        return {
          title: "This item isn’t available to you",
          nextAction:
            "It may have been removed or your access may have changed. Return to Work Home.",
        };
      case "version_conflict":
        return {
          title: "A newer saved version exists",
          nextAction:
            "Review the current version before saving again. Your draft is kept.",
        };
      case "command_conflict":
        return {
          title: "This request was already sent with different content",
          nextAction: "Reload to see the recorded result before trying again.",
        };
      case "source_unavailable":
      case "source_changed":
        return {
          title: "A selected source changed or is unavailable",
          nextAction:
            "Check the sources and start again with the current versions.",
        };
      case "budget_exhausted":
        return {
          title: "Work paused: the budget for this assignment is used up",
          nextAction: "Existing results are kept.",
        };
      case "unauthenticated":
        return {
          title: "You are signed out",
          nextAction:
            "Sign in again to continue. Unsaved text stays in this tab.",
        };
      case "transport":
        return {
          title: "Couldn’t reach the service",
          nextAction:
            "Check your connection. Nothing was discarded; retry sends the same request, not a new one.",
        };
      default:
        return {
          title: err.message || "Something went wrong",
          nextAction: err.nextAction ?? "Try again.",
        };
    }
  }
  return { title: "Something went wrong", nextAction: "Try again." };
}
