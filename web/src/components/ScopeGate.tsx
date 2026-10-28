"use client";
import {
  Fragment,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { API_MODE } from "@/lib/client/api";
import {
  bindMockIdentity,
  probeSession,
  scopeState,
  subscribeScope,
  type ScopeState,
} from "@/lib/client/session-scope";

const CHECKING: ScopeState = { status: "checking" };
const RECHECK_MS = 60_000;

/**
 * Nothing kept on this device is read or shown until the session proves who
 * is signed in (A14). Access is checked again on focus and periodically; if
 * it changed or can't be confirmed, everything below unmounts at once and
 * stays down until an explicit reload. Kept work stays on this device under
 * the access it was written with.
 */
export function ScopeGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    subscribeScope,
    scopeState,
    () => CHECKING,
  );
  useEffect(() => {
    if (API_MODE === "mock") {
      bindMockIdentity();
      return;
    }
    void probeSession();
    const recheck = () => {
      if (document.visibilityState === "visible") void probeSession();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    const timer = window.setInterval(recheck, RECHECK_MS);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      window.clearInterval(timer);
    };
  }, []);

  if (state.status === "ready")
    return <Fragment key={state.scope_id}>{children}</Fragment>;
  return (
    <main className="page">
      <p role="status">
        {state.status === "checking"
          ? "Checking access…"
          : state.status === "unavailable"
            ? "Couldn’t confirm access to this workspace."
            : "Access for this page changed. Reload to continue with the current access."}
      </p>
      {state.status === "unavailable" && (
        <button type="button" onClick={() => void probeSession()}>
          Check again
        </button>
      )}
      {state.status === "changed" && (
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      )}
    </main>
  );
}
