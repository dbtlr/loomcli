/*
 * The operator sentences of the self-update plugin, under ADR-0164: the refusals and failures the
 * Command raises, the issues of its inputs, the lines it writes about its work, and the update
 * notice. Each is a function of the values it repeats, or a constant, and the code that raises the
 * failure or writes the line calls it. It imports nothing but core's escaping and text helpers, so
 * the notice's hook loads no request code through it. `tests/message-voice.test.ts` holds this
 * module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

/** Every name, path, URL, and version a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** A path or URL escaped as a failure message quotes text, and kept whole when a message wraps. */
const shownPlace = (place: string): string => nowrap(shown(place));

/**
 * The refusal of a cache directory the environment cannot name.
 *
 * @example
 * ```ts
 * cacheNotAbsolute('notes', 'XDG_CACHE_HOME');
 * ```
 */
function cacheNotAbsolute(name: string, variable: string): string {
  return `${shown(name)} cannot find its cache directory because ${shown(variable)} is not an absolute path. Set ${shown(variable)} to an absolute path.`;
}

/**
 * The refusal of a binary changed since it was installed.
 *
 * @example
 * ```ts
 * binaryChanged('notes', '/usr/local/bin/notes');
 * ```
 */
function binaryChanged(name: string, path: string): string {
  return `${shown(name)} at ${shownPlace(path)} changed since it was installed, so self-update will not replace it. Install it again with install.sh.`;
}

/**
 * The refusal of a binary path that is a symbolic link.
 *
 * @example
 * ```ts
 * binaryIsLink('notes', '/usr/local/bin/notes');
 * ```
 */
function binaryIsLink(name: string, path: string): string {
  return `${shown(name)} at ${shownPlace(path)} is a symbolic link, so self-update will not replace what it points to. Install it again with install.sh.`;
}

/**
 * The refusal of a recorded binary path that holds no file.
 *
 * @example
 * ```ts
 * binaryMissing('notes', '/usr/local/bin/notes');
 * ```
 */
function binaryMissing(name: string, path: string): string {
  return `${shown(name)} cannot find its binary at ${shownPlace(path)}. Install it again with install.sh.`;
}

/**
 * The refusal of a run that is not a release binary.
 *
 * @example
 * ```ts
 * notReleaseBinary('notes');
 * ```
 */
function notReleaseBinary(name: string): string {
  return `${shown(name)} was not built as a release binary, so it cannot update itself. Update it the way you installed it.`;
}

/**
 * The refusal of an installation another installer placed.
 *
 * @example
 * ```ts
 * otherInstaller('notes');
 * ```
 */
function otherInstaller(name: string): string {
  return `${shown(name)} was installed some other way, so self-update cannot replace it. Update it the way you installed it.`;
}

/**
 * The refusal of an installation record directory the environment cannot name.
 *
 * @example
 * ```ts
 * recordNotAbsolute('notes', 'XDG_STATE_HOME');
 * ```
 */
function recordNotAbsolute(name: string, variable: string): string {
  return `${shown(name)} cannot find its installation record because ${shown(variable)} is not an absolute path. Set ${shown(variable)} to an absolute path, then run self-update again.`;
}

/**
 * The refusal of a directory the process cannot write to.
 *
 * @example
 * ```ts
 * directoryUnwritable('notes', '/usr/local/bin');
 * ```
 */
function directoryUnwritable(name: string, directory: string): string {
  return `${shown(name)} cannot write to ${shownPlace(directory)}. Run self-update as the user who installed ${shown(name)}.`;
}

/**
 * What a sentence states about a request that failed: why, the URL it started at, and the status
 * of its response, when one came.
 *
 * @example
 * ```ts
 * const facts: FailedRequest = { kind: 'status', status: 404, url: 'https://example.com/a' };
 * ```
 */
interface FailedRequest {
  readonly kind: 'insecure' | 'too-many' | 'status' | 'no-response';
  readonly url: string;
  readonly status: number | undefined;
}

/** A response's status code as a sentence repeats it. */
function statusCode(status: number): string {
  return String(status);
}

/** What answered a request: its status code, or no response. */
function answered(status: number | undefined): string {
  return status === undefined ? 'no response' : statusCode(status);
}

/** The correction of a download that failed: check the named release, or try again later. */
function downloadCorrection(missingRelease: string | undefined): string {
  return missingRelease === undefined
    ? 'Run self-update again later.'
    : `Check that release v${shown(missingRelease)} exists, then run self-update again.`;
}

