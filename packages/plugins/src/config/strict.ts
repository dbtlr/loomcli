import { DeclarationError, escapeControlCharacters, InputError, phrasedIssue } from '@loomcli/core';
import type { GraphBuiltHook, InputProblem, Phrase } from '@loomcli/core';

import { isRecord } from '../plain-data.js';
import { configStrictPath, configStrictSchemaPath } from '../rules.js';
import type { Removal, Step } from './drop.js';
import { isArrayShape, leavesOf, stepInto } from './links.js';
import type { Shape, ShapeStep } from './links.js';
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

/** Whether the setting is on at all, `true` or a list, so a broken discovered file fails the run. */
function isStrict(strictness: Strictness): boolean {
  return strictness.everything || strictness.listed.length > none;
}

/** Whether a linked option is covered: `strict` is `true`, or its path is at or under a listed one. */
function coversLink(strictness: Strictness, linkPath: string): boolean {
  return covers(strictness, linkPath.split('.'));
}

/** Whether the file holds a value at a listed path's keys, each an own key of an object. */
function holdsAt(file: unknown, keys: readonly string[]): boolean {
  let node = file;
  for (const key of keys) {
    if (!isRecord(node) || !Object.hasOwn(node, key)) {
      return false;
    }
    node = node[key];
  }
  return true;
}

/**
 * Whether a removal fails the run: an issue behind it names a path at or under a listed path, or the
 * removal discards a value the file holds at a listed path. `file` is the file of the round that
 * removes it.
 */
function coversRemoval(
  strictness: Strictness,
  removal: Removal,
  file: Readonly<Record<string, unknown>>,
): boolean {
  if (strictness.everything || removal.issuePaths.some((path) => covers(strictness, path))) {
    return true;
  }
  return strictness.keys.some(
    (keys) =>
      removal.path.length <= keys.length &&
      removal.path.every((step, index) => step === keys[index]) &&
      holdsAt(file, keys),
  );
}

/** One linked option's value the source could not take, as the failure holds it. */
interface LinkedProblem {
  readonly problem: Extract<InputProblem, { reason: 'invalid' }>;
  /** One line for each issue, in core's form for a filled value. */
  readonly lines: readonly Phrase[];
}

/**
 * The failure a strict read raises: an `InputError` with code 2, the class of a broken `--config`
 * file. Its first problem, present when the file held a covered value or key, names `--config`
 * and carries one issue for each line, and each covered linked option follows as its own problem.
 */
function strictFailure(
  fileLines: readonly Phrase[],
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
            issues: fileLines.map((line) => phrasedIssue(line)),
            reason: 'invalid',
            spelling,
          },
        ];
  const lines = [...fileLines, ...linked.flatMap((entry) => entry.lines)];
  return new InputError(lines, [...file, ...linked.map((entry) => entry.problem)]);
}

/**
 * What a listed path's walk through the shape came to: a path the shape holds or leaves unchecked,
 * a key it does not hold, or an array met before a key no member that is not an array holds or
 * leaves unchecked, with the array's own path.
 */
type Walked = { kind: 'passes' } | { kind: 'missing' } | { kind: 'array'; array: string };

/**
 * One key of a listed path's walk, as a link's key is followed. Where a shape describes an array,
 * the walk goes on through its members that are not arrays when one of them holds the key or leaves
 * it unchecked, and otherwise the path passes through the array.
 */
function stepListed(
  leaves: readonly Shape[],
  key: string,
  root: Shape,
): ShapeStep | { kind: 'array' } {
  if (!leaves.some(isArrayShape)) {
    return stepInto(leaves, key, root);
  }
  const step = stepInto(
    leaves.filter((leaf) => !isArrayShape(leaf)),
    key,
    root,
  );
  return step.kind === 'missing' ? { kind: 'array' } : step;
}

/** Follows a listed path's keys through the shape, as a link's path is followed. */
function walkListed(path: string, shape: Shape): Walked {
  const keys = path.split('.');
  let leaves = leavesOf(shape, shape);
  for (const [index, key] of keys.entries()) {
    const step = stepListed(leaves, key, shape);
    if (step.kind === 'array') {
      return { array: keys.slice(none, index).join('.'), kind: 'array' };
    }
    if (step.kind !== 'held') {
      return step.kind === 'missing' ? step : { kind: 'passes' };
    }
    leaves = step.next;
  }
  return { kind: 'passes' };
}

/** The fault of a listed path the shape cannot cover, or `undefined` when it passes. */
function listedFault(
  walked: Walked,
  path: string,
  finding: { arguments: unknown[]; call: string; mark: string },
): DeclarationError | undefined {
  if (walked.kind === 'passes') {
    return undefined;
  }
  const listed = escapeControlCharacters(path);
  return walked.kind === 'missing'
    ? new DeclarationError(configStrictSchemaPath, {
        correction: 'List a path the schema describes, or add the key to the schema.',
        findings: [finding],
        sentence: `Plugin "${identity}" strict lists ${listed}, which the configuration schema does not hold.`,
      })
    : new DeclarationError(configStrictSchemaPath, {
        correction: "List the array's own path, which covers every item.",
        findings: [finding],
        sentence: `Plugin "${identity}" strict lists ${listed}, which passes through the array at ${escapeControlCharacters(walked.array)}.`,
      });
}

/**
 * The `onGraphBuilt` judgment of the listed paths: where the graph holds the configuration's
 * shape, each path's keys must be ones the shape holds, in list order. None may pass through an
 * array unless a member of the same shape that is not an array holds the next key or leaves it
 * unchecked. A key the shape leaves unchecked passes.
 */
function judgeStrictPaths(strictness: Strictness): GraphBuiltHook {
  return (graph) => {
    const shape = graph.configuration?.schema;
    if (shape === undefined || shape === null) {
      return undefined;
    }
    for (const [index, path] of strictness.listed.entries()) {
      const fault = listedFault(walkListed(path, shape), path, {
        arguments: [{ strict: strictness.listed }],
        call: 'configuration',
        mark: `0.strict.${String(index)}`,
      });
      if (fault !== undefined) {
        throw fault;
      }
    }
    return undefined;
  };
}

export {
  covers,
  coversLink,
  coversRemoval,
  isStrict,
  judgeStrict,
  judgeStrictPaths,
  strictFailure,
};
export type { LinkedProblem, StrictSetting, Strictness };
