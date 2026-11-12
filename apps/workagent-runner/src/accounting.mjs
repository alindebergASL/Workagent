import http from 'node:http';
export class DisabledAccounting {
  async policy() { throw new Error('accounting_bridge_not_connected'); }
  async reserve() { throw new Error('accounting_bridge_not_connected'); }
}
// Certificate-funded subaccount only. No authority or funding operations live here.
export class IssuerSocketAccounting {
  constructor(socketPath) { this.socketPath = socketPath; }
  call(operation, data) {
    const payload = JSON.stringify(data);
    if (Buffer.byteLength(payload) > 8_000_000) return Promise.reject(new Error('accounting_request_too_large'));
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: this.socketPath, path: `/workspace-accounting/v1/${operation}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 10000 }, res => {
        let body = '', bytes = 0; res.setEncoding('utf8');
        res.on('error', () => reject(new Error('issuer_response_unknown')));
        res.on('aborted', () => reject(new Error('issuer_response_unknown')));
        res.on('data', chunk => { body += chunk; bytes += Buffer.byteLength(chunk); if (bytes > 2_000_000) req.destroy(new Error('issuer_response_too_large')); });
        res.on('end', () => { if (res.statusCode !== 200) return reject(new Error('issuer_refused')); try { resolve(JSON.parse(body)); } catch { reject(new Error('issuer_invalid_response')); } });
      });
      req.on('error', () => reject(new Error('issuer_unavailable'))); req.on('timeout', () => req.destroy(new Error('issuer_timeout'))); req.end(payload);
    });
  }
  policy() { return this.call('policy', {}); }
  status() { return this.call('status', {}); }
  reserve(data) { return this.call('reserve', data); }
  dispatch(data) { return this.call('dispatch', data); }
  retain(data) { return this.call('retain', data); }
}
