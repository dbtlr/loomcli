import { declaredName, repeatedAlias } from './command-rules.js';
import { valueCode } from './diagnostic-text.js';
import { DeclarationError, quoted } from './errors.js';
import { factFault, flagFault, siteFinding } from './facts.js';
import type { InputSite } from './facts.js';
import {
  booleanOptionMultiple,
  optionDeclaredTwice,
  optionPolarity,
  optionType,
  polarityOnString,
  shortAlias,
  shortOnlyBothPolarities,
  shortOnlyWithAliases,
  shortOnlyWithoutShort,
  spellingTaken,
} from './input-rules.js';
import { notAList } from './plugin-rules.js';
import type { OptionConfig } from './types.js';

export interface OptionDeclaration {
  name: string;
  config: OptionConfig;
}

export interface OptionValues {
  strings: Map<string, string>;
  lists: Map<string, string[]>;
  booleans: Map<string, boolean>;
  /** The spelling of the token that supplied each parsed option, which no input source writes. */
  spellings: Map<string, string>;
}

/** Every parsed value lands in one of these maps; `lists` holds the repeated string options. */
export function emptyValues(): OptionValues {
  return { booleans: new Map(), lists: new Map(), spellings: new Map(), strings: new Map() };
}

/**
 * Which accepted form a table entry is, and for an alias's spelling, positive or negative, its place
 * in `aliases`. The table owns the convention, so readers never re-derive it.
 */
export type SpellingOrigin =
  | { role: 'long' | 'negative' | 'short' }
  | { role: 'alias'; alias: number };

type OptionForm =
  | { type: 'string'; name: string; multiple: boolean }
  | { type: 'boolean'; name: string; value: boolean };

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
      return `${site.at}.aliases.${String(origin.alias)}`;
    }
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

/** The declared name answers the declared-name rule an argument's name answers. */
export function checkOptionName(name: unknown, site: InputSite): void {
  const findings = [siteFinding(site, site.named)];
  if (typeof name !== 'string') {
    throw new DeclarationError(declaredName, {
      correction: 'Supply a string name.',
      findings,
      sentence: `Option name ${valueCode(name)} is not a string.`,
    });
  }
  if (!isOptionName(name)) {
    throw new DeclarationError(declaredName, {
      correction: optionNameCorrection,
      findings,
      sentence: `Option name ${quoted(name)} is invalid.`,
    });
  }
}

/**
 * Whether a string can be an option's declared name or alias, each of which becomes a long
 * spelling: nonempty, with no leading hyphen, whitespace, or `=`, which the parser reads apart.
 */
function isOptionName(name: string): boolean {
  return name !== '' && !name.startsWith('-') && !/[\s=]/u.test(name);
}

const optionNameCorrection = 'Use a nonempty name without a leading hyphen, whitespace, or "=".';

/** Whether a declared short alias is one ASCII letter, the rule every short spelling answers. */
export function isShortAlias(short: unknown): boolean {
  return typeof short === 'string' && /^[A-Za-z]$/u.test(short);
}

/** The sentence and correction of the short-alias fault for the option `subject` names. */
export function shortAliasText(subject: string): { sentence: string; correction: string } {
  return {
    correction: 'Supply one ASCII letter.',
    sentence: `${subject} declares a short alias that is not one ASCII letter.`,
  };
}

/** The short alias, and `shortOnly`, which leaves the option that alias alone. */
function checkShortForms(config: OptionConfig, site: InputSite, subject: string): void {
  if (config.short !== undefined && !isShortAlias(config.short)) {
    throw factFault(shortAlias, site, { ...shortAliasText(subject), fact: 'short' });
  }
  if (config.shortOnly !== undefined && typeof config.shortOnly !== 'boolean') {
    throw flagFault(site, 'shortOnly');
  }
  if (config.shortOnly && config.short === undefined) {
    throw factFault(shortOnlyWithoutShort, site, {
      correction: 'Add short or remove shortOnly.',
      fact: 'shortOnly',
      sentence: `${subject} declares shortOnly and no short alias.`,
    });
  }
}

/**
 * The aliases, each a name the declared-name rule accepts, none repeating the option's name or
 * another alias. `shortOnly` removes every long spelling, so it declares none.
 */
