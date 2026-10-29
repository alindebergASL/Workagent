# Independent narrow recovery2 review

Model: gpt-6-astra via openai-codex (inherited); independent delegate, read-only. Returned verdict below is preserved verbatim. Parent did not change source after this review. Full campaign and negative control were subsequently parent-executed; reviewer only inspected the first confinement run.

---

**PASS — narrow recovery2 confinement-proof review.** No blocking safety regression found. Independent Astra review on `hermes/b2-conversational-client`; compared the actual current test file against `.local/recovery2/test_document_confinement.before.py`, not merely Git’s tracked diff.

- **CPU proof distinguishes CPU enforcement from the wall guard** (`test_document_confinement.py:79–101`). It verifies live `RLIMIT_CPU == (5,5)`, observes at least 4.5 CPU seconds, then requires SIGKILL-compatible termination. A wall timeout propagates as an exception and **cannot pass** these assertions. The 60-second allowance is test-only; production retains `--cpu=5:5` and `WALL_SECONDS = 15` (`document_sandbox.py:16,51`). This is strong behavioral evidence, not forensic attribution excluding every unrelated external SIGKILL.
- **Wall proof materially strengthens descendant-cleanup coverage** (`:104–167`). The observer forwards to the real `os.killpg`; host `/proc` identities establish a live, detached session-leading leaf before termination, then check disappearance/death using PID plus start time. Closed child pipes do not substitute for observing termination. The `/proc/stat` field offsets are correct. This covers the constructed detached child tree, not every possible adversarial process topology.

**Nonblocking limitations**
- `observed_killpg` snapshots before forwarding (`:127–129`). An unexpected `/proc` read exception could prevent the actual kill. A `finally` around forwarding would make the observer safer. Likewise, failed survivor assertions have no independent cleanup; a cleanup regression could leave the sleeping fixture alive until its sleep ends.
- The wall test asserts only an elapsed lower bound (`:163`), so a moderately late timeout could pass. It proves termination, not a strict maximum response latency.
- Severe scheduling starvation can still make the CPU proof fail at its 60-second guard. That is an explicit failed proof, not false CPU-enforcement evidence.

**Existing execution evidence inspected—not rerun by me:** XML contains exactly **7 cases, zero failures/errors/skips**, consistent with the log. CPU evidence records **4.500043947 CPU seconds**, exit **137**, and **14.764643448055722 wall seconds**. Wall evidence records **5.020313636981882 seconds**, **4 observed processes**, and **0 live survivors**. I separately checked the host `/proc` field interpretation.

Unchanged target-filter/XML-preflight review evidence in `.local/documents-rereview.md` remains reusable within its original static-review scope. No files or board state changed; no DB, paid, web, or full-batch checks performed. **No batch-completion claim.**
