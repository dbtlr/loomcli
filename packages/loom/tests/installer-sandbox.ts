import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { setTimeout as after } from 'node:timers/promises';

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
  const tool = realTool(name);
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
 * The shell body both fake downloaders share once they have read `url` and `output`: log the URL,
 * then answer from the fixture directory, which holds each file under its URL without `https://`.
 * A URL that is not HTTPS finds no file. The sleeping URL writes a few bytes and sleeps, after it
 * marks the log, so a test can signal the run mid-download. `missing` runs when no file answers.
 */
function serve(
  box: { log: string; release: string },
  sleepOn: string | undefined,
  missing: string,
) {
  const sleep =
    sleepOn === undefined
      ? ''
      : `if [ "$url" = ${quoted(sleepOn)} ]; then
  printf partial >"$output"
  printf 'sleeping\\n' >>${quoted(`${box.log}.sleeping`)}
  exec ${quoted(requiredTool('sleep'))} 30
fi
`;
  return `printf '%s\\n' "$url" >>${quoted(box.log)}
${sleep}case $url in https://*) file=${quoted(box.release)}/\${url#https://} ;; *) file= ;; esac
if [ -n "$file" ] && [ -f "$file" ]; then
  ${quoted(requiredTool('cat'))} "$file" >"$output"
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
  const downloaders = fakes.downloaders ?? ['curl', 'gnu-wget'];
  if (downloaders.includes('curl')) {
    executable(
      join(directory, 'curl'),
      `printf 'curl %s\\n' "$*" >>${quoted(`${box.log}.argv`)}
fail= output= url=
while [ $# -gt 0 ]; do
  case $1 in
    --fail) fail=1 ;;
    --output) shift; output=$1 ;;
    --proto | --proto-redir) shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
${serve(box, fakes.sleepOn, '[ -z "$fail" ] || exit 22\nprintf "Not Found" >"$output"\nexit 0')}`,
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
output= url=
for argument in "$@"; do
  case $argument in
    --version) ${version.replaceAll('\n', '; ')} ;;
    --output-document=*) output=\${argument#--output-document=} ;;
    -*) ;;
    *) url=$argument ;;
  esac
done
${serve(box, fakes.sleepOn, 'exit 8')}`,
    );
  }
}

/** Links each named real tool the machine holds into a directory. */
function linkTools(directory: string, tools: readonly string[]) {
  for (const tool of tools) {
    const real = realTool(tool);
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
  /** A URL whose download writes a few bytes and then sleeps, so a test can end the run. */
  readonly sleepOn?: string;
  /** The real tools linked into the minimal PATH, by default `scriptTools`. */
  readonly tools?: readonly string[];
  /** What `sysctl -n sysctl.proc_translated` prints, or `undefined` for a `sysctl` that fails. */
  readonly translated?: string;
}

/** One sandbox: its directories, the minimal PATH, and the rendered script. */
export interface Sandbox {
  /** The PATH of the fakes and the linked tools, nothing else. */
  readonly path: string;
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

/** The executable a tool's name resolves to on the test process's own PATH, if any. */
export function realTool(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return undefined;
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
  for (const [url, bytes] of Object.entries(fakes.release ?? defaultRelease)) {
    const file = join(directories.release, url.replace(/^https:\/\//u, ''));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  writeFakes(directories.fakes, { log, release: directories.release }, fakes);
  linkTools(directories.tools, fakes.tools ?? scriptTools);
  const script = join(root, 'install.sh');
  writeFileSync(script, rendered ?? renderManaged(installerScript(app, repo)));
  return {
    home: directories.home,
    log,
    path: `${directories.fakes}:${directories.tools}`,
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
 * A run of the script that a `SIGTERM` to its process group ends once the sleeping download has
 * begun, as a terminal's signal reaches both `sh` and the downloader. It resolves to the exit code.
 */
export async function runScriptUntilSignal(box: Sandbox): Promise<number | null> {
  const child = spawn('/bin/sh', [box.script], {
    cwd: box.work,
    detached: true,
    env: environment(box, {}),
    stdio: 'ignore',
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
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
  process.kill(-child.pid, 'SIGTERM');
  return exited;
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
