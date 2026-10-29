**Implementation risk: FAIL — three concrete findings.**  
**End-to-end acceptance: PENDING**, including production browser/native PTY journeys and render inspection.

Reviewed branch `hermes/b2-conversational-client`, HEAD/base `cac4b343091db6d7d443d656f34f6ba548936c79`. Read-only: no edits, commits, services, DB writes, or paid calls.

1. **P2 — Web clears the copy command before verified recovery completes.**  
   [office-export.ts:494](/home/ubuntu/workagent-continuation-20261026/web/src/lib/office-export.ts:494) clears the journal before validating readback; [FileExport.tsx:559](/home/ubuntu/workagent-continuation-20261026/web/src/components/FileExport.tsx:559) subsequently opens the copy. The actual component-handler reproduction produced `pending=undefined` after an opening failure, then POST IDs `cmd-1`, `cmd-2`. Production [WorkspaceFiles.tsx:112](/home/ubuntu/workagent-continuation-20261026/web/src/components/WorkspaceFiles.tsx:112) also swallows list failures and selects an ID without confirming it is present.  
   **Fix:** durably retain the acknowledged command/result until exact copy readback succeeds. Keep mismatches unresolved; make failed opening retry the existing result without creating another copy.

2. **P2 — Web accepts mismatched provenance and chart input hashes.**  
   [office-export.ts:543](/home/ubuntu/workagent-continuation-20261026/web/src/lib/office-export.ts:543) accepts an editable copy with the wrong source snapshot, extraction hash, workspace, and conversation. [office-export.ts:386](/home/ubuntu/workagent-continuation-20261026/web/src/lib/office-export.ts:386) accepts a chart whose `input_sha256` differs from the requested saved CSV. Both actual helper reproductions returned `null` (“no problem”); existing success fixtures themselves contain mismatched bindings.  
   **Fix:** compare copy provenance against the exact source snapshot and authenticated scope; compare chart input hashes for the supported saved CSV/typed-workbook path. Add negative readback tests and retain the journal on refusal.

3. **P2 — New Office inspection breaks previously supported BOM-prefixed JSON.**  
   [workspace_files.py:41](/home/ubuntu/workagent-continuation-20261026/backend/workagent/workspace_files.py:41) reparses the original string without removing its UTF-8 BOM. Reproduction with `\ufeff{"a":1}`: existing `validate_text` accepts it, but `text_body` raises `validation_error`. Existing BOM-preserving JSON drafts therefore cannot be saved.  
   **Fix:** inspect a BOM-stripped parsing view or UTF-8 bytes while preserving original content and hash; apply consistently to Office revision/proposal validation.

No additional concrete confinement, transaction-fencing, revocation, or download defect was established in this review. This is not independent execution proof of the parent’s PG/confinement results.

Verification: **19 focused unit checks passed**, canonical contracts matched, and `git diff --check` passed. Initial pytest collection lacked `PYTHONPATH`; the corrected invocation passed. The parent’s reported broader totals remain separate evidence.

SHA256 manifest below covers **47 changed/untracked files**, excluding the preexisting `contracts/pnpm-lock.yaml`. Manifest digest, using exactly `hash␠␠path\n` per entry:  
`2ad7c3b23d357f96d19862f1b3022b0372fc5bbc3e445fb583d5de3f790fbbd4`

