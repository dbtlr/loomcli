/*
 * Acceptance plan for the npm launcher packages (ADR-0213's proof,
 * docs/toolchain/build.md#the-npm-launcher-packages).
 *
 * One `loom build --target npm` runs in-process before the cases, in a fixture package named
 * `@acme/probe` whose file lists five platforms. The host's platform compiles a real release binary
 * of a probe application. Every other platform's compile is stubbed through the run's Bun program,
 * which writes a small file in its place, because cross-compiling five more binaries downloads Bun
 * runtimes and costs gigabytes of memory, and the layout does not depend on what a binary holds.
 * The launcher runs through the `node` on the PATH, with a preload that ceils its walk up to
 * `node_modules` at the sandbox and, for the spawn path, removes `process.execve` before it loads.
 * A case about the launcher alone installs a copy of `/bin/sh` as the binary, which runs on every
 * host and ends as its script asks.
 *
 * - The packages (proof 1). The build writes the launcher package and one platform package per
 *   listed platform into `dist/npm`, each `package.json` equal to its golden file, a scoped name
 *   included. It replaces a package directory an earlier build wrote whole, removes a stale
 *   platform package the list dropped, and leaves every other entry alone. Each `bin/probe` has mode 755, the launcher holds
 *   what `npmLauncher` renders, and README and license files are copied.
 * - The exec path (proof 4). The launcher passes its arguments, stdin, stdout, its environment,
 *   its working directory, and the binary's exit code through, the binary runs with the launcher's
 *   process ID, and stderr holds only the binary's bytes.
 * - The spawn path (proof 5). With `process.execve` removed, the launcher passes its arguments,
 *   stdio, and exit code through from a child. With no terminal, a SIGINT, a SIGTERM, and a SIGHUP
 *   sent to the launcher's process ID each reach the child once, and the launcher dies by that
 *   signal. With any one of stdin, stdout, and stderr a terminal, a SIGINT, a SIGHUP, and a SIGQUIT
 *   sent to the launcher's process ID are held and not forwarded, and a SIGTERM is.
 * - The re-raise. A child ended by SIGUSR1, SIGPIPE, or SIGXFSZ, which Node reserves or ignores,
 *   ends the launcher with 128 plus the signal's number, and the inspector never opens. A raise
 *   that does not end the launcher ends it with the same status after the guard's wait.
 * - The shell loop (proof 6). Under a pseudo-terminal, `while true; do probe wait; done` stops at the
 *   first Ctrl-C on both paths, with the status the bare binary's loop reads: 130 on Linux.
 * - The npm global layout (proof 7). `npm install -g` of the packed launcher, against a registry the
 *   test serves with every packed platform package, installs only the host's platform package beneath
 *   the launcher, and the binary run through the launcher reads the installation method `npm` and
 *   `release.npmPackage` `@acme/probe`. Each package packs from its own directory, so a checkout
 *   above the temporary directory lends it no settings.
 * - An unsupported platform (proof 8). A launcher rendered for `darwin-arm64` alone, run on another
 *   host, fails with exit 1 and names the host's platform and the supported one.
 * - The platform package (proof 9). A launcher whose platform package is not installed fails with
 *   exit 1 and names the package to install, and so does one that resolves a platform package of
 *   another version or name, from an ancestor `node_modules` or from `NODE_PATH`. On a musl Linux
 *   it runs the `-musl` package.
 * - A binary that cannot start (proof 10). On both paths, a binary without execute permission or
 *   one that is a directory fails with exit 1 and the `EACCES` cause, and a shell script or a file
 *   that is no program fails with the `ENOEXEC` cause before it starts. An exec that throws and a
 *   spawn that emits `error` print the sentence too, and a path that holds a line break prints
 *   escaped.
 * - The escaping copy. The launcher's `escapeControlCharacters` escapes every character core's does.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { constants } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { escapeControlCharacters } from '@loomcli/core';
import { afterAll, beforeAll, expect, test, vi } from 'vite-plus/test';
import { z } from 'zod';

import { childEnvironment } from '../../../scripts/test-process.js';
import { zsh } from '../../../scripts/test-pty.js';
import { drive } from '../../../scripts/test-terminal.js';
import {
  launcherCannotStart,
  launcherMissingPackage,
  launcherNoPlatform,
} from '../src/commands/build/messages.js';
import { npmLauncher } from '../src/content/npm-launcher.js';
import { systemCause } from '../src/helpers/messages.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { fixturePackage, loom } from './package.js';
import type { BunStandIn } from './run.js';

// Ceil the toolchain's walks up from a fixture at the sandbox (see ./ceiling.ts).
vi.mock(import('node:fs'), async (importOriginal) => {
  const { ceiled } = await import('./ceiling.js');
  return ceiled(await importOriginal());
});

afterAll(() => {
  removeRoots();
});

/** How long the build, a terminal case, or the npm install may take. */
const slow = 180_000;

/** How long one launcher run may take. */
const runTimeout = 30_000;

