import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { InputSite } from '../diagnostics/facts.js';
import { partOf, siteFinding } from '../diagnostics/facts.js';
import { validatorFailed } from '../diagnostics/rules.js';
import { asSentence, DeclarationError, InputError, reasonOf } from '../failures/errors.js';
import type { InputProblem } from '../failures/errors.js';
import type { Host } from '../host/types.js';
import type { Content } from './content.js';
import { prepareContent } from './content.js';
import { schemaOptions } from './context.js';
import { declarationSubject, identityOf, scoped } from './declarations.js';
import type {
  DeclaredValues,
  InputDeclaration,
  Invocation,
  OptionInput,
  ScopedInput,
  ScopedInputs,
} from './declarations.js';
import { ValidatedInputs } from './ledger.js';
import type { Report } from './ledger.js';
import {
  environmentBoolean,
  environmentCount,
  environmentTuple,
  ignoredFill,
  issueLine,
  silentRejection,
  stdinIssue,
} from './messages.js';
import type { InputSubject, LogLineText } from './messages.js';
import { absentBooleans, groupReports } from './option-groups.js';
import { arityOf, booleanValue, copyValues, withdrawFill } from './options.js';
import type { OptionValues } from './options.js';
import { rememberReceived } from './received.js';
import {
  collects,
  freshDeclaredValue,
  holdsTupleList,
  missingMessage,
  spellingOf,
  suppliedInputs,
  suppliedName,
  suppliedOption,
  validatesOmission,
  wordsOf,
} from './supplied.js';
import type { SuppliedInputs, ValidationContext } from './types.js';

/**
 * One issue a validator returned, checked where it enters. Core keeps every own enumerable field
 * the issue carries and rewrites only `path`, reducing each segment to its key, so a field core
 * never reads, such as a validator's issue code, reaches a failure view unchanged.
 */
function readIssue(issue: unknown): StandardSchemaV1.Issue {
  if (issue === null || typeof issue !== 'object' || !('message' in issue)) {
    throw new Error('The validator returned an invalid Standard Schema issue.');
  }
  const message = issue.message;
  if (typeof message !== 'string') {
    throw new Error('The validator returned an invalid Standard Schema issue message.');
  }
  const suppliedPath = 'path' in issue ? issue.path : undefined;
  if (suppliedPath === undefined) {
    return { ...issue, message };
  }
  if (!Array.isArray(suppliedPath)) {
    throw new Error('The validator returned an invalid Standard Schema issue path.');
  }
  const path = Array.from(suppliedPath, (segment: unknown) => {
    const key =
      segment !== null && typeof segment === 'object' && 'key' in segment ? segment.key : segment;
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
      throw new Error('The validator returned an invalid Standard Schema path key.');
    }
    return key;
  });
  return { ...issue, message, path };
}

/**
 * A broken validator is a fault in the declaration, whichever value reached it, so its diagnostic
 * names the declaration and its finding marks the validator on the call at `place`. Returned issues
 * belong to the value, so the caller names those.
 */
export async function validate(
  input: InputDeclaration,
  raw: unknown,
  call: { context: ValidationContext; site: InputSite | undefined },
): Promise<StandardSchemaV1.Result<unknown>> {
  const { context, site } = call;
  const validator = input.config.validate;
  if (validator === undefined) {
    return { value: raw };
  }
  try {
    const result: unknown = await validator['~standard'].validate(raw, schemaOptions(context));
    if (result === null || typeof result !== 'object') {
      throw new Error('The validator returned an invalid Standard Schema result.');
    }
    const issues = 'issues' in result ? result.issues : undefined;
    if (issues === undefined && 'value' in result) {
      return { value: result.value };
    }
    if (!Array.isArray(issues)) {
      throw new Error('The validator returned an invalid Standard Schema result.');
    }
    return { issues: Array.from(issues, readIssue) };
  } catch (error) {
    // The reason is the author's detail: a distributed build shows the generic defect message.
    throw new DeclarationError(
      validatorFailed,
      {
        correction: 'Fix the validator.',
        findings: site === undefined ? [] : [siteFinding(site, partOf(site, 'validate'))],
        sentence: `${declarationSubject(input)} validator failed unexpectedly: ${asSentence(reasonOf(error))}`,
      },
      { cause: error },
    );
  }
}

