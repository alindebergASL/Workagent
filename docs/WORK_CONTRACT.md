# Working boundaries during development

The canonical [blueprint](product/01-product-blueprint.md), [architecture](product/02-architectural-plan.md)
and [build steps](product/03-build-steps.md) describe the product. API schemas are changeable
engineering artifacts. Hermes and the existing Claude web owner coordinate shared
interfaces and regenerate affected contracts/clients together.

Keep these behavioral protections:

- Preserve saved user work, human edits and explicit acceptance choices.
- Enforce access scope, current authorization and the cumulative spending ceiling.
- Preserve durable provenance and unknown external outcomes; do not blindly replay
  requests whose effects are unresolved.
- Keep progress, failures, proposals and actual outcomes truthful.
- Use migrations/backups or isolated data to protect persistence; installed-data
  maintenance requires its actual authority.

Do not freeze architecture, APIs, database layout, renderer structure, old designs,
demo flows or every legacy fixture to satisfy historical checkpoints. Preserve historical
interpretation and receipts without importing old task-selection/runtime policy into new work.

Within an authorized increment, routine implementation, refactoring, testing, integration
and feature-branch publication proceed without another checkpoint. Use one writer per
stream, changed-behavior checks and at most one useful independent risk review. Share
interfaces early and publish coherent increments. If web ownership is unavailable, report
it immediately, request reassignment for that stream and continue independent backend work.

Current scope and effect boundaries are in [development direction](DEVELOPMENT_AUTHORITY.md);
paid use follows [model authorization](GENERAL_MODEL_AUTHORIZATION.md) and actual accounting.
The present documentation cleanup does not activate product implementation, private
access, external business effects, installed maintenance, default merge or deployment.
Never force or reroute a refused git, filesystem, database or permission operation.
