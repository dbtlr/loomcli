import { DeclarationError, readExtension } from '@loomcli/core';
import type {
  ArgumentNode,
  CommandGraph,
  CommandNode,
  OptionNode,
  ResultNode,
  View,
} from '@loomcli/core';

import { encodeText } from '../encode.js';
import { manifestCommand } from './extension.js';

/**
 * The document `--manifest` prints, as JSON. Every field is present; an absent scalar reads `null`
 * and an empty list reads `[]`. Each object lists its keys in the order the contract gives them.
 */
interface ManifestDocument {
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly tokens: string;
  readonly exitCodes: Readonly<Record<string, string>>;
  readonly encodings: { readonly json: string; readonly jsonl: string };
  readonly globals: readonly ManifestOption[];
  readonly command: ManifestCommand;
}

interface ManifestCommand {
  readonly name: string | null;
  readonly path: readonly string[];
  readonly description: string | null;
  readonly details: readonly string[];
  readonly examples: readonly { readonly command: string; readonly note: string | null }[];
  readonly deprecated: string | null;
  readonly hasAction: boolean;
  readonly result: ResultNode | null;
  readonly failures: readonly ManifestFailure[];
  readonly arguments: readonly ManifestArgument[];
  readonly options: readonly ManifestOption[];
  readonly children: readonly ManifestCommand[];
}

interface ManifestFailure {
  readonly name: string;
  readonly exitCode: number;
  readonly meaning: string;
}

interface ManifestArgument {
  readonly name: string;
  readonly description: string | null;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly schema: Readonly<Record<string, unknown>> | null;
  readonly default: { readonly value: unknown } | null;
}

type ManifestOption =
  | {
      readonly type: 'string';
      readonly name: string;
      readonly description: string | null;
      readonly deprecated: string | null;
      readonly long: string | null;
      readonly short: string | null;
      readonly required: boolean;
      readonly multiple: boolean;
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: string | null;
      readonly default: { readonly value: unknown } | null;
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly description: string | null;
      readonly deprecated: string | null;
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly polarity: 'positive' | 'negative' | 'both';
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: string | null;
    };

/** The token rule, stated once so no entry repeats it. */
const tokens =
  "Every input is a string token. A schema describes the value one token must satisfy, and each token of a multiple option or a variadic argument satisfies it alone. A null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.";

/** The Meaning column of core's Invocation table, with its code formatting removed. */
const coreExitCodes: Readonly<Record<string, string>> = {
  '0': 'Successful execution and core output',
  '1': 'Expected action failure, internal failure, or invalid declarations',
  '2': 'Invalid invocation inputs',
  '130': 'Cancelled by SIGINT or by a caller-supplied abort',
  '143': 'Cancelled by SIGTERM',
};

/** What the view names `json` and `jsonl` promise under Declaring a result. */
const encodings = {
  json: "The output is one JSON document. Unless the Command's view reshapes it, a value result is the value and a rows result is the array of its rows.",
  jsonl:
    'Each line is one JSON document: one line per element when the printed value is an array, nothing for an empty array, and one line otherwise. Unless the view reshapes it, a rows result prints one line per row.',
} as const;

/** `JSON.stringify`'s indent for the document, the same as the formatter's `json()`. */
const indentSpaces = 2;

/** A declared default as the document carries it: the value, or `null` for none or `undefined`. */
function defaultOf(node: { readonly default: { readonly value: unknown } | undefined }) {
  return node.default === undefined || node.default.value === undefined
    ? null
    : { value: node.default.value };
}

/** One option's entry: its node without `hidden`, `scope`, `extensions`, and the schema-run flags. */
function optionEntry(node: OptionNode): ManifestOption {
  const common = {
    name: node.name,
    description: node.description ?? null,
    deprecated: node.deprecated ?? null,
    long: node.long,
    short: node.short,
  };
  return node.type === 'boolean'
    ? {
        type: 'boolean',
        ...common,
        negative: node.negative,
        polarity: node.polarity,
        schema: node.schema,
        env: node.env,
      }
    : {
        type: 'string',
        ...common,
        required: node.required,
        multiple: node.multiple,
        schema: node.schema,
        env: node.env,
        default: defaultOf(node),
      };
}

