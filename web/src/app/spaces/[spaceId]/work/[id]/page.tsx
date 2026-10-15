"use client";
import { useParams } from "next/navigation";
import { SpaceView } from "@/components/SpaceView";

/** A project's stable address: its workspace and its conversation. */
export default function SpaceWorkPage() {
  const { spaceId, id } = useParams<{ spaceId: string; id: string }>();
  return (
    <SpaceView
      key={`${spaceId}:${id}`}
      ws={decodeURIComponent(spaceId)}
      id={decodeURIComponent(id)}
    />
  );
}
