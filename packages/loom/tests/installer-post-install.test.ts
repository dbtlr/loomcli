/*
 * Acceptance plan for the installer script's post-install step
 * (docs/toolchain/install.md#the-post-install-command and #the-post-install-message).
 *
 * The step is proven when process runs of a rendered `install.sh` under `/bin/sh`, with the fakes
 * of installer-sandbox.ts first on `PATH` and a fake released binary that records its words, its
 * stdin, its working directory, and the `install.json` it finds, produce these results:
 *
 * - No declaration. The script an Application with no post-install declaration gets is byte for
 *   byte the script an earlier toolchain rendered.
 * - The message. It prints last, after the PATH advice, each of its lines opening with the name.
 * - The command. It is announced with a copyable command line and runs once, with the declared
 *   words byte for byte, after `install.json` is written, in the script's working directory, and
 *   its output passes through. With no terminal, its stdin is `/dev/null`, under `sh install.sh`
 *   and under `curl | sh` alike. On a real pseudo-terminal under `cat install.sh | sh`, it reads
 *   `/dev/tty`.
 * - A failure warns with the status and the command line, and the script exits 0. A signal the
 *   script receives while the command runs exits 1 and leaves the install in place.
 * - `--skip-post-install` skips the command and prints the line to run it. In a script whose
 *   application declares no command it is an unknown option, and `--help` lists it only where it
 *   exists.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PostInstall } from '@loomcli/core';
import { afterEach, expect, test } from 'vite-plus/test';

import { zsh } from '../../../scripts/test-pty.js';
import { findOnPath, sealedShellEnvironment } from '../../../scripts/test-shell.js';
import { installerScript } from '../src/content/installer-script.js';
import { renderManaged } from '../src/helpers/managed.js';
import { removeRoots } from './fixture.js';
import {
  app,
  binaryRecord,
  entries,
  latest,
  publish,
  recordingBinary,
  release,
  repo,
  runDetached,
  runScript,
  runScriptUntilSignal,
  sandbox,
  sha256,
} from './installer-sandbox.js';
import type { Sandbox } from './installer-sandbox.js';

afterEach(() => {
  removeRoots();
});

const asset = `${app}-linux-x64`;

/** The installation record's directory for the sandbox on the fake Linux the tests default to. */
function recordDirectory(box: Sandbox) {
  return join(box.state, app, 'installation');
}

/** The default install directory under the sandbox's home. */
function defaultDirectory(box: Sandbox) {
  return join(box.home, '.local', 'bin');
}

/**
 * A sandbox whose script declares `postInstall` and whose latest release serves the fake released
 * binary, which finds `install.json` where the script records it.
 */
function postInstallSandbox(postInstall: PostInstall | undefined) {
  const box = sandbox({}, renderManaged(installerScript(app, repo, postInstall)));
  const binary = recordingBinary(box, join(recordDirectory(box), 'install.json'));
  publish(box.release, release(latest, { [asset]: binary }));
  return box;
}

/** The lines every successful install into the default directory prints first, PATH advice included. */
function installLines(box: Sandbox) {
  const directory = defaultDirectory(box);
  return [
    `notes: Downloading ${asset} from the latest release of ${repo}.`,
    `notes: Installed ${directory}/${app}.`,
    `notes: ${directory} is not on PATH. Add it to your shell's PATH to run notes:`,
    `  export PATH="${directory}:$PATH"`,
  ];
}

test('an Application with no post-install declaration gets the script an earlier toolchain rendered, byte for byte', () => {
  // The digest of the script before the post-install step existed.
  const earlier = '577782aa8d38b434894dca7259a782ef6985e0632ee22db442251d2154c04be5';
  expect(sha256(renderManaged(installerScript('notes', 'me/notes')))).toBe(earlier);
  expect(sha256(renderManaged(installerScript('notes', 'me/notes', undefined)))).toBe(earlier);
});

test('the message prints last, after the PATH advice, each of its lines opening with the name', () => {
  const box = postInstallSandbox({ message: "Run notes init in a project.\nIt's quick." });
  const result = runScript(box);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    [...installLines(box), 'notes: Run notes init in a project.', "notes: It's quick.", ''].join(
      '\n',
    ),
  );
  expect(binaryRecord(box).argv).toBeUndefined();
});

