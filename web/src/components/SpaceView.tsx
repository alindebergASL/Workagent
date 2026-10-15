"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { useResource } from "@/lib/client/hooks";
import { productApi, isProduct } from "@/lib/client/products";
import { conversationApi } from "@/lib/client/real-api";
import { useHolds } from "@/lib/client/responsibility";
import { useWorkspace } from "@/lib/client/workspace";
import type { ConversationDetailView } from "@/lib/contract/types";
import type { ExactTarget } from "@/lib/contract/natural";
import { isFlexible } from "@/lib/flexible";
import { formatTime } from "@/lib/time";
import {
  leadWork,
  proposalSummary,
  spaceStanding,
  workHref,
  workKind,
  workTitle,
  type SpaceWorkItem,
  type StandingLine,
} from "@/lib/space-view";
import { ConversationPeek } from "./ConversationPeek";
import { ReadOnly } from "./FlexibleWork";
import { ProductView } from "./ProductView";
import { SpaceDetails } from "./WorkAreas";
import { WorkSurface } from "./WorkSurface";
import { ErrorNotice } from "./ui";
import "./SpaceWork.css";

type Turn = ConversationDetailView["turns"][number];
const awaiting = (t: Turn) =>
  t.state === "queued" ||
  t.state === "responding" ||
  t.state === "unavailable" ||
  t.state === "outcome_unknown";

/** `?work=` names the selected work; `none` means the project as a whole. */
const NONE = "none";

/**
 * A project or workflow Space: what it is for, where it stands, its work,
 * and one conversation beside it. Everything shown is read from the
 * project's own records; a reply is about the work selected here (its
 * exact saved version) or, with nothing selected, about the project.
 */
