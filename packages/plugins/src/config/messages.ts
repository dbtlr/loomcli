/*
 * The operator sentences of the configuration plugin, under ADR-0164. A clause that says why a file
 * cannot be used is one of the `Clause` codes the readers return, or names the format of a
 * file the application passes no reader for. `tests/message-
 * voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';
import type { ContextualStyle } from '@loomcli/core';

import type { Clause, Unread } from './reading.js';
import type { Position } from './text.js';
import { clauses, fixes } from './wording.js';

const shown = escapeControlCharacters;

interface Unusable {
  /** Why a reader could not use the file. */
  readonly clause: Clause;
  /** Where in the file the reader stopped, for a syntax error. */
  readonly at?: Position | undefined;
}

/** Why a file cannot be used: a reader's clause, or a format the application does not read. */
type Problem = Unusable | Unread;

/**
 * The formats the application reads as a step lists them, `JSON` or `JSON or YAML`. A file meets
 * this only when its own format is not read, so the list never holds all three.
 */
function formatChoices(formats: readonly string[]): string {
  return formats.map((format) => shown(format)).join(' or ');
}

/** The step for a file whose format the application does not read. */
function unreadStep({ formats }: Unread): string {
  return `Supply a ${formatChoices(formats)} file.`;
}

function discoveredStep(problem: Problem): string {
  return 'clause' in problem ? (fixes[problem.clause].discovered ?? '') : unreadStep(problem);
}

/** The step the file `--config` named asks for. */
function namedStep(problem: Problem): string {
  return 'clause' in problem ? fixes[problem.clause].named : unreadStep(problem);
}

const clauseStart = 0;
const closingStop = -1;

/** A clause without its closing full stop, so the sentence can go on. Every clause ends in one. */
function withoutStop(clause: Clause): string {
  return clauses[clause].slice(clauseStart, closingStop);
}

function place(line: number, column: number): string {
  return ` at line ${String(line)}, column ${String(column)}`;
}

function where(at: Position | undefined): string {
  return at === undefined ? '' : place(at.line, at.column);
}

/** Why the file cannot be used, after its name and without a closing full stop. */
function reason(problem: Problem): string {
  if ('clause' in problem) {
    return `${withoutStop(problem.clause)}${where(problem.at)}`;
  }
  return `is ${shown(problem.format)}, which this application does not read`;
}

function warned(file: string, style: ContextualStyle): string {
  return nowrap(style.escape(escapeControlCharacters(file)));
}

function warnedFiles(files: readonly string[], style: ContextualStyle): string {
  return files.map((file) => warned(file, style)).join(', ');
}

function namedFileIssue(file: string, problem: Problem): string {
  return `File "${shown(file)}" ${reason(problem)}. ${namedStep(problem)}`;
}

function namedFileFailure(spelling: string, file: string, problem: Problem): string {
  return `Option "${shown(spelling)}": ${namedFileIssue(file, problem)}`;
}

function quotedSpellings(spellings: readonly string[]): string {
  return spellings.map((spelling) => `"${shown(spelling)}"`).join(' and ');
}

function exclusiveFileOptions(spellings: readonly string[]): string {
  return `Options ${quotedSpellings(spellings)} cannot be used together. Supply only one of them.`;
}

function skippedCandidates(
  skipped: readonly string[],
  found: string,
  style: ContextualStyle,
): string {
  return `Skipped ${warnedFiles(skipped, style)}: ${warned(found, style)} matches the same pattern first. Keep one of the files, and remove the others.`;
}

function skippedUnusable(file: string, problem: Problem, style: ContextualStyle): string {
  return `Skipped ${warned(file, style)}: the file ${reason(problem)}, so this run reads no configuration. ${discoveredStep(problem)}`;
}

function brokenFileLine(file: string, problem: Problem): string {
  return `Configuration file ${shown(file)} ${reason(problem)}. ${discoveredStep(problem)}`;
}

/** The `-v` line of a lookup that found no file, which the notice opens with too. */
const noFileFound = 'Found no configuration file.';

