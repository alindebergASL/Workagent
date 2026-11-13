import { randomUUID } from 'node:crypto';
import { Fault, id, text, revision, anchor, validatePatch } from '../../../packages/workagent-contract/index.mjs';
import { authorize, work, same, event, dedup, digest, preconditions, commitEditorPatch } from './workspace.mjs';
import { parseSource } from './owned-files.mjs';
const timestamp = ms => new Date(ms).toISOString();
const responsibilities = s => Object.values(s.works).flatMap(w => (w.responsibilities ?? []).map(r => ({ w, r })));
function owned(s, principal, sourceId) {
  const source = s.ownedSources?.[id(sourceId)];
  if (!source || source.owner !== principal) throw new Fault('source_access_denied', 403);
  return source;
}
function settings(input) {
  const intervalSeconds = Number(input.intervalSeconds ?? 60);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 86400) throw new Fault('invalid_interval', 400);
  const timezone = input.timezone ?? 'UTC'; text(timezone, 100);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new Fault('invalid_timezone', 400); }
  const threshold = input.notifications?.threshold ?? 0, digestMinutes = input.notifications?.digestMinutes ?? 0, quiet = input.notifications?.quiet ?? null;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || !Number.isInteger(digestMinutes) || digestMinutes < 0 || digestMinutes > 10080
    || quiet && (!Number.isInteger(quiet.start) || !Number.isInteger(quiet.end) || quiet.start < 0 || quiet.start > 23 || quiet.end < 0 || quiet.end > 23)) throw new Fault('invalid_notifications', 400);
  const endAt = input.endAt || null;
  if (endAt && (typeof endAt !== 'string' || !Number.isFinite(Date.parse(endAt)))) throw new Fault('invalid_end', 400);
  if (input.catchUp && input.catchUp !== 'latest') throw new Fault('invalid_catch_up', 400);
  return { intervalSeconds, timezone, catchUp: 'latest', notifications: { threshold, digestMinutes, quiet }, endAt, pauseConditions: ['owner_pause', 'source_revoked', 'grant_changed'], endConditions: { at: endAt } };
}
function quietNow(r, now) {
  const quiet = r.notifications.quiet; if (!quiet || quiet.start === quiet.end) return false;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: r.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  return quiet.start < quiet.end ? hour >= quiet.start && hour < quiet.end : hour >= quiet.start || hour < quiet.end;
}
function flush(w, r, now) {
  if (!r.pendingNotice || quietNow(r, now) || now < r.pendingNotice.dueAt) return;
  (w.inbox ??= []).push({ id: randomUUID(), responsibilityId: r.id, at: timestamp(now), count: r.pendingNotice.count, ...r.pendingNotice.latest });
  r.pendingNotice = null;
}
function notice(w, r, outcome, observation, now, errorCode) {
  const signature = digest({ outcome, value: observation.value, error: observation.error, errorCode });
  if (outcome === 'unchanged' || signature === r.noticeSignature) return;
  if (outcome === 'changed' && typeof observation.value === 'number' && typeof r.notifiedValue === 'number'
    && Math.abs(observation.value - r.notifiedValue) < r.notifications.threshold) return;
  r.noticeSignature = signature; r.notifiedValue = observation.value;
  const pending = r.pendingNotice ?? { count: 0, dueAt: now + r.notifications.digestMinutes * 60000 };
  pending.count++; pending.latest = { outcome, value: observation.value, sourceRevision: observation.sourceRevision, observationId: observation.id, errorCode };
  r.pendingNotice = pending; flush(w, r, now);
}
function result(job) { return { outcome: job.outcome, observation: job.observation, ...(job.errorCode ? { errorCode: job.errorCode } : {}) }; }
function finish(s, w, r, job, outcome, now) {
  job.status = 'completed'; job.outcome = outcome; job.completedAt = timestamp(now);
  r.lastOutcome = outcome; r.lastObservation = job.observation; r.cursor = job.observation.sourceRevision;
  r.lastCompletedAt = job.completedAt; r.lastErrorCode = job.errorCode ?? null;
  notice(w, r, outcome, job.observation, now, job.errorCode); event(s, w, 'maintenance_outcome');
  return result(job);
}
export class Maintenance {
  constructor({ workspace, files, budgetReference = 'openrouter:configured-provider-limits', now = Date.now }) {
    this.workspace = workspace; this.store = workspace.store; this.files = files; this.budgetReference = budgetReference; this.now = now;
  }
  async sources(principal) { return this.store.transaction(s => {
    authorize(s, principal); return Object.values(s.ownedSources ?? {}).filter(x => x.owner === principal).map(x => ({ id: x.id, name: x.name, revision: x.revision, status: x.status, fields: x.fields, updatedAt: x.updatedAt }));
  }); }
  async publish(principal, input) {
    id(input.commandId); text(input.name, 200);
    if (input.synthetic !== true || Object.keys(input).some(k => !['commandId', 'name', 'content', 'synthetic', 'sourceId', 'expectedRevision'].includes(k))) throw new Fault('invalid_owned_source', 400);
    const data = parseSource(input.content);
    // Check access before touching disk; recheck after IO before publishing authority.
    const replay = await this.store.transaction(s => {
      authorize(s, principal);
      const old = s.commands[input.commandId];
      if (old && old.hash !== digest(input)) throw new Fault('command_conflict');
      if (old) return old.result;
      if (input.sourceId) { const source = owned(s, principal, input.sourceId); if (source.status !== 'active') throw new Fault('source_revoked'); }
      return null;
    });
    if (replay) return replay;
    const blob = await this.files.write(principal, input.content);
    return this.store.transaction(s => {
      authorize(s, principal); return dedup(s, input.commandId, input, () => {
        s.ownedSources ??= {};
        const source = input.sourceId ? owned(s, principal, input.sourceId) : { id: randomUUID(), owner: principal, revision: 0, revisions: [], status: 'active', synthetic: true };
        if (source.status !== 'active') throw new Fault('source_revoked');
        if (input.sourceId && source.revision !== revision(input.expectedRevision)) throw new Fault('source_conflict');
        source.revision++; source.name = input.name; source.fields = Object.keys(data); source.updatedAt = timestamp(this.now());
        source.revisions.push({ revision: source.revision, ...blob, at: source.updatedAt });
        s.ownedSources[source.id] = source;
        for (const { w, r } of responsibilities(s)) if (r.sourceId === source.id) { r.nextDue = Math.min(r.nextDue, this.now()); event(s, w, 'source_revised'); }
        return { id: source.id, revision: source.revision, hash: blob.hash, at: source.updatedAt };
      });
    });
  }
  async revokeSource(principal, sourceId, input) { return this.store.transaction(s => {
    authorize(s, principal); return dedup(s, input.commandId, { sourceId, ...input }, () => {
      const source = owned(s, principal, sourceId); source.status = 'revoked';
      for (const { w, r } of responsibilities(s)) if (r.sourceId === sourceId && r.status !== 'ended') { r.status = 'revoked'; r.revision++; r.lastOutcome = 'source_revoked'; event(s, w, 'source_revoked'); }
      return { status: source.status };
    });
  }); }
  async create(principal, workId, input) {
    const config = settings(input); text(input.field, 100);
    const target = validatePatch({ cells: [{ sheetId: input.target?.sheetId, row: input.target?.row, column: input.target?.column, value: null }] }).cells[0]; delete target.value;
    return this.store.transaction(s => {
      authorize(s, principal); const w = work(s, workId), source = owned(s, principal, input.sourceId);
      return dedup(s, input.commandId, { workId, ...input }, () => {
        if (!same(input.expected, preconditions(s, w))) throw new Fault('save_conflict');
        if (source.status !== 'active' || !source.fields.includes(input.field)) throw new Fault('source_field_unavailable');
        const sheet = w.book.sheets[target.sheetId];
        if (!sheet || target.row >= sheet.rowCount || target.column >= sheet.columnCount) throw new Fault('cell_bounds', 400);
        if ((w.responsibilities ?? []).some(r => r.status !== 'ended' && anchor(r.target) === anchor(target))) throw new Fault('cell_already_bound');
        const r = { id: randomUUID(), workId, sourceId: source.id, field: input.field, target, ...config, revision: 1, status: 'active',
          scope: { sourceId: source.id, workId, target }, actions: ['read_owned_json_field', 'maintain_cell'], budgetReference: this.budgetReference,
          triggers: ['interval', 'source_revision'], permissionRevision: s.permissionRevision, cursor: 0, nextDue: this.now(), ordinal: 0,
          detached: w.humanCells.includes(anchor(target)), lastOutcome: 'waiting', lastObservation: null };
        (w.responsibilities ??= []).push(r); event(s, w, 'responsibility_created'); return { id: r.id };
      });
    });
  }
  async manage(principal, workId, responsibilityId, input) { return this.store.transaction(s => {
    authorize(s, principal); const w = work(s, workId), r = w.responsibilities?.find(r => r.id === responsibilityId);
    if (!r) throw new Fault('responsibility_not_found', 404);
    return dedup(s, input.commandId, { workId, responsibilityId, ...input }, () => {
      if (r.revision !== input.revision) throw new Fault('responsibility_conflict');
      if (r.status === 'ended') throw new Fault('responsibility_ended');
      if (!['pause', 'resume', 'end', 'relink', 'configure'].includes(input.action)) throw new Fault('invalid_action', 400);
      if (['resume', 'relink'].includes(input.action) && owned(s, principal, r.sourceId).status !== 'active') throw new Fault('source_revoked');
      if (input.action === 'relink') {
        if (!same(input.expected, preconditions(s, w))) throw new Fault('save_conflict');
        const sheet = w.book.sheets[r.target.sheetId];
        if (!sheet || r.target.row >= sheet.rowCount || r.target.column >= sheet.columnCount) throw new Fault('cell_bounds');
        w.humanCells = w.humanCells.filter(key => key !== anchor(r.target)); r.detached = false;
      }
      if (input.action === 'configure') Object.assign(r, settings(input));
      if (input.action === 'pause') r.status = 'paused';
      if (input.action === 'resume') { r.status = 'active'; r.permissionRevision = s.permissionRevision; }
      if (input.action === 'end') r.status = 'ended';
      r.revision++; r.nextDue = this.now(); r.lastOutcome = input.action; event(s, w, `responsibility_${input.action}`);
      return { id: r.id, revision: r.revision, status: r.status };
    });
  }); }
  async admitDue(principal) {
    const now = this.now();
    const due = await this.store.transaction(s => {
      if (s.owner !== principal || !s.enabled) return [];
      const result = [];
      for (const { w, r } of responsibilities(s)) {
        const pending = !!r.pendingNotice; flush(w, r, now); if (pending && !r.pendingNotice) event(s, w, 'maintenance_digest');
        if (r.status !== 'active') continue;
        if (r.endAt && now >= Date.parse(r.endAt)) { r.status = 'ended'; r.revision++; r.lastOutcome = 'ended'; event(s, w, 'responsibility_ended'); continue; }
        const source = s.ownedSources?.[r.sourceId];
        if (r.permissionRevision !== s.permissionRevision || source?.status !== 'active' || source?.owner !== principal) {
          r.status = 'revoked'; r.revision++; r.lastOutcome = 'revoked'; event(s, w, 'responsibility_revoked'); continue;
        }
        if (r.nextDue > now || Object.values(s.jobs).some(j => j.responsibilityId === r.id && ['queued', 'running'].includes(j.status))) continue;
        result.push({ workId: w.id, id: r.id, revision: r.revision, due: r.nextDue, sourceRevision: source.revision, sourceId: source.id,
          blob: source.revisions.find(v => v.revision === source.revision), field: r.field });
        if (result.length === 32) break;
      }
      return result;
    });
    for (const candidate of due) {
      let data, error;
      // No database lock is held during filesystem access. The transaction below pins
      // the immutable revision actually read; a concurrent publish is retried next wake.
      try { if (!candidate.blob) throw new Fault('source_revision_gap'); data = await this.files.read(principal, candidate.blob.hash); }
      catch (e) { error = e instanceof Fault ? e.code : e.code === 'ENOENT' ? 'source_deleted_or_unavailable' : 'source_unavailable'; }
      await this.store.transaction(s => {
        if (s.owner !== principal || !s.enabled) return null;
        const w = work(s, candidate.workId), r = w.responsibilities.find(r => r.id === candidate.id), source = s.ownedSources[candidate.sourceId];
        if (r.status !== 'active' || r.revision !== candidate.revision || r.nextDue !== candidate.due || source.revision !== candidate.sourceRevision || source.status !== 'active' || source.owner !== principal || r.permissionRevision !== s.permissionRevision
          || Object.values(s.jobs).some(j => j.responsibilityId === r.id && ['queued', 'running'].includes(j.status))) return null;
        const observation = { id: randomUUID(), sourceId: source.id, sourceRevision: candidate.sourceRevision, hash: candidate.blob?.hash ?? null,
          observedAt: timestamp(this.now()), data: data ?? null, value: data?.[r.field] ?? null,
          error: error ?? (Object.hasOwn(data ?? {}, r.field) ? null : 'source_field_missing'),
          fromRevision: r.cursor, coalescedRevisions: Math.max(0, source.revision - r.cursor - 1), missedIntervals: Math.max(0, Math.floor((now - candidate.due) / (r.intervalSeconds * 1000))) };
        (s.observations ??= {})[observation.id] = observation;
        const commandId = `maintenance_${r.id}_${++r.ordinal}`;
        dedup(s, commandId, { responsibilityId: r.id, ordinal: r.ordinal }, () => {
          s.jobs[commandId] = { id: commandId, kind: 'maintenance', workId: w.id, responsibilityId: r.id, responsibilityRevision: r.revision,
            permissionRevision: s.permissionRevision, observation, status: 'queued', phase: 'admitted' };
          return { workId: w.id, commandId };
        });
        r.nextDue = now + r.intervalSeconds * 1000; r.lastOutcome = 'queued'; event(s, w, 'maintenance_admitted'); return null;
      });
    }
  }
  async run(principal, claimed) { return this.store.transaction(s => {
    if (s.owner !== principal) throw new Fault('access_denied', 403);
    const job = s.jobs[claimed.id]; if (!job || job.kind !== 'maintenance') throw new Fault('job_not_found');
    if (job.status === 'completed') return result(job);
    if (job.status !== 'running') throw new Fault('job_not_running');
    const w = work(s, job.workId), r = w.responsibilities.find(r => r.id === job.responsibilityId), now = this.now(), observation = job.observation;
    let outcome;
    if (!s.enabled || s.permissionRevision !== job.permissionRevision || s.ownedSources[r.sourceId]?.status !== 'active' || s.ownedSources[r.sourceId]?.owner !== principal) outcome = 'revoked';
    else if (r.status !== 'active') outcome = r.status;
    else if (r.endAt && now >= Date.parse(r.endAt)) { r.status = 'ended'; r.revision++; outcome = 'ended'; }
    else if (r.revision !== job.responsibilityRevision) outcome = 'configuration_changed';
    else if (observation.error) outcome = observation.error;
    else if (r.detached || w.humanCells.includes(anchor(r.target))) { r.detached = true; outcome = 'protected'; }
    else if (Object.values(s.jobs).some(j => j.workId === w.id && j.kind !== 'maintenance' && ['queued', 'running'].includes(j.status))
      || !same(job.expected, preconditions(s, w))) outcome = 'work_changed';
    else {
      const cell = w.book.sheets[r.target.sheetId]?.cellData?.[r.target.row]?.[r.target.column];
      if (!w.book.sheets[r.target.sheetId]) { r.detached = true; outcome = 'protected'; }
      else if (!cell?.f && digest(cell?.v ?? null) === digest(observation.value)) outcome = 'unchanged';
      else {
        try {
          const patch = validatePatch({ cells: [{ ...r.target, value: observation.value }] });
          const committed = commitEditorPatch(s, w, patch, job.expected, 'maintenance_changed');
          outcome = committed.status === 'applied' ? 'changed' : 'protected';
        } catch (error) {
          // These synchronous validators finish before commitEditorPatch mutates
          // the workbook/revision. Settle only their confirmed refusal, in this
          // same transaction. Store/COMMIT/acknowledgement failures stay uncertain.
          if (!(error instanceof Fault) || error.status !== 400) throw error;
          job.errorCode = error.code; outcome = 'validation_failed';
        }
      }
    }
    return finish(s, w, r, job, outcome, now);
  }); }
}
