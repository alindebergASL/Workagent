# Workagent

Workagent is a general, persistent work partner. Conversation and appropriate work surfaces belong together; CSV and shipping tools are breadth tests, not its identity.

**Current integrated application:** `f68efe5c81e4865f9e1547e03b4af7b62c4303a0` ([PR #9](https://github.com/alindebergASL/Workagent/pull/9)). Source-free controlled conversations, real editable CSV/table/file products and import-free integer Wasm tools are implemented through the same GeneralWorker/domain. Companion replies, phone panes, proposals, exact results, human edits, exports and restart/retry paths are exercised. All three exact-head CI workflows pass.

**Start the hands-on review:** [working private access, saved examples and walkthrough](docs/EXPERIENCE_REVIEW.md). The existing EC2 review session is running, not merely saved test state. Access uses the existing SSH tunnel; no public deployment is implied.

**Important limit:** the general worker accepts only `ControlledTransport`. Ordinary replies are deterministic, and product operations are operator-selected. A real-model adapter, model-selected operation admission and bounded execution wiring still need implementation through this same worker. A model-test grant alone is insufficient. [Runtime status](docs/RUNTIME_STATUS.md) separates implemented paths from that gap.

## Reopen the preserved candidate on the existing review host

```sh
cd /home/ubuntu/workagent-general-integration
git rev-parse HEAD  # f68efe5c81e4865f9e1547e03b4af7b62c4303a0
python3 scripts/workagent.py serve --env .local/parent-quota-final.env --skip-setup
```

Do not start a second copy if the review is already running. The launcher refuses occupied ports3000/8000 rather than killing another app. `serve` starts real web/API and a continuous controlled dispatcher; Ctrl-C stops processes without deleting saved work. Reuse the same ignored env/database. Do not run tests, `demo` or reseeding commands against this review instance.

Web is loopback-only at `http://127.0.0.1:3000`; API is loopback-only at8000. For access from your own computer, use the [SSH tunnel instructions](docs/EXPERIENCE_REVIEW.md). There is no production login, shared/public endpoint or entitlement implied. The local bearer remains server-side in a mode0600 ignored env file, never browser code. Model keys are stripped from the controlled launcher environment and migration credentials are withheld from runtime services.

## Reproduce controlled verification on a separate local instance

The existing review installation has dependencies and a production build already. A fresh checkout needs Python3.12, PostgreSQL, Node/pnpm, locked backend/frontend dependencies, Playwright Chromium and `backend/requirements-local-tools.txt` (Wasmtime49). Verify paths in the backend documentation before provisioning. The old generic `setup` uses `/usr/bin/python3`; do not blindly replace an existing3.12 environment on a host whose default Python differs.

```sh
# Isolated env path: never the hands-on review database.
python3 scripts/verify_general_integration.py \
  --env .local/new-integration.env --output .local/new-integration
```

This exercises real CSV/tool UI, controlled continuous worker, lost response and process restart, then stops its test services while preserving the separate test DB. It proves engineering, not natural-language action selection or model usefulness. [Verification and explicit limits](handoffs/backend/GENERAL_COMPANION_VERIFICATION.md).

## Verify / regenerate

```sh
backend/.venv/bin/python backend/dev_db.py --env-file backend/.tests.env
. backend/.tests.env
PYTHONPATH=backend:. backend/.venv/bin/python -m pytest -q backend/tests runtime/tests
npm --prefix contracts run generate
npm --prefix contracts run check
pnpm --dir web check
node web/scripts/products-review-regressions.mjs
```

Use a separate disposable test database. `backend/dev_db.py` refuses to overwrite an existing env file; source it to rerun tests, or explicitly choose another test file. Follow `backend/README.md` for migrations/grants rather than resetting or repinning old runs. The standalone frontend mock mode is separate from actual-domain verification.

## Product, ownership and evidence

- [Product contract](docs/PRODUCT_CONTRACT.md), [current build plan](docs/BUILD_PLAN.md), [work contract](docs/WORK_CONTRACT.md), [acceptance](docs/PRODUCT_ACCEPTANCE.md), [developer ownership](AGENTS.md).
- [Current runtime boundary](docs/RUNTIME_STATUS.md), [current integration status](handoffs/backend/STATUS.md), [experience review](docs/EXPERIENCE_REVIEW.md).
- Canonical backend schemas/service and PostgreSQL retain authorization, immutable revisions, scope, command replay and fenced execution. `contracts/` is generated JSON/OpenAPI/TypeScript authority.
- Claude owns frontend design; Hermes owns backend/runtime/integration. No competing frontend or model loop is commissioned.

## Historical intake demonstration—not the current startup

The old `scripts/workagent.py demo` journey and `hermes/intake-next-action` branch describe a preserved intake checkpoint. They are not the entrypoint for this integrated CSV/tool review. Historical [intake acceptance](handoffs/backend/INTAKE_ACCEPTANCE.md) includes a bounded live Responses test, whose four-call grant is exhausted/expired. That evidence does not connect a model to the current general worker.

**Next:** Andrew's hands-on experience review, then a narrowly scoped same-worker live-adapter implementation and separately authorized bounded usefulness test. Engineering is verified; general-model usefulness and Andrew's experience acceptance remain NOT TESTED. No new inference/spend, private context, external business action, default merge or deployment is authorized by these documents.
