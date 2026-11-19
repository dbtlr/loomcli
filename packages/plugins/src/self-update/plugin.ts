import { join } from 'node:path';

import { applicationDirectory, Command, DeclarationError, InputError, plugin } from '@loomcli/core';
import type { FatalError, Host, Log, Out, Plugin } from '@loomcli/core';
import { createValidator } from '@loomcli/validators';

import { binaryReplaced, fileWritten } from '../change-events.js';
import { packageName } from '../constants.js';
import {
  digestOf,
  observe,
  recordLeftovers,
  removeStagingFiles,
  replaceFile,
} from '../installation/disk.js';
import { attestationSettingRule, selfUpdateSettings } from '../rules.js';
import { isVariableName } from '../variable-name.js';
import { attesterOf } from './attestation-setting.js';
import type { Attest, AttestationCheck, AttestationSetting } from './attestation-setting.js';
import { releaseBinary } from './binary.js';
import type { ReleaseBinary } from './binary.js';
import { fatal } from './fatal.js';
import {
  alreadyInstalled,
  assetNotListed,
  attestationCacheNotAbsolute,
  binaryChanged,
  binaryIsLink,
  binaryMissing,
  binaryUnwritable,
  canInstall,
  canUpdate,
  channelConflict,
  channelConflictIssue,
  channelIssue,
  digestConflict,
  digestMismatch,
  directoryUnwritable,
  downloading,
  newerThanNewest,
  newestRelease,
  noRelease,
  notReleaseBinary,
  otherInstaller,
  recordNotAbsolute,
  recordUnwritable,
  refreshNoticeConflict,
  refreshNoticeConflictIssue,
  requested,
  requestFailed,
  resolvedRelease,
  updated,
  verifiedAsset,
  versionIssue,
} from './messages.js';
import { unwritable } from './place.js';
import { refreshNotice } from './refresh.js';
import { fetchBytes, notFound, RequestError } from './request.js';
import type { Requesting } from './request.js';
import { downloadUrl, fetchSums, latestRelease } from './resolve.js';
import type { Release } from './resolve.js';
import { listingOf } from './sums.js';
import { compareVersions, equalPrecedence, isChannelName, versionOfArgument } from './version.js';
import type { Version } from './version.js';

const identity = `${packageName}/self-update`;

/** The mode of the installation record, as the installer script's `mktemp` leaves it. */
const recordMode = 0o600;

/**
 * What `afterReplace` reads once the binary is replaced and the record rewritten.
 *
 * @public
 * @sealed
 */
interface AfterReplaceContext {
  /** The version that was replaced. */
  readonly previous: string;
  /** The version now at `path`. */
  readonly current: string;
  /** The recorded path, as `install.json` holds it. */
  readonly path: string;
  /** The application's name, as the graph holds it. */
  readonly name: string;
  /** The run's host, whose release facts still describe the replaced binary. */
  readonly host: Host;
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
}

/**
 * How the author tunes update notices beside turning them on or off.
 *
 * @public
 */
interface NoticeSettings {
  /** A variable that turns notices off when it is set and not empty, beside NO_UPDATE_NOTIFIER. */
  readonly env?: string;
}

/**
 * What the application tells the self-update plugin.
 *
 * @public
 */
interface SelfUpdateSettings {
  /** Called once after the binary is replaced and the record rewritten. */
  readonly afterReplace?: (context: AfterReplaceContext) => Promise<void> | void;
  /** Verify a GitHub artifact attestation of the asset before it is downloaded. */
  readonly attestation?: AttestationSetting;
  /** Update notices: on unless false. */
  readonly notices?: boolean | NoticeSettings;
}

/** Judges `notices.env`, which names the variable that turns notices off, at the `selfUpdate()` call. */
function judgeNoticeVariable(settings: SelfUpdateSettings | undefined): void {
  const { notices } = settings ?? {};
  const env = typeof notices === 'object' ? notices.env : undefined;
  if (env !== undefined && !isVariableName(env)) {
    throw new DeclarationError(selfUpdateSettings, {
      correction: 'Name it with letters, digits, and underscores, not starting with a digit.',
      findings: [{ arguments: [settings], call: 'selfUpdate', mark: '0.notices.env' }],
      sentence: `Plugin "${identity}" setting "notices.env" is not an environment variable name.`,
    });
  }
}

/**
 * The verification a set `attestation` carries, judged at the `selfUpdate()` call: a value
 * `attestation()` did not make is refused, because reading it as unset would turn the check off.
 */
