"use client";
import { useParams } from "next/navigation";
import { SpaceView } from "@/components/SpaceView";
import { InWorkspace } from "@/lib/client/workspace";

/** A project's stable address: its workspace and its conversation. */
export default function SpaceWorkPage() {
  const { spaceId, id } = useParams<{ spaceId: string; id: string }>();
  const ws = decodeURIComponent(spaceId);
  return (
    <InWorkspace ws={ws}>
      <SpaceView key={`${spaceId}:${id}`} ws={ws} id={decodeURIComponent(id)} />
    </InWorkspace>
  );
}
