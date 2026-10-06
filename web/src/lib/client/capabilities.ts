import { API_MODE } from "./api";

/**
 * What this build can actually do against its API. Each flag turns on only
 * when the route exists in the generated client; nothing here is inferred
 * from configuration or simulated.
 *
 * - conversation: source-free conversation (B1 routes in the generated
 *   client since 9a8944b). Real mode only; the mock service has no
 *   conversation, so it says so plainly and never fakes a reply.
 * - delegateWithoutContext: handing work over with no context. The deployed
 *   CreateAssignment still requires at least one selected source.
 * - naturalAdmission: messages may carry attachments and an exact saved
 *   target (no operation picker). The released backend's PostMessage is
 *   closed and refuses these fields, so the build turns this on explicitly
 *   (NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1) against a backend that has
 *   the general-responses contract.
 */
export const CAPABILITIES = {
  conversation: API_MODE === "real",
  delegateWithoutContext: false,
  naturalAdmission:
    API_MODE === "real" &&
    process.env["NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION"] === "1",
} as const;
