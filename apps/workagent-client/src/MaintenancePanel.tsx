import { useEffect, useRef, useState } from 'react';
import { MaintenanceActions, type Pending } from './maintenance-actions';
import type { Work } from './types';
type Source = { id: string; name: string; revision: number; status: string; fields: string[]; updatedAt: string };
type Observation = { id: string; sourceRevision: number; observedAt: string; value: unknown; error?: string; coalescedRevisions: number; missedIntervals: number };
export type Responsibility = { id: string; revision: number; sourceId: string; field: string; target: { sheetId: string; row: number; column: number }; status: string; detached: boolean; lastOutcome: string; lastErrorCode?: string | null; lastObservation: Observation | null; intervalSeconds: number; timezone: string; endAt: string | null; notifications: { threshold: number; digestMinutes: number; quiet: { start: number; end: number } | null } };
export type Notice = { id: string; responsibilityId: string; at: string; count: number; outcome: string; errorCode?: string; value?: unknown; sourceRevision?: number };
type API = <T>(path: string, input?: unknown, method?: string) => Promise<T>;
export function MaintenancePanel({ work, api, beforeAction, refresh }: { work: Extract<Work, { book: unknown }>; api: API; beforeAction: () => Promise<void>; refresh: () => Promise<void> }) {
  const [sources, setSources] = useState<Source[]>([]), [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('Synthetic inventory'), [content, setContent] = useState('{"available_units": 120, "reorder_point": 30}');
  const [fieldChoice, setField] = useState(''), [sheetId, setSheetId] = useState(work.book.sheetOrder[0]), [row, setRow] = useState(1), [column, setColumn] = useState(1);
  const [interval, setInterval] = useState(60), [timezone, setTimezone] = useState('UTC'), [threshold, setThreshold] = useState(0), [digest, setDigest] = useState(0), [quietStart, setQuietStart] = useState(0), [quietEnd, setQuietEnd] = useState(0), [endAt, setEndAt] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const actions = useRef(new MaintenanceActions(localStorage, work.id));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selected = sources.find(s => s.id === sourceId);
  // Both the controlled select and submitted binding use a valid current field,
  // including the first render after creation or a renamed source revision.
  const field = selected?.fields.includes(fieldChoice) ? fieldChoice : selected?.fields[0] ?? '';
  useEffect(() => { setField(field); }, [field]);
  const config = () => ({ intervalSeconds: interval, timezone, catchUp: 'latest', notifications: { threshold, digestMinutes: digest, quiet: { start: quietStart, end: quietEnd } }, endAt: endAt ? new Date(endAt).toISOString() : null });
  const reload = async () => { const items = await api<Source[]>('/owned-sources'); if (mounted.current) setSources(items); };
  useEffect(() => { let active = true; api<Source[]>('/owned-sources').then(items => { if (active) setSources(items); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [work.eventSequence]);
  async function act(key: string, path: string, input: Record<string, unknown>, after?: (result: { id: string }) => void) {
    if (busy) return; setBusy(true); setError('');
    const requests = actions.current; let submitted: Pending | undefined;
    try {
      await beforeAction();
      if (!mounted.current) return;
      // Retry an uncertain acknowledgement with its original identity and exact body.
      submitted = requests.prepare(key, path, input, () => crypto.randomUUID());
      const result = await api<{ id: string }>(submitted.path, submitted.input); requests.accepted(submitted);
      if (!mounted.current) return;
      after?.(result); await reload(); if (mounted.current) await refresh();
    } catch (e) {
      if (submitted) requests.rejected(e, submitted);
      if (mounted.current) setError(e instanceof Error ? e.message : 'Unable to save maintenance settings.');
    } finally { if (mounted.current) setBusy(false); }
  }
  const manage = (r: Responsibility, action: string) => act(`${r.id}:${action}`, `/work/${work.id}/responsibilities/${r.id}`, { action, revision: r.revision, expected: work.expected, ...(action === 'configure' ? config() : {}) });
  return <details className="maintenance"><summary>Keep a cell current · {work.responsibilities?.filter(r => r.status === 'active').length ?? 0} active</summary>
    <p>Bind an owned synthetic JSON field to a sheet cell. Updates continue with this page closed. Manual edits protect the cell until you relink it.</p>
    {actions.current.read() && <button type="button" disabled={busy} onClick={() => { const p = actions.current.read(); if (p) void act(p.key, p.path, p.input); }}>Retry unresolved action</button>}
    {error && <p role="alert" className="notice">{error}</p>}
    <fieldset disabled={busy}><legend>Owned source</legend>
      <label>Source<select value={sourceId} onChange={e => { setSourceId(e.target.value); setContent(''); const s = sources.find(s => s.id === e.target.value); if (s) setName(s.name); }}><option value="">Create a new source</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name} · revision {s.revision} · {s.status}</option>)}</select></label>
      <label>Source name<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Complete JSON revision<textarea value={content} onChange={e => setContent(e.target.value)} /></label>
      <label>Or choose a synthetic JSON file<input type="file" accept=".json,application/json" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 65536) { setError('Choose a JSON file no larger than 64 KiB.'); return; } setContent(await f.text()); }} /></label>
      <button type="button" disabled={selected?.status === 'revoked'} onClick={() => void act('publish', '/owned-sources', { name, content, synthetic: true, ...(selected ? { sourceId: selected.id, expectedRevision: selected.revision } : {}) }, result => setSourceId(result.id))}>{selected ? 'Publish new revision' : 'Create owned source'}</button>
      {selected && <button type="button" className="secondary" onClick={() => void act('revoke', `/owned-sources/${selected.id}/revoke`, {})}>Revoke source access</button>}
    </fieldset>
    <fieldset disabled={busy}><legend>Binding and notification settings</legend>
      <label>Field<select value={field} onChange={e => setField(e.target.value)}>{selected?.fields.map(f => <option key={f}>{f}</option>)}</select></label>
      <label>Sheet<select value={sheetId} onChange={e => setSheetId(e.target.value)}>{work.book.sheetOrder.map(sid => <option key={sid} value={sid}>{work.book.sheets[sid].name}</option>)}</select></label>
      <div className="maintenance-row"><label>Row (1-based)<input type="number" min="1" value={row} onChange={e => setRow(+e.target.value)} /></label><label>Column (1-based)<input type="number" min="1" value={column} onChange={e => setColumn(+e.target.value)} /></label></div>
      <label>Check every seconds<input type="number" min="10" max="86400" value={interval} onChange={e => setInterval(+e.target.value)} /></label>
      <label>Timezone<input value={timezone} onChange={e => setTimezone(e.target.value)} /></label>
      <label>Notify after numeric change of at least<input type="number" min="0" value={threshold} onChange={e => setThreshold(+e.target.value)} /></label>
      <label>Digest delay in minutes (0 for immediate)<input type="number" min="0" value={digest} onChange={e => setDigest(+e.target.value)} /></label>
      <div className="maintenance-row"><label>Quiet from hour<input type="number" min="0" max="23" value={quietStart} onChange={e => setQuietStart(+e.target.value)} /></label><label>Until hour<input type="number" min="0" max="23" value={quietEnd} onChange={e => setQuietEnd(+e.target.value)} /></label></div>
      <small>Equal hours disable quiet hours. Missed observations coalesce to the latest revision; earlier revisions remain retained.</small>
      <label>End at (this device's local time; blank to continue)<input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)} /></label>
      <button type="button" disabled={!selected || selected.status !== 'active' || !field} onClick={() => void act('bind', `/work/${work.id}/responsibilities`, { sourceId, field, target: { sheetId, row: row - 1, column: column - 1 }, expected: work.expected, ...config() })}>Bind cell</button>
    </fieldset>
    {(work.responsibilities ?? []).map(r => <article key={r.id} className="proposal"><strong>{sources.find(s => s.id === r.sourceId)?.name ?? r.sourceId} · {r.field}</strong><p>{work.book.sheets[r.target.sheetId]?.name ?? r.target.sheetId}, row {r.target.row + 1}, column {r.target.column + 1}<br />{r.status} · {r.detached ? 'Protected manual edit' : r.lastOutcome.replaceAll('_', ' ')}<br />Every {r.intervalSeconds}s · {r.timezone}</p>
      {r.lastObservation && <p>Observed {r.lastObservation.observedAt} · source revision {r.lastObservation.sourceRevision}<br />Finding: {r.lastObservation.error ?? JSON.stringify(r.lastObservation.value)}<br />{r.lastObservation.coalescedRevisions} intermediate revisions and {r.lastObservation.missedIntervals} missed intervals coalesced.</p>}
      {r.lastErrorCode && <p role="alert" className="notice">Last update not applied: {r.lastErrorCode}. {r.lastErrorCode === 'invalid_workbook' && 'The updated sheet exceeds its size limit or is invalid. Reduce the sheet content or source value before retrying.'}</p>}
      {r.status !== 'ended' && <><button type="button" className="secondary" onClick={() => { setInterval(r.intervalSeconds); setTimezone(r.timezone); setThreshold(r.notifications.threshold); setDigest(r.notifications.digestMinutes); setQuietStart(r.notifications.quiet?.start ?? 0); setQuietEnd(r.notifications.quiet?.end ?? 0); setEndAt(r.endAt ? new Date(Date.parse(r.endAt) - new Date(r.endAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''); }}>Load current settings</button><button type="button" disabled={busy || sources.find(s => s.id === r.sourceId)?.status === 'revoked'} onClick={() => void manage(r, r.status !== 'active' ? 'resume' : 'pause')}>{r.status !== 'active' ? 'Resume with current access' : 'Pause'}</button><button type="button" disabled={busy} onClick={() => void manage(r, 'end')}>End</button><button type="button" disabled={busy} onClick={() => void manage(r, 'configure')}>Apply settings above</button>{r.detached && <button type="button" disabled={busy} onClick={() => void manage(r, 'relink')}>Relink this cell to source</button>}</>}
    </article>)}
    <div aria-label="Maintenance inbox"><strong>Maintenance inbox</strong>{!(work.inbox?.length) && <p>No new findings. Unchanged observations stay quiet.</p>}{work.inbox?.slice(-20).reverse().map(n => <p key={n.id}>{work.responsibilities?.find(r => r.id === n.responsibilityId)?.field ?? 'Source'} · revision {n.sourceRevision ?? '—'}<br />{n.at} · {n.outcome.replaceAll('_', ' ')}{n.errorCode ? ` (${n.errorCode})` : ''} · {JSON.stringify(n.value)}{n.count > 1 ? ` · ${n.count} findings in this digest` : ''}</p>)}</div>
  </details>;
}
