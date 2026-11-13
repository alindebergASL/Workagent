import type { IWorkbookData } from '@univerjs/core';
export function withoutFormulaResults(book: IWorkbookData): IWorkbookData;

export type FormatEdits = Record<string, number[]>;
export function validateFormatEdits(value: unknown, book: IWorkbookData): FormatEdits | undefined;
