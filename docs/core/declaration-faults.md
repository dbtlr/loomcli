---
description: When core reports a declaration fault (at the call, at attach, at build), the defects that author code raises, and the Developer Diagnostic that reports them.
---

# Declaration faults

A declaration fault is a mistake in how an author declares an Application, a Command, an option, or a plugin. This page states when core reports one (at the call, at attach, or at build), how its Developer Diagnostic reads, and the defects core reports at run time when author code throws or breaks a contract.

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
- **One text.** A rule's diagnostic reads the same whichever moment raises it. The rules lists under [Command declaration errors](commands.md#command-declaration-errors), [Input declaration errors](options.md#input-declaration-errors), [Input source declaration errors](input-sources.md#input-source-declaration-errors), [Result declaration errors](results.md#result-declaration-errors), and [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) state each rule, and this page alone assigns each rule its moment. [The diagnostics reference](diagnostics.md) lists every rule by identity with its headline and explanation.

## At the call

The call that receives a bad value throws, and so does a call that the receiver's own earlier calls make wrong. The calls are `new Command()`, `new Application()`, `argument()`, `option()`, `globalOption()`, `alias()`, `command()`, `result()`, `rows()`, `views()`, `action()`, `extend()`, `extension()`, `view()`, `plugin()`, `translate()`, `encodeFailure()`, and `diagnosticRule()`.

