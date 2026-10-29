import { declaredName } from './command-rules.js';
import { DeclarationError, quoted } from './errors.js';
import { siteFinding } from './facts.js';
import type { InputSite } from './facts.js';
import { optionDeclaredTwice, spellingTaken } from './input-rules.js';
import type { OptionConfig } from './types.js';

export interface OptionDeclaration {
  name: string;
  config: OptionConfig;
}

export interface OptionValues {
  strings: Map<string, string>;
  lists: Map<string, string[]>;
  booleans: Map<string, boolean>;
  /** How many times each counted option was supplied, or the count an input source filled. */
  counts: Map<string, number>;
  /** The spelling of the token that supplied each parsed option, which no input source writes. */
  spellings: Map<string, string>;
  /**
   * For each string option a bare spelling supplied, the positions that held its implied value: `0`
   * for a scalar, and each such occurrence's index in a multiple option's list. Validation supplies
   * the implied value's prepared output there, and no input source writes it.
   */
  implied: Map<string, number[]>;
}

/**
 * Every parsed value lands in one of these maps; `lists` holds the repeated string options and
 * `counts` the counted ones.
 */
export function emptyValues(): OptionValues {
  return {
    booleans: new Map(),
    counts: new Map(),
    implied: new Map(),
    lists: new Map(),
    spellings: new Map(),
    strings: new Map(),
  };
}

/**
 * Which accepted form a table entry is, and for an alias's spelling, positive or negative, its place
 * in `aliases`. The table owns the convention, so readers never re-derive it.
 */
export type SpellingOrigin =
  | { role: 'long' | 'negative' | 'short' }
  | { role: 'alias'; index: number };

/**
 * How one option reads words: its kind, and its value class, of which there are four: a Boolean
 * option, a counted option, a string option with an implied value, which never takes the next word
 * and supplies `implied` when its spelling is bare, and a string option that takes the next word as
 * its value when nothing is attached. Compiling the table derives the class once, and the parser, a
 * rebound occurrence, and `locate` read that one fact.
 */
type OptionForm =
  | { type: 'string'; valueClass: 'separate'; name: string; multiple: boolean }
  | { type: 'string'; valueClass: 'implied'; name: string; multiple: boolean; implied: string }
  | { type: 'boolean'; valueClass: 'boolean'; name: string; value: boolean }
  | { type: 'count'; valueClass: 'count'; name: string };

export type OptionSpelling = OptionForm & SpellingOrigin;

/**
 * One entry of a Command's spelling table: a spelling of one declaration, and whether that
 * declaration is a global option, whose value every action reads, or the Command's own.
 */
export type TableSpelling = OptionSpelling & { readonly global: boolean };

/** The one table the parser reads a Command's words against, keyed by spelling. */
export type SpellingTable = ReadonlyMap<string, TableSpelling>;

/** One scope's compiled spellings as table entries, each marked with whether the scope is global. */
export function tableEntries(
  spellings: ReadonlyMap<string, OptionSpelling>,
  global: boolean,
): [string, TableSpelling][] {
  return [...spellings].map(([spelling, option]) => [spelling, { ...option, global }]);
}

/** The accepted spellings of one option, `null` where the declaration publishes none. */
export interface Spellings {
  long: string | null;
  negative: string | null;
  short: string | null;
}

/**
 * Reads one option's spellings out of a compiled table, so a reader cannot report a form the parser
 * does not accept. Each entry carries its own role, so the naming convention has one owner: the
 * table that writes it.
 */
export function spellingsOf(table: ReadonlyMap<string, OptionSpelling>, name: string): Spellings {
  const spellings: Spellings = { long: null, negative: null, short: null };
  for (const [spelling, option] of table) {
    // An alias is unadvertised, so the spellings are the ones the declared name derives.
    if (option.name === name && option.role !== 'alias') {
      spellings[option.role] = spelling;
    }
  }
  return spellings;
}

/**
 * The spelling every reported problem names an option by: its long form, a negative-only Boolean
 * option's negative form, and otherwise its short form, which a short-only option alone publishes.
 * The problem belongs to the option, so an alias or the spelling the operator typed is never it.
 */
export function reportedOf({ long, negative, short }: Spellings, name: string): string {
  // Every compiled option publishes one of the three, because shortOnly requires a short.
  // A node no table wrote falls back to the declared name's long form.
  return long ?? negative ?? short ?? `--${name}`;
}

/**
 * The part of one declaration that yields a spelling of the given origin, which a spelling fault
 * marks: the declared name for the long form, `short` for the short alias, the `polarity` that
 * generates a negative form, and the alias in `aliases` for either form of an alias.
 */
