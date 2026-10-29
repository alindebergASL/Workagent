"use client";
import { ConnectorPanel } from "@/components/ConnectorPanel";
import { API_MODE } from "@/lib/client/api";
import { useWorkspace } from "@/lib/client/workspace";

export default function ConnectionsPage() {
  const { workspace, zone } = useWorkspace();
  return (
    <div className="agent-col">
      {API_MODE === "real" ? (
        <ConnectorPanel wsId={workspace?.id ?? null} zone={zone} />
      ) : (
        <p className="connector-muted" role="note">
          Connections need the local service; this demonstration has none.
        </p>
      )}
    </div>
  );
}
