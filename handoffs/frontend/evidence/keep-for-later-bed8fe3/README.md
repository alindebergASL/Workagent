# "Keep for later" follow-up: `bed8fe3`

A separate follow-up to the accepted `e0da95c` candidate, built on the integration base `5ae4cbb`. It contains no other UI change.

**Defect.** On the artifact page, `showAsk = askOpen || Boolean(instruction.trim()) || Boolean(requestState.error)`, so a non-empty instruction kept the revision form open after "Keep for later".

**Fix.**
- The form opens and closes only on request (`showAsk = askOpen`).
- The instruction stays in state, and so does any unconfirmed send, whose exact command stays frozen.
- Collapsed, the button reads "Resume your request". A one-line note says either "Your unsent request is kept here." or "Your last send wasn’t confirmed. Resume to retry the same request."
- Resuming restores the text, the error and the same-command retry. Focus returns to the resume button on collapse and to the text field on resume.

| Check | Mode | Result | Evidence |
|---|---|---|---|
| Collapse → resume → same text, with a pane switch on phones, at 1440 / 390 / 320 px | mock browser (`web/e2e/revision-draft.spec.ts`) | pass, 3/3 | `mock/*/21`, `22` |
| Unconfirmed send: collapse → note → resume → same error → retry sends the identical `command_id` once; one pending proposal | mock browser | pass, 3/3 | `mock/*/23` |
| The same spec against the pre-fix page | mock browser, desktop | fails as reported (form still open) | — |
| Full mock suite | mock | 15/15 pass | — |
| `pnpm check` (tsc, eslint, prettier, 25 unit tests) | — | pass | — |
| `scripts/workagent.py demo` at `bed8fe3`, clean tree (fresh database; includes the lost-202 revision retry with one run, `revision_response_loss`) | real UI + FastAPI + PostgreSQL, fixture compute | pass; 9/9 fault regressions | `real-demo/` |
| Live agent or model execution | live | not observed | — |
