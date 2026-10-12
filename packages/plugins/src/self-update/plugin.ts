import { join } from 'node:path';

import {
  applicationDirectory,
  checkPluginSettings,
  Command,
  DeclarationError,
  InputError,
  plugin,
} from '@loomcli/core';
import type { Host, Log, Plugin } from '@loomcli/core';
import { z } from 'zod';

import { packageName } from '../constants.js';
import { digestOf, observe, removeStagingFiles, replaceFile } from '../installation/disk.js';
import { selfUpdateSettings } from '../rules.js';
import { failures, refusals, requestFailed, shown } from './messages.js';
import { unwritable } from './place.js';
import { fetchBytes, RequestError } from './request.js';
import { downloadUrl, fetchSums, latestRelease } from './resolve.js';
import type { Release } from './resolve.js';
import { listingOf } from './sums.js';
import {
  compareVersions,
  equalPrecedence,
  isChannelName,
  parseVersion,
  versionOfArgument,
} from './version.js';
import type { Version } from './version.js';

const identity = `${packageName}/self-update`;

/** The mode of the installation record, as the installer script's `mktemp` leaves it. */
const recordMode = 0o600;

/** What `afterReplace` reads once the binary is replaced and the record rewritten. */
interface AfterReplaceContext {
  /** The version that was replaced. */
  readonly previous: string;
  /** The version now at `path`. */
  readonly current: string;
  /** The recorded path, as `install.json` holds it. */
  readonly path: string;
  /** The run's host, whose release facts still describe the replaced binary. */
  readonly host: Host;
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
}

/** What the application tells the self-update plugin. */
interface SelfUpdateSettings {
  /** Called once after the binary is replaced and the record rewritten. */
  readonly afterReplace?: (context: AfterReplaceContext) => Promise<void> | void;
}

/** Judges the one key, after core's rules for any plugin's settings, at the `selfUpdate()` call. */
function judgeSettings(settings: SelfUpdateSettings | undefined): void {
  checkPluginSettings(settings, { call: 'selfUpdate', plugin: identity });
  const afterReplace: unknown = settings?.afterReplace;
  if (afterReplace !== undefined && typeof afterReplace !== 'function') {
    throw new DeclarationError(selfUpdateSettings, {
      correction: 'Supply a function, or omit the setting.',
      findings: [{ arguments: [settings], call: 'selfUpdate', mark: '0.afterReplace' }],
      sentence: `Plugin "${identity}" setting "afterReplace" is not a function.`,
    });
  }
}

const versionInput = z.string().refine((text) => versionOfArgument(text) !== undefined, {
  error: 'Supply a semantic version, such as 1.4.0.',
});

const channelInput = z.string().refine(isChannelName, {
  error: 'Supply stable or a prerelease identifier, such as next.',
});

/** What a run checked before any request: the binary to replace and where its record lives. */
interface Checked {
  readonly asset: string;
  readonly repository: string;
  readonly running: Version;
  readonly channel: string;
  readonly path: string;
  readonly mode: number;
  readonly record: string;
}

/** The installation record's directory, or the refusal when the environment cannot name one. */
function recordDirectory(name: string, host: Host): string {
  const directory = applicationDirectory('installation', name, host);
  if ('variable' in directory) {
    throw refusals.record(name, directory.variable);
  }
  return directory.path;
}

/** What the installation record holds for a binary the installer script placed. */
type Installation = NonNullable<Host['release']['installation']>;

/** The installation, or the refusal when something other than the installer script placed it. */
function scriptInstallation(name: string, installation: Installation | undefined): Installation {
  if (installation?.method !== 'script') {
    throw refusals.otherInstaller(name);
  }
  return installation;
}

/** The recorded binary's mode, or the refusal when it is missing, a link, or changed. */
function intactMode(name: string, installation: Installation): number {
  const found = observe(installation.path);
  if (found.kind === 'link') {
    throw refusals.link(name, installation.path);
  }
  if (found.kind !== 'file') {
    throw refusals.missing(name, installation.path);
  }
  if (found.digest !== installation.digest) {
    throw refusals.changed(name, installation.path);
  }
  return found.mode;
}

