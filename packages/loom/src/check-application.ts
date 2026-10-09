import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DeclarationError, diagnosticRule } from '@loomcli/core';
import { z } from 'zod';

import type { CheckResult } from './helpers/application-check.js';

/*
 * The graph checks of `loom check`, run under Bun in a process of their own, so the application
 * module imports as source, TypeScript included, and nothing it loads stays in `loom`. The
 * arguments name the result file, the package directory, the module, and the module as the
 * operator reads it. The result file receives one `CheckResult` as JSON, and the process ends once
 * it is written, whatever the module left running when it loaded, such as an interval.
 */

/** A module that threw while it loaded, for a throw that is not a `DeclarationError`. */
const loadFailed = diagnosticRule('@loomcli/loom/application-load-failed', {
  explanation:
    'loom check imports the application module to read its declarations, and the module threw while it loaded, so no declaration could be checked.',
  headline: 'Application failed to load',
});

/** The faults `check()` returns, each read by its message, which holds the whole diagnostic. */
const faults = z.array(z.object({ message: z.string() }));

/** One export of a module namespace or member of the package's core, read without trusting it. */
function member(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

/** A class the package's core exports, or `undefined` when the export is not a class. */
function coreClass(core: unknown, name: string) {
  const value = member(core, name);
  return typeof value === 'function' ? value : undefined;
}

/** The fault a throw while the module loads is: a `DeclarationError`'s own, or a load failure. */
function loadFault(
  error: unknown,
  isDeclarationError: (value: unknown) => boolean,
  module: string,
): string {
  if (isDeclarationError(error) && error instanceof Error) {
    return error.message;
  }
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new DeclarationError(loadFailed, {
    correction:
      'Fix the code that throws, or move the work into an action, which runs only when its Command runs.',
    sentence: `${module} threw while it loaded: ${reason}`,
  }).message;
}

/**
 * Imports the application module and reads every fault its one exported Application holds, and
 * the names it is exported under. The Application class comes from the `@loomcli/core` the package
 * itself resolves, which is the copy the module's own declarations are instances of. Core resolves
 * from the package's `package.json` as a path, because Bun does not decode a percent-encoded
 * `file:` URL parent, so a package directory whose path holds a space would resolve nothing.
 */
async function check(directory: string, path: string, module: string): Promise<CheckResult> {
  let coreAddress = '';
  try {
    coreAddress = import.meta.resolve('@loomcli/core', join(directory, 'package.json'));
  } catch {
    return {
      failure: `@loomcli/core does not resolve from the package, so install it before checking ${module}.`,
    };
  }
  const core: unknown = await import(coreAddress);
  const application = coreClass(core, 'Application');
  const declarationError = coreClass(core, 'DeclarationError');
  if (application === undefined || declarationError === undefined) {
    return {
      failure: `The @loomcli/core the package resolves exports no Application to check ${module} with.`,
    };
  }
  let namespace: unknown = undefined;
  try {
    namespace = await import(pathToFileURL(path).href);
  } catch (error) {
    return {
      faults: [loadFault(error, (value) => value instanceof declarationError, module)],
      names: [],
    };
  }
  const exported =
    typeof namespace === 'object' && namespace !== null ? Object.entries(namespace) : [];
  const found = [
    ...new Set(exported.map(([, value]) => value).filter((value) => value instanceof application)),
  ];
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    return {
      failure:
        found.length === 0
          ? `${module} exports no Application, so export the Application the entry runs.`
          : `${module} exports ${found.length} Applications, so export one Application from it.`,
    };
  }
  const method = member(only, 'check');
  if (typeof method !== 'function') {
    return { failure: `The Application ${module} exports has no check() to read its faults with.` };
  }
  const checked: unknown = Reflect.apply(method, only, []);
  return {
    faults: faults.parse(checked).map((fault) => fault.message),
    names: exported.filter(([, value]) => value === only).map(([name]) => name),
  };
}

const [resultFile, directory, path, module] = process.argv.slice(2);
if (
  resultFile === undefined ||
  directory === undefined ||
  path === undefined ||
  module === undefined
) {
  throw new Error(
    'check-application takes a result file, a package directory, a module, and its name.',
  );
}
writeFileSync(resultFile, JSON.stringify(await check(directory, path, module)));
process.exit(0);
