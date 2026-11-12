import test from 'node:test';
import assert from 'node:assert/strict';
import { identity } from '../src/http.mjs';
const token = 'synthetic-test-access-key-at-least-32-characters';
const auth = identity({ token, origin: 'https://private.example.test', owner: 'owner' });
test('identity fixture: server owns principal, cookie is signed, invalid login and forged cookie denied', () => {
  assert.throws(() => auth.login('wrong'), /access_denied/);
  const cookie = auth.login(token);
  assert.equal(auth.authenticate({ headers: { cookie: `workagent_session=${cookie}` } }), 'owner');
  assert.throws(() => auth.authenticate({ headers: { cookie: `workagent_session=${Date.now() + 1000}.forged` } }), /access_denied/);
  assert.throws(() => auth.authenticate({ headers: { 'x-user': 'owner' } }), /access_denied/);
});
test('identity fixture: mutations require exact configured origin and weak setup is rejected', () => {
  assert.throws(() => auth.origin({ method: 'POST', headers: { origin: 'https://evil.example.test' } }), /origin_denied/);
  assert.throws(() => auth.origin({ method: 'POST', headers: {} }), /origin_denied/);
  auth.origin({ method: 'POST', headers: { origin: 'https://private.example.test' } });
  assert.throws(() => identity({ token: 'short', origin: 'http://localhost', owner: 'owner' }), /32_characters/);
});
