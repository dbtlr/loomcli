import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { platformPackageDescription } from '../commands/build/messages.js';
import { npmLauncher } from '../content/npm-launcher.js';
import { bunWrite, staged } from './build.js';
import type { BuildOutcome, BuildPlan } from './build.js';
import { npmPlatforms } from './loom-config.js';
import type { NpmPlatform } from './loom-config.js';
import type { RunHost } from './run-host.js';

/** The mode of a package's `bin/<name>`, which runs as a program. */
const programMode = 0o755;

/**
 * The fields the launcher package copies from the author's `package.json` after its version, in
 * the order it writes them, each only when present.
 */
const launcherCopies = [
  'description',
  'keywords',
  'homepage',
  'bugs',
  'license',
  'author',
  'repository',
] as const;

/** The fields a platform package copies after its description, each only when present. */
const platformCopies = ['license', 'repository'] as const;

/** A file npm packs from every package directory whatever `files` says: a license. */
const licenseFile = /^licen[cs]e/iu;

/** A file npm packs from every package directory whatever `files` says: a readme. */
const readmeFile = /^readme/iu;

/** One platform package's binary: the platform, and the compile that writes it. */
interface NpmBinary {
  readonly plan: BuildPlan;
  readonly platform: NpmPlatform;
}

/**
 * One `loom build --target npm`, every path absolute: the package directory, the directory the
 * packages go into, the author's `package.json` as written, the launcher package's name and
 * version, the application's name, and one binary per written platform, in the order of the six.
 */
interface NpmPlan {
  readonly binaries: readonly NpmBinary[];
  readonly directory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly out: string;
  readonly pkg: string;
  readonly version: string;
}

/** A package name without its scope, which names its directory: `notes` for `@acme/notes`. */
function packageDirectoryName(pkg: string): string {
  return pkg.replace(/^@[^/]+\//u, '');
}

/** The fields of `keys` the author's `package.json` holds, in the order of `keys`, as written. */
function copiedFields(
  manifest: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): [string, unknown][] {
  return keys.flatMap((key): [string, unknown][] =>
    Object.hasOwn(manifest, key) && manifest[key] !== undefined ? [[key, manifest[key]]] : [],
  );
}

/**
 * A `package.json` from its fields in the order given, with two-space indentation and a final
 * newline. The fields are entries rather than an object literal, because their order is the
 * contract that golden files pin.
 */
function packageJson(fields: readonly [string, unknown][]): string {
  return `${JSON.stringify(Object.fromEntries(fields), undefined, 2)}\n`;
}

/** The launcher package's `package.json`, under ADR-0213. */
function launcherManifest(plan: NpmPlan): string {
  const { manifest, name, pkg, version } = plan;
  return packageJson([
    ['name', pkg],
    ['version', version],
    ...copiedFields(manifest, launcherCopies),
    ['bin', Object.fromEntries([[name, `bin/${name}`]])],
    ['files', ['bin']],
    [
      'optionalDependencies',
      Object.fromEntries(plan.binaries.map(({ platform }) => [`${pkg}-${platform}`, version])),
    ],
    ...copiedFields(manifest, ['publishConfig']),
  ]);
}

/**
 * A platform package's `package.json`, under ADR-0213: its exact `os` and `cpu`, and on Linux its
 * `libc`, so a package manager installs only the one that matches the host.
 */
function platformManifest(plan: NpmPlan, platform: NpmPlatform): string {
  const { manifest, pkg, version } = plan;
  const [os = '', cpu = '', variant] = platform.split('-');
  const libc: [string, unknown][] =
    os === 'linux' ? [['libc', [variant === 'musl' ? 'musl' : 'glibc']]] : [];
  return packageJson([
    ['name', `${pkg}-${platform}`],
    ['version', version],
    ['description', platformPackageDescription(platform, pkg)],
    ...copiedFields(manifest, platformCopies),
    ['os', [os]],
    ['cpu', [cpu]],
    ...libc,
    ['files', ['bin']],
    ['preferUnplugged', true],
    ...copiedFields(manifest, ['publishConfig']),
  ]);
}

/**
 * Copies the package directory's files whose names match into a package, unchanged, in name order.
 * Only files at the top of the directory count, as npm packs them.
 */
function copyAlwaysPacked(directory: string, target: string, patterns: readonly RegExp[]) {
  const names = readdirSync(directory)
    .filter((name) => patterns.some((pattern) => pattern.test(name)))
    .filter((name) => statSync(join(directory, name), { throwIfNoEntry: false })?.isFile())
    .toSorted();
  for (const name of names) {
    copyFileSync(join(directory, name), join(target, name));
  }
}

/** Writes a package's `package.json` and its `bin/<name>`, mode 755, under `root`. */
function writePackage(root: string, manifest: string, name: string) {
  writeFileSync(join(root, 'package.json'), manifest);
  chmodSync(join(root, 'bin', name), programMode);
}

/**
 * Whether a build may replace or remove the folder at `path`: it is absent, or it is a directory,
 * read without following a link, whose `package.json` names `name`, the package the build writes
 * there. Any other entry, such as an author's folder in a shared output directory, is not the
 * build's to touch.
 */
function mayReplace(path: string, name: string): boolean {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (entry === undefined) {
    return true;
  }
  if (!entry.isDirectory()) {
    return false;
  }
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    return (
      typeof manifest === 'object' && manifest !== null && Reflect.get(manifest, 'name') === name
    );
  } catch {
    // A folder with no package.json, or one that does not parse, is no package the build wrote.
    return false;
  }
}

