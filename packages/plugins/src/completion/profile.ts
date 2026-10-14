/**
 * Asking PowerShell for its profile: the program found on an absolute `PATH` entry, run from the
 * home folder with the pinned words, and its answer, the profile's path in Base64 of its UTF-8
 * bytes and the execution policy, decoded and judged.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { Host } from '@loomcli/core';

import { runChild } from '../child.js';
import { refusals } from './messages.js';
import { holdsControlCharacter, variable } from './shells.js';

/** What PowerShell reported: its profile's path and its execution policy. */
interface Profile {
  readonly path: string;
  readonly policy: string;
}

/** The words the shell runs with: no logo, no profile, no prompt, and one command. */
const words = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PROFILE)) + ' ' + (Get-ExecutionPolicy)",
];

/** The code of a shell that answered. */
const succeeded = 0;

/** An answer's shape: Base64 digits, one space, and the policy's name. */
const answerShape = /^(?<encoded>[A-Za-z0-9+/]+={0,2}) (?<policy>[A-Za-z]+)$/u;

/** The policies under which PowerShell runs no unsigned profile, so the line would load nothing. */
const blockingPolicies = new Set(['restricted', 'allsigned']);

/** A trailing line feed, or carriage return and line feed, which the answer ends with. */
const trailingLineBreak = /\r?\n$/u;

/** Whether the process may execute the path. */
function mayExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Whether a regular file is at the path, and `false` when the process cannot inspect it, as in a folder it may not search. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether a regular file is at the path that, off `win32`, the process may execute, as a shell runs one.
 * A path the process cannot inspect is no program, so the lookup goes on to the next entry.
 */
function isProgram(path: string, windows: boolean): boolean {
  return isFile(path) && (windows || mayExecute(path));
}

/**
 * The shell's program: the first file named `pwsh` or `powershell`, with `.exe` on `win32`, in an
 * absolute entry of `PATH` that off `win32` the process may execute, so a program in the working
 * directory or under a relative entry never runs. None when no entry holds one.
 */
function programOf(shell: 'powershell' | 'pwsh', host: Host): string | undefined {
  const windows = host.platform === 'win32';
  const file = windows ? `${shell}.exe` : shell;
  const entries = (variable(host, 'PATH') ?? '').split(windows ? ';' : ':');
  return entries
    .filter((entry) => isAbsolute(entry))
    .map((entry) => join(entry, file))
    .find((path) => isProgram(path, windows));
}

/** The UTF-8 text of some Base64 digits, or none when they are not whole Base64 of valid UTF-8. */
function decodedPath(encoded: string): string | undefined {
  const base64Block = 4;
  if (encoded.length % base64Block !== succeeded) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64'));
  } catch {
    return undefined;
  }
}

/** The profile an answer reports, or none for an answer of any other shape. */
function profileOf(answer: string): Profile | undefined {
  const groups = answerShape.exec(answer)?.groups;
  if (groups?.encoded === undefined || groups.policy === undefined) {
    return undefined;
  }
  const path = decodedPath(groups.encoded);
  if (path === undefined || !isAbsolute(path) || holdsControlCharacter(path)) {
    return undefined;
  }
  return { path, policy: groups.policy };
}

/** What a profile query reads: the application, the shell, the run, and the home folder it runs from. */
interface ProfileRequest {
  readonly name: string;
  readonly shell: 'powershell' | 'pwsh';
  readonly host: Host;
  readonly home: string;
  readonly signal: AbortSignal;
}

/**
 * Runs the program with the pinned words, `host.env` as its environment, the home folder as its
 * working directory, no shell, and no input, its standard error passed through to the host's, and
 * answers its standard output with the trailing line break removed. A program that cannot start,
 * and one that exits with any code but 0, throw the pinned failure; the run signal ends it with
 * SIGTERM and then aborts the run.
 */
async function answerOf(request: ProfileRequest, program: string): Promise<string> {
  const { home, host, name, shell, signal } = request;
  const answer = await runChild({
    cwd: home,
    env: host.env,
    program,
    signal,
    stderr: host.stderr,
    stdout: 'capture',
    words,
  });
  signal.throwIfAborted();
  if (answer.kind === 'missing') {
    throw refusals.profile(name, shell, { kind: 'not-started' });
  }
  if (answer.code !== succeeded) {
    throw refusals.profile(name, shell, { code: answer.code, kind: 'exited' });
  }
  return answer.stdout.replace(trailingLineBreak, '');
}

/**
 * Asks the shell for its profile and execution policy. A shell not found on `PATH`, one that
 * cannot start or exits with any code but 0, and an answer of any other shape each throw the
 * pinned failure.
 */
async function askProfile(request: ProfileRequest): Promise<Profile> {
  const { host, name, shell } = request;
  const program = programOf(shell, host);
  if (program === undefined) {
    throw refusals.profile(name, shell, { kind: 'not-started' });
  }
  const answer = await answerOf(request, program);
  const profile = profileOf(answer);
  if (profile === undefined) {
    throw refusals.profile(name, shell, { answer, kind: 'reported' });
  }
  return profile;
}

/** Whether PowerShell runs no unsigned profile under the policy: `Restricted` or `AllSigned`. */
function blocksProfile(policy: string): boolean {
  return blockingPolicies.has(policy.toLowerCase());
}

export type { Profile };
export { askProfile, blocksProfile, profileOf };
