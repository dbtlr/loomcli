import { DeclarationError, diagnosticRule } from '@loomcli/core';

/*
 * What the processes that load an application module share: `loom init`'s read of its exports and
 * `loom build`'s read of its skills folder each import the module under Bun in a process of their
 * own, and each reads a throw while it loads the same way.
 */

/** A module that threw while it loaded, for a throw that is not a `DeclarationError`. */
const loadFailed = diagnosticRule('@loomcli/loom/application-load-failed', {
  explanation:
    'loom imports the application module to learn what it declares, loom init how the entry imports its Application and loom build the skills folder skills() names, and the module threw while it loaded, so the command could not finish.',
  headline: 'Application failed to load',
});

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

export { coreClass, loadFailure, member };
