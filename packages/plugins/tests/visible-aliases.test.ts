/*
 * Acceptance plan for visible aliases in the plugins (ADR-0168, docs/plugins/help-page.md,
 * docs/plugins/manpage.md, docs/plugins/completion.md, docs/plugins/manifest.md,
 * docs/plugins/mcp.md, docs/plugins/suggestions.md).
 *
 * Every case runs the store application in process on a mock process, or reads its graph through
 * the projection that renders it.
 *
 * - Help. A visible alias is the first fact of its member's row, `(alias: ls)` for a Command and
 *   `(alias: --minimum)` for an option, `(aliases: ...)` for several, before `deprecated`, and a
 *   routed Command's own page prints `Alias: ls` in its masthead before its deprecation line, while
 *   the usage lines keep the canonical name. On a terminal the alias names wrap under the first.
 * - The man page. An entry's text carries help's alias fact, and a Command's DESCRIPTION opens with
 *   `Alias: ls` before `Deprecated: <message>`.
 * - Completion. A visible alias is offered only where the canonical name does not match, for a
 *   Command and for an option, its negative form included, and an alias that is not visible never.
 * - The manifest. A Command entry and an option entry carry `aliases`, the visible aliases alone,
 *   after `name` and after `short` or `negative`, `[]` when there is none.
 * - MCP. A visible alias adds no tool, changes no tool name, and adds no input schema property.
 * - Suggestions. A typo of a visible alias suggests nothing, and a candidate list stays canonical.
 */
import { Application, Command, locate, style } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { answer } from '../src/completion/answer.js';
import { help } from '../src/help/plugin.js';
import { manifest } from '../src/manifest/plugin.js';
import { manPages } from '../src/manpage/page.js';
import { mcpCommand } from '../src/mcp/extension.js';
import { mcp } from '../src/mcp/plugin.js';
import { listedTool, toolEntries } from '../src/mcp/tools.js';
import { suggestions } from '../src/suggestions/plugin.js';
import { theme } from '../src/theme/plugin.js';
import { runOnMock } from './fixtures/in-process.ts';

/**
 * The store application: `cache list` advertises `ls` and keeps `dir` unadvertised, `cache remove`
 * advertises two names, `cache old` is deprecated with one, and the options each advertise one or
 * more names beside a hidden one.
 */
function store(themed = false) {
  const list = new Command('list', {
    description: 'List the cache.',
    extensions: [mcpCommand({})],
  })
    .alias('dir')
    .visibleAlias('ls')
    .option('min-bytes', {
      aliases: ['mb'],
      description: 'The smallest size.',
      type: 'string',
      visibleAliases: ['minimum'],
    })
    .option('color', {
      description: 'Color the rows.',
      polarity: 'both',
      type: 'boolean',
      visibleAliases: ['colour'],
    })
    .option('quiet', { polarity: 'negative', type: 'boolean', visibleAliases: ['silent'] })
    .option('verbose', { type: 'count', visibleAliases: ['loud', 'chatty'] })
    .action(() => {});
  const remove = new Command('remove', { description: 'Remove an entry.' })
    .visibleAlias('rm', 'delete')
    .action(() => {});
  const old = new Command('old', { deprecated: 'Use list instead.', description: 'List it.' })
    .visibleAlias('ol')
    .action(() => {});
  const clear = new Command('clear', { description: 'Empty the cache.' }).action(() => {});
  return new Application('store', {
    plugins: [
      help(),
      manifest(),
      mcp(),
      suggestions(),
      ...(themed ? [theme({ dim: style.magenta })] : []),
    ],
    version: '1.0.0',
  })
    .globalOption('profile', {
      description: 'The profile.',
      type: 'string',
      visibleAliases: ['prof'],
    })
    .command(
      new Command('cache', { description: 'Manage the cache.' })
        .command(clear)
        .command(list)
        .command(remove)
        .command(old),
    );
}

/**
 * What one run of the store application printed and exited with, on a terminal of `columns` when
 * one is given, and styled when `styled` is set.
 */
async function run(argv: string[], { columns, styled }: { columns?: number; styled?: true } = {}) {
  return await runOnMock(
    store(styled === true),
    columns === undefined
      ? { argv }
      : { argv, terminal: { columns, rows: 24, streams: ['stdout'] } },
    styled === undefined ? {} : { rendering: { color: 'always', modifiers: 'always' } },
  );
}

