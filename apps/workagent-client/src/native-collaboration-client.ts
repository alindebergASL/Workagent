import { UniverInstanceType } from '@univerjs/core';
import type { Injector } from '@univerjs/core';
import { CollaborationController, CollaborationStatus, DataLoaderService } from '@univerjs-pro/collaboration-client';
import type { IChangesetResendEvent, ICollaborationConflictEvent } from '@univerjs-pro/collaboration-client';

// Instance-scoped public services. Importing the SDK collaboration facade would
// globally require collaboration dependencies in ordinary Sheets and Documents.
export function nativeCollaborationClient(injector: Injector, unitID: string) {
  const controller = injector.get(CollaborationController);
  const loader = injector.get(DataLoaderService);
  return {
    async loadSheetAsync() {
      // Same sequence as SDK loadSheetAsync: native cache-aware load, then ready.
      // DataLoaderService alone owns snapshot/cache loading and unit creation.
      const unit = await loader.loadUnit(unitID, UniverInstanceType.UNIVER_SHEET);
      if (unit) await controller.readyForCollab(unitID);
      return unit;
    },
    getCollaborationStatus: () => controller.getCollabEntity(unitID)?.state.status ?? CollaborationStatus.NOT_COLLAB,
    hasWritePending: () => controller.hasWritePending(unitID),
    subscribe(handlers: { status(): void; resend(event: IChangesetResendEvent): void; conflict(event: ICollaborationConflictEvent): void }) {
      let streams: { unsubscribe(): void }[] = [];
      const entities = controller.getCollabEntity$(unitID).subscribe(entity => {
        streams.forEach(s => s.unsubscribe());
        streams = [entity.status$.subscribe(handlers.status), entity.changesetResend$.subscribe(handlers.resend), entity.conflict$.subscribe(handlers.conflict)];
      });
      return { dispose() { entities.unsubscribe(); streams.forEach(s => s.unsubscribe()); streams = []; } };
    },
  };
}
