/** Time display: always labeled with the zone it is shown in. Fixture times are UTC. */
export function formatTime(
  iso: string | null | undefined,
  zone: string,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return fmt.format(d);
  } catch {
    return d.toISOString();
  }
}

export function formatDate(
  iso: string | null | undefined,
  zone: string,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