/** The refusal when the process cannot write to the binary's directory or the record's. */
function requireWritable(name: string, path: string, record: string): void {
  const blocked = unwritable([join(path, '..'), record]);
  if (blocked !== undefined) {
    throw refusals.unwritable(name, blocked.directory, blocked.cause);
  }
}

/**
 * The refusals, in the contract's order, before any request: a run that is not a release binary,
 * a record directory that cannot be resolved, an installation another installer owns, a recorded
 * path that holds no regular file, a binary changed since it was recorded, and a directory the
 * process cannot write to.
 */
function check(name: string, host: Host): Checked {
  const { release } = host.release;
  const running = release === undefined ? undefined : parseVersion(release.version);
  if (release?.asset === undefined || running === undefined) {
    throw refusals.notBuilt(name);
  }
  const record = recordDirectory(name, host);
  const installation = scriptInstallation(name, host.release.installation);
  const mode = intactMode(name, installation);
  requireWritable(name, installation.path, record);
  return {
    asset: release.asset,
    channel: release.channel,
    mode,
    path: installation.path,
    record,
    repository: release.repository,
    running,
  };
}

/** What finding the release to install needs. */
interface Lookup {
  readonly name: string;
  readonly checked: Checked;
  readonly named: Version | undefined;
  readonly channel: string;
  readonly signal: AbortSignal;
}

/** The release a run installs: the named version, or the newest on the channel. */
async function target({ name, checked, named, channel, signal }: Lookup): Promise<Release> {
  if (named !== undefined) {
    const { repository, sums } = await fetchSums(checked.repository, named, signal);
    return { repository, sums, version: named };
  }
  const found = await latestRelease(checked.repository, channel, signal);
  if (found === undefined) {
    throw failures.noRelease(name, channel, checked.repository);
  }
  return found;
}

/** The release's `SHA256SUMS`, downloaded now unless finding the release already did. */
async function sumsOf(release: Release, signal: AbortSignal): Promise<Release & { sums: string }> {
  if (release.sums !== undefined) {
    return { ...release, sums: release.sums };
  }
  const fetched = await fetchSums(release.repository, release.version, signal);
  return { ...fetched, version: release.version };
}

/** The asset's digest from the release's `SHA256SUMS`, or the failure its listing is. */
function listedDigest(asset: string, release: Release & { sums: string }): string {
  const listing = listingOf(release.sums, asset);
  const tag = `v${release.version.text}`;
  if ('missing' in listing) {
    throw failures.notListed(asset, tag, release.repository);
  }
  if ('conflict' in listing) {
    throw failures.conflict(asset, tag, release.repository);
  }
  return listing.digest;
}

/** Whether `found` has the precedence of `running` or lower. */
function isNotNewer(found: Version, running: Version): boolean {
  return compareVersions(found, running) <= equalPrecedence;
}

/** The versions and channel a line about a release that is not newer names. */
interface NotNewer {
  readonly name: string;
  readonly running: Version;
  readonly found: Version;
  readonly channel: string;
}

/** The line a resolved release that is not newer prints, which replaces nothing. */
function notNewerLine({ name, running, found, channel }: NotNewer): string {
  return compareVersions(found, running) === equalPrecedence
    ? `${name} ${shown(running.text)} is the newest release on the ${shown(channel)} channel.`
    : `${name} ${shown(running.text)} is newer than the newest release on the ${shown(channel)} channel, ${shown(found.text)}. Name that version to install it: ${name} self-update ${shown(found.text)}.`;
}

/** What downloading the asset needs: the run's binary, the release, and the digest it lists. */
interface Download {
  readonly checked: Checked;
  readonly release: Release;
  readonly digest: string;
  readonly signal: AbortSignal;
}

/** Downloads the asset and returns its bytes once their digest matches the listed one. */
async function download({ checked, release, digest, signal }: Download): Promise<Uint8Array> {
  const bytes = await fetchBytes(
    downloadUrl(release.repository, release.version, checked.asset),
    signal,
  );
  if (digestOf(bytes) !== `sha256:${digest}`) {
    throw failures.mismatch(checked.asset, `v${release.version.text}`, release.repository);
  }
  return bytes;
}

