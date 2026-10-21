---
description: "The formatter plugin: the --format option and how a result is written in the chosen format."
---

# Formatter plugin

The formatter is `@loomcli/plugins/format`. Its factory `format(settings?)` takes one optional setting, `short`, the short spelling `--format` takes, under the convention of [Plugin settings](../core/plugin-contract.md#plugin-settings), and with none `--format` has no short spelling. It declares no global option and claims no slot. It ships two views, `json()` and `jsonl()`, one hook that puts `--format` on every Command that declares a [result](../core/results.md), one always-on middleware that copies a supplied name into `view`, and two [failure encoders](../core/failure-views.md#failure-encoders), for `application/json` and `application/jsonl`. The plugin owns the encodings and the option; core owns the selection.

```ts
// @loomcli/plugins/format
interface FormatSettings {
  readonly short?: NonNullable<StringOption['short']>; // one ASCII letter, as every option's short spelling is
}
function format(settings?: FormatSettings): Plugin<{}>;
function json<Data>(config?: { map?: (data: Readonly<Data>) => unknown }): View<Data>; // mediaType 'application/json'
function jsonl<Data>(config?: { map?: (data: Readonly<Data>) => unknown }): View<Data>; // mediaType 'application/jsonl'
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
jsonkit: Unknown option "--format". Supply a declared option; prefix a hyphenated path with "./".
Run "jsonkit get --explain" to explain this command.
```

Once [help's failure hint](suggestions.md#helps-failure-hint) lands, `Run "jsonkit get --help" to see the usage.` prints between the sentence and the explain line.

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

- **Views.** `json()` and `jsonl()` are whole views: under `result<Value>` they receive the value, and under `rows<Row>` core collects the sequence and they receive the array. `map` reshapes what they receive, identity by default. They are bare pack views under [Row views](../core/results.md#row-views), typed by contextual typing inside a `views` record and as the second argument of `out.render`, and stated, `json<Summary>()`, when hoisted. They render as ordinary views with the plugin uninstalled, so a Command that names `json: json()` first prints JSON by default with no `--format` anywhere. `json()` declares the [media type](../core/results.md#media-types) `application/json` and `jsonl()` declares `application/jsonl`, whatever `map` they take and whatever key holds them.
- **Bytes.** `json()` writes `JSON.stringify(mapped, null, 2)` and one newline. `jsonl()` writes one line per element when the mapped value is an array, each `JSON.stringify(element)` and one newline, and one such line otherwise; an empty array prints nothing. `toJSON` is honored and an `undefined`, function, or symbol property is dropped, as `JSON.stringify` does. A value that encodes to nothing, `undefined` at the top, or that `JSON.stringify` throws on, a `bigint` or a cycle, makes the view throw `The value cannot be encoded as JSON. Emit plain JSON data from the action.`, or for `undefined`, `The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.`, reported through the output-view row of the [Failure contract](../core/failures.md#failure-contract). The message carries no engine reason, which differs between runtimes; the thrown error keeps the engine's error as its `cause`. The text is data: each view escapes it through `style.escape` and replaces every character from U+007F to U+009F with its `\uXXXX` escape, four lowercase hex digits, so nothing the [rendering policy](../core/styles.md#rendering-policies) would strip or read as a terminal control reaches it, and applies no style, so the bytes are the same under every capability.
- **The hook.** A Command with no result is returned unchanged. On one with a result, the hook appends `json` and then `jsonl` to the `views` record where the record lacks the key, so an author's own `json: json({ map })` or `json: myView` is kept as written and the default is unchanged, then declares the local string option `format` after the author's options, with the short spelling `settings.short` names, or none when it is omitted, `control: true` under [Control options](../core/commands.md#control-options), and no default, the description `Select the output format, <default> by default.`, where `<default>` is the declared default at that hook, and a validator that accepts each key and returns the issue `Supply one of <names>.` for anything else. The validator also accepts `ndjson` and transforms it to `jsonl`, unless the record names `ndjson` itself; `ndjson` is an unadvertised alias under [Aliases](../core/commands.md#aliases). The validator maps `ndjson` to `jsonl` before it checks the record's keys, so the option's [input schema](../core/validation.md#input-schema) is the enum of the record's keys and the unadvertised alias stays out of it. The option is an ordinary local option in every respect: parsed at local placement, on the help page as `--format <format>`, or `-f, --format <format>` under `format({ short: 'f' })`, with its description and its accepted values, under the node's `options` in `inspect()`, reaching the action at run time under `options.format` and absent from its types. The `short` setting's type takes one ASCII letter, and the option it spells meets the ordinary option declarations, under [Plugin settings](../core/plugin-contract.md#plugin-settings). A key or spelling collision with an option the Command, the Application, or another plugin declares, the chosen short spelling included, is the hook-collision build error, naming the plugin, the Command, and the declaration that already holds the name or spelling, and the developer resolves it; the plugin offers no rename. A plugin whose hook adds a view installs ahead of `format()` if `--format` is to accept its name. The same order lets the description reflect a hook's changed default.
- **The middleware.** `activate: 'always'`, because a hook-declared option cannot activate it. When the routed Command declares a result and [`ownOptions`](../core/middleware.md) holds a string under `format`, it assigns that string to `view` and calls `next()`; when the option was omitted it assigns nothing, so an earlier plugin's selection stands. A held fault on another input, a structural one such as `--bogus` and an input-source one such as a configuration file that cannot be read included, leaves `format` in `ownOptions`, so the selection stands for the failure, and the fault is raised at the dispatch boundary unless a later middleware takes over. A `--format` its validator rejected is absent from `ownOptions`, so the middleware assigns nothing and the failure's selection stays as it was, the default view when nothing else selected one: `textstat --format yaml one.txt` is the validator's issue, exit 2, written as text because textstat's default view, `table`, declares no media type, and `--format yaml --help` with help installed after the formatter still prints the page.
- **The failure encoders.** The plugin registers one encoder for `application/json` and one for `application/jsonl`, the media types its two views declare, so a failed run whose selected view is a `json()` or `jsonl()` view writes its [failure form](../core/failures.md#the-failure-form) as JSON. Both write the same bytes: one line, `JSON.stringify({ error: form })` with the form's keys in the order `code`, `exitCode`, `message`, `hints`, then one newline, to stderr. Every character from U+007F to U+009F is replaced by its `\uXXXX` escape, four lowercase hex digits, as the views replace it, and no style applies. An author's own view that declares either media type selects the same encoder. `--format` on a Command with no result is the unknown-option error, and `--format` twice or with no value follows the rules every string option follows.

```ts
// src/format/middleware.ts, loaded on every invocation that reaches it
import type { Middleware } from '@loomcli/core';

import type { format } from './plugin.js';

const middleware: Middleware<typeof format> = async (context) => {
  // A hook-declared option, so its value is unknown to the types; it stands under a held fault.
  const selected = context.ownOptions.format;
  if (context.view !== null && typeof selected === 'string') {
    context.view = selected;
  }
  await context.next();
};

export default middleware;
```

## Formatter example coverage

The formatter increment is proven when textstat installs `format({ short: 'f' })` and jsonkit installs `format({ short: 'o' })`, after `help()` and `version()` and ahead of the example plugin, and public APIs alone produce the transcript above: `textstat -f json one.txt` and `textstat --format json one.txt` print the rows as one indented array with the `--timing` line still on stderr, `textstat --format jsonl one.txt` prints one line per row, `textstat one.txt` prints its table, `jsonkit paths -o jsonl -f doc.json` and `jsonkit paths --format jsonl -f doc.json` print one line per `Entry`, `--format ndjson` prints the same bytes, and `--format json` prints one indented array. `textstat --help` prints the page under [The help page](help.md#the-help-page) with its `--format` row, whose description names the declared default, as specified by the [help restyle](help.md#help-and-version-restyle), and whose [accepted values](help.md#accepted-values) list the view names. `inspect()` reports `['table', 'json', 'jsonl']` on textstat's root and `['list', 'table', 'json', 'jsonl']` on `paths`. The acceptance tests cover both views under both units with an empty array and with a map, a `bigint` and a top-level `undefined` as view faults, U+009B and U+001B inside a string printed as escapes under `color: 'never'` and `'always'` alike, an author-declared `json` kept with its map and position, an author-declared `ndjson` key that the alias no longer serves, `--format yaml`, `--format` on a no-result Command, `--format` twice and with no value, an omitted `--format` leaving an earlier plugin's selection in place, `--format yaml --help` printing the page, the hook-collision error against a local, a global, and another plugin's `format`, `format({ short: 'f' })` putting `-f` on the help row and selecting a view through it, its short spelling colliding with a local option's and with help's `-h`. The lifecycle cases live with the [plugin example coverage](../core/plugin-contract.md#example-coverage): a fixture hook declaring an option the action reads at run time and `request` carries, the hook receiving the root, `result` and `hasAction` read from a hook, two plugins' hooks in order with the later replacing a view, each hook build error, `request` holding values on a valid invocation and `null` under a held fault and on a group, a takeover under a held fault and under a throwing validator exiting 0 with no diagnostic, an always-on wrapper ahead of help reaching help's takeover, the held fault raised at the boundary with its code and rank and ranking ahead of a bad `view`, a run cancelled inside a validator and one cancelled mid-chain resolving the signal's code, `view` starting at the default and `null` on a no-result Command, the last assignment before the boundary winning across two middleware, an assignment after the boundary changing nothing, and each `view` fault raised at the boundary and unobserved under a takeover. The two failure encoders' lines are pinned under [Failure encoders acceptance](../core/failure-views.md#failure-encoders-acceptance), and a fixture middleware reads its own global and hook-declared options from `ownOptions` under a held fault on another input, a validation problem, a validator that throws, an unknown option, and a configuration source that fails alike, and finds an option absent when its validator rejected the option's own value or when the option's own occurrence faulted. Each case runs under Node and Bun.
