import { API_MODE } from "@/lib/client/api";

/**
 * How work is actually executed in this build. The real domain API currently
 * dispatches only the deterministic fixture worker (run profile
 * `fixture-deterministic-v1`); no live model runtime is connected. Every place
 * that shows agent-produced work names this mode instead of implying a live run.
 * When the API exposes a run's profile/provider per item, label per run instead.
 */
export const EXECUTION =
  API_MODE === "mock"
    ? {
        short: "Mock service",
        worker: "mock worker",
        line: "Mock service in this browser session · Not a live agent run · No connected accounts",
      }
    : {
        short: "Local fixture computation",
        worker: "deterministic fixture worker",
        line: "Local preview · Work is prepared by a fixture worker, not a live agent · No connected accounts",
      };
