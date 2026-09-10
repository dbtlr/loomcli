import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/run.mjs', import.meta.url);

/** One page the fixture printed, with the single newline `out.print` appends. */
function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

/** A page written by hand, as its lines. `out.print` ends it with exactly one newline. */
function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

test('a root with an action and children prints both usage forms and the closing hint', () => {
  expect(run('nested', ['--help'])).toEqual(
    page(
      'store · Keep a local store.',
      '',
      'USAGE',
      '  store [options]',
      '  store <command> [options]',
      '',
      'COMMANDS',
      '  cache <command>  Manage the cache.',
      '  sync [command]   Copy the store to a remote.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
      '',
      'Run store <command> --help for command details.',
    ),
  );
});

test('a group prints the children form alone, because it has no other form', () => {
  expect(run('nested', ['cache', '--help'])).toEqual(
    page(
      'store cache · Manage the cache.',
      '',
      'USAGE',
      '  store cache <command> [options]',
      '',
      'COMMANDS',
      '  clear  Empty the cache.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
      '',
      'Run store cache <command> --help for command details.',
    ),
  );
});

test('a child with an action and children of its own prints both forms', () => {
  expect(run('nested', ['sync', '--help'])).toEqual(
    page(
      'store sync · Copy the store to a remote.',
      '',
      'USAGE',
      '  store sync [options]',
      '  store sync <command> [options]',
      '',
      'COMMANDS',
      '  now  Copy it at once.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
      '',
      'Run store sync <command> --help for command details.',
    ),
  );
});

test('an option row spells each polarity and placeholder, and folds in the globals', () => {
  expect(run('cells', ['--help'])).toEqual(
    page(
      'app · Show one option row for each spelling.',
      '',
      'USAGE',
      '  app [options]',
      '',
      'OPTIONS',
      '  -f, --file <path>  The document to read.',
      '      --explain      Explain the selected command and exit.',
      '  -m <metric>        What each row counts.  (default: bytes)',
      '  -t, --total        Add a total row.',
      '      --no-quiet     Print nothing.  (default: true)',
      '      --[no-]cache   Use the cache.',
      '      --verbose      Say more.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
    ),
  );
});

test('a right cell carries the description, then the facts that apply, in one parenthesis', () => {
  expect(run('facts', ['--help'])).toEqual(
    page(
      'app · Show one right cell for each fact.',
      '',
      'USAGE',
      '  app <path> [depth] --field <field>... --source <source> [options]',
      '',
      'ARGUMENTS',
      '  path   Dot path to read.',
      '  depth  How deep to walk.  (default: 1)',
      '',
      'OPTIONS',
      '  -F, --field <field>    A field to keep.  (required, repeatable)',
      '      --mode <mode>      How to print.  (default: plain)',
      '      --tags <tags>      The tags to keep.  (repeatable, default: one two)',
      '      --limit <limit>    How many rows.  (default: 3)',
      String.raw`      --label <label>    The label.  (default: a\nb)`,
      '      --note <note>      A note.',
      '      --source <source>  (required)',
      '      --plain',
      '  -h, --help             Show this help.',
      '  -V, --version          Print the version.',
    ),
  );
});

test('a root with children prints GLOBAL OPTIONS and its required global in the action form', () => {
  expect(run('usage', ['--help'])).toEqual(
    page(
      'app · Do the work.',
      '',
      'USAGE',
      '  app --key <key> [options]',
      '  app <command> [options]',
      '',
      'COMMANDS',
      '  run   Run one job.',
      '  pack  Pack the files.',
      '',
      'GLOBAL OPTIONS',
      '      --key <key>    The key to use.  (required)',
      '  -f, --file <file>  The document to read.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
      '',
      'Run app <command> --help for command details.',
    ),
  );
});

test('the action form holds the arguments, then the node options, then the globals', () => {
  expect(run('usage', ['run', '--help'])).toEqual(
    page(
      'app run · Run one job.',
      '',
      'USAGE',
      '  app run <source> [target] --out <out> --tag <tag>... --key <key> [options]',
      '',
      'ARGUMENTS',
      '  source  Where to read.',
      '  target  Where to write.',
      '',
      'OPTIONS',
      '  -o, --out <out>    The output path.  (required)',
      '      --tag <tag>    A tag to apply.  (required, repeatable)',
      '      --mode <mode>  How to run.',
      '',
      'GLOBAL OPTIONS',
      '      --key <key>    The key to use.  (required)',
      '  -f, --file <file>  The document to read.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
    ),
  );
});

test('a required variadic argument prints its ellipsis inside the required brackets', () => {
  expect(run('usage', ['pack', '--help'])).toEqual(
    page(
      'app pack · Pack the files.',
      '',
      'USAGE',
      '  app pack <files...> --key <key> [options]',
      '',
      'ARGUMENTS',
      '  files  The files to pack.',
      '',
      'GLOBAL OPTIONS',
      '      --key <key>    The key to use.  (required)',
      '  -f, --file <file>  The document to read.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
    ),
  );
});

test('a node with no description prints its path alone, with details joined by line feeds', () => {
  expect(run('prose', ['--help'])).toEqual(
    page(
      'app',
      '',
      '  first line',
      '  second line',
      '  third line',
      '',
      'USAGE',
      '  app [options]',
      '',
      'OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
      '',
      'EXAMPLES',
      '  $ app run one',
      '    The first job.',
      '  $ app run two',
    ),
  );
});