test('a group page lists each visible alias as the first fact of its row, before deprecated', async () => {
  const { status, stdout } = await run(['cache', '--help']);
  expect(status).toBe(0);
  expect(stdout).toContain(
    [
      'COMMANDS',
      '  clear   Empty the cache.',
      '  list    List the cache.  (alias: ls)',
      '  remove  Remove an entry.  (aliases: rm, delete)',
      '  old     List it.  (alias: ol, deprecated: Use list instead.)',
    ].join('\n'),
  );
});

test("an option row names each visible alias by its positive long spelling, a negative option's by its one spelling", async () => {
  const { stdout } = await run(['cache', 'list', '--help']);
  expect(stdout).toContain(
    [
      'OPTIONS',
      '      --min-bytes <min-bytes>  The smallest size.  (alias: --minimum)',
      '      --[no-]color             Color the rows.  (alias: --colour)',
      '      --no-quiet               (alias: --no-silent, default: true)',
      '      --verbose...             (aliases: --loud, --chatty)',
      '',
      'GLOBAL OPTIONS',
      '      --profile <profile>  The profile.  (alias: --prof)',
    ].join('\n'),
  );
});

test("a Command's own page prints its visible aliases in the masthead, before its deprecation line, and usage keeps the canonical path", async () => {
  await expect(run(['cache', 'ls', '-h'])).resolves.toMatchObject({
    status: 0,
    stdout: expect.stringMatching(
      /^store cache list · List the cache\.\n {2}Alias: ls\n\nUSAGE\n {2}store cache list \[options\]\n/u,
    ),
  });
  const several = await run(['cache', 'rm', '-h']);
  expect(several.stdout).toMatch(
    /^store cache remove · Remove an entry\.\n {2}Aliases: rm, delete\n\n/u,
  );
  const deprecated = await run(['cache', 'old', '-h']);
  expect(deprecated.stdout).toMatch(
    /^store cache old · List it\.\n {2}Alias: ol\n {2}Deprecated: Use list instead\.\n\n/u,
  );
  const none = await run(['cache', 'clear', '-h']);
  expect(none.stdout).toMatch(/^store cache clear · Empty the cache\.\n\nUSAGE\n/u);
});

test('on a terminal the alias names wrap under the first name, or at indent 2 when that hang cannot fit', async () => {
  const hung = await run(['cache', 'remove', '-h'], { columns: 17 });
  expect(hung.stdout).toMatch(/\n {2}Aliases: rm,\n {11}delete\n\n/u);
  const narrow = await run(['cache', 'remove', '-h'], { columns: 16 });
  expect(narrow.stdout).toMatch(/\n {2}Aliases: rm,\n {2}delete\n\n/u);
});

test('MCP keeps one tool per Command under its canonical name, and an option alias adds no property', () => {
  const graph = store().inspect();
  const tools = toolEntries(graph).map((entry) => listedTool(graph, entry));
  expect(tools.map(({ name }) => name)).toEqual(['cache_list']);
  const [tool] = tools;
  expect(Object.keys(Object(tool?.inputSchema.properties))).toEqual([
    'min-bytes',
    'color',
    'quiet',
    'verbose',
    'profile',
  ]);
});

/** What the suggestions plugin printed for one mistyped run. */
async function mistyped(argv: string[]) {
  const { status, stderr } = await run(argv);
  expect(status).toBe(2);
  return stderr;
}

test('a typo of a visible alias suggests nothing, and the candidates stay canonical', async () => {
  await expect(mistyped(['cache', 'delet'])).resolves.toBe(
    'store: Unknown command "delet". Use one of: clear, list, remove.\nRun "store cache --help" to see the usage.\n',
  );
  // A typo one edit from both `list` and its alias `ls` suggests the canonical name alone.
  await expect(mistyped(['cache', 'lst'])).resolves.toBe(
    'store: Unknown command "lst". Did you mean "list"?\nRun "store cache --help" to see the usage.\n',
  );
  await expect(mistyped(['cache', 'list', '--chaty'])).resolves.toBe(
    'store: Unknown option "--chaty". Supply a declared option; prefix a hyphenated path with "./".\nRun "store cache list --help" to see the usage.\n',
  );
});

