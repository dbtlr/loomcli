// @module-tag docs

/*
 * Acceptance plan for the installer script (docs/toolchain/install.md).
 *
 * The installer script is proven when process runs of a rendered `install.sh` under `/bin/sh` on
 * Linux and macOS produce these results, with a fake `uname`, `sysctl`, `ldd`, `curl`, and `wget`
 * first on `PATH` that serve a fixture release and record each URL they are asked for:
 *
 * - Installing. With no arguments, the script fetches `releases/latest/download/` URLs, writes a
 *   binary with mode `755` and the fixture's bytes to `$HOME/.local/bin/<name>`, and writes
 *   `install.json` with the bytes the recipe pins. `1.4.0`, `v1.4.0`, and `--dir` with an absolute
 *   directory each fetch the `releases/download/v1.4.0/` URLs or install into that directory. A
 *   second install replaces the binary and the record.
 * - Refusing. A digest mismatch, an asset `SHA256SUMS` does not list or lists twice with different
 *   digests, a failed download, an unknown operating system or architecture, and a directory at the
 *   binary's path each exit 1. An unknown option, a relative `--dir`, a second version, and a
 *   version holding `/` each exit 2. Each leaves the install directory as it was, or empty when the
 *   script created it, writes no `install.json`, and leaves no staging file. With no `--dir`, a
 *   relative `HOME` exits 1 with nothing downloaded, and so does an unset `HOME` with an absolute
 *   `XDG_STATE_HOME`. A run ended by `SIGTERM` during the download leaves no staging file.
 * - The platform. Each `uname` row fetches its asset. `sysctl.proc_translated` printing `1` on
 *   `Darwin` `x86_64` fetches `darwin-arm64`, and a failing `sysctl` there fetches `darwin-x64`. An
 *   `ldd --version` that mentions `musl` fetches the `-musl` asset, and a missing `ldd` fetches the
 *   glibc asset.
 * - Downloaders. With no `curl`, a `wget` whose `--version` names GNU Wget downloads with it. A
 *   BusyBox `wget`, and no downloader at all, exit 1 and name `curl`. A `SHA256SUMS` request
 *   answered with an HTTP error exits 1 with the script's download sentence.
 * - PATH. An install directory that is not on `PATH` prints the `export` line. One that is on
 *   `PATH` prints none, also when `--dir` was given with a trailing slash. Another file of the same
 *   name earlier on `PATH` is named.
 * - The record. For each case of the installation record directory acceptance, unset, empty,
 *   relative, and absolute `XDG_STATE_HOME` and `HOME`, run with an absolute `--dir`, the directory
 *   the script writes `install.json` into is the one `applicationDirectory('installation', name,
 *   host)` gives for that `env` on the running platform, and a case the resolver answers with `{
 *   variable }` exits 1 with nothing downloaded. The rendered script holds both parts of the recipe
 *   in `docs/core/installation-record.md` byte for byte. A rendered script cut short at any line
 *   runs nothing.
 * - Init. The loom init acceptance plan in packages/loom/tests/init.test.ts covers rendering,
 *   drift, and the missing repository.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applicationDirectory } from '@loomcli/core';
import { afterEach, expect, test } from 'vite-plus/test';

import { installationRecipeParts } from '../../../scripts/test-installation.js';
import { findOnPath } from '../../../scripts/test-shell.js';
import { installerScript } from '../src/content/installer-script.js';
import { renderManaged } from '../src/helpers/managed.js';
import { removeRoots } from './fixture.js';
import {
  app,
  commandLines,
  entries,
  latest,
  release,
  repo,
  requested,
  runScript,
  runScriptUntilSignal,
  sandbox,
  scriptTools,
  sha256,
  tagged,
} from './installer-sandbox.js';
import type { Sandbox } from './installer-sandbox.js';

afterEach(() => {
  removeRoots();
});

/** The SHA-256 digest of the four bytes `test`, the default fixture binary, as the installation record reference pins it. */
const testDigest = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

/** The default install directory under the sandbox's home. */
function defaultDirectory(box: Sandbox) {
  return join(box.home, '.local', 'bin');
}

