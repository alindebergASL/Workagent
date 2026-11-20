// A bounded arithmetic grammar, not JavaScript or a spreadsheet formula evaluator.
export function calculate(expression) {
  const invalid = () => { throw new Error('invalid_arithmetic_expression'); };
  if (typeof expression !== 'string' || expression.length > 256) invalid();
  const tokens = expression.match(/\d+(?:\.\d+)?|\.\d+|[^\s]/gu) ?? [];
  let i = 0;
  function bounded(n) {
    if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) throw new Error('calculation_out_of_range');
    return n;
  }
  function atom() {
    const t = tokens[i++];
    if (t === '+' || t === '-') return (t === '-' ? -1 : 1) * atom();
    if (t === '(') {
      const n = sum();
      if (tokens[i++] !== ')') invalid();
      return n;
    }
    if (!t || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) invalid();
    return bounded(Number(t));
  }
  function product() {
    let n = atom();
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++], rhs = atom();
      if (op === '/' && rhs === 0) throw new Error('division_by_zero');
      n = bounded(op === '*' ? n * rhs : n / rhs);
    }
    return n;
  }
  function sum() {
    let n = product();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++], rhs = product();
      n = bounded(op === '+' ? n + rhs : n - rhs);
    }
    return n;
  }
  const value = sum();
  if (i !== tokens.length) invalid();
  return { expression, value };
}
