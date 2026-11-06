# B3.0b R3/R4 independent correction review — PASS

**Verdict: PASS for the exact R3/R4 correction candidate below. No material finding remains in this narrow scope.** This is not Batch 3 acceptance or production/browser verification.

Reviewed the isolated `.local/batch3/b30b/web-owner` source, not the intentionally older main checkout, against `r34-final-candidate.patch` and `r34-final-candidate-source.json`. Read the controlling authority and original `docs/evidence/batch3-b30b/final-narrow-review.md`. R1/R2, backend/native, unrelated web behavior, and deployment were not reaudited.

## Resolution evidence

Paths below are relative to the isolated owner tree.

- **R3:** `web/src/components/WorkspaceFiles.tsx:697-702` locks the textarea while busy or holding an unresolved envelope. `:507-532` preserves the stored body rather than reconstructing replay. `:545-549` clears only the matching command and matching stored draft; `web/src/lib/file-draft.ts:71-78` checks exact base version/hash and display-normalized sent content. A distinct newer draft survives and is explicitly offered for recovery at `WorkspaceFiles.tsx:575-578`, rather than silently rebased.
- **R4, both completion orders:** creator `WorkspaceFiles.tsx:255-265` and editor `:538-549` fence dead mounts **before** any journal/draft mutation. Thus old A settling first cannot consume the live replay's journal; replay settling first cannot let the old mount erase a later B. Creator controls remain locked while a command is held (`:307-334`), and draft removal follows successful matching-command ownership, so the late original A does not own B's draft.
- **Hash/catch/finally:** creator `:244-253`, `:271-291` and editor `:517-531`, `:586-602` fence post-hash and dead error completions. Definitive errors clear only their matching body; restored/ever-ambiguous errors retain their journal through `failedWriteOutcome`. Finally only resets that mount's local busy state, not persistent or live-remount state. Editor also fences the asynchronous accepted-version readback at `:564`.
- **Real hook, not helper-only simulation:** `web/src/lib/client/pending-command.ts:22-38` restores the persisted envelope; `:60-79` checks both in-memory identity and stored exact serialization before clearing. The race suite transpiles this actual hook, the actual draft module, and the actual component handlers. It uses a synthetic React-hook scheduler, transport and storage, not a browser/real React renderer.

## Executed verification

1. `git -C .local/batch3/b30b/web-owner apply --reverse --check /home/ubuntu/workagent-continuation-20261026/.local/batch3/b30b/r34-final-candidate.patch` — exit 0; the supplied patch matches the reviewed tree. Check only; no patch applied.
2. From `.local/batch3/b30b/web-owner/web`: `./node_modules/.bin/vitest run test/workspace-files-races.test.ts` — exit 0, **1 file / 9 tests passed**. Includes actual-hook remount/replay for editor and creator in both old-first and replay-first orders, newer edit recovery across reload, B journal/draft survival, dead creator hash fencing, and late definitive failure isolation. Assertions cover full-envelope equality in both-order cases, no extra sends, and creator reload with no remaining replay.
3. SHA256 inventory and an independent Python manifest comparison — exact three source hashes match before/after the test run. The unchanged real hook hash matches the original review.

The editor's equivalent late-B and pre-send-hash/error fencing was inspected directly; the nine tests do not separately exercise every editor permutation. Browser and production-build validation remain parent-owned. No claim of browser coverage or new live service effects is made. The already-present `r34-parent-handler-result.json` read during this review still contained the earlier old-first failure and lacked final-candidate hashes; it was not counted as current green evidence. The final candidate's both-order tests passed independently here.

## Exact source binding

```text
1c44d937b798e3b14051cbf3c214fe53748c4cf55f96d21f197c2ba93c63bf22  web/src/components/WorkspaceFiles.tsx
11ea527c7967fc917ba2c376607579aec4c5a7699a112e0615c6ffc3d54f5999  web/src/lib/file-draft.ts
2c5ffb7c9f5e0fa7605e959359831eb54f18cdbbcdc259367908ffdb95a493b8  web/test/workspace-files-races.test.ts
```

Supporting bindings:

```text
138d4220be8791e0911e7d32eaa68bc832382443c4cc0e9f9bfc8e7b64c3dda1  web/src/lib/client/pending-command.ts
ec7f16d8dbd86a4da74d7d25e466541e02a757aeb0cce72c04e0ee3357593ab9  r34-final-candidate.patch
5839f8a1dbd1104a53d18e8697670c845d073006520208e5fcd8ca8649d03c74  r34-final-candidate-source.json
```

Only this report and its compact JSON companion were authored. No source edits, commits, board actions, builds, services, databases, network/provider requests, or additional reviewer dispatches. An initial batch-read attempt via `execute_code` was blocked before execution; ordinary read tools completed those reads. Development-model cost is unmeasured and outside the product ledger.
