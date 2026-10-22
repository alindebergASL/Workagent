# Interrupted-turn recovery

A new human message can supersede a stalled conversation turn without discarding
saved work or pretending that the old goal completed. The existing message command
proves the old attempt safe, cancels/fences the old run and queues the new turn in
one workspace-locked transaction. No new UI/API or database repair is required.

In addition to the existing historical count-rejection path, a turn is safe when:

- At least one prepared step has exact terminal provider receipts: matching count,
  response identity, metadata, request hash and reported usage.
- Every function-call receipt has its committed local `tool_result`.
- Every other prepared step either satisfies that same proof or has zero journal
  events. A zero-event step has not reserved count/generation I/O; cancellation
  prevents a stale worker from reserving it later.

Unknown counts/generations, received-but-unapplied actions, cancellation requests,
problems, corrected readbacks and nonterminal results are not released by this
proof. Prepared-only attempts keep their existing narrower semantics. Every
attempt in the conversation must be accounted for; one safe attempt cannot hide
another unresolved one. Active turns are not automatically bypassed by a scheduled
continuation. An already-cancelled safe history cannot indefinitely block later
admission.

Historical attempts, request bytes, receipts, recorded effects and reservations
are never rewritten, refunded or reinterpreted as goal completion. Paused handovers
remain paused, saved human revisions remain authoritative, and current grant/scope,
version and budget checks still apply to the new request. No migration, additional
allowance, model route or private-data permission is introduced.

`test_settled_turn_recovery.py` exercises the actual worker and restricted-role
PostgreSQL at settled, prepared-unsent-tail, unknown count, unknown generation and
unapplied-result boundaries. Independent review checked workspace locking and
fencing; this batch does not claim a new concurrent lock-contention test. Live
recovery and varied-task results are recorded separately in `STATUS.md`.
