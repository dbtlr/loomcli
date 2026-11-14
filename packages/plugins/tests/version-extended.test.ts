import { stripVTControlCharacters } from 'node:util';

import { Application, Command, override } from '@loomcli/core';
import type { ReleaseFacts } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { prose } from '@loomcli/plugins/prose';
import { version } from '@loomcli/plugins/version';
import { versionFacts } from '@loomcli/plugins/version/views';
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

test('a Command that declares no result prints the block under --format json', async () => {
  const { stdout } = await printed(application(), {
    argv: ['--format', 'json', '--version'],
    runtime: bun,
  });
  expect(stdout.startsWith('notes v1.1.0-next.3\nchannel')).toBe(true);
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
