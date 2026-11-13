import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { IDocClipboardService, UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import UniverDocsCoreEnUS from '@univerjs/preset-docs-core/locales/en-US';
import { ICommandService, type IDocumentData } from '@univerjs/core';
import '@univerjs/preset-docs-core/lib/index.css';
export type DocumentHandle = { save: () => IDocumentData; commit: () => Promise<IDocumentData>; isEditing: () => boolean; contentEpoch: () => number };
export function DocumentEditor({ document: data, version, onReady, onEdit, onError }: { document: IDocumentData; version: string; onReady: (e: DocumentHandle | null) => void; onEdit: (d: IDocumentData) => void; onError: (e: unknown) => void }) {
  const rename = useRef<((title: string) => void) | null>(null);
  const container = useRef<HTMLDivElement>(null), edit = useRef(onEdit), ready = useRef(onReady), error = useRef(onError);
  edit.current = onEdit; ready.current = onReady; error.current = onError;
  useEffect(() => {
    const notifyEdit = edit.current, notifyReady = ready.current;
    let dispose: (() => void) | undefined;
    try {
    const { univer, univerAPI } = createUniver({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(UniverDocsCoreEnUS) }, presets: [UniverDocsCorePreset({ container: container.current! })] });
    dispose = () => univer.dispose();
    let disposed = false, composing = false, pendingInput = 0, pendingClipboard = 0, epoch = 0;
    const inputCommand = (id: string, params?: object) => (!params || !('unitId' in params) || params.unitId === data.id) && id.startsWith('doc.command.');
    const doc = univerAPI.createDocument(structuredClone(data));
    // Completion events are skipped on SDK throws/refusals. Own each call's
    // lifetime instead, including nested calls, without releasing another input.
    const commands = univer.__getInjector().get(ICommandService);
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
      disposed = true; pendingClipboard = 0;
      // The SDK generation fence cancels a read that resumes after disposal.
      clipboard.dismissPasteOptions();
      restoreClipboard.forEach(restore => restore()); restoreCommands.forEach(restore => restore()); univer.dispose();
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
    notifyReady({ save: snapshot, contentEpoch: () => epoch, isEditing: () => !disposed && (composing || pendingInput > 0 || pendingClipboard > 0), commit: async () => {
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
  return <><label className="document-title">Document title<input key={version} aria-label="Document title" defaultValue={data.title} maxLength={200} onChange={e => { try { rename.current?.(e.target.value); } catch (err) { error.current(err); } }} /></label><p className="document-limits">Native paragraphs and inline formatting. Tables, media, links, headers, notes and advanced objects cannot be saved in this slice. After a human edit, model changes propose a whole document for review. Paragraph attachment to conversation is not yet available.</p><div className="native-editor" ref={container} aria-label="Editable document" /></>;
}
