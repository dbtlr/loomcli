/*
 * The operator sentences of the configuration plugin, under ADR-0164. A clause that says why a file
 * cannot be used is one of the fixed `Clause` strings the readers return, or names the format of a
 * file the application passes no reader for. `tests/message-
 * voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';
import type { ContextualStyle } from '@loomcli/core';

import type { Clause, Unread } from './reading.js';
import type { Position } from './text.js';

const shown = escapeControlCharacters;

/** What the operator does about one clause: for the file `--config` named, and for a discovered file. */
interface Fix {
  readonly named: string;
  /** Absent for a clause a discovered file is silent about. */
  readonly discovered?: string;
}

/** The one table of fixes, so each sentence the plugin writes ends with its step. */
const fixes: Readonly<Record<Clause, Fix>> = {
  'could not be read.': {
    discovered: 'Make it readable, or remove it.',
    named: 'Supply a file this process can read.',
  },
  'does not exist.': { named: 'Supply the path of an existing file.' },
  'does not hold a JSON object.': {
    discovered: 'Write its settings as one JSON object, or remove it.',
    named: 'Write its settings as one JSON object.',
  },
  'does not hold a YAML mapping.': {
    discovered: 'Write its settings as one YAML mapping, or remove it.',
    named: 'Write its settings as one YAML mapping.',
  },
  'is not valid JSON.': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
  'is not valid TOML.': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
  'is not valid YAML.': {
    discovered: 'Correct its syntax, or remove it.',
    named: 'Correct its syntax, or supply another file.',
  },
};

interface Unusable {
  readonly clause: Clause;
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

/** Whether a discovered file the problem describes warns, or the lookup passes over it in silence. */
function isSilent(problem: Problem): boolean {
  return 'clause' in problem && fixes[problem.clause].discovered === undefined;
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
  return clause.slice(clauseStart, closingStop);
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

/** One log line: its message, a constant Message Template, and the fields it reads. */
interface LogText {
  readonly template: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** The `debug` log line that names the file the run read. */
function readFrom(file: string): LogText {
  return { fields: { file }, template: 'Read configuration from {file}.' };
}

/** The `trace` log line for one place the lookup looked and found nothing. */
function lookedFor(file: string): LogText {
  return { fields: { file }, template: 'Looked for {file}: not found.' };
}

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

/**
 * The `debug` log line for a removed value or an unknown key: its path, or every key for the whole
 * file, the file when the run read one, and the issue.
 */
function ignoredValue(
  { file, path }: { readonly path: string | undefined; readonly file: string | undefined },
  issue: string,
): LogText {
  if (path === undefined) {
    return file === undefined
      ? { fields: { issue }, template: 'Ignored every key: {issue}' }
      : { fields: { file, issue }, template: 'Ignored every key in {file}: {issue}' };
  }
  return file === undefined
    ? { fields: { issue, key: path }, template: 'Ignored {key}: {issue}' }
    : { fields: { file, issue, key: path }, template: 'Ignored {key} in {file}: {issue}' };
}

interface FileFill {
  readonly spelling: string;
  readonly label: string;
  readonly path: string | undefined;
}

function position(path: string | undefined): string {
  return path === undefined ? '' : ` at ${shown(path)}`;
}

/**
 * The `debug` log line for a value the option cannot take, in core's form for a dropped fill: the
 * option by its reported spelling, any position, the label, and the issue.
 */
function ignoredOption(fill: FileFill, issueSentence: string): LogText {
  const fields = { issue: issueSentence, label: fill.label, option: fill.spelling };
  return fill.path === undefined
    ? { fields, template: 'Ignored option "{option}" from {label}: {issue}' }
    : {
        fields: { ...fields, position: fill.path },
        template: 'Ignored option "{option}" at {position} from {label}: {issue}',
      };
}

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

export type { FileFill, LogText, Problem };
export {
  booleanIssue,
  brokenFileLine,
  countIssue,
  exclusiveFileOptions,
  filledOptionLine,
  ignoredOption,
  ignoredValue,
  isSilent,
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
