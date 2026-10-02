"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { ArtifactState, AssignmentState } from "@/lib/contract/types";
import { ApiError, describeError } from "@/lib/contract/errors";

export function assignmentStatus(
  state: AssignmentState,
  stage?: string | null,
): { label: string; tone: string } {
  switch (state) {
    case "queued":
      return { label: "Queued", tone: "status-working" };
    case "working":
      return {
        label: stage ? `Working · ${stage}` : "Working",
        tone: "status-working",
      };
    case "ready_for_review":
      return { label: "Ready for review", tone: "status-ready" };
    case "needs_input":
      return { label: "Needs your input", tone: "status-attention" };
    case "finished":
      return { label: "Finished", tone: "status-ok" };
    case "stopped":
      return { label: "Stopped", tone: "" };
    case "failed":
      return { label: "Didn’t finish", tone: "status-error" };
  }
}

export function artifactStatus(
  state: ArtifactState,
  partial: boolean,
): { label: string; tone: string } {
  switch (state) {
    case "queued":
      return { label: "Queued", tone: "status-working" };
    case "generating":
      return { label: "Drafting", tone: "status-working" };
    case "needs_review":
      return { label: "Revision needs review", tone: "status-attention" };
    case "ready":
      return partial
        ? { label: "Partial result", tone: "status-working" }
        : { label: "Saved", tone: "status-ok" };
  }
}

export function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return <span className={`status ${tone}`}>{label}</span>;
}

export function Notice({
  tone = "",
  title,
  children,
  actions,
  role,
}: {
  tone?: "" | "notice-warn" | "notice-error" | "notice-ok";
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className={`notice ${tone}`} role={role}>
      {title ? <strong>{title}</strong> : null}
      {children ? <div>{children}</div> : null}
      {actions ? <div className="notice-actions">{actions}</div> : null}
    </div>
  );
}

export function ErrorNotice({
  error,
  actions,
}: {
  error: unknown;
  actions?: ReactNode;
}) {
  const d = describeError(error);
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <Notice tone="notice-error" title={d.title} role="alert" actions={actions}>
      {d.nextAction}
      {requestId ? (
        <div className="small muted mono">Reference {requestId}</div>
      ) : null}
    </Notice>
  );
}

/**
 * Drawer on desktop, full-screen sheet on mobile. Uses the native dialog
 * element for focus trapping and Escape; focus returns to the trigger.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => {
      onClose();
      returnFocusTo?.current?.focus();
    };
    el.addEventListener("close", handleClose);
    return () => el.removeEventListener("close", handleClose);
  }, [onClose, returnFocusTo]);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="drawer-head">
        <h2 id="drawer-title">{title}</h2>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => ref.current?.close()}
          aria-label={`Close ${title}`}
        >
          Close
        </button>
      </div>
      <div className="drawer-body">{open ? children : null}</div>
    </dialog>
  );
}
