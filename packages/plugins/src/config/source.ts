import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { InputError, readExtension } from '@loomcli/core';
import type {
  CommandGraph,
  ContextualStyle,
  Host,
  InputProblem,
  OptionNode,
  Out,
  SourceAnswer,
  SourceResolver,
} from '@loomcli/core';

import { escapeControlCharacters } from '../encode.js';
import { configInput } from './extension.js';
import type { config } from './plugin.js';

/**
 * The configuration plugin's resolver. Its rules are the plugin contract: rank the files, read each
 * once, answer every request from the first file whose path leads to a value, warn about a
 * discovered file that cannot be used, and fail the run on the file the operator named or on a
 * value the option cannot take. Every sentence it writes is fixed, so the bytes are the same under
 * Node and Bun, and no file content reaches the terminal.
 */

/** One ranked file: where it is read, how a label or a diagnostic shows it, and who chose it. */
interface RankedFile {
  readonly path: string;
  readonly shown: string;
  /** Whether `--config` named it, which makes every fault of it a usage failure. */
  readonly named: boolean;
}

/** A file the run reads from: its rank entry and the object its text holds. */
interface UsableFile {
  readonly file: RankedFile;
  readonly object: Record<string, unknown>;
}

/** What decides the files one run reads and the order they answer in. */
interface Ranking {
  readonly files: readonly string[];
  readonly host: Host;
  /** The application name, which derives the user file. */
  readonly name: string;
  /** The file `--config` named, which replaces every other file for the run. */
  readonly named: string | undefined;
}

/** The clause that ends a warning or a failure about a file that cannot be used. */
type Clause =
  | 'does not exist.'
  | 'could not be read.'
  | 'is not valid JSON.'
  | 'does not hold a JSON object.';

/** What reading one file found: its top-level object, or the clause that says why it is skipped. */
type Reading =
  | { kind: 'usable'; object: Record<string, unknown> }
  | { kind: 'unusable'; clause: Clause };

/** One issue of a wrong value, as the problem's `issues` carry it. */
type Issue = Extract<InputProblem, { reason: 'invalid' }>['issues'][number];

/** A value read at a request's path: one the option takes, or the issues that say why not. */
type Shaped =
  | { kind: 'value'; value: string | boolean | readonly string[] }
  | { kind: 'wrong'; issues: readonly Issue[] };

/** What one request came to: an answer, a wrong value with its reported lines, or nothing. */
type Answered =
  | { kind: 'answer'; answer: SourceAnswer }
  | { kind: 'wrong'; problem: InputProblem; lines: readonly string[] }
  | undefined;

/** The one file every user-file rule ends in. */
const userFileName = 'config.json';

/** The code point of the byte order mark a UTF-8 file may start with, which the reading ignores. */
const byteOrderMarkCodePoint = 65_279;
const byteOrderMark = String.fromCodePoint(byteOrderMarkCodePoint);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a read failed because nothing is at the path, a missing directory or a file in its place included. */
function isAbsent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

/**
 * The user file the application name derives, or `undefined` when the variable its platform reads
 * is unset or empty. The platform chooses only the variable; the running process's path rules build
 * the path. A relative `XDG_CONFIG_HOME` counts as unset.
 */
function userFile(name: string, host: Host): string | undefined {
  if (host.platform === 'win32') {
    const appData = host.env.APPDATA;
    return appData ? join(appData, name, userFileName) : undefined;
  }
  const xdg = host.env.XDG_CONFIG_HOME;
  if (xdg && isAbsolute(xdg)) {
    return join(xdg, name, userFileName);
  }
  const home = host.env.HOME;
  return home ? join(home, '.config', name, userFileName) : undefined;
}

/** One rank entry for a path, shown with each control character escaped. */
function ranked(path: string, shown: string, named: boolean): RankedFile {
  return { named, path, shown: escapeControlCharacters(shown) };
}

/**
 * The files one run reads, in rank order. `--config` names the only one. Otherwise the project
 * files rank as listed, resolved against the host's working directory, and the user file last. A
 * path that appears twice is kept where it first appears.
 */
