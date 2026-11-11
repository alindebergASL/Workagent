const $ = selector => document.querySelector(selector);
let state, stream, refreshing = false, pendingRefresh = false, editVersion;
let editing = false, draftDirty = false, pageActive = true;
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status})`);
  return value;
}
function render(next) {
  state = next;
  $('#welcome').hidden = !!state.sessionId; $('#work').hidden = !state.sessionId;
  $('#status').textContent = ({ new: '', working: 'Comparing the venues…', ready: 'Recommendation ready', interrupted: 'Work paused before a recommendation was retained', 'needs-update': 'Constraint saved; comparison needs an update' })[state.status];
  updateSaveState();
  $('#fixture-details').textContent = state.fixtureLabel;
  if (document.activeElement !== $('#budget')) $('#budget').value = (state.constraint?.budgetCents ?? 80000) / 100;
  $('#constraint-state').textContent = state.constraintApplied ? 'Both workers applied your current ceiling.' : 'The saved ceiling will be checked against each worker’s result.';
  $('#schedule').disabled = !!state.scheduleId;
  const schedule = state.schedule?.schedule ?? state.schedule;
  if (schedule?.scheduledAt) $('#schedule-state').textContent = schedule.lastDelivery ? 'Scheduled check delivered to your work. Your saved edits are preserved.' : `Next check: ${new Date(schedule.scheduledAt).toLocaleTimeString()}. The preview host must be running.`;
  $('#result').textContent = state.text ?? 'Reading the source and calculating costs…';
  $('#edit').disabled = !state.generatedText;
  const rows = (state.budget?.alternatives ?? []).map(venue => {
    const row = document.createElement('tr');
    for (const value of [venue.venue, `${venue.capacity} people`, money(venue.totalCents), venue.totalCents <= (state.constraint?.budgetCents ?? Infinity) ? 'Yes' : 'Over ceiling']) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    return row;
  });
  $('#venues').replaceChildren(...rows);
  connectFollow();
}
function updateSaveState() {
  $('#save-state').textContent = editing && draftDirty
    ? 'Unsaved draft · kept on this browser'
    : state?.humanText != null ? 'Your edits are saved' : '';
}
function connectFollow() {
  if (pageActive && state?.sessionId && !stream) {
    const connection = new EventSource('/api/follow');
    stream = connection;
    connection.onmessage = () => { if (pageActive && stream === connection) refresh(); };
    connection.onerror = () => {
      if (pageActive && stream === connection) $('#status').textContent = 'Reconnecting to your saved work…';
    };
  }
}
async function refresh() {
  if (refreshing) { pendingRefresh = true; return; }
  refreshing = true;
  try { render(await api('/api/work')); } catch (error) { $('#error').textContent = error.message; }
  finally { refreshing = false; if (pendingRefresh) { pendingRefresh = false; refresh(); } }
}
$('#start').onclick = async () => {
  $('#start').disabled = true; $('#error').textContent = '';
  try { render(await api('/api/start', {})); } catch (error) { $('#error').textContent = error.message; }
  finally { $('#start').disabled = false; }
};
$('#edit').onclick = () => {
  const draft = localStorage.getItem(`workagent-dsh-draft-${state.sessionId}`);
  editing = true; draftDirty = draft !== null;
  editVersion = state.version; $('#text').value = draft ?? state.text;
  $('#editor').hidden = false; $('#result').hidden = true; $('#edit').hidden = true; $('#text').focus();
  updateSaveState();
};
$('#text').oninput = () => {
  localStorage.setItem(`workagent-dsh-draft-${state.sessionId}`, $('#text').value);
  draftDirty = true;
  updateSaveState();
};
$('#cancel').onclick = () => {
  editing = false; draftDirty = false;
  $('#editor').hidden = true; $('#result').hidden = false; $('#edit').hidden = false;
  localStorage.removeItem(`workagent-dsh-draft-${state.sessionId}`);
  updateSaveState();
};
$('#editor').onsubmit = async event => {
  event.preventDefault(); $('#error').textContent = '';
  try { const updated = await api('/api/edit', { text: $('#text').value, version: editVersion }); $('#cancel').click(); render(updated); }
  catch (error) { $('#error').textContent = error.message; }
};
window.addEventListener('pagehide', () => {
  pageActive = false;
  if (stream) { stream.onmessage = null; stream.onerror = null; stream.close(); stream = null; }
});
window.addEventListener('pageshow', () => { pageActive = true; refresh(); });
await refresh();
if (state?.generatedText && localStorage.getItem(`workagent-dsh-draft-${state.sessionId}`) !== null) $('#edit').click();

$('#constraint-form').onsubmit = async event => {
  event.preventDefault(); $('#error').textContent = '';
  try { render(await api('/api/constraint', { budgetCents: Number($('#budget').value) * 100, version: state.version })); }
  catch (error) { $('#error').textContent = error.message; }
};
$('#schedule').onclick = async () => {
  $('#error').textContent = '';
  try { render(await api('/api/schedule', {})); } catch (error) { $('#error').textContent = error.message; }
};
