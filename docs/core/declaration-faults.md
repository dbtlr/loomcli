---
description: When core reports a declaration fault (at the call, at attach, at build) and the Developer Diagnostic that reports it.
---

# Declaration faults

```ts
class DeclarationError extends LoomError {} // exit 1; its Developer Diagnostic, see Developer Diagnostics
```

```ts
// src/commands/list.ts
import { Command } from '@loomcli/core';

// Throws when the module evaluates, with a stack at the second option() line, and the runtime
// prints the rule's Developer Diagnostic, which opens:
// -- SPELLING USED TWICE ---------------------------- @loomcli/core/spelling-taken
//
// Option spelling "-v" is used by both "verbose" and "version".
export const list = new Command('list')
  .option('verbose', { short: 'v', type: 'boolean' })
  .option('version', { short: 'v', type: 'boolean' });
```

A declaration fault throws `DeclarationError` at the earliest of three moments that holds the data proving it: the call, the attach, or the build. Only a declaration that a later step may still add to waits for build. [ADR-0034](../decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md) records the decision, and [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md) carries it forward.

- **Types first.** TypeScript rejects most faults at compile time. A runtime check exists only for a fault a type cannot express, and a value that bypasses the types, from JavaScript or through `any`, gets no rule: the platform's own error reports it. Each check runs at the top of its function, before any side effect, so a call that throws changes nothing.
- **Where a fault surfaces.** A fault at a call or an attach throws when the module that makes the call evaluates, usually at import, with a stack at the offending line, and the run stops there. It never reaches `run()`, so no [failure view](failure-views.md#failure-views) renders it and core sets no exit code. Its `message` holds its whole [Developer Diagnostic](#developer-diagnostics) as plain text, so the runtime's own uncaught-error output prints the diagnostic under the offending line, in every build. A build fault surfaces from `run()` and a thrown `DeclarationError` from `inspect()`; `run()` renders the Developer Diagnostic in a development build and the generic defect message in a distributed one, under [Development builds](release-facts.md#development-builds).
- **One text.** A rule's diagnostic reads the same whichever moment raises it. The tables under [Command declaration errors](commands.md#command-declaration-errors), [Input source declaration errors](input-sources.md#input-source-declaration-errors), [Result declaration errors](results.md#result-declaration-errors), and [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) hold each rule's text, the fault's sentence followed by its correction, and this section alone assigns each rule its moment. Each rule's descriptor under [Developer Diagnostics](#developer-diagnostics) holds its headline, identity, and explanation.

## At the call

The call that receives a bad value throws, and so does a call that the receiver's own earlier calls make wrong. The calls are `new Command()`, `new Application()`, `argument()`, `option()`, `globalOption()`, `alias()`, `command()`, `result()`, `rows()`, `views()`, `action()`, `extend()`, `extension()`, `view()`, `plugin()`, `translate()`, `encodeFailure()`, and `diagnosticRule()`.

- **Names.** An invalid application name, from `new Application()`; an invalid Command name, from `new Command()`; and an invalid argument, option, or alias name, from the call that declares it.
- **Option configuration.** A key or spelling the receiver's own options already hold, generated negative forms and [aliases](options.md#option-aliases) included; an alias name that is not a valid option name; a variable another option of the receiver already binds; and, at `globalOption()`, an option that declares `interaction`, `color`, `verbose`, `quiet`, or `background` when another option of the Application already does, and a configuration binding on the color-marked, verbose-marked, quiet-marked, or background-marked option. An alias that repeats its option's name, another of its aliases, or a spelling the option already accepts adds nothing and is no fault, and a variable an `env` list names twice binds once.
- **Globals.** `option()` on the Application rejects a key or spelling that a global option holds, the application's or a plugin's, or a variable one of them binds. `globalOption()` rejects one that a root-local option, a plugin's option, or a local option on an attached Command holds, the plugins' Commands included, and a variable one of those options already binds. The plugins' Commands, which the constructor attaches, do not close `globalOption()`; only the application's own `command()` or `action()` does.
- **Core facts.** A description, deprecated message, or version is the author's text, and core judges none of them. Help, the manifest, MCP, man pages, completion, and the service unit print a description or a deprecated message on one line, and read each line break in it as a space. The types place `hidden`, `deprecated`, and `control`, and core checks none of their placements.
- **Order.** `argument()` on the root after a plugin's Commands attached, which the types cannot see; a variadic argument that is not last; and a required argument after an optional one. The types close every other call `action()`, `result()`, `rows()`, `argument()`, and `command()` rule out. An alias that repeats its own Command's name or another of its aliases adds nothing and is no fault.
- **Results.** Core checks no result declaration. The types give a value result whole views alone, and `views()` takes a `default` that names one of the keys its own record supplies. A views record that names no view fails where the result renders.
- **Extensions.** On a call that carries `extensions` and on `extend()`: an extension value another installed copy of `@loomcli/core` built, a value its schema rejects, a schema that does not answer synchronously, an output that is not plain data, and two distinct descriptors that share an identity within the receiver, the installed plugins' descriptors included for the Application. A second value of one extension in one layer replaces the first whole, as a value in a later layer does.
- **Plugins.** `plugin()` applies every rule on one definition: the rules on each option declaration, an extension, view, override, translation, or failure encoding another installed copy of core built, two distinct descriptors that share an identity, and two [failure encoders](failure-views.md#failure-encoders) for one media type. Core admits the configuration source's binding descriptor itself, so a binding the plugin does not also list under `extensions` works the same. A signal claimed twice is claimed once, and one key overridden twice resolves to the first override. Each `commands` entry also meets the [attach](#at-attach) checks at `plugin()`, against the root it will join and the entries before it: a Command that is not finished, and two entries with one name or an alias that repeats a sibling's. A sibling diagnostic names the root Command, the parent the entries attach to.
- **The Application.** `new Application(name, options)` applies every rule on its own options and on the installed set: a view, override, or translation another installed copy of core built, two distinct declared-view objects that share an identity across the Application, its plugins, and core, a plugin another installed copy of core built, an identity installed twice, a second claim on the signals slot, the theme slot, or the configuration source, two plugins that register a failure encoder for one media type, two plugins whose options share a key or a spelling or bind one variable, two distinct descriptors that share an identity across the plugins, two options that declare `interaction`, two options that declare `color`, two options that declare `verbose`, two options that declare `quiet`, two options that declare `background`, and a configuration binding on a plugin's color-marked, verbose-marked, quiet-marked, or background-marked option.
- **Failure classes.** Constructing a failure whose class declares a failure code outside its grammar throws from `LoomError`'s constructor, under [Failure codes](failures.md#failure-codes). An exit code outside 1 through 125 is a compile error alone, under [Declared exit codes](failures.md#declared-exit-codes). A failure is usually constructed inside a run, where the fault reports with code 1 like any run-time `DeclarationError`.

## At attach

One attach operation serves `Command.command()`, `Application.command()`, and each plugin's `commands` list, which the Application constructor attaches to the root first, in installation order. A Command is an immutable value, so an attached Command is final: attach checks it as a finished Command and stores it as a typed child.

- **The finished Command.** A Command with neither children nor an action, and stdin declared on a group, a Command with no action.
- **Siblings.** A child whose name repeats a sibling's, and an alias that repeats a sibling's name or alias. The root's children include the plugins' Commands, so the application's own `command()` call throws on a name a plugin Command holds.
- **Joining the Application.** When a subtree joins an Application, through `Application.command()` or a plugin's `commands`, the Application walks it once and throws for what only it can judge: a local option whose key or spelling a global option holds, a variable that a global option and a local option both bind, one Command value reached through two paths, and two distinct descriptors that share an identity across the subtree and the Application.

## At build

`run()` and `inspect()` build the graph and throw only for what no earlier moment could know.

- **The root.** The root is never attached, so build is the first point at which it is final. Build applies the finished-Command rules to it: neither children nor an action, and stdin on a root group.
- **Lifecycle hooks.** A hook that throws, and every fault in what a hook contributes: the hook-collision rule, a rule a hook's erased call breaks, an argument a hook declares on a Command that holds children, and a descriptor a hook's value brings that shares an identity with another. A value a hook passes to `extend()` is validated at that call, as [Lifecycle hooks](lifecycle-hooks.md) states. Then an `onGraphBuilt` hook that throws anything but a `DeclarationError`, and every `DeclarationError` one throws to reject the built graph, under [Judging the built graph](lifecycle-hooks.md#judging-the-built-graph).
- **Defaults and implied values.** `run()` alone passes each declared default and each [implied value](options.md#implied-values) through its validator, before it reads any token, because the validator may answer asynchronously.
- **Input schemas.** In a [development build](release-facts.md#development-builds), `inspect()` and every `run()` call each validated input's converter at build and throw `@loomcli/core/schema-converter-failed` for a converter that throws or returns anything but a plain object. The check runs after the rules over what the lifecycle hooks returned. A distributed build runs no such check.
- **Descriptions.** Build checks no description. A lint rule reports a Command, an option, or an argument declared without one, in the editor and in CI, under [ADR-0098](../decisions/0098-lint-is-the-author-guidance-lane.md).

## Developer Diagnostics

```ts
interface DiagnosticRule {
  readonly identity: string;
  readonly headline: string;
  readonly explanation: string;
  readonly docs: string | undefined;
}
function diagnosticRule(
  identity: string,
  definition: { readonly headline: string; readonly explanation: string; readonly docs?: string },
): DiagnosticRule; // frozen
function isRuleIdentity(value: unknown): value is string;

interface Finding {
  readonly path?: readonly string[]; // the Command the declaration sits on; [] is the root
  readonly call: string; // the authoring call, such as 'option', 'alias', or a plugin factory's name
  readonly arguments: readonly unknown[]; // the call's arguments as core holds them
  readonly mark?: string; // a dotted path into arguments, such as '1.multiple'
  readonly note?: string; // one line printed beside the mark
}
interface DiagnosticParts {
  readonly sentence: string;
  readonly findings?: readonly Finding[];
  readonly correction?: string | readonly string[];
}

class DeclarationError extends LoomError {
  readonly rule: DiagnosticRule | undefined;
  readonly sentence: string;
  readonly findings: readonly Finding[];
  readonly correction: string | readonly string[] | undefined;
  constructor(rule: DiagnosticRule, parts: DiagnosticParts, options?: ErrorOptions);
  constructor(sentence: string, options?: ErrorOptions);
}
class InternalError extends LoomError {
  readonly cause: unknown;
  readonly rule: DiagnosticRule | undefined;
  readonly sentence: string;
  readonly correction: string | readonly string[] | undefined;
  constructor(rule: DiagnosticRule, parts: Omit<DiagnosticParts, 'findings'> & { readonly cause: unknown });
  constructor(message: string, cause: unknown);
}
```

```ts
// src/plugin.ts, a plugin that checks its own factory's argument
import { DeclarationError, diagnosticRule, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import { packageName } from './constants.js';

const retryLimit = diagnosticRule(`${packageName}/retry-limit`, {
  headline: 'Retry limit out of range',
  explanation:
    'Each retry repeats the request against the service, so a large limit can hold the terminal for minutes. The plugin accepts from 0 through 10 retries.',
});

export function retry(limit: number): Plugin {
  if (!Number.isInteger(limit) || limit < 0 || limit > 10) {
    throw new DeclarationError(retryLimit, {
      sentence: `retry() received ${String(limit)} retries.`,
      findings: [{ call: 'retry', arguments: [limit], mark: '0', note: 'from 0 through 10' }],
      correction: 'Pass a whole number from 0 through 10.',
    });
  }
  return plugin(packageName, {
    /* ... */
  });
}
```

`retry(50)` throws while the module loads, and the runtime prints the diagnostic the error's `message` holds:

```text
-- RETRY LIMIT OUT OF RANGE ---------------------------- @acme/retry/retry-limit

retry() received 50 retries.

    retry(50)
          ^^ from 0 through 10

Each retry repeats the request against the service, so a large limit can hold
the terminal for minutes. The plugin accepts from 0 through 10 retries.

Pass a whole number from 0 through 10.
```

A Developer Diagnostic teaches the author what broke, where, why the rule exists, and how to fix it. The author sees it for a declaration fault and, in a [development build](release-facts.md#development-builds), for a defect. [ADR-0051](../decisions/0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md) records the decision.

- **The anatomy.** Six parts, in order, separated by one blank line, each left out when the fault does not carry it: the banner, the sentence, the findings, the explanation, the correction, and the docs link.
- **A rule.** `diagnosticRule(identity, definition)` declares one rule and returns a frozen descriptor that every site raising it shares. The identity is the declaring package's name, zero or more subpath segments, and a kebab-case rule name, each segment after a `/` and kebab-case, `<package>[/<subpath>...]/<rule-name>`, the grammar of [issue codes](../libs/validators.md#issue-codes): an [identity](plugin-contract.md#identity-and-installation) followed by a rule name. The subpath names the part of the package that owns the rule, such as a plugin the package ships as a subpath: `@loomcli/plugins/manifest/failure-code-conflict`. Core's rules take `@loomcli/core/`. One rule covers one reason a declaration is wrong, so several sites that reject one kind of value share it. The headline is a short noun phrase, the explanation is prose that says why the rule exists, and `docs` is an optional URL. `diagnosticRule()` throws a `DeclarationError` for an identity outside the grammar, and takes the headline, the explanation, and `docs` as the author wrote them.
- **The fault's parts.** A `DeclarationError` built from a rule carries the sentence, the findings, and the correction. The sentence says what is wrong, and the correction says what to do: a rule table's text is the sentence followed by the correction, so `Option "raw" is declared more than once on Command "get".` is the sentence and `Remove or rename the duplicate.` the correction. The correction is one imperative sentence, or a list of them when several fixes fit, printed one per line under `- `. The sentence-only constructor stays, for a plugin that has no rule, and its diagnostic holds the banner `-- INVALID DECLARATION --` and the sentence.
- **The banner.** Two hyphens, the headline in capitals, a run of hyphens, and the rule's identity, filling stderr's effective width, the `columns` a view context for stderr reads at that moment, or 80 columns when that is `undefined` or the text goes into `message`. A stderr that is not a terminal falls back to 80, even when a host override reports a width. The explanation wraps to the same width, with the line breaker `context.wrap` uses, so a word wider than the width keeps a line of its own. That breaker measures terminal display width where the earlier breaker counted string length. `COLUMNS` narrows that width as it narrows any `columns`. A fault with no rule reads `INVALID DECLARATION` for a `DeclarationError` and `DEFECT` for an `InternalError`, with no identity.
- **Findings rebuild the declaration.** A finding names the authoring call and the arguments core holds, and the diagnostic prints the call as JavaScript an author recognizes, indented four spaces: strings in single quotes, plain objects with their keys, and a function or a validator as `…`. A finding with a `path` prints under the Command it sits on, `new Command('get')` above `.option(…)`, and opens with the path, after the application name when `run()` reports the fault. `mark` underlines one argument or one key inside it with `^`, and `note` prints beside the marks. A fault between two declarations, such as a plugin's option that collides with a local option, carries a finding for each. Findings hold no file or line; a later static check can add them to the same part.
- **Core's declaration findings.** A finding core raises at a call on a named Command opens with that Command's name alone, because the call cannot know the parent it will join; one raised at an attach opens with the path the parent knows, and one raised at build or from `run()` with the whole path. A fault about a child as a whole, such as a Command with nothing to run or a name a sibling already holds, marks the call that attached it: `.command(new Command('get'))`, or the entry in a plugin's `commands` list, where a Command value prints as `new Command('get')`. A fault that is an absence at the root, a root with nothing to run, has no call to mark and carries no finding. A name that breaks a name rule is quoted escaped in the sentence, so a line break in it cannot break the line. A fault about one key of an argument's or an option's config, such as `default` or `env`, marks that key inside the call that declared the input, `globalOption()` for an application's global option and the entry in its plugin's `options` record for a plugin's, and a collision between two inputs carries a finding for each side, noted with the scope that declared it. A fault about one key of a plugin's definition or of the Application's options rebuilds the call with that key alone, `plugin('@acme/json', { failureEncoders: […] })` or `new Application('probe', { plugins: […] })`, and marks the key, a key inside its value, or the list entry at fault; a plugin in a `plugins` list prints as `plugin('@acme/log', …)`, a declared view as `view('@acme/page', …)`, an override as `override(InputError, …)`, and a class key of `translate()` by its name. A repeat inside one list, such as a plugin installed twice, a second claim on a slot, or two failure encoders for one media type, carries a finding for each entry. A value an `extensions` list or an `extend()` call carries is marked with its extension's identity as the note. A fault no call declared, such as a read through a second copy of an extension descriptor or a failure class whose exit code no failure may carry, carries no finding.
- **A defect's findings.** For an `InternalError` whose `cause` is an Error, the findings are the cause chain, each cause's name and escaped message, or a `DeclarationError`'s sentence, and its stack, following `cause` links until one repeats. Each error an `AggregateError` holds prints right after it, in order, under `Holds `, with its own chain. A stack's frames are read after its header, the cause's name and message, so a message line that reads as a frame is never one. A frame's location is the text between the first ` (` and the closing parenthesis, or the whole frame after `at`, so a path that holds spaces or parentheses reads whole. Above them, in a development build, core prints the author's source: the first frame of the outermost cause's stack, or for an `AggregateError` of the stacks of the errors it holds in order and then its own, whose file lies under `host.cwd`, or under the path `host.cwd` resolves to through symbolic links, and outside any `node_modules` directory, with two lines on each side, line numbers, and a caret under the frame's column. Core converts a `file:` URL frame to a path, and reads the file through `host.readSource(path, host.cwd)` only in a development build, only while it reports a defect, and only when the normalized path lies under `host.cwd`, because a thrown value's stack can be forged; the captured reader then resolves both through symbolic links and refuses a file that leaves `cwd`. A read that answers `undefined` or throws, and a stack with no qualifying frame, leave the frame's location alone.
- **The layout.** A finding with a `path` opens with a comment, `// jsonkit get`, above its receiver. A declaration fault's sentence keeps the line breaks its author wrote, such as the issue lines under a rejected default or implied value, and a defect's sentence stays on one line. A thrown reason inside either sentence, such as the reason in `Option "token" validator failed unexpectedly: <reason>.`, prints each control character, line separator, and bidirectional control as its escape by [`escapeControlCharacters`](styles.md#strings-and-composition), so it never breaks the sentence's line. A defect whose cause is not an Error prints `Thrown value:` and the value the way a finding prints an argument. The docs link prints as `See <url>`. In a run, the hints follow the diagnostic after one blank line, the diagnostic of a broken view or the throw of an `onFailure` hook follows the failure's own text after one blank line, and any other diagnostic that follows an earlier report of the same run opens with one blank line.
- **Ahead of every override.** The diagnostic is not a view and has no identity. In a development build, core renders it for a defect or a `DeclarationError` that `run()` reports before it consults any override, and prints the hints of [Failure hints](lifecycle-hooks.md#failure-hints) under it. It resolves through core's default styles for stderr, and with no color it is the plain text shown above.
- **In the message.** A `DeclarationError`'s `message` holds its whole diagnostic as plain text at 80 columns, so a fault thrown at a call or an attach prints its diagnostic through the runtime's own uncaught-error output in both builds, under the runtime's source line. Its `sentence` holds the sentence alone. An `InternalError`'s `message` stays its sentence, because only `run()` reports one.
- **Core's defect rules.** Each defect core raises carries a rule of its own.

  | Rule                                    | Raised when                                                                                  |
  | --------------------------------------- | -------------------------------------------------------------------------------------------- |
  | `@loomcli/core/foreign-throw`           | An action, a middleware, a source, a view, a translator, or a plugin's hook threw a value no translator answered |
  | `@loomcli/core/broken-failure-view`     | A failure view threw                                                                         |
  | `@loomcli/core/broken-failure-encoder`  | A [failure encoder](failure-views.md#failure-encoders) threw or returned a value that is not a string        |
  | `@loomcli/core/plugin-loader-failed`    | A plugin's middleware or source loader rejected or exported no default                       |
  | `@loomcli/core/next-misuse`             | A middleware called `next()` twice or after it returned                                      |
  | `@loomcli/core/result-contract`         | An action broke the [result](results.md) contract, one `ResultError` kind                      |
  | `@loomcli/core/view-selection`          | A middleware assigned `view`, or `invoke()` selected a view, that the routed Command's result cannot render |
  | `@loomcli/core/source-answers`          | A configuration source answered outside the answers rule                                     |
  | `@loomcli/core/run-options`             | `run()` received a `signal` that is not an `AbortSignal`                                     |
  | `@loomcli/core/invalid-release-facts`   | The build baked malformed [release facts](release-facts.md); it renders as its Developer Diagnostic in every build |
  | `@loomcli/core/invoke-options`          | `invoke()` received a malformed path, values, signal, failure handler, progress observer, or host, under [Invocation by name](invocation.md#invocation-by-name) |
  | `@loomcli/core/foreign-graph`           | A graph `inspect()` did not return, or whose nodes disagree with its build, reached core     |
  | `@loomcli/core/broken-destination`      | A host stream failed a write the run owed it                                                 |

  A validator that throws, rejects, or returns a malformed result is a declaration fault under `@loomcli/core/validator-failed`, as [Issues and validator failures](validation.md#issues-and-validator-failures) states. Every declaration fault in core, `@loomcli/plugins`, and `@loomcli/validators` carries a rule too. The Rule columns of [Command declaration errors](commands.md#command-declaration-errors), [Input declaration errors](options.md#input-declaration-errors), [Input source declaration errors](input-sources.md#input-source-declaration-errors), [Result declaration errors](results.md#result-declaration-errors), and [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) name core's. The pack declares its own through `diagnosticRule()`, as a third-party plugin does: `@loomcli/plugins/config/file-path` and `@loomcli/plugins/config/file-pattern` under [Configuration](../plugins/config.md), `@loomcli/plugins/manifest/failure-code-conflict` under [Manifest failures](../plugins/manifest.md#manifest-failures), and `@loomcli/plugins/version/postfix` under [Version](../plugins/version.md). The catalog's are listed under [Faults at the call](../libs/validators.md#shared-rules).
- **Names.** `diagnosticRule`, `isRuleIdentity`, `DiagnosticRule`, `Finding`, and `DiagnosticParts` are exported from `@loomcli/core`.
- **The rule grammar.** `isRuleIdentity(value)` answers whether a value is a string in the rule-identity grammar, the check `diagnosticRule()` runs, so a package that keys its own values on that grammar, as `@loomcli/validators` keys [issue codes](../libs/validators.md#issue-codes), checks them against core's grammar instead of a copy.

### Developer Diagnostics acceptance

Developer Diagnostics are proven when public APIs alone produce these results under Node and Bun:

- **Thrown at a call.** A fixture whose two `option()` calls give one short spelling throws while it loads; the error's `message` holds the diagnostic of its rule, and the process's stderr under both runtimes contains it.
- **From `run()`.** A build fault, a default its validator rejects, and an implied value its validator rejects each write their pinned diagnostic from source in a development build, with the application name before the path in the findings.
- **A third-party rule.** The fixture plugin above writes the pinned text for `retry(50)`, with two findings for a fixture fault that names both sides of a collision, and a correction list printed one line per fix. A sentence-only `DeclarationError` from a fixture plugin writes the banner and the sentence alone.
- **The descriptor.** `diagnosticRule()` throws for an identity with no package part and one with an uppercase rule name, and returns a frozen value otherwise.
- **A defect's source.** In a development build, an action that throws a `TypeError` prints the rule's banner, the action's own source lines with the caret under the failing column, and the cause's name, escaped message, and stack; a cause chain of two prints both. A frame inside `node_modules` is skipped for the next qualifying one.
- **The guards.** A fixture throws an Error whose forged stack names a file outside `host.cwd` and one that names a file that does not exist; `readSource` is not called for the first, the second answers `undefined`, and both print the frame's location alone. The captured reader answers `undefined` for a symbolic link under `cwd` that points outside it, with `cwd` itself reached through a symbolic link, as `/tmp` is on macOS. A frame named by a `file:` URL reads its file. A `readSource` that throws prints the location alone. In a distributed build `readSource` is never called. The captured reader answers `undefined` for a FIFO and for a file larger than 1 MiB. A message line that reads as a frame never names a file the reader is asked for, a frame whose path holds spaces or parentheses reads its file, and an action thrown from a module under a `host.cwd` reached through a symbolic link prints its source.
- **Escaping.** A cause whose message holds a line break, a bidirectional control, or a U+2028 prints it escaped by [`escapeControlCharacters`](styles.md#strings-and-composition), both in the cause chain and where the sentence quotes it, a validator's thrown reason included.
- **The layout.** Goldens pin the whole text of a third-party rule's fault with findings, a core declaration fault with a finding for each of two declarations, a core fault with no finding from `run()`, and a defect with its source and stack.
- **The families.** Every declaration rule in core, the pack, and the catalog pins its identity, sentence, and correction, family by family. Each explanation lives in its rule's registry, and one registry test per package checks that every rule there has one declaration, a one-line headline, and an explanation of whole sentences on one line.
