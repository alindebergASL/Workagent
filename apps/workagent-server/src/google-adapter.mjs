import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DocumentDataModel, ThemeService } from '@univerjs/core';
import { id, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { validateDocument, documentText, blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { googleTransport, googleFail, GoogleAdapterError } from './google-transport.mjs';

export { GoogleAdapterError, GOOGLE_SCOPES } from './google-transport.mjs';
export const GOOGLE_SHEET_POLICY = 'Selected bounded ranges only; typed literal strings, numbers and booleans. Missing cells remain absent. Formulas (including cached results), authored formatting, merges, charts, controls, rich text and other unsupported structures are refused. This preview creates no local work. Layout and unselected cells/tabs are not imported.';
export const GOOGLE_DOC_POLICY = 'Plain text in one Google Docs tab; line endings normalize to LF. Rich formatting, lists and nondefault page layout are refused before create. Google default appearance can differ. Success requires authoritative text/title readback; this is not full-fidelity native document export.';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every(k => allowed.includes(k));
const nonempty = v => Array.isArray(v) ? v.length > 0 : object(v) ? Object.keys(v).length > 0 : v !== undefined && v !== null;
const reject = () => googleFail('google_unsupported_sheet');
const remoteId = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) googleFail('invalid_google_id'); return value; };
// Docs tab IDs are JSON selectors, not URL resource paths. Google's example uses
// t.0: https://developers.google.com/workspace/docs/api/samples/output-json
const documentTabId = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value)) googleFail('invalid_google_tab_id'); return value; };
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const column = value => [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
function selections(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) googleFail('invalid_google_ranges');
  let cells = 0; const titles = new Set();
  return input.map(v => {
    if (!keys(v, ['sheetTitle', 'range']) || typeof v.sheetTitle !== 'string' || !v.sheetTitle.trim() || v.sheetTitle.length > 100 || /[\x00-\x1f]/.test(v.sheetTitle) || titles.has(v.sheetTitle)) googleFail('invalid_google_ranges');
    titles.add(v.sheetTitle);
    const m = typeof v.range === 'string' && /^([A-Z]{1,2})([1-9]\d{0,4}):([A-Z]{1,2})([1-9]\d{0,4})$/.exec(v.range);
    if (!m) googleFail('invalid_google_ranges');
    const r0 = +m[2] - 1, r1 = +m[4] - 1, c0 = column(m[1]), c1 = column(m[3]);
    if (r0 > r1 || c0 > c1 || r1 >= 10000 || c1 >= 200 || (cells += (r1 - r0 + 1) * (c1 - c0 + 1)) > 50000) googleFail('google_range_bounds');
    return { ...v, r0, r1, c0, c1, a1: `'${v.sheetTitle.replaceAll("'", "''")}'!${v.range}` };
  });
}
function sheetPreview(data, wanted, spreadsheetId, previewId) {
  if (!object(data) || data.spreadsheetId !== spreadsheetId || !Array.isArray(data.sheets) || data.sheets.length > 200 || !object(data.properties)) reject();
  for (const k of ['namedRanges', 'dataSources', 'dataSourceSchedules']) if (nonempty(data[k])) reject();
  const book = { id: previewId, name: data.properties.title, appVersion: '1.4.0', locale: 'enUS', styles: {}, sheetOrder: [], sheets: {} };
  const seen = new Set();
  for (const range of wanted) {
    const matches = data.sheets.filter(s => s.properties?.title === range.sheetTitle);
    if (matches.length !== 1) reject();
    const sheet = matches[0], props = sheet.properties, grid = props.gridProperties;
    if (!Number.isSafeInteger(props.sheetId) || props.sheetId < 0 || seen.has(props.sheetId) || props.sheetType && props.sheetType !== 'GRID' || !grid || !Number.isSafeInteger(grid.rowCount) || !Number.isSafeInteger(grid.columnCount) || range.r1 >= grid.rowCount || range.c1 >= grid.columnCount) reject();
    seen.add(props.sheetId);
    if (Object.entries(sheet).some(([k, v]) => !['properties', 'data'].includes(k) && nonempty(v))) reject();
    if (!Array.isArray(sheet.data) || sheet.data.length !== 1) reject(); // Never assume default get includes cells.
    const block = sheet.data[0];
    if (!keys(block, ['startRow', 'startColumn', 'rowData', 'rowMetadata', 'columnMetadata']) || (block.startRow ?? 0) !== range.r0 || (block.startColumn ?? 0) !== range.c0 || block.rowData !== undefined && !Array.isArray(block.rowData)) reject();
    const sid = `google_${props.sheetId}`, cellData = {};
    if ((block.rowData?.length ?? 0) > range.r1 - range.r0 + 1) reject();
    for (const [ri, row] of (block.rowData ?? []).entries()) {
      if (!keys(row, ['values']) || row.values !== undefined && !Array.isArray(row.values) || (row.values?.length ?? 0) > range.c1 - range.c0 + 1) reject();
      for (const [ci, cell] of (row.values ?? []).entries()) {
        if (!keys(cell, ['userEnteredValue', 'effectiveValue', 'formattedValue', 'effectiveFormat', 'userEnteredFormat', 'textFormatRuns', 'note', 'hyperlink', 'dataValidation', 'pivotTable', 'chipRuns'])) reject();
        for (const k of ['userEnteredFormat', 'textFormatRuns', 'note', 'hyperlink', 'dataValidation', 'pivotTable', 'chipRuns']) if (nonempty(cell[k])) reject();
        const entered = cell.userEnteredValue;
        if (!entered || !Object.keys(entered).length) { if (nonempty(cell.effectiveValue)) reject(); continue; }
        if (!keys(entered, ['stringValue', 'numberValue', 'boolValue']) || Object.keys(entered).length !== 1) reject(); // formulaValue never reads its cache.
        let v, t;
        if (Object.hasOwn(entered, 'stringValue')) { v = entered.stringValue; t = 1; if (typeof v !== 'string' || v.length > 20000 || v.includes('\0')) reject(); }
        else if (Object.hasOwn(entered, 'numberValue')) { v = entered.numberValue; t = 2; if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER) reject(); }
        else { v = entered.boolValue; t = 3; if (typeof v !== 'boolean') reject(); }
        (cellData[range.r0 + ri] ??= {})[range.c0 + ci] = { v, t };
      }
    }
    book.sheetOrder.push(sid); book.sheets[sid] = { id: sid, name: props.title, rowCount: Math.max(200, range.r1 + 1), columnCount: Math.max(26, range.c1 + 1), cellData };
  }
  return validateWorkbook(book);
}

