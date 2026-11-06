**REVIEW_CLOSURE.md — PASS for narrow code closure**

Continuation of the same Astra/high review against HEAD `e1db70df77957de6aca842bc6f47ebb0f133008e`. P1/P2/P3 are closed in the reviewed corrections. No remaining blocking regression was identified in those fixes or the working-file citation integration.

**This is conditional source-review closure, not full B3.2a acceptance.** The parent’s final working-file browser proof and updated source/evidence bindings remain outstanding.

- **P1 — Closed.** Migration 060 checks research dependencies and follows retained `read_result` dependencies transitively with cycle-terminating recursive `UNION`. Checks cover shared observation reads, retained-result authorization, `Ledger._auth()`, and SQL `count_send`/`dispatch` boundaries. Historical receipts and accounting remain intact; authorization checks do not impose current-revision citation CAS.
- **P2 — Closed.** Web readers handle canonical 404 alongside 401/403, clear dependent claims/quotes/snapshots, and advance an abort/generation fence so pending successes cannot restore cleared content.
- **P3 — Closed.** Source and citation views provide explicit metadata refresh, including empty/error states. Refresh clears the prior projection and reads saved records for the same binding without fetching the public web or changing human work.
- **Working-file consumer — Source review passes.** `WorkspaceFiles` mounts `ArtifactCitations` using the loaded saved version’s canonical artifact/revision/body hash. Dirty text does not change that binding and is explicitly labeled. Moved/unavailable heads cannot silently bind another revision. Targeted tests cover binding, dirty-text preservation, refusal/moved head, and rebinding after save.

**Evidence and limitations**

Read the saved review, `VERIFICATION_HANDOFF.md`, correction code, targeted regression assertions, and sanitized evidence:

- `focused-08.log`: 37 passing tests.
- `revocation-exact-09.log`: two passing prepared/count-state regressions; two deselected.
- Document browser log/proof: mounted refresh and actual canonical-404 clearing with unchanged artifact revision/body hash.
- Migration proof: current migration 060 checksum and `restricted_runtime_verified: true`.
- Visually inspected narrow-width document citations and the cleared view with an access-change notice.

These are inspected parent-generated artifacts, not independently executed tests. Native journey results remain attributed to the handoff. No runtime tests, network/product calls, implementation, service operations, or additional broad review were performed.

The final working-file browser verification was active; its result is **not asserted**. Existing document proof does not substitute for that consumer proof.

The existing source manifest differs from current reviewed source in exactly two later consumer files:

| File | Existing manifest SHA-256 | Reviewed SHA-256 |
|---|---|---|
| `web/src/components/WorkspaceFiles.tsx` | `ffd14405b1deb7ed00f9aa467e144c9d1d9a273a0d25a68d4aaf5918f78a09a5` | `a7b5b913d66047c84ae9385bc5fbaf9cbb2b6a8306847644806ccca9422cf5f7` |
| `web/test/workspace-files-races.test.ts` | `52d793194eed1881bdec6fcccbc824485ed6434f6e38edbac5ae55dc25425f1b` | `d04855503575985880cb01251042c3c90d0fb8b766dc518a5ca12b53ac9530b5` |

Bind the completed consumer proof/build to these reviewed files and update the evidence package while preserving earlier results. No reviewed correction changed between initial capture and closing rehash.

**Reviewed correction and supporting source hashes**

```text
4bec30ad96a0f50875ee468fae4edb0e1f33b7d3c0595b2ab2dfa23de4b32dc3  backend/migrations/060_research_dependency_visibility.sql
c285da50e63dca8e7d41253bd095021394610b6d5811846a9773a71b2c7740f0  backend/tests/research_http_fixture.py
8f397ea12961d23db3b97d9415cbfbebc9562e226bf8d5ce0a1c9e80d16fe648  backend/tests/test_research_http_pg.py
f381e8312433958c9b280167a5417515f9a564272977a102aa52bac7186bb3bf  backend/tests/test_research_revocation_pg.py
4455b64aa5d167dc5d8399eea67c73419fcfcdff323d57dc7ce22c5d6fbcedd9  backend/workagent/capabilities/observations.py
c3e2b657bc2358f1731dc1821f872a99d89138a7f30b97dce2936895a68a6ba6  backend/workagent/capabilities/research_adapters.py
cc6a278fb98e05c31fa04efeef8351b2c49b4e79f9052a828bb8e158f61b8c95  backend/workagent/research.py
5d184f69f7f59da25330d34a3d33de5029c56c916f0dad9552b478cdafa5e0d7  backend/workagent/responses_ledger.py
b4578a6db038c561d568fc0ca8c9d3d6e07fb65f6acdf6a1305099ee194300dd  backend/workagent/retained_results.py
9c9176d1e88a3690c8b25a8504db97dd35f366418fcaa36f3eb127eb16e09523  contracts/capability-registry-v2.json
4a611d3d1650ad0d49ac75813f6c2522196b5afadb335fd0eb99f71804150f65  web/src/components/ResearchSources.tsx
a7b5b913d66047c84ae9385bc5fbaf9cbb2b6a8306847644806ccca9422cf5f7  web/src/components/WorkspaceFiles.tsx
2fd1d78f8e328aa65ba80eb944ae2f69ef0cc9cce2fb67381fda857a56f313eb  web/src/lib/research-readers.ts
c6aef4ec3ee10dead8a69a1e4058bf312a7fbc37a73a35dcc1f8a823f1d34e98  web/test/research-readers.test.ts
d04855503575985880cb01251042c3c90d0fb8b766dc518a5ca12b53ac9530b5  web/test/workspace-files-races.test.ts
```

**Inspected report/evidence hashes**

```text
16ab46a7dc4137a0a30a95ddaf2e18365c234439b27d10be3e24d0976cb2d4a5  .local/batch3/b32a/REVIEW.md
daf8d79fb1f48f15dbe56658c301ecc80e10423ad44bf0c93211e4f4cee3146e  .local/batch3/b32a/VERIFICATION_HANDOFF.md
03ba017b69ec79e92b5dab042adbab84847534583088c8a267a481a7ccbb6f40  docs/evidence/batch3-b32a/SOURCE_MANIFEST.json
d49aa712b39a6552fe9ce0008c8d1d00bb280b78d0c0e58212766ac935cc9781  docs/evidence/batch3-b32a/EVIDENCE_MANIFEST.json
d629112fe91b65b034c8866eb17b6dd05f2b1924a4e5c6f450133737eafcbfd5  docs/evidence/batch3-b32a/checks/focused-08.log
779b0cd955397cbbed6954ca28a906e0b94a3876250912c0c1db2f88afae553b  docs/evidence/batch3-b32a/checks/revocation-exact-09.log
3da23e2ef19b62d803c57afdea2bb3391d0b88dc4ddb6e5d6ba4ac6985afe5f5  docs/evidence/batch3-b32a/checks/browser-document-05.log
f66a834053c62f96f9cefb4205414e8a466a4d041383d757db2a14cfd8df5202  docs/evidence/batch3-b32a/browser/document-proof.json
ee2f1108918a12de51e6ec336cb3c3a0f27520da93af9d2ed608d00ed511e3ed  docs/evidence/batch3-b32a/browser/document-citations-320.png
1d622fb938b214088e5b1ab3ad2750f67cced3fd389699fc8d52306168563166  docs/evidence/batch3-b32a/browser/document-real404-cleared.png
```

Delivered here for `.local/batch3/b32a/REVIEW_CLOSURE.md`; no file was written under the read-only sandbox.
