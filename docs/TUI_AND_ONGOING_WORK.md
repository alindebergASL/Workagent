# B2.2 conversational terminal client

This is the isolated B2.2 client implementation based on `c75fb58`. It changes no
web, server endpoint, runtime, database, authority, worker or provider behavior.
It does **not** claim integrated completion: the starting server at `c75fb58` lacks
authenticated principal discovery, so this client deliberately locks durable draft
restoration and writes against that server. The parent owns integration and PG proof.
During this slice, an external writer added the principal header to `api.py` and
created `test_tui_real_stack_pg.py`. Those files are outside this client author’s
diff and were neither edited nor executed by this slice.

## Launch and identity integration

The optional dependency set is `backend/requirements-tui.txt`, with the retained
pinned `requirements-tui.lock` (Textual 8.2.8). Existing service/CLI installs do not
import Textual. After installing that optional set in the backend environment:

```sh
PYTHONPATH=backend backend/.venv/bin/python -m workagent.operator_tui --workspace WORKSPACE
# Explicit fallbacks:
PYTHONPATH=backend backend/.venv/bin/python -m workagent.operator_tui --workspace WORKSPACE curses
PYTHONPATH=backend backend/.venv/bin/python -m workagent.operator_tui --workspace WORKSPACE conversations
```

Use the existing loopback `WORKAGENT_OPERATOR_URL` and environment-only
`LOCAL_BEARER_TOKEN`. No credential is written into drafts or command envelopes.
The client currently expects `X-Workagent-Principal` from an authenticated API
response to `/v1/workspaces/{workspace}/execution`. **The starting base does not
emit that header; the separately written parent integration now adds it.** The
client never substitutes a workspace/conversation owner, configured default, arbitrary principal string, or bearer hash. Read-only
browsing remains available; writes and draft restoration fail closed. A parent
integration must expose authenticated principal identity, or supply an equally
trusted transport identity method, before claiming the live TUI works end to end.
No server/header implementation is included or represented as complete here.

## Conversation and retained work

Home starts a new conversation by typing. Named work has a search field and a
selector; discovery sorts the loaded items by updated time. Enter inserts a line;
Send, F5 and Ctrl+Enter send. F5 works in terminals which cannot distinguish
Ctrl+Enter. Ctrl+Q and Detach leave all server work running.

The mounted composer keeps its focus, cursor and selection during reads. Plain
Unicode, whitespace, mixed CR/LF, BOMs and Unicode separators are retained exactly
by a plain document adapter pinned to Textual 8.2.8. Rendered terminal controls,
OSC/CSI introducers and bidi formatting are escaped. Escaped control characters
occupy extra display cells, so cursor geometry around those unusual pasted
characters is approximate. Ordinary Unicode editing is unaffected. Rich markup
is disabled for untrusted content; result/source/code content never executes.

Conversation pages show 40 messages, with Earlier/Later controls and a 120,000
character rendering ceiling. A limit is labelled; Details retains the fetched
response. Saved work opens readable document blocks, all table cells and notes,
files and inert source/fallbacks. Wide tables use labelled stacked rows, preserving
all cells at 80 columns. The 80×24 and 120×40 layouts keep the composer and Send
visible; content panels scroll independently.

The Work panel has exact revision/history selection, human-current versus earlier
labels, and an explicit Use as target action. Selecting a revision alone does not
change the send target. The retained artifact/revision/hash is shown separately.
Proposal selection shows the full current, exact base and proposed bodies, latest
versus earlier labels, and the server's total removal count versus bounded sample.
The two acknowledgements start unchecked. Changed candidate/current/policy identity
resets both. Accept uses the selected proposal and its exact base; it never rebases
or manufactures consent. A stale candidate cannot be accepted through the button.
Accept/dismiss remain journaled writes with exact replay semantics.

Discovery is bounded to 16 pages per collection (400 items at the current default
page size). Search is over that loaded sample, not a server-wide search. An exact
selected revision/base outside the loaded history is read separately. Server-wide
recent ordering/search or explicit pagination beyond the sample remains a gap for
large workspaces. Artifact/proposal bodies come from current HTTP endpoints.

## Durability, concurrency and recovery

`WORKAGENT_TUI_DRAFTS` defaults to `~/.local/state/workagent-drafts`.
`WORKAGENT_OPERATOR_JOURNAL` retains its existing separate default. Both contain
private unredacted user work. Directories must be owned by the current user and
mode 700, records mode 600 and single-linked. All path components use no-follow
handles and owner checks. Writes use a bounded temp file, fsync, atomic replacement
and directory fsync. Corruption, unsafe paths/modes or scope mismatch fail closed. A digest comparison
also refuses stale saves from a second terminal, preserving the first terminal’s edits.
There are at most 64 conversation drafts in a scope document, 256 scope records,
and a 1 MiB serialized bound per record. Capacity errors preserve the last durable
state and block sends rather than discarding retained content.

A scope includes endpoint, workspace and authenticated principal. It retains the
selected conversation, exact text, attachment snapshot content, target, displayed
work version, draft generation, pending command identity and creation stage.
Attachment bytes are reconstructed exactly from retained UTF-8 text, including
BOM/CRLF. The original path is never persisted or reread for send/replay. Stage,
preview and remove are local actions. Combined snapshots obey the existing input
contract; preflight also measures the **actual serialized HTTP bytes**, including
JSON escaping, against the 256,000-byte API limit.

