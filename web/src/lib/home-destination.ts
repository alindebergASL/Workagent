/**
 * Where a message started on Home goes: the workspace the address names, else
 * the one this person last chose here, else their personal workspace (or the
 * first they can open). Only a workspace they can open is ever chosen, so a
 * stale address or remembered choice falls back rather than failing.
 */
export const DESTINATION_KEY = "workagent:home-destination";

export function homeDestination(o: {
  named?: string | null;
  remembered?: string | null;
  openable: readonly { id: string; kind?: string }[];
}): string | null {
  const ids = new Set(o.openable.map((w) => w.id));
  for (const id of [o.named, o.remembered]) if (id && ids.has(id)) return id;
  return (
    (o.openable.find((w) => w.kind === "personal") ?? o.openable[0])?.id ?? null
  );
}
