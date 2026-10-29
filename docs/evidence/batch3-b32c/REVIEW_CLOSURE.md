**PASS — both original P2 findings are closed.**

- Full `unavailable` receipts now say **“outcome uncertain”**; the short variant says **“no execution receipt.”**
- Download failures invalidate the scoped attempt and hide stdout, provenance, and download controls. Successful refresh restores the receipt; unmount guards discard stale download completions.

Reviewed current code and focused tests; no tests rerun. Browser proof remains the parent’s separate verification. No edits, network/product calls, or private-oracle access.

Current SHA-256 hashes for closure-reviewed files:

```text
4194ef38690aac197e16cd9a8e6d1afb3b808bb16e1dd90b0988fab46cb47ba1  web/src/components/ToolActivity.tsx
85d3a0ff80fe9238a0598aeb325ce2e2b9beaae36ebc2157f49c86eeccc3e78f  web/src/components/ComputeReceipt.tsx
ddd3de464357a3ae39c869c5ab13623b7c892446fc08b1e03ac1f011df73ba13  web/src/lib/tool-activity.ts
43255b940ad2b9c221e77c44b0401abaad474902e2314ced07ea8ab8e2e29a9f  web/test/tool-activity.test.ts
d6b1f4d24727fe22ca2971db3636225400a561a3f18bb74e0616e17c0b0afd32  web/test/compute-receipt.test.ts
```