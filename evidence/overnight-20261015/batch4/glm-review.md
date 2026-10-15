# Critique: WorkAgent (candidate 4e676b1)

I have not used the app or viewed screenshots; this is a packet-only assessment.

## Engineering

Substantive but with a clear unresolved hole. Independent review, backend/frontend checks, lint/type/webpack pass, and 39 controlled saved-work/protected-note/CAS cases pass. The most credible new engineering result is the three controlled SQL cases showing the canonical worker can resume after lease expiry without duplicate generation. That is real progress toward robustness — but it is a controlled proxy. The live library run failed with `action_unresolved` on a `DomainError`, no artifact published, no retry, no same-ID recovery, and the exact exception stack was never captured. Lease expiry is a plausible diagnosis, not a confirmed one. The system stopped honestly rather than fabricating a save, which is correct behavior, but self-healing on real runs is unproven. Budget accounting is unusually transparent (reserved vs. conservatively-calculated costs, quarantined unknowns) — keep this.

## Usefulness

The one real, usable output is the investigation brief: a saved, persistent, 7.9KB canonical artifact whose analytical content is genuinely good. It correctly computes rates (10/10/16 per 100), the 60% rate growth, the 18-above-benchmark decomposition, and — most importantly — refuses the easy traps: it doesn't equate the 18 billing tickets with the 18 excess tickets, doesn't let the two pre-release login reports exonerate the release, separates ticket rate from affected-user percentage, and explicitly lists unsupported claims. It is a legitimate "living investigation brief" with a reusable evidence-entry template and preserved human constraints. That is a real step toward nanoMuse-style persistent personal continuity: a body of reasoning a human can extend rather than a chat transcript that evaporates.

What failed: the library track produced nothing — stopped, unresolved, zero artifacts, and the planned human correction was never frozen. The original run's human note was *never saved* (the original_history is untouched); only the new investigation note was saved and reloaded. `note_followup_model_tested: false` means the note persisting through reload is persistence plumbing, not demonstrated model memory — the model never had to recall or honor the note in a later turn. The generated interactive views were authored by the evaluator; the model, given the choice, produced a document. So "useful adaptive surfaces" remain aspirational.

## Experience

The visible scope adds in-place views, version-gated read-only broker, and provenance links — plausible scaffolding, but I cannot verify any of it, and the controlled supplier view must not be read as model capability. The harness reload stopping because the locator matched TWO notes is a small but telling defect: ambiguity in the harness mirror of a human artifact will bite real usage.

## Direction (no parity claimed)

The investigation artifact shows the right shape of progress: correction priority respected (human note protected, corrections explicit, history not silently replaced), honest uncertainty, no invented initiative. But selective initiative is untested — the system has never demonstrated a completed autonomous follow-up on saved work in any live probe, only controlled ones.

## Next actions (3)

1. **Fix and re-run the live library track end-to-end**: capture the actual exception stack, implement same-ID recovery or documented retry, and complete a real saved-work follow-up with the frozen human correction. This is the single largest gap.
2. **Test note-followup with the model**: a live probe where the model must load the saved note and honor it (e.g., refuse to call the release confirmed). Persistence without recall is not continuity.
3. **Fix the two-match locator failure** in the reload harness before any further edit-controls work; ambiguity resolution on protected notes is a correctness prerequisite, not polish.

**Verdict**: One genuinely useful persistent artifact and honest failure reporting; core autonomy and memory claims remain unearned.
