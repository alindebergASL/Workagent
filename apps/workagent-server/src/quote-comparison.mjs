import { Fault } from '../../../packages/workagent-contract/index.mjs';

// Calculate the initial totals in cents so decimal quotes have the same value as
// the native sheet's rounded totals. The bounds keep the arithmetic exact.
function cents(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Fault('invalid_quote_price', 400);
  const scaled = Math.round(value * 100);
  if (scaled / 100 !== value) throw new Fault('invalid_quote_price', 400);
  return scaled;
}

export function quoteComparisonCells({ quantity, offers }) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) throw new Fault('invalid_quote_quantity', 400);
  if (!Array.isArray(offers) || offers.length < 2 || offers.length > 50) throw new Fault('invalid_quote_offers', 400);
  const cells = {
    0: { 0: { t: 1, v: 'Quantity' }, 1: { t: 2, v: quantity } },
    1: { 0: { t: 1, v: 'Offer' }, 1: { t: 1, v: 'Unit price' }, 2: { t: 1, v: 'Flat fee' }, 3: { t: 1, v: 'Total' } },
  };
  for (const [index, offer] of offers.entries()) {
    if (!offer || typeof offer !== 'object' || Array.isArray(offer) || Object.keys(offer).some(k => !['name', 'unitPrice', 'flatFee'].includes(k))) {
      throw new Fault('invalid_quote_offer', 400);
    }
    const { name, unitPrice, flatFee } = offer;
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\r\n]/.test(name)) throw new Fault('invalid_quote_name', 400);
    const total = (quantity * cents(unitPrice) + cents(flatFee)) / 100;
    const row = index + 3;
    cells[row - 1] = {
      0: { t: 1, v: name }, 1: { t: 2, v: unitPrice }, 2: { t: 2, v: flatFee },
      3: { t: 2, v: total, f: `=ROUND($B$1*B${row}+C${row},2)` },
    };
  }
  return cells;
}
