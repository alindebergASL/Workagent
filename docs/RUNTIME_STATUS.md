# Current runtime status and execution boundary

## Exact demonstrated application

**1b81a1d742829663faf12a0ca5fa03957daf252c** integrates verified backend9ed2467,
Claude frontend a3c06fb and reviewed integration fixes. PR9 and the non-default
`hermes/general-model-integration` branch contain it. The retained review runs
this exact application; subsequent evidence-only commits do not change it.

[Actual experience/access](GENERAL_MODEL_REVIEW.md) ·
[Full checkpoint evidence](../handoffs/backend/GENERAL_MODEL_CHECKPOINT.md).

## Implemented and observed

- Natural-language/attachment/exact-saved-target admission through the existing
  GeneralWorker, dispatcher, broker/domain and Responses ledger; no parallel model runtime.
- Strict model-selected CSV/Wasmtime operation, actual local result inspection
  and result-aware explanation. Model-generated calculator code and changed form.
- Immutable saved work/proposals, human edits, cumulative authorization, pre-I/O
  target checks, READ COMMITTED admission guards, fences/replay and truthful recovery.
- Claude's Home/Spaces conversation-owned result and pending-decision discovery,
  companion conversation, saved edits and phone panes; read-only progress polling.
- Exact-head synthetic actual-browser/API/PostgreSQL four-turn journey and restart;
  four authorized live turns with no client-supplied operation or WAT. Both live
  revisions remain pending against preserved human-saved bases.

## Separate verdicts

- **Engineering PASS for this checkpoint:** full487 backend tests on identical
  backend bytes,91 frontend tests, exact-head synthetic and live journeys.
  Exact application frontend CI passed; this is not a claim of all repository
  workflows freshly running on this SHA.
- **Usefulness:** narrow live work demonstrated; Andrew's acceptance NOT TESTED.
- **Experience:** scoped journey demonstrated, full seamless-product acceptance
  FAIL/incomplete. Literal Markdown/long replies, a proposed-result/saved-input
  subtitle mismatch and operator-only narrow-grant setup remain explicit gaps.

M1's one-operation profile is specific to this checkpoint. **M3 adaptive goal
execution, M4 actual specialist coordination and M5 persistent ownership are
planned/NOT TESTED.** Four human turns are not autonomous replanning; persisted
chat/restart is not ongoing responsibility; development workers are not product
specialists. B4–B7 broader gates remain. See BUILD_PLAN and PRODUCT_ACCEPTANCE.

## Authority and historical state

The existing grant consumed all four turns/eight generations/eight counts, with
16 retrievals and no unknown usage. Usage-based conservative estimate$0.0752650;
reserved$1.05536; provider billing unknown. The $20 ceiling is unchanged and does
not override exhausted call limits. No more live calls without applicable new
call/scenario authority; deterministic development remains authorized.

Default startup remains controlled and strips model keys. No customer/private
context, external business action, default merge or deployment was added. The
historical controlled f68efe5 checkout/database and old intake grants remain
untouched. See EXPERIENCE_REVIEW for the historical controlled walkthrough;
GENERAL_MODEL_REVIEW is the current retained model-results walkthrough.
