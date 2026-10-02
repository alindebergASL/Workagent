// Read-only current-UI check; the original model-proof archive stays immutable.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const origin = new URL(process.env.WORKAGENT_WEB_ORIGIN ?? 'http://127.0.0.1:3000');
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('This read-only evaluator requires an explicit loopback HTTP origin.');
}
const output = path.resolve(process.env.WORKAGENT_MODEL_PROOF_OUTPUT ?? '.local/model-proof-recheck');
const archived = path.join(root, 'handoffs/backend/model-proof');
if (output === archived || output.startsWith(archived + path.sep)) {
  throw new Error('Do not overwrite the historical model-proof evidence archive.');
}
const operation = JSON.parse(await readFile(path.join(archived, 'operation.json'), 'utf8'));
const { chromium, expect } = createRequire(path.join(root, 'web/package.json'))('@playwright/test');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const blocked = [];
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin.origin || !['GET', 'HEAD'].includes(request.method())) {
      blocked.push({ method: request.method(), path: new URL(request.url()).pathname });
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin.origin}/assignments/${operation.assignment_id}/artifacts/${operation.artifact_id}`);
  const document = page.locator('.doc-card');
  await expect(document.getByText(/Actual qwen3.8-max draft, operator-imported for review/)).toBeVisible({ timeout: 15000 });
  await expect(document.getByText('Keep Wednesday 14:00–15:00 for method drafting.', { exact: true })).toBeVisible();
  // The current UI distinguishes a stored human draft from an accepted proposal.
  await expect(page.locator('header .status').first()).toHaveText('Ready for review');
  await expect(document.getByText(/4 unique cases missing an owner or a next action/)).toBeVisible();
  await expect(page.getByText(/fixture worker, not a live agent/)).toBeVisible();
  await page.screenshot({ path: path.join(output, 'reopened-model-draft.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('header .status').first()).toHaveText('Ready for review');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(output, 'reopened-model-draft-mobile.png'), fullPage: true });
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(path.join(output, 'browser.json'), JSON.stringify({
    passed: true, mode: 'read_only_reopen_of_retained_operator_import',
    assignment_id: operation.assignment_id, artifact_id: operation.artifact_id,
    current_badge: 'Ready for review', approval_claimed: false, autonomous_worker_claimed: false,
    provider_calls: 0, import_replays: 0, widths: [1440, 390], blocked_requests: blocked, page_errors: errors,
  }, null, 2) + '\n');
  console.log('PASS: retained model draft visible on current UI; no new inference, import, mutation or approval.');
} finally {
  await browser.close();
}
