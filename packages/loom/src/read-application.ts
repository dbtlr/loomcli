import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DeclarationError, diagnosticRule } from '@loomcli/core';

import type { ApplicationExports } from './helpers/application-exports.js';

/*
 * The read of the application module that `loom init` makes, run under Bun in a process of its own,
 * so the module imports as source, TypeScript included, and nothing it loads stays in `loom`. The
 * arguments name the result file, the package directory, the module, and the module as the
 * operator reads it. The result file receives one `ApplicationExports` as JSON, and the process
 * ends once it is written, whatever the module left running when it loaded, such as an interval.
 * Beside the names the module exports its Application under, the read builds the Application's
 * graph through `inspect()`, as a source run builds it, and keeps its post-install declaration.
 */

/** A module that threw while it loaded, for a throw that is not a `DeclarationError`. */
const loadFailed = diagnosticRule('@loomcli/loom/application-load-failed', {
  explanation:
    'loom init imports the application module to learn how the entry imports its Application, and the module threw while it loaded, so the entry could not be written.',
  headline: 'Application failed to load',
});

/**
 * What the build of the graph found, with the post-install declaration as the graph holds it,
 * which `readApplicationExports` validates once the result file is read.
 */
type GraphFound = { fault: string } | { failure: string } | { postInstall?: unknown };

/** What the read writes to the result file. */
type Found =
  | Exclude<ApplicationExports, { graph: unknown }>
  | { graph: GraphFound; names: string[] };

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
 * What a throw while the module loads read as: a `DeclarationError`'s own Developer Diagnostic, or
 * the load failure any other throw is.
 */
function loadFailure(
  error: unknown,
  isDeclarationError: (value: unknown) => boolean,
  module: string,
): Found {
  if (isDeclarationError(error) && error instanceof Error) {
    return { fault: error.message };
  }
  const failure = new DeclarationError(loadFailed, {
    correction:
      'Fix the code that throws, or move the work into an action, which runs only when its Command runs.',
    sentence: `${module} threw while it loaded: ${reasonOf(error)}`,
  }).message;
  return { failure, loaded: false };
}

/**
 * The Application's graph as `inspect()` builds it from source, which runs a development build's
 * checks: its post-install declaration, or the Developer Diagnostic of the declaration fault the
 * build raised, or why the build failed otherwise.
 */
function readGraph(
  application: unknown,
  isDeclarationError: (value: unknown) => boolean,
  module: string,
): GraphFound {
  const inspect = member(application, 'inspect');
  if (typeof inspect !== 'function') {
    return {
      failure: `The Application ${module} exports has no inspect() to read its graph with.`,
    };
  }
  try {
    const postInstall = member(Reflect.apply(inspect, application, []), 'postInstall');
    return postInstall === undefined ? {} : { postInstall };
  } catch (error) {
    if (isDeclarationError(error) && error instanceof Error) {
      return { fault: error.message };
    }
    return { failure: `The graph of ${module} failed to build: ${reasonOf(error)}` };
  }
}

/**
 * Imports the application module and reads the names its one exported Application is exported
 * under, or why it has none. The Application class comes from the `@loomcli/core` the package
 * itself resolves, which is the copy the module's own declarations are instances of. Core resolves
 * from the package's `package.json` as a path, because Bun does not decode a percent-encoded
 * `file:` URL parent, so a package directory whose path holds a space would resolve nothing.
 */
async function read(directory: string, path: string, module: string): Promise<Found> {
  let coreAddress = '';
  try {
    coreAddress = import.meta.resolve('@loomcli/core', join(directory, 'package.json'));
  } catch {
    return {
      failure: `@loomcli/core does not resolve from the package, so install it before init reads ${module}.`,
      loaded: false,
    };
  }
  const core: unknown = await import(coreAddress);
  const application = coreClass(core, 'Application');
  const declarationError = coreClass(core, 'DeclarationError');
  if (application === undefined || declarationError === undefined) {
    return {
      failure: `The @loomcli/core the package resolves exports no Application to read ${module} with.`,
      loaded: false,
    };
  }
  let namespace: unknown = undefined;
  try {
    namespace = await import(pathToFileURL(path).href);
  } catch (error) {
    return loadFailure(error, (value) => value instanceof declarationError, module);
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
      loaded: true,
    };
  }
  return {
    graph: readGraph(only, (value) => value instanceof declarationError, module),
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
    'read-application takes a result file, a package directory, a module, and its name.',
  );
}
writeFileSync(resultFile, JSON.stringify(await read(directory, path, module)));
process.exit(0);
