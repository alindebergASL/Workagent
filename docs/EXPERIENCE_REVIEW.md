# Hands-on review: integrated general-work candidate

## Exact runtime and access

The application under review is **f68efe5c81e4865f9e1547e03b4af7b62c4303a0**, not a new build or a saved screenshot. PR #9's three exact-head workflows passed. Documentation updates are separate from this frozen application commit.

Current review host: existing Hermes EC2 **16.148.68.248** (`ip-10-0-3-214`, instance `i-0b0fdf98dff73e9e8`, us-west-2). Runtime checkout: `/home/ubuntu/workagent-general-integration`. Existing ignored environment: `.local/parent-quota-final.env`. Do not print its contents, regenerate it or run test suites against this review database.

The real Next.js/FastAPI/PostgreSQL stack and continuous controlled dispatcher are running. Web listens on **127.0.0.1:3000**, API on **127.0.0.1:8000**. Both preserved examples have been opened in the host's browser; their real API readbacks and CSV/WAT downloads return200. There is no public app URL and no new deployment, reverse proxy, TLS endpoint or firewall change.

Andrew confirmed existing SSH access to this host. On the **review computer**, keep this terminal open:

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:3000:127.0.0.1:3000 ubuntu@16.148.68.248
```

Use the existing SSH alias or key selection you normally use for this host if required. Do not send a private key in chat. Port3000 on the review computer must be free; another application there is not Workagent. `ExitOnForwardFailure` detects a local bind failure. Browser links below work **after** the tunnel connects; `127.0.0.1` otherwise means your own computer, not EC2. No need to forward API8000: the server-side proxy handles it.

- [Saved CSV](http://127.0.0.1:3000/conversations/771452d7-c08a-4400-b5af-a1e70f23b9bf/artifacts/11294b4e-b3dc-445a-9fc9-eb2e495dddf8)
- [Saved shipping tool](http://127.0.0.1:3000/conversations/108b6068-53aa-4ca6-bdde-938d3d2ff7b6/artifacts/4f838f5b-c0fa-4302-8bfb-35071006bae1)
- [Conversations](http://127.0.0.1:3000/conversations)

Open both example links in separate browser tabs. Browser rendering/state is verified on the host. The review computer's SSH login/tunnel is user-operated, not falsely reported as already connected.

## Short walkthrough

### 1. Edit and export the CSV

Open the saved CSV. RowB has quantity3, unit price12.50, reported38.50 versus retained calculated37.50; its note is **Human credit note retained**. The current human-saved revision correctly says it has not been checked yet; retained calculated columns are not new verification.

Change RowB's reported total to37.50 and optionally edit its note. Click **Save my edits**, then **Recalculate saved rows**. Inspect the proposed result and **Apply proposed version** when satisfied. **Download saved file** exports the saved revision, not an unsaved draft or unaccepted proposal. Open the CSV download and check your edited note and reported value. Do not infer a recalculation from simply editing a cell.

### 2. Change the shipping requirement

Open the saved tool: Quantity3, Unit price cents1250, Shipping cents500; observed return4250. Change Shipping cents to750. Save, **Run saved tool**, inspect the proposed observed result4500, then apply. This is the minimal fee-requirement change; the tool code remains inspectable under **Tool code**. Saving code/inputs alone does not execute it. Decimal3.5 is intentionally rejected as an integer input and should remain an unsaved draft until corrected or discarded.

### 3. Reply beside the work without losing edits

Before saving another change, add a sentence to **Your notes**. Use **Reply about this work** in the companion pane, for example: “Keep this note; I want a different shipping rule.” Confirm the unsaved note remains. On a narrow window, switch **Work / Conversation** and back. The reply is a labeled controlled placeholder, not a model's understanding or an executed requirement change. Use the explicit controls in step2 for an actual change today.

### 4. Reopen

Save changes you want committed. Close/reopen the same artifact link or return through Conversations; inspect saved values/history. Reload also retains a same-tab draft; browser draft/retry storage is sessionStorage and is not a promise of durability in a different browser or after storage is cleared. PostgreSQL-saved work survives service restart. Your browser's drafts are separate from the agent/browser used for verification.

## What this does—and does not—demonstrate

- **Real:** domain authorization, local calculation/import-free Wasm execution, exact observed returns, saved revisions, exports, proposal acceptance, human edits, reply persistence and recovery.
- **Operator-selected:** Recalculate/Run and the attached operation chooser. You supply/select the operation and inputs; the runtime is not inferring a tool from your sentence.
- **Controlled replies:** source-free messages receive deterministic transport text. The model is not reasoning, deciding actions, writing WAT or revising work in response to these messages.
- **Not implemented yet:** real-model action selection through GeneralWorker and its available authorized tools. A grant alone cannot turn this candidate into a live general agent. See [runtime status](RUNTIME_STATUS.md) and the bounded implementation/test proposal linked there.

## Restart without losing this review

The review process is retained beyond the chat turn. It is not a boot-managed deployment and does not promise survival of an EC2 reboot. If it stops, SSH to the host and run:

```sh
cd /home/ubuntu/workagent-general-integration
git rev-parse HEAD  # must be f68efe5c81e4865f9e1547e03b4af7b62c4303a0
python3 scripts/workagent.py serve --env .local/parent-quota-final.env --skip-setup
```

If already running, leave it alone; the launcher safely refuses occupied ports. Stop this launcher with Ctrl-C when finished; saved PostgreSQL work remains. Do not run `demo`, provision a fresh env or reset this database to reopen it. All fixtures are synthetic; no provider key or migration credential is passed to service processes by this launcher.
