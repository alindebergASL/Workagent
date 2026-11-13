// Fixture only; production exclusively uses PostgreSQL. No database access in tests.
import { readFile, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
export class FileFixtureStore {
  tail = Promise.resolve();
  constructor(path) { this.path = path; }
  read(fn) {
    const operation = this.tail.then(async () => structuredClone(await fn(JSON.parse(await readFile(this.path, 'utf8')))));
    this.tail = operation.catch(() => {}); return operation;
  }
  transaction(fn) {
    const operation = this.tail.then(async () => {
      const state = JSON.parse(await readFile(this.path, 'utf8'));
      const result = await fn(state);
      const file = await open(this.path + '.next', 'w', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(this.path + '.next', this.path);
      const dir = await open(dirname(this.path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
      return structuredClone(result);
    });
    this.tail = operation.catch(() => {}); return operation;
  }
}
