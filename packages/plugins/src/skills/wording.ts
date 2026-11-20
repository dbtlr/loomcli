/*
 * The skills plugin's status-note wording, under ADR-0200's wording modules: the install step the
 * notes repeat. Each note is a sentence of `messages.ts`, chosen in `status-notes.ts`.
 * `tests/message-voice.test.ts` reads this module as a message module.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shown = escapeControlCharacters;

interface NoteScope {
  readonly target: string;
  readonly project: boolean;
  readonly root?: string | undefined;
}
/** The target-specific project step, whose values are escaped before composition. */
function installStep(name: string, scope: NoteScope): string {
  const directory = scope.root === undefined ? '' : ` --directory ${shown(scope.root)}`;
  return `${shown(name)} skills install${scope.project ? ' --project' : ''} --agent ${shown(scope.target)}${directory}`;
}

export { installStep };
export type { NoteScope };