function judgeAttestation(settings: SelfUpdateSettings | undefined): Attest | undefined {
  const value: unknown = settings?.attestation;
  if (value === undefined) {
    return undefined;
  }
  const attest = attesterOf(value);
  if (attest === undefined) {
    throw new DeclarationError(attestationSettingRule, {
      correction:
        'Pass the value attestation() from @loomcli/plugins/self-update/attestation returns, or leave attestation out.',
      findings: [{ arguments: [settings], call: 'selfUpdate', mark: '0.attestation' }],
      sentence: `Plugin "${identity}" setting "attestation" is not a value attestation() made.`,
    });
  }
  return attest;
}

/** A string input that `accepts` or the one-sentence `message`, published as a plain string. */
function stringInput(accepts: (text: string) => boolean, message: string) {
  return createValidator({
    inputSchema: { type: 'string' },
    parse: (raw) => (accepts(raw) ? { value: raw } : { issues: [{ message }] }),
  });
}

const versionInput = stringInput((text) => versionOfArgument(text) !== undefined, versionIssue);

const channelInput = stringInput(isChannelName, channelIssue);

/** What a run checked before any request: the binary to replace and where its record lives. */
interface Checked extends ReleaseBinary {
  readonly path: string;
  readonly mode: number;
  readonly record: string;
}

/** The installation record's directory, or the refusal when the environment cannot name one. */
function recordDirectory(name: string, host: Host): string {
  const directory = applicationDirectory('installation', name, host);
  if ('variable' in directory) {
    throw fatal(recordNotAbsolute(name, directory.variable));
  }
  return directory.path;
}

/**
 * The cache directory, which holds Sigstore's trust root, or the refusal when the environment
 * cannot name one.
 */
function attestationCache(name: string, host: Host): string {
  const directory = applicationDirectory('cache', name, host);
  if ('variable' in directory) {
    throw fatal(attestationCacheNotAbsolute(name, directory.variable));
  }
  return directory.path;
}

/**
 * The verification a run makes before it downloads, with the cache directory it keeps its trust
 * root in, when the author set an attestation and the run would replace the binary. A `--check`
 * run resolves no cache directory.
 */
function attestingFor(
  request: Request,
  attest: Attest | undefined,
): ((facts: Omit<AttestationCheck, 'cache'>) => Promise<void>) | undefined {
  if (attest === undefined || request.checkOnly) {
    return undefined;
  }
  const cache = attestationCache(request.name, request.host);
  return (facts) => attest({ ...facts, cache });
}

/** What the installation record holds for a binary the installer script placed. */
type Installation = NonNullable<Host['release']['installation']>;

/** The installation, or the refusal when something other than the installer script placed it. */
function scriptInstallation(name: string, installation: Installation | undefined): Installation {
  if (installation?.method !== 'script') {
    throw fatal(otherInstaller(name));
  }
  return installation;
}

/** The recorded binary's mode, or the refusal when it is missing, a link, or changed. */
function intactMode(name: string, installation: Installation): number {
  const found = observe(installation.path);
  if (found.kind === 'link') {
    throw fatal(binaryIsLink(name, installation.path));
  }
  if (found.kind !== 'file') {
    throw fatal(binaryMissing(name, installation.path));
  }
  if (found.digest !== installation.digest) {
    throw fatal(binaryChanged(name, installation.path));
  }
  return found.mode;
}

/** The refusal when the process cannot write to the binary's directory or the record's. */
function requireWritable(name: string, path: string, record: string): void {
  const blocked = unwritable([join(path, '..'), record]);
  if (blocked !== undefined) {
    throw fatal(directoryUnwritable(name, blocked.directory), blocked.cause);
  }
}

/**
 * The refusals, in the contract's order, before any request: a run that is not a release binary,
 * a record directory that cannot be resolved, an installation another installer owns, a recorded
 * path that holds no regular file, a binary changed since it was recorded, and a directory the
 * process cannot write to.
 */
function check(name: string, host: Host): Checked {
  const binary = releaseBinary(host);
  if (binary === undefined) {
    throw fatal(notReleaseBinary(name));
  }
  const record = recordDirectory(name, host);
  const installation = scriptInstallation(name, host.release.installation);
  const mode = intactMode(name, installation);
  requireWritable(name, installation.path, record);
  return { ...binary, mode, path: installation.path, record };
}

/** What finding the release to install needs. */
interface Lookup {
  readonly name: string;
  readonly checked: Checked;
  readonly named: Version | undefined;
  readonly channel: string;
  readonly requesting: Requesting;
}

