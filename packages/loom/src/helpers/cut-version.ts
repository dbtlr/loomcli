import type { FragmentKind } from './fragments.js';
import { releaseVersions } from './markdown.js';
import {
  compareReleases,
  compareSemVer,
  nextVersion,
  parseSemVer,
  parseVersion,
} from './version.js';
import type { SemVer, Version } from './version.js';

const zero: Version = { major: 0, minor: 0, patch: 0, text: '0.0.0' };

// The version a cut without a target takes.
function finalVersion(current: SemVer, minimum: Version): SemVer {
  if (current.prerelease.length === 0) {
    return { prerelease: [], release: minimum, text: minimum.text };
  }
  if (compareReleases(current.release, minimum) < 0) {
    throw new Error(
      `The pending fragments need at least ${minimum.text}, which is above ${current.release.text}, the release of ${current.text}, so pass --target ${minimum.text} or a higher version.`,
    );
  }
  return { prerelease: [], release: current.release, text: current.release.text };
}

/**
 * The package's last release under ADR-0132: its version when stable. While the version is a
 * prerelease, the highest version among the changelog's release sections, or `0.0.0` when the
 * changelog is missing or holds none.
 */
export function lastRelease(current: SemVer, changelog: string | undefined): Version {
  if (current.prerelease.length === 0) {
    return current.release;
  }
  const highest = releaseVersions(changelog ?? '')
    .toSorted(compareReleases)
    .at(-1);
  return highest ?? zero;
}

/**
 * The fragment minimum: the version the bump table gives from the last release and the highest
 * pending kind.
 */
export function fragmentMinimum(last: Version, highest: FragmentKind | undefined): Version {
  const minimum = parseVersion(nextVersion(last, highest));
  if (minimum === undefined) {
    throw new Error(`The version ${last.text} cannot advance.`);
  }
  return minimum;
}

/**
 * The version a cut takes. Without a target, a stable version advances to the minimum and a
 * prerelease finalizes to its release part when that meets the minimum. A target must be in the
 * target form, rank above the current version, and have a release part at or above the minimum.
 * Every refusal names the minimum.
 */
export function chooseVersion(
  current: SemVer,
  minimum: Version,
  target: string | undefined,
): SemVer {
  if (target === undefined) {
    return finalVersion(current, minimum);
  }
  const chosen = parseSemVer(target);
  if (chosen === undefined) {
    throw new Error(
      `Target ${JSON.stringify(target)} is not MAJOR.MINOR.PATCH with an optional -prerelease part, such as 1.2.0 or 1.2.0-rc.1, and the version must be at least ${minimum.text}.`,
    );
  }
  if (compareSemVer(chosen, current) <= 0) {
    throw new Error(
      `Target ${target} must rank above the current version ${current.text} and be at least ${minimum.text}, the least version the pending fragments allow.`,
    );
  }
  if (compareReleases(chosen.release, minimum) < 0) {
    throw new Error(
      `Target ${target} must be at least ${minimum.text}, the least version the pending fragments allow; the current version is ${current.text}.`,
    );
  }
  return chosen;
}

/**
 * Refuses a prerelease cut from a stable version other than `0.0.0` whose release section the
 * changelog lacks, because once the version is a prerelease that section is how the cut finds its
 * last release.
 */
export function requireReleaseSection(
  current: SemVer,
  changelog: string | undefined,
  file: string,
) {
  if (current.prerelease.length > 0 || current.text === zero.text) {
    return;
  }
  if (!releaseVersions(changelog ?? '').some((version) => version.text === current.text)) {
    throw new Error(
      `A prerelease cut needs ${file} to hold the v${current.text} release section, because the prerelease reads its last release there, so cut a stable release first or add the section.`,
    );
  }
}
