"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  InWorkspace,
  useScopedWorkspace,
  useWorkspace,
  type WorkspaceScope,
} from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import { ErrorNotice } from "./ui";

/**
 * Where "back" leads from a record page: the agent home for the default
 * workspace, otherwise that workspace's own Space.
 */
export function backTo(scope: WorkspaceScope): { href: string; label: string } {
  return scope.workspace && !scope.isDefault
    ? {
        href: `/spaces/${encodeURIComponent(scope.workspace.id)}`,
        label: `← Back to ${scope.workspace.name}`,
      }
    : { href: "/", label: "← Back to agent" };
}

/**
 * A record page read inside the workspace its address names. A workspace this
 * person can't open is not available here; it is never read from another
 * workspace instead. While the workspace list loads, the page renders with no
 * workspace yet, so drafts kept on it aren't dropped.
 */
export function ScopedRecord({
  children,
}: {
  children: (scope: WorkspaceScope) => ReactNode;
}) {
  const scope = useScopedWorkspace();
  const { error } = useWorkspace();
  if (scope.status === "unavailable" || scope.status === "unreadable")
    return (
      <div className="agent-col">
        <Link className="back-link" href="/">
          ← Back to agent
        </Link>
        <ErrorNotice
          error={
            scope.status === "unreadable" && error
              ? error
              : new ApiError({
                  code: "not_found_or_not_authorized",
                  status: 404,
                  message: "",
                })
          }
          actions={
            <Link className="btn btn-sm" href="/spaces">
              All spaces
            </Link>
          }
        />
      </div>
    );
  // While the list loads, links already carry the workspace the address
  // names; reads still wait for it to be confirmed.
  return (
    <InWorkspace
      ws={scope.wsId ?? (scope.status === "loading" ? scope.named : null)}
    >
      {children(scope)}
    </InWorkspace>
  );
}
