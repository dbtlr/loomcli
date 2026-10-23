---
description: "The results lane: how a Command declares a result and its named views, row views, media types, emitting the result, and a sequence that stops early."
---

# Results

A result is the typed value a Command produces for its consumer, as distinct from the messages it writes about its work. The results lane is opt-in in four steps, and each step pays for itself alone: a pack view rendered inside the action with no declaration, one declared result with a default view, the [formatter](../plugins/format.md) that lets a run select another view by name, and rows that render as they arrive. Nothing in the first step needs the rest, and a Command that declares no result behaves exactly as [Output](output.md) describes.

The block restates `View` from [Rendered output](output.md#rendered-output) beside the shapes and calls this page adds. The `views()` lines describe one method whose record type and presence follow the carried result: the implementation adds the member to the picked surface where a result is carried, so a declaration with none has no `views` member at all, and it may expose one signature per call with internal dispatch where overloads would make a rejection read as a complaint about the last overload.

```ts
interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  row?: undefined;
  mediaType?: string; // see Media types
}
interface RowView<Row> {
  row: (row: Readonly<Row>, index: number, context: ViewContext) => string;
  head?: (context: ViewContext) => string;
  tail?: (count: number, context: ViewContext) => string;
  render?: undefined;
  mediaType?: string; // see Media types
}
interface DeclaredRowView<Row> extends RowView<Row>, DeclaredViewBrand {
  readonly identity: string;
  readonly [invariant]: (row: Row) => Row; // the same private witness DeclaredView carries
}
type ResultViews<Value> = Readonly<Record<string, View<Value>>>;
type RowViews<Row> = Readonly<Record<string, View<readonly Row[]> | RowView<Row>>>;

function view<Data>(identity: string, definition: View<Data>): DeclaredView<Data>;
function view<Row>(identity: string, definition: RowView<Row>): DeclaredRowView<Row>;
function override<Key extends AnyOverrideKey>(key: Key, replacement: NoInfer<ReplacementView<Key>>): ViewOverride; // a DeclaredRowView<Row> key takes a RowView<Row>

// On Command and Application, before action().
result<Value>(declaration: { views: ResultViews<Value> }): …
rows<Row>(declaration: { views: RowViews<Row> }): …
// On a declaration that carries a result, in every state; absent otherwise.
views<const R extends ResultViews<Value>>(replacements: R, options?: { default?: keyof R & string }): … // under result<Value>
views<const R extends RowViews<Row>>(replacements: R, options?: { default?: keyof R & string }): … // under rows<Row>

// The result rides in the declared types beside args, options, and globals. Its neutral is unknown.
// The data out.render accepts: any value under a whole view, a sequence of a stated row view's rows under one.
type RenderedData<Data, Row> = Data & ([Row] extends [never] ? unknown : Iterable<NoInfer<Row>> | AsyncIterable<NoInfer<Row>>);
// The row view over the rows the data yields, which types a pack view's factory from the data.
type RowViewOver<Data> = [Data] extends [Iterable<infer Row> | AsyncIterable<infer Row>] ? RowView<Row> : never;
type ResultInput<Result> = Result extends { kind: 'value'; value: infer Value }
  ? Value
  : Result extends { kind: 'rows'; row: infer Row }
    ? Iterable<Row> | AsyncIterable<Row>
    : never;
interface Out<Result = unknown> {
  render<Data, Row = never>(data: RenderedData<Data, Row>, view: View<Data> | ([Row] extends [never] ? RowViewOver<Data> : RowView<Row>)): Promise<void>; // one signature over both shapes
  results: (value: ResultInput<Result>) => Promise<void>; // property syntax: contravariant, so a neutral Out never stands in for a specific one
}
```

## Row views

A view renders one whole value in one call, as [Rendered output](output.md#rendered-output) defines it; where the two shapes meet, this page calls it a whole view. A row view renders a sequence one row at a time: `row` receives one row, its zero-based index, and the view context, and returns the text for that row; `head` and `tail` return the text that opens and closes the sequence, and each defaults to the empty string. `head` receives the view context alone, because nothing about the sequence is known before it starts. `tail` receives the number of rows `row` was called with and then the view context, so a summary line reports a count no view has to accumulate, and the count is zero on an empty sequence. Every function is pure and synchronous, holds no output handle, and owns the newlines in the text it returns, because the write site appends nothing. The two shapes are exclusive: a whole view has `render` and no `row`, a row view has `row` and no `render`, the types reject a value with both, and from JavaScript a call that renders one fails as a view that breaks does, so core never guesses. `view(identity, definition)` declares either shape, and a declared row view carries the brand and the invariance witness a declared view carries, so `override` keyed by it takes a row view under the rules of [Views](views.md) unchanged; a replacement supplies the whole shape, so an omitted `head` or `tail` replaces the default's with nothing. `AnyDeclaredView` and `ViewContribution` admit both shapes, as the type block there states.

`out.render` accepts a row view with an iterable: its one signature takes a whole view over the data or a row view over a sequence of that view's rows, a generic sequence included, and data that is not a sequence, such as one row or rows that may be `undefined`, takes no row view. A row view written in the call, or returned by a pack view factory, takes its row type from the data. Where the data carries no row type, the row view states it, as a factory's type argument, `records<Row>({…})`, or a typed row view: under data typed `any`, under data whose type is a type parameter, such as a helper's `Source extends readonly Row[]`, and under inline rows whose literals the row view types as a union, such as `[{ variant: 'compact' }]` under a row view over `'compact' | 'extended'`, which state that type on the array instead. `out.render(rows, records)` renders `head`, then each row as the iterable yields it, then `tail`, and writes each piece in order on the call's destination. A synchronous or an asynchronous iterable is accepted. Core calls `row` for each item as it arrives, with a fresh reading of the destination's `columns` for each call, not inside the `out.render` call, and does not request the next item until the previous piece's write has completed, so a slow destination applies back-pressure to the source; a source that never ends never completes, which is the author's to avoid. The returned promise resolves when `tail` is written. A sequence call, under `out.render` with a row view or under `out.results` with either view shape, holds its place in its destination's order from the moment it is issued until its last piece is written, so a later call to the same destination, awaited or not, writes after the sequence, and the call-order rule of [Output](output.md) reads at the granularity of calls. One consequence is a hazard the author owns: a source that itself writes to the sequence's destination waits behind the sequence, which waits on the source, so such a write is issued before or after the sequence or to the other destination. A pending sequence is open output: the invocation does not complete, under the rule that successful completion requires output completion, until every sequence it issued has ended. This is the first step of the lane: an action renders through a table or records view from the plugin pack with no declaration, no `--format`, and no change to its stdout.

```ts
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';

.action(async ({ out }) => {
  await out.render(rows, table({ columns: ['source', { key: 'count', header: 'Bytes', align: 'right' }] }));
  await out.render(walk(document), records({ identifier: 'path', fields: ['path', 'kind'] }));
});
```

A pack view is a configured factory, and what it returns is a bare view: it carries no identity, nothing replaces it by reference, and two calls with one configuration are two views. Its configuration is typed from the row type. When the factory call is written inside a `views` record, or as the second argument of `out.render`, the row type flows in by contextual typing from the declaration or from the data, an array for a whole view and an array, a generator, or an async generator for a row view, so a column that names a field the rows do not carry is a compile error on that string and each cell callback receives the row's own value types. Hoisted into its own constant, a call has no type to flow in, so the factory states its row type, `table<Row>({…})`, or its cell callbacks go unchecked, and a row view's factory over data that carries no row type states it under the rule above. A `columns` or `fields` list is an ordered list whose entries are a bare key or an object with `key` and the entry's own optional fields, where a bare key is `{ key }`, the list order is the column order, a key may appear twice, and `format` is a function that renders one cell. When the list is omitted every own key that appears in the rows is a column or a field in first-seen order and cells stringify with `String(value)`, and each factory's own section states what it writes over an empty sequence. A factory's return type names one shape, never a union of the two, so its value reaches `out.render` and a `views` record alike. A factory's configuration is plain data the view it returns holds, and no factory publishes it: core sees a bare view and has nothing to key such a fact on, and an application changes a result's layout by naming another view rather than by reaching for the one it has. Each factory's full configuration is its own contract: [Table](../plugins/pack-views.md#table) states the table's, a whole view that measures every row, [Records](../plugins/pack-views.md#records) states the records list's, a row view that writes each record as it arrives, and [List](../plugins/pack-views.md#list) states the list's, a whole view that aligns its ordered markers. The heading, the rule, prose, and the box are [views over a string](../plugins/pack-views.md#views-over-a-string), returned by factories the same way and typed from the string they render or, for a box that frames another view, from that view's data.

## Declaring a result

`result<Value>(declaration)` declares that the Command produces one value, and `rows<Row>(declaration)` declares that it produces a sequence of rows. Both are authoring calls on `Command` and on `Application` for its root action, both return a new value like every other authoring call, and `action()` removes both, because the action's `out.results` is typed from the declaration and an action registered before the type exists cannot be checked against it. Calling either removes the other, and a Command that declares a result must register an action, because a group can keep no promise. The type parameter is stated by the author and is the value under `result` and one row under `rows`. The result travels in the declared types beside the arguments, options, and globals, which is how `ActionHandler<typeof count>` types `out.results` in an extracted action, and the note in [Modular authoring](commands.md#modular-authoring) holds for `views()` as it holds for `extend()`: appending it inside a self-referencing initializer is circular, so an enriched value is derived from the completed declaration. The result's neutral type is `unknown`, so a library's neutral `Command` annotations and `command()` attachment keep compiling for a declaration with a result, and `views()` is published where a result is carried rather than where none is known.

```ts
// src/commands/count.ts
import { Command } from '@loomcli/core';
import { json } from '@loomcli/plugins/format';
import { table } from '@loomcli/plugins/table';

import { countFiles } from '../actions/count-files.js';
import type { Row } from '../row.js';

export const count = new Command('count')
  .argument('files', { required: true, variadic: true })
  .rows<Row>({ views: { table: table({ columns: ['source', 'count'] }), json: json() } })
  .action(countFiles);
```

`views` is a record keyed by view name, and its values are views in the sense [Views](views.md) gives the word, reached by a name rather than by a reference. The first key is the default view, the one core renders when nothing selects another, and every key the record holds when the [formatter](../plugins/format.md)'s hook runs is a name `--format` accepts, so the names are unique by construction. A key is a bare token under the rule Application names meet and is not an integer-like string, because such a key does not keep its authored position, and the record holds at least one entry. Under `result<Value>` every entry is a `View<Value>`. Under `rows<Row>` an entry is a `View<readonly Row[]>`, which core buffers the whole sequence for, or a `RowView<Row>`, which core feeds as rows arrive. Core knows no view name of its own, not even `text`: `json()` and `jsonl()` are whole views the [formatter](../plugins/format.md) ships, with an optional `map` that reshapes what the view receives before encoding, the value under `result` and the collected rows under `rows`. They render as ordinary views with the plugin uninstalled. Installing the plugin adds `--format` to every Command that declares a result and the two views to every record that lacks them, through its `onCommandAttach` hook.

A view states how its text encodes through its [media type](#media-types), never through its name: `json()` declares `application/json` and `jsonl()` declares `application/jsonl`, whatever key the record holds them under and whatever their `map` reshapes. The [manifest](../plugins/manifest.md) and the [MCP](../plugins/mcp.md) plugin read the media types the result's node publishes, so a view named `json` that declares none promises nothing, and a mapped `json()` under another name keeps its media type. Core checks nothing here: a view whose text does not match the media type it declares breaks its author's promise, not a rule of core.

The `views()` call reshapes the views after the fact. It is published in every state on a declaration that carries a result, and never on one that carries none, so an importing application can add a wide table or a mapped `json` to a Command it did not author without touching its action. Its record takes the shape the declaration carries, so a row view under a value result is the same compile error there as in the declaration. It merges by key: an existing key is replaced in place and keeps its position, and a new key is appended. `default` names the key that becomes the default view, one of the keys the same call supplies, so a typo is a compile error; a default once named persists through later calls that name none, and until one is named the first key is the default. A merged record with no views fails where the result renders. Like `extend()`, `views()` returns a new immutable value. A result's view is replaced by name alone: the Application's override list reaches failures, lanes, and declared views by reference, and never a result's views, which carry no identity.

```ts
import { json } from '@loomcli/plugins/format';
import { table } from '@loomcli/plugins/table';

import { count } from './commands/count.js';
import type { Row } from './row.js';

const wide = table<Row>({ columns: ['source', 'count', { key: 'count', header: 'Share', format: share }] });
export const branded = count.views({ wide, json: json({ map: toWire }) }, { default: 'wide' });
```

The declaration is a graph fact. `inspect()` publishes `result` on every node, as [Graph inspection](graph-inspection.md) lists it: `null` where none is declared, and otherwise `{ kind: 'value' | 'rows', views: readonly string[], default: string, mediaTypes: Readonly<Record<string, string | null>> }`, the names in record order and each view's [media type](#media-types) by name. No schema is part of the declaration; a projection that needs the shape of a result reads a fact the plugin that needs it defines.

## Media types

```ts
interface View<Data> {
  // ...render and row, as under Row views...
  mediaType?: string; // such as 'application/json'; omitted means none
}
interface RowView<Row> {
  // ...row, head, tail, and render, as under Row views...
  mediaType?: string;
}
interface ResultNode {
  readonly kind: 'value' | 'rows';
  readonly views: readonly string[];
  readonly default: string;
  readonly mediaTypes: Readonly<Record<string, string | null>>; // by view name, null where a view declares none
}
```

```ts
import { Command } from '@loomcli/core';
import type { View } from '@loomcli/core';
import { json } from '@loomcli/plugins/format';
import { table } from '@loomcli/plugins/table';

import { countFiles } from '../actions/count-files.js';
import type { Row } from '../row.js';

const csv: View<readonly Row[]> = {
  mediaType: 'text/csv',
  render: (rows, { style }) => rows.map((row) => `${style.escape(row.source)},${String(row.count)}\n`).join(''),
};

// For this node, inspect() reports mediaTypes { table: null, csv: 'text/csv', json: 'application/json' }.
export const count = new Command('count')
  .argument('files', { required: true, variadic: true })
  .rows<Row>({ views: { table: table({ columns: ['source', 'count'] }), csv, json: json() } })
  .action(countFiles);
```

A view declares the media type of the text it writes, and a result publishes it by view name, so a reader learns how to parse a view's output from the graph rather than from the view's name. [ADR-0061](../decisions/0061-a-view-declares-its-media-type-and-a-result-publishes-it-by-view-name.md) records the decision.

- **On every view.** `mediaType` is optional on every view shape: a whole view and a row view, a bare view and a declared view. An omitted `mediaType` declares none.
- **An open string.** Core never checks the value: it holds no grammar and no registry of media types, and it never compares the text a view writes with the type it declares. A view whose text does not match its declared type breaks its author's promise. The one rule is the type: TypeScript rejects a `mediaType` that is not a string.
- **Copied when stored.** The call that stores a view reads its `mediaType` once and keeps the string: `result()`, `rows()`, `views()`, and the `views()` a [lifecycle hook](lifecycle-hooks.md) calls for a result's record, and `view()` for a declared view. A later write to the view object changes no fact. A view handed to `out.render` is never stored, and its media type has no reader.
- **The graph fact.** `ResultNode.mediaTypes` holds one entry for each view name the record holds, a view a hook added included: the string the view declared, or `null`. It is frozen with the rest of the node.
- **Selection is by name.** A run selects a view by name, through a middleware's `view` or `invoke()`'s starting selection, and never by media type. Core reads a media type at run time for one purpose: a failed `run()` reads its selected view's media type, as the [failure view context](failure-views.md#failure-view-context) states, to find a [failure encoder](failure-views.md#failure-encoders).
- **The pack's views.** The formatter's `json()` declares `application/json`, and `jsonl()` declares `application/jsonl`, under every `map`. The table and records views declare none, because they write text for a terminal.
- **Its readers.** The [manifest](../plugins/manifest.md) copies `mediaTypes` with each result and states its two encodings for the views that declare them. The [MCP](../plugins/mcp.md) plugin selects the first view whose media type is `application/json` and sends its output as structured content. A [failure encoder](failure-views.md#failure-encoders) answers a failed `run()` whose selected view declares the media type it registered.

## Emitting a result

An action emits its result once through `out.results`. Core renders the selected view: the one a middleware named through `view` on its [context](middleware.md) before the action dispatched, or the declaration's default when none did. Under `result<Value>` the argument is the value, and core renders the selected view over it and writes the text to stdout. Under `rows<Row>` the argument is any `Iterable<Row>` or `AsyncIterable<Row>`, an array included, so an action holds no opinion about whether its consumer wants a buffer or a stream. Under a row view core writes `head`, then each row's text as the source yields it, under the back-pressure and ordering rules of [Row views](#row-views), then `tail`. Under a whole view core collects every row and renders once at the end of the source, so a whole view over an unbounded source never completes, which is the author's choice and not a build error. An empty sequence still writes `head` and `tail`, and renders a whole view over an empty array. `results` is present on every `Out`, so no method is ever removed, and it accepts a value on the action's `out` of a Command that declares a result alone: on a Command with no declared result and on a middleware's or a configuration source's `out` its argument is typed `never`, and a JavaScript caller's call throws a plain `TypeError`, because only the action of a Command that declares a result emits one.

The returned promise resolves when the last byte of the result is written and rejects on a view or a write failure. It is the ordering anchor for anything the action writes afterwards, so `await out.results(rows); await out.info('done')` puts the summary after the last row. The optional-await contract holds: an action that returns normally without awaiting the call still has its result written and accounted for before the invocation completes, because a pending sequence is open output, and the rows source is still drained.

A declared result is a promise the Command makes, and core holds the action to it from the moment the action runs. An action that returns normally without calling `out.results` fails with `ResultError`, exit 1, naming the Command. A failure raised before the call is that failure, because a failure is the outcome, not a missing result. A run cancelled under [Signals, cancellation, and cleanup](signals.md) raises no missing-result fault, because an action that reads `signal` and returns is the sanctioned path. A middleware that never dispatches raises none either, because the action never ran. A second call rejects with `ResultError`. An action that lets the rejection propagate fails with it, and one that catches it decides the outcome, as a middleware does with a second `next()`, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A second call no code awaits or attaches to has no catcher, so core reports its `ResultError` after the chain settles and returns 1, as it reports any output call no code observed under the [ordinary failure path](failures.md#the-ordinary-failure-path). `ResultError` extends `InternalError`, so an override of `InternalError` brands it and its default text carries the `Internal error: ` prefix; its `cause` is `undefined`, because it wraps no thrown value, it carries the Command's `path` and a `kind`, and an override keyed by the class itself reaches it alone.

```ts
class ResultError extends InternalError {
  readonly path: readonly string[];
  readonly kind: 'missing' | 'repeated';
  readonly cause: undefined;
} // exit 1
```

- **Emit before returning.** The action of a Command that declares a result calls `out.results` before it returns, and a return without the call fails with `ResultError` of kind `missing`: [`@loomcli/core/result-contract`](diagnostics.md#loomclicoreresult-contract).
- **Emit once.** The action calls `out.results` once, and a second call rejects with `ResultError` of kind `repeated`: [`@loomcli/core/result-contract`](diagnostics.md#loomclicoreresult-contract).

## Stdout belongs to the result

On a Command that declares a result, nothing the action writes but the result reaches stdout. The action's `out` is its own channel object: `print` and `render` keep their signatures and write to stderr, decided at graph build from the declaration and never at run time from the selected view, so a script that captures stdout receives the result and nothing else the action wrote whichever view ran. The redirect moves the destination and the view context together, so capability detection and glyph selection follow the stream the bytes reach, `out.render(message, lanes.print)` included. `info`, `success`, `warn`, `error`, `debug`, and `trace` already write to stderr, and `fatal` still throws without writing. No method is removed, because an author denied a lane works around the framework rather than through it. On a Command with no declared result every method keeps the destination the table in [Output](output.md) states. A middleware's `out` keeps those default destinations on every Command, so a help page rendered for a result Command still reaches stdout, and a middleware that prints to stdout after `next()` on a result Command owns what its consumer then reads.

## A sequence that stops early

A rows sequence, under `out.results` or under `out.render` with a row view, can stop before it is complete: the source throws, the selected view's function throws, under a row view mid-sequence or under a whole view once the source has ended, a write to the destination fails, the action fails while an unawaited sequence is pending, or the run is cancelled. In every case core stops requesting rows, writes no `tail`, and retracts nothing already written, so under a row view the rows already written stay on the call's destination, and under a whole view nothing was queued before the source ended, so the destination holds nothing from the sequence unless its one final write itself failed partway. Core then writes one line on stderr through the declared view `incompleteResult`, exported from core with the identity `@loomcli/core/results/incomplete`, over `{ path, yielded, written }`: `yielded` counts the rows the source produced, including one an in-flight request delivers after the stop, which is never written, and `written` counts the rows whose text core wrote, which is zero under a whole view. The line resolves through the registry the way `out.render` output does and follows the output-view row of the [ordinary failure path](failures.md#the-ordinary-failure-path): the view owns its newline, an override that returns the empty string silences it, and an override that throws writes nothing for it and, when nothing else failed, fails the run as a foreign throw, because no code can catch it. The line prints for zero rows too, because an empty stdout and a failed stdout must not read the same. Core holds the line until the run settles: it writes the line ahead of the fault's own report, or at the end of a run that reports none, such as a cancelled one or one whose stdout failed, unless a [failure encoder](failure-views.md#failure-encoders) writes the run's failure, because the encoded line is then its only failure text on stderr, or the reader of stdout closed the pipe, because it stopped reading on purpose. When stderr itself has already failed, the line goes through the plain fallback path and no further.

```text
Output is incomplete: Command "count" stopped after 4 rows, 3 written.
```

What follows the line is the fault's own report, when there is one. A write failure follows the destination row of the [ordinary failure path](failures.md#the-ordinary-failure-path), whose diagnostic is the report. Under cancellation the code stays the signal's: from the moment the run is cancelled core requests no further rows and writes no further pieces, calls the source's `return`, and treats the sequence as stopped early, so a truncated result never reads as a complete one. A row an in-flight request delivers after the cancellation counts as yielded and is not written, a cancellation echo the source throws is silent, and when nothing else failed the line stands alone.

```ts
import { Application, incompleteResult, override } from '@loomcli/core';

const app = new Application('quiet', { views: [override(incompleteResult, { render: () => '' })] });
```

## When author code fails

An action, a rows source, or a view that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). On the results lane these outcomes differ.

- **A source that throws.** The sequence stops early, and the incomplete line prints ahead of the fault's own report. A source that throws under an awaited call ends the invocation with that failure's exit code and its diagnostic. Under a call the action did not await and had already returned from, it has no catcher, so core reports it after the chain settles through the ordinary failure path, with its own diagnostic and its own exit code. A foreign throw is offered to the [translators](failures.md#translators) at that point, once: a failure one returns replaces the internal error, reports through its view after the incomplete line, and returns its own code, while the rows already written stand. A failure class the source throws is never offered. A value that iterates neither way is the source's own fault before the first row, a `TypeError` reported as a foreign throw, which the types reject and a JavaScript author alone reaches.
- **A view that throws.** A view of either shape follows the output-view row of the [ordinary failure path](failures.md#the-ordinary-failure-path), rejection with the view's error included, so an action that awaits the call and lets a thrown failure class propagate keeps that class's code as it would for any view. The atomic rule there, nothing written for the call, is scoped to a whole view, and a row view's pieces before the fault stand.
- **An action that fails while its sequence is pending.** The action's failure stays primary, and the sequence is stopped rather than drained. A failure the action raises after `out.results` resolved is an ordinary failure, and the result it already wrote stands.

## Result declaration errors

Core raises no declaration rule for a result. The types reject each fault at the call: they close `result()` and `rows()` after one of them and after `action()`, give `result()` whole views alone and `rows()` whole views or row views, publish `views()` only on a declaration that carries a result, and type the `default` a `views()` call names as one of the keys its own record supplies. A Command with no action may carry a result, which no action emits. A views record that names no view, and a default no view answers, fail where the result renders, through the ordinary render failure. A view name is the author's key, and an integer-like one moves ahead of the other keys, as JavaScript orders an object's keys.
