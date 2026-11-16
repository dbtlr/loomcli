/*
 * The operator sentences of the configuration plugin, under ADR-0164: the failures of a `--config`
 * file and of `--config` beside `--no-config`, the warnings and the notice of the lookup, the lines
 * a strict read adds to its failure, the `-v` lines of a value the run ignores, and the issues of a
 * file value an option cannot take. Each is a function of the values it repeats, or a constant,
 * and the code that raises the failure or writes the line calls it. A clause that says why a file
 * cannot be used is one of the fixed `Clause` strings the readers return. An issue's sentence is
 * its validator's, which a line repeats after the option's name as the validator wrote it, as core
 * does. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';
import type { ContextualStyle } from '@loomcli/core';

import type { Clause } from './reading.js';
import type { Position } from './text.js';

/** Every path, label, spelling, and name a sentence repeats, escaped as a failure message quotes text. */
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

/**
 * Whether a discovered file the clause describes warns, or the lookup passes over it in silence.
 *
 * @example
 * ```ts
 * isSilent('does not exist.'); // true
 * ```
 */
function isSilent(clause: Clause): boolean {
  return fixes[clause].discovered === undefined;
}

/** The step a discovered file's clause asks for, or nothing for a clause that is silent. */
function discoveredStep(clause: Clause): string {
  return fixes[clause].discovered ?? '';
}

/** The step the file `--config` named asks for. */
function namedStep(clause: Clause): string {
  return fixes[clause].named;
}

/** Where a clause's text starts, and the offset from its end of its closing full stop. */
const clauseStart = 0;
const closingStop = -1;

/** A clause without its closing full stop, so the sentence can go on. Every clause ends in one. */
function withoutStop(clause: Clause): string {
  return clause.slice(clauseStart, closingStop);
}

/** Where a file stops parsing, at a line and a column. */
function place(line: number, column: number): string {
  return ` at line ${String(line)}, column ${String(column)}`;
}

/** Where a file stops parsing, as the sentence names it, or nothing when the parser named no place. */
function where(at: Position | undefined): string {
  return at === undefined ? '' : place(at.line, at.column);
}

/**
 * Why a file cannot be used: the clause, and where the file stops parsing when its parser names a
 * place.
 *
 * @example
 * ```ts
 * const unusable: Unusable = { at: { column: 7, line: 3 }, clause: 'is not valid JSON.' };
 * ```
 */
interface Unusable {
  readonly clause: Clause;
  readonly at?: Position | undefined;
}

/** A file as a warning shows it: escaped for the terminal and its markup, and kept on one line. */
function warned(file: string, style: ContextualStyle): string {
  return nowrap(style.escape(escapeControlCharacters(file)));
}

/** Files as a warning lists them, joined with commas. */
function warnedFiles(files: readonly string[], style: ContextualStyle): string {
  return files.map((file) => warned(file, style)).join(', ');
}

/**
 * The issue of a `--config` file that cannot be used.
 *
 * @example
 * ```ts
 * namedFileIssue('settings.json', { at: { column: 7, line: 3 }, clause: 'is not valid JSON.' });
 * // 'File "settings.json" is not valid JSON at line 3, column 7. Correct its syntax, or supply another file.'
 * ```
 */
function namedFileIssue(file: string, { at, clause }: Unusable): string {
  return `File "${shown(file)}" ${withoutStop(clause)}${where(at)}. ${namedStep(clause)}`;
}

/**
 * The failure of a `--config` file that cannot be used, opened by the option's spelling.
 *
 * @example
 * ```ts
 * namedFileFailure('--config', 'settings.json', { clause: 'does not exist.' });
 * // 'Option "--config": File "settings.json" does not exist. Supply the path of an existing file.'
 * ```
 */
function namedFileFailure(spelling: string, file: string, unusable: Unusable): string {
  return `Option "${shown(spelling)}": ${namedFileIssue(file, unusable)}`;
}

/** Spellings as a sentence lists them, each quoted, joined with `and`. */
function quotedSpellings(spellings: readonly string[]): string {
  return spellings.map((spelling) => `"${shown(spelling)}"`).join(' and ');
}

/**
 * The failure of `--config` and `--no-config` given together.
 *
 * @example
 * ```ts
 * exclusiveFileOptions(['--config', '--no-config']);
 * // 'Options "--config" and "--no-config" cannot be used together. Supply only one of them.'
 * ```
 */
function exclusiveFileOptions(spellings: readonly string[]): string {
  return `Options ${quotedSpellings(spellings)} cannot be used together. Supply only one of them.`;
}