/** The installation record's directory for the sandbox on the fake Linux the tests default to. */
function recordDirectory(box: Sandbox) {
  return join(box.state, app, 'installation');
}

/** The bytes `install.json` holds for a binary at `path` whose digest is `digest`. */
function recordBytes(path: string, digest = testDigest) {
  return `{"format":1,"method":"script","path":"${path}","digest":"sha256:${digest}"}\n`;
}

test('with no arguments the script installs the latest release into ~/.local/bin and records it', () => {
  const box = sandbox();
  const result = runScript(box);
  const target = join(defaultDirectory(box), app);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(requested(box)).toEqual([`${latest}SHA256SUMS`, `${latest}${app}-linux-x64`]);
  expect(readFileSync(target, 'utf8')).toBe('test');
  expect(statSync(target).mode & 0o777).toBe(0o755);
  expect(readFileSync(join(recordDirectory(box), 'install.json'), 'utf8')).toBe(
    recordBytes(target),
  );
  expect(entries(defaultDirectory(box))).toEqual([app]);
  expect(entries(recordDirectory(box))).toEqual(['install.json']);
});

test('the rendered script holds both parts of the recipe in docs/core/installation-record.md byte for byte', () => {
  const script = installerScript(app, repo);
  const { prepare, record } = installationRecipeParts();
  expect(script).toContain(prepare);
  expect(script).toContain(record);
  expect(script.indexOf(prepare)).toBeLessThan(script.indexOf(record));
});

/**
 * The byte offsets a rendered script may be cut at to test truncation: the start of every line, and
 * every byte of the last line short of its closing brace, so a cut inside `{ main "$@"; }` counts
 * too. A cut that keeps the brace keeps the whole script, which is meant to run.
 */
function cuts(script: Buffer): number[] {
  const last = script.lastIndexOf('\n', script.length - 2) + 1;
  const starts = [0];
  for (let offset = script.indexOf('\n'); offset !== -1 && offset < last;) {
    starts.push(offset + 1);
    offset = script.indexOf('\n', offset + 1);
  }
  const closing = script.lastIndexOf('}');
  const inside = Array.from({ length: closing - last }, (_unused, index) => last + index + 1);
  return [...new Set([...starts, ...inside])].filter((offset) => offset <= closing);
}

test('a rendered script cut short at any line, or anywhere in its last line, runs nothing', () => {
  const rendered = Buffer.from(renderManaged(installerScript(app, repo)));
  expect(rendered.toString().endsWith('\n{ main "$@"; }\n')).toBe(true);
  const box = sandbox();
  for (const cut of cuts(rendered)) {
    writeFileSync(box.script, rendered.subarray(0, cut));
    runScript(box);
    expect({ cut, requested: requested(box) }).toEqual({ cut, requested: [] });
    expect({ cut, written: entries(box.home) }).toEqual({ cut, written: [] });
    expect({ cut, written: entries(box.state) }).toEqual({ cut, written: [] });
  }
});

test('1.4.0 and v1.4.0 each fetch the release of the tag v1.4.0', () => {
  for (const version of ['1.4.0', 'v1.4.0']) {
    const box = sandbox();
    expect(runScript(box, [version]).status).toBe(0);
    expect(requested(box)).toEqual([`${tagged}SHA256SUMS`, `${tagged}${app}-linux-x64`]);
  }
});

test('--dir with an absolute directory installs into it, creating it, and records that path', () => {
  const box = sandbox();
  const directory = join(box.root, 'opt', 'notes', 'bin');
  expect(runScript(box, ['--dir', directory, '1.4.0']).status).toBe(0);
  expect(readFileSync(join(directory, app), 'utf8')).toBe('test');
  expect(readFileSync(join(recordDirectory(box), 'install.json'), 'utf8')).toBe(
    recordBytes(join(directory, app)),
  );
  expect(entries(defaultDirectory(box))).toBeUndefined();
});

/** The usage line, as `--help` opens it and an argument error repeats it. */
const usage = 'Usage: install.sh [--dir <directory>] [<version>]';