A send validates before setting its durable pending marker, reserves its immutable
journal envelope before HTTP, and posts once. New format 3 adds principal scoping,
structured snapshots and explicit caller-displayed versions. Format 1 and 2
validation and wire serialization remain frozen. The client does not fetch a fresh
CAS behind the user's view. Exact readback matches the receipt message's ID, text,
target and snapshots before clearing; edits made during send increment generation
and survive. Failed durable completion rolls back the in-memory clear as well.

A successful create followed by an interrupted follow keeps the created identity.
An uncertain create remains locked until explicit journal recovery; it cannot
silently create another conversation. Recovery offers Inspect, Read back and Replay
exact. Read back requires a retained receipt and performs no POST. Replay posts
only the validated retained envelope once. A pending marker with provably no journal
envelope can be released without sending; corruption is not treated as absence.
Unknown outcomes stay locked against fresh sends. Definite HTTP rejections also
remain retained/locked in this implementation; there is no UI action to abandon a
known rejected command. This is conservative and can require operator handling.

One tracked concurrent future owns the read executor until its actual function
returns, even if the asyncio awaiter is cancelled. Refreshes coalesce, and typing
never awaits HTTP. One write executor is shared across all panels/conversations;
new sends are refused while a write is outstanding. Writes wait for the read lane
before starting, so write readbacks do not overlap refresh reads. HTTP responses
are bounded to 8 MiB and socket operations use the existing 15-second timeout.
Bounded multi-page reads can exceed a polling interval; they do not spawn more
threads or fabricate progress. There is no durable send queue.

Status reads the existing `/execution` endpoint, including its server timestamp,
conversation run sample, next action and local read age. Work-context responsibilities
show lifecycle, wait and check-in data. Available model and response-step reservation
fields are shown, with unknown/not-exposed values and reservation-versus-billing
labels. Admission receipts never imply execution. Active workspace execution uses
2-second polling, idle 15 seconds, failures 30 seconds. During active execution for the selected conversation, Send is
labelled Redirect; this describes existing superseding-send semantics, not a queue.

## Verification and remaining integration

Focused local tests use `backend/.venv` and fake HTTP only. They cover private draft
restart/scope/path/mode/corruption, exact attachments after deletion, displayed CAS,
unknown create/follow recovery, pre-journal failures, edit generations, fsync failure
rollback, cancelled read bounds, typing while reads/writes block, cross-conversation
write serialization, narrow layouts, terminal controls, full comparisons/history,
and consent reset. Existing operator/replay/review checks are retained unchanged.
Final local verification: **120 focused tests passed** in 116.25 seconds, plus
**1 targeted Redirect-label regression passed** after its final correction (121
unique checks). Compile checks and `git diff --check` also passed. These results
use the sandbox ownership shim described below; no PG result is claimed.

Example command on a normal host:

```sh
PYTHONPATH=backend backend/.venv/bin/python -m pytest -q \
  backend/tests/test_operator_client.py backend/tests/test_operator_replay.py \
  backend/tests/test_operator_review_ack.py backend/tests/test_operator_attachments.py \
  backend/tests/test_tui_state.py backend/tests/test_tui_review.py \
  backend/tests/test_tui_composer.py
```

This sandbox maps the read-only `/home` and `/tmp` ancestors to UID 65534. The
existing production journal correctly refuses them. Local test execution uses an
external `/tmp/b22_root_owner_compat.py` pytest fixture which maps **only those two
host ancestor fstat results** to root; actual draft/command directories, file owners,
modes, symlinks and hardlinks remain checked. No production check was relaxed.
Run without that shim in the parent's normal environment.

`backend/tests/test_tui_http_pg.py` is authored for the parent to provision/run:
real FastAPI/PG, lost post acknowledgement, immutable attachment replay after path
deletion, and stale displayed CAS without hidden GETs. It explicitly asserts the
format-3 protocol independently of the UI. It has not been run in this slice. No network,
product-model calls, web checks, service operations, commits or pushes were made.
Physical terminal and parent-integrated API/PG proof remain outstanding.


## Client-author file boundary

- Additive client protocol changes: `backend/workagent/operator_client.py` and
  `operator_journal.py`; default Textual/explicit legacy routing in `operator_tui.py`.
- Finished retained prototypes: `operator_attachments.py`, `tui/app.py`,
  `tui/safe_text.py`, `tests/test_operator_attachments.py`, `test_tui_composer.py`.
  The existing optional requirements files remain intact.
- New client modules: `tui/drafts.py`, `session.py`, `transport.py`,
  `presentation.py`, `widgets.py`.
- New focused checks: `tests/test_tui_state.py`, `test_tui_review.py`, and
  parent-run `test_tui_http_pg.py`.
- This document is the only documentation path changed by this author.

Concurrent external files observed and left untouched: `backend/workagent/api.py`,
`backend/tests/test_responses_leases.py`, `backend/tests/test_tui_real_stack_pg.py`.
No commit, push or staging operation was performed.
