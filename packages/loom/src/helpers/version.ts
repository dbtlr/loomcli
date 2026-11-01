import type { FragmentKind } from './fragments.js';

/** One SemVer prerelease identifier: a number with no leading zero, or alphanumerics and hyphens. */
const identifier = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)`;

/** `MAJOR.MINOR.PATCH` and an optional `-` prerelease part, with no `v`, leading zero, or build metadata. */
const targetForm = new RegExp(
  String.raw`^(?<release>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-(?<prerelease>${identifier}(?:\.${identifier})*))?$`,
  'u',
);

function compareNumbers(left: number, right: number) {
  return Math.sign(left - right);
}

// Numbers rank below words and by value; words rank in ASCII order. A number has no leading zero,
// So a longer one is the larger.
function compareIdentifiers(left: string, right: string) {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) {
    return compareNumbers(left.length, right.length) || Number(left > right) - Number(left < right);
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return Number(left > right) - Number(left < right);
}

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

/** A version split into its release part and its SemVer prerelease identifiers, empty for a stable one. */
export interface SemVer {
  prerelease: string[];
  release: Version;
  text: string;
}

/**
 * Reads `MAJOR.MINOR.PATCH` with an optional `-` prerelease part, the form `--target` and a
 * package's version take. Undefined for any other form, a leading `v`, a leading zero, and build
 * metadata included.
 */
export function parseSemVer(text: string): SemVer | undefined {
  const groups = targetForm.exec(text)?.groups;
  const release = parseVersion(groups?.release ?? '');
  if (release === undefined) {
    return undefined;
  }
  return { prerelease: groups?.prerelease?.split('.') ?? [], release, text };
}

/** SemVer precedence of two release parts: major, then minor, then patch. */
export function compareReleases(left: Version, right: Version) {
  return (
    compareNumbers(left.major, right.major) ||
    compareNumbers(left.minor, right.minor) ||
    compareNumbers(left.patch, right.patch)
  );
}

/**
 * SemVer precedence: below zero when `left` ranks lower, zero when equal, above zero when higher.
 * A version with a prerelease part ranks below its release part, and a shorter prerelease list
 * below a longer one that begins with it.
 */
export function compareSemVer(left: SemVer, right: SemVer) {
  const release = compareReleases(left.release, right.release);
  if (release !== 0) {
    return release;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return compareNumbers(right.prerelease.length, left.prerelease.length);
  }
  for (const [index, part] of left.prerelease.entries()) {
    const other = right.prerelease[index];
    if (other === undefined) {
      return 1;
    }
    const difference = compareIdentifiers(part, other);
    if (difference !== 0) {
      return difference;
    }
  }
  return compareNumbers(left.prerelease.length, right.prerelease.length);
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
