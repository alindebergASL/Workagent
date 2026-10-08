/** Canonical access-scoped proposal readback. No speculative single-item route. */
export async function readProposal(get, artifactId, proposalId) {
  let cursor = null;
  const seen = new Set();
  do {
    const page = await get(`/artifacts/${encodeURIComponent(artifactId)}/proposals${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`);
    const proposal = page.items.find(item => item.id === proposalId);
    if (proposal) {
      if (proposal.artifact_id !== artifactId) throw new Error('Proposal artifact mismatch');
      return proposal;
    }
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error('Proposal cursor repeated');
    seen.add(cursor);
  } while (cursor);
  throw new Error('Proposal not found in authorized artifact scope');
}
