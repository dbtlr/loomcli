import {
  DeclarationError,
  MissingValueError,
  RepeatedOptionError,
  ShortGroupError,
  UnexpectedValueError,
  UnknownOptionError,
} from './errors.js';
import type { OptionConfig } from './types.js';

export interface OptionDeclaration {
  name: string;
  config: OptionConfig;
}

export interface OptionValues {
  strings: Map<string, string>;
  lists: Map<string, string[]>;
  booleans: Map<string, boolean>;
}

/** Every parsed value lands in one of these maps; `lists` holds the repeated string options. */
function emptyValues(): OptionValues {
  return { booleans: new Map(), lists: new Map(), strings: new Map() };
}

/** Which accepted form a table entry is. The table owns the convention, so readers never re-derive it. */
type SpellingRole = 'long' | 'negative' | 'short';

type OptionForm =
  | { type: 'string'; name: string; multiple: boolean }
  | { type: 'boolean'; name: string; value: boolean };

type OptionSpelling = OptionForm & { role: SpellingRole };

function validateDeclaration({ name, config }: OptionDeclaration) {
  if (typeof name !== 'string') {
    throw new DeclarationError('Option names must be strings. Supply a string name.');
  }
  if (!name || name.startsWith('-') || /[\s=]/u.test(name)) {
    throw new DeclarationError(
      `Option name "${name}" is invalid. Use a nonempty name without a leading hyphen, whitespace, or "=".`,
    );
  }
  if (!['string', 'boolean'].includes(config.type)) {
    throw new DeclarationError(`Option "${name}" has an invalid type. Use "string" or "boolean".`);
  }
  if (
    config.short !== undefined &&
    (typeof config.short !== 'string' || !/^[A-Za-z]$/u.test(config.short))
  ) {
    throw new DeclarationError(`Option "${name}" requires a short alias of one ASCII letter.`);
  }
  if (config.shortOnly !== undefined && typeof config.shortOnly !== 'boolean') {
    throw new DeclarationError(`Option "${name}" shortOnly must be Boolean. Use true or false.`);
  }
  if (config.shortOnly && config.short === undefined) {
    throw new DeclarationError(`Option "${name}" with shortOnly requires a short alias.`);
  }
  if (config.type === 'boolean' && config.multiple !== undefined) {
    throw new DeclarationError(
      `Option "${name}" is a boolean option and declares multiple. Remove multiple or declare a string option.`,
    );
  }
  if (config.multiple !== undefined && typeof config.multiple !== 'boolean') {
    throw new DeclarationError(`Option "${name}" multiple must be Boolean. Use true or false.`);
  }
  if (config.polarity !== undefined) {
    if (config.type !== 'boolean') {
      throw new DeclarationError(
        `Option "${name}" declares polarity but is not Boolean. Remove polarity or use type "boolean".`,
      );
    }
    if (!['positive', 'both', 'negative'].includes(config.polarity)) {
      throw new DeclarationError(
        `Option "${name}" has an invalid polarity. Use "positive", "both", or "negative".`,
      );
    }
    if (config.polarity === 'both' && config.shortOnly) {
      throw new DeclarationError(
        `Option "${name}" cannot express both polarities with shortOnly. Enable long forms or select one polarity.`,
      );
    }
  }
}

function addSpelling(
  spellings: Map<string, OptionSpelling>,
  spelling: string,
  option: OptionSpelling,
) {
  const existing = spellings.get(spelling);
  if (existing) {
    throw new DeclarationError(
      `Option spelling "${spelling}" is used by both "${existing.name}" and "${option.name}". Change one declaration.`,
    );
  }
  spellings.set(spelling, option);
}

export function compileOptions(declarations: readonly OptionDeclaration[], subject: string) {
  const spellings = new Map<string, OptionSpelling>();
  const names = new Set<string>();
  for (const { name, config } of declarations) {
    validateDeclaration({ config, name });
    if (names.has(name)) {
      throw new DeclarationError(
        `Option "${name}" is declared more than once on ${subject}. Remove or rename the duplicate.`,
      );
    }
    names.add(name);
    const positive: OptionForm =
      config.type === 'string'
        ? { multiple: config.multiple === true, name, type: 'string' }
        : { name, type: 'boolean', value: config.polarity !== 'negative' };
    if (!config.shortOnly) {
      if (config.type === 'string' || config.polarity !== 'negative') {
        addSpelling(spellings, `--${name}`, { ...positive, role: 'long' });
      }
      if (
        config.type === 'boolean' &&
        (config.polarity === 'both' || config.polarity === 'negative')
      ) {
        addSpelling(spellings, `--no-${name}`, {
          name,
          role: 'negative',
          type: 'boolean',
          value: false,
        });
      }
    }
    if (config.short !== undefined) {
      addSpelling(spellings, `-${config.short}`, { ...positive, role: 'short' });
    }
  }
  return spellings;
}

