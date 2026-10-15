"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { useResource } from "@/lib/client/hooks";
import { productApi, isProduct } from "@/lib/client/products";
import { conversationApi } from "@/lib/client/real-api";
import { useHolds } from "@/lib/client/responsibility";
import { useCurrentWorkspace, useScopedHref } from "@/lib/client/workspace";
import type { ConversationDetailView } from "@/lib/contract/types";
import type { ExactTarget } from "@/lib/contract/natural";
import { isFlexible } from "@/lib/flexible";
import { formatTime } from "@/lib/time";
import {
  actionable,
  canAskAbout,
  outdated,
  proposalSummary,
  spaceStanding,
  workHref,
  workKind,
  workTitle,
  type SpaceWorkItem,
  type StandingLine,
} from "@/lib/space-view";
import { ConversationPeek } from "./ConversationPeek";
import { InPlaceView, ReadOnly, type Bound } from "./FlexibleWork";
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

/** `?work=` names the work the person chose; absent, the project as a whole. */

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
  const { zone } = useCurrentWorkspace();
  const res = useResource<ConversationDetailView>(
    `space:${ws}:${id}`,
    (signal) => conversationApi.get(ws, id, signal, true),
    { pollMs: 2000, shouldPoll: (d) => Boolean(d?.turns.some(awaiting)) },
  );
  const d = res.data;
  const ids = d?.artifact_ids ?? [];
  const idsKey = ids.join(",");
  // Work is re-read from its own records too: a save or an accepted change
  // elsewhere moves a work's version without changing the conversation's.
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
    { pollMs: 20000 },
  );
  const { holds } = useHolds(ws, d?.assignment_ids ?? []);
  const refreshWork = work.refresh;
  const refreshConversation = res.refresh;
  const refreshAll = useCallback(
    () => Promise.all([refreshConversation(), refreshWork()]),
    [refreshConversation, refreshWork],
  );

  const items = work.data ?? null;
  // Only the person's own choice names the work a reply is about; nothing
  // is selected for them. With nothing chosen, a reply is about the project.
  const param = search.get("work");
  const resolved = (items ?? []).find((i) => i.artifact.id === param) ?? null;
  // A choice stays the person's while its work is being re-read (a changed
  // list of work re-reads it from scratch): it is shown as last read, and
  // sending waits for it. Missing data never reads as "the whole project".
  const [remembered, setRemembered] = useState<SpaceWorkItem | null>(null);
  useEffect(() => {
    if (resolved) setRemembered(resolved);
  }, [resolved]);
  // A refusal to re-read the work (removed, or access withdrawn) ends what was
  // last shown: nothing of it stays on screen, though the choice is kept.
  const workDenied =
    work.error?.code === "not_found_or_not_authorized" ||
    work.error?.code === "unauthenticated";
  const selected =
    resolved ??
    (param && !workDenied && remembered?.artifact.id === param
      ? remembered
      : null);
  const choiceUnavailable = Boolean(param) && !resolved && workDenied;
  const choiceChecking =
    Boolean(param) && !resolved && items === null && !workDenied;
  const choiceGone = Boolean(param) && !resolved && items !== null;
  const select = (aid: string | null) => {
    const next = new URLSearchParams(search.toString());
    if (aid) next.set("work", aid);
    else next.delete("work");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
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
  // A reply names only work the person chose and the service accepts as a
  // subject; anything else (a saved file) leaves it about the project.
  const subject = resolved && canAskAbout(resolved.artifact) ? resolved : null;
  const target: ExactTarget | null | undefined = CAPABILITIES.naturalAdmission
    ? subject
      ? {
          artifact_id: subject.artifact.id,
          revision_id: subject.artifact.current_revision_id,
          body_hash: subject.artifact.current_revision.body_hash,
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
            {workDenied
              ? "Some of this project’s work isn’t available to you any more. It may have been removed, or your access changed."
              : "Couldn’t read this project’s work right now."}{" "}
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
                    id={`space-item-${item.artifact.id}`}
                    aria-pressed={on}
                    aria-controls={on ? "space-selected" : undefined}
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
                    {actionable(item).length ? (
                      <span className="badge status-attention">
                        {actionable(item).length === 1
                          ? "Change to review"
                          : `${actionable(item).length} changes to review`}
                      </span>
                    ) : outdated(item).length ? (
                      <span className="badge">Outdated proposal</span>
                    ) : null}
                  </button>
                  {on && selected ? (
                    <SelectedWork
                      inline
                      ws={ws}
                      cid={id}
                      item={selected}
                      items={items}
                      open={d.conversation.state === "open"}
                      refresh={refreshAll}
                      onSelect={select}
                      onAsk={
                        canAskAbout(selected.artifact)
                          ? () => askAbout(selected.artifact.id)
                          : undefined
                      }
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {items && items.length && !selected && !param ? (
          <p className="small muted" data-testid="choose-work">
            Choose one to read it here and to ask about it. Until you do, a
            message is about the project as a whole.
          </p>
        ) : items && items.length && choiceGone ? (
          <p className="small muted" data-testid="choose-work">
            The work you chose isn’t in this project any more. Choose one, or
            ask about the whole project.
          </p>
        ) : items && !ids.length ? (
          <p className="muted">
            Nothing saved yet. What Workagent makes for this project shows up
            here, ready to read and edit.
          </p>
        ) : null}
      </section>
      {choiceUnavailable ? (
        <p
          role="status"
          className="notice-line"
          data-testid="chosen-unavailable"
        >
          The work you chose isn’t available to you now. Your draft is kept.
        </p>
      ) : null}
      {/* Shown on its own only while the list is being re-read (the choice
          is kept, as last read); otherwise it opens in place in the list. */}
      {selected &&
      !items?.some((i) => i.artifact.id === selected.artifact.id) ? (
        <SelectedWork
          ws={ws}
          cid={id}
          item={selected}
          items={items ?? []}
          open={d.conversation.state === "open"}
          refresh={refreshAll}
          onSelect={select}
          onAsk={
            canAskAbout(selected.artifact)
              ? () => askAbout(selected.artifact.id)
              : undefined
          }
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
      paused={
        choiceChecking
          ? "Checking the work you chose before sending. Your draft is kept."
          : choiceUnavailable
            ? "The work you chose isn’t available to you now. Choose again, or ask about the whole project. Your draft is kept."
            : choiceGone
              ? "The work you chose isn’t in this project any more. Choose again, or ask about the whole project."
              : undefined
      }
      placeholder="Ask, or ask for a change…"
      idleHint={
        subject
          ? "Your message is about the selected work’s saved version."
          : param && !resolved
            ? "Sending waits until the work you chose is confirmed."
            : resolved
              ? "This kind of work can’t be a reply’s subject, so your message goes to the project."
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
              : subject
                ? workTitle(subject.artifact)
                : param && !resolved
                  ? selected
                    ? workTitle(selected.artifact)
                    : "the work you chose"
                  : null;
        if (shown === undefined) return null;
        return (
          <div className="reply-about small" data-testid="reply-about">
            <p>
              <span className="muted">About:</span>{" "}
              <strong>{shown ?? "the whole project"}</strong>
              {pending === undefined &&
              (subject || choiceGone || choiceUnavailable) ? (
                <button
                  type="button"
                  className="link-quiet small"
                  aria-label={
                    subject
                      ? `Stop replying about ${workTitle(subject.artifact)}`
                      : "Ask about the whole project instead"
                  }
                  onClick={() => select(null)}
                >
                  Ask about the whole project instead
                </button>
              ) : null}
            </p>
            {pending === undefined && resolved && !subject ? (
              <p className="muted" data-testid="reply-about-file">
                A reply can’t point at a saved file like “
                {workTitle(resolved.artifact)}”, so it goes to the project; name
                the file in your message.
              </p>
            ) : null}
          </div>
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
  const inScope = useScopedHref();
  return (
    <li data-tone={line.tone}>
      {line.href ? (
        <Link href={inScope(line.href)}>{line.text}</Link>
      ) : (
        line.text
      )}
      {line.detail ? <span className="small muted"> {line.detail}</span> : null}
    </li>
  );
}

function LineAction({ line }: { line: StandingLine }) {
  const inScope = useScopedHref();
  return line.href ? (
    <Link className="btn btn-sm" href={inScope(line.href)}>
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
  ws,
  cid,
  item,
  items,
  open,
  refresh,
  onSelect,
  onAsk,
  inline = false,
}: {
  ws: string;
  cid: string;
  item: SpaceWorkItem;
  /** All of the project's work as last read: what this work reads, or is read by. */
  items: SpaceWorkItem[];
  open: boolean;
  refresh: () => Promise<unknown>;
  /** Choose another piece of this project's work, in place. */
  onSelect: (aid: string) => void;
  /** Absent when a reply can't name this kind of work. */
  onAsk?: () => void;
  /**
   * Opened in place under its own entry in the list, which already names it:
   * no second title, and focus stays where the person chose it.
   */
  inline?: boolean;
}) {
  const inScope = useScopedHref();
  const body = item.artifact.current_revision.body;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownId = item.artifact.id;
  const first = useRef(true);
  // Moving to another piece of work announces it to assistive technology
  // without stealing focus on the first render.
  useEffect(() => {
    if (first.current || inline) {
      first.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [shownId, inline]);
  const title = workTitle(item.artifact);
  const ready = actionable(item);
  const old = outdated(item);
  // An agent-made view reads other work of this project at exact versions;
  // other work may be read by such views. Both are said, and selectable here.
  const view =
    (body as { kind?: string }).kind === "custom_view"
      ? (body as { bindings?: { artifact_id: string }[] })
      : null;
  const byId = new Map(items.map((i) => [i.artifact.id, i]));
  const reads = (view?.bindings ?? []).map((b) => b.artifact_id);
  const usedBy = items
    .filter((i) =>
      (
        i.artifact.current_revision.body as {
          kind?: string;
          bindings?: { artifact_id: string }[];
        }
      ).bindings?.some((b) => b.artifact_id === item.artifact.id),
    )
    .map((i) => i.artifact.id);
  const bound: Bound = Object.fromEntries(
    reads.map((aid) => {
      const other = byId.get(aid);
      return [
        aid,
        other
          ? {
              revision_id: other.artifact.current_revision_id,
              body_hash: other.artifact.current_revision.body_hash,
              title: workTitle(other.artifact),
            }
          : null,
      ];
    }),
  );
  const boundKey = JSON.stringify(bound);
  const preview = useMemo(
    () =>
      view ? (
        <InPlaceView
          ws={ws}
          cid={cid}
          artifact={item.artifact}
          bound={JSON.parse(boundKey) as Bound}
          open={open}
          refresh={refresh}
        />
      ) : isProduct(body) ? (
        <ProductView body={body} />
      ) : isFlexible(body) ? (
        <ReadOnly body={body} />
      ) : (
        <p className="muted">This kind of work opens in its own page.</p>
      ),
    [body, boundKey, open, item.artifact],
  );
  const related = (label: string, ids: string[]) =>
    ids.length ? (
      <p className="small space-related" data-testid={`space-${label}`}>
        <span className="muted">{label === "reads" ? "Reads" : "Used by"}</span>{" "}
        {ids.map((aid, i) => {
          const other = byId.get(aid);
          return (
            <span key={aid}>
              {i ? ", " : ""}
              {other ? (
                <button
                  type="button"
                  className="link-quiet"
                  onClick={() => onSelect(aid)}
                >
                  {workTitle(other.artifact)}
                </button>
              ) : (
                "work that isn’t in this project"
              )}
            </span>
          );
        })}
      </p>
    ) : null;
  return (
    <article
      id={inline ? "space-selected" : undefined}
      className={`stack-sm space-work${inline ? " inline" : " card"}`}
      aria-labelledby={
        inline ? `space-item-${item.artifact.id}` : "space-selected-heading"
      }
      data-artifact-id={item.artifact.id}
      data-revision-id={item.artifact.current_revision_id}
    >
      {inline ? null : (
        <>
          <h2 id="space-selected-heading" tabIndex={-1} ref={headingRef}>
            {title}
          </h2>
          <p className="small muted">
            {workKind(item.artifact)} · saved version{" "}
            {item.artifact.current_revision.revision_number}
          </p>
        </>
      )}
      <div className="row wrap">
        <Link
          className="btn btn-sm"
          href={inScope(workHref(cid, item.artifact.id))}
        >
          {item.pending.length ? "Review and edit" : "Open to edit"}
        </Link>
        {onAsk ? (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={onAsk}
          >
            Ask about this
          </button>
        ) : null}
      </div>
      {related("reads", reads)}
      {related("used-by", usedBy)}
      {ready.length ? (
        <div className="notice-line space-proposal" role="note">
          <p>
            <strong>
              {ready.length === 1
                ? "A proposed change is waiting for your review."
                : `${ready.length} proposed changes are waiting for your review.`}
            </strong>{" "}
            {ready.length === 1
              ? proposalSummary(
                  item.artifact.current_revision.body,
                  ready[0]!.body,
                )
              : null}
          </p>
          <p className="small muted">
            Shown below is the saved version; the change applies only if you
            accept it.
          </p>
        </div>
      ) : null}
      {old.length ? (
        <div className="notice-line space-proposal-outdated" role="note">
          <p>
            {old.length === 1
              ? "A proposed change was made for an earlier version of this work, so it can’t be applied as is."
              : `${old.length} proposed changes were made for an earlier version of this work, so they can’t be applied as is.`}{" "}
            Open the work to dismiss it, or ask for the change again.
          </p>
        </div>
      ) : null}
      {preview}
    </article>
  );
}
