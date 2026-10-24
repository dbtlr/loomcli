/**
 * Asking PowerShell 7 for its profile: the program found on an absolute `PATH` entry, run from the
 * home folder with the pinned words, and its answer, the profile's path in Base64 of its UTF-8
 * bytes, decoded and judged.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { Host } from '@loomcli/core';

import { refusals } from './messages.js';

/** The program the profile query runs, and the shell its failures name. */
const shell = 'pwsh';

/** The words the shell runs with: no logo, no profile, no prompt, and one command. */
const words = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PROFILE))',
];

/** The code of a shell that answered. */
const succeeded = 0;

/** An answer's shape: Base64 digits alone. */
const answerShape = /^[A-Za-z0-9+/]+={0,2}$/u;

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
 * The shell's program: the first file named `pwsh` in an absolute entry of `PATH` that the process
 * may execute, as a shell runs one, so a program in the working directory or under a relative
 * entry never runs. A path the process cannot inspect is no program, so the lookup goes on to the
 * next entry. None when no entry holds one.
 */
function programOf(host: Host): string | undefined {
  return (host.env.PATH ?? '')
    .split(':')
    .filter((entry) => isAbsolute(entry))
    .map((entry) => join(entry, shell))
    .find((path) => isFile(path) && mayExecute(path));
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

/** The absolute profile path an answer reports, or none for an answer of any other shape. */
function profileOf(answer: string): string | undefined {
  if (!answerShape.test(answer)) {
    return undefined;
  }
  const path = decodedPath(answer);
  return path !== undefined && isAbsolute(path) ? path : undefined;
}

/** What a profile query reads: the application, the run, and the home folder it runs from. */
interface ProfileRequest {
  readonly name: string;
  readonly host: Host;
  readonly home: string;
  readonly signal: AbortSignal;
}

/**
 * Runs the program through `host.spawn` with the pinned words, `host.env` as its environment, the
 * home folder as its working directory, no shell, and no input, its standard error piped into the
 * host's, and answers its standard output with the trailing line break removed. A program that
 * cannot start, and one that exits with any code but 0, throw the pinned failure; the run signal
 * ends it with SIGTERM and then aborts the run.
 */
async function answerOf(request: ProfileRequest, program: string): Promise<string> {
  const { home, host, name, signal } = request;
  const answer = await host.spawn(program, words, { cwd: home, signal, stderr: host.stderr })
    .exited;
  signal.throwIfAborted();
  if (answer.kind === 'unstarted') {
    throw refusals.profile(name, shell, { kind: 'not-started' });
  }
  if (answer.code !== succeeded) {
    throw refusals.profile(name, shell, { code: answer.code, kind: 'exited' });
  }
  return answer.stdout.text.replace(trailingLineBreak, '');
}

/**
 * Asks PowerShell 7 for its profile. A shell not found on `PATH`, one that cannot start or exits
 * with any code but 0, and an answer of any other shape each throw the pinned failure.
 */
async function askProfile(request: ProfileRequest): Promise<string> {
  const { host, name } = request;
  const program = programOf(host);
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

export { askProfile };