/**
 * The failure of a request: a redirect away from HTTPS, too many redirects, or a download with no
 * response or a status it does not accept. `missingRelease` is the version the operator named when
 * the response was a 404, which the correction asks to check.
 *
 * @example
 * ```ts
 * requestFailed('notes', { kind: 'status', status: 503, url: 'https://example.com/a' }, undefined);
 * // 'notes could not download https://example.com/a (503). Run self-update again later.'
 * ```
 */
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

/**
 * The text of a request error, which the Command words through `requestFailed` before it reaches
 * the operator.
 *
 * @example
 * ```ts
 * requestErrorText('https://example.com/a', 'status'); // 'The request for https://example.com/a failed: status.'
 * ```
 */
function requestErrorText(url: string, kind: string): string {
  return `The request for ${shown(url)} failed: ${shown(kind)}.`;
}

/**
 * The failure of a cache write.
 *
 * @example
 * ```ts
 * cacheUnwritable('notes', '/home/ada/.cache/notes');
 * ```
 */
function cacheUnwritable(name: string, directory: string): string {
  return `${shown(name)} could not write its update cache to ${shownPlace(directory)}. Free space there or check its permissions, then run self-update --refresh-notice again.`;
}

/**
 * The failure of a release whose `SHA256SUMS` lists the asset twice with different digests.
 *
 * @example
 * ```ts
 * digestConflict('notes-linux-x64', 'v1.4.0', 'acme/notes');
 * ```
 */
function digestConflict(asset: string, tag: string, repository: string): string {
  return `Release ${shown(tag)} of ${shown(repository)} lists ${shown(asset)} twice in its SHA256SUMS with different digests. Run self-update again once the release is fixed.`;
}

/**
 * The failure of a download whose digest does not match its listing.
 *
 * @example
 * ```ts
 * digestMismatch('notes-linux-x64', 'v1.4.0', 'acme/notes');
 * ```
 */
function digestMismatch(asset: string, tag: string, repository: string): string {
  return `${shown(asset)} from ${shown(tag)} of ${shown(repository)} does not match its SHA256SUMS digest. Run self-update again later.`;
}

/**
 * The failure of a channel with no release.
 *
 * @example
 * ```ts
 * noRelease('notes', 'next', 'acme/notes');
 * ```
 */
function noRelease(name: string, channel: string, repository: string): string {
  return `${shown(name)} found no release on the ${shown(channel)} channel of ${shown(repository)}. Name a version to install, such as ${shown(name)} self-update 1.4.0.`;
}

/**
 * The failure of a release whose `SHA256SUMS` does not list the asset.
 *
 * @example
 * ```ts
 * assetNotListed('notes-linux-x64', 'v1.4.0', 'acme/notes');
 * ```
 */
function assetNotListed(asset: string, tag: string, repository: string): string {
  return `Release ${shown(tag)} of ${shown(repository)} has no ${shown(asset)} in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.`;
}

/**
 * The failure of an installation record write after the binary was replaced.
 *
 * @example
 * ```ts
 * recordUnwritable('notes', '1.4.0');
 * ```
 */
function recordUnwritable(name: string, version: string): string {
  return `${shown(name)} was updated to ${shown(version)}, but its installation record could not be written. Install it again with install.sh.`;
}

/**
 * The failure of a binary write.
 *
 * @example
 * ```ts
 * binaryUnwritable('notes', '/usr/local/bin');
 * ```
 */
function binaryUnwritable(name: string, directory: string): string {
  return `${shown(name)} could not write the new binary to ${shownPlace(directory)}. Free space there or check its permissions, then run self-update again.`;
}

/**
 * The issue of a version argument that is not a semantic version.
 *
 * @example
 * ```ts
 * console.log(versionIssue); // 'Supply a semantic version, such as 1.4.0.'
 * ```
 */
const versionIssue = 'Supply a semantic version, such as 1.4.0.';

/**
 * The issue of a `--channel` that names no channel.
 *
 * @example
 * ```ts
 * console.log(channelIssue); // 'Supply stable or a prerelease identifier, such as next.'
 * ```
 */
const channelIssue = 'Supply stable or a prerelease identifier, such as next.';

/**
 * The usage error of `--refresh-notice` given beside other inputs.
 *
 * @example
 * ```ts
 * console.log(refreshNoticeConflict);
 * ```
 */
const refreshNoticeConflict =
  'Option "--refresh-notice" cannot be given with other inputs. Leave out the other inputs.';

/**
 * The issue of `--refresh-notice` given beside other inputs.
 *
 * @example
 * ```ts
 * console.log(refreshNoticeConflictIssue); // 'Leave out the other inputs.'
 * ```
 */
