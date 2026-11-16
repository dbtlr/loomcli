/*
 * The operator sentences of the files at the top of the plugin pack's `src`, which several plugins
 * share, under ADR-0164: the refusals of a host whose home folder or installation record cannot be
 * named. Each is a function of the values it repeats, and the code that raises the failure calls
 * it. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Every name and variable a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/**
 * The refusal of a `HOME` that does not hold an absolute path.
 *
 * @example
 * ```ts
 * homeNotAbsolute('notes');
 * // 'notes cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.'
 * ```
 */
function homeNotAbsolute(name: string): string {
  return `${shown(name)} cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`;
}

/**
 * The refusal of an installation record directory the environment cannot name.
 *
 * @example
 * ```ts
 * recordDirectoryNotAbsolute('notes', 'XDG_STATE_HOME');
 * ```
 */
function recordDirectoryNotAbsolute(name: string, variable: string): string {
  return `${shown(name)} cannot find its installation record because ${shown(variable)} is not an absolute path. Set ${shown(variable)} to an absolute path, then run the command again.`;
}

export { homeNotAbsolute, recordDirectoryNotAbsolute };
