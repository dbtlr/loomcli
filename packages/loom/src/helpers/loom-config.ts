import { join, relative, resolve, sep } from 'node:path';

import { configuration } from '@loomcli/plugins/config';
import {
  minLength,
  object,
  optional,
  pipe,
  rawTransform,
  safeParse,
  string,
  tupleWithRest,
  unknown,
} from 'valibot';
import type { InferOutput } from 'valibot';

import { conventionalChangelog, conventionalFragments } from './conventions.js';

/**
 * One path the configuration file names. An empty string or a value of another type is an issue at
 * its own key, so the plugin drops that key alone and its convention applies.
 */
const pathValue = optional(pipe(string(), minLength(1)));

/** The post-install command's words, which hold at least one. */
const postInstallWordList = tupleWithRest([string()], string());

/**
 * The words, checked as one value: a rejected list is one issue at `command` rather than at an
 * item, so the configuration plugin drops the whole command instead of running the words that
 * remain.
 */
const postInstallWords = pipe(
  unknown(),
  rawTransform(({ addIssue, dataset, NEVER }) => {
    const words = safeParse(postInstallWordList, dataset.value);
    if (words.success) {
      return words.output;
    }
    addIssue({ message: 'Expected a non-empty array of strings' });
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
 * The schema of `loom.config.json`. Every key is optional, and valibot's `object` strips a key it
 * does not describe, so an unknown key is ignored. `skills` is read by no command yet.
 */
const loomConfigSchema = object({
  paths: optional(
    object({
      application: pathValue,
      changelog: pathValue,
      changes: pathValue,
      entry: pathValue,
      installer: pathValue,
      out: pathValue,
      skills: pathValue,
      source: pathValue,
    }),
  ),
  postInstall: optional(postInstall),
});

/** Every key of `paths`. */
const pathKeys = [
  'application',
  'changelog',
  'changes',
  'entry',
  'installer',
  'out',
  'skills',
  'source',
] as const satisfies readonly PathKey[];

/** The validated contents of `loom.config.json`, as `provided.config` holds them. */
export type LoomConfig = InferOutput<typeof loomConfigSchema>;

/**
 * The configuration plugin the `loom` bin installs and the provider a command opts in to. The bin
 * reads `loom.config.json` from the working directory up to the package directory and never above
 * it, so a package in a monorepo never reads the root's file as its own.
 */
export const { plugin: loomConfigPlugin, values: loomConfig } = configuration({
  file: 'loom.config.json',
  root: 'package.json',
  schema: loomConfigSchema,
  scopes: ['project'],
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
  readonly skills: string;
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
    skills: at(paths.skills ?? 'skills'),
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
