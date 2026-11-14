// Parent qualification: actual namespace and actual installed Poppler; never skip.
// PATH=<Node 24 bin>:$PATH node apps/workagent-server/tests/pdf-import-isolation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PdfWorker } from '../src/pdf-worker.mjs';
const worker=new PdfWorker();
function fixture(kind,pages=1){const r=spawnSync('/usr/bin/python3',['-I','services/workagent-execution/pdf/fixtures/text_import.py',kind,String(pages)],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
test('actual namespace Unicode/multipage literal extraction and page limit',async()=>{
 const result=await worker.run({op:'import',base64:fixture('unicode',2)});
 assert.equal(result.pages,2);assert.equal(result.text.split('Café café Ω Ж 0012 1. Literal label').length,3);
 assert.equal((await worker.run({op:'import',base64:fixture('plain',200)})).pages,200);
 await assert.rejects(worker.run({op:'import',base64:fixture('plain',201)}),/pdf_page_limit/);
});
for(const [kind,code] of [['empty','pdf_ocr_not_supported'],['scanned','pdf_ocr_not_supported'],['encrypted','pdf_encrypted_not_supported'],['empty-password','pdf_encrypted_not_supported']])test('actual namespace refuses '+kind,async()=>{
 await assert.rejects(worker.run({op:'import',base64:fixture(kind)}),new RegExp(code));assert.equal(worker.active,false);
});
for (const kind of ['mixed-scanned', 'mixed-blank']) test('actual namespace refuses the whole ' + kind + ' PDF', async () => {
 await assert.rejects(worker.run({op:'import',base64:fixture(kind)}), error => error.code === 'pdf_page_without_text' && error.status === 400);
 assert.equal(worker.active, false);
});
test('actual namespace refuses malformed PDF with no partial output',async()=>{
 await assert.rejects(worker.run({op:'import',base64:Buffer.from('%PDF-1.7\nmalformed\n%%EOF').toString('base64')}),/pdf_malformed/);
});

for(const [kind,code] of [['text-limit','pdf_extraction_output_limit'],['paragraph-limit','pdf_paragraph_limit']])test('actual namespace refuses '+kind,async()=>{
 await assert.rejects(worker.run({op:'import',base64:fixture(kind)}),new RegExp(code));
});
