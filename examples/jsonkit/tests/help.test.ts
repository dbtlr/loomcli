/*
 * Acceptance plan for the color plugin (docs/plugins/color.md#color-plugin).
 *
 * - jsonkit installs `color()` after its example plugin, and `jsonkit --help` lists `--[no-]color`
 *   with its description after `--explain` among the global options, in the pages The help page
 *   pins. The manifest marks it `control` and `color`, and every other Boolean option node reads
 *   `color: false`.
 * - On a capable terminal with `FORCE_COLOR=1`, `jsonkit --help --no-color` prints the page with no
 *   color escape, and piped, `jsonkit --help --color` prints it with color escapes.
 * - An application that marks its own option and installs the plugin fails with the two-marks
 *   error.
 * - A consumer installs the packed pack, imports `@loomcli/plugins/color`, compiles against its
 *   declarations, and `pnpm check:packed` resolves the subpath from the packed tarball under Node
 *   and Bun.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, override } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpPage } from '@loomcli/plugins/help/views';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { printed, run } from './run.js';

/** The same application, started behind the hook that records each plugin module it loads. */
const loads = new URL('fixtures/loads.mjs', import.meta.url);

/**
 * The application brands the page the installed help plugin renders. The plugin stays installed and
 * keeps its option and its middleware; only the view function behind the page is replaced. A broken
 * replacement reports one diagnostic and returns 1.
 */
