# Working boundaries during development

The [product direction](PRODUCT_CONTRACT.md) governs the build. API schemas describe
the current interface; they are changeable engineering artifacts. Hermes and Claude
coordinate changes and regenerate contracts/clients together.

Keep these behavioral protections:
- Preserve saved user work, human edits and explicit acceptance choices.
- Enforce access scope, current authorization and the cumulative spending ceiling.
- Preserve durable provenance and unknown external outcomes; do not blindly replay
  requests whose effects are unresolved.
- Keep progress, failures, proposals and actual outcomes truthful.
- Use reversible migrations/backups or isolated data when changing persistence.

Do not freeze architecture, APIs, database layout, renderer structure, historical
demo flows or every old fixture to satisfy an obsolete checkpoint. Prefer reuse
where it helps; replace mechanisms when there is a concrete product reason.

Routine implementation, refactoring, testing, integration and feature-branch
publication proceed without another user checkpoint. Share interfaces early;
publish usable increments instead of waiting for a perfect full milestone.

Actual paid-call/access boundaries remain in [authorization](GENERAL_MODEL_AUTHORIZATION.md).
Changing this guidance grants no additional private access, external business
effects, default-branch merge or production deployment.

[Previous work contract, retained as history](https://github.com/alindebergASL/Workagent/blob/3c537b7f366369879069379ddcb9735b19fe9fed/docs/WORK_CONTRACT.md).
