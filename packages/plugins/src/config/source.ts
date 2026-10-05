import {
  escapeControlCharacters,
  InputError,
  issuePath,
  readExtension,
  reportedSpelling,
} from '@loomcli/core';
import type {
  CommandGraph,
  InputProblem,
  OptionNode,
  SourceAnswer,
  SourceResolver,
} from '@loomcli/core';

import { configInput } from './extension.js';
import { findFile } from './lookup.js';
import type { UsableFile } from './lookup.js';
import type { config } from './plugin.js';
import { isPlainObject } from './reading.js';

/**
 * The configuration plugin's resolver. Its rules are the plugin contract: find the one file the run
 * reads, answer every request from it, and fail the run on a value the option cannot take. Every
 * sentence it writes is fixed, so the bytes are the same under Node and Bun, and no file content
 * reaches the terminal.
 */

/** One issue of a wrong value, as the problem's `issues` carry it. */
type Issue = Extract<InputProblem, { reason: 'invalid' }>['issues'][number];

/** A value read at a request's path: one the option takes, or the issues that say why not. */
type Shaped =
  | { kind: 'value'; value: string | boolean | number | readonly string[] }
  | { kind: 'wrong'; issues: readonly Issue[] };

/** What one request came to: an answer, a wrong value with its reported lines, or nothing. */
type Answered =
  | { kind: 'answer'; answer: SourceAnswer }
  | { kind: 'wrong'; problem: InputProblem; lines: readonly string[] }
  | undefined;

/** Marks where a path stops leading to a value, distinct from every value a file holds. */
const missing = Symbol('missing');

/**
 * The value a dotted path leads to in the file's object. A missing key, or a value that is not an
 * object before the last segment, means the path leads to no value.
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

/**
 * The string a string option takes from one value: a string as it is, a finite number as its JSON
 * text, and a TOML integer beyond the safe range, which reads as a `bigint`, as its exact digits.
 * A TOML date or time has already read as the text the file wrote.
 */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  // An overflowing JSON literal, TOML inf and nan, and YAML .inf and .nan are no finite number.
  return typeof value === 'number' && Number.isFinite(value) ? JSON.stringify(value) : undefined;
}

/** The list a multiple option takes from an array, or one issue per item that is not a string or a number. */
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

/** The fewest occurrences a count holds, which a configured count may not go below. */
const fewestOccurrences = 0;

/**
 * The count a counted option takes from one value: a JSON number, a TOML integer, or a YAML integer
 * that is a whole number of 0 or more. A TOML integer beyond the safe range reads as a `bigint`,
 * which counts as the nearest number.
 */
function countOf(value: unknown): number | undefined {
  const count = typeof value === 'bigint' ? Number(value) : value;
  return typeof count === 'number' && Number.isInteger(count) && count >= fewestOccurrences
    ? count
    : undefined;
}

/**
 * The raw value an option takes from one value, by the option's type, or the issues it raises. A
 * string option with an implied value takes a string by the string rule, never its implied value.
 */
function shape(request: OptionNode, value: unknown): Shaped {
  if (request.type === 'boolean') {
    return typeof value === 'boolean'
      ? { kind: 'value', value }
      : { issues: [{ message: 'Use true or false.' }], kind: 'wrong' };
  }
  if (request.type === 'count') {
    const count = countOf(value);
    return count === undefined
      ? { issues: [{ message: 'Use a whole number of 0 or more.' }], kind: 'wrong' }
      : { kind: 'value', value: count };
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
 * The lines one wrong value reports, one per issue, each naming the option, its origin, and any
 * position. The position is read and escaped as core's own validation lines read it.
 */
function wrongValueLines(subject: string, issues: readonly Issue[]): string[] {
  return issues.map((issue) => {
    const path = issuePath(issue);
    const position = path === undefined ? '' : ` at ${escapeControlCharacters(path)}`;
    return `${subject}${position}: ${issue.message}`;
  });
}

/**
 * One request answered from the file when its path leads to a value. A request the file does not
 * answer comes to nothing, and a value the option cannot take is the problem core reports.
 */
function answer(request: OptionNode, usable: UsableFile, graph: CommandGraph): Answered {
  const located = locate(request, usable);
  if (located === undefined) {
    return undefined;
  }
  const shaped = shape(request, located.value);
  if (shaped.kind === 'value') {
    return { answer: { label: located.label, value: shaped.value }, kind: 'answer' };
  }
  const spelling = reportedSpelling(request);
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
 * The value at a request's path in the file, with the label that names the path and the file, each
 * escaped for quoting, or `undefined` when the option carries no binding or the path leads to no
 * value.
 */
function locate(
  request: OptionNode,
  { file, object }: UsableFile,
): { label: string; value: unknown } | undefined {
  const binding = readExtension(request, configInput);
  if (binding === undefined) {
    return undefined;
  }
  const value = valueAt(object, binding.path.split('.'));
  return value === missing
    ? undefined
    : { label: `${escapeControlCharacters(binding.path)} in ${file.shown}`, value };
}

/**
 * Every request answered from the file, by option name. One wrong value fails the run with an
 * `InputError` that carries each wrong value as one problem, in request order, and answers nothing.
 */
function answerAll(
  requests: readonly OptionNode[],
  usable: UsableFile,
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
 * The resolver for the candidates the settings' `file` names, or, with none, for `.<app>.json`,
 * derived from the graph's name when the source runs. It finds the one file the run reads, and
 * answers each request whose path leads to a value in it. A run with no usable file answers
 * nothing, and one wrong value fails the run in place of every answer.
 */
export function configSource(
  candidates: readonly string[] | undefined,
): SourceResolver<typeof config> {
  return async ({ graph, host, options, out, requests, style }) => {
    const lookup = {
      candidates: candidates ?? [`.${graph.name}.json`],
      host,
      named: options.config,
    };
    const usable = await findFile(lookup, { out, style });
    return usable === undefined ? {} : answerAll(requests, usable, graph);
  };
}
