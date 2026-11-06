**PASS — the sole residual is a truthful shared busy-lock release, not a material lifecycle defect.**

Inspected facts in [Composer.tsx](/home/ubuntu/workagent-continuation-20261026/web/src/components/Composer.tsx:224):

- `locked` includes `submitting`; both operation handlers explicitly refuse while submitting (289, 373). Workspace selection does not reset that lock.
- After switching A → B, A’s completion releases its existing lock in `finally` (507–509). B cannot have started a replacement operation through these handlers.
- That block changes neither B’s text/files/chat/error nor navigation. The settlement guards remain in place.

No concrete harmful transition was found from this residual. Guarding `finally` without another lock reset would instead leave controls stuck after switching.

The shared wait across workspaces is a **nonblocking UX limitation**. Post-unmount setters are ignored by React; mounted behavior was not experimentally verified in this source-only adjudication. A blanket “no setState” requirement does not justify HOLD.

Composer’s hash matches the manifest. No files changed or tests/build/browser/services run; prior broader conclusions remain retained.