import { join } from 'node:path';

import type { Threw } from './helpers/application-load-failure.js';

/*
 * What the processes that load an application module share: `loom init`'s read of its exports and
 * `loom build`'s read of its skills folder each import the module under Bun in a process of their
 * own, take the same arguments, resolve the package's own core the same way, and read a throw while
 * the module loads the same way. They import no module of `@loomcli/core` themselves, only the
 * package's own core at run time, so each bundles to a few kilobytes; the `loom` process formats
 * the Developer Diagnostic of a throw.
 */

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
 * What a throw while the module loads reads as: a `DeclarationError`'s own Developer Diagnostic as
 * the failure, or any other throw's reason, which the `loom` process formats as the load failure.
 */
function loadThrow(
  error: unknown,
  isDeclarationError: (value: unknown) => boolean,
): { readonly failure: string } | Threw {
  if (isDeclarationError(error) && error instanceof Error) {
    return { failure: error.message };
  }
  return { threw: reasonOf(error) };
}

export { coreAddress, coreClass, loadThrow, member, readerArguments };
