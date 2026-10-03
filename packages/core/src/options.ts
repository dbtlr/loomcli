import { declaredName } from './command-rules.js';
import { valueCode } from './diagnostic-text.js';
import {
  DeclarationError,
  MissingValueError,
  quoted,
  RepeatedOptionError,
  ShortGroupError,
  UnexpectedValueError,
  UnknownOptionError,
} from './errors.js';
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
  shortOnlyWithoutShort,
  spellingTaken,
} from './input-rules.js';
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

/** Which accepted form a table entry is. The table owns the convention, so readers never re-derive it. */
export type SpellingRole = 'long' | 'negative' | 'short';

type OptionForm =
  | { type: 'string'; name: string; multiple: boolean }
  | { type: 'boolean'; name: string; value: boolean };

type OptionSpelling = OptionForm & { role: SpellingRole };

/**
 * The part of one declaration that yields a spelling of the given role, which a spelling fault
 * marks: the declared name for the long form, `short` for the short alias, and the `polarity` that
 * generates a negative form.
 */
export function spellingMark(site: InputSite, role: SpellingRole): string {
  if (role === 'long') {
    return site.named;
  }
  return `${site.at}.${role === 'short' ? 'short' : 'polarity'}`;
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
  if (!name || name.startsWith('-') || /[\s=]/u.test(name)) {
    throw new DeclarationError(declaredName, {
      correction: 'Use a nonempty name without a leading hyphen, whitespace, or "=".',
      findings,
      sentence: `Option name ${quoted(name)} is invalid.`,
    });
  }
}

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
        siteFinding(site, spellingMark(site, option.role)),
      ),
      sentence: `Option spelling ${quoted(spelling)} is used by both ${quoted(existing.option.name)} and ${quoted(claim.option.name)}.`,
    });
  }
  claims.set(spelling, claim);
}

/**
 * One Boolean option's value for one invocation: the value the parser consumed, or the value its
 * declared polarity gives an absent option. A negative-only option is absent as `true`, because its
 * one spelling turns the value off. Every scope reads it here, so a plugin option and a validated
 * declaration answer the same rule.
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
      if (config.type === 'string' || config.polarity !== 'negative') {
        addSpelling(claims, `--${name}`, { option: { ...positive, role: 'long' }, site });
      }
      if (
        config.type === 'boolean' &&
        (config.polarity === 'both' || config.polarity === 'negative')
      ) {
        addSpelling(claims, `--no-${name}`, {
          option: { name, role: 'negative', type: 'boolean', value: false },
          site,
        });
      }
    }
    if (config.short !== undefined) {
      addSpelling(claims, `-${config.short}`, { option: { ...positive, role: 'short' }, site });
    }
  }
  return new Map([...claims].map(([spelling, { option }]) => [spelling, option]));
}

/**
 * Whether a token reads as an option: it starts with a hyphen. Routing stops at one, and a
 * separate value is never one. The parser and `locate` read each token through this rule.
 */
export function isOptionToken(token: string): boolean {
  return token.startsWith('-');
}

/** A long option token and the inline value it carries after its first `=`, if any. */
export interface LongToken {
  spelling: string;
  inline: string | undefined;
}

/**
 * A token that starts with `--` split at its first `=` into the spelling and the inline value, or
 * `undefined` for any other token. The parser and `locate` split long tokens through this rule.
 */
export function longToken(token: string): LongToken | undefined {
  if (!token.startsWith('--')) {
    return undefined;
  }
  const equals = token.indexOf('=');
  return equals === -1
    ? { inline: undefined, spelling: token }
    : { inline: token.slice(equals + 1), spelling: token.slice(0, equals) };
}

function lookup(spellings: ReadonlyMap<string, OptionSpelling>, spelling: string) {
  const option = spellings.get(spelling);
  if (!option) {
    throw new UnknownOptionError(spelling);
  }
  return option;
}

/**
 * The name of the string option one long spelling names in a table, which takes its value after
 * `=`, or `undefined` for a Boolean, negative, short, or unknown spelling.
 */
