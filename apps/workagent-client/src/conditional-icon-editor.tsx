import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ICommandService, IUniverInstanceService, LocaleService, type Injector, type IWorkbookData, type Workbook } from '@univerjs/core';
import { Button, Checkbox, RangeSelector, RemoveSheetMutation, SetWorksheetActiveOperation, deserializeRangeWithSheet, serializeRange } from '@univerjs/preset-sheets-core';
import { iconMap, AddCfCommand, SetCfCommand, ConditionalFormattingRuleModel, type IConditionFormattingRule } from '@univerjs/preset-sheets-conditional-formatting';
import { CONDITIONAL_ICON_FAMILIES, conditionalRules, validateConditionalRules, type ConditionalIconSet } from '../../../packages/workagent-contract/conditional-formatting.mjs';

type RuleProps = { rule?: IConditionFormattingRule; onCancel: () => void };
export type ConditionalPanelProps = { rule?: IConditionFormattingRule; onEditorExit?: () => void; RuleEditComponent?: ComponentType<RuleProps>; RuleListComponent?: ComponentType<{ onCreate: () => void }> };
// The public panel's RuleEditComponent slot is instance scoped. The SDK does
// not expose its inner IconSet or its interceptor manager. Adapt only existing
// icon rules and menu drafts; delegate every other kind and new-rule selection to the native
// panel, including its exit lifecycle. No command or module-wide interception.
export function conditionalRuleEditor(NativePanel: ComponentType<ConditionalPanelProps>, injector: Injector, unitId: string, save: () => IWorkbookData) {
  function StartNativeRule({ onCreate }: { onCreate: () => void }) {
    useEffect(onCreate, []);
    return null;
  }
  function NativeIconRuleEditor({ rule, onCancel }: RuleProps & { rule: IConditionFormattingRule }) {
    const [subUnitId] = useState(() => injector.get(IUniverInstanceService).getUnit<Workbook>(unitId)!.getActiveSheet()!.getSheetId());
    // An allocated ID does not imply a saved rule. Keep the opening mode for
    // this editor's lifetime so deletion cannot turn an edit into creation.
    const [existing] = useState(() => (conditionalRules(save())[subUnitId] ?? []).some(r => r.cfId === rule.cfId));
    const [draft, setDraft] = useState(() => ({ ...structuredClone(rule),
      cfId: rule.cfId ?? injector.get(ConditionalFormattingRuleModel).createCfId(unitId, subUnitId),
      stopIfTrue: rule.stopIfTrue ?? false,
    }));
    const rangeTouched = useRef(false);
    const [error, setError] = useState('');
    const [stopTouched, setStopTouched] = useState(false);
    const commands = injector.get(ICommandService), locale = injector.get(LocaleService);
    const config = draft.rule as ConditionalIconSet;
    const update = (next: ConditionalIconSet) => setDraft({ ...draft, rule: next as IConditionFormattingRule['rule'] });
    useEffect(() => {
      const listener = commands.onCommandExecuted(c => {
        const p = c.params as { unitId?: string; subUnitId?: string } | undefined;
        if (c.id === SetWorksheetActiveOperation.id || c.id === RemoveSheetMutation.id && p?.unitId === unitId && p.subUnitId === subUnitId) onCancel();
      });
      return () => listener.dispose();
    }, []);
    const submit = async () => {
      const book = save(), data = conditionalRules(book), rules = data[subUnitId] ?? [];
      const current = rules.find(r => r.cfId === draft.cfId);
      if (existing && !current) { setError('This rule was removed. Cancel and reopen conditional formatting.'); return; }
      if (!existing && current) { setError('This rule ID already exists. Cancel and reopen conditional formatting.'); return; }
      const next = { ...draft, stopIfTrue: existing && !stopTouched ? current!.stopIfTrue : draft.stopIfTrue };
      try {
        // This is the before-submit check, using the same domain contract as
        // persistence and the pre-mutation guard. No ordering predicate: ties
        // and crossings retain authored icon/comparator/threshold associations.
        validateConditionalRules(book, { ...data, [subUnitId]: existing ? rules.map(r => r.cfId === next.cfId ? next : r) : [...rules, next] });
      } catch { setError('Use valid sheet ranges, built-in icons, > or >=, and finite numeric or 0–100 percent/percentile thresholds.'); return; }
      try {
        if (await commands.executeCommand(existing ? SetCfCommand.id : AddCfCommand.id, { unitId, subUnitId, rule: next })) onCancel();
        else setError('The rule was not applied. Check its settings and try again.');
      } catch { setError('The rule was not applied. Check its settings and try again.'); }
    };
    const point = (index: number, change: Partial<ConditionalIconSet['config'][number]>) => update({ ...config, config: config.config.map((p,i) => i === index ? { ...p, ...change } : p) });
    const iconOptions = Object.entries(iconMap).flatMap(([family, list]) => list.map((src, id) => ({ family, id: String(id), src })));
    return <div data-u-comp="workagent-icon-rule-editor" className="univer-flex univer-flex-col univer-gap-3">
      <RangeSelector unitId={unitId} subUnitId={subUnitId} initialValue={rule.ranges.map(r => serializeRange(r)).join(',')}
        onChange={(_, text) => {
          if (!rangeTouched.current && !text && draft.ranges.length) return;
          rangeTouched.current = true;
          setDraft({ ...draft, ranges: text.split(',').filter(Boolean).map(r => deserializeRangeWithSheet(r).range) });
        }} />
      <label>Icon family <select aria-label="Icon family" value="" onChange={e => {
        const family = e.target.value, count = CONDITIONAL_ICON_FAMILIES[family];
        if (!count) return;
        update({ ...config, config: Array.from({ length: count }, (_, i) => ({ iconType: family, iconId: String(i), operator: i === count - 1 ? 'lessThanOrEqual' : 'greaterThanOrEqual', value: i === count - 1 ? { type: 'num', value: 0 } : { type: 'percent', value: Math.round((count - 1 - i) * 100 / count) } })) });
      }}><option value="" disabled>Choose a family</option>{Object.keys(CONDITIONAL_ICON_FAMILIES).map(f => <option key={f} value={f}>{f}</option>)}</select></label>
      <Button onClick={() => update({ ...config, config: config.config.map((p,i,a) => ({ ...p, iconType: a[a.length-1-i].iconType, iconId: a[a.length-1-i].iconId })) })}>Reverse icons</Button>
      {config.config.map((p,i) => <div key={i} className="univer-flex univer-flex-wrap univer-items-center univer-gap-2">
        {p.iconType !== 'EMPTY_ICON_TYPE' && <img width={20} height={20} alt="" src={iconOptions.find(o => o.family === p.iconType && o.id === p.iconId)?.src} />}
        <select aria-label={`Icon ${i+1}`} value={`${p.iconType}:${p.iconId}`} onChange={e => { const [iconType,iconId] = e.target.value.split(':'); point(i,{iconType,iconId}); }}>
          <option value="EMPTY_ICON_TYPE:">No icon</option>{iconOptions.map(o => <option key={`${o.family}:${o.id}`} value={`${o.family}:${o.id}`}>{o.family} {+o.id+1}</option>)}
        </select>
        {i === config.config.length - 1 ? <span>Otherwise</span> : <>
          <select aria-label={`Operator ${i+1}`} value={p.operator} onChange={e => point(i,{operator:e.target.value as typeof p.operator})}><option value="greaterThan">&gt;</option><option value="greaterThanOrEqual">&gt;=</option></select>
          <input aria-label={`Threshold ${i+1}`} type="number" value={Number.isNaN(p.value.value) ? '' : p.value.value} onChange={e => point(i,{value:{...p.value,value:e.target.value === '' ? NaN : Number(e.target.value)}})} />
          <select aria-label={`Threshold type ${i+1}`} value={p.value.type} onChange={e => point(i,{value:{...p.value,type:e.target.value as typeof p.value.type}})}>{['num','percent','percentile'].map(t => <option key={t} value={t}>{t}</option>)}</select>
        </>}
      </div>)}
      <p>Thresholds keep their icons when they cross. At equal thresholds, the first matching row wins.</p>
      <Checkbox checked={config.isShowValue ?? true} onChange={checked => update({ ...config, isShowValue: !!checked })}>Show values</Checkbox>
      <Checkbox checked={draft.stopIfTrue} onChange={checked => { setStopTouched(true); setDraft({ ...draft, stopIfTrue: !!checked }); }}>Stop if true</Checkbox>
      {error && <div role="alert">{error}</div>}
      <div className="univer-flex univer-justify-end univer-gap-2"><Button onClick={onCancel}>{locale.t('sheets-conditional-formatting-ui.panel.cancel')}</Button><Button variant="primary" onClick={submit}>{locale.t('sheets-conditional-formatting-ui.panel.submit')}</Button></div>
    </div>;
  }
  return function ConditionalRuleEditor(props: RuleProps) {
    return props.rule?.rule.type === 'iconSet' ? <NativeIconRuleEditor key={props.rule.cfId} {...props} rule={props.rule} />
      : <NativePanel rule={props.rule} onEditorExit={props.onCancel} RuleListComponent={props.rule ? undefined : StartNativeRule} />;
  };
}
