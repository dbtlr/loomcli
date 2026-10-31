/*
 * Acceptance plan for help variants (docs/plugins/help.md#help-variants).
 *
 * Help variants are proven when public APIs alone produce these results under Node and Bun:
 *
 * - Example pages. `textstat --help`, `textstat -h`, `jsonkit -h`, and `jsonkit select -h` print
 *   the pages above, byte for byte, with color and modifiers disabled, and `jsonkit --help` and
 *   `jsonkit select --help` print their pages unchanged. The example applications' help goldens are
 *   re-pinned to these pages.
 * - Selection. `-h` prints the compact page, `-Vh` the compact page, and `-h --help` the compact
 *   page, because the earlier `-h` stands when the repeated option is held.
 * - Spellings. A fixture plugin's middleware reads `--flag`, `-f`, and `--no-flag` for its typed
 *   options, `--name` for `--name=value`, the grouped letter as `-f`, and the last spelling of a
 *   multiple string option given as `-n a --name b`. An option filled from the environment or the
 *   configuration source, a defaulted option, and an option not supplied have no entry, another
 *   plugin's options and the application's options never appear, and the record is frozen.
 * - Hints. A compact leaf page whose only extended block is Details prints the pointer, a compact
 *   leaf with neither Details nor EXAMPLES prints none, and a compact group page prints the child
 *   hint with `-h` ahead of the pointer.
 * - Replacement. An `override(helpPage, …)` receives `variant` as `compact` under `-h` and
 *   `extended` under `--help`.
 * - Styles. A themed compact page styles both hint lines under the restyle mapping.
 */

import { expect, test } from 'vite-plus/test';

import { run as fixtureRun } from './fixtures/run-app.mjs';

async function run(scenario: string, argv: string[]) {
  return await fixtureRun([scenario, ...argv]);
}

/** A page written by hand, as its lines. The view ends it with exactly one newline. */
function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

const globals = [
  'GLOBAL OPTIONS',
  '  -h, --help     Show this help.',
  '  -V, --version  Print the version.',
];

/** The compact root page: the child hint spelled `-h`, then the pointer to its EXAMPLES. */
const compactRoot = page(
  'app · A fixture application.',
  '',
  'USAGE',
  '  app [options]',
  '  app <command> [options]',
  '',
  'COMMANDS',
  '  get   Read one value at a path.',
  '  keys  List the keys at a path.',
  '',
  ...globals,
  '',
  'Run app <command> -h for command details.',
  'Run app --help for details and examples.',
);

test('--help prints the extended page, with the details and examples and the --help child hint', async () => {
  await expect(run('variants', ['--help'])).resolves.toEqual(
    page(
      'app · A fixture application.',
      '',
      'USAGE',
      '  app [options]',
      '  app <command> [options]',
      '',
      'COMMANDS',
      '  get   Read one value at a path.',
      '  keys  List the keys at a path.',
      '',
      ...globals,
      '',
      'EXAMPLES',
      '  $ app get a.b',
      '',
      'Run app <command> --help for command details.',
    ),
  );
  await expect(run('variants', ['get', '--help'])).resolves.toEqual(
    page(
      'app get · Read one value at a path.',
      '',
      '  Reads the value at one dot path.',
      '',
      'USAGE',
      '  app get [options]',
      '',
      ...globals,
    ),
  );
});

test('-h prints the compact page of a group, the child hint ahead of the pointer', async () => {
  await expect(run('variants', ['-h'])).resolves.toEqual(compactRoot);
});

test('-h drops the details of a leaf and points to the extended page that holds them', async () => {
  await expect(run('variants', ['get', '-h'])).resolves.toEqual(
    page(
      'app get · Read one value at a path.',
      '',
      'USAGE',
      '  app get [options]',
      '',
      ...globals,
      '',
      'Run app get --help for details and examples.',
    ),
  );
});

test('-h on a leaf with neither details nor examples prints the extended page with no pointer', async () => {
  const extended = await run('variants', ['keys', '--help']);
  await expect(run('variants', ['keys', '-h'])).resolves.toEqual(extended);
  expect(extended.stdout).not.toContain('Run ');
});

test('a letter in a short group is spelled -h, so -Vh prints the compact page', async () => {
  await expect(run('variants', ['-Vh'])).resolves.toEqual(compactRoot);
});

test('-h --help holds the repeated option, and the earlier -h stands, so the compact page prints', async () => {
  await expect(run('variants', ['-h', '--help'])).resolves.toEqual(compactRoot);
});

test.each([
  [['-h'], 'root:compact\n'],
  [['--help'], 'root:extended\n'],
  [['get', '-h'], 'get:compact\n'],
])('an override of the page receives the variant for %j', async (argv, stdout) => {
  await expect(run('variants-page', argv)).resolves.toEqual({ status: 0, stderr: '', stdout });
});
