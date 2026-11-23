/*
 * The skills plugin's status-note wording, under ADR-0200's wording modules: the install step the
 * notes repeat. Each note is a sentence of `messages.ts`, chosen in `status-notes.ts`.
 * `tests/message-voice.test.ts` reads this module as a message module.
 */
import { escapeControlCharacters } from '@loomcli/core';

import { shellWord } from '../shell-quoting.js';

const shown = escapeControlCharacters;

interface NoteScope {
  readonly target: string;
  readonly project: boolean;
  readonly root?: string | undefined;
}
/**
 * The target-specific install step, whose values are escaped before composition. The root is one
 * shell word, quoted when it holds a space or another character a shell reads, so the step pastes.
 */
function installStep(name: string, scope: NoteScope): string {
  const directory = scope.root === undefined ? '' : ` --directory ${shown(shellWord(scope.root))}`;
  return `${shown(name)} skills install${scope.project ? ' --project' : ''} --agent ${shown(scope.target)}${directory}`;
}

export { installStep };
export type { NoteScope };
