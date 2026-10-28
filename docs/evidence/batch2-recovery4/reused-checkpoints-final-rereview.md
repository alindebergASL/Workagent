**PASS — narrow static correction rereview.** The sole finding in `.local/checkpoints-rereview.md` is resolved.

- [Per-conversation handling](/home/ubuntu/workagent-continuation-20261026/backend/workagent/conversation_intents.py:126) catches the specified denials inside a nested transaction, retains `held/scope_changed`, and continues before admission.
- Current owner binding and source ACL/availability checks remain enforced; work version, access generation, source freshness and fingerprint checks still gate admission.
- [Regression tests](/home/ubuntu/workagent-continuation-20261026/backend/tests/test_b24_queue_isolation_pg.py:10) cover revoked/unavailable sources, independent admission in the same scan, unchanged subsequent admission, denied queue reads, and zero denied-conversation runs.

Evidence limits: code/test inspection only; tests not executed. No broader audit, edits, network, services, DB, credentials or product calls.