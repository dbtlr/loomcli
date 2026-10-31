/*
 * Acceptance plan for accepted values (docs/plugins/help.md#accepted-values).
 *
 * Accepted values are proven when public APIs alone produce these results under Node and Bun:
 *
 * - Example pages. `textstat --help` prints the `--metric` and `--format` rows shown above, and
 *   `jsonkit --help` prints `--format` with `One of: records, json, jsonl.`. The quoted pages in
 *   this document and the example applications' help and manifest goldens are re-pinned for the
 *   formatter's new description.
 * - Derived shapes. Fixture applications prove each shape the Derived rule names, a string `enum`,
 *   a single string `const`, and an `anyOf` of them, at every level it can appear: at the top level
 *   and as an `anyOf` member, on a single option, a multiple option, and a variadic argument. At
 *   each level, one case holds `type: 'string'` beside the shape and one holds an annotation such
 *   as `default`, and both still derive, and one holds a narrowing keyword, such as `pattern` or
 *   `minLength`, and derives nothing. Beside those, fixtures cover an `anyOf` mixing an `enum`
 *   member and a `const` member, flattened in order, with a value repeating across members printing
 *   once; a schema holding only a narrowing keyword such as `pattern`, with no closed set, deriving
 *   nothing; an `enum` beside a `const` or an `anyOf` at the same level deriving nothing; a
 *   repeated value printing once, an empty set and a nullable enum deriving nothing, eight values
 *   printing, nine deriving and help listing none, a set holding a number deriving nothing, and an
 *   argument row deriving from its schema.
 * - Authored. An `accepts` wins over a derived list, prints for an input with a `null` or pattern
 *   schema, prints on an argument row through `helpArgument`, and is never shown on a Boolean
 *   option.
 * - Text. A value that is empty or holds a space, a comma, a double quote, a line terminator, or a
 *   control character prints as its JSON string, a marker character in a value prints literally,
 *   and a row with no description starts its right cell with the sentence.
 */

import { expect, test } from 'vite-plus/test';

import { run as fixtureRun } from './fixtures/help-accepted.js';

/** The lines of one section of a page, from its title to the next blank line. */
function section(page: string, title: string): string[] {
  const lines = page.split('\n');
  const start = lines.indexOf(title);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.indexOf('');
  return end === -1 ? rest : rest.slice(0, end);
}

/** Each option row's right cell, keyed by the long spelling, or `null` for a row with none. */
function optionCells(page: string): Record<string, string | null> {
  const cells: Record<string, string | null> = {};
  for (const line of section(page, 'OPTIONS')) {
    const match = /^ {2}(?:-\S, | {4})(?<long>--[\w-]+)(?: <[\w-]+>)?(?: {2,}(?<right>.*))?$/u.exec(
      line,
    );
    if (match?.groups?.long !== undefined) {
      cells[match.groups.long] = match.groups.right ?? null;
    }
  }
  return cells;
}

async function pageOf(argv: string[]) {
  const result = await fixtureRun(argv);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return result.stdout;
}

test('a row derives its accepted values from a closed set of strings at every level, and nothing when a keyword could narrow it', async () => {
  expect(optionCells(await pageOf(['shapes', '--help']))).toEqual({
    '--all-annotations': 'One of: a.',
    '--any-annotated': 'One of: a, b.',
    '--any-consts': 'One of: a, b.',
    '--any-enum-annotated': 'One of: a.',
    '--any-enum-narrow': null,
    '--any-enum-typed': 'One of: a, b.',
    '--any-mixed': 'One of: a, b, c.',
    '--any-nested': null,
    '--any-pattern': null,
    '--any-top-annotated': 'One of: a.',
    '--any-top-pattern': null,
    '--any-typed': 'One of: a, b.',
    '--authored-open': 'Anything at all.',
    '--authored-over-enum': 'Custom words.',
    '--authored-pattern': 'An x.',
    '--beside-any': null,
    '--beside-const': null,
    '--const-annotated': 'One of: only.',
    '--const-min-length': null,
    '--const-typed': 'One of: only.',
    '--described': 'Pick one. One of: a, b.',
    '--eight': 'One of: a, b, c, d, e, f, g, h.',
    '--empty': null,
    '--enum-annotated': 'One of: a, b.',
    '--enum-pattern': null,
    '--enum-typed': 'One of: a, b.',
    '--faceted': 'Pick one. One of: a, b.  (default: a)',
    '--flag': null,
    '--many-annotated': 'One of: x, y.  (repeatable)',
    '--many-array': '(repeatable)',
    '--many-enum': 'One of: x, y.  (repeatable)',
    '--many-pattern': '(repeatable)',
    '--marked': 'One of: m\uE000n.',
    '--nine': null,
    '--nine-repeating': 'One of: a, b, c, d, e, f, g, h.',
    '--nullable': null,
    '--number': null,
    '--number-const': null,
    '--number-typed': null,
    '--pattern-only': null,
    '--quoted': String.raw`One of: "", "a b", "c,d", "e\"f", "g\u2028h", plain.`,
    '--quoted-controls': String.raw`One of: "b\bc", "d\u007fe", "f\u009bg".`,
    '--quoted-more': `${String.raw`One of: "i\u0085j", "k\tl", "m`}\u00a0${String.raw`n".`}`,
    '--repeated': 'One of: a, b.',
    '--repeated-late': 'One of: b, a.',
    '--scalar-array': null,
    '--sparse-any': null,
    '--sparse-enum': null,
  });
});

test('an argument row derives from its schema and prints an authored helpArgument sentence', async () => {
  expect(section(await pageOf(['pick', '--help']), 'ARGUMENTS')).toEqual([
    '  mode   The mode. One of: fast, slow.',
    '  size   A whole number.',
    '  names  One of: x, y.',
  ]);
});

test.each([
  ['v-const', ['  values  One of: x.']],
  ['v-any', ['  values  One of: x, y.']],
  ['v-typed', ['  values  One of: x.']],
  ['v-annotated', ['  values  One of: x.']],
  ['v-narrow', ['  values']],
  ['v-array', ['  values']],
])(
  'a variadic argument derives from the top of its schema under the same keyword rules: %s',
  async (name, rows) => {
    expect(section(await pageOf([name, '--help']), 'ARGUMENTS')).toEqual(rows);
  },
);
