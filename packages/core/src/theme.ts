import type { Background } from './background.js';
import type { Palette } from './style-state.js';
import { adaptives, concreteOperations } from './style.js';
import type { Operation, ThemeMapping } from './style.js';

/** One theme entry's operations: one list for a plain entry, or one for each background. */
type ThemeEntry =
  | { readonly kind: 'plain'; readonly operations: readonly Operation[] }
  | {
      readonly kind: 'adaptive';
      readonly dark: readonly Operation[];
      readonly light: readonly Operation[];
    };

/** One plugin's theme: each name's entry, a plain one or an adaptive one. */
type BuiltTheme = ReadonlyMap<string, ThemeEntry>;

/**
 * The entry one mapping value holds: an unapplied concrete chain's operations, an adaptive style's
 * two sides, or no operations for `undefined`. Any other value misses both registries and throws a
 * plain `TypeError`.
 */
function themeEntry(name: string, value: unknown): ThemeEntry {
  const operations = value === undefined ? [] : concreteOperations(value);
  if (operations !== undefined) {
    return { kind: 'plain', operations };
  }
  const sides = typeof value === 'object' && value !== null ? adaptives.get(value) : undefined;
  if (sides === undefined) {
    throw new TypeError(`Theme entry "${name}" is not an unapplied concrete style chain.`);
  }
  return { ...sides, kind: 'adaptive' };
}

/** One plugin's theme, read as the entries core resolves semantic styles through. */
function buildTheme(mapping: ThemeMapping): BuiltTheme {
  return new Map(Object.entries(mapping).map(([name, chain]) => [name, themeEntry(name, chain)]));
}

/** Whether any entry of a theme is adaptive, which makes the run detect its background. */
function themeAdapts(theme: BuiltTheme): boolean {
  return [...theme.values()].some((entry) => entry.kind === 'adaptive');
}

/**
 * The operations one entry resolves to on one background: a plain entry's own, and an adaptive
 * entry's light side on a light background and its dark side on a dark one or an unknown one.
 */
function entryOperations(entry: ThemeEntry, background: Background | undefined) {
  if (entry.kind === 'plain') {
    return entry.operations;
  }
  return background === 'light' ? entry.light : entry.dark;
}

/** The palette a theme resolves to on one background, each entry resolved by `entryOperations`. */
function themePalette(theme: BuiltTheme, background: Background | undefined): Palette {
  return new Map([...theme].map(([name, entry]) => [name, entryOperations(entry, background)]));
}

export type { BuiltTheme };
export { buildTheme, themeAdapts, themePalette };
