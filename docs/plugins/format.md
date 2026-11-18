---
description: "The formatter plugin: the --format and --fields options, the json and jsonl views, the media type it states at a group, and the failure encoders that write a failed run in the chosen format."
---

# Formatter plugin

The formatter is `@loomcli/plugins/format`. Its factory `format(settings?)` takes one optional setting, `short`, the short spelling `--format` takes, under the convention of [Plugin settings](../core/plugin-contract.md#plugin-settings), and with none `--format` has no short spelling. It declares no global option and claims no slot. It ships three views, `json()`, `jsonl()`, and the row view `jsonlRows()`, one hook that puts `--format` on every Command that declares a [result](../core/results.md) and a hidden `--format` on every [group](../core/commands.md#nested-commands-and-groups), a `--fields` option beside each `--format` that keeps the named top-level keys of the json and jsonl output the formatter provides, one always-on middleware that copies a supplied name into `view`, or at a group its media type into `mediaType`, and sets the run's [result transform](../core/middleware.md) from `--fields`, and two [failure encoders](../core/failure-views.md#failure-encoders), for `application/json` and `application/jsonl`. The plugin owns the encodings and the option; core owns the selection and the run's media type.

```ts
// @loomcli/plugins/format
interface FormatSettings {
  readonly short?: NonNullable<StringOption['short']>; // one ASCII letter, as every option's short spelling is
}
function format(settings?: FormatSettings): Plugin<{}>;
interface EncodingConfig<Data> {
  readonly map?: (data: Readonly<Data>) => unknown;
}
function json<Data>(config?: EncodingConfig<Data>): View<Data>; // mediaType 'application/json'
function jsonl<Data>(config?: EncodingConfig<Data>): View<Data>; // mediaType 'application/jsonl'
function jsonlRows<Row>(config?: EncodingConfig<Row>): RowView<Row>; // mediaType 'application/jsonl'; map applies per row
```

```ts
import { Application } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { table } from '@loomcli/plugins/table';
import { version } from '@loomcli/plugins/version';

export const textstat = new Application('textstat', { plugins: [help(), version(), format({ short: 'f' })] })
  // ...
  .rows<Row>({
    views: {
      table: table({
        columns: [
          { key: 'count', header: 'COUNT', align: 'right' },
          { key: 'source', header: 'SOURCE' },
        ],
      }),
    },
  })
  .action(countFiles);
```

```text
$ textstat --format json one.txt      # the rows as one JSON array on stdout, warnings on stderr
$ textstat --format yaml one.txt
textstat: Option "--format": Supply one of table, json, jsonl.
$ textstat --format json --metric nope one.txt
{"error":{"code":"invalid-input","exitCode":2,"message":"Option \"--metric\": Expected one of: bytes, words, lines.","hints":["Run \"textstat --help\" to see the usage."]}}
$ jsonkit get --format json user.name -f doc.json
jsonkit: Unknown option "--format". Supply a declared option, or pass it as an argument after "--".
Run "jsonkit get --explain" to explain this command.
```

With help installed, [help's failure hint](suggestions.md#helps-failure-hint) prints `Run "jsonkit get --help" to see the usage.` between the sentence and the explain line.

An application whose operators and scripts already type `-f` for the format gives it as the short spelling, and the help row carries it:

```ts
new Application('store', { plugins: [help(), format({ short: 'f' })] });
```

```text
$ store list --help
store list

USAGE
  store list [options]

OPTIONS
  -f, --format <format>  Select the output format, table by default. One of: table, json, jsonl.

GLOBAL OPTIONS
  -h, --help  Show this help.
```

`store list -f json` then selects `json` as `store list --format json` does. The default stays no short spelling, because an application such as jsonkit already spells `--file` as `-f`.

At a group, the root of a group application included, `--format` states the media type the operator asked for, which a takeover such as the [extended version](version.md#the-json-form) and a failure encoder read. For a `notes` application whose root registers no action and attaches `add` and `list`, with help, the formatter, and `version({ extended: true })` installed in that order:

```text
$ notes --version --format json   # the extended version as one JSON object on stdout
$ notes --format json
{"error":{"code":"missing-subcommand","exitCode":2,"message":"A command is required. Use one of: add, list.","hints":["Run \"notes --help\" to see the usage."]}}
$ notes --format json list        # list's result as JSON, as notes list --format json prints it
$ notes --format yaml
notes: A command is required. Use one of: add, list.
Run "notes --help" to see the usage.
```

When declaring views by hand, pick `jsonl()` to map and encode the whole value or collected array, and `jsonlRows()` to map and write each row as it arrives.

- **Views.** `json()` and `jsonl()` are whole views: under `result<Value>` they receive the value, and under `rows<Row>` core collects the sequence and they receive the array. `jsonlRows()` is the row view. `map` reshapes what they receive, identity by default. They are bare pack views under [Row views](../core/results.md#row-views), typed by contextual typing inside a `views` record and as the second argument of `out.render`, and stated, `json<Summary>()`, when hoisted. They render as ordinary views with the plugin uninstalled, so a Command that names `json: json()` first prints JSON by default with no `--format` anywhere. `json()` declares the [media type](../core/results.md#media-types) `application/json` and `jsonl()` declares `application/jsonl`, whatever `map` they take and whatever key holds them. `jsonlRows()` is the row form of `jsonl()`: a [row view](../core/results.md#row-views) that core feeds as the rows arrive, so each line is written before the source finishes and an unbounded source prints as it goes. It has no head and no tail, declares `application/jsonl` under every `map`, and takes the same `EncodingConfig`, whose `map` applies to each row, where `jsonl()`'s applies to the collected array. `json`, `jsonl`, `jsonlRows`, and their configuration type `EncodingConfig` are exported from `@loomcli/plugins/format` and from its views module, `@loomcli/plugins/format/views`, which installs nothing.
- **Bytes.** `json()` writes `JSON.stringify(mapped, null, 2)` and one newline. `jsonl()` writes one line per element when the mapped value is an array, each `JSON.stringify(element)` and one newline, and one such line otherwise; an empty array prints nothing. `jsonlRows()` writes one line per row, each `JSON.stringify(map(row))` and one newline, through the same encoding and escaping, so its bytes equal `jsonl()`'s for the same rows, and an empty sequence prints nothing. A source that stops early leaves the lines already written and no tail, under [A sequence that stops early](../core/results.md#a-sequence-that-stops-early). `toJSON` is honored and an `undefined`, function, or symbol property is dropped, as `JSON.stringify` does. The text is data: each view escapes it through `style.escape` and replaces every character from U+007F to U+009F with its `\uXXXX` escape, four lowercase hex digits, so nothing the [rendering policy](../core/styles.md#rendering-policies) would strip or read as a terminal control reaches it, and applies no style, so the bytes are the same under every capability.
- **The hook.** A Command that registers an action and declares no result is returned unchanged. On one with a result, the hook appends `json` and then `jsonl` to the `views` record where the record lacks the key, the `jsonl` entry being `jsonlRows()` under a `rows<Row>` result and the whole `jsonl()` under a `result<Value>`, so an author's own `json: json({ map })` or `json: myView` is kept as written and the default is unchanged, then declares the local string option `format` after the author's options, with the short spelling `settings.short` names, or none when it is omitted, `control: true` under [Control options](../core/commands.md#control-options), and no default, the description `Select the output format, <default> by default.`, where `<default>` is the declared default at that hook, and a validator that accepts each key and returns the issue `Supply one of <names>.` for anything else. The validator also accepts `ndjson` and transforms it to `jsonl`, unless the record names `ndjson` itself; `ndjson` is an unadvertised alias under [Aliases](../core/commands.md#aliases). The validator maps `ndjson` to `jsonl` before it checks the record's keys, so the option's [input schema](../core/validation.md#input-schema) is the enum of the record's keys and the unadvertised alias stays out of it. The option is an ordinary local option in every respect: parsed at local placement, on the help page as `--format <format>`, or `-f, --format <format>` under `format({ short: 'f' })`, with its description and its accepted values, under the node's `options` in `inspect()`, reaching the action at run time under `options.format` and absent from its types. The `short` setting's type takes one ASCII letter, and the option it spells meets the ordinary option declarations, under [Plugin settings](../core/plugin-contract.md#plugin-settings). A key or spelling collision with an option the Command, the Application, or another plugin declares, the chosen short spelling included, is the hook-collision build error, naming the plugin, the Command, and the declaration that already holds the name or spelling, and the developer resolves it; the plugin offers no rename. A plugin whose hook adds a view installs ahead of `format()` if `--format` is to accept its name. The same order lets the description reflect a hook's changed default.
- **The hook at a group.** On a [group](../glossary.md#authoring), a Command that registers no action, the hook adds no view, because a group declares no result, and declares the local string option `format` with `hidden: true`, `control: true`, no default, the description `Select the output format.`, the short spelling `settings.short` names, or none, and the validator over the names `json` and `jsonl`, which returns the issue `Supply one of json, jsonl.` for anything else and accepts `ndjson` for `jsonl`. Routing reads a group's own options as a parent's own, under [Nested Commands and groups](../core/commands.md#nested-commands-and-groups), so `notes --format json list` binds the occurrence to `list`'s own `--format`, by the spelling the operator typed, and `notes --format json plain`, where `plain` registers an action and declares no result, is the unknown-option error on `plain`. A child that declares its own string option `--format` and no result takes the occurrence too, so `notes --format csv export` binds `csv` to `export`'s `--format` and runs it, where it was the misplaced-option error. At a group, `--format` is read as the group's own option, so every form of it is judged there or at the Command it binds to: with no value it is the missing-value error, a repeat is the repeated-option error, a value the formatter rejects at the group leaves the missing subcommand, and a value bound to a child is judged by that child's `--format`, so under `--version` the view it selects, or the child's default view when the child rejects the value, decides the version form. The option is hidden because a bare group invocation always fails with the missing subcommand, so help, the manifest, and completion list it nowhere and no page changes, while `inspect()` publishes it on the group's node with `hidden: true`. Completion completes past a hidden option typed in full, under [Completion](completion.md), so `notes --format <Tab>` offers `json` and `jsonl`, and `notes --format json <Tab>` offers the root's children. A collision on a group is the hook-collision build error, as on a Command with a result: an application whose group declares its own option named `format`, or an option with the short spelling `settings.short` names, fails every run with exit 1, under `@loomcli/core/option-declared-twice` or `@loomcli/core/spelling-taken`, and the developer renames the group's option or its short spelling.
- **The middleware.** `activate: 'always'`, because a hook-declared option cannot activate it. When the routed Command declares a result and [`ownOptions`](../core/middleware.md) holds a string under `format`, it assigns that string to `view` and calls `next()`; when the option was omitted it assigns nothing, so an earlier plugin's selection stands. When the routed Command is a group and `ownOptions` holds `json` or `jsonl` under `format`, it assigns `application/json` or `application/jsonl`, the media type that name's view declares, to `mediaType`, and calls `next()`; core validates the group's `--format` for `ownOptions` under the held missing-subcommand fault, so the value is there whenever it validated. On a Command that declares a result it never assigns `mediaType`, because there the selected view states it. Every other run it assigns nothing and calls `next()`. Before it calls `next()` it also sets the run's result transform from `--fields`, or fails the run, under [Selecting fields](#selecting-fields). A held fault on another input, a structural one such as `--bogus` and an input-source one such as a configuration file that cannot be read included, leaves `format` in `ownOptions`, so the selection stands for the failure, and the fault is raised at the dispatch boundary unless a later middleware takes over. A `--format` its validator rejected is absent from `ownOptions`, so the middleware assigns nothing and the failure's selection stays as it was, the default view when nothing else selected one: `textstat --format yaml one.txt` is the validator's issue, exit 2, written as text because textstat's default view, `table`, declares no media type, and `--format yaml --help` with help installed after the formatter still prints the page. At a group, `notes --format yaml` is the missing subcommand, exit 2, written as text, because the missing subcommand ranks ahead of the rejected value and no media type was assigned.
- **The failure encoders.** The plugin registers one encoder for `application/json` and one for `application/jsonl`, the media types its views declare, so a failed run whose [media type](../core/failure-views.md#failure-view-context) is one of them, a selected `json()`, `jsonl()`, or `jsonlRows()` view or `--format json` or `--format jsonl` at a group, writes its [failure form](../core/failures.md#the-failure-form) as JSON. Both write the same bytes: one line, `JSON.stringify({ error: form })` with the form's keys in the order `code`, `exitCode`, `message`, `hints`, then one newline, to stderr. Every character from U+007F to U+009F is replaced by its `\uXXXX` escape, four lowercase hex digits, as the views replace it, and no style applies. An author's own view that declares either media type selects the same encoder. `--format` on a Command that registers an action and declares no result is the unknown-option error, and `--format` twice or with no value follows the rules every string option follows.

```ts
// src/format/middleware.ts, loaded on every invocation that reaches it
import { readExtension } from '@loomcli/core';
import type { Middleware, MiddlewareContext } from '@loomcli/core';

import { providedViews } from './extension.js';
import { fieldsFailure, requestedFields, rowFields, valueFields } from './fields.js';
import { fieldsNeedEncoding } from './messages.js';
import type { format } from './plugin.js';

/** The media type each of the formatter's views declares, which a group's `--format` states. */
const encodings = new Map([
  ['json', 'application/json'],
  ['jsonl', 'application/jsonl'],
]);

/** The length of a field list that names nothing. */
const EMPTY = 0;

/**
 * Sets the run's result transform from a supplied `--fields`, which keeps the named fields, when
 * the selected view is one the formatter appended, and fails the run under any other view. It
 * acts only on a request core holds no fault for, so a held fault stays the one raised, and a
 * group, which renders no result, ignores it.
 */
function selectFields(context: MiddlewareContext): void {
  const fields = requestedFields(context.ownOptions.fields);
  if (fields.length === EMPTY || context.request === null) {
    return;
  }
  const result = context.command.result;
  if (result === null) {
    return;
  }
  if (!readExtension(context.command, providedViews)?.includes(context.view ?? '')) {
    throw fieldsFailure(fieldsNeedEncoding);
  }
  context.transform = result.kind === 'rows' ? rowFields(fields) : valueFields(fields);
}

/**
 * Copies a supplied `--format` into `view` on a Command that declares a result, and at a group
 * states the media type that name's view declares through `mediaType`. The option is
 * hook-declared, so its value is unknown to the types, and `ownOptions` holds it whenever it
 * validated, a held fault on another input included, so the selection stands for the failure too.
 * Then it sets the result transform `--fields` asks for, once the view is selected.
 */
const middleware: Middleware<typeof format> = async (context) => {
  // A hook-declared option, so its value is unknown to the types; it stands under a held fault.
  const selected = context.ownOptions.format;
  if (typeof selected === 'string') {
    const encoding = encodings.get(selected);
    if (context.view !== null) {
      context.view = selected;
    } else if (encoding !== undefined) {
      // Only a group holds the option where no view is, so this states the group's media type.
      context.mediaType = encoding;
    }
  }
  selectFields(context);
  await context.next();
};

export default middleware;
```

## Selecting fields

`--fields` keeps the named top-level keys under the `json` and `jsonl` views the formatter appended, so an agent or a script reads the fields it needs and no others, as `gh --json <fields>` does:

```text
$ notes list --format jsonl --fields title,id
{"title":"Groceries","id":1}
{"title":"Ideas","id":2}
$ notes list --format json --fields title --fields id    # the same fields, repeated
$ notes list --format jsonl --fields titel
{"error":{"code":"invalid-input","exitCode":2,"message":"Option \"--fields\" names \"titel\", which the output does not hold. Supply fields from id, title, tags.","hints":["Run \"notes list --help\" to see the usage."]}}
$ notes list --fields title
notes: Option "--fields" applies to the json and jsonl output the formatter provides. Remove --fields, or select output the formatter provides with --format json or --format jsonl.
Run "notes list --help" to see the usage.
```

- **The option.** The hook declares the local string option `fields` after `--format` on every Command it gives `--format`, with `multiple: true`, so it may repeat, `control: true` under [Control options](../core/commands.md#control-options), so it is on the help page as `--fields <fields>` and in `inspect()` and stays off [MCP](mcp.md) tool inputs, no short spelling, no default, and the description `Select top-level fields of json and jsonl output, as a comma list.` Each value is a comma list of field names, split at each comma as [ADR-0127](../decisions/0127-a-multiple-option-binds-a-variable-whose-value-its-authors-delimiter-splits-into-the-list.md) splits a variable at its delimiter: matched literally, untrimmed, with an empty name kept, and the validator rejects a value that holds an empty name with the issue `Supply field names separated by commas, such as name,size.` The names of every occurrence join in order, and a name given twice counts once. A field is a top-level key; a dotted name such as `owner.name` names the key `owner.name`, never a path. A collision with an option named `fields` that the Command, the Application, or another plugin declares is the hook-collision build error, as for `--format`. A positional argument named `fields` also collides, with `@loomcli/core/name-shared-across-kinds`: rename the argument and update action code reading `args.fields`. On a group the hook declares it hidden, as the group's `--format` is: it parses there, and the run fails with the missing subcommand, as `--format` does.
- **Where it applies.** The middleware reads `--fields` only on a run core holds no fault for, so a held fault stays the one raised, and on a Command that declares a result. When the selected view is one of the `json` and `jsonl` views the formatter's hook appended, it sets the run's result transform, which reshapes the result before that view renders it. The hook records the names it appended in a command extension, and the middleware reads those names through `readExtension`. An author-declared view is excluded, even an unmapped `json()` or `jsonl()` under the same key and media type. An author who declares their own JSON view shapes the data themselves, in the action or the view's `map`. Under any other view, a table or a records list among them, it fails before the action runs with an `InputError`, exit 2: `Option "--fields" applies to the json and jsonl output the formatter provides. Remove --fields, or select output the formatter provides with --format json or --format jsonl.` The refusal is thrown from the middleware before `next()`: help installed after the formatter cannot take over this refusal, unlike a rejected `--format` value.
- **What it keeps.** Each object keeps the named keys it holds, in the order the operator named them, and drops every other key. Integer-like keys, such as `"200"` and `"404"`, come out in ascending order regardless of the order in `--fields`, as JavaScript objects order them; the json view does the same without `--fields`. Under `result<Value>` the value is an object, or an array whose elements each are. Under `rows<Row>` core passes each row through the transform as it arrives, so `jsonlRows()` still writes each line before the source finishes. A row or an element that lacks a named key leaves that key out, so `{"title":"Ideas"}` follows `{"title":"Groceries","id":1}`. Without `--fields` every byte is unchanged.
- **A field the output does not hold.** A named field that the value holds nowhere fails the run with an `InputError`, exit 2, whose sentence names each such field and lists the keys the output holds: `Option "--fields" names "titel", which the output does not hold. Supply fields from id, title, tags.` The keys are judged against the value: an object's own keys, or under an array the keys any element holds, and an empty array keeps nothing and fails nothing. Under `rows<Row>` they are judged against the first row alone, because the later rows have not arrived, so a field only a later row holds fails. An output that holds no keys says so: `Option "--fields" names "id", but the output holds no fields. Remove --fields.`
- **A value that is not an object.** A value, an element, or a row that is not an object fails the run with an `InputError`, exit 2, whose sentence names what it holds: `Option "--fields" selects fields of objects, but the output holds a string. Remove --fields.`, with `a number`, `a Boolean`, `null`, `an array`, or `a value that is not an object` in place of `a string`.
- **Effects before a failure.** An unknown field or a non-object value is judged after the action has run. If the Command has an effect, it has already acted when `--fields` fails with exit 2. Do not retry an effect just because field selection failed.
- **Lines already streamed.** Under `jsonlRows()` a failure at a later row leaves the lines already written on stdout, under [A sequence that stops early](../core/results.md#a-sequence-that-stops-early), and the failure encoder writes the failure line on stderr in place of the incomplete-result line. A failure at the first row, which an unknown field always is under rows, leaves stdout empty. Under a whole view nothing is written before the failure.

[ADR-0183](../decisions/0183-a-middleware-may-set-one-result-transform-that-reshapes-a-result-before-its-view.md) records the decision.

## When author code fails

A `map` that throws takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). One outcome has its own text. A value that encodes to nothing, `undefined` at the top, or that `JSON.stringify` throws on, a `bigint` or a cycle, makes the view throw `The value cannot be encoded as JSON. Emit plain JSON data from the action.`, or for `undefined`, `The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.`, reported through the output-view row of the [ordinary failure path](../core/failures.md#the-ordinary-failure-path). The message carries no engine reason, which differs between runtimes; the thrown error keeps the engine's error as its `cause`.
