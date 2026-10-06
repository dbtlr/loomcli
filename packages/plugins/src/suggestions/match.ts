/**
 * Whether the typed word is a Command name, an option spelling, whose leading hyphens fold away, or
 * an option's declared name, which an invocation by name writes and which is compared as written.
 */
type Spelled = 'command' | 'name' | 'option';

/** The cost of one edit: an insertion, a deletion, a substitution, or an adjacent transposition. */
const edit = 1;

/** One position: the code point before or after, or the table's leading row and column. */
const step = 1;

/** A typed token shorter than this, in code points after folding, matches nothing. */
const shortestToken = 2;

/** At most this many names print. */
const mostMatches = 3;

/** The distance a token of each length allows: up to 4 code points, up to 8, and longer. */
const budgets = [
  { distance: 1, longest: 4 },
  { distance: 2, longest: 8 },
] as const;
const longTokenBudget = 3;

/**
 * The code points one word is compared by: NFC, lowercased with the locale-independent default
 * conversion, and for an option spelling without its leading hyphens.
 */
function fold(word: string, spelled: Spelled): string[] {
  const folded = word.normalize('NFC').toLowerCase();
  return (spelled === 'option' ? folded.replace(/^-+/u, '') : folded).match(/./gsu) ?? [];
}

function budgetOf(length: number): number {
  return budgets.find(({ longest }) => length <= longest)?.distance ?? longTokenBudget;
}

/**
 * The rows of the distance table one cell reads: `before` two typed code points back, `above` one
 * back, and `current` filled up to the cell.
 */
interface Rows {
  typed: readonly string[];
  candidate: readonly string[];
  before: readonly number[];
  above: readonly number[];
  current: readonly number[];
}

/**
 * The distance between the typed code points through `row` and the candidate's through `column`.
 * A transposition reads one code point back on each side, which the first row and column lack, so
 * its comparison with `undefined` rules it out there.
 */
function cell({ above, before, candidate, current, typed }: Rows, row: number, column: number) {
  const letter = typed[row];
  const other = candidate[column];
  const transposed =
    typed[row - step] === other && candidate[column - step] === letter
      ? (before[column - step] ?? Infinity) + edit
      : Infinity;
  return Math.min(
    (above[column + step] ?? Infinity) + edit,
    (current[column] ?? Infinity) + edit,
    (above[column] ?? Infinity) + Number(letter !== other),
    transposed,
  );
}

/**
 * The restricted Damerau-Levenshtein distance, or optimal string alignment: each edit costs 1, and
 * no substring is edited more than once. The table is built one row per typed code point.
 */
function distance(typed: readonly string[], candidate: readonly string[]): number {
  let before: readonly number[] = [];
  let above: readonly number[] = Array.from(
    { length: candidate.length + step },
    (_cell, column) => column,
  );
  typed.forEach((_letter, row) => {
    const current = [row + step];
    candidate.forEach((_other, column) => {
      current.push(cell({ above, before, candidate, current, typed }, row, column));
    });
    before = above;
    above = current;
  });
  return above[candidate.length] ?? Infinity;
}

/**
 * The declared spellings near the typed word, nearest first and in candidate order at one distance,
 * at most three. Each candidate is the spellings of one declared member, and a member offers only
 * its nearest spellings, so a Boolean option never offers its opposite beside the spelling the
 * operator meant. A spelling prints as declared, so the comparison folds a copy of each side.
 */
function nearest(
  word: string,
  candidates: readonly (readonly string[])[],
  spelled: Spelled,
): string[] {
  const typed = fold(word, spelled);
  if (typed.length < shortestToken) {
    return [];
  }
  const budget = budgetOf(typed.length);
  const scored = candidates.flatMap((spellings) => {
    const near = spellings.flatMap((name) => {
      const folded = fold(name, spelled);
      // A length gap past the budget is at least that many edits, so no table is built for it.
      if (Math.abs(folded.length - typed.length) > budget) {
        return [];
      }
      const found = distance(typed, folded);
      return found <= budget ? [{ found, name }] : [];
    });
    const closest = Math.min(...near.map(({ found }) => found));
    return near.filter(({ found }) => found === closest);
  });
  // Ascending distance, and the names at one distance keep candidate order.
  return Array.from({ length: budget + step }, (_slot, found) => found)
    .flatMap((found) => scored.filter((match) => match.found === found))
    .filter((_match, rank) => rank < mostMatches)
    .map(({ name }) => name);
}

export type { Spelled };
export { nearest };
