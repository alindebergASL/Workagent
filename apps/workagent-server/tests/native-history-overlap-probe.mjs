// Explicit safety CAPABILITY PROBE, intentionally outside ordinary green gates.
// A nonzero exit means pinned native individual undo cannot yet satisfy P05's
// peer-overwrite protection. Never normalize that failure into a product PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UndoCommand, RedoCommand } from '@univerjs/core';
import { pair, edit, relay, UNIT } from './native-history-sdk.test.mjs';

test('required safety: own native undo/redo must not erase a newer same-cell peer value',async t=>pair(async(s,a,b)=>{
  await relay(await edit(a,s,0,0,11),b);await relay(await edit(b,s,0,0,22),a);
  const before=a.undo.getUndoRedoStatus(UNIT),undo=await a.run(s,UndoCommand.id);
  assert.equal(undo.command,true,'a real native undo must execute');await relay(undo,b);
  const afterUndo=[a.cell(0,0),b.cell(0,0),(await s.data()).sheets['sheet-1'].cellData?.[0]?.[0]?.v??null];
  const redo=await a.run(s,RedoCommand.id);assert.equal(redo.command,true);await relay(redo,b);
  const afterRedo=[a.cell(0,0),b.cell(0,0),(await s.data()).sheets['sheet-1'].cellData?.[0]?.[0]?.v??null];
  t.diagnostic(JSON.stringify({before,afterUndo,afterRedo,head:s.head,history:(await s.history()).changesets.map(c=>({revision:c.revision,userID:c.userID,mutations:c.mutations}))}));
  assert.deepEqual(afterUndo,[22,22,22],'own undo erased the newer peer value on both clients and authoritative native head');
  assert.deepEqual(afterRedo,[22,22,22],'own redo resurrected an overwritten value');
}));
