/*
 * The operator sentences of the self-update plugin, under ADR-0164. It imports only core's escaping
 * and text helpers, so the update notice's hook loads no request code. `tests/message-voice.test.ts`
 * holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownPlace = (place: string): string => nowrap(shown(place));

function cacheNotAbsolute(name: string, variable: string): string {
  return `${shown(name)} cannot find its cache directory because ${shown(variable)} is not an absolute path. Set ${shown(variable)} to an absolute path.`;
}

function binaryChanged(name: string, path: string): string {
  return `${shown(name)} at ${shownPlace(path)} changed since it was installed, so self-update will not replace it. Install it again with install.sh.`;
}

function binaryIsLink(name: string, path: string): string {
  return `${shown(name)} at ${shownPlace(path)} is a symbolic link, so self-update will not replace what it points to. Install it again with install.sh.`;
}

function binaryMissing(name: string, path: string): string {
  return `${shown(name)} cannot find its binary at ${shownPlace(path)}. Install it again with install.sh.`;
}

function notReleaseBinary(name: string): string {
  return `${shown(name)} was not built as a release binary, so it cannot update itself. Update it the way you installed it.`;
}

function otherInstaller(name: string): string {
  return `${shown(name)} was installed some other way, so self-update cannot replace it. Update it the way you installed it.`;
}

function recordNotAbsolute(name: string, variable: string): string {
  return `${shown(name)} cannot find its installation record because ${shown(variable)} is not an absolute path. Set ${shown(variable)} to an absolute path, then run self-update again.`;
}

function directoryUnwritable(name: string, directory: string): string {
  return `${shown(name)} cannot write to ${shownPlace(directory)}. Run self-update as the user who installed ${shown(name)}.`;
}

interface FailedRequest {
  /** Why the request failed: a redirect off HTTPS, too many redirects, a status, or no response. */
  readonly kind: 'insecure' | 'too-many' | 'status' | 'no-response';
  /** The address requested, as the sentence shows it. */
  readonly url: string;
  /** The response's status, for a request that received one. */
  readonly status: number | undefined;
}

function statusCode(status: number): string {
  return String(status);
}

function answered(status: number | undefined): string {
  return status === undefined ? 'no response' : statusCode(status);
}

function downloadCorrection(missingRelease: string | undefined): string {
  return missingRelease === undefined
    ? 'Run self-update again later.'
    : `Check that release v${shown(missingRelease)} exists, then run self-update again.`;
}

function requestFailed(
  name: string,
  { kind, status, url }: FailedRequest,
  missingRelease: string | undefined,
): string {
  if (kind === 'insecure') {
    return `${shown(name)} was redirected away from HTTPS while downloading ${shownPlace(url)}. Run self-update again later.`;
  }
  if (kind === 'too-many') {
    return `${shown(name)} was redirected too many times while downloading ${shownPlace(url)}. Run self-update again later.`;
  }
  return `${shown(name)} could not download ${shownPlace(url)} (${answered(status)}). ${downloadCorrection(missingRelease)}`;
}

function cacheUnwritable(name: string, directory: string): string {
  return `${shown(name)} could not write its update cache to ${shownPlace(directory)}. Free space there or check its permissions, then run self-update --refresh-notice again.`;
}

function digestConflict(asset: string, tag: string, repository: string): string {
  return `Release ${shown(tag)} of ${shown(repository)} lists ${shown(asset)} twice in its SHA256SUMS with different digests. Run self-update again once the release is fixed.`;
}

function digestMismatch(asset: string, tag: string, repository: string): string {
  return `${shown(asset)} from ${shown(tag)} of ${shown(repository)} does not match its SHA256SUMS digest. Run self-update again later.`;
}

function noRelease(name: string, channel: string, repository: string): string {
  return `${shown(name)} found no release on the ${shown(channel)} channel of ${shown(repository)}. Name a version to install, such as ${shown(name)} self-update 1.4.0.`;
}

