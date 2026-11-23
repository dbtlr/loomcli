import { pathToFileURL } from 'node:url';

import type { Application, CommandGraph } from '@loomcli/core';

import { coreAddress, coreClass, loadThrow } from '../application-load.js';
import type { ApplicationRead } from './application-exports.js';

/**
 * Loads the module's one exported Application in the Bun reader process.
 * Future reader projections call this step and runReader, retaining the live graph so a plugin's
 * public projection can find the declaration its onGraphBuilt hook recorded.
 */
export async function loadApplication(
  directory: string,
  path: string,
): Promise<
  { readonly application: Pick<Application, 'inspect'>; readonly names: string[] } | ApplicationRead
> {
  const address = coreAddress(directory);
  if (address === undefined) {
    return { problem: 'core-unresolved' };
  }
  const core: unknown = await import(address);
  const applicationClass = coreClass(core, 'Application');
  const declarationError = coreClass(core, 'DeclarationError');
  if (applicationClass === undefined || declarationError === undefined) {
    return { problem: 'core-without-application' };
  }
  try {
    const namespace: unknown = await import(pathToFileURL(path).href);
    const exports =
      typeof namespace === 'object' && namespace !== null ? Object.values(namespace) : [];
    // The package's own Application class establishes the public inspect contract across copies.
    const applications = [
      ...new Set(
        exports.filter(
          (value): value is Pick<Application, 'inspect'> => value instanceof applicationClass,
        ),
      ),
    ];
    const [only] = applications;
    if (applications.length !== 1 || only === undefined) {
      return { count: applications.length, problem: 'applications' };
    }
    return {
      application: only,
      names:
        typeof namespace === 'object' && namespace !== null
          ? Object.entries(namespace)
              .filter(([, value]) => value === only)
              .map(([name]) => name)
          : [],
    };
  } catch (error) {
    const thrown = loadThrow(error, (value) => value instanceof declarationError);
    return 'threw' in thrown ? thrown : { ...thrown, loaded: false };
  }
}

/** Loads and builds the Application for a reader projection, leaving its graph in this process. */
export async function loadAndInspectApplication(
  directory: string,
  path: string,
): Promise<{ readonly graph: CommandGraph } | ApplicationRead> {
  const loaded = await loadApplication(directory, path);
  if (!('application' in loaded)) {
    return loaded;
  }
  try {
    return { graph: loaded.application.inspect() };
  } catch (error) {
    const address = coreAddress(directory);
    const core: unknown = address === undefined ? undefined : await import(address);
    const declarationError = coreClass(core, 'DeclarationError');
    const thrown = loadThrow(
      error,
      (value) => declarationError !== undefined && value instanceof declarationError,
    );
    return 'threw' in thrown ? thrown : { ...thrown, loaded: true };
  }
}
