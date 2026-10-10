# Flexible work: frontend consumption of the #13 contract

The frontend now consumes Hermes's published contract (`hermes/flexible-work-13`
at `a48c6d5`; `FLEXIBLE_VIEW_CONTRACT.md`) with no new backend fields and no
task-specific code. Everything renders from what a saved body declares about
itself.

## What a person gets

| Saved body | Shown as | Editing |
| --- | --- | --- |
| `structured_table` | Table with headings from each field's label and unit; numbers right-aligned; booleans Yes/No; missing values as a dash. On a phone, each row is a labelled card. | Each cell gets the input its declared type needs (text, whole number, decimal to the field's scale, Yes/No, or the field's choices). A value the service would refuse stays as typed, is marked, is listed, and blocks Save. Read-only fields stay as text. Rows can be added; a saved row with read-only cells can't be removed. Download as CSV, made in the browser from the saved version, with formula-looking cells quoted. |
| document (`{title, blocks}`) | The existing document editor | Same blocks, same ids; Save rejects empty parts. |
| `custom_view` | The trusted shell first (who made it, that it's unverified and can't change anything, which saved work it reads and whether that's still current), then the generated view in the isolated frame, then its readable version as plain text and its source as text. | The readable version can be edited and saved. When what the view reads has been saved since, the shell says so and offers **Use the latest saved versions**: an explicit human save of the view with only its bindings moved to the current revisions. |

Older kinds (`table` reconciliation, `tool`, `file`) are unchanged and keep
their own page. Home, Spaces and conversation links list the new kinds
("Table", "Document", "Interactive view").

## How the view is wired

- The frame gets only the saved `source` and `{}` as data. Its actions are built
  only from the saved `actions`. For a declared action the shell sends the
  request built from the revision on screen (`view_revision_id`, its
  `body_hash`, the body's `access_generation`, the action name, `{}`) to
  `POST …/artifacts/{view}/view-actions`, and passes back the bounded JSON reply.
- Undeclared names are refused by the host before any call. A payload that
  isn't empty is refused before any call, and the shell shows "The view asked
  for something it isn't allowed to." That notice stays visible.
- A 404 from the service is reported by the shell ("couldn't read your saved
  work … may be out of date") unless the shell already explains it because the
  bound work moved on. It never depends on the generated code being honest.
- The frame is remounted on every new view revision, so an old channel never
  carries authority.

## Other changes

- `ObservedOutput` has an `artifact_draft` branch: "Saved as a draft. Only its
  shape was checked; nothing in it was run or verified."
- `OperationComposer` narrows the expanded operation union. A saved
  `publish_artifact` retry is still resent exactly.
- Turn state: the service reports a run that published a draft as `failed`,
  because drafts are partial by design. If that run's reply carries only draft
  products, the conversation shows it as replied rather than "This didn't
  complete". The draft's own page says what isn't verified. **Hermes:** if you
  would rather report these turns differently on the wire, the frontend
  mapping (`draftAware` in `real-api.ts`) can go.
- Rows are named by their first editable text column, so labels read
  "Ben Hours" rather than a reference code. A unit already in a label isn't
  repeated.

## Evidence (zero provider calls)

| Check | Result |
| --- | --- |
| `pnpm check` (types, lint, format, unit tests) | 163 passed |
| `pnpm build` (production) | Passes. Hermes reported this as failing at `a48c6d5`; it is now fixed. |
| DOM regressions (fixture transport) | 26/26. The 3 new ones use Hermes's retained model-made venue table and view. |
| Sandbox regressions (real Chromium) | 9/9 |
| Mock browser suite | 15/15 |
| `verify_general_integration.py` (fresh PostgreSQL) | PASS |
| **`web/scripts/flexible-journey.mjs`** (fresh PostgreSQL, real API, continuous controlled consumer, production web, all processes restarted between phases) | PASS create + reopen |

The journey covers:

- A volunteer rota table: typed edits, an invalid value refused, the draft
  surviving a reload, then save. Exact ids and values are read back from the API.
- A Workagent revision of the rota arriving as a proposal ("1 row added") and
  applied by a person.
- A checklist document: checked and saved.
- A view bound to the rota:
  - it reads the exact revision through the broker and filters locally;
  - its generated code tries to fetch, read the parent, use storage, call an
    undeclared action and name a target, and every attempt is refused;
  - a person then saves the rota, the view's read is refused, and the shell
    explains;
  - the person rebinds and it reads the new version.
- Home listing all three.
- After the restart: the same revisions, the view reading again, and the phone
  layout with no sideways scroll.

Screenshots and run records are in `evidence/flexible-work/`.

These checks run against synthetic data published through the controlled
path. They aren't model usefulness evidence. Hermes's live model-made records
are covered only through the DOM fixture, and Andrew's experience review is
still untested.

## Update: the live model-made records in the real app

`web/scripts/flexible-live-records.mjs` takes the backend owner's retained
model-made venue table and view (`evidence/flexible-work-13`) and republishes
them unchanged through the controlled path into a fresh stack: real API,
PostgreSQL, the controlled consumer and the production web app, with zero
provider calls. The view's script hard-codes its original
artifact/revision/hash, so only those three strings are swapped for the
fresh records' ids.

- The table renders by its declared fields, edits and fits on a phone.
- The view reads the saved table through the broker and filters live:
  - at £300, 70 people and step-free: no venue;
  - at £350: Willow Hall and River Centre;
  - at £300 without step-free: Station Loft.
  - It fits on a phone with no sideways scroll.
- **Finding (backend/model policy).** The generated view checks every read
  against the exact ids it was written with. So after a person edits the
  table, re-pointing the view ("Use the latest saved versions") would make it
  refuse its own, correct, data.
  - **Frontend mitigation.** When a view's own code names the exact version it
    reads (`pinsVersions`), the shell doesn't offer the rebind. It says the view
    was written for the earlier version and to ask for an updated view.
  - **Suggested policy fix.** Generated code should trust the host-validated
    read (by `binding` name) rather than embed ids. Then a human edit can be
    followed by a simple rebind.

Screenshots and the run record are in `evidence/flexible-live/`. This is a
replay of retained model output, not a new model run, and it isn't usefulness
acceptance.