const preload = fileURLToPath(new URL('fixtures/npm-launcher-preload.cjs', import.meta.url));

const goldens = fileURLToPath(new URL('fixtures/npm-packages/', import.meta.url));

/** The platforms the fixture's file lists, out of order, without `linux-arm64-musl`. */
const listed = ['linux-x64-musl', 'darwin-arm64', 'linux-x64', 'darwin-x64', 'linux-arm64'];

/** The written platforms in the order of the six. */
const written = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'linux-x64-musl'];

/** The release asset platform of the host the tests run on, as the launcher reads it. */
function hostPlatform(): string {
  const platform = `${process.platform}-${process.arch}`;
  if (process.platform !== 'linux') {
    return platform;
  }
  const report = spawnSync(
    'node',
    ['-p', 'process.report.getReport().header.glibcVersionRuntime === undefined'],
    { encoding: 'utf8' },
  );
  return report.stdout.trim() === 'true' ? `${platform}-musl` : platform;
}

const host = hostPlatform();

/** Whether the host is one of the listed platforms, which the cases that run the binary need. */
const hostListed = listed.includes(host);

const application = `import { appendFileSync } from 'node:fs';

import { Application, Command } from '@loomcli/core';

// What the wait Command announces, also appended to the file PROBE_ANNOUNCE names, when it names one.
function announce(stream, line) {
  stream.write(line);
  if (process.env.PROBE_ANNOUNCE) {
    appendFileSync(process.env.PROBE_ANNOUNCE, line);
  }
}

export const probe = new Application('probe', { description: 'Probe the npm launcher.' })
  .command(
    new Command('facts', { description: 'Print the release facts.' }).action(({ host, out }) =>
      out.print(JSON.stringify(host.release)),
    ),
  )
  .command(
    new Command('report', { description: 'Report what the binary received.' })
      .argument('words', { variadic: true })
      .action(async ({ args, out }) => {
        let input = '';
        for await (const chunk of process.stdin) {
          input += chunk;
        }
        process.stderr.write('probe-stderr\\n');
        out.print(
          JSON.stringify({
            args: args.words ?? [],
            cwd: process.cwd(),
            env: process.env.PROBE_VALUE ?? null,
            input,
            pid: process.pid,
          }),
        );
      }),
  )
  .command(
    new Command('exit', { description: 'Exit with a code.' })
      .argument('code')
      .action(({ args }) => process.exit(Number(args.code))),
  )
  .command(
    new Command('wait', { description: 'Wait until cancelled.' }).action(
      ({ signal }) =>
        new Promise((resolve) => {
          const listeners = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].map((name) => [
            name,
            () => announce(process.stderr, 'heard:' + name + '\\n'),
          ]);
          for (const [name, listener] of listeners) {
            process.on(name, listener);
          }
          signal.addEventListener(
            'abort',
            () => {
              for (const [name, listener] of listeners) {
                process.off(name, listener);
              }
              resolve(undefined);
            },
            { once: true },
          );
          announce(process.stdout, 'waiting:' + process.pid + ':' + process.ppid + ';\\n');
        }),
    ),
  );
`;

const entrySource = `import { probe } from './application.js';

await probe.run();
`;

/** The author's `package.json`, its fields in an order the launcher's does not follow. */
const manifest = {
  author: 'Acme <dev@example.com>',
  bin: { probe: 'dist/main.js' },
  bugs: { url: 'https://github.com/acme/probe/issues' },
  description: 'Probe the npm launcher.',
  engines: { node: '>=22' },
  homepage: 'https://example.com/probe',
  keywords: ['probe', 'npm'],
  license: 'MIT',
  name: '@acme/probe',
  publishConfig: { access: 'public' },
  repository: { type: 'git', url: 'git+https://github.com/acme/probe.git' },
  scripts: { build: 'loom build' },
  type: 'module',
  version: '1.2.3',
};

/** The text a stubbed compile writes in place of a platform's binary. */
function stubBinary(target: string): string {
  return `stub ${target}\n`;
}

/** Compiles the host's binary with the real Bun, and writes a stub for every other compile. */
const stubOtherPlatforms: BunStandIn = (call, real) => {
  const target = call.args[call.args.indexOf('--target') + 1];
  if (!call.args.includes('--compile') || target === `bun-${host}`) {
    return real(call);
  }
  writeFileSync(call.args[call.args.indexOf('--outfile') + 1] ?? '', stubBinary(target ?? ''));
  return { code: 0 };
};

/** The SHA-256 digest of a text. */
function textDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The SHA-256 digest of a file, so a large binary is compared by digest alone. */
function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A program's permission bits in octal, or for any other file whether a bit lets it run. */
function modeOf(relativePath: string, bits: number): string {
  if (relativePath.startsWith('bin/')) {
    return bits.toString(8);
  }
  return (bits & 0o111) === 0 ? 'file' : 'runs';
}

/**
 * Every file under a directory, by its path relative to it: a program's with its mode's permission
 * bits, and any other's with whether a bit lets it run, since the umask sets the rest.
 */
