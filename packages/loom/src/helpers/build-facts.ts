import { join } from 'node:path';

import { object, safeParse, string, union } from 'valibot';

import type { BuildTarget } from './build-target.js';
import { parseManifest } from './manifest.js';
import { readWorkingFile } from './repository.js';

/** A semantic version, as semver.org's grammar states it and core reads it. */
const semanticVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*))*)?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/u;

/** The host each npm shorthand prefix names, and the host a bare `owner/name` names. */
const shorthandHosts: Readonly<Record<string, string>> = {
  '': 'github.com',
  bitbucket: 'bitbucket.org',
  github: 'github.com',
  gitlab: 'gitlab.com',
};

/** A repository address read apart: the host it names, in lower case, and its `owner/name`. */
interface RepositoryAddress {
  readonly host: string;
  readonly repository: string;
}

/**
 * The host and `owner/name` a `repository` field's address names: the npm shorthands `owner/name`
 * and `github:owner/name`, which name GitHub, `gitlab:` and `bitbucket:`, or the host and the path
 * of a URL or an SSH address without `.git` or a trailing slash. A URL's host may end with a port,
 * before a `/`, or with a `:` that opens the path, as `git+ssh://git@github.com:owner/name.git`
 * writes an SSH address inside a URL. A path of more or fewer than two segments, such as a nested
 * group or a path below the repository, names no `owner/name`.
 */
function addressOf(address: string): RepositoryAddress | undefined {
  const shorthand = /^(?:(?<prefix>github|gitlab|bitbucket):)?(?<path>[\w.-]+\/[\w.-]+)$/u.exec(
    address,
  )?.groups;
  if (shorthand?.path !== undefined) {
    return {
      host: shorthandHosts[shorthand.prefix ?? ''] ?? '',
      repository: shorthand.path.replace(/\.git$/u, ''),
    };
  }
  const remote =
    /^(?:[\w+.-]+:\/\/(?:[^@/]+@)?(?<urlHost>[^@/:]+)(?::\d+\/|:|\/)|[\w.-]+@(?<sshHost>[^:/]+):)(?<path>.+?)(?:\.git)?\/?$/u.exec(
      address,
    )?.groups;
  const host = remote?.urlHost ?? remote?.sshHost;
  const repository = remote?.path;
  return host !== undefined && repository !== undefined && ownerName.test(repository)
    ? { host: host.toLowerCase(), repository }
    : undefined;
}

const repositoryAddress = union([string(), object({ url: string() })]);

/**
 * The address a `package.json` `repository` field holds: the string itself, or the `url` of an
 * object, else `undefined` for a field that is missing or holds neither.
 */
function repositoryField(field: unknown): string | undefined {
  const parsed = safeParse(repositoryAddress, field);
  if (!parsed.success) {
    return undefined;
  }
  return typeof parsed.output === 'string' ? parsed.output : parsed.output.url;
}

/**
 * The key of a `bin` that is an object with exactly one key, which names the application. An array
 * is not one, so a `bin` of one path names nothing rather than an application called `0`.
 */
function singleBinKey(bin: unknown): string | undefined {
  const keys =
    typeof bin === 'object' && bin !== null && !Array.isArray(bin) ? Object.keys(bin) : [];
  return keys.length === 1 ? keys[0] : undefined;
}

/** A package name without its scope, so `@acme/notes` reads as `notes`, or `undefined` for none. */
function unscopedName(name: unknown): string | undefined {
  return typeof name === 'string' && name !== '' ? name.replace(/^@[^/]+\//u, '') : undefined;
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
  const repository = addressOf(repositoryField(field) ?? '')?.repository;
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

/** The release group one build bakes, computed from the package and the release options. */
function releaseGroup(
  request: FactsRequest,
  release: NonNullable<FactsRequest['release']>,
): NonNullable<BuildFacts['release']> {
  const { manifest, target } = request;
  const version = releaseVersion(manifest);
  const repository = releaseRepository(manifest, release.repository);
  if (target.kind === 'bundle') {
    return { repository, version };
  }
  const asset = `${applicationName(manifest, request.name)}-${target.platform}`;
  return { asset, repository, version };
}

/** The build an artifact reads: a development artifact or a distributed one. */
export type Build = 'development' | 'distributed';

/**
 * The release facts a build bakes into `__LOOM_RELEASE__`, in the shape core reads. Core derives
 * the release channel from the version, so the build never bakes it.
 */
export interface BuildFacts {
  readonly build: Build;
  /** Present on a compiled binary alone, so core knows the binary is the whole program. */
  readonly compiled?: true;
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
 * The GitHub repository a package names, as `owner/name`: its `package.json` `repository` field
 * read with the rule `loom build --release` uses, when the address names the host `github.com`.
 * A field that is missing, cannot be read, or names another host reads `undefined`.
 */
export function githubRepository(manifest: Manifest): string | undefined {
  const address = addressOf(repositoryField(manifest.repository) ?? '');
  return address?.host === 'github.com' ? address.repository : undefined;
}

/**
 * The application's name, which a binary's default path and its asset name carry: `--name`, else
 * the key of an object `bin` with one key, else the package name without its scope for a string
 * `bin`. Without one, a build that needs the name fails and names `--name`.
 */
export function applicationName(manifest: Manifest, option: string | undefined): string {
  const name =
    option ??
    singleBinKey(manifest.bin) ??
    (typeof manifest.bin === 'string' ? unscopedName(manifest.name) : undefined);
  if (name === undefined) {
    throw new Error(
      'package.json names no application in bin, a string or an object with one key, so pass --name <name>.',
    );
  }
  return name;
}

/**
 * The application's name `loom init` scaffolds with: the key of an object `bin` with one key, else
 * the package name without its scope. A package with neither fails and says to name it.
 */
export function scaffoldName(manifest: Manifest): string {
  const name = singleBinKey(manifest.bin) ?? unscopedName(manifest.name);
  if (name === undefined) {
    throw new Error(
      'package.json names no application in bin or name, so set its name field and run loom init again.',
    );
  }
  return name;
}

/**
 * The release facts one build bakes, computed from its options and the package's `package.json`
 * alone. A compile target bakes `compiled: true`, with or without a release. `loom build` bakes
 * them, and `--facts` and `--define` print them, so every build of the same options reads the same
 * facts.
 */
export function buildFacts(request: FactsRequest): BuildFacts {
  const { build, release, target } = request;
  const compiled: Pick<BuildFacts, 'compiled'> = target.kind === 'bundle' ? {} : { compiled: true };
  return release === undefined
    ? { build, ...compiled }
    : { build, ...compiled, release: releaseGroup(request, release) };
}

/** The define pair a bundler takes, `__LOOM_RELEASE__=<json>`, for the facts it bakes. */
export function definePair(facts: BuildFacts): string {
  return `__LOOM_RELEASE__=${JSON.stringify(facts)}`;
}

/** Reads the standard fields of a `package.json` source, the file at `path`. */
export function manifestOf(source: string, path: string): Manifest {
  const { bin, name, repository, version } = parseManifest(source, path);
  return { bin, name, repository, version };
}

/** Reads the standard fields of the `package.json` in a package directory. */
export function readManifest(directory: string): Manifest {
  return manifestOf(readWorkingFile(directory, 'package.json'), join(directory, 'package.json'));
}