/**
 * Where a bare spelling supplied a string option's implied value among the values it collected,
 * and the output its validator gave that value before any token was read.
 */
interface ImpliedPositions {
  readonly output: unknown;
  readonly positions: readonly number[];
}

/**
 * Where a bare spelling supplied one option's implied value, with that value's prepared output, or
 * `undefined` when no bare spelling supplied it.
 */
function impliedPositions(
  input: InputDeclaration,
  read: { declaredValues: DeclaredValues; options: OptionValues },
): ImpliedPositions | undefined {
  const positions = input.kind === 'option' ? read.options.implied.get(input.name) : undefined;
  return positions === undefined
    ? undefined
    : { output: read.declaredValues.implied.get(input), positions };
}

/** The outputs and the issues of one list of values, each passed through the validator alone. */
interface EachValidated {
  readonly issues: StandardSchemaV1.Issue[];
  readonly outputs: unknown[];
}

/**
 * Each value of one list through the validator in order. Each issue reads at its value's position
 * after `prefix` and before its own path. A position a bare spelling filled reuses the implied
 * value's prepared output, and a cancelled run starts no further call.
 */
async function validateEach(
  input: InputDeclaration,
  values: readonly unknown[],
  call: {
    context: () => ValidationContext;
    site: InputSite | undefined;
    signal?: AbortSignal | undefined;
    implied?: ImpliedPositions | undefined;
    prefix: readonly PropertyKey[];
  },
): Promise<EachValidated> {
  const { context, implied, prefix, signal, site } = call;
  const outputs: unknown[] = [];
  const issues: StandardSchemaV1.Issue[] = [];
  for (const [position, value] of values.entries()) {
    if (signal?.aborted) {
      // A cancelled run starts no further call; the run resolves its cancellation code instead.
      break;
    }
    // A bare occurrence holds the implied value, whose output was prepared before any token.
    const result =
      implied?.positions.includes(position) === true
        ? { value: freshDeclaredValue(implied.output) }
        : await validate(input, value, { context: context(), site });
    if (result.issues === undefined) {
      outputs.push(result.value);
    } else {
      // The issue keeps its own fields, and only its path gains the value's position.
      for (const issue of reported(result.issues)) {
        issues.push({ ...issue, path: [...prefix, position, ...(issue.path ?? [])] });
      }
    }
  }
  return { issues, outputs };
}

/**
 * The raw value of one input that collects, checked to be the array the parser, the input sources,
 * and a default the types shape only ever supply.
 */
function arrayOf(input: InputDeclaration, raw: unknown): readonly unknown[] {
  if (!Array.isArray(raw)) {
    throw new TypeError(
      `${declarationSubject(input)} reached validation without an array of values.`,
    );
  }
  return raw;
}

/**
 * An arity option's words through the validator, one call per word in supplied order. Each issue
 * reads at the word's position, after its occurrence's position on a multiple option, so the
 * action receives a tuple of outputs, or a list of them.
 */