function assetNotListed(asset: string, tag: string, repository: string): string {
  return `Release ${shown(tag)} of ${shown(repository)} has no ${shown(asset)} in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.`;
}

function recordUnwritable(name: string, version: string): string {
  return `${shown(name)} was updated to ${shown(version)}, but its installation record could not be written. Install it again with install.sh.`;
}

function binaryUnwritable(name: string, directory: string): string {
  return `${shown(name)} could not write the new binary to ${shownPlace(directory)}. Free space there or check its permissions, then run self-update again.`;
}

const versionIssue = 'Supply a semantic version, such as 1.4.0.';

const channelIssue = 'Supply stable or a prerelease identifier, such as next.';

const refreshNoticeConflict =
  'Option "--refresh-notice" cannot be given with other inputs. Leave out the other inputs.';

const refreshNoticeConflictIssue = 'Leave out the other inputs.';

const channelConflict =
  'Option "--channel" cannot be given with a version. Leave out --channel, or the version.';

const channelConflictIssue = 'Leave out --channel, or the version.';

interface FoundRelease {
  /** The application's name. */
  readonly name: string;
  /** The version that is running. */
  readonly running: string;
  /** The release channel the check read. */
  readonly channel: string;
  /** The newer version the check found. */
  readonly found: string;
}

function newestRelease(name: string, running: string, channel: string): string {
  return `${shown(name)} ${shown(running)} is the newest release on the ${shown(channel)} channel.`;
}

function newerThanNewest({ channel, found, name, running }: FoundRelease): string {
  return `${shown(name)} ${shown(running)} is newer than the newest release on the ${shown(channel)} channel, ${shown(found)}. Name that version to install it: ${shown(name)} self-update ${shown(found)}.`;
}

function alreadyInstalled(name: string, running: string): string {
  return `${shown(name)} ${shown(running)} is already installed.`;
}

function canInstall(name: string, named: string, running: string): string {
  return `${shown(name)} can install ${shown(named)} in place of ${shown(running)}.`;
}

function canUpdate({ channel, found, name, running }: FoundRelease): string {
  return `${shown(name)} can update from ${shown(running)} to ${shown(found)} on the ${shown(channel)} channel.`;
}

function downloading(asset: string, version: string, repository: string): string {
  return `Downloading ${shown(asset)} from v${shown(version)} of ${shown(repository)}.`;
}

function updated(name: string, running: string, version: string): string {
  return `Updated ${shown(name)} from ${shown(running)} to ${shown(version)}.`;
}

/**
 * The refusal of a package-manager install. `manager` is the manager's display name, and `command`
 * is the rendered, escaped command that upgrades it, absent when no command names the version.
 */
function packageManagerRefusal({
  command,
  manager,
  name,
}: {
  readonly command: string | undefined;
  readonly manager: string;
  readonly name: string;
}): string {
  const correction =
    command === undefined ? `Update it with ${shown(manager)}.` : `Run ${command}.`;
  const refusal = `${shown(name)} was installed with ${shown(manager)}, so self-update cannot replace it. `;
  return refusal + correction;
}

function noReleaseFacts(name: string): string {
  return `${shown(name)} has no release facts, so it cannot check for updates. Install a release build of ${shown(name)}, then try again.`;
}

/** The update notice. `command` is the rendered, escaped command that installs the found version. */
function updateNotice({ channel, found, name, running }: FoundRelease, command: string): string {
  return `${shown(name)} ${shown(found)} is available on the ${shown(channel)} channel. Run ${command} to update from ${shown(running)}.`;
}

/** The `trace` log template of a middleware an opt-out variable skipped. */
const skippedOptedOut = 'Skipped the update check: {variable} is set.';

/** The `trace` log template of a middleware skipped because stdout is not a terminal. */
const skippedStdout = 'Skipped the update check: stdout is not a terminal.';

/** The `trace` log template of a middleware skipped because stderr is not a terminal. */
const skippedStderr = 'Skipped the update check: stderr is not a terminal.';

/** The `trace` log template of a middleware skipped under CI. */
const skippedCi = 'Skipped the update check: CI is set.';