export function validateGoogleSheetPreview({ response, spreadsheetId, ranges, previewId }) {
  remoteId(spreadsheetId); id(previewId);
  return sheetPreview(response, selections(ranges), spreadsheetId, previewId);
}

// Derive the opened plain baseline through the pinned SDK's own normalization.
// This retains Workagent's page geometry while including SDK-added view and
// hyphenation defaults. Never normalize the caller's authored styles away.
const plainNativeStyle = (() => {
  const model = new DocumentDataModel(blankDocument('google_plain_baseline'));
  try { return structuredClone(model.getSnapshot().documentStyle); }
  finally { model.dispose(); }
})();
// Pinned DocMenuStyleService supplies gray.900 to the normal typing controller.
// Its default font/size are elided from inserted runs; only this exact foreground
// (or an empty style) is plain. Authored font, decoration and other colors refuse.
const plainNativeTextStyle = (() => {
  const theme = new ThemeService();
  try { return { cl: { rgb: theme.getColorFromTheme('gray.900') } }; }
  finally { theme.dispose(); }
})();
export function prepareGoogleDocDelivery(input) {
  const doc = validateDocument(input);
  // The validated terminal section may carry its generated ID, never authored layout.
  if (doc.body.textRuns?.some(r => Object.entries(r.ts).some(([k, v]) => !Object.hasOwn(plainNativeTextStyle, k) || !isDeepStrictEqual(v, plainNativeTextStyle[k])))
      || doc.body.paragraphs.some(p => p.bullet || nonempty(p.paragraphStyle)) || nonempty(doc.lists)
      || Object.entries(doc.documentStyle).some(([k, v]) => !isDeepStrictEqual(v, plainNativeStyle[k]))
      || doc.body.sectionBreaks?.some(s => Object.keys(s).some(k => !['startIndex', 'sectionId'].includes(k)))) googleFail('google_plain_text_required');
  const content = documentText(doc);
  // Docs insertText strips certain control/PUA characters. Refuse before any effect.
  if (!content.length || /[\uE000-\uF8FF\u0000-\u0008\u000B-\u001F]/u.test(content) || !content.isWellFormed()) googleFail('google_unsupported_document_text');
  const action = { kind: 'google-doc-plain-text-v1', sourceId: doc.id, title: doc.title, text: content };
  return Object.freeze({ ...action, digest: hash(action), policy: GOOGLE_DOC_POLICY });
}
function checkedPlan(plan) {
  if (!keys(plan, ['kind', 'sourceId', 'title', 'text', 'digest', 'policy']) || plan.kind !== 'google-doc-plain-text-v1') googleFail('invalid_google_delivery_plan');
  const canonical = prepareGoogleDocDelivery(blankDocument(plan.sourceId, plan.title, plan.text));
  if (canonical.digest !== plan.digest || canonical.policy !== plan.policy) googleFail('invalid_google_delivery_plan');
  return canonical;
}
function readDoc(data, documentId) {
  if (!object(data) || data.documentId !== documentId || typeof data.revisionId !== 'string' || !data.revisionId || data.revisionId.length > 1024 || !Array.isArray(data.tabs) || data.tabs.length !== 1 || data.body !== undefined) googleFail('google_unsupported_document_response');
  const tab = data.tabs[0];
  if (tab.childTabs?.length || !tab.documentTab || !Array.isArray(tab.documentTab.body?.content)) googleFail('google_unsupported_document_response');
  const tabId = documentTabId(tab.tabProperties?.tabId); let content = '';
  for (const element of tab.documentTab.body.content) {
    if (element.sectionBreak && !element.paragraph) continue;
    if (!element.paragraph || element.paragraph.bullet || !Array.isArray(element.paragraph.elements)) googleFail('google_unsupported_document_response');
    for (const e of element.paragraph.elements) {
      if (!e.textRun || typeof e.textRun.content !== 'string' || Object.keys(e).some(k => !['startIndex', 'endIndex', 'textRun'].includes(k))) googleFail('google_unsupported_document_response');
      content += e.textRun.content;
    }
  }
  return { tabId, revisionId: data.revisionId, text: content, title: data.title };
}

