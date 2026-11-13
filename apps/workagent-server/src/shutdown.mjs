// Keep HTTP callbacks and dispatcher settlement inside the leader's lifetime.
export function createShutdown({ server, dispatcher, host, leadership, pool, timer }) {
  let shutdown;
  return () => shutdown ??= (async () => {
    clearInterval(timer);
    // Stop HTTP admission first; cancel inference without disposing its host.
    await Promise.all([server.drain(), dispatcher.close()]);
    await host.close();
    leadership.release();
    await pool.end();
  })();
}
