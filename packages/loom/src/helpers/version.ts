import type { FragmentKind } from './fragments.js';

/** A `MAJOR.MINOR.PATCH` version, split into its numbers. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

/**
 * Reads a `MAJOR.MINOR.PATCH` version. Undefined for any other form, a prerelease included, and
 * for a number too large to advance, so each caller says what it accepts.
 */
export function parseVersion(text: string): Version | undefined {
  const match = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/u.exec(text);
  const major = Number(match?.groups?.major);
  const minor = Number(match?.groups?.minor);
  const patch = Number(match?.groups?.patch);
  if (![major + 1, minor + 1, patch + 1].every((value) => Number.isSafeInteger(value))) {
    return undefined;
  }
  return { major, minor, patch, text };
}

/**
 * The next version. `0.0.0` cuts `0.1.0`. Below `1.0.0`, breaking advances the minor and anything
 * else the patch; from `1.0.0`, breaking advances the major, feature the minor, and fix the patch.
 */
export function nextVersion(current: Version, highest: FragmentKind | undefined) {
  if (current.text === '0.0.0') {
    return '0.1.0';
  }
  if (highest === 'breaking') {
    return current.major === 0 ? `0.${current.minor + 1}.0` : `${current.major + 1}.0.0`;
  }
  if (highest === 'feature' && current.major > 0) {
    return `${current.major}.${current.minor + 1}.0`;
  }
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}
