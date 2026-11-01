**HOLD on successor activation; continuation projection passes static review.** Accepted gateway075 and observer closures remain unchanged.

Two material defects in [amend_discovery_continuation.py](/home/ubuntu/workagent-continuation-20261026/evaluation/amend_discovery_continuation.py:100):

- **Application hash checked after activation:** lines 109–112 replace the application and publish the approval marker before verifying `application_after_sha256`. Validate the exact replacement bytes before any replacement, then verify installed state before publishing approval.
- **Interrupted activation cannot resume:** interruption after application replacement fails the predecessor-application guard on retry; interruption after manifest replacement fails the predecessor-manifest guard. Support exact, hash-verified intermediate states and idempotent completion, retaining predecessor evidence.

The projection validates v2 before removing schemas, preserves legacy and denial distinctions, labels omissions, and retains identity/schema pins, availability and effects without an empty-array fallback. Immutable receipts remain untouched. The full failed snapshot and current product inventories match their bindings; only `adaptive.py` differs. Successor activation contains no SQL, provider, accounting or certificate operations.

Exact reviewed SHA-256:

```text
backend/workagent/adaptive.py
19aefd1e768a190c6a2d94b135309e26a66d1725cccf476dffeada7b0e276ea4

backend/tests/test_discovery_continuation.py
b17d133f32d1f9d16f296965b8dc736f53cb4d4f49ec3cc700431e4c39e837eb

evaluation/amend_discovery_continuation.py
47e67ecbd305e0cf5e2731735cd5fb6efa9d61ca0083938f29332f06c0c8f702

CANDIDATE.json
bf2c4f5e3f256f7a82449f82c8c01f86c254779e025b08ce89c1414b9aac167a
```

Static inspection only; recorded nine passes, prior failures and 23-descriptor retained reply inspected. No tests, edits, DB/network/provider/credential access. Limits unchanged; full12/72 remains incomplete. Development/review model costs remain outside the product ledger.