/** One argument's entry: its node without `validated`, `validateOmitted`, and `extensions`. */
function argumentEntry(node: ArgumentNode): ManifestArgument {
  return {
    name: node.name,
    description: node.description ?? null,
    required: node.required,
    variadic: node.variadic,
    schema: node.schema,
    default: defaultOf(node),
  };
}

/** A listing omits every hidden member, as each projection's listing does. */
function visible<Member extends { readonly hidden: boolean }>(members: readonly Member[]) {
  return members.filter((member) => !member.hidden);
}

/** Whether two declared failures are the same entry: one name, one code, and one meaning. */
function sameFailure(first: ManifestFailure, second: ManifestFailure): boolean {
  return (
    first.name === second.name &&
    first.exitCode === second.exitCode &&
    first.meaning === second.meaning
  );
}

/**
 * The failures one Command's `manifestCommand` values declare, concatenated in collection order.
 * An entry identical to an earlier one on the same Command is listed once, at the first.
 */
function failuresOf(node: CommandNode): ManifestFailure[] {
  const entries: ManifestFailure[] = [];
  for (const value of readExtension(node, manifestCommand)) {
    for (const declared of value.failures ?? []) {
      const entry = { name: declared.name, exitCode: declared.exitCode, meaning: declared.meaning };
      if (!entries.some((listed) => sameFailure(listed, entry))) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

/** One declared failure and the Command that declares it, as a conflict names them. */
interface Declaration {
  readonly command: CommandNode;
  readonly failure: ManifestFailure;
}

/** Every Command in the application, hidden ones included: the root, then each child's subtree. */
function everyCommand(node: CommandNode): CommandNode[] {
  return [node, ...node.children.flatMap(everyCommand)];
}

/** How a conflict names one Command: by name, or as the unnamed root. */
function commandSubject(node: CommandNode): string {
  return node.name === null ? 'the root Command' : `Command "${node.name}"`;
}

/**
 * The fault for one failure name declared with two codes, or with one code and two meanings. It
 * names the name and both Commands, the first declaration first.
 */
function conflictError(first: Declaration, second: Declaration): DeclarationError {
  const sameCode = first.failure.exitCode === second.failure.exitCode;
  const clause = ({ failure }: Declaration) =>
    sameCode ? `meaning "${failure.meaning}"` : `exit code ${String(failure.exitCode)}`;
  return new DeclarationError(
    `Failure "${first.failure.name}" is declared with ${clause(first)} on ${commandSubject(first.command)} and ${clause(second)} on ${commandSubject(second.command)}. Declare one code and one meaning for each failure name.`,
  );
}

/**
 * Each failure the application declares, once per name, in the order a depth-first walk from the
 * root first meets it. A name means one failure across the application, so one declared with a
 * second code or meaning throws its `DeclarationError` here.
 */
function applicationFailures(root: CommandNode): ManifestFailure[] {
  const first = new Map<string, Declaration>();
  for (const command of everyCommand(root)) {
    for (const failure of failuresOf(command)) {
      const known = first.get(failure.name);
      if (known === undefined) {
        first.set(failure.name, { command, failure });
      } else if (!sameFailure(known.failure, failure)) {
        throw conflictError(known, { command, failure });
      }
    }
  }
  return [...first.values()].map((declaration) => declaration.failure);
}

/**
 * The exit-code table: core's five rows, and a row for each other code a failure declared anywhere
 * in the application carries, naming its failures in the order the walk first meets them. A code
 * core's own row explains, 1 or 2, adds no row. JavaScript enumerates integer keys in ascending
 * order, so the rows print that way.
 */
function exitCodeTable(root: CommandNode): Readonly<Record<string, string>> {
  const names = new Map<string, string[]>();
  for (const failure of applicationFailures(root)) {
    const code = String(failure.exitCode);
    if (!Object.hasOwn(coreExitCodes, code)) {
      names.set(code, [...(names.get(code) ?? []), failure.name]);
    }
  }
  const rows = [...names].map(([code, carried]) => [
    code,
    `Declared failures: ${carried.join(', ')}`,
  ]);
  return { ...coreExitCodes, ...Object.fromEntries(rows) };
}

/**
 * One Command's entry, with its visible descendants nested under `children`. `details`,
 * `examples`, and `failures` are the Command's collected `manifestCommand` values, in collection
 * order.
 */
function commandEntry(node: CommandNode): ManifestCommand {
  const values = readExtension(node, manifestCommand);
  return {
    name: node.name,
    path: node.path,
    description: node.description ?? null,
    details: values.flatMap((value) => (value.details === undefined ? [] : [value.details])),
    examples: values.flatMap((value) =>
      (value.examples ?? []).map((example) => ({
        command: example.command,
        note: example.note ?? null,
      })),
    ),
    deprecated: node.deprecated ?? null,
    hasAction: node.hasAction,
    result:
      node.result === null
        ? null
        : { kind: node.result.kind, views: node.result.views, default: node.result.default },
    failures: failuresOf(node),
    arguments: node.arguments.map(argumentEntry),
    options: visible(node.options).map(optionEntry),
    children: visible(node.children).map(commandEntry),
  };
}

/**
 * The routed Command's slice: its entry, plus the Application facts and the fixed statements an
 * agent needs to read it with no second document. A hidden Command routed to directly is the
 * slice's own entry, as its help page is. The exit-code table reads the whole application, so every
 * slice carries the same table and a conflicting failure name fails every slice.
 */
function manifestDocument(graph: CommandGraph, command: CommandNode): ManifestDocument {
  return {
    name: graph.name,
    version: graph.version,
    description: graph.description ?? null,
    tokens,
    exitCodes: exitCodeTable(graph.root),
    encodings,
    globals: visible(graph.globals).map(optionEntry),
    command: commandEntry(command),
  };
}

/**
 * Whether a value is plain JSON data: null, a Boolean, a finite number, a string, or arrays and
 * plain objects of these. Core copies every plain object it snapshots onto `Object.prototype`, so
 * a null-prototype object never reaches the document.
 */
function isPlainJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item: unknown) => isPlainJson(item));
  }
  if (typeof value !== 'object') {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype &&
    Object.values(value).every((item: unknown) => isPlainJson(item))
  );
}