export function SpaceView({ ws, id }: { ws: string; id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { zone } = useWorkspace();
  const res = useResource<ConversationDetailView>(
    `space:${ws}:${id}`,
    (signal) => conversationApi.get(ws, id, signal, true),
    { pollMs: 2000, shouldPoll: (d) => Boolean(d?.turns.some(awaiting)) },
  );
  const d = res.data;
  const ids = d?.artifact_ids ?? [];
  const idsKey = ids.join(",");
  const work = useResource<SpaceWorkItem[]>(
    d ? `space-work:${ws}:${id}:${idsKey}` : null,
    (signal) =>
      Promise.all(
        ids.map(async (aid) => {
          const [artifact, proposals] = await Promise.all([
            productApi.get(ws, aid, signal),
            productApi.proposals(ws, aid, signal),
          ]);
          return {
            artifact,
            pending: proposals.filter((p) => p.status === "pending"),
          };
        }),
      ),
  );
  const { holds } = useHolds(ws, d?.assignment_ids ?? []);
  const refreshWork = work.refresh;
  const refreshConversation = res.refresh;
  const refreshAll = useCallback(
    () => Promise.all([refreshConversation(), refreshWork()]),
    [refreshConversation, refreshWork],
  );

  const items = work.data ?? null;
  const param = search.get("work");
  const lead = items ? leadWork(items) : null;
  const selected =
    param === NONE
      ? null
      : ((items ?? []).find((i) => i.artifact.id === param) ?? lead);
  const select = (aid: string | null) => {
    const next = new URLSearchParams(search.toString());
    next.set("work", aid ?? NONE);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const [focusAgent, setFocusAgent] = useState(0);

  // On a phone, "Ask about this" switches to the conversation and puts the
  // cursor in the reply box; on a wide screen it only moves focus. The box
  // can take focus only once its pane is shown, so try for a few frames.
  const askAbout = (aid: string | null) => {
    select(aid);
    setFocusAgent((n) => n + 1);
  };
  useEffect(() => {
    if (!focusAgent) return;
    let frames = 0;
    let handle = 0;
    const tryFocus = () => {
      const box = document.getElementById("peek-reply");
      box?.focus();
      if (document.activeElement !== box && ++frames < 10)
        handle = requestAnimationFrame(tryFocus);
    };
    handle = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(handle);
  }, [focusAgent]);

  const revoked =
    res.error?.code === "not_found_or_not_authorized" ||
    res.error?.code === "unauthenticated";
  if (revoked && !d)
    return (
      <div className="agent-col stack">
        <Link className="back-link" href="/spaces">
          ← Spaces
        </Link>
        <p role="status" className="notice-line">
          This project isn’t available to you. It may have been removed, or you
          may no longer have access.
        </p>
      </div>
    );
  if (!d)
    return (
      <div className="agent-col stack">
        {res.error ? (
          <ErrorNotice error={res.error} />
        ) : (
          <p role="status">Opening the project…</p>
        )}
      </div>
    );

  const area = d.conversation.work_area;
  const standing = spaceStanding({
    detail: d,
    work: items,
    workUnreadable: Boolean(work.error),
    holds,
  });
  const target: ExactTarget | null | undefined = CAPABILITIES.naturalAdmission
    ? selected
      ? {
          artifact_id: selected.artifact.id,
          revision_id: selected.artifact.current_revision_id,
          body_hash: selected.artifact.current_revision.body_hash,
        }
      : null
    : undefined;
  const titleOf = (aid: string) => {
    const item = items?.find((i) => i.artifact.id === aid);
    return item ? workTitle(item.artifact) : "earlier work";
  };

  const workPane = (
    <div className="stack space-view">
      <Standing standing={standing} />
      <section className="stack-sm" aria-labelledby="space-work-heading">
        <div className="row wrap">
          <h2 id="space-work-heading">Work in this project</h2>
          <button
            type="button"
            className="link-quiet small"
            aria-label="Refresh this project"
            onClick={() => void refreshAll()}
          >
            Refresh
          </button>
        </div>
        {work.error && !items ? (
          <p role="status" className="notice-line">
            Couldn’t read this project’s work right now.{" "}
            <button
              type="button"
              className="link-quiet"
              onClick={() => void refreshWork()}
            >
              Try again
            </button>
          </p>
        ) : null}
        {work.reconnecting ? (
          <p role="status" className="small muted">
            Showing the work as last read; can’t re-check it right now.
          </p>
        ) : null}
        {ids.length && !items && !work.error ? (
          <p role="status" className="small muted">
            Reading the project’s work…
          </p>
        ) : null}
        {items && items.length ? (
          <ul className="space-work-list">
            {items.map((item) => {
              const on = selected?.artifact.id === item.artifact.id;
              return (
                <li key={item.artifact.id}>
                  <button
                    type="button"
                    className="space-work-item"
                    aria-pressed={on}
                    data-artifact={item.artifact.id}
                    onClick={() => select(item.artifact.id)}
                  >
                    <strong>{workTitle(item.artifact)}</strong>
                    <span className="small muted">
                      {workKind(item.artifact)} · changed{" "}
                      {formatTime(
                        item.artifact.current_revision.created_at,
                        zone,
                      )}
                      {item.artifact.current_revision.author_kind === "human"
                        ? " by you"
                        : " by Workagent"}
                    </span>
                    {item.pending.length ? (
                      <span className="badge status-attention">
                        {item.pending.length === 1
                          ? "Change to review"
                          : `${item.pending.length} changes to review`}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : items && !ids.length ? (
          <p className="muted">
            Nothing saved yet. What Workagent makes for this project shows up
            here, ready to read and edit.
          </p>
        ) : null}
      </section>
      {selected ? (
        <SelectedWork
          cid={id}
          item={selected}
          onAsk={() => askAbout(selected.artifact.id)}
        />
      ) : null}
      <Ongoing standing={standing} />
    </div>
  );

  const agent = (
    <ConversationPeek
      conversation={d}
      artifactId={selected?.artifact.id}
      wsId={ws}
      refreshWork={refreshAll}
      target={target}
      eyebrow="Conversation"
      compact
      held={res.reconnecting || Boolean(res.error)}
      placeholder="Ask, or ask for a change…"
      idleHint={
        selected
          ? "Your message is about the selected work’s saved version."
          : "Your message is about the project as a whole."
      }
      about={(pending) => {
        // An unconfirmed send keeps what it was about; show that, not the
        // current selection, until it resolves.
        const shown =
          pending !== undefined
            ? pending
              ? titleOf(pending.artifact_id)
              : null
            : target === undefined
              ? undefined
              : selected
                ? workTitle(selected.artifact)
                : null;
        if (shown === undefined) return null;
        return (
          <p className="reply-about small" data-testid="reply-about">
            <span className="muted">About:</span>{" "}
            <strong>{shown ?? "the whole project"}</strong>
            {pending === undefined && selected ? (
              <button
                type="button"
                className="link-quiet small"
                aria-label={`Stop replying about ${workTitle(selected.artifact)}`}
                onClick={() => select(null)}
              >
                Ask about the whole project instead
              </button>
            ) : null}
          </p>
        );
      }}
    />
  );

  return (
    <div className="space-page stack">
      <Link className="back-link" href="/spaces">
        ← Spaces
      </Link>
      <SpaceDetails
        ws={ws}
        id={id}
        area={area ?? null}
        title={d.conversation.title}
        version={d.conversation.work_version}
        open={d.conversation.state === "open"}
        refresh={res.refresh}
      />
      {res.reconnecting || (res.error && !revoked) ? (
        <p className="notice-line" role="status" data-state="reconnecting">
          Can’t reach the project right now. Showing what was last read; sending
          waits until it reconnects. Your drafts are kept.
        </p>
      ) : null}
      <WorkSurface document={workPane} agent={agent} focusAgent={focusAgent} />
    </div>
  );
}

function Line({ line }: { line: StandingLine }) {
  return (
    <li data-tone={line.tone}>
      {line.href ? <Link href={line.href}>{line.text}</Link> : line.text}
      {line.detail ? <span className="small muted"> {line.detail}</span> : null}
    </li>
  );
}

function LineAction({ line }: { line: StandingLine }) {
  return line.href ? (
    <Link className="btn btn-sm" href={line.href}>
      {line.action ?? "Open"}
    </Link>
  ) : null;
}

/** Where the project stands: the one next step, then anything else that needs the person. */
function Standing({
  standing,
}: {
  standing: ReturnType<typeof spaceStanding>;
}) {
  const rest = standing.needs.filter((l) => l.key !== standing.next.key);
  return (
    <section
      className="card stack-sm space-standing"
      aria-labelledby="space-standing-heading"
      data-tone={standing.next.tone}
    >
      <h2 id="space-standing-heading" className="eyebrow-caps">
        Next
      </h2>
      <p className="space-next" data-testid="space-next">
        {standing.next.text}
      </p>
      {standing.next.detail ? (
        <p className="small muted">{standing.next.detail}</p>
      ) : null}
      <LineAction line={standing.next} />
      {rest.length ? (
        <>
          <h3 className="small">Also needs you</h3>
          <ul className="space-lines">
            {rest.map((l) => (
              <Line key={l.key} line={l} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** Ongoing responsibilities and work underway that need nothing right now. */
function Ongoing({ standing }: { standing: ReturnType<typeof spaceStanding> }) {
  if (!standing.underway.length) return null;
  return (
    <section className="stack-sm" aria-labelledby="space-ongoing-heading">
      <h2 id="space-ongoing-heading">Underway</h2>
      <ul className="space-lines">
        {standing.underway.map((l) => (
          <Line key={l.key} line={l} />
        ))}
      </ul>
    </section>
  );
}

/** The selected work's current saved version, read-only, with its real controls a step away. */
function SelectedWork({
  cid,
  item,
  onAsk,
}: {
  cid: string;
  item: SpaceWorkItem;
  onAsk: () => void;
}) {
  const body = item.artifact.current_revision.body;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownId = item.artifact.id;
  const first = useRef(true);
  // Moving to another piece of work announces it to assistive technology
  // without stealing focus on the first render.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [shownId]);
  const title = workTitle(item.artifact);
  const preview = useMemo(
    () =>
      isProduct(body) ? (
        <ProductView body={body} />
      ) : isFlexible(body) ? (
        <ReadOnly body={body} />
      ) : (
        <p className="muted">This kind of work opens in its own page.</p>
      ),
    [body],
  );
  return (
    <article
      className="card stack-sm space-work"
      aria-labelledby="space-selected-heading"
      data-artifact-id={item.artifact.id}
      data-revision-id={item.artifact.current_revision_id}
    >
      <h2 id="space-selected-heading" tabIndex={-1} ref={headingRef}>
        {title}
      </h2>
      <p className="small muted">
        {workKind(item.artifact)} · saved version{" "}
        {item.artifact.current_revision.revision_number}
      </p>
      <div className="row wrap">
        <Link className="btn btn-sm" href={workHref(cid, item.artifact.id)}>
          {item.pending.length ? "Review and edit" : "Open to edit"}
        </Link>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onAsk}>
          Ask about this
        </button>
      </div>
      {item.pending.length ? (
        <div className="notice-line space-proposal" role="note">
          <p>
            <strong>
              {item.pending.length === 1
                ? "A proposed change is waiting for your review."
                : `${item.pending.length} proposed changes are waiting for your review.`}
            </strong>{" "}
            {item.pending.length === 1
              ? proposalSummary(
                  item.artifact.current_revision.body,
                  item.pending[0]!.body,
                )
              : null}
          </p>
          <p className="small muted">
            Shown below is the saved version; the change applies only if you
            accept it.
          </p>
        </div>
      ) : null}
      {preview}
    </article>
  );
}