/** The release a run installs: the named version, or the newest on the channel. */
async function target({ name, checked, named, channel, requesting }: Lookup): Promise<Release> {
  if (named !== undefined) {
    const { repository, sums } = await fetchSums(checked.repository, named, requesting);
    return { repository, sums, version: named };
  }
  const found = await latestRelease(checked.repository, channel, requesting);
  if (found === undefined) {
    throw fatal(noRelease(name, channel, checked.repository));
  }
  return found;
}

/** The release's `SHA256SUMS`, downloaded now unless finding the release already did. */
async function sumsOf(
  release: Release,
  requesting: Requesting,
): Promise<Release & { sums: string }> {
  if (release.sums !== undefined) {
    return { ...release, sums: release.sums };
  }
  const fetched = await fetchSums(release.repository, release.version, requesting);
  return { ...fetched, version: release.version };
}

/** The asset's digest from the release's `SHA256SUMS`, or the failure its listing is. */
function listedDigest(asset: string, release: Release & { sums: string }): string {
  const listing = listingOf(release.sums, asset);
  const tag = `v${release.version.text}`;
  if ('missing' in listing) {
    throw fatal(assetNotListed(asset, tag, release.repository));
  }
  if ('conflict' in listing) {
    throw fatal(digestConflict(asset, tag, release.repository));
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
    ? newestRelease(name, running.text, channel)
    : newerThanNewest({ channel, found: found.text, name, running: running.text });
}

/**
 * What downloading the asset needs: the run's binary, the release, the digest it lists, the
 * requests' signal and naming, and the run's `log`.
 */
interface Download {
  readonly checked: Checked;
  readonly release: Release;
  readonly digest: string;
  readonly requesting: Requesting;
  readonly log: Log;
}

/**
 * Downloads the asset and returns its bytes once their digest matches the listed one, logging the
 * match at `debug`.
 */
async function download({
  checked,
  release,
  digest,
  requesting,
  log,
}: Download): Promise<Uint8Array> {
  const bytes = await fetchBytes(
    downloadUrl(release.repository, release.version, checked.asset),
    requesting,
  );
  if (digestOf(bytes) !== `sha256:${digest}`) {
    throw fatal(digestMismatch(checked.asset, `v${release.version.text}`, release.repository));
  }
  const verified = verifiedAsset(checked.asset);
  log.debug(verified.template, verified.fields);
  return bytes;
}

/** The `install.json` line for the binary now at `path`, in the installation record's format. */
function recordLine(path: string, digest: string): string {
  // The members keep the record's order, which an object literal would not survive formatting in.
  return `{"format":1,"method":"script","path":${JSON.stringify(path)},"digest":"${digest}"}\n`;
}

/**
 * What placing the verified bytes needs: the run's binary, the version, the bytes, and the run's
 * signal and log.
 */
interface Placement {
  readonly name: string;
  readonly checked: Checked;
  readonly version: Version;
  readonly bytes: Uint8Array;
  readonly signal: AbortSignal;
  readonly log: Log;
}

/**
 * Places the verified bytes over the binary, removing leftover staging files first, and records
 * the replacement.
 */
function placeBinary({ name, checked, bytes, signal, log, version }: Placement): void {
  try {
    recordLeftovers(log, removeStagingFiles(checked.path));
    replaceFile(checked.path, bytes, { durable: true, mode: checked.mode, signal });
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw fatal(binaryUnwritable(name, join(checked.path, '..')), error);
  }
  binaryReplaced(log, { from: checked.running.text, path: checked.path, to: version.text });
}

/** Rewrites the installation record for the binary now at the recorded path, and records it. */
function writeRecord({ name, checked, version, bytes, log }: Placement): void {
  const line = recordLine(checked.path, digestOf(bytes));
  const record = join(checked.record, 'install.json');
  try {
    recordLeftovers(log, removeStagingFiles(record));
    replaceFile(record, line, { durable: true, mode: recordMode });
  } catch (error) {
    throw fatal(recordUnwritable(name, version.text), error);
  }
  fileWritten(log, { path: record });
}

/**
 * Places the verified bytes over the binary, then rewrites the record. An abort read before the
 * rename propagates as it is. From the rename to the record no signal is read: the span is
 * synchronous, so no abort can arrive inside it, and it must stay so. The binary change event
 * comes before the record's rewrite, and a record that cannot be written is the failure the run reports.
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
  readonly out: Out;
  /** The run signal, and the `trace` log line each request is named by. */
  readonly requesting: Requesting;
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
  return alreadyInstalled(request.name, checked.running.text);
}

/**
 * Reports that the named version is the running one, when it is and the run would replace, and
 * says whether it did. A `--check` run resolves and verifies the release first.
 */
