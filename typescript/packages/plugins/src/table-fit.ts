const EMPTY = 0;
const HALVES = 2;
const NEXT = 1;

/** The sum of a list of widths. */
function total(widths: readonly number[]): number {
  let sum = EMPTY;
  for (const width of widths) {
    sum += width;
  }
  return sum;
}

/** The width of each column when no column is wider than `level`, unless its floor is. */
function widthsAt(natural: readonly number[], floors: readonly number[], level: number): number[] {
  return natural.map((width, index) => Math.max(floors[index] ?? EMPTY, Math.min(width, level)));
}

/**
 * The largest whole level at which the columns still fit `available`, found by bisection. The
 * floors fit at level 0, and the natural widths do not fit at the widest of them.
 */
function largestLevel(
  natural: readonly number[],
  floors: readonly number[],
  available: number,
): number {
  let low = EMPTY;
  let high = Math.max(...natural);
  while (high - low > NEXT) {
    const middle = Math.floor((low + high) / HALVES);
    if (total(widthsAt(natural, floors, middle)) <= available) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * The widths of columns that must give up room, by levelling from the top. It finds the largest
 * whole level at which every column at `max(floor, min(natural, level))` still fits `available`,
 * and gives the columns that sit exactly at that level and are naturally wider one leftover column
 * each, from the left. The widths total `available` exactly. The caller guarantees that the floors
 * fit and that the natural widths do not.
 */
function levelWidths(
  natural: readonly number[],
  floors: readonly number[],
  available: number,
): number[] {
  const level = largestLevel(natural, floors, available);
  const widths = widthsAt(natural, floors, level);
  let remainder = available - total(widths);
  return widths.map((width, index) => {
    if (remainder > EMPTY && width === level && (natural[index] ?? EMPTY) > level) {
      remainder -= NEXT;
      return width + NEXT;
    }
    return width;
  });
}

export { levelWidths, total };