test.each([
  ['a trailing line break ends the last line', 'Run x.\n', ['notes: Run x.']],
  ['a blank line inside the message stays', 'a\n\nb', ['notes: a', 'notes: ', 'notes: b']],
])('the message: %s', (_name, message, lines) => {
  const box = postInstallSandbox({ message });
  const result = runScript(box);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe([...installLines(box), ...lines, ''].join('\n'));
});

test('the command is announced and runs once with the declared words after install.json is written, and the message follows it', async () => {
  const box = postInstallSandbox({ command: ['setup'], message: 'Run notes init next.' });
  const result = await runDetached(box);
  const target = join(defaultDirectory(box), app);
  expect(result).toEqual({
    status: 0,
    stderr: [
      ...installLines(box),
      'notes: Running the post-install command:',
      `  ${target} setup`,
      'notes: Run notes init next.',
      '',
    ].join('\n'),
    stdout: 'Set up notes.\n',
  });
  const recorded = binaryRecord(box);
  expect(recorded.argv).toEqual(['setup']);
  expect(recorded.cwd).toBe(box.work);
  expect(recorded.record).toBe(readFileSync(join(recordDirectory(box), 'install.json'), 'utf8'));
});

test.each([
  ['sh install.sh with piped input', { input: 'typed\n', reading: 'path' }],
  ['curl | sh, whose stdin holds the script', { reading: 'stdin' }],
] as const)('with no terminal, under %s, the command reads /dev/null', async (_case, run) => {
  const box = postInstallSandbox({ command: ['setup'] });
  const result = await runDetached(box, run);
  expect(result.status).toBe(0);
  expect(binaryRecord(box)).toMatchObject({ argv: ['setup'], input: '', stdin: 'device' });
});

test('a command that fails warns with its status and the command line, goes on to the message, and exits 0', async () => {
  const box = postInstallSandbox({ command: ['setup'], message: 'Run notes init next.' });
  const result = await runDetached(box, { env: { LOOM_FAKE_STATUS: '3' } });
  const target = join(defaultDirectory(box), app);
  expect(result.status).toBe(0);
  expect(result.stderr.split('\n').slice(4)).toEqual([
    'notes: Running the post-install command:',
    `  ${target} setup`,
    'notes: The post-install command failed with exit status 3, and notes is installed. Run it again to finish setting up notes:',
    `  ${target} setup`,
    'notes: Run notes init next.',
    '',
  ]);
  expect(readFileSync(target, 'utf8')).toContain('#!/bin/sh');
  expect(entries(recordDirectory(box))).toEqual(['install.json']);
});

test('--skip-post-install runs nothing and prints the line to run the command, then the message', () => {
  const box = postInstallSandbox({ command: ['setup'], message: 'Run notes init next.' });
  const result = runScript(box, ['--skip-post-install']);
  const target = join(defaultDirectory(box), app);
  expect(result.status).toBe(0);
  expect(result.stderr.split('\n').slice(4)).toEqual([
    'notes: Skipped the post-install command. Run it to finish setting up notes:',
    `  ${target} setup`,
    'notes: Run notes init next.',
    '',
  ]);
  expect(binaryRecord(box).argv).toBeUndefined();
  expect(entries(recordDirectory(box))).toEqual(['install.json']);
});

/** The usage line of a script whose application declares a post-install command. */
const usage = 'Usage: install.sh [--dir <directory>] [--skip-post-install] [<version>]';

test.each([
  ['no declaration', undefined],
  ['a message alone', { message: 'Run notes init next.' }],
])(
  'in a script with %s, --skip-post-install is an unknown option and --help does not list it',
  (_case, postInstall) => {
    const box = postInstallSandbox(postInstall);
    const result = runScript(box, ['--skip-post-install']);
    expect(result).toEqual({
      status: 2,
      stderr:
        'notes: install.sh has no option --skip-post-install.\nnotes: Usage: install.sh [--dir <directory>] [<version>]\n',
      stdout: '',
    });
    expect(runScript(box, ['--help']).stdout).not.toContain('--skip-post-install');
  },
);

