import type { Background } from './background.js';
import { DeclarationError, quoted } from './errors.js';
import { partFinding, slotSite } from './facts.js';
import { isPlainObject } from './plain.js';
import { themeMapping, themeNameTaken } from './plugin-rules.js';
import type { Palette } from './style-state.js';
import { adaptives, concreteOperations, reservedStyleNames } from './style.js';
import type { Operation } from './style.js';

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
 * two sides, no operations for `undefined`, or `undefined` for a value that is none of these.
 */
function themeEntry(value: unknown): ThemeEntry | undefined {
  const operations = value === undefined ? [] : concreteOperations(value);
  if (operations !== undefined) {
    return { kind: 'plain', operations };
  }
  const sides = typeof value === 'object' && value !== null ? adaptives.get(value) : undefined;
  return sides === undefined ? undefined : { ...sides, kind: 'adaptive' };
}

/**
 * One plugin's theme, read as the entries core resolves semantic styles through. Each fault marks
 * the theme, or the one entry at fault, in `plugin(identity, { theme })`.
 */
function buildTheme(value: unknown, identity: string): BuiltTheme {
  const subject = `Plugin ${quoted(identity)}`;
  const site = slotSite({ call: 'plugin', named: identity, subject }, 'theme', value);
  if (!isPlainObject(value)) {
    throw new DeclarationError(themeMapping, {
      correction: 'Supply a mapping of names to concrete style chains.',
      findings: [partFinding(site, [])],
      sentence: `${subject} declares a theme that is not a mapping.`,
    });
  }
  const theme = new Map<string, ThemeEntry>();
  for (const [name, chain] of Object.entries(value)) {
    if (reservedStyleNames.has(name)) {
      throw new DeclarationError(themeNameTaken, {
        correction: 'Rename the theme entry.',
        findings: [partFinding(site, [name])],
        sentence: `${subject} theme name ${quoted(name)} shadows a built-in style member.`,
      });
    }
    const entry = themeEntry(chain);
    if (entry === undefined) {
      throw new DeclarationError(themeMapping, {
        correction:
          'Map the name to a concrete chain such as style.cyan.bold, without calling it or naming a semantic style.',
        findings: [partFinding(site, [name])],
        sentence: `${subject} theme mapping ${quoted(name)} is not an unapplied concrete style chain without semantic tokens.`,
      });
    }
    theme.set(name, entry);
  }
  return theme;
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
