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

/**
 * An option as a sentence names it, quoted and escaped: `spelling` is its spelling, such as
 * `--fields`, or its declared name in an invocation by name, which types no spelling.
 */
function shownOption(spelling: string): string {
  return `"${escapeControlCharacters(spelling)}"`;
}

/** The views, escaped, joined with `and`. */
function viewsAnd(views: readonly string[]): string {
  return views.map(escapeControlCharacters).join(' and ');
}

/** The views, escaped, joined with `or`. */
function viewsOr(views: readonly string[]): string {
  return views.map(escapeControlCharacters).join(' or ');
}

/**
 * `--fields` under a view the formatter did not append. The sentence names the formatter's views
 * this Command has, `views`, and corrects with them alone, so it never offers a view the Command
 * lacks; with none, it says only to remove the option. `format` names the option that selects a
 * view, by spelling or by declared name as `spelling` names `--fields`.
 */
function fieldsNeedEncoding(spelling: string, format: string, views: readonly string[]): string {
  if (views.length === EMPTY) {
    return `Option ${shownOption(spelling)} applies only to output the formatter provides, and the formatter provides none here. Remove the option.`;
  }
  return `Option ${shownOption(spelling)} applies only to the ${viewsAnd(views)} output the formatter provides. Remove the option, or select ${viewsOr(views)} with ${shownOption(format)}.`;
}

/** The opening of the sentence below, naming the fields the output does not hold. */
function namedFields(spelling: string, unknown: readonly string[]): string {
  return `Option ${shownOption(spelling)} names ${shownFields(unknown)}`;
}

/** `--fields` naming keys the output does not hold, with the keys it does hold. */
function unknownFields(
  spelling: string,
  unknown: readonly string[],
  available: readonly string[],
): string {
  return `${namedFields(spelling, unknown)}, which the output does not hold. Supply fields from ${shownNames(available)}.`;
}

/** `--fields` naming keys of an output that holds no keys at all. */
function noFieldsHeld(spelling: string, unknown: readonly string[]): string {
  return `${namedFields(spelling, unknown)}, but the output holds no fields. Remove the option.`;
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
function fieldsNeedObjects(spelling: string, kind: FieldlessKind): string {
  return `Option ${shownOption(spelling)} selects fields of objects, but the output holds ${fieldlessKind(kind)}. Remove the option.`;
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
