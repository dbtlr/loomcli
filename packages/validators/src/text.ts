import type { StandardSchemaV1 } from '@loomcli/core';

import {
  textExactLengthIssue,
  textLengthRangeIssue,
  textMaxLengthIssue,
  textMinLengthIssue,
  textNonemptyIssue,
  textPatternIssue,
} from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault, readOptions } from './faults.js';
import { reject } from './issues.js';

/**
 * The bounds on a token's length, and a pattern with the author's sentence for what it accepts.
 * Only the author can say what a pattern accepts, so `message` comes with `pattern` or not at all.
 */
type TextOptions = { minLength?: number; maxLength?: number } & (
  | { pattern?: undefined; message?: undefined }
  | { pattern: RegExp; message: string }
);

/** The length rule for the effective bounds: a test and the issue it fails with. */
interface LengthRule {
  fits: (count: number) => boolean;
  issue: StandardSchemaV1.Issue;
}

/** The pattern rule: the pattern under the `u` flag and the issue carrying the author's sentence. */
interface PatternRule {
  pattern: RegExp;
  issue: StandardSchemaV1.Issue;
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

function messageOf(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value === '') {
    throw fault(
      'text() message is not a nonempty string. Supply one sentence that states the expectation.',
    );
  }
  return value;
}

/** The pattern rule, or undefined without a pattern; a pattern and a message each need the other. */
function patternRule(
  pattern: RegExp | undefined,
  message: string | undefined,
): PatternRule | undefined {
  if (pattern === undefined) {
    if (message !== undefined) {
      throw fault(
        'text() message has no pattern to describe. Supply a pattern or leave out message.',
      );
    }
    return undefined;
  }
  if (message === undefined) {
    throw fault(
      'text() pattern has no message to describe it. Supply a message that states what the pattern accepts.',
    );
  }
  return { issue: textPatternIssue.issue({ message }), pattern };
}

/** The issue for bounds with a `maxLength`, where `min` is `minLength` after its default. */
function boundedIssue(min: number, max: number): StandardSchemaV1.Issue {
  if (min === max) {
    return textExactLengthIssue.issue({ length: min });
  }
  if (min === noLength) {
    return textMaxLengthIssue.issue({ max });
  }
  return textLengthRangeIssue.issue({ max, min });
}

/** The length rule for the effective bounds, or undefined when every length passes. */
function lengthRule(min: number, max: number | undefined): LengthRule | undefined {
  if (max !== undefined) {
    return { fits: (count) => count >= min && count <= max, issue: boundedIssue(min, max) };
  }
  if (min === noLength) {
    return undefined;
  }
  const issue =
    min === oneCharacter ? textNonemptyIssue.issue({}) : textMinLengthIssue.issue({ min });
  return { fits: (count) => count >= min, issue };
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
  const matching = patternRule(patternOf(declared.pattern), messageOf(declared.message));
  const length = lengthRule(minLength, maxLength);
  return createValidator({
    inputSchema: {
      type: 'string',
      minLength,
      ...(maxLength === undefined ? {} : { maxLength }),
      ...(matching === undefined ? {} : { pattern: matching.pattern.source }),
    },
    parse: (raw): ParseResult<string> => {
      if (length !== undefined && !length.fits(codePoints(raw))) {
        return reject(length.issue);
      }
      if (matching !== undefined && !matching.pattern.test(raw)) {
        return reject(matching.issue);
      }
      return { value: raw };
    },
  });
}

export { text };
export type { TextOptions };
