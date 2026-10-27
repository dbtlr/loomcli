import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as after } from 'node:timers/promises';

import { findOnPath } from '../../../scripts/test-shell.js';
import { installerScript } from '../src/content/installer-script.js';
import { renderManaged } from '../src/helpers/managed.js';
import { temporaryRoot } from './fixture.js';

/** How long one run of the script may take before the test fails. */
const runTimeout = 20_000;

/** A value as one single-quoted shell word. */
function quoted(value: string) {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/** A tool the fakes need, resolved once, which a machine running the suite always holds. */
function requiredTool(name: string) {
  const tool = findOnPath(name);
  if (tool === undefined) {
    throw new Error(`The installer tests need ${name} on PATH.`);
  }
  return tool;
}

/** Writes an executable shell script. */
function executable(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, 0o755);
}

/**
 * The shell body both fake downloaders share once they have read `url`: log the URL, then write
 * the answer to stdout from the fixture directory, which holds each file under its URL without
 * `https://`, as both downloaders do when the script redirects their output. A URL that is not
 * HTTPS finds no file. The sleeping URL writes a few bytes and sleeps, after it marks the log, so a
 * test can signal the run mid-download. `missing` runs when no file answers.
 */
function serve(box: { log: string; release: string }, fakes: Fakes, missing: string) {
  const sleep =
    fakes.sleepOn === undefined
      ? ''
      : `if [ "$url" = ${quoted(fakes.sleepOn)} ]; then
  printf partial
  printf 'sleeping\\n' >>${quoted(`${box.log}.sleeping`)}
  exec ${quoted(requiredTool('sleep'))} ${fakes.sleepSeconds ?? 30}
fi
`;
  return `printf '%s\\n' "$url" >>${quoted(box.log)}
${sleep}case $url in https://*) file=${quoted(box.release)}/\${url#https://} ;; *) file= ;; esac
if [ -n "$file" ] && [ -f "$file" ]; then
  ${quoted(requiredTool('cat'))} "$file"
  exit 0
fi
${missing}
`;
}

/** Writes the fakes into a directory: `uname`, `sysctl`, `ldd`, and the chosen downloaders. */
function writeFakes(directory: string, box: { log: string; release: string }, fakes: Fakes) {
  executable(
    join(directory, 'uname'),
    `case $1 in -m) echo ${quoted(fakes.arch ?? 'x86_64')} ;; *) echo ${quoted(fakes.os ?? 'Linux')} ;; esac\n`,
  );
  executable(
    join(directory, 'sysctl'),
    fakes.translated === undefined
      ? "echo 'sysctl: unknown oid' >&2\nexit 1\n"
      : `[ "$1 $2" = '-n sysctl.proc_translated' ] || exit 1\necho ${quoted(fakes.translated)}\n`,
  );
  const libc = fakes.libc ?? 'glibc';
  if (libc !== 'missing') {
    executable(
      join(directory, 'ldd'),
      libc === 'musl'
        ? "echo 'musl libc (x86_64)' >&2\necho 'Version 1.2.4' >&2\nexit 1\n"
        : "echo 'ldd (GNU libc) 2.39'\n",
    );
  }
  if (fakes.refuseRenameOnto !== undefined) {
    executable(
      join(directory, 'mv'),
      `for destination in "$@"; do :; done
if [ "\${destination##*/}" = ${quoted(fakes.refuseRenameOnto)} ]; then
  echo "mv: cannot move to '$destination': Permission denied" >&2
  exit 1
fi
exec ${quoted(requiredTool('mv'))} "$@"
`,
    );
  }
  const downloaders = fakes.downloaders ?? ['curl', 'gnu-wget'];
  if (downloaders.includes('curl')) {
    executable(
      join(directory, 'curl'),
      `printf 'curl %s\\n' "$*" >>${quoted(`${box.log}.argv`)}
fail= url=
while [ $# -gt 0 ]; do
  case $1 in
    --fail) fail=1 ;;
    --proto | --proto-redir) shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
${serve(
  box,
  fakes,
  `if [ -n "$fail" ]; then
  echo 'curl: (22) The requested URL returned error: 404' >&2
  exit 22
fi
printf 'Not Found'
exit 0`,
)}`,
    );
  }
  const wget = downloaders.find((downloader) => downloader !== 'curl');
  if (wget !== undefined) {
    const version =
      wget === 'gnu-wget'
        ? "echo 'GNU Wget 1.21.4 built on linux-gnu.'\nexit 0"
        : "echo 'wget: unrecognized option: version' >&2\necho 'BusyBox v1.36.1 (2024-01-01 00:00:00 UTC) multi-call binary.' >&2\nexit 1";
    executable(
      join(directory, 'wget'),
      `printf 'wget %s\\n' "$*" >>${quoted(`${box.log}.argv`)}
url=
for argument in "$@"; do
  case $argument in
    --version) ${version.replaceAll('\n', '; ')} ;;
    -*) ;;
    *) url=$argument ;;
  esac
done
${serve(box, fakes, `echo "$url:" >&2\necho '2026-10-12 12:00:00 ERROR 404: Not Found.' >&2\nexit 8`)}`,
    );
  }
}

