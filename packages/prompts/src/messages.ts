/*
 * The operator sentences of the questions, under ADR-0164: the failures a question raises, and the
 * line a question shows under an answer it rejects. Each is a function of the values it repeats, or
 * a constant, and the code that raises the failure or shows the line calls it.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/**
 * Values a sentence names, each quoted and escaped, joined with commas.
 *
 * @example
 * ```ts
 * quotedValues(['prod', 'dev']); // '"prod", "dev"'
 * ```
 */
function quotedValues(values: readonly unknown[]): string {
  return values.map((value) => `"${escapeControlCharacters(String(value))}"`).join(', ');
}

/**
 * The failure of a question asked in a run that is not interactive, which links no option or
 * argument that could answer it.
 *
 * @example
 * ```ts
 * interactionUnavailable('Wipe the cache?', 'app wipe');
 * // 'The question "Wipe the cache?" needs an interactive terminal, and this run is not interactive. Run "app wipe" at a terminal.'
 * ```
 */
function interactionUnavailable(question: string, command: string): string {
  return `The question "${escapeControlCharacters(question)}" needs an interactive terminal, and this run is not interactive. Run "${escapeControlCharacters(command)}" at a terminal.`;
}

/**
 * The failure of an editor question that cannot write its answer's file, with the system's code.
 *
 * @example
 * ```ts
 * editorFileUnwritable('/tmp', 'EACCES');
 * // 'Cannot write the editor\'s file in "/tmp" (EACCES). Set TMPDIR to a folder you can write to, then run the command again.'
 * ```
 */
function editorFileUnwritable(folder: string, code: string): string {
  return `Cannot write the editor's file in "${escapeControlCharacters(folder)}" (${escapeControlCharacters(code)}). Set TMPDIR to a folder you can write to, then run the command again.`;
}

/**
 * The failure of an editor question whose editor could not start.
 *
 * @example
 * ```ts
 * editorNotStarted('vi');
 * // 'The editor "vi" could not start. Set VISUAL or EDITOR to an editor you have installed, then run the command again.'
 * ```
 */
function editorNotStarted(editor: string): string {
  return `The editor "${escapeControlCharacters(editor)}" could not start. Set VISUAL or EDITOR to an editor you have installed, then run the command again.`;
}

/**
 * The failure of an editor question whose editor exited with an error status.
 *
 * @example
 * ```ts
 * editorExited('vi', 1);
 * // 'The editor "vi" exited with code 1, so the question has no answer. ...'
 * ```
 */
function editorExited(editor: string, status: number): string {
  return `The editor "${escapeControlCharacters(editor)}" exited with code ${String(status)}, so the question has no answer. To answer it, set VISUAL or EDITOR to another editor if you need one, then run the command again.`;
}

/**
 * The line an editor question shows when the editor removed the answer's file.
 *
 * @example
 * ```ts
 * answerFileRemoved; // "The editor removed the answer's file. Save the answer before you close the editor."
 * ```
 */
const answerFileRemoved =
  "The editor removed the answer's file. Save the answer before you close the editor.";

/**
 * The line an editor question shows when it cannot read the answer's file, with the system's code.
 *
 * @example
 * ```ts
 * answerFileUnreadable('EACCES');
 * // "The question cannot read the answer's file (EACCES). Save the answer as a file before you close the editor."
 * ```
 */
function answerFileUnreadable(code: string): string {
  return `The question cannot read the answer's file (${escapeControlCharacters(code)}). Save the answer as a file before you close the editor.`;
}

/**
 * The line an editor question shows when the saved answer is not UTF-8 text.
 *
 * @example
 * ```ts
 * answerNotUtf8; // 'The saved answer is not UTF-8 text. Save it as UTF-8.'
 * ```
 */
const answerNotUtf8 = 'The saved answer is not UTF-8 text. Save it as UTF-8.';

/**
 * The line a question shows when a validator rejects an answer with no issue to name.
 *
 * @example
 * ```ts
 * invalidAnswer; // 'The answer is invalid.'
 * ```
 */
const invalidAnswer = 'The answer is invalid.';

/**
 * The line a confirm question shows under an answer that is neither yes nor no.
 *
 * @example
 * ```ts
 * yesOrNo; // 'Type y or n.'
 * ```
 */
const yesOrNo = 'Type y or n.';

/**
 * The line a select question shows when no choice the search leaves can be selected.
 *
 * @example
 * ```ts
 * noSelectableChoice; // 'No choice can be selected. Change the search.'
 * ```
 */
const noSelectableChoice = 'No choice can be selected. Change the search.';

/**
 * The line a multiselect question shows when too few choices are selected.
 *
 * @example
 * ```ts
 * chooseAtLeast(2); // 'Choose at least 2.'
 * ```
 */
function chooseAtLeast(min: number): string {
  return `Choose at least ${String(min)}.`;
}

/**
 * The line a multiselect question shows when a validator rejects one choice: the choice's label,
 * escaped, and the issue's sentence, which is its validator's.
 *
 * @example
 * ```ts
 * choiceIssue('Staging', 'Expected a whole number.'); // 'Staging: Expected a whole number.'
 * ```
 */
function choiceIssue(label: string, issueSentence: string): string {
  return `${escapeControlCharacters(label)}: ${issueSentence}`;
}

/**
 * The line a select question shows when a supplied value names no choice it can select.
 *
 * @example
 * ```ts
 * unselectable(['qa']); // 'Cannot select "qa". Choose from the list.'
 * ```
 */
function unselectable(values: readonly unknown[]): string {
  return `Cannot select ${quotedValues(values)}. Choose from the list.`;
}

/**
 * The line a multiselect question shows when supplied values would select more than its maximum.
 *
 * @example
 * ```ts
 * overLimit(['qa'], 2);
 * // 'Cannot select "qa": at most 2 can be selected. Deselect a choice to select it.'
 * ```
 */
function overLimit(values: readonly unknown[], max: number): string {
  return `Cannot select ${quotedValues(values)}: at most ${String(max)} can be selected. Deselect a choice to select ${values.length === 1 ? 'it' : 'one'}.`;
}

export {
  answerFileRemoved,
  answerFileUnreadable,
  answerNotUtf8,
  choiceIssue,
  chooseAtLeast,
  editorExited,
  editorFileUnwritable,
  editorNotStarted,
  interactionUnavailable,
  invalidAnswer,
  noSelectableChoice,
  overLimit,
  unselectable,
  yesOrNo,
};
