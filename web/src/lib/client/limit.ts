/**
 * Runs at most `max` of the given reads at once; the rest wait their turn.
 * Home assembles its feed from many small reads, and firing them all at
 * once slows every request behind them, including the person's own send.
 */
export function limiter(max: number) {
  if (!Number.isSafeInteger(max) || max < 1)
    throw new RangeError("Concurrency must be a positive safe integer.");
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    if (active >= max) return;
    const start = waiting.shift();
    if (start) {
      active++;
      start();
    }
  };
  return <T>(read: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        Promise.resolve()
          .then(read)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}
