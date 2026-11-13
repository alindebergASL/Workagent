// Protocol-shaped synthetic placeholders only; never real encrypted provider data.
export const claudeDetails = [
  ...Array.from({ length: 317 }, (_, index) => ({ type: 'reasoning.text', text: `Synthetic thought ${index}`, format: 'anthropic-claude-v1', index })),
  ...Array.from({ length: 4 }, (_, index) => ({ type: 'reasoning.text', text: 'Synthetic signed thought', signature: `synthetic-signature-${index}`, format: 'anthropic-claude-v1', index: index + 317 })),
];
export const openaiDetails = [{ type: 'reasoning.encrypted', data: 'synthetic-opaque-placeholder', id: 'synthetic-reasoning-id', format: 'openai-responses-v1', index: 0 }];
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function history() {
  return [
    { role: 'assistant', content: [{ type: 'text', text: 'I read the document.' }, { type: 'tool-call', id: 'read-id', name: 'read_document', arguments: '{}' }], source: { replayState: { response: { model: 'anthropic/synthetic', reasoning_details: structuredClone(claudeDetails) } } } },
    { role: 'tool', toolCallId: 'read-id', content: [{ type: 'text', text: '{"document":{"text":"meaningful normal tool content","signature":"ordinary document text"}}' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'I proposed the change.' }, { type: 'tool-call', id: 'edit-id', name: 'edit_document', arguments: '{"document":"synthetic snapshot"}' }], source: { replayState: { response: { model: 'openai/synthetic', reasoning_details: structuredClone(openaiDetails) } } } },
    { role: 'tool', source: { callId: 'edit-id' }, content: [{ type: 'text', text: '{"proposalId":"retained-proposal"}' }] },
  ];
}
