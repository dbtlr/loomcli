import { join } from 'node:path';

import { DeclarationError, diagnosticRule } from '@loomcli/core';

/*
 * What the processes that load an application module share: `loom init`'s read of its exports and
 * `loom build`'s read of its skills folder each import the module under Bun in a process of their
 * own, take the same arguments, resolve the package's own core the same way, and read a throw while
 * the module loads the same way.
 */

/** A module that threw while it loaded, for a throw that is not a `DeclarationError`. */
const loadFailed = diagnosticRule('@loomcli/loom/application-load-failed', {
  explanation:
    'loom imports the application module to learn what it declares, loom init how the entry imports its Application and loom build the skills folder skills() names, and the module threw while it loaded, so the command could not finish.',
  headline: 'Application failed to load',
});

/** What a reader is given: the result file, the package directory, the module, and its name. */
interface ReaderArguments {
  readonly resultFile: string;
  readonly directory: string;
  /** The module's absolute path. */
  readonly path: string;
  /** The module as the operator reads it. */
  readonly module: string;
}

/** A reader's arguments, read from the words after the script, or a throw when one is missing. */
function readerArguments(words: readonly string[], reader: string): ReaderArguments {
  const [resultFile, directory, path, module] = words;
  if (
    resultFile === undefined ||
    directory === undefined ||
    path === undefined ||
    module === undefined
  ) {
    throw new Error(`${reader} takes a result file, a package directory, a module, and its name.`);
  }
  return { directory, module, path, resultFile };
}

/**
 * The address of the `@loomcli/core` the package itself resolves, which the module's own
 * declarations are instances of, or `undefined` when it resolves none. Core resolves from the
 * package's `package.json` as a path, because Bun does not decode a percent-encoded `file:` URL
 * parent, so a package directory whose path holds a space would resolve nothing.
 */
function coreAddress(directory: string): string | undefined {
  try {
    return import.meta.resolve('@loomcli/core', join(directory, 'package.json'));
  } catch {
    return undefined;
  }
}

/** One export of a module namespace or member of the package's core, read without trusting it. */
function member(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

/** A class the package's core exports, or `undefined` when the export is not a class. */
function coreClass(core: unknown, name: string) {
  const value = member(core, name);
  return typeof value === 'function' ? value : undefined;
}

/** A thrown value as one reason: an `Error`'s name and message, or the value itself. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * What a throw while the module loads reads as: a `DeclarationError`'s own Developer Diagnostic, or
 * the load failure any other throw is.
 */
function loadFailure(
  error: unknown,
  isDeclarationError: (value: unknown) => boolean,
  module: string,
): string {
  if (isDeclarationError(error) && error instanceof Error) {
    return error.message;
  }
  return new DeclarationError(loadFailed, {
    correction:
      'Fix the code that throws, or move the work into an action, which runs only when its Command runs.',
    sentence: `${module} threw while it loaded: ${reasonOf(error)}`,
  }).message;
}

export { coreAddress, coreClass, loadFailure, member, readerArguments };
