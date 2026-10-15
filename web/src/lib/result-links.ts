import type { components } from "../../../contracts/src/client";
import { scopedHref } from "./scope";

type S = components["schemas"];

/** What a message's result link opens, in plain words. */
export const RESULT_NAME: Record<S["ProductResult"]["kind"], string> = {
  table: "table",
  tool: "tool",
  file: "file",
  document: "document",
  structured_table: "table",
  custom_view: "interactive view",
};

/** What is known now about the work a message's result points at. */
export interface ResultState {
  current_revision_id: string;
  proposal?: Pick<
    S["Proposal"],
    "id" | "status" | "base_revision_id" | "accepted_revision_id"
  > | null;
}

export interface ResultLink {
  label: string;
  href: string;
  /** A short fact beside the link, e.g. that the work changed since. */
  note?: string;
  /** Where the work stands now, when the link opens an earlier version. */
  current?: { label: string; href: string };
}

/**
 * A message's result link, labelled from what the records say now rather
 * than from when the message was written: a proposal can since have been
 * applied or dismissed, and saved work can have been edited since. An
 * earlier version opens in the work's saved history, never as if current.
 * Who changed the work is shown there, from the revisions themselves.
 * Links name the workspace the work lives in, when given.
 */
export function resultLink(
  base: string,
  product: Pick<
    S["ProductResult"],
    "artifact_id" | "kind" | "proposal_id" | "revision_id"
  >,
  state: ResultState | null | undefined,
  ws?: string | null,
): ResultLink {
  const link = unscopedLink(base, product, state);
  return {
    ...link,
    href: scopedHref(link.href, ws),
    ...(link.current
      ? {
          current: {
            ...link.current,
            href: scopedHref(link.current.href, ws),
          },
        }
      : {}),
  };
}

function unscopedLink(
  base: string,
  product: Pick<
    S["ProductResult"],
    "artifact_id" | "kind" | "proposal_id" | "revision_id"
  >,
  state: ResultState | null | undefined,
): ResultLink {
  const name = RESULT_NAME[product.kind] ?? "work";
  const work = `${base}/artifacts/${product.artifact_id}`;
  const version = (rid: string) =>
    `${work}?revision=${encodeURIComponent(rid)}`;
  const openCurrent = { label: `Open current ${name}`, href: work };
  // Not read yet (or unreadable): open the work without claiming its state.
  if (!state) return { label: `Open ${name}`, href: work };
  const current = state.current_revision_id;
  if (product.proposal_id) {
    const p = state.proposal;
    if (!p || p.id !== product.proposal_id)
      return { label: `Open ${name}`, href: work };
    if (p.status === "pending")
      return p.base_revision_id === current
        ? { label: `Review proposed change to the ${name}`, href: work }
        : {
            label: `Open ${name}`,
            href: work,
            note: "The proposed change is out of date: the work was saved since.",
          };
    if (p.status === "dismissed")
      return {
        label: `Open current ${name}`,
        href: work,
        note: "This proposed change was dismissed.",
      };
    const accepted = p.accepted_revision_id;
    if (!accepted || accepted === current)
      return {
        label: `Open ${name}`,
        href: work,
        note: "This change was applied and is the current version.",
      };
    return {
      label: "Open the applied version",
      href: version(accepted),
      note: "Applied, then changed since.",
      current: openCurrent,
    };
  }
  if (product.revision_id && product.revision_id !== current)
    return {
      label: "Open this version",
      href: version(product.revision_id),
      note: "Changed since.",
      current: openCurrent,
    };
  return { label: `Open ${name}`, href: work };
}
