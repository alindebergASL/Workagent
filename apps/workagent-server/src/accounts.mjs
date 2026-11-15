import { id } from '../../../packages/workagent-contract/index.mjs';
// Explicit operator injection only. There are no built-in peers or enrollment API.
export function configuredAccounts(owner, token, accounts = []) {
  if (!Array.isArray(accounts) || accounts.length > 20) throw new Error('invalid_accounts');
  const ids = new Set([owner]), tokens = new Set([token]);
  return accounts.map(account => {
    if (!account || Object.keys(account).some(k => !['id', 'name', 'token'].includes(k))) throw new Error('invalid_account');
    id(account.id);
    if (ids.has(account.id) || typeof account.token !== 'string' || account.token.length < 32 || tokens.has(account.token)) throw new Error('invalid_account');
    if (typeof account.name !== 'string' || !account.name.trim() || account.name.length > 100) throw new Error('invalid_account_name');
    ids.add(account.id); tokens.add(account.token);
    return Object.freeze({ id: account.id, name: account.name.trim(), token: account.token });
  });
}
