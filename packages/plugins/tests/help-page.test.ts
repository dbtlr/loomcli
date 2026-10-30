/*
 * Acceptance plan for the first-party help and version plugins (docs/plugins/README.md).
 *
 * The first-party plugins are proven when both example applications install `help()` and
 * `version()` from `@loomcli/plugins` through `plugins`, ahead of the example plugin so that help
 * and version win a tie, and public APIs alone produce the pages the reference pins. The byte
 * comparisons run with color and modifiers disabled, and separate expectations cover themed
 * output. Each case runs under Node and Bun. The cases:
 *
 * - Pages. `jsonkit --help`, `jsonkit select --help`, and `textstat --help` print the three pages.
 *   `jsonkit get --help` prints the `get` page with its `details` and example while `path` is
 *   missing. `jsonkit select --bogus --help` prints the `select` page.
 * - Deprecated and hidden members. `jsonkit fetch --help` prints the deprecated page and `jsonkit
 *   debug --help` the hidden one.
 * - Groups. `jsonkit cache --help` on a nested fixture prints a group page with the children form
 *   alone and a `cache <command>` row on its parent's page.
 * - Version. `jsonkit --version` and `jsonkit get --version` print `jsonkit v0.0.0` while the
 *   example manifests hold `0.0.0`, and an Application that omits `version` prints the same line
 *   (packages/plugins/tests/version.test.ts). `jsonkit --help --version` prints help and never
 *   imports the version middleware module.
 */

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
      '  app <path> [depth] --field <field>... --legacy-field <legacy-field>... --source <source> [options]',
      '',
      'ARGUMENTS',
      '  path   Dot path to read.',
      '  depth  How deep to walk.  (default: 1)',
      '',
      'OPTIONS',
      '  -F, --field <field>                A field to keep.  (required, repeatable)',
      '      --legacy-field <legacy-field>  A field to keep, the old way.  (required, repeatable, deprecated: Use --field instead.)',
      '      --mode <mode>                  How to print.  (default: plain)',
      '      --tags <tags>                  The tags to keep.  (repeatable, default: one two)',
      '      --limit <limit>                How many rows.  (default: 3)',
      String.raw`      --label <label>                The label.  (default: a\nb)`,
      '      --count <count>                How many items.  (default: 10)',
      '      --nan <nan>                    The unset ratio.  (default: NaN)',
      '      --inf <inf>                    The upper bound.  (default: Infinity)',
      '      --note <note>                  A note.',
      '      --source <source>              (required)',
      '      --plain',
      '      --no-legacy-quiet              Print nothing, the old way.  (default: true, deprecated: Use --quiet instead.)',
      '  -h, --help                         Show this help.',
      '  -V, --version                      Print the version.',
    ),
  );
});

test('a counted option ends its spellings with an ellipsis, and an implied value brackets its placeholder', () => {
  expect(run('kinds', ['--help'])).toEqual(
    page(
      'copyit · Copy files with backups.',
      '',
      'USAGE',
      '  copyit <files...> --tag[=<tag>]... -m[<mode>] [options]',
      '',
      'ARGUMENTS',
      '  files  The files to copy.',
      '',
      'OPTIONS',
      '  -b, --backup[=<control>]  How to back up each file. Use none, simple, or numbered.  (implied: simple)',
      '      --suffix[=<suffix>]   The backup suffix.  (default: ~, implied: .bak)',
      '  -c[<color>]               (implied: auto)',
      String.raw`      --tag[=<tag>]         (required, repeatable, implied: a\nb)`,
      '  -m[<mode>]                (required, implied: fast)',
      '  -v, --verbose...          Say more.',
      '  -q...',
      '      --level...            (deprecated: Use -v instead.)',
      '  -h, --help                Show this help.',
      '  -V, --version             Print the version.',
    ),
  );
});

test('the quiet-marked option prints no ellipsis, because a further -q adds nothing', () => {
  expect(run('verbose', ['--help'])).toEqual(
    page(
      'fetchit · Fetch records.',
      '',
      'USAGE',
      '  fetchit [options]',
      '',
      'OPTIONS',
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
    ),
  );
});

