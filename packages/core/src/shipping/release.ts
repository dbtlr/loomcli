import { invalidReleaseFacts } from '../diagnostics/rules.js';
import { InternalError } from '../failures/errors.js';
import { quoted } from '../failures/wording.js';
import { isPlainObject } from '../support/plain.js';
import { readInstallation } from './installation.js';
import type { InstallationLookup } from './installation.js';
import type { ReleaseFacts } from './types.js';

/**
 * The identifier the build replaces with the release facts through a bundler `define`. Nothing
 * declares it at run time, so a run of the source reads it as absent through `typeof`.
 */
declare const __LOOM_RELEASE__: unknown;

/** The release group of the facts, which a baked value carries without its channel. */
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

/** The repository, asset, and npm package name, or the defect the first malformed one is. */
function releaseSource(
  repository: unknown,
  asset: unknown,
  npmPackage: unknown,
): { source: Omit<ReleaseGroup, 'channel' | 'version'> } | { failure: InternalError } {
  if (typeof repository !== 'string' || !ownerName.test(repository)) {
    return malformed(heldMember('repository', repository));
  }
  if (asset !== undefined && (typeof asset !== 'string' || asset === '')) {
    return malformed(heldMember('asset', asset));
  }
  if (npmPackage !== undefined && (typeof npmPackage !== 'string' || npmPackage === '')) {
    return malformed(heldMember('npmPackage', npmPackage));
  }
  return {
    source: {
      ...(asset === undefined ? {} : { asset }),
      ...(npmPackage === undefined ? {} : { npmPackage }),
      repository,
    },
  };
}

/**
 * The release channel a semantic version reads: its first prerelease identifier, or `stable` when
 * it has none. A value that is not a semantic version reads no release channel.
 */
function channelOf(version: unknown): string | undefined {
  const parsed = typeof version === 'string' ? semanticVersion.exec(version) : undefined;
  return parsed ? (parsed.groups?.prerelease?.split('.')[0] ?? 'stable') : undefined;
}

/** The release group of a baked value, frozen with its known members and the channel core derives. */
function releaseGroup(value: unknown): { group: ReleaseGroup } | { failure: InternalError } {
  if (!isPlainObject(value)) {
    return malformed('hold a release that is not an object');
  }
  const { asset, npmPackage, repository, version } = value;
  const channel = channelOf(version);
  if (typeof version !== 'string' || channel === undefined) {
    return malformed(heldMember('version', version));
  }
  const read = releaseSource(repository, asset, npmPackage);
  return 'failure' in read ? read : { group: Object.freeze({ ...read.source, channel, version }) };
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
  const { build, compiled, release } = value;
  if (build !== 'source' && build !== 'development' && build !== 'distributed') {
    return malformed(build === undefined ? 'hold no build' : `hold build ${quoted(build)}`);
  }
  if (compiled !== undefined && compiled !== true) {
    return malformed(`hold compiled ${quoted(compiled)}`);
  }
  return withRelease(build, release);
}

/** The facts of one baked build and its release group, or the defect a malformed group is. */
function withRelease(build: ReleaseFacts['build'], release: unknown): CapturedRelease {
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
 * Whether the build baked `compiled: true`, which marks a compiled binary, the whole program. The
 * release facts never repeat it. A value core cannot read marks none, and the run reports it as
 * malformed release facts unless a supplied `release` replaced them.
 */
function isCompiled(): boolean {
  if (typeof __LOOM_RELEASE__ === 'undefined') {
    return false;
  }
  const baked: unknown = __LOOM_RELEASE__;
  return isPlainObject(baked) && baked.compiled === true;
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

/** The runtime paths a release can use to find its installation. */
interface ApplicationPaths {
  readonly executable: string;
  readonly script: string | undefined;
}

/** The baked facts with the installation of the running artifact, when core can identify it. */
function withInstallation(
  facts: ReleaseFacts,
  lookup: InstallationLookup,
  paths: ApplicationPaths,
): ReleaseFacts {
  if (facts.release === undefined) {
    return facts;
  }
  const hasAsset = facts.release.asset !== undefined;
  const path = hasAsset || isCompiled() ? paths.executable : paths.script;
  const installation = readInstallation(lookup, path, hasAsset);
  return installation === undefined ? facts : Object.freeze({ ...facts, installation });
}

/** The baked release facts and installation a handle reads once per run. */
function captureRelease(lookup: InstallationLookup, paths: ApplicationPaths): CapturedRelease {
  const read = readBaked();
  return 'failure' in read ? read : { facts: withInstallation(read.facts, lookup, paths) };
}

/**
 * Whether one run's facts make it a development build: any build but `distributed`. A supplied
 * `release` is taken as given, so facts core cannot read, like malformed baked facts, leave the build unknown,
 * and the author reads their defect.
 */
function isDevelopment(release: unknown): boolean {
  return !isPlainObject(release) || release.build !== 'distributed';
}

export type { CapturedRelease };
export { bakedFacts, captureRelease, isCompiled, isDevelopment };
