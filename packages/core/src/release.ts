import { InternalError, quoted } from './errors.js';
import { isPlainObject } from './plain.js';
import { invalidReleaseFacts } from './rules.js';
import type { ReleaseFacts } from './types.js';

/**
 * The identifier the build replaces with the release facts through a bundler `define`. Nothing
 * declares it at run time, so a run of the source reads it as absent through `typeof`.
 */
declare const __LOOM_RELEASE__: unknown;

/** The release group of the facts, which a baked value carries without its lane. */
type ReleaseGroup = NonNullable<ReleaseFacts['release']>;

/** The release facts one read found, or the defect a malformed baked value is in their place. */
type CapturedRelease = { readonly facts: ReleaseFacts } | { readonly failure: InternalError };

/** The facts of a run with nothing baked in: the source run, or a bundle built without the define. */
const sourceFacts: ReleaseFacts = Object.freeze({ build: 'source' });

/** A semantic version, its prerelease identifiers captured, as semver.org's grammar states it. */
const semanticVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*))*))?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/u;

/** A repository as `owner/name`. */
const ownerName = /^[\w.-]+\/[\w.-]+$/u;

/** The defect a malformed baked value is, its sentence naming what is wrong after the subject. */
function malformed(found: string): { failure: InternalError } {
  return {
    failure: new InternalError(invalidReleaseFacts, {
      cause: undefined,
      correction: 'Rebuild with loom build, or compose the define from loom build --define.',
      sentence: `The release facts baked into __LOOM_RELEASE__ ${found}.`,
    }),
  };
}

/** What one member of the release group holds, for a sentence: its value, or that it has none. */
function heldMember(name: string, value: unknown): string {
  return value === undefined
    ? `hold a release with no ${name}`
    : `hold release ${name} ${quoted(value)}`;
}

/** The repository and the asset of a release group, or the defect the first malformed one is. */
function releaseSource(
  repository: unknown,
  asset: unknown,
): { source: Omit<ReleaseGroup, 'lane' | 'version'> } | { failure: InternalError } {
  if (typeof repository !== 'string' || !ownerName.test(repository)) {
    return malformed(heldMember('repository', repository));
  }
  if (asset === undefined) {
    return { source: { repository } };
  }
  if (typeof asset !== 'string' || asset === '') {
    return malformed(heldMember('asset', asset));
  }
  return { source: { asset, repository } };
}

/**
 * The lane a semantic version reads: its first prerelease identifier, or `stable` when it has none.
 * A value that is not a semantic version reads no lane.
 */
function laneOf(version: unknown): string | undefined {
  const parsed = typeof version === 'string' ? semanticVersion.exec(version) : undefined;
  return parsed ? (parsed.groups?.prerelease?.split('.')[0] ?? 'stable') : undefined;
}

/** The release group of a baked value, frozen with its known members and the lane core derives. */
function releaseGroup(value: unknown): { group: ReleaseGroup } | { failure: InternalError } {
  if (!isPlainObject(value)) {
    return malformed('hold a release that is not an object');
  }
  const { asset, repository, version } = value;
  const lane = laneOf(version);
  if (typeof version !== 'string' || lane === undefined) {
    return malformed(heldMember('version', version));
  }
  const read = releaseSource(repository, asset);
  return 'failure' in read ? read : { group: Object.freeze({ ...read.source, lane, version }) };
}

/**
 * The release facts one baked value says, frozen with the known members alone, so a later
 * toolchain can bake more facts under this core. A malformed value is the `invalid-release-facts`
 * defect, whose sentence names the member at fault.
 */
function readFacts(value: unknown): CapturedRelease {
  if (!isPlainObject(value)) {
    return malformed('are not an object');
  }
  const { build, release } = value;
  if (build !== 'source' && build !== 'development' && build !== 'distributed') {
    return malformed(build === undefined ? 'hold no build' : `hold build ${quoted(build)}`);
  }
  if (release === undefined) {
    return { facts: Object.freeze({ build }) };
  }
  const read = releaseGroup(release);
  return 'failure' in read ? read : { facts: Object.freeze({ build, release: read.group }) };
}

/** The release facts the build baked into this artifact, read afresh, or the source's own. */
function readBaked(): CapturedRelease {
  return typeof __LOOM_RELEASE__ === 'undefined'
    ? { facts: sourceFacts }
    : readFacts(__LOOM_RELEASE__);
}

/**
 * The release facts `inspect()` learns its build from, because it takes no host. A malformed baked
 * value throws the `invalid-release-facts` defect.
 */
function bakedFacts(): ReleaseFacts {
  const read = readBaked();
  if ('failure' in read) {
    throw read.failure;
  }
  return read.facts;
}

/**
 * The one step `run()` and `app.invoke` read the release facts through, once per run, beside the
 * working directory. An override replaces the whole field and is taken as given, so no baked value
 * is read.
 */
function captureRelease(override: ReleaseFacts | undefined): CapturedRelease {
  return override === undefined ? readBaked() : { facts: override };
}

/** Whether one run's facts make it a development build: any build but `distributed`. */
function isDevelopment(release: ReleaseFacts): boolean {
  return release.build !== 'distributed';
}

export type { CapturedRelease };
export { bakedFacts, captureRelease, isDevelopment };
