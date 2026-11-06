**HOLD — RR1 passes; RR2’s navigation fence is repaired, but late UI updates remain unguarded.** All five files match the manifest’s `after` SHA-256 hashes.

- **RR1 PASS:** Evidence carries its resource key, and render-time `currentFor(evidence, key)` rejects old-key evidence before passive reset. Request generations and abort checks prevent superseded completions from replacing data or freshness.
- **RR2 residual:** Layout-effect selection and cleanup correctly invalidate workspace/epoch on switch and unmount. Success/error guards prevent stale chat settlement and navigation. However, [Composer.tsx:507](/home/ubuntu/workagent-continuation-20261026/web/src/components/Composer.tsx:507) unconditionally executes `setSubmitting(false)` and `rerender` in `finally`, including after either guard returns. A late A completion therefore still updates the mounted Composer after switching to B. The claim that late promises cannot update UI is not fully satisfied.
- Added regressions cover before-reset key changes and delayed success/error after simulated unmount. They exercise helpers, omitting Composer’s unconditional `finally`.

Verified hashes:

```text
web/src/components/Composer.tsx
54be7db66700024af3f0b5bd60962b88e80198cc719deaa148f8053db11ff82e

web/src/lib/client/home-start.ts
a7433d611d1a6a741655733d2dcba72ac969c2eb2cbd32ca84bfd4e0ef3fc576

web/src/lib/client/hooks.ts
227a07c7ea24e1cbdd1b94cf6cc5720ac4aed3fc379bf9e6a6016dd879a43961

web/src/lib/client/resource-freshness.ts
dd5ee4c68077163745c2ac3fe6dd9cec3afc6c06537f8f47075229c37eb385b0

web/test/b2-correction.test.ts
3fec1e5a70ff39b7169bb08e3c2c053a4034f97db5ef6bd1abfc602ad35d802b
```

Source-only review: no changes, tests, builds, browser, services, generated-file inspection or secrets accessed. Broader R1–R4 and type/upload conclusions remain retained. Parent gates and downstream mounted/browser proof remain separate; their absence does not cause this HOLD.