/** Links each named real tool the machine holds into a directory. */
function linkTools(directory: string, tools: readonly string[]) {
  for (const tool of tools) {
    const real = findOnPath(tool);
    if (real !== undefined) {
      symlinkSync(real, join(directory, tool));
    }
  }
}

/**
 * The environment one run starts from: the sandbox's PATH, its home, and its state directory,
 * with the supplied variables on top. A variable set to `undefined` is unset.
 */
function environment(box: Sandbox, env: Record<string, string | undefined>) {
  const merged: Record<string, string | undefined> = {
    HOME: box.home,
    PATH: box.path,
    XDG_STATE_HOME: box.state,
    ...env,
  };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** The application the rendered script installs, and the repository it reads releases from. */
export const app = 'notes';
export const repo = 'me/notes';

/** The release URLs the script reads, with no version and for `1.4.0`. */
export const latest = `https://github.com/${repo}/releases/latest/download/`;
export const tagged = `https://github.com/${repo}/releases/download/v1.4.0/`;

/** The tools the script runs that no fake stands in for, linked into the minimal PATH. */
export const scriptTools = ['chmod', 'mkdir', 'mktemp', 'mv', 'rm', 'sha256sum', 'shasum'];

/** The downloaders a sandbox can offer. */
export type Downloader = 'busybox-wget' | 'curl' | 'gnu-wget';

/** What the fakes report and serve. Every field has the default a plain Linux x64 machine reads. */
export interface Fakes {
  /** What `uname -m` prints. */
  readonly arch?: string;
  /** The downloaders on PATH, by default `curl` and GNU Wget. */
  readonly downloaders?: readonly Downloader[];
  /** What `ldd --version` reports, or `missing` for no `ldd` on PATH. */
  readonly libc?: 'glibc' | 'missing' | 'musl';
  /** What `uname -s` prints. */
  readonly os?: string;
  /** The release fixture: each URL the fakes answer and the bytes they answer it with. */
  readonly release?: Readonly<Record<string, string>>;
  /**
   * A file name a fake `mv` refuses to rename onto, in any directory, as a failed rename would; any
   * other rename runs the real `mv`.
   */
  readonly refuseRenameOnto?: string;
  /** A URL whose download writes a few bytes and then sleeps, so a test can end the run. */
  readonly sleepOn?: string;
  /** How long the sleeping download sleeps, by default 30 seconds. */
  readonly sleepSeconds?: number;
  /** The real tools linked into the minimal PATH, by default `scriptTools`. */
  readonly tools?: readonly string[];
  /** What `sysctl -n sysctl.proc_translated` prints, or `undefined` for a `sysctl` that fails. */
  readonly translated?: string;
}

/** One sandbox: its directories, the minimal PATH, and the rendered script. */
export interface Sandbox {
  /** The PATH of the fakes and the linked tools, nothing else. */
  readonly path: string;
  /** The directory the fake downloaders serve each URL from, without `https://`. */
  readonly release: string;
  readonly home: string;
  readonly log: string;
  readonly root: string;
  readonly script: string;
  readonly state: string;
  readonly work: string;
}

/** The SHA-256 of a text's UTF-8 bytes, in lowercase hex, for building a fixture's SHA256SUMS. */
export function sha256(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A `SHA256SUMS` listing each asset, as `sha256sum` prints it. */
export function sums(assets: Readonly<Record<string, string>>) {
  return Object.entries(assets)
    .map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`)
    .join('');
}

/** A release under one base URL: each asset and the `SHA256SUMS` that lists them. */
export function release(base: string, assets: Readonly<Record<string, string>>) {
  const files: Record<string, string> = { [`${base}SHA256SUMS`]: sums(assets) };
  for (const [name, bytes] of Object.entries(assets)) {
    files[`${base}${name}`] = bytes;
  }
  return files;
}

/** The default fixture: `notes-linux-x64`, whose bytes are `test`, in the latest release and v1.4.0. */
export const defaultRelease = {
  ...release(latest, { [`${app}-linux-x64`]: 'test' }),
  ...release(tagged, { [`${app}-linux-x64`]: 'test' }),
};

/** Writes each URL's bytes where the fake downloaders serve it from. */
export function publish(directory: string, files: Readonly<Record<string, string>>) {
  for (const [url, bytes] of Object.entries(files)) {
    const file = join(directory, url.replace(/^https:\/\//u, ''));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
}

/**
 * A fresh sandbox: a temporary home, state directory, and working directory, the fakes and the
 * linked tools as the whole PATH, the release fixture, and the script rendered as init writes it.
 */
export function sandbox(fakes: Fakes = {}, rendered?: string): Sandbox {
  const root = temporaryRoot('loom-installer-');
  const directories = {
    fakes: join(root, 'fakes'),
    home: join(root, 'home'),
    release: join(root, 'release'),
    state: join(root, 'state'),
    tools: join(root, 'tools'),
    work: join(root, 'work'),
  };
  for (const directory of Object.values(directories)) {
    mkdirSync(directory);
  }
  const log = join(root, 'downloads.log');
  publish(directories.release, fakes.release ?? defaultRelease);
  writeFakes(directories.fakes, { log, release: directories.release }, fakes);
  linkTools(directories.tools, fakes.tools ?? scriptTools);
  const script = join(root, 'install.sh');
  writeFileSync(script, rendered ?? renderManaged(installerScript(app, repo)));
  return {
    home: directories.home,
    log,
    path: `${directories.fakes}:${directories.tools}`,
    release: directories.release,
    root,
    script,
    state: directories.state,
    work: directories.work,
  };
}

/** One run of the script under `/bin/sh` in the sandbox's working directory. */
export function runScript(
  box: Sandbox,
  args: readonly string[] = [],
  env: Record<string, string | undefined> = {},
) {
  const result = spawnSync('/bin/sh', [box.script, ...args], {
    cwd: box.work,
    encoding: 'utf8',
    env: environment(box, env),
    timeout: runTimeout,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/**
 * A run of the script that a `SIGTERM` ends once the sleeping download, or the sleeping fake
 * released binary, has begun. `group` signals
 * the whole process group, as a terminal's signal reaches both `sh` and the downloader; `shell`
 * signals `sh` alone, which runs its trap once the downloader exits. It resolves to the exit code
 * and what the script wrote to stderr.
 */
export async function runScriptUntilSignal(
  box: Sandbox,
  reach: 'group' | 'shell',
  env: Record<string, string | undefined> = {},
): Promise<{ status: number | null; stderr: string }> {
  const child = spawn('/bin/sh', [box.script], {
    cwd: box.work,
    detached: true,
    env: environment(box, env),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      resolve(code);
    });
  });
  const deadline = Date.now() + runTimeout;
  while (!existsSync(`${box.log}.sleeping`)) {
    if (Date.now() > deadline) {
      throw new Error('The sleeping download never began.');
    }
    await after(20);
  }
  if (child.pid === undefined) {
    throw new Error('The script did not start.');
  }
  process.kill(reach === 'group' ? -child.pid : child.pid, 'SIGTERM');
  return { status: await exited, stderr };
}

/** Each URL the fake downloaders were asked for, in order. */
export function requested(box: Sandbox): string[] {
  return existsSync(box.log) ? readFileSync(box.log, 'utf8').split('\n').filter(Boolean) : [];
}

/** Each downloader command line the fakes ran, in order. */
export function commandLines(box: Sandbox): string[] {
  const argv = `${box.log}.argv`;
  return existsSync(argv) ? readFileSync(argv, 'utf8').split('\n').filter(Boolean) : [];
}

/** Every entry under a directory, by relative path, or `undefined` when it does not exist. */
export function entries(directory: string): string[] | undefined {
  if (!existsSync(directory)) {
    return undefined;
  }
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
    .toSorted();
}

/**
 * A fake released binary, the asset a post-install case installs. Each run writes, beside the
 * sandbox's log, the words it received, each followed by a NUL; whether its stdin is a terminal, a
 * device such as `/dev/null`, or another file; the line it read from stdin; its working directory;
 * and the `install.json` it found. It prints `Set up notes.` and exits with `LOOM_FAKE_STATUS`, 0
 * by default. The variables it reads are the test's, which reach it because the script passes its
 * environment through.
 */
export function recordingBinary(box: Pick<Sandbox, 'log'>, record: string) {
  const log = quoted(`${box.log}.binary`);
  return `#!/bin/sh
printf '%s\\000' "$@" >${log}.argv
if [ -t 0 ]; then stdin=terminal; elif [ -c /dev/fd/0 ]; then stdin=device; else stdin=other; fi
printf '%s\\n' "$stdin" >${log}.stdin
printf '%s\\n' "$PWD" >${log}.cwd
if [ -f ${quoted(record)} ]; then ${quoted(requiredTool('cat'))} ${quoted(record)} >${log}.record; fi
if [ -n "\${LOOM_FAKE_PROMPT:-}" ]; then printf '%s\\n' "$LOOM_FAKE_PROMPT" >&2; fi
if [ -n "\${LOOM_FAKE_SLEEP:-}" ]; then printf 'sleeping\\n' >>${quoted(`${box.log}.sleeping`)}; ${quoted(requiredTool('sleep'))} "$LOOM_FAKE_SLEEP"; fi
line=
IFS= read -r line || :
printf '%s' "$line" >${log}.input
echo 'Set up notes.'
exit "\${LOOM_FAKE_STATUS:-0}"
`;
}

/** What the fake released binary recorded of its runs, or `undefined` for a file it never wrote. */
export function binaryRecord(box: Sandbox) {
  const read = (suffix: string) => {
    const path = `${box.log}.binary.${suffix}`;
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  };
  const argv = read('argv');
  return {
    argv: argv === undefined ? undefined : argv.split('\0').slice(0, -1),
    cwd: read('cwd')?.trimEnd(),
    input: read('input'),
    record: read('record'),
    stdin: read('stdin')?.trimEnd(),
  };
}

/** How a detached run of the script reads it: from its path, or from stdin as `curl | sh` does. */
export type Reading = 'path' | 'stdin';

/**
 * One run of the script under `/bin/sh` in a session of its own, so it has no controlling terminal
 * and `/dev/tty` does not open. Its stdin holds `input` when it reads the script from its path, and
 * the script alone when it reads it from stdin. It resolves to the exit code and what the run wrote.
 */
export async function runDetached(
  box: Sandbox,
  options: {
    args?: readonly string[];
    env?: Record<string, string | undefined>;
    input?: string;
    reading?: Reading;
  } = {},
): Promise<{ status: number | null; stderr: string; stdout: string }> {
  const { args = [], env = {}, input = '', reading = 'path' } = options;
  const argv = reading === 'path' ? [box.script, ...args] : ['-s', '--', ...args];
  const child = spawn('/bin/sh', argv, {
    cwd: box.work,
    detached: true,
    env: environment(box, env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The script did not finish within ${runTimeout} ms.`));
    }, runTimeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(reading === 'stdin' ? readFileSync(box.script, 'utf8') : input);
  return { status: await exited, stderr, stdout };
}
