import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { DocSelectionManagerService, IDocClipboardService, UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import UniverDocsCoreEnUS from '@univerjs/preset-docs-core/locales/en-US';
import { ICommandService, JSONX, TextXActionType, UpdateDocsAttributeType, type IDocumentData } from '@univerjs/core';
import '@univerjs/preset-docs-core/lib/index.css';
import { validateDocument, documentSelectionText, type DocumentSelection } from '../../../packages/workagent-contract/document.mjs';
import { installEditorFocus } from './editor-focus';
export type DocumentCapture = Omit<DocumentSelection, 'contentRevision'> & { quote: string; title: string; editorId: string; selectionEpoch: number; contentEpoch: number };
export type DocumentHandle = { editorId: string; save: () => IDocumentData; commit: () => Promise<IDocumentData>; isEditing: () => boolean; contentEpoch: () => number; selection: () => DocumentCapture; selectionEpoch: () => number };
export function DocumentEditor({ document: data, version, onReady, onEdit, onError, onSelectionChange }: { document: IDocumentData; version: string; onReady: (e: DocumentHandle | null) => void; onEdit: (d: IDocumentData) => void; onError: (e: unknown) => void; onSelectionChange?: () => void }) {
  const rename = useRef<((title: string) => void) | null>(null);
  const container = useRef<HTMLDivElement>(null), edit = useRef(onEdit), ready = useRef(onReady), error = useRef(onError);
  edit.current = onEdit; ready.current = onReady; error.current = onError;
  const selectionChanged = useRef(onSelectionChange); selectionChanged.current = onSelectionChange;
  useEffect(() => {
    const notifyEdit = edit.current, notifyReady = ready.current;
    let dispose: (() => void) | undefined;
    try {
    const { univer, univerAPI } = createUniver({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(UniverDocsCoreEnUS) }, presets: [UniverDocsCorePreset({ container: container.current! })] });
    dispose = () => univer.dispose();
    const releaseFocus = installEditorFocus(univer, container.current!);
    dispose = () => { releaseFocus(); univer.dispose(); };
    let disposed = false, composing = false, pendingInput = 0, pendingClipboard = 0, epoch = 0;
    const inputCommand = (id: string, params?: object) => (!params || !('unitId' in params) || params.unitId === data.id) && id.startsWith('doc.command.');
    if (data.lists || data.body?.paragraphs?.some(p => p.bullet)) validateDocument(data);
    const doc = univerAPI.createDocument(structuredClone(data));
    const editorId = crypto.randomUUID();
    const selections = univer.__getInjector().get(DocSelectionManagerService);
    const identity = { unitId: data.id, subUnitId: data.id };
    let selectionEpoch = 0, selectionKey = '';
    // Read this instance's logical native selection, which survives composer
    // focus. Observe every change (including away/back), not just the final range.
    const selectedInfo = () => selections.getSelectionInfo(identity);
    const observeSelection = () => {
      const info = selectedInfo();
      const key = JSON.stringify([info?.segmentId, info?.textRanges.map(r => [r.startOffset, r.endOffset, r.collapsed, r.segmentId, r.rangeType]), info?.rectRanges]);
      if (key !== selectionKey) { selectionKey = key; selectionEpoch++; selectionChanged.current?.(); }
    };
    const selected = selections.textSelection$.subscribe(e => { if (e.unitId === data.id && e.subUnitId === data.id) observeSelection(); });
    observeSelection();
    const selection = (): DocumentCapture => {
      if (disposed) throw new Error('The document editor changed. Attach selected text again.');
      if (composing || pendingInput || pendingClipboard) throw new Error('Native document input is still finishing. Attach selected text after it finishes.');
      observeSelection();
      const info = selectedInfo(), ranges = info?.textRanges ?? [];
      if (!info || info.segmentId !== '' || info.rectRanges.length || ranges.length !== 1 || (ranges[0].segmentId ?? '') !== '' || (ranges[0].rangeType !== undefined && ranges[0].rangeType !== 'TEXT')) throw new Error('Select one contiguous body-text range. Multiple ranges, headers, footers and objects cannot be attached.');
      const range = ranges[0];
      if (range.collapsed || range.startOffset === range.endOffset) throw new Error('Select nonempty body text before attaching; a caret is not a selection.');
      const saved = doc.save();
      try {
        const offsets = { segmentId: '' as const, startOffset: range.startOffset, endOffset: range.endOffset };
        return { kind: 'document', workId: data.id, documentId: data.id, ...offsets, quote: documentSelectionText(saved, offsets), title: saved.title ?? '', editorId, selectionEpoch, contentEpoch: epoch };
      } catch { throw new Error('Select at most 10,000 UTF-16 units of supported body text, with complete Unicode characters.'); }
    };
    // Completion events are skipped on SDK throws/refusals. Own each call's
    // lifetime instead, including nested calls, without releasing another input.
    const commands = univer.__getInjector().get(ICommandService);
    // Public pre-execution hook + the SDK's own JSONX projection. Refuse an
    // unsupported candidate before the real mutation, including paste/indent.
    const validation = commands.beforeCommandExecuted(command => {
      if (command.id !== 'doc.mutation.rich-text-editing') return;
      const params = command.params as { unitId: string; actions: Parameters<typeof JSONX.apply>[1]; trigger?: string; segmentId?: string; textRanges?: { startOffset: number }[] };
      if (params?.unitId !== data.id) return;
      try {
        const before = structuredClone(doc.save());
        let candidate = JSONX.apply(structuredClone(before), params.actions) as unknown as IDocumentData;
        // Enter copies the split paragraph's restart to both fragments. Keep it
        // on the first resulting item (including a new empty item at its start),
        // and clear only the surviving second fragment, never another item's
        // independent restart after a cross-paragraph replacement.
        if (params.trigger === 'doc.command.break-line' && !params.segmentId && params.textRanges?.length === 1 && before.body && candidate.body) {
          const at = params.textRanges[0].startOffset - 1;
          const end = at + before.body.dataStream.length + 1 - candidate.body.dataStream.length;
          const original = before.body.paragraphs?.find(p => p.startIndex >= at);
          const first = candidate.body.paragraphs?.find(p => p.startIndex === at);
          const second = candidate.body.paragraphs?.find(p => p.startIndex > at);
          if (at >= 0 && end >= at && original?.bullet && first?.bullet && second?.bullet && first.bullet.startNumber === original.bullet.startNumber && first.bullet.listId === original.bullet.listId && second.bullet.listId === original.bullet.listId) {
            const tail = before.body.paragraphs?.find(p => p.startIndex >= end);
            const restart = end > original.startIndex && tail?.bullet?.listId === original.bullet.listId ? tail.bullet.startNumber : undefined;
            if (second.bullet.startNumber !== restart) {
              const paragraph = structuredClone(second);
              if (restart !== undefined) paragraph.bullet!.startNumber = restart;
              else delete paragraph.bullet!.startNumber;
              // Selection replacement can also carry an explicit right-fragment
              // paragraph in its TextX retain. Clear that copied value before
              // composition: TextX composes paragraph objects by deep merge.
              params.actions = structuredClone(params.actions);
              const bodyEdit = params.actions?.[1] as { et?: string; e?: { t: string; len: number; body?: IDocumentData['body'] }[] };
              if (params.actions?.[0] === 'body' && bodyEdit?.et === 'text-x') {
                let offset = 0;
                for (const action of bodyEdit.e ?? []) {
                  if (action.t === TextXActionType.DELETE) continue;
                  for (const p of action.body?.paragraphs ?? []) {
                    if (offset + p.startIndex === second.startIndex) p.bullet = structuredClone(paragraph.bullet);
                  }
                  offset += action.len;
                }
              }
              paragraph.startIndex = 0;
              const correction = JSONX.getInstance().editOp([
                { t: TextXActionType.RETAIN, len: second.startIndex },
                { t: TextXActionType.RETAIN, len: 1, body: { dataStream: '', paragraphs: [paragraph] }, coverType: UpdateDocsAttributeType.REPLACE },
              ], ['body']);
              params.actions = JSONX.compose(params.actions, correction);
              candidate = JSONX.apply(structuredClone(before), params.actions) as unknown as IDocumentData;
            }
          }
        }
        validateDocument(candidate);
      }
      catch (cause) {
        error.current(cause);
        throw cause;
      }
    });
    const restoreCommands: (() => void)[] = [];
    for (const key of ['executeCommand', 'syncExecuteCommand'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(commands, key);
      const original = commands[key];
      const tracked = (id: string, params?: object, options?: Parameters<typeof original>[2]) => {
        const pending = !disposed && inputCommand(id, params);
        if (pending) { pendingInput++; epoch++; }
        const settle = () => { if (pending) pendingInput--; };
        try {
          const result = original.call(commands, id, params, options);
          if (key === 'executeCommand') return Promise.resolve(result).finally(settle);
          settle(); return result;
        } catch (e) { settle(); throw e; }
      };
      Object.defineProperty(commands, key, { configurable: true, writable: true, value: tracked });
      restoreCommands.push(() => {
        if (commands[key] !== tracked) return;
        if (descriptor) Object.defineProperty(commands, key, descriptor);
        else delete (commands as unknown as Record<string, unknown>)[key];
      });
    }
    // Keyboard, context-menu and clipboard events all use this owned service.
    // Commands start too late: clipboard reads/preparation happen before them.
    // Decorate this instance only; never modify the SDK or its shared prototype.
    const clipboard = univer.__getInjector().get(IDocClipboardService);
    const restoreClipboard: (() => void)[] = [];
    for (const key of ['pasteFromClipboard', 'paste', 'legacyPaste', 'changePasteMode', 'cut'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(clipboard, key);
      const original = clipboard[key] as (...args: unknown[]) => Promise<boolean>;
      const tracked = async (...args: unknown[]) => {
        if (disposed) return false;
        pendingClipboard++; epoch++;
        try { return await original.apply(clipboard, args); }
        finally { if (!disposed) pendingClipboard--; }
      };
      clipboard[key] = tracked;
      restoreClipboard.push(() => {
        if (clipboard[key] !== tracked) return;
        if (descriptor) Object.defineProperty(clipboard, key, descriptor);
        else delete (clipboard as unknown as Record<string, unknown>)[key];
      });
    }
    dispose = () => {
      releaseFocus();
      disposed = true; pendingClipboard = 0;
      // The SDK generation fence cancels a read that resumes after disposal.
      clipboard.dismissPasteOptions();
      validation.dispose(); selected.unsubscribe(); restoreClipboard.forEach(restore => restore()); restoreCommands.forEach(restore => restore()); univer.dispose();
    };
    const snapshot = () => structuredClone(doc.save());
    rename.current = title => { epoch++; doc.setName(title); notifyEdit(snapshot()); };
    const changed = () => { if (!disposed) { epoch++; notifyEdit(snapshot()); } };
    // Docs applies ordinary typing directly as native mutations. Composition is
    // retained by native mutations too; never acknowledge an unfinished IME edit.
    const start = () => { composing = true; epoch++; }, end = () => { composing = false; queueMicrotask(changed); };
    const element = container.current!;
    element.addEventListener('compositionstart', start, true); element.addEventListener('compositionend', end, true);
    const listener = univerAPI.addEvent(univerAPI.Event.CommandExecuted, command => { if (command.id.startsWith('doc.mutation.')) changed(); });
    notifyReady({ editorId, save: snapshot, selection, selectionEpoch: () => { observeSelection(); return selectionEpoch; }, contentEpoch: () => epoch, isEditing: () => !disposed && (composing || pendingInput > 0 || pendingClipboard > 0), commit: async () => {
      if (disposed) throw new Error('The document editor changed. Retry from the current document.');
      if (pendingInput) throw new Error('Native document input is still finishing. Retry saving, sending or exporting after it finishes.');
      if (pendingClipboard) throw new Error('Native document clipboard input is still finishing. Retry saving, sending or exporting after it finishes.');
      if (composing) throw new Error('Finish composing the current character before saving, sending or exporting.');
      // Let the current native input event finish its synchronous mutation and
      // queued callbacks, then verify this is still the same live editor.
      await Promise.resolve();
      if (disposed || composing || pendingInput || pendingClipboard) throw new Error('The document editor changed. Retry.');
      return snapshot();
    } });
    return () => { disposed = true; rename.current = null; listener.dispose(); element.removeEventListener('compositionstart', start, true); element.removeEventListener('compositionend', end, true); notifyReady(null); dispose?.(); };
    } catch (e) { dispose?.(); rename.current = null; notifyReady(null); error.current(e); }
  }, [version]);
  return <><label className="document-title">Document title<input key={version} aria-label="Document title" defaultValue={data.title} maxLength={200} onChange={e => { try { rename.current?.(e.target.value); } catch (err) { error.current(err); } }} /></label><p className="document-limits">Native paragraphs, inline formatting and lists up to nine levels: standard bullets, decimal, letter and Roman numbering. Use the native list and indent/outdent commands. Custom outline patterns and task lists are refused. Word retains supported hierarchy; PDF supports flat bullets and decimal lists only. Tables, media, links, headers, notes and advanced objects cannot be saved in this slice. Attach one body-text selection to conversation (at most 10,000 UTF-16 units). Selection is context; model edits still use whole-document proposals after human edits.</p><div className="native-editor" ref={container} aria-label="Editable document" /></>;
}
