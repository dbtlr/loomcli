/** One SemVer prerelease identifier: a number with no leading zero, or alphanumerics and hyphens. */
const identifier = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)`;

/** A semantic version, as semver.org's grammar states it, its parts captured. */
const semanticVersion = new RegExp(
  String.raw`^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)` +
    String.raw`(?:-(?<prerelease>${identifier}(?:\.${identifier})*))?` +
    String.raw`(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$`,
  'u',
);

/** A release channel an operator names: `stable`, or one prerelease identifier. */
const channelName = new RegExp(String.raw`^(?:stable|${identifier})$`, 'u');

/** A semantic version read into the parts precedence compares. */
interface Version {
  readonly text: string;
  readonly core: readonly [bigint, bigint, bigint];
  readonly prerelease: readonly string[];
}

/** The version a string spells, or `undefined` when it is not a semantic version. */
function parseVersion(text: string): Version | undefined {
  const groups = semanticVersion.exec(text)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { major = '0', minor = '0', patch = '0', prerelease } = groups;
  return {
    core: [BigInt(major), BigInt(minor), BigInt(patch)],
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
    text,
  };
}

/** What a tag or an operator's version may begin with. */
const versionPrefix = 'v';

/** The comparison result of two versions or identifiers that have the same precedence. */
const equalPrecedence = 0;

/** The comparison result of a version that has no prerelease identifiers to compare. */
const noIdentifiers = 0;

/** The comparison result of a left side that has precedence over the right. */
const higher = 1;

/** The version a tag names, `v` and a semantic version, or `undefined` for any other tag. */
function versionOfTag(tag: string): Version | undefined {
  return tag.startsWith(versionPrefix) ? parseVersion(tag.slice(versionPrefix.length)) : undefined;
}

/** A version the operator typed, with or without a leading `v`. */
function versionOfArgument(text: string): Version | undefined {
  return parseVersion(text.startsWith(versionPrefix) ? text.slice(versionPrefix.length) : text);
}

/** The release channel of a version: its first prerelease identifier, or `stable`. */
function channelOf(version: Version): string {
  const [first = 'stable'] = version.prerelease;
  return first;
}

/** Whether a string names a release channel: `stable`, or one prerelease identifier. */
function isChannelName(text: string): boolean {
  return channelName.test(text);
}

/** Below zero when `left` sorts before `right`, zero when they are equal, above zero after. */
function compareOrdered<Value extends bigint | number | string>(left: Value, right: Value): number {
  return Number(left > right) - Number(left < right);
}

/** SemVer precedence of two prerelease identifiers: numbers below words, numbers by value. */
function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/u.test(left);
  const rightNumber = /^\d+$/u.test(right);
  if (leftNumber && rightNumber) {
    return compareOrdered(BigInt(left), BigInt(right));
  }
  if (leftNumber !== rightNumber) {
    return Number(rightNumber) - Number(leftNumber);
  }
  return compareOrdered(left, right);
}

/** SemVer precedence of the major, minor, and patch numbers, the first difference deciding. */
function compareCore(left: Version, right: Version): number {
  return (
    left.core
      .map((part, index) => compareOrdered(part, right.core[index] ?? part))
      .find((difference) => difference !== equalPrecedence) ?? equalPrecedence
  );
}

/** SemVer precedence of two prerelease lists, where a version with none outranks one with some. */
function comparePrerelease(left: Version, right: Version): number {
  if (left.prerelease.length === noIdentifiers || right.prerelease.length === noIdentifiers) {
    return compareOrdered(right.prerelease.length, left.prerelease.length);
  }
  for (const [index, part] of left.prerelease.entries()) {
    const other = right.prerelease[index];
    if (other === undefined) {
      return higher;
    }
    const difference = compareIdentifiers(part, other);
    if (difference !== equalPrecedence) {
      return difference;
    }
  }
  return compareOrdered(left.prerelease.length, right.prerelease.length);
}

/** SemVer precedence: below zero when `left` is lower, zero when equal, above zero when higher. */
function compareVersions(left: Version, right: Version): number {
  const core = compareCore(left, right);
  return core === equalPrecedence ? comparePrerelease(left, right) : core;
}

export type { Version };
export {
  channelOf,
  compareVersions,
  equalPrecedence,
  isChannelName,
  parseVersion,
  versionOfArgument,
  versionOfTag,
};
