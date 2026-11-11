import test from 'node:test';
import assert from 'node:assert/strict';
import { decideWorkshop } from '../src/decision.mjs';

const candidates = [
  { candidateId: 'harbor', venue: 'Harbor', totalCents: 76800, fits: true, budgetCeilingCents: 74000, sourceIds: ['fixtures/venues.csv#L2'] },
  { candidateId: 'garden', venue: 'Garden', totalCents: 71200, fits: true, budgetCeilingCents: 74000, sourceIds: ['fixtures/venues.csv#L3'] },
];
test('bounded decision selects only a supplied eligible candidate and preserves its source references', () => {
  const input = structuredClone(candidates);
  const result = decideWorkshop(input);
  assert.equal(result.providerMode, 'deterministic-fallback');
  assert.equal(result.jevEnabled, false);
  assert.equal(result.selectedCandidateId, 'garden');
  for (const item of [...result.ranking, ...result.excluded]) {
    assert.deepEqual(item.sourceIds, input.find(candidate => candidate.candidateId === item.candidateId).sourceIds);
    assert.ok(item.reason);
  }
  assert.deepEqual(input, candidates, 'ranking must not change evidence or constraints');
});
test('no eligible source-backed candidate produces no pick, including a cheaper unsupported alternative', () => {
  const result = decideWorkshop([
    ...candidates.map(candidate => ({ ...candidate, budgetCeilingCents: 70000 })),
    { candidateId: 'unsupported', venue: 'Unverified bargain', totalCents: 1, fits: true, sourceIds: [] },
  ]);
  assert.equal(result.selectedCandidateId, null);
  assert.deepEqual(result.ranking, []);
  assert.equal(result.excluded.length, 3);
});
