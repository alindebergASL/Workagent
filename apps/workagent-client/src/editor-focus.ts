import { UniverInstanceType, type Univer } from '@univerjs/core';
import { DocSelectionRenderService, ILayoutService, IRenderManagerService } from '@univerjs/preset-docs-core';

/** Install before creating the first unit (before the SDK's onReady render modules).
 * Sheets' hidden cell/formula editors and Docs share this render service. The
 * preset's disableAutoFocus also disables sheet typing, and direct focus() calls
 * bypass canFocusing. Register an instance-local implementation at that seam.
 */
export function installEditorFocus(univer: Univer, container: HTMLElement): () => void {
  const document = container.ownerDocument;
  const injector = univer.__getInjector();
  const layout = injector.get(ILayoutService);
  let disposed = false, released: Element | null = null, tab: KeyboardEvent | null = null;
  let tabTimer: ReturnType<typeof setTimeout> | undefined;
  const inNative = (target: EventTarget | null) => !!target &&
    (container.contains(target as Node) || layout.checkElementInCurrentContainers(target as HTMLElement));
  const appInput = (target: Element | null) => !!target && !inNative(target) && !!target.closest('.app') &&
    target.matches('textarea, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="color"])');
  const clear = () => { released = null; tab = null; clearTimeout(tabTimer); tabTimer = undefined; };
  const pointer = (event: Event) => { clear(); if (inNative(event.target)) released = document.activeElement; };
  const keyboard = (event: KeyboardEvent) => {
    clear();
    if (event.key === 'Tab' && appInput(document.activeElement)) {
      released = document.activeElement; tab = event;
      // Only expire keyboard navigation intent; never schedule a refocus.
      tabTimer = setTimeout(clear, 0);
    }
  };
  const focused = () => { clear(); };
  class OwnedDocSelection extends DocSelectionRenderService {
    override focus() {
      if (disposed) return;
      const active = document.activeElement;
      if (appInput(active) && (active !== released || tab?.defaultPrevented)) return;
      // No blur/refocus or selection replay: app caret/IME state stays untouched.
      super.focus();
    }
  }
  const registration = injector.get(IRenderManagerService).registerRenderModule(
    UniverInstanceType.UNIVER_DOC, [DocSelectionRenderService, { useClass: OwnedDocSelection }]);
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('keydown', keyboard, true);
  document.addEventListener('focusin', focused, true);
  document.addEventListener('beforeinput', clear, true);
  document.addEventListener('compositionstart', clear, true);
  return () => {
    disposed = true; clear(); registration.dispose();
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', keyboard, true);
    document.removeEventListener('focusin', focused, true);
    document.removeEventListener('beforeinput', clear, true);
    document.removeEventListener('compositionstart', clear, true);
  };
}
