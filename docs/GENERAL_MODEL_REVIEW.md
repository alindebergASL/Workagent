# Hands-on review: live-model work and preserved decisions

## Exact application and private access

Application **1b81a1d742829663faf12a0ca5fa03957daf252c** is running in
`/home/ubuntu/workagent-model-integration`, using the isolated retained
`.local/general-live-01.env` database. This is not the historical controlled
review database. On 2026-10-06, loopback Home returned HTTP200 and both saved
artifacts and pending decisions were read back. Availability is session-local,
not a deployed service or a guarantee of survival across host/session restart.

Use your existing SSH access to the review host from your own computer:

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:3000:127.0.0.1:3000 ubuntu@16.148.68.248
```

Use your normal SSH alias/key selection if required. The local port must be free.
Only after connecting, open http://127.0.0.1:3000 . No public app endpoint, firewall
change or deployment was made. The review computer's tunnel has not been operated
or verified by Hermes.

## Inspect the actual retained work

1. Home leads with **A proposed version is ready** for the invoice tool. The
   reconciled CSV decision is also discoverable. Open the workspace's Work tab
   to find these same conversation-owned results, without invented assignments.
2. [CSV and pending revision](http://127.0.0.1:3000/conversations/f477845c-f0f1-4bd8-9d54-d3bf1725ccbc/artifacts/62aa3902-cb84-409c-9fde-f835521d3cc9):
   the initial live-selected reconciliation found the row B discrepancy. The
   human-saved price12.495 and notes remain saved; the half-even proposal has
   calculated total77.38. Inspect both versions before deciding.
3. [Calculator and shipping proposal](http://127.0.0.1:3000/conversations/07ac39bd-e6ae-4c33-99f1-93465ff910cb/artifacts/b08e0a5b-2189-4ac6-8c5a-dccf7bf64b9c):
   the model generated the original executable two-input tool and the shipping
   revision without supplied WAT. Actual local execution returned3750 then4250.
   Open **See the proposed version** to inspect the added shipping input. The
   saved form is still the two-input version until you explicitly apply it.
4. Switch Work / Conversation on a narrow screen; inspect the request/result
   history, retained notes and pending decision. Leave through Home/Spaces and
   reopen the same artifact. Saved work is in PostgreSQL; unsent drafts are
   tab/sessionStorage-scoped, not cross-device durable memory.

The two live proposals were deliberately left pending. You may inspect, apply
or keep the current version; applying is your decision, not proof of a new run.
**Download saved file** downloads the saved version, not the pending proposal.

## Important test limit

The authorized four user turns / eight generations / eight token counts have
been consumed. The review stack has no continuous live dispatcher and no model
key in its web/API environment. **Do not expect further natural-language sends
or Run/Recalculate controls to generate new work in this retained review.** This
is an inspection/decision checkpoint, not an unrestricted agent subscription.
Do not create another grant, reset counters or rerun the live driver.

For recovery, reuse the retained database and pinned application; do not reseed
or test against it. The session-local operator wrapper lives outside the repo at
`/home/ubuntu/.hermes/cache/scratch/workagent_review_server.py`; it is not a durable
restart/deployment interface. Ask the integration owner to restore review access
if the session stops, without activating a provider worker.

## Verdicts and actual captures

[Engineering/usefulness/experience report and remaining M3–M5 gates](../handoffs/backend/GENERAL_MODEL_CHECKPOINT.md).
The live test proved these narrow work shapes; Andrew's usefulness review remains
NOT TESTED. Overall seamless-product experience remains FAIL against full
acceptance because the reported gaps are open. Adaptive multistep agency,
specialists and ongoing responsibility are still planned, not demonstrated.

[Actual Home capture](../handoffs/backend/evidence/general-model/live-home.png)
· [Actual phone capture](../handoffs/backend/evidence/general-model/live-phone.png)