test('a script whose application declares a command lists --skip-post-install in its usage and its help', () => {
  const box = postInstallSandbox({ command: ['setup'] });
  const help = runScript(box, ['--help']);
  expect(help.status).toBe(0);
  expect(help.stdout).toContain(`${usage}\n`);
  expect(help.stdout).toContain(
    '\n  --skip-post-install  Install without running the post-install command.\n',
  );
  expect(runScript(box, ['--force']).stderr).toBe(
    `notes: install.sh has no option --force.\nnotes: ${usage}\n`,
  );
});

test('words that hold a space, a quote, or a dollar sign reach the command byte for byte, and the command line runs the same words', async () => {
  const words: [string, ...string[]] = [
    'setup',
    "it's a test",
    '--name=a b',
    '$HOME',
    '',
    'tab\there',
    'line\nbreak',
    '--plain=x',
  ];
  const box = postInstallSandbox({ command: words });
  const directory = join(box.root, 'my bin');
  const result = await runDetached(box, { args: ['--dir', directory] });
  expect(result.status).toBe(0);
  expect(binaryRecord(box).argv).toEqual(words);
  // Nothing follows the command line, so it runs to the end of what the script wrote.
  const announced = result.stderr.split('notes: Running the post-install command:\n')[1] ?? '';
  const line = announced.slice(0, -1);
  expect(line).toBe(
    `  '${directory}/notes' setup 'it'\\''s a test' '--name=a b' '$HOME' '' 'tab\there' 'line\nbreak' --plain=x`,
  );
  // The printed line, run by sh, passes the same words again.
  const again = spawnSync('/bin/sh', ['-c', line], {
    cwd: box.work,
    env: { HOME: box.home, PATH: box.path },
    input: '',
  });
  expect(again.status).toBe(0);
  expect(binaryRecord(box).argv).toEqual(words);
});

test('a signal the script receives while the command runs exits 1 and leaves the binary and install.json in place', async () => {
  const box = postInstallSandbox({ command: ['setup'], message: 'Run notes init next.' });
  const { status, stderr } = await runScriptUntilSignal(box, 'group', { LOOM_FAKE_SLEEP: '30' });
  expect(status).toBe(1);
  expect(stderr).not.toContain('Run notes init next.');
  expect(entries(defaultDirectory(box))).toEqual([app]);
  expect(entries(recordDirectory(box))).toEqual(['install.json']);
});

/** The pseudo-terminal driver the shell completion tests use. */
const driver = new URL('../../../scripts/zpty-driver.zsh', import.meta.url).pathname;

test.skipIf(zsh === undefined)(
  'on a real pseudo-terminal under cat install.sh | sh, the command reads the terminal',
  () => {
    const box = postInstallSandbox({ command: ['setup'], message: 'Run notes init next.' });
    const cat = findOnPath('cat');
    const env = findOnPath('env');
    if (cat === undefined || env === undefined) {
      throw new Error('The pseudo-terminal case needs cat and env on PATH.');
    }
    mkdirSync(join(box.root, 'driver-home'));
    const command = [
      env,
      '-i',
      `HOME=${box.home}`,
      `PATH=${box.path}`,
      `XDG_STATE_HOME=${box.state}`,
      'LOOM_FAKE_PROMPT=Name the project:',
      '/bin/sh',
      '-c',
      `cd "$1" && ${cat} "$0" | /bin/sh`,
      box.script,
      box.work,
    ];
    const result = spawnSync(zsh ?? 'zsh', [driver, ...command], {
      encoding: 'utf8',
      env: sealedShellEnvironment(join(box.root, 'driver-home')),
      input:
        'expect Name the project:\nsend typed at the terminal\\n\nexpect Run notes init next.\nquit\n',
      timeout: 30_000,
    });
    expect(result.stdout).not.toContain('@@TIMEOUT@@');
    expect(result.stdout).not.toContain('@@EXITED@@');
    expect(binaryRecord(box)).toMatchObject({
      argv: ['setup'],
      input: 'typed at the terminal',
      stdin: 'terminal',
    });
  },
);
