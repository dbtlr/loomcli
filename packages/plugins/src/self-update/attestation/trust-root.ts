import { isAbsolute, relative, sep } from 'node:path';

import type { FatalError } from '@loomcli/core';
import { TUFError } from '@sigstore/tuf';

import { fatal } from '../fatal.js';
import {
  trustRootFolderUnusable,
  trustRootNotCurrent,
  trustRootStagingUnusable,
  trustRootUnreachable,
} from '../messages.js';

/** What naming a trust-root fault needs: the application, the trust root's folder, the temporary folder. */
interface TrustRootPlaces {
  readonly name: string;
  readonly folder: string;
  readonly temporary: string;
}

/**
 * Settles with `pending`, or rejects with the signal's reason once it aborts. The pending call
 * goes on, since no signal reaches it, and its outcome is then dropped.
 */
async function untilAborted<Value>(pending: Promise<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  // Aborting `listening` removes the listener once the race settles.
  const listening = new AbortController();
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason);
      },
      { once: true, signal: listening.signal },
    );
  });
  // The pending call's outcome after an abort is dropped, not left unhandled.
  pending.catch(() => undefined);
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    listening.abort();
  }
}

/** The fault beneath a trust-root failure: a `TUFError`'s cause, or what the call threw itself. */
function faultOf(error: unknown): unknown {
  if (error instanceof TUFError) {
    const cause: unknown = error.cause;
    return cause;
  }
  return error;
}

/**
 * Whether a fault is a rejection of the platform's `fetch`: a `TypeError`, whatever `code` and
 * `path` it carries, as Bun's does, or the `TimeoutError` of sigstore-js's time limit.
 */
function isFetchRejection(fault: unknown): boolean {
  return (
    fault instanceof TypeError || (fault instanceof DOMException && fault.name === 'TimeoutError')
  );
}

/** The status of tuf-js's fault for a response, which carries it as a numeric `statusCode`. */
function statusOf(fault: unknown): number | undefined {
  return typeof fault === 'object' &&
    fault !== null &&
    'statusCode' in fault &&
    typeof fault.statusCode === 'number'
    ? fault.statusCode
    : undefined;
}

/** The path of a system error: one that is not a `TypeError` and has a string `code` and `path`. */
function systemPath(fault: unknown): string | undefined {
  if (typeof fault !== 'object' || fault === null || fault instanceof TypeError) {
    return undefined;
  }
  return 'code' in fault &&
    typeof fault.code === 'string' &&
    'path' in fault &&
    typeof fault.path === 'string'
    ? fault.path
    : undefined;
}

/** Whether `path` is `folder` or below it. */
function isWithin(folder: string, path: string): boolean {
  const between = relative(folder, path);
  return (
    between === '' || (!isAbsolute(between) && between !== '..' && !between.startsWith(`..${sep}`))
  );
}

/**
 * What a `TUFError`'s cause says of reaching the host: no response, from a rejection of the
 * platform's `fetch`, or the status of tuf-js's fault for a response. Any other fault, and any
 * error that is not a `TUFError`, says nothing of it.
 */
function unreachable(error: unknown): { status: number | undefined } | undefined {
  if (!(error instanceof TUFError)) {
    return undefined;
  }
  const fault = faultOf(error);
  if (isFetchRejection(fault)) {
    return { status: undefined };
  }
  const status = statusOf(fault);
  return status === undefined ? undefined : { status };
}

/** The sentence of a trust-root fault, told apart by its facts in the contract's row order. */
function trustRootSentence(error: unknown, { folder, name, temporary }: TrustRootPlaces): string {
  const host = unreachable(error);
  if (host !== undefined) {
    return trustRootUnreachable(name, host.status);
  }
  const path = systemPath(faultOf(error));
  if (path !== undefined && isWithin(folder, path)) {
    return trustRootFolderUnusable(name, folder);
  }
  if (path !== undefined && error instanceof TUFError) {
    return trustRootStagingUnusable(name, temporary);
  }
  return trustRootNotCurrent(name, folder, temporary);
}

/** The failure a trust-root fault fails the run with, its error kept as the cause. */
function trustRootFailure(error: unknown, places: TrustRootPlaces): FatalError {
  return fatal(trustRootSentence(error, places), error);
}

export type { TrustRootPlaces };
export { trustRootFailure, trustRootSentence, untilAborted };
