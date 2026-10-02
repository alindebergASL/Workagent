/** Mode switch only. Real mode uses canonical generated client + view mapping. */
import { api as mockApi } from "./mock-api";
import { realApi } from "./real-api";
export { newCommandId } from "./mock-api";
export const API_BASE =
  process.env["NEXT_PUBLIC_WORKAGENT_API_BASE"] ?? "/api/domain";
export const API_MODE: "mock" | "real" =
  API_BASE === "/api/mock" ? "mock" : "real";
export const PRINCIPAL = API_MODE === "mock" ? "alex" : "local-human";
export const api = API_MODE === "mock" ? mockApi : realApi;
