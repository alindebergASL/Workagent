**HOLD — source-version drift prevents queue cancellation and aborts draining.**

[conversation_intents.py:17](/home/ubuntu/workagent-continuation-20261026/backend/workagent/conversation_intents.py:17) makes `_owned_conversation()` require fresh source versions. If a selected source changes while owner/access remain valid, `_source()` raises `source_changed` at [service.py:97](/home/ubuntu/workagent-continuation-20261026/backend/workagent/service.py:97).

Consequently:

- Queue draining fails at [conversation_intents.py:124](/home/ubuntu/workagent-continuation-20261026/backend/workagent/conversation_intents.py:124), before the hold/error handler. The entry stays `pending`, and remaining conversations in that scan are skipped.
- The owner cannot cancel that entry because cancellation invokes the same check at [conversation_intents.py:75](/home/ubuntu/workagent-continuation-20261026/backend/workagent/conversation_intents.py:75). Queue listing and exact STOP are also blocked.

This violates the required stale-input hold and exact cancellation behavior. Separate current ownership/access checks from execution freshness checks; handle source drift inside the drain’s hold path. STOP checkpoint creation also needs to tolerate stale source versions.

Stopped early on this material issue. Static review only; no edits, network, services, credentials, product calls, or test execution. Remaining areas are not certified PASS.