/** How a diagnostic names one input: an option by its spelling, an argument by its name. */
function inputLabel(entry: ManifestOption | ManifestArgument): string {
  return 'type' in entry
    ? `option "${entry.long ?? entry.short ?? entry.name}"`
    : `argument "${entry.name}"`;
}

/** Every input a document lists: the globals, then each Command's arguments and options. */
function inputsOf(document: ManifestDocument): (ManifestOption | ManifestArgument)[] {
  const inputs: (ManifestOption | ManifestArgument)[] = [...document.globals];
  const pending = [document.command];
  for (let entry = pending.shift(); entry !== undefined; entry = pending.shift()) {
    inputs.push(...entry.arguments, ...entry.options);
    pending.push(...entry.children);
  }
  return inputs;
}

/**
 * The first input in a document whose declared default or published schema is not plain JSON data,
 * named with the field that holds it, or `undefined`. A declared default is snapshotted as the
 * author wrote it, and a converter's schema keeps any value it returned, so either can hold one.
 */
function unencodableInput(document: ManifestDocument): string | undefined {
  for (const input of inputsOf(document)) {
    if ('default' in input && input.default !== null && !isPlainJson(input.default.value)) {
      return `the default of ${inputLabel(input)}`;
    }
    if (input.schema !== null && !isPlainJson(input.schema)) {
      return `the schema of ${inputLabel(input)}`;
    }
  }
  return undefined;
}

/**
 * The document as bytes: `JSON.stringify` with a two-space indent and one newline, escaped as the
 * formatter's `json()` escapes, with no style. It is a bare view the plugin never declares, so no
 * override reaches it: the document is data, as a result's `json` output is. A default or a schema
 * that is not plain JSON data fails the write instead of printing a value the author never declared.
 */
const manifestView: View<ManifestDocument> = {
  render: (document, context) => {
    const unencodable = unencodableInput(document);
    if (unencodable !== undefined) {
      throw new Error(
        `The manifest cannot encode ${unencodable} as JSON. Supply a value that is null, a Boolean, a finite number, a string, or an array or plain object of these.`,
      );
    }
    return encodeText(`${JSON.stringify(document, undefined, indentSpaces)}\n`, context);
  },
};

export { manifestDocument, manifestView };
