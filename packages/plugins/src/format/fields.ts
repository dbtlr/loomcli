/**
 * The result transforms `--fields` sets: each keeps the named top-level keys of an object, in the
 * order the operator named them, and fails the run for a field the output does not hold or a value
 * that holds no fields. The value form reads a whole value, an object or an array of objects; the
 * row form reads one row at a time and judges the named fields against the first row alone.
 */
import { InputError, phrasedIssue } from '@loomcli/core';
import type { Phrase, ResultTransform } from '@loomcli/core';

import { isRecord } from '../plain-data.js';
import type { FieldlessKind } from './messages.js';
import { splitFields } from './names.js';
import { formatPhrase } from './phrases.js';

/** The length of a list that holds nothing. */
const EMPTY = 0;

/**
 * The fields every occurrence of `--fields` names, in order, each name once. The option is
 * hook-declared, so its value is unknown to the types, and a list of strings is what it holds.
 */
function requestedFields(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names = value.filter((each) => typeof each === 'string').flatMap(splitFields);
  return [...new Set(names)];
}

/**
 * How a `--fields` failure names the option and `--format`: by their spellings on an argv run, and
 * by their declared names in an invocation by name, which types no spelling, as core's own
 * problems name an option there.
 */
interface Spellings {
  readonly fields: string;
  readonly format: string;
}

/** The spellings a run's failures name the two options by. */
function spellingsOf(invokedBy: 'argv' | 'name'): Spellings {
  return invokedBy === 'name'
    ? { fields: 'fields', format: 'format' }
    : { fields: '--fields', format: '--format' };
}

/** The usage failure `--fields` raises, with the sentence as the option's one issue. */
function fieldsFailure(sentence: Phrase, spellings: Spellings): InputError {
  return new InputError(sentence, [
    {
      input: { global: false, kind: 'option', name: 'fields' },
      issues: [phrasedIssue(sentence)],
      reason: 'invalid',
      spelling: spellings.fields,
    },
  ]);
}

/** The kind of a value that holds no fields, as the failure names it. */
function kindOf(value: unknown): FieldlessKind {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean': {
      return 'boolean';
    }
    case 'number': {
      return 'number';
    }
    case 'string': {
      return 'string';
    }
    default: {
      return 'other';
    }
  }
}

/** The object one value is, or the failure that says what it is instead. */
function objectOf(value: unknown, spellings: Spellings): Record<string, unknown> {
  if (!isRecord(value)) {
    throw fieldsFailure(
      formatPhrase('fieldsNeedObjects', spellings.fields, kindOf(value)),
      spellings,
    );
  }
  return value;
}

/** Fails when a named field is in no key of `held`, listing the keys `held` holds. */
function judge(fields: readonly string[], held: ReadonlySet<string>, spellings: Spellings): void {
  const unknown = fields.filter((field) => !held.has(field));
  if (unknown.length === EMPTY) {
    return;
  }
  throw fieldsFailure(
    held.size === EMPTY
      ? formatPhrase('noFieldsHeld', spellings.fields, unknown)
      : formatPhrase('unknownFields', spellings.fields, unknown, [...held]),
    spellings,
  );
}

/** The named fields of one object, in the order named; a field it lacks is left out. */
function pick(fields: readonly string[], record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(record, field)).map((field) => [field, record[field]]),
  );
}

/**
 * The transform over a value result: an object keeps the named fields, and an array keeps them in
 * each element, judged against the keys any element holds. An empty array stays empty.
 */
function valueFields(fields: readonly string[], spellings: Spellings): ResultTransform {
  return (value) => {
    if (!Array.isArray(value)) {
      const record = objectOf(value, spellings);
      judge(fields, new Set(Object.keys(record)), spellings);
      return pick(fields, record);
    }
    const records = value.map((element) => objectOf(element, spellings));
    if (records.length > EMPTY) {
      judge(fields, new Set(records.flatMap((record) => Object.keys(record))), spellings);
    }
    return records.map((record) => pick(fields, record));
  };
}

/**
 * The transform over a rows result, which core calls with each row as it arrives: the first row
 * decides which fields are known, so a later row that lacks one leaves it out.
 */
function rowFields(fields: readonly string[], spellings: Spellings): ResultTransform {
  let judged = false;
  return (row) => {
    const record = objectOf(row, spellings);
    if (!judged) {
      judge(fields, new Set(Object.keys(record)), spellings);
      judged = true;
    }
    return pick(fields, record);
  };
}

export { fieldsFailure, requestedFields, rowFields, spellingsOf, valueFields };
export type { Spellings };