/**
 * The warning of present candidates a directory skips unread, because an earlier one matches.
 *
 * @example
 * ```ts
 * skippedCandidates(['.notes.yaml'], '.notes.json', style);
 * // 'Skipped .notes.yaml: .notes.json matches the same pattern first. Keep one of the files, and remove the others.'
 * ```
 */
function skippedCandidates(
  skipped: readonly string[],
  found: string,
  style: ContextualStyle,
): string {
  return `Skipped ${warnedFiles(skipped, style)}: ${warned(found, style)} matches the same pattern first. Keep one of the files, and remove the others.`;
}

/**
 * The warning of a discovered file that cannot be used, after which the run reads no configuration.
 *
 * @example
 * ```ts
 * skippedUnusable('.notes.json', { clause: 'is not valid JSON.' }, style);
 * // 'Skipped .notes.json: the file is not valid JSON, so this run reads no configuration. Correct its syntax, or remove it.'
 * ```
 */
function skippedUnusable(file: string, { at, clause }: Unusable, style: ContextualStyle): string {
  return `Skipped ${warned(file, style)}: the file ${withoutStop(clause)}${where(at)}, so this run reads no configuration. ${discoveredStep(clause)}`;
}

/**
 * The line a discovered file that cannot be used adds to a strict read's failure.
 *
 * @example
 * ```ts
 * brokenFileLine('.notes.json', { clause: 'is not valid JSON.' });
 * // 'Configuration file .notes.json is not valid JSON. Correct its syntax, or remove it.'
 * ```
 */
function brokenFileLine(file: string, { at, clause }: Unusable): string {
  return `Configuration file ${shown(file)} ${withoutStop(clause)}${where(at)}. ${discoveredStep(clause)}`;
}

/**
 * The notice of a lookup that found no file, naming the file to create.
 *
 * @example
 * ```ts
 * noFileNotice('.notes.json', 'notes', style);
 * // 'Found no configuration file. Create .notes.json to configure notes.'
 * ```
 */
function noFileNotice(file: string, app: string, style: ContextualStyle): string {
  return `Found no configuration file. Create ${warned(file, style)} to configure ${shown(app)}.`;
}

/** The ending punctuation an issue already carries, which a line does not add again. */
const stops = ['.', '!', '?'];

/** The issue escaped, with a period unless it already ends in a stop, as the `empty-file` sentence adds one. */
function stopped(issueSentence: string): string {
  const text = escapeControlCharacters(issueSentence);
  return stops.some((stop) => text.endsWith(stop)) ? text : `${shown(text)}.`;
}

/** The place a line names: ` in <file>`, or nothing when the run read no file. */
function placeOf(file: string | undefined): string {
  return file === undefined ? '' : ` in ${shown(file)}`;
}

/**
 * The strict line of a value the schema rejected, naming the issue's own path. An issue with no
 * path rejected the whole file, and its line names the file.
 *
 * @example
 * ```ts
 * valueLine('workers', '.notes.json', 'Expected a number');
 * // 'Configuration value workers in .notes.json: Expected a number. Correct the value, or remove it.'
 * ```
 */
function valueLine(path: string | undefined, file: string | undefined, issue: string): string {
  if (path === undefined) {
    return `Configuration file${file === undefined ? '' : ` ${shown(file)}`}: ${stopped(issue)} Correct the file, or remove it.`;
  }
  return `Configuration value ${shown(path)}${placeOf(file)}: ${stopped(issue)} Correct the value, or remove it.`;
}

/**
 * The strict line of an unknown key.
 *
 * @example
 * ```ts
 * unknownKeyLine('wrokers', '.notes.json');
 * // 'Unknown key wrokers in .notes.json. Check its spelling, or remove it.'
 * ```
 */
function unknownKeyLine(path: string, file: string | undefined): string {
  return `Unknown key ${shown(path)}${placeOf(file)}. Check its spelling, or remove it.`;
}

/**
 * The issue of an unknown key, which its `-v` line repeats.
 *
 * @example
 * ```ts
 * console.log(unknownKeyIssue); // 'Unknown key. Check its spelling, or remove it.'
 * ```
 */
const unknownKeyIssue = 'Unknown key. Check its spelling, or remove it.';

/** What a `-v` line ignored: the value at a shown path, kept on one line, or every key. */
function ignoredSubject(path: string | undefined, style: ContextualStyle): string {
  return path === undefined ? 'every key' : nowrap(style.escape(escapeControlCharacters(path)));
}