async function branded(scenario: 'branded' | 'broken') {
  const application = new Application('jsonkit', {
    description: 'Read and reshape one JSON document.',
    plugins: [help()],
    views: [
      override(
        helpPage,
        scenario === 'broken'
          ? {
              render: () => {
                throw new Error('Cannot render the page.');
              },
            }
          : {
              render: ({ command, graph }, { style }) =>
                `${style.escape(`${graph.name}: ${command.name ?? graph.description ?? ''}`)}\n`,
            },
      ),
    ],
  }).action(({ out }) => out.print('summarized'));
  const mock = mockProcess({ argv: ['--help'], release: { build: 'distributed' } });
  const status = await application.run({ process: mock });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** A page as its lines, ending with the single newline the declared view appends. */
function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

/**
 * One invocation with a marks file, so a test reads which plugin middleware modules the invocation
 * evaluated. A module the chain never reached leaves no line.
 */
function loaded(argv: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-jsonkit-marks-'));
  const marks = join(directory, 'marks.txt');
  try {
    const result = invoke(loads, argv, { env: { LOOM_FIXTURE_MARKS: marks } });
    let lines: string[] = [];
    try {
      lines = readFileSync(marks, 'utf8').split('\n').filter(Boolean);
    } catch {
      lines = [];
    }
    return { ...result, marks: lines };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** The root page, which every invocation help takes over on the root prints. */
const root = page(
  'jsonkit · Read and reshape one JSON document.',
  '',
  '  With no subcommand, jsonkit summarizes the document and its top-level keys.',
  '',
  'USAGE',
  '  jsonkit [options]',
  '  jsonkit <command> [options]',
  '',
  'DOCUMENT COMMANDS',
  '  READ',
  '    get              Read one value at a path.',
  '    keys             List the keys at a path.',
  "    stats <command>  Report facts about the document's shape.",
  '    fetch            Read one value at a path.  (deprecated: Use get instead.)',
  '  RESHAPE',
  '    select  Keep the named fields of the document.',
  '',
  'COMMANDS',
  '  doctor                Check the host this application runs on.',
  '  completion <command>  Print or install a shell completion script.',
  "  mcp [command]         Serve this application's tools to an MCP client over stdin and stdout.",
  '  manpage <command>     Write or install the man pages.',
  '',
  'OPTIONS',
  '  -f, --file <path>      The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)',
  '  -o, --format <format>  Select the output format, records by default. One of: records, json, jsonl.',
  '',
  'GLOBAL OPTIONS',
  '  -h, --help        Show this help.',
  '  -V, --version     Print the version.',
  "  -M, --manifest    Print this command's manifest as JSON.",
  '  -e, --explain     Explain the selected command and exit.',
  '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
  '  -v, --verbose...  Show more detail. Repeat it for more.',
  '  -q, --quiet       Hide info and success messages.',
  '',
  'EXAMPLES',
  '  $ jsonkit -f doc.json',
  '  $ jsonkit get user.name -f doc.json',
  '',
  'Run jsonkit <command> --help for command details.',
);

/** The `select` page, which every invocation that routes to `select` prints. */
const select = page(
  'jsonkit select · Keep the named fields of the document.',
  '',
  'USAGE',
  '  jsonkit select --field <field>... [options]',
  '',
  'OPTIONS',
  '  -f, --file <path>    The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)',
  '  -F, --field <field>  A field to keep. Repeat it for several.  (required, repeatable)',
  '',
  'GLOBAL OPTIONS',
  '  -h, --help        Show this help.',
  '  -V, --version     Print the version.',
  "  -M, --manifest    Print this command's manifest as JSON.",
  '  -e, --explain     Explain the selected command and exit.',
  '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
  '  -v, --verbose...  Show more detail. Repeat it for more.',
  '  -q, --quiet       Hide info and success messages.',
);

test('jsonkit --help prints the root page', async () => {
  await expect(run(['--help'])).resolves.toEqual(root);
});

test('jsonkit -F name select names the Command that declares -F, and help takes the fault over', async () => {
  await expect(run(['-F', 'name', 'select'])).resolves.toEqual({
    status: 2,
    stderr:
      'jsonkit: Option "-F" belongs to command "select". Supply it after "select".\nRun "jsonkit --help" to see the usage.\n',
    stdout: '',
  });
  await expect(run(['-F', 'name', 'select', '--help'])).resolves.toEqual(root);
});

test('jsonkit holds a fault on a root local option, so help after it renders the page', async () => {
  await expect(run(['--file'])).resolves.toEqual({
    status: 2,
    stderr:
      'jsonkit: Option "--file" requires a value. Supply a value after "--file".\nRun "jsonkit --help" to see the usage.\n',
    stdout: '',
  });
  await expect(run(['--file', '--help'])).resolves.toEqual(root);
  await expect(run(['--help', '--help'])).resolves.toEqual(root);
  await expect(run(['nope', '--help'])).resolves.toEqual({
    status: 2,
    stderr:
      'jsonkit: Unknown command "nope". Use one of: doctor, completion, mcp, manpage, get, keys, select, stats.\nRun "jsonkit --help" to see the usage.\n',
    stdout: '',
  });
});

test('jsonkit -h prints the compact root page, the child hint ahead of the pointer', async () => {
  await expect(run(['-h'])).resolves.toEqual(
    page(
      'jsonkit · Read and reshape one JSON document.',
      '',
      'USAGE',
      '  jsonkit [options]',
      '  jsonkit <command> [options]',
      '',
      'DOCUMENT COMMANDS',
      '  READ',
      '    get              Read one value at a path.',
      '    keys             List the keys at a path.',
      "    stats <command>  Report facts about the document's shape.",
      '    fetch            Read one value at a path.  (deprecated: Use get instead.)',
      '  RESHAPE',
      '    select  Keep the named fields of the document.',
      '',
      'COMMANDS',
      '  doctor                Check the host this application runs on.',
      '  completion <command>  Print or install a shell completion script.',
      "  mcp [command]         Serve this application's tools to an MCP client over stdin and stdout.",
      '  manpage <command>     Write or install the man pages.',
      '',
      'OPTIONS',
      '  -f, --file <path>      The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)',
      '  -o, --format <format>  Select the output format, records by default. One of: records, json, jsonl.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      "  -M, --manifest    Print this command's manifest as JSON.",
      '  -e, --explain     Explain the selected command and exit.',
      '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
      '',
      'Run jsonkit <command> -h for command details.',
      'Run jsonkit --help for details and examples.',
    ),
  );
});

test('jsonkit --help --version prints help and never loads the version middleware module', async () => {
  const result = loaded(['--help', '--version']);
  expect(result.marks).toEqual(['loaded:help']);
  expect(result).toMatchObject(root);
});

test('jsonkit --version --help prints the same page, because help wins the tie', async () => {
  expect(loaded(['--version', '--help'])).toMatchObject(root);
});

test('jsonkit select --help prints the leaf page of a Command with a required option', async () => {
  await expect(run(['select', '--help'])).resolves.toEqual(select);
});

test('jsonkit select -h prints the extended page, because select has no details or examples', async () => {
  await expect(run(['select', '-h'])).resolves.toEqual(select);
});

test('jsonkit stats depth max --help prints the page of the Command three levels down', async () => {
  await expect(run(['stats', 'depth', 'max', '--help'])).resolves.toEqual(
    page(
      'jsonkit stats depth max · Print the deepest nesting level under a path.',
      '',
      'USAGE',
      '  jsonkit stats depth max [path] [options]',
      '',
      'ARGUMENTS',
      '  path  Dot path to measure. Omit it for the root.',
      '',
      'OPTIONS',
      '  -f, --file <path>  The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      "  -M, --manifest    Print this command's manifest as JSON.",
      '  -e, --explain     Explain the selected command and exit.',
      '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
      '',
      'EXAMPLES',
      '  $ jsonkit stats depth max user -f doc.json',
    ),
  );
});

test('jsonkit stats depth --help lists the child of the group two levels down', async () => {
  await expect(printed(['stats', 'depth', '--help'])).resolves.toContain(
    ['COMMANDS', '  max  Print the deepest nesting level under a path.'].join('\n'),
  );
});

test('jsonkit get --help renders while the required path is missing', async () => {
  await expect(run(['get', '--help'])).resolves.toEqual(
    page(
      'jsonkit get · Read one value at a path.',
      '',
      '  A path is a dot-separated walk from the root of the document.',
      '',
      "  ● A key reads an object's member, such as `user.name`.",
      "  ● A whole number reads an array's item, such as `items.0`.",
      '',
      '  The document is JSON; see the format (https://www.json.org/json-en.html).',
      '',
      'USAGE',
      '  jsonkit get <path> [options]',
      '',
      'ARGUMENTS',
      '  path  Dot path to read.',
      '',
      'OPTIONS',
      '  -f, --file <path>  The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      "  -M, --manifest    Print this command's manifest as JSON.",
      '  -e, --explain     Explain the selected command and exit.',
      '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
      '',
      'EXAMPLES',
      '  $ jsonkit get name -f doc.json',
      '  $ jsonkit get nested.deep.value -f doc.json',
    ),
  );
});

test('jsonkit get -h omits Details and EXAMPLES and points to extended help', async () => {
  await expect(run(['get', '-h'])).resolves.toEqual(
    page(
      'jsonkit get · Read one value at a path.',
      '',
      'USAGE',
      '  jsonkit get <path> [options]',
      '',
      'ARGUMENTS',
      '  path  Dot path to read.',
      '',
      'OPTIONS',
      '  -f, --file <path>  The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      "  -M, --manifest    Print this command's manifest as JSON.",
      '  -e, --explain     Explain the selected command and exit.',
      '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
      '',
      'Run jsonkit get --help for details and examples.',
    ),
  );
});

test('jsonkit select --bogus --help renders too, because help takes over held input faults', async () => {
  await expect(run(['select', '--bogus', '--help'])).resolves.toEqual(select);
});

test('jsonkit fetch --help opens with the deprecation message under the masthead', async () => {
  await expect(run(['fetch', '--help'])).resolves.toEqual(
    page(
      'jsonkit fetch · Read one value at a path.',
      '  Deprecated: Use get instead.',
      '',
      'USAGE',
      '  jsonkit fetch <path> [options]',
      '',
      'ARGUMENTS',
      '  path  Dot path to read.',
      '',
      'OPTIONS',
      '  -f, --file <path>  The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      "  -M, --manifest    Print this command's manifest as JSON.",
      '  -e, --explain     Explain the selected command and exit.',
      '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
    ),
  );
});

test('jsonkit debug --help prints the page of a Command no listing shows', async () => {
  await expect(run(['debug', '--help'])).resolves.toEqual(
    page(
      'jsonkit debug · Dump the parsed document.',
      '',
      'USAGE',
      '  jsonkit debug [options]',
      '',
      'OPTIONS',
      '  -f, --file <path>  The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      "  -M, --manifest    Print this command's manifest as JSON.",
      '  -e, --explain     Explain the selected command and exit.',
      '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
    ),
  );
});

test('jsonkit --version prints the name and the declared version', async () => {
  await expect(run(['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'jsonkit v0.0.0\n',
  });
});

test('jsonkit get --version prints the same line, because the version is an Application fact', async () => {
  await expect(run(['get', '--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'jsonkit v0.0.0\n',
  });
});

test('an override of helpPage changes jsonkit --help while help() stays installed', async () => {
  await expect(branded('branded')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'jsonkit: Read and reshape one JSON document.\n',
  });
});

test('a broken helpPage override reports one diagnostic on stderr and returns 1', async () => {
  await expect(branded('broken')).resolves.toEqual({
    status: 1,
    stderr: 'jsonkit: Something went wrong.\n',
    stdout: '',
  });
});

/** One invocation on a terminal `columns` wide on stdout, with no `COLUMNS` and no styling. */
function at(columns: number, argv: string[]) {
  return run(argv, {
    rendering: { color: 'never', hyperlinks: 'never', modifiers: 'never' },
    terminal: { columns, streams: ['stdout'] },
  });
}

/** The lines of a page that run past `columns`. */
function overflowing(stdout: string, columns: number): string[] {
  return stdout.split('\n').filter((line) => line.length > columns);
}

test('jsonkit --help on a 60-column terminal wraps its prose and keeps its literals whole', async () => {
  await expect(at(60, ['--help'])).resolves.toEqual(
    page(
      'jsonkit · Read and reshape one JSON document.',
      '',
      '  With no subcommand, jsonkit summarizes the document and',
      '  its top-level keys.',
      '',
      'USAGE',
      '  jsonkit [options]',
      '  jsonkit <command> [options]',
      '',
      'DOCUMENT COMMANDS',
      '  READ',
      '    get              Read one value at a path.',
      '    keys             List the keys at a path.',
      "    stats <command>  Report facts about the document's",
      '                     shape.',
      '    fetch            Read one value at a path.  (deprecated:',
      '                     Use get instead.)',
      '  RESHAPE',
      '    select  Keep the named fields of the document.',
      '',
      'COMMANDS',
      '  doctor                Check the host this application runs',
      '                        on.',
      '  completion <command>  Print or install a shell completion',
      '                        script.',
      "  mcp [command]         Serve this application's tools to an",
      '                        MCP client over stdin and stdout.',
      '  manpage <command>     Write or install the man pages.',
      '',
      'OPTIONS',
      '  -f, --file <path>      The document to read. Omit it to',
      '                         read piped text.  (file or piped',
      '                         stdin; - selects stdin, required)',
      '  -o, --format <format>  Select the output format, records',
      '                         by default. One of: records, json,',
      '                         jsonl.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      "  -M, --manifest    Print this command's manifest as JSON.",
      '  -e, --explain     Explain the selected command and exit.',
      '      --[no-]color  Turn color on or off, overriding',
      '                    NO_COLOR.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
      '',
      'EXAMPLES',
      '  $ jsonkit -f doc.json',
      '  $ jsonkit get user.name -f doc.json',
      '',
      'Run jsonkit <command> --help for command details.',
    ),
  );
});

test('jsonkit --help on a 30-column terminal stacks its COMMANDS rows', async () => {
  const { stdout } = await at(30, ['--help']);
  const blocks = stdout.split('\n\n');
  expect(blocks.find((block) => block.startsWith('COMMANDS\n'))).toBe(
    [
      'COMMANDS',
      '  doctor',
      '      Check the host this',
      '      application runs on.',
      '  completion <command>',
      '      Print or install a shell',
      '      completion script.',
      '  mcp [command]',
      "      Serve this application's",
      '      tools to an MCP client',
      '      over stdin and stdout.',
      '  manpage <command>',
      '      Write or install the man',
      '      pages.',
    ].join('\n'),
  );
});

test.each([40, 60])('jsonkit -h fits a %i-column terminal', async (columns) => {
  const result = await at(columns, ['-h']);
  expect(result.status).toBe(0);
  expect(overflowing(result.stdout, columns)).toEqual([]);
});

test('jsonkit get --help and select --help fit 60 columns, and at 40 only their literals overflow', async () => {
  for (const argv of [
    ['get', '--help'],
    ['select', '--help'],
  ]) {
    const result = await at(60, argv);
    expect(result.status).toBe(0);
    expect(overflowing(result.stdout, 60)).toEqual([]);
  }
  const get = await at(40, ['get', '--help']);
  expect(overflowing(get.stdout, 40)).toEqual(['  $ jsonkit get nested.deep.value -f doc.json']);
  const selectPage = await at(40, ['select', '--help']);
  expect(overflowing(selectPage.stdout, 40)).toEqual([
    '  jsonkit select --field <field>... [options]',
  ]);
});

/** The color plugin's run of jsonkit's help page, on a capable terminal or with every stream piped. */
function colored(
  terminal: 'pipe' | 'tty',
  argv: string[],
  env: Record<string, string | undefined>,
) {
  return run(argv, {
    env,
    // A page taller than the terminal goes to the pager; this stub stands for the real `less` with LESS=FRX, which the spawn piped through unchanged.
    programs: { '/bin/sh': ({ input }) => ({ stdout: input }) },
    ...(terminal === 'tty' ? { terminal: { columns: 100 } } : {}),
  });
}

/** One SGR sequence and the parameters it carries. */
const sgr = new RegExp(`${String.fromCodePoint(27)}\\[(?<parameters>[0-9;]*)m`, 'gu');

/** Whether some SGR sequence in the text sets a foreground color. */
function hasColor(text: string): boolean {
  return [...text.matchAll(sgr)].some((match) =>
    (match.groups?.parameters ?? '')
      .split(';')
      .some((parameter) => /^(?:3[0-8]|9[0-7])$/u.test(parameter)),
  );
}

test('jsonkit --help --no-color prints no color on a capable terminal, even under FORCE_COLOR', async () => {
  const variables = { COLORTERM: undefined, NO_COLOR: undefined, TERM: 'xterm' };
  const forced = { ...variables, FORCE_COLOR: '1' };
  const colorful = await colored('tty', ['--help'], forced);
  expect(colorful.status).toBe(0);
  expect(hasColor(colorful.stdout)).toBe(true);
  const off = await colored('tty', ['--help', '--no-color'], forced);
  expect(off.status).toBe(0);
  expect(off.stdout).toContain('--[no-]color');
  expect(hasColor(off.stdout)).toBe(false);
  const piped = await colored('pipe', ['--help'], { ...variables, FORCE_COLOR: undefined });
  expect(hasColor(piped.stdout)).toBe(false);
  const on = await colored('pipe', ['--help', '--color'], { ...variables, FORCE_COLOR: undefined });
  expect(on.status).toBe(0);
  expect(hasColor(on.stdout)).toBe(true);
});
