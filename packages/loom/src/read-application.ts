import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { coreAddress, coreClass, loadThrow, readerArguments } from './application-load.js';
import type { ApplicationRead } from './helpers/application-exports.js';

/*
 * The read of the application module that `loom init` makes, run under Bun in a process of its own,
 * so the module imports as source, TypeScript included, and nothing it loads stays in `loom`. The
 * arguments name the result file, the package directory, the module, and the module as the
 * operator reads it. The result file receives one `ApplicationRead` as JSON, and the process
 * ends once it is written, whatever the module left running when it loaded, such as an interval.
 * It bundles no message module, so it answers facts, and the `loom` process words each one.
 */

/**
 * Imports the application module and reads the names its one exported Application is exported
 * under, or why it has none, as a fact the `loom` process words. The Application class comes from
 * the `@loomcli/core` the package itself resolves, which is the copy the module's own declarations
 * are instances of.
 */
async function read(directory: string, path: string): Promise<ApplicationRead> {
  const address = coreAddress(directory);
  if (address === undefined) {
    return { problem: 'core-unresolved' };
  }
  const core: unknown = await import(address);
  const application = coreClass(core, 'Application');
  const declarationError = coreClass(core, 'DeclarationError');
  if (application === undefined || declarationError === undefined) {
    return { problem: 'core-without-application' };
  }
  let namespace: unknown = undefined;
  try {
    namespace = await import(pathToFileURL(path).href);
  } catch (error) {
    const thrown = loadThrow(error, (value) => value instanceof declarationError);
    return 'threw' in thrown ? thrown : { ...thrown, loaded: false };
  }
  const exported =
    typeof namespace === 'object' && namespace !== null ? Object.entries(namespace) : [];
  const found = [
    ...new Set(exported.map(([, value]) => value).filter((value) => value instanceof application)),
  ];
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    return { count: found.length, problem: 'applications' };
  }
  return { names: exported.filter(([, value]) => value === only).map(([name]) => name) };
}

const { directory, path, resultFile } = readerArguments(process.argv.slice(2), 'read-application');
writeFileSync(resultFile, JSON.stringify(await read(directory, path)));
process.exit(0);
