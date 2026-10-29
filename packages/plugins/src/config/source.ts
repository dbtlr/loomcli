import { dirname } from 'node:path';

import { escapeControlCharacters, issuePath, readExtension, reportedSpelling } from '@loomcli/core';
import type {
  ContextualStyle,
  InputProblem,
  OptionNode,
  Out,
  Plugin,
  SourceAnswer,
  SourceContext,
  SourceResolver,
  StandardSchemaV1,
} from '@loomcli/core';

import { isRecord } from '../plain-data.js';
import { configInput } from './extension.js';
import type { UsableFile } from './lookup.js';
import type { ConfigOptions } from './plugin.js';
import { loadOnce } from './shared.js';
import type { Shared } from './shared.js';

/**
 * The configuration plugin's resolver. Its rules are the plugin contract: answer every request from
 * the file the run read once it passed the schema, and name at `-v` a value the option cannot take.
 * Every sentence it writes is fixed, so the bytes are the same under Node and Bun, and no file
 * content reaches the terminal.
 */

/** One issue of a wrong value, as the problem's `issues` carry it. */
type Issue = Extract<InputProblem, { reason: 'invalid' }>['issues'][number];

/** A value read at a request's path: one the option takes, or the issues that say why not. */
type Shaped =
  | { kind: 'value'; value: string | boolean | number | readonly string[] }
  | { kind: 'wrong'; issues: readonly Issue[] };

/** What one request came to: an answer, a value the option cannot take with its `-v` lines, or nothing. */
type Answered =
  | { kind: 'answer'; answer: SourceAnswer }
  | { kind: 'ignored'; lines: readonly string[] }
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
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
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

/** How the run received its inputs, which decides how a line names its option. */
type InvokedBy = SourceContext['invokedBy'];

/**
 * The lines one value the option cannot take writes at `-v`, one per issue, in core's form for a
 * dropped fill: the option by its reported spelling, any position, the label, and the message. The
 * position is read and escaped as core's own lines read it.
 */
function ignoredLines(
  subject: { label: string; spelling: string },
  issues: readonly Issue[],
  style: ContextualStyle,
): string[] {
  return issues.map((issue) => {
    const path = issuePath(issue);
    const position = path === undefined ? '' : ` at ${escapeControlCharacters(path)}`;
    return `Ignored option "${subject.spelling}"${position} from ${style.escape(subject.label)}: ${issue.message}`;
  });
}

/**
 * One request answered from the file when its path leads to a value. A request the file does not
 * answer comes to nothing, and a value the option cannot take comes to its `-v` lines and no answer,
 * which names the option as core does: by its reported spelling, or, in an invocation by name, by
 * its declared name.
 */
function answer(
  request: OptionNode,
  usable: UsableFile,
  scene: { invokedBy: InvokedBy; style: ContextualStyle },
): Answered {
  const located = locate(request, usable);
  if (located === undefined) {
    return undefined;
  }
  const shaped = shape(request, located.value);
  if (shaped.kind === 'value') {
    return {
      answer: {
        directory: dirname(usable.file.path),
        label: located.label,
        value: shaped.value,
      },
      kind: 'answer',
    };
  }
  const spelling = scene.invokedBy === 'name' ? request.name : reportedSpelling(request);
  return {
    kind: 'ignored',
    lines: ignoredLines({ label: located.label, spelling }, shaped.issues, scene.style),
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
 * Every request answered from the file, by option name. A value an option cannot take writes its
 * lines at `-v` and answers nothing.
 */
async function answerAll(
  requests: readonly OptionNode[],
  usable: UsableFile,
  scene: { invokedBy: InvokedBy; out: Out; style: ContextualStyle },
): Promise<Record<string, SourceAnswer>> {
  const answers: Record<string, SourceAnswer> = {};
  for (const request of requests) {
    const outcome = answer(request, usable, scene);
    if (outcome?.kind === 'answer') {
      answers[request.name] = outcome.answer;
    }
    for (const line of outcome?.kind === 'ignored' ? outcome.lines : []) {
      await scene.out.debug(line);
    }
  }
  return answers;
}

/**
 * The resolver for the call's settings and schema. It answers each request whose path leads to a
 * value in the file the run read, once the file passed the schema, so a value the schema removed
 * fills nothing. A value the option cannot take writes its lines at `-v` and answers nothing.
 */
export function configSource<Schema extends StandardSchemaV1, Directory extends string>(
  shared: Shared<Schema>,
): SourceResolver<Plugin<ConfigOptions<Directory>>> {
  return async ({ graph, host, invokedBy, options, out, requests, style }) => {
    const { usable } = await loadOnce(shared, { graph, host, invokedBy, options, out, style });
    return usable === undefined ? {} : answerAll(requests, usable, { invokedBy, out, style });
  };
}