export function spellingMark(site: InputSite, origin: SpellingOrigin): string {
  switch (origin.role) {
    case 'long': {
      return site.named;
    }
    case 'short': {
      return `${site.at}.short`;
    }
    case 'negative': {
      return `${site.at}.polarity`;
    }
    case 'alias': {
      return `${site.at}.aliases.${String(origin.index)}`;
    }
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

/** The declared name answers the declared-name rule an argument's name answers. */
export function checkOptionName(name: string, site: InputSite): void {
  if (!isDeclaredName(name)) {
    throw new DeclarationError(declaredName, {
      correction: declaredNameCorrection,
      findings: [siteFinding(site, site.named)],
      sentence: `Option name ${quoted(name)} is invalid.`,
    });
  }
}

/**
 * The one name rule for an argument, option, alias of an option, or view name: a bare token the
 * parser can read, nonempty, with no leading hyphen, whitespace, or `=`, which it reads apart.
 * Core exports it so the lint plugin judges a literal name by this same rule.
 */
export function isDeclaredName(name: string): boolean {
  return name !== '' && !name.startsWith('-') && !/[\s=]/u.test(name);
}

/** The one correction every declared-name diagnostic ends with. */
export const declaredNameCorrection =
  'Use a nonempty name without a leading hyphen, whitespace, or "=".';

/** Each alias answers the declared-name rule, because an operator types it as a long spelling. */
function checkAliases(config: OptionConfig, site: InputSite, name: string): void {
  for (const [index, alias] of (config.aliases ?? []).entries()) {
    if (!isDeclaredName(alias)) {
      throw new DeclarationError(declaredName, {
        correction: declaredNameCorrection,
        findings: [siteFinding(site, `${site.at}.aliases.${String(index)}`)],
        sentence: `Option ${quoted(name)} declares an alias named ${quoted(alias)}.`,
      });
    }
  }
}

/**
 * The aliases one option declares, each with its place in `aliases`, without a repeat: an alias
 * that names the option or an alias before it adds no spelling, so it is skipped.
 */
export function distinctAliases(
  name: string,
  config: OptionConfig,
): readonly { readonly alias: string; readonly index: number }[] {
  const seen = new Set([name]);
  const distinct: { alias: string; index: number }[] = [];
  for (const [index, alias] of (config.aliases ?? []).entries()) {
    if (!seen.has(alias)) {
      seen.add(alias);
      distinct.push({ alias, index });
    }
  }
  return distinct;
}

/**
 * The scope one table compiles: the phrase a repeated name names it by, and where each of its
 * options was declared, which every fault's findings rebuild.
 */
export interface CompileScope<Declaration extends OptionDeclaration> {
  readonly subject: string;
  readonly siteOf: (declaration: Declaration) => InputSite;
}

/** One spelling of a table being compiled, with the site of the option that claims it. */
interface Claim {
  option: OptionSpelling;
  site: InputSite;
}

function addSpelling(claims: Map<string, Claim>, spelling: string, claim: Claim) {
  const existing = claims.get(spelling);
  if (existing) {
    throw new DeclarationError(spellingTaken, {
      correction: 'Change one declaration.',
      findings: [existing, claim].map(({ option, site }) =>
        siteFinding(site, spellingMark(site, option)),
      ),
      sentence: `Option spelling ${quoted(spelling)} is used by both ${quoted(existing.option.name)} and ${quoted(claim.option.name)}.`,
    });
  }
  claims.set(spelling, claim);
}

/**
 * The long forms one name yields for an option, the declared name or an alias: the positive form,
 * unless the polarity is negative, and the negative form for `both` and `negative` polarity.
 */
function addLongForms(
  claims: Map<string, Claim>,
  option: { config: OptionConfig; positive: OptionForm; site: InputSite },
  long: { name: string; positive: SpellingOrigin; negative: SpellingOrigin },
): void {
  const { config, positive, site } = option;
  const forms: [string, OptionSpelling][] = [];
  if (config.type !== 'boolean' || config.polarity !== 'negative') {
    forms.push([`--${long.name}`, { ...positive, ...long.positive }]);
  }
  if (config.type === 'boolean' && (config.polarity === 'both' || config.polarity === 'negative')) {
    forms.push([
      `--no-${long.name}`,
      {
        name: positive.name,
        type: 'boolean',
        value: false,
        valueClass: 'boolean',
        ...long.negative,
      },
    ]);
  }
  for (const [spelling, form] of forms) {
    // The name's forms claim first, so an alias whose spelling the option already holds adds nothing.
    if (form.role !== 'alias' || claims.get(spelling)?.option.name !== positive.name) {
      addSpelling(claims, spelling, { option: form, site });
    }
  }
}

/**
 * One Boolean option's value for one invocation: the value the parser consumed, or the value its
 * declared polarity gives an absent option. A negative-only option is absent as `true`, because its
 * one spelling turns the value off. Validation reads every Boolean option's value here, whichever
 * scope declared it.
 */
export function booleanValue(values: OptionValues, name: string, config: OptionConfig): boolean {
  return values.booleans.get(name) ?? config.polarity === 'negative';
}

/** The form an option's positive spellings read words by, its long form and short alias alike. */
function positiveForm(name: string, config: OptionConfig): OptionForm {
  switch (config.type) {
    case 'content':
    case 'string': {
      const multiple = config.multiple === true;
      return config.implied === undefined
        ? { multiple, name, type: 'string', valueClass: 'separate' }
        : { implied: config.implied, multiple, name, type: 'string', valueClass: 'implied' };
    }
    case 'boolean': {
      return {
        name,
        type: 'boolean',
        value: config.polarity !== 'negative',
        valueClass: 'boolean',
      };
    }
    case 'count': {
      return { name, type: 'count', valueClass: 'count' };
    }
    default: {
      const exhaustive: never = config;
      return exhaustive;
    }
  }
}

/**
 * One scope's options compiled into the spelling table the parser reads, with every rule one
 * declaration answers alone and every rule two of them answer together.
 */
export function compileOptions<Declaration extends OptionDeclaration>(
  declarations: readonly Declaration[],
  scope: CompileScope<Declaration>,
): Map<string, OptionSpelling> {
  const claims = new Map<string, Claim>();
  const names = new Map<string, Declaration>();
  for (const declaration of declarations) {
    const { name, config } = declaration;
    const site = scope.siteOf(declaration);
    checkOptionName(name, site);
    checkAliases(config, site, name);
    const first = names.get(name);
    if (first) {
      const earlier = scope.siteOf(first);
      throw new DeclarationError(optionDeclaredTwice, {
        correction: 'Remove or rename the duplicate.',
        findings: [
          siteFinding(earlier, earlier.named, 'the first declaration'),
          siteFinding(site, site.named, 'the second declaration'),
        ],
        sentence: `Option ${quoted(name)} is declared more than once on ${scope.subject}.`,
      });
    }
    names.set(name, declaration);
    const positive = positiveForm(name, config);
    if (!config.shortOnly) {
      const option = { config, positive, site };
      addLongForms(claims, option, {
        name,
        negative: { role: 'negative' },
        positive: { role: 'long' },
      });
      for (const { alias, index } of distinctAliases(name, config)) {
        const origin: SpellingOrigin = { index, role: 'alias' };
        addLongForms(claims, option, { name: alias, negative: origin, positive: origin });
      }
    }
    if (config.short !== undefined) {
      addSpelling(claims, `-${config.short}`, { option: { ...positive, role: 'short' }, site });
    }
  }
  return new Map([...claims].map(([spelling, { option }]) => [spelling, option]));
}

/**
 * Whether one option holds a value a tier supplied: a token in any spelling it accepts, or a fill
 * from an input source. A declared default is never in these maps, so it never counts.
 */
export function isSupplied(values: OptionValues, name: string): boolean {
  return (
    values.strings.has(name) ||
    values.lists.has(name) ||
    values.booleans.has(name) ||
    values.counts.has(name)
  );
}

/** Removes the value an input source filled, so the option reads as unfilled by every tier. */
export function withdrawFill(values: OptionValues, name: string): void {
  values.booleans.delete(name);
  values.counts.delete(name);
  values.lists.delete(name);
  values.strings.delete(name);
}

/** One run's own copy of parsed values, which the input-source stage fills without touching argv's. */
export function copyValues(values: OptionValues): OptionValues {
  return {
    booleans: new Map(values.booleans),
    counts: new Map(values.counts),
    implied: new Map([...values.implied].map(([name, positions]) => [name, [...positions]])),
    lists: new Map([...values.lists].map(([name, list]) => [name, [...list]])),
    spellings: new Map(values.spellings),
    strings: new Map(values.strings),
  };
}

/** Global and local keys never overlap, so one merged view feeds a single validation pass. */
export function mergeValues(globals: OptionValues, locals: OptionValues): OptionValues {
  return {
    booleans: new Map([...globals.booleans, ...locals.booleans]),
    counts: new Map([...globals.counts, ...locals.counts]),
    implied: new Map([...globals.implied, ...locals.implied]),
    lists: new Map([...globals.lists, ...locals.lists]),
    spellings: new Map([...globals.spellings, ...locals.spellings]),
    strings: new Map([...globals.strings, ...locals.strings]),
  };
}