const refreshNoticeConflictIssue = 'Leave out the other inputs.';

/**
 * The usage error of `--channel` given beside a version.
 *
 * @example
 * ```ts
 * console.log(channelConflict);
 * ```
 */
const channelConflict =
  'Option "--channel" cannot be given with a version. Leave out --channel, or the version.';

/**
 * The issue of `--channel` given beside a version.
 *
 * @example
 * ```ts
 * console.log(channelConflictIssue); // 'Leave out --channel, or the version.'
 * ```
 */
const channelConflictIssue = 'Leave out --channel, or the version.';

/**
 * The versions and channel a line about a release names: the application, the running version,
 * the channel, and the version found there.
 *
 * @example
 * ```ts
 * const found: FoundRelease = { channel: 'stable', found: '1.4.0', name: 'notes', running: '1.3.0' };
 * ```
 */
interface FoundRelease {
  readonly name: string;
  readonly running: string;
  readonly channel: string;
  readonly found: string;
}

/**
 * The line of a run whose running version is the newest on the channel.
 *
 * @example
 * ```ts
 * newestRelease('notes', '1.4.0', 'stable'); // 'notes 1.4.0 is the newest release on the stable channel.'
 * ```
 */
function newestRelease(name: string, running: string, channel: string): string {
  return `${shown(name)} ${shown(running)} is the newest release on the ${shown(channel)} channel.`;
}

/**
 * The line of a run whose running version is newer than the newest on the channel.
 *
 * @example
 * ```ts
 * newerThanNewest({ channel: 'stable', found: '1.4.0', name: 'notes', running: '1.5.0-next.1' });
 * ```
 */
function newerThanNewest({ channel, found, name, running }: FoundRelease): string {
  return `${shown(name)} ${shown(running)} is newer than the newest release on the ${shown(channel)} channel, ${shown(found)}. Name that version to install it: ${shown(name)} self-update ${shown(found)}.`;
}

/**
 * The line of a run that named the running version.
 *
 * @example
 * ```ts
 * alreadyInstalled('notes', '1.4.0'); // 'notes 1.4.0 is already installed.'
 * ```
 */
function alreadyInstalled(name: string, running: string): string {
  return `${shown(name)} ${shown(running)} is already installed.`;
}

/**
 * The `--check` line of a named version.
 *
 * @example
 * ```ts
 * canInstall('notes', '1.3.0', '1.4.0'); // 'notes can install 1.3.0 in place of 1.4.0.'
 * ```
 */
function canInstall(name: string, named: string, running: string): string {
  return `${shown(name)} can install ${shown(named)} in place of ${shown(running)}.`;
}

/**
 * The `--check` line of a newer release on the channel.
 *
 * @example
 * ```ts
 * canUpdate({ channel: 'stable', found: '1.4.0', name: 'notes', running: '1.3.0' });
 * // 'notes can update from 1.3.0 to 1.4.0 on the stable channel.'
 * ```
 */
function canUpdate({ channel, found, name, running }: FoundRelease): string {
  return `${shown(name)} can update from ${shown(running)} to ${shown(found)} on the ${shown(channel)} channel.`;
}

/**
 * The line written before the download.
 *
 * @example
 * ```ts
 * downloading('notes-linux-x64', '1.4.0', 'acme/notes');
 * // 'Downloading notes-linux-x64 from v1.4.0 of acme/notes.'
 * ```
 */
function downloading(asset: string, version: string, repository: string): string {
  return `Downloading ${shown(asset)} from v${shown(version)} of ${shown(repository)}.`;
}

/**
 * The confirmation of an update.
 *
 * @example
 * ```ts
 * updated('notes', '1.3.0', '1.4.0'); // 'Updated notes from 1.3.0 to 1.4.0.'
 * ```
 */
function updated(name: string, running: string, version: string): string {
  return `Updated ${shown(name)} from ${shown(running)} to ${shown(version)}.`;
}

/**
 * The update notice.
 *
 * @example
 * ```ts
 * updateNotice({ channel: 'stable', found: '1.4.0', name: 'notes', running: '1.3.0' });
 * // 'notes 1.4.0 is available on the stable channel. Run notes self-update to update from 1.3.0.'
 * ```
 */
function updateNotice({ channel, found, name, running }: FoundRelease): string {
  return `${shown(name)} ${shown(found)} is available on the ${shown(channel)} channel. Run ${shown(name)} self-update to update from ${shown(running)}.`;
}

export type { FailedRequest, FoundRelease };
export {
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