test('a default JSON cannot render prints as String renders it', () => {
  const result = run('unencodable', ['--help']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(result.stdout).toContain('  --shape <shape>  The shape.  (default: [object Object])\n');
  expect(result.stdout).toMatch(/^ {6}--list <list> {4}The list\. {2}\(default: 7\)$/mu);
});

test('a root with children prints GLOBAL OPTIONS and the action form', () => {
  expect(run('usage', ['--help'])).toEqual(
    page(
      'app · Do the work.',
      '',
      'USAGE',
      '  app [options]',
      '  app <command> [options]',
      '',
      'COMMANDS',
      '  run   Run one job.',
      '  pack  Pack the files.',
      '',
      'GLOBAL OPTIONS',
      '      --key <key>    The key to use.',
      '  -f, --file <file>  The document to read.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
      '',
      'Run app <command> --help for command details.',
    ),
  );
});

test('the action form holds the arguments, then the node required options', () => {
  expect(run('usage', ['run', '--help'])).toEqual(
    page(
      'app run · Run one job.',
      '',
      'USAGE',
      '  app run <source> [target] --out <out> --tag <tag>... [options]',
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
      '      --key <key>    The key to use.',
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
      '  app pack <files...> [options]',
      '',
      'ARGUMENTS',
      '  files  The files to pack.',
      '',
      'GLOBAL OPTIONS',
      '      --key <key>    The key to use.',
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

test('a hidden child leaves no row in COMMANDS, and a child that is also deprecated leaves none', () => {
  expect(run('children', ['--help'])).toEqual(
    page(
      'app · Do the work.',
      '',
      'USAGE',
      '  app [options]',
      '  app <command> [options]',
      '',
      'COMMANDS',
      '  get              Read one value at a path.',
      '  fetch            Read one value at a path.  (deprecated: Use get instead.)',
      '  cache <command>  Manage the cache.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
      '',
      'Run app <command> --help for command details.',
    ),
  );
});

test('a deprecated Command carries its message on a second masthead line', () => {
  expect(run('children', ['fetch', '--help'])).toEqual(
    page(
      'app fetch · Read one value at a path.',
      '  Deprecated: Use get instead.',
      '',
      'USAGE',
      '  app fetch [options]',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
    ),
  );
});

test('a line break in a description or a deprecation message prints as one space', () => {
  expect(run('multiline', ['--help'])).toEqual(
    page(
      'app · Do the work.',
      '',
      'USAGE',
      '  app [options]',
      '  app <command> [options]',
      '',
      'COMMANDS',
      '  fetch  Read one value at a path.  (deprecated: Use get instead.)',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
      '',
      'Run app <command> --help for command details.',
    ),
  );
  expect(run('multiline', ['fetch', '--help'])).toEqual(
    page(
      'app fetch · Read one value at a path.',
      '  Deprecated: Use get instead.',
      '',
      'USAGE',
      '  app fetch [options]',
      '',
      'OPTIONS',
      '      --depth <depth>  How deep to walk.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
    ),
  );
});

test('a hidden Command routed to directly prints its own page like any other', () => {
  expect(run('children', ['debug', '--help'])).toEqual(
    page(
      'app debug · Dump the document.',
      '',
      'USAGE',
      '  app debug [options]',
      '',
      'OPTIONS',
      '      --depth <depth>  How deep to walk.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
    ),
  );
});

test('a group whose children are all hidden prints the children form and no other listing', () => {
  expect(run('children', ['cache', '--help'])).toEqual(
    page(
      'app cache · Manage the cache.',
      '',
      'USAGE',
      '  app cache <command> [options]',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
    ),
  );
});

test('a root whose children are all hidden prints no children form, no COMMANDS, and no hint', () => {
  expect(run('unlisted', ['--help'])).toEqual(
    page(
      'app · Do the work.',
      '',
      'USAGE',
      '  app [options]',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help     Show this help.',
      '  -V, --version  Print the version.',
    ),
  );
});

test('a hidden option, required ones included, leaves the action form, OPTIONS, and GLOBAL OPTIONS, and deprecated is last', () => {
  expect(run('scoped', ['--help'])).toEqual(
    page(
      'app · Do the work.',
      '',
      'USAGE',
      '  app [options]',
      '  app <command> [options]',
      '',
      'COMMANDS',
      '  run  Run one job.',
      '',
      'OPTIONS',
      '      --mode <mode>  How to print.  (default: plain, deprecated: Use --style instead.)',
      '',
      'GLOBAL OPTIONS',
      '      --key <key>  The key to use.',
      '  -h, --help       Show this help.',
      '  -V, --version    Print the version.',
      '',
      'Run app <command> --help for command details.',
    ),
  );
});

test('a hidden global option leaves GLOBAL OPTIONS on a non-root page', () => {
  expect(run('scoped', ['run', '--help'])).toEqual(
    page(
      'app run · Run one job.',
      '',
      'USAGE',
      '  app run [options]',
      '',
      'GLOBAL OPTIONS',
      '      --key <key>  The key to use.',
      '  -h, --help       Show this help.',
      '  -V, --version    Print the version.',
    ),
  );
});

test('a hidden option of either scope leaves the folded root OPTIONS', () => {
  expect(run('folded', ['--help'])).toEqual(
    page(
      'app · Do the work.',
      '',
      'USAGE',
      '  app [options]',
      '',
      'OPTIONS',
      '      --mode <mode>  How to print.',
      '      --key <key>    The key to use.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
    ),
  );
});

test('an option row lists its variables and its configuration key last among the facts but deprecated, never a value', () => {
  const expected = page(
    'app · Show each binding fact.',
    '',
    'USAGE',
    '  app [options]',
    '',
    'OPTIONS',
    '      --region[=<region>]  The region to use.  (default: eu, implied: us, env: APP_REGION APP_ZONE, config: cloud.region)',
    '      --cache              Use the cache.  (env: APP_CACHE)',
    '      --retries <retries>  (config: retries)',
    '      --old <old>          (env: APP_OLD, config: old, deprecated: Use --region instead.)',
    '      --token <token>      The access token.',
    '  -h, --help               Show this help.',
    '  -V, --version            Print the version.',
  );
  // The compact page prints the same facts, and its hints follow.
  expect(run('bindings', ['--help'])).toEqual(expected);
  const compact = run('bindings', ['-h']);
  expect(compact.stdout).toContain('(env: APP_CACHE)');
  expect(compact.stdout).toContain('config: cloud.region)');
  expect(compact.stdout).not.toContain('APP_TOKEN');
});
