/**
 * The update notices' middleware: after the action of a run at a terminal, it prints one line when
 * the cache names a newer release on the running binary's channel, and refreshes a stale cache
 * through a detached copy of the application, which the run never waits for. At `-v` it names the
 * cache it read and the refresh it started, and at `-vv` why it did nothing and a cache it ignored.
 */
import { applicationDirectory } from '@loomcli/core';
import type { Host, Log, Middleware, Out } from '@loomcli/core';

import { fileWritten } from '../change-events.js';
import { underCI } from '../ci.js';
import { passOver, say } from '../lane-writes.js';
import { releaseBinary } from './binary.js';
import { cachePath, findCache, stale, writeCache } from './cache.js';
import type { CacheEntry, CacheReading, Lookup } from './cache.js';
import {
  ignoredUpdateCache,
  readUpdateCheck,
  skippedUpdateCheck,
  startedRefresh,
  updateNotice,
} from './messages.js';
import type { UpdateCheckSkip } from './messages.js';
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
 * The reason the first of conditions 2 to 5 of the contract that fails names, in its order: no
 * opt-out variable, both output streams at a terminal, not CI, and not `self-update` itself; or
 * `undefined` when all hold.
 */
function ineligibility({ host, optOut, routed }: Candidate): UpdateCheckSkip | undefined {
  const { env } = host;
  const reason = optedOut(env, optOut) ?? notTerminal(host.terminal);
  if (reason !== undefined) {
    return reason;
  }
  if (underCI(env)) {
    return { kind: 'ci' };
  }
  return routed.join(' ') === commandName ? { kind: 'self-update' } : undefined;
}

/** The opt-out variable that is set, the operator's before the author's, as its reason. */
function optedOut(env: Host['env'], optOut: string | undefined): UpdateCheckSkip | undefined {
  if (isSet(env, operatorOptOut)) {
    return { kind: 'opted-out', variable: operatorOptOut };
  }
  return optOut !== undefined && isSet(env, optOut)
    ? { kind: 'opted-out', variable: optOut }
    : undefined;
}

/** The first output stream that is not a terminal, stdout before stderr, as its reason. */
function notTerminal(terminal: Host['terminal']): UpdateCheckSkip | undefined {
  if (!terminal.stdout.isTTY) {
    return { kind: 'stdout' };
  }
  return terminal.stderr.isTTY ? undefined : { kind: 'stderr' };
}

/**
 * The running binary's version and lookup, when a release binary the installer script placed, or
 * the reason it is not one.
 */
function scriptRelease(
  host: Host,
  name: string,
): (Lookup & { readonly running: Version }) | { readonly skipped: UpdateCheckSkip } {
  const binary = releaseBinary(host);
  if (binary === undefined) {
    return { skipped: { kind: 'not-release', name } };
  }
  if (host.release.installation?.method !== 'script') {
    return { skipped: { kind: 'not-script', name } };
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
 * the last two are a script-installed release binary and a cache directory that resolves. A run
 * that fails one answers the reason the first that fails names.
 */
function qualified(candidate: Candidate): Qualified | { readonly skipped: UpdateCheckSkip } {
  const reason = ineligibility(candidate);
  if (reason !== undefined) {
    return { skipped: reason };
  }
  const { host, name } = candidate;
  const release = scriptRelease(host, name);
  if ('skipped' in release) {
    return release;
  }
  const directory = applicationDirectory('cache', name, host);
  return 'variable' in directory
    ? { skipped: { kind: 'not-absolute', variable: directory.variable } }
    : { ...release, directory: directory.path, host, name };
}

/** The cache's newer version, when it names one above the running version. */
function newerVersion(reading: CacheReading, running: Version): Version | undefined {
  const latest = typeof reading.latest === 'string' ? parseVersion(reading.latest) : undefined;
  return latest !== undefined && compareVersions(latest, running) > equalPrecedence
    ? latest
    : undefined;
}

/** The notice line, which names the newer version and the running one. */
function noticeLine({ channel, name, running }: Qualified, newer: Version): string {
  return updateNotice({ channel, found: newer.text, name, running: running.text });
}

/**
 * Starts `[...program, 'self-update', '--refresh-notice']` through `host.spawn` as a detached
 * child, in the cache directory, with every stream ignored, and releases it, answering whether
 * `host.spawn` returned it. A child that cannot start, at the call, as a mock with no script for it
 * throws, or through `exited`, is passed over.
 */
function startRefresh(host: Host, directory: string): boolean {
  const [command, ...words] = host.program;
  if (command === undefined) {
    return false;
  }
  try {
    // The run never waits for the refresh, and `exited` never rejects, so its answer is released.
    void host.spawn(command, [...words, ...refreshWords], { cwd: directory, detached: true })
      .exited;
    return true;
  } catch {
    // A notice is a courtesy: its own faults are not the run's.
    passOver();
    return false;
  }
}

/**
 * Writes `checked` first, recording the write, then starts the child, answering whether it
 * started; a `checked` that cannot be written starts none.
 */
function refresh(run: Qualified, entry: CacheEntry, log: Log): boolean {
  try {
    fileWritten(log, { path: writeCache(run.directory, entry) });
  } catch {
    return false;
  }
  return startRefresh(run.host, run.directory);
}

/** Reads the cache, naming it at `-v` when it is one this version reads, or at `-vv` when not. */
async function readNamed(run: Qualified, out: Out, now: number): Promise<CacheReading> {
  const found = findCache(run.directory, run, now);
  const path = cachePath(run.directory);
  if (found.kind === 'ignored') {
    await say(out.trace(ignoredUpdateCache(path)));
  }
  if (found.kind !== 'read') {
    return stale;
  }
  await say(out.debug(readUpdateCheck(path)));
  return found.reading;
}

/**
 * Prints the notice when the cache names a newer version, then refreshes a stale cache, writing the
 * cached `latest` back when only its `checked` was at fault.
 */
async function notify(run: Qualified, { log, out }: { log: Log; out: Out }): Promise<void> {
  const now = Date.now();
  const reading = await readNamed(run, out, now);
  const newer = newerVersion(reading, run.running);
  if (newer !== undefined) {
    await say(out.info(noticeLine(run, newer)));
  }
  if (!reading.fresh) {
    const { channel, repository } = run;
    const entry = { channel, checked: new Date(now), latest: reading.latest, repository };
    if (refresh(run, entry, log)) {
      await say(out.debug(startedRefresh));
    }
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
    const { command, graph, host, log, out } = context;
    const run = qualified({ host, name: graph.name, optOut, routed: command.path });
    if ('skipped' in run) {
      await say(out.trace(skippedUpdateCheck(run.skipped)));
      return;
    }
    await notify(run, { log, out });
  };
}

export { noticeMiddleware };