test.each([['--help'], ['-h']])(
  '%s prints the usage to stdout, exits 0, and downloads nothing',
  (flag) => {
    const box = sandbox();
    const result = runScript(box, [flag]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`${usage}\n`);
    expect(result.stdout).toContain('--dir <directory>');
    expect(requested(box)).toEqual([]);
  },
);

test.each([
  ['an unknown option', ['--force']],
  ['a --dir without a value', ['--dir']],
  ['a relative --dir', ['--dir', 'bin']],
  ['an empty --dir', ['--dir', '']],
  ['a second version', ['1.4.0', '1.5.0']],
  ['a version holding /', ['1.4.0/../x']],
  ['a version holding a space', ['1.4 0']],
  ['an empty version', ['']],
  ['a bare v', ['v']],
])('%s prints one sentence and the usage line to stderr and exits 2', (_case, args) => {
  const box = sandbox();
  const result = runScript(box, args);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  const lines = result.stderr.split('\n');
  expect(lines).toHaveLength(3);
  expect(lines[0]).toMatch(/^notes: .+\.$/u);
  expect(lines.slice(1)).toEqual([`notes: ${usage}`, '']);
  expect(requested(box)).toEqual([]);
  expect(entries(box.home)).toEqual([]);
  expect(entries(box.state)).toEqual([]);
});

test('a version may hold letters, digits, ., -, and +', () => {
  const box = sandbox();
  runScript(box, ['1.5.0-next.2+build.7']);
  expect(requested(box)[0]).toBe(
    `https://github.com/${repo}/releases/download/v1.5.0-next.2+build.7/SHA256SUMS`,
  );
});

/** A latest release that carries every asset the release shape names, each holding `test`. */
const everyAsset = release(
  latest,
  Object.fromEntries(
    [
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
      'linux-arm64',
      'linux-x64-musl',
      'linux-arm64-musl',
    ].map((platform) => [`${app}-${platform}`, 'test']),
  ),
);

test.each([
  ['Darwin', 'arm64', {}, 'darwin-arm64'],
  ['Darwin', 'x86_64', { translated: '1' }, 'darwin-arm64'],
  ['Darwin', 'x86_64', { translated: '0' }, 'darwin-x64'],
  ['Darwin', 'x86_64', {}, 'darwin-x64'],
  ['Linux', 'x86_64', {}, 'linux-x64'],
  ['Linux', 'amd64', {}, 'linux-x64'],
  ['Linux', 'aarch64', {}, 'linux-arm64'],
  ['Linux', 'arm64', {}, 'linux-arm64'],
  ['Linux', 'x86_64', { libc: 'musl' }, 'linux-x64-musl'],
  ['Linux', 'aarch64', { libc: 'musl' }, 'linux-arm64-musl'],
  ['Linux', 'x86_64', { libc: 'missing' }, 'linux-x64'],
] as const)('uname %s %s with %j fetches %s', (os, arch, fakes, platform) => {
  const box = sandbox({ arch, os, release: everyAsset, ...fakes });
  const result = runScript(box, ['--dir', join(box.root, 'bin')]);
  expect(result.stderr).toContain(`notes: Downloading ${app}-${platform} from the latest release`);
  expect(result.status).toBe(0);
  expect(requested(box)).toEqual([`${latest}SHA256SUMS`, `${latest}${app}-${platform}`]);
});