/** The `trace` log template of a middleware skipped while self-update runs. */
const skippedSelfUpdate = 'Skipped the update check: self-update is running.';

/** The `trace` log template of a middleware skipped for a build that is not a release. */
const skippedNotRelease = 'Skipped the update check: {name} is not a release build.';

/** The `trace` log template of a middleware skipped for a binary no installer it reads installed. */
const skippedNotInstalled =
  "Skipped the update check: {name} has no installation record and does not run from a Homebrew Cellar or a package manager's global root.";

/** The `trace` log template of a middleware skipped for a package manager with no upgrade command. */
const skippedNoCommand =
  'Skipped the update check: {name} was installed by {method}, and its facts give no upgrade command.';

/** The `trace` log template of a middleware skipped for a cache path that is not absolute. */
const skippedNotAbsolute = 'Skipped the update check: {variable} is not an absolute path.';

/** The `debug` log template that names the cache the middleware read. */
const readUpdateCheckFrom = 'Read the update check from {path}.';

/** The `trace` log template for something at the cache's path that is not a cache this version reads. */
const ignoredUpdateCacheAt = 'Ignored {path}: it is not an update cache this version reads.';

/** The `debug` log template once the detached refresh started. */
const refreshStarted = 'Started a refresh of the update check.';

/** The `trace` log template before each request the Command sends. */
const requestedUrl = 'Requested {url}.';

/** The `debug` log template once a run without a version found a newer release on its channel. */
const resolvedVersion = 'Resolved v{version} on the {channel} channel.';

/** The `debug` log template once the downloaded asset matches its listed digest. */
const verifiedAssetDigest = 'Verified {asset} against SHA256SUMS.';

/*
 * The attestation's sentences, under ADR-0212. The subpath `@loomcli/plugins/self-update/attestation`
 * and the Command's refusal before any request say them.
 */

/** What every attestation sentence names: the asset, the version being installed, and the repository. */
interface AttestedRelease {
  /** The release asset the attestation covers. */
  readonly asset: string;
  /** The release's version, without its `v`. */
  readonly version: string;
  /** The repository whose release it is, as `owner/name`. */
  readonly repository: string;
}

/** The release an attestation sentence names, as `<asset> from v<version> of <repository>`. */
function attestedRelease({ asset, repository, version }: AttestedRelease): string {
  return `${shown(asset)} from v${shown(version)} of ${shown(repository)}`;
}

function attestationCacheNotAbsolute(name: string, variable: string): string {
  return `${shown(name)} cannot find its cache directory, where it keeps Sigstore's trust root, because ${shown(variable)} is not an absolute path. Set ${shown(variable)} to an absolute path, then run self-update again.`;
}

/** The one count of minutes a rate-limit step names in the singular. */
const oneMinute = 1;

/** The step after a rate limit that names when it resets, in whole minutes rounded up. */
function againIn(minutes: number): string {
  return minutes === oneMinute
    ? 'Run self-update again in 1 minute.'
    : `Run self-update again in ${String(minutes)} minutes.`;
}

function attestationsRateLimited(release: AttestedRelease, minutes: number | undefined): string {
  return `GitHub refused to list the attestations of ${attestedRelease(release)}, because this address reached its hourly limit of requests. ${minutes === undefined ? 'Run self-update again later.' : againIn(minutes)}`;
}

function attestationsNotListed(release: AttestedRelease, status: number): string {
  return `GitHub could not list the attestations of ${attestedRelease(release)} (${statusCode(status)}). Run self-update again later. If it fails again, install the newest release with install.sh.`;
}

function attestationsUnreadable(release: AttestedRelease, name: string, running: string): string {
  return `GitHub's list of the attestations of ${attestedRelease(release)} is not in a form ${shown(name)} ${shown(running)} reads. Install the newest release with install.sh.`;
}

function noAttestation({ asset, repository, version }: AttestedRelease): string {
  return `Release v${shown(version)} of ${shown(repository)} has no attestation for ${shown(asset)}. Install a release that has one by naming its version, or ask its maintainers to attest their release assets.`;
}

