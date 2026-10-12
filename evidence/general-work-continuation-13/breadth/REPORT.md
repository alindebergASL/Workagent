# PASS — bounded calculator breadth REPLAY

Exact application: `dd01cd49a9b026edf8a99281d182e0554d54f4e2`. Production Next build was present before launch. This is retained model-created code replay plus real controlled local Wasm execution, NOT fresh generation, independent agent intelligence, or Andrew acceptance.

## Verified result
- Browser changed roof area from 80 to **137**, keeping rainfall 12 and efficiency 75, saved a human QA note, and clicked **Run saved tool**.
- Independent Python `137 * 12 * 75 // 100` returned **1233**; visible proposal summary said **Returns 1233**. Wasmtime observation matches exact code hash, arguments and pending proposal.
- Initial replay code and input form exactly equal retained source. They also remained unchanged after ordinary UI edits. Original source file hash is unchanged.
- Desktop 1440px and phones 390px/320px: ordinary labeled values, readable **Collected litres tool** heading, collapsed **Change the inputs** and **Tool code**, accessible notes. No document horizontal overflow. Screenshots visually inspected: saved-version-unchecked status is separate from the pending result; no rendering failure found. Phone controls stack rather than clip; notes require vertical scrolling but are accessible.
- Agent navigation (the Home surface is labeled **Agent**, not Home) shows the pending decision; reopening and a fresh browser context preserve values, note and pending proposal.
- No proposal was accepted. Final API and direct isolated-PostgreSQL readbacks retain the human-saved current revision and `status=pending`, `accepted_revision_id=null`.
- Continuous `workagent.dispatcher --general-controlled`; no manual ticks, model calls or provider attempts. DB provider-attempt count is zero.

## Scope identifiers
- New isolated DB: `workagent_test_ae55e72eba85`; env: `/home/ubuntu/workagent-general-continuation-review/.local/general-continuation-breadth.env` (credentials not copied to evidence).
- Retained SOURCE artifact: `0208e036-79c1-4b9a-a2c7-a1c7af844179`; source revision `a4cad990-bd09-4165-8c45-2ab801bed4dc`.
- Code SHA-256: `e13be796e686eba260784f2dcd17ba4a19ee03e30538ed0206526338f27ca609`.
- OBSERVED replay conversation: `2550d1aa-6c2d-4049-9219-f4c0ae55fc6d`.
- OBSERVED replay tool artifact: `f8076664-1dd3-4ff6-bc2f-1829a8726bc4`.
- Pending proposal: `def1b33e-a617-44ce-a0ee-3b7c2529f7f9`.
- Human-saved/current revision: `f9698612-d77a-4d35-b562-518d18807758`.
- Replay URL while owned service was running: `http://127.0.0.1:3175/conversations/2550d1aa-6c2d-4049-9219-f4c0ae55fc6d/artifacts/f8076664-1dd3-4ff6-bc2f-1829a8726bc4`.

## Evidence
All paths below are relative to this report directory:
- `verification.json`: final browser assertions, visible result text, API proposals and observations, IDs, source hash, viewport metrics and POST paths.
- `scope-and-cleanup.json`: final direct DB readback, database identity/counts, source-file hash check, tracked-diff check, stopped process and closed port checks.
- `source.json`: public retained calculator body plus provenance and independently calculated expected integer; no private saved-artifact extras exported.
- `01-desktop-replayed-source.png`, `02-desktop-pending-proposal.png`, `03-phone-390.png`, `03-phone-320.png`, `04-home-pending.png`, `05-reopened-pending.png`.
- `api.log`, `web.log`, `consumer.log`, `owned-processes.json`, `browser-exit.json`, `cleanup.json`.
- `harness-attempt-1/` through `harness-attempt-4/` retain intermediate runner evidence. Top-level `failure.png` is an older harness-failure image, not a final application failure.

## Commands and execution
From `/home/ubuntu/workagent-general-continuation-review`:

```
env -u PYTHONPATH -u PYTHONHOME /home/ubuntu/workagent-flexible-work/backend/.venv/bin/python .local/general-breadth-run.py
# Final exit 0; browser passed=true, all named checks true.
env -u PYTHONPATH -u PYTHONHOME /home/ubuntu/workagent-flexible-work/backend/.venv/bin/python .local/general-breadth-finalize.py
# Exit 0; pending proposal, 1233 result, zero provider attempts, no owned PIDs remaining.
```

Launcher uses canonical `dev_db` provisioning and `workagent.seed`, exact review backend via `uvicorn workagent.api:app --host 127.0.0.1 --port 8175 --no-proxy-headers`, built Next via `node web/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3175`, and ordinary continuous controlled dispatcher. Exact argv/PIDs are in `owned-processes.json`.

## Issues / limitations
- Initial `pnpm start` tried dependency auto-install against symlinked node_modules and was refused by pnpm's unsafe-modules protection. No install succeeded. Running the existing Next executable directly resolved this without edits or network installation.
- Harness corrections only: await artifact navigation before extracting ID; correct observation route to `/observations`; use actual navigation label **Agent**; record visible proposal summary separately from hidden disclosure text. A final DB probe initially assumed a scalar status column; corrected to stored JSON `data->>'status'`. These were QA-script errors, not frontend failures. Retries left five synthetic conversations/nine runs/four pending proposals in this newly isolated DB; final IDs above identify the accepted evidence run.
- Only a valid-input change was tested. Source input-form numeric bounds are broader than the source's descriptive labels/code guards; retained unchanged, not corrected or validated for invalid inputs here.
- No original or parent live DB was opened or modified; no grants/services/env of originals touched. Global original-DB immutability was not queried because parent live work is concurrent. Only the public source evidence file was read and its unchanged hash checked.
- All owned service groups stopped; ports 3175/8175 closed; DB/evidence preserved. No tracked code/web edits, commit or push; only ignored local runner/evidence files created. No frontend fixes made.
