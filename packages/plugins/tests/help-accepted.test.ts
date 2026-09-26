import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/help-accepted.mjs', import.meta.url);

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

function pageOf(argv: string[]): string {
  const result = invoke(fixture, argv);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return result.stdout;
}

test('a row derives its accepted values from a closed set of strings at every level, and nothing when a keyword could narrow it', () => {
  expect(optionCells(pageOf(['shapes', '--help']))).toEqual({
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

test('an argument row derives from its schema and prints an authored helpArgument sentence', () => {
  expect(section(pageOf(['pick', '--help']), 'ARGUMENTS')).toEqual([
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
  (name, rows) => {
    expect(section(pageOf([name, '--help']), 'ARGUMENTS')).toEqual(rows);
  },
);
