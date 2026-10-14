// Generate actual provider-facing AlphaDecision types without inventing an HTTP route.
import { readFileSync, writeFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';
const schema = JSON.parse(readFileSync(new URL('./alpha-decision.schema.json', import.meta.url), 'utf8'));
const { $defs, ...root } = schema;
const document = JSON.parse(JSON.stringify({
  openapi: '3.1.0', info: { title: 'Alpha decision contract', version: '1' }, paths: {},
  components: { schemas: { ...$defs, AlphaDecision: root } },
}).replaceAll('#/$defs/', '#/components/schemas/'));
const text = astToString(await openapiTS(document));
const path = new URL('./src/alpha-decision.d.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== text) throw new Error('Alpha TypeScript drift; run npm run generate');
  console.log('Alpha TypeScript matches the actual Python decision schema.');
} else {
  writeFileSync(path, text);
}