/** A folder a build writes in the output directory, and the name of the package it holds. */
interface PackageFolder {
  readonly name: string;
  readonly path: string;
}

/**
 * Each folder a build writes in the output directory: one per listed platform, then the
 * launcher's.
 */
function writtenFolders(
  out: string,
  pkg: string,
  platforms: readonly NpmPlatform[],
): PackageFolder[] {
  const base = packageDirectoryName(pkg);
  return [
    ...platforms.map((platform) => ({
      name: `${pkg}-${platform}`,
      path: join(out, `${base}-${platform}`),
    })),
    { name: pkg, path: join(out, base) },
  ];
}

/**
 * The first folder a build would write that it may not replace, under ADR-0213, so the build fails
 * before it compiles rather than replace a folder it did not write.
 */
function unownedFolder(
  out: string,
  pkg: string,
  platforms: readonly NpmPlatform[],
): PackageFolder | undefined {
  return writtenFolders(out, pkg, platforms).find(({ name, path }) => !mayReplace(path, name));
}

/** Replaces a directory whole with the one written for it in the temporary directory. */
function replaceDirectory(from: string, target: string) {
  rmSync(target, { force: true, recursive: true });
  renameSync(from, target);
}

/**
 * Removes a platform package a build no longer writes, only when the build may replace it: a
 * directory, read without following a link, whose `package.json` names that platform package. A
 * file or a link of the package's name, and a folder the build did not write, stays as it is.
 */
function removeDroppedPackage(path: string, name: string) {
  if (lstatSync(path, { throwIfNoEntry: false }) !== undefined && mayReplace(path, name)) {
    rmSync(path, { recursive: true });
  }
}

/**
 * Moves the staged packages into place in a fixed order: every platform package first, then the
 * launcher package, then the removal of each platform package a build no longer writes. A move cut
 * short leaves new platform packages beside the old launcher, which pins only what it was built
 * with, and never a new launcher beside an old platform package.
 */
function moveIntoPlace(plan: NpmPlan, staging: string) {
  const base = packageDirectoryName(plan.pkg);
  const written = new Set(plan.binaries.map(({ platform }) => platform));
  for (const platform of written) {
    replaceDirectory(join(staging, `${base}-${platform}`), join(plan.out, `${base}-${platform}`));
  }
  replaceDirectory(join(staging, base), join(plan.out, base));
  for (const platform of npmPlatforms.filter((each) => !written.has(each))) {
    removeDroppedPackage(join(plan.out, `${base}-${platform}`), `${plan.pkg}-${platform}`);
  }
}

/**
 * Writes the launcher package and one platform package per binary into the plan's directory,
 * under ADR-0213. Every binary compiles in the temporary directory every build uses, each in a
 * working directory of its own, and every package is written there, so the set moves into place
 * only once all of it succeeded, and a failed or cancelled build leaves the earlier set as it was.
 */
async function buildNpm(plan: NpmPlan, run: RunHost): Promise<BuildOutcome> {
  const base = packageDirectoryName(plan.pkg);
  const outcome = await staged(plan.out, run, async (staging) => {
    const packages = join(staging, 'packages');
    let uncarriedSkillsPlugin = false;
    for (const binary of plan.binaries) {
      const root = join(packages, `${base}-${binary.platform}`);
      const work = join(staging, `bun-${binary.platform}`);
      mkdirSync(join(root, 'bin'), { recursive: true });
      mkdirSync(work);
      const wrote = await bunWrite(binary.plan, work, join(root, 'bin', plan.name), run);
      if (wrote === undefined) {
        return undefined;
      }
      uncarriedSkillsPlugin ||= wrote.uncarriedSkillsPlugin;
      writePackage(root, platformManifest(plan, binary.platform), plan.name);
      copyAlwaysPacked(plan.directory, root, [licenseFile]);
    }
    const launcher = join(packages, base);
    mkdirSync(join(launcher, 'bin'), { recursive: true });
    writeFileSync(
      join(launcher, 'bin', plan.name),
      npmLauncher({
        name: plan.name,
        pkg: plan.pkg,
        platforms: plan.binaries.map(({ platform }) => platform),
        version: plan.version,
      }),
    );
    writePackage(launcher, launcherManifest(plan), plan.name);
    copyAlwaysPacked(plan.directory, launcher, [readmeFile, licenseFile]);
    moveIntoPlace(plan, packages);
    return { uncarriedSkillsPlugin };
  });
  return outcome ?? { uncarriedSkillsPlugin: false };
}

export type { NpmBinary, NpmPlan };
export { buildNpm, launcherManifest, packageDirectoryName, platformManifest, unownedFolder };