function lookup(spellings: ReadonlyMap<string, OptionSpelling>, spelling: string) {
  const option = spellings.get(spelling);
  if (!option) {
    throw new UnknownOptionError(spelling);
  }
  return option;
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
}) {
  const repeatable = option.type === 'string' && option.multiple;
  if (!repeatable && (values.strings.has(option.name) || values.booleans.has(option.name))) {
    throw new RepeatedOptionError(spelling);
  }
  if (option.type === 'boolean') {
    if (inline !== undefined) {
      throw new UnexpectedValueError(spelling, inline);
    }
    values.booleans.set(option.name, option.value);
    return false;
  }
  const value = inline ?? next;
  if (value === undefined || (inline === undefined && value.startsWith('-'))) {
    throw new MissingValueError(spelling);
  }
  if (repeatable) {
    const collected = values.lists.get(option.name) ?? [];
    collected.push(value);
    values.lists.set(option.name, collected);
  } else {
    values.strings.set(option.name, value);
  }
  return inline === undefined;
}

function parseOption(
  spellings: ReadonlyMap<string, OptionSpelling>,
  input: { token: string; next: string | undefined },
  values: OptionValues,
) {
  const { token, next } = input;
  if (token.startsWith('--')) {
    const equals = token.indexOf('=');
    const spelling = equals === -1 ? token : token.slice(0, equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
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
    if (acceptValue({ inline, next, option, spelling, values })) {
      return true;
    }
  }
  return false;
}

/**
 * A hyphen token belongs to the globals when its long spelling or every short letter does. The
 * pre-scan reads the globals alone, so a letter it does not own is only "not a global option".
 */
function isGlobalToken(spellings: ReadonlyMap<string, OptionSpelling>, token: string) {
  if (token.startsWith('--')) {
    const equals = token.indexOf('=');
    return spellings.has(equals === -1 ? token : token.slice(0, equals));
  }
  const group = token.slice(1).split('=')[0] ?? '';
  let global = '';
  let other = '';
  for (let index = 0; index < group.length; index += 1) {
    const letter = group.charAt(index);
    if (spellings.has(`-${letter}`)) {
      global = global === '' ? letter : global;
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

/** Consumes global options anywhere before the passthrough delimiter and leaves the rest routable. */
export function extractGlobals(
  spellings: ReadonlyMap<string, OptionSpelling>,
  tokens: readonly string[],
) {
  const values = emptyValues();
  const rest: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (token === '--') {
      rest.push(...tokens.slice(index));
      return { rest, values };
    }
    if (!token.startsWith('-') || !isGlobalToken(spellings, token)) {
      rest.push(token);
    } else if (parseOption(spellings, { next: tokens[index + 1], token }, values)) {
      index += 1;
    }
  }
  return { rest, values };
}

/** Global and local keys never overlap, so one merged view feeds a single validation pass. */
export function mergeValues(globals: OptionValues, locals: OptionValues): OptionValues {
  return {
    booleans: new Map([...globals.booleans, ...locals.booleans]),
    lists: new Map([...globals.lists, ...locals.lists]),
    strings: new Map([...globals.strings, ...locals.strings]),
  };
}

export function parseInputs(
  spellings: ReadonlyMap<string, OptionSpelling>,
  tokens: readonly string[],
) {
  const options = emptyValues();
  const positionals: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (token === '--') {
      return { options, passthrough: tokens.slice(index + 1), positionals };
    }
    if (!token.startsWith('-')) {
      positionals.push(token);
    } else if (parseOption(spellings, { next: tokens[index + 1], token }, options)) {
      index += 1;
    }
  }
  return { options, passthrough: [], positionals };
}
