import { z } from 'zod';

import { isWindows } from './build-target.js';
import type { BuildTarget } from './build-target.js';
import { withoutByteOrderMark } from './markdown.js';
import { readRegularFile } from './repository.js';

/** A semantic version, as semver.org's grammar states it and core reads it. */
const semanticVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*))*)?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/u;

/**
 * The `owner/name` a `repository` field's address names: the npm shorthands `owner/name` and
 * `github:owner/name`, or the path of a URL or an SSH address without its host, `.git`, or a
 * trailing slash. A path of more or fewer than two segments, such as a nested group or a path below
 * the repository, names no `owner/name`.
 */
function repositoryFromAddress(address: string): string | undefined {
  const shorthand = /^(?:(?:github|gitlab|bitbucket):)?(?<path>[\w.-]+\/[\w.-]+)$/u.exec(address);
  if (shorthand?.groups?.path !== undefined) {
    return shorthand.groups.path.replace(/\.git$/u, '');
  }
  const remote = /^(?:[\w+.-]+:\/\/[^/]+\/|[\w.-]+@[^:/]+:)(?<path>.+?)(?:\.git)?\/?$/u.exec(
    address,
  );
  const repository = remote?.groups?.path;
  return repository !== undefined && ownerName.test(repository) ? repository : undefined;
}

/** The repository a release names: `--repository`, else the `package.json` `repository` field. */
function releaseRepository(manifest: Manifest, option: string | undefined): string {
  if (option !== undefined) {
    return option;
  }
  const field = manifest.repository;
  if (field === undefined) {
    throw new Error(
      'package.json has no repository field, so pass --repository <owner/name> to name the repository the release belongs to.',
    );
  }
  const address = z.union([z.string(), z.object({ url: z.string() })]).safeParse(field).data;
  const repository = repositoryFromAddress(
    typeof address === 'string' ? address : (address?.url ?? ''),
  );
  if (repository === undefined) {
    throw new Error(
      'The package.json repository field does not read as owner/name, so pass --repository <owner/name>.',
    );
  }
  return repository;
}

/** The version a release names: the `package.json` `version` field, a semantic version. */
function releaseVersion(manifest: Manifest): string {
  const { version } = manifest;
  if (version === undefined) {
    throw new Error('package.json has no version field, so set version to build a release.');
  }
  if (typeof version !== 'string' || !semanticVersion.test(version)) {
    throw new Error(
      `The package.json version field ${JSON.stringify(version)} is not a semantic version, so set it to one, such as 1.0.0.`,
    );
  }
  return version;
}

/** The build an artifact reads: a development artifact or a distributed one. */
export type Build = 'development' | 'distributed';

/**
 * The release facts a build bakes into `__LOOM_RELEASE__`, in the shape core reads. Core derives
 * the lane from the version, so the build never bakes it.
 */
export interface BuildFacts {
  readonly build: Build;
  readonly release?: {
    readonly asset?: string;
    readonly repository: string;
    readonly version: string;
  };
}

/** The standard `package.json` fields a build reads, each as the file holds it. */
export interface Manifest {
  readonly bin: unknown;
  readonly name: unknown;
  readonly repository: unknown;
  readonly version: unknown;
}

/** What a build asks of the facts: the build, the target, and the release options when given. */
export interface FactsRequest {
  readonly build: Build;
  readonly manifest: Manifest;
  readonly name: string | undefined;
  readonly release: { readonly repository: string | undefined } | undefined;
  readonly target: BuildTarget;
}

/** A repository as `owner/name`, as core reads it. */
export const ownerName = /^[\w.-]+\/[\w.-]+$/u;

/**
 * The application's name, which a binary's default path and its asset name carry: `--name`, else
 * the key of an object `bin` with one key, else the package name without its scope for a string
 * `bin`. Without one, a build that needs the name fails and names `--name`.
 */
export function applicationName(manifest: Manifest, option: string | undefined): string {
  if (option !== undefined) {
    return option;
  }
  const { bin, name } = manifest;
  const keys = typeof bin === 'object' && bin !== null ? Object.keys(bin) : [];
  if (keys.length === 1 && keys[0] !== undefined) {
    return keys[0];
  }
  if (typeof bin === 'string' && typeof name === 'string' && name !== '') {
    return name.replace(/^@[^/]+\//u, '');
  }
  throw new Error(
    'package.json names no application in bin, a string or an object with one key, so pass --name <name>.',
  );
}

/**
 * The release facts one build bakes, computed from its options and the package's `package.json`
 * alone. `loom build` bakes them, and `--facts` and `--define` print them, so every build of the
 * same options reads the same facts.
 */
export function buildFacts(request: FactsRequest): BuildFacts {
  const { build, manifest, release, target } = request;
  if (release === undefined) {
    return { build };
  }
  const version = releaseVersion(manifest);
  const repository = releaseRepository(manifest, release.repository);
  if (target.kind === 'bundle') {
    return { build, release: { repository, version } };
  }
  const asset = `${applicationName(manifest, request.name)}-${target.platform}${isWindows(target) ? '.exe' : ''}`;
  return { build, release: { asset, repository, version } };
}

/** The define pair a bundler takes, `__LOOM_RELEASE__=<json>`, for the facts it bakes. */
export function definePair(facts: BuildFacts): string {
  return `__LOOM_RELEASE__=${JSON.stringify(facts)}`;
}

/** Reads the standard fields of the `package.json` in a package directory. */
export function readManifest(directory: string): Manifest {
  let document: unknown = undefined;
  try {
    document = JSON.parse(withoutByteOrderMark(readRegularFile(directory, 'package.json')));
  } catch (error) {
    throw new Error('package.json: expected valid JSON.', { cause: error });
  }
  const parsed = z.record(z.string(), z.unknown()).safeParse(document);
  if (!parsed.success) {
    throw new Error('package.json: expected a JSON object.');
  }
  const { bin, name, repository, version } = parsed.data;
  return { bin, name, repository, version };
}
