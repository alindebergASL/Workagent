import { useEffect, useState } from 'react';
import { CHART_LIMITS, CHART_SCOPE, chartRangeLabel, chartScale, parseChartRange, type ChartData, type SheetChart } from '../../../packages/workagent-contract/sheet-charts.mjs';
import type { ChartController } from './native-charts';
const colors = ['#2563eb', '#b45309', '#059669', '#9333ea'];
export function ChartGraphic({ chart, data }: { chart: SheetChart; data: ChartData }) {
  const scale = chartScale(data), step = 540 / data.labels.length, x = (i: number) => 60 + (i + .5) * step;
  return <>{!data.series.some(s => s.values.some(v => v !== null)) && <p>No finite numeric values in this source range.</p>}<svg viewBox="0 0 640 230" role="img" aria-label={`${chart.title || 'Untitled chart'} — ${chart.type} chart`}>
    <line x1="60" x2="600" y1={scale.y(0)} y2={scale.y(0)} stroke="#64748b" />
    <text x="4" y="18" fontSize="10">{scale.max.toPrecision(4)}</text><text x="4" y="195" fontSize="10">{scale.min.toPrecision(4)}</text>
    {data.series.map((series, s) => <g key={s} fill={colors[s]} stroke={colors[s]}>
      {series.values.map((v, i) => v === null ? null : <g key={i}><title>{`${data.labels[i]} · ${series.name}: ${v}`}</title>
        {chart.type === 'bar' ? <rect x={x(i)-step*.4+s*step*.8/data.series.length} y={Math.min(scale.y(v),scale.y(0))} width={step*.8/data.series.length} height={Math.abs(scale.y(v)-scale.y(0))} />
          : <>{i > 0 && series.values[i-1] !== null && <line x1={x(i-1)} y1={scale.y(series.values[i-1]!)} x2={x(i)} y2={scale.y(v)} strokeWidth="2" />}<circle cx={x(i)} cy={scale.y(v)} r="3" /></>}
        {v === 0 && chart.type === 'bar' && <circle cx={x(i)-step*.4+(s+.5)*step*.8/data.series.length} cy={scale.y(0)} r="2" />}
      </g>)}
    </g>)}
    {data.labels.map((label, i) => i % Math.max(1, Math.ceil(data.labels.length/8)) === 0 && <text key={i} x={x(i)} y="215" textAnchor="middle" fontSize="10">{label.length > 16 ? label.slice(0, 15)+'…' : label}</text>)}
  </svg><p>{data.series.map((s,i) => <span key={i} style={{ color: colors[i], marginRight: 16 }}>{s.name}</span>)}</p>
  <details><summary>Chart values and missing data</summary><div className="sheet-chart-values" tabIndex={0} role="region" aria-label="Chart values"><table><thead><tr><th>Label</th>{data.series.map((s,i)=><th key={i}>{s.name}</th>)}</tr></thead><tbody>{data.labels.map((l,i)=><tr key={i}><th>{l}</th>{data.series.map((s,j)=><td key={j}>{s.values[i] === null ? `Missing (${s.missing[i]})` : String(s.values[i])}</td>)}</tr>)}</tbody></table></div></details></>;
}
export function SheetCharts({ controller }: { controller: ChartController }) {
  const [owner, setOwner] = useState(() => ({ controller, key: 0 }));
  // Reset the entire owner before rendering children, never after a paint.
  if (owner.controller !== controller) {
    setOwner({ controller, key: owner.key + 1 });
    return null;
  }
  return <ChartPanel key={owner.key} controller={controller} />;
}
function ChartPanel({ controller }: { controller: ChartController }) {
  const [view, setView] = useState(controller.view), [form, setForm] = useState<(SheetChart & { address: string }) | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const update = () => { if (active) setView(controller.view()); };
    const unsubscribe = controller.subscribe(update);
    update(); // Include changes between the initial render and subscription.
    return () => { active = false; unsubscribe(); };
  }, [controller]);
  const start = (chart?: SheetChart) => {
    try {
      const source = chart ?? { id: crypto.randomUUID(), title: 'Chart', type: 'bar' as const, sheetId: controller.tabs()[0].id, range: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 1 } };
      controller.stage(); setForm({ ...source, address: chartRangeLabel(source.range) }); setError('');
    } catch (e) { setError((e as Error).message); }
  };
  const selected = () => { try { const s = controller.selected(); setForm(f => f && ({ ...f, ...s, address: chartRangeLabel(s.range) })); setError(''); } catch(e) { setError((e as Error).message); } };
  const apply = () => {
    try { if (form) { const { address, ...chart } = form; controller.put({ ...chart, range: parseChartRange(address) }); setForm(null); setError(''); } }
    catch (e) { setError((e as Error).message === 'invalid_sheet_charts' ? 'Use a source with 1 header row, 1 label column, 1–100 data rows and 1–4 numeric series, within the sheet and without merged cells; at most 8 charts.' : (e as Error).message); }
  };
  return <section className="sheet-charts" aria-label="Sheet charts" tabIndex={0}>
    <div className="sheet-chart-actions"><strong>Workagent charts · Bar / Line</strong><button type="button" disabled={!!form || view.charts.length >= CHART_LIMITS.charts} onClick={() => start()}>Add chart</button>
    {view.charts.length > 0 && <button type="button" onClick={() => { controller.invalidate(); }}>Refresh charts</button>}</div>
    <p>Cell paste and fill work within sheet bounds. While charts exist, structural edits, sorting, merges and cut are refused. XLSX export is refused; CSV loses charts.</p>
    <details><summary>Chart scope and restrictions</summary><p>{CHART_SCOPE}</p></details>
    {form && <fieldset><legend>{view.charts.some(c=>c.id===form.id) ? 'Edit chart' : 'Create chart'}</legend>
      <p>Apply to keep this chart edit in the recoverable sheet draft. Apply or Cancel before Save or switching work.</p>
      <label>Chart title<input aria-label="Chart title" maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} /></label>
      <label>Chart type<select aria-label="Chart type" value={form.type} onChange={e=>setForm({...form,type:e.target.value as SheetChart['type']})}><option value="bar">Bar</option><option value="line">Line</option></select></label>
      <label>Source sheet<select aria-label="Chart source sheet" value={form.sheetId} onChange={e=>setForm({...form,sheetId:e.target.value})}>{controller.tabs().map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Source range<input aria-label="Chart source range" value={form.address} maxLength={24} onChange={e=>setForm({...form,address:e.target.value})} /></label>
      <button type="button" onClick={selected}>Use selected range</button><button type="button" onClick={apply}>Apply chart</button><button type="button" onClick={()=>{controller.cancel();setForm(null);setError('');}}>Cancel chart edit</button>
    </fieldset>}
    {error && <p className="sheet-chart-error" role="alert">{error}</p>}
    {view.charts.length > 0 && <p role="status">{view.status}</p>}
    {view.charts.map(chart=><article key={chart.id}><h3>{chart.title || 'Untitled chart'}</h3><p>{controller.tabs().find(s=>s.id===chart.sheetId)?.name} · {chartRangeLabel(chart.range)}</p>
      <button type="button" disabled={!!form} onClick={()=>start(chart)}>Edit chart</button><button type="button" disabled={!!form} onClick={()=>{try{controller.remove(chart.id);}catch(e){setError((e as Error).message);}}}>Delete chart</button>
      {view.data[chart.id] && <ChartGraphic chart={chart} data={view.data[chart.id]} />}
    </article>)}
  </section>;
}