```text
ce4a6e2cbc5e70bf4880e1db5c1b0a448f51a8f314f7291dd19e216159cd0b37  backend/export_contracts.py
b38984f4ab3b145e1eaed906b7ab4fcbae15fc2a286733f0a98653da5892acc0  backend/migrations/061_office_outputs.sql
ea04a15df1a30fde5d2606cfb3681d898e4f7a3289cb72ed8673851fd346d305  backend/requirements-office.lock
aeb12d0374a048369428083d78a7e138aefeae9846e5483be8d0fba7dcf3a6a0  backend/requirements-office.txt
438d18e054f1127ead9a6f96704d19af33857d2a97e8ad49f8a11da95cb9088f  backend/tests/test_office_acceptance.py
41517df0a5f58dba6e68c9cca1361f34df163dfc286e813bca7e47a757ee3c5b  backend/tests/test_office_parent.py
1970ae16b97a3f2318ac33fa088fbba275c5fa425832b0cf5781cbbdab692001  backend/tests/test_office_pg.py
a8898222fe7b430391eb1a128eb99090f860845ae4dbfc42f1f724d54957ab2a  backend/tests/test_office_unit.py
71d348cea0dd2d08271d7af4467385283c32fbae6ebc4b064fc62715ca4ed10c  backend/tests/test_tui_files.py
28b6fc4a55bf647670416e6ccb5b312839caa95b734cb156dc143c349f28908b  backend/tests/test_tui_office_files.py
0f44a140b0facc5839a26f080bb9d870dd8c0967c2825c9bad1db18bbc40a44f  backend/workagent/adaptive.py
6c9d54b25c691e1187bab9c392c95b09658f6e157e33a27351eb9f6727d29f37  backend/workagent/artifact_exports.py
d77b49356a239dd04e20b3aae2cf30c252811a78c6c310a559ea49ff52e2d1b9  backend/workagent/capabilities/broker.py
f8c727bba20dc8c6d8dc5f84822a0f220ab633954a7f7e842317455170cf4f0b  backend/workagent/capabilities/compute_adapters.py
4f5b25fa9dedf897af5b4ac4644e1fdc0d7de7f992e639c46b03a12ecdb6ef12  backend/workagent/capabilities/file_adapters.py
44a46891d5b20bf6ecd7fe682a4be5616cbd1d275c8e00373d02cb357fae12bc  backend/workagent/capabilities/office_adapters.py
2c01215fb0cee96a7c2dc2f5e651f14c15a8d374299b239267f3cdb8f0304ea2  backend/workagent/capabilities/office_composition.py
9321868aa2d487c4bcba84ea1da8628d67979628f4439643fd56367fff9e3214  backend/workagent/capabilities/policy.py
515e50873dd147600b7564150d28778a7548be672cebe2bfbe779754264b0098  backend/workagent/capabilities/registry.py
a83f1b09a621889e6761d8f466deb6da313985f678a134d74c8b0f1a77361d99  backend/workagent/capabilities/research_composition.py
5553508a93151c50232e250eadce9754a27eebe61cdbd97b65354f2caf103df8  backend/workagent/document_sandbox.py
f06a77db31ed09acc96dc2932658131b3e8664b22b0c1c693cd100adf1daa2c4  backend/workagent/general_responses.py
3a43436026bfeac67e13f73d220af3aadc4ffcef924cb443539f3b3c5fdc4639  backend/workagent/office_content.py
7eeb08f65d74fb1d0a927edb79a95177b4e7ffd378cc2f7855941d86d90459ad  backend/workagent/office_converter.py
afc5fafcf66128266db37617a9dcd9633603a5339c23aae8861fa142bd227e8e  backend/workagent/office_models.py
0a63ad941f59ea2a3ed8661932e39afefe30f66fc507a8e22b01e7483d18e7fb  backend/workagent/office_sandbox.py
48a57effa682ff865f5bf1fbbc3bcfb0041376900dd9c6b02e4066bde1bf5ece  backend/workagent/office_service.py
11791d13df73c7cadde2364907fa7c05de8c1eea1880ee35280426d7ebf910ee  backend/workagent/service.py
f57597a1997b9547b0121d13d97831529ad5fb93f734f77989c4eb72aab14feb  backend/workagent/tui/file_drafts.py
4bc38bcb69b175cf38bf5932f429fed8b8be6ae296f7a233b7f778cca0a9e8b4  backend/workagent/tui/files.py
057c11543d3570367c4db71062d534d2b84aea1166d16eaa75eafaa864becde7  backend/workagent/tui/files_screen.py
7e62c96482f5dde5af5d6480c7c1f1da3a34ef69c34b13c20fd81122c89600d3  backend/workagent/workspace_file_api.py
08ef3ea540ff1d7862444c080b29e8e4a15aefc3126b1f7fcea758fa618360ce  backend/workagent/workspace_file_models.py
671462e02ee24319de7b86dd8bbcc88b5fe30cad07b6cb97e45f2da4dd04a476  backend/workagent/workspace_files.py
d7b1c357b23e285a5e054ff7ae6bc8515ecf9a5c1809674d57d3291a8d887318  contracts/capability-registry-v2.json
64f597e5c9c2ac190a34cb15d4ab3fdc6fa3e6886ae3ec5b8bc2ff182dc7a00a  contracts/gateway-office-decision.schema.json
e8ec7dba143f5d6a34e10fa84c9d78d279d4cc0efa81694cbbe4da73c7840ec9  contracts/office-v1.json
4e8b8fccbd13ebd4414933d748b848f2538ec8901185bcf234d653e81abd227e  contracts/openapi.json
6084a8d6503b5ac5ffc2719035d79225d3d690367405ba777c01a3298bbf99e4  contracts/src/schema.d.ts
9d9b2cae68cdcbf1f9000789814b01c326d3a9fff59ca8cc5f15e115ddac8671  contracts/workspace-files-v1.json
6af5741495c02c8384888747fee640d11f27e0f8b3d4f3890621a25a04a57f73  web/src/components/FileExport.tsx
7eb7e9fe1800a41cbd3fc4d77b2361b4b3ad34114a3fdc85bd8d4fb3d149972e  web/src/components/WorkspaceFiles.tsx
5cc3f2f82a9a521df6507e9d1c14016de7b4c9a6a2e4db698c26a94646c986df  web/src/lib/client/workspace-files.ts
06879398fdf3ad460f9f9f69c29a16b805bc812af769704f6cd3a8fa6dd65813  web/src/lib/files-contract.ts
71ffe0fce4857c70609d39d00ad5faabc398c5967da13c3d15418e1b2aa419d7  web/src/lib/office-export.ts
058e714ad2b942ae072dc96220d5cae8398297d5980c5d9d499dc117d8040f7b  web/test/office-export.test.ts
2f9f34071d3bb763b571ebdef98e25adee1438eeccac9c6b2c22b0e24ba282e4  web/test/workspace-files-races.test.ts
```