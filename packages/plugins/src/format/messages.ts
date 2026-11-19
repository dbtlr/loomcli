/*
 * The operator sentences of the format plugin, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** The length of a view list with no formatter-appended view. */
const EMPTY = 0;

const shownNames = (names: readonly string[]): string =>
  names.map(escapeControlCharacters).join(', ');

function formatIssue(names: readonly string[]): string {
  return `Supply one of ${shownNames(names)}.`;
}

/** The issue `--fields` reports for a value with an empty name, such as `name,` or `,`. */
const fieldsIssue = 'Supply field names separated by commas, such as name,size.';

/** The fields an operator named, each quoted and escaped, joined as a list. */
function shownFields(fields: readonly string[]): string {
  return fields.map((field) => `"${escapeControlCharacters(field)}"`).join(', ');
}

/** Only views appended by the formatter are valid corrections for `--fields`. */
function fieldsNeedEncoding(views: readonly string[]): string {
  if (views.length === EMPTY) {
    return 'Option "--fields" applies to the json and jsonl output the formatter provides. Remove --fields.';
  }
  return `Option "--fields" applies to the json and jsonl output the formatter provides. Remove --fields, or select output the formatter provides with ${shownFormats(views)}.`;
}

/** Each view as the `--format` spelling that selects it, joined with `or`. */
function shownFormats(views: readonly string[]): string {
  return views.map((view) => `--format ${escapeControlCharacters(view)}`).join(' or ');
}

/** The opening of the sentence below, naming the fields the output does not hold. */
function namedFields(unknown: readonly string[]): string {
  return `Option "--fields" names ${shownFields(unknown)}`;
}

/** `--fields` naming keys the output does not hold, with the keys it does hold. */
function unknownFields(unknown: readonly string[], available: readonly string[]): string {
  return `${namedFields(unknown)}, which the output does not hold. Supply fields from ${shownNames(available)}.`;
}

/** `--fields` naming keys of an output that holds no keys at all. */
function noFieldsHeld(unknown: readonly string[]): string {
  return `${namedFields(unknown)}, but the output holds no fields. Remove --fields.`;
}

/** The kinds of JSON value that hold no fields, as the sentence below names them. */
type FieldlessKind = 'array' | 'boolean' | 'null' | 'number' | 'other' | 'string';

/** How the sentence below names each kind. */
function fieldlessKind(kind: FieldlessKind): string {
  switch (kind) {
    case 'array': {
      return 'an array';
    }
    case 'boolean': {
      return 'a Boolean';
    }
    case 'null': {
      return 'null';
    }
    case 'number': {
      return 'a number';
    }
    case 'string': {
      return 'a string';
    }
    default: {
      return 'a value that is not an object';
    }
  }
}

/** `--fields` over a value, an element, or a row that is not an object. */
function fieldsNeedObjects(kind: FieldlessKind): string {
  return `Option "--fields" selects fields of objects, but the output holds ${fieldlessKind(kind)}. Remove --fields.`;
}

export {
  fieldsIssue,
  fieldsNeedEncoding,
  fieldsNeedObjects,
  formatIssue,
  noFieldsHeld,
  unknownFields,
};
export type { FieldlessKind };