function filesWithModes(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const relativePath = path.slice(directory.length + 1);
      return `${relativePath} ${modeOf(relativePath, statSync(path).mode % 0o1000)}`;
    })
    .toSorted();
}

/** What the probe's `report` Command prints. */
const reportSchema = z.object({
  args: z.array(z.string()),
  cwd: z.string(),
  env: z.string().nullable(),
  input: z.string(),
  pid: z.number(),
});

/** What `npm pack --json` reports of the one tarball it wrote. */
const packSchema = z.tuple([
  z.object({ filename: z.string(), integrity: z.string(), shasum: z.string() }),
]);

/** The fields of a platform package's `package.json` the test's registry names it by. */
const platformSchema = z.looseObject({ name: z.string(), version: z.string() });

/** The release facts the probe's `facts` Command prints, as far as an npm install reads them. */
const factsSchema = z.object({
  installation: z.object({ method: z.string() }).optional(),
  release: z.object({ npmPackage: z.string().optional() }).optional(),
});

/** The package.json of a package an earlier build wrote, which names it. */
function earlierPackage(name: string): string {
  return `${JSON.stringify({ name, version: '1.0.0' })}\n`;
}

/** The package directory and its build's result, which the build in `beforeAll` fills. */
let root = '';
let result: { status: number | undefined; stderr: string; stdout: string } = {
  status: undefined,
  stderr: '',
  stdout: '',
};

/** A node_modules layout that installs the launcher and the host's platform package. */
let layout = '';

beforeAll(async () => {
  root = fixturePackage({
    LICENSE: 'MIT License\n',
    'README.md': '# probe\n',
    'docs/README.md': '# Not packed\n',
    'loom.config.json': `${JSON.stringify({ npm: { launcher: true, platforms: listed } })}\n`,
    'package.json': `${JSON.stringify(manifest)}\n`,
    'src/application.ts': application,
    'src/main.ts': entrySource,
  });
  const npm = join(root, 'dist/npm');
  // An earlier build's packages, each named in its package.json, so this build owns them.
  put(npm, 'probe-linux-arm64-musl/package.json', earlierPackage('@acme/probe-linux-arm64-musl'));
  put(npm, 'probe-linux-x64/package.json', earlierPackage('@acme/probe-linux-x64'));
  put(npm, 'probe-linux-x64/old-file', 'stale\n');
  put(npm, 'probe-linux-x64-baseline/package.json', '{}\n');
  put(npm, 'probe-windows-x64/package.json', '{}\n');
  put(npm, 'other/kept', 'kept\n');
  const built = await loom(root, ['build', '--target', 'npm'], { bun: stubOtherPlatforms });
  result = { status: built.status, stderr: built.stderr, stdout: built.stdout };
  layout = temporaryRoot('loom-npm-layout-');
  if (result.status === 0 && hostListed) {
    cpSync(join(npm, 'probe'), join(layout, 'node_modules/@acme/probe'), { recursive: true });
    cpSync(join(npm, `probe-${host}`), join(layout, `node_modules/@acme/probe-${host}`), {
      recursive: true,
    });
  }
}, slow);

/** The launcher in the shared layout. */
function layoutLauncher(): string {
  return join(layout, 'node_modules/@acme/probe/bin/probe');
}

/** The environment a launcher runs in: the fixture's, ceiled at its sandbox, on one path. */
function launcherEnvironment(
  path: 'exec' | 'spawn',
  ceiling: string,
  env: Record<string, string> = {},
) {
  return childEnvironment({
    NPM_LAUNCHER_CEILING: ceiling,
    ...(path === 'spawn' ? { NPM_LAUNCHER_SPAWN: '1' } : {}),
    ...env,
  });
}

/** One run of a launcher through Node, waited for. */
function launch(
  launcher: string,
  args: string[],
  options: {
    ceiling?: string;
    cwd?: string;
    env?: Record<string, string>;
    input?: string;
    path?: 'exec' | 'spawn';
  } = {},
) {
  const run = spawnSync('node', ['-r', preload, launcher, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: launcherEnvironment(options.path ?? 'exec', options.ceiling ?? layout, options.env),
    input: options.input ?? '',
    timeout: runTimeout,
  });
  return {
    pid: run.pid,
    signal: run.signal,
    status: run.status,
    stderr: run.stderr,
    stdout: run.stdout,
  };
}

