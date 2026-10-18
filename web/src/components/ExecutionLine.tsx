"use client";
import { workspaceExecution, type ExecutionStatus } from "@/lib/execution-view";

/**
 * Whether Workagent can take on work in this workspace right now, from the
 * service's own check. Says nothing when it's ready; never stops reading,
 * editing or asking.
 */
export function ExecutionLine({
  execution,
  perTurn = false,
}: {
  execution: { data: ExecutionStatus | null; error: unknown };
  /** Each request on this page shows its own run (a conversation). */
  perTurn?: boolean;
}) {
  const line = workspaceExecution(
    execution.data,
    Boolean(execution.error),
    perTurn,
  );
  if (!line) return null;
  return (
    <p
      className={`small ${line.state === "working" ? "muted" : "notice-line"}`}
      role="status"
      data-testid="execution-line"
      data-execution={line.state}
    >
      {line.text}
    </p>
  );
}