async function validateWords(
  input: InputDeclaration,
  raw: unknown,
  call: {
    context: () => ValidationContext;
    site: InputSite | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<StandardSchemaV1.Result<unknown>> {
  const multiple = collects(input);
  const tuples = multiple ? arrayOf(input, raw) : [raw];
  const outputs: unknown[] = [];
  const issues: StandardSchemaV1.Issue[] = [];
  for (const [occurrence, tuple] of tuples.entries()) {
    const prefix = multiple ? [occurrence] : [];
    const each = await validateEach(input, arrayOf(input, tuple), { ...call, prefix });
    outputs.push(each.outputs);
    issues.push(...each.issues);
  }
  if (issues.length > 0) {
    return { issues };
  }
  return { value: multiple ? outputs : outputs[0] };
}

/**
 * One validation of a declared value. A multiple option or a variadic argument passes each of its
 * values through the validator in order, and each issue reads at its value's position before its
 * own path, so the action receives the array of outputs. An arity option passes each word alike.
 * Every other input passes its value once.
 * A bare spelling's implied value never meets the validator here: its output was prepared before
 * any token, so a scalar that a bare spelling supplied, and each bare occurrence in a multiple
 * option's list, reuse a copy of that output in place. Each call reads a fresh context whose
 * arrays are copies, so a write to them never reaches the next call. The host is the one captured
 * object that every call and the action share.
 */
export async function validateDeclared(
  input: InputDeclaration,
  raw: unknown,
  call: {
    context: () => ValidationContext;
    site: InputSite | undefined;
    signal?: AbortSignal;
    implied?: ImpliedPositions | undefined;
  },
): Promise<StandardSchemaV1.Result<unknown>> {
  const { context, implied, signal, site } = call;
  if (!collects(input) && implied?.positions.includes(0) === true) {
    // A bare spelling supplied the implied value, whose output was prepared before any token.
    return { value: freshDeclaredValue(implied.output) };
  }
  if (input.config.validate === undefined) {
    return validate(input, raw, { context: context(), site });
  }
  if (input.kind === 'option' && arityOf(input.config) !== undefined) {
    return validateWords(input, raw, { context, signal, site });
  }
  if (!collects(input)) {
    return validate(input, raw, { context: context(), site });
  }
  // The parser, the input sources, and a default the types shape only ever supply an array here.
  const values = arrayOf(input, raw);
  const { issues, outputs } = await validateEach(input, values, {
    context,
    implied,
    prefix: [],
    signal,
    site,
  });
  return issues.length === 0 ? { value: outputs } : { issues };
}

/**
 * The dotted path an issue names inside a value, or `undefined` when the issue names the value
 * itself. Core's default text and an application's own view read a position through this one
 * helper, so a rejected item reads alike wherever its diagnostic is written.
 *
 * @example
 * ```ts
 * import { issuePath } from '@loomcli/core';
 * import type { StandardSchemaV1 } from '@loomcli/core';
 *
 * export function describeIssue(issue: StandardSchemaV1.Issue): string {
 *   const path = issuePath(issue);
 *   return path === undefined ? issue.message : `${path}: ${issue.message}`;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/validation.md#issues-and-validator-failures
 * @public
 */
export function issuePath(issue: StandardSchemaV1.Issue): string | undefined {
  const path = issue.path
    ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
  return path === undefined || path === '' ? undefined : path;
}

/**
 * The issues one rejection reports. A validator that returned none still rejected the value, so the
 * placeholder stands in for its silence. Reporting takes this list once: the reported problem
 * carries it and the default text is derived from it, so a view and core read the same issues.
 */
export function reported(
  issues: readonly StandardSchemaV1.Issue[],
): readonly StandardSchemaV1.Issue[] {
  return issues.length === 0 ? [{ message: silentRejection }] : issues;
}

/**
 * One line per issue under the input's subject. A path segment can hold text the operator typed,
 * such as a key of a record, so the line escapes the path; `issuePath` keeps it raw for a view.
 */
export function messages(subject: InputSubject, issues: readonly StandardSchemaV1.Issue[]) {
  return issues.map((issue) => issueLine(subject, issuePath(issue), issue.message));
}

/**
 * The one issue a variable outside its option's grammar reports: the Boolean grammar, the count
 * grammar of ASCII decimal digits, or an arity option's count of items its delimiter separates.
 */
function grammarIssues(input: OptionInput): readonly StandardSchemaV1.Issue[] {
  const { config } = input;
  const arity = arityOf(config);
  if (arity !== undefined) {
    const delimiter = config.type === 'string' ? (config.envDelimiter ?? '') : '';
    return [{ message: environmentTuple(arity, delimiter) }];
  }
  return config.type === 'count'
    ? [{ message: environmentCount }]
    : [{ message: environmentBoolean }];
}

/** A stdin declaration is not a token slot, but its problems retain its authoring position. */
function orderedReports(
  inputs: ScopedInputs,
  reports: ReadonlyMap<InputDeclaration, Report>,
  standalone: { position: number | undefined; report: Report | undefined },
): Report[] {
  if (standalone.report === undefined) {
    return [...reports.values()];
  }
  const preceding = new Set([
    ...inputs.globals,
    ...inputs.locals.filter(
      (_input, index) => index < (standalone.position ?? inputs.locals.length),
    ),
  ]);
  const before: Report[] = [];
  const after: Report[] = [];
  for (const [input, report] of reports) {
    (preceding.has(input) ? before : after).push(report);
  }
  return [...before, standalone.report, ...after];
}

/**
 * What one validation pass produced: every value its validator accepted, each input's report in
 * reporting order, and those reports aggregated into one failure, or `undefined` when there were
 * none. A pass that found problems still answers with the values it accepted, so a reader of the
 * global options keeps them when only a local input was rejected.
 */
export interface Validation {
  /**
   * The configuration fills the option's validator rejected. Each reads as unfilled in this pass,
   * and the caller withdraws it and names it.
   */
  readonly dropped: ReadonlyMap<InputDeclaration, LogLineText>;
  readonly stdin: Content | undefined;
  readonly failure: InputError | undefined;
  readonly reports: ReadonlyMap<InputDeclaration, Report>;
  readonly values: ValidatedInputs;
}

/**
 * Whether a pass rejected a global option, which leaves no global value a middleware may read. A
 * global option declares no presence rule, so every problem it reports is a rejected value.
 */
export function rejectsGlobal(validation: Validation): boolean {
  return (
    validation.failure?.problems.some((problem) => 'input' in problem && problem.input.global) ??
    false
  );
}

/**
 * Validates one invocation in reporting order: the global options, the application's and then each
 * plugin's, and then the routed Command's own declarations, each in authoring order.
 */
export async function validateValues(invocation: Invocation): Promise<Validation> {
  const { declaredValues, ledger, sources, supplied } = invocation;
  const { defaults } = declaredValues;
  const declarations = scoped(invocation.inputs);
  /** Where a filled option's value came from, which its diagnostic names; argv names none. */
  const originOf = (input: InputDeclaration) =>
    input.kind === 'option' ? sources.labels.get(input.name) : undefined;
  /**
   * One reading of the tokens and the route, built anew for each validator call. The route, the
   * tail, and every collected value are copies, so a validator that writes to them reaches neither
   * the parser's collections, nor the tail the action receives, nor the next validator call of
   * this invocation. Each copy is made on its first read and kept for the call, so a validator
   * that never reads one never pays for it, however many values a list holds. The host is the
   * captured object itself, the one the action receives.
   */
  const hostFor = ({ input }: ScopedInput): Host => {
    const directory =
      input.kind === 'option' ? sources.fills?.get(input.name)?.directory : undefined;
    // A dropped fill reads as unfilled, so its omission reads the run's own working directory.
    // The derived host reads every other member, getters included, from the run's own.
    return directory === undefined || dropped.has(input)
      ? invocation.host
      : Object.create(invocation.host, { cwd: { enumerable: true, value: directory } });
  };
  const contextOf = (entry: ScopedInput): ValidationContext => {
    const copies: {
      command?: readonly string[];
      passthrough?: readonly string[];
      supplied?: SuppliedInputs;
    } = {};
    return {
      get command() {
        copies.command ??= [...invocation.command];
        return copies.command;
      },
      host: hostFor(entry),
      input: identityOf(entry),
      get passthrough() {
        copies.passthrough ??= [...invocation.passthrough];
        return copies.passthrough;
      },
      phase: 'invocation',
      get supplied() {
        copies.supplied ??= suppliedInputs(
          declarations.map((declared) => declared.input),
          supplied,
        );
        return copies.supplied;
      },
    };
  };
  const values = new Map<InputDeclaration, unknown>();
  /** Each dropped configuration fill with the `-v` log line that names it. */
  const dropped = new Map<InputDeclaration, LogLineText>();
  // Each input reports at most once, so insertion order is the order this phase reaches them.
  const reports = new Map<InputDeclaration, Report>();
  /**
   * One missing input, in the order this phase reaches it, unless a skipped configuration source
   * would have been asked to fill it.
   */
  const omit = (entry: ScopedInput, spelling: string, line: string) => {
    if (sources.unanswered?.has(entry.input) === true) {
      return;
    }
    reports.set(entry.input, {
      lines: [line],
      problem: { input: identityOf(entry), reason: 'missing', spelling },
    });
  };
  /** One rejected input, whatever rejected it, in the order this phase reaches it. */
  const reject = (
    entry: ScopedInput,
    issues: readonly StandardSchemaV1.Issue[],
    subject: InputSubject & { raw?: unknown },
  ) => {
    const problem: InputProblem = {
      input: identityOf(entry),
      issues,
      reason: 'invalid',
      spelling: spellingOf(entry.input, invocation),
    };
    rememberReceived(problem, subject.raw);
    reports.set(entry.input, { lines: messages(subject, issues), problem });
  };
  /** One path for every value a validator reads, so a raw shape and its issues meet it once. */
  const accept = async (
    entry: ScopedInput,
    raw: unknown,
    named: { origin: string | undefined; spelling: string },
  ) => {
    const { origin, spelling } = named;
    const result = await validateDeclared(entry.input, raw, {
      context: () => contextOf(entry),
      implied: impliedPositions(entry.input, { declaredValues, options: supplied.options }),
      signal: invocation.signal,
      site: invocation.places.get(entry.input),
    });
    if (result.issues === undefined) {
      values.set(entry.input, result.value);
      return;
    }
    const issues = reported(result.issues);
    if (dropsFill(entry, issues, { origin, spelling })) {
      // A configuration fill its validator rejects falls back, as if no tier had supplied it.
      await absent(entry, spelling, true);
      return;
    }
    reject(entry, issues, { ...suppliedName(entry.input, spelling, origin), raw });
  };
  /**
   * Drops a value the configuration source filled, recording the `-v` log line that names its
   * first issue, and says whether it did. A value from any other tier, and a strict fill, is never dropped.
   */
  const dropsFill = (
    entry: ScopedInput,
    issues: readonly StandardSchemaV1.Issue[],
    named: { origin: string | undefined; spelling: string },
  ): boolean => {
    const { input } = entry;
    if (
      named.origin === undefined ||
      input.kind !== 'option' ||
      sources.fills?.has(input.name) !== true ||
      sources.fills.get(input.name)?.strict === true
    ) {
      return false;
    }
    const [first] = issues;
    const path = first === undefined ? undefined : issuePath(first);
    dropped.set(
      entry.input,
      ignoredFill({ label: named.origin, spelling: named.spelling }, path, String(first?.message)),
    );
    return true;
  };
  /** One input no tier supplied, or whose configuration fill was dropped: its default, or its absence rule. */
  /** Whether this run requires a value for the input: always, or only when it is not interactive. */
  const requires = (input: ScopedInput['input']) =>
    input.config.required === true ||
    (input.config.required === 'non-interactive' && !invocation.interactive);
  const absent = async (entry: ScopedInput, spelling: string, fellBack: boolean) => {
    const { input } = entry;
    const collected = collects(input);
    if (requires(input)) {
      // An omitted required argument arrives here too, so omission has one class.
      // One aggregated diagnostic covers an omitted argument and an omitted option alike.
      omit(entry, spelling, missingMessage(input, spelling, { collected }));
    } else if (collected && !defaults.has(input)) {
      // No occurrence has no value to validate, so the action receives an empty array.
      values.set(input, []);
    } else if (validatesOmission(input) && (fellBack || sources.unanswered?.has(input) !== true)) {
      // The flag sends the omission itself to the validator.
      // An option a skipped configuration source would have filled is not judged absent.
      // An absence rule reads the context a supplied value reads, and reports input issues.
      await accept(entry, undefined, { origin: undefined, spelling });
    } else {
      values.set(input, freshDeclaredValue(defaults.get(input), holdsTupleList(input)));
    }
  };
  /** One declaration's outcome: what an earlier pass settled, or this pass's own. */
  const settle = async (entry: ScopedInput) => {
    const { input } = entry;
    const variable = sources.rejected.get(input.name);
    const earlier = ledger.report(input);
    const unlowered = invocation.named?.unlowered.get(input);
    if (ledger.values.has(input)) {
      // An earlier pass validated this value once, and one value meets its validator once.
      values.set(input, ledger.values.read(input));
    } else if (earlier !== undefined) {
      // The earlier pass's problem reports here, in this pass's order.
      reports.set(input, earlier);
    } else if (ledger.threw(input)) {
      // Its validator threw in an earlier pass, so it settles nothing and is never called again.
    } else if (unlowered !== undefined) {
      // A value no token spells supplied nothing, and the caller's value is the input's problem.
      reject(entry, [{ message: unlowered }], suppliedName(input, input.name));
    } else if (input.kind === 'option' && variable !== undefined) {
      // A variable outside its option's grammar filled nothing, so it is the option's problem.
      reject(
        entry,
        grammarIssues(input),
        suppliedName(input, spellingOf(input, invocation), variable),
      );
    } else if (input.kind === 'option' && input.config.type === 'boolean') {
      values.set(input, booleanValue(supplied.options, input.name, input.config));
    } else if (input.kind === 'option' && input.config.type === 'count') {
      // A count passes no validator, and no occurrence and no source reads 0.
      values.set(input, supplied.options.counts.get(input.name) ?? 0);
    } else {
      const collected = collects(input);
      const spelling = spellingOf(input, invocation);
      const raw =
        input.kind === 'argument'
          ? supplied.args.get(input)
          : suppliedOption(supplied.options, input, collected);
      if (input.config.type === 'content') {
        const { config } = input;
        // A content option takes one word per occurrence, so it holds no tuple.
        const words =
          input.kind === 'argument'
            ? supplied.args.get(input)
            : wordsOf(supplied.options, input.name, collected);
        // A relative path a configuration file holds reads against that file's directory.
        const prepare = async (from: typeof words) =>
          prepareContent(from, config, {
            collected,
            host: hostFor(entry),
            named: invocation.named !== undefined,
            signal: invocation.signal,
          });
        const prepared = await prepare(words);
        // A configuration path its content option cannot read falls back, as if no tier had supplied it.
        const result =
          prepared.issues !== undefined &&
          prepared.missing !== true &&
          dropsFill(entry, prepared.issues, { origin: originOf(input), spelling })
            ? await prepare(undefined)
            : prepared;
        if (result.issues === undefined) {
          values.set(input, result.value);
        } else if (result.missing) {
          omit(entry, spelling, messages(suppliedName(input, spelling), result.issues).join('\n'));
        } else {
          const origin = dropped.has(input) ? undefined : originOf(input);
          reject(entry, result.issues, { ...suppliedName(input, spelling, origin), raw: words });
        }
      } else if (raw === undefined) {
        await absent(entry, spelling, false);
      } else if (requires(input) && Array.isArray(raw) && raw.length === 0) {
        // A filled list satisfies the at-least-one rule by its length, so an empty one is missing.
        omit(
          entry,
          spelling,
          missingMessage(input, spelling, { collected, origin: originOf(input) }),
        );
      } else {
        await accept(entry, raw, { origin: originOf(input), spelling });
      }
    }
  };
  const { only } = invocation;
  const validated = only ? declarations.filter(({ input }) => only.has(input)) : declarations;
  for (const entry of validated) {
    if (invocation.signal.aborted) {
      /**
       * A cancelled run starts no further validator call. The one already in flight was awaited
       * above, and whatever this phase collected is never raised, because the run resolves its
       * cancellation code instead.
       */
      break;
    }
    try {
      await settle(entry);
    } catch (error) {
      // What this pass settled before the throw stays the run's.
      // The input whose validator threw is never validated again.
      ledger.record({ reports, values }, entry.input);
      throw error;
    }
  }
  ledger.record({ reports, values }, undefined);
  let stdinReport: Report | undefined = undefined;
  let stdin: Content | undefined = undefined;
  if (invocation.stdin !== undefined && invocation.only === undefined) {
    const result = await prepareContent(
      undefined,
      { ...invocation.stdin, stdin: true },
      {
        collected: false,
        host: invocation.host,
        named: invocation.named !== undefined,
        signal: invocation.signal,
      },
    );
    if (result.issues !== undefined) {
      stdinReport = {
        lines: result.issues.map((issue) => stdinIssue(issue.message)),
        problem: {
          input: { global: false, kind: 'stdin', name: 'stdin' },
          reason: 'missing',
          spelling: 'stdin',
        },
      };
    } else if (result.value !== undefined && !Array.isArray(result.value)) {
      stdin = result.value;
    }
  }
  const found = orderedReports(invocation.inputs, reports, {
    position: invocation.stdin?.position,
    report: stdinReport,
  });
  const unanswered = new Set([...(sources.unanswered ?? [])].map((input) => input.name));
  // A dropped fill is no value of the option, so no option group counts it.
  const groupValues = copyValues(supplied.options);
  for (const input of dropped.keys()) {
    withdrawFill(groupValues, input.name);
  }
  found.push(
    ...groupReports({
      absent: absentBooleans(invocation.inputs.locals),
      groups: invocation.optionGroups,
      labels: sources.labels,
      named: invocation.named !== undefined,
      table: invocation.table,
      unanswered,
      values: groupValues,
      withdrawn: sources.withdrawn ?? new Set(),
    }),
  );
  return {
    dropped,
    failure:
      found.length > 0
        ? new InputError(
            found.flatMap((report) => report.lines).join('\n'),
            found.map((report) => report.problem),
          )
        : undefined,
    reports,
    stdin,
    values: new ValidatedInputs(values),
  };
}
