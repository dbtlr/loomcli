import { join, relative, resolve, sep } from 'node:path';

import { configuration } from '@loomcli/plugins/config';
import {
  array,
  boolean,
  check,
  checkItems,
  forward,
  minLength,
  object,
  optional,
  picklist,
  pipe,
  rawTransform,
  safeParse,
  string,
  tupleWithRest,
  unknown,
} from 'valibot';
import type { InferOutput } from 'valibot';

import { conventionalChangelog, conventionalFragments } from './conventions.js';
import { notAWordList, platformsNeedLauncher, repeatedPlatform } from './messages.js';

/**
 * One path the configuration file names. An empty string or a value of another type is an issue at
 * its own key, which fails the run under the bin's `strict: true`.
 */
const pathValue = optional(pipe(string(), minLength(1)));

/** The post-install command's words, which hold at least one. */
const postInstallWordList = tupleWithRest([string()], string());

/**
 * The words, checked as one value: a rejected list is one issue at `command` rather than at an
 * item, so the failure names the whole command rather than one of its words.
 */
const postInstallWords = pipe(
  unknown(),
  rawTransform(({ addIssue, dataset, NEVER }) => {
    const words = safeParse(postInstallWordList, dataset.value);
    if (words.success) {
      return words.output;
    }
    addIssue({ message: notAWordList });
    return NEVER;
  }),
);

/**
 * What the installer script does after it installs and records the binary, under ADR-0131:
 * `command` is the words it runs the installed binary with, and `message` the text it prints last.
 */
const postInstall = object({
  command: optional(postInstallWords),
  message: optional(string()),
});

/**
 * The six release asset platforms, which name the platform packages `loom build --target npm`
 * writes, in the order the launcher package lists them, under ADR-0213.
 */
const npmPlatforms = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-arm64-musl',
  'linux-x64',
  'linux-x64-musl',
] as const;

/** A nonempty list of release asset platforms, each named once. */
const platformList = pipe(
  array(picklist(npmPlatforms)),
  minLength(1),
  checkItems((item, index, items) => items.indexOf(item) === index, repeatedPlatform),
);

/** The keys of the `npm` object, each optional. */
const npmFields = object({ launcher: optional(boolean()), platforms: optional(platformList) });

/**
 * The npm launcher packages' opt-in, under ADR-0213: `launcher` turns the mode on, and `platforms`
 * names the platform packages, each of the six once. A list without `launcher: true` is an issue at
 * `platforms`, so the run fails rather than ignore a list that turns nothing on.
 */
const npmSettings = pipe(
  npmFields,
  forward(
    check(
      (settings) => settings.platforms === undefined || settings.launcher === true,
      platformsNeedLauncher,
    ),
    ['platforms'],
  ),
);

/**
 * The schema of `loom.config.json`. Every key is optional, and valibot's `object` strips a key it
 * does not describe, so an unknown key is ignored. The file names no skills folder, which the
 * skills plugin's `folder` setting names. `sharedVersion` passes through as written, and
 * `loom changelog write` checks it as one value and fails on a malformed one.
 */
const loomConfigSchema = object({
  npm: optional(npmSettings),
  paths: optional(
    object({
      application: pathValue,
      changelog: pathValue,
      changes: pathValue,
      entry: pathValue,
      installer: pathValue,
      out: pathValue,
      source: pathValue,
    }),
  ),
  postInstall: optional(postInstall),
  sharedVersion: optional(unknown()),
});

/** Every key of `paths`. */
const pathKeys = [
  'application',
  'changelog',
  'changes',
  'entry',
  'installer',
  'out',
  'source',
] as const satisfies readonly PathKey[];

/** The validated contents of `loom.config.json`, as `provided.config` holds them. */
export type LoomConfig = InferOutput<typeof loomConfigSchema>;

/**
 * The configuration plugin the `loom` bin installs and the provider a command opts in to. The bin
 * reads `loom.config.json` from the working directory up to the package directory and never above
 * it, so a package in a monorepo never reads the root's file as its own. It reads under
 * `strict: true`, under ADR-0158: a file that cannot be used, and a value the schema rejects, fail
 * the command with code 2, so neither leaves a CI run on conventions. An unknown key, such as a
 * misspelled one, is still ignored.
 */
export const { plugin: loomConfigPlugin, values: loomConfig } = configuration({
  file: 'loom.config.json',
  root: 'package.json',
  schema: loomConfigSchema,
  scopes: ['project'],
  strict: true,
});

/** The post-install declaration of `loom.config.json`, which `loom init` renders into `install.sh`. */
export type PostInstall = NonNullable<LoomConfig['postInstall']>;

/** A key of the configuration file's `paths`. */
export type PathKey = keyof NonNullable<LoomConfig['paths']>;

/**
 * Every path the bin owns, absolute, and the keys the file set itself. A module the file names
 * follows the option's rule rather than the convention's, so a command reads `configured` to tell
 * the two apart.
 */
export interface PackagePaths {
  readonly application: string;
  readonly changelog: string;
  readonly changes: string;
  readonly configured: ReadonlySet<PathKey>;
  readonly entry: string;
  readonly installer: string;
  readonly out: string;
  readonly source: string;
}

/**
 * Resolves the file's paths against the package directory, whichever directory the file sits in,
 * filling each missing key with its convention. An absolute path stays as written, and a relative
 * one may leave the package directory. `application` and `entry` follow `source` unless set
 * themselves. An empty configuration gives every convention.
 */
export function packagePaths(directory: string, config: LoomConfig): PackagePaths {
  const paths = config.paths ?? {};
  const at = (path: string) => resolve(directory, path);
  const source = at(paths.source ?? 'src');
  return {
    application:
      paths.application === undefined ? join(source, 'application.ts') : at(paths.application),
    changelog: at(paths.changelog ?? conventionalChangelog),
    changes: at(paths.changes ?? conventionalFragments),
    configured: new Set(pathKeys.filter((key) => paths[key] !== undefined)),
    entry: paths.entry === undefined ? join(source, 'main.ts') : at(paths.entry),
    installer: at(paths.installer ?? 'install.sh'),
    out: at(paths.out ?? 'dist'),
    source,
  };
}

/**
 * A path as the package names it: relative to the package directory, with `/` between segments,
 * and `.` for the directory itself. A path outside the directory starts with `..`.
 */
export function packageRelative(directory: string, path: string): string {
  return relative(directory, path).split(sep).join('/') || '.';
}

/**
 * The changelog and the fragment folder a package's changelog commands read, relative to the
 * package directory.
 */
export function changelogFiles(directory: string, paths: PackagePaths) {
  return {
    changelog: packageRelative(directory, paths.changelog),
    changes: packageRelative(directory, paths.changes),
  };
}

/** One release asset platform, such as `linux-x64-musl`. */
export type NpmPlatform = (typeof npmPlatforms)[number];

export { npmPlatforms };
