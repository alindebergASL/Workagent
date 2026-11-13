import type { Responsibility, Notice } from './MaintenancePanel';
import type { IWorkbookData } from '@univerjs/core';
export type Expected = { contentRevision: number; intentRevision: number; permissionRevision: number; cancellationEpoch: number };
export type Cell = { sheetId: string; row: number; column: number; value: string | number | boolean | null; formula?: string };
export type Proposal = { id: string; status: string; reason: string; expected: Expected; patch: { title?: string; cells: Cell[]; addSheets?: { id: string; name: string }[] } };
export type Work = { id: string; original?: { id: string; filename: string; encoding: string; size: number; hash: string }; book: IWorkbookData; expected: Expected; eventSequence: number; contentRevision: number; intentRevision: number; status: string; responsibilities?: Responsibility[]; inbox?: Notice[]; errorCode?: string; messages: { id: string; role: string; text: string }[]; proposals: Proposal[] };
