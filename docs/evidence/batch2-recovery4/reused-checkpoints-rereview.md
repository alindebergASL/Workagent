**HOLD — one material finding.**

**P1: revoked or unavailable sources can indefinitely block unrelated queues.** At [conversation_intents.py:126](/home/ubuntu/workagent-continuation-20261026/backend/workagent/conversation_intents.py:126), `_owned_conversation()` still checks current source access/availability before the per-entry error handler. Revocation or unavailability raises, leaving that entry `pending` and aborting the remaining scan. With fewer than 50 conversations, the cursor resets each time; later authorized queues repeatedly starve. The dispatcher silently catches the error.

Reproduction: queue entries in two conversations ordered A then B; revoke A’s selected-source access while preserving workspace membership; drain. A prevents B from advancing on every tick. Preserve ACL enforcement, but contain the failure per conversation and retain an appropriate hold.

The reported source-version correction checks out. Completed the remaining static review of checkpoints, successor admission, retained-result authorization, duplicate/cancel behavior, schema opt-in and cumulative accounting; no additional material findings.

Reviewed uncommitted B24 against `c75fb58`, excluding document/TUI work. No edits, tests, network, services, DB, credentials or product calls.