function checkAliases(config: OptionConfig, site: InputSite, name: string): void {
  const subject = `Option ${quoted(name)}`;
  // The types reject the pair, so this reads `shortOnly` before `aliases` narrows it away.
  if (config.shortOnly === true && config.aliases !== undefined) {
    throw factFault(shortOnlyWithAliases, site, {
      correction: 'Remove aliases or shortOnly.',
      fact: 'aliases',
      sentence: `${subject} declares aliases and shortOnly, which removes every long spelling.`,
    });
  }
  const { aliases } = config;
  if (aliases === undefined) {
    return;
  }
  if (!Array.isArray(aliases)) {
    throw factFault(notAList, site, {
      correction: 'Supply a list of alias names.',
      fact: 'aliases',
      sentence: `${subject} declares aliases that are not an array.`,
    });
  }
  const seen = new Set<string>();
  for (const [index, alias] of aliases.entries()) {
    const at = `${site.at}.aliases.${String(index)}`;
    if (typeof alias !== 'string') {
      throw new DeclarationError(declaredName, {
        correction: 'Supply a string name.',
        findings: [siteFinding(site, at)],
        sentence: `${subject} declares an alias named ${valueCode(alias)}.`,
      });
    }
    if (!isOptionName(alias)) {
      throw new DeclarationError(declaredName, {
        correction: optionNameCorrection,
        findings: [siteFinding(site, at)],
        sentence: `${subject} declares an alias named ${quoted(alias)}.`,
      });
    }
    if (alias === name) {
      throw new DeclarationError(repeatedAlias, {
        correction: 'Remove the alias.',
        findings: [siteFinding(site, at, 'its own name')],
        sentence: `${subject} declares alias ${quoted(alias)}, which is its own name.`,
      });
    }
    if (seen.has(alias)) {
      throw new DeclarationError(repeatedAlias, {
        correction: 'Remove the repeated alias.',
        findings: [siteFinding(site, at, 'already an alias')],
        sentence: `${subject} declares alias ${quoted(alias)} twice.`,
      });
    }
    seen.add(alias);
  }
}

/** A Boolean option's polarity, which a string option does not declare. */
function checkPolarity(config: OptionConfig, site: InputSite, subject: string): void {
  if (config.polarity === undefined) {
    return;
  }
  if (config.type !== 'boolean') {
    throw factFault(polarityOnString, site, {
      correction: 'Remove polarity or use type "boolean".',
      fact: 'polarity',
      sentence: `${subject} declares polarity but is not Boolean.`,
    });
  }
  if (!['positive', 'both', 'negative'].includes(config.polarity)) {
    throw factFault(optionPolarity, site, {
      correction: 'Use "positive", "both", or "negative".',
      fact: 'polarity',
      sentence: `${subject} has an invalid polarity.`,
    });
  }
  if (config.polarity === 'both' && config.shortOnly) {
    throw factFault(shortOnlyBothPolarities, site, {
      correction: 'Enable long forms or select one polarity.',
      fact: 'shortOnly',
      sentence: `${subject} cannot express both polarities with shortOnly.`,
    });
  }
}

/** Every rule one option declaration answers alone, before the table meets it. */
function validateDeclaration({ name, config }: OptionDeclaration, site: InputSite) {
  checkOptionName(name, site);
  const subject = `Option ${quoted(name)}`;
  if (!['string', 'boolean'].includes(config.type)) {
    throw factFault(optionType, site, {
      correction: 'Use "string" or "boolean".',
      fact: 'type',
      sentence: `${subject} has an invalid type.`,
    });
  }
  checkShortForms(config, site, subject);
  checkAliases(config, site, name);
  if (config.type === 'boolean' && config.multiple !== undefined) {
    throw factFault(booleanOptionMultiple, site, {
      correction: 'Remove multiple or declare a string option.',
      fact: 'multiple',
      sentence: `${subject} is a boolean option and declares multiple.`,
    });
  }
  if (config.multiple !== undefined && typeof config.multiple !== 'boolean') {
    throw flagFault(site, 'multiple');
  }
  checkPolarity(config, site, subject);
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
  if (config.type === 'string' || config.polarity !== 'negative') {
    addSpelling(claims, `--${long.name}`, { option: { ...positive, ...long.positive }, site });
  }
  if (config.type === 'boolean' && (config.polarity === 'both' || config.polarity === 'negative')) {
    addSpelling(claims, `--no-${long.name}`, {
      option: { name: positive.name, type: 'boolean', value: false, ...long.negative },
      site,
    });
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
    validateDeclaration({ config, name }, site);
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
    const positive: OptionForm =
      config.type === 'string'
        ? { multiple: config.multiple === true, name, type: 'string' }
        : { name, type: 'boolean', value: config.polarity !== 'negative' };
    if (!config.shortOnly) {
      const option = { config, positive, site };
      addLongForms(claims, option, {
        name,
        negative: { role: 'negative' },
        positive: { role: 'long' },
      });
      for (const [index, alias] of (config.aliases ?? []).entries()) {
        const origin: SpellingOrigin = { alias: index, role: 'alias' };
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
  return values.strings.has(name) || values.lists.has(name) || values.booleans.has(name);
}

/** One run's own copy of parsed values, which the input-source stage fills without touching argv's. */
export function copyValues(values: OptionValues): OptionValues {
  return {
    booleans: new Map(values.booleans),
    lists: new Map([...values.lists].map(([name, list]) => [name, [...list]])),
    spellings: new Map(values.spellings),
    strings: new Map(values.strings),
  };
}

/** Global and local keys never overlap, so one merged view feeds a single validation pass. */
export function mergeValues(globals: OptionValues, locals: OptionValues): OptionValues {
  return {
    booleans: new Map([...globals.booleans, ...locals.booleans]),
    lists: new Map([...globals.lists, ...locals.lists]),
    spellings: new Map([...globals.spellings, ...locals.spellings]),
    strings: new Map([...globals.strings, ...locals.strings]),
  };
}