export function longStringOption(
  spellings: ReadonlyMap<string, OptionSpelling>,
  spelling: string,
): string | undefined {
  const option = spellings.get(spelling);
  return option?.type === 'string' && option.role === 'long' ? option.name : undefined;
}

/**
 * A string option whose value the next token supplies, where the tokens ended first. A complete
 * invocation reports it as a missing value; a partial one reads the next word as that value.
 */
export interface AwaitingValue {
  name: string;
  spelling: string;
}

/** What reading one option token did: it stood alone, took the next token, or ran out of tokens. */
type OptionReading = 'alone' | 'next' | AwaitingValue;

/** One option name a token newly supplied, with the index of that token in the list read. */
export interface SuppliedOption {
  name: string;
  token: number;
}

function acceptValue({
  option,
  spelling,
  values,
  next,
  inline,
}: {
  option: OptionSpelling;
  spelling: string;
  values: OptionValues;
  next: string | undefined;
  inline: string | undefined;
}): OptionReading {
  const repeatable = option.type === 'string' && option.multiple;
  if (!repeatable && (values.strings.has(option.name) || values.booleans.has(option.name))) {
    throw new RepeatedOptionError(spelling);
  }
  // A repeatable option records its last occurrence, because each one overwrites the entry.
  values.spellings.set(option.name, spelling);
  if (option.type === 'boolean') {
    if (inline !== undefined) {
      throw new UnexpectedValueError(spelling, inline);
    }
    values.booleans.set(option.name, option.value);
    return 'alone';
  }
  const value = inline ?? next;
  if (value === undefined) {
    return { name: option.name, spelling };
  }
  if (inline === undefined && isOptionToken(value)) {
    throw new MissingValueError(spelling);
  }
  if (repeatable) {
    const collected = values.lists.get(option.name) ?? [];
    collected.push(value);
    values.lists.set(option.name, collected);
  } else {
    values.strings.set(option.name, value);
  }
  return inline === undefined ? 'next' : 'alone';
}

function parseOption(
  spellings: ReadonlyMap<string, OptionSpelling>,
  input: { token: string; next: string | undefined },
  values: OptionValues,
): OptionReading {
  const { token, next } = input;
  const long = longToken(token);
  if (long) {
    const { inline, spelling } = long;
    return acceptValue({ inline, next, option: lookup(spellings, spelling), spelling, values });
  }
  if (token === '-') {
    lookup(spellings, token);
  }
  for (let index = 1; index < token.length; index += 1) {
    const spelling = `-${token[index]}`;
    const option = lookup(spellings, spelling);
    const suffix = token.slice(index + 1);
    if (option.type === 'string' && suffix !== '') {
      throw new ShortGroupError({ reason: 'value-position', token: spelling });
    }
    const inline = suffix.startsWith('=') ? suffix.slice(1) : undefined;
    const reading = acceptValue({ inline, next, option, spelling, values });
    if (reading !== 'alone') {
      return reading;
    }
  }
  return 'alone';
}

/** The state one scan carries from token to token, whichever scope it reads. */
interface ScanState {
  awaiting: AwaitingValue | undefined;
  supplied: SuppliedOption[];
  values: OptionValues;
}

/**
 * Reads one option token into the scan and answers whether it took the next token too. The names
 * it newly supplied join `supplied` in the order the values map first recorded them, so a repeated
 * option keeps its first position.
 */
function readOption(
  spellings: ReadonlyMap<string, OptionSpelling>,
  input: { index: number; next: string | undefined; token: string },
  state: ScanState,
): boolean {
  const known = state.values.spellings.size;
  const reading = parseOption(spellings, input, state.values);
  for (const name of [...state.values.spellings.keys()].slice(known)) {
    state.supplied.push({ name, token: input.index });
  }
  if (typeof reading === 'object') {
    state.awaiting = reading;
  }
  return reading === 'next';
}

/**
 * A hyphen token belongs to the globals when its long spelling or every short letter does. The
 * pre-scan reads the globals alone, so a letter it does not own is only "not a global option".
 * The scan stops at a global value option, because the letters after it may be the value the
 * operator meant to pass: the token then belongs to the globals, and parsing reports the
 * value-position fault that names that option alone.
 */
