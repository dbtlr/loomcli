---
description: Public SDK, invocation phases, invocation by name, host capture, rendered and semantic output, the view registry and media types, the failure classes, their codes, views, and failure form, failure encoders, and the plugin contract for named commands with global, local, and control options, Standard Schema validation and the input schema fact, passthrough, middleware, lifecycle hooks, extensions, cancellation, and the first-party plugins, MCP included.
---

# Core reference

Core resolves marked strings under a destination-aware [rendering policy](#styles-and-rendering-policy). The [view registry](#views) is implemented under accepted ADR-0021: the package exports `view`, `override`, `lanes`, `View`, and `ViewContext`, and the retired `failures`, `renderFailure`, `FailureRenderer`, `Renderer`, and `RendererContext` are gone. The named [Loom theme](#loom-theme) and explicit color fallbacks are implemented under accepted ADR-0022 and ADR-0029. The results lane under [Results](#results) is implemented under accepted ADR-0023: `result()`, `rows()`, and `views()` are authoring calls, `out.results` is on every channel, and the package exports `RowView`, `DeclaredRowView`, `ResultError`, and `incompleteResult`. The [formatter](#formatter), the `onCommandAttach` [lifecycle hook](#lifecycle-hooks) with its exported `AttachedCommand`, `CommandAttachHook`, and `ResultView` types, and the [middleware](#middleware) context's `request`, typed by the exported `Request`, and `view` are implemented under accepted ADR-0028, and the invocation order in [Invocation](#invocation) describes the chain behind local parsing. The [table](#table) and [records](#records) pack views are implemented under the 2026-09-17 entries in ADR-0008 and ADR-0023. [Collecting extensions](#collecting-extensions), the `extensions` a [lifecycle hook](#lifecycle-hooks) reads, and [help's values in the manifest](#help-in-the-manifest) are implemented under accepted ADR-0031, and the [manifest](#manifest) plugin is implemented under its contract, installed by both example applications. [Accepted values](#accepted-values) on help rows, `accepts`, and `helpArgument` are implemented, and the formatter's description names only its default. [Input sources](#input-sources), the environment binding and the configuration source, are implemented under accepted ADR-0032: core exports `SourceResolver`, `SourceContext`, and `SourceAnswer`, `inspect()` and the manifest publish `env`, and textstat binds `--min-bytes` and `--total` to variables. [Help variants](#help-variants), the middleware context's `spellings` typed by the exported `PluginOptionSpellings`, and `HelpPage.variant` are implemented under accepted ADR-0040: `-h` prints the compact page and `--help` the extended page. [Declared exit codes](#declared-exit-codes) are implemented under accepted ADR-0045: core exports `FailureExitCode` and the fifteen `sysexits.h` constants, `LoomError`'s constructor takes the message and no code, and jsonkit's `PathNotFoundError` exits 65. The [failure view context](#failure-view-context), the `onFailure` [failure hints](#failure-hints), and the issue fields core keeps under [Issues and validator failures](#issues-and-validator-failures) are implemented under accepted ADR-0046: the package exports `FailureViewContext`, `FailureView`, `FailureHook`, and `FailureHookContext`, and the private `@loom/explain` plugin adds its hint to both example applications' unknown-option diagnostics. The [failure message](failure-messages.md) rules and [issue codes](validators.md#issue-codes) are implemented under accepted ADR-0047 and ADR-0048: core's default text opens every usage failure with the application name, routing candidates leave out deprecated children, `escapeControlCharacters` escapes the bidirectional controls and marks, every sentence the [audit](failure-messages.md#9-audit) lists ends with its fix, and `@loomcli/validators` exports `issueCode` and the catalog's codes. The [suggestions](#suggestions) plugin and [help's failure hint](#helps-failure-hint) are implemented under their contract: the pack exports `@loomcli/plugins/suggestions`, `help()` points every usage error at its page, and both example applications install both. [Translators](#translators) are implemented under accepted ADR-0049: core exports `translate`, `Translation`, `Translator`, and `ErrorClass`, `LoomError`, `FatalError`, `InputError`, and `DeclarationError` accept the platform's `ErrorOptions`, and jsonkit's reader holds no `JSON.parse` catch, so a malformed document exits 65. The manifest's [declared failures](#manifest-failures) are implemented under their contract: `manifestCommand` takes `failures`, `--manifest` lists each Command's failures and joins their codes to core's rows in `exitCodes`, and jsonkit declares `invalid-json`, which its translator raises with code 65, and `path-not-found`. [Development builds](#development-builds) and the [Developer Diagnostic](#developer-diagnostics) for defects are implemented under accepted ADR-0050 and ADR-0051: core exports `Packet`, `diagnosticRule`, `DiagnosticRule`, `Finding`, and `DiagnosticParts`, `DeclarationError` and `InternalError` take a rule beside their earlier constructors, `Host` gains `readSource`, `@loomcli/loom/build` exports `packet()`, `@loomcli/loom` is published beside the libraries, and both example applications build with it. Every declaration fault in core, the pack, and the catalog carries its rule's descriptor and explanation, and findings wherever a call declared it, under the identities [Developer Diagnostics](#developer-diagnostics) lists, and a development build runs the converter check of [Input schema](#input-schema). The [identity grammar](#identity-and-installation) is implemented under accepted [ADR-0052](decisions/0052-a-plugin-extension-and-view-identity-follows-one-grammar.md): `plugin()`, `extension()`, and `view()` reject an identity outside it at the call under `@loomcli/core/invalid-identity`, and core exports `isRuleIdentity`. The configuration plugin's one-file lookup, TOML and YAML files, and its `file` and `short` settings are implemented under accepted [ADR-0054](decisions/0054-the-configuration-plugin-reads-one-file-per-run-found-by-the-authors-file-pattern.md): `@loomcli/plugins` depends on `yaml` and `smol-toml`, and textstat reads `.textstat.{toml,json}` with `-c` as the short spelling of `--config`. [Undescribed declarations](#undescribed-declarations) are implemented under the 2026-10-06 entry in ADR-0050: a development `run()` and `app.invoke()` fail under `@loomcli/core/undescribed` for a graph that leaves a Command, an option, or an argument without a description, and both example applications and every first-party plugin describe each one. Every `Invalid declaration: ` and `Internal error: ` line this reference shows outside those sections quotes the fault's `sentence`; `run()` renders the fault by build as [Development builds](#development-builds) states, and never with either prefix.

## Application declarations

`new Application(name)` creates an application with an unnamed root Command. The name is a [portable name](glossary.md#names-and-routing): `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, not starting with `-` or `.`, because an operator types it as a command at the shell prompt. The constructor takes no input type parameter. `new Application(name, options)` takes one options object. `plugins` installs the plugins described in [Plugins](#plugins) in composition order, and `views` holds the view overrides described in [Views](#views), which is where an application replaces the view function of a failure class, a lane, a help page, or any other declared view. `description` and `version` are core graph facts every projection reads, and `extensions` carries the root's [extension values](#extensions). An omitted `version` is `0.0.0`, which means unversioned, so the graph always carries one; the root cannot be hidden or deprecated, so the Application options carry neither fact. `translators` holds the application's [translators](#translators), and `packet` is the build fact [Development builds](#development-builds) describes.

```ts
interface ApplicationOptions<Plugins extends readonly Plugin[] = readonly Plugin[]> {
  plugins?: Plugins;
  rendering?: RenderingPolicy;
  views?: readonly ViewOverride[];
  translators?: readonly Translation[];
  packet?: Packet;
  description?: string;
  version?: string;
  extensions?: readonly ExtensionValue<'command'>[];
}
```

```ts
import { Application } from '@loomcli/core';

const app = new Application('paths')
  .argument('files', { variadic: true, required: true })
  .action(({ args, out }) => out.print(args.files.join('\n')));

await app.run();
```

Every authoring call returns a new declaration value and never changes its receiver. `argument()`, `option()`, `globalOption()`, `alias()`, `result()`, `rows()`, `views()`, `action()`, `command()`, and `extend()` all follow this rule, so `const forked = base.option('verbose', { type: 'boolean' })` leaves `base` without `verbose`, and `base.command(child)` leaves both `base` and `forked` without the child. Keep the value each call returns. An extracted handler uses `ActionHandler<typeof app>` and a type-only import of its declaration. That helper reads the declared types, so it answers for a fresh declaration, a partly declared one, and one that already registered its action.

A declaration value publishes the authoring calls that are still valid for it. `Command` and `Application` always publish `extend()`, outside the authoring-state parameter. A fresh `Command` publishes `argument()`, `option()`, `alias()`, `result()`, `rows()`, `command()`, and `action()`; a fresh `Application` publishes `argument()`, `option()`, `result()`, `rows()`, `command()`, and `action()` for the unnamed root, which has no name to alias. An Application also publishes `globalOption()` until its first `command()` or `action()` call. A declaration that carries a result publishes `views()` in every state, as [Results](#results) describes. An `Application` keeps `inspect()`, `run()`, `invoke()`, and its `name` in every state. The collected declarations stay private, so no consumer can read or replace them.

Declare global options before attaching children or registering the action. Declare local arguments and options before the action. Command-targeted extensions remain configurable afterward through `extend()`. Each call removes the calls it invalidates, so this order is a compile-time rule and not advice.

| Call         | Removed from the value it returns                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `argument()` | `command()`, because one Command declares arguments or attaches children, never both                        |
| `command()`  | `argument()`; on Application, also `globalOption()`                                                        |
| `globalOption()` | nothing; available on Application alone |
| `option()`   | nothing                                                                                                     |
| `alias()`    | nothing                                                                                                     |
| `result()`   | `result()` and `rows()`; the value gains `views()`                                                          |
| `rows()`     | `result()` and `rows()`; the value gains `views()`                                                          |
| `views()`    | nothing; available on a declaration that carries a result, in every state                                   |
| `action()`   | `argument()`, `option()`, `globalOption()`, `alias()`, `result()`, `rows()`, `command()`, and `action()`; both declarations keep `extend()`, and `views()` on a declaration that carries a result |

Arguments and children exclude each other at the second call, so `.argument('files', config).command(child)` does not compile. A declaration that registers no action stays open, so a group keeps `option()` and `command()` available. Only an `Application` publishes `inspect()`, `run()`, `invoke()`, and `name`, in every state; a named `Command` publishes its authoring calls alone. The type states do not read what a group holds, so attach rejects an option declared on a Command that registers no action, and build applies the rule to the root: a local option never reaches a child's action. A Command with children and no action is a group, and routing sends its invocations on to one of its children. A Command with neither children nor an action is a declaration error, from attach or, for the root, from build. `command()` accepts a Command in any state, because a child's own `action()` is the call that finished it.

`Command` and `Application` take a fourth type parameter that lists the authoring calls a value still offers. It defaults to `never`, so `Command<Args, Options, Globals>` and `Application<Args, Options, Globals>` accept a declaration in any state, one that registered its action included. Write the parameter only to require a state. The fresh states are the exported `CommandMethod` and `ApplicationMethod` unions, which also let a consumer emit declarations for a value that has not registered its action. An explicit `any` in that position removes the lock, as `any` does anywhere else.

A JavaScript author meets the same rules at the call that breaks them: `option()` after `action()` throws from `option()`, and `argument()` on a Command that holds children throws from `argument()`. Both are listed in [Command declaration errors](#command-declaration-errors), and [Declaration faults](#declaration-faults) names the moment of every rule. A plugin's [Commands](#plugin-commands) join the root when the Application is constructed, outside the authoring types, so a root that declares arguments meets the arguments-beside-children rule at its `argument()` call for every author when a plugin brings Commands.

TypeScript requires one statically known name for each `argument()`, `option()`, and `globalOption()` declaration. Literal-typed constants such as `const name = 'metric'` are valid. Widened `string` types, unions such as `'left' | 'right'`, and open template types are rejected. One declaration creates one handler key, so its type cannot promise several possible keys at once. A rejected name reports the missing property `'Declaration names must be one literal string'`. A JavaScript declaration's name is checked at the call instead.

A Command accepts arguments in declaration order. A scalar argument, with optional `variadic: false`, binds one token and produces one `string`, or the validator output when validated. A variadic argument, `{ variadic: true }`, must be last and takes the remaining tokens.

A scalar argument is optional when it omits `required` or declares `required: false`. It then binds the next bare token when one exists, and its action value is `string | undefined`, or the validator output or `undefined`. The presence rules are the option rules: `required: true` excludes `default`, a declared default removes `undefined` from the action value, and omission with no default is `undefined` with no call to the validator. A validated optional argument can declare `validateOmitted: true` to send its omission to its own validator, as [Absence and defaults](#absence-and-defaults) describes. An optional argument declares after every required one, and no argument declares after it, so `app keys` and `app keys a.b` both bind.

A variadic argument follows the presence rules of a [multiple option](#repeated-string-values). `required: true` means at least one token and excludes `default`; without it the argument is optional and can declare a default. Its action value is `string[]`, or the array of its validator's outputs, and never `undefined`: an empty tail is an accurate empty list, and it calls no validator. A default is a `string[]`, or an array of the validator's input type when the declaration validates, each value passes through the validator, and it reaches each invocation as its own copy.

```ts
const keys = new Command('keys').argument('path', {}).action(({ args, out }) => {
  const path: string | undefined = args.path;
  return out.print(path ?? 'the root');
});
```

Bare tokens before `--` retain their order as positional inputs. Local options can appear before, between, or after these inputs. A hyphenated file path uses an explicit relative path such as `./-notes.txt`.

Application methods apply the same declaration transitions as a Command to the unnamed root's state. Build produces a graph with that root, and routing selects the Command for normal validation and dispatch. There is no separate root action runner. An action is lazy by definition: registering it runs nothing, and core calls it only when routing selects its Command and the invocation reaches the dispatch boundary, whether the application or a [plugin](#plugin-commands) attached that Command.

`argument()` rejects an invalid or repeated argument name, a variadic argument that is not last, an argument that follows an optional one, and an optional argument that precedes a required one. Every declaration call after `action()` throws, and so does a second `action()`. Attach rejects a Command with neither children nor an action and a group that declares a local option, and graph build applies the same two rules to the root. [Declaration faults](#declaration-faults) names the moment of every rule. No action runs after a declaration or input failure.

## Declaration faults

```ts
class DeclarationError extends LoomError {} // exit 1; its Developer Diagnostic, see Developer Diagnostics
```

```js
// src/commands/list.js, JavaScript, so no type check stops the call.
import { Command } from '@loomcli/core';

// Throws when the module evaluates, with a stack at this line, and the runtime prints the
// rule's Developer Diagnostic, which opens:
// -- BOOLEAN OPTION TAKES ONE VALUE -------- @loomcli/core/boolean-option-multiple
//
// Option "verbose" is a boolean option and declares multiple.
export const list = new Command('list').option('verbose', { multiple: true, type: 'boolean' });
```

A declaration fault throws `DeclarationError` at the earliest of three moments that holds the data proving it: the call, the attach, or the build. Only a declaration that a later step may still add to waits for build. [ADR-0034](decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md) records the decision.

- **Types first.** TypeScript rejects most faults at compile time. The runtime guards catch values that bypass the types, from JavaScript or through `any`. Each guard runs at the top of its function, before any side effect, so a call that throws changes nothing.
- **Where a fault surfaces.** A fault at a call or an attach throws when the module that makes the call evaluates, usually at import, with a stack at the offending line, and the run stops there. It never reaches `run()`, so no [failure view](#failure-views) renders it and core sets no exit code. Its `message` holds its whole [Developer Diagnostic](#developer-diagnostics) as plain text, so the runtime's own uncaught-error output prints the diagnostic under the offending line, in every build. A build fault surfaces from `run()` and a thrown `DeclarationError` from `inspect()`; `run()` renders the Developer Diagnostic in a development build and the generic defect message in a distributed one, under [Development builds](#development-builds).
- **One text.** A rule's diagnostic reads the same whichever moment raises it. The tables under [Command declaration errors](#command-declaration-errors), [Input source declaration errors](#input-source-declaration-errors), [Result declaration errors](#result-declaration-errors), and [Plugin declaration errors](#plugin-declaration-errors) hold each rule's text, the fault's sentence followed by its correction, and this section alone assigns each rule its moment. Each rule's descriptor under [Developer Diagnostics](#developer-diagnostics) holds its headline, identity, and explanation.

### At the call

The call that receives a bad value throws, and so does a call that the receiver's own earlier calls make wrong. The calls are `new Command()`, `new Application()`, `argument()`, `option()`, `globalOption()`, `alias()`, `command()`, `result()`, `rows()`, `views()`, `action()`, `extend()`, `extension()`, `view()`, `plugin()`, `translate()`, `encodeFailure()`, `diagnosticRule()`, and the settings checks `checkPluginSettings()` and `checkShortSetting()`, which a plugin factory calls on its settings.

- **Names.** An invalid application name, from `new Application()`; an invalid Command name, from `new Command()`; an invalid argument, option, alias, or short spelling, from the call that declares it; an `alias()` call with no names; and a view name that is not a bare token or is integer-like, from `result()`, `rows()`, or `views()`.
- **Identities.** An identity outside the [identity grammar](#identity-and-installation), from `plugin()`, `extension()`, or `view()`, before any other rule on the call.
- **Unreadable configuration.** An argument or option config, or the config object of one option a plugin declares, whose read throws while the call takes its one copy, such as a getter or a proxy trap that throws, at any depth the call reads of its default. For an argument or option it is judged after the name. The name of an option a plugin declares is judged later, by `plugin()` once it has read every option's config. Either way it comes before every other rule on the config.
- **Default depth.** A default with a path through more than 10 arrays and plain objects, counted from the default itself, or one that holds itself, which nests without end. The call takes its copy of the default up to that limit and stops there, so it is judged with an unreadable read, before every other rule on the config.
- **Option configuration.** A key or spelling the receiver's own options already hold, generated negative forms and [aliases](#option-aliases) included; an invalid type, polarity, or short-only combination; an `aliases` value that is not an array, an alias name that is not a valid option name, an alias that repeats its own option's name, another of its aliases, or a spelling the option already accepts, and `aliases` beside `shortOnly`; `multiple` on a Boolean or counted option, or a `multiple` value that is not Boolean; a default of the wrong raw shape without a validator, and a default that is not an array on a validated multiple option or variadic argument; `validate`, `default`, `required`, or `validateOmitted` on a Boolean or counted option; `polarity` on a counted option; `implied` on a Boolean or counted option, and an `implied` value that is not a string; `required` beside a default; a `required`, `variadic`, or `validateOmitted` value that is not Boolean, and `validateOmitted` on a declaration that already decides its own absence; a validator that is not a Standard Schema; an `env` name outside the grammar, `env` on a multiple option, and `env` on an argument; and a variable another option of the receiver already binds.
- **Globals.** `option()` on the Application rejects a key or spelling that a global option holds, the application's or a plugin's, or a variable one of them binds. `globalOption()` rejects one that a root-local option, a plugin's option, or a local option on an attached Command holds, the plugins' Commands included, and a variable one of those options already binds. `globalOption()` rejects `required` and `validateOmitted`, whatever their value. `globalOption()` after `command()` or `action()` throws. The plugins' Commands, which the constructor attaches, do not close `globalOption()`; only the application's own `command()` or `action()` does.
- **Core facts and options objects.** A description, deprecated message, version, `hidden` value, or `control` value of the wrong shape; `hidden` or `deprecated` on an argument or on the Application options, and `control` on an argument; an options argument that holds no plain object; the retired `globals` and `failures` Application options; and globals passed to a named Command.
- **Order.** Every `argument()`, `option()`, `alias()`, `result()`, `rows()`, or `command()` call after `action()`, and a second `action()`; `argument()` on a Command that holds children, the root with plugin Commands included, and `command()` on one that declares arguments; a variadic argument that is not last, an argument after an optional one, and an optional argument before a required one; an alias that repeats its own Command's name or another of its aliases; and a value passed to `command()` that is not a Command.
- **Results.** A second `result()` or `rows()`; a row view under `result()`; a views entry that is not a view or that carries both `render` and `row`; and `views()` on a declaration with no result.
- **Extensions.** On a call that carries `extensions` and on `extend()`: an entry that is not an extension value, a value on the wrong target, two values of one extension in one layer, a descriptor with no schema or with a `collect` that is not a Boolean, a value its schema rejects, a schema that answers asynchronously, an output that is not plain data, and two distinct descriptors that share an identity within the receiver, the installed plugins' descriptors included for the Application.
- **Plugins.** `plugin()` applies every rule on one definition: the identity, the definition's shape, the `options` record and each option declaration, an option with a presence rule, the `middleware` object with its activation and loader, an `onCommandAttach`, `onGraphBuilt`, or `onFailure` that is not a function, the `extensions`, `views`, `translators`, `failureEncoders`, `signals`, and `commands` lists and their entries, one key overridden twice, two [failure encoders](#failure-encoders) for one media type, a signal outside the closed set or claimed twice, every `source` rule, and the theme mapping rules. Each `commands` entry also meets the [attach](#at-attach) checks at `plugin()`, against the root it will join and the entries before it: a Command that is not finished, and two entries with one name or an alias that repeats a sibling's. The nesting cap needs no check here, because the entry's own `command()` calls already enforce it. A sibling diagnostic names the root Command, the parent the entries attach to.
- **The Application.** `new Application(name, options)` applies every rule on its own options and on the installed set: a `views` entry that is not an override, a `translators` entry that is not a translation, a `packet` that is not a plain object or whose `build` is neither `development` nor `distributed`, two overrides for one key, two distinct declared-view objects that share an identity across the Application, its plugins, and core, a `plugins` value that is not an array or an entry that is not a plugin, an identity installed twice, a second claim on the signals slot, the theme slot, or the configuration source, two plugins that register a failure encoder for one media type, two plugins whose options share a key or a spelling or bind one variable, and two distinct descriptors that share an identity across the plugins.
- **Failure classes.** Constructing a failure whose class declares an exit code outside 1 through 125 throws from `LoomError`'s constructor, under [Declared exit codes](#declared-exit-codes), and so does constructing one whose class declares a failure code outside its grammar, under [Failure codes](#failure-codes). A failure is usually constructed inside a run, where the fault reports with code 1 like any run-time `DeclarationError`.

### At attach

One attach operation serves `Command.command()`, `Application.command()`, and each plugin's `commands` list, which the Application constructor attaches to the root first, in installation order. A Command is an immutable value, so an attached Command is final: attach checks it as a finished Command and stores it as a typed child.

- **The finished Command.** A Command with neither children nor an action, a group that declares a local option, a result on a Command with no action, and a merged views record with no views or with a `default` that names a key the record does not hold. `views()` stays callable and can add keys, so neither fault is known at the call.
- **Siblings.** A child whose name repeats a sibling's, and an alias that repeats a sibling's name or alias. The root's children include the plugins' Commands, so the application's own `command()` call throws on a name a plugin Command holds.
- **Nesting.** A child that would sit more than two levels below the root, under [Nested Commands and groups](#nested-commands-and-groups).
- **Joining the Application.** When a subtree joins an Application, through `Application.command()` or a plugin's `commands`, the Application walks it once and throws for what only it can judge: a local option whose key or spelling a global option holds, a variable that a global option and a local option both bind, one Command value reached through two paths, two distinct descriptors that share an identity across the subtree and the Application, and the nesting cap measured from the root.

### At build

`run()` and `inspect()` build the graph and throw only for what no earlier moment could know.

- **The root.** The root is never attached, so build is the first point at which it is final. Build applies the finished-Command rules to it: neither children nor an action, a root group that declares a local option, a result on a root with no action, and a merged views record with no views or with a `default` that names no key.
- **Lifecycle hooks.** A hook that returns anything but the attached Command or throws, and every fault in what a hook contributes: the hook-collision rule, a rule a hook's erased call breaks, the result rules over the record the hooks returned, and a descriptor a hook's value brings that shares an identity with another. A value a hook passes to `extend()` is validated at that call, as [Lifecycle hooks](#lifecycle-hooks) states. Then an `onGraphBuilt` hook that throws or returns a value, and every `DeclarationError` one throws to reject the built graph, under [Judging the built graph](#judging-the-built-graph).
- **Defaults and implied values.** `run()` alone passes each declared default and each [implied value](#implied-values) through its validator, before it reads any token, because the validator may answer asynchronously.
- **Input schemas.** In a [development build](#development-builds), `inspect()` and every `run()` call each validated input's converter at build and throw `@loomcli/core/schema-converter-failed` for a converter that throws or returns anything but a plain object. The check runs after the rules over what the lifecycle hooks returned and ahead of the description check below, so a graph with both faults reports the converter's. A distributed build runs no such check.
- **Descriptions.** In a [development build](#development-builds), every `run()` and every `app.invoke()` throw `@loomcli/core/undescribed` for a graph that holds a Command, an option, or an argument without a description, under [Undescribed declarations](#undescribed-declarations). A lifecycle hook can still add an input until build, so build is the first moment that knows every member. `inspect()` and a distributed build run no such check.

## Local options

```ts
import { Application } from '@loomcli/core';

const app = new Application('textstat')
  .argument('files', { required: true, variadic: true })
  .option('metric', { short: 'm', type: 'string' })
  .option('total', { short: 't', type: 'boolean' })
  .action(({ args, options, passthrough, out }) => {
    const metric: string | undefined = options.metric;
    const total: boolean = options.total;
    const files: string[] = args.files;
    const tail: string[] = passthrough;
    return out.print(JSON.stringify({ metric, total, files, tail }));
  });
```

`option(name, config)` declares a local option on the unnamed root Command. The declared name is the key in `options`. Short aliases, option aliases, and negative spellings do not add handler keys. Options and arguments have separate objects, so they can use the same key without collision.

Declarations infer types through fluent calls and `ActionHandler<typeof app>`. The constructor accepts no caller-supplied input types. `StringOption`, `BooleanOption`, `CountOption`, and their union `OptionConfig` support extracted configuration with `satisfies`. An option is one of three kinds, chosen by `type`: a string option takes a value, a Boolean option takes none and reads the value of its spelling, and a [counted option](#counted-options) takes none and reads how many times it was supplied.

Every option and argument config object also accepts `description`, the one-line core fact every projection reads under the rule [Extensions](#extensions) states, and `extensions`, the list of [extension values](#extensions) plugins define for inputs: `ExtensionValue<'option'>` on `StringOption`, `BooleanOption`, and `CountOption`, and `ExtensionValue<'argument'>` on `ArgumentConfig`. Both keys are optional, both apply to every global option, whichever declarer declares it, and neither changes parsing or validation. An option config object, and no argument config, also accepts the two core facts `hidden` and `deprecated` that [Hidden and deprecated members](#hidden-and-deprecated-members) describes, the `control` fact [Control options](#control-options) describes, `env`, the [environment binding](#input-sources) that names the variable which supplies the option, and `aliases`, the [option aliases](#option-aliases) that add unadvertised long spellings.

The long spelling uses the exact declared name. `dryRun` produces `--dryRun`; `dry-run` produces `--dry-run`. Names are case-sensitive. They cannot be empty, start with a hyphen, or contain whitespace or `=`. A `short` alias is one ASCII letter and is case-sensitive. A hyphenated name is not a JavaScript identifier, so its action value reads with bracket access: `options['dry-run']`, the way textstat reads `options['min-bytes']`.

`shortOnly: true` requires `short` and suppresses every long spelling. For example, `.option('metric', { short: 'm', shortOnly: true, type: 'string' })` accepts `-m words` and rejects `--metric`.

### String values and token consumption

| Form                                                                  | Result                        |
| --------------------------------------------------------------------- | ----------------------------- |
| `--metric words`, `--metric=words`, `-m words`, `-mwords`, `-m=words` | `options.metric` is `"words"` |
| `--metric=`, `--metric ""`, `-m ""`, `-m=`                            | An empty string               |
| No metric option                                                      | `undefined`                   |
| `--metric=-value`, `-m-value`, `-m=-value`                            | The literal string `"-value"` |
| `--metric -5`, `-m -`                                                 | `"-5"` and `"-"`              |
| `--metric --total`, `-m -v`, `-m --`, `--metric` at the end           | Missing-value error           |

A string option that declares an [implied value](#implied-values) reads a bare spelling as that value and never takes the next word, so the missing-value row never applies to it: `--backup --total` and `--backup` at the end each supply the implied value.

An option word is `--` followed by at least one character, or `-` followed by an ASCII letter. Every other word is a plain word, a value or an argument: `-`, `-5`, `-.5`, and `-1e3` need no `--` escape, because no declaration can claim a spelling that is not an ASCII letter. A separate word is the value of a string option that declares no implied value, unless it is an option word or the bare `--`. A long assignment and an attached short value can contain any string, hyphens and additional `=` characters included, so a value that starts with a hyphen and a letter is written attached. When the word after a value option is an option word or the bare `--`, the missing-value error names that form: `Option "--pattern" requires a value. Supply a value after "--pattern", or attach one that starts with a hyphen as "--pattern=<value>".` [ADR-0055](decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md) records the grammar.

The parser preserves empty values. After parsing, value inputs pass through their declared validators. A declared default fills only an optional value that no token and no [input source](#input-sources) supplied. A validated optional value can declare `validateOmitted: true` instead, which sends its omission to its validator, as [Absence and defaults](#absence-and-defaults) describes.

### Short groups

A short group is one option word that holds short aliases after a single hyphen, read under the POSIX `getopt` rule. Each character after the hyphen is one code point and must be a declared letter. A Boolean letter is set, and the walk continues to the next character; a `=` after it is the unexpected-value error that Boolean option reports. A counted letter adds one to its count and the walk continues the same way, so a repeated counted letter is no repeat and a `=` after it is the unexpected-value error. A value letter ends the group: the rest of the word is its value, with one leading `=` stripped, or the next word is its value when nothing remains. A letter whose string option declares an [implied value](#implied-values) is a value letter that never takes the next word: the rest of the word is its value, with one leading `=` stripped, and when nothing remains it supplies its implied value. The walk stops at the first letter that faults, because core cannot know whether that letter takes a value: the characters after it are not read and supply nothing, so `-xh` reports `Unknown option "-x"` rather than rendering help, and the misplaced `-Fhello` never reads `hello` as letters.

| Form, with Boolean `t`, string `m`, counted `v`, and `b` implying `simple` | Result                                        |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| `-tm words`, `-tmwords`, `-tm=words`                                       | `total` is `true` and `metric` is `"words"`   |
| `-mt`                                                                      | `metric` is `"t"`                             |
| `-m==x`                                                                    | `metric` is `"=x"`                            |
| `-tx` with no `x` declared                                                 | `Unknown option "-x"`                         |
| `-t5`                                                                      | `Unknown option "-5"`                         |
| `-t=false`                                                                 | `Boolean option "-t" does not accept a value` |
| `-tt`                                                                      | `Option "-t" can be supplied only once`       |
| `-vvv`                                                                     | `verbose` is `3`                              |
| `-tvv`                                                                     | `total` is `true` and `verbose` is `2`        |
| `-v3`                                                                      | `Unknown option "-3"`                         |
| `-v=3`                                                                     | `Counted option "-v" does not accept a value` |
| `-b`, `-tb`                                                                | `backup` is `"simple"`, and `-tb` sets `total` |
| `-bnumbered`, `-b=numbered`                                                | `backup` is `"numbered"`                      |
| `-bt`                                                                      | `backup` is `"t"`                             |
| `-b=`                                                                      | `backup` is `""`                              |
| `-b words`                                                                 | `backup` is `"simple"`, and `words` is the next word |

A value letter takes the rest of its word whatever it holds, so `-mt` gives `metric` the value `t` and `-bt` gives `backup` the value `t`, and the option's validator is where such a typo surfaces. The letters of one group may belong to any option the routed Command's table holds, global or local, so `textstat -ht` sets help's `help` and the root's `total`. A letter outside ASCII is named whole, so `-té` reports `Unknown option "-é"`.

### Repeated string values

A string option declares `multiple: true` to collect every occurrence instead of rejecting the second one. Boolean options and counted options cannot declare `multiple`; a [counted option](#counted-options) already counts every occurrence.

```ts
const app = new Application('select')
  .option('field', { multiple: true, short: 'F', type: 'string' })
  .action(({ options, out }) => {
    const fields: string[] = options.field;
    return out.print(fields.join('\n'));
  });
```

The collected value keeps supplied token order across every accepted spelling, so `--field a -F b --field=c` gives `['a', 'b', 'c']`. Each occurrence follows the ordinary value rules of its spelling. A multiple string alias is a value letter in a short group: it ends the group.

The declared validator checks one value under [ADR-0036](decisions/0036-each-value-passes-the-same-validator.md). Core runs it on each occurrence in supplied order and reports each issue at the value's position, counted from 0, so `z.string().nonempty('Supply a field name.')` rejects an empty value: `--field a -F ''` fails with `Option "--field" at 1: Supply a field name.`. The action receives the array of the validator's outputs.

| Declaration and input               | Action value or failure              |
| ----------------------------------- | ------------------------------------ |
| Omitted, no declared default        | `[]`; the validator is not called    |
| Omitted, declared default           | Each default value's validated output |
| One or more occurrences             | Each value's validated output, or input issues |
| `required: true` with no occurrence | Input error; no dispatch             |

`required: true` means at least one occurrence. A multiple option's action value is never `undefined`: no occurrence is an accurate empty list, and it calls no validator. `required: true` is the structural at-least-one check, and it is read before validation. A rule over the whole list, such as uniqueness, a maximum count, or a transform of the array into another shape, is the action's, because the values are uniform and the action receives them all. A default is a `string[]`, or an array of the validator's input type when the declaration validates, and each of its values passes through the validator like a supplied one.

Global options declare `multiple` under the same rules. Every occurrence before the passthrough delimiter is collected, whether routing or the routed Command's table reads it, so a repeated global is collected rather than rejected.

| Rejected declaration or input                              | Diagnostic                                                                                                | Rule |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---- |
| A required multiple option with no occurrence              | `Option "--field" is required. Supply at least one value.`                                                |      |
| `multiple` on a Boolean option                             | `Option "verbose" is a boolean option and declares multiple. Remove multiple or declare a string option.` | `@loomcli/core/boolean-option-multiple` |
| `multiple` on a counted option                             | `Option "verbose" is a counted option and declares multiple. Remove multiple; a counted option already counts every occurrence.` | `@loomcli/core/count-option-multiple` |
| A `multiple` value that is not Boolean                     | `Command "get" option "field" declares multiple that is not a Boolean. Use true or false.`                | `@loomcli/core/flag-not-boolean` |
| A multiple default that is not a string array, unvalidated | `Option "field" default must be an array of strings without a validator. Supply a string array default.`  | `@loomcli/core/default-shape` |
| A multiple default that is not an array, validated         | `Option "field" default must be an array. Supply an array of values.`                                | `@loomcli/core/default-shape` |

The first diagnostic is a validation-phase issue with exit code 2 and ranks with the other required inputs. The rest are declaration errors that the declaring call throws, under the rules [Input declaration errors](#input-declaration-errors) describes. TypeScript rejects `multiple` on a Boolean or counted option, a default of the wrong shape, and a validator whose input type does not accept `string`, at the `option()` call.

### Boolean polarity

Boolean options accept `polarity: 'positive' | 'both' | 'negative'`. The default polarity is `positive`.

| Polarity for `total`, with alias `t` | Long forms                                         | Short alias        | Absent value |
| ------------------------------------ | -------------------------------------------------- | ------------------ | ------------ |
| `positive`                           | `--total` gives `true`                             | `-t` gives `true`  | `false`      |
| `both`                               | `--total` gives `true`; `--no-total` gives `false` | `-t` gives `true`  | `false`      |
| `negative`                           | `--no-total` gives `false`                         | `-t` gives `false` | `true`       |

`shortOnly` removes long forms for positive or negative polarity. It cannot combine with `both`, because one short alias cannot express both polarities. String options and counted options cannot declare polarity.

Boolean options consume no value token. Assignments such as `--total=false` and `-t=false` fail. A following bare `false` remains a positional input.

### Counted options

```ts
const app = new Application('fetchit')
  .option('verbose', { short: 'v', type: 'count' })
  .action(({ options, out }) => {
    const verbose: number = options.verbose;
    return out.print(String(Math.min(verbose, 3)));
  });
```

`type: 'count'` declares a counted option. Each occurrence adds one, and the action reads the total as a `number`, so `fetchit -vvv`, `fetchit -v -v -v`, and `fetchit --verbose -vv` each read `3`, and `fetchit` alone reads `0`. [ADR-0057](decisions/0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md) records the decision.

- **No value.** A counted option takes no value, as a Boolean option takes none. `--verbose=3` and `-v=3` fail with the unexpected-value error `Counted option "--verbose" does not accept a value. Repeat "--verbose" to raise its count.`, which names the spelling typed. A following plain word such as `3` stays a positional input, and `-v3` reports `Unknown option "-3"`, as `-t5` does for a Boolean letter.
- **Every occurrence counts.** Occurrences count across every spelling of the option, its short alias and its [aliases](#option-aliases) included, and across words, so `-vv --verbose` reads `3`. The once-per-invocation rule never applies to a counted option, and a repeated counted letter in a [short group](#short-groups) is no repeat. A global counted option counts every occurrence before the passthrough delimiter, whether routing or the routed Command's table reads it, so occurrences before and after the Command name add together.
- **Absence.** No occurrence means the option was not supplied, and the action reads `0` unless an [input source](#input-sources) fills it. A count needs no declared absence and has no upper limit, so a counted option declares no `validate`, `default`, `required`, `validateOmitted`, `multiple`, `polarity`, or `implied`. TypeScript rejects each at the `option()` call, and the call throws for a JavaScript author under the rules [Input declaration errors](#input-declaration-errors) lists. An action that wants a cap clamps the count itself, as `Math.min` does above.
- **Input sources.** An [environment binding](#input-sources) fills a count from a variable that holds one or more ASCII decimal digits, such as `0`, `3`, or `12`, and the configuration source fills it with a whole number of 0 or more. A source fills the count only when no occurrence supplied it, so with `env: 'VERBOSE'` on the declaration, `VERBOSE=2 fetchit -v` reads `1` and `VERBOSE=2 fetchit` reads `2`.
- **Every option.** `type: 'count'` applies to a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares, under the same rules, because they are one kind of option.

### Implied values

```ts
import { oneOf } from '@loomcli/validators';

const app = new Application('copyit')
  .argument('files', { required: true, variadic: true })
  .option('backup', { implied: 'simple', short: 'b', type: 'string', validate: oneOf(['none', 'simple', 'numbered']) })
  .action(({ options, out }) => {
    const backup: 'none' | 'simple' | 'numbered' | undefined = options.backup;
    return out.print(backup ?? 'no backup');
  });
```

`implied` on a string option declares the value a bare spelling supplies, so the value after the spelling becomes optional, as in GNU `cp --backup[=CONTROL]` and `ls --color[=WHEN]` under `getopt`'s optional-argument rule. [ADR-0057](decisions/0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md) records the decision.

| Form, with `backup` implying `simple` and short alias `b` | Result                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `--backup`, `-b`                                          | `"simple"`                                                      |
| `--backup=numbered`, `-bnumbered`, `-b=numbered`          | `"numbered"`                                                    |
| `--backup numbered`, `-b numbered`                        | `"simple"`, and `numbered` is the next word, an argument or a Command name |
| `--backup=`, `-b=`                                        | An empty string                                                 |
| `-tb`, with Boolean `t`                                   | `total` is `true` and `backup` is `"simple"`                    |
| `-bt`                                                     | `"t"`                                                           |
| No backup option                                          | `undefined`                                                     |

- **Attached values only.** A bare spelling never takes the next word, so an explicit value is attached: after `=` on a long spelling, and after the letter, with one leading `=` stripped, on a short alias. The missing-value error therefore never applies to the option, at the end of the words or before an option word. In a [short group](#short-groups) its letter takes the rest of the word as its value, as any value letter does, and supplies the implied value only when nothing remains.
- **Judged as a default is.** The implied value is the string an operator would otherwise type, so it is in the validator's input type as a string, and TypeScript checks `implied` against the validator's input type, as it checks a default. Every `run()` passes it through the option's validator before it reads a token, as it passes a declared default, in the `default` phase of the [validation context](#validation-context), awaits an asynchronous answer, and reuses the output for that invocation, so a bare spelling supplies the validated output and the action's type is the type it would be without `implied`. A validator that rejects it is the declaration error `@loomcli/core/invalid-implied`, with exit code 1, whether or not the invocation holds a bare spelling, because the author declared the value. `inspect()` does not pass it through the validator, as it does not pass a default.
- **With other keys.** A default fills an omitted option, and the implied value fills a bare spelling, so with `default: 'none'` an omitted `--backup` reads `none` and a bare one reads `simple`. A bare spelling supplies the option, so it satisfies `required`, and `validateOmitted` still receives omission alone. A [multiple option](#repeated-string-values) collects each bare occurrence as the implied value in its place, so `--backup -b=numbered -b` collects `['simple', 'numbered', 'simple']`. An [alias](#option-aliases) spelling reads the same forms as the long spelling.
- **Input sources.** An environment binding and the configuration source supply explicit values alone and never the implied value: a variable fills the string it holds, and an empty variable is unset, as for any string option.
- **Declarations.** `implied` belongs to a string option. `implied` on a Boolean or counted option and an `implied` value that is not a string are rejected by TypeScript at the call and throw from it for a JavaScript author, under the rules [Input declaration errors](#input-declaration-errors) lists.
- **Every option.** `implied` applies to a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares, under the same rules.

### Option aliases

```ts
const app = new Application('textstat')
  .option('min-bytes', { aliases: ['minimum'], default: '0', type: 'string' })
  .action(({ options, out }) => out.print(options['min-bytes']));
```

`aliases` lists other names of one option, for a common mistype, an inference, or a name the option used to have. Each alias adds its long spelling to the table the option's other spellings sit in, and that spelling binds the declared option, so `textstat --minimum 5` and `textstat --min-bytes 5` both set `options['min-bytes']`. [ADR-0056](decisions/0056-an-option-alias-is-an-unadvertised-long-spelling-of-one-option.md) records the decision.

- **Names.** An alias follows the rule the declared name follows: nonempty, case-sensitive, with no leading hyphen, whitespace, or `=`. An empty list declares no alias. An alias that repeats the option's own name or another of its aliases is a declaration error, and so is an alias whose spelling the option already accepts, such as `no-color` on a `both` option `color`, and an alias spelling that another option of the table already holds, under the rules [Input declaration errors](#input-declaration-errors) lists.
- **Spellings.** An alias takes every long form the option's polarity generates. A string option, a counted option, and a positive Boolean option gain `--<alias>`, a `both` Boolean option gains `--<alias>` and `--no-<alias>`, and a `negative` Boolean option gains `--no-<alias>`, so a renamed Boolean option keeps its negative form. `shortOnly` removes every long spelling, so it cannot combine with `aliases`, an empty list included: TypeScript rejects the pair, and the call that declares it throws.
- **One option.** An alias's spelling reads every value form the option's long spelling reads, `--minimum 5` and `--minimum=5` alike. It binds the option in every other respect: an option that is neither multiple nor counted can occur only once across every spelling, so `--min-bytes 1 --minimum 2` fails with `Option "--minimum" can be supplied only once`, a `multiple` option collects across them in supplied order, and a [counted option](#counted-options) counts across them. An [input source](#input-sources) fills the option only when no spelling supplied it, so `TEXTSTAT_MIN_BYTES=5 textstat --minimum 1` applies 1.
- **Diagnostics.** A fault the parser finds names the spelling the operator typed, as it does for a short alias, so a missing value reads `Option "--minimum" requires a value. Supply a value after "--minimum".` Validation and every reported problem name the option by its own long spelling, as `Option "--min-bytes"`, because the problem belongs to the option.
- **Unadvertised.** An alias is a synonym the application accepts, never a second name it advertises. Help, the [manifest](#manifest), [completion](#completion), the [suggestions](#suggestions) plugin, and every other listing omit it. [`locate`](#locating-a-word) reads a typed alias as the parser does, and [`inspect()`](#graph-inspection) publishes the declared names under `aliases` on the option's node. An alias carries no `deprecated` message of its own, because no listing shows it; an option that is itself retired declares `deprecated` on its own config.
- **Every option.** `aliases` applies to a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares, under the same rules, because they are one kind of option.

### Declaration and invocation errors

A declaration rejects duplicate option keys and spelling collisions, including generated negative forms, short aliases, and option aliases. It also rejects invalid names, aliases, types, polarity, implied values, and short-only combinations. Each throws from the call that declares the option, or from the attach that first brings two colliding options into one Application, as [Declaration faults](#declaration-faults) states. Authoring calls and both constructors capture configuration values, so later changes to the original configuration or options object do not change the declaration. The call that declares an input, `argument()`, `option()`, `globalOption()`, an input a lifecycle hook declares, and `plugin()` for the config object of each option it declares, reads that config once: it judges the prototype, copies every own string key, enumerable or not, copies its `extensions` and `aliases` lists, and snapshots the default, and every later check and the graph read that copy, so a getter on the config runs once. `plugin()`, `new Application()`, and `new Command()` read their definition or options the same way, once the name or identity is judged: each copies every own string key of the object, enumerable or not, and every plain object and list it holds that core reads by key or index, such as a plugin's `options` record, `middleware` and its `activate` list, `source`, and `views`, or the Application's `packet`, `rendering`, and `plugins`. Whether each of those parts is a plain object is judged once, and every later rule of that call reads that verdict; a later call or a run judges the value afresh. A list is read by its length once and then index by index, never through its own methods. An entry a factory built, such as a plugin, a view override, or an extension value, is not copied. Every later check, every finding, and the Application's read of each plugin's `views` read that copy, so a finding prints the value the rule judged. A read that throws there, such as a getter or a proxy trap that throws, is a declaration fault at that call, and its finding marks the top-level key whose read threw, or the whole argument when the object itself threw, and prints that part elided without reading it again. A fault judged before the declaration is read, such as an invalid name on `argument()`, `option()`, `globalOption()`, or `new Command()`, prints the config or options elided and reads none of them.

Each option that is neither multiple nor counted can occur only once per invocation. Repetition fails across every accepted spelling, including `--metric words -m bytes`, `--total -t`, `-tt`, `--total --no-total`, and `--backup -b=numbered` for a string option with an implied value. A `multiple` option collects its repetitions instead, as [Repeated string values](#repeated-string-values) describes, and a counted option counts them, as [Counted options](#counted-options) describes. An unknown or misplaced option, a missing value, or a value after a Boolean or counted option also prevents dispatch. Diagnostics identify the affected option and give a correction. A declaration error that `run()` reports returns code 1; invocation errors return code 2. A declaration diagnostic names the declaration, as in `Option "field"`, because the author edits the declaration to fix it. An input diagnostic names the supplied spelling, as in `Option "--field"`, because the operator changes that token. An argument declares and reads under one name, so its diagnostics use it throughout. A broken validator is a fault in the declaration, so it names the declaration even when a supplied value reached it. Command names, child attachment, and collisions between a global and a local option have their own rules, described in [Commands and global options](#commands-and-global-options).

#### Input declaration errors

Each rule below is a `DeclarationError` with code 1 that throws at the moment [Declaration faults](#declaration-faults) assigns it. The Rule column names the [diagnostic rule](#developer-diagnostics) the fault carries: its `sentence` is the Diagnostic cell up to the fix, and its `correction` is the fix. A fault about one key of an input's config marks that key in its finding, a fault about the input as a whole marks its name, and a fault between two inputs carries a finding for each. The finding for an option a plugin declares rebuilds its entry in the `options` record of its `plugin()` call, and its sentences name it `Plugin "@loomcli/log" option "level"`. The rules for a multiple option, an environment binding, and a global option read in [Repeated string values](#repeated-string-values), [Input source declaration errors](#input-source-declaration-errors), and [Command declaration errors](#command-declaration-errors).

| Rejected declaration | Diagnostic | Rule |
| --- | --- | --- |
| An option name that is not a string | `Option name 7 is not a string. Supply a string name.` The value prints as a finding prints it. | `@loomcli/core/declared-name` |
| An invalid option name | `Option name "bad=name" is invalid. Use a nonempty name without a leading hyphen, whitespace, or "=".` | `@loomcli/core/declared-name` |
| An `argument()`, `option()`, or `globalOption()` call whose config is missing or is not an object | `Option "format" declares a config that is not an object. Supply an option config object, such as { type: 'string' }.` | `@loomcli/core/not-an-object` |
| An `argument()`, `option()`, or `globalOption()` call whose config throws while core reads it, from a getter or a proxy trap, in its `extensions` list, or at any depth the call reads of its default | `Option "format" config could not be read: boom. Declare the config as a plain object literal whose properties read without throwing.` An argument reads `Argument "path"`. The finding marks the top-level key whose read threw, such as `default` for a throw at any depth of the default, or the whole config when the config itself threw, and prints it elided. The reason is the thrown value's, escaped, and the thrown value is the fault's `cause`. | `@loomcli/core/unreadable-declaration` |
| An `argument()`, `option()`, or `globalOption()` call, or an option a plugin declares, whose default has a path through more than 10 arrays and plain objects, or holds itself | `Option "deep" default nests deeper than 10 levels. Nest a default at most 10 levels deep.` An option a plugin declares reads `Plugin "@acme/log" option "level"`. The finding marks the default and prints it elided. | `@loomcli/core/default-depth` |
| A type other than `string`, `boolean`, or `count` | `Option "limit" has an invalid type. Use "string", "boolean", or "count".` | `@loomcli/core/option-type` |
| A `short` value that is not one ASCII letter | `Option "file" declares a short alias that is not one ASCII letter. Supply one ASCII letter.` | `@loomcli/core/short-alias` |
| A `shortOnly`, `required`, `variadic`, or `validateOmitted` value that is not Boolean | `Command "get" option "file" declares shortOnly that is not a Boolean. Use true or false.` The sentence names the key, as `Command "get" argument "paths" declares variadic that is not a Boolean.` does. | `@loomcli/core/flag-not-boolean` |
| `shortOnly` with no short alias | `Option "file" declares shortOnly and no short alias. Add short or remove shortOnly.` | `@loomcli/core/short-only-without-short` |
| An `aliases` value that is not an array | `Option "min-bytes" declares aliases that are not an array. Supply a list of alias names.` | `@loomcli/core/not-a-list` |
| An alias that is not a valid option name | `Option "min-bytes" declares an alias named "bad=name". Use a nonempty name without a leading hyphen, whitespace, or "=".` A value that is not a string prints as a finding prints it, and the fix reads `Supply a string name.` | `@loomcli/core/declared-name` |
| An alias that repeats its own option's name | `Option "min-bytes" declares alias "min-bytes", which is its own name. Remove the alias.` | `@loomcli/core/repeated-alias` |
| An alias declared twice on one option | `Option "min-bytes" declares alias "minimum" twice. Remove the repeated alias.` | `@loomcli/core/repeated-alias` |
| An alias whose spelling its own option already accepts | `Option "color" declares alias "no-color", whose spelling "--no-color" the option already accepts. Remove the alias.` The spelling may come from the option's name or from an earlier alias, and the finding marks the later alias. | `@loomcli/core/repeated-alias` |
| `aliases` beside `shortOnly` | `Option "file" declares aliases and shortOnly, which removes every long spelling. Remove aliases or shortOnly.` | `@loomcli/core/short-only-with-aliases` |
| `polarity` on a string option | `Option "color" declares polarity but is not Boolean. Remove polarity or use type "boolean".` | `@loomcli/core/polarity-on-string` |
| `polarity` on a counted option | `Option "verbose" declares polarity but is a counted option. Remove polarity or use type "boolean".` | `@loomcli/core/polarity-on-count` |
| A polarity outside the three settings | `Option "color" has an invalid polarity. Use "positive", "both", or "negative".` | `@loomcli/core/option-polarity` |
| `polarity: 'both'` beside `shortOnly` | `Option "color" cannot express both polarities with shortOnly. Enable long forms or select one polarity.` | `@loomcli/core/short-only-both-polarities` |
| Two options of one scope with one spelling | `Option spelling "-f" is used by both "force" and "file". Change one declaration.` A generated negative form counts, and its finding marks the `polarity` that generates it. An alias's spelling counts, its negative form included, and its finding marks that alias in `aliases`. | `@loomcli/core/spelling-taken` |
| Two options of one scope with one key | `Option "raw" is declared more than once on Command "get". Remove or rename the duplicate.` The scope reads `the root Command`, `the global options`, or `plugin "@loomcli/log"`. | `@loomcli/core/option-declared-twice` |
| An option a plugin declares whose key or spelling another global option or a local option holds | `Option "verbose" is declared by plugin "@acme/log" and plugin "@acme/trace". Install one of them or rename the option.` A key reports under `@loomcli/core/option-declared-twice` and a spelling under `@loomcli/core/spelling-taken`, the rules of a collision between the application's own options, and the sentence names the plugin. The rows of [Plugin declaration errors](#plugin-declaration-errors) give each pairing. | `@loomcli/core/option-declared-twice`, `@loomcli/core/spelling-taken` |
| `validate`, `default`, `required`, or `validateOmitted` on a Boolean option | `Option "verbose" is Boolean and declares default. Remove default; use polarity to control its absent value.` The sentence names the first of the four keys the option declares. | `@loomcli/core/boolean-option-value-rule` |
| `validate`, `default`, `required`, or `validateOmitted` on a counted option | `Option "verbose" is a counted option and declares default. Remove default; a counted option reads 0 when no occurrence supplies it.` The sentence names the first of the four keys the option declares. `multiple` reads under [Repeated string values](#repeated-string-values). | `@loomcli/core/count-option-value-rule` |
| `implied` on a Boolean or counted option | `Option "verbose" is a counted option and declares implied. Remove implied or declare a string option.` A Boolean option reads `Option "total" is a Boolean option and declares implied.` | `@loomcli/core/implied-on-boolean-or-count` |
| An `implied` value that is not a string | `Option "backup" declares implied that is not a string. Supply a string, the value a bare spelling supplies.` | `@loomcli/core/implied-not-a-string` |
| `required` beside a default | `Option "limit" is required and declares a default. Remove the default or make the input optional.` | `@loomcli/core/required-with-default` |
| `validateOmitted` on a declaration that decides its own absence | `Option "file" is required and declares validateOmitted. Remove validateOmitted or make the input optional.` A default reads `Option "file" declares a default and validateOmitted. Remove one; the default already fills an omitted value.`, and a multiple option or a variadic argument reads `Argument "paths" takes several values and declares validateOmitted. Remove validateOmitted; with no values the action receives an empty array and no validator runs.` | `@loomcli/core/omission-already-decided` |
| `validateOmitted` with no validator | `Option "file" declares validateOmitted without a validator. Add validate or remove validateOmitted.` | `@loomcli/core/omission-without-validator` |
| A `validate` value that is not a Standard Schema v1 object | `Option "limit" validate must be a Standard Schema v1 object. Supply a compatible validator.` | `@loomcli/core/not-a-validator` |
| A scalar default that is not a string, unvalidated | `Option "limit" default must be a string without a validator. Supply a string default.` The forms for a multiple option and a variadic argument read in [Repeated string values](#repeated-string-values). | `@loomcli/core/default-shape` |
| A default its validator rejects | `Option "limit" has an invalid default.`, one line per issue, `Option "limit": Use a whole number.`, then the fix `Fix the default or its validator.` `run()` raises it before it reads a token. | `@loomcli/core/invalid-default` |
| An implied value its validator rejects | `Option "backup" has an invalid implied value.`, one line per issue, `Option "backup": Use none, simple, or numbered.`, then the fix `Fix the implied value or its validator.` `run()` raises it before it reads a token, whether or not the invocation holds a bare spelling. | `@loomcli/core/invalid-implied` |
| A converter that fails, in a [development build](#development-builds) | `Argument "path" validator's JSON Schema converter failed for target "draft-2020-12": <reason>.` A converter that answers with anything but a plain object reads `... converter answered target "draft-2020-12" with a value that is not a plain object.` The fix reads `Fix the converter so it returns a JSON Schema object, or declare a validator that publishes none.` | `@loomcli/core/schema-converter-failed` |

### Passthrough

The first bare `--` ends core parsing. Every following token reaches the action in `passthrough: string[]`, with order, values, and token boundaries intact. The delimiter is excluded. Later `--` tokens are ordinary passthrough values.

Passthrough is always available and is empty when no tail exists. It does not satisfy required positional arguments. Core does not parse it as options or arguments, validate it, or transform it. Parsing leaves `host.argv` intact.

## Commands and global options

`Application.globalOption(name, config)` declares an option shared by every action. It accepts the config `option()` accepts, except the presence rules `required` and `validateOmitted`, and returns a new Application with the global output type added. Keep the returned value; the receiver is unchanged. Declare all globals before the first `command()` or `action()` call. An Application with no global declarations has no application-owned global options.

```ts
import { Application } from '@loomcli/core';

const configured = new Application('jsonkit')
  .globalOption('file', { short: 'f', type: 'string' })
  .globalOption('quiet', { type: 'boolean' });
```

Global names, aliases, kinds, polarity, implied values, defaults, and validators follow the local-option rules above. A global value reaches every action, so `options.file` has one type in the root action and in each Command action. A plugin declares global options too, under [Global options from plugins](#global-options-from-plugins), and they are global options in every respect: the same configuration, the same parse, the same validation, and values that reach every action typed.

A global option declares no presence rule. Its validation runs on every Command, plugin Commands included, so a rule that it must be supplied would fail the Commands that never read it. `required` and `validateOmitted` are a compile error at `globalOption()` and a declaration error thrown from it, whatever their value, under [ADR-0044](decisions/0044-a-global-option-declares-no-presence-rule.md). An omitted global is plain absence: `undefined`, its declared default, or `[]` for a multiple option. A Command that needs the value checks for it in its action, as jsonkit's document reader does under [Absence and defaults](#absence-and-defaults).

`new Command(name, options?)` declares a named Command with `argument()`, `option()`, `alias()`, `command()`, `action()`, and `extend()`. A Command name is a portable name, the rule [Application declarations](#application-declarations) states, because an operator types it at the prompt the way the application name is typed. Names stay plain strings; no handler object is keyed by command name. `configured.command(child)` attaches one child to the root, and `command()` on a named Command attaches one child to it, so a graph nests up to the cap [Nested Commands and groups](#nested-commands-and-groups) states. A Command takes one options object like the Application does: `description` is the one-line core fact every projection reads under the rule [Extensions](#extensions) states, `hidden` and `deprecated` are the two core facts [Hidden and deprecated members](#hidden-and-deprecated-members) describes, and `extensions` carries the [extension values](#extensions) plugins define. The constructor rejects globals passed to a named Command through its options. Declare globals on the Application and register its environment as shown below.

```ts
interface CommandOptions {
  description?: string;
  hidden?: boolean;
  deprecated?: string;
  extensions?: readonly ExtensionValue<'command'>[];
}
```

The action `options` object is the intersection of the global values and the selected Command's local values. A sibling Command's local options never appear in it. `.option()` rejects a name the globals already own. `.globalOption()` rejects a name already declared as a root-local option. Both checks apply at compile time and at the call.

### Nested Commands and groups

`command()` belongs to a named Command and to the unnamed root alike, and a Command path reaches at most two levels below the root. A child of the root is at level 1 and its child is at level 2, so `store cache clear` is valid and a Command attached below `clear` is a declaration error. A plugin's [Commands](#plugin-commands) are root children at level 1. A named parent sits at level 1 or deeper, so it holds only Commands with no children of their own, and `command()` on a named Command rejects a child that has children. The cap is a constant inside core, not an option, and [ADR-0035](decisions/0035-a-command-path-nests-at-most-two-levels-below-the-root.md) records it.

The Application supplies its globals throughout the graph. Every per-Command rule applies at every level, and a diagnostic that names a parent names the Command that holds the fault, so a nested parent reads as `Command "cache"`. The graph is a tree: one Command value attaches at one point in an Application's graph, and a value reached through two paths is rejected when its subtree joins the Application, so a Command that belongs in two places comes from a function that returns a fresh value for each placement. A separate Application may attach the same value, because each Application claims its nodes anew.

A Command with children and no action is a group. The unnamed root may be a group too. A group holds children alone: a local option on it reaches no handler, because locals never inherit, so attaching such a group, or building a root that is one, is a declaration error. A Command with children and an action keeps its options for that action and runs it when routing selects no child. A Command with neither children nor an action keeps the no-action declaration error.

```ts
import { Application, Command } from '@loomcli/core';

import { clearCache, listCache, summarize } from './actions.js';

const clear = new Command('clear').option('force', { type: 'boolean' }).action(clearCache);
const list = new Command('list').action(listCache);
const cache = new Command('cache').command(clear).command(list);

export const store = new Application('store')
  .globalOption('file', { type: 'string' })
  .command(cache)
  .action(summarize);
```

Routing reads a nested graph the way it reads a flat one. Plain words descend from the root, an own option of a Command with an action and children is read there and carried on to the Command routing reaches, and any other option word no global option declares stops routing at the Command reached, so `store cache clear --force` dispatches `clear` with the global values and its own locals, and `store cache --force clear` names `clear` as the Command that declares `--force`. An unknown child lists the children of the Command that holds it, at every depth.

An invocation that routes to a group fails with code 2 unless a middleware takes it over. The missing subcommand ranks after the structural faults, under [Global consumption and routing](#global-consumption-and-routing), so `store cache --verbose` reports the unknown option and `store cache` reports the missing subcommand.

### Aliases

`alias(...names)` on a named Command declares one or more aliases: other bare tokens that route to that Command. An alias changes routing alone. The routed path, every diagnostic, and the validation context report the canonical name, and the candidate list of an unknown-command or missing-subcommand error holds canonical names alone. An alias is an unadvertised synonym for a common mistype or inference, so `get` reaches a Command named `fetch` for an operator or an agent that guessed; it is never a second name the application advertises, and no projection lists it. It is not an option's short alias, which is a spelling of one option and appears in every projection, and it is not a [hidden Command](#hidden-and-deprecated-members), which is a full Command kept off every listing. An option declares unadvertised synonyms of its own under [Option aliases](#option-aliases).

Aliases belong to the Command value, so a group carries them like any other named Command, and the unnamed root declares none. The call is variadic and repeatable: `.alias('ls', 'list')` and `.alias('ls').alias('list')` declare the same set, in that order. A call with no names does not compile. An alias is a portable name like a Command name, and every canonical name and alias under one parent shares one namespace. `alias()` rejects an alias that repeats another alias of its own Command or its own Command's canonical name, and attach rejects one that repeats a sibling's name or a sibling's alias. Like every other declaration call, `alias()` precedes `action()`.

```ts
const list = new Command('list').alias('ls').action(listCache);
const cache = new Command('cache').command(clear).command(list);
```

`store cache ls` and `store cache list` both dispatch `list`, and the validation context reports `['cache', 'list']` for either spelling. `store cache nope` still lists `clear, list`.

### Hidden and deprecated members

A named Command and an option carry two core facts beside `description`, declared on the Command's options object and on the option config. `hidden` is a Boolean, and an omitted `hidden` reads `false`. `hidden: true` keeps the member off every listing: a help page, a manifest, a completion script, and the candidate list of a routing error omit it, and the member otherwise behaves as any other. A hidden Command routes, runs, and has its own help page when it is routed to directly, and that page lists its own visible children like any other page; a listing that starts from a visible ancestor never reaches them. A hidden option parses and reaches every reader its declaration reaches. When every child of a Command is hidden or deprecated, a routing error at that Command offers no candidates, and its diagnostic ends `Supply the name of a declared command.` or `Supply the name of a declared subcommand.` in place of the `Use one of` clause.

`deprecated` marks a member the application still accepts but no longer advertises as the way to do its job, and its value is the migration message: one line that holds a character other than whitespace, under the rule a `description` follows, such as `'Use get instead.'`. The declaration rejects a bare `true`, because a deprecation with no migration path leaves an operator or an agent with nothing to do. A projection shows the message beside the member, so a reader learns what to use instead at the point where they choose. A member that is both hidden and deprecated is omitted, because hidden decides what a listing shows.

Both facts apply to a local option and to a global option, whichever declarer declares it. Neither applies to an argument, because a positional cannot leave the grammar it sits in, and neither applies to the root, which is every page's entry point; `argument()` and the Application constructor reject either fact, because an argument config is inferred from its value and the compiler checks it for no excess key. Routing selects and parsing binds without reading either fact. They are facts for the projections that read the graph, and `inspect()` reports both on every `CommandNode` and `OptionNode`.

```ts
const fetch = new Command('fetch', { deprecated: 'Use get instead.', description: 'Read one value at a path.' }).action(readValue);
const debug = new Command('debug', { description: 'Dump the parsed document.', hidden: true }).action(dump);
```

### Control options

```ts
interface StringOption {
  // ...the keys under Local options...
  control?: boolean; // new: the option controls the invocation; omitted reads false
}
// BooleanOption and CountOption take the same key.
// So OptionConfig, GlobalOptionConfig, a plugin's options record, and a hook's option() call accept it.
type OptionNode =
  | { readonly type: 'string'; readonly control: boolean /* ...the fields under Graph inspection... */ }
  | { readonly type: 'boolean'; readonly control: boolean /* ... */ }
  | { readonly type: 'count'; readonly control: boolean /* ... */ };
```

```ts
// The help plugin's own option: it asks for a page about the Command, not the Command's work.
const options = {
  help: { control: true, description: 'Show this help.', short: 'h', type: 'boolean' },
} satisfies PluginOptions;
```

A control option controls the invocation rather than feeding the Command's work: `--help`, `--version`, `--manifest`, and `--format` say what the run prints or how it prints it, `--config` says where the run reads its configuration, and an action never reads them as its inputs. Whoever declares the option marks it with `control: true`, and a projection that lists what a Command needs, such as the [MCP](#mcp) tool listing, reads the mark. [ADR-0062](decisions/0062-a-control-option-is-marked-by-the-plugin-that-declares-it-and-core-never-reads-the-fact.md) records the decision.

- **Options alone.** `control` applies to an option: a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares, under one rule. An argument is always the Command's input, so `argument()` rejects `control` under `@loomcli/core/misplaced-listing-fact`, as it rejects `hidden` and `deprecated`. A value that is not a Boolean is the `@loomcli/core/flag-not-boolean` declaration error, and an omitted `control` reads `false`.
- **Core never reads it.** Routing, parsing, the input-source stage, validation, activation, and dispatch behave as they would without it, as they do for `hidden`. [`invoke()`](#invocation-by-name) accepts a control option like any other, so an invocation by name still behaves as the argv that spells it.
- **The declarer marks it.** The graph names no plugin as the source of an option under [ADR-0055](decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md), so a projection cannot tell a plugin's control option from an application's by origin. Help, version, the manifest, the formatter, and the configuration plugin set `control: true` on `--help`, `--version`, `--manifest`, `--format`, and `--config`, the private example plugin `@loom/explain` sets it on `--explain`, and an application sets it on an option of its own that does the same kind of job.
- **Its readers.** `inspect()` publishes `control` on every `OptionNode` variant, and the [manifest](#manifest) copies it into each option entry. The MCP plugin leaves a control option out of every tool's input schema. Help lists a control option as it lists any other option, so no help page changes.

#### Control options acceptance

Control options are proven when public APIs alone produce these results under Node and Bun:

- **The first-party marks.** `inspect()` on jsonkit reports `control: true` on `--help`, `--version`, `--manifest`, `--explain`, and the `--format` the formatter's hook declares on `paths`, and `control: false` on `--file`, `--verbose`, and `select`'s `--field`, and `inspect()` on textstat reports `control: true` on `--config`. Every help page the examples pin is unchanged byte for byte.
- **Every declarer.** A fixture marks a local option, a global option, a plugin's option, and an option a lifecycle hook declares, and each node reads `true`; an omitted `control` reads `false`.
- **No effect at run time.** A fixture Command whose option is marked parses, validates, activates its plugin's middleware, and reaches the action exactly as the same option unmarked does.
- **Faults.** `control: 'yes'` on an option throws `@loomcli/core/flag-not-boolean` from the declaring call, a plugin's option included, and `control` on an argument throws `@loomcli/core/misplaced-listing-fact`. The negative type checks reject both.

### Modular authoring

The Application declares globals once and registers its shallow environment in the same TypeScript project. Commands import neither the Application nor its globals. Registration supplies their global output types, including validator transformations.

```ts
// src/application.ts
import { Application } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { get } from './commands/get.js';

const configured = new Application('jsonkit')
  .globalOption('file', { type: 'string' });

declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const jsonkit = configured.command(get);
```

Register the configured Application before attaching Commands or registering its action. Registering the completed Application creates a circular dependency through the Commands that consume its types. `EnvironmentOf` reads a type-only marker containing global outputs and the installed plugin tuple. It contains no Command graph or root-local inputs and exposes no runtime property.

Keep one registration per TypeScript compilation context. Separate applications with different registrations need separate compiler projects, including examples and tests. Ensure the registration module is included in each application's project. A reusable library compiles without the consumer's registration. Its emitted Commands retain their own action types and can attach when the Application satisfies their global requirements and their local keys do not collide. Public `Command` type annotations have neutral defaults; only construction reads the registration.

An extracted action type-imports its own declaration. Keep that declaration's initializer ending in `action(handler)`: TypeScript resolves its outermost call before checking the handler. Appending `extend()` in the same self-referencing initializer makes that action call an inner call and creates circular inference. Derive an enriched value from the completed declaration instead. Inline handlers have no such self-reference.

```ts
// src/commands/get.ts
import { Command } from '@loomcli/core';

import { getValue } from '../actions/get-value.js';

export const get = new Command('get')
  .argument('path', { required: true })
  .action(getValue);

// src/actions/get-value.ts
import type { ActionHandler } from '@loomcli/core';

import type { get } from '../commands/get.js';

export const getValue: ActionHandler<typeof get> = async ({ args, options, out }) => {
  const path: string = args.path;
  const file: string | undefined = options.file;
  return out.print(`${file ?? 'stdin'}:${path}`);
};
```

`ActionHandler<typeof declaration>` works for a Command and for the root alike. `ActionArgs<typeof declaration>` and `ActionOptions<typeof declaration>` derive the same two objects for a handler that names its parameters separately, as `textstat` does. A handler written inline in `action()` needs no helper, because it infers its context from the declaration it receives.

### Global consumption and routing

```ts
const jsonkit = new Application('jsonkit', { plugins: [help()] })
  .globalOption('file', { short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .option('raw', { short: 'r', type: 'boolean' })
  .command(
    new Command('get')
      .argument('path', { required: true })
      .option('pretty', { short: 'p', type: 'boolean' })
      .option('raw', { short: 'r', type: 'boolean' })
      .action(readValue),
  )
  .action(summarize);

// jsonkit -f data.json get a.b -qp      routes to get; -q is global, -p is get's own
// jsonkit get a.b -qph                  -h is help's global option, so help renders get's page
// jsonkit -qp -f data.json get a.b      jsonkit: Option "-p" belongs to command "get". Supply it after "get".
// jsonkit -r get a.b                    the root's own -r carries routing on to get, which receives it
// jsonkit -r                            the root's action runs with raw set
```

Core reads an invocation in three layers, under [ADR-0055](decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md). An option word and a plain word are defined in [String values and token consumption](#string-values-and-token-consumption).

1. **Routing** reads the words before the first bare `--` from the root downward.
   - A plain word that names a child, or one of its [aliases](#aliases), descends into that child.
   - A plain word that names no child, while the current Command has children, is an unknown-command error that lists the children's canonical names.
   - A plain word under a Command with no children ends routing, and it is that Command's first argument.
   - An option word is read against the global options, and at a Command with an action and children against that Command's own options too, with the ordinary value rules, so its declaration says whether the next word is its value, and routing continues. Values win over route names: in `jsonkit --file keys get name`, the value of `--file` is `keys`, and routing sees `get name`.
   - A Command with children takes no arguments, under [ADR-0004](decisions/0004-arguments-and-children-are-exclusive.md), so a plain word after a parent's own option can only name a child: `jsonkit --format json paths` reads the root's own `--format` and routes to `paths`, and `jsonkit --format json` runs the root's action with it. A parent's own option read this way binds to the Command routing finally reaches, at every depth, and its letters in a short group do the same. It binds by the spelling the operator typed, not by declared name, so with the root's Boolean `-v` for `verbose` and `get`'s Boolean `-v` for `values`, `app -v get a` sets `values`, as `app get a -v` does. When that Command does not declare the spelling, the fault is held as for any spelling its table lacks, the unknown-option error unless a visible Command below it declares the spelling. When it declares the spelling with another value class than the parent's declaration routing read it by, the fault is held as the misplaced-option error that names it, because the words the parent's declaration read are never read again. The [value class](glossary.md#inputs) is the kind of option together with the rule for whether it takes the next word, so there are four: a string option that takes the next word as its value when nothing is attached, a string option with an [implied value](#implied-values), which never takes the next word, a Boolean option, and a [counted option](#counted-options). A held occurrence rebinds only to an option of the same class, so the root's own Boolean `-v` before `get` is misplaced when `get` declares `-v` as a counted option, and the root's own `--backup` with an implied value is misplaced when `get` declares `--backup` as a string option without one. A rebound bare spelling supplies the implied value of the option it binds, so the root's own `--backup` implying `simple` gives `get`'s `--backup` implying `numbered` the value `numbered`. That holds when the parent's declaration found a fault in the word too, such as a missing value or a value after a Boolean, and a declaration of the same class keeps the fault the parent's declaration found. A rebound counted occurrence adds to the count, so the root's own counted `-v` and `get`'s counted `-v` read `app -v get a -v` as `2`.
   - An option word whose walk meets a spelling those options do not declare stops routing at the Command reached, so at a group `-qp` stops when `p` is not global, and `-fp` does not when `f` is a global value letter that takes `p`. When that Command's table holds the spelling, as a local option of a Command with no children, it is that Command's option. Otherwise the fault is held: a misplaced-option error when a visible Command below the one reached declares the spelling, and an unknown-option error when none does.
   - Routing also ends where the words run out or reach `--`.
2. **The routed Command's words**, up to the first bare `--`, are read against that Command's table. Graph build gives each Command one table, after every [lifecycle hook](#lifecycle-hooks) has run: its local options, hook-declared ones included, and every global option, each entry referencing its one declaration. A group declares no local option, so its table holds the global options alone. A later plain word is the Command's argument, even when it matches a child's name. An option word the table does not hold is the misplaced-option error when a visible Command below the routed one declares it, and the unknown-option error otherwise, wherever it sits.
3. **Each owner reads its values.** Global values reach every action and every middleware's `options`. Local values reach the routed Command's action and the [request](#middleware).

A global option that is neither multiple nor counted, supplied more than once, fails as a repeated option at any placement, whichever layer read each occurrence. A global counted option counts every occurrence at any placement, so `jsonkit -v get a.b -v` reads `verbose` as `2`. Words at and after `--` are never inspected, so a `--file` in the passthrough tail stays in the tail.

- **The unknown command is raised.** It is the one fault core raises before the chain, because no Command was reached to render help for. Its `path` is the partial path routing walked.
- **Every other fault is held.** A structural fault on a global option, a misplaced or unknown option, a missing value, a repeated option, an unexpected argument, a group's missing subcommand, and a validation problem are held and raised at the [dispatch boundary](#middleware), so a middleware can take any of them over: `jsonkit -qp -f data.json get a.b --help` renders the root's page.
- **Parsing continues past a fault.** After the first fault, the rest of the words are still read against the same table, so every global option is found wherever it sits. The first fault in word order is the one held, and later faults are dropped. An unknown or misplaced option word takes no value.
- **A faulted occurrence supplies nothing.** It sets no value, records no spelling, activates nothing, and leaves its option to the [input sources](#input-sources). An earlier well-formed occurrence of a repeated option stands, so `jsonkit --help --help` renders help.
- **Precedence.** The unknown command comes first. Then the first structural fault in word order, then a group's missing subcommand, then the validation problems. So `store cache --verbose` reports the unknown option, and `store cache` alone reports the missing subcommand.
- **Validation.** One validation pass checks the global options in authoring order, whatever was held, then the routed Command's own declarations in authoring order, only when no structural fault is held and the Command is not a group. Under a held structural fault, the pass still checks each local option a plugin's hook declared whose tokens parsed, so that plugin's middleware reads its value under [`ownOptions`](#middleware); the structural fault stays the one held.

A missing required input is a validation-phase problem, so it loses to every structural fault: `jsonkit nope` reports the unknown command and validates nothing. Inside the phase, problems aggregate in authoring order, the global options first, so an invocation that omits both a required `path` argument and a required `--depth` option on the same Command reports every omission in one failure.

The misplaced-option error is `MisplacedOptionError` under [Failure classes](#failure-classes). For a parent's own option the routed Command declares with another value class, it names the routed Command, which the operator typed. Otherwise it names the visible Commands below the one routing reached that declare the spelling, in authoring order and by their path from the root, and it leaves out a hidden or deprecated Command, as every routing error's candidates do. When only such Commands declare it, the error is the unknown-option error, so it never names a Command a listing hides.

| Invocation for a `get` and `keys` graph            | Diagnostic                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `--file data.json nope`                            | `Unknown command "nope". Use one of: get, keys.`                                           |
| `--file data.json get`                             | `Argument "path" requires a value. Supply a value for "path".`                             |
| `--file data.json keys extra`                      | `Command "keys" accepts no arguments. Remove the supplied values.`                         |
| `-r get a.b` with `-r` local to `get`              | `Option "-r" belongs to command "get". Supply it after "get".`                             |
| `-r get a.b` with `-r` local to `get` and `keys`   | `Option "-r" belongs to commands get, keys. Supply it after the command name.`             |
| `-r get a.b` with `-r` declared nowhere            | `Unknown option "-r". Supply a declared option; prefix a hyphenated path with "./".`       |
| `-r get a.b` with `-r` local to the root and to `get` | None: `get` runs with its own `raw` set                                                 |
| `--verbose get a.b` with `--verbose` local to the root alone | `Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".` |
| `-n x get a.b` with a string `-n` on the root and a Boolean `-n` on `get` | `Option "-n" belongs to command "get". Supply it after "get".`        |
| `-v get a.b` with a Boolean `-v` on the root and a counted `-v` on `get` | `Option "-v" belongs to command "get". Supply it after "get".`        |
| `--backup get a.b` with `--backup` implying a value on the root and taking the next word on `get` | `Option "--backup" belongs to command "get". Supply it after "get".` |
| `-qp --file data.json get a.b` with `-p` on `get`  | `Option "-p" belongs to command "get". Supply it after "get".`                             |
| `--file one.json get a.b -f two.json`              | `Option "-f" can be supplied only once. Remove the repeated option.`                       |
| `get a.b` with a required `--depth` on `get`       | `Option "--depth" is required. Supply a value.`                                            |
| no tokens with an actionless root                  | `A command is required. Use one of: get, keys.`                                            |
| `cache` for a `cache` group                        | `Command "cache" requires a subcommand. Use one of: clear, list.`                          |
| `cache --verbose` for a `cache` group              | `Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".` |

#### Option parsing acceptance

Option parsing is proven when public APIs alone produce these results under Node and Bun:

- **Mixed groups.** `textstat -ht` renders the root's compact help page with exit code 0, and `textstat -tc .textstat.toml notes.txt` reads `-t` as the root's `total` and `-c` as the configuration plugin's `--config`.
- **Attached values.** `textstat -mwords notes.txt`, `-m=words`, and `-tmwords` set `metric` to `words`, and `-m=` hands its validator the empty string.
- **Plain words.** A fixture reads `--depth -5` and `-d -5` as the value `-5`, `-5` and `-` as arguments, and `--pattern -x` as the missing-value error that names the attached form.
- **A parent's own option.** `jsonkit --format json paths` reads the root's own `--format`, routes to `paths`, and prints its rows as JSON with exit code 0, and a fixture proves the unknown-option and misplaced-option faults when the routed Command does not declare the spelling or declares another value class, at the root and one level down.
- **Misplaced options.** `jsonkit -F name select` fails with `jsonkit: Option "-F" belongs to command "select". Supply it after "select".`, then help's hint `Run "jsonkit --help" to see the usage.`, and exit code 2, and the same words with `--help` render the root's page.
- **Held faults.** `jsonkit --file` fails with the missing-value error, `jsonkit --file --help` and `jsonkit --help --help` render help, `store cache --verbose` reports the unknown option, and `jsonkit nope --help` still reports the unknown command.
- **A plugin's options.** A fixture plugin's validated option reaches a fixture action typed as its validator's output and every middleware's `options`, a value its validator rejects is an input problem with exit code 2 and leaves `options` `null`, and a fault on a local option leaves `options` set.
- **Counted options.** `jsonkit -v keys -f doc.json`, `jsonkit keys -f doc.json -v`, and `jsonkit -vv keys -f doc.json` each write jsonkit's `Reading doc.json.` line on stderr and `jsonkit keys -f doc.json` writes none, `jsonkit --verbose=2 keys` fails with `jsonkit: Counted option "--verbose" does not accept a value. Repeat "--verbose" to raise its count.` and exit code 2, and `jsonkit -v2 keys` reports `Unknown option "-2"`. A fixture proves that `-vvv`, `-v -v -v`, `--verbose -vv`, and occurrences on both sides of the Command name each read `3`, an omitted counted option reads `0`, `-tvv` beside a Boolean `t` reads `2`, an alias's occurrences counted with the rest, `VERBOSE=3` and a configuration answer of `3` each filling `3` when no occurrence supplied it, `VERBOSE=x` failing with `Option "--verbose" (from VERBOSE): Use a whole number of 0 or more.`, and each counted-option row of [Input declaration errors](#input-declaration-errors) and [Repeated string values](#repeated-string-values) rejected.
- **Implied values.** A fixture with `backup` implying `simple` and short alias `b` reads each form of [Implied values](#implied-values): a bare spelling at the end of the words and before an option word supplies `simple`, `--backup numbered` reads `numbered` as the next word, `-tb` and `-bt` read as the table states, `--backup=` and `-b=` supply the empty string, a bare spelling supplies the validator's output for the implied value, a validator that rejects the implied value fails `run()` with `@loomcli/core/invalid-implied` before any token is read, a multiple option collects it in place, and the declaration rows for `implied` are rejected.
- **Rebinding.** A fixture proves that a parent's own option rebinds to a child's option of the same value class and is the misplaced-option error for each other pairing of the four value classes.
- **One grammar.** `locate` reads each form above where the parser reads it, and completion is re-proven for short groups, attached values, misplaced options, counted options, and implied values in Bash, Zsh, and Fish.

### Command declaration errors

Each rule below is a `DeclarationError` with code 1 that names both sides with a correction, and it throws at the moment [Declaration faults](#declaration-faults) assigns it. The Rule column names the [diagnostic rule](#developer-diagnostics) a fault carries: its `sentence` is the Diagnostic cell up to the fix, and its `correction` is the fix. The rules cover the global options, every Command's spellings, every declared default, the view overrides, the options object's own shape, the order of the declaration calls, and every level of the tree. [Result declaration errors](#result-declaration-errors), [Input source declaration errors](#input-source-declaration-errors), and [Plugin declaration errors](#plugin-declaration-errors) list the rules for results, for environment bindings and the configuration source, and for plugins. Many reach JavaScript authors alone, because the types already reject the invalid declaration: arguments beside children in either declaration order, a local option that repeats a global option's key, a Command with several actions, an attached value that is not a Command, constructor options that contain a retired `globals` or `failures` property, a `views` entry that is not an `override` value, an argument, option, or alias declared after the action, a child attached after the action, an `alias()` call with no names, a global option declared after Command attachment or action registration, a version that is not a string, a description that is not a string, a `hidden` value that is not a Boolean, and a `deprecated` value that is not a string. A plugin's [Commands](#plugin-commands) join the root outside the types, so arguments beside children and a local option that repeats a global option's key reach every author when a plugin brings them. Every author, TypeScript and JavaScript alike, meets the rest: a description that is blank or holds a line terminator, a deprecated message that is blank or holds a line terminator, a version that is blank or holds a line terminator, a `hidden` or `deprecated` fact on the root or on an argument, two children with one name, a Command value attached under two parents, a Command nested more than two levels below the root, an invalid application name, an invalid Command name, an alias that repeats a name or alias under the same parent, an alias that repeats its own Command's name or another of its aliases, an invalid alias name, an invalid argument name, an argument declared twice, a global and a local option that share one spelling, a Command with neither children nor an action, a local option on a group, a variadic argument that is not last, two view overrides for one key inside one contributor, since the same key overridden across contributors resolves first-in-wins, an override key whose identity a distinct declared-view object already carries, an options slot on the Application or on a Command holding a value that is not a plain object even when it satisfies the options type structurally, and the two argument-order rules below. Every rule applies at every level, and a diagnostic names the Command that holds the fault. The four closures `action()` applies, to arguments, options, aliases, and children, are judged against the author's own calls; a call a plugin's [lifecycle hook](#lifecycle-hooks) issues is exempt from them and from nothing else. [`inspect()`](#graph-inspection) applies every build rule `run()` applies, so the only faults it leaves to `run()` are a declared default and an implied value that their validator rejects. In a [development build](#development-builds) a converter that fails is a build fault from both, under [Checks only development runs](#development-builds); a distributed build reads its schema as `null` under both, as [Input schema](#input-schema) states.

| Rejected declaration                                    | Diagnostic                                                                                                                                                                                                                                                                 | Rule |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A Command that declares arguments and attaches children | `The root Command declares argument "files" and attaches child "get". Move the argument into a child Command or remove the children.`                                                                                                                                      | `@loomcli/core/arguments-beside-children` |
| Two children with one name                              | `The root Command attaches two children named "get". Rename or remove one.`                                                                                                                                                                                                | `@loomcli/core/sibling-name-taken` |
| A Command value attached under two parents              | `The root Command attaches child "clear", which Command "cache" also attaches. Attach a Command value at one point; create a new Command for each placement.`                                                                                                              | `@loomcli/core/command-attached-twice` |
| A Command nested more than two levels below the root   | `Command "cache" attaches child "clear", which has children of its own. Nest Commands at most two levels below the root.` | `@loomcli/core/nesting-depth` |
| An invalid application name                             | `Application name "bad name" is invalid. Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".` `new Application()` throws it before it reads any option. | `@loomcli/core/portable-name` |
| An invalid Command name                                 | `Command name "bad name" is invalid. Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".` `new Command()` throws it before any parent exists, so the sentence names the Command alone. | `@loomcli/core/portable-name` |
| An alias that repeats a sibling's name                  | `The root Command attaches child "keys" with alias "get", which is also the name of child "get". Rename or remove one.`                                                                                                                                                    | `@loomcli/core/sibling-name-taken` |
| An alias that repeats a sibling's alias                 | `The root Command attaches child "keys" with alias "ls", which is also an alias of child "select". Rename or remove one.`                                                                                                                                                  | `@loomcli/core/sibling-name-taken` |
| An alias that repeats its own Command's name            | `Command "keys" declares alias "keys", which is its own name. Remove the alias.`                                                                                                                                                                                           | `@loomcli/core/repeated-alias` |
| An alias declared twice on one Command                  | `Command "keys" declares alias "ls" twice. Remove the repeated alias.`                                                                                                                                                                                                     | `@loomcli/core/repeated-alias` |
| An invalid alias name                                   | `Command "keys" declares an alias named "bad name". Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".`                                                                                                                                              | `@loomcli/core/portable-name` |
| An invalid argument name                                | `The root Command declares an argument named "bad name". Use a nonempty name without a leading hyphen, whitespace, or "=".`                                                                                                                                                | `@loomcli/core/declared-name` |
| A global option with a presence rule                    | `Global option "file" declares <required or validateOmitted>. Remove <required or validateOmitted>, and check for the value in each Command that needs it.` It throws from `globalOption()` whatever the key's value, `required: false` included. | `@loomcli/core/global-presence-rule` |
| A global option declared after the application's own `command()` or `action()` | `The Application declares global option "file" after command() or action(). Declare global options before attaching Commands or registering an action.` | `@loomcli/core/global-option-after-command` |
| Globals declared on a named Command                      | `Command "get" declares globals. Declare globals on the Application and register its environment.` Attachment separately rejects an unsatisfied global type requirement or a known global/local key collision.                                                              | `@loomcli/core/command-globals` |
| A global and a local option with one key                | `Option "file" is declared as a global option and as a local option on Command "get". Rename the local option.` A local option a plugin's hook declared reports through the hook-collision row of [Plugin declaration errors](#plugin-declaration-errors) instead.                                                                                                                                                            || `@loomcli/core/option-declared-twice` |
| A global and a local option with one spelling           | `Option spelling "-f" is used by the global option "file" and the local option "force" on Command "get". Change one declaration.`                                                                                                                                          || `@loomcli/core/spelling-taken` |
| A Command with neither children nor an action           | `Command "get" has no action. Register an action.`                                                                                                                                                                                                                         | `@loomcli/core/command-without-action` |
| A group that declares a local option                    | `Command "cache" declares option "verbose" but registers no action to receive it. Register an action or remove the option.` The root form reads `The root Command declares option "verbose" ...`.                                                                          | `@loomcli/core/group-option` |
| A Command with several actions                          | `Command "get" has multiple actions. Register one action.`                                                                                                                                                                                                                 | `@loomcli/core/multiple-actions` |
| An attached value that is not a Command                 | `The root Command attaches a value that is not a Command. Attach the value returned by new Command(name).`                                                                                                                                                                 | `@loomcli/core/not-a-command` |
| Retired constructor globals configuration | `The Application options contain globals. Declare them with globalOption(name, config).` | `@loomcli/core/retired-application-option` |
| Retired constructor failures configuration | `The Application options contain failures. Declare view overrides under views with override(key, view).` | `@loomcli/core/retired-application-option` |
| An options argument that holds no options object | `The Application declares options that are not an object. Supply an Application options object.` | `@loomcli/core/not-an-object` |
| Application options that throw while core reads them, from a getter or a proxy trap on the options, the `packet`, the `rendering` policy, or one of its `plugins`, `views`, `translators`, or `extensions` lists | `The Application options could not be read: boom. Declare the options as a plain object literal whose properties read without throwing.` The finding marks the top-level slot whose read threw, such as `packet` for a throw in its `build`, or the whole options argument when the object itself threw, and prints it elided. The thrown value is the fault's `cause`. | `@loomcli/core/unreadable-declaration` |
| A views entry that is not an override                   | `The Application holds a value that is not a view override. Supply the value returned by override(key, view).` A `views` value that is not an array reads `The Application declares views that are not an array. Supply a list of override values.` under `@loomcli/core/not-a-list`.                                                                                                                                                            | `@loomcli/core/foreign-value` |
| An override keyed on neither a declared view nor a failure class | `The Application overrides a key that is neither a declared view nor a failure class. Key the override on a value view(identity, definition) returned, or on a failure class.` A plugin's list reads `Plugin "@acme/brand" overrides` in its place. | `@loomcli/core/override-key` |
| A rendering policy that is not an object | `The rendering policy is not an object. Supply an object, or omit rendering.` `run()`'s own `rendering` option reports the same rule from the run. | `@loomcli/core/rendering-policy` |
| A rendering setting outside its closed set | `Rendering color is not auto, always, or never. Supply one of the three, or omit color.` The same sentence names `modifiers` and `hyperlinks`, and `terminalControls` reads `Rendering terminalControls is not strip or preserve. Supply strip or preserve, or omit terminalControls.` | `@loomcli/core/rendering-policy` |
| A packet that is not a plain object                    | `The Application packet must be an object. Import loom.packet.json and pass it as packet.` | `@loomcli/core/invalid-packet` |
| A packet with no `build`, or a `build` outside the two values | `The packet's build is "staging". Set build to "development" or "distributed".` A missing `build` reads `The packet has no build. Set build to "development" or "distributed".`, and a quoted value is escaped. | `@loomcli/core/invalid-packet` |
| A Command options argument that holds no options object | `Command "get" declares options that are not an object. Supply a Command options object.` | `@loomcli/core/not-an-object` |
| Command options that throw while core reads them, from a getter or a proxy trap on the options or their `extensions` list | `Command "get" options could not be read: boom. Declare the options as a plain object literal whose properties read without throwing.` The finding marks the top-level slot whose read threw, such as `extensions` for a throw in one of its entries, or the whole options argument when the object itself threw, and prints it elided. The thrown value is the fault's `cause`. | `@loomcli/core/unreadable-declaration` |
| A description that is blank or holds a line terminator  | `Command "get" description must hold a character other than whitespace and no line terminator. Supply a one-line summary.` The same sentence names the Application as `The Application`, a global option as `Global option "file"`, a local option as `Command "get" option "raw"`, an option a plugin declares as `Plugin "@loomcli/log" option "level"`, and an argument as `The root Command argument "files"`. A description that is not a string reads the same sentence, and a JavaScript author alone can declare one. | `@loomcli/core/not-one-line` |
| A version that is not a string, or is blank or holds a line terminator | `The Application version must be a string that holds a character other than whitespace and no line terminator. Supply a string such as "1.2.0".` A JavaScript author alone can declare a version that is not a string. | `@loomcli/core/not-one-line` |
| A deprecated message that is blank or holds a line terminator | `Command "fetch" deprecated message must hold a character other than whitespace and no line terminator. Supply a one-line migration path, such as "Use get instead.".` The same sentence names a global option as `Global option "raw"`, a local option as `Command "get" option "raw"`, and an option a plugin declares as `Plugin "@loomcli/log" option "level"`. A `deprecated` value that is not a string, `true` included, reads the same sentence, and a JavaScript author alone can declare one. | `@loomcli/core/not-one-line` |
| A hidden value that is not a Boolean                    | `Command "fetch" declares hidden that is not a Boolean. Use true or false.` The same sentence names a global option as `Global option "raw"`, a local option as `Command "get" option "raw"`, and an option a plugin declares as `Plugin "@loomcli/log" option "level"`. A `control` value that is not a Boolean reads the same sentence with `control` in place of `hidden`, as in `Command "get" option "raw" declares control that is not a Boolean. Use true or false.` A JavaScript author alone can declare one. | `@loomcli/core/flag-not-boolean` |
| A hidden or deprecated fact on the root or an argument, or `control` on an argument | `The Application declares hidden, which applies to named Commands and options alone. Remove it.` The same sentence names the fact declared, and an argument as `The root Command argument "files"` or `Command "get" argument "path"`. `control` reads `Command "get" argument "path" declares control, which applies to options alone. Remove it.` Neither the Application options type nor an argument config accepts either key, so a fresh object literal fails to compile; a TypeScript author reaches this rule through an options object or an argument config held in a variable, because excess-key checking applies to a fresh object literal alone. | `@loomcli/core/misplaced-listing-fact` |
| Two view overrides for one key                          | `The Application overrides the view for "InputError" twice. Remove one override.` For a declared view the sentence reads `The Application overrides view "@loomcli/plugins/help/page" twice. Remove one override.`                                                                                       | `@loomcli/core/override-twice` |
| An override key from a second copy of a package         | `View "@loomcli/plugins/help/page" is declared by two distinct objects. Install one copy of the package that declares it.` The same sentence reports every identity collision, whichever lists hold the two objects.                                                                                                  | `@loomcli/core/two-package-copies` |
| A variadic argument that is not last                    | `Argument "paths" is variadic and precedes argument "path" on Command "get". Declare the variadic argument last.`                                                                                                                                                          | `@loomcli/core/variadic-argument-last` |
| An optional argument before a required one              | `Argument "path" is optional and precedes required argument "name" on Command "keys". Declare optional arguments after required ones.`                                                                                                                                     | `@loomcli/core/optional-argument-last` |
| An argument after an optional one                       | `Argument "extra" follows optional argument "path" on the root Command. Declare an optional argument last.`                                                                                                                                                                | `@loomcli/core/optional-argument-last` |
| An argument or option declared after the action         | `Command "get" declares option "raw" after its action. Declare arguments and options before action().`                                                                                                                                                                     | `@loomcli/core/declared-after-action` |
| An alias declared after the action                      | `Command "keys" declares alias "ls" after its action. Declare aliases before action().`                                                                                                                                                                                    | `@loomcli/core/declared-after-action` |
| An `alias()` call with no names                         | `Command "keys" declares an alias with no names. Supply at least one name.`                                                                                                                                                                                                | `@loomcli/core/alias-without-names` |
| A child attached after the action                       | `The root Command attaches child "get" after its action. Attach children before action().`                                                                                                                                                                                 | `@loomcli/core/declared-after-action` |
| An argument declared twice | `Argument "path" is declared more than once on Command "get". Remove or rename the duplicate.` | `@loomcli/core/argument-declared-twice` |

Local options on separate Commands can reuse names and spellings, with a different value shape on each one, so `--field` and `-F` can collect strings on one Command, read as a Boolean with `--no-field` on a sibling, and carry a validated scalar on a nested leaf. Each action sees only its own Command's declarations and the global options. A Command's table references each global option's one declaration and never copies it, so a diagnostic names the declarer.

### Example coverage

[jsonkit](../examples/jsonkit/src/application.ts) declares two global options, an optional `--file` and the [counted option](#counted-options) `-v, --verbose` with the description `Name the document before reading it.`, a root summary action, a `get` Command with a required scalar `path`, a `keys` Command with an optional scalar `path` and the alias `ls`, a `select` Command, a `fetch` Command that is deprecated in favor of `get`, and a `debug` Command that is hidden. `jsonkit ls` lists keys exactly as `jsonkit keys` does, and `jsonkit typo` offers `doctor, completion, get, keys, select`, because a routing failure's candidate list omits the hidden `debug` and the deprecated `fetch`. `select` declares `--field` as a required multiple option with the alias `-F` and the validator `text()` from the [validator catalog](validators.md), so its action receives `string[]` and prints the requested top-level keys in supplied order. A field the document does not hold is skipped with a warning on stderr while the rest still print, which is the example use of a non-fatal `out` channel. An omitted `keys` path lists the root; a supplied one resolves with the syntax `get` uses, through the resolver both Commands share. Each action is a separate module typed with `ActionHandler`, and all six read their document through one shared reader. That reader selects the source: a supplied `--file` streams from disk, and without one the document streams from `host.stdin`. When `verbose` is at least 1, the reader first writes one line through `out.info` that names the source, `Reading doc.json.` for `-f doc.json` and `Reading stdin.` without a file, with the file name passed through `escapeControlCharacters` and the action's `style.escape`, as jsonkit's other operator-supplied names are; a higher count writes the same one line, and with no occurrence it writes nothing. A read failure names the file or `stdin`, and a parse failure names the document the same way; a file name and a runtime reason that quotes it print with their control characters escaped. The reader also holds the rule that one of the two sources must exist, because a global option declares no presence rule, and the [validation example coverage](#example-coverage-1) describes it.

## Input sources

```ts
// `StringOption`, `BooleanOption`, `CountOption`, and `GlobalOptionConfig` accept `env`, except a multiple string option, so `{ multiple: true, env: 'FIELDS' }` fails to compile.
// Core exports `SourceResolver`, `SourceContext`, `SourceAnswer`, and `ContextualStyle`, the type of an action's `style`.
interface EnvBinding {
  env?: string;
}

interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  // ...
  source?: {
    binding: AnyExtension & { readonly target: 'option' };
    load: () => Promise<{ default: SourceResolver<Plugin<Options>> }>;
  };
}
type SourceResolver<P extends Plugin | ((...args: never[]) => Plugin)> = (
  context: SourceContext<OptionsOf<P>>,
) => Promise<Readonly<Record<string, SourceAnswer>>>;
interface SourceContext<Options extends PluginOptions = PluginOptions> {
  readonly host: Host;
  readonly options: PluginOptionValues<Options>;
  readonly requests: readonly OptionNode[];
  readonly graph: CommandGraph;
  readonly out: Out;
  readonly style: ContextualStyle;
  readonly invokedBy: 'argv' | 'name'; // new: see Invocation by name
}
interface SourceAnswer {
  readonly value: string | boolean | number | readonly string[]; // a number for a counted option
  readonly label: string;
}
```

```ts
// src/config/extension.ts: the binding names a key in the plugin's settings file.
export const configKey = extension('@acme/config/key', { schema: z.string(), target: 'option' });

// src/config/plugin.ts
export function config(): Plugin<ConfigOptions> {
  return plugin('@acme/config', {
    extensions: [configKey],
    options: { config: { description: 'Read settings from this file.', type: 'string' } },
    source: { binding: configKey, load: () => import('./source.js') },
  });
}

// src/config/source.ts, loaded only when an unfilled option carries configKey
const source: SourceResolver<typeof config> = async ({ host, options, requests }) => {
  const settings = await readSettings(options.config ?? join(host.cwd, '.acme.json'));
  const answers: Record<string, SourceAnswer> = {};
  for (const request of requests) {
    const key = readExtension(request, configKey);
    const value = key === undefined ? undefined : settings.values[key];
    if (typeof value === 'string') {
      answers[request.name] = { label: `${key} in ${settings.path}`, value };
    }
  }
  return answers;
};
export default source;

// The application binds --limit to a variable and to a configuration key.
const app = new Application('textstat', { plugins: [config()] })
  .option('limit', { env: 'TEXTSTAT_LIMIT', extensions: [configKey('limits.bytes')], type: 'string', validate: digits })
  .action(count);
```

The environment and the configuration map into options, and everything downstream reads options. A value from either is an alternative to giving the option, in every way. [ADR-0032](decisions/0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) records the decision.

- **Precedence.** For each option, the first tier that supplies a value wins: argv, then the environment, then the configuration source, then the declared default, which for a Boolean option is its polarity's absent value and for a counted option is `0`. The order is fixed and core owns it. No input and no plugin reorders it. A multiple option and a counted option are supplied by argv when they have at least one occurrence. An [implied value](#implied-values) is a value argv supplies, through a bare spelling, so no source supplies one.
- **The stage.** Core fills options in one input-source stage, after parsing and before validation. The options in scope are the routed Command's local options and every global option. The stage fills the global options whatever was held, a structural fault on a global option and a group's missing-subcommand error included, so [activation](#activation) is identical to typing the flag. An occurrence that faulted supplies nothing, so the stage may fill its option. It fills the local options only when nothing is held, because the [request](#middleware) is `null` otherwise. An unknown command ends the run before the stage.
- **Environment binding.** `env` names the variable that supplies the option, and binding is explicit only: core derives no name, adds no prefix, and accepts no `env: true`. A local option and a global option may bind, whoever declares it, and the author of the declaration names the variable, so a logger plugin that declares `--verbose` binds it with `env: 'VERBOSE'`. An argument cannot bind. A multiple string option cannot bind either, because its list comes from the configuration source. The name matches `[A-Za-z_][A-Za-z0-9_]*` and is read from `host.env` case-sensitively, with no rule about case. Within one invocation's scope a variable binds at most one option. Two Commands may bind one variable to their own local options, because only one of them runs.
- **Environment values.** An empty variable is unset and falls through to the next tier, the rule `NO_COLOR` and `FORCE_COLOR` follow. A string option receives the variable's value as its raw string. A Boolean option reads the whole value, case-insensitive and untrimmed: `true` and `1` are true, and `false` and `0` are false. The value states the option's value, not a spelling, so `VERBOSE=false` means false under positive, negative, and both polarity. Any other value is a usage failure naming the variable, `Option "--verbose" (from VERBOSE): Use true, false, 1, or 0.`, and it fills nothing: no lower tier fills the option, and it activates nothing. A [counted option](#counted-options) reads the whole value as a count when it is one or more ASCII decimal digits, so `0`, `3`, `007`, and `12` fill `0`, `3`, `7`, and `12`. Any other value, `-1`, `1.5`, ` 3`, and `three` included, is the same usage failure with the issue `Use a whole number of 0 or more.`, and it fills nothing in the same way. A variable fills a string option that declares an implied value with the string it holds, never with the implied value.
- **Host conventions.** `NO_COLOR`, `FORCE_COLOR`, and `TERM` are core's [rendering policy](#rendering-policies), read by presence under ADR-0022. They are not environment bindings, and the Boolean grammar does not apply to them. An option may bind `NO_COLOR`, `FORCE_COLOR`, or `TERM`. Rendering policy still reads the variable by presence, and the binding reads it under the rules above.
- **Configuration source.** A plugin definition may declare `source: { binding, load }`. `binding` is an option-target descriptor the plugin lists under its own `extensions`. An option that carries a value of it is configuration-bound, so core knows which options to ask about without knowing what the binding means, and core holds no store, file format, or path grammar. After argv and the environment, core collects the in-scope options that are still unfilled, configuration-bound, and hold no environment fault, the global options first and then the routed Command's own, each in declaration order. When there are none, core never loads the source. Otherwise it loads the source lazily, as it loads a middleware, and calls the resolver once and awaits it. The context holds the host, the plugin's own option values, the requests, which are the `OptionNode` of each collected option, and `graph`, the graph `inspect()` would return, which a run that calls a source builds as a run with a middleware chain does. Each request is the node itself inside `graph`, so `graph.globals.includes(request)` tells a global option from a local one. It also holds `out`, the channel object a middleware receives, and `style`, the contextual style an action receives, so a source warns through `out.warn` and the `lanes.warn` view, escaping raw data with `style.escape` first. A warning writes when the source runs, ahead of any takeover, so a source that warns under `--help` prints the warning on stderr before the page. `out.fatal()` in a source throws a `FatalError`, which core reports with its message and its class's code, 1, as it reports any failure from a source, and `out.results()` is the `out.results()` fault with `A configuration source` as its subject, and each call is reported after the outcome, a takeover included, as a middleware's call is, so it turns a would-be 0 into 1. The source's own options resolve from argv, the environment, and their defaults, and pass their validators, before the call, and they are never requested. When one is rejected, core never calls the source and reports the problem with the other validation problems, in their order; a rejected own option is not a source failure. An option the skipped source would have filled reports no missing value, and an absence rule never judges its omission, because the operator's configuration may hold it. A binding value on an option of an application that does not install the declaring plugin is inert, as every extension value of an uninstalled plugin is.
- **Answers.** The resolver returns a record keyed by declared name. An answer holds a value of the option's raw type, a string for a string option, a Boolean for a Boolean option, a whole number of 0 or more for a counted option, and a list of strings for a multiple option, which the configuration source may fill although the environment cannot. It also holds a label, one line that holds a character other than whitespace, which core prints in diagnostics. A requested option with no key in the record has no answer and falls through to its default. A configuration answer of an empty string or an empty list is a fill: it keeps the default from applying and activates, and only a missing key is no answer.
- **One source.** An application has at most one configuration source. A second installed plugin that declares one is a declaration error from the Application constructor naming both plugins, as a second claim on the [signals slot](#signals-and-cancellation) is.
- **Failures from a source.** A resolver that throws or rejects with a `LoomError` reports that failure with its class's code, as an action's failure reports. An `InputError` is a usage failure with code 2, with the message and problems the source gave it, as under [ADR-0036](decisions/0036-each-value-passes-the-same-validator.md); the source uses it for a mistake in the invocation that only it can see, such as a file the operator named that does not exist. A problem the source reports for a requested option names it by [`reportedSpelling(request)`](#failure-classes), the spelling core's own validation reports, so the source never derives it. In an [invocation by name](#invocation-by-name), where `invokedBy` reads `'name'`, it names the option by its declared name, `request.name`, as core's own problems do there. An application's own failure class keeps its [declared code](#declared-exit-codes). Only the resolver's own throw or rejection reports this way; a failure thrown while core reads the answers is a plugin fault. [ADR-0038](decisions/0038-a-configuration-source-warns-and-reports-input-problems-through-the-ordinary-channels.md) records the decision for an `InputError`, and [ADR-0045](decisions/0045-a-failure-class-declares-its-exit-code.md) widens it to any `LoomError`.
- **Plugin faults.** A source that fails to load, throws anything that is not a `LoomError` and that no [translator](#translators) answered, or answers with anything the answers rule does not allow is a fault of that plugin, an internal error with code 1. A throw while core reads the source's answers, a getter on the record or on an answer included, is never offered to a translator and is reported as the resolver failure `Plugin "<id>" failed in its configuration source: <reason>.`, while a fault the answers rule raises keeps its own sentence. A missing or malformed configuration file is not a core fault: the configuration plugin decides how to treat one, and a source that answers nothing leaves every option to its default.
- **Supplied in every sense.** A filled value satisfies `required`, and a list satisfies the at-least-one rule of a required multiple option by its length, so an empty list still reports the required message. A filled value never triggers `validateOmitted`, because the validator receives the filled value and not `undefined`. It appears in the [validation context](#validation-context)'s `supplied` record as the raw value. The action, the request, and the graph cannot tell which tier supplied a value. Provenance is internal to core's failure messages, and nothing publishes it, except that a [middleware](#middleware) reads under `spellings` how its own plugin's options were typed, which a filled option never has.
- **Diagnostics.** A failure on a filled value keeps the option as its subject, named by the spelling an operator would type under [Absence and defaults](#absence-and-defaults), and adds the source in parentheses after it: `Option "--limit" (from TEXTSTAT_LIMIT): Supply a whole number.`. An issue path follows the parenthesis, as in `Option "--field" (from fields in ./.acme.json) at 1: Supply a field name.`. The environment's label is the variable name, and the configuration source supplies the label of each answer, such as `limits.bytes in ./.acme.json`. A message about a value given in argv is unchanged. A fault on a filled value is an ordinary `InputProblem`, and `InputProblem` gains no field. A Boolean variable outside the grammar is an `invalid` problem whose one issue reads `Use true, false, 1, or 0.`, and a counted option's variable outside its grammar one whose issue reads `Use a whole number of 0 or more.`. The parenthesized source appears in core's default text alone, so a view that renders `problems` cannot print it.
- **Held faults.** Every environment and configuration fault is held like any validation fault under [Invocation](#invocation) and raised only at the dispatch boundary, so a takeover such as `--help` reports none. A Boolean or counted variable outside its grammar and an issue on a filled value are validation-phase problems, collected in authoring order with the rest, the globals first. A plugin fault or a failure from the source stops the stage, fills nothing more, and takes the place of every problem collected, as a validator's developer error does. A structural fault and the missing-subcommand error keep their rank ahead of all of them, and after either one core validates the global options alone. A run cancelled while a source call is in flight awaits it, as it awaits a validator, and starts nothing further.
- **Projections.** `inspect()` publishes `env` on every [`OptionNode`](#graph-inspection) variant, the bound variable or `null`, and the [manifest](#manifest) copies it into each option entry. Help prints no environment binding on either [variant](#help-variants), because help teaches command-line syntax and a variable belongs to the documentation. A configuration binding is the declaring plugin's extension value, which `inspect()` already publishes under `extensions`, and core adds no fact for it.

### Input source declaration errors

Each rule below is a `DeclarationError` with code 1 that throws at the moment [Declaration faults](#declaration-faults) assigns it. A diagnostic names the declaration the way the description row of [Command declaration errors](#command-declaration-errors) does: `Global option "limit"`, `Command "count" option "limit"` or `The root Command option "limit"` for a local option, and `Plugin "@loomcli/log" option "verbose"` for an option a plugin declares. The types reject `env` on a multiple option, on an argument config written as a fresh object literal, and with a value that is not a string, and they reject a source binding that is not an option-target descriptor, so those rules reach a JavaScript author alone, except `env` on an argument, which the types reject only as an excess property of a fresh object literal.

| Rejected declaration | Diagnostic | Rule |
| --- | --- | --- |
| A variable name outside the grammar | `Global option "limit" env "9LIMIT" is not a variable name. Use a letter or an underscore, then letters, digits, or underscores.` An `env` value that is not a string reads the same sentence without the quoted value. | `@loomcli/core/env-name` |
| `env` on a multiple option | `Global option "field" is a multiple option and declares env. Remove env; a list comes from the configuration source.` | `@loomcli/core/env-on-multiple` |
| `env` on an argument | `Command "get" argument "path" declares env, which applies to options alone. Remove it.` | `@loomcli/core/env-on-argument` |
| One variable bound twice in one scope | `Variable "TEXTSTAT_LIMIT" is bound by global option "limit" and Command "count" option "max". Bind each variable to one option.` The two sides name any pair of a global option and a local option, and an option a plugin declares against an application's is the same error. | `@loomcli/core/variable-bound-twice` |
| A second configuration source | `Plugin "@acme/yaml" declares a configuration source, which plugin "@acme/config" already declares. Install one source.` | `@loomcli/core/slot-taken` |
| A `source` value that is not an object | `Plugin "@acme/config" declares a source that is not an object. Supply { binding, load }.` | `@loomcli/core/not-an-object` |
| A binding the plugin does not list | `Plugin "@acme/config" declares a source binding that is not one of its extensions. Supply a descriptor the plugin lists under extensions.` | `@loomcli/core/source-binding` |
| A binding on the wrong target | `Plugin "@acme/config" declares source binding "@acme/config/key", which applies to Commands. Supply an extension that applies to options.` | `@loomcli/core/source-binding` |
| A source without a loader | `Plugin "@acme/config" declares a source with no load function. Supply load: () => import('./source.js').` | `@loomcli/core/not-a-function` |
| A binding on the source's own option | `Plugin "@acme/config" option "config" carries its own source binding. Remove the value; the source's own options resolve before it loads.` | `@loomcli/core/source-bound-own-option` |

Five faults surface at invocation time, as defects with code 1, held and raised at the dispatch boundary and rendered by build under [Development builds](#development-builds): the loader faults under `@loomcli/core/plugin-loader-failed`, a resolver that throws under `@loomcli/core/foreign-throw`, and the answer faults under `@loomcli/core/source-answers`. Their sentences are `Loading plugin "@acme/config" failed: <reason>` when `load` throws or rejects, with `the module exports no default source function.` as the reason when the module exports none; `Plugin "@acme/config" failed in its configuration source: <reason>.` when the resolver throws or rejects with anything that is not a `LoomError`; `Plugin "@acme/config" returned configuration answers that are not a record.`; `Plugin "@acme/config" answered option "port", which core did not request.`; and `Plugin "@acme/config" answered option "limit" with a value that is not a string.`, where the type follows the option, `a Boolean`, `a whole number of 0 or more`, or `an array of strings`, and an answer that is not an object, or whose label is not one line that holds a character other than whitespace, reads `answered option "limit" with an answer that is not { value, label }.` in place of the value clause.

### Input sources acceptance

Input sources are proven when public APIs alone produce these results under Node and Bun:

- **Precedence.** A fixture option bound to a variable and to a configuration key reads argv over the environment, the environment over the configuration source, and the configuration source over the default, and an empty variable falls through.
- **Supplied.** A required option filled from the environment passes, a `validateOmitted` validator receives the filled string, `supplied` holds it, and the action receives the same value it would for the flag.
- **Booleans.** `true`, `1`, `FALSE`, and `0` fill a Boolean option under each polarity, `yes` fails with the grammar diagnostic, and `NO_COLOR` keeps its presence rule.
- **Counts.** `0`, `3`, and `007` fill a counted option with `0`, `3`, and `7`, `-1`, `1.5`, and `three` fail with the count diagnostic, one occurrence beats the variable, and a configuration answer of `2` fills `2`.
- **Implied values.** A variable bound to a string option with an implied value fills the string it holds, and no source supplies the implied value.
- **Activation.** A plugin's option filled from the environment activates its middleware, and one filled with `false` activates it too.
- **Held faults.** A bad variable and a failing source both report nothing under `--help`, and each reports its diagnostic without it.
- **Loading.** A source is never loaded when no in-scope option is unfilled, configuration-bound, and free of an environment fault, so a Boolean variable outside the grammar keeps the source unloaded although its option is unfilled and configuration-bound. A source answers a multiple option with a list.
- **Declarations.** Each row of [Input source declaration errors](#input-source-declaration-errors) is rejected, and one variable bound on two sibling Commands is accepted.
- **Projections.** `inspect()` and the manifest report `env` on bound and unbound options.
- **Diagnostics.** A rejected filled value prints `Option "--limit" (from TEXTSTAT_LIMIT): ...`, a configuration answer prints its label, and an argv message is unchanged.
- **Scope.** With a structural fault held, a global option is still filled and activates, a local option is not, and the structural fault is reported ahead of a source fault.
- **Faults.** Each invocation-time source fault prints its sentence with code 1.
- **Cancellation.** An abort during the source call awaits it and dispatches nothing.
- **Own options.** The source's own options are never in requests.
- **Ordinary channels.** A source's `out.warn` renders through an override of `lanes.warn`, a source reads `graph.name`, and an `InputError` a source throws prints each line of its message after the application name and a colon with code 2, reports nothing under `--help`, and runs no validation after it. The failure classes a source throws with other codes are proven under [Declared exit codes acceptance](#declared-exit-codes-acceptance).

## Standard Schema validation

Value options and arguments, scalar and variadic alike, accept a `validate` property containing a [Standard Schema v1](https://standardschema.dev/) object. Core calls the standard interface directly. A compatible library needs no adapter or plugin. Boolean options and counted options do not accept `validate`, `default`, `required`, or `validateOmitted`: a Boolean option's polarity controls its absent value, and a counted option reads `0` when nothing supplies it. A string option's [implied value](#implied-values) passes through its validator as a typed value does.

```ts
import { Application } from '@loomcli/core';
import { z } from 'zod';

const app = new Application('sizes')
  .option('minimum', {
    type: 'string',
    validate: z
      .string()
      .regex(/^[0-9]+$/)
      .transform(Number),
    default: '0',
  })
  .action(({ options, out }) => {
    const minimum: number = options.minimum;
    return out.print(String(minimum));
  });

await app.run();
```

`type`, and `implied` on a string option, control token consumption. The validator receives the supplied string and determines the action's output type. Core awaits synchronous or asynchronous validation before dispatch. Without a validator, supplied values remain strings.

A scalar argument's validator receives its one token. A variadic argument's validator, and a multiple option's, receive one value at a time under [ADR-0036](decisions/0036-each-value-passes-the-same-validator.md), and the action receives the array of their outputs. A rule over the whole list belongs to the action. Passthrough never enters this pipeline. The [validators reference](validators.md) describes `@loomcli/validators`, the catalog of validators for common input shapes.

`ActionHandler<typeof app>` retains these output types for extracted handlers. `ArgumentConfig`, `StringOption`, and `OptionConfig` support configuration declarations with `satisfies`. A broad type annotation can erase validator details; `satisfies` preserves inference.

### Validation context

Core calls every validator through the Standard Schema options argument, under the `libraryOptions` key `validationContextKey`. `validationContext(options)` reads that channel and returns the `ValidationContext` core attached, or `undefined` when another caller ran the same validator. A schema library that ignores the argument, such as Zod, is unaffected: the extra argument changes nothing for a validator that does not read it.

```ts
import { validationContext } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

const upper: StandardSchemaV1<string, string> = {
  '~standard': {
    validate: (value: unknown, options?: StandardSchemaV1.Options) => {
      const name = validationContext(options)?.input.name ?? 'the value';
      return typeof value === 'string'
        ? { value: value.toUpperCase() }
        : { issues: [{ message: `Supply a string for ${name}.` }] };
    },
    vendor: 'example',
    version: 1,
  },
};
```

Core re-exports the `StandardSchemaV1` type, so a custom validator depends on `@loomcli/core` alone. The annotation is what fixes the validator's input and output types; an unannotated object literal widens `version: 1` to `number` and resolves the output to `unknown`. The accessor answers for the contexts core produced alone. A value core did not produce reads as `undefined`.

| Field         | `phase: 'default'`       | `phase: 'invocation'`                                      |
| ------------- | ------------------------ | ---------------------------------------------------------- |
| `host`        | The captured `Host`      | The captured `Host`, the object the action receives        |
| `input`       | `{ kind, name, global }` | The same identity for the declaration under validation     |
| `command`     | absent                   | The routed path of canonical names; `[]` for the root      |
| `passthrough` | absent                   | The tail after the first bare `--`                         |
| `supplied`    | absent                   | The raw tokens, or the raw values input sources filled, of every declared input, before any default |

A default and an [implied value](#implied-values) validate before any token is parsed, so their phase, `default`, reports the host and the declaration alone. A configuration source's own options validate before the source is called, so `supplied` holds no value the source fills, and `passthrough` is `[]` while a local fault is held. Every validator call of one invocation, the globals and the routed Command's own declarations alike, reports the same route, passthrough, and supplied inputs. The route, the passthrough tail, and every collected value are copies made for each call, so a validator that writes to them changes nothing that a later validator or the action reads. `host` is the captured object itself, shared with the action, as the table states.

`supplied` holds the tokens as the parser read them, and the raw values the [input sources](#input-sources) filled, before any validator runs and before any default applies; a bare spelling with an [implied value](#implied-values) reads as the raw implied string. Every declared name of the routed Command, and every global name, is a key.

| Declared input and invocation                  | `supplied` value               |
| ---------------------------------------------- | ------------------------------ |
| Scalar argument or single option, supplied     | The one string                 |
| Variadic argument or multiple option, supplied | Every token, in supplied order |
| Scalar argument or single option, omitted      | `undefined`                    |
| Variadic argument or multiple option, omitted  | `[]`                           |
| Boolean option, supplied                       | The value of its spelling      |
| Boolean option, omitted                        | `undefined`                    |
| Counted option, supplied                       | The number of occurrences      |
| Counted option, omitted                        | `undefined`                    |
| String option with an implied value, bare      | The raw implied string, in its place in a multiple option's list |
| Option an input source filled                  | The raw value it filled        |

An omitted Boolean or counted option reads as `undefined` here, because the polarity value and `0` are absent values, not supplied tokens. A count an input source filled reads as the number it filled, so `SuppliedInputs.options`, the exported type of `supplied.options`, admits a `number` for a counted option. A bare spelling of a string option with an implied value reads as the raw implied string, before its validator, as a Boolean's entry holds the value of its spelling, because the operator supplied the option. Absence rules do not change: an omitted optional value with no default never reaches its validator, and no context is produced for it, unless its declaration asks for that call with `validateOmitted: true`.

### Absence and defaults

| Declaration and input                           | Action value or failure                           |
| ----------------------------------------------- | ------------------------------------------------- |
| Optional value or argument omitted, no default  | `undefined`; validator is not called               |
| Optional value omitted, `validateOmitted: true` | The validated output of `undefined`               |
| Optional multiple option omitted, no default    | `[]`; validator is not called                     |
| Optional variadic argument omitted, no default  | `[]`; validator is not called                     |
| Optional value omitted, declared default        | The validated default output                      |
| Supplied value, including an empty string       | Its validated output or input issues              |
| Bare spelling of an option with an implied value | The implied value's validated output, judged before any token is read |
| Counted option, no occurrence and no source     | `0`; nothing validates                            |
| `required: true` value option omitted           | Input error; no dispatch                          |
| Required input with a declared default          | Developer declaration error                       |
| Invalid declared default                        | Developer declaration error, even when overridden |
| Invalid implied value                           | Developer declaration error, even with no bare spelling |

For an option, omitted means that no token and no [input source](#input-sources) supplied it. A value the environment or the configuration source filled is a supplied value in every row above.

A declared default reaches its validator as the frozen snapshot the declaring call took, the value `inspect()` publishes under `default`, never as the author's object. A validator that writes to its input in place therefore fails on a default: in strict-mode code, which every ES module is, the write throws, and the run reports that throw as the validator's failure. An array default reaches the action as its own mutable copy on every invocation.

A scalar rule about omission, such as "a file or piped stdin", cannot live in a validator by itself, because an omitted optional value never reaches one. `validateOmitted: true` is how that rule reads omission: core calls the validator with `undefined` as the value, in the invocation phase, with the full [validation context](#validation-context). A returned issue is an input issue like any other and returns code 2. No token was supplied, so it names the declaration by the spelling an operator would type: an option under its long form, as in `Option "--file": Supply a file or pipe JSON to stdin.`, a `shortOnly` option under its short spelling, and an argument under its name. The action value is the validator output alone, because the validator always runs.

```ts
import { Command, validationContext } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

/** The rule answers omission too, so the schema's input type accepts `undefined`. */
const fileOrStdin: StandardSchemaV1<string | undefined, string | undefined> = {
  '~standard': {
    validate: (value: unknown, options?: StandardSchemaV1.Options) => {
      if (typeof value === 'string') {
        return { value };
      }
      const context = validationContext(options);
      return context?.phase === 'invocation' && !context.host.terminal.stdin.isTTY
        ? { value: undefined }
        : { issues: [{ message: 'Supply a file or pipe JSON to stdin.' }] };
    },
    vendor: 'jsonkit',
    version: 1,
  },
};

const get = new Command('get').option('file', {
  short: 'f',
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
});
```

The flag belongs to an optional scalar string option or scalar argument that declares a validator and no default. Every other declaration already decides its own absence, so the flag beside `required: true`, beside a `default`, beside `multiple: true` or `variadic: true`, on a Boolean or counted option, or without `validate` is a compile error at the declaration call and a declaration error thrown from it. The validator's input type must accept `undefined`, the way a declared default must satisfy that same input type. A global option declares the flag under no condition, because its omission is plain absence under [Commands and global options](#commands-and-global-options). The flag is Boolean, the way `required` and `variadic` are: any other declared value, an explicit `undefined` included, is the declaration error `Command "get" option "file" declares validateOmitted that is not a Boolean. Use true or false.`

Defaults use the validator's input type, not its output type. In the example, `default: '0'` is valid and `default: 0` is a type error. Without a validator, a value default must be a string.

Omission does not invoke validator-internal defaults. An explicitly declared `default: undefined` does enter the validator when its input type accepts `undefined`. Successful validator outputs retain their type, including `undefined`; core does not replace them or validate them a second time.

Every `run()` builds the graph, then validates all declared defaults and [implied values](#implied-values) before parsing invocation tokens. It awaits asynchronous ones and reuses their transformed outputs for that invocation. Invalid defaults and implied values report the affected declaration, the validator explanation, and a correction with exit code 1. Their results are not cached across invocations.

Authoring captures configuration properties. Replacing a property on the original configuration object does not alter the declaration. An array default is copied at authoring, and the copy, not the declared array, reaches each invocation, so a later change to the declared array, and an action that mutates the array it receives, reach neither the declaration nor the next invocation. The copy is shallow over the frozen snapshot the declaration holds: a nested array or plain object stays frozen, so an action that writes to one fails and the declaration is unchanged. A validator replaces the default with the value it returns, and an array it returns is copied for that invocation the same way. Validator objects, and default objects that are neither arrays nor plain objects, are retained by reference; core does not clone library objects or enforce validator purity.

### Issues and validator failures

Returned validator issues prevent dispatch and produce exit code 2. Core collects them across supplied inputs in authoring order, preserving each validator's own issue order. Async completion timing does not change diagnostic order. Each message identifies the argument or option and includes the validator explanation and any issue path. A message about a value an input source filled also names that source, under the diagnostics rule of [Input sources](#input-sources). An empty issues array still denotes failure.

Core keeps an issue's own fields. Where it reads an issue a validator returned, and where it rebuilds one to prefix a value's position on a multiple option or a variadic argument, it keeps every own enumerable field the issue carries and rewrites only `path`: each segment becomes its key, and the value's position goes in front. A validator that returns `{ message: 'Too short.', code: 'too_short' }` for the second value of a variadic argument therefore reaches the failure as `{ message: 'Too short.', code: 'too_short', path: [1] }`. Core reads nothing but `message` and `path`, so another field means nothing to core and reaches a failure view unchanged. `InputProblem.issues` still types each issue as `StandardSchemaV1.Issue`, so a view that reads another field checks it at run time; a validator package's [issue codes](validators.md#issue-codes) are read that way, through a typed descriptor. [ADR-0046](decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) records the rule.

CLI structure errors, such as unknown options or repeated single-value options, occur before validation. They retain their existing diagnostics.

A validator that throws, rejects its promise, or returns a malformed result produces a developer error with exit code 1: a `DeclarationError` under the rule `@loomcli/core/validator-failed`, whose sentence names the affected input and the thrown reason, `Option "token" validator failed unexpectedly: <reason>.`, whose finding marks `validate` on the call that declared the input, and whose correction asks the author to fix the validator. The thrown value is its `cause`. It is a fault only the author can fix, so a distributed build shows the generic defect message and a development build its Developer Diagnostic, under [Development builds](#development-builds). Validation stops immediately and the action does not run. This failure is distinct from returned operator-input issues. Like every fault validation produces, it is held under [Invocation](#invocation) and raised at the dispatch boundary, so an invocation a middleware takes over, `--help` included, reports neither the issues nor the developer error.

### Input schema

A validated input carries the JSON Schema its validator publishes as a core fact, `schema` on every `ArgumentNode` and `OptionNode` under [Graph inspection](#graph-inspection). Build derives it through the [Standard JSON Schema](https://standardschema.dev/json-schema) channel, the converter `@standard-schema/spec` defines beside `validate`, and stores the plain result. The fact reaches every projection with no plugin installed, and it changes nothing at run time: validation is unchanged, and no rule reads the stored schema.

```ts
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@loomcli/core';

interface ArgumentNode {
  // ...the fields under Graph inspection...
  readonly schema: Readonly<Record<string, unknown>> | null;
}
// The field is on every `OptionNode` variant, the Boolean and counted ones included.

// The converter core calls, as the standard declares it beside `validate`. A schema library
// implements it once; a hand-written schema implements it with this type or omits it.
type Converter = StandardJSONSchemaV1['~standard']['jsonSchema'];
// `validate` takes a Standard Schema; one that also implements the converter publishes a shape.
type Validator = StandardSchemaV1 | (StandardSchemaV1 & StandardJSONSchemaV1);
```

```ts
// Zod illustrates a library's converter here; textstat itself declares oneOf() from the validator catalog.
const app = new Application('textstat')
  .option('metric', {
    type: 'string',
    default: 'bytes',
    validate: z.enum(['bytes', 'words', 'lines'], { error: 'Use bytes, words, or lines.' }),
  })
  .action(count);

const [metric] = app.inspect().root.options;
metric.schema;
// { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string', enum: ['bytes', 'words', 'lines'] }
```

- Build asks every validated argument and option whose `validate` value implements `StandardJSONSchemaV1` for its input-side schema: one call of `'~standard'.jsonSchema.input({ target: 'draft-2020-12' })`, with no `libraryOptions`. Under this contract `@loomcli/core` re-exports the `StandardJSONSchemaV1` type beside `StandardSchemaV1`, so a hand-written validator can declare the converter with the standard's own type.
- The stored value is the converter's return value, snapshotted the way a declared default is, but with no depth limit and with any cycle kept: arrays and plain objects copied and frozen at every depth, a value that holds itself copied with the same cycle, any other value kept as it is, so a write through the graph fails and the library's own object is never frozen. Core reads nothing inside it and adds, removes, and renames nothing: the `$schema` key the library writes, a `description` or `default` the author set on the schema, and any vendor keyword are the library's words. A projection that wants another form makes it from the fact and never asks core for one.
- The input side alone. The output side describes the value the action receives after the validator's transforms, which is the action's business. So `z.string().regex(/^[0-9]+$/).transform(Number)` publishes `{ type: 'string', pattern: '^[0-9]+$' }` beside `$schema`, and a projection describes what a caller supplies. Every token is a string, and the schema is the value the token must satisfy: `z.coerce.number().int().min(1)` publishes `type: 'integer'` with its bounds. A projection states that rule once and never per input.
- A variadic argument's and a multiple option's validator checks one value under [ADR-0036](decisions/0036-each-value-passes-the-same-validator.md), so their input schema is that validator's schema, unchanged, exactly as for a single option. The node's `multiple` or `variadic` flag says the input takes several values.
- On `schema`, `null` has one reading: the graph holds no published shape. An input without `validate`, a Boolean option, a counted option, a validator without `jsonSchema`, and a converter that fails all read `null`. It never means unconstrained. A projection that needs a shape where the fact is `null` derives it from the node: a Boolean option is exact, a counted option takes no value and reads a whole number of 0 or more, and a string option or an argument is open, one string, or the whole `string[]` under `multiple` or `variadic`. `validated` answers a different question and is unchanged, so `validated: true` beside `schema: null` is an ordinary state. The Boolean and counted variants carry the field, always `null` under this contract, so the node shape and every projection built on it hold unchanged if a later contract lets a Boolean option validate.
- A converter fails when it throws, returns anything but a plain object, or answers with an object whose keys throw when core copies them, such as a getter that throws. An answer that holds itself is no failure: the stored copy holds the same cycle. In a distributed build a failure reads `null` under `inspect()` and `run()` alike: the graph holds no published shape, validation is unchanged, and nothing else happens. An operator cannot correct an author's validator, so the diagnostic belongs to development: in a [development build](#development-builds) the failure is a `DeclarationError` at build under the rule `@loomcli/core/schema-converter-failed`, from `run()` and `inspect()`, whose finding marks the input's `validate`, whose sentence names the input, the target, and the converter's thrown reason, escaped, and whose `cause` is the thrown value. zod 4.5.4's converter does not throw on a transform's input side, so no validator in the examples meets it.
- The fact is computed in the projection step: one converter call per validated input, on every `inspect()` call and on every run that has a middleware chain, asks a [configuration source](#input-sources), or has an action that reads `graph` or `command`, since the graph a middleware, a source, or an action reads is the one `inspect()` returns, built once for the run on its first read. Two inputs that share one validator object each get their own call and their own copy. A run with no middleware that asks no configuration source and whose action reads neither member calls no converter, except in a development build, where build calls every validated input's converter so its check runs on every run. The converter is synchronous by the standard's contract, so `inspect()` stays synchronous, and the [validation context](#validation-context) is never passed to it.
- An option a plugin declares publishes what its validator publishes, a [global option](#global-options-from-plugins) under its `options` and a local option a lifecycle hook declares alike, and core never edits the fact, so an alias a validator accepts on its input side is published with the rest. The [formatter](#formatter)'s `--format` therefore carries the enum of the view names alone: its validator's declared shape is that enum, and the `ndjson` mapping is applied before it reaches the enum, so the alias stays out of the published fact, a change this contract requires of the formatter.

### Example coverage

[textstat](../examples/textstat/src/application.ts) declares `metric` with the catalog's `oneOf(['bytes', 'words', 'lines'])` and the default `'bytes'`. Its `min-bytes` validator is `integer({ min: 0 })` with default `'0'`. `--minimum` is an [alias](#option-aliases) of `--min-bytes`, the name the threshold had before, so it binds the same option and appears in no listing. `--timing` is a hidden Boolean; when set, the action writes one `elapsed: <n>ms` line to stderr after the rows. The action uses the inferred values directly. Under [Input schema](#input-schema), `inspect()` reports `metric` with `{ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string', enum: ['bytes', 'words', 'lines'] }` beside its default, `min-bytes` with `{ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'integer', minimum: 0 }`, `--timing` with `null`, `files` with `null`, because it declares no validator, and the `--format` option the formatter's hook declares with `enum: ['table', 'json', 'jsonl']`. `min-bytes` binds `TEXTSTAT_MIN_BYTES` and `--total` binds `TEXTSTAT_TOTAL` under [Input sources](#input-sources), so `TEXTSTAT_MIN_BYTES=4 textstat` filters as `--min-bytes 4` does, the flag wins over the variable, and a rejected value reads `Option "--min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.` A typed alias is the flag, so `TEXTSTAT_MIN_BYTES=5 textstat --minimum 1` applies 1. It keeps a row for each source at or above the byte threshold and totals only retained sources. A selection the threshold filters entirely still prints the header, and a `total` row of zero when the invocation asked for one.

`files` is an optional variadic argument with no validator. Its rule, a nonempty list or piped stdin, is over the whole list, so under [ADR-0036](decisions/0036-each-value-passes-the-same-validator.md) it lives in the action: an empty list when `host.terminal.stdin.isTTY` is true throws `new InputError('Argument "files": Supply file arguments or pipe text to stdin.', [{ input: { kind: 'argument', name: 'files', global: false }, spelling: 'files', reason: 'invalid', issues: [{ message: 'Supply file arguments or pipe text to stdin.' }] }])`, so stderr reads `textstat: Argument "files": Supply file arguments or pipe text to stdin.`, with code 2. Otherwise the action counts each supplied file, or `host.stdin` when no file is supplied, and prints the row name `stdin` for the piped text. Every source is counted incrementally over its chunks, so a word or a multibyte character that a chunk boundary splits is counted once.

[jsonkit](../examples/jsonkit/src/application.ts) holds the same rule for one scalar. Its `--file` is a global option, which declares no presence rule, so the rule lives in the shared document reader that every document Command calls, the way textstat's lives in its action: with no file, when `host.terminal.stdin.isTTY` is true, the reader throws `new InputError('Option "--file": Supply a file or pipe JSON to stdin.', [{ input: { kind: 'option', name: 'file', global: true }, spelling: '--file', reason: 'invalid', issues: [{ message: 'Supply a file or pipe JSON to stdin.' }] }])` with code 2. A Command that reads no document, such as the `doctor` Command the private `@loom/doctor` plugin attaches, never meets the rule and runs at a terminal. The application overrides the `InputError` view, so the operator reads `jsonkit: --file: Supply a file or pipe JSON to stdin.` where core's default text would read `jsonkit: Option "--file": Supply a file or pipe JSON to stdin.` Otherwise the reader selects between the file and `host.stdin`. `inspect()` reports `--file` with `validated: false` and `schema: null`, since it declares no validator, `--verbose` as a `count` node with `schema: null`, and `select`'s `--field`, whose validator is the catalog's `text()`, with `{ type: 'string', minLength: 1 }` beside the `$schema` key.

## Graph inspection

`inspect()` returns the declared graph as plain data. It answers in every authoring state, as `run()` and `name` do, and it is synchronous. It applies every build rule `run()` applies before it reads a token, in the same order, except two: it does not pass a declared default or an implied value through its validator, because that call can be asynchronous, and in a [development build](#development-builds) it runs no [undescribed declarations](#undescribed-declarations) check, because that check fails a run and `inspect()` starts none. A fault an authoring call, a constructor, or an attach can detect, such as a Boolean option with `validate`, `required: true` beside a default, or a non-Boolean `required`, `variadic`, or `validateOmitted`, has already thrown from that call, under [Declaration faults](#declaration-faults), so `inspect()` never meets it. A rejected build throws the exported `DeclarationError`, which a consumer catches by class. `run()` reports the same message as a diagnostic with exit code 1, and it alone reports a default or an implied value its validator rejects, and, in a development build, an undescribed declaration. In a development build a validator whose converter fails is a build fault from `inspect()` and `run()` alike under `@loomcli/core/schema-converter-failed`; a distributed build reads its schema as `null` under both, as [Input schema](#input-schema) states. `inspect()` reads no host facts, and it caches nothing: each call builds the graph anew.

```ts
import { DeclarationError } from '@loomcli/core';

try {
  const graph = app.inspect();
  process.stdout.write(`${graph.root.children.length} commands\n`);
} catch (error) {
  if (error instanceof DeclarationError) {
    process.stderr.write(`${error.message}\n`);
  }
}
```

```ts
interface CommandGraph {
  readonly name: string;
  readonly version: string;
  readonly description: string | undefined;
  readonly globals: readonly OptionNode[];
  readonly root: CommandNode;
}
interface CommandNode {
  readonly name: string | null;
  readonly aliases: readonly string[];
  readonly path: readonly string[];
  readonly description: string | undefined;
  readonly hidden: boolean;
  readonly deprecated: string | undefined;
  readonly hasAction: boolean;
  readonly result: ResultNode | null;
  readonly arguments: readonly ArgumentNode[];
  readonly options: readonly OptionNode[];
  readonly children: readonly CommandNode[];
  readonly extensions: Readonly<Record<string, unknown>>;
}
interface ResultNode {
  readonly kind: 'value' | 'rows';
  readonly views: readonly string[];
  readonly default: string;
  readonly mediaTypes: Readonly<Record<string, string | null>>; // new: each view's media type, by view name
}
interface ArgumentNode {
  readonly name: string;
  readonly description: string | undefined;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly validated: boolean;
  readonly validateOmitted: boolean;
  readonly schema: Readonly<Record<string, unknown>> | null;
  readonly default: { readonly value: unknown } | undefined;
  readonly extensions: Readonly<Record<string, unknown>>;
}
type OptionNode =
  | {
      readonly type: 'string';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean; // new: see Control options
      readonly long: string | null;
      readonly short: string | null;
      readonly aliases: readonly string[];
      readonly required: boolean;
      readonly multiple: boolean;
      readonly validated: boolean;
      readonly validateOmitted: boolean;
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: string | null;
      readonly default: { readonly value: unknown } | undefined;
      readonly implied: string | null;
      readonly extensions: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean; // new: see Control options
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly aliases: readonly string[];
      readonly polarity: 'positive' | 'negative' | 'both';
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: string | null;
      readonly extensions: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'count';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean; // new: see Control options
      readonly long: string | null;
      readonly short: string | null;
      readonly aliases: readonly string[];
      readonly schema: null;
      readonly env: string | null;
      readonly extensions: Readonly<Record<string, unknown>>;
    };
```

- `name` is `null` for the root, and `path` is the route from the root: `[]` for the root and `['cache', 'clear']` for a nested leaf. Children and declarations appear in authoring order.
- `aliases` holds the Command's [aliases](#aliases) in declaration order, and `[]` for the root and for a Command that declares none. A Command appears once, under its canonical name, so `path` never holds an alias. Help, the manifest, and [completion](#completion) omit them, because an alias is unadvertised; routing and [`locate`](#locating-a-word) resolve them.
- `hidden` and `deprecated` are the core facts [Hidden and deprecated members](#hidden-and-deprecated-members) describes: `hidden` is `false` unless the declaration says `true`, and `deprecated` is the declared message or `undefined`. The root reads `hidden: false` and `deprecated: undefined`. A listing projection omits a hidden node and marks a deprecated one; the candidate list of a routing error omits both, as completion does; routing selects and parsing binds without reading either.
- The globals appear once on the graph and never inside a `CommandNode`. A help or manifest consumer combines the two sets for display.
- Spellings are the accepted CLI forms, read from the table the parser reads. `long` is `'--dry-run'` for the declared name `dry-run` and `null` under `shortOnly`, `short` is `'-f'`, and `negative` is `'--no-total'` for `both` and `negative` polarity alone, and each reports the spelling the declared name derives, never an alias's. `aliases` holds the option's declared [aliases](#option-aliases) as bare names in declaration order, such as `['minimum']`, and `[]` when it declares none. Help, the manifest, and completion omit them, because an alias is unadvertised; parsing and `locate` resolve them. `env` is the variable the option's [environment binding](#input-sources) names, or `null` when it declares none, whoever declared the option.
- `control` is the fact [Control options](#control-options) describes: `true` when the declaration marks the option as controlling the invocation, and `false` otherwise. Routing, parsing, and validation read it nowhere.
- `type` is the option's kind. A string option's `implied` is the [implied value](#implied-values) a bare spelling supplies, or `null` when it declares none. A [counted option](#counted-options) has no negative spelling, no polarity, no default, and no validator, so its node carries none of those fields, and its `schema` is always `null`.
- Validator objects stay private. `validated` says whether a validator exists, `validateOmitted` says whether the declaration sends its omission to that validator, and `schema` is the plain [input schema](#input-schema) that validator publishes through its converter, or `null` where the graph holds no published shape. `default` wraps the declared input value, so an explicit `default: undefined` reads apart from no default at all. The wrapped value is the snapshot the declaring call took: arrays and plain objects are copied and frozen, and no path through them holds more than 10 of them or leads back into one it passed, so a write through the graph fails and a later call reports the declared value again. Other objects are reported as they are. It is the one value every reader sees: a run passes that same frozen copy to the default's validator, and an array default still reaches the action as its own mutable copy.
- `version` is the string the Application declares, or `0.0.0` when it declares none, so it is never `undefined`. Every `description` is the core fact the declaration carries, or `undefined` when omitted. The root `CommandNode` reports the Application's description, the value `CommandGraph.description` holds, so a projection that walks nodes never special-cases the root. The graph names no plugin as the source of anything: which plugin contributed an option is provenance, and a projection describes the built product alone. An extension key carries its defining plugin's identity because that identity is the fact's name, the way a package name is part of an import, not a record of who installed what.
- `globals` holds every global option in one list: the application's declarations, then each plugin's in installation order. Nothing in an entry tells an application's global option from a plugin's, because the two are one kind under [ADR-0055](decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md), and the graph names no plugin as the source of anything. Every string entry reads `required: false` and `validateOmitted: false`, because a global option declares no presence rule, so a projection does not branch on them.
- `result` is `null` on a Command that declares none, and otherwise the kind, the view names in record order, the default, and the media type each view declares, keyed by view name, under [Results](#results) and [Media types](#media-types). The names include every view a plugin's `onCommandAttach` hook added, and an option such a hook declared appears under the node's `options` like any local option, because the graph names no plugin as the source of anything.
- `extensions` holds each [extension value](#extensions) the declaration carries, keyed by extension identity, as the frozen plain-data output of its schema. A [collecting extension](#collecting-extensions) holds the frozen array of its values' outputs in collection order, and a declaration that carries none of its values has no key for it. `readExtension(node, descriptor)` is the typed read; the record is the projection-neutral form.
- The result is frozen, and its types are read-only, so a consumer reads it without copying it.

```ts
const graph = app.inspect();
const names = graph.root.children.map((child) => child.path.join(' '));
```

### Locating a word

```ts
declare function locate(graph: CommandGraph, words: readonly string[]): WordPosition;

type WordPosition =
  | { readonly kind: 'command'; readonly command: CommandNode; readonly prefix: string }
  | {
      readonly kind: 'option';
      readonly command: CommandNode;
      readonly prefix: string;
      readonly supplied: readonly string[];
    }
  | {
      readonly kind: 'value';
      readonly command: CommandNode;
      readonly option: OptionNode;
      readonly lead: string;
      readonly prefix: string;
    }
  | { readonly kind: 'argument'; readonly command: CommandNode; readonly argument: ArgumentNode; readonly prefix: string }
  | { readonly kind: 'passthrough'; readonly command: CommandNode; readonly prefix: string }
  | { readonly kind: 'none' };
```

```ts
import { locate } from '@loomcli/core';

const graph = jsonkit.inspect();
locate(graph, ['g']); // { kind: 'command', command: <root>, prefix: 'g' }
locate(graph, ['ls', '--']); // { kind: 'option', command: <keys>, prefix: '--', supplied: [] }
locate(graph, ['paths', '--format=j']); // { kind: 'value', option: <format>, lead: '--format=', prefix: 'j', ... }
```

`locate(graph, words)` reads an unfinished invocation against a graph and reports where its last word sits. [ADR-0042](decisions/0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md) records the decision. `words` holds the tokens after the application name, and the last one is the word being completed, which may be empty; an empty list reads as one empty word.

- **One grammar.** Core's parser and `locate` read tokens through one implementation of the grammar under [Local options](#local-options) and [Global consumption and routing](#global-consumption-and-routing): routing through canonical names and [aliases](#aliases) while it reads the global options and the own options of a Command with an action and children, those own options binding to the Command routing reaches, routing stopping at an option word none of those options declares, the routed Command's one table, every [option alias](#option-aliases) included, option words and plain words, values after `=`, in the next word, or attached to a short value letter, short groups under the `getopt` rule, Boolean and counted options taking no value, a counted option's occurrences never repeating it, a string option's [implied value](#implied-values) never taking the next word, variadic arguments, and passthrough. A change to the grammar changes both.
- **Structure alone.** The words before the last are read with the grammar's structural rules alone. No validator, input source, or middleware runs, and no requirement is checked, because the line is unfinished. A structural fault among them, such as an unknown command, an unknown or misplaced option, a repeated option that is neither multiple nor counted, a missing value, a value after a Boolean or counted option, or an unexpected argument, gives `{ kind: 'none' }`. A string option at the end of the earlier words that is still waiting for its value is not a missing value, because the last word is its value. A string option with an implied value never waits for one, so a bare spelling of it at the end of the earlier words has supplied its implied value. Routing to a group is not a fault here either, because a middleware may take such an invocation over: the group is the routed Command. When the earlier words end at a Command with children, the last word may still continue routing, whatever it holds, so routing has not ended and a parent's own option among the earlier words binds to no Command yet, unless it already faulted: the last word reads by the rules below at the Command reached, so `--format json cache ''` reads as `command` for the children of `cache`, and `--format json cache --h` as `option` there.
- **The last word.** It is read as the parser would read the next token:
  - after a bare `--` among the earlier words, `passthrough`;
  - when the word before the last ends with a string option that takes its value from the next token, as a spelling alone or as the last letter of a short group, `value` for that option with `lead: ''`, unless the last word is an option word or the bare `--`, which the grammar never consumes as a separate value, giving `none`; a string option with an implied value never takes the next token, so after a bare `--backup` the last word reads by the rules below;
  - a word that starts with `--` and holds `=`, when the part before the first `=` is a long spelling of a string option in scope, an [alias](#option-aliases)'s included, `value` for that option, with `lead` holding that part and the `=` and `prefix` holding the rest, so `--backup=` and `--backup=n` read as `value` for an option with an implied value too; a Boolean, counted, or unknown spelling before the `=` gives `none`;
  - a short group whose walk reaches a value letter with characters after it, `value` for that option, with `lead` holding the group through that letter and one `=` if one follows, and `prefix` holding the rest, a letter whose option declares an implied value included; a group the walk cannot read gives `none`;
  - a last word whose `=` value or short group repeats an option that is neither multiple nor counted, supplied by an earlier word or an earlier letter of the same group, `none`, because the parser holds that repeat; a long spelling with no `=` may still grow into another spelling, so it reads as the next rule says;
  - any other option word, and `-` and `--`, which may still become one, `option`;
  - any other word, `command` while routing has not ended and the current Command has children, `argument` for the next positional the routed Command accepts, a variadic argument accepting every later one, and `none` when neither applies.
- **The members.** `command` is the routed `CommandNode`, reached through a canonical name or an alias alike; for `command`, it is the node whose children the word would name. `prefix` is the part of the word being completed, the whole word except under `value` after an `=` or a short value letter. The options in scope are the graph's `globals` and the routed Command's `options`. `supplied` lists, in supplied order, the name of each option in scope that an earlier word supplied. A parent's own option that routing still holds unbound lists under the name the routed Command's own entry gives its spelling, and lists nothing when that Command does not hold the spelling, so a root's own `-p` lists as `plain` when the routed Command declares `-p` as `plain`. Every node is the graph's own, so a reader compares by identity.
- **Pure.** `locate` is synchronous, reads no host fact, and, given a graph `inspect()` returned, throws nothing for any array of strings. Any other graph, such as a spread copy or a `structuredClone` of one, throws an `InternalError`, because `locate` reads the parser's tables through that graph's identity. It reads neither `hidden` nor `deprecated`, because routing selects and parsing binds without reading either; the reader decides what to offer.

## Invocation

`run(options?)` returns `Promise<ExitCode>` and sets the same `process.exitCode`. It resolves execution failures through the output path. `invoke(path, values, options?)` runs one Command by name instead, captures what the run writes, and resolves a structured outcome, under [Invocation by name](#invocation-by-name).

| Code          | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| 0             | Successful execution and core output                               |
| 1             | Expected action failure, internal failure, or invalid declarations |
| 2             | Invalid invocation inputs                                          |
| 3 through 125 | An application failure whose class declares that code              |
| 130           | Cancelled by `SIGINT` or by a caller-supplied abort                |
| 143           | Cancelled by `SIGTERM`                                             |

Codes 3 through 125 belong to the application: core raises none of them, and a failure exits with one only when its class declares it under [Declared exit codes](#declared-exit-codes). An application's class may also declare 1 or 2. Core resolves no other code.

Each invocation follows this order:

1. Capture host facts and apply overrides. A working directory that cannot be read fails the run here, under [An unreadable working directory](#an-unreadable-working-directory).
2. Build and validate the whole Command graph, including the global options, each Command's table, every installed plugin, every command name, alias, and spelling, then, in a [development build](#development-builds), every validated input's [schema converter](#input-schema) and then every [description](#undescribed-declarations), then every [`onGraphBuilt`](#judging-the-built-graph) hook over the frozen graph, and every declared default and implied value. Then install the process listeners the validated [signals owner](#signals-and-cancellation) claimed; a build failure installs none.
3. Copy invocation tokens for input processing.
4. Route from the root, reading option words against the global options and the own options of each Command with an action and children that routing passes through, under [Global consumption and routing](#global-consumption-and-routing). An unknown command is raised here, before the chain.
5. Parse the routed Command's remaining words against its table, up to the first bare `--`. Hold the first structural fault in word order, raising nothing yet, and keep reading so every global option is found. A routed Command that is a group holds the missing-subcommand error behind any structural fault.
6. Run the [input-source stage](#input-sources), which fills unfilled options from the environment and then the configuration source: the global options always, and the local options when nothing is held. Then validate the global options in authoring order, and, when no structural fault is held and the Command is not a group, that Command's inputs in authoring order. When a structural fault is held, validate instead each local option a plugin's hook declared whose tokens parsed, for that plugin's middleware's [`ownOptions`](#middleware) alone. Hold the first fault by the precedence below, a validator's own developer error included, so a takeover swallows a broken validator as it swallows an input fault.
7. Run the [middleware](#middleware) of each installed plugin whose activation matched, in installation order, loading each one as the chain reaches it. Each middleware reads the request. A middleware that takes over ends the invocation here, and a held fault is never raised. When the chain continues past its last middleware it reaches the dispatch boundary, where core raises the held fault, or reads the selected view and dispatches the action.
8. Await its action.
9. Unwind the middleware chain, finish pending core output, remove any process listeners, and set the exit status.

Error precedence follows these phases. An unknown command comes first and is raised before the chain. Then the first structural fault in word order, then a group's missing subcommand, then a validator issue. Unknown-command, misplaced-option, missing-value, repetition, and unexpected-argument diagnostics return code 2. Parsing, the input-source stage, and invocation validation run ahead of the chain so middleware can read the invocation. Core holds their faults until the dispatch boundary, and a takeover never observes them. A run cancelled before the chain starts, an abort landing inside a validator included, resolves its cancellation code under [Signals and cancellation](#signals-and-cancellation), and the held fault is never raised; core awaits the validator in flight and starts no further one. A run cancelled while the chain is running and before it reaches the dispatch boundary never reaches it: the `next()` that would have reached it resolves `'cancelled'`, the held fault and any bad `view` assignment stay unobserved, and the code is the signal's; a cancellation that lands after the action dispatched changes nothing here, and `next()` still resolves `'dispatched'`. The held fault is what the run would have raised before this contract: the input error carrying every issue collected in authoring order, or a validator's developer error, which stops validation where it happens and takes the place of anything collected before it, as [Issues and validator failures](#issues-and-validator-failures) states, or a configuration source's plugin fault or the failure it threw, which [Input sources](#input-sources) ranks. The consequence is that a validator runs on an invocation a middleware then takes over, `app get --help` included: this contract requires nothing of a validator it did not require before, so a validator that reads the host or awaits a network still does so on such an invocation, and one with a side effect performs it there. A takeover skips neither invocation validation nor its effects. A declared default or implied value validates before tokens are parsed. A validator rejection, throw, or malformed result there fails before middleware can take over.

An action receives `{ args, options, passthrough, graph, command, out, host, signal, style, invoke }`. Core attaches no input-source or token-spelling metadata to the action's input values. `graph` is the frozen graph [`inspect()`](#graph-inspection) returns, built for this run, and `command` is the routed node inside it: the same two values the run's [middleware](#middleware) receive, under [ADR-0041](decisions/0041-every-action-reads-the-frozen-graph-and-its-routed-command.md). An application's action and a plugin Command's action receive them alike, so a Command whose job is to project the graph, such as [completion](#completion), does it in its own action. The contextual `style` includes the installed theme's custom names. Its return value is ignored, including a resolved promise value. `run()` awaits action completion but does not render its return value. `signal` is the run's cancellation signal, which [Signals and cancellation](#signals-and-cancellation) describes; it never aborts unless a caller supplied a signal or an installed plugin owns the process signals. `invoke` runs another Command of the same graph by name, under [Invocation by name](#invocation-by-name).

The application can run again. Each call captures host facts and builds from its declarations. Core does not call `process.exit()`, consume stdin, or track unrelated background work. It installs process signal listeners only on behalf of an installed signals owner, for the duration of one run, and it re-raises a repeated signal so that the default disposition ends the process when no other listener remains.

### Validation lifecycle acceptance

The validation lifecycle is proven when public process fixtures establish these cases under Node and Bun, alongside the existing [plugin example coverage](#example-coverage-3):

- A supplied value passes its validator, which produces an observable effect. Middleware then takes over. The observed order is validation followed by takeover, and the action never runs.
- A required argument is omitted, so core holds an input fault. Middleware throws before calling `next()`. Only the middleware's failure determines the diagnostic and exit code, and the held input fault stays unraised.

### Invocation by name

```ts
import type { FailureExitCode, FailureForm, Host, LoomError } from '@loomcli/core';

interface InvocationValues {
  readonly args?: Readonly<Record<string, string | number | boolean | readonly (string | number)[] | undefined>>;
  readonly options?: Readonly<Record<string, string | number | boolean | readonly (string | number)[] | undefined>>;
  readonly passthrough?: readonly string[];
}
interface InvokeOptions<Mapped = LoomError> {
  readonly view?: string; // the starting view selection, as a middleware's `view` assignment
  readonly failure?: (
    failure: Readonly<LoomError>,
    context: {
      readonly application: string;
      readonly path: readonly string[];
      readonly exitCode: FailureExitCode;
      readonly form: FailureForm; // new: see The failure form
    },
  ) => Mapped;
  readonly signal?: AbortSignal; // composed with the parent run's signal
}
type InvocationOutcome<Mapped = LoomError> =
  | { readonly status: 'completed'; readonly output: string; readonly messages: string }
  | {
      readonly status: 'failed';
      readonly failure: Mapped;
      readonly form: FailureForm; // new: the failure form of the failure the handler received
      readonly exitCode: FailureExitCode;
      readonly output: string;
      readonly messages: string;
    }
  | { readonly status: 'cancelled'; readonly exitCode: 130 | 143 };

interface ActionContext<Args, Options = {}, Result = unknown> {
  // ...the members under Invocation...
  readonly invoke: <Mapped = LoomError>(
    path: readonly string[],
    values: InvocationValues,
    options?: InvokeOptions<Mapped>,
  ) => Promise<InvocationOutcome<Mapped>>; // new: bound to the graph this run built
}
declare class Application {
  // ...the members under Application declarations; published in every state, as run() is...
  invoke<Mapped = LoomError>(
    path: readonly string[],
    values: InvocationValues,
    options?: InvokeOptions<Mapped> & {
      readonly host?: Partial<Pick<Host, 'env' | 'cwd' | 'platform' | 'readSource'>>;
    },
  ): Promise<InvocationOutcome<Mapped>>; // new: builds the graph for each call
}
```

```ts
import { Command } from '@loomcli/core';

import { jsonkit } from './application.js';

// An embedding host runs `jsonkit keys user -f doc.json` with named values in place of argv.
const outcome = await jsonkit.invoke(['keys'], { args: { path: 'user' }, options: { file: 'doc.json' } });
if (outcome.status === 'completed') {
  process.stdout.write(outcome.output);
}

// An action runs another Command of its own graph by name and reads its JSON view.
export const report = new Command('report').action(async ({ invoke, out, style }) => {
  const members = await invoke([], { options: { file: 'doc.json' } }, { view: 'json' });
  if (members.status === 'failed') {
    out.fatal(style.escape(members.messages));
  }
  if (members.status === 'completed') {
    await out.print(`${String(JSON.parse(members.output).length)} top-level keys`);
  }
});
```

`invoke(path, values, options?)` runs one Command of an already-built graph by its path, with named values in place of argv, captures what the run writes instead of writing it, and resolves a structured outcome. An action reaches it as `invoke` on its context, bound to the graph its own run built. An embedding host reaches it as `app.invoke`, which builds the graph for each call as `run()` does. [ADR-0059](decisions/0059-a-command-runs-by-name-through-invoke.md) records the decision.

- **One run, spelled by name.** `invoke(path, values)` behaves as `run()` does on the argv that spells the same path and values: one table, routing and its held faults, the [input-source stage](#input-sources), declared defaults and implied values, every validator, the middleware chain and its takeovers, [translators](#translators), failure views, [declared exit codes](#declared-exit-codes), and the precedence [Invocation](#invocation) states. A divergence between the two on the same inputs is a defect. The rules below state the only differences: values arrive by name, problems report by name, the output is captured, and the run touches no process.
- **The path.** `path` names Commands from the root, `[]` for the root. Each element reads as a plain word reads during routing: a canonical name or an [alias](#aliases) descends, and a hidden Command routes. An element that no child holds is the `UnknownCommandError` routing raises before the chain, with the partial path. So is an element after a Command that has no children, which lists no candidates, because a path names Commands alone and an argument goes under `args`. A path that ends at a group holds the missing-subcommand error, as argv does.
- **The values.** `values` mirrors the action context: `args` is keyed by argument name, `options` by the declared name of the routed Command's local options and of every global option, a plugin's included, and `passthrough` is the tail after `--`, delivered unchanged. The two records are separate because an argument and an option may share a name. An option alias, a short spelling, and a negative spelling are spellings, never keys. A key whose value is `undefined` reads as an absent key.
- **Lowering.** Each value lowers to the tokens argv would give, once, at the point the parser produces its result, and never by building argv text. So `SuppliedInputs`, every validator, and the [input schema](#input-schema) meet exactly what they meet on a command line.

  | Value                                   | Input                                    | Lowers to                                                                                         |
  | --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
  | A string                                | A string option or a scalar argument     | That token                                                                                        |
  | A finite number                         | A string option or a scalar argument     | The token `String(value)` gives, such as `5` or `0.5`                                             |
  | `true`                                  | A Boolean option                         | The spelling that reads `true`, or absence on a `negative` option, whose absent value is `true`   |
  | `false`                                 | A Boolean option                         | The negative spelling on a `both` or `negative` option, or absence on a `positive` option         |
  | `true`                                  | A string option with an implied value    | The bare spelling, which supplies the [implied value](#implied-values)                            |
  | A whole number of 0 or more             | A counted option                         | That many occurrences, so 0 is absence                                                            |
  | A string, a number, or an array of them | A multiple option or a variadic argument | One occurrence per element in order; a single value is one occurrence, and an empty array is none |

  A value no row covers is unlowerable: `null`, an object, a nested array, an array on a scalar input, a Boolean on an argument, on a counted option, or on a string option without an implied value, `false` on a string option with one, a number that is not finite, a number on a Boolean option, and a number on a counted option that is not a whole number of 0 or more. An unlowerable value supplies nothing, so an input source may still fill the option. It is an `invalid` problem of the run's `InputError`, in authoring order with the validation phase, with exit 2, and its one issue says what the input takes: `Use a string or a number.`, `Use a string, a number, or a list of them.` on a multiple option or a variadic argument, `Use true or false.` on a Boolean option, `Use a string, a number, or true.` on a string option with an implied value, `Use a string, a number, true, or a list of strings and numbers.` on a multiple option with an implied value, and `Use a whole number of 0 or more.` on a counted option. Three cases follow from the equivalence. `false` on a `positive` option is absence, so an environment binding or the configuration file may still fill it, as it fills an option a command line omits. An empty array on a required multiple option is the missing-input problem. A number on a string option with no validator reaches the action as the string `String(value)`.
- **Unknown names.** A key of `options` that the routed Command's table does not hold is an `UnknownOptionError`, and a key of `args` the routed Command does not declare is an `UnexpectedArgumentError` whose `extra` holds the name and whose `accepted` holds the number of arguments the Command declares. Each is a structural fault, held as argv's are, and the first held is the first in the order `options` keys and then `args` keys, each record in its own key order. It ranks after an unknown command and ahead of a group's missing subcommand and the validation phase, and a middleware takes it over as it takes over any held fault.
- **Reported by name.** An invocation by name types no spelling, so every problem core reports names an input by its declared name, the key the caller wrote, in place of the [reported spelling](#failure-classes) and of the spelling a parser fault names. `InputProblem.spelling` and `UnknownOptionError.spelling` hold that name. The sentences read `Option "file": Use a string or a number.`, `Option "depth" is required. Supply a value.`, `Option "min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.`, `Unknown option "verbos". Supply the name of a declared option.`, and `Command "get" declares no argument "pth". Supply the name of a declared argument.` An argument already reports under its name. A [configuration source](#input-sources) reads `invokedBy` on its context and names a problem's option the same way.
- **Capture.** The run's stdout and stderr are capture sinks. `output` holds every byte the run wrote to stdout, decoded as UTF-8: the rendered result on a Command that declares one, and `out.print` and `out.render` text on one that does not. `messages` holds every byte the run wrote to stderr: the semantic lanes, the action's `print` and `render` on a result Command, a failure's diagnostic and its hints, and the [incomplete-result](#a-sequence-that-stops-early) line. Stdin is an empty stream, `host.argv` is `[]`, and every terminal fact reads not a TTY, with no width or height. The captured text is plain: core resolves it as for a destination that supports no color, modifier, or hyperlink, whatever the rendering policy or `FORCE_COLOR` says, and `terminalControls` keeps the Application's setting.
- **The view.** `view` is the starting selection: the name a middleware's `view` reads before any assignment, in place of the declaration's default. A later assignment still wins, and the [formatter](#formatter) assigns only when `--format` was supplied. A name the routed Command's result does not hold, a value that is not a string, and a `view` on a Command that declares no result are the view-selection defect at the dispatch boundary, exit 1, under `@loomcli/core/view-selection`, with `invoke()` named in the plugin's place: `invoke() selected view "yaml", which Command "count" does not name.`, `invoke() selected a view that is not a string on Command "count".`, and `invoke() selected view "json" on Command "get", which declares no result.` A takeover or a cancellation leaves it unobserved, as it leaves a middleware's.
- **The outcome.** `completed` is a run that would resolve 0, a takeover included. `failed` is a run that would resolve a failure code: `exitCode` is that code, `output` and `messages` hold everything the run wrote, the failure's report included, and `failure` holds what the caller's handler returned, or the failure itself when the caller passed no handler, and `form` holds that failure's [failure form](#the-failure-form). `cancelled` is a cancelled run, and `exitCode` is the code of the cause that aborted it; its captured text is discarded. `invoke` never rejects, except with a throw from the caller's handler. `Mapped` is inferred from the handler, and without one it is `LoomError`.
- **The failure path.** A failure takes `run()`'s path. A foreign throw is offered to the translators, each `onFailure` hook adds its [hints](#failure-hints), and the failure's view renders, by build, into `messages`: a defect in a [distributed build](#development-builds) writes the generic defect message there, and a broken failure view or hook reports through the plain fallback path there and forces 1. Then core calls the caller's `failure` handler once, for the primary failure, or, when the primary outcome succeeded and a fault reported after it set the code, such as a plugin's `next()` fault, for the first such fault, with the failure as the run caught it, the translated failure and never the raw throw, and a context that holds `application`, `path`, the outcome's `exitCode`, and the failure's [failure form](#the-failure-form). The handler adds structure and never replaces the text: `messages` holds the same report `run()` writes to stderr when no [failure encoder](#failure-encoders) answers. It receives no style, because the form's hints are plain text, and no graph, which a failure raised at build lacks, under [ADR-0046](decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md). It receives the failure in both builds, its `cause` included, so what it exposes is the caller's decision. A handler that throws makes `invoke` reject with that throw, and the run's captured text is discarded. A cancellation never reaches it.
- **No encoded line.** The [failure-encoding stage](#failure-encoders) runs under `run()` alone. Under `invoke`, a failure's view renders into `messages` whatever media type the selected view declares, so `invoke(['paths'], …, { view: 'json' })` captures the failure's text, and the caller reads the form from the outcome and from its handler's context.
- **Spellings.** A value lowered by name is recorded in a middleware's [`spellings`](#middleware) under the option's reported spelling, its long form, else its negative or short form, so [help](#help-variants) renders the extended page for `help: true`, as it does for `--help`.
- **Where the run was.** A run `invoke` started reads `invokedBy: 'name'` on the [failure view context](#failure-view-context) and the [failure hook context](#failure-hints), and every other run reads `'argv'`. A hint that points at a command line skips an invocation by name: [help's hint](#helps-failure-hint) and the example `--explain` hint return none for it, and the [suggestions](#suggestions) plugin offers declared names in place of spellings.
- **No process effects.** An invocation by name installs no process listener, even when an installed plugin holds the signals slot. It sets no `process.exitCode`, writes to no real stdout or stderr, reads no real stdin, and calls no `process.exit()`. An action's `invoke` reads nothing from the process: the call's `env`, `cwd`, `platform`, and `readSource` are its run's host fields. `app.invoke` captures those four from the process at entry, as `run()` does, unless `host` replaces a whole field, and it accepts no other host field and neither `argv` nor `rendering`. A working directory that capture cannot read resolves `failed`, under [An unreadable working directory](#an-unreadable-working-directory).
- **The graph.** An action's `invoke` reuses the graph its run built and validated, and that run's declared-value checks: no lifecycle hook runs again, and each declared default and implied value is the run's validated output, an array default copied for the call. `app.invoke` builds the graph for each call, as `run()` does, so every `onCommandAttach` and [`onGraphBuilt`](#judging-the-built-graph) hook runs and every declared default and implied value validates, and a build fault is a `failed` outcome with exit 1. Both render by the Application's [packet](#development-builds).
- **Cancellation.** Each call has its own run signal. An action's `invoke` derives it from its run's signal and the call's `signal`, and the first to abort fixes the reason. A parent's abort carries the parent's reason, so the call reads `cancelled` with 130 or 143 as the parent's cause does, and an abort of the call's own `signal` reads 130 as a caller abort. `app.invoke` derives it from the call's `signal` alone. A signal already aborted at the call resolves `cancelled` having run no middleware and no action. Inside the call, the rules of [Signals and cancellation](#signals-and-cancellation) hold.
- **Concurrency.** Calls may overlap, from one action or from many. Each is its own run and shares nothing mutable with another, and Loom adds no queue, limit, or timer. An application whose actions cannot overlap serializes the calls itself.
- **Nesting.** An invoked action may call `invoke` itself, under these rules, and its call's signal derives from its own run.
- **Not interactive.** An invocation by name has an empty stdin and no terminal, so a prompt reads it as non-interactive.
- **Actions alone.** A middleware's context carries no `invoke`. A Command that serves other Commands by name does so in its own action, as the [MCP](#mcp) plugin's `mcp` Command does.
- **The call's shape.** The types reject a malformed call, and a JavaScript caller meets one rule before the graph is built. The rule covers a `path` that is not an array of strings, `values` that are not a plain object or that hold a key other than `args`, `options`, and `passthrough`, an `args` or `options` that is not a plain object, a `passthrough` that is not an array of strings, a `signal` that is not an `AbortSignal`, a `failure` that is not a function, and a `host` that holds a field other than the four. Each is a defect under `@loomcli/core/invoke-options`, whose sentence names the slot, such as `invoke() received a signal that is not an AbortSignal.` or `invoke() received a path that is not an array of Command names.`, and whose correction says what the slot takes, such as `Supply the signal of an AbortController.` or `Supply the path as an array of Command names, [] for the root.` It renders by build into `messages`, and the outcome is `failed` with exit 1.
- **Names.** `InvocationValues`, `InvokeOptions`, and `InvocationOutcome` are exported from `@loomcli/core`, and `ActionContext` gains `invoke`.

#### Invocation by name acceptance

Invocation by name is proven when public APIs alone produce these results under Node and Bun:

- **The equivalence wedge.** For each jsonkit invocation below, `run()` with argv and a sink host, and `invoke` with the same path and values, write identical stdout and stderr bytes and resolve the same exit code: `get name -f doc.json`, `keys -f doc.json`, `select --field a --field b -f doc.json`, `paths --format json -f doc.json` against `invoke(['paths'], …, { view: 'json' })`, `get missing -f doc.json` with exit 65, `get name -f broken.json` with exit 65, and `select --field '' -f doc.json` with exit 2. The bytes differ only where a problem names an input: by its reported spelling under `run()` and by its declared name under `invoke`. Help's hint and the explain hint print under `run()` alone.
- **Lowering.** A fixture pins every row of the table and each unlowerable value's issue. `false` on a positive option is absence, and a bound variable still fills it. An empty array on a required multiple option is the missing-input problem. A number on an unvalidated string option reaches the action as its `String` text. `true` on a string option with an implied value supplies it, and `3` on a counted option reads `3`. `null`, an object, `NaN`, `1.5` on a counted option, and `true` on an argument each report their sentence with exit 2.
- **Names.** An unknown option name, an unknown argument name, and an unknown path element report their by-name sentences with exit 2. `jsonkit.invoke(['nope'], {})` lists the root's children, a path through an alias routes, and `invoke(['get'], { options: { help: true } })` completes with help's extended page for `get` as `output`.
- **Capture.** A fixture action that writes every lane and a result proves the split between `output` and `messages`, reads `host.terminal` as not a TTY and `host.argv` as `[]`, and writes no ANSI under `FORCE_COLOR=1` and under `rendering: { color: 'always' }`. `jsonkit.invoke(['get'], { args: { path: 'name' } })` reads the empty stdin and fails with exit 65.
- **Failures.** A handler maps a failure into `failed.failure` and receives the translated failure, never the foreign throw. With no handler `failed.failure` is the failure. `failed.form` and the handler's `form` are one failure form, as [The failure form](#the-failure-form) builds it. A defect writes the generic defect message into `messages` in a distributed build and its Developer Diagnostic in a development one, while the handler receives the `InternalError`. A broken failure view resolves `failed` with exit 1, and a handler that throws makes `invoke` reject with the same value.
- **The view.** `view: 'json'` renders the JSON view, and a middleware's later assignment wins over it. An unknown name, a non-string, and a view on a Command with no result each report their `invoke()` sentence with exit 1.
- **Process isolation.** A parent run with a sentinel host whose streams record every write calls `invoke` from its action, with a signals owner installed. The process's listener counts, `process.exitCode`, and real stdout and stderr are unchanged, and the parent's own streams receive nothing from the call. `app.invoke` with a `host` override reads only the four fields.
- **Cancellation.** A parent run cancelled by `SIGTERM` resolves a call in flight as `cancelled` with 143, and the call's own abort resolves 130. A pre-aborted signal runs no action, and a cancelled call never reaches the handler.
- **Concurrency and nesting.** Two overlapping calls from one action capture their own bytes with no interleaving, and an invoked action that calls `invoke` resolves its inner outcome.
- **The graph.** A fixture hook counts its calls: an action's `invoke` runs no hook again, and each `app.invoke` runs every `onCommandAttach` and `onGraphBuilt` once.
- **Call shape.** Each malformed slot reports `@loomcli/core/invoke-options` with exit 1.
- **Types.** The outcome narrows on `status`, and `Mapped` is inferred from the handler. The negative type checks reject a value outside the value union and a `host` field outside the four. Editor latency on `ActionHandler` is measured against the baseline on `main` before the increment merges, because the action context gains a member.

## Host

`run({ host: partialHost })` overrides selected host fields. Omitted fields use process capture at invocation entry, before graph build. `run({ signal })` supplies a caller-owned `AbortSignal` that cancels the run, as [Signals and cancellation](#signals-and-cancellation) describes; it is the path for an embedding host or a test, and it composes with an installed signals owner. A `signal` slot holding a value that is not an `AbortSignal` is a defect reported before the graph is built, under `@loomcli/core/run-options`, whose sentence is `run() received a signal that is not an AbortSignal.` and whose correction is `Supply the signal of an AbortController.`, rendered by build under [Development builds](#development-builds), and the run returns 1.

| Field              | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| `argv`             | Application tokens without the runtime and script prefix      |
| `platform`         | Captured process platform string, such as `linux` or `win32` |
| `cwd`              | Working directory; a capture that throws fails the run, under [An unreadable working directory](#an-unreadable-working-directory) |
| `env`              | Map of environment names to strings or `undefined`            |
| `stdin`            | Node `Readable` connection                                    |
| `stdout`, `stderr` | Node `Writable` connections                                   |
| `terminal`         | Each stream's `isTTY` value, plus output `columns` and `rows` |
| `readSource`       | Optional `(path, cwd) => string \| undefined`, one source file for a [Developer Diagnostic](#developer-diagnostics) |

An override replaces its whole field. An environment override replaces the captured map. Terminal facts remain independent of stream overrides. Automatic capture maps missing or zero output dimensions to `undefined`. Supplied terminal overrides retain their values.

The environment snapshot is a plain, case-sensitive map on every operating system, including Windows. Keys retain their original spelling; `Path` and `PATH` are distinct lookups. It does not retain the Windows `process.env` object's case-insensitive lookup.

Core copies argv, environment values, and terminal facts. It retains the supplied stream connections. Parsing does not modify `host.argv`. Application code owns file access and any stdin reads. The one file core reads is a source file for a defect's findings in a development build, through `readSource`, under the guards [Developer Diagnostics](#developer-diagnostics) states. Process capture supplies `readSource(path, cwd)` as a synchronous read of a UTF-8 file that resolves both paths through symbolic links and answers `undefined` for a file outside `cwd`, for a path that is not a regular file, such as a FIFO or a device, for a file larger than 1 MiB, and for any failure. An override replaces it like any other field, so a test supplies its own reader, and a reader that always answers `undefined` leaves the findings at the stack location.

The public declarations include Node stream types. The package supplies their type dependency and an explicit declaration reference. Core exports the `Host` and `Out` types, so a helper extracted out of an action, such as a reader that opens a file or `host.stdin`, states its own parameters without reading them back off the action context.

### An unreadable working directory

```ts
class WorkingDirectoryError extends LoomError {
  static override readonly code: string; // 'working-directory-unreadable'; the exit code is LoomError's 1
  constructor(options?: ErrorOptions); // the message is fixed
}
```

```ts
import { WorkingDirectoryError } from '@loomcli/core';

import { jsonkit } from './application.js';

// The host process sits in a directory another process removed, such as a deleted git worktree.
// run() writes `jsonkit: The current working directory cannot be read. Change to a directory that
// exists and run the command again.` to stderr and resolves 1; invoke() resolves failed.
const outcome = await jsonkit.invoke(['keys'], { options: { file: '/srv/doc.json' } });
if (outcome.status === 'failed' && outcome.failure instanceof WorkingDirectoryError) {
  // outcome.form.code is 'working-directory-unreadable', and outcome.exitCode is 1.
}
```

A process whose working directory was removed cannot read it, and the platform's `process.cwd()` throws. Core captures the working directory for every run, so the run fails cleanly under one rule, as git does, and neither door rejects with the platform's error.

- **Captured once.** `run()` and `app.invoke` capture `cwd` through one shared step, once per run. When the read throws, the run fails with `WorkingDirectoryError` before the graph builds. A `host.cwd` override replaces the capture, so it never meets the failure, and an action's `invoke` reads its run's `cwd` and captures nothing.
- **The failure.** `WorkingDirectoryError` exits 1, and its [failure code](#failure-codes) is `working-directory-unreadable`. Its `message` is `The current working directory cannot be read. Change to a directory that exists and run the command again.`, and core's default text opens it with the application name, as it opens a usage error's line. It is an operator failure, not a defect, so both builds print the same bytes. Its `cause` is the value the capture threw.
- **Where it reports.** It is raised before the graph builds, so its `path` is `[]`, no `onFailure` hook runs, and no view override applies, because overrides register at build: core's default text writes it. The [failure view context](#failure-view-context) reads `view` and `mediaType` as `undefined`, so no [failure encoder](#failure-encoders) answers it.
- **No second capture.** The failure path writes through the streams and terminal facts the same capture read, or their overrides, and reads no host field from the process again. `run()` resolves 1 and sets `process.exitCode` to 1. `app.invoke` resolves `failed` with exit 1, the failure, its [failure form](#the-failure-form), and the line in `messages`.
- **Names.** `WorkingDirectoryError` is exported from `@loomcli/core`.

#### An unreadable working directory acceptance

An unreadable working directory is proven when public APIs alone produce these results under Node and Bun:

- **Both builds.** A process test removes its working directory and runs jsonkit's bundle and jsonkit's source with `keys -f <absolute path>`. Each writes exactly `jsonkit: The current working directory cannot be read. Change to a directory that exists and run the command again.` and one newline to stderr, writes nothing to stdout, prints no stack, and exits 1. The same run with `--format json` on `paths` writes the same text line.
- **Embedding.** `jsonkit.invoke(['keys'], …)` from a removed directory resolves `failed` with exit 1, a `WorkingDirectoryError`, the form `{ code: 'working-directory-unreadable', exitCode: 1, message, hints: [] }`, and the line in `messages`, and never rejects.
- **Overrides.** `run({ host: { cwd } })` and `app.invoke` with `host: { cwd }` from a removed directory complete, and an action's `invoke` in such a run completes with its run's `cwd`.
- **The class.** `WorkingDirectoryError.code` reads `working-directory-unreadable` and `WorkingDirectoryError.exitCode` reads 1 without an instance.

## Output and failures

| Method                       | Default destination | Return          |
| ---------------------------- | ------------------- | --------------- |
| `out.print(message)`         | stdout              | `Promise<void>` |
| `out.info(message)`          | stderr              | `Promise<void>` |
| `out.success(message)`       | stderr              | `Promise<void>` |
| `out.warn(message)`          | stderr              | `Promise<void>` |
| `out.error(message)`         | stderr              | `Promise<void>` |
| `out.render(data, view)`     | stdout              | `Promise<void>` |
| `out.results(value)`         | stdout              | `Promise<void>` |
| `out.fatal(message)`         | Failure path        | `never`         |

The `results` row holds on a Command that declares a result, where the action's `print` and `render` move to stderr as [Results](#results) describes; on every other Command `results` takes a `never` argument and the other rows hold as written. Messages are marked strings. The five semantic methods render through core's lane views, described under [Views](#views), and append one newline. `print` has no prefix. By default the other methods add their matching glyph and one space, and indent continuation lines by the selected glyph width plus one, without repeating the glyph; that gutter belongs to the lane view, which an application can override. Semantic method identity remains distinct inside core. `out.render` is the neutral render call, and [Rendered output](#rendered-output) describes it.

Nonfatal labels do not change success. Calls can omit `await`; core still accounts for their output and failures before completion. Awaiting a call observes its write completion or rejection. Catching that rejection does not make the invocation successful.

Writes preserve call order within a destination. Separate stdout and stderr captures have no shared observable order. Core does not close host streams.

`out.fatal()` synchronously throws the exported `FatalError` without an eager write. An uncaught `FatalError` prints its message once and returns its class's code: 1, unless a subclass declares another under [Declared exit codes](#declared-exit-codes). A caught fatal error does not itself change success. Other exceptions use an internal-error diagnostic.

A broken output pipe returns code 1 through the failure path below.

### Rendered output

```ts
interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  row?: undefined; // a view has one shape; the row view of Results is the other
  mediaType?: string; // the media type of the text it writes, under Media types
}
```

A view is a pure synchronous value that turns one typed value into marked text. Its `render` function, the view function, receives the data and an immutable context with `style` and `width(text)`, which a failure view's context extends with where the run was and the plugins' hints, under [Failure view context](#failure-view-context). It holds no output handle. Existing one-argument view functions remain valid. Escape raw data with `style.escape()` before interpolating it into authored text. `out.render` is the neutral render call: a rendered value has no purpose and no destination parameter.

Newline ownership belongs to the write site, not to the view type. `out.render` and a failure diagnostic append nothing, so a view rendered through either owns its trailing newline. A semantic method appends one newline after its lane view, so a lane view returns none. Each write site below states which rule it follows.

`out.render(data, view)` resolves the view's marked text for its destination, stdout, or stderr from the action of a Command that declares a [result](#results), then writes it without adding a newline. The second argument is either a bare view, as below, or a [declared view](#views) that a plugin or core exported. A bare view is a view the action chose at the call site, and nothing can replace it. A declared view carries an identity, so an application can replace its function through `views` without touching the call site. `out.render` also accepts an iterable with a row view, the shape [Row views](#row-views) defines, and writes the sequence as the iterable yields it.

```ts
import { Application } from '@loomcli/core';
import type { View } from '@loomcli/core';

interface Row {
  count: number;
  source: string;
}

const table: View<readonly Row[]> = {
  render: (rows, { style }) => rows.map((row) => `${String(row.count)}  ${style.escape(row.source)}\n`).join(''),
};

const app = new Application('counts')
  .argument('files', { required: true, variadic: true })
  .action(({ args, out }) => {
    const rows: readonly Row[] = args.files.map((source) => ({ count: source.length, source }));
    return out.render(rows, table);
  });
```

A rendered value has no semantic identity: no purpose parameter and no destination parameter. The five semantic methods keep their string-only signatures and their own destinations.

Core calls a whole view's function synchronously inside the `out.render` call, then queues its text on the destination; a row view's functions run as the iterable yields, under [Row views](#row-views). Call order within a destination holds across both forms, so a rendered table and a plain `print` write in the order the action issued them. The optional-await contract is unchanged: the returned promise resolves on write completion and rejects on a view or write failure, and catching that rejection changes the caller's control flow, not the invocation result.

The type parameter is inferred from the value, so `out.render(rows, table)` checks the view against the rows it receives. A view for another value type, and one that returns anything but a string, are compile errors.

### Views

Every byte core or a plugin renders passes through one registry of views, except the line a [failure encoder](#failure-encoders) writes for a failed run in place of the failure's view. A failure diagnostic, a semantic lane message, a help page, and a version line each render through a declared view, and an application replaces the function behind any of them through the `views` option. The registry has one override surface and one resolution, so branding a plugin's page and branding a failure class are the same call.

```ts
interface DeclaredViewBrand {
  readonly [declaredView]: true; // declaredView is an unexported unique symbol, as on ExtensionValue
}
interface DeclaredView<Data> extends View<Data>, DeclaredViewBrand {
  readonly identity: string;
  readonly [invariant]: (data: Data) => Data; // a private phantom witness that makes Data invariant
}
interface DeclaredRowView<Row> extends RowView<Row>, DeclaredViewBrand {
  readonly identity: string;
  readonly [invariant]: (row: Row) => Row;
}
type AnyDeclaredView = (View<never> | RowView<never>) & DeclaredViewBrand & { readonly identity: string }; // the brand without the witness, either shape
type FailureClass<Failure extends LoomError> = abstract new (...args: never[]) => Failure;
function view<Data>(identity: string, definition: View<Data>): DeclaredView<Data>;
function view<Row>(identity: string, definition: RowView<Row>): DeclaredRowView<Row>; // both row-view shapes are defined in Results
type AnyOverrideKey = AnyDeclaredView | FailureClass<LoomError>;
type ReplacementView<Key> = [Key] extends [DeclaredView<infer Data>]
  ? View<Data>
  : [Key] extends [DeclaredRowView<infer Row>]
    ? RowView<Row>
    : [Key] extends [FailureClass<infer Failure>]
      ? FailureView<Failure> // FailureView is defined in Failure views
      : never;
function override<Key extends AnyOverrideKey>(key: Key, replacement: NoInfer<ReplacementView<Key>>): ViewOverride;
type ViewContribution = AnyDeclaredView | ViewOverride; // ViewOverride is opaque and branded
```

`view(identity, definition)` declares a view: an identity and its default function. The identity follows the [identity grammar](#identity-and-installation), and by convention it is the declaring plugin's identity with a suffix, so the help page is `@loomcli/plugins/help/page`; core's own views take `@loomcli/core/` as their prefix by the same convention, so the lanes are `@loomcli/core/lanes/<name>` and the incomplete-result line is `@loomcli/core/results/incomplete`. The data type is inferred from the function's first parameter when that parameter is an object type or a `readonly` array, and is stated for a primitive or a union, `view<string>(…)`, because inference runs through `Readonly<Data>`: a union parameter is either rejected or silently inferred as part of the union, so a union is always stated in full, and a view function's array parameter is always `readonly`, so a mutable array parameter is a compile error under any type argument. The value it returns satisfies `View<Data>`, so `out.render(page, helpPage)` type-checks the same way a bare view does, and the identity travels on the value. `DeclaredView` is invariant in `Data` through a private witness, so a declared view is never reassigned as a declared view of another data type, and a replacement that requires data the key does not carry is a compile error; a replacement that accepts wider data is valid, since it accepts the key's data, and a bare `View<Data>` keeps its ordinary assignability. The value is branded the way an extension value is, so a hand-built object with an `identity` field is a bare view to core: `out.render` renders it through its own function and consults no override.

The identity string reaches diagnostics and nothing else: an application never spells it, because a view is named by reference, exactly as an [extension descriptor](#extensions) is. `AnyDeclaredView` is the supertype a contribution list uses; it keeps `identity`, a view function of either shape over `never`, and the brand, and drops the invariance witness, because a list cannot carry one type parameter per element and an invariant type has no common supertype across data types. Every `DeclaredView<Data>` is assignable to it, and the shape rules on a `views` list stay type-rejected. `override` typing is compile-time alone. Core stores a replacement without a run-time witness for a declared-view key, so a JavaScript author's mismatched replacement surfaces through the output-view row of the [Failure contract](#failure-contract) when it throws.

A declared view is exported from a declarations module of the plugin that declares it, `<subpath>/views`, beside the `<subpath>/extension` module that holds its descriptors, so an application that overrides the help page imports `helpPage` from `@loomcli/plugins/help/views` and never the middleware. The two modules are separate because a declared view carries its default function and the modules it needs, while a descriptor module stays declarations alone, which is the promise a projection that imports another plugin's facts relies on. The default function loads with the entry module, which is the one cost this design accepts: a plugin's middleware module stays lazy under [Activation](#activation), and its default view functions are part of its entry cost. A view function is synchronous, so nothing inside it can wait for a lazy import; a plugin whose default function is heavy pays that cost at install, and help's page function is pure string building.

`override(key, replacement)` pairs a key with a replacement view and returns a `ViewOverride`. The key is a declared view or a failure class, which `AnyOverrideKey` names. One signature serves every key: its type parameter is the key's type, and `ReplacementView<Key>` derives the replacement's type from it, so a key that is neither is rejected at the key and a mismatched replacement is reported as its own type against the one the key expects, such as `View<number>` against `View<readonly Row[]>`, rather than as a failure of every key kind. Under a declared view the replacement is typed from the view's data, so a view that requires data the key does not carry is a compile error. The declared-view branches are tried first, so a declared view is never read as a failure class. Under a failure class, `FailureClass<Failure>` is an abstract constructor type, so `UsageError` and `LoomError` are valid keys and the replacement is a `FailureView` typed from the class's instances, as [Failure view context](#failure-view-context) describes. A helper generic over a declared view's data or a failure class's instances forwards its key and replacement to `override` unchanged, and one generic over the key itself types its replacement as `ReplacementView<Key>`. Under a declared view the replacement is any `View<Data>`; a declared view passed as the replacement contributes its function alone, and its own identity plays no part. An application lists its overrides under `views`; a plugin lists its declarations and its overrides together under its own `views`, as [Views from plugins](#views-from-plugins) describes. In this contract an application overrides and does not declare: `ApplicationOptions.views` is `readonly ViewOverride[]`, and an application declares no view under the results lane either, because a Command's result names bare views by view name, as [Results](#results) describes.

```ts
import { Application, InputError, override } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpPage } from '@loomcli/plugins/help/views';

import { brandedPage, inputProblems } from './views.js';

export const jsonkit = new Application('jsonkit', {
  plugins: [help()],
  views: [override(InputError, inputProblems), override(helpPage, brandedPage)],
});
```

Resolution is one walk over one list of contributors: the application's overrides first, then each installed plugin's overrides in installation order, then the default function of the view that was declared. A declared-view key matches by reference. A failure-class key matches the thrown failure's prototype chain, most derived first, and the chain is walked in full at each contributor before the next contributor is consulted, so an application's override for `UsageError` beats a plugin's override for `InputError`. This is a deliberate correction to the 0.2.0 resolver, which merged every contributor's registrations into one class-keyed table before walking the chain, so that a plugin's more specific class won over the application's base class; the application owns its diagnostics, and installation order breaks ties among plugins alone. The write site decides the destination and a view carries none: `out.render` writes stdout, or stderr from the action of a Command that declares a [result](#results), a lane writes its own destination, and a failure writes stderr directly, never through a lane. A result's own views are reached by view name and carry no identity, so this walk never touches them.

Core declares the five lane views and exports them as `lanes`, one `DeclaredView<string>` per semantic method, declared as `view<string>(…)`. Each receives the original message string, line breaks and authored styles included, under the rules in [Width, padding, and multiline lanes](#width-padding-and-multiline-lanes), with the view context of the write site that called it: stderr under `out.warn`, stdout under `out.print`, and stdout under `out.render` whichever lane view it was handed, or stderr under both from the action of a Command that declares a [result](#results), so capability detection and glyph selection follow the stream the bytes reach. The default for `lanes.print` returns its message unchanged. A lane view is an ordinary declared view, so `out.render(message, lanes.print)` is legal and writes the message with no newline; the semantic method is the write site that appends one. The other four add their matching glyph and one space and indent continuation lines by the measured gutter; that gutter is the default, not a rule outside the view, so an application that overrides `lanes.warn` owns it for every `out.warn` call in the run. The semantic method appends its one newline after the view, so a lane view returns none, and an override that returns the empty string still writes one newline. The semantic method checks its argument before calling the lane view, so a non-string message is still rejected as today.

```ts
import { Application, lanes, override } from '@loomcli/core';

const app = new Application('quiet', {
  views: [override(lanes.warn, { render: (message, { style }) => style.dim(message) })],
});
```

Every identity on the graph is compared the way an extension identity is: across every declared view core exports, every declared view a plugin lists, and every declared-view key an override carries, whether or not the view is declared by an installed plugin. Two distinct objects that share one identity are a `DeclarationError` from the Application constructor, which holds every contributor, so an application that imports `helpPage` from one copy of the package while the installed plugin declares it from a second copy is told to deduplicate rather than left with a silent miss, the rule a second copy of an extension descriptor already meets. An override whose identity matches no declaration is inert: it is not a declaration error, it applies the moment a view with that object is rendered, and it never applies otherwise. An application can therefore brand a help page ahead of installing the plugin, and a shared override list holds in an application that omits it. A failure class never meets either case, because every failure class descends from `LoomError`, core keys each class's default text function as that class's default view, which carries no identity, and an application's own subclass is answered by the chain walk at throw time.

Every view declared in this section renders one whole value in one call. A second structural shape, the row view of [Row views](#row-views), renders a sequence one row at a time through a `row` function, with optional `head` and `tail`, and `view()` declares either shape; the two are told apart by the function present, so no declaration in this section changes and no cardinality field exists. A definition that carries both functions, or neither, is a `DeclarationError` at the `view()` call rather than a guess: `View "probe/both" carries render and row. Supply one of the two.` and `View "probe/none" carries neither render nor row. Supply a view with render or a row view with row.`, both under `@loomcli/core/view-shape`, the rule a views entry of either shape breaks.

Three rules guard the registry, each a `DeclarationError` thrown from the call that holds the list, `plugin()` for a plugin's list and the Application constructor for the application's and for the installed set: two overrides for one key inside one contributor, two distinct declared-view objects that share one identity, and a `views` entry that is not an override on the Application, or neither a declared view nor an override on a plugin, which the types already reject and a JavaScript author alone reaches. [Command declaration errors](#command-declaration-errors) and [Plugin declaration errors](#plugin-declaration-errors) list the diagnostics. The registry is not an `inspect()` fact in this contract.

### Failure classes

Every failure `run()` reports is an instance of a public class. Each class carries the facts its sentence interpolates, so a view reads them instead of parsing prose. `message` is the sentence without its category prefix, except a `DeclarationError`'s, which holds its whole [Developer Diagnostic](#developer-diagnostics) while `sentence` holds the sentence. The exit code is a static field the class declares, so a subclass inherits it and a view reads it on the instance, as [Declared exit codes](#declared-exit-codes) describes. The failure code is a static field too, which a machine reader branches on, as [Failure codes](#failure-codes) describes.

```ts
abstract class LoomError extends Error {
  static readonly code: string; // 'failure'; see Failure codes
  static readonly exitCode: FailureExitCode; // 1
  readonly exitCode: FailureExitCode;
  constructor(message: string, options?: ErrorOptions); // ErrorOptions is the platform's { cause }
}
abstract class UsageError extends LoomError {
  static override readonly code: string; // 'usage'
  static override readonly exitCode: FailureExitCode; // 2: the invocation is wrong
}

type InputProblem =
  | { input: InputIdentity; spelling: string; reason: 'missing' }
  | {
      input: InputIdentity;
      spelling: string;
      reason: 'invalid';
      issues: readonly StandardSchemaV1.Issue[];
    };

function reportedSpelling(option: OptionNode): string; // '--file', '--no-quiet', or '-F'
```

| Class                     | Base         | Exit code | Facts                             |
| ------------------------- | ------------ | --------- | -------------------------------------- |
| `InputError`              | `UsageError` | 2    | `problems`                             |
| `UnknownCommandError`     | `UsageError` | 2    | `token`, `candidates`                  |
| `NonCallableCommandError` | `UsageError` | 2    | `command`, `candidates`                |
| `UnexpectedArgumentError` | `UsageError` | 2    | `command`, `accepted`, `extra`         |
| `UnknownOptionError`      | `UsageError` | 2    | `spelling`                             |
| `MissingValueError`       | `UsageError` | 2    | `spelling`                             |
| `UnexpectedValueError`    | `UsageError` | 2    | `spelling`, `value`                    |
| `RepeatedOptionError`     | `UsageError` | 2    | `spelling`                             |
| `MisplacedOptionError`    | `UsageError` | 2    | `spelling`, `commands`                 |
| `DeclarationError`        | `LoomError`  | 1    | `rule`, `sentence`, `findings`, `correction`; see [Developer Diagnostics](#developer-diagnostics) |
| `FatalError`              | `LoomError`  | 1    | the message `out.fatal()` received     |
| `WorkingDirectoryError`   | `LoomError`  | 1    | `cause`, the value capture threw; see [An unreadable working directory](#an-unreadable-working-directory) |
| `InternalError`           | `LoomError`  | 1    | `cause`, the thrown value core wrapped, and `rule`, `sentence`, `correction` |
| `ResultError`             | `InternalError` | 1 | `path`, `kind`, and an `undefined` `cause`; see [Results](#results) |

Core's default views open each failure with a prefix: the application name and a colon for every `UsageError`, as in `jsonkit: Unknown command "nope". Use one of: get, keys.`, so the operator reads who is speaking under rule 2 of [Failure messages](failure-messages.md#2-say-what-went-wrong-and-what-to-do-instead). The name opens every line of a `UsageError`'s message, so an `InputError` that reports two problems opens both of its lines with it, as in `jsonkit: Option "--limit": Use decimal digits.` above `jsonkit: Argument "path" requires a value. Supply a value for "path".`, and the hint lines an `onFailure` hook adds below them carry no prefix. The failure's `message` holds the lines without the name, so an override reads the problems alone. `FatalError` takes no prefix, and `WorkingDirectoryError` takes the application name, as a usage error's line does. `DeclarationError`, `InternalError`, and `ResultError` take none either, because an operator never reads their sentence: in a distributed build their default text is the generic defect message, `jsonkit: Something went wrong.`, and in a development build core renders their [Developer Diagnostic](#developer-diagnostics) without consulting a view, under [Development builds](#development-builds).

`InputError.problems` carries the whole validation phase in authoring order: each required input the invocation omitted, and each value a validator rejected with the issues that validator returned. `spelling` is the token an operator would type: `--file` for an option, `--no-quiet` for a negative-only Boolean option, `-F` for a `shortOnly` option, and the declared name for an argument. In an [invocation by name](#invocation-by-name) it is the declared name for an option too, the key the caller wrote. An omitted required argument is a `missing` problem like an omitted required option, so omission has one class whichever kind of input it names. An `invalid` problem always carries at least one issue: a validator that rejected a value and returned none reports `The validator rejected this value without an explanation. Supply a different value.`, the sentence core's own text uses. Error precedence is unchanged, because routing and token errors still precede validation. An action may also throw an `InputError` for a rule over a whole list of values under [ADR-0036](decisions/0036-each-value-passes-the-same-validator.md); it carries the problems the action names, and it reports with exit code 2 after the middleware chain rather than before it.

`issuePath(issue)` returns the dotted path an issue names inside a value, such as `1` for the second value of a multiple option, or `undefined` when the issue names the value itself, so a view positions an issue the way core's default text does.

`reportedSpelling(option)` returns the `spelling` a problem names an [`OptionNode`](#graph-inspection) by: its long form, else the negative form a negative-only Boolean option publishes, and otherwise its short form, which a `shortOnly` option alone publishes, so a negative `shortOnly` option reports `-k`, not `--no-keep`. An alias is never the reported spelling. Core's validation reads the same rule, so a plugin that builds an `InputProblem` for an option, such as a [configuration source](#input-sources), names it as core does. An [invocation by name](#invocation-by-name) types no spelling, so there every problem core reports, a parser fault's included, names the option by its declared name, and `reportedSpelling` itself is unchanged.

`candidates` on `UnknownCommandError` and `NonCallableCommandError` holds the canonical child names in authoring order. An alias never appears in it, and neither does a hidden or a deprecated Command, the rule [ADR-0043](decisions/0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) applies to completion; a deprecated Command typed in full still routes, and its migration message lives on the help page. With candidates, the sentence ends `Use one of: get, keys.` With none, it ends `Supply the name of a declared command.` for `UnknownCommandError` and `Supply the name of a declared subcommand.` for `NonCallableCommandError`, so the sentence keeps its fix under [Failure messages](failure-messages.md).

`MisplacedOptionError.spelling` is the spelling as supplied, a letter of a short group as `-p`, and `commands` holds the path from the root of each visible Command below the one routing reached that declares that spelling, in authoring order, such as `[['get']]` or `[['cache', 'clear']]`, or the routed Command's own path alone when it declares a parent's own option with another value class, as [Global consumption and routing](#global-consumption-and-routing) describes. With one Command the sentence reads `Option "-p" belongs to command "get". Supply it after "get".`, the path joined by single spaces, and with several `Option "-p" belongs to commands get, keys. Supply it after the command name.` It names only Commands a listing shows and repeats the spelling alone, so it repeats no value under [Failure messages](failure-messages.md). A short group raises no class of its own: an undeclared letter is an `UnknownOptionError`, `=` after a Boolean or counted letter an `UnexpectedValueError`, and a repeated letter of an option that is neither multiple nor counted a `RepeatedOptionError`.

In an invocation by name, `UnknownOptionError` names the key the caller wrote and its sentence reads `Unknown option "verbos". Supply the name of a declared option.`, and a key of `args` the routed Command does not declare is an `UnexpectedArgumentError` whose `extra` holds that name, with the sentence `Command "get" declares no argument "pth". Supply the name of a declared argument.`

`UnexpectedValueError` reports a value attached to a spelling that takes none. For a Boolean option its sentence reads `Boolean option "-t" does not accept a value. Supply the flag alone.`, and for a [counted option](#counted-options) `Counted option "-v" does not accept a value. Repeat "-v" to raise its count.`, each naming the spelling typed and repeating no value.

`InternalError` wraps an unexpected exception or a non-error throw that no [translator](#translators) answered. Its message is the thrown error's message, `An unknown error occurred.` for a thrown value that is not an Error, or `The thrown value has no readable message.` for an Error whose message is not a string or cannot be read; its `cause` is the thrown value itself. A validator that throws stays a `DeclarationError`, because only a returned issue states a validation verdict. An `InternalError` is a defect under [Failure messages](failure-messages.md#7-a-defect-shows-one-generic-message), which shows the operator one generic message with no reason, and so is a `DeclarationError` that `run()` reports.

`LoomError` and the failure classes an author constructs, `FatalError`, `InputError`, and `DeclarationError`, accept the platform's `ErrorOptions` as their last constructor parameter, and `InternalError` keeps `cause` as its second, so a failure keeps the error it replaces as `cause`, as a translator does with `new InvalidJsonError({ cause: error })`. Core reads `cause` for nothing but a defect's findings and sets it on no failure it did not construct.

`FatalError` is the class `out.fatal()` throws. An application can subclass it and override the view for the subclass, which is how one fatal type implies one diagnostic, and the subclass can declare its own exit code.

### Declared exit codes

```ts
type FailureExitCode = 1 | 2 | 3 /* … every whole number through */ | 125; // 1 through 125
type ExitCode = 0 | FailureExitCode | 130 | 143;

abstract class LoomError extends Error {
  static readonly exitCode: FailureExitCode; // 1
  get exitCode(): FailureExitCode; // the class's code, captured at its first construction
  constructor(message: string, options?: ErrorOptions);
}

// The sysexits.h names, each with its literal number type.
const EX_USAGE: 64; // the command was used incorrectly
const EX_DATAERR: 65; // the input data was incorrect
const EX_NOINPUT: 66; // an input file did not exist or could not be read
const EX_NOUSER: 67; // an addressee is unknown
const EX_NOHOST: 68; // a host name is unknown
const EX_UNAVAILABLE: 69; // a service is unavailable
const EX_SOFTWARE: 70; // an internal software error
const EX_OSERR: 71; // an operating system error
const EX_OSFILE: 72; // a system file is missing or malformed
const EX_CANTCREAT: 73; // an output file cannot be created
const EX_IOERR: 74; // an input or output error
const EX_TEMPFAIL: 75; // a temporary failure; a retry may succeed
const EX_PROTOCOL: 76; // a remote system broke the protocol
const EX_NOPERM: 77; // permission is insufficient
const EX_CONFIG: 78; // the configuration is wrong
```

```ts
import { Application, EX_UNAVAILABLE, FatalError, override } from '@loomcli/core';

export class RegistryUnavailableError extends FatalError {
  static override readonly exitCode = EX_UNAVAILABLE;
  readonly status: number;

  constructor(status: number) {
    super(`The registry answered ${String(status)}.`);
    this.name = 'RegistryUnavailableError';
    this.status = status;
  }
}

// A failed health check prints `deploy: the registry is unavailable (503); retry later.` and exits 69.
const app = new Application('deploy', {
  views: [
    override(RegistryUnavailableError, {
      render: (failure) => `deploy: the registry is unavailable (${String(failure.status)}); retry later.\n`,
    }),
  ],
}).action(async ({ signal }) => {
  const response = await fetch('https://registry.example/health', { signal });
  if (!response.ok) {
    throw new RegistryUnavailableError(response.status);
  }
});
```

A failure class states its exit code once, on the class, so a script branches on the code the way a view branches on the class. [ADR-0045](decisions/0045-a-failure-class-declares-its-exit-code.md) records the decision.

- **The declaration.** A class declares its code as `static override readonly exitCode`. Core reads the code from the thrown failure's class, walking to the nearest ancestor that declares one, so a subclass that declares none exits with its parent's code and every class reaches `LoomError`'s 1. `failure.exitCode` reports the same value, so a view reads it on the instance, and a projection reads `Class.exitCode` without constructing a failure. Nothing sets a code per throw, so one class never exits with two codes.
- **Captured once.** Core reads a class's code at the first construction of the class, or of a subclass that declares none, and keeps it. A static written later, or a static getter that answers differently on a later read, changes no failure of that class, and `failure.exitCode` keeps the captured code. A class whose code is not declarable captures nothing, so each construction throws. Core captures its own classes when `@loomcli/core` loads, so a write to `LoomError.exitCode` or any other core class's static changes no code core resolves. A static getter that throws makes the construction throw that error, which reports as an internal error with code 1.
- **Read-only on the instance.** The instance's `exitCode` is an accessor without a setter. A subclass cannot declare it as a property: TypeScript reports `'exitCode' is defined as an accessor in class 'FatalError', but is overridden here in 'ShadowError' as an instance property.` (TS2610), and a JavaScript class field that shadows it changes neither the code `run()` resolves nor the class's code, though a view that reads `failure.exitCode` reads the field. An assignment to it is rejected as a read-only property (TS2540); at run time it throws a `TypeError` in strict mode code, such as an ES module, which reports as an internal error with code 1, and sloppy mode code ignores it.
- **An unconstructed failure.** A value that inherits from a failure class without being constructed by one, such as `Object.create(FatalError.prototype)` or an object whose prototype was set to a failure class's, holds no code. `run()` reports it as `Internal error: A thrown value inherits from a failure class but was never constructed as one.` with code 1, from an action, a middleware, or a configuration source. `run()` therefore resolves only 0, a code from 1 through 125, 130, or 143, and never rejects for a code.
- **The range.** A class declares 1, 2, or a code from 3 through 125, the members of the exported `FailureExitCode`. 1 and 2 keep core's meanings, an application failure and invalid input. 0 and every code from 126 up are reserved: 0 is success, 126 and 127 belong to the shell, and 128 plus a signal number reports a signal, which covers 130 and 143.
- **Type checks.** `LoomError` types its static as `FailureExitCode`, so TypeScript rejects a literal outside the range and a plain `number` on the class line as a static side that incorrectly extends its base. A `readonly` static with a literal initializer takes that literal as its type, so a class whose own subclasses declare other codes annotates its declaration, `static override readonly exitCode: FailureExitCode = EX_DATAERR;`.
- **A reserved code.** `LoomError`'s constructor reads the class's code and, when it is not declarable, throws a `DeclarationError` under `@loomcli/core/failure-exit-code` in place of the failure: `Failure class "RegistryUnavailableError" declares exit code 130.`, with the correction `Declare a whole number from 1 through 125.` and an explanation that says 0 means success and 126 and above belong to the shell and to signals. The class is named by its constructor's `name`, `new.target.name`, escaped, because the subclass has not yet set the instance's `name`. A class declaration is no call, so the fault carries no finding. A value that is not a finite number reads `declares an exit code that is not a finite number.` in place of `declares exit code 130.`. Core never clamps or replaces a code. A failure constructed inside a run reports the fault with code 1, by build as [Development builds](#development-builds) states, and one constructed outside a run throws at that line.
- **The sysexits names.** `@loomcli/core` exports the fifteen constants above as flat names with literal types, the values of `sysexits.h`. `EX_OK` is not exported, because no failure declares 0. `EX_USAGE` serves an author's own usage failure: core raises invalid input as 2 and never 64, and no application setting changes that.
- **Core's classes.** `LoomError` declares 1 and `UsageError` declares 2, and every other core class inherits its code, so the table in [Failure classes](#failure-classes) holds. `LoomError`'s constructor takes the message and the platform's optional `ErrorOptions`, and no code.
- **Wherever it is raised.** The declared code holds for a failure an action throws, a failure a [middleware](#middleware) throws before its `next()` has settled, and a failure a [configuration source](#input-sources) throws or rejects with, and it holds for a failure a [translator](#translators) returns for a foreign throw from any of the three. A class that declares 2 without extending `UsageError` exits 2 but takes no application-name prefix, which core's default text adds for a `UsageError` alone, and no `UsageError` override reaches it.
- **What outranks it.** The ordering in [Signals and cancellation](#signals-and-cancellation) is unchanged: a cancelled run resolves its signal's code whatever failure its action raised, a broken failure view or destination forces 1, and a throw during unwinding is an internal error. A working view cannot change the code.

#### Declared exit codes acceptance

Declared exit codes are proven when public APIs alone produce these results under Node and Bun:

- **Declared.** A `FatalError` subclass that declares `EX_UNAVAILABLE`, thrown from an action, exits 69 and renders through its own override, whose view reads `failure.exitCode` as 69.
- **Inherited.** A subclass of that class that declares nothing exits 69, a `FatalError` subclass that declares nothing exits 1, and `LoomError.exitCode`, `UsageError.exitCode`, and `InputError.exitCode` read 1, 2, and 2 without an instance.
- **Reserved.** Classes that declare 0, 126, 130, 3.5, and the string `'69'` each throw a `DeclarationError` at construction with the diagnostic above, and an action that constructs one exits 1 with `Invalid declaration: Failure class "<name>" declares exit code <code>. ...` on stderr, or `declares an exit code that is not a finite number. ...` for `'69'`. The negative type checks reject 0, 126, and a plain `number` on the class line.
- **Middleware.** A middleware that throws the class before calling `next()` exits 69.
- **Configuration source.** A resolver that throws or rejects with the class exits 69 and reports nothing under `--help`; one that calls `out.fatal()` exits 1 with the message alone; a plain `Error` that no translator answers stays the plugin fault with code 1; and the class thrown from a getter on the answers record or from an answer's `value` getter stays the plugin fault with code 1.
- **Captured once.** A class whose static is reassigned between two constructions, whose static getter answers 69 and then 65, or whose static is set to 200 after the thrown instance was constructed exits 69, and both instances read 69. A static getter that throws reports its error as an internal error with code 1. A class that declares `NaN` or `Infinity` reads `declares an exit code that is not a finite number.`
- **Core's statics.** After every core failure class's static is set to 0, a `FatalError` and an undeclaring subclass of it exit 1, and an unknown command exits 2. After every one is set to 200, a class that declares 130 reports `Invalid declaration:` with code 1.
- **Tampering.** From an action, a middleware, and a configuration source: a strict-mode assignment of 200, 300, 0, `'69'`, or `'abc'` to `failure.exitCode` reports as an internal error with code 1; a sloppy-mode assignment is ignored and the failure exits 69; a subclass field that shadows `exitCode` with 65, 200, 0, or `'69'` exits with the class's code, 1; and `Object.create(FatalError.prototype)`, a plain object whose prototype is set to `FatalError.prototype`, and a foreign `Error` reprototyped the same way report the unconstructed-failure sentence with code 1. The negative type checks reject a subclass property override of `exitCode` (TS2610) and an assignment to it (TS2540).
- **Cancellation.** An action that throws the class after a caller abort resolves 130.
- **Broken view.** An override of the class that throws writes the class's default text and the internal-error line through the fallback path, and the run returns 1.
- **Exports.** The fifteen constants hold their `sysexits.h` values, `EX_OK` is absent, and `FailureExitCode` accepts 1 and 125 and rejects 0 and 126.
- **Example.** `jsonkit get missing -f doc.json` and `jsonkit keys missing -f doc.json` exit 65, as the [failure example coverage](#example-coverage-2) pins.

### Failure codes

```ts
abstract class LoomError extends Error {
  static readonly code: string; // 'failure'; a kebab-case code, captured at the class's first construction
  static readonly exitCode: FailureExitCode; // 1
  get exitCode(): FailureExitCode;
  constructor(message: string, options?: ErrorOptions);
}
class FatalError extends LoomError {
  static override readonly code: string; // 'fatal'; each core class annotates its code as string
}
```

```ts
import { EX_DATAERR, FatalError } from '@loomcli/core';

// `jsonkit get missing -f doc.json` exits 65, and a machine reader branches on `path-not-found`.
export class PathNotFoundError extends FatalError {
  static override readonly code = 'path-not-found';
  static override readonly exitCode = EX_DATAERR;
  readonly path: string;

  constructor(path: string) {
    super(`Path not found: "${path}". Run jsonkit keys to list the keys at the root.`);
    this.name = 'PathNotFoundError';
    this.path = path;
  }
}
```

A failure class states a failure code once, on the class, so a script or an agent tells one failure from another where many share an exit code. The code is read the way [Declared exit codes](#declared-exit-codes) reads the exit code. [ADR-0064](decisions/0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) records the decision.

| Class                     | Failure code                   |
| ------------------------- | ------------------------------ |
| `LoomError`               | `failure`                      |
| `UsageError`              | `usage`                        |
| `InputError`              | `invalid-input`                |
| `UnknownCommandError`     | `unknown-command`              |
| `NonCallableCommandError` | `missing-subcommand`           |
| `UnexpectedArgumentError` | `unexpected-argument`          |
| `UnknownOptionError`      | `unknown-option`               |
| `MissingValueError`       | `missing-value`                |
| `UnexpectedValueError`    | `unexpected-value`             |
| `RepeatedOptionError`     | `repeated-option`              |
| `MisplacedOptionError`    | `misplaced-option`             |
| `FatalError`              | `fatal`                        |
| `WorkingDirectoryError`   | `working-directory-unreadable` |
| `DeclarationError`        | `internal`                     |
| `InternalError`           | `internal`                     |
| `ResultError`             | `internal`, inherited          |

- **The declaration.** A class declares its code as `static override readonly code`. Core reads the code from the thrown failure's class, walking to the nearest ancestor that declares one, so an author class that declares none reads its parent's: a bare `FatalError` subclass reads `fatal`, and a class that extends jsonkit's `PathNotFoundError` without a code reads `path-not-found`. A projection reads `Class.code` without constructing a failure.
- **The grammar.** A code is one or more words of lowercase ASCII letters and digits joined by single hyphens, the grammar of the rule name that ends a [rule identity](#developer-diagnostics), such as `path-not-found` or `http-503`. It has no package part: a code names one failure of the application that raises it.
- **Captured once.** Core reads a class's code at the first construction of the class, or of a subclass that declares none, beside its exit code, and keeps it. A static written later, or a static getter that answers differently on a later read, changes no failure of that class. Core captures its own classes when `@loomcli/core` loads, so a write to `FatalError.code` or any other core class's static changes no code core reports. A static getter that throws makes the construction throw that error, which reports as an internal error with code 1.
- **On the class alone.** A failure instance carries no `code` member of core's. The [failure form](#the-failure-form) reports the captured code, and an author's own instance field named `code`, such as one copied from a Node system error, keeps its own meaning.
- **Type checks.** `LoomError` types its static as `string`, and every core class annotates its own as `string`, so a subclass declares any literal. A `readonly` static with a literal initializer takes that literal as its type, so an author class whose own subclasses declare other codes annotates its declaration, `static override readonly code: string = 'registry';`. A static that is not a string is a compile error, as a static side that incorrectly extends its base (TS2417). The types do not check the grammar.
- **An invalid code.** After its exit code check, `LoomError`'s constructor reads the class's code and, when it is not a string in the grammar, throws a `DeclarationError` under `@loomcli/core/failure-code` in place of the failure: `Failure class "RegistryDownError" declares failure code "Registry_Down".`, with the correction `Declare a kebab-case code of lowercase letters and digits, such as "registry-down".` and an explanation that says a machine reader branches on the code, so it follows one grammar. A value that is not a string reads `declares a failure code that is not a string.` in place of `declares failure code "Registry_Down".` The class is named by `new.target.name`, escaped, and the fault carries no finding, as the exit code fault does. A failure constructed inside a run reports the fault with code 1, by build as [Development builds](#development-builds) states, and one constructed outside a run throws at that line.
- **Author faults read `internal`.** `DeclarationError`, `InternalError`, and `ResultError` read `internal`, and the failure form reads `internal` for every failure that is an instance of `DeclarationError` or `InternalError`, in both builds, so no rule identity and no class reaches a machine reader. A defect a [translator](#translators) never answered, an unconstructed failure, and a build fault all read `internal`.
- **Its readers.** The [failure form](#the-failure-form) carries the code to [`invoke`](#invocation-by-name)'s outcome, to a [failure encoder](#failure-encoders), and to the [MCP](#mcp) plugin's failed calls, and the [manifest](#manifest-failures) lists each declared failure by its class's code.

#### Failure codes acceptance

Failure codes are proven when public APIs alone produce these results under Node and Bun:

- **Core's codes.** Each class in the table reads its code without an instance, and a failure core raises for each reaches `invoke`'s `failed.form.code` with it.
- **Inherited.** A `FatalError` subclass that declares nothing reads `fatal`, a subclass of `PathNotFoundError` that declares nothing reads `path-not-found`, and a direct `LoomError` subclass that declares nothing reads `failure`.
- **The example.** jsonkit's `PathNotFoundError` declares `path-not-found` and its `InvalidJsonError` declares `invalid-json`, and `jsonkit.invoke(['get'], { args: { path: 'missing' }, options: { file: 'doc.json' } })` reads `path-not-found` with exit 65.
- **Invalid.** Classes that declare `'Path_Not_Found'`, `''`, `'-x'`, `'a--b'`, `'path not found'`, and `42` each throw `@loomcli/core/failure-code` at construction, and an action that constructs one exits 1 with the Developer Diagnostic from source and the generic defect message from a bundle.
- **Captured once.** A class whose static is reassigned between two constructions reads its first code on both, and after every core class's static is set to `'x'`, an unknown command still reads `unknown-command` and an undeclaring `FatalError` subclass reads `fatal`.
- **Author faults.** A `TypeError` from an action, a `ResultError`, a build fault, an unconstructed failure, and an author's `InternalError` subclass that declares `'oops'` each read `internal` in both builds.
- **Types.** The negative type checks reject a numeric static `code` and a subclass whose literal code conflicts with a literal-typed parent's.

### The failure form

```ts
interface FailureForm {
  readonly code: string; // the class's failure code; 'internal' for a defect or a declaration fault
  readonly exitCode: FailureExitCode; // the failure's declared exit code
  readonly message: string; // the sentence as plain text, without the application-name prefix
  readonly hints: readonly string[]; // the onFailure lines as plain text, in the order the failure view receives them
}
```

```ts
import { textstat } from './application.js';

// `textstat --metric nope one.txt`, run by name: the form is the same data a failure encoder writes.
const outcome = await textstat.invoke([], { args: { files: ['one.txt'] }, options: { metric: 'nope' } });
if (outcome.status === 'failed') {
  // {"code":"invalid-input","exitCode":2,"message":"Option \"metric\": Expected one of: bytes, words, lines.","hints":[]}
  process.stdout.write(`${JSON.stringify(outcome.form)}\n`);
}
```

The failure form is one failure as plain data, so a reader that cannot parse prose reads what went wrong. Core builds it, and the readers that need a failure as data share it: [`invoke`](#invocation-by-name)'s outcome and its caller's handler, a [failure encoder](#failure-encoders) under `run()`, and the [MCP](#mcp) plugin. [ADR-0064](decisions/0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) records the decision.

- **When.** Core builds one form for each failure it reports, after the [translators](#translators) and the `onFailure` [hooks](#failure-hints), so a translated failure reads its own class and the form holds the hooks' hints. It is a frozen plain object whose keys are, in order, `code`, `exitCode`, `message`, and `hints`.
- **`code`.** The class's [failure code](#failure-codes), or `internal` for a defect or a declaration fault.
- **`exitCode`.** The failure's declared exit code, the value `failure.exitCode` reads. The code the run resolves can differ: a broken failure view, `onFailure` hook, or failure encoder forces 1, and a cancelled run keeps its signal's code. `invoke`'s outcome reports that code beside the form.
- **`message`.** For an operator failure, the failure's `message`: the sentence without the application-name prefix, so a usage error that reports two problems holds both lines, separated by one line break, with no trailing newline. Core resolves its markup as plain text, as [`invoke`](#invocation-by-name) resolves its captured text, with no color, modifier, or hyperlink. For a defect or a declaration fault, the message follows the build: `Something went wrong.` in a [distributed build](#development-builds), and the fault's `sentence` in a development build. A form never carries a cause, a stack, a finding, or a rule identity.
- **`hints`.** The hints the [failure view context](#failure-view-context) receives, each resolved as plain text, in the same order. It is `[]` when no hook contributed and for a failure no hook runs for, such as a build fault.
- **Nothing else.** The form carries no exit name, because the [manifest](#manifest)'s `exitCodes` table explains each number, and no fact of the class, such as `InputError.problems`. A later field can add class facts without changing the four.
- **Not on the views.** A failure view and an `onFailure` hook receive the failure and their contexts, never the form.
- **Names.** `FailureForm` is exported from `@loomcli/core`.

#### The failure form acceptance

The failure form is proven when public APIs alone produce these results under Node and Bun:

- **The example.** The `invoke` above reads the form in its comment, and `jsonkit.invoke(['get'], { args: { path: 'missing' }, options: { file: 'doc.json' } })` reads `{ code: 'path-not-found', exitCode: 65, message: 'Path not found: "missing". Run jsonkit keys to list the keys at the root.', hints: [] }`.
- **Two problems.** An `InputError` with two problems reads both lines in `message`, with no application name and no trailing newline.
- **Plain text.** A `FatalError` whose message carries a style mark, and a hint that carries one, read as plain text with no ANSI and no markup under `FORCE_COLOR=1`.
- **By build.** A `TypeError` from an action reads `Something went wrong.` from a bundle and the defect's sentence from source, and neither form holds a stack frame.
- **Hints.** Two fixture plugins' hints read in installation order, and a build fault reads `[]`.
- **Exit codes.** A usage error whose `onFailure` hook breaks reads `exitCode` 2 in the form and 1 on the outcome.
- **Frozen.** An assignment to a form's member throws in strict mode code.

### Failure views

Core keys each failure class's default text function as that class's default view, so a failure is overridden with the same `override` call as any other view. The key is the class itself, and the replacement is typed from its instances, so `override(InputError, fn)` checks `fn` against an `InputError`. This is the typed path for a class-keyed list, because an array literal cannot carry a different type parameter per element.

```ts
import { Application, InputError, override, UnknownCommandError } from '@loomcli/core';

import { summarize } from './actions/summarize.js';
import { inputProblems, unknownCommand } from './views.js';

export const jsonkit = new Application('jsonkit', {
  views: [override(InputError, inputProblems), override(UnknownCommandError, unknownCommand)],
}).action(summarize);
```

The view receives the failure instance and the [failure view context](#failure-view-context): the stderr view context, where the run was, and the hints plugins added. It returns marked text that core resolves for stderr without adding a newline, so the view owns its trailing newline. Core's default diagnostics escape raw facts; `FatalError` retains the authored marked message supplied to `out.fatal()`. A working view cannot change the exit code, which is a fact of the class. A view that throws or returns a non-string is itself an internal failure, so that invocation returns 1 whichever code the original failure carried, except in a cancelled run, which keeps its signal's code under [Signals and cancellation](#signals-and-cancellation) and reports the view fault as text.

[Failure messages](failure-messages.md) states the rules core's default text follows for an operator, what went wrong and what to do instead, and shows an author how their own views and failure classes can follow them.

Resolution follows the one walk [Views](#views) defines: the application's overrides, then each installed plugin's overrides in installation order, then core's default text, with the thrown failure's prototype chain walked in full, most derived first, at each contributor before the next is consulted. An override for `UsageError` therefore brands every exit-2 failure core raises at once, whatever any plugin registers beneath it, and within one contributor an override for a `FatalError` subclass beats one for `FatalError`. In a distributed build, `DeclarationError` and `InternalError` reach overrides too, because the generic defect message is output the application owns; a `DeclarationError` build raises reaches the application's overrides, and a plugin's overrides are not consulted for it. In a development build, neither reaches any override: core renders its [Developer Diagnostic](#developer-diagnostics) first, so no override can hide a fault from the author. A `DeclarationError` thrown from an authoring call, a constructor, or an attach never reaches `run()`, so no view renders it, as [Declaration faults](#declaration-faults) states. In a distributed build, a `DeclarationError` raised at run time, such as a typed read through the wrong descriptor, resolves through every contributor like any other failure. Two overrides for one class by one contributor are a declaration error from the call that holds the list; the same class overridden by the application and a plugin, or by two plugins, resolves first-in-wins, as [Views from plugins](#views-from-plugins) describes.

Core's default text for each class is a plain function that runs no application code. The class's default view is that function, and the plain fallback path in the [Failure contract](#failure-contract) calls it directly, so a broken override can never leave a failure unreported.

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

#### Failure view context

```ts
interface FailureViewContext extends ViewContext {
  readonly application: string;
  readonly path: readonly string[];
  readonly hints: readonly string[];
  readonly invokedBy: 'argv' | 'name'; // how the run received its inputs
  readonly view: string | undefined; // new: the view name the result would render through when the run failed
  readonly mediaType: string | undefined; // new: the media type that view declares
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

A failure carries what went wrong, and the run carries where it happened. [ADR-0046](decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) records the decision.

- **`application`.** The name the Application was constructed with, the value `graph.name` holds. It is known for every failure, so every failure view reads it, a build fault's view included.
- **`path`.** The canonical names routing walked when the failure was raised; an alias reports its Command's canonical name, as `CommandNode.path` does. It is `[]` before routing: for a declaration fault raised at graph build, a failure raised before build, and a declared default or implied value its validator rejects. For an unknown Command it is the partial path walked before the unknown token, so `store cache nope` reads `['cache']`. Otherwise it is the path routing reached, for every held fault, a structural fault on a global option and a misplaced option included, and for every failure the chain or the action raised, so `store --file` with no value reads `[]`, `store cache --force clear` reads `['cache']`, and `store cache clear --bogus` reads `['cache', 'clear']`.
- **`hints`.** The lines the installed plugins' `onFailure` hooks returned for this failure, in installation order, as a frozen array, under [Failure hints](#failure-hints). It is `[]` when no hook contributed and for a failure no hook runs for.
- **`invokedBy`.** How the run received its inputs: `'argv'` for a `run()` call and `'name'` for a run [`invoke()`](#invocation-by-name) started, a nested one included. The by-name sentences [Failure classes](#failure-classes) states are the failure's own `message`, which core writes where it raises the failure, so core's default text and a view that prints `message` read them as they are. A view or a hint that points at a command line, such as `Run "jsonkit get --help"`, reads `invokedBy` to stay silent where no command line exists.
- **`view` and `mediaType`.** The run's selection when it failed: the view the result would render through, which a [failure encoder](#failure-encoders) reads under `run()`. `view` is the last name a middleware assigned to `view` before the dispatch boundary, else the name [`invoke()`](#invocation-by-name) started with, else the routed Command's default view, the value a middleware's `view` holds, and the rule is the same before and after dispatch. For a failure raised after the boundary dispatched the action, it is the [selected view](#emitting-a-result) the boundary read. For a failure raised before dispatch, a held fault the boundary raises included, it is the name `view` held when the run failed. A `--format` its validator rejected is never assigned, so the selection stays as it was, an earlier middleware's assignment or the name `invoke()` started with, else the default view: `textstat --format yaml one.txt` reads `table`. `mediaType` is the media type that view declares, read from the routed Command's `ResultNode.mediaTypes` under [Media types](#media-types), and `undefined` when the view declares none. Neither field is the graph, so the rule below that a failure view's context carries no graph stands.
- **When the selection is `undefined`.** Both fields are `undefined` in four cases alone: a build fault, which includes a failure raised before the graph built and a declared default its validator rejects; an unknown command, because routing reached no Command; a Command that declares no result; and an assigned or starting name the routed Command's result does not hold, or one that is not a string, which the dispatch boundary rejects.
- **Filled once.** `run()` and `invoke()` fill all six where they catch the failure, before they call the view. Core adds nothing to the failure instance, and no failure class carries a field for any of them. A fault reported after the primary outcome, such as a plugin's `next()` fault, reads the same `application`, `path`, `view`, and `mediaType`, and hints of its own.
- **Default text.** Core's default text for every class writes the sentence it writes without hints, then each hint followed by one newline, with no prefix and no indent. A hint is marked text, so core resolves it for stderr as it resolves view output and escapes nothing in it. With no hints, the default text is unchanged byte for byte.
- **Overrides.** An override receives the hints and decides whether to print them. One that ignores `hints` prints none, and core never appends them behind an override.
- **Plain fallback.** The plain fallback path of the [Failure contract](#failure-contract) writes core's default text for the original failure without hints, because it resolves no markup and writes nothing a plugin produced.
- **No `command`.** A failure view's context never carries a member named `command`. A build fault has no graph, and `path` names the place; advice that needs the graph belongs in a hint.
- **Other views.** Lane views, the help page, the version line, and result views receive `ViewContext` unchanged.
- **Types.** `FailureViewContext` and `FailureView` are exported, and `override(FailureClass, view)` takes a `FailureView` of the class's instances. A `View<Failure>` written against `ViewContext` is assignable to it, because its function reads less of the context, so an existing failure override compiles unchanged.

##### Selection in the failure contexts acceptance

`view` and `mediaType` are proven when public APIs alone produce these results under Node and Bun, each read by a fixture view override and a fixture `onFailure` hook alike:

- **After dispatch.** `jsonkit paths --format json -f <document with a refused key>` reads `json` and `application/json`, and `jsonkit paths -f <the same document>` reads the default view, `list`, and `undefined`.
- **A held fault.** `textstat --format json --metric nope one.txt` and `textstat --format json --bogus one.txt` read `json` and `application/json`, the second because core validates the formatter's `--format` under the held unknown option. `textstat --metric nope one.txt` reads the default view, `table`, and `undefined`.
- **The default view.** `textstat --format yaml one.txt` reads `table` and `undefined`, because the rejected `--format` assigns nothing. A fixture Command whose default view is `json()` reads `json` and `application/json` for a failure with no `--format`.
- **No selection.** `jsonkit typo --format json -f doc.json`, a build fault, a declared default its validator rejects, and a failure on jsonkit's `get`, which declares no result, each read `undefined` for both.
- **A bad selection.** A fixture middleware that assigns `yaml` to `view` and then calls `next()` under a held fault reads `undefined` for both.
- **By name.** `invoke(['paths'], …, { view: 'json' })` against a document with a refused key reads `json` and `application/json` on both contexts.

### Failure encoders

```ts
type FailureEncoder = (form: FailureForm) => string;
function encodeFailure(mediaType: string, encoder: FailureEncoder): FailureEncoding; // FailureEncoding is opaque and branded

interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  failureEncoders?: readonly FailureEncoding[]; // new
  // ...
}
```

```ts
// src/format/plugin.ts, the entry module of the @loomcli/plugins/format subpath
import { encodeFailure, plugin } from '@loomcli/core';
import type { FailureEncoder, Plugin, StringOption } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { escapeControls } from '../encode.js';
import { attachFormat } from './attach.js';

export interface FormatSettings {
  readonly short?: NonNullable<StringOption['short']>;
}

// One line on stderr: {"error":{"code":…,"exitCode":…,"message":…,"hints":[…]}} and a newline.
const errorLine: FailureEncoder = (form) => `${escapeControls(JSON.stringify({ error: form }))}\n`;

export function format(settings?: FormatSettings): Plugin<{}> {
  // ...the settings check under Plugin settings...
  return plugin(`${Package.name}/format`, {
    failureEncoders: [encodeFailure('application/json', errorLine), encodeFailure('application/jsonl', errorLine)],
    middleware: { activate: 'always', load: () => import('./middleware.js') },
    onCommandAttach: attachFormat(settings?.short),
  });
}
```

A failure encoder writes a failed run's [failure form](#the-failure-form) in the media type the run selected, so a run that prints JSON on success prints JSON on failure. It is a stage ahead of view resolution, not a view override, because overrides resolve first-in-wins and none can decline. Core encodes nothing itself, under [ADR-0023](decisions/0023-a-command-declares-its-result-and-core-resolves-its-presentation.md). [ADR-0064](decisions/0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) records the decision.

- **Registration.** `encodeFailure(mediaType, encoder)` pairs a media type with a function and returns a `FailureEncoding`. A plugin lists its encodings under `failureEncoders`, as it lists [translations](#translators) under `translators`. The Application registers none; an application that wants its own encoder installs a small local plugin.
- **One encoder per media type.** Media types compare as the exact strings core stores, under [Media types](#media-types), which holds no grammar. Two encodings for one media type in one plugin are a `DeclarationError` from `plugin()`, and two plugins that register one media type are a `DeclarationError` from the Application constructor, both under `@loomcli/core/failure-encoder-taken`.
- **When it answers.** When `run()` reports a failure whose [failure view context](#failure-view-context) reads a `mediaType` that an installed plugin registered, core calls that encoder once with the failure's form and writes the returned text to stderr as it is: it resolves no markup, escapes nothing, and appends nothing, so the encoder owns its newline. No failure view resolves for that failure, an application's override included. A failure whose `mediaType` is `undefined`, or that no encoder answers, renders through its view as before.
- **The only failure text.** When an encoder answers a failed `run()`, its line is the only failure text the run writes to stderr: core writes no [incomplete-result](#a-sequence-that-stops-early) line for that run either. The rule follows the registration, which core knows when the sequence stops, so the fallback text of a broken encoder writes none either. A development build still writes a defect's Developer Diagnostic first, as the next rule states.
- **Defects by build.** In a [development build](#development-builds), a defect or a declaration fault writes its [Developer Diagnostic](#developer-diagnostics) and the hints under it first, as today, and then, after one blank line, the encoder's line. In a distributed build the encoder's line takes the place of the generic defect message, and its form reads `internal` and `Something went wrong.`
- **Each reported failure.** The stage takes the place of the view wherever core resolves a failure's view: the primary failure and each fault reported after it, each with a line of its own. A report core writes through the plain fallback path of the [Failure contract](#failure-contract), such as a broken failure view's or a broken hook's, stays text, and the at-most-once rule of the generic defect message applies to that text alone.
- **Stdout is untouched.** The stage writes to stderr alone. Rows a result wrote before the failure stay on stdout, and the encoded line, with no incomplete-result line ahead of it, tells a reader the result is incomplete.
- **`run()` alone.** [`invoke`](#invocation-by-name) never calls an encoder: its outcome and its caller's handler carry the form, and `messages` keeps the failure view's text.
- **Synchronous.** An encoder runs synchronously and receives the form alone.
- **A broken encoder.** An encoder that throws or returns a value that is not a string, a promise included, is a defect. Core writes the original failure's default text through the plain fallback path, then reports the broken encoder by build: the generic defect message in a distributed build, at most once per run, and the Developer Diagnostic of `@loomcli/core/broken-failure-encoder` in a development build. Its sentence is `Plugin "@acme/json" failed to encode the failure as "application/json": <reason>`, where the reason is the thrown value's, escaped, or `The encoder returned number instead of a string.`, and its correction is `Return the encoded failure as a string, and throw nothing from the encoder.` A returned promise receives a rejection handler and is otherwise ignored. The run returns 1, except a cancelled run, which keeps its signal's code.
- **Names.** `encodeFailure`, `FailureEncoder`, and `FailureEncoding` are exported from `@loomcli/core`. `encodeFailure()` rejects a media type that is not a string under `@loomcli/core/media-type` and an encoder that is not a function under `@loomcli/core/not-a-function`, and `plugin()` rejects a `failureEncoders` value that is not an array and an entry that is not an encoding, under [Plugin declaration errors](#plugin-declaration-errors).

#### Failure encoders acceptance

Failure encoders are proven when public APIs alone produce these results under Node and Bun, with textstat and jsonkit installing the [formatter](#formatter):

- **A held fault.** `textstat --format json --metric nope one.txt` writes exactly `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \"--metric\": Expected one of: bytes, words, lines.","hints":["Run \"textstat --help\" to see the usage."]}}` and one newline to stderr, nothing to stdout, and exits 2. `--format jsonl` writes the same bytes. `textstat --format json --bogus one.txt` writes the `unknown-option` line and exits 2, because core validates the formatter's `--format` under the held structural fault.
- **An action failure.** `jsonkit paths --format json -f broken.json` writes the `invalid-json` line with exit code 65, and `jsonkit paths --format jsonl -f <document with a refused key>` writes the rows before the key on stdout and the `fatal` line alone on stderr, with no incomplete-result line.
- **Text.** `textstat --metric nope one.txt`, `textstat --format yaml one.txt`, and `jsonkit typo --format json -f doc.json` write their text diagnostics unchanged, as does a build fault under `--format json`, and `jsonkit paths -f <document with a refused key>` still writes the incomplete-result line ahead of its text.
- **The default view.** A fixture Command whose default view is `json()` writes the JSON line for a failure with no `--format`.
- **Defects.** A fixture action that throws a `TypeError` under `--format json` writes `{"error":{"code":"internal","exitCode":1,"message":"Something went wrong.","hints":[]}}` from a bundle, with no generic text line, and its Developer Diagnostic and then the line with its sentence from source.
- **Overrides.** jsonkit's `FatalError` override renders `jsonkit paths -f broken.json` and is not consulted under `--format json`.
- **Registration faults.** Two encodings for one media type in one plugin, and in two installed plugins, throw `@loomcli/core/failure-encoder-taken`; a numeric media type, an encoder that is not a function, a `failureEncoders` value that is not an array, and an entry that is not an encoding throw their rules.
- **Broken.** An encoder that throws, one that returns a number, and one that returns a promise each write the failure's default text, then the generic defect message from a bundle or the `@loomcli/core/broken-failure-encoder` diagnostic from source, and exit 1, or 130 in a run a caller cancelled.
- **By name.** `textstat.invoke([], …, { view: 'json' })` with an invalid metric captures the text diagnostic in `messages`, calls no encoder, and carries the form on the outcome.

### Translators

```ts
type ErrorClass<Thrown extends object> = abstract new (...args: never[]) => Thrown;
type Translator<Thrown extends object> = (error: Thrown) => LoomError | undefined;
function translate<Thrown extends object>(key: ErrorClass<Thrown>, translator: Translator<Thrown>): Translation; // Translation is opaque and branded

interface ApplicationOptions {
  translators?: readonly Translation[];
  // ...
}
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  translators?: readonly Translation[];
  // ...
}
```

```ts
import { Application, EX_DATAERR, FatalError, translate } from '@loomcli/core';

import { summarize } from './actions/summarize.js';

// JSON.parse throws a SyntaxError for a malformed document, and the reader no longer catches it:
// `jsonkit get name -f broken.json` exits 65 and writes the class's sentence.
export class InvalidJsonError extends FatalError {
  static override readonly exitCode = EX_DATAERR;

  constructor(options?: ErrorOptions) {
    super('The document is not valid JSON. Correct its syntax, or supply another document.', options);
    this.name = 'InvalidJsonError';
  }
}

export const jsonkit = new Application('jsonkit', {
  translators: [translate(SyntaxError, (error) => new InvalidJsonError({ cause: error }))],
}).action(summarize);
```

A translator turns a foreign throw, an error a library or the platform raised, into one of the author's failure classes, so the failure exits with the class's code and renders through its view, and no action repeats the catch. [ADR-0049](decisions/0049-a-translator-turns-a-foreign-throw-into-a-failure-class.md) records the decision.

- **The translation.** `translate(key, translator)` pairs an error class with a function and returns a `Translation`. The function receives the thrown instance, typed from the class with no narrowing, and returns a failure or `undefined`. `undefined` passes the throw on. An error that shares its class with others, such as Node's system errors, which are `Error` instances told apart by `code`, is keyed on that class and checked inside the function.
- **Who registers them.** An application lists its translations under `translators`, and a plugin under its own `translators`, so a plugin that wraps a client ships the translations for that client's errors.
- **Resolution.** The walk [Views](#views) defines: the application's list first, then each installed plugin's in installation order. At each contributor the thrown value's prototype chain is walked in full, most derived first, before the next contributor is consulted, and a translation matches when its key's `prototype` is the link being walked. Within one contributor, translations for one class run in list order, and one class may hold several. The first translator that returns a failure wins, so an application's translation keyed on `Error` answers before a plugin's keyed on `SyntaxError`.
- **What reaches a translator.** A throw from an action, from a [middleware](#middleware), or from an [input source](#input-sources) resolver, the configuration source included. The action's work includes the row source it passes to `out.results` or to `out.render` with a row view, and the write it awaits, so a source's throw and a destination's write failure, such as `EPIPE`, that the action lets propagate reach the translators too. A `LoomError` is never offered, and neither is a value with no prototype chain a class can match, such as a thrown string or an object with a `null` prototype, or a value whose chain cannot be read, such as a proxy whose prototype trap throws, repeats a link, or runs past 1024 links; those report as today. A cancellation echo, the signal's reason or an `AbortError` in a cancelled run, is never offered and keeps its signal's code under [Signals and cancellation](#signals-and-cancellation). A throw from Loom's own contracts is never offered: a view, an `onFailure` hook, a validator, a plugin loader, a `next()` misuse, and the result contract each report a defect in the code that broke the contract.
- **Where it happens.** Core offers a throw once, at the point it would otherwise wrap it as an `InternalError`: where it leaves the middleware chain, for an action's or a middleware's throw, and where the resolver's call settles, for a source's throw, ahead of the plugin-fault wrap [Input sources](#input-sources) applies. A row source that throws after the action settled, because the action never awaited its call or caught its rejection, is offered once where core reports it as a deferred fault under [Results](#results); the translated failure, or a broken translator's defect, takes that internal error's place and its report, and it turns a would-be 0 into its own code, while a failure the run already reported as primary keeps its code. The rows the source yielded before the throw stay written, no `tail` is written, and the incomplete-result line precedes the translated failure's report, as it precedes any fault's. A middleware that awaits `next()` therefore sees the action's own throw, as it does without translators, and one that rethrows it passes the same value on. A middleware's own throw during unwinding, after its `next()` has settled, is never offered and stays the unwinding internal error [Middleware](#middleware) defines. A translated failure or a broken-translator defect from a source is held like the source's own failure and raised at the dispatch boundary, so a takeover such as `--help` reports neither.
- **The translated failure.** It reports as the failure the action raised would: it exits with its class's code under [Declared exit codes](#declared-exit-codes), each `onFailure` hook receives it, and its view renders it. Cancellation still outranks it. It prints the same text in a development build and a distributed one, because it is an operator failure. A translator that returns a value inheriting from a failure class without being constructed by one meets the unconstructed-failure rule of [Declared exit codes](#declared-exit-codes).
- **The cause.** A failure carries the foreign throw only when the translator passes it, `{ cause: error }`. Core never sets `cause` on the failure a translator returns.
- **A broken translator.** A translator that throws, or returns a value that is not a `LoomError`, a promise included, is a defect: core consults no later translator and reports an `InternalError` under the rule `@loomcli/core/broken-translator`, whose [Developer Diagnostic](#developer-diagnostics) names who registered it, the application or the plugin by identity, and the class it was keyed on, then shows the translator's throw and the original throw under it. A returned promise receives a rejection handler and is otherwise ignored. A distributed build prints the generic defect message and exits 1. The defect's sentence is `The translator the Application registered for "SyntaxError" threw: <reason>`, with `plugin "@acme/http"` in place of `the Application` for a plugin's translator, and `returned a string instead of a failure.` in place of `threw: <reason>` for a returned value that is not a failure, `a promise` for a promise, and its correction is `Return a failure, or undefined to pass, and throw nothing from the translator.` The class name and the reason stay on one line: each control character and line separator in them prints as its lowercase `\uXXXX` escape, as [`escapeControlCharacters`](#strings-and-composition) writes it. For a translator that throws, its `cause` is a new `AggregateError` whose `errors` hold the translator's throw and then the original throw, so neither throw is lost and neither is changed, and the diagnostic's source is the translator's own line. For a returned value, its `cause` is the original throw, and the source is the line that threw it.
- **Synchronous.** A translator runs synchronously and receives the thrown value alone.
- **Names and faults.** `translate`, `Translation`, `Translator`, and `ErrorClass` are exported. A `translators` entry that is not a translation is a `DeclarationError` from the call that holds the list, `plugin()` for a plugin's list and the Application constructor for the application's, and so is a key that is not a constructor or a translator that is not a function, from `translate()`. A key that is a failure class, `LoomError` or a class whose prototype chain holds `LoomError.prototype`, is a `DeclarationError` from `translate()` too, because a failure is never offered and such a translation could never run. A key whose prototype chain cannot be read is reported as a key that is not a class, and a key that is not a class is reported as one before the failure-class check.

#### Translators acceptance

Translators are proven when public APIs alone produce these results under Node and Bun:

- **Example.** jsonkit's reader holds no `JSON.parse` catch, and its application registers the translation above. `jsonkit get name -f broken.json` and the same document piped to `jsonkit get name` exit 65 and write `The document is not valid JSON. Correct its syntax, or supply another document.`, and an `onFailure` hook in a fixture reads the `SyntaxError` as the failure's `cause`.
- **Untranslated.** A `TypeError` from an action with no translation for it reports as an `InternalError` with exit 1.
- **Order.** An application's translation and a plugin's for one class resolve to the application's; an application's translation keyed on `Error` beats a plugin's keyed on `SyntaxError`; two plugins resolve in installation order; a translator that returns `undefined` passes to the next one, within one contributor in list order and then to the next contributor.
- **Reach.** A foreign throw from an action, from a middleware before it calls `next()`, and from a configuration source's resolver each reaches the translator and exits with the translated class's code, 69 for a class that declares `EX_UNAVAILABLE`. A row source that yields one row and then throws a `SyntaxError` under `out.results()` exits 69 whether the action awaited the call, never awaited it, or caught its rejection, with the row and the incomplete-result line ahead of the translated failure's report, and a stdout write that fails with an `EPIPE`-style error under an awaited `out.print` exits 69 with no fallback line. A throw from a failure view, an `onFailure` hook, a validator, a getter on a validator's output, and a plugin loader, a thrown `FatalError`, a thrown string, an object with a `null` prototype, and a proxy whose prototype chain repeats a link, runs past 1024 links, or stops being readable never reach it. A caller abort whose action rejects with the signal's reason resolves 130 and calls no translator.
- **The raw throw.** A middleware that awaits `next()` around an action that throws a `SyntaxError` catches the `SyntaxError`, not the translated failure.
- **Broken.** A translator that throws, one that returns a string, and one that returns a promise each report a defect with exit 1, and a later translator that would have answered is not called. In a distributed build the text is the generic defect message; in a development build it is the diagnostic of `@loomcli/core/broken-translator`, which for a throwing translator shows the translator's line, then its throw and the original throw under the `AggregateError` that holds them.
- **Faults.** `translate()` with a key that is not a constructor, `translate()` with a key whose prototype's chain cannot be read, `translate()` keyed on `LoomError`, on `FatalError`, and on an author's subclass of `FatalError`, `translate()` with a translator that is not a function, and a `translators` entry that is not a translation on a plugin and on the Application each throw their `DeclarationError`.
- **Types.** The translator's parameter types as the key's instance type, and a translator returning a string or an `Error` that is not a `LoomError` is a compile error.

### Failure contract

View and destination failures are internal errors and return code 1, except in a cancelled run as [Signals and cancellation](#signals-and-cancellation) defines it, where the code stays the signal's and the fault is reported as text; every row below reads with that carve-out and one more: a failure the chain or the action raised stays primary over a deferred view fault and keeps its own code, so an action that throws an `InputError` after an unawaited broken `out.render` returns 2. The rows speak of the chain, because a middleware calls `out.render` and the semantic methods under the same output contract an action has, and the help page is rendered by one.

| Failure                                           | Observation                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An output view throws or returns a non-string     | The `out.render` call rejects with the view's error, and nothing is written for that call under a whole view; a row view's pieces before the fault stand, under [Results](#results). Later output still writes. After the chain and the action have settled, core reports one `InternalError` through the registry, `Rendering output failed: <reason>`, and returns 1. A failure the chain or the action raised stays primary over it and keeps its own exit code, and one fault reports once: when the chain or the action raised any failure, core writes that failure's diagnostic and no separate internal error for the view fault, whether the failure is the view's own rejection returned by a middleware or a wrapper thrown around it; the `Rendering output failed` diagnostic appears only when the chain and the action returned normally. A takeover that would have returned 0 returns 1. |
| A lane view throws or returns a non-string        | The semantic call rejects with the view's error, and nothing is written for that call. The rest of the row above applies: later output still writes, and core reports one `InternalError` after the chain and the action have settled and returns 1.                                                                                |
| A destination write fails                         | The call rejects, later writes to that destination reject, core reports the broken destination by build through one plain stderr fallback, the generic defect message in a distributed build, at most once per run, and the Developer Diagnostic of `@loomcli/core/broken-destination`, whose sentence is `Could not write invocation output.`, in a development build, and returns 1, unless the action awaits the call, lets its rejection propagate, and a [translator](#translators) answers it: the translated failure then reports in place of the fallback report and returns its own code. |
| A failure view throws or returns a non-string     | Core writes the default text of the original failure through the plain fallback path on stderr, bypassing every override whichever contributor made it, then reports the broken view by build: the generic defect message in a distributed build, at most once per run, and the Developer Diagnostic of `@loomcli/core/broken-failure-view`, whose sentence is `Rendering the failure failed: <reason>`, in a development build. It returns 1. The original failure stays primary. |
| A failure encoder throws or returns a non-string  | Core writes the default text of the original failure through the plain fallback path on stderr, then reports the broken encoder by build: the generic defect message in a distributed build, at most once per run, and the Developer Diagnostic of `@loomcli/core/broken-failure-encoder` in a development build, under [Failure encoders](#failure-encoders). It returns 1. The original failure stays primary. |
| An `onFailure` hook breaks                        | The hook throws, returns a value that is not a string or an array of strings, or returns a promise. Core drops that hook's hints, renders the failure with every other plugin's hints, then reports the broken hook by build through the plain fallback path, and returns 1. The original failure stays primary. [Failure hints](#failure-hints) states the report. |
| The fallback write fails                          | Reporting stops. `run()` still resolves 1.                                                                                                                                                                                                                                                                        |

Successful completion requires output completion. A view failure during the chain or the action makes the invocation unsuccessful even when the action or middleware returned normally and even when it caught the rejection. The fallback path calls no override and no lane; it calls core's default text function. A thenable a view returned receives a rejection handler and is otherwise ignored. The reason a thrown value gives is its message when it is an Error, `An unknown error occurred.` when it is not, and `The thrown value has no readable message.` when the message is not a string or cannot be read. The plain fallback path writes the reason on one line, with each control character and line separator escaped by [`escapeControlCharacters`](#strings-and-composition).

### Development builds

```ts
interface Packet {
  readonly build: string; // 'development' or 'distributed'; the Application constructor rejects any other value
}
interface ApplicationOptions {
  packet?: Packet;
  // ...
}

// @loomcli/loom/build
interface PacketPlugin {
  readonly name: string;
  setup(build: PacketBuilder): void; // PacketBuilder is the onLoad part of Bun's plugin builder
}
export declare function packet(): PacketPlugin; // a Bun plugin by shape, which Bun.build accepts
```

```json
{ "build": "development" }
```

```ts
// src/application.ts; loom.packet.json above sits at the package root, beside package.json.
import { Application } from '@loomcli/core';

import packet from '../loom.packet.json' with { type: 'json' };

export const jsonkit = new Application('jsonkit', { packet });
```

```ts
// scripts/build.ts, run as `bun scripts/build.ts`; the bundle reads { "build": "distributed" }.
import { packet } from '@loomcli/loom/build';

await Bun.build({ entrypoints: ['src/main.ts'], outdir: 'dist', plugins: [packet()], target: 'node' });
```

Whether an application is in development is a build fact. The packet in the source tree reads `development`, so `bun src/main.ts` shows the author a [Developer Diagnostic](#developer-diagnostics) for a fault, and the build writes `distributed` into the artifact, so an operator sees one generic message. [ADR-0050](decisions/0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md) records the decision.

- **The packet.** A packet is the JSON file `loom.packet.json` at the package root. Its `build` member is `development` or `distributed`. Core ignores every other member, so a packet a later toolchain writes with more facts still reads under this core.
- **Handed over as data.** The entry imports the packet as a JSON module and passes it as `packet` in the Application options. Core reads no file, no environment variable, and no property of the process for it. `Packet.build` is typed `string`, because a JSON module types its members that way, and the Application constructor checks the value at the boundary: a packet that is not a plain object, or whose `build` is neither value, is a `DeclarationError` from the constructor, whose text [Command declaration errors](#command-declaration-errors) states. The constructor reads `build` once, so a later change to the imported object changes nothing.
- **No packet.** An Application given no packet is distributed.
- **The writer.** `packet()` from `@loomcli/loom/build` is a `Bun.build` plugin, typed by the exported `PacketPlugin`, a Bun plugin by shape that `Bun.build` accepts. `@loomcli/loom` ships no Bun type dependency, because `@types/bun` requires newer Node declarations than the Node 22 ones core ships, and a consumer that checks library declarations would meet the conflict. While it bundles, it answers the import of every module whose file name is `loom.packet.json` with the file's own members and `build` set to `distributed`, and it never writes to the source tree. A compiled binary is built through the same plugin with `Bun.build({ compile, plugins: [packet()] })`, so it is distributed; the `bun build` command line takes no plugin and cannot build a distributed Loom application. The plugin answers no other module. Core reads no file at run time, its Unicode tables included, so any bundler can bundle a Loom application. Only a bundle built with the plugin is a distributed build: a bundle built without it starts, reads the source packet, and is a development build.
- **What the build changes.** The build decides how core renders what only the author can fix. Everything else prints the same bytes in both builds.

  | What `run()` reports                                                                 | Development build | Distributed build |
  | ------------------------------------------------------------------------------------ | ----------------- | ----------------- |
  | A usage error, a `FatalError`, or an author's own class, a [translated](#translators) one included | Its view, unchanged | Its view, unchanged |
  | A defect: an `InternalError` or `ResultError`                                          | Its Developer Diagnostic, ahead of every override | `jsonkit: Something went wrong.` through its view, at most once per run |
  | A `DeclarationError` from build or from a run: a hook fault, a declared default or implied value its validator rejects, a validator that throws or returns a malformed result | Its Developer Diagnostic, ahead of every override | `jsonkit: Something went wrong.` through its view, at most once per run |
  | A broken failure view, `onFailure` hook, or [failure encoder](#failure-encoders), after the failure's own text, or a broken output view | One Developer Diagnostic per broken contract, in the order [Failure contract](#failure-contract) and [Failure hints](#failure-hints) give | `jsonkit: Something went wrong.`, at most once per run |

  A `DeclarationError` thrown at a call or an attach never reaches `run()`, and its message carries its diagnostic in both builds, under [Declaration faults](#declaration-faults).
- **The generic message.** It is the application name, a colon, and `Something went wrong.`, with no reason, class name, code, or path. A run writes it at most once, whichever faults it reports, so a second defect that core's own view renders writes nothing. It is the default text of `InternalError` and `DeclarationError` in a distributed build, so `override(InternalError, view)` replaces it for defects and `override(DeclarationError, view)` for declaration faults, and an `onFailure` hint, such as where to report the defect, prints under it. It is the one operator message with no next step, because a defect has none Loom can name, as rule 7 of [Failure messages](failure-messages.md#7-a-defect-shows-one-generic-message) states.
- **Exit codes.** A defect and a declaration fault exit 1 in both builds, and a cancelled run keeps its signal's code under [Signals and cancellation](#signals-and-cancellation).
- **Names.** `Packet` is exported from `@loomcli/core`, and `packet` from `@loomcli/loom/build`.
- **Checks only development runs.** A development build reports author mistakes a distributed build tolerates. A validated input's converter that throws or returns anything other than a plain object is a `DeclarationError` at build under the rule `@loomcli/core/schema-converter-failed`, naming the input, the target, and the converter's message, from `run()` and from `inspect()`; a distributed build reads its [input schema](#input-schema) as `null`, as it does today. A Command, an option, or an argument without a description fails the run under `@loomcli/core/undescribed`, as [Undescribed declarations](#undescribed-declarations) states; a distributed build skips that check.
- **The failure form.** A defect's or a declaration fault's [failure form](#the-failure-form) follows the build too: its `message` reads `Something went wrong.` in a distributed build and the fault's sentence in a development one, and its `code` reads `internal` in both.

#### Development builds acceptance

Development builds are proven when public APIs alone produce these results:

- **The examples.** jsonkit and textstat each ship a `loom.packet.json` that reads `development` and pass it to their Application, and each builds with `Bun.build` and `packet()`. The process tests run the bundle under Node and Bun, and every golden they pin is unchanged, because operator failures print the same bytes in both builds. A process test runs `bun src/main.ts` for each example and pins the same bytes for its usage errors.
- **A defect by build.** A fixture application whose action throws a `TypeError` writes exactly `probe: Something went wrong.` and exits 1 when bundled with `packet()`, with no reason, class name, or path on stderr. Run from source, it writes the Developer Diagnostic of `@loomcli/core/foreign-throw` and exits 1. A compiled binary built with `Bun.build` `compile` and `packet()` writes the generic message.
- **No packet.** The same fixture with no `packet` option writes the generic message from source and from a bundle.
- **The packet's checks.** A packet whose `build` is `staging`, one that is not a plain object, and one with no `build` each throw their `DeclarationError` from the constructor; a packet with an extra member reads as its `build`; and a change to the imported object after construction changes no run.
- **Overrides by build.** An application override of `InternalError` renders a defect in a distributed build and is not consulted in a development build; a plugin override of `InternalError` is likewise not consulted in development. An `onFailure` hint prints under the generic message and under the Developer Diagnostic.
- **Build faults.** A root with neither children nor an action writes the generic message from a bundle and its Developer Diagnostic from source, both with exit 1, and `inspect()` throws the `DeclarationError` in both.
- **Broken contracts.** A broken failure view and a broken `onFailure` hook each write the failure's own text and then one generic line in a distributed build, and the broken contract's Developer Diagnostic in a development build, with exit 1, or 130 in a run a caller cancelled.
- **The converter.** A validated input whose converter throws is a `DeclarationError` from `run()` and `inspect()` in a development build and reads `null` in a distributed one.
- **The writer.** A packed consumer installs `@loomcli/loom`, compiles against its emitted declarations with `skipLibCheck` off, imports `packet` from `@loomcli/loom/build`, bundles a fixture application with it under Bun, and the bundle reads `distributed` and writes the generic defect message under Node and Bun while the source file still reads `development`.
- **Without the writer.** A packed consumer bundles a fixture application with `Bun.build` and with Rolldown, each with no plugin. Each bundle pads wide, combining, emoji, and flag text to its display width, and reads `development`, under Node and Bun, and keeps the license notices of core's derived modules.

Each case runs under Node and Bun, except the source runs, which run under Bun.

#### Undescribed declarations

```ts
// The facts the check reads, as inspect() publishes them.
interface CommandNode {
  readonly description: string | undefined; // the Application's description on the root
  // ...the fields under Graph inspection...
}
interface ArgumentNode {
  readonly description: string | undefined;
  // ...
}
// Each OptionNode variant carries the same field, on global and local options alike.
```

```ts
// src/application.ts, run from source, where loom.packet.json reads development
import { Application, Command } from '@loomcli/core';

import packet from '../loom.packet.json' with { type: 'json' };

const get = new Command('get', { description: 'Read one value at a path.' })
  .argument('path', { required: true })
  .action(({ args, out }) => out.print(args.path));

// `bun src/main.ts get name` exits 1 with one Developer Diagnostic under @loomcli/core/undescribed:
// "2 declarations have no description.", with a finding for --verbose and one for get's path.
export const store = new Application('store', { description: 'Read stored values.', packet })
  .globalOption('verbose', { type: 'boolean' })
  .command(get);
```

Agents, MCP tools, help, and the manifest describe a Command and its inputs by their descriptions, so a development build fails a run whose graph leaves one out, and the author meets the gap before an operator or an agent does. A distributed build skips the check. [ADR-0050](decisions/0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md) carries the dated entry.

- **The check.** In a development build, after the graph builds, the build rules over what the lifecycle hooks returned have passed, and every validated input's converter has passed the [input schema](#input-schema) check, and before any [`onGraphBuilt`](#judging-the-built-graph) hook runs, core reads the description of every Command, the root included, every global option, every local option, and every argument. A member whose description is `undefined` is a gap. Any gap fails the run with one `DeclarationError` under `@loomcli/core/undescribed`, a build fault with exit 1 that renders its Developer Diagnostic, as [Development builds](#development-builds) states.
- **No exemption.** A hidden or deprecated member is checked, because a hidden Command still routes, prints its own manifest slice, and can opt in to [MCP](#mcp). What a plugin declares is checked too: its global options, its [Commands](#plugin-commands), and each option and argument its `onCommandAttach` hook declares. The root reads the Application's description.
- **One diagnostic.** One fault lists every gap. Its sentence is `2 declarations have no description.`, or `1 declaration has no description.`, its correction is `Give each one a description of one line.`, and its explanation says that agents, MCP tools, help, and the manifest read the descriptions. It carries one finding per gap, in graph order: the global options in graph order, then each Command, the root first and then depth first in authoring order, each followed by its arguments and then its local options in authoring order. Each finding rebuilds the call that declared the member, under the rules of [Developer Diagnostics](#developer-diagnostics): a Command as the call that attached it, the root as `new Application('store', { … })`, a global option as its `globalOption()` call or its plugin's `options` entry, and an input a hook declared as the hook's call, noted with its plugin. Each marks the member's name and carries the note `no description`.
- **Where it runs.** Every `run()` and every [`app.invoke()`](#invocation-by-name) in a development build, before routing, so a run with a gap fails whatever its words, `--help` and a completion request included. An action's `invoke` reuses its run's graph and checks nothing again. `inspect()` runs no such check.
- **Distributed builds.** A distributed build reads no description for this check, so a shipped application never fails on one.

##### Undescribed declarations acceptance

The check is proven when public APIs alone produce these results under Node and Bun, from source under Bun:

- **The examples.** jsonkit and textstat describe every Command, option, and argument, the installed plugins' included, so every golden their source runs pin is unchanged, and every first-party plugin's Commands and options carry a description.
- **Every gap.** A fixture whose root, a hidden Command, a deprecated option, a global option, a plugin's option, a plugin Command's argument, and an option a hook declares carry no description exits 1 from source with one diagnostic that lists seven findings in graph order, and runs from a bundle.
- **Every word.** The same fixture exits 1 from source under `--help` and under a completion request.
- **The doors.** `app.invoke` from source resolves `failed` with exit 1 and a form whose code is `internal`, `inspect()` returns the graph, and a fixture `onGraphBuilt` hook is never called.

### Developer Diagnostics

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

import Package from '../package.json' with { type: 'json' };

const retryLimit = diagnosticRule(`${Package.name}/retry-limit`, {
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
  return plugin(Package.name, {
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

A Developer Diagnostic teaches the author what broke, where, why the rule exists, and how to fix it. The author sees it for a declaration fault and, in a [development build](#development-builds), for a defect. [ADR-0051](decisions/0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md) records the decision.

- **The anatomy.** Six parts, in order, separated by one blank line, each left out when the fault does not carry it: the banner, the sentence, the findings, the explanation, the correction, and the docs link.
- **A rule.** `diagnosticRule(identity, definition)` declares one rule and returns a frozen descriptor that every site raising it shares. The identity is the declaring package's name, zero or more subpath segments, and a kebab-case rule name, each segment after a `/` and kebab-case, `<package>[/<subpath>...]/<rule-name>`, the grammar of [issue codes](validators.md#issue-codes): an [identity](#identity-and-installation) followed by a rule name. The subpath names the part of the package that owns the rule, such as a plugin the package ships as a subpath: `@loomcli/plugins/manifest/failure-code-conflict`. Core's rules take `@loomcli/core/`. One rule covers one reason a declaration is wrong, so several sites that reject one kind of value share it. The headline is a short noun phrase, the explanation is prose that says why the rule exists, and `docs` is an optional URL. `diagnosticRule()` throws a `DeclarationError` for an identity outside the grammar, an empty headline or explanation, and a `docs` value that is not a URL.
- **The fault's parts.** A `DeclarationError` built from a rule carries the sentence, the findings, and the correction. The sentence says what is wrong, and the correction says what to do: a rule table's text is the sentence followed by the correction, so `Option "verbose" is a boolean option and declares multiple.` is the sentence and `Remove multiple or declare a string option.` the correction. The correction is one imperative sentence, or a list of them when several fixes fit, printed one per line under `- `. The sentence-only constructor stays, for a plugin that has no rule, and its diagnostic holds the banner `-- INVALID DECLARATION --` and the sentence.
- **The banner.** Two hyphens, the headline in capitals, a run of hyphens, and the rule's identity, filling the stderr width, or 80 columns when the width is unknown or the text goes into `message`. A fault with no rule reads `INVALID DECLARATION` for a `DeclarationError` and `DEFECT` for an `InternalError`, with no identity.
- **Findings rebuild the declaration.** A finding names the authoring call and the arguments core holds, and the diagnostic prints the call as JavaScript an author recognizes, indented four spaces: strings in single quotes, plain objects with their keys, and a function or a validator as `…`. A finding with a `path` prints under the Command it sits on, `new Command('get')` above `.option(…)`, and opens with the path, after the application name when `run()` reports the fault. `mark` underlines one argument or one key inside it with `^`, and `note` prints beside the marks. A fault between two declarations, such as a plugin's option that collides with a local option, carries a finding for each. Findings hold no file or line; a later static check can add them to the same part.
- **Core's declaration findings.** A finding core raises at a call on a named Command opens with that Command's name alone, because the call cannot know the parent it will join; one raised at an attach opens with the path the parent knows, and one raised at build or from `run()` with the whole path. A fault about a child as a whole, such as a Command with nothing to run or a name a sibling already holds, marks the call that attached it: `.command(new Command('get'))`, or the entry in a plugin's `commands` list, where a Command value prints as `new Command('get')`. A fault that is an absence at the root, a root with nothing to run, has no call to mark and carries no finding. A name that breaks a name rule is quoted escaped in the sentence, so a line break in it cannot break the line. A fault about one key of an argument's or an option's config, such as `multiple` or `env`, marks that key inside the call that declared the input, `globalOption()` for an application's global option and the entry in its plugin's `options` record for a plugin's, and a collision between two inputs carries a finding for each side, noted with the scope that declared it. A fault about one key of a plugin's definition or of the Application's options rebuilds the call with that key alone, `plugin('@acme/log', { middleware: … })` or `new Application('probe', { plugins: […] })`, and marks the key, a key inside its value, or the list entry at fault; a plugin in a `plugins` list prints as `plugin('@acme/log', …)`, a declared view as `view('@acme/page', …)`, an override as `override(InputError, …)`, and a class key of `translate()` by its name. A repeat inside one list, such as a plugin installed twice, a second claim on a slot, or a key overridden twice, carries a finding for each entry. A value an `extensions` list or an `extend()` call carries is marked with its extension's identity as the note. A fault no call declared, such as a read through a second copy of an extension descriptor or a failure class whose exit code no failure may carry, carries no finding.
- **A defect's findings.** For an `InternalError` whose `cause` is an Error, the findings are the cause chain, each cause's name and escaped message, or a `DeclarationError`'s sentence, and its stack, following `cause` links. Each error an `AggregateError` holds prints right after it, in order, under `Holds `, with its own chain. A stack's frames are read after its header, the cause's name and message, so a message line that reads as a frame is never one. A frame's location is the text between the first ` (` and the closing parenthesis, or the whole frame after `at`, so a path that holds spaces or parentheses reads whole. Above them, in a development build, core prints the author's source: the first frame of the outermost cause's stack, or for an `AggregateError` of the stacks of the errors it holds in order and then its own, whose file lies under `host.cwd`, or under the path `host.cwd` resolves to through symbolic links, and outside any `node_modules` directory, with two lines on each side, line numbers, and a caret under the frame's column. Core converts a `file:` URL frame to a path, and reads the file through `host.readSource(path, host.cwd)` only in a development build, only while it reports a defect, and only when the normalized path lies under `host.cwd`, because a thrown value's stack can be forged; the captured reader then resolves both through symbolic links and refuses a file that leaves `cwd`. A read that answers `undefined` or throws, and a stack with no qualifying frame, leave the frame's location alone.
- **The layout.** A finding with a `path` opens with a comment, `// jsonkit get`, above its receiver. A declaration fault's sentence keeps the line breaks its author wrote, such as the issue lines under a rejected default or implied value, and a defect's sentence stays on one line. A thrown reason inside either sentence, such as the reason in `Option "token" validator failed unexpectedly: <reason>.`, prints each control character, line separator, and bidirectional control as its escape by [`escapeControlCharacters`](#strings-and-composition), so it never breaks the sentence's line. A defect whose cause is not an Error prints `Thrown value:` and the value the way a finding prints an argument. The docs link prints as `See <url>`. In a run, the hints follow the diagnostic after one blank line, the diagnostic of a broken view or hook follows the failure's own text after one blank line, and any other diagnostic that follows an earlier report of the same run opens with one blank line.
- **Ahead of every override.** The diagnostic is not a view and has no identity. In a development build, core renders it for a defect or a `DeclarationError` that `run()` reports before it consults any override, and prints the hints of [Failure hints](#failure-hints) under it. It resolves through core's default styles for stderr, and with no color it is the plain text shown above.
- **In the message.** A `DeclarationError`'s `message` holds its whole diagnostic as plain text at 80 columns, so a fault thrown at a call or an attach prints its diagnostic through the runtime's own uncaught-error output in both builds, under the runtime's source line. Its `sentence` holds the sentence alone. An `InternalError`'s `message` stays its sentence, because only `run()` reports one.
- **Core's defect rules.** Each defect core raises carries a rule of its own.

  | Rule                                    | Raised when                                                                                  |
  | --------------------------------------- | -------------------------------------------------------------------------------------------- |
  | `@loomcli/core/foreign-throw`           | An action, a middleware, or a source threw a value no translator answered                    |
  | `@loomcli/core/unconstructed-failure`   | A thrown value inherits from a failure class without being constructed by one                |
  | `@loomcli/core/broken-translator`       | A [translator](#translators) threw or returned a value that is not a failure                 |
  | `@loomcli/core/broken-failure-view`     | A failure view threw or returned a non-string                                                |
  | `@loomcli/core/broken-output-view`      | An output or lane view threw or returned a non-string                                        |
  | `@loomcli/core/broken-failure-hook`     | An `onFailure` hook threw or returned a value that is not hints                              |
  | `@loomcli/core/broken-failure-encoder`  | A [failure encoder](#failure-encoders) threw or returned a value that is not a string        |
  | `@loomcli/core/plugin-loader-failed`    | A plugin's middleware or source loader rejected or exported no default                       |
  | `@loomcli/core/next-misuse`             | A middleware called `next()` twice or after it returned                                      |
  | `@loomcli/core/result-contract`         | An action broke the [result](#results) contract, one `ResultError` kind                      |
  | `@loomcli/core/view-selection`          | A middleware assigned `view`, or `invoke()` selected a view, that the routed Command's result cannot render |
  | `@loomcli/core/source-answers`          | A configuration source answered outside the answers rule                                     |
  | `@loomcli/core/run-options`             | `run()` received a `signal` that is not an `AbortSignal`                                     |
  | `@loomcli/core/invoke-options`          | `invoke()` received a malformed path, values, signal, failure handler, or host, under [Invocation by name](#invocation-by-name) |
  | `@loomcli/core/foreign-graph`           | A graph `inspect()` did not return, or whose nodes disagree with its build, reached core     |
  | `@loomcli/core/broken-destination`      | A host stream failed a write the run owed it                                                 |

  A validator that throws, rejects, or returns a malformed result is a declaration fault under `@loomcli/core/validator-failed`, as [Issues and validator failures](#issues-and-validator-failures) states. Every declaration fault in core, `@loomcli/plugins`, and `@loomcli/validators` carries a rule too. The Rule columns of [Command declaration errors](#command-declaration-errors), [Input declaration errors](#input-declaration-errors), [Input source declaration errors](#input-source-declaration-errors), [Result declaration errors](#result-declaration-errors), and [Plugin declaration errors](#plugin-declaration-errors) name core's. The pack declares its own through `diagnosticRule()`, as a third-party plugin does: `@loomcli/plugins/config/file-path` and `@loomcli/plugins/config/file-pattern` under [Configuration](#configuration), `@loomcli/plugins/manifest/failure-code-conflict` under [Manifest failures](#manifest-failures), and `@loomcli/plugins/version/postfix` under [Version](#version). The catalog's are listed under [Faults at the call](validators.md#shared-rules).
- **Names.** `diagnosticRule`, `isRuleIdentity`, `DiagnosticRule`, `Finding`, and `DiagnosticParts` are exported from `@loomcli/core`.
- **The rule grammar.** `isRuleIdentity(value)` answers whether a value is a string in the rule-identity grammar, the check `diagnosticRule()` runs, so a package that keys its own values on that grammar, as `@loomcli/validators` keys [issue codes](validators.md#issue-codes), checks them against core's grammar instead of a copy.

#### Developer Diagnostics acceptance

Developer Diagnostics are proven when public APIs alone produce these results under Node and Bun:

- **Thrown at a call.** A JavaScript fixture whose `option()` call declares `multiple` on a Boolean option throws while it loads; the error's `message` is the pinned diagnostic of its rule, and the process's stderr under both runtimes contains it.
- **From `run()`.** A build fault, a default its validator rejects, and an implied value its validator rejects each write their pinned diagnostic from source in a development build, with the application name before the path in the findings.
- **A third-party rule.** The fixture plugin above writes the pinned text for `retry(50)`, with two findings for a fixture fault that names both sides of a collision, and a correction list printed one line per fix. A sentence-only `DeclarationError` from a fixture plugin writes the banner and the sentence alone.
- **The descriptor.** `diagnosticRule()` throws for an identity with no package part, one with an uppercase rule name, an empty headline, an empty explanation, and a `docs` value that is not a URL, and returns a frozen value otherwise.
- **A defect's source.** In a development build, an action that throws a `TypeError` prints the rule's banner, the action's own source lines with the caret under the failing column, and the cause's name, escaped message, and stack; a cause chain of two prints both. A frame inside `node_modules` is skipped for the next qualifying one.
- **The guards.** A fixture throws an Error whose forged stack names a file outside `host.cwd` and one that names a file that does not exist; `readSource` is not called for the first, the second answers `undefined`, and both print the frame's location alone. The captured reader answers `undefined` for a symbolic link under `cwd` that points outside it, with `cwd` itself reached through a symbolic link, as `/tmp` is on macOS. A frame named by a `file:` URL reads its file. A `readSource` that throws prints the location alone. In a distributed build `readSource` is never called. The captured reader answers `undefined` for a FIFO and for a file larger than 1 MiB. A message line that reads as a frame never names a file the reader is asked for, a frame whose path holds spaces or parentheses reads its file, and an action thrown from a module under a `host.cwd` reached through a symbolic link prints its source.
- **Escaping.** A cause whose message holds a line break, a bidirectional control, or a U+2028 prints it escaped by [`escapeControlCharacters`](#strings-and-composition), both in the cause chain and where the sentence quotes it, a validator's thrown reason included.
- **The families.** Every declaration rule in core, the pack, and the catalog pins its rendered diagnostic, family by family.

### Example coverage

[textstat](../examples/textstat/src/application.ts) prints a row per counted source, and a read failure on any source leaves stdout empty. The header names `COUNT`, then `SOURCE`. Counts right-align in a column as wide as the header or the widest count, a two-space gutter separates the columns, and the source column has no trailing padding. The total row is present only with `--total` and its source is `total`, so a selection that the byte threshold filters entirely still prints the header and one `total` row. The [table](#table) view produces these bytes from the column list, and the [table and records coverage](#table-and-records-example-coverage) pins them.

```text
COUNT  SOURCE
    6  one.txt
    2  two words.txt
    8  total
```

[jsonkit](../examples/jsonkit/src/views.ts) overrides one failure view, the literal `FatalError` view above, and keeps core's text for every other class, so its usage diagnostics are core's sentences opened by the application name under the audit row of [Failure messages](failure-messages.md#9-audit), with the [suggestions](#suggestions) plugin's fix where a name is near and help's hint under each.

| Invocation                              | stderr                                                                                   | Code |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ---- |
| `jsonkit select --field '' -f doc.json` | `jsonkit: Option "--field" at 0: Expected a nonempty value.` then `Run "jsonkit select --help" to see the usage.` | 2 |
| `jsonkit get -f doc.json`               | `jsonkit: Argument "path" requires a value. Supply a value for "path".` then `Run "jsonkit get --help" to see the usage.` | 2 |
| `jsonkit typo -f doc.json`              | `jsonkit: Unknown command "typo". Use one of: doctor, completion, get, keys, select.` then `Run "jsonkit --help" to see the usage.` | 2 |
| `jsonkit gte -f doc.json`               | `jsonkit: Unknown command "gte". Did you mean "get"?` then `Run "jsonkit --help" to see the usage.` | 2 |
| `jsonkit get missing -f doc.json`       | `Path not found: "missing". Run jsonkit keys to list the keys at the root.`                | 65   |
| `jsonkit keys missing -f doc.json`      | `Path not found: "missing". Run jsonkit keys to list the keys at the root.`                | 65   |
| `jsonkit get name -f broken.json`       | `The document is not valid JSON. Correct its syntax, or supply another document.`          | 65   |

The two rows above the last are jsonkit's `PathNotFoundError`, a `FatalError` subclass that `get` and `keys` throw for a path the document does not hold. It declares `EX_DATAERR`, 65, under [Declared exit codes](#declared-exit-codes), because the document was read and its data holds no value at the path, which `EX_NOINPUT` would misreport as a missing input file. It renders through the literal `FatalError` view, which escapes the message and adds nothing, so its bytes match core's text for a message that carries no marker.

The last row is jsonkit's `InvalidJsonError`, which its [translator](#translators) returns for the `SyntaxError` `JSON.parse` throws, so the reader holds no catch. It also declares 65. It names no source, because the translator sees only the `SyntaxError`, and it quotes no engine text.

The registry increment is proven when jsonkit's `FatalError` override produces the bytes above unchanged, and when an override of `helpPage` in a test application changes `jsonkit --help` while `help()` stays installed. The acceptance tests cover the resolution order with one application override and one plugin override for a shared key, an application override for `UsageError` beside a plugin override for `InputError` resolving to the application's, an earlier plugin's `UsageError` override beside a later plugin's `InputError` override resolving to the earlier plugin's, a declared-view key from a second copy of a package rejected, an inert override for a view no plugin declares, an override of `lanes.warn` observed through `out.warn` with one newline, a hand-built object with an `identity` field rendered as a bare view, a help page and a version line whose graph facts carry marker characters printed literally, each build rule above, a broken lane view, a broken `helpPage` override under `jsonkit --help` returning 1 with one diagnostic on stderr, an action that throws an `InputError` after an unawaited broken `out.render` returning 2 with one diagnostic, and a broken failure view under the fallback path. The negative type checks gain the invariance cases, a replacement that requires data the key lacks and a declared view reassigned to another data type, and the retired `Renderer` cases move to `View`. Each case runs under Node and Bun.

### Results

A result is the typed value a Command produces for its consumer, as distinct from the messages it writes about its work. The results lane is opt-in in four steps, and each step pays for itself alone: a pack view rendered inside the action with no declaration, one declared result with a default view, the [formatter](#formatter) that lets a run select another view by name, and rows that render as they arrive. Nothing in the first step needs the rest, and a Command that declares no result behaves exactly as [Output and failures](#output-and-failures) describes.

The block restates `View` from [Rendered output](#rendered-output) beside the shapes and calls this section adds. The `views()` lines describe one method whose record type and presence follow the carried result: the implementation adds the member to the picked surface where a result is carried, so a declaration with none has no `views` member at all, and it may expose one signature per call with internal dispatch where overloads would make a rejection read as a complaint about the last overload.

```ts
interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  row?: undefined;
  mediaType?: string; // new: see Media types
}
interface RowView<Row> {
  row: (row: Readonly<Row>, index: number, context: ViewContext) => string;
  head?: (context: ViewContext) => string;
  tail?: (count: number, context: ViewContext) => string;
  render?: undefined;
  mediaType?: string; // new: see Media types
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
views(replacements: ResultViews<Value>, options?: { default?: string }): … // under result<Value>
views(replacements: RowViews<Row>, options?: { default?: string }): … // under rows<Row>

// The result rides in the declared types beside args, options, and globals. Its neutral is unknown.
type ResultInput<Result> = Result extends { kind: 'value'; value: infer Value }
  ? Value
  : Result extends { kind: 'rows'; row: infer Row }
    ? Iterable<Row> | AsyncIterable<Row>
    : never;
interface Out<Result = unknown> {
  render<Data>(data: Data, view: View<Data>): Promise<void>;
  render<Row>(rows: Iterable<Row> | AsyncIterable<Row>, view: RowView<Row>): Promise<void>;
  results: (value: ResultInput<Result>) => Promise<void>; // property syntax: contravariant, so a neutral Out never stands in for a specific one
}
```

#### Row views

A view renders one whole value in one call, as [Rendered output](#rendered-output) defines it; where the two shapes meet, this section calls it a whole view. A row view renders a sequence one row at a time: `row` receives one row, its zero-based index, and the view context, and returns the text for that row; `head` and `tail` return the text that opens and closes the sequence, and each defaults to the empty string. `head` receives the view context alone, because nothing about the sequence is known before it starts. `tail` receives the number of rows `row` was called with and then the view context, so a summary line reports a count no view has to accumulate, and the count is zero on an empty sequence. Every function is pure and synchronous, holds no output handle, and owns the newlines in the text it returns, because the write site appends nothing. The two shapes are exclusive: a whole view has `render` and no `row`, a row view has `row` and no `render`, the types reject a value with both, and the call that receives one a JavaScript author writes rejects it, so core never guesses. `view(identity, definition)` declares either shape, and a declared row view carries the brand and the invariance witness a declared view carries, so `override` keyed by it takes a row view under the rules of [Views](#views) unchanged; a replacement supplies the whole shape, so an omitted `head` or `tail` replaces the default's with nothing. `AnyDeclaredView` and `ViewContribution` admit both shapes, as the type block there states.

`out.render` accepts a row view with an iterable, the second overload above. `out.render(rows, records)` renders `head`, then each row as the iterable yields it, then `tail`, and writes each piece in order on the call's destination. A synchronous or an asynchronous iterable is accepted. Core calls `row` for each item as it arrives, not inside the `out.render` call, and does not request the next item until the previous piece's write has completed, so a slow destination applies back-pressure to the source; a source that never ends never completes, which is the author's to avoid. The returned promise resolves when `tail` is written. A sequence call, under `out.render` with a row view or under `out.results` with either view shape, holds its place in its destination's order from the moment it is issued until its last piece is written, so a later call to the same destination, awaited or not, writes after the sequence, and the call-order rule of [Output and failures](#output-and-failures) reads at the granularity of calls. One consequence is a hazard the author owns: a source that itself writes to the sequence's destination waits behind the sequence, which waits on the source, so such a write is issued before or after the sequence or to the other destination. A pending sequence is open output: the invocation does not complete, under the rule that successful completion requires output completion, until every sequence it issued has ended. This is the first step of the lane: an action renders through a table or records view from the plugin pack with no declaration, no `--format`, and no change to its stdout.

```ts
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';

.action(async ({ out }) => {
  await out.render(rows, table({ columns: ['source', { key: 'count', header: 'Bytes', align: 'right' }] }));
  await out.render(walk(document), records({ identifier: 'path', fields: ['path', 'kind'] }));
});
```

A pack view is a configured factory, and what it returns is a bare view: it carries no identity, nothing replaces it by reference, and two calls with one configuration are two views. Its configuration is typed from the row type. When the factory call is written inside a `views` record, the row type flows in by contextual typing and a column that names a field the rows do not carry is a compile error on that string. As the second argument of `out.render` the call's row type is inferred from the iterable and does not flow into the factory's configuration, so there, as in a call hoisted into its own constant, the factory states its row type, `table<Row>({…})`, or its cell callbacks go unchecked. A `columns` or `fields` list is an ordered list whose entries are a bare key or an object with `key` and the entry's own optional fields, where a bare key is `{ key }`, the list order is the column order, a key may appear twice, and `format` is a function that renders one cell. When the list is omitted every own key that appears in the rows is a column or a field in first-seen order and cells stringify with `String(value)`, and each factory's own section states what it writes over an empty sequence. A factory's return type names one shape, never a union of the two, so its value reaches both `out.render` overloads and a `views` record alike. A factory's configuration is plain data the view it returns holds, and no factory publishes it: core sees a bare view and has nothing to key such a fact on, and an application changes a result's layout by naming another view rather than by reaching for the one it has. Each factory's full configuration is its own contract: [Table](#table) states the table's, a whole view that measures every row, and [Records](#records) states the records list's, a row view that writes each record as it arrives.

#### Declaring a result

`result<Value>(declaration)` declares that the Command produces one value, and `rows<Row>(declaration)` declares that it produces a sequence of rows. Both are authoring calls on `Command` and on `Application` for its root action, both return a new value like every other authoring call, and `action()` removes both, because the action's `out.results` is typed from the declaration and an action registered before the type exists cannot be checked against it. Calling either removes the other, and a Command that declares a result must register an action, because a group can keep no promise. The type parameter is stated by the author and is the value under `result` and one row under `rows`. The result travels in the declared types beside the arguments, options, and globals, which is how `ActionHandler<typeof count>` types `out.results` in an extracted action, and the note in [Modular authoring](#modular-authoring) holds for `views()` as it holds for `extend()`: appending it inside a self-referencing initializer is circular, so an enriched value is derived from the completed declaration. The result's neutral type is `unknown`, so a library's neutral `Command` annotations and `command()` attachment keep compiling for a declaration with a result, and `views()` is published where a result is carried rather than where none is known, which the implementation's type checks prove.

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

`views` is a record keyed by view name, and its values are views in the sense [Views](#views) gives the word, reached by a name rather than by a reference. The first key is the default view, the one core renders when nothing selects another, and every key the record holds when the [formatter](#formatter)'s hook runs is a name `--format` accepts, so the names are unique by construction. A key is a bare token under the rule Application names meet and is not an integer-like string, because such a key does not keep its authored position, and the record holds at least one entry. Under `result<Value>` every entry is a `View<Value>`. Under `rows<Row>` an entry is a `View<readonly Row[]>`, which core buffers the whole sequence for, or a `RowView<Row>`, which core feeds as rows arrive. Core knows no view name of its own, not even `text`: `json()` and `jsonl()` are whole views the [formatter](#formatter) ships, with an optional `map` that reshapes what the view receives before encoding, the value under `result` and the collected rows under `rows`. They render as ordinary views with the plugin uninstalled. Installing the plugin adds `--format` to every Command that declares a result and the two views to every record that lacks them, through its `onCommandAttach` hook.

A view states how its text encodes through its [media type](#media-types), never through its name: `json()` declares `application/json` and `jsonl()` declares `application/jsonl`, whatever key the record holds them under and whatever their `map` reshapes. The [manifest](#manifest) and the [MCP](#mcp) plugin read the media types the result's node publishes, so a view named `json` that declares none promises nothing, and a mapped `json()` under another name keeps its media type. Core checks nothing here: a view whose text does not match the media type it declares breaks its author's promise, not a rule of core.

The `views()` call reshapes the views after the fact. It is published in every state on a declaration that carries a result, and never on one that carries none, so an importing application can add a wide table or a mapped `json` to a Command it did not author without touching its action. Its record takes the shape the declaration carries, so a row view under a value result is the same compile error there as in the declaration. It merges by key: an existing key is replaced in place and keeps its position, and a new key is appended. `default` names the key that becomes the default view; a default once named persists through later calls that name none, and until one is named the first key is the default. A merged record with no views, or a `default` that names a key the merged record does not hold, is a declaration error at attach, or at build for the root. Like `extend()`, `views()` returns a new immutable value. A result's view is replaced by name alone: the Application's override list reaches failures, lanes, and declared views by reference, and never a result's views, which carry no identity.

```ts
import { json } from '@loomcli/plugins/format';
import { table } from '@loomcli/plugins/table';

import { count } from './commands/count.js';
import type { Row } from './row.js';

const wide = table<Row>({ columns: ['source', 'count', { key: 'count', header: 'Share', format: share }] });
export const branded = count.views({ wide, json: json({ map: toWire }) }, { default: 'wide' });
```

The declaration is a graph fact. `inspect()` publishes `result` on every node, as [Graph inspection](#graph-inspection) lists it: `null` where none is declared, and otherwise `{ kind: 'value' | 'rows', views: readonly string[], default: string, mediaTypes: Readonly<Record<string, string | null>> }`, the names in record order and each view's [media type](#media-types) by name. No schema is part of the declaration; a projection that needs the shape of a result reads a fact the plugin that needs it defines.

#### Media types

```ts
interface View<Data> {
  // ...render and row, as above...
  mediaType?: string; // new: such as 'application/json'; omitted means none
}
interface RowView<Row> {
  // ...row, head, tail, and render, as above...
  mediaType?: string; // new
}
interface ResultNode {
  readonly kind: 'value' | 'rows';
  readonly views: readonly string[];
  readonly default: string;
  readonly mediaTypes: Readonly<Record<string, string | null>>; // new: by view name, null where a view declares none
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

A view declares the media type of the text it writes, and a result publishes it by view name, so a reader learns how to parse a view's output from the graph rather than from the view's name. [ADR-0061](decisions/0061-a-view-declares-its-media-type-and-a-result-publishes-it-by-view-name.md) records the decision.

- **On every view.** `mediaType` is optional on every view shape: a whole view and a row view, a bare view and a declared view. An omitted `mediaType` declares none.
- **An open string.** Core never checks the value: it holds no grammar and no registry of media types, and it never compares the text a view writes with the type it declares. A view whose text does not match its declared type breaks its author's promise. The one rule is the type: a `mediaType` that is not a string is the declaration error `@loomcli/core/media-type`, which TypeScript already rejects.
- **Copied when stored.** The call that stores a view reads its `mediaType` once and keeps the string: `result()`, `rows()`, `views()`, and the `views()` a [lifecycle hook](#lifecycle-hooks) calls for a result's record, and `view()` for a declared view. A later write to the view object changes no fact. A view handed to `out.render` is never stored, and its media type has no reader.
- **The graph fact.** `ResultNode.mediaTypes` holds one entry for each view name the record holds, a view a hook added included: the string the view declared, or `null`. It is frozen with the rest of the node.
- **Selection is by name.** A run selects a view by name, through a middleware's `view` or `invoke()`'s starting selection, and never by media type. Core reads a media type at run time for one purpose: a failed `run()` reads its selected view's media type, as the [failure view context](#failure-view-context) states, to find a [failure encoder](#failure-encoders).
- **The pack's views.** The formatter's `json()` declares `application/json`, and `jsonl()` declares `application/jsonl`, under every `map`. The table and records views declare none, because they write text for a terminal.
- **Its readers.** The [manifest](#manifest) copies `mediaTypes` with each result and states its two encodings for the views that declare them. The [MCP](#mcp) plugin selects the first view whose media type is `application/json` and sends its output as structured content. A [failure encoder](#failure-encoders) answers a failed `run()` whose selected view declares the media type it registered.

| Rejected declaration | Diagnostic | Rule |
| --- | --- | --- |
| A result view whose `mediaType` is not a string | `Command "count" names view "csv" with a media type that is not a string. Supply a media type such as "text/csv", or omit mediaType.` | `@loomcli/core/media-type` |
| A declared view whose `mediaType` is not a string | `View "@acme/notes/page" declares a media type that is not a string. Supply a media type such as "text/plain", or omit mediaType.` `view()` throws it after the identity rule. | `@loomcli/core/media-type` |

##### Media types acceptance

Media types are proven when public APIs alone produce these results under Node and Bun:

- **The examples.** `inspect()` reports `mediaTypes` `{ table: null, json: 'application/json', jsonl: 'application/jsonl' }` on textstat's root and `{ list: null, table: null, json: 'application/json', jsonl: 'application/jsonl' }` on jsonkit's `paths`, and every pinned result byte is unchanged.
- **Each store.** A fixture declares a media type on a bare whole view, a row view, a declared view, a view `views()` adds, and a view a hook adds, and each reads back by name. A view that declares none reads `null`, a mapped `json()` under the key `wire` reads `application/json`, and a write to a view object after the call changes no fact.
- **No check.** A media type of `nonsense` is stored as written, and a view whose text is not JSON under `application/json` renders unchanged.
- **Faults.** A `mediaType` of `5` on a result view and on a declared view throws `@loomcli/core/media-type` from the call, and the negative type checks reject it.

#### Emitting a result

An action emits its result once through `out.results`. Core renders the selected view: the one a middleware named through `view` on its [context](#middleware) before the action dispatched, or the declaration's default when none did. Under `result<Value>` the argument is the value, and core renders the selected view over it and writes the text to stdout. Under `rows<Row>` the argument is any `Iterable<Row>` or `AsyncIterable<Row>`, an array included, so an action holds no opinion about whether its consumer wants a buffer or a stream. Under a row view core writes `head`, then each row's text as the source yields it, under the back-pressure and ordering rules of [Row views](#row-views), then `tail`. Under a whole view core collects every row and renders once at the end of the source, so a whole view over an unbounded source never completes, which is the author's choice and not a build error. An empty sequence still writes `head` and `tail`, and renders a whole view over an empty array. `results` is present on every `Out`, so no method is ever removed, and it accepts a value on the action's `out` of a Command that declares a result alone: on a Command with no declared result and on a middleware's `out` its argument is typed `never`, and a JavaScript caller reaches the `undeclared` or the `middleware` fault below; a call from a middleware is the `middleware` kind whatever the Command declares and whatever the action did.

The returned promise resolves when the last byte of the result is written and rejects on a view or a write failure. It is the ordering anchor for anything the action writes afterwards, so `await out.results(rows); await out.info('done')` puts the summary after the last row. The optional-await contract holds: an action that returns normally without awaiting the call still has its result written and accounted for before the invocation completes, because a pending sequence is open output, and the rows source is still drained.

A declared result is a promise the Command makes, and core holds the action to it from the moment the action runs. An action that returns normally without calling `out.results` fails with `ResultError`, exit 1, naming the Command. A failure raised before the call is that failure, because a failure is the outcome, not a missing result. A run cancelled under [Signals and cancellation](#signals-and-cancellation) raises no missing-result fault, because an action that reads `signal` and returns is the sanctioned path. A middleware that never dispatches raises none either, because the action never ran. A second call rejects with `ResultError` and turns a would-be 0 into 1, the rule a second `next()` follows in a middleware chain. `ResultError` extends `InternalError`, so an override of `InternalError` brands it and its default text carries the `Internal error: ` prefix; its `cause` is `undefined`, because it wraps no thrown value, it carries the Command's `path` and a `kind`, and an override keyed by the class itself reaches it alone.

```ts
class ResultError extends InternalError {
  readonly path: readonly string[];
  readonly kind: 'missing' | 'repeated' | 'undeclared' | 'middleware' | 'source';
  readonly cause: undefined;
} // exit 1
```

| Fault                                              | Diagnostic                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The action returned without emitting               | `Internal error: Command "count" declares a result and its action returned without emitting one. Call out.results() once.` |
| The action emitted twice                           | `Internal error: Command "count" emitted its result twice. Call out.results() once.`                                        |
| `out.results` on a Command with no declared result | `Internal error: Command "get" declares no result. Declare one with result() or rows() before action().`                    |
| `out.results` from a middleware                    | `Internal error: A middleware called out.results() on Command "count". Only the action emits a result.`                     |
| `out.results` from a configuration source          | `Internal error: A configuration source called out.results() on Command "count". Only the action emits a result.`           |

The root Command is named by that phrase rather than by a name, capitalized where it opens a sentence, as every diagnostic names it.

#### Stdout belongs to the result

On a Command that declares a result, nothing the action writes but the result reaches stdout. The action's `out` is its own channel object: `print` and `render` keep their signatures and write to stderr, decided at graph build from the declaration and never at run time from the selected view, so a script that captures stdout receives the result and nothing else the action wrote whichever view ran. The redirect moves the destination and the view context together, so capability detection and glyph selection follow the stream the bytes reach, `out.render(message, lanes.print)` included. `info`, `success`, `warn`, and `error` already write to stderr, and `fatal` still throws without writing. No method is removed, because an author denied a lane works around the framework rather than through it. On a Command with no declared result every method keeps the destination the table in [Output and failures](#output-and-failures) states. A middleware's `out` keeps those default destinations on every Command, so a help page rendered for a result Command still reaches stdout, and a middleware that prints to stdout after `next()` on a result Command owns what its consumer then reads.

#### A sequence that stops early

A rows sequence, under `out.results` or under `out.render` with a row view, can stop before it is complete: the source throws, the selected view's function throws or returns a non-string, under a row view mid-sequence or under a whole view once the source has ended, a write to the destination fails, the action fails while an unawaited sequence is pending, or the run is cancelled. In every case core stops requesting rows, writes no `tail`, and retracts nothing already written, so under a row view the rows already written stay on the call's destination, and under a whole view nothing was queued before the source ended, so the destination holds nothing from the sequence unless its one final write itself failed partway. Core then writes one line on stderr through the declared view `incompleteResult`, exported from core with the identity `@loomcli/core/results/incomplete`, over `{ path, yielded, written }`: `yielded` counts the rows the source produced, including one an in-flight request delivers after the stop, which is never written, and `written` counts the rows whose text core wrote, which is zero under a whole view. The line resolves through the registry the way `out.render` output does and follows the output-view row of the [Failure contract](#failure-contract): the view owns its newline, an override that returns the empty string silences it, and an override that throws writes nothing for it and is reported as a view fault only when nothing else is primary. The line prints for zero rows too, because an empty stdout and a failed stdout must not read the same. A run whose failure a [failure encoder](#failure-encoders) answers writes no such line, because the encoded line is its only failure text on stderr. When stderr itself has already failed, the line goes through the plain fallback path and no further.

```text
Output is incomplete: Command "count" stopped after 4 rows, 3 written.
```

What follows the line is the fault's own report, when there is one. A value that iterates neither way is the source's own fault before the first row, reported as `Internal error: The result of Command "count" is not iterable.`, which the types reject and a JavaScript author alone reaches. A source that throws under an awaited call ends the invocation with that failure's exit code and its diagnostic; under a call the action did not await and had already returned from, or one whose rejection the action caught, it is a deferred fault that reports its own diagnostic and returns 1, the rule every post-settle fault follows. A foreign throw is offered to the [translators](#translators) at that point, once: a failure one returns replaces the internal error, reports through its view after the incomplete line, and returns its own code in place of the 1, while the rows already written stand. A failure class the source throws is never offered. A view of either shape that throws or returns a non-string is the output-view fault of the [Failure contract](#failure-contract), rejection with the view's error included, so an action that awaits the call and lets a thrown failure class propagate keeps that class's code as it would for any view; the atomic rule there, nothing written for the call, is scoped to a whole view, and a row view's pieces before the fault stand. A write failure follows the destination row of the same contract, whose diagnostic is the report. An action that fails while its unawaited sequence is pending stays primary, and the sequence is stopped rather than drained. Under cancellation the code stays the signal's: from the moment the run is cancelled core requests no further rows and writes no further pieces, calls the source's `return`, and treats the sequence as stopped early, so a truncated result never reads as a complete one. A row an in-flight request delivers after the cancellation counts as yielded and is not written, a cancellation echo the source throws is silent, and when nothing else failed the line stands alone. A failure the action raises after `out.results` resolved is an ordinary failure, and the result it already wrote stands.

```ts
import { Application, incompleteResult, override } from '@loomcli/core';

const app = new Application('quiet', { views: [override(incompleteResult, { render: () => '' })] });
```

#### Result declaration errors

Each rule below is a `DeclarationError` with exit 1 under [Command declaration errors](#command-declaration-errors), at every level, and it throws at the moment [Declaration faults](#declaration-faults) assigns it. The types already reject most of them, so they reach a JavaScript author alone: a `result()` or `rows()` call after `action()`, a second `result()` or `rows()` call, a row view under `result()`, a `views` entry that is neither shape or carries both `render` and `row`, and a `views()` call on a declaration with no result. Every author meets the rest: a key that is not a bare token or is integer-like, an empty record, a `default` that names no key, and a result on a Command with no action.

| Rejected declaration                          | Diagnostic                                                                                                                   | Rule |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---- |
| A result declared after the action            | `Command "count" declares its result after its action. Declare result() or rows() before action().`                          | `@loomcli/core/declared-after-action` |
| A second result declaration                   | `Command "count" declares two results. Declare one result() or rows() call.`                                                 | `@loomcli/core/multiple-results` |
| A result on a Command with no action          | `Command "count" declares a result and no action. Register an action or remove the result.`                                  | `@loomcli/core/result-without-action` |
| A views() call on a declaration with no result | `Command "get" reshapes its views and declares no result. Declare result() or rows() before action().`                      | `@loomcli/core/views-without-result` |
| A row view on a value result                  | `Command "get" names row view "records" on a value result. Supply a view with render, or declare the result with rows().`    | `@loomcli/core/row-view-on-value` |
| A views entry that is not a view              | `Command "count" names view "table" with a value that is not a view. Supply a view with render or a row view with row.`      | `@loomcli/core/view-shape` |
| A views entry that carries both shapes        | `Command "count" names view "both" with render and row. Supply one of the two.`                                              | `@loomcli/core/view-shape` |
| A view name that is not a bare token           | `Command "count" names view "wide table". Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.` | `@loomcli/core/view-name` |
| An empty views record                         | `Command "count" declares a result with no views. Name at least one view.`                                                   | `@loomcli/core/result-without-views` |
| A default that names no key                   | `Command "count" selects default view "wide", which it does not name. Name the view or select a named one.`                  | `@loomcli/core/unknown-default-view` |
| A view whose media type is not a string        | `Command "count" names view "csv" with a media type that is not a string. Supply a media type such as "text/csv", or omit mediaType.`, under [Media types](#media-types) | `@loomcli/core/media-type` |

#### Results example coverage

The results increment is proven when [textstat](../examples/textstat/src/application.ts) declares its table as a result with one whole view under the key `table` and prints the table bytes the [table and records coverage](#table-and-records-example-coverage) pins, with its `--timing` line still on stderr, and when a hidden jsonkit Command declares `rows<Entry>` over the document's paths with an application-authored row view as its default and a whole view under a second key, writes each row as an async generator yields it, and leaves a partial list and the incomplete line behind when the generator throws. The acceptance tests cover both shapes of `out.render` with a row view under a synchronous and an asynchronous iterable, `out.results` under each declaration with an array, a generator, and an async generator, back-pressure observed through a destination that delays its write callback and a source that records each request, so no second request precedes the first callback, a later `print` to the same destination landing after an unawaited sequence's last piece under a row view and under a whole view, an invocation that stays open while an unawaited sequence waits on a slow source and completes after it, `print` and `render` reaching stderr with stderr's capabilities on a result Command and stdout on a plain one, a middleware's `print` keeping stdout on a result Command, each `ResultError` kind with its exit code, its prefix, and an `undefined` cause, an `InternalError` override reaching a `ResultError`, a cancelled run with an unemitted result returning the signal's code and no missing-result diagnostic, each early stop of the previous section under a row view and under a whole view with the incomplete line carrying both counts before the report, a whole view that throws after a finite source ended, a cancelled source that returns leaving the line alone, an override of `incompleteResult` silencing it and one that throws leaving the primary report intact, an empty sequence under each view shape, `views()` replacing a key in place, appending a key, moving the default, and keeping a moved default through a later call, `inspect()` publishing the fact, and each build rule above. The positive type checks cover a declared row view in a plugin's `views` list and a library's neutral annotation and `command()` attachment of a declaration with a result. The negative type checks cover an iterable that is not the declared value passed under `result`, a value passed under `rows`, `out.results` on a Command with no result and on a middleware's `out`, a column that names a missing field through the declaration and through `out.render`, a value with both `render` and `row` in a declaration and in `views()`, a row view under `result` in a declaration and in `views()`, `result()` or `rows()` called after `action()`, and `views()` on a declaration with no result. Editor latency on `ActionHandler` over a declaration with a result is measured against the current baseline before the increment merges. Each case runs under Node and Bun.

## Plugins

Core installs no plugins. Every capability beyond authoring, graph build, invocation, host capture, output, and failures is a plugin that an Application installs explicitly, and a first-party plugin uses the same public contract as a third-party one. A plugin is a frozen value that `plugin(identity, definition)` returns. It holds the options it contributes, one middleware with its activation and a loader, the extensions it defines, the views it declares and overrides, the [translators](#translators) and [failure encoders](#failure-encoders) it registers, one optional claim on the signals slot, one optional [configuration source](#input-sources), the [Commands](#plugin-commands) it attaches to the root, and its [lifecycle hooks](#lifecycle-hooks), the functions core calls at named points of an Application's life. Creating and installing the value runs none of its code: `onCommandAttach` and `onGraphBuilt` run at graph build, `onFailure` runs when `run()` renders a failure, and the middleware runs inside an invocation. An installed plugin costs its entry module and the declarations that module imports on an invocation that never reaches it, plus one call of each hook it implements at every point core calls it: `onCommandAttach` once per Command and `onGraphBuilt` once per build, since the graph builds on every invocation, and `onFailure` once per rendered failure. Its middleware module loads only when the chain reaches it.

The optional [theme contribution](#plugindefinitiontheme-field) claims the single theme slot.

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  theme?: Theme & ThemeConstraint<Theme>;
  options?: Options;
  middleware?: {
    activate: 'always' | readonly (keyof Options & string)[];
    load: () => Promise<{ default: Middleware<Plugin<Options>> }>;
  };
  onCommandAttach?: CommandAttachHook;
  onGraphBuilt?: GraphBuiltHook; // new: see Judging the built graph
  onFailure?: FailureHook;
  extensions?: readonly AnyExtension[];
  views?: readonly ViewContribution[];
  translators?: readonly Translation[];
  failureEncoders?: readonly FailureEncoding[]; // new: see Failure encoders
  signals?: readonly ('SIGINT' | 'SIGTERM')[];
  source?: {
    binding: AnyExtension & { readonly target: 'option' };
    load: () => Promise<{ default: SourceResolver<Plugin<Options>> }>;
  };
  commands?: readonly Command<unknown, unknown>[];
}
```

`Plugin<Options>` carries its options as a type parameter used in a read position alone and defaults to `Plugin<PluginOptions>`, so a `plugins` list holds plugins with different options the way `views` holds overrides for different keys. The parameter is therefore covariant, which is what lets `plugins`, `Middleware`, and `load` accept a narrower plugin; Command globals instead express a requirement on the receiving Application. `AnyExtension` is the descriptor supertype a plugin's `extensions` list uses: it publishes the identity, the target, and whether the extension collects, and erases both the schema and the factory call signature, because a schema-typed call signature relates only by schema identity and a list cannot name one schema per element. A descriptor is assignable to it; an extension value is not. A plugin that loads a middleware annotates its factory's return type, and exports its options type when it declares options. That annotation is the boundary that breaks the type cycle between the entry module, which names the middleware module in `load`, and the middleware module, which type-imports the plugin.

```ts
// src/help/plugin.ts, the entry module of the @loomcli/plugins/help subpath
import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { attachHelp } from './attach.js';
import { helpArgument, helpCommand, helpInput } from './extension.js';
import { helpHint } from './hint.js';
import { helpPage } from './views.js';

const options = {
  help: { control: true, description: 'Show this help.', short: 'h', type: 'boolean' },
} satisfies PluginOptions;
export type HelpOptions = typeof options;

export function help(): Plugin<HelpOptions> {
  return plugin(`${Package.name}/help`, {
    extensions: [helpArgument, helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
    onCommandAttach: attachHelp,
    onFailure: helpHint,
    options,
    views: [helpPage],
  });
}
```

A plugin package written outside this repository enables `resolveJsonModule` to import its manifest this way. The compiler copies the manifest into the output directory beside the compiled modules, so the package's `exports` targets stay relative to the package root, and a module inside the output must not import its own package by name. `Package.name` types as `string`, never as a literal, so nothing keys on an identity at the type level. A package that ships one plugin uses `Package.name` alone as the identity; the example above ships several, so it appends the plugin's own name, as [First-party plugins](#first-party-plugins) describes.

### Identity and installation

A plugin's, an extension's, and a view's identity follows one grammar: an npm package name, scoped or unscoped, of lowercase letters, digits, `-`, `.`, and `_` and at most 214 characters with its scope, then zero or more subpath segments, each after a `/` and each of lowercase letters and digits in words joined by single hyphens. `help`, `@acme/config`, `@loomcli/plugins/help`, and `@loomcli/core/lanes/stdout` are identities; `Help`, `@acme`, `@acme/`, `~x`, `x//y`, `@loomcli/plugins/Help`, and `x/under_score` are not, and neither is a package name of 215 characters. The subpath segments do not count toward the limit. The package part is the package part of a [rule identity](#developer-diagnostics), which adds a mandatory rule name, so every rule identity's prefix is an identity. `plugin()`, `extension()`, and `view()` check the identity at the call and throw `@loomcli/core/invalid-identity`, whose sentence names the declarer, for a value that is not a string or lies outside the grammar. A hand-built descriptor, a callable object with an `identity` and a `target` that `extension()` did not make, is checked where the plugin that lists it under `extensions` is declared, which also covers a source binding, since a binding is one of those extensions: `plugin()` reads its identity once and throws the same rule with the sentence `Plugin "@acme/notes" holds the extension identity "Not A Valid/ID_", which is not a package name with optional kebab-case subpath segments.`, and the finding marks the list entry. [ADR-0052](decisions/0052-a-plugin-extension-and-view-identity-follows-one-grammar.md) records the decision.

For a plugin, the convention is the package name for a package that ships one plugin, and `<package name>/<plugin>` for a package that ships several, both read from the package manifest so the identity and the package stay in sync. An application-local plugin names itself the same way, under the application's own name. Identity is fixed where the plugin is defined and never changes at installation, because the extensions a plugin defines carry that identity in modules the plugin's consumers import statically.

An Application installs plugins through `plugins` in its options object. Installation order is the order every plugin contribution composes in, so the application source shows the precedence. The list is the only way in: there is no install call on the fluent chain, no default set, and no removal. Replacing a first-party behavior means omitting one plugin and installing another. The constructor rejects a `plugins` entry that is not a plugin value and an identity installed twice.

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

import Package from '../package.json' with { type: 'json' };

export const jsonkit = new Application('jsonkit', {
  plugins: [help()],
  version: Package.version,
});
```

### Global options from plugins

```ts
type GlobalOptionConfig = OptionConfig & { readonly required?: never; readonly validateOmitted?: never };
type PluginOptions = Readonly<Record<string, GlobalOptionConfig>>;
type PluginOptionValues<Options extends PluginOptions> = {
  readonly [Name in keyof Options & string]: OptionValue<Options[Name]>;
};
```

```ts
// src/plugin.ts, the entry module of a package that ships one plugin
import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

import Package from '../package.json' with { type: 'json' };

const options = {
  level: { description: 'Set the log level.', env: 'ACME_LOG', type: 'string', validate: oneOf(['debug', 'info', 'warn']) },
} satisfies PluginOptions;
export type LogOptions = typeof options;

export function log(): Plugin<LogOptions> {
  return plugin(Package.name, { middleware: { activate: 'always', load: () => import('./middleware.js') }, options });
}

// Any action of an application that installs log() reads it typed:
//   const level: 'debug' | 'info' | 'warn' | undefined = options.level;
```

A plugin declares global options under `options`, keyed by name. They are global options with no difference from the ones `globalOption()` declares, under [ADR-0055](decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md).

- **One configuration.** An entry takes `GlobalOptionConfig`, the configuration `globalOption()` takes: everything `option()` takes except the presence rules, which [ADR-0044](decisions/0044-a-global-option-declares-no-presence-rule.md) forbids on a global option. Every option kind, a [counted option](#counted-options) included, a validator, a default, an [implied value](#implied-values), `multiple`, an [environment binding](#input-sources), the core facts, and `extensions` all apply, under the rules of [Local options](#local-options). `plugin()` rejects `required` and `validateOmitted` under `@loomcli/core/global-presence-rule`, whatever their value, and applies every other rule an option declaration meets. `satisfies PluginOptions` checks each entry's keys, but not a default against its type or its validator's input, which `option()` checks at compile time, so a TypeScript author meets those two rules from `plugin()` at run time.
- **One parse.** Routing reads a plugin's option like every global option, and every Command's table holds it, so it shares short groups with the routed Command's local options: `textstat -ht` sets help's `help` and the root's `total`. A structural fault on it is the fault any option produces, held under [Global consumption and routing](#global-consumption-and-routing).
- **One validation.** Its value validates with the other global options, in authoring order after the application's own and then in plugin installation order, and a rejected value is an ordinary input problem with exit code 2.
- **Every reader.** Its validated value reaches every action and every middleware's `options`. An action's type names it through the installed plugin tuple: the Application's own action reads it from the constructor's `plugins`, and a Command built where the Application's `Register` augmentation is visible reads it through `EnvironmentOf`, under [Modular authoring](#modular-authoring). A [plugin Command](#plugin-commands) receives it at run time, and its types name no global option, because it compiles without the Application. A plugin typed as the wide `Plugin`, or a list widened to `Plugin[]`, names no option in an action's type; the value still reaches the action at run time.
- **Its own plugin keeps three things.** [Activation](#activation) lists the plugin's own option names, [`spellings`](#middleware) records how its own options were typed, and [`ownOptions`](#middleware) holds its own options' validated values under a held fault. None reaches another plugin's options or the application's.
- **Collisions.** Every collision is a declaration error, by key, by spelling, or by variable, against an application global option, a local option on any Command, or another plugin's option, under [Plugin declaration errors](#plugin-declaration-errors).
- **Types.** `GlobalOptionConfig`, `PluginOptions`, and `PluginOptionValues<Options>` are exported, as `OptionsOf` is. `PluginOptionValues` maps each declaration through the same `OptionValue` an action's options use, so a validated option reads as its validator's output.

### Plugin settings

A plugin factory that lets an application choose a spelling takes one optional settings object, and a chosen short spelling is its `short` key, one ASCII letter, so `format({ short: 'f' })` gives `--format` the spelling `-f`. Every first-party plugin that offers a short spelling takes it this way, and none of them renames its long spelling. A factory with no settings, or settings without `short`, declares its option with the short spelling it ships with, which may be none.

```ts
function checkPluginSettings(
  settings: unknown,
  declarer: { readonly plugin: string; readonly call: string },
): void;

function checkShortSetting(
  settings: unknown,
  declarer: { readonly plugin: string; readonly call: string; readonly option: string },
): void;

function isProseLine(value: unknown): value is string;
```

`checkPluginSettings(settings, declarer)` judges any factory's settings object at its call, under core's rule, so a plugin applies core's check instead of a copy and the fault throws where the author wrote the call, under [ADR-0034](decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md). Undefined settings pass, and it reads no key, so the factory judges its own keys after it. `checkShortSetting(settings, declarer)` judges settings that hold a short spelling: it applies `checkPluginSettings` first, then the `short` rule. Settings that are not a plain object throw `@loomcli/core/not-an-object`: `Plugin "@loomcli/plugins/format" declares settings that are not an object. Supply a settings object, or omit the settings.` A `short` that is not one ASCII letter throws `@loomcli/core/short-alias` in the sentence every option's short spelling uses: `Option "format" declares a short alias that is not one ASCII letter. Supply one ASCII letter.` Each finding quotes the factory's call, `format({ short: 'fo' })`, marks the settings or their `short`, and carries the note `declared by plugin "@loomcli/plugins/format"`. Both judge the settings alone. The ordinary option declarations judge spelling ownership at the earliest point that knows both owners: construction or an option or Command attachment for globals, and graph build for a hook-declared option. `checkPluginSettings` and `checkShortSetting` are exported from `@loomcli/core`. A factory whose settings hold no `short`, such as `version()`, calls `checkPluginSettings`, so a stray `short` key is never judged as a spelling it does not take.

`isProseLine(value)` answers whether a value is one line of prose: a string that holds a character other than whitespace and no line terminator, the rule every core fact string follows. A plugin whose setting prints inside one line judges it against core's rule instead of a copy, as `version()` judges its postfix, and throws its own rule's `DeclarationError`. `isProseLine` is exported from `@loomcli/core`.

#### First-party and example short spellings

Help and version have fixed short spellings. Configuration, the formatter, and the manifest let the application choose theirs through `short` and have none by default. The example applications choose these spellings without collisions:

| Declaration | Long spelling | Short spelling | Rule |
| ----------- | ------------- | -------------- | ---- |
| Help | `--help` | `-h` | Fixed; selects compact help. |
| Version | `--version` | `-V` | Fixed; leaves lowercase `-v` available. |
| Configuration | `--config` | None by default; textstat chooses `-c`. | `config({ short: 'c' })`. |
| Formatter | `--format` | None by default; textstat chooses `-f`, jsonkit chooses `-o`. | Keeps jsonkit's `-f` for its document. |
| Manifest | `--manifest` | None by default; both examples choose `-M`. | Keeps textstat's `-m` for its metric. |
| Private example plugin | `--explain` | `-e` | Fixed in the example plugin. |
| textstat | `--metric` | `-m` | Selects bytes, words, or lines. |
| textstat | `--min-bytes` | `-b` | Selects the byte threshold; `--minimum` remains an unadvertised alias. |
| textstat | `--total` | `-t` | Adds the total row. |
| textstat | `--timing` | None | Hidden diagnostic option, kept long-only. |
| jsonkit | `--file` | `-f` | Global document option. |
| jsonkit | `--verbose` | `-v` | Global counted option. |
| jsonkit select | `--field` | `-F` | Local multiple option; lowercase `-f` belongs to the document. |

### Plugin Commands

A plugin attaches Commands to the root through `commands`, a list of the same Command values an application builds with `new Command(name)`. Once attached, a plugin Command is an ordinary child of the root.

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  commands?: readonly Command<unknown, unknown>[];
  // ...
}
```

```ts
// src/plugin.ts, the entry module of a package that ships one plugin
import { Command, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };

const doctorCommand = new Command('doctor', { description: 'Check the host this application runs on.' }).action(
  ({ out }) => out.print('All checks passed.'),
);

export function doctor(): Plugin {
  return plugin(Package.name, { commands: [doctorCommand] });
}
```

- **Where and when.** When the Application is constructed, core attaches each installed plugin's Commands to the root, in plugin installation order and in list order within one plugin, ahead of the application's own Commands, which attach later through `command()`. The root's authoring order is therefore the plugins' Commands first, and help's command rows, `inspect()`, and the manifest list them in that order.
- **An ordinary Command.** Every Command rule applies to a plugin Command unchanged, at every depth of its subtree: naming, [aliases](#aliases), hidden and deprecated, routing, parsing, the [input-source stage](#input-sources), validation, and every row under [Command declaration errors](#command-declaration-errors). Every installed plugin's [lifecycle hooks](#lifecycle-hooks) run on it, its own plugin's included, in the root-first, depth-first walk. Nothing in the graph records which plugin attached it. Its action receives what every action receives, every global option's value included, and runs only when routing selects its Command. The plugin Commands attach before any call on the root, so the closures `action()` applies never meet them.
- **Globals.** The list is typed `Command<unknown, unknown>`, whose globals are empty, so a plugin Command requires no global option: a plugin cannot know the Application it is installed in. A plugin therefore builds its Commands in its own compilation, where no Application registers globals. A Command built where an Application's `Register` augmentation is visible carries that Application's globals and does not compile into the list, whether or not its action reads them.
- **No rename or removal.** The application cannot rename or remove a plugin Command. An application that does not want it does not install the plugin.
- **Collisions.** A plugin Command whose name or alias repeats another root child's, from the application or from another plugin, is a declaration error under the sibling rows of [Command declaration errors](#command-declaration-errors), such as `The root Command attaches two children named "doctor". Rename or remove one.` The constructor throws it when two installed plugins attach one name, and the application's own `command()` call throws it otherwise. An application that also attaches the plugin's Command value to the root fails with the two-children row, and one that attaches it under another Command fails with the one-parent row.
- **A root with arguments.** A root that declares arguments cannot also hold children, so an application whose root declares arguments cannot install a plugin that brings Commands. The root's `argument()` call throws the existing row, `The root Command declares argument "files" and attaches child "doctor". Move the argument into a child Command or remove the children.`
- **Cost.** A plugin's Commands are declarations its entry module imports, so they load with that module like any Command, and each action is lazy as every action is.

The acceptance attaches the `doctor` Command of the private `@loom/doctor` plugin to jsonkit's root. The plugin compiles in its own package, outside jsonkit's `Register` augmentation, as the private `@loom/explain` plugin does. `jsonkit doctor` routes and runs it, `jsonkit --help` lists it ahead of jsonkit's own Commands, `inspect()` and `--manifest` list it as the root's first child, and `jsonkit doctor --help` prints its page. A core fixture proves the order across two plugins, routing into a plugin group's children, a hook-declared option reaching a plugin Command from another plugin's hook and from its own, and a declaration error when the application attaches a Command with the same name, when two installed plugins attach one name, when an alias repeats a sibling's name, when the application also attaches the plugin's Command value at the root or under another Command, when a plugin Command's local option repeats a global option's key, and when the root declares arguments. Each case runs under Node and Bun.

### Middleware

An invocation runs one chain. After routing has selected a Command, and after core has parsed that Command's words, run the input-source stage, and validated the invocation, holding any fault it found, core runs the middleware of each installed plugin whose activation matched, in installation order. The selected Command's action terminates the chain. A middleware surrounds the whole request: it reads the request before the action runs, it can set the view the result renders through, and its code after `await next()` runs after the action. A middleware receives:

```ts
interface MiddlewareContext<Options extends PluginOptions = PluginOptions> {
  readonly options: (PluginOptionValues<Options> & Readonly<Record<string, unknown>>) | null;
  readonly ownOptions: Partial<PluginOptionValues<Options>> & Readonly<Record<string, unknown>>; // new
  readonly spellings: PluginOptionSpellings<Options>;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly request: Request | null;
  get view(): string | null;
  set view(name: string);
  readonly host: Host;
  readonly out: Out;
  readonly signal: AbortSignal;
  readonly next: () => Promise<ChainOutcome>;
}
interface Request {
  readonly args: Readonly<Record<string, unknown>>;
  readonly options: Readonly<Record<string, unknown>>;
  readonly passthrough: readonly string[];
}
type PluginOptionSpellings<Options extends PluginOptions> = {
  readonly [Name in keyof Options & string]?: string;
};
type ChainOutcome = 'dispatched' | 'taken-over' | 'cancelled';
type Middleware<P extends Plugin | ((...args: never[]) => Plugin)> = (
  context: MiddlewareContext<OptionsOf<P>>,
) => Promise<void> | void;
```

- `options` holds the validated value of every global option, the application's and every plugin's, keyed by declared name. The plugin's own options are typed from its declaration, and every other key reads `unknown`, because a plugin compiles without the Application that installs it. It is `null` when a global option has a structural fault or a validation problem, whichever fault is held, so a middleware never reads a global value no validator accepted; a fault on a local option alone leaves it set, so a wrapping plugin keeps its own settings on a run that fails. It is also `null` when a configuration source fails or a validator throws, because core then holds no validated value to give. Each value is a copy frozen to every depth, as the request's values are, so a middleware copies a value before changing it. `Middleware` accepts the plugin type or its factory's type, with or without parameters, and the exported `OptionsOf` extracts the declared options from either, so `Middleware<typeof help>` reads them from the factory's annotated return type.
- `ownOptions` holds the validated value of each option the plugin itself declared that validated in this run, keyed by declared name: each key of its `options`, typed from the declaration, and each local option its [`onCommandAttach`](#lifecycle-hooks) hook declared on the routed Command, typed `unknown`, because nothing a hook adds reaches the types. It holds them whether or not core holds a fault for another input, so a plugin reads its own setting on a run that fails, as the [formatter](#formatter) reads `--format` under a held fault. An option whose validator rejected it, or whose validation never ran, is absent. Under a held structural fault, such as an unknown option, core still validates each local option the plugin's hook declared whose tokens parsed, so `textstat --format json --bogus one.txt` reads `json` under `format`. A local option the invocation omitted, or whose own occurrence faulted, such as `--format` with no value, is not validated under a structural fault, and on a group no local option validates, under [Invocation](#invocation). That validation serves `ownOptions` alone: the structural fault stays the held fault, whatever the validator answers. An option the invocation omitted that has no default reads `undefined`, as an action reads it. Each value is a copy frozen to every depth, as under `options`, and the record is frozen. Another plugin's options and the application's never appear in it.
- `spellings` holds, for each of the plugin's own options that the invocation supplied as a token, the spelling that supplied it: `--help`, `-h`, or `--no-total`, the spelling alone without a value attached with `=`, `-t` for a letter inside a short group such as `-tV`, and `-n` for a value letter whose value is attached, as in `-n5`. An option filled by the [input sources](#input-sources), or left to its default, has no entry, and neither does an option of the plugin the invocation did not supply, nor an occurrence that faulted. An option other than a multiple string option or a counted option is supplied at most once, because a repeat is the repeated-option usage error of [Global consumption and routing](#global-consumption-and-routing), so it has one spelling, its first well-formed occurrence's; a multiple string option and a counted option record the spelling of their last occurrence. A bare spelling of a string option with an [implied value](#implied-values) records that spelling, as `--backup` or `-b`. The record is frozen, and the exported `PluginOptionSpellings` types it from the declaration. A plugin reads the spellings of its own declared options alone, whatever its activation, although `options` holds every global option's value, so the action, the request, and the graph still cannot tell which tier supplied a value. [ADR-0040](decisions/0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md) records the decision, and [help variants](#help-variants) are its first reader.
- `graph` is the frozen graph `inspect()` returns, and `command` is the routed node inside it, so `jsonkit get --help` renders help for `get`, `jsonkit --help` for the root, and `store cache --help` for the `cache` group. An unknown command fails in routing before any middleware runs. A group's missing subcommand is held behind any structural fault and raised at the dispatch boundary, so a middleware can take over a group invocation, and with no takeover `store cache` reports the missing subcommand and `store cache --verbose` the unknown option.
- `request` is the routed Command's invocation after parsing and validation, the exported `Request`: the argument values under `args`, the local option values under `options`, each as the validator output an action receives, and the passthrough tokens. It is `null` while core holds a fault and on a group, so a middleware never reads a half-parsed invocation. The records are untyped: a middleware runs ahead of every action and the graph carries no type for a value, so it checks what it reads. Every array and plain object is copied and frozen to any depth, so a middleware reads a separate snapshot of those action inputs; a value that is neither, a class instance or a `Date` a validator produced, is shared by reference because core cannot copy it meaningfully. The request provides no supported path to replace validated action inputs. A validator's output determines the value the action receives. Additional context data, including data a middleware derives from these inputs, belongs to the separate typed context contribution design. Global option values are not here; a middleware reads them under `options`.
- `view` names the view the result renders through, on a Command that declares a [result](#results). It reads as the declaration's default until a middleware assigns one, and as `null` on a Command that declares none; it accepts a string alone. It is one value per run: the last assignment before the dispatch boundary wins, whichever middleware made it and whether or not that middleware had already called `next()`, and an assignment after the boundary changes nothing. A name the record does not hold, a non-string, or an assignment on a Command with no result is an internal error raised at the boundary, exit 1, naming the plugin, because a plugin that selects a view has the name checked first, as the [formatter](#formatter) does through its option's validator. Core spells no view name of its own.
- `next()` continues the invocation: every later middleware, then the dispatch boundary. The dispatch boundary is the point the chain reaches when its last middleware continues: there core raises a held fault, or else reads `view` and dispatches the action, so a held fault ranks ahead of a bad assignment. A held fault is raised there and not before, so a wrapper installed ahead of help still reaches help's takeover; the innermost `next()` rejects with it, the rejection propagates outward through every awaiting `next()`, and the fault keeps its exit code and rank, so a wrapping plugin sees a validator issue the way it sees an action failure. Otherwise it resolves when the rest of the chain has settled, with `'dispatched'` when the action ran, `'taken-over'` when a later middleware returned without calling its own `next()`, and `'cancelled'` when the run was cancelled before the action ran, so a wrapping plugin knows what it wrapped. `'cancelled'` wins over `'taken-over'`, so a later middleware that returns because it saw the abort reports as cancelled, the order the exit codes follow. It rejects with the failure the rest of the chain raised. Core records that failure when it is raised, so a middleware that catches the rejection changes its own control flow and not the exit code, the rule an action's caught output rejection already follows. A later middleware that catches the failure the rest of the chain raised and returns reports to its callers as `'taken-over'` when the action never ran and `'dispatched'` when it did, and the recorded failure still decides the exit code.
- `next` is live until the middleware's own result settles. Calling it twice, or calling it after the middleware has returned, is an internal error: the call rejects and nothing is parsed or dispatched. While the run is live the fault is reported after the primary outcome and turns a would-be 0 into 1; once `run()` has resolved, the call only rejects.
- A middleware that returns without calling `next()` has taken over the invocation. A held fault is never raised, nothing later in the chain runs, and the exit code is 0 unless the middleware throws, its output fails, or the run was cancelled, under the precedence in [Signals and cancellation](#signals-and-cancellation). So `jsonkit get --help` renders while `get` is missing its required `path`, and `jsonkit select --bogus --help` renders too, as they did when the chain ran ahead of parsing. Because the chain runs in installation order, `jsonkit --help --version` prints help when help is installed first.
- Core calls a plugin's `load` at the moment the chain reaches that plugin, not before. A takeover earlier in the chain therefore never loads a later plugin, and `jsonkit --help --version` never imports the version middleware module.
- Work after `await next()` returns, or in a `finally` around it, is the plugin's cleanup, and it runs in reverse installation order because the awaited calls unwind. A middleware reads the outcome directly: the value `next()` resolved, the failure it rejected with, or `signal.aborted` with a reason naming the signal. The order holds for a middleware that awaits `next()`. A middleware that calls `next()` without awaiting it still holds the chain open, because core awaits the middleware's own result and the downstream promise both, but its own cleanup then runs whenever it returns, ahead of the chain it started.
- `out` follows the output contract an action has, with the default destinations on every Command and `results` typed with a `never` argument, since a result is the action's promise under [Results](#results). Output a middleware issues counts toward completion the same way, and a middleware whose promise never settles holds the run open exactly as an action would.

A `FatalError` or other failure a middleware throws before its `next()` has settled, or without calling it, resolves through the failure path with that class's exit code, a [declared code](#declared-exit-codes) included. If middleware fails before the chain reaches dispatch, its failure determines the outcome and the held input fault stays unraised. If dispatch raises the held fault, core records it there, and catching the rejection does not change the exit outcome. A throw during unwinding, after `next()` has already settled, is an internal error whatever class it carries: it is reported after the primary outcome and turns a would-be 0 into 1, the way a view failure does. The primary outcome keeps its code.

```ts
// src/middleware.ts, loaded only when --help or -h is supplied
import type { Middleware } from '@loomcli/core';

import type { help } from './plugin.js';
import { helpPage } from './views.js';

const middleware: Middleware<typeof help> = ({ command, graph, out, spellings }) =>
  out.render({ command, graph, variant: spellings.help === '-h' ? 'compact' : 'extended' }, helpPage);

export default middleware;
```

```ts
// An always-on wrapper: cleanup in finally, the outcome from next()
const timing: Middleware<typeof timer> = async ({ next, out }) => {
  const started = performance.now();
  try {
    const outcome = await next();
    if (outcome === 'dispatched') await out.info(`${Math.round(performance.now() - started)} ms`);
  } finally {
    stopClock();
  }
};
```

### Activation

A middleware declares what activates it, and there is no default. `activate` is a list of the plugin's own option names, or `'always'`. With a list, the middleware runs when any listed option is present in the invocation; present means supplied as a token, in any spelling including a negative Boolean form, or filled by the environment or the configuration source under [Input sources](#input-sources), whatever value the fill holds, so a declared default never activates anything. With `'always'`, the middleware runs on every invocation that reaches the chain.

Activation is evaluated after the input-source stage, from which tier supplied each option: a token or a fill activates whatever value it holds, and a declared default never does. It is evaluated before any middleware module loads. Core calls `load` only for a middleware whose activation matched and only when the chain reaches it, so an invocation of `jsonkit get -f doc.json` with help, version, and manifest plugins installed imports none of their middleware modules. Each plugin's entry module and the declarations it imports, its declared views included, load at install whatever the invocation. A plugin whose middleware must observe every invocation, such as a logging or color policy, declares `'always'` and pays for its module on every run that reaches it; a plugin that only acts on a request declares the options that make the request. The plugin author chooses, and the choice is visible in the descriptor.

An activation name that is not one of the plugin's declared options is a compile error when the plugin declares options, because the list is typed from the declaration. `plugin()` applies the same rule for JavaScript authors and for a plugin that declares no options at all, and it also rejects a middleware without `activate`, an empty list, and a middleware without `load`. A local option a plugin's `onCommandAttach` hook declared is not one of the plugin's options and cannot activate it: a middleware that reads such an option declares `'always'`, as the [formatter](#formatter) does. A `load` that throws, rejects, or resolves to a module with no default middleware function, is an internal error with code 1.

### Lifecycle hooks

A lifecycle hook is a function on the plugin definition that core calls at one named point of an Application's life. Its name is `on` followed by the event, with the subject where it carries meaning: `onCommandAttach`, [`onGraphBuilt`](#judging-the-built-graph), and [`onFailure`](#failure-hints) now, `onLog` later. A hook runs in sequence at its point; middleware wraps an invocation and keeps its name for that reason. Contributions from a middleware into an action's context and a hook after an action that succeeds are direction, not contract, and wait for a plugin that needs them.

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  onCommandAttach?: CommandAttachHook;
  // ...
}
type CommandAttachHook = (command: AttachedCommand) => AttachedCommand;

interface AttachedCommand {
  readonly [attachedCommand]: true; // an unexported unique symbol, the brand a Command carries under another name
  readonly name: string | null; // null for the root
  readonly path: readonly string[];
  readonly hasAction: boolean;
  readonly arguments: readonly string[]; // declared names, in order
  readonly options: readonly string[]; // declared local option names, in order
  readonly result: ResultNode | null; // as inspect() publishes it
  readonly extensions: Readonly<Record<string, unknown>>; // as inspect() would publish it at this hook
  argument(name: string, config: ArgumentConfig): AttachedCommand;
  option(name: string, config: OptionConfig): AttachedCommand;
  views(replacements: Readonly<Record<string, ResultView>>, options?: { default?: string }): AttachedCommand;
  extend(...values: readonly ExtensionValue<'command'>[]): AttachedCommand;
}
type ResultView = View<never> | RowView<never>; // the erased view a result names
```

```ts
// src/format/attach.ts, the hook of the @loomcli/plugins/format subpath
import type { CommandAttachHook } from '@loomcli/core';

import { formatName } from './names.js';
import { json, jsonl } from './views.js';

export const attachFormat: CommandAttachHook = (command) => {
  const result = command.result;
  if (result === null) {
    return command;
  }
  const machine = { json: json(), jsonl: jsonl() };
  const missing = Object.entries(machine).filter(([name]) => !result.views.includes(name));
  const reshaped = command.views(Object.fromEntries(missing));
  const names = reshaped.result?.views ?? [];
  return reshaped.option('format', {
    description: `Select the output format, ${result.default} by default.`,
    type: 'string',
    validate: formatName(names),
  });
};
```

The hook includes the declared default in its description, as specified by the [help restyle](#help-and-version-restyle), and leaves the view names to the help page's [accepted values](#accepted-values), which read them from the option's input schema.

- **When.** Graph build, once per Command, the root first and then each child depth first in authoring order; for each Command, every installed plugin's hook in installation order, each receiving what the previous returned. The author's result record passed the rules under [Result declaration errors](#result-declaration-errors) at its own calls and at attach, so `result` is exact, and build runs those rules over what the hooks returned. A hook is synchronous and costs one call per Command on every build.
- **What it receives.** The declaration unlocked, with its types erased: the facts `inspect()` publishes, including the extension values, and the four calls above. Each call returns a new value whose facts include what the call added, so `result.views` inside the hook lists the names the hook's own earlier calls appended. `extensions` is the record `inspect()` would publish for the Command at that hook: the author's layers, then every value an earlier hook or this hook's earlier `extend()` calls added, each validated and frozen. `readExtension` reads it through a Command-target descriptor, as it reads a `CommandNode`. The author's layers were validated at the calls that declared them, so a hook never reads an unvalidated value, and an invalid value the author declared has thrown before any hook runs. A value passed to `extend()` is validated at the call: every rule under [Plugin declaration errors](#plugin-declaration-errors) that applies to a declaration's `extensions` applies there too, and it throws its `DeclarationError` from the call, which reports as itself. A hook that catches the throw continues, and the rejected value is not added. Only the value a hook returns carries its `extend()` values into the build, so a descriptor used in a call that threw, or in a value the hook discarded, registers nothing. Build stores the output validated at the call and runs no schema twice. The root arrives through the same surface with `name` `null`; `option()` on it declares a root-local option, and nothing declares a global. `result()`, `rows()`, `alias()`, `command()`, and `action()` are not published, because each changes what the action was compiled against or the graph's shape; a plugin attaches a Command to the root through its definition's [`commands`](#plugin-commands) instead.
- **What it returns.** The value it received or one derived from it by those calls. `plugin()` rejects a hook that is not a function, and build rejects one that returns anything else and one that throws, under [Plugin declaration errors](#plugin-declaration-errors); a thrown `DeclarationError` reports as itself.
- **Types.** Nothing a hook adds reaches the action's types: a hook-declared option is in `options` at run time and absent from the typed `options`, and a middleware reads it through `request`, which is untyped for that reason. A rule the types reject for an author is reached by a hook's erased call and reported at build; a JavaScript author meets the same rule at the call.
- **Rules.** A hook's calls are exempt from the four closures `action()` applies, to arguments, options, aliases, and children, and from nothing else. An input a hook declares whose key or spelling the Command, the Application's globals, another plugin's options, or another plugin's hook already use is the hook-collision error, naming the plugin and the Command; the rule reads across kinds, so a hook-declared argument collides with an option and a hook-declared option collides with an argument. `arguments` and `options` show the Command's own names, so a hook sees that case before it causes it, and the other three surface at build. Hooks compose in sequence, not first-in-wins: a later hook sees and can replace what an earlier one added, `views()` by name included, except that a value of a [collecting extension](#collecting-extensions) joins the values before it and replaces none of them.
- **Names.** `AttachedCommand`, `CommandAttachHook`, and `ResultView` are exported. The private build handle the command module spells `AttachedCommand` today is renamed with the increment.

#### Judging the built graph

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  onGraphBuilt?: GraphBuiltHook; // new
  // ...
}
type GraphBuiltHook = (graph: CommandGraph) => undefined;
```

```ts
// src/plugin.ts, a plugin that rejects a graph in which two Commands share one description
import { DeclarationError, diagnosticRule, plugin } from '@loomcli/core';
import type { CommandNode, GraphBuiltHook, Plugin } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };

const sharedDescription = diagnosticRule(`${Package.name}/shared-description`, {
  explanation: 'An agent tells two Commands apart by their descriptions, so each Command describes its own job.',
  headline: 'Two Commands share one description',
});

const walk = (node: CommandNode): readonly CommandNode[] => [node, ...node.children.flatMap(walk)];

const distinctDescriptions: GraphBuiltHook = (graph) => {
  const seen = new Map<string, CommandNode>();
  for (const node of walk(graph.root)) {
    const earlier = node.description === undefined ? undefined : seen.get(node.description);
    if (earlier !== undefined) {
      throw new DeclarationError(sharedDescription, {
        correction: 'Describe what each Command does in its own words.',
        sentence: `Commands "${earlier.path.join(' ')}" and "${node.path.join(' ')}" share one description.`,
      });
    }
    if (node.description !== undefined) {
      seen.set(node.description, node);
    }
  }
  return undefined;
};

export function distinct(): Plugin {
  return plugin(Package.name, { onGraphBuilt: distinctDescriptions });
}
```

A plugin judges the whole built graph through `onGraphBuilt`, and it may reject the graph. It never contributes: it cannot attach a Command, rewrite a fact, or store what it derives. [ADR-0060](decisions/0060-ongraphbuilt-judges-the-built-graph-and-never-contributes.md) records the decision.

- **When.** Once per graph build, after every `onCommandAttach` hook has run, after the build rules over what those hooks returned, and after the graph is frozen: on every `run()`, every `inspect()`, and every [`app.invoke()`](#invocation-by-name). An action's `invoke` reuses its run's graph, so it runs no hook again. Every installed plugin's hook runs in installation order, and each receives the same graph. A `run()` reaches it before it validates declared defaults and implied values and before it installs any process listener.
- **What it receives.** The frozen `CommandGraph` [`inspect()`](#graph-inspection) returns for that build, extension values included: the same object the run's middleware, actions, and `onFailure` hooks read. The hook is synchronous and is not told which call built the graph.
- **What it returns.** `undefined`. To reject the graph, it throws a `DeclarationError`, which reports as itself: a build fault, exit 1, with its Developer Diagnostic in a [development build](#development-builds) and the generic defect message in a distributed one. The first hook that throws ends the build, and no later hook runs. Any other throw, and any returned value, a promise included, is the `@loomcli/core/broken-graph-hook` build fault under [Plugin declaration errors](#plugin-declaration-errors). A returned promise receives a rejection handler and is otherwise ignored.
- **Types.** The return type is `undefined`, so a hook written as an arrow with no `return`, or one that returns `undefined`, compiles, and one that returns a value or a promise is a compile error.
- **Rules.** The graph is frozen, so a hook changes nothing about the build: a later hook, the run, and every projection read the graph the hooks received. A fault the hook reports is a build fault like a fault of `onCommandAttach`, so no `onFailure` hook runs for it, its `path` is `[]`, and an `inspect()` call throws it. A plugin that needs data derived from the graph derives it where it reads it, as the [MCP](#mcp) plugin builds its tool table in its own action.
- **Cost.** A plugin that implements the hook makes every build produce the frozen graph, so every validated input's [schema converter](#input-schema) runs once per run, as it does on a run that has a middleware chain.
- **Names.** `GraphBuiltHook` is exported. `plugin()` rejects an `onGraphBuilt` that is not a function.

##### Judging the built graph acceptance

The hook is proven when public APIs alone produce these results under Node and Bun:

- **Order and reach.** A fixture hook records each call: it runs once per `run()`, `inspect()`, and `app.invoke()`, after every `onCommandAttach` and with the Commands and options those hooks added, in installation order across two plugins, and never for an action's `invoke`.
- **Rejection.** A hook that throws a `DeclarationError` fails `run()` with exit 1, its Developer Diagnostic from source and the generic defect message from a bundle, makes `inspect()` throw it, runs no `onFailure` hook, and stops later hooks.
- **Broken hooks.** A hook that throws a `TypeError`, one that returns `true`, and one that returns a promise each report `@loomcli/core/broken-graph-hook` with exit 1, and an `onGraphBuilt` that is not a function is rejected by `plugin()`.
- **Frozen.** A hook that writes to the graph throws in strict mode, which reports as a broken hook, and the graph the action reads is unchanged.
- **Types.** The negative type checks reject a hook that returns a value.

#### Failure hints

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  onFailure?: FailureHook;
  // ...
}
type FailureHook = (failure: Readonly<LoomError>, context: FailureHookContext) => string | readonly string[] | undefined;

interface FailureHookContext {
  readonly application: string;
  readonly path: readonly string[];
  readonly invokedBy: 'argv' | 'name'; // the value the failure view reads
  readonly view: string | undefined; // new: the selection the failure view reads
  readonly mediaType: string | undefined; // new
  readonly style: ContextualStyle;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
}
```

```ts
// src/plugin.ts, a plugin that suggests a declared spelling for a mistyped option
import { plugin, UnknownOptionError } from '@loomcli/core';
import type { FailureHook, Plugin } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };
import { nearest } from './nearest.js';

const suggestOption: FailureHook = (failure, { command, graph, style }) => {
  if (!(failure instanceof UnknownOptionError)) {
    return undefined;
  }
  const offered = [...graph.globals, ...command.options].filter(
    (option) => !option.hidden && option.deprecated === undefined,
  );
  const spellings = offered.flatMap((option) => (option.long === null ? [] : [option.long]));
  const match = nearest(failure.spelling, spellings);
  return match === undefined ? undefined : `${style.escape(failure.spelling)}: did you mean ${match}?`;
};

export function suggest(): Plugin {
  return plugin(Package.name, { onFailure: suggestOption });
}
```

A hint is a line a plugin adds under a failure message. Plugins add hints to a failure and never replace each other's views; the failure's view receives them under [Failure view context](#failure-view-context). [ADR-0046](decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) records the decision.

- **When.** Core calls each installed plugin's hook, in installation order, for each failure `run()` renders after graph build, before it calls that failure's view: the primary failure, and each fault reported after it, with calls of its own. A declared default or implied value its validator rejects is such a failure, because the graph has built. No hook runs for a declaration fault raised at graph build or for a failure raised before build, because no valid graph exists; a plugin's overrides are not consulted for a build fault either. No hook runs where nothing renders: a takeover such as `--help` never raises the held fault, and a cancelled run reports its own cancellation silently under [Signals and cancellation](#signals-and-cancellation). A failure a cancelled run still renders receives hints like any other. No hook runs for a line the plain fallback path writes.
- **What it receives.** The failure instance as `run()` caught it, typed `Readonly<LoomError>` as a failure view receives its failure, and the context above. The guarantee is the type's: core neither freezes nor copies the failure, so a JavaScript hook that assigns to it, `message` included, steps outside the contract, and the view may render what it assigned. A hook cannot catch or suppress the failure, and a working hook cannot change the exit code, because core reads the code before any hook runs. `application`, `path`, `invokedBy`, `view`, and `mediaType` are the values the failure view reads, so a hook that points at a command line returns no hint for an [invocation by name](#invocation-by-name), and a hook reads the run's selection when it failed. `style` is the contextual style for stderr, so a hook escapes text the operator typed, such as `failure.spelling` or `failure.token`, with `style.escape()` before interpolating it. `graph` is the frozen graph [`inspect()`](#graph-inspection) returns for this run, and `command` is the node at `path` inside it: the root when `path` is empty, the last Command the partial path reached for an unknown Command, and the routed node otherwise, so `command.path` equals `path`. They are the values an action and a middleware read under [ADR-0041](decisions/0041-every-action-reads-the-frozen-graph-and-its-routed-command.md), and reading either builds the run's graph once.
- **What it returns.** A string is one hint, a readonly array is one hint per element in order, and `undefined` or `[]` contributes none. Each hint is marked text that core resolves for stderr as it resolves view output. Core keeps every string as returned and neither trims, filters, nor deduplicates, so an empty string prints an empty line and a line break inside a hint is written as it is. Core reads a returned array's length once and copies each index into a frozen array of its own, calling no method on the returned value, so an array subclass or a proxy contributes the strings it holds, whatever its own methods answer.
- **Order.** Hints keep installation order, and each hook's strings keep their own. Each hook receives the failure and its context alone and never another hook's hints, so no plugin removes or rewords another's, and two plugins that return the same line print it twice.
- **Candidates.** A hook that suggests a name reads its candidates from the graph: `graph.globals` and `command.options` for an option spelling, and `command.children` for a Command name. It leaves out what [completion](#completion) leaves out, by the node facts: a hidden or deprecated member, and every alias, since a child's `name` is its canonical name. `UnknownOptionError` carries no accepted spellings, and `candidates` on the routing errors leaves out hidden and deprecated children, the same rule. A hint adds a line; a plugin that wants the near match inside the sentence itself overrides the failure's view, as the [suggestions](#suggestions) plugin does.
- **A broken hook.** A hook that throws, returns a value that is not a string or an array of strings, an array holding a non-string or a hole included, or returns a promise contributes no hints, and a returned promise receives a rejection handler and is otherwise ignored. The failure still renders with every other plugin's hints. After the failure's diagnostic, core reports each broken hook, in installation order, through the plain fallback path, which calls no override and runs no hook: a distributed build writes the generic defect message, at most once per run, and a development build writes one Developer Diagnostic of `@loomcli/core/broken-failure-hook` for each broken hook, whose sentence is `Plugin "@acme/suggest" failed in onFailure: <reason>`, where the reason is the thrown Error's message, a `DeclarationError`'s sentence, `An unknown error occurred.` for a thrown value that is not an Error, `The thrown value has no readable message.` for one whose message is not a string or cannot be read, `The hook returned a promise instead of hints.`, or `The hook returned a value that is not a string or an array of strings.` Reading the reason never throws, so a hostile thrown value cannot suppress the failure or another plugin's hints. The sentence stays one line: each control character and line separator in the reason prints as its lowercase `\uXXXX` escape, as [`escapeControlCharacters`](#strings-and-composition) writes it. The run returns 1 whichever code the failure carried, except in a cancelled run, which keeps its signal's code and still writes the report. Hooks run before the failure's view, but their reports follow its diagnostic whole: when the view breaks too, the plain fallback path writes core's default text and the broken view's report together as that diagnostic, and the broken hooks' reports follow both, so a distributed build writes the generic message once for both.
- **Plugins alone.** The hook is on the plugin definition alone, as `onCommandAttach` is. An application that wants a hint of its own writes an override that prints it, or installs a small local plugin.
- **Names.** `FailureHook` and `FailureHookContext` are exported. `plugin()` rejects an `onFailure` that is not a function, under [Plugin declaration errors](#plugin-declaration-errors).

#### Failure hints acceptance

The private `@loom/explain` plugin, which both example applications install, proves the hook in the examples. Its `onFailure` answers an `UnknownOptionError` alone and returns `Run "<command line>" to explain this command.`, where the command line is `application`, then `path`, then `--explain`, joined by single spaces. Neither application overrides `UnknownOptionError`, so core's default text prints the hint under its sentence. Every unknown-option diagnostic the examples pin therefore gains the hint line: `jsonkit get --format json user.name -f doc.json` under [Formatter](#formatter), and `jsonkit get name -f doc.json --pretty`, which reads `Run "jsonkit get --explain" to explain this command.` under core's sentence. The tests that pin them, `examples/jsonkit/tests/format.test.ts` at line 53 and `examples/jsonkit/tests/jsonkit.test.ts` at line 303, move with the change; a change to diagnostic text is not breaking. Every other diagnostic the examples pin is unchanged, because the hook answers no other class. `jsonkit get --bogus -f doc.json` exits 2 and writes:

```text
jsonkit: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".
Run "jsonkit get --explain" to explain this command.
```

`textstat --bogus` exits 2 with the same sentence and `Run "textstat --explain" to explain this command.`, because the fault is raised on the root and `path` is empty. Once [help's failure hint](#helps-failure-hint) lands, `Run "jsonkit get --help" to see the usage.` and `Run "textstat --help" to see the usage.` print above the explain line, because `help()` is installed first.

The acceptance tests cover, through public APIs with fixture applications and fixture plugins: an override reading `application` and `path` for a structural fault on a global option before any child name, `[]`; for a local-option fault on a nested Command, its routed path; for an unknown Command under a group, the partial path to the group; and for a build fault, the application name, `[]`, and no hints; a declared default or implied value its validator rejects, for which the hook runs with `path` `[]` and `command` the root; a fault reported after the primary outcome, such as a plugin's `next()` fault, receiving hook calls of its own; two plugins' hints under core's default text in installation order, with a line both return printed twice; an override receiving the hints and printing them in its own form; a hook returning `undefined`, and one returning `[]`, beside which the default text is unchanged byte for byte; a hook that throws, one that returns a number, one that returns an array holding a number, and one that returns a promise, each losing its own hints while a second plugin's hint still prints, writing its one line, and returning 1 for a usage error that carried 2; a hook that throws a value whose message cannot be read, such as an Error whose `message` getter throws, a Symbol message, or a Proxy whose prototype trap throws, writing the fixed reason while the failure and the other hints still print; a hook whose reason holds a line break or control characters, and a broken failure view whose reason does, each writing one escaped line; a hook returning an array with a hole, an array subclass or Proxy whose `filter` lies, each contributing only the strings it holds or counting as broken, never a non-string hint; a JavaScript hook assigning `exitCode` leaving the resolved code unchanged; two broken hooks writing their lines in installation order; a broken hook beside a broken failure view, writing core's default text, then the rendering-failure line, then the hook's line; an `onFailure` that is not a function rejected by `plugin()` with its diagnostic; a broken hook in a run a caller cancelled whose failure still renders, returning 130; no hook call for a build fault, for a run a caller cancelled whose action rejects with the signal's reason, or for `--help` taking over a held unknown-option fault; the plain fallback under a broken failure view writing no hints; an issue with an extra `code` field on the second value of a variadic argument reaching an `InputError` override with `code` intact and `path` `[1]`, and the same on the second value of a multiple option; and a hook reading `graph` and `command`, which for an unknown option on a nested Command suggests a visible global or local spelling and never a hidden or deprecated one, and for an unknown Command under a group suggests a visible child by its canonical name and never an alias. Each case runs under Node and Bun.

### Extensions

`Command.extend(...values)` and `Application.extend(...values)` return new declarations and remain available after `action()`. They accept command-targeted extension values, including help details and examples on an imported library Command:

```ts
import { helpCommand } from '@loomcli/plugins/help/extension';
import { build } from 'command-library';

const customized = build.extend(helpCommand({ details: 'Build this application.' }));
const app = configured.command(customized);
```

Constructor `extensions` and each `extend()` call form successive layers. A later value of an ordinary extension replaces its complete earlier value, and a [collecting extension](#collecting-extensions) keeps both. Other descriptors remain. No fields merge and no arrays concatenate; schema defaults belong to the replacement output. Duplicate identities within one layer fail. Layers validate in authoring order, so replacement cannot hide an invalid earlier value or a conflicting descriptor reference. Replacement does not delete and reinsert keys; records use ordinary JavaScript object key ordering. The final record supports both inspection and `readExtension()`.

An empty call returns an equivalent new declaration. Extending preserves the action, inputs, aliases, children, core facts, Application environment, and authoring state. It never reopens input or action declarations. Core facts such as `description`, `hidden`, and `deprecated`, and option/argument extensions, retain their constructor or input-configuration rules. A plugin reaches a completed declaration only through `onCommandAttach` under [Lifecycle hooks](#lifecycle-hooks), where `extend()` is one of the calls it may make.


An extension is a typed fact a plugin defines and a declaration carries. `extension(identity, config)` checks its identity against the [identity grammar](#identity-and-installation) and returns a descriptor that is also a factory, and `plugin()` checks the identity of a hand-built descriptor its `extensions` list holds, reading it once: calling it with a value returns a branded extension value, `ExtensionValue<Target>`, and a declaration lists those values under `extensions` in its config object. The key is overloaded on purpose: a plugin's own `extensions` lists the descriptors it defines, and every declaration's `extensions` lists the values those descriptors produce. An extension names one target, `'command'`, `'option'`, or `'argument'`, and one Standard Schema for its value. Each config object takes the values for its own target: `ApplicationOptions` and `CommandOptions` take `ExtensionValue<'command'>`, `StringOption`, `BooleanOption`, and `CountOption` take `ExtensionValue<'option'>`, on every global option declaration, whoever declares it, and `ArgumentConfig` takes `ExtensionValue<'argument'>`.

```ts
// src/help/extension.ts, abbreviated: the shipped module in First-party plugins adds the value rules
import Package from '../../package.json' with { type: 'json' };
import { extension } from '@loomcli/core';
import { z } from 'zod';

export const helpCommand = extension(`${Package.name}/help/command`, {
  schema: z.object({
    details: z.string().optional(),
    examples: z.array(z.object({ command: z.string(), note: z.string().optional() })).optional(),
  }),
  target: 'command',
});
export const helpInput = extension(`${Package.name}/help/input`, {
  schema: z.object({ placeholder: z.string().optional() }),
  target: 'option',
});
```

```ts
const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [helpCommand({ examples: [{ command: 'get user.name', note: 'a nested key' }] })],
}).argument('path', { required: true, description: 'Dot path to read.' });
```

An extension value is keyed by its extension's identity and branded with its target, so it needs no field name and collides with no core key, and a value on the wrong target is a compile error at the config object. The call is typed from the schema's input type, so an unresolved descriptor or an ill-typed value fails to compile; identity strings and the remaining rules are checked at the call that receives the value. The value carries the input the author supplied and a private reference to the descriptor that produced it. That call validates the input once against the descriptor's schema, which must answer synchronously, and stores a copy of the output on the graph node under the identity, frozen to any depth, as a declared default is stored but without a default's depth limit, so a later change to the author's object changes nothing. `readExtension(node, descriptor)` takes the node kind the descriptor targets, `CommandNode` or the `AttachedCommand` a [lifecycle hook](#lifecycle-hooks) receives, `OptionNode`, or `ArgumentNode`, so a read against the wrong node kind is a compile error, and returns the stored output as a deeply read-only value, or `undefined` when the node carries no value for that identity, through an ordinary descriptor; through a collecting descriptor it returns an array, as [Collecting extensions](#collecting-extensions) states. It compares the descriptor by reference with the one that produced the value and throws a `DeclarationError` when they differ, so a read never returns output another schema produced. It runs no schema.

The stored output must be plain data: `string`, finite `number`, `boolean`, `null`, arrays, and objects whose prototype is `Object.prototype` or `null` with no accessors and no non-enumerable properties, to any depth and without cycles, with `undefined` property values dropped. That is the form the node can freeze and `inspect()` can report as the projection-neutral form. A schema that produces anything else, a `Date`, a `Map`, a class instance, a `bigint`, a `symbol`, or a function, is rejected at that call; a date travels as a string and a map as an array of pairs.

One identity means one descriptor. Every descriptor on a graph, whether an installed plugin defines it or a carried value references it, is compared by reference, and two distinct descriptor objects that share an identity are a declaration error at the first moment both reach one declaration or one Application, under [Declaration faults](#declaration-faults), because a read through one would return a value another schema produced. A second copy of one plugin package in `node_modules`, installed or not, trips this rule, which is the intended signal to deduplicate. A projection that reads another plugin's facts imports that plugin's descriptor module, which is declarations alone and never its middleware, and it never imports the plugin's implementation. A plugin that supplies values to another plugin's collecting extension imports that descriptor module the same way.

The call also rejects two values of one extension in one layer, one `extensions` list or one `extend()` call, a value the schema rejects, a schema that returns a promise, and an `extensions` entry that is not an extension value.

A fact whose plugin is not installed is inert for execution: no middleware or hook of the declaring plugin acts on it, because none runs, and core gives it no meaning. Another plugin's hook or middleware may read it through the descriptor, as a projection does. It still sits on the graph, `inspect()` reports it, and a projection that imports its descriptor can read it through `readExtension`. A Command library can therefore ship help facts into an application that installs no help plugin, or one that installs a different help plugin.

Core owns the facts every projection needs: `description` on the Application, on a Command, on an option, and on an argument, `version` on the Application, and `hidden` and `deprecated` on a Command and on an option, as [Hidden and deprecated members](#hidden-and-deprecated-members) describes. Each is optional in the declaration, and each states how an omitted declaration reads: `undefined` for a description and a deprecated message, `false` for `hidden`, and `0.0.0` for `version`, the one fact with a conventional sentinel for "unversioned". A description, a deprecated message, and a declared version are strings that hold a character other than whitespace and no line terminator, and `hidden` is a Boolean. Whitespace is the Unicode `White_Space` class, which covers the tab, the space, the no-break space, and every line terminator, and a line terminator is LF, VT, FF, CR, NEL, LS, or PS. They make a help page, a manifest, or a completion script minimally useful with no extension present, and an extension enriches them. A further fact of the same kind follows the same rule when it is specified, and states its own omitted reading. The convention for `version` is the package manifest's own field, as the installation example shows, so the graph and the published version stay in sync.

#### Collecting extensions

```ts
function extension<Target extends ExtensionTarget, Schema extends StandardSchemaV1>(
  identity: string,
  config: { schema: Schema; target: Target; collect?: false | undefined },
): Extension<Target, Schema>;
function extension<Target extends ExtensionTarget, Schema extends StandardSchemaV1>(
  identity: string,
  config: { schema: Schema; target: Target; collect: true },
): Extension<Target, Schema, true>;

interface AnyExtension {
  readonly identity: string;
  readonly target: ExtensionTarget;
  readonly collect: boolean;
}

interface Extension<
  Target extends ExtensionTarget = ExtensionTarget,
  Schema extends StandardSchemaV1 = StandardSchemaV1,
  Collect extends boolean = false,
> extends AnyExtension {
  (input: StandardSchemaV1.InferInput<Schema>): ExtensionValue<Target>;
  readonly schema: Schema;
  readonly target: Target;
  readonly collect: Collect;
}

type NodeFor<Target extends ExtensionTarget> = Target extends 'command'
  ? CommandNode | AttachedCommand
  : Target extends 'option'
    ? OptionNode
    : ArgumentNode;

type ExtensionRead<Schema extends StandardSchemaV1, Collect extends boolean> = Collect extends true
  ? readonly DeepReadonly<StandardSchemaV1.InferOutput<Schema>>[]
  : DeepReadonly<StandardSchemaV1.InferOutput<Schema>> | undefined;

function readExtension<Target extends ExtensionTarget, Schema extends StandardSchemaV1, Collect extends boolean = false>(
  node: NodeFor<Target>,
  descriptor: Extension<Target, Schema, Collect>,
): ExtensionRead<Schema, Collect>;
// DeepReadonly<Value> makes a value read-only to any depth, arrays included.
```

```ts
// A plugin declares the extension in its declarations module.
export const notesCommand = extension(`${Package.name}/command`, {
  collect: true,
  schema: z.object({ note: z.string() }),
  target: 'command',
});

// The author supplies a value, and another plugin's hook supplies one more.
const get = new Command('get', { extensions: [notesCommand({ note: 'Read one value.' })] });
const supplier = plugin('@acme/supplier', {
  onCommandAttach: (command) => command.extend(notesCommand({ note: 'Paths are dot-separated.' })),
});

// The declaring plugin's middleware reads both, author first.
const middleware: Middleware<Plugin> = async ({ command, out }) => {
  for (const { note } of readExtension(command, notesCommand)) {
    await out.print(note); // 'Read one value.', then 'Paths are dot-separated.'
  }
};
```

A collecting extension lets an open set of suppliers give facts to the one plugin that declares it. The author and any plugin supply values, each value is kept, and the declaring plugin reads them all and needs no code for any supplier. [ADR-0031](decisions/0031-a-plugin-supplies-facts-to-another-plugins-projection-through-a-collecting-extension.md) records the decision.

- **Declaration.** `collect: true` makes an extension collecting. Without it, or with `collect: false`, the extension is ordinary and keeps the replacement rule above. `extension()` publishes `collect` as `false` when the config omits it or holds `undefined`, and otherwise as given. The call that receives a descriptor rejects one whose `collect` is neither `true` nor `false`, a hand-built descriptor with no `collect` property included.
- **Collection.** A Command keeps every value of a collecting extension it carries, in collection order: the constructor's `extensions`, then each `extend()` layer in authoring order, then each value a lifecycle hook adds, hooks in installation order and each hook's `extend()` calls in call order. A later value never replaces an earlier one, and values never merge: each is its own validated output. One layer still holds at most one value of an extension, so two values in one `extensions` list or in one `extend()` call are the two-values error. An option and an argument have one layer and no hook call reaches them, so a collecting extension on either holds no value or one.
- **Storage.** Each value is validated by the descriptor's schema and stored as plain data, as any extension output is. The declaration's record holds the frozen array of outputs under the identity, and a declaration that carries no value of the extension has no key for it.
- **Read.** Through a collecting descriptor, `readExtension` returns the array, read-only to any depth, or `[]` when the node carries no value, so a reader never branches on absence. The by-reference descriptor check is unchanged.
- **Suppliers.** An author supplies a value as with any extension. A plugin supplies values from its `onCommandAttach` hook through `extend()`, importing the declaring plugin's declarations module, and the declaring plugin need not be installed; its values are then inert, as any extension value of an uninstalled plugin is. A value names no supplier: which plugin or which layer supplied it is provenance, and neither the node nor a read reports it.

The collecting extension is proven when public APIs alone show, under Node and Bun: help's values under `manifestCommand` on textstat's root and on jsonkit's root and `get`, read through `inspect()`, and in a fixture application with no manifest plugin installed; an author's `manifestCommand` value on jsonkit's `get` collected ahead of help's; `[]` from `readExtension` on a Command that carries neither; two values in one layer rejected; values from two layers and from two hooks kept in collection order; a hook reading an author value and an earlier hook's value through `readExtension`; an invalid author value reported ahead of a hook that throws; a value a hook passes to `extend()` rejected at the call with the invalid-value diagnostic, and a hook that catches that throw continuing without the value; each value's schema called once; an ordinary extension still replaced across layers and across hooks; a collecting extension on an option holding one value; and a `collect` that is not a Boolean rejected.

### Views from plugins

A plugin's `views` list holds the views it declares and the overrides it makes, in one list, the way `extensions` holds descriptors on a plugin and values on a declaration. A declared view is the value `view(identity, definition)` returned, its identity checked against the [identity grammar](#identity-and-installation) at that call, and listing it is what puts its identity on the graph for the duplicate rule; an override is the value `override(key, view)` returned, and it enters the resolution [Views](#views) describes: the application's overrides first, then each plugin's in installation order, then the declaring contributor's default. A plugin can override a view another plugin declares. A plugin can list an override for its own declared view, and it resolves like any other, but the declared default is the place for that function. Two overrides for one key inside one contributor are a declaration error from the call that holds the list; the same key overridden by the application and by a plugin, or by two plugins, resolves first-in-wins.

Overriding a plugin's view replaces its function alone: the plugin stays installed and its middleware, options, and facts are unchanged. Replacing the capability itself still means omitting the plugin and installing another, the rule the [first-party plugins](#first-party-plugins) follow.

```ts
// src/help/plugin.ts
import { plugin } from '@loomcli/core';

import { attachHelp } from './attach.js';
import { helpArgument, helpCommand, helpInput } from './extension.js';
import { helpHint } from './hint.js';
import { helpPage } from './views.js';

export function help(): Plugin<HelpOptions> {
  return plugin(`${Package.name}/help`, {
    extensions: [helpArgument, helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
    onCommandAttach: attachHelp,
    onFailure: helpHint,
    options,
    views: [helpPage],
  });
}
```

### Signals and cancellation

Every run creates one private cancellation controller and exposes its signal to each middleware and to the action context as `signal`. Two things can abort it. A caller passes `signal` in the run options, which is the path for an embedding host or a test; core subscribes to it at run entry and honors an abort at every phase boundary from then on. Or one installed plugin claims the signals slot by listing the signals it owns, `SIGINT`, `SIGTERM`, or both, and core installs a process listener for each once the graph has built and validated, and removes it on every exit path of that run, so an Application can run again and a test leaks no listener. The slot has one owner: a second claim is a declaration error from the Application constructor naming both plugins, and `plugin()` rejects a signal outside the closed set and a signal claimed twice, because core installs one listener per entry. An empty list claims nothing and leaves the slot free. With no owner and no run signal, core installs nothing.

```ts
export function signals() {
  return plugin(Package.name, { signals: ['SIGINT', 'SIGTERM'] });
}
```

The first cause to abort the controller fixes the run's cancellation reason and code: 130 for `SIGINT`, 143 for `SIGTERM`, and 130 for a caller-supplied abort. A later cause changes neither. Core keeps awaiting the chain: a middleware or action already running reads `signal` and finishes on its own terms, and core never ends the process on a first signal. Core starts nothing new after cancellation: a middleware the chain has not reached and an action not yet dispatched are skipped, a loader already in flight settles and its middleware is skipped, and the entries already running unwind in order. A loader has the standing an action has: a module import cannot be aborted, so core awaits it, and a loader that never settles holds the run open exactly as an action that ignores the signal does, until the force path or a supervisor ends the process. A cancelled run resolves its cancellation code whenever it ends after graph build with no declaration or internal failure raised before the chain starts, whether or not the chain was reached; such a failure ends the run with its own code, an abort that lands during build included. A run whose caller signal is already aborted at entry still builds and validates the graph, installs no process listeners, and otherwise resolves 130 having loaded no plugin and run no middleware or action.

Work that must happen at the moment of the signal, such as restoring the cursor or leaving raw mode, belongs in a synchronous listener the plugin adds to `signal` before it changes terminal state; it runs even when the action ignores the abort. For a run with a slot owner, any process signal that arrives after the run is cancelled, by any cause, is the force path: core removes its own listeners for that run and re-raises the signal. The default disposition then ends the process with the conventional status when no other listener remains. Core does not own the process. A re-raised signal reaches every listener still installed. An embedding host's own listener sees it. A second run in the same process that owns the slot receives the original signal and the re-raise alike, and applies its own rule to each: not yet cancelled, it cancels and absorbs the signal; already cancelled, it removes its listeners and re-raises in turn. The force path is defined for one slot-owning run per process. With several, each run applies its own rule to each signal it receives: a run not yet cancelled cancels and absorbs the signal, and a cancelled run removes its listeners and re-raises, so the process ends only once no run's listener remains. When a listener outside core keeps the process alive, the run that re-raised observes no further signals and keeps awaiting the chain. An embedding host that runs several Applications in one process supplies `run({ signal })` and installs no slot owner; with no owner, core holds no listener, and a process signal has its default effect. A listener that blocks the event loop delays the second signal's handling until it yields, as it delays everything else.

The signal decides the code whatever the action did afterward, because a script that sees 0 after an interrupt carries on as if the work finished. Core aborts the private signal with a reason it owns, the exported `CancellationReason`, `{ source: 'SIGINT' | 'SIGTERM' | 'caller', cause?: unknown }`, where `cause` carries the caller's own `signal.reason` when the caller aborted, so a middleware reads `source` and never infers a signal name. An API that rejects with `signal.reason`, as `fetch` does, throws that reason itself; a thrown value that is the reason, or an error named `AbortError`, is silent. Any other failure after cancellation is rendered as usual, and the code stays the signal's. A first signal that arrives after the chain has settled, while core is rendering a failure or finishing output, still cancels the run and decides its code; a further signal in that window changes the code no further, and for a slot owner the force path still applies until `run()` resolves. One rule orders every code: a cancelled run, as defined above, resolves its signal's code, and a broken failure view, `onFailure` hook, or destination in that run is reported as text without changing it; otherwise a broken failure view, `onFailure` hook, or destination forces 1 over the primary outcome, the accepted view rule; otherwise the primary failure or the action decides, and a throw during unwinding turns a would-be 0 into 1.

```ts
type ExitCode = 0 | FailureExitCode | 130 | 143;
```

The published `ExitCode` type widened from `0 | 1 | 2` to add the two cancellation codes, and it widens again to every code a failure class can declare under [Declared exit codes](#declared-exit-codes), so a consumer that switches exhaustively on it handles that range.

### Plugin declaration errors

Each rule below is a `DeclarationError` with code 1 that throws at the moment [Declaration faults](#declaration-faults) assigns it. The following reach JavaScript authors alone, because the types already reject the declaration: every shape rule on the `plugins` slot and on one plugin's definition, `options` record, single option declaration, `middleware` object, `onCommandAttach`, `onGraphBuilt`, and `onFailure` functions, `extensions` list, `views` list, `failureEncoders` list, `signals` list, and `commands` list; an `encodeFailure()` media type that is not a string or encoder that is not a function; a `views` entry that is neither a declared view nor an override, since the list is typed as `ViewContribution[]`; the two `extensions` rules a plugin's own list carries, a value that is not a descriptor and a descriptor with no schema; a descriptor whose `collect` is not a Boolean, since `AnyExtension` requires one; an `extensions` entry on a declaration that is not an extension value; an extension value on the wrong target, since each config object's `extensions` slot is typed by target; a signal outside the closed set, since the `signals` list is typed by that set; and a plugin's option with a presence rule, since `GlobalOptionConfig` omits those keys. The activation-name rule reaches a TypeScript author only for a plugin that declares no options. The identity rule reaches every author, because the types accept any string.

| Rejected declaration                             | Diagnostic                                                                                                                                                                              | Rule |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A `plugins` value that is not an array           | `The Application declares plugins that are not an array. Supply a list of plugin values.`                                                                                               | `@loomcli/core/not-a-list` |
| A `plugins` entry that is not a plugin           | `The Application holds a value that is not a plugin. Supply the value returned by plugin(identity, definition).`                                                                        | `@loomcli/core/foreign-value` |
| An identity installed twice                      | `The Application installs plugin "@loomcli/plugins/help" twice. Install each plugin once.`                                                                                                      | `@loomcli/core/plugin-installed-twice` |
| A `plugin()`, `extension()`, or `view()` identity outside the grammar | `A plugin declares the identity "Help", which is not a package name with optional kebab-case subpath segments. Name it <package>[/<subpath>...], such as "@acme/notes" or "@acme/notes/page".` `extension()` reads `An extension declares` and `view()` reads `A view declares`. An empty identity reads `the identity ""`, and a value that is not a string prints as a finding prints it, such as `the identity 7`. | `@loomcli/core/invalid-identity` |
| A definition that is not an object               | `Plugin "@loomcli/plugins/help" declares a definition that is not an object. Supply { options, middleware, extensions, views }.`                                                             | `@loomcli/core/not-an-object` |
| A definition that throws while core reads it, from a getter or a proxy trap on the definition, its theme, `options` record, `middleware`, `activate` list, `source`, or one of its lists | `Plugin "@loomcli/log" definition could not be read: boom. Declare the definition as a plain object literal whose properties read without throwing.` The finding marks the top-level slot whose read threw, such as `middleware` for a throw in its `activate` list, or the whole definition when the definition itself threw, and prints it elided. The thrown value is the fault's `cause`. | `@loomcli/core/unreadable-declaration` |
| An `options` value that is not an object         | `Plugin "@loomcli/log" declares options that are not an object. Supply a record of option declarations.`                                                                                | `@loomcli/core/not-an-object` |
| A `middleware` value that is not an object       | `Plugin "@loomcli/plugins/help" declares middleware that is not an object. Supply { activate, load }.`                                                                                          | `@loomcli/core/not-an-object` |
| An option config that is not a declaration       | `Plugin "@loomcli/log" option "level" is not an option declaration. Supply { type, ... }.`                                                                                              | `@loomcli/core/not-an-object` |
| Plugin factory settings that are not an object, judged by `checkPluginSettings` or `checkShortSetting` | `Plugin "@loomcli/plugins/format" declares settings that are not an object. Supply a settings object, or omit the settings.` | `@loomcli/core/not-an-object` |
| A settings `short` that is not one ASCII letter, judged by `checkShortSetting` | `Option "format" declares a short alias that is not one ASCII letter. Supply one ASCII letter.` The finding quotes the factory's call and names the plugin. | `@loomcli/core/short-alias` |
| One option's config object that throws while core reads it, its `extensions` list included | `Plugin "@loomcli/log" option "level" config could not be read: boom. Declare the config as a plain object literal whose properties read without throwing.` The finding marks the config's top-level key whose read threw, or the whole config, and prints it elided. The thrown value is the fault's `cause`. | `@loomcli/core/unreadable-declaration` |
| A plugin's option with a presence rule           | `Plugin "@loomcli/log" option "level" declares <required or validateOmitted>. Remove <required or validateOmitted>, and check for the value in each Command that needs it.` It is the global option rule, because a plugin's options are global options, and it throws from `plugin()` whatever the key's value. | `@loomcli/core/global-presence-rule` |
| A plugin's option that repeats a global key      | `Option "help" is declared by plugin "@loomcli/plugins/help" and as a global option. Rename one declaration.`                                                                                    | `@loomcli/core/option-declared-twice` |
| A plugin's option that repeats a local key       | `Option "help" is declared by plugin "@loomcli/plugins/help" and as a local option on Command "get". Rename the local option.` A local option a plugin's hook declared reports through the hook-collision row below instead.                                                                   | `@loomcli/core/option-declared-twice` |
| Two plugins declaring one option key             | `Option "verbose" is declared by plugin "@loomcli/log" and plugin "@acme/trace". Install one of them or rename the option.`                                                              | `@loomcli/core/option-declared-twice` |
| A plugin's option spelling used elsewhere        | `Option spelling "-h" is used by plugin "@loomcli/plugins/help" option "help" and the global option "host". Change one declaration.`                                                             | `@loomcli/core/spelling-taken` |
| A middleware without activation                  | `Plugin "@loomcli/plugins/help" declares middleware with no activation. Supply activate: 'always' or a list of the plugin's own option names.`                                                   | `@loomcli/core/middleware-activation` |
| An empty activation list                         | `Plugin "@loomcli/plugins/help" declares middleware with an empty activation list. Name at least one of the plugin's options or use 'always'.`                                                   | `@loomcli/core/middleware-activation` |
| An activation naming an undeclared option        | `Plugin "@loomcli/plugins/help" activates middleware on option "hlep", which it does not declare. Name one of the plugin's own options.`                                                         | `@loomcli/core/middleware-activation` |
| A middleware without a loader                    | `Plugin "@loomcli/plugins/help" declares middleware with no load function. Supply load: () => import('./middleware.js').`                                                                       | `@loomcli/core/not-a-function` |
| A second claim on the signals slot               | `Plugin "@acme/trace" claims the signals slot, which plugin "@loomcli/signals" already holds. Install one owner.`                                                                       | `@loomcli/core/slot-taken` |
| A signal outside the closed set                  | `Plugin "@loomcli/signals" claims signal "SIGHUP". Claim SIGINT or SIGTERM.`                                                                                                             | `@loomcli/core/unknown-signal` |
| A signal claimed twice                           | `Plugin "@loomcli/signals" claims signal "SIGINT" twice. Claim each signal once.`                                                                                                        | `@loomcli/core/signal-claimed-twice` |
| A plugin `translators` entry that is not a translation | `Plugin "@acme/http" holds a translator entry that is not a translation. Supply the value returned by translate(ErrorClass, translator).` The Application's list reads `The Application holds` in place of `Plugin "@acme/http" holds`. A `translators` value that is not an array reads `Plugin "@acme/http" declares translators that are not an array. Supply a list of values returned by translate(ErrorClass, translator).` under `@loomcli/core/not-a-list`. | `@loomcli/core/foreign-value` |
| A `translate()` key that is not a class          | `translate() received a key that is not a class. Supply an error class, such as SyntaxError.`                                                                                          | `@loomcli/core/translation-key` |
| A `translate()` key that is a failure class      | `translate() received a failure class as its key. Key the translation on the foreign class it replaces.` A key that is not a class reports the row above first. | `@loomcli/core/translation-key` |
| A translator that is not a function              | `translate() received a translator that is not a function. Supply a function that returns a failure or undefined.`                                                                     | `@loomcli/core/not-a-function` |
| A `failureEncoders` entry that is not an encoding | `Plugin "@acme/json" holds a failure encoder entry that is not an encoding. Supply the value returned by encodeFailure(mediaType, encoder).` A `failureEncoders` value that is not an array reads `Plugin "@acme/json" declares failureEncoders that are not an array. Supply a list of values returned by encodeFailure(mediaType, encoder).` under `@loomcli/core/not-a-list`. | `@loomcli/core/foreign-value` |
| An `encodeFailure()` media type that is not a string | `encodeFailure() received a media type that is not a string. Supply a media type such as "application/json".` | `@loomcli/core/media-type` |
| An encoder that is not a function                | `encodeFailure() received an encoder that is not a function. Supply a function of the failure form that returns a string.` | `@loomcli/core/not-a-function` |
| Two failure encoders for one media type          | `Plugin "@acme/json" registers two failure encoders for "application/json". Register one.` `plugin()` throws it. Two plugins read `Plugin "@acme/json" registers a failure encoder for "application/json", which plugin "@loomcli/plugins/format" already registers. Install one of them.`, which the Application constructor throws, with a finding for each entry. | `@loomcli/core/failure-encoder-taken` |
| A `diagnosticRule()` identity outside the grammar | `Diagnostic rule "Retry Limit" has no package part, or a subpath or rule name that is not kebab-case. Name it <package>[/<subpath>...]/<kebab-case-rule>, such as "@acme/retry/retry-limit".` An empty segment, an uppercase letter in any segment, and a trailing `/` read the same sentence.                   | `@loomcli/core/rule-identity` |
| A `diagnosticRule()` with an empty headline or explanation | `Diagnostic rule "@acme/retry/retry-limit" declares an empty headline. Supply a short noun phrase.` An empty explanation reads `declares an empty explanation. Supply prose that says why the rule exists.` | `@loomcli/core/rule-prose` |
| A `diagnosticRule()` docs value that is not a URL | `Diagnostic rule "@acme/retry/retry-limit" declares docs that are not a URL. Supply an absolute https URL, or omit docs.`                                                             | `@loomcli/core/rule-docs` |
| A plugin `extensions` entry that is not a descriptor | `Plugin "@loomcli/plugins/help" holds a value that is not an extension. Supply the value returned by extension(identity, config).`                                                          | `@loomcli/core/foreign-value` |
| An `extensions` entry that is not an extension   | `Command "get" holds a value that is not an extension value. Supply the value returned by calling an extension.` An `extensions` value on a declaration that is not an array reads `Command "get" declares extensions that are not an array. Supply a list of values returned by calling an extension.` under `@loomcli/core/not-a-list`.                                                                        | `@loomcli/core/foreign-value` |
| A descriptor that declares no schema             | `Command "get" holds extension "@loomcli/plugins/help/command", which declares no schema. Supply a Standard Schema v1 object that answers synchronously.`                                       | `@loomcli/core/extension-without-schema` |
| A descriptor whose `collect` is not a Boolean    | `Extension "@acme/notes/command" declares collect that is not a Boolean. Use true or false.` Only a descriptor built by hand reaches it, because `extension()` always publishes a Boolean. | `@loomcli/core/flag-not-boolean` |
| An extension value on the wrong target           | `Command "get" holds extension "@loomcli/plugins/help/input", which applies to options. Supply an extension that applies to Commands.`                                                          | `@loomcli/core/extension-target` |
| Two values of one extension in one layer         | `Command "get" holds extension "@loomcli/plugins/help/command" twice. Supply one value.`                                                                                                         | `@loomcli/core/extension-value-twice` |
| Two descriptors sharing one identity             | `Extension "@loomcli/plugins/help/command" is defined twice. Install one copy of the package that defines it.`                                                                                   | `@loomcli/core/two-package-copies` |
| An extension value its schema rejects            | `Command "get" holds an invalid "@loomcli/plugins/help/command" value: <issue message>. Correct the value.` Core adds the full stop after the message only when the message carries none, so a schema message that ends with its own is not doubled.                                                                                      | `@loomcli/core/invalid-extension-value` |
| An extension schema that answers asynchronously  | `Extension "@loomcli/plugins/help/command" validates asynchronously. Supply a schema that answers synchronously.`                                                                                | `@loomcli/core/async-extension-schema` |
| An extension output that is not plain data       | `Extension "@loomcli/plugins/help/command" produced a value that is not plain data on Command "get". Return strings, numbers, booleans, null, arrays, and plain objects.`                       | `@loomcli/core/extension-output` |
| A `views` value that is not an array             | `Plugin "@loomcli/plugins/help" declares views that are not an array. Supply a list of declared views and override values.`                                                                    | `@loomcli/core/not-a-list` |
| A `views` entry that is neither a view nor an override | `Plugin "@loomcli/plugins/help" holds a value that is not a view. Supply the value returned by view(identity, definition) or override(key, view).`                                          | `@loomcli/core/foreign-value` |
| Two distinct objects sharing one view identity   | `View "@loomcli/plugins/help/page" is declared by two distinct objects. Install one copy of the package that declares it.` A plugin's override key from a second copy of a package reports the same sentence.                                                                                        | `@loomcli/core/two-package-copies` |
| An `extensions` value that is not an array       | `Plugin "@loomcli/plugins/help" declares extensions that are not an array. Supply a list of extension descriptors.`                                                                             | `@loomcli/core/not-a-list` |
| A `signals` value that is not an array           | `Plugin "@loomcli/signals" declares signals that are not an array. Supply a list of signal names.`                                                                                       | `@loomcli/core/not-a-list` |
| A `commands` value that is not an array          | `Plugin "@acme/doctor" declares commands that are not an array. Supply a list of Command values.`                                                                                       | `@loomcli/core/not-a-list` |
| A `commands` entry that is not a Command         | `Plugin "@acme/doctor" holds a value that is not a Command. Supply the value returned by new Command(name).`                                                                            | `@loomcli/core/not-a-command` |
| A plugin overriding one key twice                | `Plugin "@loomcli/plugins/help" overrides the view for "InputError" twice. Remove one override.` For a declared view the sentence reads `Plugin "@acme/brand" overrides view "@loomcli/plugins/help/page" twice. Remove one override.`                                                                                                | `@loomcli/core/override-twice` |
| A hook that is not a function                    | `Plugin "@loomcli/plugins/format" declares onCommandAttach that is not a function. Supply a function of the Command.`                                                                                    | `@loomcli/core/not-a-function` |
| An `onFailure` that is not a function            | `Plugin "@acme/suggest" declares onFailure that is not a function. Supply a function of the failure and its context.` | `@loomcli/core/not-a-function` |
| A hook that returns something else               | `Plugin "@loomcli/plugins/format" returned a value that is not the attached Command from onCommandAttach for Command "count". Return the value it received or a value derived from it.`                  | `@loomcli/core/broken-attach-hook` |
| An `onGraphBuilt` that is not a function         | `Plugin "@loomcli/plugins/mcp" declares onGraphBuilt that is not a function. Supply a function of the built graph.` | `@loomcli/core/not-a-function` |
| An `onGraphBuilt` that returns a value           | `Plugin "@loomcli/plugins/mcp" returned a value from onGraphBuilt. Return nothing from the hook; it judges the graph and cannot change it.` A returned promise reads the same sentence. | `@loomcli/core/broken-graph-hook` |
| An `onGraphBuilt` that throws                    | `Plugin "@loomcli/plugins/mcp" failed in onGraphBuilt: <reason>. Return nothing from the hook, and throw only a DeclarationError to reject the graph.` The reason is the thrown value's, escaped, with a full stop added when it carries none, and the thrown value is the fault's `cause`. A thrown `DeclarationError` reports as itself instead. | `@loomcli/core/broken-graph-hook` |
| A hook that throws                               | `Plugin "@loomcli/plugins/format" failed in onCommandAttach for Command "count": <reason>. Return the value the hook received or a value derived from it, and throw only a DeclarationError from the hook.` The reason is the thrown value's, escaped, with a full stop added when it carries none, and the thrown value is the fault's `cause`. A thrown `DeclarationError` reports as itself instead.                                                        | `@loomcli/core/broken-attach-hook` |
| A hook-declared input that collides              | `Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as a local option. Rename the Command's option or omit the plugin.` A hook-declared argument reports the same way, `declares argument "tag"` in place of `declares option "format"`. The clause after "declared as" names what it collides with, one set shared by both kinds of hook-declared input: `a local option`, `a global option`, `an option of plugin "@acme/out"`, `an option plugin "@acme/out" declared through onCommandAttach`, `an argument`, or `an argument plugin "@acme/out" declared through onCommandAttach`. The remedy follows the target alone, whichever kind the hook declared: `Rename the Command's option or omit the plugin.` against a local option, `Rename the Command's argument or omit the plugin.` against an argument, `Rename the global option or omit the plugin.` against a global option, and `Install one of them.` against another plugin's input, whether the option is a global option or an earlier hook declared the option or the argument. A spelling collision reads `declares option "format" with spelling "-f" on Command "count", which "--file" already uses. Change one of the two spellings or omit the plugin.` A collision carries a finding for the hook's input and one for the declaration that already holds the name or spelling. Each collision reports under the rule the application's own collision of that pair breaks: two options under one key under `@loomcli/core/option-declared-twice`, two arguments under one name under `@loomcli/core/argument-declared-twice`, and a spelling under `@loomcli/core/spelling-taken`. An argument and an option under one name report under `@loomcli/core/name-shared-across-kinds`, which only a hook reaches, because an author's argument and option may share a name. | `@loomcli/core/option-declared-twice`, `@loomcli/core/argument-declared-twice`, `@loomcli/core/spelling-taken`, `@loomcli/core/name-shared-across-kinds` |

An `extensions` fault on the Application names the root Command, the declaration that carries the value, so it reads `The root Command holds ...`. A schema that throws where it is called rejected the value the only way it could, so it reports through the invalid-value row with the thrown reason as its message.

Six faults surface at invocation time rather than at declaration, as defects with code 1, which `run()` renders by build under [Development builds](#development-builds): the loader faults under `@loomcli/core/plugin-loader-failed`, the two `next()` faults under `@loomcli/core/next-misuse`, and the three `view` faults under `@loomcli/core/view-selection`. Their sentences are `Loading plugin "@loomcli/plugins/help" failed: <reason>` when `load` throws or rejects, with `the module exports no default middleware function.` as the reason when the loader resolves to a module that exports no default middleware function, `Plugin "@loomcli/plugins/help" called next() twice.`, `Plugin "@loomcli/plugins/help" called next() after its middleware returned.`, `Plugin "@loomcli/plugins/format" selected view "yaml", which Command "count" does not name.` when a middleware assigned `view` a name the routed Command's record does not hold, `Plugin "@loomcli/plugins/format" selected a view that is not a string on Command "count".` when the value assigned is not a string, and `Plugin "@loomcli/plugins/format" selected view "json" on Command "get", which declares no result.` The no-result sentence wins when both apply. A starting selection [`invoke()`](#invocation-by-name) made that no middleware replaced reports the same three faults with `invoke()` in place of `Plugin "<identity>"`. The three `view` faults are raised at the dispatch boundary, and a takeover or a cancellation that never lets the chain reach it leaves a bad assignment unobserved. A typed read through a descriptor that did not produce the stored value throws a `DeclarationError`, `Extension "@loomcli/plugins/help/command" was read through a descriptor that did not define the stored value. Install one copy of the package that defines it.`, which the failure path reports with code 1 when it happens inside a run. A configuration source has its own invocation-time faults, listed under [Input source declaration errors](#input-source-declaration-errors). A broken `onFailure` hook is an invocation-time fault too, and [Failure hints](#failure-hints) states its line.

### Example coverage

The plugin increment is proven when both example applications install a plugin through `plugins` and public APIs alone. The acceptance tests cover the seam with in-repository fixture plugins rather than a published package: one with option-activated middleware whose implementation module records its own evaluation, so a test shows the module is never loaded on an invocation that does not supply its option and never loaded when an earlier middleware takes over; one with always-on middleware that wraps `next()` and observes each outcome value; one whose loader is pending when a caller abort lands, so a test shows the run resolves 130 once the loader settles and the middleware never runs; one that claims the signals slot, with a second claimant failing at construction and no listener surviving a run; and one that defines an extension both examples attach to a Command. The first-party help and version plugins are specified in [First-party plugins](#first-party-plugins) and land after the seam exists.

## First-party plugins

`@loomcli/plugins` is the plugin pack: the one first-party package that ships every first-party plugin as its own subpath export, `@loomcli/plugins/<plugin>`. Each one is an ordinary plugin under the [contract above](#plugins): an entry module with the annotated factory at the subpath and the exported options type when it declares options, an extension module of declarations alone at `<subpath>/extension` when the plugin defines facts, a views module at `<subpath>/views` when it declares views, a middleware module the entry loads lazily when the plugin acts on an invocation, and a source module the entry loads lazily through `source.load` when the plugin declares a configuration source. A plugin's identity is `${Package.name}/<plugin>`, the convention for a package that ships several, so the help plugin is `@loomcli/plugins/help` and its descriptors are `@loomcli/plugins/help/command` and `@loomcli/plugins/help/input`. A subpath imports nothing from a sibling subpath except the sibling's declarations module at `<subpath>/extension`, which it imports to supply values to a [collecting extension](#collecting-extensions) the sibling declares; it never imports a sibling's entry, middleware, or views module. The package has no root export, so an application that installs one plugin bundles one, plus the declarations of any collecting extension that plugin supplies, and importing the package installs nothing. The package lives at `packages/plugins` and is released at the one synchronized version every first-party library shares. The pack ships help, version, the formatter, the [manifest](#manifest), the [configuration plugin](#configuration), [completion](#completion), [suggestions](#suggestions), [MCP](#mcp), the bare `theme(mapping)` factory of [Theme plugins and typed names](#theme-plugins-and-typed-names), and the `table` and `records` pack views of [Table](#table) and [Records](#records).

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

import Package from '../package.json' with { type: 'json' };

export const jsonkit = new Application('jsonkit', {
  description: 'Read and reshape one JSON document.',
  plugins: [help(), version()],
  version: Package.version,
});
```

The help factory takes no parameters, so an application installs help as it is, and the version factory takes an optional `postfix` under [Version](#version). A spelling a plugin reserves is a declaration error for an application option that uses it, under [Global options from plugins](#global-options-from-plugins), and the application renames its own option. No first-party plugin claims the signals slot; the theme factory claims the theme slot, which is its whole contribution. Help needs no slot of its own, because being the only help plugin is not an invariant core has to hold: the same plugin installed twice fails on its identity, a second help plugin that shares a spelling fails on the option table, and a second one with its own spellings installs beside it and takes its turn in installation order. Replacing help means omitting `help()` and installing the other plugin; restyling its page means overriding `helpPage` under [Views](#views) while `help()` stays installed. Help's page reads the graph and its plugin's own option alone, so it is a projection in the sense [Graph inspection](#graph-inspection) gives the word: it adds nothing the graph does not hold. The version line is that projection of the graph's name and version, plus the postfix, which is its plugin's own setting and no graph fact. Help's hook restates help's own facts under the manifest's collecting extension, as [Help in the manifest](#help-in-the-manifest) states, so it adds no fact the graph did not already hold. The formatter is not one: its hook adds an option and two views to the graph, and its middleware reads the request, as [Formatter](#formatter) states.

### Version

```ts
// @loomcli/plugins/version
export interface VersionSettings {
  readonly postfix?: string;
}

export declare function version(settings?: VersionSettings): Plugin<VersionOptions>;

// @loomcli/plugins/version/views
import type { CommandGraph, DeclaredView } from '@loomcli/core';

export interface VersionLine {
  readonly graph: CommandGraph;
  readonly postfix: string | undefined;
}

export declare const versionLine: DeclaredView<VersionLine>;
```

For an Application that declares `version: '0.2.0'`, `version()` prints the first line and `version({ postfix: '(Report schema v1)' })` the second:

```text
jsonkit v0.2.0
jsonkit v0.2.0 (Report schema v1)
```

- **Style.** The application name uses `style.highlight.bold`, and the version, including its `v`, uses `style.primary`. One unstyled space separates them. A postfix follows the version after one more unstyled space and uses `style.dim`. Each graph string and the postfix are escaped before styling. The line ends with exactly one newline and adds no logo, branding glyph, or label.
- **Postfix.** `postfix` is text the application prints after the version, such as the schema a binary speaks. It is one line of prose under the rule every core fact string follows, judged at the `version()` call: a value that is not a string, is blank, or holds a line terminator throws a `DeclarationError` from `version()` under `@loomcli/plugins/version/postfix`, headlined `Invalid version postfix`: `Plugin "@loomcli/plugins/version" postfix must be a string that holds a character other than whitespace and no line terminator. Supply one line, such as "(Report schema v1)", or omit the postfix.` The finding rebuilds the `version()` call and marks `postfix`. Settings that are not an object are the `@loomcli/core/not-an-object` fault, judged first through core's [`checkPluginSettings`](#plugin-settings). The postfix is a setting of the plugin, not a graph fact, so `graph.version`, the manifest, and every other projection are unchanged by it.
- **Policy.** Core resolves these semantic styles under the existing [rendering policy](#styles-and-rendering-policy). Installing `loomTheme()` supplies copper for highlight. The version plugin requires no theme, chooses no color, and reads no host capability.

`version()` declares one Boolean option, `version`, with the short spelling `V`, the description `Print the version.`, and `control: true`, because it asks for the version and feeds no Command's work under [Control options](#control-options), so an invocation spells it `-V` or `--version`, and a middleware activated by it. The middleware renders one line to stdout through the plugin's declared view, `versionLine`, a `DeclaredView<VersionLine>` exported from `@loomcli/plugins/version/views` and listed in the plugin's `views`. Its data is the graph and the postfix the `version()` call took, `undefined` when it took none. Its default function returns the text `<name> v<version>\n` from `graph.name` and `graph.version`, or `<name> v<version> <postfix>\n` with a postfix, with the styling above, and the middleware calls `out.render({ graph, postfix }, versionLine)` and returns without calling `next()`, so the exit code is 0, nothing later in the chain runs, the action never dispatches, and a fault core held from parsing or validation is never raised. An application overrides `versionLine` to restyle the line while `version()` stays installed; the replacement reads `graph` and `postfix`, and it can call `versionLine.render(line, context)` to build on the default line. An application whose manifest reads `0.2.0` prints `jsonkit v0.2.0`. When the declared version already starts with a lowercase `v`, the line carries that `v` once, so a declared `v0.2.0` prints `jsonkit v0.2.0` too; an uppercase `V` or any other first character is printed after the added `v` as declared. The rule is rendering alone, and `graph.version` holds the declared string. The middleware reads no host fact, no extension, and no option beyond its own, and the routed Command does not change the line: `jsonkit get --version` prints the same line, because the version is a fact of the Application.

`version` is never absent on the graph. An Application that omits it declares `0.0.0`, which means unversioned, so `CommandGraph.version` is a `string` and no projection branches on its absence. An explicit `0.0.0` reads the same, and core keeps no record of which one the author wrote. A declared version follows the one-line rule every core fact string follows, so the line the plugin prints is one line; core otherwise neither validates nor normalizes it.

### Help

`help()` declares one Boolean option, `help`, with the short spelling `h`, the description `Show this help.`, and `control: true` under [Control options](#control-options), a middleware activated by it, the three extensions below, the `onCommandAttach` hook of [Help in the manifest](#help-in-the-manifest), and the `onFailure` hook of [Help's failure hint](#helps-failure-hint). The middleware renders the [help page](#the-help-page) of the routed Command through the plugin's declared view, `helpPage`, a `DeclaredView<HelpPage>` where `HelpPage` is `{ readonly graph: CommandGraph; readonly command: CommandNode; readonly variant: HelpVariant }`. It derives the [variant](#help-variants) from `spellings.help`, calls `out.render({ command, graph, variant }, helpPage)`, and returns without calling `next()`, so the exit code is 0. The default function derives the page content from `graph`, `command`, and `variant` alone and ends the page with exactly one newline. The installed view escapes raw fragments before styling, as specified by the [help restyle](#help-and-version-restyle). Stdout holds the resolved page and one line terminator. An application overrides `helpPage` to change the page while `help()` stays installed, which is the acceptance target of the registry increment; the data it receives is the graph, the routed node, and the variant, and a replacement owns its own escaping, layout, and newline. The restyle retains `{ graph, command }`, help variants add `variant`, and neither adds a public structured page model or builder. `jsonkit --help` renders the root, `jsonkit get --help` renders `get`, and `jsonkit cache --help` renders the `cache` group, because the group's missing-subcommand fault is held before the chain and raised at the dispatch boundary, which the takeover never reaches. An unknown command still fails in routing, so `jsonkit nope --help` reports the unknown command. A fault core held from local parsing or validation is never raised under the takeover, so `jsonkit get --help` renders while `get` is missing its required `path`, and `jsonkit select --bogus --help` renders too. Like every global option, `--help` is read at any placement before `--`, in a short group with the routed Command's local options included, and every fault but an unknown command is held, so `textstat -ht` renders the root's page and `jsonkit -F name select --help` renders it although `-F` is misplaced. There is no `jsonkit help get` form: a `help` command would share the namespace with the application's own commands, and it would be a second way to say one thing.

The page is derived from the graph and the variant by the rules below and nothing else, so a test compares the bytes of `jsonkit --help` with a page written by hand.

#### Help extensions

Three descriptors are exported from `@loomcli/plugins/help/extension`, and all are help's own facts; every other fact the page prints is a core fact. Each field is optional, and the descriptor's schema carries every rule below, so the call that receives a value that breaks one rejects it the way it rejects any extension value its schema rejects. The declared view is exported from `@loomcli/plugins/help/views`, a second declarations module, because it imports the page module: the page code loads with the plugin's entry module, the descriptor module stays declarations alone, and the middleware module holds nothing but the call. A graph fact that carries a marker character prints literally. The restyle escapes raw fragments before it adds style markers, and a replacement owns that escaping obligation.

```ts
// @loomcli/plugins/help/views
import type { CommandGraph, CommandNode, DeclaredView } from '@loomcli/core';

export type HelpVariant = 'compact' | 'extended';

export interface HelpPage {
	readonly graph: CommandGraph;
	readonly command: CommandNode;
	readonly variant: HelpVariant;
}

export declare const helpPage: DeclaredView<HelpPage>;
```

```ts
import { Application, override } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpPage } from '@loomcli/plugins/help/views';

const app = new Application('example', {
	plugins: [help()],
	views: [override(helpPage, {
		render: ({ graph, command }, { style }) =>
			`${style.primary(style.escape([graph.name, ...command.path].join(' ')))}\n`,
	})],
});
```

```ts
// src/lines.ts, the pack's line and prose rules, which belong to no subpath
import { z } from 'zod';

const terminator = /[\n\v\f\r\u0085\u2028\u2029]/u;
export const line = z.string().refine((value) => /\S/u.test(value) && !terminator.test(value), {
  message: 'Supply one line that holds a character other than whitespace.',
});
export const prose = z.string().refine((value) => value.split(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/u).every((each) => /\S/u.test(each)), {
  message: 'Supply prose whose every line holds a character other than whitespace.',
});
```

```ts
// src/help/extension.ts, the declarations module of the @loomcli/plugins/help subpath
import Package from '../../package.json' with { type: 'json' };
import { extension } from '@loomcli/core';
import { z } from 'zod';

import { line, prose } from '../lines.js';

const sectionPath = z.union([z.tuple([line]), z.tuple([line, line])]);

export const helpCommand = extension(`${Package.name}/help/command`, {
  schema: z.object({
    commandSections: z.array(sectionPath).optional(),
    details: prose.optional(),
    examples: z.array(z.object({ command: line, note: line.optional() })).optional(),
    optionSections: z.array(sectionPath).optional(),
    section: sectionPath.optional(),
  }),
  target: 'command',
});
export const helpInput = extension(`${Package.name}/help/input`, {
  schema: z.object({
    accepts: line.optional(),
    placeholder: z.string().regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.').optional(),
    section: sectionPath.optional(),
  }),
  target: 'option',
});
export const helpArgument = extension(`${Package.name}/help/argument`, {
  schema: z.object({ accepts: line.optional() }),
  target: 'argument',
});
```

`helpCommand` targets Commands, so a Command or the Application carries it. `details` is prose the page prints after the masthead, one authored line per page line, each indented two spaces, with line breaks kept and nothing wrapped; every line of it holds a character other than whitespace, so it adds no blank line of its own to the page and no line terminator at either end. `examples` lists invocations the page prints under EXAMPLES: `command` holds the tokens after the application name as one line, and `note` is one line printed under it. `helpInput` targets options, so a local option and a global option carry it, whoever declares it. `placeholder` is the word the page shows for a string option's value, `<path>` for a `--file` declared with `placeholder: 'path'`; it holds no whitespace, and without it the page shows the option's declared name. A `placeholder` on a Boolean or counted option is accepted and never shown, because neither takes a value. `accepts` is one line the page prints as the input's [accepted values](#accepted-values), in place of any list help would derive from the schema; an `accepts` on a Boolean or counted option is accepted and never shown, for the same reason. `helpArgument` targets arguments and carries `accepts` alone: an argument's placeholder is its declared name, which the author already chose, and its description is a core fact. The value a projection reads back through `readExtension` is the schema's output, deeply read-only, with an omitted field absent and an explicit `undefined` dropped, as every stored extension value drops it.

`section` places a Command or an option in an authored [help section](#ordered-help-sections). `commandSections` and `optionSections` order the sections on that Command's own help page. The fields are optional and belong to help, including on a global option a plugin declares. Arguments keep their existing block and gain no section field.

```ts
import { Application, Command } from '@loomcli/core';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';

export const configured = new Application('jsonkit').globalOption('file', {
  description: 'The document to read. Omit it to read piped text.',
  extensions: [helpInput({ placeholder: 'path' })],
  short: 'f',
  type: 'string',
});

const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [
    helpCommand({
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: [{ command: 'get user.name -f doc.json', note: 'A nested key.' }],
    }),
  ],
}).argument('path', { description: 'Dot path to read.', required: true });
```

```ts
import { Command } from '@loomcli/core';
import { helpArgument, helpInput } from '@loomcli/plugins/help/extension';
import { z } from 'zod';

const pick = new Command('pick', { description: 'Print one item of a list.' })
  .argument('index', {
    description: 'The item to print.',
    extensions: [helpArgument({ accepts: 'A whole number from 0 up to the last index.' })],
    validate: z.string().regex(/^[0-9]+$/u),
  })
  .option('order', {
    description: 'The order to count in.',
    extensions: [helpInput({ accepts: 'asc to count from the first item, desc from the last.' })],
    type: 'string',
    validate: z.enum(['asc', 'desc']),
  });
```

A projection that wants help's prose imports the descriptor module and reads the values with `readExtension`, as [Extensions](#extensions) describes, and never imports the help middleware.

#### Help in the manifest

```ts
// src/help/attach.ts, the hook of the @loomcli/plugins/help subpath
import { readExtension } from '@loomcli/core';
import type { CommandAttachHook } from '@loomcli/core';

import { manifestCommand } from '../manifest/extension.js';
import { helpCommand } from './extension.js';

export const attachHelp: CommandAttachHook = (command) => {
  const value = readExtension(command, helpCommand);
  if (value === undefined || (value.details === undefined && value.examples === undefined)) {
    return command;
  }
  return command.extend(
    manifestCommand({
      ...(value.details === undefined ? {} : { details: value.details }),
      ...(value.examples === undefined ? {} : { examples: [...value.examples] }),
    }),
  );
};
```

Help decides that its prose belongs in the [manifest](#manifest), and it supplies that prose through the manifest's [collecting extension](#collecting-extensions), so the manifest carries no code for help.

- **What it supplies.** On each Command, the hook reads `helpCommand` as it stands at help's turn, so a later plugin's hook that replaces that value does not change what help supplied. When the value holds `details` or `examples`, it extends the Command with one `manifestCommand` value that holds the same `details` and the same `examples`, each field present only where help's value holds it. `manifestCommand` applies the same line and prose rules as the shipped `helpCommand`, so every value help supplies validates. A Command with no help value, or with one that holds neither field, gets nothing. Neither `helpInput` nor `helpArgument` is supplied: a placeholder and an `accepts` line are for a human reader, and the input's own [schema](#input-schema) states what it accepts.
- **When the manifest is absent.** The manifest plugin need not be installed. The value is then inert, and `inspect()` still reports it under `@loomcli/plugins/manifest/command`.
- **Order.** Help's value joins the author's own `manifestCommand` values after them, and it joins values from other plugins' hooks in installation order.
- **Cost.** The hook is one call per Command on every build. Help's entry module imports `@loomcli/plugins/manifest/extension`, a declarations module, and nothing else of the manifest's.

#### The help page

The page rules below define the default content and layout. [Ordered help sections](#ordered-help-sections) replace the Command and option blocks when section fields are declared. The [help and version restyle](#help-and-version-restyle) adds semantic styles without changing that structure. Output is UTF-8, and no meaning depends on styling. The page reads the routed `CommandNode`, `graph.globals`, `graph.name`, and `graph.description`, plus the help extension values those nodes carry. It reads no host facts. Each rule applies to both [variants](#help-variants) unless it names one: Details and EXAMPLES print on the extended page alone, and the hints differ.

The page is a sequence of blocks separated by one blank line, and no block holds a blank line of its own. A block that has nothing to show is omitted. Outer section titles are uppercase at the left margin. The default layout indents every other line two spaces, except hints. [Ordered help sections](#ordered-help-sections) add inner headings indented two spaces and inner rows indented four spaces. A line at the left margin is the masthead, an outer section title, or a hint and nothing else. `<name>` below is the application name, and `<path>` is the name followed by the routed path, space-separated: `jsonkit`, `jsonkit get`, or `store cache clear`. A member is visible when it is not hidden.

1. **Masthead.** `<path> · <description>`, with a space, U+00B7, and a space as the separator, or `<path>` alone when the node has no description. When the routed Command is deprecated, a second line `  Deprecated: <message>` follows in the same block.
2. **Details.** Extended alone. The routed node's `details`, one authored line per page line, each indented two spaces. The page view splits on the same line terminators the schema recognizes, CRLF and each single terminator, and joins with LF, so an authored CR or NEL never reaches the page.
3. **USAGE.** One line per form, each beginning with `<path>`. The action form is `<path> <arguments> <required options> [options]`: each declared argument in declaration order as `<name>` when required and `[name]` when optional, with `...` inside the brackets for a variadic, so `<path>`, `[path]`, `<files...>`, and `[files...]`; then each visible required option in declaration order, which is always the node's own because a global option declares no presence rule, as `--long <placeholder>`, or `-s <placeholder>` for a `shortOnly` option, or `--long[=<placeholder>]` and `-s[<placeholder>]` for an option with an [implied value](#implied-values), with `...` appended for a multiple option; then `[options]`, which is always present because the help option is one. A node with an action prints the action form. A node with a visible child prints the children form, `<path> <command> [options]`, after the action form when both apply. A group whose children are all hidden prints the children form alone, because it has no other form.
4. **COMMANDS.** For a node with a visible child, one row per visible child in authoring order. The left cell is the child's name, followed by ` <command>` when the child is a group and by ` [command]` when it has an action and children. The right cell follows the right-cell rule below, with `deprecated` as its one possible fact.
5. **ARGUMENTS.** For a node with arguments, one row per argument in declaration order. The left cell is the name, and the right cell follows the right-cell rule, with `default` as its one possible fact.
6. **OPTIONS.** The routed node's visible local options in declaration order, one row each; on the root page of an Application with no children, the visible globals follow them in `graph.globals` order, in this one section. The left cell is the spellings, then ` <placeholder>` for a string option: `-f, --file <path>` with both spellings, `    --explain` with a long spelling alone, indented four spaces so the long spellings align, and `-m <metric>` for a `shortOnly` string option. A string option with an [implied value](#implied-values) shows its placeholder in brackets after `=`, `-b, --backup[=<control>]`, and after the letter alone, `-b[<control>]`, for a `shortOnly` one, because only an attached value replaces the implied value, and its right cell carries the fact `implied: <value>`, so the row reads `-b, --backup[=<control>]  How to back up each file.  (implied: simple)`. A [counted option](#counted-options) has no placeholder, and its spellings end with `...`, `-v, --verbose...`, or `-v...` for a `shortOnly` one, because each occurrence adds one; it never carries `repeatable`, `required`, or `default`, since the `...` already says it repeats and a count has no presence rule or default. A Boolean option's long spelling follows its polarity: `--total` for `positive`, `--no-total` for `negative`, and `--[no-]total` for `both`. The right cell follows the right-cell rule. A Boolean option with `negative` polarity carries the fact `default: true`, because its absent value is `true` and both of its spellings set it to `false`; the other polarities carry no default fact, because their absent value is `false`.
7. **GLOBAL OPTIONS.** On every page except the root page of an Application with no children, the visible globals in `graph.globals` order, one row each under the OPTIONS rule, so the reader sees which options belong to this Command and which reach every Command.
8. **EXAMPLES.** Extended alone. For a node that carries `examples`, one entry each: `$ <name> <command>`, then the note on the next line indented two more spaces.
9. **Hints.** One block of up to two lines, each at the left margin. When the page printed any child Command row, the first line is `Run <path> <command> --help for command details.` on the extended page and `Run <path> <command> -h for command details.` on the compact page. On the compact page alone, when the extended page of the same node would print Details or EXAMPLES, the last line is `Run <path> --help for details and examples.`

The right-cell rule: the description when the member has one, then, for an option or an argument that has them, its [accepted values](#accepted-values) as one sentence, then, when any fact applies, one parenthesis holding the facts that apply, comma-separated, in this order: `required`, `repeatable` for a multiple option, `default: <value>`, `implied: <value>` for an option with an [implied value](#implied-values), and `deprecated: <message>`. One space separates the description from the accepted-values sentence, and help prints both as written, adding no punctuation between them; two spaces separate the text before the parenthesis from it; a member with neither description nor accepted values has the parenthesis as its whole right cell, with no leading spaces; and a member with none of the three has no right cell. The parenthesis begins at the first `  (` that is followed by `required`, `repeatable`, `default: `, `implied: `, or `deprecated: `, and it ends at the closing `)` that ends the row, and `deprecated` is always the last fact, so a reader splits the earlier facts on the comma and reads the text between `deprecated: ` and that closing parenthesis as the message. The page is a rendering for a reader; a consumer that needs a fact exactly, whatever a description, an accepted-values sentence, or a default holds, reads it from `inspect()`, which is the machine surface, and that includes a deprecated message, which may itself hold a comma or a parenthesis. An implied value prints, and is escaped, exactly as a default that is a string does. A default value prints as it is when it is a string, as its elements separated by a space when it is an array of strings, as `JSON.stringify` renders it for any other value JSON can represent, and as `String(value)` renders it otherwise, or as Object's own spelling, such as `[object Array]`, where `String` throws; an explicit `undefined` default prints no default fact, and a line terminator inside a rendered default prints as its JSON escape, so a row stays one line.

Within a section the rows are two columns: the left cell is padded to the longest left cell in that section plus two spaces, and a row with no right cell has no trailing padding. The view measures terminal columns with `context.width` and pads to the widest cell with core's `pad` from [Width, padding, and multiline lanes](#width-padding-and-multiline-lanes). Markup contributes no width, and Unicode follows core's existing measurement rules. Nothing wraps, so a long row runs past the terminal width, and terminal width is not read.

The root of jsonkit has an action and eight children: the `doctor` Command the private `@loom/doctor` plugin attaches and the `completion` group the [completion](#completion) plugin attaches, ahead of jsonkit's own in installation order, then six of its own, of which `fetch` is deprecated and `debug` and `paths` are hidden. It declares one local option, `--format`, which the [formatter](#formatter) declared on it because it declares a result, so the restyled `jsonkit --help` has this text with color and modifiers disabled:

```text
jsonkit · Read and reshape one JSON document.

  With no subcommand, jsonkit summarizes the document and its top-level keys.

USAGE
  jsonkit [options]
  jsonkit <command> [options]

DOCUMENT COMMANDS
  READ
    get    Read one value at a path.
    keys   List the keys at a path.
    fetch  Read one value at a path.  (deprecated: Use get instead.)
  RESHAPE
    select  Keep the named fields of the document.

COMMANDS
  doctor                Check the host this application runs on.
  completion <command>  Print a shell completion script.

OPTIONS
  -o, --format <format>  Select the output format, records by default. One of: records, json, jsonl.

GLOBAL OPTIONS
  -f, --file <path>  The document to read. Omit it to read piped text.
  -v, --verbose...   Name the document before reading it.
  -h, --help         Show this help.
  -V, --version      Print the version.
  -M, --manifest     Print this command's manifest as JSON.
  -e, --explain      Explain the selected command and exit.

EXAMPLES
  $ jsonkit -f doc.json
  $ jsonkit get user.name -f doc.json

Run jsonkit <command> --help for command details.
```

`select` is a leaf with one required multiple option and no `details` or `examples`, so the restyled `jsonkit select --help` has this text with color and modifiers disabled:

```text
jsonkit select · Keep the named fields of the document.

USAGE
  jsonkit select --field <field>... [options]

OPTIONS
  -F, --field <field>  A field to keep. Repeat it for several.  (required, repeatable)

GLOBAL OPTIONS
  -f, --file <path>  The document to read. Omit it to read piped text.
  -v, --verbose...   Name the document before reading it.
  -h, --help         Show this help.
  -V, --version      Print the version.
  -M, --manifest     Print this command's manifest as JSON.
  -e, --explain      Explain the selected command and exit.
```

textstat is one root Command with a variadic argument, four local options, of which `--timing` is hidden and `--min-bytes` carries the [alias](#option-aliases) `--minimum` that no page lists, a fifth local option `--format` that the [formatter](#formatter) declared on it because it declares a result, and no children, so its page folds the globals into OPTIONS. The restyled `textstat --help` has this text with color and modifiers disabled:

```text
textstat · Count bytes, words, or lines across text sources.

  With no files, textstat counts the text piped to it and names the source "stdin".

USAGE
  textstat [files...] [options]

ARGUMENTS
  files  The files to count. Omit them to read piped text.

COUNTING
  MEASURE
    -m, --metric <metric>  What each row counts. One of: bytes, words, lines.  (default: bytes)
  FILTER
    -b, --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0)
  SUMMARY
    -t, --total  Add a total row.

OPTIONS
  -f, --format <format>  Select the output format, table by default. One of: table, json, jsonl.
  -h, --help             Show this help.
  -V, --version          Print the version.
  -M, --manifest         Print this command's manifest as JSON.
  -c, --config <config>  Read configuration from this file alone.
  -e, --explain          Explain the selected command and exit.

EXAMPLES
  $ textstat one.txt two.txt
  $ textstat --metric words --total *.md
```

`textstat -h` prints the compact page, without the details and EXAMPLES blocks, and it points to the extended page because those blocks hold something:

```text
textstat · Count bytes, words, or lines across text sources.

USAGE
  textstat [files...] [options]

ARGUMENTS
  files  The files to count. Omit them to read piped text.

COUNTING
  MEASURE
    -m, --metric <metric>  What each row counts. One of: bytes, words, lines.  (default: bytes)
  FILTER
    -b, --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0)
  SUMMARY
    -t, --total  Add a total row.

OPTIONS
  -f, --format <format>  Select the output format, table by default. One of: table, json, jsonl.
  -h, --help             Show this help.
  -V, --version          Print the version.
  -M, --manifest         Print this command's manifest as JSON.
  -c, --config <config>  Read configuration from this file alone.
  -e, --explain          Explain the selected command and exit.

Run textstat --help for details and examples.
```

`jsonkit -h` prints both hints, the child hint first:

```text
jsonkit · Read and reshape one JSON document.

USAGE
  jsonkit [options]
  jsonkit <command> [options]

DOCUMENT COMMANDS
  READ
    get    Read one value at a path.
    keys   List the keys at a path.
    fetch  Read one value at a path.  (deprecated: Use get instead.)
  RESHAPE
    select  Keep the named fields of the document.

COMMANDS
  doctor                Check the host this application runs on.
  completion <command>  Print a shell completion script.

OPTIONS
  -o, --format <format>  Select the output format, records by default. One of: records, json, jsonl.

GLOBAL OPTIONS
  -f, --file <path>  The document to read. Omit it to read piped text.
  -v, --verbose...   Name the document before reading it.
  -h, --help         Show this help.
  -V, --version      Print the version.
  -M, --manifest     Print this command's manifest as JSON.
  -e, --explain      Explain the selected command and exit.

Run jsonkit <command> -h for command details.
Run jsonkit --help for details and examples.
```

`jsonkit select -h` prints the `jsonkit select --help` page above unchanged, because `select` carries no details or examples, so the compact page has nothing to point to.

The deprecated child `fetch` carries its message as the last fact of its row, and its own page opens with `jsonkit fetch · Read one value at a path.` followed by `  Deprecated: Use get instead.`. The hidden child `debug` appears on no page above, and `jsonkit debug --help` prints its own page like any other. A group child `cache` with the description `Manage the cache.` would add the row `cache <command>  Manage the cache.`.

#### Ordered help sections

```ts
// The shared schema in the help declarations module.
const sectionPath = z.union([z.tuple([line]), z.tuple([line, line])]);
```

```ts
import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';

const next = new Command('next', {
	description: 'Find ready tasks.',
	extensions: [helpCommand({ section: ['Work commands', 'Read'] })],
}).action(() => {});
const done = new Command('done', {
	description: 'Complete a task.',
	extensions: [helpCommand({ section: ['Work commands', 'Lifecycle'] })],
}).action(() => {});
const doctor = new Command('doctor', {
	description: 'Check the application.',
}).action(() => {});

const app = new Application('work', {
	extensions: [helpCommand({
		commandSections: [
			['Work commands', 'Read'],
			['Work commands', 'Lifecycle'],
			['COMMANDS'],
		],
		optionSections: [['Output'], ['GLOBAL OPTIONS']],
	})],
	plugins: [help()],
})
	.globalOption('quiet', {
		description: 'Suppress progress messages.',
		extensions: [helpInput({ section: ['Output'] })],
		short: 'q',
		type: 'boolean',
	})
	.command(done)
	.command(next)
	.command(doctor);
```

- **Membership.** A child's `helpCommand.section` places its row on the parent's help page. An option's `helpInput.section` places its row on every page that shows it. A path has exactly one or two heading strings. Each string follows the existing `line` schema. Headings match by their uppercase form, which is also the form printed. They are not trimmed, and stored extension values retain their authored strings. TypeScript rejects an empty path, a path with three entries, and a non-string heading. Extension validation rejects those shapes and any heading the `line` schema rejects. A Command's membership does not enclose its own help page. The root's membership has no effect because the root has no parent.
- **Defaults.** A Command without membership uses `['COMMANDS']`. A local option without membership uses `['OPTIONS']`. A global option without membership uses `['GLOBAL OPTIONS']`, except on a childless root, where it uses `['OPTIONS']` as today. An authored path replaces the default for that member. Default paths participate in ordering and matching like authored paths, so an option explicitly assigned `['OPTIONS']` joins that default section. Arguments remain in ARGUMENTS.
- **Ownership.** The routed Command's `helpCommand.commandSections` orders its visible children's sections. Its `optionSections` orders the sections of its visible local and global options together. Both lists are optional and may be empty. Neither list is inherited, and the Application's value orders the root page alone. Commands remain before ARGUMENTS, and option sections remain after ARGUMENTS. A Command and an option with the same path belong to separate sections in those separate parts of the page.
- **Ordering.** Ordering applies at each heading level. Listed headings appear first, in their first listed order, and unlisted headings follow by their first visible member's appearance. Each listed path orders its outer heading and, when it has two entries, its inner heading. A one-entry path participates when its outer heading has visible direct members or visible subsections. A two-entry path participates only when that inner section has visible members. Otherwise the entire entry is ignored, even if another subsection makes the outer heading visible. Repeating a path adds no second section or second priority. Outer sections stay together even when their paths are interleaved in the order list. For example, `['Work', 'Read']`, `['Machinery']`, `['Work', 'Lifecycle']` renders Work with Read and Lifecycle, then Machinery. Direct members of an outer section precede its subsections.
- **Member order.** Visible children enter in authoring order. Visible options enter with the local options in declaration order, followed by globals in `graph.globals` order. Members keep that order within each section. Local and global options with the same authored path share one section, with local members first. Membership never changes the graph's lists or the order another projection reads.
- **Layout.** Outer headings are uppercase at the left margin. Direct members are indented two spaces. An inner heading is uppercase and indented two spaces, followed by members indented four spaces. Every outer section is one block, without an internal blank line. One blank line separates it from the next block. The existing row cells, accepted values, facts, and semantic styles apply. Column widths are measured independently for direct members and for each inner section, using `context.width` and `pad` as today. Hidden members are filtered before ordering and measurement. A heading with no visible members beneath it prints nothing, and a parent with visible subsections prints its heading even when it has no direct members.
- **Variants and projections.** Both variants use the same sections and order. Compact help still omits details and examples alone. Both variants retain their child hint whenever any visible child row prints, including when every child uses an authored section. Heading text is uppercased, then escaped before styling. The default section style is `dim` at both levels. The three descriptor identities, `HelpPage`, and the whole-page override remain unchanged. `readExtension` publishes the new fields through the ordinary extension values. Help still supplies only details and examples to `manifestCommand`, and completion keeps its existing descriptions and ordering. No section field is added to core or the manifest.

The command part of `work --help` in the example is:

```text
WORK COMMANDS
  READ
    next  Find ready tasks.
  LIFECYCLE
    done  Complete a task.

COMMANDS
  doctor  Check the application.
```

With no section membership or order fields, existing help pages keep their bytes. [ADR-0058](decisions/0058-help-owns-ordered-sections-with-at-most-two-heading-levels.md) records the decision.

#### Ordered help sections acceptance

Public API fixtures prove the following rules under Node and Bun, including rendered output and packed-package checks.

- **Paths and storage.** One-level and two-level membership compile and reach the frozen extension values, whether help is installed or not. An empty path, a three-entry path, and a non-string heading fail TypeScript checks and ordinary extension validation. A blank or multiline heading fails the `line` rule. The same checks apply to entries in either order list. Membership paths whose headings have the same uppercase form combine, order entries match that same form, and title-case references such as `Global options` match default headings. Stored strings retain their authored spelling.
- **Commands.** A page with direct and nested sections, unsectioned children, interleaved order entries, duplicate entries, unlisted sections, and an entry for an absent section pins the heading and member order. A two-entry order path for an absent or entirely hidden subsection does not position its visible outer heading. A parent-only order entry positions that outer heading when another subsection is visible. A child page uses its own ordering, while that child's membership affects only its row on the parent page. Plugin-attached Commands use the same membership rules.
- **Options.** `optionSections` orders local and global sections together, including GLOBAL OPTIONS before OPTIONS when explicitly listed that way. Direct and nested option sections cover partial, interleaved, repeated, parent-only, and absent order entries. A child's page uses its own order for global and local members even when the root declares an option order. Every option section remains after ARGUMENTS. A named section combines a local option and a global option, with local members first. A childless root folds unsectioned globals into OPTIONS, while a page with children retains the two default sections. A root with hidden children alone retains GLOBAL OPTIONS as today. An authored default path joins the default section. Global options declared by a plugin follow the same rules.
- **Filtering and layout.** Hidden members create no headings and affect no widths. An outer heading containing only visible subsections remains. Golden bytes pin two-space inner headings, four-space inner rows, two-space direct rows, blank lines, and the final newline. Wide and combining characters align using the existing width rules. Marker characters in headings print literally under both plain and styled output.
- **Variants and other projections.** Compact and extended pages have the same section layout, with their existing differences in details, examples, and hints. Both variants retain the child hint when every visible child uses an authored section and no COMMANDS heading prints. A whole-page replacement can read section fields through `readExtension`. The manifest receives details and examples alone, and its graph order and completion output are unchanged.
- **Compatibility and delivery.** Unsectioned fixture pages remain byte-for-byte unchanged. Both examples opt into authored sections through the public descriptors, and packed-package checks exercise grouped help under Node and Bun. An ordinary change fragment describes the new fields and layout. No version field changes in the implementation PR.

#### Help variants

```ts
// @loomcli/plugins/help/views
export type HelpVariant = 'compact' | 'extended';
```

`-h` asks for compact help, which orients a reader who needs the syntax, and `--help` asks for extended help, which teaches. [ADR-0040](decisions/0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md) records the decision.

- **Selection.** The middleware reads `spellings.help` from its [context](#middleware). `-h` selects `compact`. Every other case selects `extended`: `--help`, and a help option with no spelling, which only an input source could supply. Help's option binds no variable and carries no configuration binding, so the first-party plugin never meets that case, and the rule keeps the extended page as the answer to a request that names no variant. `jsonkit -h --help` repeats the help option, and the repeated-option fault is held while the earlier `-h` stands, as it does for any repeated global under [Global consumption and routing](#global-consumption-and-routing), so it prints the compact page. A letter in a short group is spelled `-h`, so `jsonkit -Vh` prints the compact page when help is installed ahead of version. Core supplies no variant fact and knows nothing of help.
- **Compact.** The page rules above with Details and EXAMPLES omitted, the child hint spelled `-h`, and the pointer `Run <path> --help for details and examples.` when the extended page of the node would print one of the omitted blocks. The masthead keeps its deprecation line, and every row keeps its accepted values and facts, so the compact page loses no rule about what an input accepts.
- **Extended.** Every block of the page rules, which is the page `--help` printed before variants. Help prints no environment or configuration binding on either page: help teaches command-line syntax, and a variable or a configuration file belongs to the documentation.
- **Replacement.** `HelpPage` carries `variant`, and `helpPage` stays one declared view. A replacement receives the variant and decides what each one prints, and one that ignores it prints one page for both, as every replacement did before. A replacement never reads `spellings`.
- **The manifest.** Help's values in the manifest are unchanged: it supplies `details` and `examples` whatever the variant, because the variant is a choice of page, not a fact of the Command.

Compared with the page rules before this section, the changed rules are: `-h` prints the compact page; `--help` prints the page it printed before; the hint becomes a block that may hold the pointer; and `HelpPage` gains `variant`. The help option's row and description are unchanged.

#### Help variants acceptance

Help variants are proven when public APIs alone produce these results under Node and Bun:

- **Example pages.** `textstat --help`, `textstat -h`, `jsonkit -h`, and `jsonkit select -h` print the pages above, byte for byte, with color and modifiers disabled, and `jsonkit --help` and `jsonkit select --help` print their pages unchanged. The example applications' help goldens are re-pinned to these pages.
- **Selection.** `-h` prints the compact page, `-Vh` the compact page, and `-h --help` the compact page, because the earlier `-h` stands when the repeated option is held.
- **Spellings.** A fixture plugin's middleware reads `--flag`, `-f`, and `--no-flag` for its typed options, `--name` for `--name=value`, the grouped letter as `-f`, and the last spelling of a multiple string option given as `-n a --name b`. An option filled from the environment or the configuration source, a defaulted option, and an option not supplied have no entry, another plugin's options and the application's options never appear, and the record is frozen.
- **Hints.** A compact leaf page whose only extended block is Details prints the pointer, a compact leaf with neither Details nor EXAMPLES prints none, and a compact group page prints the child hint with `-h` ahead of the pointer.
- **Replacement.** An `override(helpPage, …)` receives `variant` as `compact` under `-h` and `extended` under `--help`.
- **Styles.** A themed compact page styles both hint lines under the [restyle](#help-and-version-restyle) mapping.

#### Accepted values

```text
OPTIONS
  -m, --metric <metric>        What each row counts. One of: bytes, words, lines.  (default: bytes)
  -f, --format <format>        Select the output format, table by default. One of: table, json, jsonl.
```

An option or an argument row states the values the input accepts, so a reader chooses a valid value before the first run rather than learning it from a validation error. The sentence sits in the right cell after the description and before the facts, under the right-cell rule.

- **Authored.** An `accepts` value on the input's help extension, `helpInput` for an option and `helpArgument` for an argument, is the sentence, printed as written. It always wins, whatever the input's schema holds, so an author states a pattern, a range, or a long set in their own words. An `accepts` on a Boolean or counted option is never shown.
- **Derived.** Without `accepts`, help derives the sentence from the input's [input schema](#input-schema) when that schema is a closed set of strings: an `enum` whose members are all strings, a single string `const`, or an `anyOf` whose members are each such an `enum` or `const`, flattened in order, and a multiple option or a variadic argument reads the same shapes, because its input schema describes one value under [ADR-0036](decisions/0036-each-value-passes-the-same-validator.md). Help reads `enum`, `const`, and `anyOf` at the schema's top level, and derives nothing when more than one of the three sits at the same level. Every other keyword beside them must leave each listed value accepted, so help derives only when each one is `type: 'string'` or an annotation, `$schema`, `$id`, `$comment`, `title`, `description`, `default`, `examples`, `readOnly`, `writeOnly`, or `deprecated`, and the same holds inside each `anyOf` member. Any other keyword, such as `pattern`, `minLength`, `format`, or `not`, may narrow the set, so it derives nothing, and the author states the set with `accepts`. The sentence is `One of: ` followed by the values in the schema's order, separated by a comma and a space, and a closing period: `One of: bytes, words, lines.`
- **Bounds.** A value that repeats prints once, at its first place, and counts once. Help lists no set of more than eight distinct values, and its row prints as it would without accepted values: eight bounds help's listing, not the derivation, so [completion](#completion) still offers every value of a larger set. An empty set derives nothing, and neither does any other shape, a `null` schema, or a set holding a member that is not a string; the row then prints as it would without accepted values. A member that is not a string derives nothing because the list prints tokens exactly, and help does not decide how a token spells a number, a Boolean, or `null`.
- **Quoting.** A value that is empty or holds whitespace, a comma, a double quote, or a control character prints as its JSON string, `One of: "a b", c.`, so the list splits unambiguously. A line terminator inside it prints as its JSON escape, as a rendered default's does, so a row stays one line, and DEL and the C1 controls, which JSON leaves raw, print as their lowercase `\uXXXX` escapes, so no control character reaches the terminal. Every value is escaped before styling, as every graph string on the page is.
- **Not the manifest's.** `accepts` is help's own fact for a human reader. Help does not supply it to the [manifest](#manifest), where an agent reads the exact `schema`.

The [formatter](#formatter)'s `--format` carries the enum of its view names, so its row derives them, and the formatter's description names only the default. A Command with more than eight view names prints none of them in help; `inspect()` and the manifest still carry the enum.

Compared with the page rules before this section, the changed rules are: the right cell gains the accepted-values sentence between the description and the facts, and a member with neither description nor sentence has the parenthesis alone; `helpInput` gains `accepts`; arguments gain `helpArgument`, where no help extension targeted them before; and the formatter's description drops the view names and states the default as `Select the output format, <default> by default.`

#### Accepted values acceptance

Accepted values are proven when public APIs alone produce these results under Node and Bun:

- **Example pages.** `textstat --help` prints the `--metric` and `--format` rows shown above, and `jsonkit --help` prints `--format` with `One of: records, json, jsonl.`. The quoted pages in this document and the example applications' help and manifest goldens are re-pinned for the formatter's new description.
- **Derived shapes.** Fixture applications prove each shape the Derived rule names, a string `enum`, a single string `const`, and an `anyOf` of them, at every level it can appear: at the top level and as an `anyOf` member, on a single option, a multiple option, and a variadic argument. At each level, one case holds `type: 'string'` beside the shape and one holds an annotation such as `default`, and both still derive, and one holds a narrowing keyword, such as `pattern` or `minLength`, and derives nothing. Beside those, fixtures cover an `anyOf` mixing an `enum` member and a `const` member, flattened in order, with a value repeating across members printing once; a schema holding only a narrowing keyword such as `pattern`, with no closed set, deriving nothing; an `enum` beside a `const` or an `anyOf` at the same level deriving nothing; a repeated value printing once, an empty set and a nullable enum deriving nothing, eight values printing, nine deriving and help listing none, a set holding a number deriving nothing, and an argument row deriving from its schema.
- **Authored.** An `accepts` wins over a derived list, prints for an input with a `null` or pattern schema, prints on an argument row through `helpArgument`, and is never shown on a Boolean option.
- **Text.** A value that is empty or holds a space, a comma, a double quote, a line terminator, or a control character prints as its JSON string, a marker character in a value prints literally, and a row with no description starts its right cell with the sentence.

#### Help and version restyle

```ts
// The restyle left both view inputs unchanged; help variants add variant to HelpPage, and the
// version postfix gives the version line VersionLine.
import type { DeclaredView } from '@loomcli/core';
import type { HelpPage } from '@loomcli/plugins/help/views';
import type { VersionLine } from '@loomcli/plugins/version/views';

// Exported from @loomcli/plugins/help/views and @loomcli/plugins/version/views.
declare const helpPage: DeclaredView<HelpPage>;
declare const versionLine: DeclaredView<VersionLine>;
```

```text
OPTIONS
  -o, --format <format>  Select the output format, records by default. One of: records, json, jsonl.
```

- **Scope.** It changes the default help and version views and the formatter's option description. The restyle itself adds no export, extension field, theme requirement, glyph, or rendering policy; the `accepts` field and `helpArgument` arrive with [accepted values](#accepted-values). The existing help and version takeover, output destination, invocation rules, and view override identities stay unchanged.
- **Content.** The page keeps its masthead, details, usage forms, section order, filtering, row facts, examples, hint, indentation, blank lines, and final newline. The application path remains first in the masthead. Neither default view adds a framework logo or branding glyph. Available view names print as the `--format` row's [accepted values](#accepted-values), with no separate section.
- **Escaping.** Graph strings, help extension strings, and rendered default values are literal data. The view escapes each raw fragment with `style.escape` before styling or measuring it. It never escapes the completed marked page or recovers semantic fields by parsing a rendered row. Authored markup in a description or example remains literal. Existing default serialization and line-terminator escaping remain unchanged. Embedded ANSI remains subject to core's separate rendering policy.
- **Measurement.** The two-column rule uses destination-aware `context.width` and core's deferred `pad`. This replaces JavaScript string-length padding. It preserves ASCII spacing while aligning wide and combining characters under core's existing rules. Styling never changes which members or sections appear, and neither view wraps or reads terminal width.
- **Policy.** Views return semantic marked strings. The installed theme and core's destination policy determine colors and modifiers. A missing theme leaves semantic colors unmapped, while explicit bold and italic still follow modifier policy. Under automatic policy, an ordinary pipe has no style escapes. At a capable terminal, `NO_COLOR` disables color but does not disable bold or italic. Explicit policy and `FORCE_COLOR` retain their existing precedence. The plain examples disable both colors and modifiers.
- **Replacement.** `helpPage` keeps `{ graph, command }`, which [help variants](#help-variants) extend with `variant`. `versionLine` takes `VersionLine`, `{ graph, postfix }`, since the [version postfix](#version). Each override replaces the whole view through the existing registry. A replacement derives its own content and owns its layout, literal-data escaping, styles, and final newline. No public section model or builder is introduced.

The default help view applies this mapping. A style named below is a member of the run-specific `style` object.

| Page part | Style |
| --- | --- |
| Masthead application path | `highlight.bold` |
| Masthead middle dot | `dim` |
| Masthead description and details | `primary` |
| Section titles | `dim` |
| Application paths, child command names, and option spellings outside authored examples | `highlight` |
| Placeholders, including their brackets, the `[=` and `]` around an implied value's placeholder, and variadic suffix, the `...` after a counted option's spellings, and argument labels in ARGUMENTS | `dim.italic` |
| Argument forms in USAGE, `[options]`, and the `<command>` or `[command]` markers in USAGE and COMMANDS | `dim.italic` |
| Option spelling separator `,` | `dim` |
| Descriptions in right cells | `primary` |
| Accepted-values sentences in right cells | `primary` |
| Fact parentheses, fact separators, `required`, `repeatable`, `default: <value>`, and `implied: <value>` | `dim` |
| `deprecated: <message>` inside a fact list | `warning` |
| The entire `Deprecated: <message>` line below a masthead, excluding indentation | `warning` |
| Example `$` prompt | `dim` |
| Application name added before an authored example | `highlight` |
| Authored example command text | `primary` |
| Example note | `dim` |
| Hint words `Run`, `for command details.`, and `for details and examples.` | `dim` |
| Hint application path, `--help`, and `-h` | `highlight` |
| Hint `<command>` | `dim.italic` |

Indentation, padding, spaces between styled parts, and newlines are unstyled. Spaces inside a styled text value retain that value's style. A placeholder's internal `...`, and the `...` after a required multiple option's placeholder, share its dim italic style, and so does the `...` after a counted option's spellings. The `--[no-]name` spelling is one highlighted option spelling, not a placeholder. Deprecated rows keep their name and description styles. Only the deprecation fact uses warning, with surrounding parentheses and separators still dim. The text stays explicit when color is off, and no warning glyph is added.

Examples remain opaque authored text. The view styles only the prompt and application name it adds, the whole authored command string, and the optional note. It does not parse shell syntax or highlight individual flags inside that string.

The formatter hook sets its description to `Select the output format, <default> by default.`, where `<default>` is the result's declared default name at that hook. The view names are not in the description: the option's input schema is the enum of the names, in record order after `json` and `jsonl` are appended where absent, and the page prints them as the row's [accepted values](#accepted-values). A plugin whose hook changes the default installs before `format()` for the description to reflect that choice. Later hooks do not retroactively update the description. The description is ordinary literal graph text, so the whole sentence uses the description's `primary` style. It is not the right-cell `default:` fact, and the option still declares no parser default. An omitted `--format` preserves an earlier middleware's selection. Help does not infer formatter ownership from an option name or inspect the result to synthesize this sentence. A Command without the formatter has no synthetic format row or view list.

Compared with the previously accepted help page rules, the changed rules are: semantic styling replaces unconditional plain output, column width follows core's measurement, and the formatter description adds its declared default. The version line gains the styling in [Version](#version) without changing its text. All other content and invocation rules remain in force.

#### Help and version restyle acceptance

The implementation re-pins hand-written help pages and version lines against built processes under Node and Bun, including packed-consumer coverage. Plain and themed expectations are authored independently of the rendering helpers.

- Root, leaf, group, and hybrid pages retain their content rules. Cover hidden-member filtering, a directly requested hidden Command, a group with only hidden children, omitted empty sections, and root-only folding of globals.
- Compare complete plain text for jsonkit root, jsonkit select, and textstat against the examples above. Check one final newline, no trailing row padding, required and variadic forms, Boolean polarity, short-only options, and existing default serialization.
- Pin exact themed bytes for the style mapping, including placeholders beside highlighted spellings, the accepted-values sentence, dim fact punctuation around warning deprecation, literal example flags, notes, the hint lines, and the version line. Cover deprecation on both a row and a routed Command's masthead.
- Cover the named theme at truecolor, 256 colors, and 16 colors, a custom token mapping, an absent theme, an ordinary pipe, and a capable terminal with `NO_COLOR`. Check modifier policy independently, including fully disabled styles. Neither view chooses a fallback color or adds a glyph.
- Use wide and combining characters in names and placeholders, plus literal style-marker data in graph facts, defaults, and help extensions. Check alignment through core's measurement, literal marker output, and no interpretation of authored example syntax.
- Check formatter view order, custom and replaced view names, an unadvertised `ndjson` alias, and a declared default other than a pack view. An earlier hook changing the default updates the description. A later hook changing it leaves the description at its formatter-hook value. With the formatter absent, help invents no selector or view list. Inspect the formatter description and the absence of a parser default, and prove omission preserves an earlier middleware's selected view.
- Check version strings with a lowercase `v`, an uppercase `V`, an omitted version, and explicit `0.0.0`. Root and routed invocations print the same application version text, and raw marker-bearing strings stay literal.
- Keep the existing help and version override, takeover, fault precedence, stdout, and exit-code coverage. A replacement sees the same graph data, owns its newline, and can render its own styles without installing a replacement plugin.

### Formatter

The formatter is `@loomcli/plugins/format`. Its factory `format(settings?)` takes one optional setting, `short`, the short spelling `--format` takes, under the convention of [Plugin settings](#plugin-settings), and with none `--format` has no short spelling. It declares no global option and claims no slot. It ships two views, `json()` and `jsonl()`, one hook that puts `--format` on every Command that declares a [result](#results), one always-on middleware that copies a supplied name into `view`, and two [failure encoders](#failure-encoders), for `application/json` and `application/jsonl`. The plugin owns the encodings and the option; core owns the selection.

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

Once [help's failure hint](#helps-failure-hint) lands, `Run "jsonkit get --help" to see the usage.` prints between the sentence and the explain line.

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

- **Views.** `json()` and `jsonl()` are whole views: under `result<Value>` they receive the value, and under `rows<Row>` core collects the sequence and they receive the array. `map` reshapes what they receive, identity by default. They are bare pack views under [Row views](#row-views), typed by contextual typing inside a `views` record and stated, `json<Summary>()`, when hoisted or written as the second argument of `out.render`. They render as ordinary views with the plugin uninstalled, so a Command that names `json: json()` first prints JSON by default with no `--format` anywhere. `json()` declares the [media type](#media-types) `application/json` and `jsonl()` declares `application/jsonl`, whatever `map` they take and whatever key holds them.
- **Bytes.** `json()` writes `JSON.stringify(mapped, null, 2)` and one newline. `jsonl()` writes one line per element when the mapped value is an array, each `JSON.stringify(element)` and one newline, and one such line otherwise; an empty array prints nothing. `toJSON` is honored and an `undefined`, function, or symbol property is dropped, as `JSON.stringify` does. A value that encodes to nothing, `undefined` at the top, or that `JSON.stringify` throws on, a `bigint` or a cycle, makes the view throw `The value cannot be encoded as JSON. Emit plain JSON data from the action.`, or for `undefined`, `The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.`, reported through the output-view row of the [Failure contract](#failure-contract). The message carries no engine reason, which differs between runtimes; the thrown error keeps the engine's error as its `cause`. The text is data: each view escapes it through `style.escape` and replaces every character from U+007F to U+009F with its `\uXXXX` escape, four lowercase hex digits, so nothing the [rendering policy](#rendering-policies) would strip or read as a terminal control reaches it, and applies no style, so the bytes are the same under every capability.
- **The hook.** A Command with no result is returned unchanged. On one with a result, the hook appends `json` and then `jsonl` to the `views` record where the record lacks the key, so an author's own `json: json({ map })` or `json: myView` is kept as written and the default is unchanged, then declares the local string option `format` after the author's options, with the short spelling `settings.short` names, or none when it is omitted, `control: true` under [Control options](#control-options), and no default, the description `Select the output format, <default> by default.`, where `<default>` is the declared default at that hook, and a validator that accepts each key and returns the issue `Supply one of <names>.` for anything else. The validator also accepts `ndjson` and transforms it to `jsonl`, unless the record names `ndjson` itself; `ndjson` is an unadvertised alias under [Aliases](#aliases). The validator maps `ndjson` to `jsonl` before it checks the record's keys, so the option's [input schema](#input-schema) is the enum of the record's keys and the unadvertised alias stays out of it. The option is an ordinary local option in every respect: parsed at local placement, on the help page as `--format <format>`, or `-f, --format <format>` under `format({ short: 'f' })`, with its description and its accepted values, under the node's `options` in `inspect()`, reaching the action at run time under `options.format` and absent from its types. `format()` judges its settings at its own call through core's [`checkShortSetting`](#plugin-settings), so settings that are not an object are the `@loomcli/core/not-an-object` fault and a short spelling that is not one ASCII letter is the `@loomcli/core/short-alias` fault every option's short spelling answers, each thrown from `format()` with a finding that quotes the `format()` call and names the plugin. A key or spelling collision with an option the Command, the Application, or another plugin declares, the chosen short spelling included, is the hook-collision build error, naming the plugin, the Command, and the declaration that already holds the name or spelling, and the developer resolves it; the plugin offers no rename. A plugin whose hook adds a view installs ahead of `format()` if `--format` is to accept its name. The same order lets the description reflect a hook's changed default.
- **The middleware.** `activate: 'always'`, because a hook-declared option cannot activate it. When the routed Command declares a result and [`ownOptions`](#middleware) holds a string under `format`, it assigns that string to `view` and calls `next()`; when the option was omitted it assigns nothing, so an earlier plugin's selection stands. A held fault on another input, a structural one such as `--bogus` included, leaves `format` in `ownOptions`, so the selection stands for the failure, and the fault is raised at the dispatch boundary unless a later middleware takes over. A `--format` its validator rejected is absent from `ownOptions`, so the middleware assigns nothing and the failure's selection stays as it was, the default view when nothing else selected one: `textstat --format yaml one.txt` is the validator's issue, exit 2, written as text because textstat's default view, `table`, declares no media type, and `--format yaml --help` with help installed after the formatter still prints the page.
- **The failure encoders.** The plugin registers one encoder for `application/json` and one for `application/jsonl`, the media types its two views declare, so a failed run whose selected view is a `json()` or `jsonl()` view writes its [failure form](#the-failure-form) as JSON. Both write the same bytes: one line, `JSON.stringify({ error: form })` with the form's keys in the order `code`, `exitCode`, `message`, `hints`, then one newline, to stderr. Every character from U+007F to U+009F is replaced by its `\uXXXX` escape, four lowercase hex digits, as the views replace it, and no style applies. An author's own view that declares either media type selects the same encoder. `--format` on a Command with no result is the unknown-option error, and `--format` twice or with no value follows the rules every string option follows.

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

#### Formatter example coverage

The formatter increment is proven when textstat installs `format({ short: 'f' })` and jsonkit installs `format({ short: 'o' })`, after `help()` and `version()` and ahead of the example plugin, and public APIs alone produce the transcript above: `textstat -f json one.txt` and `textstat --format json one.txt` print the rows as one indented array with the `--timing` line still on stderr, `textstat --format jsonl one.txt` prints one line per row, `textstat one.txt` prints its table, `jsonkit paths -o jsonl -f doc.json` and `jsonkit paths --format jsonl -f doc.json` print one line per `Entry`, `--format ndjson` prints the same bytes, and `--format json` prints one indented array. `textstat --help` prints the page under [The help page](#the-help-page) with its `--format` row, whose description names the declared default, as specified by the [help restyle](#help-and-version-restyle), and whose [accepted values](#accepted-values) list the view names. `inspect()` reports `['table', 'json', 'jsonl']` on textstat's root and `['list', 'table', 'json', 'jsonl']` on `paths`. The acceptance tests cover both views under both units with an empty array and with a map, a `bigint` and a top-level `undefined` as view faults, U+009B and U+001B inside a string printed as escapes under `color: 'never'` and `'always'` alike, an author-declared `json` kept with its map and position, an author-declared `ndjson` key that the alias no longer serves, `--format yaml`, `--format` on a no-result Command, `--format` twice and with no value, an omitted `--format` leaving an earlier plugin's selection in place, `--format yaml --help` printing the page, the hook-collision error against a local, a global, and another plugin's `format`, `format({ short: 'f' })` putting `-f` on the help row and selecting a view through it, its short spelling colliding with a local option's and with help's `-h`, and `format()` throwing at its call for `'fo'`, `'-f'`, `'1'`, `''`, `'é'`, and `5` under the short-alias rule and for settings of `'f'`, `5`, `null`, and an array under not-an-object. The lifecycle cases live with the [plugin example coverage](#example-coverage-3): a fixture hook declaring an option the action reads at run time and `request` carries, the hook receiving the root, `result` and `hasAction` read from a hook, two plugins' hooks in order with the later replacing a view, each hook build error, `request` holding values on a valid invocation and `null` under a held fault and on a group, a takeover under a held fault and under a throwing validator exiting 0 with no diagnostic, an always-on wrapper ahead of help reaching help's takeover, the held fault raised at the boundary with its code and rank and ranking ahead of a bad `view`, a run cancelled inside a validator and one cancelled mid-chain resolving the signal's code, `view` starting at the default and `null` on a no-result Command, the last assignment before the boundary winning across two middleware, an assignment after the boundary changing nothing, and each `view` fault raised at the boundary and unobserved under a takeover. The two failure encoders' lines are pinned under [Failure encoders acceptance](#failure-encoders-acceptance), and a fixture middleware reads its own global and hook-declared options from `ownOptions` under a held fault on another input, a validation problem and an unknown option alike, and finds an option absent when its validator rejected the option's own value or when the option's own occurrence faulted. Each case runs under Node and Bun.

### Table

The table is `@loomcli/plugins/table`. Its factory `table<Row>(config?)` takes a column list and returns a whole view over the collected rows, `View<readonly Row[]>`, so the same value reaches a `views` record under `rows<Row>` and the second argument of `out.render`. Nothing is installed: there is no plugin factory at the subpath, no option, no lifecycle hook, and no graph fact, and what the call returns is a bare pack view under [Row views](#row-views). The view measures every row before it writes its first line, which is what buys a column as wide as its widest cell, so a sequence rendered through it is buffered whatever its source.

```ts
// @loomcli/plugins/table
function table<Row>(config?: TableConfig<Row>): View<readonly Row[]>;

interface TableConfig<Row> {
  columns?: readonly Column<Row>[];
}
type Column<Row> = (keyof Row & string) | ColumnEntry<Row>;
type ColumnEntry<Row> = {
  [Key in keyof Row & string]: {
    key: Key;
    header?: string;
    align?: 'left' | 'right' | 'center';
    format?: (value: Row[Key], row: Readonly<Row>, context: ViewContext) => string;
  };
}[keyof Row & string];
```

```ts
import { Command } from '@loomcli/core';
import { table } from '@loomcli/plugins/table';

import { countFiles } from '../actions/count-files.js';

interface Row {
  count: number;
  source: string;
}

export const count = new Command('count')
  .argument('files', { required: true, variadic: true })
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
COUNT  SOURCE
    6  one.txt
    2  two words.txt
    8  total
```

- **Configuration.** `columns` is an ordered list whose entries are a bare key or `{ key, header?, align?, format? }`, where a bare key is `{ key }` and the list order is the column order. A key may appear twice, which is two columns over one field, each with its own header, alignment, and format. With `columns` omitted, every own key that appears in the rows is a column in first-seen order with the key as its header. The configuration is plain data the returned view holds: the factory publishes no fact and no descriptor, and an application that wants another layout names another view.
- **Form.** One header line, then one line per row in source order. A header cell is the entry's `header` or the key spelled as written, styled `dim`. Two spaces separate one column from the next. There are no borders and no rule lines, and the last column of a line carries no padding, so a left- or center-aligned last cell ends its line and a right-aligned one keeps only the padding before it. Every line ends with `\n`, and the view owns every newline it writes.
- **Cells.** A default cell is `String(value)` passed through `style.escape` and styled `primary`, and `null` and `undefined` print as the empty string rather than as their spellings. A `format` entry replaces the default cell and returns marked text its author owns, which the view neither escapes nor styles, the view-function rule of [Rendered output](#rendered-output); a default cell is escaped by the view because the value is data.
- **Width.** Each column is padded with core's `pad` to the widest of its header and every cell in that column, each measured with `context.width`, so a styled cell and a wide character land in the same column as a plain narrow one. Alignment is `left` unless the entry names `right` or `center`. A cell is never truncated, whatever the destination reports as its width, and no alignment is inferred from a value's type: a number left-aligns until a column asks for `right`.
- **Empty.** An empty sequence with `columns` given prints the header line alone, so a filtered run still reports the shape it searched. An empty sequence with no `columns` prints nothing, because no key is known.
- **Typing.** `columns` is typed from `Row`, and each entry's `format` receives `Row[Key]` narrowed from that entry's own literal key. Inside a `views` record the row type flows in by contextual typing, so a key that is not a key of `Row` is a compile error on that string. Hoisted into a constant or written as the second argument of `out.render` the row type does not flow in, so the factory states it, `table<Row>({…})`, or its cell callbacks go unchecked, the rule [Row views](#row-views) states for every pack view.

### Records

The records list is `@loomcli/plugins/records`. Its factory `records<Row>(config)` takes an identifier and an optional field list and returns a row view, `RowView<Row>`, so a record prints as its source yields it and no row waits on the rows behind it. Like the table it installs nothing and returns a bare pack view. `identifier` is required: it names the key whose value identifies the record, which the view styles apart so an operator scanning a long list finds the record it names.

```ts
// @loomcli/plugins/records
function records<Row>(config: RecordsConfig<Row>): RowView<Row>;

interface RecordsConfig<Row> {
  identifier: keyof Row & string;
  fields?: readonly Field<Row>[];
}
type Field<Row> = (keyof Row & string) | FieldEntry<Row>;
type FieldEntry<Row> = {
  [Key in keyof Row & string]: {
    key: Key;
    format?: (value: Row[Key], row: Readonly<Row>, context: ViewContext) => string;
  };
}[keyof Row & string];
```

```ts
import { Command } from '@loomcli/core';
import { records } from '@loomcli/plugins/records';

import { listMembers } from '../actions/list-members.js';

interface Member {
  key: string;
  kind: string;
}

export const members = new Command('members')
  .rows<Member>({ views: { records: records({ identifier: 'key' }) } })
  .action(listMembers);
```

```text
key   user
kind  object with 3 keys

key   tags
kind  array with 2 items

2 records
```

- **Configuration.** `fields` is an ordered list whose entries are a bare key or `{ key, format? }`, where a bare key is `{ key }` and the list order is the field order. A field carries no `header` and no `align`: the key is the label a records list prints, and the value column is one lane, so neither has a second spelling to choose. With `fields` omitted, every own key that appears in the record is a field in first-seen order. `identifier` names a key of `Row` and adds no line of its own: it selects the value the view highlights among the fields it prints, so a `fields` list that omits the identifier's key prints no line for it and highlights nothing.
- **Form.** One line per field: the key padded left to the key column's width, styled `dim`, then two spaces, then the value. One blank line separates one record from the next, with none before the first record and none after the last. There are no rule lines. Every line ends with `\n`, and the view owns every newline it writes.
- **Width.** With `fields` declared, the key column is as wide as the widest key in the list, so every record aligns against the same column. Under the all-keys default the key column is as wide as the widest key of that record alone, because a row view sees one row and cannot measure the rows behind it. Keys are measured with `context.width` and padded with core's `pad`, and a key is never truncated.
- **Cells.** A default value is `String(value)` passed through `style.escape` and styled `primary`, except the identifier's value, which is styled `highlight`. `null` and `undefined` print as the empty string, so the key stands alone on its line. A `format` entry replaces the default and returns marked text its author owns, which the view neither escapes nor styles, the identifier's field included.
- **Head and tail.** `head` prints nothing, because a records list has no column headings to open with. `tail` prints one blank line and then the summary line `<count> records`, styled `dim`, with its own newline, where `count` is the number of rows `row` was called with. One record reads `1 record`, and an empty sequence prints `0 records` with no blank line before it, because no record printed.
- **Typing.** `identifier` and `fields` are typed from `Row`, and each entry's `format` receives `Row[Key]` narrowed from that entry's own literal key. The contextual-typing rule is the table's: inside a `views` record a key that is not a key of `Row` is a compile error on that string, and hoisted or written as the second argument of `out.render` the factory states its row type, `records<Row>({…})`, or its cell callbacks go unchecked.

#### Table and records example coverage

The increment is proven when both examples drop their hand-written views for the two factories. [textstat](../examples/textstat/src/application.ts) declares `rows<Row>` over `{ count: number; source: string }`. Its table view names the `COUNT` and `SOURCE` headers, and its action appends `{ count: total, source: 'total' }` when `--total` was supplied. The `Table` type, `tableView`, and the module that held them are deleted. `--format json` prints an array of rows instead of one object. jsonkit's `paths` declares `views: { list: records({ identifier: 'path' }), table: table({ columns: ['path', 'kind'] }) }`, and `pathList` and `pathTable` are deleted. jsonkit's root declares `rows<Member>` over `{ key: string; kind: string }` with `views: { records: records({ identifier: 'key' }) }`. Its line about the document's kind moves to stderr through `out.info`. A scalar document is an empty sequence whose tail prints `0 records`. The implementation re-pins the golden bytes and the transcripts of the [results](#results-example-coverage), [formatter](#formatter-example-coverage), and [failure](#example-coverage-2) coverage paragraphs against the new views. The `jsonkit --help` page under [The help page](#the-help-page) gains an OPTIONS section with its `--format` row because the root now declares a result.

The acceptance tests cover each factory as the second argument of `out.render` and as an entry of a declared result, a column measured against a wide CJK cell and against a styled cell, a `null` and an `undefined` cell under each factory, one key listed twice as two columns, a `format` cell that returns styled text the view leaves unescaped beside a default cell in the same row that the view escapes, the all-keys default in first-seen order under each factory, an empty sequence under the table with `columns` printing the header line alone and without `columns` printing nothing, an empty sequence under records printing `0 records`, a one-row sequence printing `1 record`, and `tail` receiving the row count under `out.render` and under `out.results` alike. The negative type checks cover a column that names a key the row does not carry, a records field that carries `header`, an `identifier` that names a key the row does not carry, and a `format` whose value parameter is typed as something other than the key's own value type. Each case runs under Node and Bun.

### Loom theme

```ts
import type { ConcreteStyle, Plugin, ThemeConstraint, ThemeMapping } from '@loomcli/core';

type LoomThemeDefaults = Readonly<Record<
	'dim' | 'primary' | 'highlight' | 'success' | 'warning' | 'error' | 'info',
	ConcreteStyle
>>;

export type LoomThemeOverrides = {
	readonly [Name in keyof LoomThemeDefaults]?: ConcreteStyle | undefined;
} & ThemeMapping;

export declare function loomTheme<const Mapping extends ThemeMapping = {}>(
	overrides?: LoomThemeOverrides & Mapping & ThemeConstraint<Mapping>,
): Plugin<{}, LoomThemeDefaults & Omit<NoInfer<Mapping>, keyof LoomThemeDefaults>>;
```

```ts
import { Application, style } from '@loomcli/core';
import { loomTheme } from '@loomcli/plugins/theme';

const app = new Application('example', {
	plugins: [loomTheme({
		highlight: style.cyan.bold,
		identifier: style.hex('#C97B36', { ansi256: 172, ansi16: 'yellow' }),
	})],
});
```

- **Status.** Implemented under ADR-0022 and [ADR-0029](decisions/0029-explicit-color-fallbacks-preserve-theme-hues.md).
- **Exports.** `@loomcli/plugins/theme` adds `loomTheme` and the type `LoomThemeOverrides` beside the existing `theme(mapping)`. Both factories use identity `@loomcli/plugins/theme` and contribute through the same single theme slot. They install no middleware, options, hooks, or views. Importing either factory installs nothing.
- **Defaults.** `loomTheme()` supplies the seven mappings below. `theme(mapping)` remains the bare factory and supplies only its declared mappings. The named defaults change foregrounds only, preserving backgrounds and modifiers. There is no mode argument, light palette, background detection, terminal query, environment variable, or CLI flag for selecting a palette.
- **Overrides.** A supplied concrete chain replaces the complete mapping for its key, including its fallback colors. An omitted or `undefined` built-in override retains the default. `style` contributes no operations and inherits its surroundings. `style.resetForeground` selects the terminal's foreground default while preserving other attributes. `null` and applied strings are invalid values. The existing concrete-chain and reserved-name rules apply.
- **Custom names.** Extra keys add tokens to the Application vocabulary, including keys whose value is `undefined`. Core-key completion suggests the seven names without requiring an annotation. A reusable mapping can use `satisfies LoomThemeOverrides` while retaining its custom keys. Literal custom names survive the returned plugin and [Application environment registration](#theme-plugins-and-typed-names) into action and view contexts. The imported `style` remains independent of Application registration. A mapping cannot reference another token.
- **Policy.** Construction reads no terminal facts. Core selects colors for each destination under the existing rendering policy. Installing the theme does not force color, select glyph forms, or change layout. An ordinary pipe remains free of styling, while explicit policy or `FORCE_COLOR` can enable it. Under automatic policy, `NO_COLOR` suppresses colors unless `FORCE_COLOR` is also set. Authored modifiers follow their own policy. Theme installation leaves unmarked text unchanged.

The named palette uses [explicit fallback colors](#explicit-color-fallbacks) at the reduced depths:

| Token | Truecolor foreground | 256-color foreground | 16-color foreground |
| --- | --- | --- | --- |
| `primary` | Terminal default | Terminal default | Terminal default |
| `dim` | `#8B93A3` | `245` | `brightBlack` |
| `highlight` | `#C97B36` | `172` | `yellow` |
| `success` | `#7A8F7B` | `108` | `green` |
| `warning` | `#E2B93D` | `178` | `brightYellow` |
| `error` | `#C04532` | `131` | `red` |
| `info` | `#5B7DA3` | `67` | `blue` |

`primary` maps to `style.resetForeground`, not a fixed white or cream. `dim` uses a color, not `faint`. No default adds bold. A view requests emphasis through a chain such as `style.highlight.bold(text)`. The palette paints no background and does not adapt to one.

#### Loom theme acceptance

The implementation increment proves these cases through public APIs:

- Packed consumers import both factories and `LoomThemeOverrides` from the same subpath. Neither import installs a plugin. Installing either with another theme fails the existing identity or theme-slot check.
- Every default emits the exact foreground in the table at each depth, with no background or modifier operation. A nested `primary` restores terminal foreground inside a colored span while preserving the surrounding background and modifiers.
- Omitted and `undefined` overrides retain defaults. A replacement chain discards the original mapping and its fallbacks. `style` inherits the enclosing style, and `style.resetForeground` restores terminal foreground. Custom `undefined` keys remain valid tokens.
- Compiler checks cover literal custom names, independent imported styles, invalid values, reserved names, and semantic references. An editor completion check suggests all seven core keys and omits keys already supplied.
- Both examples install `loomTheme()`. `textstat --total` uses the default highlight for its total row on a color terminal. Under ordinary piping or automatic `NO_COLOR`, the same content and layout contain no color escapes. Help and version restyling remains a separate increment.
- Process fixtures run on Node and Bun against the built packages. Packed-consumer evidence exercises the published declarations and the named palette at each color depth.

`scripts/check-theme-contract.mjs` checks the built factory export against the compiler and editor. `check:types` runs it after the existing declaration checks, so `pnpm verify` and PR CI include it. It verifies compilation and editor completion, not palette merging or output behavior. For a standalone run, use `pnpm build && node scripts/check-theme-contract.mjs`.

### Manifest

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
  readonly exitCodes: Readonly<Record<string, string>>; // core's five rows and a row per declared code, in ascending numeric order
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
  readonly code: string; // the class's failure code, in place of the retired hand-written name
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
      readonly control: boolean; // new: see Control options
      readonly long: string | null;
      readonly short: string | null;
      readonly required: boolean;
      readonly multiple: boolean;
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: string | null;
      readonly default: { readonly value: unknown } | null;
      readonly implied: string | null;
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
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: string | null;
    }
  | {
      readonly type: 'count';
      readonly name: string;
      readonly description: string | null;
      readonly deprecated: string | null;
      readonly control: boolean;
      readonly long: string | null;
      readonly short: string | null;
      readonly schema: null;
      readonly env: string | null;
    };
```

`jsonkit get --manifest` prints the document below, abridged here to its first global; the full `globals` list continues with `--verbose`, `--help`, `--version`, `--manifest`, and `--explain`.

```json
{
  "name": "jsonkit",
  "version": "0.0.0",
  "description": "Read and reshape one JSON document.",
  "tokens": "Every input is a string token. A schema describes the value one token must satisfy, and each token of a multiple option or a variadic argument satisfies it alone. A null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.",
  "exitCodes": {
    "0": "Successful execution and core output",
    "1": "Expected action failure, internal failure, or invalid declarations",
    "2": "Invalid invocation inputs",
    "65": "Declared failures: invalid-json, path-not-found",
    "130": "Cancelled by SIGINT or by a caller-supplied abort",
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
      "env": null,
      "default": null,
      "implied": null
    }
  ],
  "command": {
    "name": "get",
    "path": [
      "get"
    ],
    "description": "Read one value at a path.",
    "details": [
      "Quote a path that holds a shell metacharacter.",
      "A path is a dot-separated walk from the root of the document."
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

The manifest plugin prints, for the routed Command, a self-contained JSON projection of the graph that an agent reads to construct a correct invocation before it makes one. The graph is the source of truth: the document copies facts [Graph inspection](#graph-inspection) publishes and adds nothing but the fixed statements of the envelope, and no projection, plugin, or core path reads a fact from it.

- **The option.** `manifest(settings?)` takes the optional `short` setting and declares one Boolean global option, `manifest`, with the description `Print this command's manifest as JSON.` and `control: true` under [Control options](#control-options), and a middleware activated by it. `manifest({ short: 'M' })` adds `-M`; omitted or empty settings give it no short spelling. The factory judges settings at its call through `checkShortSetting`, with the ordinary not-an-object and short-alias rules naming `manifest()` and the plugin. A collision follows the ordinary global option spelling-taken rule. Like `--help`, either spelling is consumed at any placement before `--`. It lists `manifestCommand` under its `extensions`, declares no view, and claims no slot.
- **The takeover.** The middleware prints the document for the routed Command and returns without calling `next()`, so the exit code is 0, the action never dispatches, and a fault core held from parsing or validation is never raised: a group prints its own document, and `jsonkit get --manifest` prints while `path` is missing. An unknown Command still fails in routing, so `jsonkit nope --manifest` reports the unknown command, and every other fault is held, so `--manifest` takes it over. An earlier-installed middleware that takes over wins, so in the example applications `jsonkit --help --manifest` prints help and `jsonkit --version --manifest` prints the version.
- **The slice.** `command` is the routed Command's entry with its visible descendants nested under `children`, and the envelope carries the Application's `name`, `version`, `description`, and `globals`, so a slice needs no second document. At the root the slice is the whole application. A hidden Command routed to directly prints its own slice, as its help page does.
- **What a listing omits.** A hidden Command, a hidden local option, and a hidden global option are omitted, as every listing omits them. Aliases never appear, a Command's or an option's. A deprecated member appears with its migration message under `deprecated`.
- **The envelope.** `name`, `version`, and `description` are the graph's. `tokens` states the token rule once, so no entry repeats it: what a schema describes, that a `null` schema means unknown, and that an example omits the application name. `exitCodes` carries the five codes core resolves itself with the Meaning column's text from the [Invocation](#invocation) table, code formatting removed, and a row for each other code a [declared failure](#manifest-failures) carries anywhere in the application, as that section states. It omits the application's range row. `encodings` states what the [media types](#media-types) `application/json` and `application/jsonl` promise, under the keys `json` and `jsonl` the document has always carried; a Command's `result.mediaTypes` names the views that declare each, so the statements apply by media type and never by view name. The three statements are fixed strings, the same in every document.
- **A Command entry.** It mirrors `CommandNode` without `aliases`, `hidden`, and `extensions`, and adds `details`, `examples`, and `failures` from the Command's [`manifestCommand`](#manifest-extension) values: `details` holds each value's `details`, one string per value that holds one, and `examples` and `failures` concatenate each value's lists, all in collection order. At the root, `description` is the Application's, as the graph reports it.
- **An input entry.** An argument entry mirrors `ArgumentNode` without `validated`, `validateOmitted`, and `extensions`. An option entry mirrors its `OptionNode` variant without `hidden`, `aliases`, and `extensions`, so it carries `control`, which tells an agent the option controls the invocation rather than feeding the Command's work, and on the string variant without `validated` and `validateOmitted`, so a plugin's option and an application's read alike and the document names no plugin. `validated` and `validateOmitted` describe how core runs a validator, and an agent reads `schema: null` as unknown whatever they hold. `schema` is the graph's [input schema](#input-schema), copied verbatim. `default` is `{ "value": <declared value> }`, or `null` when the input declares no default or declares `undefined`. `env` is the graph's [environment binding](#input-sources), the variable an agent may set in place of the option, or `null`; it sits before `default` on the string variant and last on the Boolean and counted variants, which carry no default, and its arrival is an ordinary change under the stability rule below. `implied` is the string variant's [implied value](#implied-values), or `null`, last on that variant, and the counted variant, `type: "count"`, carries no `negative`, `polarity`, `required`, `multiple`, or `default`, because a [counted option](#counted-options) has none; an agent reads its value as the number of times it is supplied. Both arrive as ordinary changes under the stability rule below. A hook-declared option, `--format` included, is an ordinary local option entry.
- **Absence.** Every field is present in every entry. An absent scalar reads `null`, an empty list reads `[]`, and a Command with no result reads `result: null`, which is how an agent learns that `--format` is absent there.
- **Key order.** Every object the plugin builds holds its keys in the order the type block lists them. `result` holds `kind`, `views`, `default`, and `mediaTypes` in that order, and `mediaTypes` holds its keys in record order. A `schema` object and a default value keep the key order of the graph's snapshot, as JavaScript enumerates it.
- **Bytes.** The document is `JSON.stringify(document, null, 2)` and one newline, written to stdout with no style, so the bytes are the same under every capability. The text is escaped as the formatter's `json()` escapes it: through `style.escape`, with every character from U+007F to U+009F replaced by its `\uXXXX` escape in four lowercase hex digits. A declared default or a published schema that is not plain JSON data, meaning `null`, a Boolean, a finite number, a string, or an array or plain object holding only these, fails the write: the `out.render` call rejects as the output-view row of the [Failure contract](#failure-contract) states, nothing is written, and the middleware's rejection reports `Internal error: The manifest cannot encode the default of option "--odd" as JSON. Supply a value that is null, a Boolean, a finite number, a string, or an array or plain object of these.` with code 1, as a throwing help page reports; a schema reads `the schema of option "--odd"` in the same place, and an argument reads `argument "<name>"`. A declared default is snapshotted as the author wrote it and a hand-written converter's schema keeps whatever it returned, so a `bigint`, `NaN`, a function, a `Date`, or a `Map` in either would otherwise print a value the author never declared, and a value that holds itself, which core copies with its cycle, has no JSON text at all. The middleware writes through a bare view the plugin does not declare, so no override reaches it: the document is data, as a result's `json` output is, and an application that wants another document writes its own projection.
- **Stability.** The document carries no version of its own. The Application's `version` is its only version identity. A field keeps its meaning across releases, a later fact arrives as a new field, and a consumer ignores fields it does not know. An option entry may arrive with a new `type`; a consumer reads an entry whose `type` it does not know by the fields it does know.

#### Manifest extension

```ts
// src/manifest/extension.ts, the declarations module of the @loomcli/plugins/manifest subpath
import Package from '../../package.json' with { type: 'json' };
import { extension } from '@loomcli/core';
import { z } from 'zod';

// The pack's shared line and prose rules, which help's schema also uses.
import { line, prose } from '../lines.js';
// failureEntry accepts { failure, meaning }, where failure is a class that extends LoomError,
// and outputs { code, exitCode, meaning } from the class's failure code and declared exit code.
import { failureEntry } from './failures.js';

export const manifestCommand = extension(`${Package.name}/manifest/command`, {
  collect: true,
  schema: z.object({
    details: prose.optional(),
    examples: z.array(z.object({ command: line, note: line.optional() })).optional(),
    failures: z.array(failureEntry).optional(),
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

- **The extension.** `manifestCommand` is a [collecting extension](#collecting-extensions) on Commands with the identity `@loomcli/plugins/manifest/command`. `details` is prose under the rule help's `details` follows: every line holds a character other than whitespace, and line breaks are kept. `examples` lists invocations: `command` holds the tokens after the application name as one line, and `note` is one line.
- **Who supplies values.** A value is meant for an agent because it lands in the manifest. The author's own value is where an instruction goes that an agent needs beyond the help page. A plugin's value holds the facts that plugin chooses to project into the manifest, as help's hook does under [Help in the manifest](#help-in-the-manifest).
- **An empty value.** A value that holds none of the fields is accepted and stored, and the manifest prints nothing for it.

#### Manifest failures

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

- **An entry.** `failure` is the class, and the extension reads its [failure code](#failure-codes) and its `exitCode` when the value is made, as [Declared exit codes](#declared-exit-codes) lets a projection read a code without an instance. The schema outputs `{ code, exitCode, meaning }`, plain data alone as every extension value holds, so the class never reaches the graph. The schema's input type for `failure` is `unknown`, because no typed path names a class without an assertion, so a value that is not a failure class is rejected at run time alone. The entry carries no hand-written name: `code` is the class's failure code, which survives a minifying build where a class name does not, so a class that declares none lists the code it inherits, such as `fatal`. `meaning` is one line. A value that is not a class extending `LoomError` and a meaning that is not one line are rejected at the call by the extension's schema. A class whose exit code is not declarable, or whose failure code is outside its grammar, is rejected there too, with the sentence core throws when it constructs that class. The schema guards every read of the class, so it answers synchronously and the author's error never escapes the call. A static `exitCode` getter that throws reads as an exit code that is not a finite number, and a static `code` getter that throws reads as a failure code that is not a string. A `prototype` read that throws, such as a proxy's, reads as a value that is not a failure class. A static `name` that is not a string is read as text, as core reads it, so `static name = 42` reads `Failure class "42"`. A static `name` that throws, or that cannot be read as text, names the class in the sentence as the empty name an anonymous class has, `Failure class ""`.
- **Per Command.** A Command's list is what its own values declare. A Command inherits nothing from its parent or the root, so a failure every Command can raise is listed on each, and a shared constant, as above, keeps the lists in step.
- **From plugins.** A plugin that raises its own failures, or ships [translators](#translators) that return them, supplies entries through its `onCommandAttach` hook, as help supplies `details`.
- **The entry's field.** `failures` lists `{ code, exitCode, meaning }` in collection order. Two entries on one Command with the same failure code, exit code, and meaning print once, at the first. A Command that declares none reads `[]`.
- **The table.** `exitCodes` keeps core's five rows and their text. Each other code any Command in the application declares, hidden Commands included, gains a row, `Declared failures: ` followed by the failure codes that carry it, comma-separated, in the order they are first met walking the graph from the root depth-first, each Command's children in `CommandNode.children` order. A declared failure whose code is 1 or 2 adds no row, because core's row already explains the code, and it still appears in its Command's `failures`. The rows print in ascending numeric order, as JavaScript enumerates integer keys.
- **One code, one failure.** A failure code means one failure across the application. Two entries with one failure code and a different exit code or meaning, such as two `FatalError` subclasses that declare no code and different exit codes, are a `DeclarationError` under the rule `@loomcli/plugins/manifest/failure-code-conflict` that the manifest's middleware throws when it builds the document, naming the code and both Commands, `Failure "invalid-json" is declared with exit code 65 on Command "get" and exit code 1 on Command "select". Declare one exit code and one meaning for each failure code.`, which `run()` reports by build under [Development builds](#development-builds). Its two findings rebuild each declaration as the `manifestCommand({ failures: [...] })` entry the graph holds, `{ code, exitCode, meaning }`, mark the key the two disagree on, and note the Command that declares it. The rule takes the package's name and the manifest plugin's subpath, as the grammar of [diagnostic rules](#developer-diagnostics) and of issue codes reads it.
- **Breaking.** The entry's `name` is retired, and the document's failure entries carry `code` in its place. The entry's schema names `failure` and `meaning` alone, so a stale `name` is dropped like any key the schema does not name, not rejected. TypeScript rejects it only in an entry literal written inside the `manifestCommand()` call; a shared constant, such as `readFailures` above, compiles with it. The implementation PR's breaking change fragment tells authors to move each name to a static code on its class, `static override readonly code`; two classes left on an inherited code with different exit codes or meanings report the one-code rule above.

#### Manifest acceptance

The manifest is proven when both example applications install `manifest({ short: 'M' })` after their formatter and ahead of the example plugin, and public APIs alone produce these results under Node and Bun:

- **Pinned documents.** `textstat --manifest`, `jsonkit --manifest`, and `jsonkit get --manifest` print documents compared byte for byte. `jsonkit get`'s `details` holds the author's value ahead of help's. `jsonkit fetch --manifest` shows the deprecated Command's message. `jsonkit debug --manifest` prints the hidden Command's own slice, and the root document omits it.
- **An agent-shaped run.** A process test reads `textstat --manifest` alone, builds an invocation from it by choosing `--metric` from its schema's enum and `--format json` from the result's views, runs it, and parses stdout as the `json` encoding states.
- **Help pages.** Every help page lists the `--manifest` row among its options, and the golden pages are re-pinned for it.
- **Short spellings.** `textstat -M`, `jsonkit -M`, and `jsonkit get -M` print the same documents as their long forms. A fixture proves no short spelling by default, either case of an ASCII letter accepted, invalid settings rejected at the factory call, and collisions with an application global, a local option, and another plugin reported under the ordinary spelling-taken rule.
- **Takeover and precedence.** `jsonkit get --manifest` without its required argument prints with exit 0, and so does `--manifest` on a group in a fixture application. An unknown Command still reports its routing error. `jsonkit --help --manifest` prints help and `jsonkit --version --manifest` prints the version. A `--manifest` token after `--` is not read as the option.
- **Entries.** Fixture applications cover: a hidden option and a hidden global omitted. An explicit `default: undefined` reads `null`. Two `manifestCommand` values with `details` produce two strings in collection order, and a value with neither field adds nothing. A U+009B inside a description prints as `\u009b`. A declared `bigint`, `NaN`, or function default, and a published schema holding `NaN`, fail the write. Keys follow the type block's order, `result` included, and no version field appears.
- **Declared failures.** jsonkit declares `invalid-json` on every Command that reads a document and `path-not-found` on `get`, `keys`, and the deprecated `fetch`, which runs `get`'s action, all 65, and `jsonkit get --manifest` prints the document above byte for byte, with the `65` row between `2` and `130`. A malformed document given to each Command that declares `invalid-json` exits 65, the code its manifest lists. Fixture applications cover: a Command with no declared failures reading `[]`; a class that declares no exit code listing 1 with no row added; a `FatalError` subclass that declares no failure code listing `fatal`; one failure code declared on two Commands with one exit code and meaning listed on both with one row; one failure code with two exit codes, and with two meanings, reporting its `DeclarationError`; an author value and a plugin's `onCommandAttach` value concatenated in collection order, with an identical pair printed once; a hidden Command's code joining the table; a value holding a function that is not a failure class and a meaning with a line break each rejected at the call; a stale `name` dropped from the entry; and a failure class whose static `exitCode` is 200, and one whose static `code` is `'Bad_Code'`, rejected at the call.
- **Control options and media types.** Every option entry carries `control`, `true` on `--help`, `--version`, `--manifest`, and `--format` and `false` on jsonkit's own options, and every `result` carries `mediaTypes`. A fixture whose `json` key holds a view that declares no media type, and whose `wire` key holds a mapped `json()`, reads its media types from the result, and the pinned documents are re-pinned for both fields.
- **Packed consumers.** A consumer installs the packed pack, imports `@loomcli/plugins/manifest` and `@loomcli/plugins/manifest/extension`, compiles against their declarations, and runs its chosen `-M`.

### Configuration

```ts
// @loomcli/plugins/config
import type { Plugin, PluginOptions, StringOption } from '@loomcli/core';

const options = {
  config: { control: true, description: 'Read configuration from this file alone.', type: 'string' },
} satisfies PluginOptions;
export type ConfigOptions = typeof options;
export interface ConfigSettings {
  /** The configuration file's name or relative path, a file pattern. Defaults to `.<app>.json`. */
  readonly file?: string;
  /** The short spelling of `--config`, none by default. */
  readonly short?: NonNullable<StringOption['short']>; // one ASCII letter, as every option's short spelling is
}
export declare function config(settings?: ConfigSettings): Plugin<ConfigOptions>;

// src/config/extension.ts, the declarations module of the @loomcli/plugins/config subpath.
// configPath is the dotted-path schema the rules below state.
export const configInput = extension(`${Package.name}/config/input`, {
  schema: z.object({ path: configPath }),
  target: 'option',
});
```

```ts
import { Application } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';

const app = new Application('textstat', {
  plugins: [config({ file: '.textstat.{toml,json}', short: 'c' })],
})
  .option('min-bytes', {
    env: 'TEXTSTAT_MIN_BYTES',
    extensions: [configInput({ path: 'minBytes' })],
    type: 'string',
    validate: byteThreshold,
  })
  .action(count);
```

```toml
# .textstat.toml
minBytes = 5
total = true
```

`config()` is the configuration plugin, the first-party [configuration source](#input-sources). It answers the configuration tier from one JSON, TOML, or YAML file per run: the file `--config` names, or else the first found of the author's `file` in the working directory and then in the operator's home directory. Accepted [ADR-0054](decisions/0054-the-configuration-plugin-reads-one-file-per-run-found-by-the-authors-file-pattern.md) records the decision and supersedes most of [ADR-0039](decisions/0039-the-configuration-plugin-reads-layered-json-files-and-fails-only-on-the-file-the-operator-names.md). Its identity is `@loomcli/plugins/config`, its binding is `configInput`, and it declares one global option, `--config`, and no middleware. Its resolver module loads through `source.load` only when core calls the source.

- **The binding.** `configInput({ path })` is an option-target descriptor with the identity `@loomcli/plugins/config/input`, exported from the declarations module `@loomcli/plugins/config/extension`. A local option, a global option, and another plugin's option may carry it, and an option that carries it is configuration-bound under [Input sources](#input-sources).
- **The path.** `path` is dotted: it splits on `.`, and each segment is one object key. A segment is nonempty and holds no control character and no line separator, U+2028 or U+2029. There is no escaping and no array indexing, so a key that holds a dot is not reachable. A path that breaks the rule is rejected by the descriptor's schema, so `configInput({ path: 'a..b' })` throws at the call as any rejected extension value does, with the issue `Supply a dotted path of nonempty keys with no control character.`
- **Settings.** `config(settings?)` takes one optional settings object with two keys. `short` gives `--config` a short spelling under [Plugin settings](#plugin-settings), so `config({ short: 'c' })` lets an operator type `-c`, and with none `--config` has no short spelling. `file` names the configuration file the plugin looks for, and with none the plugin looks for `.<name>.json`, where `<name>` is `graph.name`, which it reads when the source runs because `config()` cannot know the application name. `config()` applies `checkShortSetting(settings, { plugin: '@loomcli/plugins/config', call: 'config', option: 'config' })` first, so settings that are not an object throw `@loomcli/core/not-an-object` and a `short` that is not one ASCII letter throws `@loomcli/core/short-alias`, and then judges `file`.
- **The file setting.** `file` is a file name or a relative path, such as `.mimir.toml` or `.norn/config.toml`: a nonempty string with no control character that does not start with `/`, `\`, or a drive letter and a colon, and whose segments, split on `/` and `\`, are each nonempty and neither `.` nor `..`. Any other value throws a `DeclarationError` from `config()` under `@loomcli/plugins/config/file-path`, headlined `Invalid configuration file path`: `Plugin "@loomcli/plugins/config" file is not a relative path. Supply a relative path such as .textstat.toml, with no control character and no empty, ., or .. segment.` The finding rebuilds the `config()` call and marks `file`.
- **Formats.** A file's extension chooses its parser: `.toml` reads as TOML through `smol-toml` (TOML 1.0, with the TOML 1.1 additions it accepts), and `.yaml` and `.yml` as YAML 1.2 under its core schema through `yaml`. Every other name reads as JSON: `.json`, a name with no extension, such as `.textstatrc`, and a name with any other extension, such as `.textstat.conf` or `config.cfg`. The rule is the same for a discovered file and the `--config` file. The file name is the path's last segment, and its extension is the text after its last `.`, unless that `.` is the name's first character. Extensions compare as written, so `.TOML` reads as JSON.
- **File patterns.** `file` is a file pattern. Glob syntax, the characters `*`, `?`, `[`, `]`, `{`, and `}`, may appear only as the whole extension of its last segment, in one of two forms: `*`, which accepts any format the plugin reads, or a brace list, `{toml,yaml}`, which accepts the formats it lists and lists only `json`, `toml`, `yaml`, and `yml`. A `file` with no glob syntax is literal, and its extension locks its format, so `.textstat.conf` reads only as JSON. A pattern's candidates are, in order, the brace list's extensions as listed, an extension listed twice counting at its first position, or for `*` `toml`, `yaml`, `yml`, then `json`; a literal name is its own one candidate. After the path check, `config()` checks the pattern under `@loomcli/plugins/config/file-pattern`, headlined `Invalid configuration file pattern`. Glob syntax anywhere but as a whole extension of `*` or a brace list, in a directory segment, in the name before its extension, or in an extension such as `t*`, throws `Plugin "@loomcli/plugins/config" file holds glob syntax other than an extension of * or a brace list. Write the name literally, and use * or a brace list only as the whole text after its last dot.` Then a brace list that lists anything other than `json`, `toml`, `yaml`, and `yml`, such as `.textstat.{toml,ini}` or an empty item, throws `Plugin "@loomcli/plugins/config" file lists an extension the plugin cannot read. List only json, toml, yaml, or yml in the braces, or use * for any of them.` A literal name never meets the second sentence. The finding marks `file`.
- **Lookup.** A run reads at most one configuration file, and nothing is merged across files. With `--config <path>`, that file is the configuration and the plugin looks nowhere else. The path is not a pattern, so `*` and braces in it are part of the name, a relative path resolves against `host.cwd`, and its extension chooses its parser as **Formats** states. Without `--config`, the plugin looks for `file` in `host.cwd` and then in the home directory, and reads the first file it finds. The home directory is `host.env.USERPROFILE` when `host.platform` is `win32` and `host.env.HOME` on every other platform. A home variable that is unset, empty, or a relative path gives no home directory, and when the home directory resolves to `host.cwd` the plugin looks there once. `host.platform` chooses only the variable; the plugin builds and resolves every path with the running process's `node:path`, against `host.cwd` and never `process.cwd()`. It searches no parent directory and expands no `~`.
- **Candidates.** In each directory, the first of the pattern's candidates that something is at is the file the plugin finds there. Every later candidate also present in that directory is skipped and never read, and the source writes one warning through `out.warn`, ahead of any warning about the file it found: `Skipped <file>: <chosen> matches the same pattern first. Keep one of the files, and remove the others.`, where `<file>` is every skipped candidate in candidate order, joined by `, `, and `<chosen>` is the file found, each shown as a label shows a file. A later candidate never answers in place of a broken first one.
- **Reading.** Core calls the source only when an option is unfilled and configuration-bound, so a run that needs no configuration value reads no file, the one `--config` names included. When it runs, the source reads the file it finds as UTF-8 with a leading byte order mark ignored, and parses it with `JSON.parse`, `smol-toml`, or `yaml` by its extension, so a TOML file reads as `smol-toml` reads it, a time written without seconds included. The source loads each of the two parser packages with a dynamic import only after it reads the text of a file of that kind, so a run that reads a JSON file loads neither. An empty JSON file is not valid JSON, an empty TOML file is an empty table, and an empty YAML file, or one that holds only comments, holds no mapping. A YAML file holds one document with unique keys and only the core schema's tags: a second document, a repeated key, a tag such as `!!binary`, `!!timestamp`, or a local `!tag`, and a mapping key that is a mapping or a sequence make it not valid YAML. An alias reads as the value its anchor names, an alias that names no preceding anchor makes the file not valid YAML, and a scalar key that is not a string reads as its text. A TOML document is always a table at its top level.
- **Answers.** For each request, the source reads the binding's path in the file. A path that meets a missing key, or a value that is not an object before its last segment, does not lead to a value, so the request has no answer and the option falls through to its default. A run with no configuration file answers nothing.
- **Values.** A string option takes a string as it is, or a finite number as `JSON.stringify` writes it, whatever the format wrote, so `5` fills `"5"` and the option's validator decides, and TOML `5_000` and YAML `0x1F` fill `"5000"` and `"31"`. A TOML integer beyond `-(2^53 - 1)` through `2^53 - 1` fills its exact decimal digits: the source reads it as a `bigint`, so `12345678901234567890` fills `"12345678901234567890"`. A TOML date or time fills its text as written in the file: `1979-05-27T07:32:00-08:00`, `1979-05-27 07:32:00`, `1979-05-27`, and `07:32:00.5` each fill as written, with no precision added and no separator changed. The YAML core schema has no date type, so `2001-12-14` is already a string. A Boolean option takes a JSON or TOML `true` or `false`, or a YAML core-schema Boolean, `true`, `True`, `TRUE`, or their `false` forms, which states the option's value, not a spelling, under every polarity, as an environment value does; a YAML `yes`, `no`, `on`, or `off` is a string. A [counted option](#counted-options) takes any number the format wrote that is a whole number of 0 or more, so `3`, TOML `1_0` and `3.0`, and YAML `0x3` fill `3`, `10`, `3`, and `3`, and `0` is a fill. A multiple option takes a JSON or TOML array or a YAML sequence whose items each follow the string rule, and an empty one is a fill. A string option with an [implied value](#implied-values) takes a value by the string rule and never its implied value. Any other value is a wrong value: a JSON `null`, a YAML null, written `null`, `~`, or as a key with no value, an object, table, or mapping, a Boolean for a string option, a string for a Boolean option, a string, a Boolean, or a negative or fractional number for a counted option, a bare value for a multiple option, and a number that is not finite, such as JSON `1e400`, which overflows to infinity, TOML `inf` and `nan`, and YAML `.inf` and `.nan`.
- **Labels.** An answer's label is `<path> in <file>`: `minBytes in .textstat.toml`. A file found in `host.cwd` shows as `file` names it, with a pattern's extension replaced by the candidate's, a file found in the home directory shows as its full path, and the `--config` file shows as the operator typed it.
- **Discovered files.** A file the lookup finds without `--config` is discovered. One that does not exist, including one under a directory that does not exist or under a path component that is a file, is not used and prints nothing. One the plugin cannot read, a directory in its place included, one that does not parse in its format, and one whose top level is not an object or a mapping are not used, and the source writes one warning for each through `out.warn`: `Skipped <file>: the file could not be read. Make it readable, or remove it.`, `Skipped <file>: the file is not valid JSON. Correct its syntax, or remove it.`, `Skipped <file>: the file does not hold a JSON object. Write its settings as one JSON object, or remove it.`, `Skipped <file>: the file is not valid TOML. Correct its syntax, or remove it.`, `Skipped <file>: the file is not valid YAML. Correct its syntax, or remove it.`, and `Skipped <file>: the file does not hold a YAML mapping. Write its settings as one YAML mapping, or remove it.` A broken file in `host.cwd` is treated as absent, so the lookup goes on to the home directory, and a run whose files are all absent or broken continues with no configuration.
- **The named file.** A `--config` file with any of those faults fails the run. The source throws an `InputError` whose one problem is `{ input: { kind: 'option', name: 'config', global: true }, spelling: '--config', reason: 'invalid', issues: [{ message: 'File "<path>" does not exist. Supply the path of an existing file.' }] }`, and stderr reads `<application>: Option "--config": File "<path>" does not exist. Supply the path of an existing file.`, opened by the application name, with `could not be read. Supply a file this process can read.`, `is not valid JSON. Correct its syntax, or supply another file.`, `does not hold a JSON object. Write its settings as one JSON object.`, `is not valid TOML. Correct its syntax, or supply another file.`, `is not valid YAML. Correct its syntax, or supply another file.`, or `does not hold a YAML mapping. Write its settings as one YAML mapping.` in place of the last clause. The problem spells the option `--config` whichever spelling the operator typed, and `config` in an [invocation by name](#invocation-by-name). The code is 2, and `--help` reports nothing, as [Input sources](#input-sources) holds every source `InputError`.
- **Wrong values.** A wrong value at a request's path fails the run with an `InputError` whose `invalid` problem names the requested option. The problem spells the option with core's [`reportedSpelling`](#failure-classes), `--no-<name>` included, and carries `global` from the request: `textstat: Option "--min-bytes" (from minBytes in .textstat.toml): Use a string or a number.` In an [invocation by name](#invocation-by-name) the problem names the option by its declared name, `Option "min-bytes" (from minBytes in .textstat.toml): Use a string or a number.` A Boolean option reads `Use true or false.`, a counted option reads `Use a whole number of 0 or more.`, and a multiple option given a bare value reads `Use an array of strings or numbers.` An array item that breaks the string rule reads its position after the parenthesis, `Option "--field" (from fields in .textstat.toml) at 1: Use a string or a number.` Each array item that breaks the rule is one issue with `path: [index]`, so an array with several bad items is one problem. Each wrong value is one problem, in the order core requested the options, the error's message is each problem's line joined by a newline, as core's validation message is, core's default text opens each of those lines with the application name, and the source answers nothing when it throws.
- **Text.** Every sentence above is fixed and carries no parser message, the YAML parser's warnings included, so the bytes are the same under Node and Bun and no file content reaches the terminal. Each character [`escapeControlCharacters`](#strings-and-composition) escapes in a file path or a bound key path prints as that escape wherever the path leaves the plugin: in an answer's label, which core prints as it is, in a warning, the candidates a several-candidates warning names included, and in a failure. A wrong value's position is read with [`issuePath`](#failure-classes) and escaped the same way. A warning escapes each path with `style.escape` before the call.
- **Portability.** The plugin reads files through `node:fs/promises` and joins paths through `node:path`, which Node and Bun both provide. It is the one pack module that imports either. `yaml` (ISC) and `smol-toml` (BSD-3-Clause) are runtime dependencies of `@loomcli/plugins` beside `zod`, each installed as its own package with its own license, so the pack's `license` field and NOTICE do not change.

#### Configuration acceptance

The configuration plugin is proven when textstat installs `config({ file: '.textstat.{toml,json}', short: 'c' })` and binds `--min-bytes` to `minBytes` and `--total` to `total`, and public APIs alone produce these results under Node and Bun, with `HOME` and `USERPROFILE` pointed at temporary directories through `host.env`:

- **Lookup.** textstat reads `minBytes` from `.textstat.toml` in `host.cwd`, from `<HOME>/.textstat.toml` when the working directory holds no candidate, from `<USERPROFILE>/.textstat.toml` under a `win32` host, and from no file when neither directory holds one. A file in the working directory hides the home file entirely, so a key only the home file holds is not read, and a broken file in the working directory warns and the home file answers. `config()` with no settings reads `.textstat.json`.
- **Precedence.** `TEXTSTAT_MIN_BYTES` beats the file, and a flag beats both.
- **`--config`.** `--config` and `-c` each name a file that answers alone, so a file in the working directory is not read. A named file that does not exist, is not valid in its format, or holds an array prints its failure with code 2, reports nothing under `--help`, and a run that fills every bound option from argv reads no file and exits 0.
- **Discovered files.** A missing file prints nothing. A directory in its place, an empty JSON file, invalid JSON, and a top-level array each print one warning and the run exits 0, and a broken home file under `--help` prints its warning before the page.
- **Formats.** `.textstat.toml`, `.textstat.yaml`, an extensionless file, and `.textstat.conf` each fill `--min-bytes` and `--total` under a `file` that names them, the last two as JSON, and a `--config` file reads by its extension. With `.textstat.toml` and `.textstat.json` both in one directory, the TOML file answers and the several-candidates warning prints once, and a run whose file is JSON loads neither parser. A broken TOML file, a broken YAML file, an empty YAML file, and a YAML file with a second document or a `!!binary` tag each print their warning when discovered and fail with code 2 when named.
- **Values.** A counted option in a fixture reads `3` as `3` and `0` as `0`, and `"3"`, `-1`, and `1.5` print its wrong-value failure. `5` fills `--min-bytes` as `"5"`, a string for `--total` and an object for `--min-bytes` print their wrong-value failures with code 2, and a multiple option in a fixture reads an array, an empty array, and an array with an object at position 1. A TOML date and a local time with one fractional digit fill their text as written, a TOML integer beyond the safe range fills its exact digits, and a YAML `no` for `--total` is a wrong value.
- **Paths.** `"limits": 5` leaves `limits.bytes` unanswered, so the option takes its default, and `configInput({ path: 'a..b' })` throws at the call.
- **Escaping.** A `--config` path that holds U+001B prints it as `\u001b` in its failure and in the label of a filled value a validator rejects, and a home directory that holds it prints it as `\u001b` in its warning.
- **Edges.** `config({ file: '/etc/textstat.json' })`, `config({ file: '*.json' })`, `config({ file: '.textstat.{toml,ini}' })`, and `config({ short: 'cc' })` throw from `config()` under their rules, a file that starts with a byte order mark reads, two wrong values print two lines in request order, each opening with the application name, the home file's label shows its full path, the `problems` of a source `InputError` reach an override of the `InputError` view, and a local structure fault outranks a source `InputError`.
- **Packed consumers.** A consumer installs the packed pack, imports `@loomcli/plugins/config` and `@loomcli/plugins/config/extension`, compiles against their declarations, and reads a value from a file.

### Completion

```ts
// @loomcli/plugins/completion
import type { Plugin } from '@loomcli/core';

export declare function completion(): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';

export const jsonkit = new Application('jsonkit', { plugins: [help(), completion()] });
```

```sh
source <(jsonkit completion bash)   # in ~/.bashrc
source <(jsonkit completion zsh)    # in ~/.zshrc, after compinit
jsonkit completion fish | source    # in ~/.config/fish/config.fish
```

```text
$ jsonkit completion __complete -- ke
keys→List the keys at a path.
:4
```

`completion()` is the completion plugin. Its identity is `@loomcli/plugins/completion`, and it declares no options, no middleware, and no extension; its whole contribution is one [plugin Command](#plugin-commands). `jsonkit completion zsh` prints a script, and the operator's shell sources it. From then on, each Tab runs the script, which calls `jsonkit completion __complete` with the words typed so far and inserts what it answers. The script holds no copy of the Command tree, so it never goes stale when the application changes. [ADR-0043](decisions/0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) records the decision: the scripts and the answer follow [Cobra](https://github.com/spf13/cobra)'s, and nothing typed is ever evaluated. In the answer above, `→` stands for one tab character.

- **The Commands.** `completion` is a group, `Print a shell completion script.`, with the children `bash`, `zsh`, and `fish`, each `Print the <Shell> completion script.`, and the hidden `__complete`, `Answer a completion script.` No child declares an argument or an option, and none declares a result, so `--format` never applies. A group cannot declare arguments beside children under [ADR-0004](decisions/0004-arguments-and-children-are-exclusive.md), so the shell is a child and not an argument, and `jsonkit completion` prints the missing-subcommand error that lists `bash, zsh, fish`. Printing is the whole feature: installing or removing a script, and PowerShell, are not offered.
- **Exact bytes.** Each action writes through `host.stdout` in one write, because `out` styles text and appends a newline. A shell action writes its script, and `__complete` writes its answer; a failure in either writes nothing to stdout.
- **The callback.** The script runs `<program> completion __complete -- <words>`, where `<program>` is the first word with its quoting removed and no expansion, and `<words>` are the words after it, the last cut at the cursor and empty when the cursor starts a new word. The words arrive in `passthrough`, so the parser never reads one of them as an option and a typed `--help` activates nothing. `__complete` passes them to [`locate`](#locating-a-word) with the action's `graph`. Each Tab is an ordinary run: always-on middleware and the configuration source run as on any run, and the script discards stderr. Stdout that an always-on middleware, or a plugin activated through its environment binding, writes on a `__complete` run is read as offered words, so a plugin that writes to stdout on a run it does not own breaks completion.
- **Offered words.** By the position `locate` reports:
  - `command`: the canonical names of the node's children, each with its description, and directive `4`.
  - `option`: the long spellings of the options in scope, a Boolean's negative spelling included, and also the short spellings when `prefix` is exactly `-`, each with its option's description, and directive `4`. An option in `supplied` is left out unless it is a multiple string option or a counted option, which another occurrence still adds to.
  - `value` and `argument`: the values of the closed set the input's `schema` names, each written after `lead` under `value`, with no description, and directive `4`. The closed set is the one help derives for its [accepted values](#accepted-values), read through one package-internal module outside either subpath, beside `encode.ts`, that help and completion both import. The module returns the whole set, and each reader applies its own bound: help keeps its limit of eight under Bounds, and completion offers every value, so a Command with more than eight view names completes each of them. An input with no closed set, a `null` schema included, offers nothing with directive `0`, so the shell completes file names.
  - `passthrough`: nothing, with directive `0`.
  - `none`: nothing, with directive `1`.

  A string option with an [implied value](#implied-values) has its values offered only after `=`, as `--backup=<Tab>`, or after its short letter in the same word, because `locate` reads a bare spelling as complete: after `--backup` and a space, completion offers what the next word may otherwise be and awaits no value.

  A hidden or deprecated Command or option is never offered, and one typed in full still routes and completes past. An alias, a Command's or an option's, is never offered and never rewritten: `locate` routes through it and reads an option alias's value, and completion reads no alias. Only words that start with `prefix`, compared by code unit, are offered, a value compared before `lead` is added to it, so `--format=j` offers `--format=json`, in graph order with repeats removed.
- **The answer.** One line per offered word: the word, then, when it has a description, a tab and the description. The last line is `:` and the directive. Every line ends with a newline. The directive numbers are Cobra's: `1` error, `2` no space, `4` no file completion, `8` filter by file extension, `16` directories only, `32` keep order, and `0` the shell's default. The plugin writes `0`, `1`, or `4`, and the scripts honor all of them, except that the Fish script, as Cobra's does, completes every file name under `8` and `16`.
- **Exact or omitted.** An offered word that holds a control character or a line separator, U+0000 through U+001F, U+007F through U+009F, U+2028, or U+2029, is left out rather than cut, so completion never inserts a value the graph does not hold. An empty value, a value holding a lone surrogate, which the shell would receive as U+FFFD, and a value that starts with `_activeHelp_ `, which Cobra's scripts read as help text, are left out too. So is a word whose first character is `~`, because Bash 3.2 and Fish insert it unescaped and it would expand when the line runs; a `~` later in a word, such as after `--format=`, is offered. The Bash script escapes every `~` it inserts, because Bash expands a `~` after `=` or `:` in a word shaped like an assignment. A description is display text: its first line, with every such character removed, and no tab when nothing is left.
- **The scripts.** The Bash, Zsh, and Fish scripts are ported from Cobra, with Cobra's Apache-2.0 notice and license text kept beside them in the pack and the changes stated. Each inserts an offered word through its shell's own completion call as one exact value. The Bash script runs on Bash 3.2 and later, with or without the bash-completion package. A Bash without `compopt`, such as 3.2, cannot turn default file completion off, so there the script registers without it and completes file names itself, only when the directive allows files and no word was offered. Without the bash-completion package's `_filedir`, the Bash script lists file names by pathname expansion of the typed word with only a trailing `*` unquoted, and it calls no `compgen -f` or `compgen -d`, because in a completion Bash 3.2 expands the directory part of their word. The Bash script escapes every word it inserts with `printf %q`, and a leading `~` too. With several matches it lists the escaped words, so the common prefix readline inserts is escaped text. The Zsh script's completion function is `_loom_<identifier>`, so no application name shadows a completion system function such as `_describe`.
- **No evaluation.** A script never evaluates text. Every `eval` in Cobra's scripts is removed, and so is every construct that expands an operand, such as Bash's `compgen -W`, which expands its word list: a script filters offered words by string comparison, and it honors directives `8` and `16` without evaluating an offered word. It calls the program with an argument array, so a typed word reaches the application as its characters and pressing Tab never runs it. It removes quoting without evaluating, through Zsh's `(Q)` flag, Fish's own tokenizer and `string unescape`, and a string-only decoder in the Bash script, and it performs no expansion, so `~`, `$HOME`, and `$(…)` reach the application as typed, and the Bash file listing never rewrites them; a Bash with `compopt` leaves the fallback to its own default file completion, which keeps the typed `$HOME/` and may append a file name it finds under the expanded directory. Zsh's default Tab widget, `expand-or-complete`, expands a typed `$(…)` before any completion function runs, so in Zsh pressing Tab runs it whether or not the script is installed; `bindkey '^I' complete-word` binds Tab to completion alone and avoids it. When the word under the cursor holds an unclosed quote, the script offers nothing and does not call the application. A nonzero exit, or an answer whose final line is not `:` followed by decimal digits, offers nothing.
- **The name.** The application name reaches a script only as data: as a single-quoted string in its shell's quoting, for Bash and Zsh with each `'` written as `'\''`, and for Fish, whose single quotes read `\'` and `\\` as escapes, with each `\` written as `\\` and each `'` written as `\'`; as the suffix of a function identifier in which every character outside `A-Z`, `a-z`, and `0-9`, `_` included, is written as `_` and its code point's lowercase hexadecimal digits and another `_`, so `git-lfs` gives `git_2d_lfs` and no two names give one identifier, and in the Zsh `#compdef` comment and autoload check as it is, because a portable name holds nothing a comment or a double-quoted string can misread. Each script generator throws a `TypeError` for a name outside the portable set, so no other name reaches a script. No author can reach it: `new Application()` already holds its name to that set under `@loomcli/core/portable-name`, so the check is a defect guard, not a declaration rule. The quoting and the identifier encoding stay, because `.` and `-` are portable and neither is an identifier character, so any name the constructor accepts yields a script that runs nothing but completion.
- **Where it installs.** A root that declares arguments cannot hold children, so textstat cannot install completion, as [Plugin Commands](#plugin-commands) states.

#### Completion acceptance

Completion is proven when jsonkit installs `completion()` and real Bash, Zsh, and Fish shells, driven through a pseudo-terminal, with Bash run as the system Bash 3.2 on macOS and again with the bash-completion package sourced where it is installed, complete against the scripts `jsonkit completion bash`, `zsh`, and `fish` print, under Node and Bun. The line each Tab leaves is read back from the shell; the words Bash and Zsh list are read from the terminal, and the words Fish lists from `complete -C` in a separate Fish that sources the same script. The run from a terminal relies on [ADR-0044](decisions/0044-a-global-option-declares-no-presence-rule.md): a global option declares no presence rule, so jsonkit's `--file` rule lives in its document reader and a completion request never meets it.

- **Commands.** `jsonkit <Tab>` offers the root's visible children, and never `fetch`, which is deprecated, `debug`, which is hidden, or `ls`, which is an alias. `jsonkit ls --<Tab>` offers the options in scope at `keys`, its own and every global option, and `jsonkit completion <Tab>` offers `bash`, `fish`, and `zsh` and never `__complete`.
- **Options.** `jsonkit paths -<Tab>` offers long and short spellings, `--<Tab>` long spellings alone, and an option already given is not offered again, while `select`'s multiple `--field` is.
- **Counted options.** `jsonkit -v --<Tab>` offers `--verbose` again, as `select`'s `--field` is offered again.
- **Implied values.** In a fixture with `backup` implying `simple` and a closed set of values, `--backup=<Tab>` offers the values as whole words that begin `--backup=`, and `--backup <Tab>` offers what the next word may be and no value.
- **Values.** `jsonkit paths --format <Tab>` and `--format=<Tab>` offer the view names, the second as whole words that begin `--format=`, `jsonkit --file <Tab>` falls back to file names, and `jsonkit paths --format a<Tab>`, which matches no view, offers no file name either.
- **Injection.** In a fixture application, a closed-set value `$(touch sentinel)`, one holding a backtick command, and one holding `;touch sentinel` are each inserted as text, two values that share the prefix `$(touch sentinel)` or `a b` insert that prefix as quoted text, values holding `\` and `\:` insert as they are, a value holding a newline is not offered, a typed word `$(touch sentinel)` before the cursor is passed as text, in Bash a typed `$((x[$(touch sentinel)]))/` or `$HOME/` under the file fallback runs and rewrites nothing, and no sentinel file ever exists. A unit test shows that each script generator refuses a name outside the portable set and that the script printed for each portable name sources without running anything.
- **Failing closed.** An unknown command earlier in the line, an unclosed quote under the cursor, a callback that exits nonzero, and an answer whose directive line is a bare `:` each offer nothing.
- **Framing.** A unit test reads `__complete` answers for every position kind, descriptions with tabs and line breaks, and directive lines, byte for byte.
- **Packed consumers.** A consumer installs the packed pack, imports `@loomcli/plugins/completion`, compiles against its declaration, and prints a script.

### MCP

```ts
// @loomcli/plugins/mcp
import type { Plugin } from '@loomcli/core';

export declare function mcp(): Plugin;
```

```ts
// @loomcli/plugins/mcp/extension, declarations alone
import type { Extension, StandardSchemaV1 } from '@loomcli/core';

// The value an author gives mcpCommand.
// The package exports no name for this shape.
interface McpCommandInput {
  readonly description?: string; // the tool's description, in place of the Command's
  readonly annotations?: {
    readonly readOnly?: boolean; // projected as readOnlyHint
    readonly destructive?: boolean; // projected as destructiveHint
    readonly idempotent?: boolean; // projected as idempotentHint
    readonly openWorld?: boolean; // projected as openWorldHint
  };
}
export declare const mcpCommand: Extension<'command', StandardSchemaV1<McpCommandInput>>;
export declare const mcpInput: Extension<'option', StandardSchemaV1<{ readonly description: string }>>;
export declare const mcpArgument: Extension<'argument', StandardSchemaV1<{ readonly description: string }>>;
```

```ts
import { Application, Command } from '@loomcli/core';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpArgument, mcpCommand } from '@loomcli/plugins/mcp/extension';

import { getValue } from './actions/get-value.js';

export const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [mcpCommand({ annotations: { openWorld: false, readOnly: true } })],
})
  .argument('path', {
    description: 'Dot path to read.',
    extensions: [mcpArgument({ description: 'A dot-separated path from the document root, such as user.name.' })],
    required: true,
  })
  .action(getValue);

export const jsonkit = new Application('jsonkit', { plugins: [mcp()] }).command(get);
```

An MCP client launches `jsonkit mcp` and speaks one JSON-RPC message per line over its stdin and stdout. Against jsonkit itself, which also declares the global `--file`, its version, and its description, the first line below is the client's request and the second is the server's answer:

```text
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}},"name":"jsonkit_get","arguments":{"path":"user.name","file":"doc.json"}}}
{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[{"type":"text","text":"\"Ada\"\n"}],"isError":false,"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"jsonkit","version":"0.9.0","description":"Read and reshape one JSON document."}}}}
```

`mcp()` is the MCP plugin. It serves every Command that opts in as one tool of a [Model Context Protocol](https://modelcontextprotocol.io/specification/2026-07-28) server over stdio, and it runs each tool call through [`invoke`](#invocation-by-name), so a call is the Command's own run with the same validation, failures, and exit codes. MCP is a projection: a tool listing is the graph's facts for the Commands that opted in, and nothing in core knows the protocol. The protocol itself lives in a private package the plugin pack compiles into its own files. [ADR-0063](decisions/0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) records the decision.

- **The plugin.** Its identity is `@loomcli/plugins/mcp`. `mcp()` takes no settings and declares no option, no middleware, and no view, and it claims no slot. It contributes one [plugin Command](#plugin-commands), the three extensions above, and an [`onGraphBuilt`](#judging-the-built-graph) hook. The Command is `mcp`, visible, with the description `Serve this application's tools to an MCP client over stdin and stdout.`, no arguments, no options, and no result. A root that declares arguments cannot hold children, so such an application cannot install the plugin, the limit [completion](#completion) has under [ADR-0033](decisions/0033-a-plugin-attaches-ordinary-commands-to-the-root.md).
- **Opt-in.** A Command is a tool when it carries an `mcpCommand` value, and only then. The root opts in through the Application's `extensions`. An explicit opt-in wins over `hidden`, so a hidden Command that carries the value is a tool, and the listing in help, the manifest, and completion still omits it. A deprecated Command that opts in is a tool whose description opens with its migration message. An alias is never a tool and never a second name. A Command with no action cannot serve a call, so `mcpCommand` on a group is a build fault.
- **Tool names.** A tool's name is the Command's path joined by `_`, with each `-` written as `_`, so `scratch create` is `scratch_create` and `cache clear-all` is `cache_clear_all`. The root's tool is the application name written the same way, so `git-lfs` serves `git_lfs`. A [portable name](glossary.md#names-and-routing) holds nothing else the protocol's tool-name characters exclude, and `.` stays. There is no name override. Two opted-in Commands whose paths give one name are a build fault that names both.
- **The description.** A tool's description is the `mcpCommand` value's `description`, or else the Command's core `description`, the Application's at the root. With neither, the tool carries no description. A deprecated Command's description opens with `Deprecated: ` and its migration message, then a line break and the rest. `description` is prose under the rule help's `details` follows: every line holds a character other than whitespace, and line breaks are kept.
- **Annotations.** `annotations` projects onto the protocol's tool annotations, `readOnly` as `readOnlyHint`, `destructive` as `destructiveHint`, `idempotent` as `idempotentHint`, and `openWorld` as `openWorldHint`. An unset hint is omitted, so the protocol's own defaults apply, and a tool with none set carries no `annotations`. They are hints the author owns and Loom never verifies: Loom infers none from the graph, and nothing but this plugin reads them, neither core nor help nor the manifest. A false claim is a defect in the author's application, and the protocol tells a client to treat annotations from a server it does not trust as untrusted.
- **The input schema.** A tool's `inputSchema` is `{ type: 'object', properties, required, additionalProperties: false }`, with `required` left out when it is empty. `properties` holds every argument of the routed Command in declaration order, then its local options in authoring order, then every global option in graph order, keyed by declared name, minus a [hidden](#hidden-and-deprecated-members) option and a [control option](#control-options). Passthrough is never exposed.
  - Each property is the input's [input schema](#input-schema) without its top-level `$schema` key, because the property lives inside a schema whose dialect is the protocol's default, JSON Schema 2020-12, the target the converter answers. Where the graph holds `null`, the property is derived from the node: `{ type: 'string' }` for a string option or an argument, `{ type: 'boolean' }` for a Boolean option, and `{ type: 'integer', minimum: 0 }` for a counted option. A multiple option or a variadic argument wraps its value's schema as `{ type: 'array', items: <schema> }`.
  - The plugin sets `description` from the input's `mcpInput` or `mcpArgument` value, or else its core description, and a deprecated option's opens with `Deprecated: ` and its message, as a tool's does. It sets `default` from a declared default that is plain JSON data and leaves it out otherwise. Either key replaces one the converter wrote.
  - `required` lists each required argument and each required local option, in property order. A global option is never required.
  - A Command whose tool would list an argument and an option under one name, a global option included, is a build fault, because a tool's arguments are one object. An author's argument and option may share a name everywhere else.
- **A call.** `tools/call` names a tool and passes `arguments`, an object or nothing. The plugin checks each key against the tool's `properties`: a key outside them, a hidden or control option's name included, is a tool execution error whose text is `Tool "jsonkit_get" takes no argument "x". Use a property its input schema lists.`, as the one text item with `isError: true` and no `structuredContent`, and no run starts. Otherwise the plugin splits the object, a key that names an argument going under `args` and every other key under `options`, and calls `invoke(path, { args, options }, { failure, signal, view })`. `view` is the first view, in record order, whose [media type](#media-types) is `application/json`, and it is omitted when the Command declares no result or no such view. `signal` is the call's own, which `notifications/cancelled` aborts. Values are not checked against the schema: [lowering](#invocation-by-name), the validators, and the run's own faults judge them and report by name.
- **A completed call.** `isError` is `false`, and `content` holds `output` as one text item and then `messages` as another, each only when it is not empty, or one empty text item when both are. When the view the plugin selected declares `application/json`, `structuredContent` is `output` parsed as JSON, any JSON value; when `output` does not parse, because a view's media type is a promise core never checks, the result carries the text alone. A `jsonl` view's output stays text. No content item carries annotations.
- **A failed call.** `isError` is `true`, and `content` holds `messages`, then any partial `output`, each only when it is not empty. The text is the failure's own report, by build, with no command-line hint, so a model reads what went wrong and what to do instead, and a defect in a distributed build reads the generic defect message. `structuredContent` is what the plugin's failure handler returns, `{ exitCode, failure }`: the outcome's exit code and the handler context's [failure form](#the-failure-form), `{ code, exitCode, message, hints }`. The form follows the build, so a defect in a distributed build reads `internal` and `Something went wrong.`, and its hints are the by-name hints, with no command-line hint. The handler exposes no cause and no stack. With both `messages` and `output` empty, as under an override view that renders nothing, `content` holds one empty text item, as a completed call's does.
- **A cancelled call.** The server sends no response for it, as the protocol asks.
- **Protocol errors.** The plugin answers these as JSON-RPC errors rather than tool results, because no run started:

  | Request                                                | Error                                                                                       |
  | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
  | `tools/call` naming no tool the server lists           | `-32602`, `Unknown tool "jsonkit_gte". Call tools/list for the tool names.`                 |
  | `tools/call` whose `arguments` is not an object        | `-32602`, `Tool "jsonkit_get" arguments must be an object. Supply a JSON object of named inputs.` |
  | `tools/list` with a `cursor`                           | `-32602`, `The cursor is not one this server issued. Call tools/list without a cursor.`     |
  | Every protocol rule of the private package             | The codes [The protocol package](#the-protocol-package) states                              |

- **Discovery.** `server/discover` answers `supportedVersions: ['2026-07-28']`, `capabilities: { tools: {} }`, with no `listChanged` because the tool list never changes while the process runs, and no `logging`, `prompts`, `resources`, or `completions` capability. The application's identity is the server's: every result's `_meta` carries `io.modelcontextprotocol/serverInfo` as `{ name, version, description }`, the graph's `name` and `version` and the Application's description, which is left out when it declares none. The result carries no `instructions`, because Loom holds no fact that guides a model beyond the descriptions.
- **The listing.** `tools/list` answers every tool in one page, in graph order: the root first, then each Command depth first in authoring order. It carries no `nextCursor`. `server/discover` and `tools/list` each carry `ttlMs: 0` and `cacheScope: 'private'`, so a client caches neither: a client may outlive the server process, and the next process may serve a newer application whose tools differ.
- **Concurrency.** Calls may overlap. Each runs through its own `invoke`, and the server writes each response when its call settles. Loom adds no queue, limit, or timer, so an application whose actions cannot overlap serializes its own work.
- **The server's life.** The `mcp` action reads `host.stdin` and writes `host.stdout`, and stdout carries protocol messages alone, each written whole. The server writes no log of its own, and stderr carries only a fault the `mcp` run itself reports. When stdin ends, the server aborts every call in flight and answers none of them, waits for each to settle, ends each open subscription with its closing response, and returns, so the run exits 0. When the run's signal aborts, through a caller or a [signals owner](#signals-and-cancellation), every call's signal aborts with it, the server answers nothing more, and the run resolves its cancellation code. A plugin that writes to stdout on a run it does not own breaks the stream, as it breaks [completion](#completion)'s answer.
- **Names.** `mcp` is exported from `@loomcli/plugins/mcp`, and `mcpCommand`, `mcpInput`, and `mcpArgument` from `@loomcli/plugins/mcp/extension`, whose identities are `@loomcli/plugins/mcp/command`, `@loomcli/plugins/mcp/input`, and `@loomcli/plugins/mcp/argument`. `mcpCommand` is an ordinary extension, so a later value replaces an earlier one. The pack's public declarations name no protocol type.

#### MCP build faults

The plugin's `onGraphBuilt` hook judges the opted-in Commands on every build, a run that never serves a tool included, and throws a `DeclarationError` under a rule of its own, which reports as itself under [Judging the built graph](#judging-the-built-graph). A sentence names the root as `the root Command`, capitalized where it opens the sentence, in place of a quoted path.

| Rejected declaration | Diagnostic | Rule |
| --- | --- | --- |
| Two opted-in Commands that give one tool name | `Commands "scratch create" and "scratch_create" both serve the MCP tool "scratch_create". Rename one Command, or remove mcpCommand from one of them.` | `@loomcli/plugins/mcp/tool-name-taken` |
| `mcpCommand` on a Command with no action | `Command "cache" carries mcpCommand and registers no action. Remove mcpCommand, or opt in the Commands under it.` | `@loomcli/plugins/mcp/tool-without-action` |
| An argument and an option a tool would list under one name | `Command "get" declares argument "path" and option "path", which one MCP tool lists under one name. Rename one of them, or remove mcpCommand.` A global option reads `global option "path"`. | `@loomcli/plugins/mcp/property-name-taken` |

#### The protocol package

The protocol is written in this repository, in the private workspace package `@loom/mcp` at `packages/mcp`, which is never published. It knows MCP and nothing of Loom, and the plugin speaks MCP only through it.

- **One revision.** The package holds one named constant, the protocol revision `2026-07-28`, and the protocol types of that revision alone. Moving to a later revision is a deliberate change to this package and the plugin's tests, never a dependency update.
- **Framing.** The stdio transport reads newline-delimited JSON-RPC 2.0 messages and writes each message as one line of `JSON.stringify` output with no indentation, followed by a line feed, so no message holds an embedded line break. A blank line, one that holds nothing but spaces, tabs, and carriage returns, is ignored. Any other line that is not JSON is answered with `-32700`, and a message that is not a JSON-RPC request or notification, a batch included, with `-32600`. A response from the client is ignored. A last line that ends without a line feed when stdin ends is read as one message.
- **Request ids.** A request whose id matches a call or a subscription still in flight is answered, before every other check, with `-32600` and a message naming the id in use, such as `The request id 7 is in use by a request still in flight. Send each request with an id no request in flight holds.` The request in flight keeps the id and runs untouched, so its answer stays the only one under that id and shutdown still waits for it. An id is free again once its request settles or the client cancels it.
- **Per-request checks.** Every request carries `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities` in its `params._meta`, and the server relies on no earlier request. A request missing either is answered with `-32602`. A request for any version other than `2026-07-28` is answered with `UnsupportedProtocolVersionError`, `-32022`, whose `data` is `{ supported: ['2026-07-28'], requested }`.
- **A legacy client.** An `initialize` request is answered, before the checks above, with `-32022` and `data` `{ supported: ['2026-07-28'], requested }`, where `requested` is the request's own `protocolVersion` when it holds a string and `""` otherwise, because the protocol requires the field, and with the message `Unsupported protocol version. This server speaks MCP 2026-07-28, which has no initialize request; use a client that supports protocol version 2026-07-28.` A client that speaks both eras probes with `server/discover` and never sends it.
- **Methods.** The package serves `server/discover`, `tools/list`, `tools/call`, and `subscriptions/listen`, answers every other method, `ping` included, with `-32601` before the per-request checks, so a `ping` without `_meta` answers `-32601`, and stamps `resultType: 'complete'` and the server's identity in `_meta` on every result. `subscriptions/listen` is acknowledged by `notifications/subscriptions/acknowledged`, its first message, with an empty `notifications` filter and `_meta['io.modelcontextprotocol/subscriptionId']` set to the request's id, and the server sends no other notification on it, because it offers no notification type. It stays open until the client cancels it or the server shuts down. A `tools/call` whose `params.name` is not a string is answered with `-32602`. A throw while the server handles a request is answered with `-32603`, and the server keeps serving.
- **Cancellation.** `notifications/cancelled` aborts the request it names and suppresses its response. A notification for an unknown or settled request is ignored. Every other notification is ignored.
- **Shutdown.** When stdin ends, the package stops reading, aborts every call in flight, waits for each to settle, sends `notifications/cancelled` naming each open subscription, answers it with its closing result, whose `_meta` carries `io.modelcontextprotocol/subscriptionId` beside the server's identity, and resolves, so the caller returns. A call shutdown aborts answers nothing, as a call the client cancels answers nothing, while a `server/discover` or `tools/list` still pending is answered. A write the client can no longer read, such as one after it closed its end of the pipe, is dropped, and the run still resolves.
- **The run's signal.** `run(input, output, { signal })` takes an optional `AbortSignal`, through which the caller ends the run early. When it aborts, before or after stdin ends, the package stops reading, aborts every call, answers nothing more, an open subscription's closing result included, and resolves once each call has settled. A signal already aborted when the run starts ends it before it reads anything.
- **Bundled into the pack.** `@loomcli/plugins` lists `@loom/mcp` as a development dependency alone. The pack keeps `tsc` for every subpath, and its build then bundles the `mcp` subpath's emitted entry with Rolldown, inlining `@loom/mcp` and leaving `@loomcli/core` and the pack's own modules external, so the packed tarball names no dependency on the private package.

#### MCP acceptance

The protocol package is proven when its own conformance tests, which import nothing of Loom, produce these results under Node and Bun:

- **The constant.** The package exports one revision, `2026-07-28`, and every version check and answer reads it.
- **Framing.** A message split across two reads parses once, two messages in one read parse in order, a blank line is ignored, a line that is not JSON answers `-32700`, a batch and a JSON value that is not a request answer `-32600`, and every line the server writes parses as one message and holds no raw line break.
- **Discovery and versions.** `server/discover` answers the fields above with `ttlMs` and `cacheScope`. A request without `_meta`, or missing either required key, answers `-32602`, a request for `2025-11-25` answers `-32022` naming `2026-07-28` and the requested version, `initialize` answers `-32022` with the message above, and `ping` and an unknown method answer `-32601`.
- **Tools.** `tools/list` answers with `resultType`, `ttlMs`, `cacheScope`, and no `nextCursor`, a cursor answers `-32602`, and `tools/call` reaches the handler it was given with the request's name and arguments.
- **Request ids.** A request reusing the id of a call or a subscription in flight answers `-32600` naming the id, the first call runs on untouched, and the id serves again once its request settles or is cancelled.
- **Cancellation.** A cancelled request's handler sees its signal abort and no response is written, and a cancellation for an unknown or settled id changes nothing.
- **Subscriptions and shutdown.** `subscriptions/listen` is acknowledged first by `notifications/subscriptions/acknowledged` with an empty filter and the subscription's id in `_meta`, a client's cancellation ends it with no response, and closing stdin aborts calls in flight, answers none of them, waits for each to settle, sends `notifications/cancelled` naming the subscription, ends it with its closing result carrying its id in `_meta`, and resolves. A client that stops reading before stdin ends leaves the run to resolve and the process to exit 0.
- **The run's signal.** A signal already aborted resolves the run with nothing read or written, and a signal that aborts while a call and a subscription are open aborts the call, writes nothing more, and resolves with stdin still open, as it does after stdin has ended.

The plugin is proven when jsonkit installs `mcp()` and opts in its root, `get`, `keys`, and `select`, each with `annotations: { openWorld: false, readOnly: true }`, and leaves `fetch`, `debug`, and `paths` out, and public APIs alone produce these results under Node and Bun:

- **A real session.** A process test launches the built `jsonkit mcp` under Node and under Bun and drives a session over stdio: `server/discover` names `jsonkit`, its version, and its description; `tools/list` lists `jsonkit`, `jsonkit_get`, `jsonkit_keys`, and `jsonkit_select` in that order with the schemas above, `file` and `verbose` among each tool's properties, and no `help`, `version`, `manifest`, `format`, or `explain` property; and a call of each tool against a document file answers as below. Closing stdin ends the process with exit 0.
- **Results.** `jsonkit_get` answers the value as text with no `structuredContent`; `jsonkit` answers the root's members as text and as `structuredContent`, the array its `json` view prints; `jsonkit_select` with an absent field answers the fields as text and the warning as a second text item; and a missing path answers `isError: true` with `Path not found: "missing". Run jsonkit keys to list the keys at the root.` and `structuredContent` `{ exitCode: 65, failure: { code: 'path-not-found', exitCode: 65, message: 'Path not found: "missing". Run jsonkit keys to list the keys at the root.', hints: [] } }`.
- **Errors.** An unknown tool and non-object arguments answer `-32602`. A key outside the schema answers the plugin's tool execution error. A value of the wrong shape and a missing required argument answer `isError: true` with the by-name sentence, no help hint, and a form whose code is `invalid-input`, and a malformed document answers 65 with the code `invalid-json`. A fixture tool whose action throws a `TypeError` answers the form `internal` with `Something went wrong.` from a bundle.
- **Cancellation and concurrency.** A fixture tool that waits on its signal is cancelled by `notifications/cancelled` and answers nothing while a second call answers. Two overlapping calls answer by their own ids. A run cancelled through a caller signal aborts both calls in flight.
- **Fixtures.** Fixture applications prove a hidden Command that opts in listed, a deprecated one listed with its message opening the description, an alias never listed, a description and a property description override, annotations projected and omitted, the three build faults with their diagnostics in both builds, a property derived for each kind of input with a `null` schema, an array property for a multiple option, a mapped `json` view under another key chosen for `structuredContent`, a view under `application/json` whose text does not parse answering text alone, and the install refused on a root that declares arguments.
- **Packed consumers.** `check:packed` installs the packed pack, imports `@loomcli/plugins/mcp` and `@loomcli/plugins/mcp/extension`, compiles against their declarations, finds no `@loom/mcp` among the tarball's dependencies, and serves an MCP session from a fixture application under Node and Bun.

### Suggestions

```ts
// @loomcli/plugins/suggestions
import type { Plugin } from '@loomcli/core';

export declare function suggestions(): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { suggestions } from '@loomcli/plugins/suggestions';

export const jsonkit = new Application('jsonkit', { plugins: [help(), suggestions()] });
```

```text
$ jsonkit gte name -f doc.json
jsonkit: Unknown command "gte". Did you mean "get"?
Run "jsonkit --help" to see the usage.
```

`suggestions()` is the suggestions plugin. Its identity is `@loomcli/plugins/suggestions`, and it declares no options, no middleware, no extension, and no Command. Its contribution is one `onFailure` hook and two view overrides, for `UnknownCommandError` and for `UnknownOptionError`, listed under its `views` and resolved as [Views from plugins](#views-from-plugins) resolves any override. A failure view's context carries no graph, under [ADR-0046](decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md), so the hook is where the plugin reads one: for either class it reads `graph` and `command` under [Failure hints](#failure-hints), computes the matches, records them for that failure instance in a module-private `WeakMap`, and returns `undefined`, so it adds no hint. Core hands the hook and the view one failure instance and runs the hook first, so the view reads the matches the hook recorded, and finds none for a failure no hook ran for. A suggestion is the near match the plugin's view offers as the failure's fix. Core's own sentence never guesses, under rule 3 of [Failure messages](failure-messages.md#3-leave-plugin-pointers-to-hint-lines): it lists the declared children and says what to do instead. A wrong guess is the plugin's risk, taken by the application that installs it. The matcher is a private module of the plugin, and the pack exports no matching function.

- **The sentence.** With at least one match, the view writes the prefix core's default text writes for a usage error, then the sentence's first clause with the token or spelling escaped through [`escapeControlCharacters`](#strings-and-composition) and then `style.escape`, under rule 5 of [Failure messages](failure-messages.md#5-escape-everything-repeated), `Unknown command "gte". ` or `Unknown option "--fields". `, then the fix: `Did you mean "get"?` for one match, and `Did you mean one of these: get, keys?` for several, in rank order, separated by a comma and a space. A name prints as declared: a child's canonical name, or an option's long or negative spelling with its dashes. Neither the `Use one of` clause nor the `prefix a hyphenated path with "./"` clause prints, because the suggestion is the fix. The line ends with one newline, and then each hint under [Failure hints](#failure-hints) follows on its own line, exactly as core's default text prints hints. Nothing in the line is styled.
- **No match.** With no candidate inside the budget, the view writes core's default text for the failure, hints included, byte for byte, so installing the plugin changes nothing for a token that resembles nothing. The view composes both shapes from the context's `application` and `style.escape(failure.message)`, the sentence without its prefix escaped as core's default text escapes its whole line, so it calls nothing of core's and matches core's text by construction, a token holding a control or bidirectional character included.
- **Candidates.** For an unknown Command, the canonical names of `command.children`, where `command` is the last Command the partial path reached, so `store cache lst`, on an application with a `cache` group, matches against the children of `cache`. For an unknown option, the long spelling and, for a Boolean, the negative spelling of each option in `graph.globals` and then `command.options`, so a counted option offers its long spelling alone, the routed Command's own, so a plugin's option is a candidate and `--hlep` suggests `--help`. A hidden member, a deprecated member, and every alias are left out, by the node facts, the rule [completion](#completion) follows under [ADR-0043](decisions/0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md): a typo of a deprecated Command suggests nothing unless a visible sibling is near, and an alias is never matched, so a typo of `ls` does not reach `keys` through it, and a typo of an option's alias does not reach that option through it. A short spelling is never a candidate, because one letter sits below any useful distance, so an unknown short spelling gets core's text. An option's long and negative spellings are both compared, and the option offers only the nearer of the two, or both in graph order when the typed spelling is as near to each, so `--no-colr` and `--nocolor` suggest `--no-color` and never `--color`, and `--noclor`, two edits from each, suggests both.
- **The matcher.** The typed token and each candidate are normalized to NFC and lowercased with the locale-independent default conversion before the comparison, so `GET` matches `get` at distance 0 and `Bild` reaches a `Build` Command, and a match prints as declared. Lengths and distances count code points, after folding. For an option, the leading hyphens of the typed spelling and of each candidate are left out of the comparison and of the length, so `--fields` is six code points against `field`. A token shorter than two code points after that matches nothing. The distance is the restricted Damerau-Levenshtein distance, also called optimal string alignment: an insertion, a deletion, a substitution, and a transposition of two adjacent code points each cost 1, so `gte` is one edit from `get`. The budget depends on the typed token's length: a token of up to 4 code points allows a distance of 1, up to 8 allows 2, and a longer token allows 3. A spelling inside the budget is a match, and an option offers only its nearer spelling, as the candidates rule above states. Matches rank by ascending distance, and ties keep graph order: the authoring order of `command.children` for a Command, and `graph.globals` then `command.options` for an option, with one option's long spelling ahead of its negative spelling. At most three names print. Every constant is the plugin's own, so a change to one is a text change under [Change fragments](../.changes/README.md), not a breaking one.
- **Precedence.** The application's overrides resolve first, then each plugin's in installation order, so an application that overrides `UnknownCommandError`, `UnknownOptionError`, or a class above them such as `UsageError` owns that sentence and prints no suggestion, and an earlier-installed plugin's override of either class or of a class above them wins over this plugin's. The plugin has no middleware, so its position in `plugins` changes no takeover and no chain order; the contract places no rule on where it is installed.
- **By name.** In an [invocation by name](#invocation-by-name), whose hook context reads `invokedBy: 'name'`, an unknown option is a key the caller wrote, so the candidates are the declared names of the visible options in the same order, compared and printed as names, `Did you mean "file"?`, and never a spelling. An unknown path element matches canonical Command names as it does under argv.
- **Not offered.** A value the validator rejected gets no suggestion from its accepted values; a group with no subcommand names no wrong token, so `NonCallableCommandError` keeps core's text; a misplaced option's sentence already names the Command that declares it, so `MisplacedOptionError` keeps core's text too; and the plugin never prompts or runs the suggested command.

#### Help's failure hint

`help()` also declares an `onFailure` hook under [Failure hints](#failure-hints). For every `UsageError`, it returns one hint, `Run "<command line> --help" to see the usage.`, where the command line is `application` then `path`, joined by single spaces: `Run "jsonkit --help" to see the usage.` at the root or before an unknown Command, `Run "store cache --help" to see the usage.` for a subcommand missing under a `cache` group, and `Run "jsonkit get --help" to see the usage.` for a fault on `get`, a rejected value included, because the page shows the accepted values. It names the extended page, which answers every case. For any other class the hook returns `undefined`, so a fatal error and a defect gain no line, and it returns `undefined` for an [invocation by name](#invocation-by-name), whose context reads `invokedBy: 'name'`, because no command line exists to rerun with `--help`. The hint quotes the application name and canonical names alone, so it repeats nothing the operator typed.

#### Suggestions acceptance

Both example applications install `suggestions()`. jsonkit drops its `unknownCommand` and `inputProblems` overrides, because core's default text now names the application under the audit row of [Failure messages](failure-messages.md#9-audit), so the one override it keeps is the literal `FatalError` view, and its [example coverage](#example-coverage) changes to the rows below. Every usage diagnostic both examples pin gains help's hint line, and the tests that pin them move with the change; a change to diagnostic text is not breaking. Where help's hint and the explain hint both apply, help's prints first, because `help()` is installed first.

| Invocation                              | stderr                                                                                              | Code |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | ---- |
| `jsonkit gte name -f doc.json`          | `jsonkit: Unknown command "gte". Did you mean "get"?` then `Run "jsonkit --help" to see the usage.` | 2    |
| `jsonkit Get name -f doc.json`          | `jsonkit: Unknown command "Get". Did you mean "get"?` then the help hint                            | 2    |
| `jsonkit typo -f doc.json`              | `jsonkit: Unknown command "typo". Use one of: doctor, completion, get, keys, select.` then the help hint | 2 |
| `jsonkit lss -f doc.json`               | Core's text, because `ls` is an alias and `keys` is too far                                         | 2    |
| `jsonkit fetc -f doc.json`              | Core's text, because `fetch` is deprecated                                                          | 2    |
| `jsonkit select --fields name -f doc.json` | `jsonkit: Unknown option "--fields". Did you mean "--field"?` then the help hint, then `Run "jsonkit select --explain" to explain this command.` | 2 |
| `jsonkit select --fiel name -f doc.json` | `jsonkit: Unknown option "--fiel". Did you mean one of these: --file, --field?`, both at distance 1 in graph order, the global first, then the help hint and the explain hint | 2 |
| `jsonkit get --hlep name -f doc.json`   | `jsonkit: Unknown option "--hlep". Did you mean "--help"?` then the help hint and the explain hint  | 2    |
| `jsonkit get -f doc.json`               | `jsonkit: Argument "path" requires a value. Supply a value for "path".` then `Run "jsonkit get --help" to see the usage.` | 2 |
| `textstat --totl one.txt`               | `textstat: Unknown option "--totl". Did you mean "--total"?` then `Run "textstat --help" to see the usage.` and the explain hint | 2 |
| `textstat --minimun 5 one.txt`          | Core's text, because `--minimum` is an alias and `--min-bytes` is too far                            | 2    |
| `textstat --timin one.txt`              | Core's text, because `--timing` is hidden                                                           | 2    |

The acceptance tests cover, through public APIs with fixture applications and fixture plugins: the distance of each edit kind, an insertion, a deletion, a substitution, and an adjacent transposition, and that a non-adjacent transposition costs 2; the budget at 4, 5, 8, and 9 code points, with a token one edit past its budget matching nothing; a token of one code point after the hyphens are removed matching nothing; NFC normalization and lowercasing, with a token that differs only in case matching at distance 0; code points counted rather than code units, with a candidate that holds no astral character beside a token that does; leading hyphens left out for an option, with `---format` treated as `format`; ranking by distance then graph order, with two candidates at one distance printed in authoring order; the cap of three with four matches; a negative spelling suggested for its own typo and never for the positive spelling's, a positive spelling never suggested for the negative spelling's, and both suggested for a typo as near to each; a plugin's option suggested; a hidden child, a deprecated child, a hidden option, a deprecated option, and an alias never suggested, each with the typo one edit from the excluded name; the plugin's hook adding no hint line, so a second plugin's hint is the only line under the plugin's sentence; the view's bytes equal to core's default text, hints included, when nothing matches; the escaped token in the sentence for a token that holds a control character or a bidirectional control; hints printed under the plugin's sentence in installation order; an application override of `UnknownCommandError` winning over the plugin's, and an earlier-installed plugin's override winning too; a later-installed plugin's override losing; the plugin installed before `help()` changing neither the help takeover nor the hint order of the other plugins; help's hint on each `UsageError` class, an `InputError` an action throws included, with the command line of the root, of a group, and of a nested Command; help's hint absent on a `FatalError`, an `InternalError`, and a `DeclarationError` a run reports; and the example rows above. Each case runs under Node and Bun. A consumer installs the packed pack, imports `@loomcli/plugins/suggestions`, compiles against its declaration, and prints a suggestion.

### Example coverage

The [help restyle acceptance](#help-and-version-restyle-acceptance) pins these byte comparisons with color and modifiers disabled. Separate expectations cover themed output.

The first-party increment is proven when both example applications install `help()` and `version()` from `@loomcli/plugins` through `plugins`, ahead of the example plugin so that help and version win a tie, and public APIs alone produce the pages above. The examples move the prose the pages print onto help's own descriptors: jsonkit's root and `get`, and textstat's root, carry `helpCommand` values with the `details` and `examples` the pages show, where each `command` omits the application name, and jsonkit's `--file` carries `helpInput({ placeholder: 'path' })`; the example plugin keeps its own descriptor and values, because the two are separate facts. The acceptance tests compare bytes: `jsonkit --help`, `jsonkit select --help`, and `textstat --help` print the three pages, `jsonkit get --help` prints the `get` page with its `details` and example while `path` is missing, `jsonkit select --bogus --help` prints the `select` page, `jsonkit fetch --help` prints the deprecated page and `jsonkit debug --help` the hidden one, and `jsonkit cache --help` on a nested fixture prints a group page with the children form alone and a `cache <command>` row on its parent's page. `jsonkit --version` and `jsonkit get --version` print `jsonkit v0.0.0` while the example manifests hold `0.0.0`, and an Application that omits `version` prints the same line. `jsonkit --help --version` prints help and never imports the version middleware module. Each case runs under Node and Bun, the pattern the seam's coverage set.

## Styles and rendering policy

Core exports the style helpers, rendering context, and rendering policy described below. [ADR-0027](decisions/0027-core-resolves-marked-output-and-one-theme-contribution.md) governs this seam. The named [Loom theme](#loom-theme) and [explicit color fallbacks](#explicit-color-fallbacks) are implemented under ADR-0022 and ADR-0029.

### Strings and composition

Core exports `style`, `glyph`, `pad`, and `escapeControlCharacters`. Style calls accept one string and return an ordinary string containing internal markup. Interpolation, concatenation, arrays, and `join()` work without a wrapper type or a conversion step.

```ts
import { glyph, pad, style } from '@loomcli/core';

const first = style.yellow.bold('Ready');
const second = style.bold(style.yellow('Ready'));
const status = `${style.green(glyph.success)} ${first}`;
const cell = pad(status, 24);
```

Both chaining and nesting are first-class. Chains apply from left to right. A later foreground or background replaces only that attribute; unrelated modifiers accumulate. An inner span overrides the attributes it supplies and restores its enclosing style afterward. The chain never mutates its receiver.

For a `warning` token mapped to yellow and bold, `style.warning.red(text)` is red and bold. `style.red.warning(text)` is yellow and bold. A token without a mapping leaves the surrounding style unchanged.

`style.escape(text)` returns a string that displays Loom's internal delimiters literally. Normal style calls preserve markup rather than escaping it. `String(value)` performs coercion and does not escape markup. The escape helper does not remove ANSI sequences; rendering policy governs them.

`escapeControlCharacters(text)` returns the text with every control character and line separator, U+0000 through U+001F, U+007F through U+009F, U+2028, and U+2029, and every bidirectional control and mark, U+202A through U+202E, U+2066 through U+2069, U+200E, U+200F, and U+061C, replaced by its four-digit lowercase `\uXXXX` escape, so raw text stays on one line, writes no control character, and cannot reorder the rest of the line. Other format characters, such as a zero-width joiner or a soft hyphen, pass through. Results output never passes through it, under rule 5 of [Failure messages](failure-messages.md#5-escape-everything-repeated). It escapes no markup, so text a view styles passes through `style.escape` as well. Core writes the reason of a broken failure view or `onFailure` hook through it, and every token, option spelling, short group, and issue path its failure sentences quote, while the failure's public fields keep the raw values. The [configuration plugin](#configuration) writes a file path through it.

First-party views escape raw data they interpolate, such as a filename taken from a data object. A string supplied to an `out.*` message method is already authored text and can contain deliberate styles. Lane views preserve that text, including its markup. Escaping a complete message would break ordinary composition.

The [wire contract](style-wire.md) fixes the delimiters, framing, literal-data rules, and malformed-input behavior. The wire form is internal and is not a persistent interchange format.

### Default styles and custom colors

The foreground catalog has all sixteen terminal colors:

| Base | Bright |
| --- | --- |
| `black` | `brightBlack` |
| `red` | `brightRed` |
| `green` | `brightGreen` |
| `yellow` | `brightYellow` |
| `blue` | `brightBlue` |
| `magenta` | `brightMagenta` |
| `cyan` | `brightCyan` |
| `white` | `brightWhite` |

Every foreground has a background counterpart: `bgBlack` through `bgWhite`, and `bgBrightBlack` through `bgBrightWhite`. Terminal palette settings determine the actual appearance of these named colors. Loom's own views do not paint backgrounds; SDK authors can use them.

The modifier catalog is `bold`, `faint`, `italic`, `underline`, `inverse`, `hidden`, `strikethrough`, and `overline`. There is no blink helper. `faint` is a terminal modifier; `dim` is a semantic theme token.

Custom colors return the same callable chain:

```ts
style.hex('#C97B36').bold('Ready');
style.rgb(201, 123, 54)('Ready');
style.ansi256(172)('Ready');
style.bgHex('#123').white('Ready');
style.bgRgb(17, 34, 51)('Ready');
style.bgAnsi256(17)('Ready');
```

Hex strings use `#RGB` or `#RRGGBB`, case-insensitively. RGB channels and ANSI palette indices are integers from 0 through 255. Alpha channels, clamping, and rounding are not supported. Invalid arguments throw when the helper is called, before a marked string is produced. Helpers do not coerce non-string text or invalid numeric input.

Three scoped resets are chainable:

| Helper | Effect inside its span |
| --- | --- |
| `reset` | Clear foreground, background, and modifiers |
| `resetForeground` | Use the terminal's foreground default; retain other attributes |
| `resetBackground` | Use the terminal's background default; retain other attributes |

`style.reset.red(text)` clears inherited styling and then applies red. Closing the span restores the enclosing style. A token mapped to `style.reset` explicitly clears inherited styling. An omitted mapping does not clear anything.

### Explicit color fallbacks

```ts
import type { Style } from '@loomcli/core';

export type ColorName =
	| 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
	| 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow'
	| 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite';

export interface ColorFallbacks {
	readonly ansi256?: number | undefined;
	readonly ansi16?: ColorName | undefined;
}

export type Ansi256Fallbacks = Pick<ColorFallbacks, 'ansi16'>;

// These members extend the existing Style type.
interface ColorHelpers<Names extends string, Semantic extends boolean> {
	hex(color: string, fallbacks?: ColorFallbacks): Style<Names, Semantic>;
	rgb(red: number, green: number, blue: number, fallbacks?: ColorFallbacks): Style<Names, Semantic>;
	ansi256(index: number, fallbacks?: Ansi256Fallbacks): Style<Names, Semantic>;
	bgHex(color: string, fallbacks?: ColorFallbacks): Style<Names, Semantic>;
	bgRgb(red: number, green: number, blue: number, fallbacks?: ColorFallbacks): Style<Names, Semantic>;
	bgAnsi256(index: number, fallbacks?: Ansi256Fallbacks): Style<Names, Semantic>;
}
```

```ts
const sage = style.hex('#7A8F7B', { ansi256: 108, ansi16: 'green' });
const rgbSage = style.rgb(122, 143, 123, { ansi256: 108, ansi16: 'green' });
const indexedSage = style.ansi256(108, { ansi16: 'green' });
sage.bold('Ready');
```

- **Status.** These helper extensions and the three types exported by core are implemented under [ADR-0029](decisions/0029-explicit-color-fallbacks-preserve-theme-hues.md).
- **Selection.** RGB and hex retain their original RGB value at truecolor depth. At 256 or 16 colors, the matching explicit fallback wins. An omitted or `undefined` fallback uses the existing approximation of the original color for that depth. A 256-color fallback never changes the 16-color result. `ansi256` retains its original index at truecolor and 256-color depth, and uses `ansi16` when supplied at 16-color depth.
- **Values.** `ansi256` is an integer from 0 through 255. `ansi16` is one of the sixteen foreground color names, including for background helpers. Both options are optional. `undefined` options and an empty object behave as omission. The `ansi256` and `bgAnsi256` helpers accept only `ansi16`.
- **Validation.** Helpers validate options when called and copy the accepted values into the chain. Later object mutation cannot change that chain. A non-plain options object, unknown option, or invalid color name throws `TypeError`. An invalid palette index throws `RangeError`. Existing hex and RGB validation remains unchanged. No value is coerced, rounded, or clamped.
- **Composition.** Fallbacks belong to one color operation. A later foreground replaces the original foreground and all its fallbacks, so `sage.blue` uses named blue at every depth. A background operation leaves the foreground choice intact. Nesting and embedded ANSI resets restore enclosing colors with their fallbacks. All helpers retain the receiver's token names and semantic-chain restriction.
- **Callbacks.** Helpers accept only their documented arguments. A callback such as `values.map(style.hex)` passes the array index as the options argument and now fails validation. Use `values.map((value) => style.hex(value))` so the helper receives only the color.
- **Policy.** Fallbacks do not change capability detection or force color. Color suppression removes them like other colors. Direct styles and theme mappings use the same rules. Calls that omit the options argument preserve their current behavior. Named terminal colors and raw ANSI colors gain no inferred fallback mapping.

#### Fallback acceptance

The implementation verifies exact bytes for explicit and omitted fallbacks at all three depths, including `ansi256` source colors and background helpers. It verifies that an index passed by a direct array callback is rejected and an explicit one-argument wrapper succeeds. It covers partial and `undefined` options, invalid options at helper-call time, copied option values, whole-color replacement, nested restoration, embedded resets, and color suppression. Type checks reject invalid fields and names while preserving chain typing. The wire checks validate the new color forms and retain the existing forms, as specified in the [wire contract](style-wire.md#explicit-color-fallbacks). Node and Bun process fixtures plus packed consumers prove the public API.

### Theme plugins and typed names

The core semantic names are `dim`, `primary`, `highlight`, `success`, `warning`, `error`, and `info`. These are names, not built-in appearances.

The plugin pack exports the bare `theme(mapping)` factory from `@loomcli/plugins/theme`:

```ts
import { Application, style } from '@loomcli/core';
import { theme } from '@loomcli/plugins/theme';

const app = new Application('example', {
	plugins: [
		theme({
			highlight: style.yellow.bold,
			identifier: style.cyan,
		}),
	],
});
```

`theme(mapping)` supplies exactly the mappings provided. Its plugin identity is `@loomcli/plugins/theme`. Importing it installs nothing.

The [`loomTheme(overrides?)`](#loom-theme) factory adds the named palette and accepts replacements and custom keys.

#### `PluginDefinition.theme` field

A [PluginDefinition](#plugins) can contribute this field:

| Field | Required | Value |
| --- | --- | --- |
| `theme` | No | A readonly mapping from semantic names to unapplied concrete style chains or `undefined`, retaining its literal keys through the returned plugin type. |

Supplying the field claims the theme slot, including an empty mapping. The pack factory uses this field; third-party themes use their own plugin identities:

```ts
import { plugin, style } from '@loomcli/core';

export const dusk = () => plugin('@example/dusk', {
	theme: {
		highlight: style.magenta.bold,
		identifier: style.cyan,
	},
});
```

The contribution retains its literal keys in the returned plugin type and through Application installation. A broad annotation must not erase the vocabulary along the framework's internal path. Theme declarations require no middleware and perform no output or capability detection during construction. They follow the same mapping validation and single-owner rule as the pack factories.

One Application installs at most one theme plugin. A second claim on the theme slot is a `DeclarationError` under `@loomcli/core/slot-taken` from the Application constructor that names both claimants and marks both entries of `plugins`. Zero themes is valid. Without a mapping, semantic tokens inherit their enclosing style; direct colors and modifiers still work under rendering policy.

In a bare theme, an omitted or undefined mapping contributes no style. An explicitly declared custom key with an undefined value still introduces that name.

Mapping values are unapplied concrete style chains: named terminal colors, modifiers, resets, custom colors, or their combinations. A mapping cannot reference any semantic token, including a core token. For example, `highlight: style.info.bold` fails the type contract. Shared concrete chain constants are valid. `plugin()` repeats these checks for JavaScript declarations: a `theme` that is not a mapping, `Plugin "@acme/theme" declares a theme that is not a mapping. Supply a mapping of names to concrete style chains.`, and a mapping value that is not an unapplied concrete chain, `Plugin "@acme/theme" theme mapping "highlight" is not an unapplied concrete style chain without semantic tokens. Map the name to a concrete chain such as style.cyan.bold, without calling it or naming a semantic style.`, report under `@loomcli/core/theme-mapping`, and a name a built-in style member holds, `Plugin "@acme/theme" theme name "bold" shadows a built-in style member. Rename the theme entry.`, under `@loomcli/core/theme-name-taken`.

The mapping's custom keys introduce one flat semantic vocabulary for the Application. The same key always names the same token within that Application. There are no public token descriptors, style groups, per-view namespaces, or group override methods. A custom key cannot shadow a built-in style member, including callable-function members. Core semantic keys are valid mapping keys because they configure those tokens.

The Application derives this vocabulary from its installed theme and publishes it through one Application-owned type registration. Independently authored Commands, extracted action handlers, and `View<Data>` values receive those names automatically. A misspelled name fails compilation. There is no per-Command theme argument, manual token generic, or Application-owned Command factory.

Custom names use automatic Application environment registration. It registers a shallow configuration type rather than a completed command tree, avoiding a circular dependency through handlers. One compilation context has one default registration; reusable libraries express their requirements without registering a consumer's Application. ADR-0026 supplies this registration API and its compatibility checks. Style derives custom names from the installed plugins in that environment, including when ordinary plugins accompany the theme.

Core supplies `style` on the action context and in the second view-function argument. The imported `style` supplies concrete styles and core semantic names; theme authoring needs no Application instance.

Actions use the supplied `style` to access the installed theme's custom names. Pass that style to helpers that compose action output.

```ts
import { Command } from '@loomcli/core';

export const show = new Command('show')
	.argument('name', { required: true })
	.action(({ args, out, style }) => out.print(style.identifier(style.escape(args.name))));
```

This action belongs to the Application compilation context that declares `identifier`, as does the view below.

```ts
import type { View } from '@loomcli/core';

interface Item {
	name: string;
}

export const item: View<Item> = {
	render: (data, { style, width }) => {
		const text = style.identifier(style.escape(data.name));
		return `${text} (${width(text)} columns)\n`;
	},
};
```

This example belongs to the Application compilation context that declares `identifier`. The view context is immutable and supplies `style` and destination-aware `width(text)`. Existing one-argument view functions can ignore it. A view remains pure and synchronous and receives no output handle. Under `out.render`, as here, it owns its trailing newline; a lane view returns none, as [Rendered output](#rendered-output) states per write site. Core resolves its returned markup and ANSI policy before writing, so returned strings no longer promise exact output bytes.

### Glyphs

`glyph` contains the complete [glyph catalog](glyphs.md), derived from a pinned Inquirer figures inventory. Each property is an unstyled marked string. `success` aliases `tick`, and `error` aliases `cross`; `info` and `warning` retain the upstream names. A glyph carries no theme token or automatic color.

```ts
style.success(glyph.success);
style.cyan(glyph.success);
glyph.success;
```

The first two expressions style the glyph explicitly; the last inherits its surroundings. The inventory preserves upstream compatibility forms, which can contain Unicode or multiple characters. There is no separate strict ASCII mode. For example, `tick` selects `✔` or `√`, `cross` selects `✘` or `×`, and `radioOn` selects `◉` or `(*)`.

Core applies the pinned Inquirer detection rule to captured facts on each run. A captured `host.platform` supplies the process platform string. On non-Windows platforms, main forms apply unless `TERM` is `linux`. On Windows, main forms apply if any of these conditions holds:

- `CI`, `WT_SESSION`, or `TERMINUS_SUBLIME` is nonempty.
- `ConEmuTask` is `{cmd::Cmder}`.
- `TERM_PROGRAM` is `Terminus-Sublime` or `vscode`.
- `TERM` is `xterm-256color` or `alacritty`.
- `TERMINAL_EMULATOR` is `JetBrains-JediTerm`.

Otherwise, core selects compatibility forms. It reads the captured environment case-sensitively. Piping, `NO_COLOR`, `FORCE_COLOR`, and theme installation do not select glyph forms. Only marked glyphs participate; core does not search and replace arbitrary Unicode characters in data.

### Rendering policies

Both Application options and `run()` options accept `rendering`:

```ts
const app = new Application('example', {
	rendering: {
		color: 'auto',
		modifiers: 'auto',
		hyperlinks: 'auto',
		terminalControls: 'strip',
	},
});

await app.run({ rendering: { color: 'never' } });
```

`color`, `modifiers`, and `hyperlinks` each accept `'auto'`, `'always'`, or `'never'`. Their default is `'auto'`. `terminalControls` accepts `'strip'` or `'preserve'`, defaulting to `'strip'`. Undefined fields act as omitted fields. Invalid values are declaration errors and name the field and accepted values.

There is one policy for both streams. No field accepts a stdout/stderr map. Core evaluates automatic capabilities separately for each destination. Redirecting stdout therefore does not turn off capable stderr output.

Invocation overrides replace only supplied rendering fields. Omitted fields retain the Application setting. Explicit `'auto'` restores automatic behavior for that field. This merge applies to rendering policy alone: `host` overrides still replace whole fields under [ADR-0009](decisions/0009-core-captures-the-host-and-resolves-an-exit-code.md).

Explicit `'always'` or `'never'` wins for its policy. With color set to `'auto'`, precedence is nonempty `FORCE_COLOR`, nonempty `NO_COLOR`, then terminal detection. Empty values make no override. The string `"0"` is nonempty and therefore active for either variable. A nonempty `FORCE_COLOR` wins when both variables are active. Numeric values do not select a color depth.

These rules follow [NO_COLOR](https://no-color.org/) and [FORCE_COLOR](https://force-color.org/), including user configuration precedence. They deliberately differ from Node's numeric `FORCE_COLOR` interpretation. Core owns the behavior under both Node and Bun.

| Automatic case | Colors | Modifiers | Hyperlinks |
| --- | --- | --- | --- |
| Capable TTY | On | On | Preserve |
| Capable TTY with `NO_COLOR` | Off | On | Preserve |
| Pipe or file | Off | Off | Strip, retaining visible text |
| Pipe or file with `FORCE_COLOR` | On | On | Strip, retaining visible text |

For ANSI color and modifier detection, a capable TTY has `isTTY: true` and `TERM` other than `dumb`. Automatic modifiers follow that detection or a nonempty `FORCE_COLOR`; `NO_COLOR` never disables them. Automatic hyperlinks require `isTTY: true`. Explicit policy values override each column independently. Setting color to `'always'` alone does not change the modifier or hyperlink policy.

When colors are enabled, core determines depth from captured hints in this order:

| Captured hint | Depth |
| --- | --- |
| `COLORTERM` is `truecolor` or `24bit` | Truecolor |
| `TERM` is `xterm-kitty`, `xterm-ghostty`, or `wezterm` | Truecolor |
| `TERM_PROGRAM` is `iTerm.app` and its version starts with a decimal major of at least 3 | Truecolor |
| `TERM_PROGRAM` is `iTerm.app` otherwise | 256 |
| `TERM_PROGRAM` is `Apple_Terminal` | 256 |
| `TERM` ends in `-256` or `-256color`, case-insensitively | 256 |
| No matching hint | 16 |

The iTerm version field is `TERM_PROGRAM_VERSION`. These are a portable subset of [supports-color's detection rules](https://github.com/chalk/supports-color/blob/e2a4cd3c44eb384b075161ef32859cd29ce1aa7f/index.js), with enablement handled separately. Core does not read CLI flags or live process globals during resolution, and does not reuse upstream numeric forcing semantics. Forced color without a depth hint uses sixteen colors. A future detector update needs equivalent Node and Bun evidence.

[Explicit fallbacks](#explicit-color-fallbacks) take precedence at their named depth. Without a matching fallback, the following approximation rule applies.

RGB colors remain RGB at truecolor depth. At lower depth, core chooses the closest available color by squared RGB distance, with the lower palette index breaking ties. The 256-color target is the conventional xterm palette. The sixteen-color target uses that palette's first sixteen entries. Named colors retain their terminal palette indices; they do not acquire hard-coded RGB values on a richer terminal. ANSI-256 colors retain their index at 256 or truecolor depth and approximate to sixteen colors at basic depth. A terminal can customize its palette, so approximation does not promise an exact visual match.

The same policies apply to ANSI styling already embedded in supplied strings. Color suppression removes foreground and background colors, not unrelated modifiers or text. An embedded reset restores the enclosing Loom style. Core closes remaining style and hyperlink state at the end of each rendered string.

General terminal controls include cursor movement, screen erasure, title changes, and the bell. The default removes those commands while retaining ordinary text, tabs, and line breaks. `'preserve'` permits them without bypassing color, modifier, or hyperlink policy. OSC 8 hyperlinks have their own policy even though their encoding uses terminal control sequences. Disabling hyperlinks preserves the label exactly and does not append the destination URL. No hyperlink authoring helper is added by this contract.

For filtered control strings such as OSC, core removes the complete sequence through its terminator, including its payload. An unterminated control string is removed through the end of the rendered string. When controls are preserved, complete unrecognized controls pass through; recognized styling and hyperlinks still obey their own policies. The resolver must not misclassify a control-string payload as ordinary text or as another output command.

Core discards an incomplete ANSI sequence at the end of each rendered string, including in preserve mode. Commands cannot span separate output calls. For example, separate view results containing `ESC[3` and `1mX` emit only the literal `1mX`, not a red-color command. Within one rendered string, ANSI recognition spans adjacent Loom frames, as the [wire contract](style-wire.md#parsing-order) specifies.

### Width, padding, and multiline lanes

The view context supplies `width(text): number`. It resolves glyph forms for that destination, ignores styling and hyperlink envelopes, and counts Unicode terminal columns. Combining marks add no column; wide characters occupy two. Emoji sequences follow the selected Unicode width implementation. Ambiguous-width characters count as one column. Measurement and padding use the grapheme width rules of `@rockorager/uucode` 2.2.1 with its Unicode 17 data. Core carries both itself, the tables as a JavaScript module, so it reads no file at run time. The tables stay under the Unicode License v3, which core's license field and its `NOTICE` state, and their license notices are legal comments that a bundler keeps in the bundle. It does not promise identical font rendering in every terminal.

`width()` returns the widest line's width. Tabs advance to the next multiple of eight columns, starting each input line at column zero. Thus `width('a\tb')` is 9. CRLF is one line break; LF is a line break. Preserved cursor operations do not turn width measurement into a terminal emulator.

Deep padding around unchanged content reuses measurement. Nested padding that changes the content at every level can still require quadratic Unicode measurement, such as appending one combining mark per level. This pathological optimization is deferred; the [wire contract](style-wire.md#resolution) includes a reproducible probe.

`pad(text, minimumWidth, options?)` returns a marked string. `options.align` is `'left'`, `'right'`, or `'center'`, defaulting to `'left'`. Padding uses spaces only. It supplies a minimum width, never truncates text, and puts an odd extra space on the right for center alignment. Width arguments are nonnegative safe integers.

```ts
pad('cat', 8);
pad('cat', 8, { align: 'right' });
pad('cat', 8, { align: 'center' });
```

These produce five spaces after `cat`, five spaces before it, or two before and three after it. Core defers actual padding until glyph selection, so a compatibility form such as `(*)` occupies its real width. Padding expands tabs within each input line before adding alignment spaces. Ordinary output outside padding preserves tabs.

Padding applies to each line independently and preserves line breaks. A trailing newline does not create a padded extra empty line. Interior blank lines are lines and receive the requested padding. For example, `pad('cat\ndog', 5)` resolves to `cat  \ndog  `, while `pad('cat\n', 5)` resolves to `cat  \n`. CRLF remains CRLF. The empty string has width zero; padding it produces the requested number of spaces.

Lane views receive the original message string, including line breaks and authored styles. Core does not split it into a new data structure or infer that later lines are details. A lane view owns its glyph gutter and continuation indentation. It measures the selected glyph form rather than assuming one column. The built-in `info`, `success`, `warn`, and `error` lanes prefix the first line with the matching glyph and one space. Continuation lines use spaces for that gutter without repeating the glyph. `print` remains prefix-free. The semantic methods retain their string-only call shape and newline contract. Each lane is a declared view core exports under `lanes`, and an application replaces its function through `views` as [Views](#views) describes; the newline the semantic method appends is outside the view and survives any override.

### Implementation acceptance

The style tests and packed consumers cover these obligations:

- Chaining, nesting, each reset, no-theme inheritance, and rejection of token references in theme mappings.
- Every foreground, background, modifier, and custom-color helper, including invalid arguments and capability degradation.
- The complete pinned glyph catalog, semantic aliases, multi-character compatibility forms, and independence from themes and ANSI policy.
- Automatic custom-name inference in detached Commands and views after the registration prerequisite, with typo and reserved-name rejection.
- Every rendering-policy field, invocation override behavior, nonempty `"0"` environment values, conflicting variables, and independent destinations under one policy.
- Embedded ANSI colors and resets, separate hyperlink and terminal-control policies, and malformed control strings.
- Literal marker data, nested deferred padding, Unicode width, tabs, multiline strings, and the adversarial cases in the wire contract.
- Fresh host capture on repeated runs, no import-time capability capture, and equivalent output under Node and Bun.

Process fixtures run on Node and Bun. Captured Windows facts test glyph selection; these fixtures do not certify native Windows support. Named-theme whole-token replacement belongs to [Loom theme acceptance](#loom-theme-acceptance). Fallback-option coverage belongs to [Fallback acceptance](#fallback-acceptance).
