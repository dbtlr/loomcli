import { accessSync, constants, statSync } from 'node:fs';
import { basename, dirname, sep } from 'node:path';

import type { Host } from '@loomcli/core';

import { resolveLogFile } from './directory.js';
import { LoggingError } from './error.js';
import { writtenLevels } from './record.js';
import type { WrittenLevel } from './record.js';

/**
 * One file destination as the author declared it.
 *
 * @public
 */
interface DeclaredLogFile {
  /** The declared `file`: a name in the default directory, an absolute path, or a `~/` path. */
  readonly file?: string | undefined;
  /** The declared level, before the operator's level variable. */
  readonly level: WrittenLevel;
}

/**
 * The logging plugin's fact on the root Command: each file destination in declaration order, with
 * its `file` setting as declared, absent for the default name, and its `level`; and the names the
 * author gave the operator's two variables, absent for the name derived from the application and
 * `false` when the author turned the variable off. The plugin publishes it on every build.
 *
 * @public
 */
interface LoggingFilesFacts {
  /** Each file destination, in declaration order. Console destinations are not listed. */
  readonly files: readonly DeclaredLogFile[];
  /** The level variable's name, absent for the derived name, `false` when it is off. */
  readonly levelEnv?: string | false | undefined;
  /** The file variable's name, absent for the derived name, `false` when it is off. */
  readonly fileEnv?: string | false | undefined;
}

/**
 * One file destination as a run on a host writes it: the level it writes from, and its absolute
 * path, or the `LoggingError` that names the variable the host lacks to resolve it.
 *
 * @public
 */
type ResolvedLogFile =
  | { readonly level: WrittenLevel; readonly path: string }
  | { readonly level: WrittenLevel; readonly error: LoggingError };

/**
 * An operator variable the resolution could not use: its name and the value it held.
 *
 * @public
 */
interface RejectedLogVariable {
  /** The variable's name, such as `HEIMDALL_LOG_LEVEL`. */
  readonly variable: string;
  /** The value the variable held, as the host's environment holds it. */
  readonly value: string;
}

/**
 * The log files a run on a host writes, one per file destination in declaration order, and each
 * operator variable that held a value the resolution could not use and so left the author's
 * setting in place.
 *
 * @public
 */
interface ResolvedLogFiles {
  /** One entry per file destination, in declaration order. */
  readonly files: readonly ResolvedLogFile[];
  /** The level and the file variable when each held a value the resolution could not use. */
  readonly rejected: {
    readonly level?: RejectedLogVariable | undefined;
    readonly file?: RejectedLogVariable | undefined;
  };
}

/**
 * The host facts the resolution reads: the environment the variables and the default directory
 * come from, the home a `~/` path starts from, and the platform that picks the default directory.
 *
 * @public
 */
type LogFilesHost = Pick<Host, 'env' | 'home' | 'platform'>;

/** The prefix of the default variable names: the application's name uppercased, `_` for the rest. */
function variablePrefix(application: string): string {
  return application.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '_');
}

/** The variable a setting names: the default for `undefined`, none for `false`. */
function variableName(
  setting: string | false | undefined,
  application: string,
  suffix: string,
): string | undefined {
  if (setting === false) {
    return undefined;
  }
  return setting ?? `${variablePrefix(application)}_${suffix}`;
}

/** Checks one existing file, or walks up to the nearest existing directory, for a writable place. */
function writable(path: string, file: boolean): boolean {
  try {
    const stat = statSync(path);
    if (file ? stat.isDirectory() : !stat.isDirectory()) {
      return false;
    }
    accessSync(path, constants.W_OK);
    return true;
  } catch (error) {
    const parent = dirname(path);
    return (
      error instanceof Error &&
      Reflect.get(error, 'code') === 'ENOENT' &&
      parent !== path &&
      writable(parent, false)
    );
  }
}

