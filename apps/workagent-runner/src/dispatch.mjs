// One service leader owns this bounded dispatcher. Workspace claims serialize
// admission and exclude an already-running work; unrelated works use free slots.
export function createDispatcher({ workspace, principal, host, capacity = 2, onError = () => {} }) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) throw new Error('invalid_worker_capacity');
  const active = new Set();
  let pumping = null, closing = false, wakeRequested = false;
  async function execute(job) {
    try {
      const messages = await host.run(job);
      await workspace.finish(principal, job, messages, closing ? 'interrupted' : messages.outcome?.status ?? 'ready', closing ? 'service_stopped' : messages.outcome?.errorCode);
    } catch (error) {
      const known = ['accounting_bridge_not_connected', 'openrouter_not_configured', 'work_superseded', 'turn_call_limit', 'interrupted_no_automatic_replay', 'provider_budget_exhausted', 'provider_http_402', 'provider_http_403', 'provider_http_429'];
      const code = closing ? 'service_stopped' : known.includes(error.message) ? error.message : 'execution_interrupted_check_receipt';
      await workspace.finish(principal, job, error.messages ?? [], closing || !known.includes(error.message) || error.message === 'interrupted_no_automatic_replay' ? 'interrupted' : 'blocked', code);
    }
  }
  function wake() {
    if (closing) return;
    wakeRequested = true;
    if (pumping) return;
    pumping = (async () => {
      do {
        wakeRequested = false;
        while (!closing && active.size < capacity) {
          const job = await workspace.claim(principal);
          if (!job) break;
          // close may race the durable claim. Settle it truthfully without starting.
          if (closing) { await workspace.finish(principal, job, [], 'interrupted', 'service_stopped'); break; }
          const task = execute(job).catch(onError).finally(() => { active.delete(task); wake(); });
          active.add(task);
        }
      } while (wakeRequested && !closing);
    })().catch(onError).finally(() => { pumping = null; if (wakeRequested && !closing) wake(); });
  }
  async function idle() {
    while (pumping || active.size) { if (pumping) await pumping; await Promise.all([...active]); }
  }
  return {
    wake, idle,
    async close() {
      closing = true;
      // Cancel every live handle, including work whose claim already completed.
      host.cancelAll?.();
      await idle();
    },
  };
}