function rank({ files, host, name, named }: Ranking): RankedFile[] {
  if (named !== undefined) {
    return [ranked(resolve(host.cwd, named), named, true)];
  }
  const entries = files.map((file) => ranked(resolve(host.cwd, file), file, false));
  const user = userFile(name, host);
  if (user !== undefined) {
    entries.push(ranked(user, user, false));
  }
  const seen = new Set<string>();
  return entries.filter((file) => {
    if (seen.has(file.path)) {
      return false;
    }
    seen.add(file.path);
    return true;
  });
}

/** The file's text as UTF-8, or the clause that says why it could not be read. */
async function readText(path: string): Promise<{ text: string } | { clause: Clause }> {
  try {
    return { text: await readFile(path, 'utf8') };
  } catch (error) {
    return { clause: isAbsent(error) ? 'does not exist.' : 'could not be read.' };
  }
}

/** The one JSON object a file's text holds, with a leading byte order mark ignored. */
function parseObject(text: string): Reading {
  const body = text.startsWith(byteOrderMark) ? text.slice(byteOrderMark.length) : text;
  try {
    const parsed: unknown = JSON.parse(body);
    return isPlainObject(parsed)
      ? { kind: 'usable', object: parsed }
      : { clause: 'does not hold a JSON object.', kind: 'unusable' };
  } catch {
    return { clause: 'is not valid JSON.', kind: 'unusable' };
  }
}

/** Reads one file once and answers with its object or the clause that says why it is skipped. */
async function read(file: RankedFile): Promise<Reading> {
  const text = await readText(file.path);
  return 'clause' in text ? { clause: text.clause, kind: 'unusable' } : parseObject(text.text);
}

/** The failure a `--config` file that cannot be used raises: a usage failure on the option itself. */
function namedFailure(file: RankedFile, clause: Clause): InputError {
  const message = `File "${file.shown}" ${clause}`;
  return new InputError(`Option "--config": ${message}`, [
    {
      input: { global: true, kind: 'option', name: 'config' },
      issues: [{ message }],
      reason: 'invalid',
      spelling: '--config',
    },
  ]);
}

/**
 * Every ranked file the run can use, read once each in rank order. A discovered file that does not
 * exist is silent, one that is broken warns once and is skipped, and the named file fails the run.
 */
async function readUsable(
  files: readonly RankedFile[],
  channels: { out: Out; style: ContextualStyle },
): Promise<UsableFile[]> {
  const usable: UsableFile[] = [];
  for (const file of files) {
    const reading = await read(file);
    if (reading.kind === 'usable') {
      usable.push({ file, object: reading.object });
    } else if (file.named) {
      throw namedFailure(file, reading.clause);
    } else if (reading.clause !== 'does not exist.') {
      await channels.out.warn(
        `Skipped ${channels.style.escape(file.shown)}: the file ${reading.clause}`,
      );
    }
  }
  return usable;
}

/** Marks where a path stops leading to a value, distinct from every JSON value. */
const missing = Symbol('missing');

/**
 * The value a dotted path leads to in one file's object. A missing key, or a value that is not an
 * object before the last segment, means the path is not in that file.
 */
function valueAt(object: Record<string, unknown>, segments: readonly string[]): unknown {
  let current: unknown = object;
  for (const segment of segments) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return missing;
    }
    current = current[segment];
  }
  return current;
}

/** The string a string option takes from one JSON value: a string as it is, or a number as its JSON text. */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' ? JSON.stringify(value) : undefined;
}

/** The list a multiple option takes from a JSON array, or one issue per item that is not a string or a number. */
function shapeList(value: readonly unknown[]): Shaped {
  const items: string[] = [];
  const issues: Issue[] = [];
  value.forEach((item, index) => {
    const text = textOf(item);
    if (text === undefined) {
      issues.push({ message: 'Use a string or a number.', path: [index] });
    } else {
      items.push(text);
    }
  });
  const [first] = issues;
  return first === undefined ? { kind: 'value', value: items } : { issues, kind: 'wrong' };
}

