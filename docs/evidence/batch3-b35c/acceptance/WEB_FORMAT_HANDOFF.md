# Web format handoff — PR18 CI Prettier failure

**Status:** done; this was formatting only. The 12 CI-flagged web files were rewritten with the installed Prettier and nothing else. The changes are uncommitted in the canonical worktree for the parent to verify and republish. No commit, push, backend/contracts/evaluation/docs edit, DB, services, browser, paid call or agent was involved.

- Base: `/home/ubuntu/workagent-continuation-20261026`, branch `hermes/b2-conversational-client`, HEAD `8bf1dcf4653b1bd583989bf03da5b53af1c26190` (PR18).
- CI failure: run `41263508466`, log `ci-failure-01.log`. It passed `typecheck` and `lint`, then `prettier --check .` failed with "Code style issues found in 12 files".
- Prettier version: 3.9.9 is installed locally, which is the same version `web/pnpm-lock.yaml` resolves for CI.
- Worktree after the change: only the 12 files below are modified. The untracked `contracts/pnpm-lock.yaml` is untouched, and nothing was reset.

## Files (paths under `web/`) — sha256 HEAD → formatted

| File | +/- | HEAD sha256 | Formatted sha256 |
| --- | --- | --- | --- |
| `src/app/assignments/[id]/page.tsx` | 9/3 | `ca401029abd846f0f9aa8b1f78490ab7922122dcc033b66770bb4e176c868a18` | `3c7cbc48573441fd562c8d518bce1ba81965a443e578007d76d879bb820024bd` |
| `src/app/conversations/[id]/page.tsx` | 7/1 | `51083ba5651a302d473f681abd84bfee324cc12fa0e89e202c2268f3c456facf` | `785bebba65b511ad53fb69b56dc2f8131c47341bd6187b54eadd7e285b34482a` |
| `src/components/HumanHistory.tsx` | 105/29 | `1fc6be819f073095951df25b4840be3f8fcfc65e42e4a96e5c768f19e26a5471` | `fe18f774bd040515e108bbe7d06a8a596057a500ba95c41f0238904845e82c4a` |
| `src/lib/client/discovery-page.ts` | 29/10 | `0d102afd63f5274492ba21d6d4405e03828fea52cd5635bdbc5d3848b1406e0c` | `54781b780ca99990a9425ec1bca29a7aeba0d3c8584cd7e354585a5099a6ba1b` |
| `src/lib/client/human-history.ts` | 40/10 | `6ad5626e42e9b269b7ae1959c236923419f2808e23319a53c0a7028b27a71b1d` | `1a5881a431f543291544808258e0eb654b92680a7fa2fb3e22c208ac4e031a85` |
| `src/lib/client/responsibility-outputs.ts` | 18/8 | `c4e4dd5184a48d1f766422a56621e3d79641ae76c0908961e108035989c57bc5` | `8d9686d79d0e5c01166f1e010df0450b277f6f602d250bc49394066047795a0e` |
| `test/frontend-boundaries.test.ts` | 6/5 | `3baeb374d305fd4bfbcfa6466072756749f511ce4dd2303a0c575a7683001604` | `99eada0e5838b3141a58b5dcf863979701e01094f51ec9b53d12f73e2255ad80` |
| `test/human-history-outputs.test.ts` | 99/38 | `588963737984a510f8586d8e1671ece1277b9d7def8bfd61802a8936fdcc3edc` | `47a81ec964a3d8077ee134fba3d274e69e4620539d1c9bade26fc84a18f1d283` |
| `test/human-history-routes.test.ts` | 266/87 | `4f89ad1daba777d9502987c3ca3e04de3dbdb9f687baca058e28647cd653d2ca` | `34f4ffa0866b15c8a6e500e4125d8270d52d6b6902c8b1502dce641a4d6256c2` |
| `test/human-history-state.test.ts` | 46/15 | `8c2824ec7c960adbd83510d5e786973310174237928ae58d071f63c4dbb251c4` | `a946f5eda377ed931b13116919872107be21177d98efae4f824cbabcfba80cc4` |
| `test/human-history.test.ts` | 216/88 | `13b7a65b5f68db2f56abb121724e0fb8b18d9a77cc069b4b3aaa27ab9a08315f` | `946fb9a0749250c9f3a8cd1e3371f9bb2cbe1e79dadf293cf6cc4eb4576f2eeb` |
| `test/responsibility-outputs.test.ts` | 9/3 | `76fc42d0fc11a67a6ea09dc86b8439b56255f8f7c4f04d41d20ec56fc973f965` | `c35eb77030dd32ce167f60e761e67903e00f034d6f8bc3a3a9697effaab4d273` |

