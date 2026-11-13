import type { Responsibility, Notice } from './MaintenancePanel';
import type { IWorkbookData, IDocumentData } from '@univerjs/core';
import type { DocumentSelection } from '../../../packages/workagent-contract/document.mjs';
export type DocumentSource = DocumentSelection & { title: string; quote: string };
export type Expected = { contentRevision: number; intentRevision: number; permissionRevision: number; cancellationEpoch: number };
export type Cell = { sheetId: string; row: number; column: number; value: string | number | boolean | null; formula?: string };
export type SheetProposal = { id: string; status: string; reason: string; expected: Expected; kind?: 'sheet'; patch: { title?: string; cells: Cell[]; addSheets?: { id: string; name: string }[] } };
export type Proposal = SheetProposal | { id: string; kind: 'document'; status: string; reason: string; expected: Expected; patch: { document: IDocumentData; title?: never; cells?: never } };
export type Work = { id: string; humanCells?: string[]; original?: { id: string; filename: string; encoding: string; warnings?: string[]; size: number; hash: string }; expected: Expected; eventSequence: number; contentRevision: number; intentRevision: number; status: string; responsibilities?: Responsibility[]; inbox?: Notice[]; errorCode?: string; messages: { id: string; role: string; text: string; selection?: DocumentSource }[]; proposals: Proposal[] } & ({ kind?: 'sheet'; book: IWorkbookData; document?: never } | { kind: 'document'; document: IDocumentData; book?: never });