/** The `install.json` line for the binary now at `path`, in the installation record's format. */
function recordLine(path: string, digest: string): string {
  // The members keep the record's order, which an object literal would not survive formatting in.
  return `{"format":1,"method":"script","path":${JSON.stringify(path)},"digest":"${digest}"}\n`;
}

/** What placing the verified bytes needs: the run's binary, the version, and the bytes. */
interface Placement {
  readonly name: string;
  readonly checked: Checked;
  readonly version: Version;
  readonly bytes: Uint8Array;
  readonly signal: AbortSignal;
}

/** Places the verified bytes over the binary, removing leftover staging files first. */
function placeBinary({ name, checked, bytes, signal }: Placement): void {
  try {
    removeStagingFiles(checked.path);
    replaceFile(checked.path, bytes, { durable: true, mode: checked.mode, signal });
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw failures.write(name, join(checked.path, '..'), error);
  }
}

/** Rewrites the installation record for the binary now at the recorded path. */
function writeRecord({ name, checked, version, bytes }: Placement): void {
  const line = recordLine(checked.path, digestOf(bytes));
  const record = join(checked.record, 'install.json');
  try {
    removeStagingFiles(record);
    replaceFile(record, line, { mode: recordMode });
  } catch (error) {
    throw failures.record(name, version.text, error);
  }
}

/**
 * Places the verified bytes over the binary, then rewrites the record. An abort read before the
 * rename propagates as it is. From the rename to the record no signal is read: the span is
 * synchronous, so no abort can arrive inside it, and it must stay so.
 */
function place(placement: Placement): void {
  placeBinary(placement);
  writeRecord(placement);
}

/** The Command's action, once its inputs are read. */
interface Request {
  readonly name: string;
  readonly host: Host;
  readonly signal: AbortSignal;
  readonly log: Log;
  readonly named: Version | undefined;
  readonly channel: string | undefined;
  readonly checkOnly: boolean;
  readonly info: (message: string) => Promise<void>;
  readonly success: (message: string) => Promise<void>;
}

/** The channel a run follows: the one the operator named, or the running binary's own. */
function channelFor(request: Request, checked: Checked): string {
  return request.channel ?? checked.channel;
}

/** Whether the operator named the version that is running. */
function namesRunning(request: Request, checked: Checked): boolean {
  return (
    request.named !== undefined &&
    compareVersions(request.named, checked.running) === equalPrecedence
  );
}

/** The line a run that named the running version prints, which replaces nothing. */
function installedLine(request: Request, checked: Checked): string {
  return `${request.name} ${shown(checked.running.text)} is already installed.`;
}

/**
 * Reports that the named version is the running one, when it is and the run would replace, and
 * says whether it did. A `--check` run resolves and verifies the release first.
 */
async function reportInstalled(request: Request, checked: Checked): Promise<boolean> {
  if (request.checkOnly || !namesRunning(request, checked)) {
    return false;
  }
  await request.success(installedLine(request, checked));
  return true;
}

/** Reports that the newest release is not newer, when it is not and the run would replace. */
async function reportNotNewer(
  request: Request,
  checked: Checked,
  found: Version,
): Promise<boolean> {
  if (request.named !== undefined || request.checkOnly || !isNotNewer(found, checked.running)) {
    return false;
  }
  const channel = channelFor(request, checked);
  await request.success(
    notNewerLine({ channel, found, name: request.name, running: checked.running }),
  );
  return true;
}

/** The release a run resolved and the digest its `SHA256SUMS` lists for the asset. */
interface Resolved {
  readonly release: Release & { sums: string };
  readonly digest: string;
}

/** The refusals and reports that end a run before any download, or the release it goes on with. */
async function resolve(request: Request, checked: Checked): Promise<Resolved | undefined> {
  const { name, named, signal } = request;
  if (await reportInstalled(request, checked)) {
    return undefined;
  }
  const channel = channelFor(request, checked);
  const found = await target({ channel, checked, name, named, signal });
  if (await reportNotNewer(request, checked, found.version)) {
    return undefined;
  }
  const release = await sumsOf(found, signal);
  return { digest: listedDigest(checked.asset, release), release };
}

