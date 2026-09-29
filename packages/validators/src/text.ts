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
import type { FactoryCall } from './faults.js';
import { reject } from './issues.js';
import { boundsOrder, boundValue, patternMessage, textPattern } from './rules.js';

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

/** The `text()` call a fault marks one key of. */
function textAt(call: FactoryCall, key: string) {
  return { ...call, mark: `0.${key}` };
}

function lengthOf(
  call: FactoryCall,
  name: 'minLength' | 'maxLength',
  value: unknown,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < noLength) {
    throw fault(boundValue, textAt(call, name), {
      correction: 'Supply a whole number of 0 or more.',
      sentence: `text() ${name} is not a non-negative safe integer.`,
    });
  }
  return value;
}

/** Faults on a pattern flag other than `u`, which JSON Schema has no way to state. */
function checkFlags(call: FactoryCall, pattern: RegExp): void {
  const others = pattern.flags.replace('u', '');
  if (others !== '') {
    const noun = others.length === oneCharacter ? 'flag' : 'flags';
    throw fault(textPattern, textAt(call, 'pattern'), {
      correction: 'Supply a pattern with no flag other than u.',
      sentence: `text() pattern carries the ${noun} ${others}.`,
    });
  }
}

/** The author's pattern recompiled under the `u` flag, as JSON Schema reads a `pattern`. */
function patternOf(call: FactoryCall, value: unknown): RegExp | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(value instanceof RegExp)) {
    throw fault(textPattern, textAt(call, 'pattern'), {
      correction: 'Supply a regular expression literal.',
      sentence: 'text() pattern is not a RegExp.',
    });
  }
  checkFlags(call, value);
  try {
    return new RegExp(value.source, 'u');
  } catch {
    throw fault(textPattern, textAt(call, 'pattern'), {
      correction: 'Supply a pattern that is valid with the u flag.',
      sentence: 'text() pattern does not compile under the u flag.',
    });
  }
}

function messageOf(call: FactoryCall, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value === '') {
    throw fault(patternMessage, textAt(call, 'message'), {
      correction: 'Supply one sentence that states the expectation.',
      sentence: 'text() message is not a nonempty string.',
    });
  }
  return value;
}

/** The pattern rule, or undefined without a pattern; a pattern and a message each need the other. */
function patternRule(
  call: FactoryCall,
  pattern: RegExp | undefined,
  message: string | undefined,
): PatternRule | undefined {
  if (pattern === undefined) {
    if (message !== undefined) {
      throw fault(patternMessage, textAt(call, 'message'), {
        correction: 'Supply a pattern or leave out message.',
        sentence: 'text() message has no pattern to describe.',
      });
    }
    return undefined;
  }
  if (message === undefined) {
    throw fault(patternMessage, textAt(call, 'pattern'), {
      correction: 'Supply a message that states what the pattern accepts.',
      sentence: 'text() pattern has no message to describe it.',
    });
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
  const call = { arguments: [options], factory: 'text' };
  const minLength = lengthOf(call, 'minLength', declared.minLength) ?? defaultMinLength;
  const maxLength = lengthOf(call, 'maxLength', declared.maxLength);
  if (maxLength !== undefined && minLength > maxLength) {
    // A minLength left to its default has no key to mark, so the maxLength below it is marked.
    const key = declared.minLength === undefined ? 'maxLength' : 'minLength';
    throw fault(boundsOrder, textAt(call, key), {
      correction: 'Supply a minLength at or below maxLength.',
      sentence: `text() minLength ${minLength} is above maxLength ${maxLength}.`,
    });
  }
  const matching = patternRule(
    call,
    patternOf(call, declared.pattern),
    messageOf(call, declared.message),
  );
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
