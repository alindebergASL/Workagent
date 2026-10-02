"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, API_MODE } from "./api";
import { ApiError } from "@/lib/contract/errors";
import type { Workspace } from "@/lib/contract/types";

export interface WorkspaceContextValue {
  workspace: Workspace | null;
  loading: boolean;
  error: ApiError | null;
  zone: string;
  zoneChoice: "utc" | "local";
  setZoneChoice: (z: "utc" | "local") => void;
  mode: "mock" | "real";
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [zoneChoice, setZoneChoiceState] = useState<"utc" | "local">("utc");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("workagent:zone");
      if (stored === "local" || stored === "utc") setZoneChoiceState(stored);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .listWorkspaces(controller.signal)
      .then((r) => {
        const personal =
          r.items.find((w) => w.kind === "personal") ?? r.items[0] ?? null;
        setWorkspace(personal);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          e instanceof ApiError
            ? e
            : new ApiError({
                code: "transport",
                status: 0,
                message: "Could not load workspace.",
              }),
        );
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspace,
      loading,
      error,
      zone:
        zoneChoice === "local"
          ? localZone()
          : (workspace?.display_time_zone ?? "UTC"),
      zoneChoice,
      setZoneChoice: (z) => {
        setZoneChoiceState(z);
        try {
          localStorage.setItem("workagent:zone", z);
        } catch {
          /* ignore */
        }
      },
      mode: API_MODE,
    }),
    [workspace, loading, error, zoneChoice],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside provider");
  return v;
}
