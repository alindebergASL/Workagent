/**
 * Live event streams held open by this server process.
 *
 * An open stream never ends on its own, so a graceful shutdown that waits
 * for in-flight requests to drain waits forever: with browsers connected,
 * Next sat past its grace period and was SIGKILLed. The first tracked
 * stream installs one shutdown handler per process (held on globalThis so
 * dev reloads reuse it instead of stacking listeners) that aborts every
 * live stream so the requests can drain. It never exits the process or
 * removes anyone else's handlers.
 */
const STREAMS = Symbol.for("workagent.web.live-streams");
const HANDLER = Symbol.for("workagent.web.live-streams-shutdown");
const g = globalThis as Record<symbol, unknown>;
const streams = (g[STREAMS] ??= new Set()) as Set<AbortController>;

/** Aborts every live stream so in-flight requests can finish. */
export function drainLiveStreams(): void {
  for (const stream of streams) stream.abort();
  streams.clear();
}

/** How many live streams this process is holding open right now. */
export const liveStreamCount = (): number => streams.size;

/** The installed process shutdown handler, if any. */
export const shutdownHandler = (): (() => void) | undefined =>
  g[HANDLER] as (() => void) | undefined;

/** Registers a live stream's controller; returns its deregistration. */
export function trackLiveStream(stream: AbortController): () => void {
  if (!g[HANDLER]) {
    const handler = () => drainLiveStreams();
    g[HANDLER] = handler;
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.once(signal, handler);
  }
  streams.add(stream);
  return () => {
    streams.delete(stream);
  };
}
