import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';
import { array, literal, object, optional, picklist, string, union } from 'valibot';

import { packageName } from '../constants.js';
import { exactFacts } from '../exact-facts.js';
import { writtenLevels } from './record.js';
import type { LoggingFilesFacts } from './resolution.js';

/*
 * The logging plugin's fact and the one resolver that reads it. Another plugin that names the log
 * file, such as the service plugin's status, imports this module and never the logging entry, so
 * it reads the file the logging plugin writes without bundling the writer.
 */

const variableSetting = optional(union([string(), literal(false)]));

const declaredFile = object({ file: optional(string()), level: picklist(writtenLevels) });

const filesFacts = exactFacts<LoggingFilesFacts>()(
  object({ fileEnv: variableSetting, files: array(declaredFile), levelEnv: variableSetting }),
);

/**
 * The logging plugin's fact, which its attach hook adds to the root Command. Read it with
 * `readExtension(graph.root, loggingFiles)`, and resolve it for a host with `resolveLoggingFiles`.
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
export const loggingFiles: Extension<
  'command',
  StandardSchemaV1<LoggingFilesFacts, LoggingFilesFacts>
> = extension(`${packageName}/logging/files`, { schema: filesFacts, target: 'command' });

export { resolveLoggingFiles } from './resolution.js';
export type { LoggingError, LoggingErrorKind } from './error.js';
export type { WrittenLevel } from './record.js';
export type {
  DeclaredLogFile,
  LogFilesHost,
  LoggingFilesFacts,
  RejectedLogVariable,
  ResolvedLogFile,
  ResolvedLogFiles,
} from './resolution.js';
