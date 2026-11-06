import { API_MODE } from "./api";

/**
 * Client implementation support, not permission to execute. The real backend
 * implements source-free conversation and PostMessage attachments/exact targets.
 * Each request still goes through current server admission (scope, profile,
 * target/version, budget and unresolved effects); a denied request stays denied.
 * Mock mode has neither path and must never simulate their availability.
 *
 * Source-free CreateAssignment is not supported by its schema. Composer uses
 * the real conversation/handover path instead; this is not an owner permission.
 */
export const CAPABILITIES = {
  conversation: API_MODE === "real",
  naturalAdmission: API_MODE === "real",
} as const;
