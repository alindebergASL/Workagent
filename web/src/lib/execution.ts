import { API_MODE } from "@/lib/client/api";

/**
 * The build-wide execution notice. In mock mode everything is the in-browser
 * mock. Against the real API, runs can be fixture, synthetic or
 * server-attested live, so the footer makes no global claim either way: each
 * item states its own `evidence_origin` (see `provenanceOf`). `worker` is the
 * label for records the backend projects no provenance for (fixture-era work).
 * Live execution is never inferred from configuration.
 */
export const EXECUTION =
  API_MODE === "mock"
    ? {
        short: "Mock service",
        worker: "mock worker",
        line: "Mock service in this browser session · Not a live agent run · No connected accounts",
      }
    : {
        short: "Local preview",
        worker: "deterministic fixture worker",
        line: "Local preview · Each item shows how it was prepared · No connected email, calendar or task accounts · No external actions are taken",
      };