Totals: 12 files, +850/−297. Full diff: `web-format.patch`, sha256 `41f328cbde8e04c555ca7ec63df49045fe2d4658f530166c59b38032730521ad`. Per-file hash lists are in `web-format-before.sha256` and `web-format-after.sha256`.

## Formatting-only evidence

`web-format-token-compare.mjs` parses the HEAD and formatted versions of each file with the installed TypeScript and compares their leaf-token streams. Whitespace and line breaks are ignored by construction. Log: `web-format-token-compare-02.log`.

| Result | Files |
| --- | --- |
| Token-identical | `assignments/[id]/page.tsx`, `responsibility-outputs.ts` |
| Identical except Prettier punctuation (trailing commas, wrapping parens/braces, quote style) | the other 9, apart from `HumanHistory.tsx` |
| Flagged, explained below | `HumanHistory.tsx` |

The script exited 1, and its last line reads `NON-FORMATTING DIFF`. Both flags were inspected, and both are formatter artifacts:

1. **`HumanHistory.tsx` token "DIFF".** Prettier wrapped the JSX line `</time> · {item.checkpoint_kind} · …` and inserted `{" "}` before the moved expression, so the same rendered space is kept. This is standard JSX whitespace preservation, so the rendered text is unchanged. There is no other token difference, and its comments are equal.
2. **"COMMENTS-DIFF" in `human-history-routes.test.ts` and `human-history.test.ts`.** The comment regex falsely matched `//history.test/api/domain", bearer, rid) };` inside the string `"http://history.test/api/domain"`. The real change there is the punctuation `) };` → `),` after Prettier wrapped the object. The token streams of both files already passed the punctuation-only check.

## Commands and results (run in `web/`, serially)

| Command | Result | Log |
| --- | --- | --- |
| `npx prettier --check .` (before) | exit 1, the same 12 files as CI | `web-format-precheck-01.log` |
| `npx prettier --write <exactly the 12 files>` | 12 files written | `web-format-write-01.log` |
| `npx prettier --check .` (whole tree, = `format:check`) | "All matched files use Prettier code style!", exit 0 | `web-format-check-01.log` |
| `npx vitest run --no-file-parallelism` on the 6 formatted tests + `phone-composer` (reads page source) + `frontend-boundaries` | 7 files, **50 passed**, exit 0 | `web-format-affected-tests-01.log` |
| `npx vitest run --no-file-parallelism` (full web suite) | 82 files, **948 passed**, exit 0 | `web-format-full-tests-01.log` |
| `npx tsc --noEmit` | exit 0 | `web-format-typecheck-01.log` |
| `npx eslint . --max-warnings 0` | exit 0 | `web-format-lint-01.log` |

No functional failure occurred, so nothing beyond formatting was changed. A `tsconfig.tsbuildinfo` generated by tsc was removed. Frozen historical evidence and build hashes under `.local/batch3/**` were not modified; only the new `web-format-*` files and this handoff were added in this directory.

## Model disclosure

- Claude Opus 5.5 (1M context), `claude-opus-5-5[1m]`, the same existing web-owner session.
- No model or profile changes, no subagents or workflows, and no product provider calls.
- Development-tool usage only, which is outside the product ledger.