test('the build writes the launcher and platform packages, which match their golden files', () => {
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'Built dist/npm for npm.\n' });
  const npm = join(root, 'dist/npm');
  expect(readdirSync(npm).toSorted()).toEqual(
    [
      'other',
      'probe',
      ...written.map((platform) => `probe-${platform}`).toSorted(),
      'probe-linux-x64-baseline',
      'probe-windows-x64',
    ].toSorted(),
  );
  for (const directory of ['probe', ...written.map((platform) => `probe-${platform}`)]) {
    expect(readFileSync(join(npm, directory, 'package.json'), 'utf8')).toBe(
      readFileSync(join(goldens, directory, 'package.json.golden'), 'utf8'),
    );
  }
  expect(filesWithModes(join(npm, 'probe'))).toEqual([
    'LICENSE file',
    'README.md file',
    'bin/probe 755',
    'package.json file',
  ]);
  expect(readFileSync(join(npm, 'probe/bin/probe'), 'utf8')).toBe(
    npmLauncher({ name: 'probe', pkg: '@acme/probe', platforms: written, version: '1.2.3' }),
  );
  for (const platform of written) {
    expect(filesWithModes(join(npm, `probe-${platform}`))).toEqual([
      'LICENSE file',
      'bin/probe 755',
      'package.json file',
    ]);
  }
  // The host's binary is a real one, and every other platform's is the stub its compile wrote.
  const binaries = written.map((platform) => {
    const binary = join(npm, `probe-${platform}`, 'bin/probe');
    return platform === host ? statSync(binary).size > 1_000_000 : digest(binary);
  });
  expect(binaries).toEqual(
    written.map((platform) =>
      platform === host ? true : textDigest(stubBinary(`bun-${platform}`)),
    ),
  );
  // An entry the build does not own stays as it was.
  expect(readFileSync(join(npm, 'other/kept'), 'utf8')).toBe('kept\n');
  expect(readFileSync(join(npm, 'probe-windows-x64/package.json'), 'utf8')).toBe('{}\n');
});

test.skipIf(!hostListed).each(['exec', 'spawn'] as const)(
  'on the %s path it passes arguments, stdio, the environment, the directory, and the exit code through',
  (path) => {
    const cwd = temporaryRoot('loom-npm-cwd-');
    const run = launch(layoutLauncher(), ['report', 'one', 'two words', ''], {
      cwd,
      env: { PROBE_VALUE: 'passed' },
      input: 'from stdin\n',
      path,
    });
    expect(run.stderr).toBe('probe-stderr\n');
    expect(run.status).toBe(0);
    const report = reportSchema.parse(JSON.parse(run.stdout));
    expect(report).toEqual({
      args: ['one', 'two words', ''],
      cwd,
      env: 'passed',
      input: 'from stdin\n',
      pid: expect.any(Number),
    });
    // The exec path keeps the launcher's process ID, and the spawn path runs a child.
    expect(report.pid === run.pid).toBe(path === 'exec');
    expect(launch(layoutLauncher(), ['exit', '7'], { path })).toMatchObject({
      status: 7,
      stderr: '',
    });
  },
  runTimeout,
);

/** A launcher started with piped stdio, which announces the binary's ids once it waits. */
function startWaiting(path: 'exec' | 'spawn') {
  const child = spawn('node', ['-r', preload, layoutLauncher(), 'wait'], {
    env: launcherEnvironment(path, layout),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const waiting = new Promise<void>((resolve) => {
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.includes(';')) {
        resolve();
      }
    });
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
  return { child, exit, stderr: () => stderr, waiting };
}

test.skipIf(!hostListed).each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
  'on the spawn path with no terminal, a %s sent to the launcher reaches the child once, and the launcher dies by it',
  async (signal) => {
    const running = startWaiting('spawn');
    await running.waiting;
    running.child.kill(signal);
    await expect(running.exit).resolves.toEqual({ code: null, signal });
    const heard = running.stderr().match(/heard:\w+/gu) ?? [];
    expect(heard).toEqual([`heard:${signal}`]);
  },
  runTimeout,
);

/** The ids the binary announced: its own, and its parent's, which is the launcher's. */
function idsOf(transcript: string) {
  const match = /waiting:(?<pid>\d+):(?<ppid>\d+);/u.exec(transcript)?.groups;
  if (match?.pid === undefined || match.ppid === undefined) {
    throw new Error(`The binary announced no process ids:\n${transcript}`);
  }
  return { child: Number(match.pid), launcher: Number(match.ppid) };
}

/** What the binary appended to its announcement file, once it announced that it waits. */
async function announced(file: string): Promise<string> {
  const deadline = Date.now() + runTimeout;
  while (Date.now() < deadline) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(';')) {
      return text;
    }
    await delay(50);
  }
  throw new Error(`The binary announced nothing in ${file}.`);
}