function isGlobalToken(spellings: ReadonlyMap<string, OptionSpelling>, token: string) {
  const long = longToken(token);
  if (long) {
    return spellings.has(long.spelling);
  }
  const group = token.slice(1).split('=')[0] ?? '';
  let global = '';
  let other = '';
  for (let index = 0; index < group.length; index += 1) {
    const letter = group.charAt(index);
    const option = spellings.get(`-${letter}`);
    if (option) {
      global = global === '' ? letter : global;
      if (option.type === 'string') {
        break;
      }
    } else {
      other = other === '' ? letter : other;
    }
  }
  if (global === '') {
    return false;
  }
  if (other !== '') {
    throw new ShortGroupError({ global, other, reason: 'mixed-scope', token });
  }
  return true;
}

/**
 * The pre-scan's reading of a token list that may stop short. `positions` holds the index in
 * `tokens` of each `rest` token, and `awaiting` is the global option the last token left without
 * its value.
 */
export interface GlobalScan {
  awaiting: AwaitingValue | undefined;
  positions: number[];
  rest: string[];
  supplied: SuppliedOption[];
  values: OptionValues;
}

/** Consumes global options anywhere before the passthrough delimiter and leaves the rest routable. */
export function scanGlobals(
  spellings: ReadonlyMap<string, OptionSpelling>,
  tokens: readonly string[],
): GlobalScan {
  const state: ScanState = { awaiting: undefined, supplied: [], values: emptyValues() };
  const rest: string[] = [];
  const positions: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (token === '--') {
      // One push per token, because a spread call would overflow the stack on a long list.
      for (const [offset, tail] of tokens.slice(index).entries()) {
        rest.push(tail);
        positions.push(index + offset);
      }
      break;
    }
    if (!isOptionToken(token) || !isGlobalToken(spellings, token)) {
      rest.push(token);
      positions.push(index);
    } else if (readOption(spellings, { index, next: tokens[index + 1], token }, state)) {
      index += 1;
    }
  }
  return { ...state, positions, rest };
}

/** The pre-scan of a complete invocation, where a global still waiting for its value is a fault. */
export function extractGlobals(
  spellings: ReadonlyMap<string, OptionSpelling>,
  tokens: readonly string[],
) {
  const { awaiting, rest, values } = scanGlobals(spellings, tokens);
  if (awaiting) {
    throw new MissingValueError(awaiting.spelling);
  }
  return { rest, values };
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

/**
 * One Command's reading of its own tokens, which may stop short. `delimited` says a bare `--` was
 * read, and `awaiting` is the option the last token left without its value.
 */
export interface InputScan {
  awaiting: AwaitingValue | undefined;
  delimited: boolean;
  options: OptionValues;
  passthrough: string[];
  positionals: string[];
  supplied: SuppliedOption[];
}

/** Reads one Command's tokens into options, positionals, and the passthrough tail. */
export function scanInputs(
  spellings: ReadonlyMap<string, OptionSpelling>,
  tokens: readonly string[],
): InputScan {
  const state: ScanState = { awaiting: undefined, supplied: [], values: emptyValues() };
  const positionals: string[] = [];
  const read = (passthrough: string[], delimited: boolean): InputScan => ({
    awaiting: state.awaiting,
    delimited,
    options: state.values,
    passthrough,
    positionals,
    supplied: state.supplied,
  });
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (token === '--') {
      return read(tokens.slice(index + 1), true);
    }
    if (!isOptionToken(token)) {
      positionals.push(token);
    } else if (readOption(spellings, { index, next: tokens[index + 1], token }, state)) {
      index += 1;
    }
  }
  return read([], false);
}

/** Parses a complete invocation's local tokens, where a waiting option is a missing value. */
export function parseInputs(
  spellings: ReadonlyMap<string, OptionSpelling>,
  tokens: readonly string[],
) {
  const { awaiting, options, passthrough, positionals } = scanInputs(spellings, tokens);
  if (awaiting) {
    throw new MissingValueError(awaiting.spelling);
  }
  return { options, passthrough, positionals };
}
