import { escapeControlCharacters, FatalError } from '@loomcli/core';

import { notFound } from './request.js';
import type { RequestError } from './request.js';

/** Every path, URL, and version a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** One failure the Command reports: its sentence and correction, the runtime's error kept as cause. */
function fatal(sentence: string, cause?: unknown): FatalError {
  return new FatalError(sentence, cause === undefined ? undefined : { cause });
}

const refusals = {
  cache: (name: string, variable: string) =>
    fatal(
      `${name} cannot find its cache directory because ${variable} is not an absolute path. Set ${variable} to an absolute path.`,
    ),
  changed: (name: string, path: string) =>
    fatal(
      `${name} at ${shown(path)} changed since it was installed, so self-update will not replace it. Install it again with install.sh.`,
    ),
  link: (name: string, path: string) =>
    fatal(
      `${name} at ${shown(path)} is a symbolic link, so self-update will not replace what it points to. Install it again with install.sh.`,
    ),
  missing: (name: string, path: string) =>
    fatal(`${name} cannot find its binary at ${shown(path)}. Install it again with install.sh.`),
  notBuilt: (name: string) =>
    fatal(
      `${name} was not built as a release binary, so it cannot update itself. Update it the way you installed it.`,
    ),
  otherInstaller: (name: string) =>
    fatal(
      `${name} was installed some other way, so self-update cannot replace it. Update it the way you installed it.`,
    ),
  record: (name: string, variable: string) =>
    fatal(
      `${name} cannot find its installation record because ${variable} is not an absolute path. Set ${variable} to an absolute path, then run self-update again.`,
    ),
  unwritable: (name: string, directory: string, cause: unknown) =>
    fatal(
      `${name} cannot write to ${shown(directory)}. Run self-update as the user who installed ${name}.`,
      cause,
    ),
};

/** The sentence for a request that failed, with the correction a named version's 404 reads. */
function requestFailed(name: string, failure: RequestError, named: string | undefined): FatalError {
  const url = shown(failure.url);
  if (failure.kind === 'insecure') {
    return fatal(
      `${name} was redirected away from HTTPS while downloading ${url}. Run self-update again later.`,
    );
  }
  if (failure.kind === 'too-many') {
    return fatal(
      `${name} was redirected too many times while downloading ${url}. Run self-update again later.`,
    );
  }
  const status = failure.status === undefined ? 'no response' : String(failure.status);
  const correction =
    named !== undefined && failure.status === notFound
      ? `Check that release v${shown(named)} exists, then run self-update again.`
      : 'Run self-update again later.';
  return fatal(`${name} could not download ${url} (${status}). ${correction}`, failure.cause);
}

const failures = {
  cache: (name: string, directory: string, cause: unknown) =>
    fatal(
      `${name} could not write its update cache to ${shown(directory)}. Free space there or check its permissions, then run self-update --refresh-notice again.`,
      cause,
    ),
  conflict: (asset: string, tag: string, repository: string) =>
    fatal(
      `Release ${shown(tag)} of ${shown(repository)} lists ${shown(asset)} twice in its SHA256SUMS with different digests. Run self-update again once the release is fixed.`,
    ),
  mismatch: (asset: string, tag: string, repository: string) =>
    fatal(
      `${shown(asset)} from ${shown(tag)} of ${shown(repository)} does not match its SHA256SUMS digest. Run self-update again later.`,
    ),
  noRelease: (name: string, channel: string, repository: string) =>
    fatal(
      `${name} found no release on the ${shown(channel)} channel of ${shown(repository)}. Name a version to install, such as ${name} self-update 1.4.0.`,
    ),
  notListed: (asset: string, tag: string, repository: string) =>
    fatal(
      `Release ${shown(tag)} of ${shown(repository)} has no ${shown(asset)} in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.`,
    ),
  record: (name: string, version: string, cause: unknown) =>
    fatal(
      `${name} was updated to ${shown(version)}, but its installation record could not be written. Install it again with install.sh.`,
      cause,
    ),
  write: (name: string, directory: string, cause: unknown) =>
    fatal(
      `${name} could not write the new binary to ${shown(directory)}. Free space there or check its permissions, then run self-update again.`,
      cause,
    ),
};

export { failures, refusals, requestFailed, shown };