/** The text of the man page with the given file, from the store application's page set. */
function manPage(file: string): string {
  const page = manPages(store().inspect()).find((candidate) => candidate.file === file);
  if (page === undefined) {
    throw new Error(`The page set holds no page "${file}".`);
  }
  return page.text;
}

test("a man page entry carries help's alias fact, and an alias has no page of its own", () => {
  expect(manPage('store-cache.1')).toContain(
    [
      '.TP',
      String.raw`\fBlist\fR`,
      'List the cache.  (alias: ls)',
      '.TP',
      String.raw`\fBremove\fR`,
      'Remove an entry.  (aliases: rm, delete)',
      '.TP',
      String.raw`\fBold\fR`,
      'List it.  (alias: ol, deprecated: Use list instead.)',
    ].join('\n'),
  );
  expect(manPage('store-cache-list.1')).toContain(
    [
      '.TP',
      String.raw`\fB\-\-min\-bytes\fR <\fImin\-bytes\fR>`,
      String.raw`The smallest size.  (alias: \-\-minimum)`,
      '.TP',
      String.raw`\fB\-\-[no\-]color\fR`,
      String.raw`Color the rows.  (alias: \-\-colour)`,
      '.TP',
      String.raw`\fB\-\-no\-quiet\fR`,
      String.raw`(alias: \-\-no\-silent, default: true)`,
      '.TP',
      String.raw`\fB\-\-verbose\fR...`,
      String.raw`(aliases: \-\-loud, \-\-chatty)`,
    ].join('\n'),
  );
  const files = manPages(store().inspect()).map(({ file }) => file);
  expect(files).not.toContain('store-cache-ls.1');
  expect(files).not.toContain('store-cache-dir.1');
});

test("a Command's man page DESCRIPTION opens with its alias paragraph, before its deprecation", () => {
  expect(manPage('store-cache-list.1')).toContain('.SH "DESCRIPTION"\nAlias: ls\n.SH');
  expect(manPage('store-cache-remove.1')).toContain('.SH "DESCRIPTION"\nAliases: rm, delete\n.SH');
  expect(manPage('store-cache-old.1')).toContain(
    '.SH "DESCRIPTION"\nAlias: ol\n.PP\nDeprecated: Use list instead.\n.SH',
  );
  expect(manPage('store-cache-clear.1')).not.toContain('DESCRIPTION');
});

/** The answer `__complete` writes for the words after the application name. */
function completed(words: readonly string[]): string {
  const graph = store().inspect();
  return answer(graph, locate(graph, words));
}

/** An answer that offers these lines, each a word and its description, under directive 4. */
function offering(...lines: readonly string[]): string {
  return `${lines.map((line) => `${line}\n`).join('')}:4\n`;
}

test.each([
  [
    ['cache', ''],
    ['clear\tEmpty the cache.', 'list\tList the cache.', 'remove\tRemove an entry.'],
  ],
  [['cache', 'l'], ['list\tList the cache.']],
  [['cache', 'ls'], ['ls\tList the cache.']],
  [['cache', 'r'], ['remove\tRemove an entry.']],
  [['cache', 'd'], ['delete\tRemove an entry.']],
  [['cache', 'di'], []],
  [['cache', 'o'], []],
] satisfies [string[], string[]][])(
  'a command position offers a visible alias only where the canonical name does not match: %j',
  (words, lines) => {
    expect(completed(words)).toBe(offering(...lines));
  },
);

test.each([
  [['--min'], ['--min-bytes\tThe smallest size.']],
  [['--mini'], ['--minimum\tThe smallest size.']],
  [['--mb'], []],
  [['--colo'], ['--color\tColor the rows.']],
  [['--colou'], ['--colour\tColor the rows.']],
  [['--no-c'], ['--no-color\tColor the rows.']],
  [['--no-colou'], ['--no-colour\tColor the rows.']],
  [['--no-s'], ['--no-silent']],
  [['--s'], []],
  [['--l'], ['--loud']],
  [['--c'], ['--color\tColor the rows.', '--chatty']],
  [['--prof'], ['--profile\tThe profile.']],
  [['--minimum', '5', '--mini'], []],
] satisfies [string[], string[]][])(
  'an option position offers a visible alias spelling only where no own spelling matches: %j',
  (words, lines) => {
    expect(completed(['cache', 'list', ...words])).toBe(offering(...lines));
  },
);

