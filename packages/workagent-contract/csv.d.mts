import type { IWorkbookData } from '@univerjs/core';
export const CSV_LIMITS: { bytes: number; rows: number; columns: number; cells: number; field: number };
export const CSV_POLICY: string;
export const CSV_LOSSES: string;
export type CsvResult = { csv: string; sheetName: string; neutralized: number; unknown: number; rows: number; columns: number };
export function serializeCsv(book: IWorkbookData, sheetId: string): CsvResult;
export function parseCsv(bytes: Uint8Array): { rows: string[][]; rowCount: number; columns: number; raggedRows: number; encoding: string };
