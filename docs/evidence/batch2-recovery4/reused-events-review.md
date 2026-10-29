**HOLD — one material defect.**

- **P1: SSE emits buffered events after revocation.** [work_event_api.py:48](/home/ubuntu/workagent-continuation-20261026/backend/workagent/work_event_api.py:48) yields the remaining batch without rechecking credentials or event/source access. The heartbeat at [line 56](/home/ubuntu/workagent-continuation-20261026/backend/workagent/work_event_api.py:56) also lacks fresh authorization. A slow consumer can therefore receive protected metadata after revocation. Reauthorize before each event and heartbeat, discarding buffered data on denial.

An offline reproduction emitted a second event and heartbeat after simulated revocation, then emitted `snapshot.required`. The existing revocation test uses `limit=1`, so it misses this within-batch case.

No additional material defect established in the scoped review. No edits, network, credentials, services, or product calls; parent PostgreSQL results were not rerun.