/** Whether a path can receive an append, judged without creating the file or its directory. */
function appendable(path: string): boolean {
  return !path.includes('\0') && writable(path, true);
}

/** The operator's level, or the rejection of a value that names no written level. */
function operatorLevel(
  variable: string | undefined,
  env: LogFilesHost['env'],
): { level?: WrittenLevel; rejected?: RejectedLogVariable } {
  const value = variable === undefined ? undefined : env[variable];
  if (variable === undefined || value === undefined || value.trim() === '') {
    return {};
  }
  const normalized = value.trim().toLowerCase();
  const level = writtenLevels.find((candidate) => candidate === normalized);
  return level === undefined ? { rejected: { value, variable } } : { level };
}

/** The operator's file, resolved, or the rejection of a value that names no appendable file. */
function operatorFile(
  variable: string | undefined,
  context: { readonly application: string; readonly host: LogFilesHost },
): { path?: string; rejected?: RejectedLogVariable } {
  const value = variable === undefined ? undefined : context.host.env[variable];
  if (variable === undefined || value === undefined || value.trim() === '') {
    return {};
  }
  const directory = value.endsWith(sep) || value.endsWith('/') || basename(value) === '';
  const path = directory ? undefined : resolveLogFile(value, context.application, context.host);
  return typeof path === 'string' && appendable(path)
    ? { path }
    : { rejected: { value, variable } };
}

/**
 * The log files a run of `application` on `host` writes, one per file destination of the fact in
 * declaration order, with the operator's variables applied: the level variable sets every file's
 * level, and the file variable replaces the first file's path. A value either variable holds that
 * the resolution cannot use, a level outside `trace`, `debug`, `info`, `warn`, and `error`, or a
 * file that is unresolvable or cannot be appended to, is listed under `rejected` and leaves
 * the author's setting. A fact with no file reads neither variable. It creates no file or
 * directory. The logging plugin writes and names its files through this same function.
 *
 * @example
 * ```ts
 * import { readExtension } from '@loomcli/core';
 * import type { CommandGraph, Host } from '@loomcli/core';
 * import { loggingFiles, resolveLoggingFiles } from '@loomcli/plugins/logging/extension';
 *
 * export function logFilePaths(graph: CommandGraph, host: Host): string[] {
 *   const facts = readExtension(graph.root, loggingFiles);
 *   if (facts === undefined) {
 *     return [];
 *   }
 *   const { files } = resolveLoggingFiles(facts, { application: graph.name, host });
 *   return files.flatMap((file) => ('path' in file ? [file.path] : []));
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/logging.md
 *
 * @public
 */
function resolveLoggingFiles(
  facts: LoggingFilesFacts,
  context: { readonly application: string; readonly host: LogFilesHost },
): ResolvedLogFiles {
  const { application, host } = context;
  const [first, ...rest] = facts.files;
  if (first === undefined) {
    return { files: [], rejected: {} };
  }
  const level = operatorLevel(variableName(facts.levelEnv, application, 'LOG_LEVEL'), host.env);
  const file = operatorFile(variableName(facts.fileEnv, application, 'LOG_FILE'), context);
  const resolvedOf = (declared: DeclaredLogFile, path: string | LoggingError): ResolvedLogFile => {
    const written = level.level ?? declared.level;
    return path instanceof LoggingError
      ? { error: path, level: written }
      : { level: written, path };
  };
  const files = [
    resolvedOf(first, file.path ?? resolveLogFile(first.file, application, host)),
    ...rest.map((declared) =>
      resolvedOf(declared, resolveLogFile(declared.file, application, host)),
    ),
  ];
  return { files, rejected: { file: file.rejected, level: level.rejected } };
}

export { resolveLoggingFiles };
export type {
  DeclaredLogFile,
  LoggingFilesFacts,
  LogFilesHost,
  RejectedLogVariable,
  ResolvedLogFile,
  ResolvedLogFiles,
};
