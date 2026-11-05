**PASS — both activation findings closed within this exact static review.**

Replacement bytes are validated before mutation. Only exact ordered states are accepted; application and manifest are read back before approval. Interrupted transitions and completed activation support retry. Tampered states and premature approval fail closed.

Projection and prior closures remain unchanged. Manifest changes only the activation-script hash and new test binding.

```text
evaluation/amend_discovery_continuation.py
cba7973805af3660de277efc66e529e69410e06e378c189f9fa98a6bdd833bec

evaluation/test_discovery_amendment.py
4fb8b59ff57e4b30c9435acf761a462ec18c5f246e59f7df5cd11284c0371560

backend/workagent/adaptive.py
19aefd1e768a190c6a2d94b135309e26a66d1725cccf476dffeada7b0e276ea4

backend/tests/test_discovery_continuation.py
b17d133f32d1f9d16f296965b8dc736f53cb4d4f49ec3cc700431e4c39e837eb

CANDIDATE.json
6237bf590c16c1264afe0a00094d135e14614f70ded22c26d3b22d7deee7d7a9
```

Recorded 16 passes inspected, not rerun; prior nine PostgreSQL passes reused. No edits, tests, SQL/provider/network/credential access. This closes only the two findings; activation and full12/72 acceptance are not claimed.