test.each([
  ['an unknown operating system', 'FreeBSD', 'amd64', 'FreeBSD'],
  ['an unknown architecture on Linux', 'Linux', 'ppc64le', 'ppc64le'],
  ['an unknown architecture on Darwin', 'Darwin', 'i386', 'i386'],
])('%s exits 1, names what uname printed, and downloads nothing', (_case, os, arch, named) => {
  const box = sandbox({ arch, os, release: everyAsset });
  const directory = join(box.root, 'bin');
  const result = runScript(box, ['--dir', directory]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(named);
  expect(result.stderr.split('\n')).toHaveLength(2);
  expect(requested(box)).toEqual([]);
  expect(entries(directory)).toBeUndefined();
  expect(entries(box.state)).toEqual([]);
});

test('curl downloads over HTTPS alone, with --fail, and is preferred over wget', () => {
  const box = sandbox();
  expect(runScript(box).status).toBe(0);
  const lines = commandLines(box);
  expect(lines).toHaveLength(2);
  expect(lines).toEqual(
    [`${latest}SHA256SUMS`, `${latest}${app}-linux-x64`].map(
      (url) =>
        `curl --fail --location --silent --proto =https --proto-redir =https --tlsv1.2 ${url}`,
    ),
  );
});

test('with no curl, a wget whose --version names GNU Wget downloads with it', () => {
  const box = sandbox({ downloaders: ['gnu-wget'] });
  expect(runScript(box).status).toBe(0);
  expect(requested(box)).toEqual([`${latest}SHA256SUMS`, `${latest}${app}-linux-x64`]);
  expect(commandLines(box).filter((line) => !line.endsWith('--version'))).toEqual(
    [`${latest}SHA256SUMS`, `${latest}${app}-linux-x64`].map(
      (url) => `wget --quiet --secure-protocol=TLSv1_2 -O - ${url}`,
    ),
  );
});

test.each([
  ['a BusyBox wget alone', ['busybox-wget'] as const],
  ['no downloader at all', [] as const],
])('%s exits 1, names curl, and downloads nothing', (_case, downloaders) => {
  const box = sandbox({ downloaders });
  const directory = join(box.root, 'bin');
  const result = runScript(box, ['--dir', directory]);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/^notes: .*\bcurl\b.*\n$/u);
  expect(requested(box)).toEqual([]);
  expect(entries(directory)).toBeUndefined();
});

test.each([
  ['curl', ['curl'] as const],
  ['GNU Wget', ['gnu-wget'] as const],
])(
  'a SHA256SUMS request answered with an HTTP error under %s exits 1 with the download sentence',
  (_case, downloaders) => {
    const box = sandbox({ downloaders, release: { [`${latest}${app}-linux-x64`]: 'test' } });
    const directory = join(box.root, 'bin');
    const result = runScript(box, ['--dir', directory]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      [
        `notes: Downloading ${app}-linux-x64 from the latest release of ${repo}.`,
        `notes: Cannot download ${latest}SHA256SUMS. Check your network connection and that the release exists, then run the installer again.`,
        '',
      ].join('\n'),
    );
    expect(entries(directory)).toEqual([]);
    expect(entries(recordDirectory(box))).toEqual([]);
  },
);

test('no digest tool exits 1, names sha256sum, and downloads nothing', () => {
  const box = sandbox({
    tools: scriptTools.filter((tool) => tool !== 'sha256sum' && tool !== 'shasum'),
  });
  const result = runScript(box, ['--dir', join(box.root, 'bin')]);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/^notes: .*\bsha256sum\b.*\n$/u);
  expect(requested(box)).toEqual([]);
});

/**
 * Whether `shasum` runs here. A machine without it skips the case that needs it, unless
 * `LOOM_REQUIRE_SHELLS` is set, when the suite fails, as it fails the shell suites.
 */
function shasumInstalled(): boolean {
  if (findOnPath('shasum') !== undefined) {
    return true;
  }
  if (process.env.LOOM_REQUIRE_SHELLS) {
    throw new Error('LOOM_REQUIRE_SHELLS is set, but shasum is not installed.');
  }
  return false;
}

test.skipIf(!shasumInstalled())('with no sha256sum, shasum -a 256 verifies the download', () => {
  const box = sandbox({ tools: scriptTools.filter((tool) => tool !== 'sha256sum') });
  expect(runScript(box).status).toBe(0);
  expect(readFileSync(join(recordDirectory(box), 'install.json'), 'utf8')).toBe(
    recordBytes(join(defaultDirectory(box), app)),
  );
});

/** A latest release whose SHA256SUMS is the supplied text and whose asset holds `test`. */
function listing(text: string) {
  return { [`${latest}${app}-linux-x64`]: 'test', [`${latest}SHA256SUMS`]: text };
}

const asset = `${app}-linux-x64`;

