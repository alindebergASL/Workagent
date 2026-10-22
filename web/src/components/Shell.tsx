"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { useWorkspace } from "@/lib/client/workspace";
import { API_MODE } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { areaHref, workAreas } from "@/lib/client/work-areas";
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

const ICONS = {
  agent: "M4 11.5L12 5l8 6.5V19a1 1 0 01-1 1h-4.5v-5.5h-5V20H5a1 1 0 01-1-1z",
  spaces:
    "M4 7a2 2 0 012-2h3.5l2 2H18a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z",
  conversations:
    "M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1h-8l-4.5 3.5V16H5a1 1 0 01-1-1V6a1 1 0 011-1z",
};

/**
 * A build that shows example content says so on every page. Set explicitly
 * (NEXT_PUBLIC_WORKAGENT_DEMO_MODE=1); never inferred from what's on screen.
 */
// NEXT_PUBLIC_WORKAGENT_DEMO is the earlier name of the same flag.
const DEMONSTRATION =
  process.env["NEXT_PUBLIC_WORKAGENT_DEMO_MODE"] === "1" ||
  process.env["NEXT_PUBLIC_WORKAGENT_DEMO"] === "1";

export function Shell({ children }: { children: ReactNode }) {
  const { workspaces } = useWorkspace();
  const pathname = usePathname();
  const onAgent = pathname === "/" || pathname.startsWith("/assignments");
  const onSpaces = pathname.startsWith("/spaces");
  const onConversations = pathname.startsWith("/conversations");
  const onActivity = pathname.startsWith("/activity");
  // Inside one conversation the reply box takes the bottom of a phone
  // screen, so the tab bar steps aside there (the page links back).
  const inConversation = /^\/conversations\/[^/]+\/?$/.test(pathname);

  // Activity & details is a secondary destination: ordinary work never
  // needs it, so it lives in the sidebar foot and the phone "More" menu.
  const more = useRef<HTMLDetailsElement>(null);
  const activityLink = (className: string, onClick?: () => void) => (
    <Link
      className={className}
      href="/activity"
      aria-current={onActivity ? "page" : undefined}
      onClick={onClick}
    >
      Activity &amp; details
    </Link>
  );

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

  // On a phone the destinations sit at the bottom, within thumb reach.
  const tabs = [
    { href: "/", label: "Agent", current: onAgent, icon: ICONS.agent },
    { href: "/spaces", label: "Spaces", current: onSpaces, icon: ICONS.spaces },
    ...(CAPABILITIES.conversation
      ? [
          {
            href: "/conversations",
            label: "Conversations",
            current: onConversations,
            icon: ICONS.conversations,
          },
        ]
      : []),
  ];

  return (
    <div className="shell" data-tabbar={inConversation ? undefined : ""}>
      <nav className="rail" aria-label="Workspace">
        <Link href="/" className="brand">
          <Mark />
          <span>workagent</span>
        </Link>
        <ul className="nav-links">{nav}</ul>
        {API_MODE === "real" ? (
          <YourWork spaces={workspaces} pathname={pathname} />
        ) : null}
        <div className="rail-foot">
          {activityLink("nav-link nav-link-sm rail-secondary")}
        </div>
      </nav>
      <div className="frame">
        <header className="topbar">
          <Link href="/" className="brand">
            <Mark />
            <span>workagent</span>
          </Link>
          <ul className="topbar-nav">{nav}</ul>
          <details className="topbar-more" ref={more}>
            <summary>More</summary>
            <div className="topbar-more-panel">
              {activityLink("nav-link", () => {
                if (more.current) more.current.open = false;
              })}
            </div>
          </details>
        </header>
        <main className="main" id="main">
          {DEMONSTRATION ? (
            <p className="demo-banner" role="note" data-testid="demo-banner">
              <strong>Demonstration.</strong> The projects and work shown here
              are made-up examples, not anyone’s real work.
            </p>
          ) : null}
          <div className="content">{children}</div>
        </main>
        <footer className="mode-line" aria-label="How work runs here">
          {EXECUTION.line}
        </footer>
      </div>
      {inConversation ? null : (
        <nav className="tabbar" aria-label="Main">
          <ul>
            {tabs.map((t) => (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={t.current ? "page" : undefined}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="22"
                    height="22"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d={t.icon}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{t.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

/**
 * The person's most recently changed projects, whichever workspace holds
 * them, so current work is one click from anywhere. A workspace that can't
 * be read just isn't listed here; Spaces says so.
 */
function YourWork({
  spaces,
  pathname,
}: {
  spaces: { id: string }[];
  pathname: string;
}) {
  const key = spaces.map((w) => w.id).join(",");
  const res = useResource(key ? `rail-work:${key}` : null, async (signal) => {
    const read = await Promise.allSettled(
      spaces.map((w) => workAreas.list(w.id, signal)),
    );
    return read
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter((cv) => cv.state !== "cancelled")
      .sort(
        (a, b) =>
          Date.parse(b.updated_at ?? b.created_at ?? "") -
          Date.parse(a.updated_at ?? a.created_at ?? ""),
      )
      .slice(0, 6);
  });
  if (!res.data?.length) return null;
  return (
    <div className="rail-spaces">
      <h2 className="rail-heading">Your work</h2>
      <ul className="nav-links" data-testid="your-work">
        {res.data.map((cv) => {
          const href = areaHref(cv.workspace_id, cv.id);
          return (
            <li key={cv.id}>
              <Link
                className="nav-link nav-link-sm"
                href={href}
                aria-current={pathname === href ? "page" : undefined}
              >
                {cv.work_area?.title ?? cv.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
