// TEST ONLY. Synthetic OAuth/account/file state, not a Google login or proxy.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const SHEETS = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DOCS = 'https://www.googleapis.com/auth/documents';
const clone = v => structuredClone(v);
const value = v => ({ userEnteredValue: { [typeof v === 'string' ? 'stringValue' : typeof v === 'number' ? 'numberValue' : 'boolValue']: v } });
export function syntheticSheet() {
  return { spreadsheetId: 'synthetic_sheet', properties: { title: 'Synthetic inventory' }, sheets: [
    { properties: { sheetId: 0, title: 'Inputs', sheetType: 'GRID', gridProperties: { rowCount: 200, columnCount: 26 } }, data: [{ rowData: [{ values: [value('0012'), value(12.5), value(false), {}, value('=1+1')] }, { values: [value('明日'), value(0), value(true)] }] }] },
    { properties: { sheetId: 7, title: "Team's notes", sheetType: 'GRID', gridProperties: { rowCount: 200, columnCount: 26 } }, data: [{ rowData: [{ values: [value('second tab')] }] }] },
  ] };
}
export function createGoogleSimulator() {
  const accounts = new Map([['alice', { scopes: new Set([SHEETS, DOCS]), revoked: false }], ['bob', { scopes: new Set([SHEETS, DOCS]), revoked: false }]]);
  const tokens = new Map(), refreshTokens = new Map(), files = new Map(), events = [], faults = [];
  function issue(account = 'alice', { expired = false, scopes = [SHEETS, DOCS] } = {}) {
    if (!accounts.has(account)) throw new Error('unknown synthetic account');
    const accessToken = `SIMULATED_ACCESS_${randomUUID()}`, refreshToken = `SIMULATED_REFRESH_${randomUUID()}`;
    tokens.set(accessToken, { account, scopes: new Set(scopes), expiresAt: expired ? 0 : Date.now() + 3600000 });
    refreshTokens.set(refreshToken, { account, scopes: new Set(scopes), revoked: false });
    return { accessToken, refreshToken, clientId: 'SIMULATED_CLIENT', clientSecret: 'SIMULATED_SECRET', expiresAt: expired ? 0 : Date.now() + 3600000 };
  }
  files.set('synthetic_sheet', { type: 'sheet', permissions: new Map([['alice', 'writer']]), data: syntheticSheet() });
  function send(res, status, body) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
  const error = (res, status, code) => send(res, status, { error: { code: status, status: code } });
  function authorize(req, res, scope, file, write) {
    const token = tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!token || token.expiresAt <= Date.now() || accounts.get(token.account)?.revoked) { error(res, 401, 'UNAUTHENTICATED'); return null; }
    if (!token.scopes.has(scope) || !accounts.get(token.account).scopes.has(scope)) { error(res, 403, 'PERMISSION_DENIED'); return null; }
    if (file && (!file.permissions.has(token.account) || write && file.permissions.get(token.account) !== 'writer')) { error(res, 403, 'PERMISSION_DENIED'); return null; }
    return token.account;
  }
  function document(file, account, tabs) {
    const body = { content: [{ endIndex: 1, sectionBreak: { sectionStyle: {} } }, { startIndex: 1, endIndex: file.text.length + 2, paragraph: { elements: [{ startIndex: 1, endIndex: file.text.length + 2, textRun: { content: file.text + '\n', textStyle: {} } }] } }] };
    const data = { documentId: file.id, title: file.title, ...(file.permissions.get(account) === 'writer' ? { revisionId: file.revision } : {}) };
    if (tabs) data.tabs = [{ tabProperties: { tabId: file.tabId, title: 'Tab 1', index: 0 }, documentTab: { body }, ...(file.extraTab ? { childTabs: [{ tabProperties: { tabId: 'extra' }, documentTab: { body } }] } : {}) }];
    else data.body = body;
    return data;
  }
  const server = http.createServer(async (req, res) => {
    // Logs retain path/method/status identity, never headers, token bodies or queries.
    const url = new URL(req.url, 'http://127.0.0.1'); const path = url.pathname;
    const event = { method: req.method, path }; events.push(event);
    res.on('finish', () => { event.status = res.statusCode; });
    try {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 1000000) { error(res, 413, 'TOO_LARGE'); return; } chunks.push(c); }
      const raw = Buffer.concat(chunks).toString('utf8');
      const fi = faults.findIndex(f => f.path === path && (!f.method || f.method === req.method));
      const fault = fi >= 0 ? faults.splice(fi, 1)[0] : null;
      if (fault?.before) fault.before({ files, accounts, tokens });
      if (fault?.status) { if (fault.location) res.setHeader('location', fault.location); send(res, fault.status, fault.body ?? { error: { status: 'INJECTED' } }); return; }
      if (fault?.oversize) { send(res, 200, { padding: 'x'.repeat(fault.oversize) }); return; }
      if (fault?.disconnectBefore) { req.socket.destroy(); return; }
      if (path === '/token' && req.method === 'POST') {
        const form = new URLSearchParams(raw), refresh = refreshTokens.get(form.get('refresh_token'));
        if (form.get('grant_type') !== 'refresh_token' || form.get('client_id') !== 'SIMULATED_CLIENT' || form.get('client_secret') !== 'SIMULATED_SECRET' || !refresh || refresh.revoked || accounts.get(refresh.account).revoked) { send(res, 400, { error: 'invalid_grant' }); return; }
        const access = `SIMULATED_ACCESS_${randomUUID()}`;
        tokens.set(access, { account: refresh.account, scopes: new Set(refresh.scopes), expiresAt: Date.now() + 3600000 });
        send(res, 200, { access_token: access, expires_in: 3600, token_type: 'Bearer', scope: [...refresh.scopes].join(' ') }); return;
      }
      const sheetMatch = /^\/v4\/spreadsheets\/([A-Za-z0-9_-]+)$/.exec(path);
      if (sheetMatch && req.method === 'GET') {
        const file = files.get(sheetMatch[1]);
        if (!authorize(req, res, SHEETS, file, false)) return;
        if (!file || file.type !== 'sheet') { error(res, 404, 'NOT_FOUND'); return; }
        const data = clone(file.data), ranges = url.searchParams.getAll('ranges');
        // Metadata-only by default. Production client must explicitly request cells.
        const include = url.searchParams.get('includeGridData') === 'true' && !url.searchParams.has('fields');
        if (ranges.length) {
          const parsed = ranges.map(r => /^'((?:[^']|'')+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(r));
          if (parsed.some(p => !p)) { error(res, 400, 'INVALID_ARGUMENT'); return; }
          const col = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
          data.sheets = parsed.map(p => {
            const sheet = clone(file.data.sheets.find(s => s.properties.title === p[1].replaceAll("''", "'")));
            if (!sheet) return null;
            const r0 = +p[3] - 1, r1 = +p[5], c0 = col(p[2]), c1 = col(p[4]) + 1;
            const rows = sheet.data?.[0]?.rowData ?? [];
            sheet.data = [{ ...(r0 ? { startRow: r0 } : {}), ...(c0 ? { startColumn: c0 } : {}), rowData: rows.slice(r0, r1).map(r => ({ values: (r.values ?? []).slice(c0, c1) })) }];
            return sheet;
          });
          if (data.sheets.some(s => !s)) { error(res, 400, 'INVALID_ARGUMENT'); return; }
        }
        if (!include) data.sheets.forEach(s => { delete s.data; });
        if (fault?.response) send(res, 200, fault.response(data)); else send(res, 200, data);
        return;
      }
      if (path === '/v1/documents' && req.method === 'POST') {
        const account = authorize(req, res, DOCS, null, true); if (!account) return;
        const body = JSON.parse(raw);
        if (typeof body.title !== 'string' || !body.title.trim()) { error(res, 400, 'INVALID_ARGUMENT'); return; }
        const id = `synthetic_doc_${randomUUID()}`;
        // Literal tab ID from Google's output example, supplied by Parent:
        // https://developers.google.com/workspace/docs/api/samples/output-json
        const file = { id, type: 'doc', title: body.title, text: '', tabId: 't.0', revision: `rev_${randomUUID()}`, permissions: new Map([[account, 'writer']]) }; files.set(id, file); event.documentId = id;
        if (fault?.after) fault.after({ files, accounts, tokens }, file);
        if (fault?.disconnectAfter) { req.socket.destroy(); return; }
        send(res, 200, { documentId: id, title: file.title, revisionId: file.revision }); return; // Content in create is ignored.
      }
      const docMatch = /^\/v1\/documents\/([A-Za-z0-9_-]+)(:batchUpdate)?$/.exec(path);
      if (docMatch) {
        const file = files.get(docMatch[1]), write = !!docMatch[2];
        const account = authorize(req, res, DOCS, file, write); if (!account) return;
        if (!file || file.type !== 'doc') { error(res, 404, 'NOT_FOUND'); return; }
        if (!write && req.method === 'GET') { const data = document(file, account, url.searchParams.get('includeTabsContent') === 'true'); send(res, 200, fault?.response ? fault.response(data) : data); return; }
        if (write && req.method === 'POST') {
          const body = JSON.parse(raw);
          if (!body.writeControl?.requiredRevisionId || body.writeControl.requiredRevisionId !== file.revision || body.writeControl.targetRevisionId) { error(res, 400, 'INVALID_ARGUMENT'); return; }
          // Validate the entire batch before mutation; response replies align 1:1.
          if (!Array.isArray(body.requests) || body.requests.length < 1 || body.requests.length > 10 || body.requests.some(r => Object.keys(r).length !== 1 || !r.insertText || r.insertText.location?.tabId !== file.tabId || r.insertText.location?.index !== 1 || typeof r.insertText.text !== 'string' || !r.insertText.text.length)) { error(res, 400, 'INVALID_ARGUMENT'); return; }
          event.insertTabIds = body.requests.map(r => r.insertText.location.tabId);
          let next = file.text; for (const r of body.requests) next = r.insertText.text + next;
          file.text = next; file.revision = `rev_${randomUUID()}`; event.documentId = file.id;
          if (fault?.after) fault.after({ files, accounts, tokens }, file);
          if (fault?.disconnectAfter) { req.socket.destroy(); return; }
          send(res, 200, { documentId: file.id, replies: body.requests.map(() => ({})), writeControl: { requiredRevisionId: file.revision } }); return;
        }
      }
      error(res, 404, 'NOT_FOUND');
    } catch { if (!res.destroyed && !res.headersSent) error(res, 400, 'INVALID_ARGUMENT'); }
  });
  return { server, accounts, tokens, refreshTokens, files, events, faults, issue,
    async start() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); return `http://127.0.0.1:${server.address().port}`; },
    async close() { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sim = createGoogleSimulator();
  const origin = await sim.start();
  // Deliberately synthetic fixture credentials printed only by this explicit CLI.
  process.stdout.write(JSON.stringify({ testOnly: true, actualGoogleAccount: false, origin, syntheticCredentials: sim.issue(), spreadsheetId: 'synthetic_sheet' }, null, 2) + '\n');
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, async () => { await sim.close(); });
}