- **Names.** An application name, a Command name, and a Command alias are portable names, and `new Application()`, `new Command()`, and `alias()` throw for one that is not: [`@loomcli/core/portable-name`](diagnostics.md#loomclicoreportable-name). An argument name, an option name, and an option alias are nonempty with no leading hyphen, whitespace, or `=`, and the call that declares one throws for a name that is not: [`@loomcli/core/declared-name`](diagnostics.md#loomclicoredeclared-name).
- **Option configuration.** The receiver's own options, generated negative forms and [aliases](options.md#option-aliases) included, never repeat a key, a spelling, or a variable. An alias that repeats its option's name, another of its aliases, or a spelling the option already accepts adds nothing and is no fault, and a variable an `env` list names twice binds once.
  - A key the receiver's own options already hold: [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice).
  - A spelling the receiver's own options already hold: [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken).
  - A variable another option of the receiver already binds: [`@loomcli/core/variable-bound-twice`](diagnostics.md#loomclicorevariable-bound-twice).
  - At `globalOption()`, an option that declares `interaction`, `color`, `verbose`, `quiet`, or `background` when another option of the Application already does, or a configuration binding on the color-marked, verbose-marked, quiet-marked, or background-marked option: [`@loomcli/core/interaction-mark`](diagnostics.md#loomclicoreinteraction-mark), [`@loomcli/core/color-mark`](diagnostics.md#loomclicorecolor-mark), [`@loomcli/core/verbose-mark`](diagnostics.md#loomclicoreverbose-mark), [`@loomcli/core/quiet-mark`](diagnostics.md#loomclicorequiet-mark), [`@loomcli/core/background-mark`](diagnostics.md#loomclicorebackground-mark).
- **Globals.** `option()` on the Application rejects a key or spelling that a global option holds, the application's or a plugin's, or a variable one of them binds. `globalOption()` rejects one that a root-local option, a plugin's option, or a local option on an attached Command holds, the plugins' Commands included, and a variable one of those options already binds. The plugins' Commands, which the constructor attaches, do not close `globalOption()`; only the application's own `command()` or `action()` does. The identities are those of the option rules above: [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice), [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken), [`@loomcli/core/variable-bound-twice`](diagnostics.md#loomclicorevariable-bound-twice).
- **Core facts.** A description, deprecated message, or version is the author's text, and core judges none of them. Help, the manifest, MCP, man pages, completion, and the service unit print a description or a deprecated message on one line, and read each line break in it as a space. The types place `hidden`, `deprecated`, and `control`, and core checks none of their placements.
- **Order.** The types close every other call `action()`, `result()`, `rows()`, `argument()`, and `command()` rule out. An alias that repeats its own Command's name or another of its aliases adds nothing and is no fault. Three order faults need a runtime check:
  - `argument()` on the root after a plugin's Commands attached, which the types cannot see: [`@loomcli/core/arguments-beside-children`](diagnostics.md#loomclicorearguments-beside-children).
  - A variadic argument that is not last: [`@loomcli/core/variadic-argument-last`](diagnostics.md#loomclicorevariadic-argument-last).
  - A required argument after an optional one: [`@loomcli/core/optional-argument-last`](diagnostics.md#loomclicoreoptional-argument-last).
- **Results.** Core checks no result declaration. The types give a value result whole views alone, and `views()` takes a `default` that names one of the keys its own record supplies. A views record that names no view fails where the result renders.
- **Extensions.** On a call that carries `extensions` and on `extend()`, a second value of one extension in one layer replaces the first whole, as a value in a later layer does. Four faults throw:
  - An extension value another installed copy of `@loomcli/core` built: [`@loomcli/core/foreign-value`](diagnostics.md#loomclicoreforeign-value).
  - A value its schema rejects, or a schema that does not answer synchronously: [`@loomcli/core/invalid-extension-value`](diagnostics.md#loomclicoreinvalid-extension-value).
  - An output that is not plain data: [`@loomcli/core/extension-output`](diagnostics.md#loomclicoreextension-output).
  - Two distinct descriptors that share an identity within the receiver, the installed plugins' descriptors included for the Application: [`@loomcli/core/two-package-copies`](diagnostics.md#loomclicoretwo-package-copies).
- **Plugins.** `plugin()` applies every rule on one definition. One key overridden twice resolves to the first override, and core admits the configuration source's binding descriptor itself, so a binding the plugin does not also list under `extensions` works the same.
  - The rules on each option declaration, under [Input declaration errors](options.md#input-declaration-errors).
  - An extension, view, override, translation, or failure encoding another installed copy of core built: [`@loomcli/core/foreign-value`](diagnostics.md#loomclicoreforeign-value).
  - Two distinct descriptors that share an identity: [`@loomcli/core/two-package-copies`](diagnostics.md#loomclicoretwo-package-copies).
  - Two [failure encoders](failure-views.md#failure-encoders) for one media type: [`@loomcli/core/failure-encoder-taken`](diagnostics.md#loomclicorefailure-encoder-taken).
  - Each `commands` entry also meets the [attach](#at-attach) checks at `plugin()`, against the root it will join and the entries before it: a Command that is not finished ([`@loomcli/core/command-without-action`](diagnostics.md#loomclicorecommand-without-action)), and two entries with one name or an alias that repeats a sibling's ([`@loomcli/core/sibling-name-taken`](diagnostics.md#loomclicoresibling-name-taken)). A sibling diagnostic names the root Command, the parent the entries attach to.
- **Providers.** `provider()`, `new Command()`, and `new Application()` apply two rules to a `uses` list.
  - A provider another installed copy of core built: [`@loomcli/core/foreign-value`](diagnostics.md#loomclicoreforeign-value).
  - Two different providers with one name anywhere among the providers the list reaches, which the types catch only when their types differ: [`@loomcli/core/provider-name-taken`](diagnostics.md#loomclicoreprovider-name-taken).
- **The Application.** `new Application(name, options)` applies every rule on its own options and on the installed set.
  - A view, override, translation, or plugin another installed copy of core built: [`@loomcli/core/foreign-value`](diagnostics.md#loomclicoreforeign-value).
  - Two distinct declared-view objects that share an identity across the Application, its plugins, and core, and two distinct descriptors that share an identity across the plugins: [`@loomcli/core/two-package-copies`](diagnostics.md#loomclicoretwo-package-copies).
  - An identity installed twice: [`@loomcli/core/plugin-installed-twice`](diagnostics.md#loomclicoreplugin-installed-twice).
  - A second claim on the theme slot or the configuration source: [`@loomcli/core/slot-taken`](diagnostics.md#loomclicoreslot-taken).
  - Two plugins that register a failure encoder for one media type: [`@loomcli/core/failure-encoder-taken`](diagnostics.md#loomclicorefailure-encoder-taken).
  - Two plugins whose options share a key, a spelling, or a variable: [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice), [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken), [`@loomcli/core/variable-bound-twice`](diagnostics.md#loomclicorevariable-bound-twice).
  - Two options that declare `interaction`, `color`, `verbose`, `quiet`, or `background`, and a configuration binding on a plugin's color-marked, verbose-marked, quiet-marked, or background-marked option: [`@loomcli/core/interaction-mark`](diagnostics.md#loomclicoreinteraction-mark), [`@loomcli/core/color-mark`](diagnostics.md#loomclicorecolor-mark), [`@loomcli/core/verbose-mark`](diagnostics.md#loomclicoreverbose-mark), [`@loomcli/core/quiet-mark`](diagnostics.md#loomclicorequiet-mark), [`@loomcli/core/background-mark`](diagnostics.md#loomclicorebackground-mark).
- **Failure classes.** Constructing a failure whose class declares a failure code outside its grammar throws from `LoomError`'s constructor, under [Failure codes](failures.md#failure-codes): [`@loomcli/core/failure-code`](diagnostics.md#loomclicorefailure-code). An exit code outside 1 through 125 is a compile error alone, under [Declared exit codes](failures.md#declared-exit-codes). A failure is usually constructed inside a run, where the fault reports with code 1 like any run-time `DeclarationError`.

## At attach

One attach operation serves `Command.command()`, `Application.command()`, and each plugin's `commands` list, which the Application constructor attaches to the root first, in installation order. A Command is an immutable value, so an attached Command is final: attach checks it as a finished Command and stores it as a typed child.

- **The finished Command.** A Command has children or an action, and a group declares no stdin: [`@loomcli/core/command-without-action`](diagnostics.md#loomclicorecommand-without-action).
- **Siblings.** A child never repeats a sibling's name, and an alias never repeats a sibling's name or alias: [`@loomcli/core/sibling-name-taken`](diagnostics.md#loomclicoresibling-name-taken). The root's children include the plugins' Commands, so the application's own `command()` call throws on a name a plugin Command holds.
- **Joining the Application.** When a subtree joins an Application, through `Application.command()` or a plugin's `commands`, the Application walks it once and throws for what only it can judge.
  - A local option whose key or spelling a global option holds: [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice), [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken).
  - A variable that a global option and a local option both bind: [`@loomcli/core/variable-bound-twice`](diagnostics.md#loomclicorevariable-bound-twice).
  - One Command value reached through two paths: [`@loomcli/core/command-attached-twice`](diagnostics.md#loomclicorecommand-attached-twice).
  - Two distinct descriptors that share an identity across the subtree and the Application: [`@loomcli/core/two-package-copies`](diagnostics.md#loomclicoretwo-package-copies).

## At build

`run()` and `inspect()` build the graph and throw only for what no earlier moment could know.

- **The root.** The root is never attached, so build is the first point at which it is final. Build applies the finished-Command rules to it, neither children nor an action and stdin on a root group: [`@loomcli/core/command-without-action`](diagnostics.md#loomclicorecommand-without-action).
- **Lifecycle hooks.** A hook that throws ([`@loomcli/core/broken-attach-hook`](diagnostics.md#loomclicorebroken-attach-hook), [`@loomcli/core/broken-graph-hook`](diagnostics.md#loomclicorebroken-graph-hook)), and every fault in what a hook contributes: the hook-collision rules ([`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice), [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken), [`@loomcli/core/name-shared-across-kinds`](diagnostics.md#loomclicorename-shared-across-kinds)), a rule a hook's erased call breaks, an argument a hook declares on a Command that holds children ([`@loomcli/core/arguments-beside-children`](diagnostics.md#loomclicorearguments-beside-children)), and a descriptor a hook's value brings that shares an identity with another ([`@loomcli/core/two-package-copies`](diagnostics.md#loomclicoretwo-package-copies)). A value a hook passes to `extend()` is validated at that call, as [Lifecycle hooks](lifecycle-hooks.md) states. Then an `onGraphBuilt` hook that throws anything but a `DeclarationError`, and every `DeclarationError` one throws to reject the built graph, under [Judging the built graph](lifecycle-hooks.md#judging-the-built-graph).
- **Defaults and implied values.** `run()` alone passes each declared default and each [implied value](options.md#implied-values) through its validator, before it reads any token, because the validator may answer asynchronously: [`@loomcli/core/invalid-default`](diagnostics.md#loomclicoreinvalid-default), [`@loomcli/core/invalid-implied`](diagnostics.md#loomclicoreinvalid-implied).
- **Input schemas.** In a [development build](release-facts.md#development-builds), `inspect()` and every `run()` call each validated input's converter at build and throw [`@loomcli/core/schema-converter-failed`](diagnostics.md#loomclicoreschema-converter-failed) for a converter that throws or returns anything but a plain object. The check runs after the rules over what the lifecycle hooks returned. A distributed build runs no such check.
- **The post-install command.** In a development build, `inspect()` and every `run()` call route the words of the Application's [`postInstall.command`](application.md#the-post-install-declaration) as an invocation's argv routes and throw `@loomcli/core/post-install-unrouted` when routing selects no Command or a Command with no action: `The post-install command "setup" routes to no Command with an action.`, corrected by `Name a Command that has an action in postInstall.command, or remove the command.`, with a finding that rebuilds `new Application('mimir', { postInstall: … })` and marks `command`. The check runs after the rules over what the lifecycle hooks returned, so a plugin's Commands count. [`check()`](graph-inspection.md#checking-the-declarations) and the assembly check return the fault in every build, as they return a failing converter's, and a distributed `inspect()` and `run()` run no such check, under [ADR-0113](../decisions/0113-an-application-declares-a-post-install-message-and-command-that-the-installer-script-prints-and-runs.md).
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
- **The fault's parts.** A `DeclarationError` built from a rule carries the sentence, the findings, and the correction. The sentence says what is wrong, and the correction says what to do: a diagnostic's text is the sentence followed by the correction, so `Option "raw" is declared more than once on Command "get".` is the sentence and `Remove or rename the duplicate.` the correction. The correction is one imperative sentence, or a list of them when several fixes fit, printed one per line under `- `. The sentence-only constructor stays, for a plugin that has no rule, and its diagnostic holds the banner `-- INVALID DECLARATION --` and the sentence.
- **The banner.** Two hyphens, the headline in capitals, a run of hyphens, and the rule's identity, filling stderr's effective width, the `columns` a view context for stderr reads at that moment, or 80 columns when that is `undefined` or the text goes into `message`. A stderr that is not a terminal falls back to 80, even when its process handle reports a width. The explanation wraps to the same width, with the line breaker `context.wrap` uses, so a word wider than the width keeps a line of its own. `COLUMNS` narrows that width as it narrows any `columns`. A fault with no rule reads `INVALID DECLARATION` for a `DeclarationError` and `DEFECT` for an `InternalError`, with no identity.
- **Findings rebuild the declaration.** A finding names the authoring call and the arguments core holds, and the diagnostic prints the call as JavaScript an author recognizes, indented four spaces: strings in single quotes, plain objects with their keys, and a function or a validator as `…`. A finding with a `path` prints under the Command it sits on, `new Command('get')` above `.option(…)`, and opens with the path, after the application name when `run()` reports the fault. `mark` underlines one argument or one key inside it with `^`, and `note` prints beside the marks. A fault between two declarations, such as a plugin's option that collides with a local option, carries a finding for each. Findings hold no file or line.
- **Core's declaration findings.** A finding core raises at a call on a named Command opens with that Command's name alone, because the call cannot know the parent it will join; one raised at an attach opens with the path the parent knows, and one raised at build or from `run()` with the whole path. A fault about a child as a whole, such as a Command with nothing to run or a name a sibling already holds, marks the call that attached it: `.command(new Command('get'))`, or the entry in a plugin's `commands` list, where a Command value prints as `new Command('get')`. A fault that is an absence at the root, a root with nothing to run, has no call to mark and carries no finding. A name that breaks a name rule is quoted escaped in the sentence, so a line break in it cannot break the line. A fault about one key of an argument's or an option's config, such as `default` or `env`, marks that key inside the call that declared the input, `globalOption()` for an application's global option and the entry in its plugin's `options` record for a plugin's, and a collision between two inputs carries a finding for each side, noted with the scope that declared it. A fault about one key of a plugin's definition or of the Application's options rebuilds the call with that key alone, `plugin('@acme/json', { failureEncoders: […] })` or `new Application('probe', { plugins: […] })`, and marks the key, a key inside its value, or the list entry at fault; a plugin in a `plugins` list prints as `plugin('@acme/log', …)`, a declared view as `view('@acme/page', …)`, an override as `override(InputError, …)`, and a class key of `translate()` by its name. A repeat inside one list, such as a plugin installed twice, a second claim on a slot, or two failure encoders for one media type, carries a finding for each entry. A value an `extensions` list or an `extend()` call carries is marked with its extension's identity as the note. A fault no call declared, such as a read through a second copy of an extension descriptor or a failure class whose exit code no failure may carry, carries no finding.
- **A defect's findings.** For an `InternalError` whose `cause` is an Error, the findings are the cause chain, each cause's name and escaped message, or a `DeclarationError`'s sentence, and its stack, following `cause` links until one repeats. Each error an `AggregateError` holds prints right after it, in order, under `Holds `, with its own chain. A stack's frames are read after its header, the cause's name and message, so a message line that reads as a frame is never one. A frame's location is the text between the first ` (` and the closing parenthesis, or the whole frame after `at`, so a path that holds spaces or parentheses reads whole. Above them, in a development build, core prints the author's source: the first frame of the outermost cause's stack, or for an `AggregateError` of the stacks of the errors it holds in order and then its own, whose file lies under `host.cwd`, or under the path `host.cwd` resolves to through symbolic links, and outside any `node_modules` directory, with two lines on each side, line numbers, and a caret under the frame's column. Core converts a `file:` URL frame to a path, and reads the file through `host.readSource(path, host.cwd)` only in a development build, only while it reports a defect, and only when the normalized path lies under `host.cwd`, because a thrown value's stack can be forged; the captured reader then resolves both through symbolic links and refuses a file that leaves `cwd`. A read that answers `undefined` or throws, and a stack with no qualifying frame, leave the frame's location alone.
- **The layout.** A finding with a `path` opens with a comment, `// jsonkit get`, above its receiver. A declaration fault's sentence keeps the line breaks its author wrote, such as the issue lines under a rejected default or implied value, and a defect's sentence stays on one line. A thrown reason inside either sentence, such as the reason in `Option "token" validator failed unexpectedly: <reason>.`, prints each control character, line separator, and bidirectional control as its escape by [`escapeControlCharacters`](styles.md#strings-and-composition), so it never breaks the sentence's line. A defect whose cause is not an Error prints `Thrown value:` and the value the way a finding prints an argument. The docs link prints as `See <url>`. In a run, the hints follow the diagnostic after one blank line, the diagnostic of a broken view or the throw of an `onFailure` hook follows the failure's own text after one blank line, and any other diagnostic that follows an earlier report of the same run opens with one blank line.
- **Ahead of every override.** The diagnostic is not a view and has no identity. In a development build, core renders it for a defect or a `DeclarationError` that `run()` reports before it consults any override, and prints the hints of [Failure hints](lifecycle-hooks.md#failure-hints) under it. It resolves through core's default styles for stderr, and with no color it is the plain text shown above.
- **In the message.** A `DeclarationError`'s `message` holds its whole diagnostic as plain text at 80 columns, so a fault thrown at a call or an attach prints its diagnostic through the runtime's own uncaught-error output in both builds, under the runtime's source line. Its `sentence` holds the sentence alone. An `InternalError`'s `message` stays its sentence, because only `run()` reports one.
- **Core's defect rules.** Each defect core raises carries a rule of its own. Author code that breaks a contract raises most of them, as [When author code fails](#when-author-code-fails) lists. Three come from elsewhere:
  - The build baked malformed [release facts](release-facts.md), which renders as its Developer Diagnostic in every build: [`@loomcli/core/invalid-release-facts`](diagnostics.md#loomclicoreinvalid-release-facts).
  - A graph `inspect()` did not return, or whose nodes disagree with its build, reached core: [`@loomcli/core/foreign-graph`](diagnostics.md#loomclicoreforeign-graph).
  - A host stream failed a write the run owed it: [`@loomcli/core/broken-destination`](diagnostics.md#loomclicorebroken-destination).

  Every declaration fault in core, `@loomcli/plugins`, and `@loomcli/validators` carries a rule too, and [the diagnostics reference](diagnostics.md) lists them all by identity. The rules lists of [Command declaration errors](commands.md#command-declaration-errors), [Input declaration errors](options.md#input-declaration-errors), [Input source declaration errors](input-sources.md#input-source-declaration-errors), [Result declaration errors](results.md#result-declaration-errors), and [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) state core's. The pack declares its own through `diagnosticRule()`, as a third-party plugin does: `@loomcli/plugins/config/file-path`, `@loomcli/plugins/config/file-pattern`, `@loomcli/plugins/config/variable-name`, `@loomcli/plugins/config/empty-file`, `@loomcli/plugins/config/link-path`, and `@loomcli/plugins/config/link-type` under [Configuration](../plugins/config.md), `@loomcli/plugins/manifest/failure-code-conflict` under [Manifest failures](../plugins/manifest.md#manifest-failures), and `@loomcli/plugins/version/postfix` under [Version](../plugins/version.md). The catalog's are listed under [Faults at the call](../libs/validators.md#shared-rules).
- **Names.** `diagnosticRule`, `isRuleIdentity`, `DiagnosticRule`, `Finding`, and `DiagnosticParts` are exported from `@loomcli/core`.
- **The rule grammar.** `isRuleIdentity(value)` answers whether a value is a string in the rule-identity grammar, the check `diagnosticRule()` runs, so a package that keys its own values on that grammar, as `@loomcli/validators` keys [issue codes](../libs/validators.md#issue-codes), checks them against core's grammar instead of a copy.

## When author code fails

Author code that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A throw that no translator answers, or a break of a contract core owns, is a defect: an `InternalError` with code 1 that carries one of the rules below, rendered as its Developer Diagnostic in a development build and as one generic message in a distributed one. The rules name the code that broke:

- **A throw no translator answered.** An action, a middleware, a source, a view, a translator, or a plugin's hook threw a value no translator answered: [`@loomcli/core/foreign-throw`](diagnostics.md#loomclicoreforeign-throw).
- **A broken failure view.** A failure view threw: [`@loomcli/core/broken-failure-view`](diagnostics.md#loomclicorebroken-failure-view).
- **A broken failure encoder.** A [failure encoder](failure-views.md#failure-encoders) threw or returned a value that is not a string: [`@loomcli/core/broken-failure-encoder`](diagnostics.md#loomclicorebroken-failure-encoder).
- **A plugin loader.** A plugin's middleware or source loader rejected or exported no default: [`@loomcli/core/plugin-loader-failed`](diagnostics.md#loomclicoreplugin-loader-failed).
- **A misused `next()`.** A middleware called `next()` twice or after it returned: [`@loomcli/core/next-misuse`](diagnostics.md#loomclicorenext-misuse).
- **A broken result.** An action broke the [result](results.md) contract, one `ResultError` kind: [`@loomcli/core/result-contract`](diagnostics.md#loomclicoreresult-contract).
- **A view that cannot render.** A middleware assigned `view`, or `invoke()` selected a view, that the routed Command's result cannot render: [`@loomcli/core/view-selection`](diagnostics.md#loomclicoreview-selection).
- **A source answer.** A configuration source answered outside the answers rule: [`@loomcli/core/source-answers`](diagnostics.md#loomclicoresource-answers).

A validator that throws, rejects, or returns a malformed result is a `DeclarationError`, not an `InternalError`, with code 1, as [When author code fails](validation.md#when-author-code-fails) states: [`@loomcli/core/validator-failed`](diagnostics.md#loomclicorevalidator-failed).
