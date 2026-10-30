---
description: "The manifest plugin: the --manifest option, the JSON document it prints for the routed Command, and the manifestCommand extension that supplies details, examples, and declared failures."
---

# Manifest plugin

This page documents the manifest plugin: the `--manifest` option, the JSON document it prints for the routed Command, and the `manifestCommand` extension that supplies details, examples, and declared failures. An author installs it so an agent can read how to invoke a Command before it does.

```ts
// @loomcli/plugins/manifest
import type { BooleanOption, Plugin, PluginOptions, ResultNode } from '@loomcli/core';

const options = {
  manifest: { control: true, description: "Print this command's manifest as JSON.", type: 'boolean' },
} satisfies PluginOptions;
export type ManifestOptions = typeof options;
export interface ManifestSettings {
  readonly short?: NonNullable<BooleanOption['short']>;
}
export declare function manifest(settings?: ManifestSettings): Plugin<ManifestOptions>;

// The document the option prints, as JSON. The package exports no type for it.
interface ManifestDocument {
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly tokens: string;
  readonly exitCodes: Readonly<Record<string, string>>; // core's eight rows and a row per declared code, in ascending numeric order
  readonly encodings: { readonly json: string; readonly jsonl: string };
  readonly globals: readonly ManifestOption[];
  readonly configuration: { readonly schema: Readonly<Record<string, unknown>> | null } | null;
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
  readonly code: string; // the class's failure code
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
      readonly control: boolean; // see Control options
      readonly long: string | null;
      readonly short: string | null;
      readonly required: boolean;
      readonly requiredWhen: 'non-interactive' | null; // see Interaction
      readonly multiple: boolean;
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: readonly string[];
      readonly envDelimiter: string | null;
      readonly envAllowEmpty: boolean;
      readonly default: { readonly value: unknown } | null;
      readonly implied: string | null;
      readonly background: boolean; // see Background
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly description: string | null;
      readonly deprecated: string | null;
      readonly control: boolean;
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly polarity: 'positive' | 'negative' | 'both';
      readonly interaction: boolean; // see Interaction
      readonly color: boolean; // see Color
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: readonly string[];
    }
  | {
      readonly type: 'count';
      readonly name: string;
      readonly description: string | null;
      readonly deprecated: string | null;
      readonly control: boolean;
      readonly long: string | null;
      readonly short: string | null;
      readonly verbose: boolean; // see Verbosity
      readonly quiet: boolean; // see Verbosity
      readonly schema: null;
      readonly env: readonly string[];
    };
```

`jsonkit get --manifest` prints the document below, abridged here to its first global; the full `globals` list continues with `--help`, `--version`, `--manifest`, `--explain`, `--color`, `--verbose`, and `--quiet`.