test.skipIf(zsh === undefined || !hostListed).each([
  { redirect: '', terminal: 'stdin, stdout, and stderr' },
  { redirect: '>/dev/null 2>/dev/null', terminal: 'stdin alone' },
  { redirect: '</dev/null 2>/dev/null', terminal: 'stdout alone' },
  { redirect: '</dev/null >/dev/null', terminal: 'stderr alone' },
])(
  'on the spawn path with $terminal on a terminal, a SIGINT, SIGHUP, and SIGQUIT sent to the launcher are held, and a SIGTERM is forwarded',
  async ({ redirect }) => {
    const file = join(temporaryRoot('loom-npm-announce-'), 'announced');
    writeFileSync(file, '');
    const terminal = drive(
      [
        'sh',
        '-c',
        `node -r "$0" "$1" wait ${redirect}; echo "status:$?:done"`,
        preload,
        layoutLauncher(),
      ],
      { NPM_LAUNCHER_CEILING: layout, NPM_LAUNCHER_SPAWN: '1', PROBE_ANNOUNCE: file },
    );
    try {
      const ids = idsOf(await announced(file));
      for (const signal of ['SIGINT', 'SIGHUP', 'SIGQUIT'] as const) {
        process.kill(ids.launcher, signal);
      }
      await delay(500);
      // Both processes still run, and the child heard nothing.
      process.kill(ids.launcher, 0);
      process.kill(ids.child, 0);
      expect(readFileSync(file, 'utf8')).not.toContain('heard:');
      process.kill(ids.launcher, 'SIGTERM');
      await expect(terminal.expect('status:[0-9]*:done')).resolves.toContain('status:143:done');
      expect(readFileSync(file, 'utf8').match(/heard:\w+/gu)).toEqual(['heard:SIGTERM']);
    } finally {
      await terminal.close();
    }
  },
  slow,
);

/** The status a shell loop of `command` reads at the first Ctrl-C, which also proves it stopped. */
async function loopStatus(command: string, env: Record<string, string>): Promise<string> {
  const terminal = drive(['bash', '--norc', '--noprofile', '-i'], { PS1: '$ ', ...env });
  try {
    terminal.send(String.raw`while true; do ${command}; done\n`);
    await terminal.expect('waiting:*;');
    terminal.send(String.raw`\x03`);
    terminal.send(String.raw`echo "status:$?:done"\n`);
    const ended = await terminal.expect('status:[0-9]*:done');
    // A second iteration would announce again before the shell read the status.
    expect(ended).not.toContain('waiting:');
    return /status:(?<status>\d+):done/u.exec(ended)?.groups?.status ?? '';
  } finally {
    await terminal.close();
  }
}

test.skipIf(zsh === undefined || !hostListed).each(['exec', 'spawn'] as const)(
  'on the %s path, a shell loop that runs the launcher stops at the first Ctrl-C with the status of the bare binary',
  async (path) => {
    const binary = join(layout, `node_modules/@acme/probe-${host}/bin/probe`);
    const bare = await loopStatus(`'${binary}' wait`, {});
    const launched = await loopStatus(`node -r '${preload}' '${layoutLauncher()}' wait`, {
      NPM_LAUNCHER_CEILING: layout,
      ...(path === 'spawn' ? { NPM_LAUNCHER_SPAWN: '1' } : {}),
    });
    // On macOS the compiled binary itself ends with another status, which the launcher keeps.
    const expected = process.platform === 'linux' ? '130' : bare;
    expect({ bare, launched }).toEqual({ bare: expected, launched: expected });
  },
  slow,
);

/** A copy of the system shell, a binary every host runs, which ends as its script asks. */
const shell = '/bin/sh';

/**
 * Writes a launcher package rendered for `platforms`, the host's by default, under `modules`, the
 * `node_modules/@acme` directory of a layout, and answers the launcher's path.
 */
function putLauncher(modules: string, platforms: readonly string[] = [host]): string {
  put(
    modules,
    'probe/package.json',
    `${JSON.stringify({ name: '@acme/probe', version: '1.2.3' })}\n`,
  );
  put(
    modules,
    'probe/bin/probe',
    npmLauncher({ name: 'probe', pkg: '@acme/probe', platforms, version: '1.2.3' }),
  );
  return join(modules, 'probe/bin/probe');
}

/**
 * Writes a platform package under `modules`, the host's at 1.2.3 unless the options say otherwise,
 * whose `bin/probe` is a copy of the shell, mode 755, unless `write` puts something else there.
 */
function putPlatform(
  modules: string,
  options: {
    name?: string;
    platform?: string;
    version?: string;
    write?: (binary: string) => void;
  } = {},
): string {
  const platform = options.platform ?? host;
  const directory = join(modules, `probe-${platform}`);
  put(
    directory,
    'package.json',
    `${JSON.stringify({ name: options.name ?? `@acme/probe-${platform}`, version: options.version ?? '1.2.3' })}\n`,
  );
  mkdirSync(join(directory, 'bin'));
  const binary = join(directory, 'bin/probe');
  const write =
    options.write ??
    ((path: string) => {
      copyFileSync(shell, path);
      chmodSync(path, 0o755);
    });
  write(binary);
  return binary;
}

/** The sentence of a platform package that is not installed, for the host's platform. */
function missingSentence(platform = host): string {
  return launcherMissingPackage('probe', '@acme/probe', '1.2.3').replaceAll('{platform}', platform);
}

/** The sentence of a binary that cannot start, with the cause a code names. */
function cannotStartSentence(binary: string, code: string): string {
  return launcherCannotStart('probe', '@acme/probe', '1.2.3')
    .replaceAll('{platform}', host)
    .replace('{path}', binary)
    .replace('{cause}', systemCause(code));
}

