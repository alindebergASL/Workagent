import type { IDocumentData } from '@univerjs/core';
export const DOCUMENT_LIMIT: number;
export const DOCUMENT_POLICY: string;
export function blankDocument(id: string, title?: string, text?: string): IDocumentData;
export function validateDocument(doc: unknown): IDocumentData;
export function documentText(doc: IDocumentData): string;
