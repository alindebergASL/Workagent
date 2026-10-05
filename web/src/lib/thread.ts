import type { Proposal, Revision } from "./contract/types";

/**
 * The conversation beside a piece of work, built only from recorded state:
 * the person's request, what the agent saved, each change the person asked
 * for (a proposal's `reason` is the person's own instruction), its outcome,
 * and the person's own edits. Nothing is invented or paraphrased as a reply.
 */
export interface ThreadEntry {
  id: string;
  who: "person" | "agent" | "event";
  at: string;
  text: string;
  /** Present on an agent turn that waits on the person. */
  waiting?: boolean;
}

export function threadFrom(input: {
  goal: string | null;
  goalAt: string;
  title: string;
  revisions: Revision[];
  proposals: Proposal[];
}): ThreadEntry[] {
  const { revisions, title } = input;
  const out: { entry: ThreadEntry; order: number }[] = [];
  let order = 0;
  const push = (entry: ThreadEntry) => out.push({ entry, order: order++ });

  const fromProposal = new Set(
    input.proposals.map((p) => p.resolved_by_revision_id).filter(Boolean),
  );
  const sorted = [...revisions].sort((a, b) => a.sequence - b.sequence);
  for (const r of sorted) {
    if (fromProposal.has(r.id)) continue;
    if (r.author.kind === "human")
      push({
        id: `rev:${r.id}`,
        who: "event",
        at: r.created_at,
        text: `You saved your edits as revision ${r.sequence}.`,
      });
    else
      push({
        id: `rev:${r.id}`,
        who: "agent",
        at: r.created_at,
        text:
          r.sequence === 1
            ? `I prepared the ${title.toLowerCase()}. Edit anything, or ask me for a change.`
            : `I saved a new version as revision ${r.sequence}.`,
      });
  }

  for (const p of [...input.proposals].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )) {
    push({
      id: `ask:${p.id}`,
      who: "person",
      at: p.created_at,
      text: p.reason,
    });
    const resolved = revisions.find((r) => r.id === p.resolved_by_revision_id);
    switch (p.status) {
      case "generating":
        push({
          id: `reply:${p.id}`,
          who: "agent",
          at: p.created_at,
          text: "I’m drafting this change. It will wait for your review.",
        });
        break;
      case "proposed":
        push({
          id: `reply:${p.id}`,
          who: "agent",
          at: p.updated_at || p.created_at,
          text: "I’ve proposed this change. Nothing is applied until you decide.",
          waiting: true,
        });
        break;
      case "conflicted":
        push({
          id: `reply:${p.id}`,
          who: "agent",
          at: p.updated_at || p.created_at,
          text: "I proposed this change, but your page has changed since. Your edits are kept; review it against your current version.",
          waiting: true,
        });
        break;
      case "accepted":
        push({
          id: `reply:${p.id}`,
          who: "agent",
          at: p.created_at,
          text: "I proposed this change.",
        });
        push({
          id: `done:${p.id}`,
          who: "event",
          at: resolved?.created_at ?? p.updated_at ?? p.created_at,
          text: resolved
            ? `You applied it as revision ${resolved.sequence}.`
            : "You applied it.",
        });
        break;
      case "declined":
        push({
          id: `reply:${p.id}`,
          who: "agent",
          at: p.created_at,
          text: "I proposed this change.",
        });
        push({
          id: `done:${p.id}`,
          who: "event",
          at: p.updated_at || p.created_at,
          text: "You kept your version. The proposal stays in history.",
        });
        break;
      case "superseded":
        push({
          id: `done:${p.id}`,
          who: "event",
          at: p.updated_at || p.created_at,
          text: "A newer request replaced this one.",
        });
        break;
    }
  }

  // The request always opens the thread; the rest is chronological, and
  // entries recorded at the same moment keep their causal order.
  const rest = out
    .sort((a, b) => a.entry.at.localeCompare(b.entry.at) || a.order - b.order)
    .map((x) => x.entry);
  return input.goal
    ? [
        { id: "goal", who: "person", at: input.goalAt, text: input.goal },
        ...rest,
      ]
    : rest;
}
