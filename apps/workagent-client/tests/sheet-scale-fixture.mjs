import assert from 'node:assert/strict';

// Two fixed sizes only: the named acceptance and one optional diagnostic control.
export function workload(populated = 100_000) {
  assert.ok([100_000, 1_000].includes(populated));
  const factor = populated / 1000, inputRows = 80 * factor, operationRows = 40 * factor, summaryRows = 10 * factor;
  const sheet = (id, name, rows, columns) => ({ id, name, rowCount: rows, columnCount: columns + 1, cellData: {} });
  const book = { id: 'scale-qualification', name: 'Synthetic operations qualification', appVersion: '1.4.0', locale: 'enUS', styles: {}, sheetOrder: ['inputs', 'operations', 'summary'], sheets: {
    inputs: sheet('inputs', 'Inputs', inputRows, 10), operations: sheet('operations', 'Operations', operationRows, 4), summary: sheet('summary', 'Summary', summaryRows, 4),
  } };
  for (let r = 0; r < inputRows; r++) book.sheets.inputs.cellData[r] = {
    0: { v: r % 97 + 1, t: 2 }, 1: { v: r % 23 + 2, t: 2 }, 2: { v: r % 3 !== 0, t: 3 },
    3: { v: String(r + 1).padStart(5, '0'), t: 1 }, 4: { v: `team${r % 8}`, t: 1 },
    5: { v: r % 11, t: 2 }, 6: { v: '雪', t: 1 }, 7: { v: -(r % 13), t: 2 },
    8: { v: r % 2 === 0, t: 3 }, 9: { v: r % 7, t: 2 },
  };
  for (let r = 0; r < operationRows; r++) {
    const a = 2 * r + 1, b = a + 1;
    book.sheets.operations.cellData[r] = {
      0: { f: `=SUM(Inputs!A${a}:A${b})` },
      1: { f: `=IF(Inputs!C${a},A${r + 1}*Inputs!B${a},0)` },
      2: { f: `=Inputs!H${a}+Inputs!J${b}` }, 3: { v: `batch${r}`, t: 1 },
    };
  }
  for (let r = 0; r < summaryRows; r++) book.sheets.summary.cellData[r] = {
    0: { f: `=SUM(Operations!B${4 * r + 1}:B${4 * r + 4})` },
    1: { f: `=IF(A${r + 1}>200,"review","ok")` },
    2: { v: String(r + 1).padStart(5, '0'), t: 1 }, 3: { v: r % 2 === 0, t: 3 },
  };
  // Explicit empty cells and one absent column: neither counts as populated.
  book.sheets.inputs.cellData[0][10] = { v: '' };
  book.sheets.operations.cellData[0][4] = { v: null };
  assert.equal(countCells(book).populated, populated);
  assert.equal(countCells(book).formulas, 140 * factor);
  return book;
}

export function countCells(book) {
  const total = { populated: 0, stored: 0, formulas: 0, cachedFormulas: 0, formulaErrors: 0, numeric: 0, strings: 0, booleans: 0, leadingZero: 0, blanks: 0, tabs: book.sheetOrder.length };
  for (const sid of book.sheetOrder) for (const row of Object.values(book.sheets[sid].cellData ?? {})) for (const c of Object.values(row)) {
    total.stored++;
    if (c?.f || c?.si) { total.formulas++; total.populated++; if (c.v !== undefined && c.v !== null) total.cachedFormulas++; if (typeof c.v === 'string' && c.v.startsWith('#')) total.formulaErrors++; }
    else if (c?.v === undefined || c.v === null || c.v === '') total.blanks++;
    else {
      total.populated++;
      if (c.t === 3 || typeof c.v === 'boolean') total.booleans++;
      else if (typeof c.v === 'number') total.numeric++;
      else { total.strings++; if (/^0\d+$/.test(c.v)) total.leadingZero++; }
    }
  }
  return total;
}

// Independent arithmetic oracle; never reads a formula or seeds a cached result.
export function expectedValues(populated, edited = false) {
  const factor = populated / 1000;
  const quantity = r => r === 2 && edited ? 103 : r % 97 + 1;
  const pair = r => quantity(2 * r) + quantity(2 * r + 1);
  const cost = r => (2 * r) % 3 !== 0 ? pair(r) * ((2 * r) % 23 + 2) : 0;
  const values = [
    { sheet: 'inputs', row: 2, column: 0, expected: quantity(2) },
    { sheet: 'inputs', row: 0, column: 3, expected: '00001' },
    { sheet: 'inputs', row: 0, column: 6, expected: '雪' },
    { sheet: 'inputs', row: 0, column: 2, expected: false },
    { sheet: 'inputs', row: 1, column: 2, expected: true },
  ];
  for (const r of [0, 1, 17, 40 * factor - 1]) {
    values.push({ sheet: 'operations', row: r, column: 0, expected: pair(r) },
      { sheet: 'operations', row: r, column: 1, expected: cost(r) },
      { sheet: 'operations', row: r, column: 2, expected: -((2 * r) % 13) + (2 * r + 1) % 7 });
  }
  for (const r of [0, 3, 10 * factor - 1]) {
    let sum = 0; for (let k = 4 * r; k < 4 * r + 4; k++) sum += cost(k);
    values.push({ sheet: 'summary', row: r, column: 0, expected: sum }, { sheet: 'summary', row: r, column: 1, expected: sum > 200 ? 'review' : 'ok' });
  }
  return values;
}

export function observedValues(book, populated, edited) {
  return expectedValues(populated, edited).map(item => ({ ...item, actual: book.sheets[item.sheet].cellData[item.row][item.column].v }));
}
