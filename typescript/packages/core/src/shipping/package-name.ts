/** A package name segment: a lowercase letter or digit, then letters, digits, `.`, `_`, and `-`. */
const packageSegment = '[a-z0-9][a-z0-9._-]*';

/** A package name: a segment, or `@`, a scope segment, `/`, and a segment. */
const packageName = new RegExp(`^(?:@${packageSegment}/)?${packageSegment}$`, 'u');

/** The longest package name npm publishes, its scope included. */
const maximumPackageLength = 214;

/** The whole names npm refuses to publish, the list validate-npm-package-name keeps. */
const reservedNames: ReadonlySet<string> = new Set(['favicon.ico', 'node_modules']);

/**
 * The npm package name rule Loom reads a name by: at most 214 characters, a segment, or `@`, a
 * scope segment, `/`, and a segment, where a segment is one or more of `a` to `z`, the digits, `-`,
 * `.`, and `_`, starting with a letter or a digit, and never one of the unscoped names npm
 * reserves, `node_modules` and `favicon.ico`. So a name is never `.` or `..`, and its last segment
 * names a folder. Core exports it so the self-update plugin's upgrade command and the
 * `loom` bin's npm packages judge a name by this same rule.
 *
 * @example
 * ```ts
 * import { isNpmPackageName } from '@loomcli/core';
 *
 * isNpmPackageName('notes'); // true
 * isNpmPackageName('@acme/notes'); // true
 * isNpmPackageName('Notes'); // false: npm names are lowercase
 * isNpmPackageName('@acme/..'); // false: a segment starts with a letter or a digit
 * isNpmPackageName('node_modules'); // false: npm reserves the name
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/release-facts.md#release-facts
 * @public
 */
export function isNpmPackageName(name: string): boolean {
  return name.length <= maximumPackageLength && packageName.test(name) && !reservedNames.has(name);
}
