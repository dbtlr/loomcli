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
  readonly kind: 'insecure' | 'too-many' | 'status' | 'no-response';
  readonly url: string;
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

function requestErrorText(url: string, kind: string): string {
  return `The request for ${shown(url)} failed: ${shown(kind)}.`;
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
  readonly name: string;
  readonly running: string;
  readonly channel: string;
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

function updateNotice({ channel, found, name, running }: FoundRelease): string {
  return `${shown(name)} ${shown(found)} is available on the ${shown(channel)} channel. Run ${shown(name)} self-update to update from ${shown(running)}.`;
}

/**
 * The first condition of the update notices' middleware that fails: an opt-out variable is set, an
 * output stream is not a terminal, CI is set, `self-update` itself is running, the run is not a
 * release binary or not one install.sh placed, or the cache directory's variable is not absolute.
 */
type UpdateCheckSkip =
  | { readonly kind: 'opted-out'; readonly variable: string }
  | { readonly kind: 'stdout' | 'stderr' | 'ci' | 'self-update' }
  | { readonly kind: 'not-release' | 'not-script'; readonly name: string }
  | { readonly kind: 'not-absolute'; readonly variable: string };

/** One log line: its message, a constant Message Template, and the fields it reads. */
interface LogText {
  readonly template: string;
  readonly fields?: Readonly<Record<string, string>>;
}

/** The `trace` log line of a middleware that did nothing, naming the first reason. */
function skippedUpdateCheck(skip: UpdateCheckSkip): LogText {
  switch (skip.kind) {
    case 'opted-out': {
      return {
        fields: { variable: skip.variable },
        template: 'Skipped the update check: {variable} is set.',
      };
    }
    case 'stdout': {
      return { template: 'Skipped the update check: stdout is not a terminal.' };
    }
    case 'stderr': {
      return { template: 'Skipped the update check: stderr is not a terminal.' };
    }
    case 'ci': {
      return { template: 'Skipped the update check: CI is set.' };
    }
    case 'self-update': {
      return { template: 'Skipped the update check: self-update is running.' };
    }
    case 'not-release': {
      return {
        fields: { name: skip.name },
        template: 'Skipped the update check: {name} is not a release binary.',
      };
    }
    case 'not-script': {
      return {
        fields: { name: skip.name },
        template: 'Skipped the update check: {name} was not installed by install.sh.',
      };
    }
    default: {
      return {
        fields: { variable: skip.variable },
        template: 'Skipped the update check: {variable} is not an absolute path.',
      };
    }
  }
}

/** The `debug` log line that names the cache the middleware read. */
function readUpdateCheck(path: string): LogText {
  return { fields: { path }, template: 'Read the update check from {path}.' };
}

/** The `trace` log line for something at the cache's path that is not a cache this version reads. */
function ignoredUpdateCache(path: string): LogText {
  return {
    fields: { path },
    template: 'Ignored {path}: it is not an update cache this version reads.',
  };
}

/** The `debug` log line once the detached refresh started. */
const startedRefresh: LogText = { template: 'Started a refresh of the update check.' };

/** The `trace` log line before each request the Command sends. */
function requested(url: string): LogText {
  return { fields: { url }, template: 'Requested {url}.' };
}

/** The `debug` log line once a run without a version found a newer release on its channel. */
function resolvedRelease(version: string, channel: string): LogText {
  return {
    fields: { channel, version },
    template: 'Resolved v{version} on the {channel} channel.',
  };
}

/** The `debug` log line once the downloaded asset matches its listed digest. */
function verifiedAsset(asset: string): LogText {
  return { fields: { asset }, template: 'Verified {asset} against SHA256SUMS.' };
}

/*
 * The attestation's sentences, under ADR-0212. The subpath `@loomcli/plugins/self-update/attestation`
 * and the Command's refusal before any request say them.
 */

/** What every attestation sentence names: the asset, the version being installed, and the repository. */
interface AttestedRelease {
  readonly asset: string;
  readonly version: string;
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

/** The `debug` log line once Sigstore's trust root is current. */
function checkedTrustRoot(path: string): LogText {
  return { fields: { path }, template: "Checked Sigstore's trust root in {path}." };
}

/** The `debug` log line once an attestation of the asset passes. */
function verifiedAttestation(asset: string, workflow: string): LogText {
  return {
    fields: { asset, workflow },
    template: 'Verified {asset} against its attestation from {workflow}.',
  };
}

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
  checkedTrustRoot,
  noAttestation,
  trustRootFolderUnusable,
  trustRootNotCurrent,
  trustRootStagingUnusable,
  trustRootUnreachable,
  verifiedAttestation,
};

export type { FailedRequest, FoundRelease, LogText, UpdateCheckSkip };
export {
  ignoredUpdateCache,
  readUpdateCheck,
  requested,
  resolvedRelease,
  skippedUpdateCheck,
  startedRefresh,
  verifiedAsset,
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
  requestErrorText,
  requestFailed,
  updated,
  updateNotice,
  versionIssue,
};
