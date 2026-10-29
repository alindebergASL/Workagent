**HOLD — RR1 and RR2 retain material lifecycle gaps.** Reviewed intentional dirty HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d`; all seven files match the manifest’s `after` hashes.

- **RR1 — P2: freshness is not bound to the actual resource key.** [hooks.ts:35](/home/ubuntu/workagent-continuation-20261026/web/src/lib/client/hooks.ts:35) stores `current` as an unkeyed boolean, resets it only in the passive effect at line 116, and returns it unchanged at line 188. On a checkpoint-version key change, the first render therefore still returns the previous checkpoints with `current: true`. If snapshot and conversation already agree on the new version, [page.tsx:366](/home/ubuntu/workagent-continuation-20261026/web/src/app/conversations/[id]/page.tsx:366) can qualify that old checkpoint evidence for fresh Continue before the effect runs. Freshness must require successful evidence belonging to the actual requested key. Ordinary pending/failed refresh transitions are corrected; exact uncertain replay remains preserved.

- **RR2 — P2: selection follows a passive effect, with no unmount invalidation.** [Composer.tsx:190](/home/ubuntu/workagent-continuation-20261026/web/src/components/Composer.tsx:190) now correctly resets both refs for empty/assignment-only B, **once its effect runs**. Before then, `live.current` and `chat.current` still describe A. More decisively, unmount never invalidates that selection: start in A, navigate elsewhere/unmount, then resolve A’s send. [The settlement guard at line 467](/home/ubuntu/workagent-continuation-20261026/web/src/components/Composer.tsx:467) still passes and `router.push` navigates back into A. The guard needs selection and mount-lifetime invalidation covering these windows. Origin-only durable cleanup remains correct.

The added tests cover helper transitions but manually apply reset/selection before settlement; they do not establish actual hook/Composer lifecycle behavior. Mounted/browser proof and full gates remain downstream. No edits, tests, builds, browser or services performed. Prior R1–R3, upload durability, Input/Output repair and unaffected broader conclusions remain retained. Assignment-handover residual remains outside scope.

Exact reviewed SHA-256 hashes, relative to the supplied root:

```text
web/src/app/conversations/[id]/page.tsx
d9f76b90bc1d078d46b93de3fc8dd7f84c97fb567b505615f30868df1f9dc2b0

web/src/components/Composer.tsx
2b46cb80a8dbbc1a353357eb940de0db84f62c8094d710921d82107e7deb1907

web/src/lib/batch2-view.ts
88e13ca3358a896998a1cb7e33e4c3a80049889ceb4f1e28bcd33e38377e2ff6

web/src/lib/client/home-start.ts
2d36c6e546fcdcb79005fec2efa2402733f2e98908a5681e9f5db482c87a73c9

web/src/lib/client/hooks.ts
f425e1ab1d782cae88798f2b7660d9081f554856c2cd4f3b9069c5977719354d

web/src/lib/client/resource-freshness.ts
0615002524e9dd12b9c87b68b6927583ceeb07455031d2ed2f285a0b7758a0cf

web/test/b2-correction.test.ts
a54f1b85a90c7bcdc50ae531271b57e382c766cda5971700dc271d8db1e0459d
```