```json
{
  "name": "jsonkit",
  "version": "0.0.0",
  "description": "Read and reshape one JSON document.",
  "tokens": "Every input is a string token. An input's schema describes the value one token must satisfy, and each token of a multiple option or a variadic argument satisfies it alone. The configuration schema describes the configuration the application reads, not a token. A null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.",
  "exitCodes": {
    "0": "Successful execution and core output",
    "1": "Expected action failure, internal failure, or invalid declarations",
    "2": "Invalid invocation inputs",
    "65": "Declared failures: invalid-json, path-not-found",
    "129": "Cancelled by SIGHUP",
    "130": "Cancelled by SIGINT, a caller-supplied abort, or the action's cancel()",
    "131": "Cancelled by SIGQUIT",
    "141": "Stopped because the reader of stdout closed the pipe",
    "143": "Cancelled by SIGTERM"
  },
  "encodings": {
    "json": "The output is one JSON document. Unless the Command's view reshapes it, a value result is the value and a rows result is the array of its rows.",
    "jsonl": "Each line is one JSON document: one line per element when the printed value is an array, nothing for an empty array, and one line otherwise. Unless the view reshapes it, a rows result prints one line per row."
  },
  "globals": [
    {
      "type": "string",
      "name": "file",
      "description": "The document to read. Omit it to read piped text.",
      "deprecated": null,
      "control": false,
      "long": "--file",
      "short": "-f",
      "required": false,
      "multiple": false,
      "schema": null,
      "env": [],
      "envDelimiter": null,
      "envAllowEmpty": false,
      "default": null,
      "implied": null
    }
  ],
  "configuration": null,
  "command": {
    "name": "get",
    "path": [
      "get"
    ],
    "description": "Read one value at a path.",
    "details": [
      "Quote a path that holds a shell metacharacter.",
      "A path is a dot-separated walk from the root of the document.\n\n- A **key** reads an object's member, such as `user.name`.\n- A **whole number** reads an array's item, such as `items.0`.\n\nThe document is *JSON*; see [the format](https://www.json.org/json-en.html).\n"
    ],
    "examples": [
      {
        "command": "get name -f doc.json",
        "note": null
      },
      {
        "command": "get nested.deep.value -f doc.json",
        "note": null
      }
    ],
    "deprecated": null,
    "hasAction": true,
    "result": null,
    "failures": [
      {
        "code": "path-not-found",
        "exitCode": 65,
        "meaning": "The path names no value in the document."
      },
      {
        "code": "invalid-json",
        "exitCode": 65,
        "meaning": "The document is not valid JSON."
      }
    ],
    "arguments": [
      {
        "name": "path",
        "description": "Dot path to read.",
        "required": true,
        "variadic": false,
        "schema": null,
        "default": null
      }
    ],
    "options": [],
    "children": []
  }
}
```

The manifest plugin prints, for the routed Command, a self-contained JSON projection of the graph that an agent reads to construct a correct invocation before it makes one. The graph is the source of truth: the document copies facts [Graph inspection](../core/graph-inspection.md) publishes and adds nothing but the fixed statements of the envelope, and no projection, plugin, or core path reads a fact from it.