function noFileNotice(file: string, app: string, style: ContextualStyle): string {
  return `${noFileFound} Create ${warned(file, style)} to configure ${shown(app)}.`;
}

/** The `debug` log template that names the file the run read. */
const readFrom = 'Read configuration from {file}.';

/** The `trace` log template for one place the lookup looked and found nothing. */
const lookedFor = 'Looked for {file}: not found.';

const stops = ['.', '!', '?'];

function stopped(issueSentence: string): string {
  const text = escapeControlCharacters(issueSentence);
  return stops.some((stop) => text.endsWith(stop)) ? text : `${shown(text)}.`;
}

function placeOf(file: string | undefined): string {
  return file === undefined ? '' : ` in ${shown(file)}`;
}

function valueLine(path: string | undefined, file: string | undefined, issue: string): string {
  if (path === undefined) {
    return `Configuration file${file === undefined ? '' : ` ${shown(file)}`}: ${stopped(issue)} Correct the file, or remove it.`;
  }
  return `Configuration value ${shown(path)}${placeOf(file)}: ${stopped(issue)} Correct the value, or remove it.`;
}

function unknownKeyLine(path: string, file: string | undefined): string {
  return `Unknown key ${shown(path)}${placeOf(file)}. Check its spelling, or remove it.`;
}

const unknownKeyIssue = 'Unknown key. Check its spelling, or remove it.';

/** The `debug` log template for a whole file's removed value when the run read no named file. */
const ignoredEveryKey = 'Ignored every key: {issue}';

/** The `debug` log template for a whole file's removed value, naming the file. */
const ignoredEveryKeyIn = 'Ignored every key in {file}: {issue}';

/** The `debug` log template for a removed value or an unknown key when the run read no named file. */
const ignoredKey = 'Ignored {key}: {issue}';

/** The `debug` log template for a removed value or an unknown key, naming the file. */
const ignoredKeyIn = 'Ignored {key} in {file}: {issue}';

/** A value the file filled an option with, as a line names it. */
interface FileFill {
  /** The option's spelling, or its declared name in an invocation by name. */
  readonly spelling: string;
  /** Where the value came from: its path and the file, escaped. */
  readonly label: string;
  /** The issue's position inside the value, when it has one. */
  readonly path: string | undefined;
}

function position(path: string | undefined): string {
  return path === undefined ? '' : ` at ${shown(path)}`;
}

/**
 * The `debug` log template for a value the option cannot take, in core's form for a dropped fill:
 * the option by its reported spelling, the label, and the issue.
 */
const ignoredOption = 'Ignored option "{option}" from {label}: {issue}';

/** The `debug` log template for a value the option cannot take, with its position in the value. */
const ignoredOptionAt = 'Ignored option "{option}" at {position} from {label}: {issue}';

function filledOptionLine(fill: FileFill, issueSentence: string): string {
  return `Option "${shown(fill.spelling)}" (from ${shown(fill.label)})${position(fill.path)}: ${issueSentence}`;
}

const stringOrNumberIssue = 'Use a string or a number.';

const stringListIssue = 'Use an array of strings or numbers.';

function tupleIssue(arity: number): string {
  return `Use an array of ${String(arity)} strings or numbers.`;
}

function tupleListIssue(arity: number): string {
  return `Use an array of arrays, each of ${String(arity)} strings or numbers.`;
}

const booleanIssue = 'Use true or false.';

const countIssue = 'Use a whole number of 0 or more.';

export type { FileFill, Problem };
export {
  booleanIssue,
  brokenFileLine,
  countIssue,
  exclusiveFileOptions,
  filledOptionLine,
  ignoredEveryKey,
  ignoredEveryKeyIn,
  ignoredKey,
  ignoredKeyIn,
  ignoredOption,
  ignoredOptionAt,
  lookedFor,
  namedFileFailure,
  namedFileIssue,
  noFileFound,
  noFileNotice,
  readFrom,
  skippedCandidates,
  skippedUnusable,
  stringListIssue,
  stringOrNumberIssue,
  tupleIssue,
  tupleListIssue,
  unknownKeyIssue,
  unknownKeyLine,
  valueLine,
};
