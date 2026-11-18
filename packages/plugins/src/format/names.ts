import { createValidator } from '@loomcli/validators';

import { fieldsIssue, formatIssue } from './messages.js';

/** The unadvertised alias `--format` accepts for `jsonl`, unless a record names it directly. */
const ndjsonAlias = 'ndjson';

/** The separator `--fields` splits each of its values at, as ADR-0127's delimiter splits. */
const fieldSeparator = ',';

/**
 * The names one `--fields` value holds: the value split at each comma, untrimmed, with an empty
 * name kept in its place, so the validator rejects a stray comma.
 */
export function splitFields(value: string): string[] {
  return value.split(fieldSeparator);
}

/**
 * The validator the format hook attaches to `--format`: a string that names one of `names`, with
 * `ndjson` accepted as an alias of `jsonl` unless the record already names `ndjson` itself.
 * The alias is mapped ahead of the match, so the input schema the option publishes carries the view
 * names alone and the unadvertised alias stays out of it.
 */
export function formatName(names: readonly string[]) {
  const issue = formatIssue(names);
  const aliased = !names.includes(ndjsonAlias);
  return createValidator({
    inputSchema: { type: 'string', enum: [...names] },
    parse: (raw) => {
      const name = aliased && raw === ndjsonAlias ? 'jsonl' : raw;
      const match = names.find((each) => each === name);
      return match === undefined ? { issues: [{ message: issue }] } : { value: match };
    },
  });
}

/**
 * The validator the format hook attaches to `--fields`: one value, a comma list of field names.
 * An empty name, from a stray comma or an empty value, is rejected; the value passes unchanged, and
 * the middleware splits it.
 */
export function fieldList() {
  return createValidator({
    inputSchema: { type: 'string' },
    parse: (raw) =>
      splitFields(raw).includes('') ? { issues: [{ message: fieldsIssue }] } : { value: raw },
  });
}