function adapter(options) {
  const transport = googleTransport(options), provenance = transport.provenance;
  return Object.freeze({
    provenance,
    async previewSheet({ spreadsheetId, ranges, previewId = randomUUID() }) {
      remoteId(spreadsheetId); id(previewId); const selected = selections(ranges);
      // https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get
      // No fields mask: includeGridData must be explicit. Repeated bounded A1 ranges.
      const query = new URLSearchParams({ includeGridData: 'true' }); selected.forEach(r => query.append('ranges', r.a1));
      const { data, requestId } = await transport.session()('sheets', `/v4/spreadsheets/${spreadsheetId}?${query}`);
      return { kind: 'google-sheet-preview', book: sheetPreview(data, selected, spreadsheetId, previewId), policy: GOOGLE_SHEET_POLICY,
        provenance: { ...provenance, spreadsheetId, ranges: selected.map(r => r.a1), observedAt: new Date().toISOString(), requestId, adopted: false, calculation: 'formulas-refused' } };
    },
    prepareDocDelivery: prepareGoogleDocDelivery,
    async executeDocDelivery(plan, { operationId = randomUUID(), recordEffect, checkAuthority = async () => {} } = {}) {
      const action = checkedPlan(plan); id(operationId);
      // Mandatory caller-owned durable journal: reserve prevents a repeated logical
      // operation; record must finish before the next external request. Not Google idempotency.
      if (!recordEffect || typeof recordEffect.reserve !== 'function' || typeof recordEffect.record !== 'function') googleFail('google_effect_journal_required');
      await recordEffect.reserve({ operationId, digest: action.digest, provenance, stage: 'prepared' });
      const request = transport.session(); let documentId, stage = 'create', writeStarted = false;
      const receipt = { operationId, digest: action.digest, provenance, requestIds: [] };
      try {
        const createId = randomUUID(); receipt.requestIds.push(createId);
        await recordEffect.record({ ...receipt, stage: 'create_dispatching' });
        await checkAuthority(); writeStarted = true;
        // create makes a BLANK doc. https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/create
        const created = await request('docs', '/v1/documents', { method: 'POST', body: { title: action.title }, effect: true, beforeDispatch: checkAuthority, requestId: createId });
        documentId = remoteId(created.data?.documentId); receipt.documentId = documentId;
        await recordEffect.record({ ...receipt, stage: 'created' }); stage = 'read_blank';
        // Current tab shape deliberately requested; never silently use legacy first-tab body.
        const getPath = `/v1/documents/${documentId}?includeTabsContent=true`;
        await checkAuthority();
        const before = readDoc((await request('docs', getPath, { documentId })).data, documentId);
        if (before.text !== '\n' || before.title !== action.title) googleFail('google_new_document_not_blank');
        receipt.tabId = before.tabId; receipt.requiredRevisionId = before.revisionId; stage = 'batch_update';
        const updateId = randomUUID(); receipt.requestIds.push(updateId);
        await recordEffect.record({ ...receipt, stage: 'update_dispatching' });
        await checkAuthority();
        // https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate
        // requiredRevisionId mismatch is 400. No targetRevisionId merge/retry fallback.
        const updated = await request('docs', `/v1/documents/${documentId}:batchUpdate`, { method: 'POST', effect: true, beforeDispatch: checkAuthority, requestId: updateId, documentId,
          body: { requests: [{ insertText: { location: { index: 1, tabId: before.tabId }, text: action.text } }], writeControl: { requiredRevisionId: before.revisionId } } });
        if (updated.data?.documentId !== documentId || !Array.isArray(updated.data.replies) || updated.data.replies.length !== 1) googleFail('google_invalid_update_response', { outcome: 'unknown' });
        stage = 'readback';
        await checkAuthority();
        const after = readDoc((await request('docs', getPath, { documentId })).data, documentId);
        if (after.tabId !== before.tabId || after.title !== action.title || after.text !== action.text + '\n') googleFail('google_readback_mismatch', { outcome: 'unknown' });
        const result = { ...receipt, stage: 'verified', outcome: 'verified', readbackRevisionId: after.revisionId, verifiedText: action.text, ...(provenance.synthetic ? {} : { url: `https://docs.google.com/document/d/${documentId}/edit` }) };
        await recordEffect.record(result); return result;
      } catch (error) {
        const e = error instanceof GoogleAdapterError ? error : new GoogleAdapterError('google_delivery_interrupted');
        // A create may already have happened even when a later permission/revision
        // refusal is definitive for that call. Preserve both facts for reconciliation.
        const outcome = documentId || writeStarted && e.outcome !== 'refused' && e.dispatched !== false ? 'unknown' : e.outcome;
        const failure = { ...receipt, stage, outcome, code: e.code, callOutcome: e.outcome, ...(e.status ? { status: e.status } : {}) };
        try { await recordEffect.record(failure); } catch { /* Caller already has durable dispatch identity; never replay. */ }
        throw new GoogleAdapterError(e.code, failure);
      }
    },
  });
}
// Fixed official hosts, native fetch, caller-supplied server credentials only. No
// account connection is asserted by constructing this unintegrated adapter.
export function createGoogleAdapter({ credentials, timeoutMs, maxResponseBytes } = {}) { return adapter({ credentials, timeoutMs, maxResponseBytes }); }
export function createSimulatedGoogleAdapter({ origin, credentials, timeoutMs, maxResponseBytes } = {}) {
  if (!origin) googleFail('simulation_origin_required');
  return adapter({ simulationOrigin: origin, credentials, timeoutMs, maxResponseBytes });
}