/** Each way an install is refused, the fakes and arguments that cause it, and the exit code. */
const refusals: [string, Parameters<typeof sandbox>[0], string[], number, RegExp][] = [
  [
    'a digest mismatch',
    { release: listing(`${sha256('other')}  ${asset}\n`) },
    [],
    1,
    new RegExp(`^notes: The download of ${asset} does not match`, 'mu'),
  ],
  [
    'an asset SHA256SUMS does not list',
    { release: listing(`${sha256('test')}  ${app}-darwin-arm64\n`) },
    [],
    1,
    new RegExp(`^notes: SHA256SUMS of the latest release of ${repo} lists no ${asset}\\.`, 'mu'),
  ],
  [
    'an asset SHA256SUMS lists twice with different digests',
    { release: listing(`${sha256('test')}  ${asset}\n${sha256('other')}  ${asset}\n`) },
    [],
    1,
    new RegExp(`^notes: SHA256SUMS of the latest release of ${repo} lists ${asset} twice`, 'mu'),
  ],
  [
    'a failed download',
    { release: { [`${latest}SHA256SUMS`]: `${sha256('test')}  ${asset}\n` } },
    [],
    1,
    new RegExp(`^notes: Cannot download ${latest}${asset}\\.`, 'mu'),
  ],
  ['an unknown operating system', { os: 'SunOS' }, [], 1, /SunOS/u],
  ['an unknown architecture', { arch: 'riscv64' }, [], 1, /riscv64/u],
  ['an unknown option', {}, ['--quiet'], 2, /--quiet/u],
  ['a relative --dir', {}, ['--dir', 'bin'], 2, /--dir/u],
  ['a second version', {}, ['1.4.0', '1.4.1'], 2, /1\.4\.1/u],
  ['a version holding /', {}, ['1.4/0'], 2, /1\.4\/0/u],
];

test.each(refusals)(
  '%s exits with its code and leaves an install directory it created empty, with no install.json',
  (_case, fakes, args, status, message) => {
    const box = sandbox(fakes);
    const result = runScript(box, args);
    expect(result.status).toBe(status);
    expect(result.stderr).toMatch(message);
    expect(entries(defaultDirectory(box)) ?? []).toEqual([]);
    expect(entries(recordDirectory(box)) ?? []).toEqual([]);
  },
);

test.each(refusals)(
  '%s exits with its code and leaves an existing install directory and binary as they were',
  (_case, fakes, args, status) => {
    const box = sandbox(fakes);
    mkdirSync(defaultDirectory(box), { recursive: true });
    writeFileSync(join(defaultDirectory(box), app), 'old');
    expect(runScript(box, args).status).toBe(status);
    expect(entries(defaultDirectory(box))).toEqual([app]);
    expect(readFileSync(join(defaultDirectory(box), app), 'utf8')).toBe('old');
    expect(entries(recordDirectory(box)) ?? []).toEqual([]);
  },
);

test("a directory at the binary's path exits 1, downloads nothing, and leaves it as it was", () => {
  const box = sandbox();
  mkdirSync(join(defaultDirectory(box), app), { recursive: true });
  const result = runScript(box);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/^notes: .+ is a directory\. /u);
  expect(requested(box)).toEqual([]);
  expect(entries(defaultDirectory(box))).toEqual([app]);
  expect(entries(recordDirectory(box)) ?? []).toEqual([]);
});

test.each([
  ['a relative HOME', { HOME: 'home' }],
  ['an empty HOME', { HOME: '' }],
  ['an unset HOME with an absolute XDG_STATE_HOME', { HOME: undefined }],
])('with no --dir, %s exits 1 with the HOME sentence and downloads nothing', (_case, env) => {
  const box = sandbox();
  const result = runScript(box, [], env);
  expect(result).toEqual({
    status: 1,
    stderr:
      'notes: HOME is not an absolute path. Set it to your home directory, then run the installer again.\n',
    stdout: '',
  });
  expect(requested(box)).toEqual([]);
  expect(entries(box.work)).toEqual([]);
  expect(entries(box.state)).toEqual([]);
});

