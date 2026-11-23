import { stripVTControlCharacters } from 'node:util';

import { Application, Command, override, style } from '@loomcli/core';
import type { ReleaseFacts } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { prose } from '@loomcli/plugins/prose';
import { theme } from '@loomcli/plugins/theme';
import { version } from '@loomcli/plugins/version';
import { versionFacts, versionLine } from '@loomcli/plugins/version/views';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/*
 * Acceptance plan for the extended version output (docs/plugins/version.md#extended-output). Every
 * case builds its host through mockProcess, so no value comes from the process the test runs in.
 *
 * - The block. A distributed release and a source run, on and off a terminal, under `--version`
 *   and `-V`.
 * - Absent facts. The release group, the asset, the installation, and the runtime.
 * - The JSON form. Both media types, the key order, `null`, and the formatter's order rule.
 * - The settings. Without `extended` the line is unchanged, and an override restyles the block.
 */

const distributed: ReleaseFacts = {
  build: 'distributed',
  installation: { digest: 'sha256:0', method: 'script', path: '/loom-test/bin/notes' },
  release: {
    asset: 'notes-linux-x64',
    channel: 'next',
    repository: 'acme/notes',
    version: '1.1.0-next.3',
  },
};

/** The application under test, with the formatter ahead of the version plugin as the contract says. */
function application(settings: Parameters<typeof version>[0] = { extended: true }) {
  return new Application('notes', {
    plugins: [format(), version(settings)],
    version: '1.1.0-next.3',
  })
    .command(new Command('list').result<string>({ views: { text: prose() } }).action(() => 'a'))
    .action(() => {});
}

/** One run's exit code and streams. */
async function printed(
  app: Pick<ReturnType<typeof application>, 'run'>,
  fields: Parameters<typeof mockProcess>[0],
) {
  const mock = mockProcess({ env: { NO_COLOR: '1' }, ...fields });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

const bun = { name: 'bun', version: '1.3.2' } as const;

const distributedBlock = [
  'notes v1.1.0-next.3',
  'channel              next',
  'build                distributed',
  'asset                notes-linux-x64',
  'installation method  script',
  'runtime              bun 1.3.2',
  'platform             linux-x64',
  '',
].join('\n');

test('a distributed release prints the line and the six rows, for --version and -V alike', async () => {
  for (const flag of ['--version', '-V']) {
    await expect(
      printed(application(), { argv: [flag], release: distributed, runtime: bun }),
    ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedBlock });
  }
});

test('a source run on a terminal ends each absent fact at its label', async () => {
  const { stdout } = await printed(application(), {
    argv: ['--version'],
    runtime: bun,
    terminal: { columns: 80, rows: 24 },
  });
  expect(stripVTControlCharacters(stdout)).toBe(
    [
      'notes v1.1.0-next.3',
      'channel',
      'build                source',
      'asset',
      'installation method',
      'runtime              bun 1.3.2',
      'platform             linux-x64',
      '',
    ].join('\n'),
  );
});

test('a source run off a terminal keeps the padding and the gap of each absent fact', async () => {
  const { stdout } = await printed(application(), { argv: ['--version'], runtime: bun });
  expect(stdout).toBe(
    [
      'notes v1.1.0-next.3',
      'channel              ',
      'build                source',
      'asset                ',
      'installation method  ',
      'runtime              bun 1.3.2',
      'platform             linux-x64',
      '',
    ].join('\n'),
  );
});

test('a release group without an asset, and a handle without a runtime, leave those facts absent', async () => {
  const bundle: ReleaseFacts = {
    build: 'distributed',
    release: { channel: 'stable', repository: 'acme/notes', version: '1.0.0' },
  };
  const { stdout } = await printed(application(), {
    arch: 'arm64',
    argv: ['--version'],
    platform: 'darwin',
    release: bundle,
    runtime: undefined,
  });
  expect(stdout.split('\n').slice(1)).toEqual([
    'channel              stable',
    'build                distributed',
    'asset                ',
    'installation method  ',
    'runtime              ',
    'platform             darwin-arm64',
    '',
  ]);
});

test('a routed Command prints the same bytes as the root', async () => {
  const { stdout } = await printed(application(), {
    argv: ['list', '--version'],
    release: distributed,
    runtime: bun,
  });
  expect(stdout).toBe(distributedBlock);
});

test('the postfix stays on the first line', async () => {
  const { stdout } = await printed(application({ extended: true, postfix: '(Report schema v1)' }), {
    argv: ['--version'],
    release: distributed,
    runtime: bun,
  });
  expect(stdout.split('\n')[0]).toBe('notes v1.1.0-next.3 (Report schema v1)');
});

