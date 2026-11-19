/**
 * The update notices' middleware: after the action of a run at a terminal, it prints one line when
 * the cache names a newer release on the running application's channel, and refreshes a stale cache
 * through a detached copy of the application, which the run never waits for. At `-v` it names the
 * cache it read and the refresh it started, and at `-vv` why it did nothing and a cache it ignored.
 */
import { applicationDirectory } from '@loomcli/core';
import type { Host, Log, Middleware, Out, ReleaseFacts } from '@loomcli/core';

import { fileWritten } from '../change-events.js';
import { underCI } from '../ci.js';
import { passOver, say } from '../lane-writes.js';
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
import { effectiveInstallation, upgradeCommand } from './upgrade.js';
import type { UpgradeCommand } from './upgrade.js';
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

/** The release and command a notice needs. */
interface NoticeRelease extends Lookup {
  readonly command: UpgradeCommand;
  readonly running: Version;
}

/** A run that can check the cache and show an upgrade command. */
interface Qualified extends NoticeRelease {
  readonly name: string;
  readonly host: Host;
  readonly directory: string;
}

/** The release facts that give a notice its upgrade command, or the reason they cannot. */
function noticeRelease({
  host,
  name,
}: Candidate): NoticeRelease | { readonly skipped: UpdateCheckSkip } {
  const { release } = host.release;
  if (release === undefined) {
    return { skipped: { kind: 'not-release', name } };
  }
  // The refusal of `self-update` reads this installation too, so a notice never names a command it refuses.
  const installation = effectiveInstallation(host.release, host.platform);
  if (installation === undefined) {
    return { skipped: { kind: 'not-installed', name } };
  }
  return releaseCommand(name, { ...host.release, installation, release });
}

/** The command and running version of an installed release, or the reason they cannot be read. */
function releaseCommand(
  name: string,
  facts: ReleaseFacts & Required<Pick<ReleaseFacts, 'installation' | 'release'>>,
): NoticeRelease | { readonly skipped: UpdateCheckSkip } {
  const { installation, release } = facts;
  const command = upgradeCommand(name, facts);
  const running = parseVersion(release.version);
  if (command === undefined || running === undefined) {
    return { skipped: { kind: 'no-command', method: installation.method, name } };
  }
  return { channel: release.channel, command, repository: release.repository, running };
}

/** Qualifies a run in the contract's order before reading the cache. */
function qualified(candidate: Candidate): Qualified | { readonly skipped: UpdateCheckSkip } {
  const reason = ineligibility(candidate);
  if (reason !== undefined) {
    return { skipped: reason };
  }
  const release = noticeRelease(candidate);
  if ('skipped' in release) {
    return release;
  }
  const { host, name } = candidate;
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
function noticeLine({ channel, command, name, running }: Qualified, newer: Version): string {
  return updateNotice({ channel, found: newer.text, name, running: running.text }, command);
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

/**
 * Reads the cache, logging it at `debug` when it is one this version reads, or at `trace` when
 * not.
 */
function readNamed(run: Qualified, log: Log, now: number): CacheReading {
  const found = findCache(run.directory, run, now);
  const path = cachePath(run.directory);
  if (found.kind === 'ignored') {
    const ignored = ignoredUpdateCache(path);
    log.trace(ignored.template, ignored.fields);
  }
  if (found.kind !== 'read') {
    return stale;
  }
  const read = readUpdateCheck(path);
  log.debug(read.template, read.fields);
  return found.reading;
}

/**
 * Prints the notice when the cache names a newer version, then refreshes a stale cache, writing the
 * cached `latest` back when only its `checked` was at fault.
 */
async function notify(run: Qualified, { log, out }: { log: Log; out: Out }): Promise<void> {
  const now = Date.now();
  const reading = readNamed(run, log, now);
  const newer = newerVersion(reading, run.running);
  if (newer !== undefined) {
    await say(out.info(noticeLine(run, newer)));
  }
  if (!reading.fresh) {
    const { channel, repository } = run;
    const entry = { channel, checked: new Date(now), latest: reading.latest, repository };
    if (refresh(run, entry, log)) {
      log.debug(startedRefresh.template);
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
      const skipped = skippedUpdateCheck(run.skipped);
      log.trace(skipped.template, skipped.fields);
      return;
    }
    await notify(run, { log, out });
  };
}

export { noticeMiddleware };
