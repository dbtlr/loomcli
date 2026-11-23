/**
 * The changelog a checkout keeps, relative to its root, when nothing names another. Loom's own
 * release commands read it in the workspace directory, and a package reads it unless its configuration
 * file names another.
 */
export const conventionalChangelog = 'CHANGELOG.md';

/**
 * The folder a checkout keeps its fragments in, relative to its root, when nothing names another:
 * Loom's own release commands read it in the workspace directory, and a package reads it unless its
 * configuration file names another.
 */
export const conventionalFragments = '.changes';