async function reportInstalled(request: Request, checked: Checked): Promise<boolean> {
  if (request.checkOnly || !namesRunning(request, checked)) {
    return false;
  }
  await request.out.success(installedLine(request, checked));
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
  await request.out.success(
    notNewerLine({ channel, found, name: request.name, running: checked.running }),
  );
  return true;
}

/** The release a run resolved and the digest its `SHA256SUMS` lists for the asset. */
interface Resolved {
  readonly release: Release & { sums: string };
  readonly digest: string;
}

/**
 * The refusals and reports that end a run before any download, or the release it goes on with. A
 * run without a version that goes on to replace names the release it resolved at `-v`.
 */
async function resolve(request: Request, checked: Checked): Promise<Resolved | undefined> {
  const { name, named, requesting } = request;
  if (await reportInstalled(request, checked)) {
    return undefined;
  }
  const channel = channelFor(request, checked);
  const found = await target({ channel, checked, name, named, requesting });
  if (await reportNotNewer(request, checked, found.version)) {
    return undefined;
  }
  sayResolved(request, found.version, channel);
  const release = await sumsOf(found, requesting);
  return { digest: listedDigest(checked.asset, release), release };
}

/**
 * Logs at `debug` the release a run without a version resolved, once it goes on to replace. A
 * named version is the operator's own and a `--check` line names the release, so neither logs it.
 */
function sayResolved(request: Request, found: Version, channel: string): void {
  if (request.named === undefined && !request.checkOnly) {
    const resolved = resolvedRelease(found.text, channel);
    request.log.debug(resolved.template, resolved.fields);
  }
}

/** The run signal, and the `trace` log line that names each request before it is sent. */
function requestingOf(log: Log, signal: AbortSignal): Requesting {
  return {
    requested: (url) => {
      const line = requested(url);
      log.trace(line.template, line.fields);
    },
    signal,
  };
}

/** The line a `--check` run prints for the release it resolved. */
function checkLine(request: Request, checked: Checked, found: Version): string {
  const { name, named } = request;
  if (namesRunning(request, checked)) {
    return installedLine(request, checked);
  }
  if (named !== undefined) {
    return canInstall(name, named.text, checked.running.text);
  }
  const channel = channelFor(request, checked);
  if (isNotNewer(found, checked.running)) {
    return notNewerLine({ channel, found, name, running: checked.running });
  }
  return canUpdate({ channel, found: found.text, name, running: checked.running.text });
}

/** What verifying an attestation of the resolved release reads, except the cache directory. */
function attestationCheck(
  request: Request,
  checked: Checked,
  resolved: Resolved,
): Omit<AttestationCheck, 'cache'> {
  const { host, log, name, requesting } = request;
  const { digest, release } = resolved;
  return {
    asset: checked.asset,
    digest,
    host,
    log,
    name,
    repository: release.repository,
    requesting,
    running: checked.running.text,
    version: release.version.text,
  };
}

/** Downloads the resolved release, places it, and reports the update. */
async function install(request: Request, checked: Checked, resolved: Resolved): Promise<void> {
  const { log, name, out, requesting, signal } = request;
  const { digest, release } = resolved;
  await out.info(downloading(checked.asset, release.version.text, release.repository));
  const bytes = await download({ checked, digest, log, release, requesting });
  place({ bytes, checked, log, name, signal, version: release.version });
  await out.success(updated(name, checked.running.text, release.version.text));
}

/** The refusals, then the cache directory an attestation needs, both before any request. */
function prepare(request: Request, attest: Attest | undefined) {
  const checked = check(request.name, request.host);
  return { attesting: attestingFor(request, attest), checked };
}

/**
 * The Command's run, in the contract's order: refusals, the cache directory an attestation needs,
 * resolving, `--check`, verifying the attestation for the digest `SHA256SUMS` lists, and
 * replacing. A `--check` run resolves no cache directory and makes no attestation request.
 */
async function update(
  request: Request,
  settings: SelfUpdateSettings | undefined,
  attest: Attest | undefined,
): Promise<void> {
  const { attesting, checked } = prepare(request, attest);
  const resolved = await resolve(request, checked);
  if (resolved === undefined) {
    return;
  }
  if (request.checkOnly) {
    await request.out.success(checkLine(request, checked, resolved.release.version));
    return;
  }
  await attesting?.(attestationCheck(request, checked, resolved));
  await install(request, checked, resolved);
  await settings?.afterReplace?.({
    current: resolved.release.version.text,
    host: request.host,
    log: request.log,
    name: request.name,
    path: checked.path,
    previous: checked.running.text,
    signal: request.signal,
  });
}

