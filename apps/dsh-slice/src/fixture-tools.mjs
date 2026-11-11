import { readFile } from 'node:fs/promises';
import { decideWorkshop } from './decision.mjs';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const VENUE_SOURCE = new URL('../fixtures/venues.csv', import.meta.url);
export function registerFixtureTools(ctx, calls) {
  return ctx.tools.register(defineTool({
    name: 'workshop_budget',
    description: 'Read fictional workshop venue CSV and compute prices in integer cents. Fixture only.',
    parameters: { attendees: { type: 'number', required: true, description: 'Whole number of attendees, 1 through 100.' }, venue: { type: 'string', description: 'Optional exact fictional venue name.' } },
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
    async execute({ attendees, venue }) {
      if (!Number.isInteger(attendees) || attendees < 1 || attendees > 100) throw new Error('Invalid attendee count');
      const csv = await readFile(VENUE_SOURCE, 'utf8');
      const [header, ...rows] = csv.trim().split('\n').map(line => line.split(','));
      const alternatives = rows.map((row, index) => ({ ...Object.fromEntries(header.map((key, i) => [key, row[i]])), candidateId: `venue-${index + 1}`, sourceIds: [`fixtures/venues.csv#L${index + 2}`] }))
        .filter(row => !venue || row.venue === venue)
        .map(row => ({ candidateId: row.candidateId, sourceIds: row.sourceIds, venue: row.venue, capacity: Number(row.capacity), accessibility: row.accessibility,
          totalCents: Number(row.room_cents) + attendees * Number(row.catering_per_person_cents),
          fits: Number(row.capacity) >= attendees }));
      const result = { fixture: true, attendees, currency: 'USD', source: 'fixtures/venues.csv', alternatives };
      calls.push(structuredClone(result));
      return JSON.stringify(result);
    },
  }));
}

export function registerComparisonTool(ctx, getConstraint = () => undefined) {
  return ctx.tools.register(defineTool({
    name: 'compare_workshop',
    description: 'Ask two concurrent DSH child workers to inspect the fictional venues and combine their sourced budgets.',
    parameters: { attendees: { type: 'number', required: true } },
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
    async execute({ attendees }, exec) {
      if (attendees !== 16 || !exec.agent) throw new Error('This scripted comparison covers 16 attendees only');
      const constraint = getConstraint(exec.agent.id);
      const children = [];
      const stop = () => { for (const child of children) void child.dispose().catch(() => {}); };
      exec.signal.addEventListener('abort', stop, { once: true });
      try {
        const starts = await Promise.allSettled(['Harbor Workshop', 'Garden Studio'].map(async venue => {
          const child = await ctx.subagents.startActivation({ provider: 'spawn', label: venue,
            request: { parent: exec.agent, prompt: [{ type: 'text', text: `Inspect fictional venue: ${venue}. Calculate the budget for 16 attendees.${constraint ? ` Constraint version ${constraint.version}: budget ceiling ${constraint.budgetCents} cents.` : ''}` }], maxDepth: 1 },
            signal: exec.signal, delivery: 'caller' });
          children.push(child); return child;
        }));
        const failure = starts.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        const results = await Promise.all(starts.map(async ({ value: child }) => {
          const result = await child.result;
          if (result.stopReason !== 'completed') throw new Error(`Child did not complete: ${result.stopReason}`);
          const report = JSON.parse(result.output.filter(block => block.type === 'text').map(block => block.text).join('\n'));
          return { ...report.alternatives[0], childSessionId: child.childId,
            ...(report.budgetCeilingCents ? { budgetCeilingCents: report.budgetCeilingCents, constraintApplied: report.constraintApplied, constraintVersion: report.constraintVersion ?? null } : {}) };
        }));
        return JSON.stringify({ fixture: true, attendees, currency: 'USD', source: 'fixtures/venues.csv', alternatives: results, decision: decideWorkshop(results) });
      } finally {
        exec.signal.removeEventListener('abort', stop);
        await Promise.all(children.map(child => child.dispose()));
      }
    },
  }));
}