test('a second install replaces the binary and the record', () => {
  const box = sandbox({
    release: {
      ...release(latest, { [asset]: 'test' }),
      ...release(tagged, { [asset]: 'newer' }),
    },
  });
  expect(runScript(box).status).toBe(0);
  expect(runScript(box, ['1.4.0']).status).toBe(0);
  const target = join(defaultDirectory(box), app);
  expect(readFileSync(target, 'utf8')).toBe('newer');
  expect(readFileSync(join(recordDirectory(box), 'install.json'), 'utf8')).toBe(
    recordBytes(target, sha256('newer')),
  );
  expect(entries(defaultDirectory(box))).toEqual([app]);
  expect(entries(recordDirectory(box))).toEqual(['install.json']);
});

test('SHA256SUMS is read by exact file name, in both separators, ignoring every other line', () => {
  const digest = sha256('test');
  const box = sandbox({
    release: listing(
      [
        `${sha256('other')}  x${asset}`,
        `${sha256('other')}  ${asset}.sig`,
        `${sha256('other').toUpperCase()}  ${asset}`,
        `${sha256('other').slice(1)}  ${asset}`,
        `${sha256('other')}  ${asset}\r`,
        'not a line of sha256sum',
        `${digest} *${asset}`,
        `${digest}  ${asset}`,
        '',
      ].join('\n'),
    ),
  });
  expect(runScript(box).status).toBe(0);
  expect(readFileSync(join(defaultDirectory(box), app), 'utf8')).toBe('test');
});

test('an install directory that is not on PATH prints the export line that adds it', () => {
  const box = sandbox();
  const directory = defaultDirectory(box);
  expect(runScript(box).stderr).toBe(
    [
      `notes: Downloading ${asset} from the latest release of ${repo}.`,
      `notes: Installed ${directory}/${app}.`,
      `notes: ${directory} is not on PATH. Add it to your shell's PATH to run notes:`,
      `  export PATH="${directory}:$PATH"`,
      '',
    ].join('\n'),
  );
});

