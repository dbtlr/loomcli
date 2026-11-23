/*
 * The plugin's own constants, each declared once for every module that reads it.
 */

/**
 * The plugin's package name, its identity and the prefix of every extension it declares. It is a
 * constant rather than a read of package.json, because importing the manifest makes tsc copy it into
 * dist beside the modules that read it.
 */
export const packageName = '@loom/explain';
