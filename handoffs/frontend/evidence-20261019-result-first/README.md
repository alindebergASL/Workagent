# Result-first responsibility page and Home: evidence for e16c9e5 (web tree)

These screenshots come from the real local stack: FastAPI, PostgreSQL and the Next.js production build with demo and natural-admission flags. No model or provider was called.
- **Fixtures.** `web/scripts/space_demo_fixture.py` seeds the made-up demonstration projects. `web/scripts/responsibility_result_fixture.py` seeds a responsibility that prepared two results through the real follow-through path, with synthetic provider transport.
- **Not the live candidate.** None of these screens come from it.

| File | What it shows |
| --- | --- |
| 01 / 02 | Home on desktop and at 390 px wide. "Needs you" holds only decisions; responsibilities waiting on someone else or on a check-in are under "I'm keeping track of". |
| 03 | A responsibility that has prepared work, on desktop. The page reads in this order: its recorded outcome; "Prepared for you", with each result opening at its conversation address; then one steering block. |
| 04 / 05 | The same page at 390 and 320 px wide, with no horizontal scroll. |
| 06 | A responsibility that is waiting on a person, with nothing prepared yet. It has no empty "Saved work" section. |

The checks behind this are in `web/scripts/responsibility-result-journey.mjs`, which ran on the real stack.