function trustRootUnreachable(name: string, status: number | undefined): string {
  return `${shown(name)} could not reach tuf-repo-cdn.sigstore.dev to bring Sigstore's trust root current (${answered(status)}). Run self-update again later.`;
}

function trustRootFolderUnusable(name: string, folder: string): string {
  return `${shown(name)} could not use ${shownPlace(folder)}, where it keeps Sigstore's trust root. Free space there, check its permissions, or remove it, then run self-update again.`;
}

function trustRootStagingUnusable(name: string, temporary: string): string {
  return `${shown(name)} could not use the temporary folder ${shownPlace(temporary)} to download Sigstore's trust root. Free space there or check its permissions, then run self-update again.`;
}

function trustRootNotCurrent(name: string, folder: string, temporary: string): string {
  return `${shown(name)} could not bring Sigstore's trust root current from tuf-repo-cdn.sigstore.dev. Check that this computer's clock is right and that ${shownPlace(folder)} and the temporary folder ${shownPlace(temporary)} have free space and can be written, then run self-update again later.`;
}

function attestationUnreadable(release: AttestedRelease, name: string): string {
  return `${shown(name)} cannot read the attestation of ${attestedRelease(release)}. Run self-update again later. If it fails again, install the newest release with install.sh.`;
}

function attestationNotVerified(release: AttestedRelease): string {
  return `The attestation of ${attestedRelease(release)} does not verify against Sigstore's trust root. Tell its maintainers, and name another version to install a release that verifies.`;
}

function attestationOtherSigner(release: AttestedRelease, workflow: string): string {
  return `The attestation of ${attestedRelease(release)} was not made by ${shown(workflow)} in ${shown(release.repository)}. Tell its maintainers, and name another version to install a release that verifies.`;
}

function attestationOtherRef(release: AttestedRelease): string {
  return `The attestation of ${attestedRelease(release)} comes from a run that was not on tag v${shown(release.version)}. Tell its maintainers to attest from the tag, and name another version to install a release that verifies.`;
}

function attestationOtherSubject(release: AttestedRelease): string {
  return `The attestation of ${attestedRelease(release)} does not name ${shown(release.asset)} with the digest its SHA256SUMS lists. Tell its maintainers, and name another version to install a release that verifies.`;
}

/** The `debug` log template once Sigstore's trust root is current. */
const checkedTrustRootIn = "Checked Sigstore's trust root in {path}.";

/** The `debug` log template once an attestation of the asset passes. */
const verifiedAttestationFrom = 'Verified {asset} against its attestation from {workflow}.';

export type { AttestedRelease };
export {
  attestationCacheNotAbsolute,
  attestationNotVerified,
  attestationOtherRef,
  attestationOtherSigner,
  attestationOtherSubject,
  attestationsNotListed,
  attestationsRateLimited,
  attestationsUnreadable,
  attestationUnreadable,
  checkedTrustRootIn,
  noAttestation,
  trustRootFolderUnusable,
  trustRootNotCurrent,
  trustRootStagingUnusable,
  trustRootUnreachable,
  verifiedAttestationFrom,
};

export type { FailedRequest, FoundRelease };
export { noReleaseFacts, packageManagerRefusal };
export {
  ignoredUpdateCacheAt,
  readUpdateCheckFrom,
  refreshStarted,
  requestedUrl,
  resolvedVersion,
  skippedCi,
  skippedNoCommand,
  skippedNotAbsolute,
  skippedNotInstalled,
  skippedNotRelease,
  skippedOptedOut,
  skippedSelfUpdate,
  skippedStderr,
  skippedStdout,
  verifiedAssetDigest,
  alreadyInstalled,
  assetNotListed,
  binaryChanged,
  binaryIsLink,
  binaryMissing,
  binaryUnwritable,
  cacheNotAbsolute,
  cacheUnwritable,
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
  requestFailed,
  updated,
  updateNotice,
  versionIssue,
};
