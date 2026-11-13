import { declaredName } from '../commands/rules.js';
import { siteFinding } from '../diagnostics/facts.js';
import type { InputSite } from '../diagnostics/facts.js';
import { DeclarationError, quoted } from '../failures/errors.js';
import { envDelimiterEmpty, optionDeclaredTwice, spellingTaken } from './rules.js';
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

/**
 * The declared name answers the declared-name rule an argument's name answers. The site is built
 * only when the name fails, because nothing else reads it.
 */
export function checkOptionName(name: string, siteOf: () => InputSite): void {
  if (!isDeclaredName(name)) {
    const site = siteOf();
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
 *
 * @example
 * ```ts
 * import { isDeclaredName } from '@loomcli/core';
 *
 * isDeclaredName('dry-run'); // true
 * isDeclaredName('--dry-run'); // false: it starts with a hyphen
 * isDeclaredName('key=value'); // false: it holds "="
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md
 * @public
 */
export function isDeclaredName(name: string): boolean {
  return name !== '' && !name.startsWith('-') && !/[\s=]/u.test(name);
}

/** The one correction every declared-name diagnostic ends with. */
export const declaredNameCorrection =
  'Use a nonempty name without a leading hyphen, whitespace, or "=".';

/** Each alias answers the declared-name rule, because an operator types it as a long spelling. */
function checkAliases(config: OptionConfig, siteOf: () => InputSite, name: string): void {
  for (const [index, alias] of (config.aliases ?? []).entries()) {
    if (!isDeclaredName(alias)) {
      const site = siteOf();
      throw new DeclarationError(declaredName, {
        correction: declaredNameCorrection,
        findings: [siteFinding(site, `${site.at}.aliases.${String(index)}`)],
        sentence: `Option ${quoted(name)} declares an alias named ${quoted(alias)}.`,
      });
    }
  }
}

/** A multiple option's delimiter separates its variable's items, so it holds a character. */
function checkEnvDelimiter(config: OptionConfig, siteOf: () => InputSite, name: string): void {
  if ((config.type === 'string' || config.type === 'content') && config.envDelimiter === '') {
    const site = siteOf();
    throw new DeclarationError(envDelimiterEmpty, {
      correction: 'Name the string that separates the items, such as ",".',
      findings: [siteFinding(site, `${site.at}.envDelimiter`)],
      sentence: `Option ${quoted(name)} declares an empty envDelimiter.`,
    });
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

/**
 * One spelling of a table being compiled, with the declaration that claims it. A fault builds the
 * declaration's site from the scope that reports it, so a claim holds no site of its own.
 */
interface Claim<Declaration extends OptionDeclaration> {
  readonly declaration: Declaration;
  readonly option: OptionSpelling;
}

/** A compile in progress: the claims so far, and the scope whose sites a fault reports. */
interface Compiling<Declaration extends OptionDeclaration> {
  readonly claims: Map<string, Claim<Declaration>>;
  readonly names: Map<string, Declaration>;
  readonly scope: CompileScope<Declaration>;
}

function addSpelling<Declaration extends OptionDeclaration>(
  compiling: Compiling<Declaration>,
  spelling: string,
  claim: Claim<Declaration>,
) {
  const { claims, scope } = compiling;
  const existing = claims.get(spelling);
  if (existing) {
    throw new DeclarationError(spellingTaken, {
      correction: 'Change one declaration.',
      findings: [existing, claim].map(({ declaration, option }) => {
        const site = scope.siteOf(declaration);
        return siteFinding(site, spellingMark(site, option));
      }),
      sentence: `Option spelling ${quoted(spelling)} is used by both ${quoted(existing.option.name)} and ${quoted(claim.option.name)}.`,
    });
  }
  claims.set(spelling, claim);
}

/**
 * The long forms one name yields for an option, the declared name or an alias: the positive form,
 * unless the polarity is negative, and the negative form for `both` and `negative` polarity.
 */
function addLongForms<Declaration extends OptionDeclaration>(
  compiling: Compiling<Declaration>,
  option: { declaration: Declaration; positive: OptionForm },
  long: { name: string; positive: SpellingOrigin; negative: SpellingOrigin },
): void {
  const { claims } = compiling;
  const { declaration, positive } = option;
  const { config } = declaration;
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
      addSpelling(compiling, spelling, { declaration, option: form });
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
  return values.booleans.get(name) ?? absentBoolean(config);
}

/** The value a Boolean option's polarity gives it when no tier supplies it: `true` for negative. */
export function absentBoolean(config: OptionConfig): boolean {
  return config.polarity === 'negative';
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
 * One scope's options compiled so far: the claim on each spelling, the first declaration of each
 * name, and the spelling table the parser reads, in claim order. A compile is never changed, so
 * `compileNext` extends one by a declaration without recompiling the declarations before it.
 */
export interface CompiledOptions<Declaration extends OptionDeclaration> {
  readonly claims: ReadonlyMap<string, Claim<Declaration>>;
  readonly names: ReadonlyMap<string, Declaration>;
  readonly table: ReadonlyMap<string, OptionSpelling>;
}

/**
 * One declaration added to a compile in progress, with every rule it answers alone and every rule it
 * answers with a declaration added before it. A fault names each declaration by its site in the
 * compile's scope, which is built only then.
 */
function addOption<Declaration extends OptionDeclaration>(
  compiling: Compiling<Declaration>,
  declaration: Declaration,
): void {
  const { names, scope } = compiling;
  const { name, config } = declaration;
  const siteOf = () => scope.siteOf(declaration);
  checkOptionName(name, siteOf);
  checkAliases(config, siteOf, name);
  checkEnvDelimiter(config, siteOf, name);
  const first = names.get(name);
  if (first) {
    const earlier = scope.siteOf(first);
    const site = siteOf();
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
    const option = { declaration, positive };
    addLongForms(compiling, option, {
      name,
      negative: { role: 'negative' },
      positive: { role: 'long' },
    });
    for (const { alias, index } of distinctAliases(name, config)) {
      const origin: SpellingOrigin = { index, role: 'alias' };
      addLongForms(compiling, option, { name: alias, negative: origin, positive: origin });
    }
  }
  if (config.short !== undefined) {
    const option: OptionSpelling = { ...positive, role: 'short' };
    addSpelling(compiling, `-${config.short}`, { declaration, option });
  }
}

/** One scope's options compiled in declaration order. */
export function compileAll<Declaration extends OptionDeclaration>(
  declarations: readonly Declaration[],
  scope: CompileScope<Declaration>,
): CompiledOptions<Declaration> {
  const compiling: Compiling<Declaration> = { claims: new Map(), names: new Map(), scope };
  for (const declaration of declarations) {
    addOption(compiling, declaration);
  }
  const { claims, names } = compiling;
  return { claims, names, table: new Map([...claims].map(([key, { option }]) => [key, option])) };
}

/**
 * One more declaration compiled after the ones `previous` holds, which stays as it was. It answers
 * what `compileAll` answers for the longer list, without compiling the earlier declarations again.
 */
export function compileNext<Declaration extends OptionDeclaration>(
  previous: CompiledOptions<Declaration>,
  declaration: Declaration,
  scope: CompileScope<Declaration>,
): CompiledOptions<Declaration> {
  const claims = new Map(previous.claims);
  const names = new Map(previous.names);
  addOption({ claims, names, scope }, declaration);
  // A claim is never replaced, so the spellings this declaration added follow the earlier ones.
  const table = new Map(previous.table);
  for (const [spelling, { option }] of claims) {
    if (!previous.claims.has(spelling)) {
      table.set(spelling, option);
    }
  }
  return { claims, names, table };
}

/**
 * One scope's options compiled into the spelling table the parser reads, with every rule one
 * declaration answers alone and every rule two of them answer together.
 */
export function compileOptions<Declaration extends OptionDeclaration>(
  declarations: readonly Declaration[],
  scope: CompileScope<Declaration>,
): Map<string, OptionSpelling> {
  return new Map(compileAll(declarations, scope).table);
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
