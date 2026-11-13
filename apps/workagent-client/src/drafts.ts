import type { IWorkbookData, IDocumentData } from '@univerjs/core';

export function isHumanSheetMutation(command: { id: string; options?: Record<string, unknown> }, editing: boolean): boolean {
  // Univer applies computed values through the same mutation as human edits.
  return (command.id.startsWith('sheet.mutation.') || command.id.startsWith('data-validation.mutation.')) && !command.id.includes('formula') && !command.id.includes('calculation')
    && !command.options?.fromFormula && !command.options?.applyFormulaCalculationResult && !editing;
}

// A response may replace a local editor only if no edit or navigation intervened.
export class DraftFence {
  generation = 0;
  navigation = 0;
  edit() { this.generation++; }
  request() { return { generation: this.generation, navigation: ++this.navigation }; }
  current(ticket: { generation: number; navigation: number }) {
    return ticket.generation === this.generation && ticket.navigation === this.navigation;
  }
}

// Recovery for text still inside Univer's cell editor when a page is refreshed.
// Normal saves always use endEditingAsync and the native workbook snapshot.
export function pendingCell(book: IWorkbookData, sheetId: string, row: number, column: number, text: string, document: IDocumentData): IWorkbookData {
  const copy = structuredClone(book), sheet = copy.sheets[sheetId];
  if (!sheet) return copy;
  sheet.cellData ??= {}; sheet.cellData[row] ??= {};
  const old = sheet.cellData[row][column] ?? {};
  sheet.cellData[row][column] = text.startsWith('=')
    ? { ...old, f: text, v: null, p: null, t: undefined, si: null }
    : { ...old, f: null, si: null, v: null, t: undefined, p: structuredClone(document) };
  return copy;
}
