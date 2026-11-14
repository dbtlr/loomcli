import { DeclarationError, escapeControlCharacters, InputError } from '@loomcli/core';
import type { GraphBuiltHook, InputProblem } from '@loomcli/core';

import { configStrictPath, configStrictSchemaPath } from '../rules.js';
import type { Step } from './drop.js';
import { reach } from './links.js';
import { configIdentity as identity, dottedPath } from './names.js';

/**
 * The strict setting: which values of the file fail the run instead of dropping, and the failure
 * they raise. The rules are the plugin contract's "The strict setting".
 */

/** No entry: the length of an empty list. */
const none = 0;

/** The `strict` setting as the author wrote it: every value, or the dotted key paths. */
type StrictSetting = boolean | readonly [string, ...string[]];

/** What the call fixed: whether every value is covered, and the paths of a list, as keys. */
interface Strictness {
  readonly everything: boolean;
  /** The listed paths as the author wrote them. */
  readonly listed: readonly string[];
  /** Each listed path split into its keys. */
  readonly keys: readonly (readonly string[])[];
}

/** The fault of a `strict` setting that is not `true`, `false`, or a list of dotted paths. */
function pathFault(settings: unknown, mark: string): DeclarationError {
  return new DeclarationError(configStrictPath, {
    correction: 'List dotted paths of nonempty keys, such as delivery or delivery.webhook.',
    findings: [{ arguments: [settings], call: 'configuration', mark }],
    sentence: `Plugin "${identity}" strict lists a path that is not a dotted path of nonempty keys.`,
  });
}

/** The paths a list holds, each judged. A list entry that is not a dotted path throws, marking it. */
function listedPaths(strict: readonly unknown[], settings: unknown): string[] {
  return strict.map((entry, index) => {
    if (typeof entry !== 'string' || !dottedPath.test(entry)) {
      throw pathFault(settings, `0.strict.${String(index)}`);
    }
    return entry;
  });
}

/**
 * What the settings' `strict` covers, judged once at the call. A list entry that is not a dotted
 * path of nonempty keys throws, marking the first one.
 */
function judgeStrict(settings: { readonly strict?: StrictSetting }): Strictness {
  const { strict } = settings;
  if (strict === undefined || strict === false) {
    return { everything: false, keys: [], listed: [] };
  }
  if (strict === true) {
    return { everything: true, keys: [], listed: [] };
  }
  if (!Array.isArray(strict)) {
    throw pathFault(settings, '0.strict');
  }
  const listed = listedPaths(strict, settings);
  return { everything: false, keys: listed.map((path) => path.split('.')), listed };
}

/**
 * Whether a path in the file is at or under a listed path: the listed path's keys are its first
 * steps, each an object key. An array item's index equals no key, and a path with no steps is under
 * no listed path.
 */
function covers(strictness: Strictness, path: readonly Step[]): boolean {
  return (
    strictness.everything ||
    strictness.keys.some(
      (keys) => keys.length <= path.length && keys.every((key, index) => path[index] === key),
    )
  );
}

/** Whether a linked option is covered: `strict` is `true`, or its path is at or under a listed one. */
function coversLink(strictness: Strictness, linkPath: string): boolean {
  return covers(strictness, linkPath.split('.'));
}

/** A period unless the message already ends in one, as the `empty-file` sentence adds one. */
function stopped(message: string): string {
  const text = escapeControlCharacters(message);
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

/** The place a line names: ` in <file>`, or nothing when the run read no file. */
function placeOf(file: string | undefined): string {
  return file === undefined ? '' : ` in ${file}`;
}

/**
 * The line for a value the schema rejected. A removal with no path removed every key, and its line
 * names the file. `file` is the file as its labels show it, already escaped.
 */
function valueLine(
  removal: { readonly path: string | undefined; readonly message: string },
  file: string | undefined,
): string {
  const { message, path } = removal;
  if (path === undefined) {
    return `Configuration file${file === undefined ? '' : ` ${file}`}: ${stopped(message)} Correct the file, or remove it.`;
  }
  return `Configuration value ${escapeControlCharacters(path)}${placeOf(file)}: ${stopped(message)} Correct the value, or remove it.`;
}

/** The line for an unknown key. */
function unknownLine(path: string, file: string | undefined): string {
  return `Unknown key ${escapeControlCharacters(path)}${placeOf(file)}. Check its spelling, or remove it.`;
}

/** One linked option's value the source could not take, as the failure holds it. */
interface LinkedProblem {
  readonly problem: Extract<InputProblem, { reason: 'invalid' }>;
  /** One line for each issue, in core's form for a filled value. */
  readonly lines: readonly string[];
}

/**
 * The failure a strict read raises: an `InputError` with code 2, the class of a broken `--config`
 * file. Its first problem, present when the file held a covered value or key, names `--config`
 * and carries one issue for each line, and each covered linked option follows as its own problem.
 */
function strictFailure(
  fileLines: readonly string[],
  linked: readonly LinkedProblem[],
  invokedBy: 'argv' | 'name',
): InputError {
  const spelling = invokedBy === 'name' ? 'config' : '--config';
  const file: InputProblem[] =
    fileLines.length === none
      ? []
      : [
          {
            input: { global: true, kind: 'option', name: 'config' },
            issues: fileLines.map((message) => ({ message })),
            reason: 'invalid',
            spelling,
          },
        ];
  const lines = [...fileLines, ...linked.flatMap((entry) => entry.lines)];
  return new InputError(lines.join('\n'), [...file, ...linked.map((entry) => entry.problem)]);
}

/**
 * The `onGraphBuilt` judgment of the listed paths: where the graph holds the configuration's
 * shape, each path's keys must be ones the shape holds, in list order. A key the shape leaves
 * unchecked passes.
 */
function judgeStrictPaths(strictness: Strictness): GraphBuiltHook {
  return (graph) => {
    const shape = graph.configuration?.schema;
    if (shape === undefined || shape === null) {
      return undefined;
    }
    for (const [index, path] of strictness.listed.entries()) {
      if (reach(path, shape).kind === 'missing') {
        throw new DeclarationError(configStrictSchemaPath, {
          correction: 'List a path the schema describes, or add the key to the schema.',
          findings: [
            {
              arguments: [{ strict: strictness.listed }],
              call: 'configuration',
              mark: `0.strict.${String(index)}`,
            },
          ],
          sentence: `Plugin "${identity}" strict lists ${escapeControlCharacters(path)}, which the configuration schema does not hold.`,
        });
      }
    }
    return undefined;
  };
}

export { covers, coversLink, judgeStrict, judgeStrictPaths, strictFailure, unknownLine, valueLine };
export type { LinkedProblem, StrictSetting, Strictness };
