/**
 * Facts supplied by the CSV calculation and child results, not a decision model.
 * @typedef {object} DecisionCandidate
 * @property {string} candidateId
 * @property {string} venue
 * @property {readonly string[]} sourceIds Original fixture file/row citations.
 * @property {number} totalCents Computed integer cents.
 * @property {boolean} fits Whether the supplied capacity fits the group.
 * @property {number} [budgetCeilingCents] User's recorded ceiling, if supplied.
 */
/**
 * @typedef {object} CandidateReason
 * @property {string} candidateId Identity copied from a supplied candidate.
 * @property {readonly string[]} sourceIds Citations copied from that candidate.
 * @property {string} reason
 */
/**
 * Bounded advisory result. It grants no authority and performs no effects.
 * @typedef {object} DecisionResult
 * @property {'deterministic-fallback'} providerMode
 * @property {false} jevEnabled
 * @property {string|null} selectedCandidateId
 * @property {CandidateReason[]} ranking Eligible candidates in ascending cost order.
 * @property {CandidateReason[]} excluded
 * @property {string} reason
 */

/**
 * Rank only supplied, source-backed candidates. No Jev, inference, network,
 * booking, permission or spending operation exists in this fallback.
 * @param {readonly DecisionCandidate[]} candidates
 * @returns {DecisionResult}
 */
export function decideWorkshop(candidates) {
  const ids = new Set();
  const eligible = [];
  const excluded = [];
  for (const candidate of candidates) {
    if (!candidate.candidateId || ids.has(candidate.candidateId)) throw new TypeError('Decision candidates require unique supplied identities');
    ids.add(candidate.candidateId);
    const sourceIds = [...(candidate.sourceIds ?? [])];
    const reason = !sourceIds.length || sourceIds.some(id => typeof id !== 'string' || !id.trim()) ? 'Missing source citation.'
      : !Number.isSafeInteger(candidate.totalCents) || candidate.totalCents < 0 ? 'Missing valid computed cost.'
        : candidate.fits !== true ? 'Does not fit the group.'
          : candidate.budgetCeilingCents !== undefined && (!Number.isSafeInteger(candidate.budgetCeilingCents) || candidate.budgetCeilingCents < 0) ? 'Invalid recorded ceiling.'
            : candidate.totalCents > (candidate.budgetCeilingCents ?? Infinity) ? 'Exceeds the recorded ceiling.' : null;
    if (reason) excluded.push({ candidateId: candidate.candidateId, sourceIds, reason });
    else eligible.push(candidate);
  }
  eligible.sort((a, b) => a.totalCents - b.totalCents || a.candidateId.localeCompare(b.candidateId));
  return {
    providerMode: 'deterministic-fallback', jevEnabled: false,
    selectedCandidateId: eligible[0]?.candidateId ?? null,
    ranking: eligible.map(candidate => ({ candidateId: candidate.candidateId, sourceIds: [...candidate.sourceIds], reason: candidate.budgetCeilingCents === undefined ? 'Fits the group; no ceiling supplied; ranked by computed cost.' : 'Fits the group and recorded ceiling; ranked by computed cost.' })),
    excluded,
    reason: eligible.length ? 'Lowest computed cost among the supplied eligible alternatives.' : 'No supplied source-backed alternative meets the recorded constraints.',
  };
}
