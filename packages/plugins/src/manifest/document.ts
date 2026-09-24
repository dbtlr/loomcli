import { readExtension } from '@loomcli/core';
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
  readonly exitCodes: Readonly<Record<'0' | '1' | '2' | '130' | '143', string>>;
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
  readonly arguments: readonly ManifestArgument[];
  readonly options: readonly ManifestOption[];
  readonly children: readonly ManifestCommand[];
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
    };

/** The token rule, stated once so no entry repeats it. */
const tokens =
  "Every input is a string token. A schema describes the value one token must satisfy, or the whole list of tokens for a multiple option or a variadic argument, and a null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.";

/** The Meaning column of core's Invocation table, with its code formatting removed. */
const exitCodes = {
  '0': 'Successful execution and core output',
  '1': 'Expected action failure, internal failure, or invalid declarations',
  '130': 'Cancelled by SIGINT or by a caller-supplied abort',
  '143': 'Cancelled by SIGTERM',
  '2': 'Invalid invocation inputs',
} as const satisfies ManifestDocument['exitCodes'];

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
      }
    : {
        type: 'string',
        ...common,
        required: node.required,
        multiple: node.multiple,
        schema: node.schema,
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

/**
 * One Command's entry, with its visible descendants nested under `children`. `details` and
 * `examples` are the Command's collected `manifestCommand` values, in collection order.
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
    arguments: node.arguments.map(argumentEntry),
    options: visible(node.options).map(optionEntry),
    children: visible(node.children).map(commandEntry),
  };
}

/**
 * The routed Command's slice: its entry, plus the Application facts and the fixed statements an
 * agent needs to read it with no second document. A hidden Command routed to directly is the
 * slice's own entry, as its help page is.
 */
function manifestDocument(graph: CommandGraph, command: CommandNode): ManifestDocument {
  return {
    name: graph.name,
    version: graph.version,
    description: graph.description ?? null,
    tokens,
    exitCodes,
    encodings,
    globals: visible(graph.globals).map(optionEntry),
    command: commandEntry(command),
  };
}

/** Whether a value is plain JSON data: null, a Boolean, a finite number, a string, or containers of these. */
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
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((item: unknown) => isPlainJson(item))
  );
}

/** How a diagnostic names one input: an option by its spelling, an argument by its name. */
function inputLabel(entry: ManifestOption | ManifestArgument): string {
  return 'type' in entry
    ? `option "${entry.long ?? entry.short ?? entry.name}"`
    : `argument "${entry.name}"`;
}

/**
 * The first input in a document whose declared default is not plain JSON data, or `undefined`.
 * Only a declared default can hold such a value, since core freezes every schema and extension
 * output as plain data.
 */
function unencodableDefault(document: ManifestDocument): string | undefined {
  const inputs: (ManifestOption | ManifestArgument)[] = [...document.globals];
  const pending = [document.command];
  for (let entry = pending.shift(); entry !== undefined; entry = pending.shift()) {
    inputs.push(...entry.arguments, ...entry.options);
    pending.push(...entry.children);
  }
  const found = inputs.find(
    (input) => 'default' in input && input.default !== null && !isPlainJson(input.default.value),
  );
  return found === undefined ? undefined : inputLabel(found);
}

/**
 * The document as bytes: `JSON.stringify` with a two-space indent and one newline, escaped as the
 * formatter's `json()` escapes, with no style. It is a bare view the plugin never declares, so no
 * override reaches it: the document is data, as a result's `json` output is. A value that is not
 * plain JSON data, which only a declared default can be, fails the write instead of printing a value
 * the author never declared.
 */
const manifestView: View<ManifestDocument> = {
  render: (document, context) => {
    const unencodable = unencodableDefault(document);
    if (unencodable !== undefined) {
      throw new Error(
        `The manifest cannot encode the default of ${unencodable} as JSON. Declare a default that is null, a Boolean, a finite number, a string, or an array or plain object of these.`,
      );
    }
    return encodeText(`${JSON.stringify(document, undefined, indentSpaces)}\n`, context);
  },
};

export { manifestDocument, manifestView };
