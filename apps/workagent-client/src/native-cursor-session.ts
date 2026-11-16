import { Injector, type DependencyOverride } from '@univerjs/core';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { CollaborationSessionService, SessionStatus, type CollaborationSession } from '@univerjs-pro/collaboration-client';

// Bind delegation to the native receiver, including SDK getters and lifecycle
// methods. The native objects/prototypes themselves are never modified.
function delegate<T extends object>(native: T, overrides: Partial<T>): T {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(native, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function' || key === 'constructor') return value;
    if (!methods.has(key)) methods.set(key, value.bind(target));
    return methods.get(key);
  } });
}

export function cursorSessionService(native: CollaborationSessionService): CollaborationSessionService {
  let disposed = false;
  const sessions = new WeakMap<CollaborationSession, CollaborationSession>();
  return delegate(native, {
    requireSession(unitID, unitType) {
      return native.requireSession(unitID, unitType).then(session => {
        const existing = sessions.get(session);
        if (existing) return existing;
        let closed = false;
        // Native close/dispose completes this public stream. A closed session
        // may retain its last ONLINE value, so status alone is insufficient.
        session.sessionStatus$.subscribe({ complete: () => { closed = true; } });
        const facade = delegate(session, {
          send(event, unit, options) {
            // Univer 1.4's cursor debounce can outlive the online session.
            // Cursors are ephemeral: do not queue/replay an expired position.
            if (event.eventID === CollaborationEvent.UPDATE_CURSOR &&
                (disposed || closed || session.sessionStatus !== SessionStatus.ONLINE)) return Promise.resolve();
            // Keep the exact native Promise, arguments and rejection behavior
            // for online cursors and every content/recovery operation.
            return session.send(event, unit, options);
          },
        });
        sessions.set(session, facade);
        return facade;
      });
    },
    dispose() { disposed = true; native.dispose(); },
  });
}

export const nativeCursorSessionOverride: DependencyOverride = [[CollaborationSessionService, {
  deps: [Injector],
  useFactory: (injector: Injector) => cursorSessionService(injector.createInstance(CollaborationSessionService)),
}]];
