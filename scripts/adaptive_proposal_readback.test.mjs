import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProposal } from './adaptive_proposal_readback.mjs';
test('reads the artifact-scoped endpoint, including pagination', async () => {
 const paths=[];
 const get=async p=>{paths.push(p);return paths.length===1?{items:[],next_cursor:'next'}:{items:[{id:'proposal',artifact_id:'artifact'}],next_cursor:null};};
 assert.equal((await readProposal(get,'artifact','proposal')).id,'proposal');
 assert.deepEqual(paths,['/artifacts/artifact/proposals','/artifacts/artifact/proposals?cursor=next']);
});
test('missing and cross-artifact proposals fail closed without fallback', async () => {
 await assert.rejects(readProposal(async()=>({items:[],next_cursor:null}),'a','p'),/not found/);
 await assert.rejects(readProposal(async()=>({items:[{id:'p',artifact_id:'other'}],next_cursor:null}),'a','p'),/mismatch/);
});
test('repeated pagination cannot spin indefinitely',async()=>{
 await assert.rejects(readProposal(async()=>({items:[],next_cursor:'same'}),'a','p'),/repeated/);
});