/** The inputs that may not be given together. */
interface Given {
  readonly version: string | undefined;
  readonly channel: string | undefined;
  readonly checkOnly: boolean;
  readonly refreshing: boolean;
}

/**
 * The failure of a request, with the runtime's error kept as its cause for a download that got no
 * response or a status it does not accept. A 404 for a version the operator named asks them to
 * check that release.
 */
function requestFailure(name: string, error: RequestError, named: string | undefined): FatalError {
  const { kind, status, url } = error;
  const sentence = requestFailed(
    name,
    { kind, status, url },
    status === notFound ? named : undefined,
  );
  return kind === 'insecure' || kind === 'too-many'
    ? fatal(sentence)
    : fatal(sentence, error.cause);
}

/** The usage error for an option given beside an input it cannot be given with. */
function conflict(option: string, sentence: string, issue: string): InputError {
  return new InputError(sentence, [
    {
      input: { global: false, kind: 'option', name: option },
      issues: [{ message: issue }],
      reason: 'invalid',
      spelling: `--${option}`,
    },
  ]);
}

/**
 * Throws the usage error for inputs given together that cannot be: `--refresh-notice` beside any
 * other input, then `--channel` beside a version.
 */
function refuseConflicts({ channel, checkOnly, refreshing, version }: Given): void {
  if (refreshing && (version !== undefined || channel !== undefined || checkOnly)) {
    throw conflict('refresh-notice', refreshNoticeConflict, refreshNoticeConflictIssue);
  }
  if (channel !== undefined && version !== undefined) {
    throw conflict('channel', channelConflict, channelConflictIssue);
  }
}

/**
 * The `self-update` Command, its action calling `afterReplace` from the settings and verifying an
 * attestation with `attest` when the author set one.
 */
function selfUpdateCommand(settings: SelfUpdateSettings | undefined, attest: Attest | undefined) {
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
    .option('refresh-notice', {
      description: "Refresh the update notices' cache.",
      hidden: true,
      type: 'boolean',
    })
    .action(async ({ args, graph, host, log, options, out, signal }) => {
      const refreshing = options['refresh-notice'];
      refuseConflicts({
        channel: options.channel,
        checkOnly: options.check,
        refreshing,
        version: args.version,
      });
      try {
        if (refreshing) {
          await refreshNotice({
            host,
            log,
            name: graph.name,
            requesting: requestingOf(log, signal),
          });
          return;
        }
        await update(
          {
            channel: options.channel,
            checkOnly: options.check,
            host,
            log,
            name: graph.name,
            named: args.version === undefined ? undefined : versionOfArgument(args.version),
            out,
            requesting: requestingOf(log, signal),
            signal,
          },
          settings,
          attest,
        );
      } catch (error) {
        if (error instanceof RequestError && !signal.aborted) {
          throw requestFailure(
            graph.name,
            error,
            args.version === undefined ? undefined : versionOfArgument(args.version)?.text,
          );
        }
        throw error;
      }
    });
}

/** The author's variable that turns notices off, when `notices` names one. */
function noticeOptOut(notices: boolean | NoticeSettings): string | undefined {
  return typeof notices === 'object' ? notices.env : undefined;
}

/**
 * A plugin that replaces the running binary with a verified release from the application's GitHub
 * repository, only when the installer script placed it and nothing has changed it since. It
 * contributes the `self-update` Command and, unless `notices` is `false`, the update notices'
 * middleware, whose module loads only when a run reaches it. The annotated return type is the
 * boundary that breaks the cycle between this module and the middleware module `load` names.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { selfUpdate } from '@loomcli/plugins/self-update';
 *
 * export const app = new Application('notes', { plugins: [selfUpdate({ notices: { env: 'NOTES_NO_UPDATE_NOTICE' } })] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/self-update.md
 *
 * @public
 */
function selfUpdate(settings?: SelfUpdateSettings): Plugin {
  judgeNoticeVariable(settings);
  const attest = judgeAttestation(settings);
  const notices = settings?.notices ?? true;
  const commands = [selfUpdateCommand(settings, attest)];
  if (notices === false) {
    return plugin(identity, { commands });
  }
  const optOut = noticeOptOut(notices);
  return plugin(identity, {
    commands,
    middleware: {
      activate: 'always',
      load: async () => {
        const { noticeMiddleware } = await import('./notices.js');
        return { default: noticeMiddleware(optOut) };
      },
    },
  });
}

export type { AttestationSetting } from './attestation-setting.js';
export type { AfterReplaceContext, NoticeSettings, SelfUpdateSettings };
export { selfUpdate };
