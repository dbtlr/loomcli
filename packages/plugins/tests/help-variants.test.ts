import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/run.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
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

test('--help prints the extended page, with the details and examples and the --help child hint', () => {
  expect(run('variants', ['--help'])).toEqual(
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
  expect(run('variants', ['get', '--help'])).toEqual(
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

test('-h prints the compact page of a group, the child hint ahead of the pointer', () => {
  expect(run('variants', ['-h'])).toEqual(compactRoot);
});

test('-h drops the details of a leaf and points to the extended page that holds them', () => {
  expect(run('variants', ['get', '-h'])).toEqual(
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

test('-h on a leaf with neither details nor examples prints the extended page with no pointer', () => {
  const extended = run('variants', ['keys', '--help']);
  expect(run('variants', ['keys', '-h'])).toEqual(extended);
  expect(extended.stdout).not.toContain('Run ');
});

test('a letter in a short group is spelled -h, so -Vh prints the compact page', () => {
  expect(run('variants', ['-Vh'])).toEqual(compactRoot);
});

test('-h --help is the repeated-option usage error and prints no page', () => {
  expect(run('variants', ['-h', '--help'])).toEqual({
    status: 2,
    stderr: 'app: Option "--help" can be supplied only once. Remove the repeated option.\n',
    stdout: '',
  });
});

test.each([
  [['-h'], 'root:compact\n'],
  [['--help'], 'root:extended\n'],
  [['get', '-h'], 'get:compact\n'],
])('an override of the page receives the variant for %j', (argv, stdout) => {
  expect(run('variants-page', argv)).toEqual({ status: 0, stderr: '', stdout });
});
