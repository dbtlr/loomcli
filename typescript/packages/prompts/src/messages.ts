/*
 * The operator sentences of the questions and the progress lines, under ADR-0164. Each is a
 * function of the values it repeats, or a constant. `tests/message-voice.test.ts` holds this module
 * to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

function quotedValues(values: readonly unknown[]): string {
  return values.map((value) => `"${escapeControlCharacters(String(value))}"`).join(', ');
}

function interactionUnavailable(question: string, command: string): string {
  return `The question "${escapeControlCharacters(question)}" needs an interactive terminal, and this run is not interactive. Run "${escapeControlCharacters(command)}" at a terminal.`;
}

function editorFileUnwritable(folder: string, code: string): string {
  return `Cannot write the editor's file in "${escapeControlCharacters(folder)}" (${escapeControlCharacters(code)}). Set TMPDIR to a folder you can write to, then run the command again.`;
}

function editorNotStarted(editor: string): string {
  return `The editor "${escapeControlCharacters(editor)}" could not start. Set VISUAL or EDITOR to an editor you have installed, then run the command again.`;
}

function editorExited(editor: string, status: number): string {
  return `The editor "${escapeControlCharacters(editor)}" exited with code ${String(status)}, so the question has no answer. To answer it, set VISUAL or EDITOR to another editor if you need one, then run the command again.`;
}

const answerFileRemoved =
  "The editor removed the answer's file. Save the answer before you close the editor.";

function answerFileUnreadable(code: string): string {
  return `The question cannot read the answer's file (${escapeControlCharacters(code)}). Save the answer as a file before you close the editor.`;
}

const answerNotUtf8 = 'The saved answer is not UTF-8 text. Save it as UTF-8.';

const invalidAnswer = 'The answer is invalid.';

const yesOrNo = 'Type y or n.';

const noSelectableChoice = 'No choice can be selected. Change the search.';

function chooseAtLeast(min: number): string {
  return `Choose at least ${String(min)}.`;
}

function chooseAtMost(max: number): string {
  return `Choose at most ${String(max)}.`;
}

function typeOneNumber(highest: number): string {
  return `Type a number from 1 to ${String(highest)}.`;
}

function typeNumbers(highest: number): string {
  return `Type numbers from 1 to ${String(highest)}, separated by commas.`;
}

function choiceIssue(label: string, issueSentence: string): string {
  return `${escapeControlCharacters(label)}: ${issueSentence}`;
}

function unselectable(values: readonly unknown[]): string {
  return `Cannot select ${quotedValues(values)}. Choose from the list.`;
}

function overLimit(values: readonly unknown[], max: number): string {
  return `Cannot select ${quotedValues(values)}: at most ${String(max)} can be selected. Deselect a choice to select ${values.length === 1 ? 'it' : 'one'}.`;
}

function logLinesDropped(dropped: number): string {
  return dropped === 1
    ? '1 earlier line was dropped.'
    : `${String(dropped)} earlier lines were dropped.`;
}

const cancelled = 'cancelled';
const disabled = 'disabled';
const editorOpen = 'Press Enter to open your editor';
const editorWaiting = 'Waiting for your editor to close the file';
const empty = 'empty';
const enterNumber = 'Enter a number';
const enterNumbers = 'Enter numbers separated by commas';
const hoursUnit = 'h';
const minutesUnit = 'm';
const multiselectKeys = '↑↓ move · Space toggle · Enter submit';
const multiselectSearchKeys = '↑↓ move · Tab toggle · Enter submit';
const multiselectSearchShortKeys = '↑↓ Tab Enter';
const multiselectShortKeys = '↑↓ Space Enter';
const noAnswer = 'no';
const noChoiceAvailable = 'No choice can be selected';
const noMatches = 'No matches';
const none = 'none';
const perHour = '/h';
const perMinute = '/min';
const perSecond = '/s';
const refineSearch = 'Enter a number, or text to search again';
const search = 'Search';
const searching = 'Searching';
const secondsUnit = 's';
const selectKeys = '↑↓ move · Enter select';
const selectSearchKeys = '↑↓ move · type to search · Enter select';
const selectShortKeys = '↑↓ Enter';
const yesAnswer = 'yes';

function editorAdditionalLines(count: number): string {
  return `(+${String(count)} ${count === 1 ? 'line' : 'lines'})`;
}

function moreChoices(count: number): string {
  return `${String(count)} more`;
}

function limitSuffix(max: number): string {
  return `/${String(max)}`;
}

/** The count of a multiselect's chosen values, and the most it takes when it has a limit. */
function selectedCount(count: number, max: number | undefined): string {
  return `${String(count)}${max === undefined ? '' : limitSuffix(max)} selected`;
}

function timeRemaining(span: string): string {
  return `about ${escapeControlCharacters(span)} left`;
}

export {
  answerFileRemoved,
  answerFileUnreadable,
  answerNotUtf8,
  cancelled,
  choiceIssue,
  chooseAtLeast,
  chooseAtMost,
  disabled,
  editorAdditionalLines,
  editorExited,
  editorFileUnwritable,
  editorNotStarted,
  editorOpen,
  editorWaiting,
  empty,
  enterNumber,
  enterNumbers,
  hoursUnit,
  interactionUnavailable,
  invalidAnswer,
  logLinesDropped,
  minutesUnit,
  moreChoices,
  multiselectKeys,
  multiselectSearchKeys,
  multiselectSearchShortKeys,
  multiselectShortKeys,
  noAnswer,
  noChoiceAvailable,
  noMatches,
  noSelectableChoice,
  none,
  overLimit,
  perHour,
  perMinute,
  perSecond,
  refineSearch,
  search,
  searching,
  secondsUnit,
  selectKeys,
  selectSearchKeys,
  selectShortKeys,
  selectedCount,
  timeRemaining,
  typeNumbers,
  typeOneNumber,
  unselectable,
  yesAnswer,
  yesOrNo,
};
