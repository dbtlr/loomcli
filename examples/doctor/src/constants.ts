/*
 * The plugin's own constants, each declared once for every module that reads it.
 */

/**
 * The plugin's package name, which is its identity. It is a constant rather than a read of
 * package.json, because importing the manifest makes tsc copy it into dist beside the module that
 * reads it.
 */
export const packageName = '@loom/doctor';
