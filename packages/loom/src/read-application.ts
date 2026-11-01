import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { coreClass, loadFailure } from './application-load.js';
import type { ApplicationExports } from './helpers/application-exports.js';

/*
 * The read of the application module that `loom init` makes, run under Bun in a process of its own,
 * so the module imports as source, TypeScript included, and nothing it loads stays in `loom`. The
 * arguments name the result file, the package directory, the module, and the module as the
 * operator reads it. The result file receives one `ApplicationExports` as JSON, and the process
 * ends once it is written, whatever the module left running when it loaded, such as an interval.
 */

/**
 * Imports the application module and reads the names its one exported Application is exported
 * under, or why it has none. The Application class comes from the `@loomcli/core` the package
 * itself resolves, which is the copy the module's own declarations are instances of. Core resolves
 * from the package's `package.json` as a path, because Bun does not decode a percent-encoded
 * `file:` URL parent, so a package directory whose path holds a space would resolve nothing.
 */
async function read(directory: string, path: string, module: string): Promise<ApplicationExports> {
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
    const failure = loadFailure(error, (value) => value instanceof declarationError, module);
    return { failure, loaded: false };
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
  return { names: exported.filter(([, value]) => value === only).map(([name]) => name) };
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
