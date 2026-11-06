# Batch 3 acceptance recovery correction — 2026-11-04

## Disposition and scope

The earlier final report and matrix promoted a partial E/F/G result to full
acceptance using unsupported **37/40** arithmetic and a stronger P7 diagnosis than
the saved traces establish. The corrected disposition is **full acceptance not
established / HOLD**, without invalidating scoped implementation or collected
outputs and without creating a new engineering-approval gate.

This was a saved-evidence audit only: no evaluation replay, paid API request,
database query/mutation, service operation, commit or push. Only REPORT.md,
MATRIX.json, MATRIX.md and this note are edited. Historical lane reports,
preregistrations, receipts, the original matrix builder and MATRIX.csv are
unchanged. No credentials or private capability payloads are copied here.

## Denominator derivation

Sources (relative to the repository):

- `.local/batch3/b35g/PRIMARY_ROWS.json`, especially `purpose` and `order`:
  six trajectories, primary episodes 2–6, with fresh episode-1 executions
  explicitly excluded from primary evidence.
- `.local/batch3/b35g/REPORT.md`, lines 66–101: 14/30 dependent rows collected;
  six fresh prerequisites; 20 collected/scored packets.
- `.local/batch3/b35h/PREREGISTRATION.md`, lines 18–38 and 104–119: continuation
  of the same cohort, not a new cohort; 16 remaining dependent rows.
- `.local/batch3/b35h/REPORT.md`, lines 86–124: 13/16 additional collected rows;
  G-M1 fails episode 4, with episodes 5–6 unmet. Its later lines 184–185 claim
  37/40 but provide only E 10/10, F 10/10, G 7/10; that summary is not a new cohort.
- Both lanes' `scoring/MANUAL-PACKETS.map.json` and `scoring/MECHANICAL.json`:
  machine-readable identity and status cross-checks.
- `.local/batch3/b35e/PRIMARY_ROWS.json` and `REPORT.md`: six canonical episode-1
  rows from the original first pass; the trajectory identities match b35g.

| Scope | Collected | Denominator | Meaning |
|---|---:|---:|---|
| b35g primary dependent rows at its close | 14 | 30 | Before P6 continuation |
| b35h continuation | 13 | 16 | Subset of those 30, not an additional denominator |
| Combined dependent coverage | 27 | 30 | E 10/10, F 10/10, G 7/10 |
| Canonical E/F/G evidence slots | 33 | 36 | Six b35e ep1 rows plus 27 dependent rows, across product versions |
| Continued b35g cohort packets | 33 | 36 | Includes six fresh nonprimary ep1 prerequisites instead of b35e ep1 |

The last two views are not additive. Packet maps have 20 b35g and 13 b35h entries,
with no duplicate `(blind_id, episode)` keys. Five continued trajectories have
all six episodes collected; G-M1 has three. Missing dependent keys are exactly
`a3481e3265f5b5f8f6482d24/4`, `/5`, `/6`.

No additional cohort or ten extra rows supporting 37/40 was identified in these
sources. **27/30 is only the dependent-row result, not overall Batch 3 acceptance
or a pooled pass rate.** A/B original and fresh72, C/D, the b35e first-pass
snapshot and the separate b35f overnight observation retain their own scopes.
Do not add overlapping snapshots or prerequisite executions to improve a rate.

## P7: observed mechanism versus unsupported attribution

The synthetic G-M1 trajectory is under
`.local/batch3/b35g/cohort-b35g-20261103/a3481e3265f5b5f8f6482d24/`.

- `actions/000018/worker.stdout` (execute) and
  `actions/000019/worker.stdout` (observe) both record
  `unknown_preserve_receipts`, `DomainError`, `not_found_or_not_authorized`,
  with `original_attachments.material` line 21 followed by
  `retained_results.authorize` line 94.
- `actions/000012/retry-b35h-1/message-readback.json` records the episode-3 message
  with `target: null` and **three different attachments**: issues.json,
  release.json, prior-work.txt.
- `actions/000017/message-readback.json` records the episode-4 explicit
  artifact/revision target and the instruction: issue resource revoked,
  release metadata permitted. Its scope-update.json says `allowed: ["release"]`.
- `backend/workagent/retained_results.py:74–95` explains the observed check:
  `if latest.target!=original.target: deny()`. The existing policy is fail-closed,
  but that predicate is target equality, not a classification of the selected
  attachment as the revoked issue resource.

The inspected saved action traces do **not** contain a selected attachment
ref/hash identifying the specifically revoked issue resource. This audit does
not query the recipient database or reconstruct missing provider selections.
Therefore it does not assert either that the model read the revoked issue or
that it read the permitted release. The post-report assertion in b35h REPORT.md
lines 167–174 is stronger than the trace/message evidence audited here.

