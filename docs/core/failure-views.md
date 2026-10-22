---
description: "How a failure renders: failure views, the failure view context, and failure encoders."
---

# Failure views and encoders

This page states how a failure renders: the failure views, the context they receive, and the failure encoders. An author uses it to restyle or re-encode a failure.

## Failure views

Core keys each failure class's default text function as that class's default view, so a failure is overridden with the same `override` call as any other view. The key is the class itself, and the replacement is typed from its instances, so `override(InputError, fn)` checks `fn` against an `InputError`. This is the typed path for a class-keyed list, because an array literal cannot carry a different type parameter per element.

```ts
import { Application, InputError, override, UnknownCommandError } from '@loomcli/core';

import { summarize } from './actions/summarize.js';
import { inputProblems, unknownCommand } from './views.js';

export const jsonkit = new Application('jsonkit', {
  views: [override(InputError, inputProblems), override(UnknownCommandError, unknownCommand)],
}).action(summarize);
```

The view receives the failure instance and the [failure view context](#failure-view-context): the stderr view context, where the run was, and the hints plugins added. It returns marked text that core resolves for stderr without adding a newline, so the view owns its trailing newline. Core's default diagnostics escape raw facts; `FatalError` retains the authored marked message supplied to `out.fatal()`. A working view cannot change the exit code, which is a fact of the class.

The [failure message voice](failures.md#failure-message-voice) states the rules core's default text follows for an operator, what went wrong and what to do instead.

Resolution follows the one walk [Views](views.md) defines: the application's overrides, then each installed plugin's overrides in installation order, then core's default text, with the thrown failure's prototype chain walked in full, most derived first, at each contributor before the next is consulted. An override for `UsageError` therefore brands every exit-2 failure core raises at once, whatever any plugin registers beneath it, and within one contributor an override for a `FatalError` subclass beats one for `FatalError`. In a distributed build, `DeclarationError` and `InternalError` reach overrides too, because the generic defect message is output the application owns; a `DeclarationError` build raises reaches the application's overrides, and a plugin's overrides are not consulted for it. In a development build, neither reaches any override: core renders its [Developer Diagnostic](declaration-faults.md#developer-diagnostics) first, so no override can hide a fault from the author. A `DeclarationError` thrown from an authoring call, a constructor, or an attach never reaches `run()`, so no view renders it, as [Declaration faults](declaration-faults.md) states. In a distributed build, a `DeclarationError` raised at run time, such as a typed read through the wrong descriptor, resolves through every contributor like any other failure. Two overrides for one class by one contributor are a declaration error from the call that holds the list; the same class overridden by the application and a plugin, or by two plugins, resolves first-in-wins, as [Views from plugins](plugin-contract.md#views-from-plugins) describes.

Core's default text for each class is a plain function that runs no application code. The class's default view is that function, and the plain fallback path in the [ordinary failure path](failures.md#the-ordinary-failure-path) calls it directly, so a broken override can never leave a failure unreported.

An application can treat fatal messages as literal error text with one override:

```ts
import { Application, FatalError, override } from '@loomcli/core';

const app = new Application('reader', {
  views: [override(FatalError, {
    render: (failure, { style }) => `${style.escape(failure.message)}\n`,
  })],
});
```

Its actions call `out.fatal(message)`, and its helpers throw `new FatalError(message)` and jsonkit's `PathNotFoundError`, a subclass. Both pass unescaped messages. The view escapes once, so helpers need no output or style context. Jsonkit and textstat use this pattern. The override applies to those applications; core's default `FatalError` view still accepts authored marked text.

### Failure view context

```ts
interface FailureViewContext extends ViewContext {
  readonly application: string;
  readonly path: readonly string[];
  readonly hints: readonly string[];
  readonly invokedBy: 'argv' | 'name'; // how the run received its inputs
  readonly view: string | undefined; // the view name the result would render through when the run failed
  readonly mediaType: string | undefined; // the media type that view declares
}
interface FailureView<Failure extends LoomError> {
  render: (failure: Readonly<Failure>, context: FailureViewContext) => string;
  row?: undefined;
}
```

```ts
import { Application, override, UsageError } from '@loomcli/core';

// For an application with a `cache clear` Command, `store cache clear --bogus` writes this line,
// then each hint on its own line:
// store cache clear: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".
export const store = new Application('store', {
  views: [
    override(UsageError, {
      render: (failure, { application, hints, path, style }) =>
        [`${[application, ...path].join(' ')}: ${style.escape(failure.message)}`, ...hints]
          .map((line) => `${line}\n`)
          .join(''),
    }),
  ],
});
```

A failure carries what went wrong, and the run carries where it happened. [ADR-0046](../decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) records the decision.

- **`application`.** The name the Application was constructed with, the value `graph.name` holds. It is known for every failure, so every failure view reads it, a build fault's view included.
- **`path`.** The canonical names routing walked when the failure was raised; an alias reports its Command's canonical name, as `CommandNode.path` does. It is `[]` before routing: for a declaration fault raised at graph build, a failure raised before build, and a declared default or implied value its validator rejects. For an unknown Command it is the partial path walked before the unknown token, so `store cache nope` reads `['cache']`. Otherwise it is the path routing reached, for every held fault, a structural fault on a global option and a misplaced option included, and for every failure the chain or the action raised, so `store --file` with no value reads `[]`, `store cache --force clear` reads `['cache']`, and `store cache clear --bogus` reads `['cache', 'clear']`.
- **`hints`.** The lines the installed plugins' `onFailure` hooks returned for this failure, in installation order, as a frozen array, under [Failure hints](lifecycle-hooks.md#failure-hints). It is `[]` when no hook contributed and for a failure no hook runs for.
- **`invokedBy`.** How the run received its inputs: `'argv'` for a `run()` call and `'name'` for a run [`invoke()`](invocation.md#invocation-by-name) started, a nested one included. The by-name sentences [Failure classes](failures.md#failure-classes) states are the failure's own `message`, which core writes where it raises the failure, so core's default text and a view that prints `message` read them as they are. A view or a hint that points at a command line, such as `Run "jsonkit get --help"`, reads `invokedBy` to stay silent where no command line exists.
- **`view` and `mediaType`.** The run's selection when it failed: the view the result would render through, which a [failure encoder](#failure-encoders) reads under `run()`. `view` is the last name a middleware assigned to `view` before the dispatch boundary, else the name [`invoke()`](invocation.md#invocation-by-name) started with, else the routed Command's default view, the value a middleware's `view` holds, and the rule is the same before and after dispatch. For a failure raised after the boundary dispatched the action, it is the [selected view](results.md#emitting-a-result) the boundary read. For a failure raised before dispatch, a held fault the boundary raises included, it is the name `view` held when the run failed. A `--format` its validator rejected is never assigned, so the selection stays as it was, an earlier middleware's assignment or the name `invoke()` started with, else the default view: `textstat --format yaml one.txt` reads `table`. `mediaType` is the media type that view declares, read from the routed Command's `ResultNode.mediaTypes` under [Media types](results.md#media-types), and `undefined` when the view declares none. Neither field is the graph, so the rule below that a failure view's context carries no graph stands.
- **When the selection is `undefined`.** Both fields are `undefined` in four cases alone: a build fault, which includes a failure raised before the graph built and a declared default its validator rejects; an unknown command, because routing reached no Command; a Command that declares no result; and an assigned or starting name the routed Command's result does not hold, which the dispatch boundary rejects.
- **Filled once.** `run()` and `invoke()` fill all six where they catch the failure, before they call the view. Core adds nothing to the failure instance, and no failure class carries a field for any of them. A fault reported after the primary outcome, such as a row source that throws after the action returned without awaiting it, reads the same `application`, `path`, `view`, and `mediaType`, and hints of its own.
- **Default text.** Core's default text for every class writes the sentence it writes without hints, then each hint followed by one newline, with no prefix and no indent. A hint is marked text, so core resolves it for stderr as it resolves view output and escapes nothing in it. With no hints, the default text is unchanged byte for byte. The default text does not wrap: each failure sentence stays on one line on a terminal, on a pipe, and in a bug report, so an operator can search it and an author can paste it whole. An application that wants wrapped failures overrides the failure view and calls `context.wrap`.
- **Overrides.** An override receives the hints and decides whether to print them. One that ignores `hints` prints none, and core never appends them behind an override.
- **Plain fallback.** The plain fallback path of the [ordinary failure path](failures.md#the-ordinary-failure-path) writes core's default text for the original failure without hints, because it resolves no markup and writes nothing a plugin produced.
- **No `command`.** A failure view's context never carries a member named `command`. A build fault has no graph, and `path` names the place; advice that needs the graph belongs in a hint.
- **Other views.** Lane views, the help page, the version line, and result views receive `ViewContext` unchanged.
- **Types.** `FailureViewContext` and `FailureView` are exported, and `override(FailureClass, view)` takes a `FailureView` of the class's instances. A `View<Failure>` written against `ViewContext` is assignable to it, because its function reads less of the context, so an existing failure override compiles unchanged.

## Failure encoders

```ts
type FailureEncoder = (form: FailureForm) => string;
function encodeFailure(mediaType: string, encoder: FailureEncoder): FailureEncoding; // FailureEncoding is opaque and branded

interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  failureEncoders?: readonly FailureEncoding[];
  // ...
}
```

```ts
// src/format/plugin.ts, the entry module of the @loomcli/plugins/format subpath
import { encodeFailure, plugin } from '@loomcli/core';
import type { FailureEncoder, Plugin, StringOption } from '@loomcli/core';

import { packageName } from '../constants.js';
import { escapeControls } from '../encode.js';
import { attachFormat } from './attach.js';

export interface FormatSettings {
  readonly short?: NonNullable<StringOption['short']>;
}

// One line on stderr: {"error":{"code":…,"exitCode":…,"message":…,"hints":[…]}} and a newline.
const errorLine: FailureEncoder = (form) => `${escapeControls(JSON.stringify({ error: form }))}\n`;

export function format(settings?: FormatSettings): Plugin<{}> {
  // ...the settings check under Plugin settings...
  return plugin(`${packageName}/format`, {
    failureEncoders: [encodeFailure('application/json', errorLine), encodeFailure('application/jsonl', errorLine)],
    middleware: { activate: 'always', load: () => import('./middleware.js') },
    onCommandAttach: attachFormat(settings?.short),
  });
}
```

A failure encoder writes a failed run's [failure form](failures.md#the-failure-form) in the media type the run selected, so a run that prints JSON on success prints JSON on failure. It is a stage ahead of view resolution, not a view override, because overrides resolve first-in-wins and none can decline. Core encodes nothing itself, under [ADR-0023](../decisions/0023-a-command-declares-its-result-and-core-resolves-its-presentation.md). [ADR-0064](../decisions/0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) records the decision.

- **Registration.** `encodeFailure(mediaType, encoder)` pairs a media type with a function and returns a `FailureEncoding`. A plugin lists its encodings under `failureEncoders`, as it lists [translations](failures.md#translators) under `translators`. The Application registers none; an application that wants its own encoder installs a small local plugin.
- **One encoder per media type.** Media types compare as the exact strings core stores, under [Media types](results.md#media-types), which holds no grammar. Two encodings for one media type in one plugin are a `DeclarationError` from `plugin()`, and two plugins that register one media type are a `DeclarationError` from the Application constructor, both under [`@loomcli/core/failure-encoder-taken`](diagnostics.md#loomclicorefailure-encoder-taken).
- **When it answers.** When `run()` reports a failure whose [failure view context](#failure-view-context) reads a `mediaType` that an installed plugin registered, core calls that encoder once with the failure's form and writes the returned text to stderr as it is: it resolves no markup, escapes nothing, and appends nothing, so the encoder owns its newline. No failure view resolves for that failure, an application's override included. A failure whose `mediaType` is `undefined`, or that no encoder answers, renders through its view as before.
- **The only failure text.** When an encoder writes a failed `run()`'s failure, its line is the only failure text the run writes to stderr: core writes no [incomplete-result](results.md#a-sequence-that-stops-early) line for that run either. Core holds the line until the run settles and writes it unless the failure went out through an encoder, so a run whose failure no encoder writes keeps it: a stream cancelled mid-sequence under `--format jsonl`, which fails nothing, a stdout write that fails, such as on a full disk, whose report takes the plain fallback path, and a broken encoder, whose fallback text follows the line. A development build still writes a defect's Developer Diagnostic first, as the next rule states. A log record is not failure text: a [logging plugin](../plugins/logging.md) that writes to the console writes its records beside the encoded line, as its author chose.
- **Defects by build.** In a [development build](release-facts.md#development-builds), a defect or a declaration fault writes its [Developer Diagnostic](declaration-faults.md#developer-diagnostics) and the hints under it first, as today, and then, after one blank line, the encoder's line. In a distributed build the encoder's line takes the place of the generic defect message, and its form reads `internal` and `Something went wrong.`
- **Each reported failure.** The stage takes the place of the view wherever core resolves a failure's view: the primary failure and each fault reported after it, each with a line of its own. A report core writes through the plain fallback path of the [ordinary failure path](failures.md#the-ordinary-failure-path), such as a broken failure view's or a throwing `onFailure` hook's, stays text, and the at-most-once rule of the generic defect message applies to that text alone.
- **Stdout is untouched.** The stage writes to stderr alone. Rows a row view wrote before the failure stay on stdout, and the encoded line, with no incomplete-result line ahead of it, tells a reader the result is incomplete. A whole view, such as the formatter's `jsonl()`, wrote nothing of a sequence that stopped.
- **`run()` alone.** [`invoke`](invocation.md#invocation-by-name) never calls an encoder: its outcome and its caller's handler carry the form, and `messages` keeps the failure view's text.
- **Synchronous.** An encoder runs synchronously and receives the form alone.
- **Names.** `encodeFailure`, `FailureEncoder`, and `FailureEncoding` are exported from `@loomcli/core`. `plugin()` rejects two encodings for one media type and an encoding another installed copy of core built, under [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors).

## When author code fails

A failure view, a failure encoder, or an `onFailure` hook that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Two outcomes differ, because both protect the report of the original failure:

- **A broken failure view.** A view that throws or returns a non-string is itself an internal failure, so that invocation returns 1 whichever code the original failure carried, except in a cancelled run, which keeps its signal's code under [Signals and cancellation](signals.md) and reports the view fault as text. Core writes the original failure's default text through the plain fallback path first, so a broken override never leaves a failure unreported.
- **A broken encoder.** An encoder that throws or returns a value that is not a string, a promise included, is a defect. Core writes the original failure's default text through the plain fallback path, then reports the broken encoder by build: the generic defect message in a distributed build, at most once per run, and the Developer Diagnostic of [`@loomcli/core/broken-failure-encoder`](diagnostics.md#loomclicorebroken-failure-encoder) in a development build. The diagnostic's reason is the thrown value's, escaped, `The encoder returned a promise instead of a string.` for a promise, or `The encoder returned number instead of a string.` for any other value. A returned promise receives a rejection handler and is otherwise ignored. The run returns 1, except a cancelled run, which keeps its signal's code.

[The ordinary failure path](failures.md#the-ordinary-failure-path) states the rest of the rules for a throwing `onFailure` hook and for a failure that reaches no view.