/** The line a `--check` run prints for the release it resolved. */
function checkLine(request: Request, checked: Checked, found: Version): string {
  const { name, named } = request;
  if (namesRunning(request, checked)) {
    return installedLine(request, checked);
  }
  if (named !== undefined) {
    return `${name} can install ${shown(named.text)} in place of ${shown(checked.running.text)}.`;
  }
  const channel = channelFor(request, checked);
  if (isNotNewer(found, checked.running)) {
    return notNewerLine({ channel, found, name, running: checked.running });
  }
  return `${name} can update from ${shown(checked.running.text)} to ${shown(found.text)} on the ${shown(channel)} channel.`;
}

/** Downloads the resolved release, places it, and reports the update. */
async function install(request: Request, checked: Checked, resolved: Resolved): Promise<void> {
  const { name, signal } = request;
  const { digest, release } = resolved;
  await request.info(
    `Downloading ${shown(checked.asset)} from v${shown(release.version.text)} of ${shown(release.repository)}.`,
  );
  const bytes = await download({ checked, digest, release, signal });
  place({ bytes, checked, name, signal, version: release.version });
  await request.success(
    `Updated ${name} from ${shown(checked.running.text)} to ${shown(release.version.text)}.`,
  );
}

/** The Command's run, in the contract's order: refusals, resolving, `--check`, replacing. */
async function update(request: Request, settings: SelfUpdateSettings | undefined): Promise<void> {
  const checked = check(request.name, request.host);
  const resolved = await resolve(request, checked);
  if (resolved === undefined) {
    return;
  }
  if (request.checkOnly) {
    await request.success(checkLine(request, checked, resolved.release.version));
    return;
  }
  await install(request, checked, resolved);
  await settings?.afterReplace?.({
    current: resolved.release.version.text,
    host: request.host,
    log: request.log,
    path: checked.path,
    previous: checked.running.text,
    signal: request.signal,
  });
}

/** The `self-update` Command, its action calling `afterReplace` from the settings. */
function selfUpdateCommand(settings: SelfUpdateSettings | undefined) {
  return new Command('self-update', {
    description: 'Replace this application with another release.',
  })
    .argument('version', {
      description: 'A release version to install, newer or older, such as 1.4.0.',
      validate: versionInput,
    })
    .option('channel', {
      description: 'The release channel to follow, such as stable or next.',
      type: 'string',
      validate: channelInput,
    })
    .option('check', {
      description: 'Report what an update would do and replace nothing.',
      type: 'boolean',
    })
    .action(async ({ args, graph, host, log, options, out, signal }) => {
      if (options.channel !== undefined && args.version !== undefined) {
        const message =
          'Option "--channel" cannot be given with a version. Leave out --channel, or the version.';
        throw new InputError(message, [
          {
            input: { global: false, kind: 'option', name: 'channel' },
            issues: [{ message: 'Leave out --channel, or the version.' }],
            reason: 'invalid',
            spelling: '--channel',
          },
        ]);
      }
      try {
        await update(
          {
            channel: options.channel,
            checkOnly: options.check,
            host,
            info: (message) => out.info(message),
            log,
            name: graph.name,
            named: args.version === undefined ? undefined : versionOfArgument(args.version),
            signal,
            success: (message) => out.success(message),
          },
          settings,
        );
      } catch (error) {
        if (error instanceof RequestError && !signal.aborted) {
          throw requestFailed(
            graph.name,
            error,
            args.version === undefined ? undefined : versionOfArgument(args.version)?.text,
          );
        }
        throw error;
      }
    });
}

/**
 * A plugin that replaces the running binary with a verified release from the application's GitHub
 * repository, only when the installer script placed it and nothing has changed it since. Its whole
 * contribution is the `self-update` Command.
 */
function selfUpdate(settings?: SelfUpdateSettings): Plugin {
  judgeSettings(settings);
  return plugin(identity, { commands: [selfUpdateCommand(settings)] });
}

export type { AfterReplaceContext, SelfUpdateSettings };
export { selfUpdate };
