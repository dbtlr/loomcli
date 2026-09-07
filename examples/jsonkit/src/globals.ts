import { GlobalOptions } from '@loom/core';

/**
 * A document arrives from a file or from piped text, so the global names a source rather than
 * demanding one. The shared reader selects between them, and every action reads through it.
 */
export const globals = new GlobalOptions().option('file', { short: 'f', type: 'string' });
