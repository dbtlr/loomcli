import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault, readOptions } from './faults.js';
import { reject } from './issues.js';

interface TextOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  message?: string;
}

/** The length rule for the effective bounds: a test and the sentence it fails with. */
interface LengthRule {
  fits: (count: number) => boolean;
  sentence: string;
}

const noLength = 0;
const oneCharacter = 1;
const defaultMinLength = 1;

function lengthOf(name: 'minLength' | 'maxLength', value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < noLength) {
    throw fault(
      `text() ${name} is not a non-negative safe integer. Supply a whole number of 0 or more.`,
    );
  }
  return value;
}

/** Faults on a pattern flag other than `u`, which JSON Schema has no way to state. */
function checkFlags(pattern: RegExp): void {
  const others = pattern.flags.replace('u', '');
  if (others !== '') {
    const noun = others.length === oneCharacter ? 'flag' : 'flags';
    throw fault(
      `text() pattern carries the ${noun} ${others}. Supply a pattern with no flag other than u.`,
    );
  }
}

/** The author's pattern recompiled under the `u` flag, as JSON Schema reads a `pattern`. */
function patternOf(value: unknown): RegExp | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(value instanceof RegExp)) {
    throw fault('text() pattern is not a RegExp. Supply a regular expression literal.');
  }
  checkFlags(value);
  try {
    return new RegExp(value.source, 'u');
  } catch {
    throw fault(
      'text() pattern does not compile under the u flag. Supply a pattern that is valid with the u flag.',
    );
  }
}

function messageOf(value: unknown, pattern: RegExp | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value === '') {
    throw fault(
      'text() message is not a nonempty string. Supply one sentence that states the expectation.',
    );
  }
  if (pattern === undefined) {
    throw fault(
      'text() message has no pattern to describe. Supply a pattern or leave out message.',
    );
  }
  return value;
}

function characters(count: number): string {
  return count === oneCharacter ? '1 character' : `${count} characters`;
}

/** The sentence for bounds with a `maxLength`, where `min` is `minLength` after its default. */
function boundedSentence(min: number, max: number): string {
  if (min === max) {
    return `Expected exactly ${characters(min)}.`;
  }
  if (min === noLength) {
    return `Expected at most ${characters(max)}.`;
  }
  return `Expected from ${min} through ${max} characters.`;
}

/** The length rule for the effective bounds, or undefined when every length passes. */
function lengthRule(min: number, max: number | undefined): LengthRule | undefined {
  if (max !== undefined) {
    return { fits: (count) => count >= min && count <= max, sentence: boundedSentence(min, max) };
  }
  if (min === noLength) {
    return undefined;
  }
  const sentence =
    min === oneCharacter ? 'Expected a nonempty value.' : `Expected at least ${characters(min)}.`;
  return { fits: (count) => count >= min, sentence };
}

/**
 * The token's length in Unicode code points, as JSON Schema counts it.
 * Under the `u` flag a dot matches one code point, a lone surrogate included, so replacing each
 * match with one code unit leaves a string as long as the count.
 */
function codePoints(raw: string): number {
  return raw.replaceAll(/./gsu, '.').length;
}

/** A string whose code-point length is within bounds and which the pattern matches, if any. */
function text(options?: TextOptions): Validator<string> {
  const declared = readOptions('text', options);
  const minLength = lengthOf('minLength', declared.minLength) ?? defaultMinLength;
  const maxLength = lengthOf('maxLength', declared.maxLength);
  if (maxLength !== undefined && minLength > maxLength) {
    throw fault(
      `text() minLength ${minLength} is above maxLength ${maxLength}. Supply a minLength at or below maxLength.`,
    );
  }
  const pattern = patternOf(declared.pattern);
  const patternSentence =
    messageOf(declared.message, pattern) ?? 'Expected a value that matches the required pattern.';
  const length = lengthRule(minLength, maxLength);
  return createValidator({
    inputSchema: {
      minLength,
      type: 'string',
      ...(maxLength === undefined ? {} : { maxLength }),
      ...(pattern === undefined ? {} : { pattern: pattern.source }),
    },
    parse: (raw): ParseResult<string> => {
      if (length !== undefined && !length.fits(codePoints(raw))) {
        return reject(length.sentence);
      }
      if (pattern !== undefined && !pattern.test(raw)) {
        return reject(patternSentence);
      }
      return { value: raw };
    },
  });
}

export { text };
export type { TextOptions };
