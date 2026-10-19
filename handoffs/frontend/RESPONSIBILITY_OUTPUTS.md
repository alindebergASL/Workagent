# Responsibility outputs on the assignment page (2026-10-19)

Branch `claude/responsibility-result-20261019` (base bcb4595), frontend only.

A retained responsibility's published outputs (e.g. an overnight checklist
saved in its source conversation) now show on its assignment page and open at
their canonical conversation-owned address
`/conversations/{conversation_id}/artifacts/{artifact_id}?workspace=...`,
reusing the existing product page (rendering, authorization, history, edits).
No IDs are hardcoded; everything derives from the rich responsibility read.

## Contract assumed (target integration)

- Rich GET responsibility projects `detail.assignment.conversation_id` and
  `detail.assignment.artifact_ids` from this responsibility's actually
  published outputs only.
- Legacy GET assignment / list will NOT project conversation-owned artifact
  ids; genuinely assignment-owned artifacts remain as today.

## Changes

- `web/src/lib/responsibility-outputs.ts` (new, pure): derives output rows
  from one frozen read set; canonical conversation hrefs; skips
  assignment-owned work (legacy list already shows it); a read naming a
  different owning conversation links there; denied/unknown rows claim
  nothing; ids beyond `OUTPUT_READ_LIMIT` (20) get the projected link without
  a claimed title; `mergeOutputReads` keeps earlier titles as stale while a
  re-read fails.
- `web/src/lib/client/responsibility-outputs.ts` (new): bounded read-only
  loader (limiter 6) + `useResponsibilityOutputs` hook, real mode only,
  re-reads on focus/refresh.
- `web/src/app/assignments/[id]/page.tsx`: Saved work section lists the
  responsibility's conversation-owned outputs with titles, scoped canonical
  links, stale/denied/unknown states and a per-row "Check again"; legacy
  assignment-owned rows unchanged.
- `web/src/lib/client/real-api.ts`: legacy assignment conversion
  (`getAssignment`, `listAssignments`, `getAssignmentSources`) converts
  assignment-owned artifacts only; a projected conversation-owned id (base
  backend still projects them) no longer fails the whole assignment view.
  Canonical validation in `artifactView`/`getArtifact` is unchanged — the
  assignment artifact route still rejects conversation-owned products.

## Checks

- `npm run typecheck` clean; `npm run lint` clean; `npm run format:check`
  clean; `npm run test` 337/337 (includes new
  `web/test/responsibility-outputs.test.ts`: canonical destination +
  workspace scoping, assignment-owned skip, ownership mismatch, denied/error/
  empty/bounded reads, stale merge, and a legacy getAssignment regression
  over a stubbed transport).

## Open

- Hermes' pending backend fix should stop projecting conversation-owned ids
  into legacy assignment responses; the frontend already tolerates either.
- No pushes, runtime/provider calls, or contract edits were made.
