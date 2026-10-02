import type { Block } from "@/lib/contract/types";

export type DiffOp = { type: "same" | "added" | "removed"; block: Block };
export type DiffItem = DiffOp | { type: "gap"; count: number };

/** What counts as a change: the text, and for checklist items whether it's done. */
const lineKey = (b: Block) =>
  b.kind === "check_item" ? `${b.text}\u0000${b.checked ? 1 : 0}` : b.text;

/** Line-level diff of two block lists (text and checklist state), via LCS. Small inputs only. */
export function diffBlocks(current: Block[], proposed: Block[]): DiffOp[] {
  const a = current;
  const b = proposed;
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        lineKey(a[i]!) === lineKey(b[j]!)
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (lineKey(a[i]!) === lineKey(b[j]!)) {
      out.push({ type: "same", block: b[j]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ type: "removed", block: a[i]! });
      i++;
    } else {
      out.push({ type: "added", block: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: "removed", block: a[i++]! });
  while (j < m) out.push({ type: "added", block: b[j++]! });
  return out;
}

export function blocksEqual(x: Block[], y: Block[]): boolean {
  if (x.length !== y.length) return false;
  return x.every((b, i) => {
    const o = y[i]!;
    return (
      b.id === o.id &&
      b.kind === o.kind &&
      b.text === o.text &&
      Boolean(b.checked) === Boolean(o.checked)
    );
  });
}

/** Only the changes: each run of unchanged lines becomes a single counted gap. */
export function condenseDiff(ops: DiffOp[]): DiffItem[] {
  const out: DiffItem[] = [];
  for (const op of ops) {
    if (op.type !== "same") {
      out.push(op);
      continue;
    }
    const last = out.at(-1);
    if (last?.type === "gap") last.count += 1;
    else out.push({ type: "gap", count: 1 });
  }
  return out;
}

export function countChanges(ops: DiffOp[]): {
  added: number;
  removed: number;
} {
  return {
    added: ops.filter((o) => o.type === "added").length,
    removed: ops.filter((o) => o.type === "removed").length,
  };
}
