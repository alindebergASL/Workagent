"use client";
import { useEffect } from "react";

/**
 * While there's something only this tab holds (unsaved edits, or a save
 * whose answer hasn't come), closing or leaving the tab asks first. Drafts
 * survive moving within the tab; they don't survive the tab closing.
 */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