/** The raw value an option takes from a JSON value, by the option's type, or the issues it raises. */
function shape(request: OptionNode, value: unknown): Shaped {
  if (request.type === 'boolean') {
    return typeof value === 'boolean'
      ? { kind: 'value', value }
      : { issues: [{ message: 'Use true or false.' }], kind: 'wrong' };
  }
  if (request.multiple) {
    return Array.isArray(value)
      ? shapeList(value)
      : { issues: [{ message: 'Use an array of strings or numbers.' }], kind: 'wrong' };
  }
  const text = textOf(value);
  return text === undefined
    ? { issues: [{ message: 'Use a string or a number.' }], kind: 'wrong' }
    : { kind: 'value', value: text };
}

/**
 * The spelling core reports an option by: its long form, a negative-only Boolean option's negative
 * form, and otherwise its short form, which a short-only option alone publishes.
 */
function spellingOf(request: OptionNode): string {
  if (request.long !== null) {
    return request.long;
  }
  if (request.type === 'boolean' && request.negative !== null) {
    return request.negative;
  }
  return request.short ?? `--${request.name}`;
}

/** The lines one wrong value reports, one per issue, each naming the option, its origin, and any position. */
function wrongValueLines(subject: string, issues: readonly Issue[]): string[] {
  return issues.map((issue) => {
    const position = issue.path
      ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.');
    return `${subject}${position ? ` at ${position}` : ''}: ${issue.message}`;
  });
}

/**
 * One request answered from the first usable file whose path leads to a value. A request no file
 * answers comes to nothing, and a value the option cannot take is the problem core reports.
 */
function answer(request: OptionNode, usable: readonly UsableFile[], graph: CommandGraph): Answered {
  const located = locate(request, usable);
  if (located === undefined) {
    return undefined;
  }
  const shaped = shape(request, located.value);
  if (shaped.kind === 'value') {
    return { answer: { label: located.label, value: shaped.value }, kind: 'answer' };
  }
  const spelling = spellingOf(request);
  return {
    kind: 'wrong',
    lines: wrongValueLines(`Option "${spelling}" (from ${located.label})`, shaped.issues),
    problem: {
      input: { global: graph.globals.includes(request), kind: 'option', name: request.name },
      issues: shaped.issues,
      reason: 'invalid',
      spelling,
    },
  };
}

/**
 * The value at a request's path in the first usable file that holds one, with the label that names
 * the path and the file, or `undefined` when the option carries no binding or no file answers.
 */
function locate(
  request: OptionNode,
  usable: readonly UsableFile[],
): { label: string; value: unknown } | undefined {
  const binding = readExtension(request, configInput);
  if (binding === undefined) {
    return undefined;
  }
  const segments = binding.path.split('.');
  const answering = usable.find(({ object }) => valueAt(object, segments) !== missing);
  return answering === undefined
    ? undefined
    : {
        label: `${binding.path} in ${answering.file.shown}`,
        value: valueAt(answering.object, segments),
      };
}

/**
 * Every request answered from the usable files, by option name. One wrong value fails the run with
 * an `InputError` that carries each wrong value as one problem, in request order, and answers nothing.
 */
function answerAll(
  requests: readonly OptionNode[],
  usable: readonly UsableFile[],
  graph: CommandGraph,
): Record<string, SourceAnswer> {
  const answered = requests.map((request) => ({
    outcome: answer(request, usable, graph),
    request,
  }));
  const wrong = answered.flatMap(({ outcome }) => (outcome?.kind === 'wrong' ? [outcome] : []));
  const [first] = wrong;
  if (first !== undefined) {
    const lines = wrong.flatMap((entry) => entry.lines);
    throw new InputError(
      lines.join('\n'),
      wrong.map((entry) => entry.problem),
    );
  }
  const entries: [string, SourceAnswer][] = answered.flatMap(({ outcome, request }) =>
    outcome?.kind === 'answer' ? [[request.name, outcome.answer]] : [],
  );
  return Object.fromEntries(entries);
}

/**
 * The resolver for the project files the application listed. It reads every ranked file once, warns
 * about each discovered file it cannot use, and answers each request from the first file whose path
 * leads to a value. One wrong value fails the run in place of every answer.
 */
export function configSource(files: readonly string[]): SourceResolver<typeof config> {
  return async ({ graph, host, options, out, requests, style }) => {
    const ranking = { files, host, name: graph.name, named: options.config };
    return answerAll(requests, await readUsable(rank(ranking), { out, style }), graph);
  };
}