test.each(['exec', 'spawn'] as const)(
  'on the %s path, a platform package at the built version runs, and its arguments reach it',
  (path) => {
    const sandbox = temporaryRoot('loom-npm-shell-');
    const modules = join(sandbox, 'node_modules/@acme');
    const launcher = putLauncher(modules);
    putPlatform(modules);
    expect(
      launch(launcher, ['-c', 'echo "ran:$1"; exit 7', 'sh', 'one'], { ceiling: sandbox, path }),
    ).toMatchObject({ status: 7, stderr: '', stdout: 'ran:one\n' });
  },
  runTimeout,
);

test.each([
  { found: 'an ancestor node_modules', name: undefined, version: '2.0.0' },
  { found: 'an ancestor node_modules', name: undefined, version: '0.9.0' },
  { found: 'an ancestor node_modules', name: '@acme/probe', version: '1.2.3' },
  { found: 'NODE_PATH', name: undefined, version: '2.0.0' },
])(
  'a launcher that resolves a platform package named $name at version $version from $found fails and names the package to install',
  ({ found, name, version }) => {
    const sandbox = temporaryRoot('loom-npm-version-');
    const launcher = putLauncher(join(sandbox, 'app/node_modules/@acme'));
    const global = join(sandbox, 'global');
    const modules =
      found === 'NODE_PATH' ? join(global, '@acme') : join(sandbox, 'node_modules/@acme');
    putPlatform(modules, { ...(name === undefined ? {} : { name }), version });
    const env: Record<string, string> = found === 'NODE_PATH' ? { NODE_PATH: global } : {};
    expect(launch(launcher, ['-c', 'echo ran'], { ceiling: sandbox, env })).toMatchObject({
      status: 1,
      stderr: `${missingSentence()}\n`,
      stdout: '',
    });
    // The same layout at the built version runs the binary it finds.
    putPlatform(join(sandbox, 'app/node_modules/@acme'));
    expect(launch(launcher, ['-c', 'echo ran'], { ceiling: sandbox, env })).toMatchObject({
      status: 0,
      stdout: 'ran\n',
    });
  },
  runTimeout,
);

test.skipIf(process.platform !== 'linux' || host.endsWith('-musl'))(
  'on a musl Linux the launcher runs the -musl platform package',
  () => {
    const sandbox = temporaryRoot('loom-npm-musl-');
    const modules = join(sandbox, 'node_modules/@acme');
    const launcher = putLauncher(modules, [host, `${host}-musl`]);
    putPlatform(modules, { platform: `${host}-musl` });
    expect(
      launch(launcher, ['-c', 'echo ran'], { ceiling: sandbox, env: { NPM_LAUNCHER_MUSL: '1' } }),
    ).toMatchObject({ status: 0, stderr: '', stdout: 'ran\n' });
    // On this glibc host the same launcher looks for the glibc package, which is not installed.
    expect(launch(launcher, ['-c', 'echo ran'], { ceiling: sandbox })).toMatchObject({
      status: 1,
      stderr: `${missingSentence()}\n`,
    });
  },
  runTimeout,
);

/** Writes a file without execute permission in place of the shell. */
function notExecutable(path: string) {
  writeFileSync(path, 'not a program\n');
  chmodSync(path, 0o644);
}

/** A binary that cannot start, each written in place of the shell. */
const unstartable = [
  { code: 'EACCES', payload: 'a file without execute permission', write: notExecutable },
  {
    code: 'EACCES',
    payload: 'a directory',
    write: (path: string) => {
      mkdirSync(path);
    },
  },
  {
    code: 'ENOEXEC',
    payload: 'a shell script',
    write: (path: string) => {
      writeFileSync(path, '#!/bin/sh\necho ran\n');
      chmodSync(path, 0o755);
    },
  },
  {
    code: 'ENOEXEC',
    payload: 'an executable file that is no program',
    write: (path: string) => {
      writeFileSync(path, 'not a program\n');
      chmodSync(path, 0o755);
    },
  },
  {
    code: 'ENOEXEC',
    payload: 'an executable file shorter than a magic number',
    write: (path: string) => {
      writeFileSync(path, '\u007fEL');
      chmodSync(path, 0o755);
    },
  },
];

test.each(
  (['exec', 'spawn'] as const).flatMap((path) =>
    unstartable.map(({ code, payload, write }) => ({ code, path, payload, write })),
  ),
)(
  'on the $path path, a binary that is $payload fails with the $code cause before it starts',
  ({ code, path, write }) => {
    const sandbox = temporaryRoot('loom-npm-start-');
    const modules = join(sandbox, 'node_modules/@acme');
    const launcher = putLauncher(modules);
    const binary = putPlatform(modules, { write });
    expect(launch(launcher, ['report'], { ceiling: sandbox, path })).toMatchObject({
      status: 1,
      stderr: `${cannotStartSentence(binary, code)}\n`,
      stdout: '',
    });
  },
  runTimeout,
);

