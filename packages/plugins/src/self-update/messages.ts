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

/** The sentence that names why the middleware did nothing. */
function skipReason(skip: UpdateCheckSkip): string {
  switch (skip.kind) {
    case 'opted-out': {
      return `${shown(skip.variable)} is set.`;
    }
    case 'stdout': {
      return 'stdout is not a terminal.';
    }
    case 'stderr': {
      return 'stderr is not a terminal.';
    }
    case 'ci': {
      return 'CI is set.';
    }
    case 'self-update': {
      return 'self-update is running.';
    }
    case 'not-release': {
      return `${shown(skip.name)} is not a release binary.`;
    }
    case 'not-script': {
      return `${shown(skip.name)} was not installed by install.sh.`;
    }
    default: {
      return `${shown(skip.variable)} is not an absolute path.`;
    }
  }
}

/** The `-vv` line of a middleware that did nothing, naming the first reason. */
function skippedUpdateCheck(skip: UpdateCheckSkip): string {
  return `Skipped the update check: ${skipReason(skip)}`;
}

/** The `-v` line that names the cache the middleware read. */
function readUpdateCheck(path: string): string {
  return `Read the update check from ${shownPlace(path)}.`;
}

/** The `-vv` line for something at the cache's path that is not a cache this version reads. */
function ignoredUpdateCache(path: string): string {
  return `Ignored ${shownPlace(path)}: it is not an update cache this version reads.`;
}

const startedRefresh = 'Started a refresh of the update check.';

/** The `-vv` line before each request the Command sends. */
function requested(url: string): string {
  return `Requested ${shownPlace(url)}.`;
}

/** The `-v` line once a run without a version found a newer release on its channel. */
function resolvedRelease(version: string, channel: string): string {
  return `Resolved v${shown(version)} on the ${shown(channel)} channel.`;
}

/** The `-v` line once the downloaded asset matches its listed digest. */
function verifiedAsset(asset: string): string {
  return `Verified ${shown(asset)} against SHA256SUMS.`;
}

/** The `-v` line once the verified bytes are renamed over the recorded path. */
function replacedBinary(path: string): string {
  return `Replaced ${shownPlace(path)}.`;
}

export type { FailedRequest, FoundRelease, UpdateCheckSkip };
export {
  ignoredUpdateCache,
  readUpdateCheck,
  replacedBinary,
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