/** The file a `-v` line names: ` in <file>`, or nothing when the run read no file. */
function within(file: string | undefined, style: ContextualStyle): string {
  return file === undefined ? '' : ` in ${warned(file, style)}`;
}

/**
 * The `-v` line of a removed value or an unknown key, from its shown path, or `undefined` for the
 * whole file, which has no steps.
 *
 * @example
 * ```ts
 * ignoredValue({ file: '.notes.json', path: 'workers' }, 'Expected a number.', style);
 * // 'Ignored workers in .notes.json: Expected a number.'
 * ```
 */
function ignoredValue(
  { file, path }: { readonly path: string | undefined; readonly file: string | undefined },
  issue: string,
  style: ContextualStyle,
): string {
  return `Ignored ${ignoredSubject(path, style)}${within(file, style)}: ${style.escape(escapeControlCharacters(issue))}`;
}

/**
 * A file value an option cannot take, as its lines name it: the option's spelling, the label of
 * its path in the file, and where inside the value an issue points, if anywhere.
 *
 * @example
 * ```ts
 * const fill: FileFill = { label: 'workers in .notes.json', path: undefined, spelling: '--workers' };
 * ```
 */
interface FileFill {
  readonly spelling: string;
  readonly label: string;
  readonly path: string | undefined;
}

/** Where inside a value an issue points, or nothing for an issue about the value itself. */
function position(path: string | undefined): string {
  return path === undefined ? '' : ` at ${shown(path)}`;
}

/**
 * The `-v` line of a file value an option cannot take, in core's form for a dropped fill.
 *
 * @example
 * ```ts
 * ignoredOption({ label: 'workers in .notes.json', path: undefined, spelling: '--workers' }, 'Use a string or a number.', style);
 * // 'Ignored option "--workers" from workers in .notes.json: Use a string or a number.'
 * ```
 */
function ignoredOption(fill: FileFill, issueSentence: string, style: ContextualStyle): string {
  return `Ignored option "${shown(fill.spelling)}"${position(fill.path)} from ${style.escape(escapeControlCharacters(fill.label))}: ${issueSentence}`;
}

/**
 * The strict line of a file value an option cannot take, in core's form for a filled value.
 *
 * @example
 * ```ts
 * filledOptionLine({ label: 'workers in .notes.json', path: undefined, spelling: '--workers' }, 'Use a string or a number.');
 * // 'Option "--workers" (from workers in .notes.json): Use a string or a number.'
 * ```
 */
function filledOptionLine(fill: FileFill, issueSentence: string): string {
  return `Option "${shown(fill.spelling)}" (from ${shown(fill.label)})${position(fill.path)}: ${issueSentence}`;
}

/**
 * The issue of a file value a string or content option cannot take.
 *
 * @example
 * ```ts
 * console.log(stringOrNumberIssue); // 'Use a string or a number.'
 * ```
 */
const stringOrNumberIssue = 'Use a string or a number.';

/**
 * The issue of a file value a multiple option cannot take.
 *
 * @example
 * ```ts
 * console.log(stringListIssue); // 'Use an array of strings or numbers.'
 * ```
 */
const stringListIssue = 'Use an array of strings or numbers.';

/**
 * The issue of a file value an option with an arity cannot take.
 *
 * @example
 * ```ts
 * tupleIssue(2); // 'Use an array of 2 strings or numbers.'
 * ```
 */
function tupleIssue(arity: number): string {
  return `Use an array of ${String(arity)} strings or numbers.`;
}

/**
 * The issue of a file value a multiple option with an arity cannot take.
 *
 * @example
 * ```ts
 * tupleListIssue(2); // 'Use an array of arrays, each of 2 strings or numbers.'
 * ```
 */
function tupleListIssue(arity: number): string {
  return `Use an array of arrays, each of ${String(arity)} strings or numbers.`;
}

/**
 * The issue of a file value a Boolean option cannot take.
 *
 * @example
 * ```ts
 * console.log(booleanIssue); // 'Use true or false.'
 * ```
 */
const booleanIssue = 'Use true or false.';

/**
 * The issue of a file value a counted option cannot take.
 *
 * @example
 * ```ts
 * console.log(countIssue); // 'Use a whole number of 0 or more.'
 * ```
 */
const countIssue = 'Use a whole number of 0 or more.';

export type { FileFill, Unusable };
export {
  booleanIssue,
  brokenFileLine,
  countIssue,
  exclusiveFileOptions,
  filledOptionLine,
  ignoredOption,
  ignoredValue,
  isSilent,
  namedFileFailure,
  namedFileIssue,
  noFileNotice,
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
