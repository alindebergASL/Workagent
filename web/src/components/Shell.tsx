"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useWorkspace } from "@/lib/client/workspace";

export function Shell({ children }: { children: ReactNode }) {
  const { workspace, zoneChoice, setZoneChoice, zone, mode } = useWorkspace();
  const pathname = usePathname();
  const name = workspace?.name ?? "Personal workspace";
  const scope = workspace?.scope_label ?? "Private";
  const isHome = pathname === "/";

  const zoneToggle = (
    <label className="row" style={{ gap: 6 }}>
      <span>Times in</span>
      <select
        aria-label="Time zone for displayed times"
        value={zoneChoice}
        onChange={(e) => setZoneChoice(e.target.value as "utc" | "local")}
        style={{
          fontSize: "0.8125rem",
          padding: "2px 4px",
          borderRadius: 6,
          border: "1px solid var(--line-strong)",
          background: "var(--surface)",
        }}
      >
        <option value="utc">UTC (source zone)</option>
        <option value="local">
          This device (
          {zone === "UTC" && zoneChoice === "local" ? "UTC" : "local"})
        </option>
      </select>
    </label>
  );

  return (
    <div className="shell">
      <nav className="nav" aria-label="Workspace">
        <div className="nav-brand">
          <strong>{name}</strong>
          <span>{scope} workspace</span>
        </div>
        <ul className="nav-links">
          <li>
            <Link
              className="nav-link"
              href="/"
              aria-current={isHome ? "page" : undefined}
            >
              Work Home
            </Link>
          </li>
        </ul>
        <div className="nav-foot">
          {zoneToggle}
          {mode === "mock" ? (
            <span>Demonstration data (mock service)</span>
          ) : null}
        </div>
      </nav>
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <div className="topbar-brand">
            <strong>{name}</strong>
            <span>
              {scope} workspace{mode === "mock" ? " · demonstration data" : ""}
            </span>
          </div>
          {isHome ? null : (
            <Link className="btn btn-sm" href="/">
              Work Home
            </Link>
          )}
        </header>
        <main className="main" id="main">
          <div className="content">{children}</div>
        </main>
      </div>
    </div>
  );
}