test.each([
  ['as given', (directory: string) => directory],
  ['with a trailing slash', (directory: string) => `${directory}//`],
])('an install directory on PATH, given to --dir %s, prints no export line', (_case, spell) => {
  const box = sandbox();
  const directory = join(box.root, 'bin');
  const result = runScript(box, ['--dir', spell(directory)], {
    PATH: `${box.path}:${directory}`,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    [
      `notes: Downloading ${asset} from the latest release of ${repo}.`,
      `notes: Installed ${directory}/${app}.`,
      '',
    ].join('\n'),
  );
});

test('another file of the same name earlier on PATH is named, with what to do', () => {
  const box = sandbox();
  const directory = join(box.root, 'bin');
  const earlier = join(box.root, 'earlier');
  mkdirSync(earlier);
  writeFileSync(join(earlier, app), '#!/bin/sh\n');
  chmodSync(join(earlier, app), 0o755);
  const result = runScript(box, ['--dir', directory], {
    PATH: `${earlier}:${box.path}:${directory}`,
  });
  expect(result.status).toBe(0);
  expect(result.stderr.split('\n').slice(2)).toEqual([
    `notes: ${earlier}/${app} runs first on PATH. Remove it, or move ${directory} earlier on PATH.`,
    '',
  ]);
});

/** The four ways a variable the record's directory reads can be set: unset, empty, relative, absolute. */
const spellings = ['unset', 'empty', 'relative', 'absolute'] as const;

/** A variable's value for a spelling, with `absolute` the sandbox directory supplied. */
function spelled(spelling: (typeof spellings)[number], absolute: string, relative: string) {
  return { absolute, empty: '', relative, unset: undefined }[spelling];
}

/** `uname` as the running platform reports it, so the recipe chooses the running platform's row. */
const runningUname =
  process.platform === 'darwin' ? { arch: 'arm64', os: 'Darwin' } : { arch: 'x86_64', os: 'Linux' };

test.each(spellings.flatMap((xdg) => spellings.map((home) => [xdg, home] as const)))(
  'with XDG_STATE_HOME %s and HOME %s, install.json lands where applicationDirectory says, or nothing is downloaded',
  (xdg, home) => {
    const box = sandbox({ ...runningUname, release: everyAsset });
    const env = {
      HOME: spelled(home, box.home, 'home'),
      XDG_STATE_HOME: spelled(xdg, box.state, 'state'),
    };
    const directory = join(box.root, 'bin');
    const result = runScript(box, ['--dir', directory], env);
    // The installer script reads HOME as it is, so the lookup's home is that HOME.
    const lookup = applicationDirectory('installation', app, {
      env,
      home: env.HOME ?? '',
      platform: process.platform,
    });
    const recorded = 'path' in lookup ? join(lookup.path, 'install.json') : undefined;
    expect({
      downloads: requested(box).length,
      record:
        recorded !== undefined && existsSync(recorded) ? readFileSync(recorded, 'utf8') : undefined,
      status: result.status,
    }).toEqual(
      'path' in lookup
        ? { downloads: 2, record: recordBytes(join(directory, app)), status: 0 }
        : { downloads: 0, record: undefined, status: 1 },
    );
    expect(entries(box.work)).toEqual([]);
  },
);

test('a run ended by SIGTERM to its process group during the download exits 1 and leaves no staging file', async () => {
  const box = sandbox({ sleepOn: `${latest}${asset}` });
  const { status } = await runScriptUntilSignal(box, 'group');
  expect(status).toBe(1);
  expect(entries(defaultDirectory(box))).toEqual([]);
  expect(entries(recordDirectory(box))).toEqual([]);
});

test('a run whose sh alone gets SIGTERM during the download exits 1 once the download ends, with nothing more done', async () => {
  const box = sandbox({ sleepOn: `${latest}${asset}`, sleepSeconds: 1 });
  await expect(runScriptUntilSignal(box, 'shell')).resolves.toEqual({
    status: 1,
    stderr: `notes: Downloading ${asset} from the latest release of ${repo}.\n`,
  });
  expect(entries(defaultDirectory(box))).toEqual([]);
  expect(entries(recordDirectory(box))).toEqual([]);
});

test('a SHA256SUMS that lists the asset only in the binary form, a space and *, installs it', () => {
  const box = sandbox({ release: listing(`${sha256('test')} *${asset}\n`) });
  expect(runScript(box).status).toBe(0);
  expect(readFileSync(join(defaultDirectory(box), app), 'utf8')).toBe('test');
});

test('a PATH entry that only holds the install directory as a prefix still draws the export line', () => {
  const box = sandbox();
  const directory = join(box.root, 'bin');
  const result = runScript(box, ['--dir', directory], {
    PATH: `${box.path}:${directory}2:/x${directory}`,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toContain(`  export PATH="${directory}:$PATH"\n`);
});

/** The sentence the recipe prints when the record's directory cannot be created. */
function recordSentence(record: string) {
  return `notes: The installation record's directory ${record} cannot be created. Make it a directory you can write to, then run the installer again.\n`;
}

test('a record directory that cannot be created exits 1 with the recipe sentence, downloads nothing, and creates no install directory', () => {
  const box = sandbox();
  const blocked = join(box.root, 'blocked');
  writeFileSync(blocked, 'a file where a directory belongs\n');
  const directory = join(box.root, 'opt', 'bin');
  const result = runScript(box, ['--dir', directory], { XDG_STATE_HOME: join(blocked, 'state') });
  expect(result).toEqual({
    status: 1,
    stderr: recordSentence(join(blocked, 'state', app, 'installation')),
    stdout: '',
  });
  expect(requested(box)).toEqual([]);
  expect(entries(join(box.root, 'opt'))).toBeUndefined();
  expect(entries(box.home)).toEqual([]);
});

test('a rename of the verified binary that fails exits 1, writes no install.json, and leaves no staging file', () => {
  const box = sandbox({ refuseRenameOnto: app });
  const directory = join(box.root, 'bin');
  const result = runScript(box, ['--dir', directory]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('mv: cannot move');
  expect(entries(directory)).toEqual([]);
  expect(entries(recordDirectory(box)) ?? []).toEqual([]);
});
