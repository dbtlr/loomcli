/**
 * The update notices' middleware: after the action of a run at a terminal, it prints one line when
 * the cache names a newer release on the running binary's channel, and refreshes a stale cache
 * through a detached copy of the application, which the run never waits for.
 */
import { spawn } from 'node:child_process';

import { applicationDirectory, escapeControlCharacters } from '@loomcli/core';
import type { Host, Middleware, Out } from '@loomcli/core';

import { releaseBinary } from './binary.js';
import { readCache, writeCache } from './cache.js';
import type { CacheEntry, CacheReading, Lookup } from './cache.js';
import type { selfUpdate } from './plugin.js';
import { compareVersions, equalPrecedence, parseVersion } from './version.js';
import type { Version } from './version.js';

/** The variable any operator sets to turn update notices off. */
const operatorOptOut = 'NO_UPDATE_NOTIFIER';

/** The plugin's Command, whose own runs show no notice. */
const commandName = 'self-update';

/** The words the refresh child runs after `host.program`. */
const refreshWords = [commandName, '--refresh-notice'];

/** Whether a variable is set to something other than the empty string. */
function isSet(env: Host['env'], name: string): boolean {
  const value = env[name];
  return value !== undefined && value !== '';
}

/** What the middleware reads of a run before it reads any file. */
interface Candidate {
  readonly name: string;
  readonly host: Host;
  /** The routed Command's path. */
  readonly routed: readonly string[];
  /** The author's variable that turns notices off, when there is one. */
  readonly optOut: string | undefined;
}

/**
 * Whether conditions 2 to 5 of the contract hold, in its order: no opt-out variable, both output
 * streams at a terminal, not CI, and not `self-update` itself.
 */
function isEligible({ host, optOut, routed }: Candidate): boolean {
  const { env, terminal } = host;
  return !(
    isSet(env, operatorOptOut) ||
    (optOut !== undefined && isSet(env, optOut)) ||
    !terminal.stdout.isTTY ||
    !terminal.stderr.isTTY ||
    isSet(env, 'CI') ||
    routed.join(' ') === commandName
  );
}

/** The running binary's version and lookup, when a release binary the installer script placed. */
function scriptRelease(host: Host): (Lookup & { readonly running: Version }) | undefined {
  const binary = releaseBinary(host);
  if (binary === undefined || host.release.installation?.method !== 'script') {
    return undefined;
  }
  const { channel, repository, running } = binary;
  return { channel, repository, running };
}

/**
 * A run that may show a notice: the graph's name, the host, the running binary's version and
 * lookup, and the cache directory.
 */
interface Qualified extends Lookup {
  readonly name: string;
  readonly host: Host;
  readonly running: Version;
  readonly directory: string;
}

/**
 * The run's binary and cache directory when conditions 2 to 7 of the contract hold, in its order;
 * the last two are a script-installed release binary and a cache directory that resolves.
 */
function qualified(candidate: Candidate): Qualified | undefined {
  const release = isEligible(candidate) ? scriptRelease(candidate.host) : undefined;
  if (release === undefined) {
    return undefined;
  }
  const { host, name } = candidate;
  const directory = applicationDirectory('cache', name, host);
  return 'variable' in directory
    ? undefined
    : { ...release, directory: directory.path, host, name };
}

/** The cache's newer version, when it names one above the running version. */
function newerVersion(reading: CacheReading, running: Version): Version | undefined {
  const latest = typeof reading.latest === 'string' ? parseVersion(reading.latest) : undefined;
  return latest !== undefined && compareVersions(latest, running) > equalPrecedence
    ? latest
    : undefined;
}

/** The notice line, each value it repeats passed through `escapeControlCharacters`. */
function noticeLine({ channel, name, running }: Qualified, newer: Version): string {
  const shown = escapeControlCharacters;
  return `${shown(name)} ${shown(newer.text)} is available on the ${shown(channel)} channel. Run ${shown(name)} self-update to update from ${shown(running.text)}.`;
}

/** Passes over a fault the update notices never report. */
function passOver(): void {
  // A notice is a courtesy: its own faults are not the run's.
}

/**
 * Starts `[...program, 'self-update', '--refresh-notice']` detached, in the cache directory, with
 * every stream ignored, and releases it. A child that cannot start, at the call or through its
 * `error` event, is passed over.
 */
function startRefresh(host: Host, directory: string): void {
  const [command, ...words] = host.program;
  if (command === undefined) {
    return;
  }
  try {
    const child = spawn(command, [...words, ...refreshWords], {
      cwd: directory,
      detached: true,
      env: { ...host.env },
      stdio: 'ignore',
    });
    child.on('error', passOver);
    child.unref();
  } catch {
    passOver();
  }
}

/**
 * Writes `checked` first, then starts the child; a `checked` that cannot be written starts none.
 */
function refresh(host: Host, directory: string, entry: CacheEntry): void {
  try {
    writeCache(directory, entry);
  } catch {
    return;
  }
  startRefresh(host, directory);
}

/**
 * Prints the notice when the cache names a newer version, then refreshes a stale cache, writing the
 * cached `latest` back when only its `checked` was at fault.
 */
async function notify(run: Qualified, out: Out): Promise<void> {
  const now = Date.now();
  const reading = readCache(run.directory, run, now);
  const newer = newerVersion(reading, run.running);
  if (newer !== undefined) {
    // Core's output contract alone reports a write that fails; the notice lets it go.
    await out.info(noticeLine(run, newer)).catch(passOver);
  }
  if (!reading.fresh) {
    const { channel, repository } = run;
    const entry = { channel, checked: new Date(now), latest: reading.latest, repository };
    refresh(run.host, run.directory, entry);
  }
}

/**
 * The middleware for one `selfUpdate()` call whose notices are on, `optOut` the author's variable.
 * It calls `next()` first and acts only once the action was dispatched and the run not cancelled.
 */
function noticeMiddleware(optOut: string | undefined): Middleware<typeof selfUpdate> {
  return async (context) => {
    const outcome = await context.next();
    if (outcome !== 'dispatched' || context.signal.aborted) {
      return;
    }
    const { command, graph, host, out } = context;
    const run = qualified({ host, name: graph.name, optOut, routed: command.path });
    if (run !== undefined) {
      await notify(run, out);
    }
  };
}

export { noticeMiddleware };