test('without extended the line is unchanged, whatever the facts and the format', async () => {
  for (const argv of [['--version'], ['list', '--format', 'json', '--version']]) {
    for (const settings of [{}, { extended: false }]) {
      await expect(
        printed(application(settings), { argv, release: distributed, runtime: bun }),
      ).resolves.toEqual({ code: 0, stderr: '', stdout: 'notes v1.1.0-next.3\n' });
    }
  }
});

/** The eight keys of the JSON object, in the order the contract fixes. */
const jsonKeys = [
  'name',
  'version',
  'channel',
  'build',
  'asset',
  'installationMethod',
  'runtime',
  'platform',
];

test('--format json prints one indented object with the eight keys in their fixed order', async () => {
  const { stdout } = await printed(application(), {
    argv: ['list', '--format', 'json', '--version'],
    release: distributed,
    runtime: bun,
  });
  expect(stdout).toBe(
    [
      '{',
      '  "name": "notes",',
      '  "version": "1.1.0-next.3",',
      '  "channel": "next",',
      '  "build": "distributed",',
      '  "asset": "notes-linux-x64",',
      '  "installationMethod": "script",',
      '  "runtime": "bun 1.3.2",',
      '  "platform": "linux-x64"',
      '}',
      '',
    ].join('\n'),
  );
  expect(Object.keys(JSON.parse(stdout))).toEqual(jsonKeys);
});

test('--format jsonl prints the same object on one line, with null for each absent fact', async () => {
  const { stdout } = await printed(application(), {
    argv: ['list', '--format', 'jsonl', '-V'],
    runtime: undefined,
  });
  expect(stdout).toBe(
    '{"name":"notes","version":"1.1.0-next.3","channel":null,"build":"source","asset":null,"installationMethod":null,"runtime":null,"platform":"linux-x64"}\n',
  );
  expect(Object.keys(JSON.parse(stdout))).toEqual(jsonKeys);
});

test('the JSON version is the declared string, with no v added and no postfix', async () => {
  const app = new Application('notes', {
    plugins: [format(), version({ extended: true, postfix: '(schema)' })],
    version: 'v0.2.0',
  })
    .command(new Command('list').result<string>({ views: { text: prose() } }).action(() => 'a'))
    .action(() => {});
  const { stdout } = await printed(app, { argv: ['list', '--format', 'json', '--version'] });
  expect(JSON.parse(stdout)).toMatchObject({ version: 'v0.2.0' });
  expect(stdout).not.toContain('schema');
});

test('the formatter has to be installed ahead of the version plugin to be read', async () => {
  const app = new Application('notes', {
    plugins: [version({ extended: true }), format()],
    version: '1.1.0-next.3',
  })
    .command(new Command('list').result<string>({ views: { text: prose() } }).action(() => 'a'))
    .action(() => {});
  const { stdout } = await printed(app, {
    argv: ['list', '--format', 'json', '--version'],
    runtime: bun,
  });
  expect(stdout.startsWith('notes v1.1.0-next.3\nchannel')).toBe(true);
});

test('a Command with an action that declares no result prints the block under --format json', async () => {
  await expect(
    printed(application(), {
      argv: ['--format', 'json', '--version'],
      release: distributed,
      runtime: bun,
    }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedBlock });
});

/** A group application: the root registers no action, `list` declares a result, `cache` is a group. */
function group(plugins: Parameters<typeof version>[0] | 'without-format' = { extended: true }) {
  const installed =
    plugins === 'without-format' ? [version({ extended: true })] : [format(), version(plugins)];
  return new Application('notes', { plugins: installed, version: '1.1.0-next.3' })
    .command(new Command('list').result<string>({ views: { text: prose() } }).action(() => 'a'))
    .command(new Command('cache').command(new Command('clear').action(() => {})));
}

const distributedDocument = [
  '{',
  '  "name": "notes",',
  '  "version": "1.1.0-next.3",',
  '  "channel": "next",',
  '  "build": "distributed",',
  '  "asset": "notes-linux-x64",',
  '  "installationMethod": "script",',
  '  "runtime": "bun 1.3.2",',
  '  "platform": "linux-x64"',
  '}',
  '',
].join('\n');

const distributedLine =
  '{"name":"notes","version":"1.1.0-next.3","channel":"next","build":"distributed","asset":"notes-linux-x64","installationMethod":"script","runtime":"bun 1.3.2","platform":"linux-x64"}\n';

test('--version --format json and jsonl at the root of a group application print the object', async () => {
  const facts = { release: distributed, runtime: bun };
  for (const argv of [
    ['--version', '--format', 'json'],
    ['--format', 'json', '--version'],
  ]) {
    await expect(printed(group(), { argv, ...facts })).resolves.toEqual({
      code: 0,
      stderr: '',
      stdout: distributedDocument,
    });
  }
  for (const argv of [
    ['--format', 'jsonl', '-V'],
    ['--format', 'ndjson', '--version'],
  ]) {
    await expect(printed(group(), { argv, ...facts })).resolves.toEqual({
      code: 0,
      stderr: '',
      stdout: distributedLine,
    });
  }
});

