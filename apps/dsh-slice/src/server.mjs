import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { bootHost } from './host.mjs';
import { Responsibility } from './responsibility.mjs';

const clientRoot = new URL('../client/', import.meta.url);
const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/sources/venues.csv', ['../fixtures/venues.csv', 'text/csv']]]);

export async function startServer({ stateRoot, port = 3310 }) {
  const host = await bootHost({ stateRoot, concurrentWorkers: true });
  const responsibility = await new Responsibility(host, join(stateRoot, 'product')).open();
  const streams = new Set();
  let origin;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
        res.writeHead(403); res.end('Local preview origin required'); return;
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && files.has(path)) {
        const [file, type] = files.get(path);
        res.setHeader('Content-Type', `${type}; charset=utf-8`);
        res.end(await readFile(new URL(file, clientRoot))); return;
      }
      if (req.method === 'GET' && path === '/api/follow' && responsibility.state.sessionId) {
        const abort = new AbortController(); streams.add(abort);
        res.on('close', () => abort.abort());
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        try {
          for await (const frame of host.controller.follow({ address: { kind: 'session', sessionId: responsibility.state.sessionId } }, abort.signal)) {
            // Each connection starts with DSH's current snapshot; subsequent durable
            // events invalidate the product projection. No invented replay cursor.
            if (frame.type === 'snapshot' || frame.type === 'event') res.write(`data: ${JSON.stringify({ refresh: true })}\n\n`);
          }
        } catch (error) { if (!abort.signal.aborted) res.destroy(error); }
        finally { streams.delete(abort); res.end(); }
        return;
      }
      let result;
      if (req.method === 'GET' && path === '/api/work') result = await responsibility.view();
      else if (req.method === 'POST' && ['/api/start', '/api/edit', '/api/constraint', '/api/schedule'].includes(path)) {
        if (req.headers['content-type'] !== 'application/json') { res.writeHead(415); res.end(); return; }
        let bytes = 0; const chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 25000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString()); }
        catch { res.writeHead(400); res.end('Invalid JSON'); return; }
        result = path === '/api/start' ? await responsibility.start() : path === '/api/edit' ? await responsibility.edit(body) : path === '/api/constraint' ? await responsibility.steer(body) : await responsibility.schedule();
      } else { res.writeHead(404); res.end('Not found'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      res.writeHead(error.status ?? 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    return { origin, host, responsibility, close: async () => {
      for (const abort of streams) abort.abort();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await host.close();
    } };
  } catch (error) { await host.close(); throw error; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stateRoot = fileURLToPath(new URL('../../../.local/dsh-slice/preview/', import.meta.url));
  const app = await startServer({ stateRoot });
  console.log(`Workagent scripted DSH fixture: ${app.origin}`);
  console.log('Fictional data; no model inference, external effects or owner data.');
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return; stopping = true;
    await app.close();
  });
}
