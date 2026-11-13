import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { IDocClipboardService, UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import UniverDocsCoreEnUS from '@univerjs/preset-docs-core/locales/en-US';
import type { IDocumentData } from '@univerjs/core';
import '@univerjs/preset-docs-core/lib/index.css';
export type DocumentHandle = { save: () => IDocumentData; commit: () => Promise<IDocumentData>; isEditing: () => boolean };
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
    let disposed = false, composing = false, pendingInput = 0, pendingClipboard = 0;
    const inputCommand = (command: { id: string; params?: { unitId?: string } }) => command.params?.unitId === data.id && ['doc.command.insert-text', 'doc.command.ime-input', 'doc.command.replace-selection'].includes(command.id);
    const doc = univerAPI.createDocument(structuredClone(data));
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
        pendingClipboard++;
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
      restoreClipboard.forEach(restore => restore()); univer.dispose();
    };
    const snapshot = () => structuredClone(doc.save());
    rename.current = title => { doc.setName(title); notifyEdit(snapshot()); };
    const changed = () => { if (!disposed) notifyEdit(snapshot()); };
    // Docs applies ordinary typing directly as native mutations. Composition is
    // retained by native mutations too; never acknowledge an unfinished IME edit.
    const start = () => { composing = true; }, end = () => { composing = false; queueMicrotask(changed); };
    const element = container.current!;
    element.addEventListener('compositionstart', start, true); element.addEventListener('compositionend', end, true);
    const before = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, command => { if (inputCommand(command)) pendingInput++; });
    const listener = univerAPI.addEvent(univerAPI.Event.CommandExecuted, command => { if (inputCommand(command)) pendingInput = Math.max(0, pendingInput - 1); if (command.id.startsWith('doc.mutation.')) changed(); });
    notifyReady({ save: snapshot, isEditing: () => !disposed && (composing || pendingInput > 0 || pendingClipboard > 0), commit: async () => {
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
    return () => { disposed = true; rename.current = null; before.dispose(); listener.dispose(); element.removeEventListener('compositionstart', start, true); element.removeEventListener('compositionend', end, true); notifyReady(null); dispose?.(); };
    } catch (e) { dispose?.(); rename.current = null; notifyReady(null); error.current(e); }
  }, [version]);
  return <><label className="document-title">Document title<input key={version} aria-label="Document title" defaultValue={data.title} maxLength={200} onChange={e => { try { rename.current?.(e.target.value); } catch (err) { error.current(err); } }} /></label><p className="document-limits">Native paragraphs and inline formatting. Tables, media, links, headers, notes and advanced objects cannot be saved in this slice. After a human edit, model changes propose a whole document for review. Paragraph attachment to conversation is not yet available.</p><div className="native-editor" ref={container} aria-label="Editable document" /></>;
}