- **The option.** `manifest(settings?)` takes the optional `short` setting and declares one Boolean global option, `manifest`, with the description `Print this command's manifest as JSON.` and `control: true` under [Control options](../core/commands.md#control-options), and a middleware activated by it. `manifest({ short: 'M' })` adds `-M`; omitted or empty settings give it no short spelling. The `short` setting's type takes one ASCII letter, under [Plugin settings](../core/plugin-contract.md#plugin-settings). A collision follows the ordinary global option spelling-taken rule. Like `--help`, either spelling is consumed at any placement before `--`. It lists `manifestCommand` under its `extensions`, declares no view, and claims no slot.
- **The takeover.** The middleware prints the document for the routed Command and returns without calling `next()`, so the exit code is 0, the action never dispatches, and a fault core held from parsing or validation is never raised: a group prints its own document, and `jsonkit get --manifest` prints while `path` is missing. An unknown Command still fails in routing, so `jsonkit nope --manifest` reports the unknown command, and every other fault is held, so `--manifest` takes it over. An earlier-installed middleware that takes over wins, so in the example applications `jsonkit --help --manifest` prints help and `jsonkit --version --manifest` prints the version.
- **The slice.** `command` is the routed Command's entry with its visible descendants nested under `children`, and the envelope carries the Application's `name`, `version`, `description`, `globals`, and `configuration`, so a slice needs no second document. At the root the slice is the whole application. A hidden Command routed to directly prints its own slice, as its help page does.
- **What a listing omits.** A hidden Command, a hidden local option, and a hidden global option are omitted, as every listing omits them. Aliases never appear, a Command's or an option's. A deprecated member appears with its migration message under `deprecated`.
- **One line.** Every `description` and `deprecated` message the document carries, the Application's and the stdin input's included, is one line: each line break the author wrote, CRLF or a single terminator, reads as one space.
- **The envelope.** `name`, `version`, and `description` are the graph's, and so is `configuration`, the [configuration fact](../core/graph-inspection.md): `null` when the application installs no configuration source, and otherwise `{ schema }`, the JSON Schema of the configuration file the source reads, or a `null` schema when it is unknown. A configuration schema that is not plain JSON data fails the write, as an input's schema does, naming `the configuration schema`. An agent reads it to write a configuration file the application accepts, and an author who publishes the file's schema hosts this object, under [ADR-0121](../decisions/0121-the-configuration-source-publishes-its-files-json-schema-as-a-core-graph-fact.md). `tokens` states the token rule once, so no entry repeats it: what a schema describes, that a `null` schema means unknown, and that an example omits the application name. `exitCodes` carries the eight codes core resolves itself with the Meaning column's text from the [Invocation](../core/invocation.md) table, code formatting removed, and a row for each other code a [declared failure](#manifest-failures) carries anywhere in the application, as that section states. It omits the application's range row. `encodings` states what the [media types](../core/results.md#media-types) `application/json` and `application/jsonl` promise, under the keys `json` and `jsonl`; a Command's `result.mediaTypes` names the views that declare each, so the statements apply by media type and never by view name. The three statements are fixed strings, the same in every document.
- **A Command entry.** It mirrors `CommandNode` without `aliases`, `hidden`, and `extensions`, and adds `details`, `examples`, and `failures` from the Command's [`manifestCommand`](#manifest-extension) values: `details` holds each value's `details`, one string per value that holds one, and `examples` and `failures` concatenate each value's lists, all in collection order. At the root, `description` is the Application's, as the graph reports it.
- **An input entry.** An argument entry mirrors `ArgumentNode` without `validated`, `validateOmitted`, and `extensions`. An option entry mirrors its `OptionNode` variant without `hidden`, `aliases`, and `extensions`, so it carries `control`, which tells an agent the option controls the invocation rather than feeding the Command's work, and on the string variant without `validated` and `validateOmitted`, so a plugin's option and an application's read alike and the document names no plugin. `validated` and `validateOmitted` describe how core runs a validator, and an agent reads `schema: null` as unknown whatever they hold. `schema` is the graph's [input schema](../core/validation.md#input-schema), copied verbatim. `default` is `{ "value": <declared value> }`, or `null` when the input declares no default or declares `undefined`. `env` is the graph's [environment binding](../core/input-sources.md), the array of variables an agent may set in place of the option, in the order core reads them, and `[]` when none; it sits before `default` on the string variant and last on the Boolean and counted variants, which carry no default. `envDelimiter` follows `env` on the string variant and on a content option entry: the delimiter that separates the items of a multiple option's variable under [Environment lists](../core/input-sources.md), so an agent that sets `FIELDS` joins the items with it, or `null` when the option declares none. `implied` is the string variant's [implied value](../core/options.md#implied-values), or `null`, followed by `background`, the [background mark](../core/background.md), last on that variant, and the counted variant, `type: "count"`, carries no `negative`, `polarity`, `required`, `multiple`, or `default`, because a [counted option](../core/options.md#counted-options) has none; an agent reads its value as the number of times it is supplied. A hook-declared option, `--format` included, is an ordinary local option entry.
- **Absence.** Every field is present in every entry. An absent scalar reads `null`, an empty list reads `[]`, and a Command with no result reads `result: null`, which is how an agent learns that `--format` is absent there.
- **Key order.** Every object the plugin builds holds its keys in the order the type block lists them. `result` holds `kind`, `views`, `default`, and `mediaTypes` in that order, and `mediaTypes` holds its keys in record order. A `schema` object and a default value keep the key order of the graph's value, as JavaScript enumerates it.
- **Bytes.** The document is `JSON.stringify(document, null, 2)` and one newline, written to stdout with no style, so the bytes are the same under every capability. The text is escaped as the formatter's `json()` escapes it: through `style.escape`, with every character from U+007F to U+009F replaced by its `\uXXXX` escape in four lowercase hex digits. A declared default or a published schema that is not plain JSON data, meaning `null`, a Boolean, a finite number, a string, or an array or plain object holding only these, fails the write: the `out.render` call rejects as the output-view row of the [ordinary failure path](../core/failures.md#the-ordinary-failure-path) states, nothing is written, and the middleware's rejection reports `Internal error: The manifest cannot encode the default of option "--odd" as JSON. Supply a value that is null, a Boolean, a finite number, a string, or an array or plain object of these.` with code 1, as a throwing help page reports; a schema reads `the schema of option "--odd"` in the same place, and an argument reads `argument "<name>"`. A declared default is snapshotted as the author wrote it and a hand-written converter's schema keeps whatever it returned, so a `bigint`, `NaN`, a function, a `Date`, or a `Map` in either would otherwise print a value the author never declared, and a value that holds itself, which core copies with its cycle, has no JSON text at all. The middleware writes through a bare view the plugin does not declare, so no override reaches it: the document is data, as a result's `json` output is, and an application that wants another document writes its own projection.
- **Stability.** The document carries no version of its own. The Application's `version` is its only version identity. A field keeps its meaning across releases, a later fact arrives as a new field, and a consumer ignores fields it does not know. An option entry may arrive with a new `type`; a consumer reads an entry whose `type` it does not know by the fields it does know.

## Manifest extension

```ts
// src/manifest/extension.ts, the declarations module of the @loomcli/plugins/manifest subpath
import { extension } from '@loomcli/core';
import { array, object, optional, pipe, rawTransform, unknown } from 'valibot';

import { packageName } from '../constants.js';
// The pack's shared line and Markdown rules, which help's schema also uses.
import { line, markdown } from '../lines.js';
// readFailure reads a value as a class that extends LoomError and answers its failure code and
// declared exit code, or the sentence that rejects it.
import { readFailure } from './failures.js';

// declaredFailure accepts { failure, meaning }, where failure is a class that extends LoomError,
// and outputs { code, exitCode, meaning } from the class's failure code and declared exit code.
const declaredFailure = pipe(
  object({ failure: optional(unknown()), meaning: line }),
  rawTransform(({ addIssue, dataset, NEVER }) => {
    const read = readFailure(dataset.value.failure);
    if ('issue' in read) {
      addIssue({ message: read.issue });
      return NEVER;
    }
    return { code: read.code, exitCode: read.exitCode, meaning: dataset.value.meaning };
  }),
);

export const manifestCommand = extension(`${packageName}/manifest/command`, {
  collect: true,
  schema: object({
    details: optional(markdown),
    examples: optional(array(object({ command: line, note: optional(line) }))),
    failures: optional(array(declaredFailure)),
  }),
  target: 'command',
});
```

```ts
import { Command } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [manifestCommand({ details: 'Quote a path that holds a shell metacharacter.' })],
});
```

The declarations module, `@loomcli/plugins/manifest/extension`, holds the collecting extension through which the author and any plugin give a Command's entry its `details`, `examples`, and `failures`. It is declarations alone, apart from the plugin's entry, so help supplies values through it whether or not the manifest is installed.

- **The extension.** `manifestCommand` is a [collecting extension](../core/extensions.md#collecting-extensions) on Commands with the identity `@loomcli/plugins/manifest/command`. `details` is Markdown under the rule help's `details` follows: a string that holds a character other than whitespace, with blank lines allowed, carried as written. `examples` lists invocations: `command` holds the tokens after the application name as one line, and `note` is one line.
- **Who supplies values.** A value is meant for an agent because it lands in the manifest. The author's own value is where an instruction goes that an agent needs beyond the help page. A plugin's value holds the facts that plugin chooses to project into the manifest, as help's hook does under [Help in the manifest](help.md#help-in-the-manifest).
- **An empty value.** A value that holds none of the fields is accepted and stored, and the manifest prints nothing for it.

## Manifest failures

```ts
import { Command, EX_DATAERR, FatalError } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

import { getValue } from './actions/get-value.js';
import { InvalidJsonError } from './translators.js';

export class PathNotFoundError extends FatalError {
  static override readonly code = 'path-not-found';
  static override readonly exitCode = EX_DATAERR;
  // ...
}

// Shared by every Command that reads a document. InvalidJsonError declares the code invalid-json.
export const readFailures = [{ failure: InvalidJsonError, meaning: 'The document is not valid JSON.' }];

export const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [
    manifestCommand({
      failures: [
        { failure: PathNotFoundError, meaning: 'The path names no value in the document.' },
        ...readFailures,
      ],
    }),
  ],
}).action(getValue);
```

A Command states the failures it can raise, each with the exit code its class declares and one line of meaning, so an agent reading the manifest knows what a code means before it runs the Command. The list is the manifest plugin's own fact, set by the author and by plugins, and core never checks it: the manifest is as accurate as its declarations.

- **An entry.** `failure` is the class, and the extension reads its [failure code](../core/failures.md#failure-codes) and its `exitCode` when the value is made, as [Declared exit codes](../core/failures.md#declared-exit-codes) lets a projection read a code without an instance. The schema outputs `{ code, exitCode, meaning }`, plain data alone as every extension value holds, so the class never reaches the graph. The schema's input type for `failure` is `unknown`, because no typed path names a class without an assertion, so a value that is not a failure class is rejected at run time alone. The entry carries no hand-written name: `code` is the class's failure code, which survives a minifying build where a class name does not, so a class that declares none lists the code it inherits, such as `fatal`. `meaning` is one line. A value that is not a class extending `LoomError` and a meaning that is not one line are rejected at the call by the extension's schema. A class whose failure code is outside its grammar is rejected there too, with the sentence core throws when it constructs that class, because the manifest lists a class no run may have constructed. The class's `exitCode` type bounds its code under [ADR-0095](../decisions/0095-the-type-bounds-a-declared-exit-code.md), so the extension judges no exit code.
- **Per Command.** A Command's list is what its own values declare. A Command inherits nothing from its parent or the root, so a failure every Command can raise is listed on each, and a shared constant, as above, keeps the lists in step.
- **From plugins.** A plugin that raises its own failures, or ships [translators](../core/failures.md#translators) that return them, supplies entries through its `onCommandAttach` hook, as help supplies `details`.
- **The entry's field.** `failures` lists `{ code, exitCode, meaning }` in collection order. Two entries on one Command with the same failure code, exit code, and meaning print once, at the first. A Command that declares none reads `[]`.
- **The table.** `exitCodes` keeps core's eight rows and their text. Each other code any Command in the application declares, hidden Commands included, gains a row, `Declared failures: ` followed by the failure codes that carry it, comma-separated, in the order they are first met walking the graph from the root depth-first, each Command's children in `CommandNode.children` order. A declared failure whose code is 1 or 2 adds no row, because core's row already explains the code, and it still appears in its Command's `failures`. The rows print in ascending numeric order, as JavaScript enumerates integer keys.
- **One code, one failure.** A failure code means one failure across the application. Two entries with one failure code and a different exit code or meaning, such as two `FatalError` subclasses that declare no code and different exit codes, are a `DeclarationError` under the rule [`@loomcli/plugins/manifest/failure-code-conflict`](../core/diagnostics.md#loomclipluginsmanifestfailure-code-conflict) that the manifest's middleware throws when it builds the document, naming the code and both Commands, which `run()` reports by build under [Development builds](../core/release-facts.md#development-builds). Its two findings rebuild each declaration as the `manifestCommand({ failures: [...] })` entry the graph holds, `{ code, exitCode, meaning }`, mark the key the two disagree on, and note the Command that declares it. The rule's identity follows the grammar of [diagnostic rules](../core/declaration-faults.md#developer-diagnostics), which `diagnosticRule()` checks: the package's name, the manifest plugin's subpath, and the rule name. The subpath follows the plugin's identity, which [ADR-0096](../decisions/0096-the-identity-grammar-is-a-naming-convention.md) makes a naming convention.
- **A `name` key.** The entry's schema names `failure` and `meaning` alone, so a `name` key is dropped like any key the schema does not name, not rejected. TypeScript rejects it only in an entry literal written inside the `manifestCommand()` call; a shared constant, such as `readFailures` above, compiles with it. Two classes left on an inherited code with different exit codes or meanings report the one-code rule above.