test.each([
  { cause: 'an exec that throws', env: { NPM_LAUNCHER_EXECVE_THROWS: 'ENOEXEC' }, path: 'exec' },
  { cause: 'a spawn that emits error', env: { NPM_LAUNCHER_SPAWN_MISSING: '1' }, path: 'spawn' },
] as const)('$cause prints the sentence and exits 1', ({ env, path }) => {
  const sandbox = temporaryRoot('loom-npm-thrown-');
  const modules = join(sandbox, 'node_modules/@acme');
  const launcher = putLauncher(modules);
  const binary = putPlatform(modules);
  const code = path === 'exec' ? 'ENOEXEC' : 'ENOENT';
  expect(launch(launcher, ['-c', 'echo ran'], { ceiling: sandbox, env, path })).toMatchObject({
    status: 1,
    stderr: `${cannotStartSentence(binary, code)}\n`,
    stdout: '',
  });
});

test.each([
  { env: {}, signal: 'SIGUSR1' },
  { env: {}, signal: 'SIGPIPE' },
  { env: {}, signal: 'SIGXFSZ' },
  { env: { NPM_LAUNCHER_HOLD: 'SIGALRM' }, signal: 'SIGALRM' },
] as const)(
  'on the spawn path, a child ended by $signal ends the launcher with 128 plus its number',
  ({ env, signal }) => {
    const sandbox = temporaryRoot('loom-npm-raise-');
    const modules = join(sandbox, 'node_modules/@acme');
    const launcher = putLauncher(modules);
    putPlatform(modules);
    const run = launch(launcher, ['-c', `kill -${signal.slice(3)} $$`], {
      ceiling: sandbox,
      env,
      path: 'spawn',
    });
    // Node's inspector would announce itself on stderr had the launcher raised SIGUSR1.
    expect(run).toMatchObject({
      signal: null,
      status: 128 + constants.signals[signal],
      stderr: '',
      stdout: '',
    });
  },
  runTimeout,
);

test('on the spawn path, a child ended by SIGALRM ends the launcher by SIGALRM', () => {
  const sandbox = temporaryRoot('loom-npm-raise-');
  const modules = join(sandbox, 'node_modules/@acme');
  const launcher = putLauncher(modules);
  putPlatform(modules);
  expect(
    launch(launcher, ['-c', 'kill -ALRM $$'], { ceiling: sandbox, path: 'spawn' }),
  ).toMatchObject({ signal: 'SIGALRM', status: null, stderr: '' });
});

test('a binary under a directory whose name holds a line break prints its path escaped on one line', () => {
  const sandbox = temporaryRoot('loom-npm-line-');
  const modules = join(sandbox, 'line\nbreak/node_modules/@acme');
  const launcher = putLauncher(modules);
  putPlatform(modules, { write: notExecutable });
  const run = launch(launcher, [], { ceiling: sandbox });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain(
    `Cannot start ${join(sandbox, String.raw`line\u000abreak/node_modules/@acme`)}/probe-${host}/bin/probe from`,
  );
  expect(run.stderr.split('\n')).toHaveLength(2);
});

test('a launcher whose platform package is not installed fails and names the package to install', () => {
  const sandbox = temporaryRoot('loom-npm-missing-');
  const launcher = putLauncher(join(sandbox, 'node_modules/@acme'));
  expect(launch(launcher, [], { ceiling: sandbox })).toMatchObject({
    status: 1,
    stderr: `${missingSentence()}\n`,
    stdout: '',
  });
  expect(missingSentence()).toBe(
    `probe: The package @acme/probe-${host}@1.2.3, which holds the binary for ${host}, is not installed. Install @acme/probe again without --omit=optional, or install @acme/probe-${host}@1.2.3 beside it.`,
  );
});

test('a launcher built for darwin-arm64 alone fails on another host and names the platforms it supports', () => {
  const only = host === 'darwin-arm64' ? 'linux-x64' : 'darwin-arm64';
  const sandbox = temporaryRoot('loom-npm-platform-');
  // The launcher is CommonJS in its own package, as a launcher package's package.json leaves it.
  put(sandbox, 'package.json', `${JSON.stringify({ type: 'commonjs' })}\n`);
  const launcher = join(sandbox, 'probe');
  writeFileSync(
    launcher,
    npmLauncher({ name: 'probe', pkg: '@acme/probe', platforms: [only], version: '1.2.3' }),
  );
  expect(launch(launcher, [], { ceiling: sandbox })).toMatchObject({
    status: 1,
    stderr: `probe: @acme/probe has no binary for ${host}. It runs on ${only}.\n`,
    stdout: '',
  });
  expect(
    launcherNoPlatform('notes', '@acme/notes', ['darwin-arm64', 'linux-x64', 'linux-x64-musl']),
  ).toBe(
    'notes: @acme/notes has no binary for {platform}. It runs on darwin-arm64, linux-x64, and linux-x64-musl.',
  );
});

