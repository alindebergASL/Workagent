"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useWorkspace } from "@/lib/client/workspace";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { EXECUTION } from "@/lib/execution";

function Mark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="26" height="26" rx="8" fill="currentColor" />
      <path
        d="M9 11l3 10 4-7 4 7 3-10"
        fill="none"
        stroke="var(--brand-stroke)"
        strokeWidth="2"
      />
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { workspace, workspaces, zoneChoice, setZoneChoice } = useWorkspace();
  const pathname = usePathname();
  const onAgent = pathname === "/" || pathname.startsWith("/assignments");
  const onSpaces = pathname.startsWith("/spaces");
  const onConversations = pathname.startsWith("/conversations");
  const onActivity = pathname.startsWith("/activity");

  const nav = (
    <>
      <li>
        <Link
          className="nav-link"
          href="/"
          aria-current={onAgent ? "page" : undefined}
        >
          Agent
        </Link>
      </li>
      <li>
        <Link
          className="nav-link"
          href="/spaces"
          aria-current={onSpaces ? "page" : undefined}
        >
          Spaces
        </Link>
      </li>
      <li>
        <Link
          className="nav-link"
          href="/activity"
          aria-current={onActivity ? "page" : undefined}
        >
          Activity
        </Link>
      </li>
      {CAPABILITIES.conversation ? (
        <li>
          <Link
            className="nav-link"
            href="/conversations"
            aria-current={onConversations ? "page" : undefined}
          >
            Conversations
          </Link>
        </li>
      ) : null}
    </>
  );

  return (
    <div className="shell">
      <nav className="rail" aria-label="Workspace">
        <Link href="/" className="brand">
          <Mark />
          <span>workagent</span>
        </Link>
        <ul className="nav-links">{nav}</ul>
        {workspaces.length ? (
          <div className="rail-spaces">
            <h2 className="rail-heading">Your spaces</h2>
            <ul className="nav-links">
              {workspaces.map((w) => {
                const href = `/spaces/${encodeURIComponent(w.id)}`;
                return (
                  <li key={w.id}>
                    <Link
                      className="nav-link nav-link-sm"
                      href={href}
                      aria-current={pathname === href ? "page" : undefined}
                    >
                      {w.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <div className="rail-foot">
          <span>
            {workspace
              ? `${workspace.kind === "personal" ? "Personal" : "Shared"} · Private`
              : "Private"}
          </span>
          <label className="zone">
            <span>Times in</span>
            <select
              aria-label="Time zone for displayed times"
              value={zoneChoice}
              onChange={(e) => setZoneChoice(e.target.value as "utc" | "local")}
            >
              <option value="utc">UTC</option>
              <option value="local">This device</option>
            </select>
          </label>
        </div>
      </nav>
      <div className="frame">
        <header className="topbar">
          <Link href="/" className="brand">
            <Mark />
            <span>workagent</span>
          </Link>
          <ul className="topbar-nav">{nav}</ul>
        </header>
        <main className="main" id="main">
          <div className="content">{children}</div>
        </main>
        <footer className="mode-line" aria-label="How work runs here">
          {EXECUTION.line}
        </footer>
      </div>
    </div>
  );
}