test('the word "-" offers the short and long spellings and no alias', () => {
  expect(completed(['cache', 'list', '-'])).not.toMatch(/--(?:minimum|colour|loud|prof)\b/u);
});

/** A manifest entry as these tests read it: its fields, and its options and children. */
interface ManifestEntry {
  readonly [field: string]: unknown;
  readonly name: string | null;
  readonly aliases: readonly string[];
  readonly options: readonly ManifestEntry[];
  readonly children: readonly ManifestEntry[];
}

/** The document `--manifest` prints for the words before it. */
async function manifestOf(
  words: readonly string[],
): Promise<{ command: ManifestEntry; globals: ManifestEntry[] }> {
  const { status, stdout } = await run([...words, '--manifest']);
  expect(status).toBe(0);
  return JSON.parse(stdout);
}

test('a manifest Command entry lists its visible aliases after name, and never an alias that is not visible or an entry of its own', async () => {
  const { command } = await manifestOf(['cache']);
  expect(command.children.map(({ aliases, name }) => [name, aliases])).toEqual([
    ['clear', []],
    ['list', ['ls']],
    ['remove', ['rm', 'delete']],
    ['old', ['ol']],
  ]);
  expect(command.aliases).toEqual([]);
  const [, list] = command.children;
  expect(Object.keys(list ?? {}).slice(0, 5)).toEqual([
    'stdin',
    'passthrough',
    'name',
    'aliases',
    'path',
  ]);
  expect(list).not.toHaveProperty('visibleAliases');
});

test('a manifest option entry lists its visible aliases as bare names after short, or after negative on a Boolean', async () => {
  const { command, globals } = await manifestOf(['cache', 'list']);
  expect(command.options.map(({ aliases, name }) => [name, aliases])).toEqual([
    ['min-bytes', ['minimum']],
    ['color', ['colour']],
    ['quiet', ['silent']],
    ['verbose', ['loud', 'chatty']],
  ]);
  expect(globals.map(({ aliases, name }) => [name, aliases])).toEqual([
    ['profile', ['prof']],
    ['help', []],
    ['manifest', []],
  ]);
  const [string, boolean, , count] = command.options;
  expect(Object.keys(string ?? {}).slice(5, 9)).toEqual(['long', 'short', 'aliases', 'required']);
  expect(Object.keys(boolean ?? {}).slice(5, 10)).toEqual([
    'long',
    'short',
    'negative',
    'aliases',
    'polarity',
  ]);
  expect(Object.keys(count ?? {}).slice(5, 9)).toEqual(['long', 'short', 'aliases', 'verbose']);
  expect(string).not.toHaveProperty('visibleAliases');
});

test('the restyle prints the whole Alias line and the alias fact dim, which the theme maps to magenta', async () => {
  const page = await run(['cache', 'ls', '-h'], { styled: true });
  expect(page.stdout).toContain('\n  \u001b[35mAlias: ls\u001b[39m\n');
  const group = await run(['cache', '-h'], { styled: true });
  expect(group.stdout).toContain('List the cache.  \u001b[35m(alias: ls)\u001b[39m\n');
});

test('a visible alias whose spelling the option already accepts is listed by neither help nor the manifest', async () => {
  const app = new Application('store', { plugins: [help(), manifest()] })
    .option('color', {
      polarity: 'both',
      type: 'boolean',
      visibleAliases: ['no-color', 'colour'],
    })
    .action(() => {});
  const listed = await runOnMock(app, { argv: ['--help'] });
  expect(listed.stdout).toMatch(/--\[no-\]color\s+\(alias: --colour\)/u);
  expect(listed.stdout).not.toContain('--no-no-color');
  const document = await runOnMock(app, { argv: ['--manifest'] });
  const { command }: { command: ManifestEntry } = JSON.parse(document.stdout);
  expect(command.options.map(({ aliases, name }) => [name, aliases])).toEqual([
    ['color', ['colour']],
  ]);
});
