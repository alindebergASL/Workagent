/**
 * The boundary for agent-created views (issue #13). Generated HTML, CSS and
 * script run in an opaque-origin frame that can draw and compute but cannot
 * reach the network, the app, its storage, the person's login or other
 * pages. The only way out is a private message port the host validates.
 *
 * This module is the host's half and owns no contract fields: what a view's
 * source, data and actions are called on the wire is the backend's to
 * publish. Adapters map that contract onto ViewSource and the action table.
 */

/** Only scripts: no same-origin, forms, popups, modals, downloads or top navigation. */
export const VIEW_SANDBOX = "allow-scripts";

/**
 * The view's own content policy, applied inside the frame before any
 * generated markup. Nothing may be fetched; images, fonts and media only from
 * inline data. Inline script and style are what a generated view is.
 */
export const VIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Browser features a view never gets (Permissions Policy). */
export const VIEW_ALLOW = [
  "accelerometer",
  "autoplay",
  "camera",
  "clipboard-read",
  "clipboard-write",
  "display-capture",
  "encrypted-media",
  "fullscreen",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking",
]
  .map((feature) => `${feature} 'none'`)
  .join("; ");

export const VIEW_LIMITS = {
  /** Source size the host will render at all. */
  sourceBytes: 512_000,
  /** Data handed to a view. */
  dataBytes: 1_000_000,
  /** Any single message from a view. */
  messageBytes: 64_000,
  minHeight: 120,
  maxHeight: 4000,
  /** Action requests per view per minute. */
  requestsPerMinute: 30,
  /** Requests waiting for an answer at once. */
  pendingRequests: 4,
} as const;

export interface ViewSource {
  html: string;
  css?: string;
  js?: string;
}

const encoder = new TextEncoder();
export const byteLength = (s: string) => encoder.encode(s).length;

/** Inline text can't close the element it sits in. */
function inlineSafe(text: string, tag: "script" | "style"): string {
  return text.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
}

/**
 * The trusted bootstrap that runs first in the frame. It accepts exactly one
 * port from the host, then exposes `window.workagent` for the view. A view
 * can tamper with it; that only affects itself, because the host checks
 * every message it receives regardless of what sent it.
 */
const BOOTSTRAP = `(() => {
  let port = null, data = null, seq = 0;
  const pending = new Map(), waiting = [];
  const report = () => port && port.postMessage({
    type: "resize",
    height: Math.ceil(document.documentElement.scrollHeight),
  });
  addEventListener("message", (e) => {
    if (port || !e.data || e.data.type !== "workagent:init" || !e.ports || !e.ports[0]) return;
    port = e.ports[0];
    data = e.data.data;
    port.onmessage = (m) => {
      const r = m.data;
      if (!r) return;
      if (r.type === "result" && pending.has(r.id)) {
        const p = pending.get(r.id);
        pending.delete(r.id);
        r.ok ? p.resolve(r.value) : p.reject(new Error(String(r.error)));
      } else if (r.type === "data") {
        data = r.data;
        dispatchEvent(new CustomEvent("workagent:data", { detail: data }));
      }
    };
    waiting.splice(0).forEach((f) => f(data));
    report();
  });
  addEventListener("load", report);
  if (typeof ResizeObserver === "function")
    new ResizeObserver(report).observe(document.documentElement);
  window.workagent = Object.freeze({
    ready: () => new Promise((r) => (port ? r(data) : waiting.push(r))),
    get data() { return data; },
    // Requests made before the host connects wait for it, then go in order.
    request: (action, payload) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const send = () => port.postMessage({ type: "request", id, action, payload });
      port ? send() : waiting.push(send);
    }),
  });
})();`;

/**
 * The complete document for a view. The content policy comes first, so it
 * applies before any generated markup is parsed; later policies a view adds
 * can only restrict further.
 */
export function buildViewDocument(source: ViewSource): string {
  const css = source.css ? inlineSafe(source.css, "style") : "";
  const js = source.js ? inlineSafe(source.js, "script") : "";
  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    `<meta http-equiv="Content-Security-Policy" content="${VIEW_CSP}">`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<script>${BOOTSTRAP}</script>`,
    "<style>html,body{margin:0;padding:0}body{font:15px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}</style>",
    css ? `<style>${css}</style>` : "",
    "</head><body>",
    source.html,
    js ? `<script>${js}</script>` : "",
    "</body></html>",
  ].join("");
}

/** Why a view can't be shown at all, or null. */
export function viewProblem(source: ViewSource, data: unknown): string | null {
  const size =
    byteLength(source.html) +
    byteLength(source.css ?? "") +
    byteLength(source.js ?? "");
  if (size > VIEW_LIMITS.sourceBytes) return "This view is too large to show.";
  let json: string | undefined;
  try {
    json = JSON.stringify(data ?? null);
  } catch {
    return "This view’s data can’t be shown.";
  }
  if (json === undefined || byteLength(json) > VIEW_LIMITS.dataBytes)
    return "This view’s data is too large to show.";
  return null;
}

export type ViewMessage =
  | { type: "resize"; height: number }
  | {
      type: "request";
      id: number;
      action: string;
      payload: unknown;
      /** Why the host must refuse this request without running anything. */
      refused?: string;
    };

/**
 * Read one message from a view, or null if it isn't a message the host
 * understands. A request with a valid id is always returned so it can be
 * answered: malformed or oversized ones come back marked refused. Nothing
 * here grants anything; an action still has to be one the host was given.
 */
export function readViewMessage(raw: unknown): ViewMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  let size = Infinity;
  try {
    size = byteLength(JSON.stringify(raw));
  } catch {
    /* unserializable: treated as oversized */
  }
  if (m["type"] === "request") {
    const id = m["id"];
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)
      return null;
    if (size > VIEW_LIMITS.messageBytes)
      return {
        type: "request",
        id,
        action: "",
        payload: null,
        refused: "That request is too large.",
      };
    const action = m["action"];
    // A malformed name can never match an action the host was given.
    const name =
      typeof action === "string" && /^[a-z][a-z0-9_.-]{0,63}$/.test(action)
        ? action
        : "";
    return { type: "request", id, action: name, payload: m["payload"] ?? null };
  }
  if (size > VIEW_LIMITS.messageBytes) return null;
  if (m["type"] === "resize") {
    const h = m["height"];
    if (typeof h !== "number" || !Number.isFinite(h)) return null;
    return {
      type: "resize",
      height: Math.min(
        VIEW_LIMITS.maxHeight,
        Math.max(VIEW_LIMITS.minHeight, Math.ceil(h)),
      ),
    };
  }
  return null;
}
