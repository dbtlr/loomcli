/*
 * The pack's own constants, each declared once for every module that reads it.
 */

/**
 * The pack's package name, the prefix of every plugin identity and rule it declares. It is a constant
 * rather than a read of package.json, because importing the manifest makes tsc copy it, unpublished
 * workspace specs included, into dist beside the modules that read it.
 */
export const packageName = '@loomcli/plugins';
