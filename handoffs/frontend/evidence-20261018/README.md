# Evidence for b957709 (web tree), 2026-10-18

These screenshots come from the real local stack: FastAPI, PostgreSQL and the Next.js production
build with demo and natural-admission flags. The fixture is `web/scripts/space_demo_fixture.py`
(made-up demonstration data, no worker). No model or provider was called. These screens are not
from the live candidate.

## Desktop, 1440 wide
| Screen | What it shows |
| --- | --- |
| d01 | Home, including "Starts in" and what the service says about that workspace. The fixture has no grant, so the note is true. |
| d02 | The project, found from "Your work" in the sidebar. |
| d03–d05 | The work page shows the result first. The decision card states plain provenance, then Changes, then the result after applying. |
| d06 | Editing. |
| d07–d08 | After a person changes a value, the changed cell is marked and the note says what hasn't been recalculated. "Ask Workagent to recheck" fills the reply beside the work; nothing is sent. |
| d09–d10 | Returning to Home, then reopening the work. |
| d11 | A responsibility: what it waits on, what's next, Checked · Check again, the controls, and Details. |

The stop-and-carry flow (`?stop=1`, then End, then the draft waiting in Home's composer) is
asserted by `conversation-journey` on the real stack. It has no screenshot here.

## Phone, 390 wide
| Screen | What it shows |
| --- | --- |
| p01 / p01b | Home. |
| p02 | The work as cards, with the edited value marked. |
| p03 | The Work/Conversation switch. |
| p04 | A responsibility. |
| p05 | Spaces. |