Likewise, the lane report's comparable instruction/context observation is not
proof of identical full requests across memory/no-memory arms. The successful
G-B1 sibling and its reported retained-result path show a completed alternative;
they do not prove that the blocked attachment path is defect-free. A context
that offers a reference while authorization rejects its read, followed by a
persistent execution stop, still needs a bounded product/harness disposition.

Withdraw the unsupported revoked-content attribution, resource-specific safety
PASS, categorical “not a product/harness defect”, and categorical “future rerun
would be gaming” conclusions. Preserve both failed actions and all three unmet
rows. No safety bypass, replay or future evaluation is authorized by this note.
The audit establishes no new safety breach; it also does not certify complete
resource-specific revocation behavior.

## Scoring and acceptance qualifications

The saved machine checks are **checks**, not row-level mechanical PASS counts:

| Lane | Manual packets (reported PASS) | Mechanical true | False | Deferred |
|---|---:|---:|---:|---:|
| b35g | 20, including 6 prerequisites | 84 | 0 | 8 |
| b35h | 13 collected | 44 | 0 | 9 |

b35h MECHANICAL.json has 16 status rows; three are explicitly not collected and
have no checks. Do not turn those into passes. Memory engagement is not causal
benefit, and G completion differs by arm. No measured human-effort improvement
is established. Private-pilot consent and provider billing remain unexercised /
unknown. Saved budget and publication/runtime observations are historical, not
freshly queried by this audit; the asserted outage cause is not verified here.

## Matrix generation and validation

The historical `.local/batch3/b3final/build_matrix.py` does **not** reproduce the
pre-correction committed final matrix: it still says b35g IN-PROGRESS and ends
FULL-BATCH3-HOLD. Its source mixes record-derived values with literal editorial
claims; its docstring's “nothing is retyped by hand” assertion is inaccurate.

A read-only execution of its AST before line 239 (before all output writes)
produced 45 rows; comparison with the pre-correction MATRIX.json differed in
rows **20, 32, 41, 45**. It was not run as a writing script and remains unchanged.
Its Markdown writer also truncates fields and omits evidence, unlike the final
full-field table. The corrected MATRIX.json is the maintained acceptance source;
MATRIX.md is a deterministic full-field rendering of it, not a fresh automatic
inference of acceptance from the old builder.

Corrected matrix rows: **20, 32, 35, 38, 41, 42, 43, 44, 45**. All 45 requirement
identities and row order are retained. MATRIX.csv is an unchanged historical
export and must not be treated as the corrected matrix; updating it or the
builder is outside this task's authorized file scope.

Read-only verification from the repository root (stdlib only):

```python
import ast
import collections
import json
from pathlib import Path

root = Path.cwd()
base = root / '.local/batch3'
rows = json.loads((root / 'docs/evidence/batch3-final/MATRIX.json').read_text())
assert len(rows) == 45
assert len({r['requirement'] for r in rows}) == 45
fields = ('section', 'requirement', 'disposition', 'evidence', 'conditions')
assert all(set(r) == set(fields) for r in rows)
lines = [f'# Batch 3 — Final requirement matrix ({len(rows)} rows)', '',
         '| # | section | requirement | disposition | evidence | conditions |',
         '|---|---|---|---|---|---|']
for i, row in enumerate(rows, 1):
    values = [str(i)] + [
        ('**' + row[k] + '**' if k == 'disposition' else row[k])
        .replace('|', '\\|').replace('\n', '<br>') for k in fields
    ]
    lines.append('| ' + ' | '.join(values) + ' |')
assert '\n'.join(lines) + '\n' == (
    root / 'docs/evidence/batch3-final/MATRIX.md').read_text()

primary = json.loads((base / 'b35g/PRIMARY_ROWS.json').read_text())['order']
expected = {(r['blind_id'], e) for r in primary for e in range(2, 7)}
seen = set()
family = collections.Counter()
for lane in ('b35g', 'b35h'):
    packets = json.loads((base / lane / 'scoring/MANUAL-PACKETS.map.json').read_text())
    keys = {(r['blind_id'], r['episode']) for r in packets}
    assert len(keys) == len(packets) and not seen.intersection(keys)
    seen |= keys
    for r in packets:
        if r['episode'] >= 2:
            family[r['family']] += 1
actual = {key for key in seen if key[1] >= 2}
assert actual <= expected and len(actual) == 27 and len(expected) == 30
assert dict(family) == {'E': 10, 'F': 10, 'G': 7}
assert expected - actual == {('a3481e3265f5b5f8f6482d24', e) for e in (4, 5, 6)}
assert len(seen) == 33 and len(primary) * 6 == 36
assert rows[-1]['disposition'] == 'FULL-BATCH3-HOLD-not-established'
print('PASS: 45 rows; exact Markdown rendering; 27/30 dependent; 33/36 packets')
```