test("the launcher's escaping copy escapes every character core's escapes", () => {
  const source = npmLauncher({
    name: 'probe',
    pkg: '@acme/probe',
    platforms: [],
    version: '1.0.0',
  });
  const copy = /\nvar controls = [^\n]+\n/u.exec(source)?.[0] ?? '';
  const escaping = /\nfunction escapeControlCharacters[\s\S]+?\n\}\n/u.exec(source)?.[0] ?? '';
  const escape: unknown = runInNewContext(`${copy}${escaping}escapeControlCharacters`);
  if (typeof escape !== 'function') {
    throw new TypeError('The launcher holds no escapeControlCharacters.');
  }
  let characters = '';
  for (let code = 0; code < 0x3_00_00; code += 1) {
    // A lone surrogate is no character, so the range skips them.
    characters += code >= 0xd8_00 && code <= 0xdf_ff ? '' : String.fromCodePoint(code);
  }
  expect(escape(characters)).toBe(escapeControlCharacters(characters));
});

/** Packs a package directory into `destination`, answering npm's report of the tarball. */
function pack(directory: string, destination: string, env: Record<string, string>) {
  // The npm program reads its project from the working directory, so the package's own lends it none.
  const packed = spawnSync('npm', ['pack', '--pack-destination', destination, '--json'], {
    cwd: directory,
    encoding: 'utf8',
    env,
    timeout: slow,
  });
  if (packed.status !== 0) {
    throw new Error(`npm pack failed:\n${packed.stderr}`);
  }
  const [report] = packSchema.parse(JSON.parse(packed.stdout));
  return report;
}

/** The port a listening server took. */
function portOf(server: Server): number {
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new TypeError('The registry is not listening on a port.');
  }
  return address.port;
}

/** Runs a program to its end without blocking the event loop, so the test's registry answers it. */
function finished(child: ChildProcess) {
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    child.on('close', (code) => {
      resolve({ code, output });
    });
  });
}

test.skipIf(!hostListed)(
  'npm install -g of the packed packages installs the host binary, which reads the method npm and the launcher package',
  async () => {
    const sandbox = temporaryRoot('loom-npm-global-');
    const npmEnvironment = childEnvironment({
      npm_config_audit: 'false',
      npm_config_cache: join(sandbox, 'cache'),
      npm_config_fund: 'false',
      npm_config_globalconfig: join(sandbox, 'globalrc'),
      npm_config_loglevel: 'error',
      npm_config_prefix: join(sandbox, 'prefix'),
      npm_config_update_notifier: 'false',
      npm_config_userconfig: join(sandbox, 'userrc'),
    });
    const tarballs = join(sandbox, 'tarballs');
    mkdirSync(tarballs);
    const npm = join(root, 'dist/npm');
    const launcher = pack(join(npm, 'probe'), tarballs, npmEnvironment);
    const platforms = written.map((platform) => {
      const directory = join(npm, `probe-${platform}`);
      return {
        manifest: platformSchema.parse(
          JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')),
        ),
        report: pack(directory, tarballs, npmEnvironment),
      };
    });
    const server = createServer((request, response) => {
      const url = decodeURIComponent(request.url ?? '');
      const port = portOf(server);
      const tarball = /^\/tarballs\/(?<file>[^/]+)$/u.exec(url)?.groups?.file;
      if (tarball !== undefined) {
        response.end(readFileSync(join(tarballs, tarball)));
        return;
      }
      const found = platforms.find(({ manifest: { name } }) => url === `/${name}`);
      if (found === undefined) {
        response.statusCode = 404;
        response.end('{}');
        return;
      }
      const { manifest: platform, report } = found;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          'dist-tags': { latest: platform.version },
          name: platform.name,
          versions: {
            [platform.version]: {
              ...platform,
              _id: `${platform.name}@${platform.version}`,
              dist: {
                integrity: report.integrity,
                shasum: report.shasum,
                tarball: `http://127.0.0.1:${String(port)}/tarballs/${report.filename}`,
              },
            },
          },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = portOf(server);
      const install = await finished(
        spawn('npm', ['install', '-g', join(tarballs, launcher.filename)], {
          cwd: sandbox,
          env: { ...npmEnvironment, npm_config_registry: `http://127.0.0.1:${String(port)}/` },
        }),
      );
      expect(install).toMatchObject({ code: 0 });
    } finally {
      server.close();
    }
    const installed = join(sandbox, 'prefix/lib/node_modules/@acme/probe');
    expect(readdirSync(join(installed, 'node_modules/@acme'))).toEqual([`probe-${host}`]);
    const run = spawnSync(join(sandbox, 'prefix/bin/probe'), ['facts'], {
      encoding: 'utf8',
      env: childEnvironment({}),
      timeout: runTimeout,
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const facts = factsSchema.parse(JSON.parse(run.stdout));
    expect(facts.installation?.method).toBe('npm');
    expect(facts.release?.npmPackage).toBe('@acme/probe');
  },
  slow,
);