test('a nested group prints the object as the root does', async () => {
  await expect(
    printed(group(), {
      argv: ['cache', '--version', '--format', 'jsonl'],
      release: distributed,
      runtime: bun,
    }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedLine });
});

test('under a Command with a result, the JSON form is the same bytes in a group application', async () => {
  const facts = { release: distributed, runtime: bun };
  await expect(
    printed(group(), { argv: ['list', '--format', 'json', '--version'], ...facts }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedDocument });
  await expect(
    printed(group(), { argv: ['list', '--format', 'jsonl', '-V'], ...facts }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedLine });
  await expect(
    printed(group(), { argv: ['--format', 'json', 'list', '--version'], ...facts }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedDocument });
});

test('a format the formatter does not know prints the line and the block under --version, and fails without it', async () => {
  const facts = { release: distributed, runtime: bun };
  await expect(
    printed(group(), { argv: ['--version', '--format', 'yaml'], ...facts }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedBlock });
  await expect(printed(group(), { argv: ['--format', 'yaml'], ...facts })).resolves.toEqual({
    code: 2,
    stderr: 'notes: A command is required. Use one of: list, cache.\n',
    stdout: '',
  });
});

test('without the formatter, --format at a group root is an unknown option the takeover leaves held', async () => {
  const facts = { release: distributed, runtime: bun };
  await expect(
    printed(group('without-format'), { argv: ['--version', '--format', 'json'], ...facts }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedBlock });
  const failed = await printed(group('without-format'), { argv: ['--format', 'json'], ...facts });
  expect(failed.code).toBe(2);
  expect(failed.stderr).toContain('Unknown option "--format".');
});

test("without the formatter, an author's own JSON view under a Command with a result selects the object", async () => {
  const app = new Application('notes', {
    plugins: [version({ extended: true })],
    version: '1.1.0-next.3',
  })
    .command(
      new Command('list')
        .result<string>({
          views: { json: { mediaType: 'application/json', render: (data) => `${data}\n` } },
        })
        .action(() => 'a'),
    )
    .command(new Command('add').action(() => {}));
  await expect(
    printed(app, { argv: ['list', '--version'], release: distributed, runtime: bun }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: distributedDocument });
});

test('an override of versionLine renders the first line of the extended output, above the block', async () => {
  const app = new Application('notes', {
    plugins: [format(), version({ extended: true })],
    version: '1.1.0-next.3',
    views: [override(versionLine, { render: ({ graph }) => `${graph.name} release\n` })],
  }).action(() => {});
  const { stdout } = await printed(app, {
    argv: ['--version'],
    release: distributed,
    runtime: bun,
  });
  expect(stdout).toBe(distributedBlock.replace('notes v1.1.0-next.3\n', 'notes release\n'));
});

test("the block's values are styled primary and its labels dim", async () => {
  const app = new Application('notes', {
    plugins: [version({ extended: true }), theme({ dim: style.red, primary: style.green })],
    version: '1.1.0-next.3',
  }).action(() => {});
  const mock = mockProcess({
    argv: ['--version'],
    env: { FORCE_COLOR: '1' },
    release: distributed,
    runtime: bun,
  });
  await app.run({ process: mock });
  const rows = mock.stdout.text.split('\n').slice(1, -1);
  // The label is padded inside its dim style, then the two-space gap, then the primary value.
  expect(rows[0]).toBe('\u001B[31mchannel            \u001B[39m  \u001B[32mnext\u001B[39m');
  expect(rows.at(-1)).toBe(
    '\u001B[31mplatform           \u001B[39m  \u001B[32mlinux-x64\u001B[39m',
  );
  expect(stripVTControlCharacters(mock.stdout.text)).toBe(distributedBlock);
});

test('an override of versionFacts restyles the block and never the JSON object', async () => {
  const app = new Application('notes', {
    plugins: [format(), version({ extended: true })],
    version: '1.1.0-next.3',
    views: [
      override(versionFacts, {
        render: ({ platform, runtime }) => `${platform} on ${runtime}\n`,
      }),
    ],
  })
    .command(new Command('list').result<string>({ views: { text: prose() } }).action(() => 'a'))
    .action(() => {});
  await expect(printed(app, { argv: ['--version'], runtime: bun })).resolves.toMatchObject({
    stdout: 'notes v1.1.0-next.3\nlinux-x64 on bun 1.3.2\n',
  });
  const json = await printed(app, { argv: ['list', '--format', 'json', '--version'] });
  expect(Object.keys(JSON.parse(json.stdout))).toEqual(jsonKeys);
});
