/**
 * What this build can actually do against its API. Each flag turns on only
 * when the route exists in the generated client; nothing here is inferred
 * from configuration or simulated.
 *
 * - conversation: source-free conversation (create/send/list). Not in the
 *   deployed schema yet (agreed delta on PR #5); the UI says so plainly and
 *   never fakes a reply.
 * - delegateWithoutContext: handing work over with no context. The deployed
 *   CreateAssignment still requires at least one selected source.
 */
export const CAPABILITIES = {
  conversation: false,
  delegateWithoutContext: false,
} as const;
