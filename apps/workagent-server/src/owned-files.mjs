import { constants } from 'node:fs';
import { mkdir, lstat, open, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
export const SOURCE_BYTES = 65536;
export const hashBytes = value => createHash('sha256').update(value).digest('hex');
export function parseSource(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > SOURCE_BYTES) throw new Fault('source_size', 400);
  let data; try { data = JSON.parse(content); } catch { throw new Fault('source_partial_or_invalid', 400); }
  if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length > 1000) throw new Fault('source_object_required', 400);
  for (const [key, value] of Object.entries(data)) {
    if (!key || key.length > 100 || ['__proto__', 'prototype', 'constructor'].includes(key)
      || (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
      || typeof value === 'string' && value.length > 20000 || typeof value === 'number' && !Number.isFinite(value)) throw new Fault('source_scalar_required', 400);
  }
  return data;
}
// Only server-generated owner/content identities reach disk. Original filenames are labels.
// Direct host-file modification is unsupported: updates publish a new immutable revision.
export class OwnedFiles {
  constructor(stateRoot) { this.root = resolve(stateRoot); }
  async directory(owner) {
    const area = join(this.root, 'owned-sources'), dir = join(area, hashBytes(owner));
    for (const path of [this.root, area, dir]) {
      try { await mkdir(path, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Fault('source_path_denied', 403);
    }
    // Persist directory entries as well as the eventual file entry. This also
    // covers a concurrent creator that has not yet synced the parent directory.
    for (const path of [this.root, area]) {
      const parent = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await parent.sync(); } finally { await parent.close(); }
    }
    return dir;
  }
  async write(owner, content) {
    parseSource(content); const hash = hashBytes(content), dir = await this.directory(owner), path = join(dir, `${hash}.json`);
    let exists = false;
    try { await this.read(owner, hash); exists = true; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    // A crash during writing leaves only an unreferenced staging file. Publish the
    // fully fsynced inode without replacing an existing content identity.
    if (!exists) {
      const staging = join(dir, `${hash}-${randomUUID()}.pending`);
      const file = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
      try { await link(staging, path); }
      catch (e) { if (e.code !== 'EEXIST') throw e; await this.read(owner, hash); }
    }
    // Even a deduplicated upload must wait for the directory durability barrier.
    const handle = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
    return { hash, bytes: Buffer.byteLength(content) };
  }
  async read(owner, hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Fault('source_path_denied', 403);
    const dir = await this.directory(owner);
    const file = await open(join(dir, `${hash}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > SOURCE_BYTES) throw new Fault('source_size', 400);
      const buffer = Buffer.alloc(SOURCE_BYTES + 1); let size = 0;
      while (size < buffer.length) { const read = await file.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
      if (size > SOURCE_BYTES) throw new Fault('source_size', 400);
      const bytes = buffer.subarray(0, size);
      if (hashBytes(bytes) !== hash) throw new Fault('source_revision_mismatch');
      return parseSource(bytes.toString('utf8'));
    } finally { await file.close(); }
  }
}
