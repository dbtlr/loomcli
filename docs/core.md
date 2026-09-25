---
description: Public SDK, invocation phases, host capture, rendered and semantic output, the view registry, the failure classes and their views, and the plugin contract for named commands with global and local options, Standard Schema validation and the input schema fact, passthrough, middleware, extensions, and cancellation.
---

# Core reference

Core resolves marked strings under a destination-aware [rendering policy](#styles-and-rendering-policy). The [view registry](#views) is implemented under accepted ADR-0021: the package exports `view`, `override`, `lanes`, `View`, and `ViewContext`, and the retired `failures`, `renderFailure`, `FailureRenderer`, `Renderer`, and `RendererContext` are gone. The named [Loom theme](#loom-theme) and explicit color fallbacks are implemented under accepted ADR-0022 and ADR-0029. The results lane under [Results](#results) is implemented under accepted ADR-0023: `result()`, `rows()`, and `views()` are authoring calls, `out.results` is on every channel, and the package exports `RowView`, `DeclaredRowView`, `ResultError`, and `incompleteResult`. The [formatter](#formatter), the `onCommandAttach` [lifecycle hook](#lifecycle-hooks) with its exported `AttachedCommand`, `CommandAttachHook`, and `ResultView` types, and the [middleware](#middleware) context's `request`, typed by the exported `Request`, and `view` are implemented under accepted ADR-0028, and the invocation order in [Invocation](#invocation) describes the chain behind local parsing. The [table](#table) and [records](#records) pack views are implemented under the 2026-09-17 entries in ADR-0008 and ADR-0023. [Collecting extensions](#collecting-extensions), the `extensions` a [lifecycle hook](#lifecycle-hooks) reads, and [help's values in the manifest](#help-in-the-manifest) are implemented under accepted ADR-0031, and the [manifest](#manifest) plugin is implemented under its contract, installed by both example applications. [Accepted values](#accepted-values) on help rows, `accepts`, and `helpArgument` are implemented, and the formatter's description names only its default.

## Application declarations

`new Application(name)` creates an application with an unnamed root Command. The constructor takes no input type parameter. `new Application(name, options)` takes one options object. `plugins` installs the plugins described in [Plugins](#plugins) in composition order, and `views` holds the view overrides described in [Views](#views), which is where an application replaces the view function of a failure class, a lane, a help page, or any other declared view. `description` and `version` are core graph facts every projection reads, and `extensions` carries the root's [extension values](#extensions). An omitted `version` is `0.0.0`, which means unversioned, so the graph always carries one; the root cannot be hidden or deprecated, so the Application options carry neither fact.

```ts
interface ApplicationOptions<Plugins extends readonly Plugin[] = readonly Plugin[]> {
  plugins?: Plugins;
  rendering?: RenderingPolicy;
  views?: readonly ViewOverride[];
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

A declaration value publishes the authoring calls that are still valid for it. `Command` and `Application` always publish `extend()`, outside the authoring-state parameter. A fresh `Command` publishes `argument()`, `option()`, `alias()`, `result()`, `rows()`, `command()`, and `action()`; a fresh `Application` publishes `argument()`, `option()`, `result()`, `rows()`, `command()`, and `action()` for the unnamed root, which has no name to alias. An Application also publishes `globalOption()` until its first `command()` or `action()` call. A declaration that carries a result publishes `views()` in every state, as [Results](#results) describes. An `Application` keeps `inspect()`, `run()`, and its `name` in every state. The collected declarations stay private, so no consumer can read or replace them.

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

Arguments and children exclude each other at the second call, so `.argument('files', config).command(child)` does not compile. A declaration that registers no action stays open, so a group keeps `option()` and `command()` available. Only an `Application` publishes `inspect()`, `run()`, and `name`, in every state; a named `Command` publishes its authoring calls alone. The type states do not read what a group holds, so build rejects an option declared on a Command that registers no action: a local option never reaches a child's action. A Command with children and no action is a group, and routing sends its invocations on to one of its children. A Command with neither children nor an action is a build error. `command()` accepts a Command in any state, because a child's own `action()` is the call that finished it.

`Command` and `Application` take a fourth type parameter that lists the authoring calls a value still offers. It defaults to `never`, so `Command<Args, Options, Globals>` and `Application<Args, Options, Globals>` accept a declaration in any state, one that registered its action included. Write the parameter only to require a state. The fresh states are the exported `CommandMethod` and `ApplicationMethod` unions, which also let a consumer emit declarations for a value that has not registered its action. An explicit `any` in that position removes the lock, as `any` does anywhere else.

JavaScript authors reach the same rules at graph build, which reports a declaration made after the action, and arguments declared beside children. Both are listed in [Graph build errors](#graph-build-errors).

TypeScript requires one statically known name for each `argument()`, `option()`, and `globalOption()` declaration. Literal-typed constants such as `const name = 'metric'` are valid. Widened `string` types, unions such as `'left' | 'right'`, and open template types are rejected. One declaration creates one handler key, so its type cannot promise several possible keys at once. A rejected name reports the missing property `'Declaration names must be one literal string'`. JavaScript declarations still undergo graph validation during `run()`.

A Command accepts arguments in declaration order. A scalar argument, with optional `variadic: false`, binds one token and produces one `string`, or the schema output when validated. A variadic argument, `{ variadic: true }`, must be last and takes the remaining tokens.

A scalar argument is optional when it omits `required` or declares `required: false`. It then binds the next bare token when one exists, and its action value is `string | undefined`, or the schema output or `undefined`. The presence rules are the option rules: `required: true` excludes `default`, a declared default removes `undefined` from the action value, and omission with no default is `undefined` with no call to the schema. A validated optional argument can declare `validateOmitted: true` to send its omission to its own schema, as [Absence and defaults](#absence-and-defaults) describes. An optional argument declares after every required one, and no argument declares after it, so `app keys` and `app keys a.b` both bind.

A variadic argument follows the presence rules of a [multiple option](#repeated-string-values). `required: true` means at least one token and excludes `default`; without it the argument is optional and can declare a default. Its action value is `string[]`, or the schema output, and never `undefined`: an empty tail is an accurate empty collection, so it enters the schema like a supplied one. A default is a `string[]`, or the schema's input type when the declaration validates, and it reaches each invocation as its own copy.

```ts
const keys = new Command('keys').argument('path', {}).action(({ args, out }) => {
  const path: string | undefined = args.path;
  return out.print(path ?? 'the root');
});
```

Bare tokens before `--` retain their order as positional inputs. Local options can appear before, between, or after these inputs. A hyphenated file path uses an explicit relative path such as `./-notes.txt`.

Application methods apply the same declaration transitions as a Command to the unnamed root's state. Build produces a graph with that root, and routing selects the Command for normal validation and dispatch. There is no separate root action runner.

Graph build rejects invalid and duplicate argument names, a variadic argument that is not last, an argument that follows an optional one, an optional argument that precedes a required one, multiple actions, a Command with neither children nor an action, a local option on a group, and a declaration made after the action. Authoring calls collect declarations before this validation. No action runs after a build or input failure.

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

`option(name, config)` declares a local option on the unnamed root Command. The declared name is the key in `options`. Short aliases and negative spellings do not add handler keys. Options and arguments have separate objects, so they can use the same key without collision.

Declarations infer types through fluent calls and `ActionHandler<typeof app>`. The constructor accepts no caller-supplied input types. `StringOption`, `BooleanOption`, and their union `OptionConfig` support extracted configuration with `satisfies`.

Every option and argument config object also accepts `description`, the one-line core fact every projection reads under the rule [Extensions](#extensions) states, and `extensions`, the list of [extension values](#extensions) plugins define for inputs: `ExtensionValue<'option'>` on `StringOption` and `BooleanOption`, and `ExtensionValue<'argument'>` on `ArgumentConfig`. Both keys are optional, both apply to global option declarations and plugin options alike, and neither changes parsing or validation. An option config object, and no argument config, also accepts the two core facts `hidden` and `deprecated` that [Hidden and deprecated members](#hidden-and-deprecated-members) describes.

The long spelling uses the exact declared name. `dryRun` produces `--dryRun`; `dry-run` produces `--dry-run`. Names are case-sensitive. They cannot be empty, start with a hyphen, or contain whitespace or `=`. A `short` alias is one ASCII letter and is case-sensitive. A hyphenated name is not a JavaScript identifier, so its action value reads with bracket access: `options['dry-run']`, the way textstat reads `options['min-bytes']`.

`shortOnly: true` requires `short` and suppresses every long spelling. For example, `.option('metric', { short: 'm', shortOnly: true, type: 'string' })` accepts `-m words` and rejects `--metric`.

### String values and token consumption

| Form                                               | Result                        |
| -------------------------------------------------- | ----------------------------- |
| `--metric words`, `--metric=words`, `-m words`     | `options.metric` is `"words"` |
| `--metric=`, `--metric ""`, `-m ""`                | An empty string               |
| No metric option                                   | `undefined`                   |
| `--metric=-value`                                  | The literal string `"-value"` |
| `--metric --total`, `-m --`, `--metric` at the end | Missing-value error           |
| `-mwords`, `-m=words`                              | Invalid attached short value  |

A separately consumed value cannot start with a hyphen. A long assignment can contain any string, including hyphens and additional `=` characters. Short-only string options cannot receive a hyphen-prefixed value in this increment.

The parser preserves empty values. After parsing, value inputs pass through their declared validation schemas. A declared default fills only an omitted optional value. A validated optional value can declare `validateOmitted: true` instead, which sends its omission to its schema, as [Absence and defaults](#absence-and-defaults) describes.

### Short groups

Boolean aliases can form a group. A string alias must be last and consumes the next token. `-tm words` sets `total` to `true` and `metric` to `"words"`. `-mt words` fails because `m` is not last. Attached short values are never inferred from the remainder of a group.

### Repeated string values

A string option declares `multiple: true` to collect every occurrence instead of rejecting the second one. Boolean options cannot declare `multiple`.

```ts
const app = new Application('select')
  .option('field', { multiple: true, short: 'F', type: 'string' })
  .action(({ options, out }) => {
    const fields: string[] = options.field;
    return out.print(fields.join('\n'));
  });
```

The collected value keeps supplied token order across every accepted spelling, so `--field a -F b --field=c` gives `['a', 'b', 'c']`. Each occurrence follows the ordinary value rules of its spelling. A multiple string alias is a string alias in a short group: it must be last and consumes the next token.

The raw value is the whole `string[]`, and the declared schema receives that array once. Per-item rules compose inside it, so `z.array(z.string().nonempty('Supply a field name.'))` rejects an empty item and reports its position, counted from 0: `--field a -F ''` fails with `Option "--field" at 1: Supply a field name.`. The action receives the schema output.

| Declaration and input               | Action value or failure              |
| ----------------------------------- | ------------------------------------ |
| Omitted, no declared default        | The validated output of `[]`         |
| Omitted, declared default           | The validated default output         |
| One or more occurrences             | The validated array, or input issues |
| `required: true` with no occurrence | Input error; no dispatch             |

`required: true` means at least one occurrence. A multiple option's action value is never `undefined`: no occurrence is an accurate empty collection. That empty collection enters the schema like a supplied one, so the action always receives the schema output, and `z.array(z.string()).transform(fields => fields.length)` gives `0` for an omitted option. A schema that rejects `[]`, such as `z.array(z.string()).min(1)`, reports its issue on omission with code 2. `required: true` is the structural at-least-one check, and it is read before validation, so a required option with no occurrence reports the required message instead. A default is a `string[]`, or the schema's input type when the declaration validates, and it passes through the schema like any other default.

Global options declare `multiple` under the same rules. The pre-scan consumes each occurrence at any placement before the passthrough delimiter, so a repeated global is collected rather than rejected.

| Rejected declaration or input                              | Diagnostic                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A required multiple option with no occurrence              | `Option "--field" is required. Supply at least one value.`                                                |
| `multiple` on a Boolean option                             | `Option "verbose" is a boolean option and declares multiple. Remove multiple or declare a string option.` |
| A `multiple` value that is not Boolean                     | `Option "field" multiple must be Boolean. Use true or false.`                                             |
| A multiple default that is not a string array, unvalidated | `Option "field" default must be an array of strings without a schema. Supply a string array default.`     |

The first diagnostic is a validation-phase issue with exit code 2 and ranks with the other required inputs. The rest are declaration errors with exit code 1. TypeScript rejects `multiple` on a Boolean option, a default of the wrong shape, and a schema whose input type does not accept `string[]`, at the `option()` call.

### Boolean polarity

Boolean options accept `polarity: 'positive' | 'both' | 'negative'`. The default polarity is `positive`.

| Polarity for `total`, with alias `t` | Long forms                                         | Short alias        | Absent value |
| ------------------------------------ | -------------------------------------------------- | ------------------ | ------------ |
| `positive`                           | `--total` gives `true`                             | `-t` gives `true`  | `false`      |
| `both`                               | `--total` gives `true`; `--no-total` gives `false` | `-t` gives `true`  | `false`      |
| `negative`                           | `--no-total` gives `false`                         | `-t` gives `false` | `true`       |

`shortOnly` removes long forms for positive or negative polarity. It cannot combine with `both`, because one alias cannot express both polarities. String options cannot declare polarity.

Boolean options consume no value token. Assignments such as `--total=false` and `-t=false` fail. A following bare `false` remains a positional input.

### Declaration and invocation errors

Graph construction rejects duplicate option keys and spelling collisions, including generated negative forms and short aliases. It also rejects invalid names, aliases, types, polarity, and short-only combinations. These errors occur during `run()`, before input parsing or dispatch. Authoring calls and both constructors capture configuration values, so later changes to the original configuration or options object do not change the declaration.

Each option without `multiple` can occur only once per invocation. Repetition fails across every accepted spelling, including `--metric words -m bytes`, `--total -t`, `-tt`, and `--total --no-total`. A `multiple` option collects its repetitions instead, as [Repeated string values](#repeated-string-values) describes. An unknown option, missing value, or invalid token form also prevents dispatch. Diagnostics identify the affected option and give a correction. Declaration errors return code 1; invocation errors return code 2. A declaration diagnostic names the declaration, as in `Option "field"`, because the author edits the declaration to fix it. An input diagnostic names the supplied spelling, as in `Option "--field"`, because the operator changes that token. An argument declares and reads under one name, so its diagnostics use it throughout. A broken validator is a fault in the declaration, so it names the declaration even when a supplied value reached it. Command names, child attachment, and collisions between a global and a local option have their own rules, described in [Commands and global options](#commands-and-global-options).

### Passthrough

The first bare `--` ends core parsing. Every following token reaches the action in `passthrough: string[]`, with order, values, and token boundaries intact. The delimiter is excluded. Later `--` tokens are ordinary passthrough values.

Passthrough is always available and is empty when no tail exists. It does not satisfy required positional arguments. Core does not parse it as options or arguments, validate it, or transform it. Parsing leaves `host.argv` intact.

## Commands and global options

`Application.globalOption(name, config)` declares an option shared by every action. It accepts the same config as `option()` and returns a new Application with the global output type added. Keep the returned value; the receiver is unchanged. Declare all globals before the first `command()` or `action()` call. An Application with no global declarations has no application-owned global options.

```ts
import { Application } from '@loomcli/core';

const configured = new Application('jsonkit')
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { type: 'boolean' });
```

Global names, aliases, polarity, defaults, and schemas follow the local-option rules above. A global value reaches every action, so `options.file` has one type in the root action and in each Command action.

`new Command(name, options?)` declares a named Command with `argument()`, `option()`, `alias()`, `command()`, `action()`, and `extend()`. A command name is a nonempty string without a leading hyphen, whitespace, or `=`. Names stay plain strings; no handler object is keyed by command name. `configured.command(child)` attaches one child to the root, and `command()` on a named Command attaches one child to it, so a graph nests to any depth. A Command takes one options object like the Application does: `description` is the one-line core fact every projection reads under the rule [Extensions](#extensions) states, `hidden` and `deprecated` are the two core facts [Hidden and deprecated members](#hidden-and-deprecated-members) describes, and `extensions` carries the [extension values](#extensions) plugins define. Build rejects globals passed to a named Command, through its constructor options. Declare globals on the Application and register its environment as shown below.

```ts
interface CommandOptions {
  description?: string;
  hidden?: boolean;
  deprecated?: string;
  extensions?: readonly ExtensionValue<'command'>[];
}
```

The action `options` object is the intersection of the global values and the selected Command's local values. A sibling Command's local options never appear in it. `.option()` rejects a name the globals already own. `.globalOption()` rejects a name already declared as a root-local option. Both checks apply at compile time and during graph build.

### Nested Commands and groups

`command()` belongs to a named Command and to the unnamed root alike, so children attach at any depth. The Application supplies its globals throughout the graph. Build walks the whole tree and checks each Command, the child names of each parent, and every per-Command rule at every level. A diagnostic that names a parent names the Command that holds the fault, so a nested parent reads as `Command "cache"`. The graph is a tree: one Command value attaches at one point in an Application's graph, and build rejects a value attached under two parents, so a Command that belongs in two places comes from a function that returns a fresh value for each placement. A separate Application may attach the same value, because each build claims its nodes anew.

A Command with children and no action is a group. The unnamed root may be a group too. A group holds children alone: a local option on it reaches no handler, because locals never inherit, so build rejects the declaration. A Command with children and an action keeps its options for that action and runs it when routing selects no child. A Command with neither children nor an action keeps the no-action build error.

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

Routing reads a nested graph the way it reads a flat one. Bare tokens descend from the root, and the first hyphen token commits to the Command they reach, so `store cache clear --force` dispatches `clear` with the global values and its own locals. An unknown child lists the children of the Command that holds it, at every depth.

An invocation that commits to a group fails before local parsing, with code 2. The diagnostic ranks with the routing errors, so `store cache --verbose` reports the missing subcommand rather than the unknown option.

### Aliases

`alias(...names)` on a named Command declares one or more aliases: other bare tokens that route to that Command. An alias changes routing alone. The routed path, every diagnostic, and the validation context report the canonical name, and the candidate list of an unknown-command or missing-subcommand error holds canonical names alone. An alias is an unadvertised synonym for a common mistype or inference, so `get` reaches a Command named `fetch` for an operator or an agent that guessed; it is never a second name the application advertises, and no projection lists it. It is not an option's short alias, which is a spelling of one option and appears in every projection, and it is not a [hidden Command](#hidden-and-deprecated-members), which is a full Command kept off every listing.

Aliases belong to the Command value, so a group carries them like any other named Command, and the unnamed root declares none. The call is variadic and repeatable: `.alias('ls', 'list')` and `.alias('ls').alias('list')` declare the same set, in that order. A call with no names does not compile. An alias follows the child name rule, and every canonical name and alias under one parent shares one namespace, so build rejects an alias that repeats a sibling's name, a sibling's alias, another alias of its own Command, or its own Command's canonical name. Like every other declaration call, `alias()` precedes `action()`.

```ts
const list = new Command('list').alias('ls').action(listCache);
const cache = new Command('cache').command(clear).command(list);
```

`store cache ls` and `store cache list` both dispatch `list`, and the validation context reports `['cache', 'list']` for either spelling. `store cache nope` still lists `clear, list`.

### Hidden and deprecated members

A named Command and an option carry two core facts beside `description`, declared on the Command's options object and on the option config. `hidden` is a Boolean, and an omitted `hidden` reads `false`. `hidden: true` keeps the member off every listing: a help page, a manifest, a completion script, and the candidate list of a routing error omit it, and the member otherwise behaves as any other. A hidden Command routes, runs, and has its own help page when it is routed to directly, and that page lists its own visible children like any other page; a listing that starts from a visible ancestor never reaches them. A hidden option parses and reaches what its declaration reaches, an action for an application option and its own plugin's middleware for a plugin option. When every child of a Command is hidden, a routing error at that Command offers no candidates, and its diagnostic ends after its first sentence, `Unknown command "nope".`, `Command "cache" requires a subcommand.`, or `The root Command requires a subcommand.`, with no `Use one of` clause.

`deprecated` marks a member the application still accepts but no longer advertises as the way to do its job, and its value is the migration message: one line that holds a character other than whitespace, under the rule a `description` follows, such as `'Use get instead.'`. Build rejects a bare `true`, because a deprecation with no migration path leaves an operator or an agent with nothing to do. A projection shows the message beside the member, so a reader learns what to use instead at the point where they choose. A member that is both hidden and deprecated is omitted, because hidden decides what a listing shows.

Both facts apply to a local option, to a global option declaration, and to a plugin option alike. Neither applies to an argument, because a positional cannot leave the grammar it sits in, and neither applies to the root, which is every page's entry point; build rejects either fact on an argument config or on the Application options, because an argument config is inferred from its value and the compiler checks it for no excess key. Routing selects and parsing binds without reading either fact. They are facts for the projections that read the graph, and `inspect()` reports both on every `CommandNode` and `OptionNode`.

```ts
const fetch = new Command('fetch', { deprecated: 'Use get instead.', description: 'Read one value at a path.' }).action(readValue);
const debug = new Command('debug', { description: 'Dump the parsed document.', hidden: true }).action(dump);
```

### Modular authoring

The Application declares globals once and registers its shallow environment in the same TypeScript project. Commands import neither the Application nor its globals. Registration supplies their global output types, including schema transformations.

```ts
// src/application.ts
import { Application } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { get } from './commands/get.js';

const configured = new Application('jsonkit')
  .globalOption('file', { required: true, type: 'string' });

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
  const file: string = options.file;
  return out.print(`${file}:${path}`);
};
```

`ActionHandler<typeof declaration>` works for a Command and for the root alike. `ActionArgs<typeof declaration>` and `ActionOptions<typeof declaration>` derive the same two objects for a handler that names its parameters separately, as `textstat` does. A handler written inline in `action()` needs no helper, because it infers its context from the declaration it receives.

### Global consumption and routing

Core reads invocation tokens in phases. The pre-scan walks the tokens up to the first bare `--`. A hyphen token whose spelling, the part before any `=`, is a global spelling is consumed with the ordinary value rules: a long spelling accepts its value inline after `=` or in the next token, and a short spelling accepts its value in the next token alone, because `-f=x` is an attached short value. A separately consumed value cannot start with a hyphen. Consumed tokens leave the router stream. A short group is all or nothing. A group of global letters is consumed, and a group with no global letters stays in the stream. A group that mixes a global letter with a letter the globals do not own is an input error: the pre-scan reads the globals alone, so it cannot tell a local option from an undeclared one, and its diagnostic classifies only the global letter. Tokens at and after `--` are never inspected, so a `--file` in the passthrough tail stays in the tail.

Routing then reads the remaining bare tokens from the root downward. A bare token that matches a child's name, or one of its [aliases](#aliases), descends into that child. A bare token that matches no child, while the current Command has children, is an unknown-command error that lists the children's canonical names. The first hyphen token commits to the current Command. Later bare tokens are positional inputs for that Command, so a root with children reports that it accepts no arguments. A commit to a group is an input error, because a group registers no action of its own. That error ranks with the routing errors above, before any local parsing, and it is held before the [middleware](#middleware) chain and raised at the dispatch boundary, so a plugin can take over a group invocation before the error is raised.

Values win over route names. In `jsonkit --file keys get name`, the value of `--file` is `keys`, and routing sees `get name`. A global supplied more than once fails as a repeated option at any placement.

The selected Command then parses the remaining tokens with its own spellings and the existing passthrough rule. One validation pass checks the globals in authoring order, then that Command's declarations in authoring order.

A missing required input is a validation-phase problem, so it loses to routing and to local structure errors: `jsonkit nope` reports the unknown command and validates nothing. Inside the phase, omissions aggregate in authoring order, the globals first, so an invocation that omits both a required `--file` global and a required `path` argument reports the `--file` line and then the `path` line in one failure.

| Invocation for a `get` and `keys` graph  | Diagnostic                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--file data.json nope`                  | `Unknown command "nope". Use one of: get, keys.`                                                                                                                                |
| `--file data.json get`                   | `Argument "path" requires a value. Supply a value for "path".`                                                                                                                  |
| `--file data.json keys extra`            | `Command "keys" accepts no arguments. Remove the supplied values.`                                                                                                              |
| `-r get a.b` with `-r` local to `get`    | `Unknown option "-r". Supply a declared option; prefix a hyphenated path with "./".`                                                                                            |
| `-p get a.b` with `-p` local to the root | `The root Command accepts no arguments. Remove the supplied values.`                                                                                                            |
| `-qp --file data.json get a.b`           | `Short group "-qp" mixes the global option "-q" with "-p", which is not a global option. Supply global options as separate tokens, and local options after their command name.` |
| `--file one.json get a.b -f two.json`    | `Option "-f" can be supplied only once. Remove the repeated option.`                                                                                                            |
| `get a.b` with a required `--file`       | `Option "--file" is required. Supply a value.`                                                                                                                                  |
| no tokens with an actionless root        | `The root Command requires a subcommand. Use one of: get, keys.`                                                                                                                |
| `cache --verbose` for a `cache` group    | `Command "cache" requires a subcommand. Use one of: clear, list.`                                                                                                               |

### Graph build errors

Authoring calls collect declarations; core validates them during `run()` and `inspect()`, before either one reads or dispatches any invocation token. This covers the globals table, every Command's spellings, every declared default, the view overrides, the options object's own shape, the order of the declaration calls, every result declaration, whose rules are listed under [Result build errors](#result-build-errors), and every installed plugin's declarations, whose rules are listed under [Plugin build errors](#plugin-build-errors). Each rule below returns code 1 and names both sides with a correction. Many reach JavaScript authors alone, because the types already reject the invalid declaration: arguments beside children in either declaration order, a local option that repeats a global option's key, a Command with several actions, an attached value that is not a Command, constructor options that contain a retired `globals` or `failures` property, a `views` entry that is not an `override` value, an argument, option, or alias declared after the action, a child attached after the action, an `alias()` call with no names, a global option declared after Command attachment or action registration, a version that is not a string, a description that is not a string, a `hidden` value that is not a Boolean, and a `deprecated` value that is not a string. The rest surface only at build time, for TypeScript and JavaScript authors alike: a description that is blank or holds a line terminator, a deprecated message that is blank or holds a line terminator, a version that is blank or holds a line terminator, a `hidden` or `deprecated` fact on the root or on an argument, two children with one name, a Command value attached under two parents, an invalid child name, an alias that repeats a name or alias under the same parent, an alias that repeats its own Command's name or another of its aliases, an invalid alias name, an invalid argument name, a global and a local option that share one spelling, a Command with neither children nor an action, a local option on a group, a variadic argument that is not last, two view overrides for one key inside one contributor, since the same key overridden across contributors resolves first-in-wins, an override key whose identity a distinct declared-view object already carries, an options slot on the Application or on a Command holding a value that is not a plain object even when it satisfies the options type structurally, and the two argument-order rules below. Build applies every rule at every depth, and a diagnostic names the Command that holds the fault. The four closures `action()` applies, to arguments, options, aliases, and children, are judged against the author's own calls; a call a plugin's [lifecycle hook](#lifecycle-hooks) issues is exempt from them and from nothing else. [`inspect()`](#graph-inspection) applies every one of these rules, and every rule a single declaration carries, so the only fault it leaves to `run()` is a declared default that its schema rejects. No rule runs the other way yet: a schema whose converter fails reads `null` under both, as [Input schema](#input-schema) states, while the diagnostic for it is decided.

| Rejected declaration                                    | Diagnostic                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Command that declares arguments and attaches children | `The root Command declares argument "files" and attaches child "get". Move the argument into a child Command or remove the children.`                                                                                                                                      |
| Two children with one name                              | `The root Command attaches two children named "get". Rename or remove one.`                                                                                                                                                                                                |
| A Command value attached under two parents              | `The root Command attaches child "clear", which Command "cache" also attaches. Attach a Command value at one point; create a new Command for each placement.`                                                                                                              |
| An invalid child name                                   | `The root Command attaches a child named "bad name". Use a nonempty name without a leading hyphen, whitespace, or "=".`                                                                                                                                                    |
| An alias that repeats a sibling's name                  | `The root Command attaches child "keys" with alias "get", which is also the name of child "get". Rename or remove one.`                                                                                                                                                    |
| An alias that repeats a sibling's alias                 | `The root Command attaches child "keys" with alias "ls", which is also an alias of child "select". Rename or remove one.`                                                                                                                                                  |
| An alias that repeats its own Command's name            | `Command "keys" declares alias "keys", which is its own name. Remove the alias.`                                                                                                                                                                                           |
| An alias declared twice on one Command                  | `Command "keys" declares alias "ls" twice. Remove the repeated alias.`                                                                                                                                                                                                     |
| An invalid alias name                                   | `Command "keys" declares an alias named "bad name". Use a nonempty name without a leading hyphen, whitespace, or "=".`                                                                                                                                                     |
| An invalid argument name                                | `The root Command declares an argument named "bad name". Use a nonempty name without a leading hyphen, whitespace, or "=".`                                                                                                                                                |
| Globals declared on a named Command                      | `Command "get" declares globals. Declare globals on the Application and register its environment.` Attachment separately rejects an unsatisfied global type requirement or a known global/local key collision.                                                              |
| A global and a local option with one key                | `Option "file" is declared as a global option and as a local option on Command "get". Rename the local option.` A local option a plugin's hook declared reports through the hook-collision row of [Plugin build errors](#plugin-build-errors) instead.                                                                                                                                                            |
| A global and a local option with one spelling           | `Option spelling "-f" is used by the global option "file" and the local option "force" on Command "get". Change one declaration.`                                                                                                                                          |
| A Command with neither children nor an action           | `Command "get" has no action. Register an action.`                                                                                                                                                                                                                         |
| A group that declares a local option                    | `Command "cache" declares option "verbose" but registers no action to receive it. Register an action or remove the option.` The root form reads `The root Command declares option "verbose" ...`.                                                                          |
| A Command with several actions                          | `Command "get" has multiple actions. Register one action.`                                                                                                                                                                                                                 |
| An attached value that is not a Command                 | `The root Command attaches a value that is not a Command. Attach the value returned by new Command(name).`                                                                                                                                                                 |
| Retired constructor globals configuration | `The Application options contain globals. Declare them with globalOption(name, config).` |
| Retired constructor failures configuration | `The Application options contain failures. Declare view overrides under views with override(key, view).` |
| An options slot that holds no options object | `The Application options must be an object. Supply an Application options object.` |
| A views entry that is not an override                   | `The Application holds a value that is not a view override. Supply the value returned by override(key, view).`                                                                                                                                                            |
| A Command options slot that holds no options object     | `Command "get" options must be an object. Supply a Command options object.` |
| A description that is blank or holds a line terminator  | `Command "get" description must hold a character other than whitespace and no line terminator. Supply a one-line summary.` The same sentence names the Application as `The Application`, a global option as `Global option "file"`, a local option as `Command "get" option "raw"`, a plugin option as `Plugin "@loomcli/log" option "level"`, and an argument as `The root Command argument "files"`. A description that is not a string reads the same sentence, and a JavaScript author alone can declare one. |
| A version that is not a string, or is blank or holds a line terminator | `The Application version must be a string that holds a character other than whitespace and no line terminator. Supply a string such as "1.2.0".` A JavaScript author alone can declare a version that is not a string. |
| A deprecated message that is blank or holds a line terminator | `Command "fetch" deprecated message must hold a character other than whitespace and no line terminator. Supply a one-line migration path, such as "Use get instead.".` The same sentence names a global option as `Global option "raw"`, a local option as `Command "get" option "raw"`, and a plugin option as `Plugin "@loomcli/log" option "level"`. A `deprecated` value that is not a string, `true` included, reads the same sentence, and a JavaScript author alone can declare one. |
| A hidden value that is not a Boolean                    | `Command "fetch" hidden must be a Boolean. Supply true or false, or omit it.` The same sentence names a global option as `Global option "raw"`, a local option as `Command "get" option "raw"`, and a plugin option as `Plugin "@loomcli/log" option "level"`. A JavaScript author alone can declare one. |
| A hidden or deprecated fact on the root or an argument  | `The Application declares hidden, which applies to named Commands and options alone. Remove it.` The same sentence names the fact declared, and an argument as `The root Command argument "files"` or `Command "get" argument "path"`. Neither the Application options type nor an argument config accepts either key, so a fresh object literal fails to compile; a TypeScript author reaches this rule through an options object or an argument config held in a variable, because excess-key checking applies to a fresh object literal alone. |
| Two view overrides for one key                          | `The Application overrides the view for "InputError" twice. Remove one override.` For a declared view the sentence reads `The Application overrides view "@loomcli/plugins/help/page" twice. Remove one override.`                                                                                       |
| An override key from a second copy of a package         | `View "@loomcli/plugins/help/page" is declared by two distinct objects. Install one copy of the package that declares it.` The same sentence reports every identity collision, whichever lists hold the two objects.                                                                                                  |
| A variadic argument that is not last                    | `Argument "paths" is variadic and precedes argument "path" on Command "get". Declare the variadic argument last.`                                                                                                                                                          |
| An optional argument before a required one              | `Argument "path" is optional and precedes required argument "name" on Command "keys". Declare optional arguments after required ones.`                                                                                                                                     |
| An argument after an optional one                       | `Argument "extra" follows optional argument "path" on the root Command. Declare an optional argument last.`                                                                                                                                                                |
| An argument or option declared after the action         | `Command "get" declares option "raw" after its action. Declare arguments and options before action().`                                                                                                                                                                     |
| An alias declared after the action                      | `Command "keys" declares alias "ls" after its action. Declare aliases before action().`                                                                                                                                                                                    |
| An `alias()` call with no names                         | `Command "keys" declares an alias with no names. Supply at least one name.`                                                                                                                                                                                                |
| A child attached after the action                       | `The root Command attaches child "get" after its action. Attach children before action().`                                                                                                                                                                                 |

Local options on separate Commands can reuse names and spellings, with a different value shape on each one, so `--field` and `-F` can collect strings on one Command, read as a Boolean with `--no-field` on a sibling, and carry a validated scalar on a nested leaf. Each action sees only its own Command's declarations. Core holds one globals table and never copies it into a Command.

### Example coverage

[jsonkit](../examples/jsonkit/src/application.ts) declares one optional global `--file`, a root summary action, a `get` Command with a required scalar `path`, a `keys` Command with an optional scalar `path` and the alias `ls`, a `select` Command, a `fetch` Command that is deprecated in favor of `get`, and a `debug` Command that is hidden. `jsonkit ls` lists keys exactly as `jsonkit keys` does, and `jsonkit typo` still offers `get, keys, select, fetch`, because a routing failure's candidate list omits the hidden `debug`. `select` declares `--field` as a required multiple option with the alias `-F` and the schema `z.array(z.string().nonempty('Supply a nonempty field name.'))`, so its action receives `string[]` and prints the requested top-level keys in supplied order. A field the document does not hold is skipped with a warning on stderr while the rest still print, which is the example use of a non-fatal `out` channel. An omitted `keys` path lists the root; a supplied one resolves with the syntax `get` uses, through the resolver both Commands share. Each action is a separate module typed with `ActionHandler`, and all five read their document through one shared reader. That reader selects the source: a supplied `--file` streams from disk, and without one the document streams from `host.stdin`. A read failure names the file or `stdin`, and a parse failure names the document the same way. The rule that one of the two sources must exist belongs to the `--file` declaration, not to the reader, and the [schema example coverage](#example-coverage-1) describes it.

## Standard Schema validation

Value options and arguments, scalar and variadic alike, accept a `validate` property containing a [Standard Schema v1](https://standardschema.dev/) object. Core calls the standard interface directly. A compatible library needs no adapter or plugin. Boolean options do not accept `validate`, `default`, `required`, or `validateOmitted`; their polarity controls their absent value.

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

`type: 'string'` controls token consumption. The schema receives the supplied string and determines the action's output type. Core awaits synchronous or asynchronous validation before dispatch. Without a schema, supplied values remain strings.

A scalar argument's schema receives its one token. A variadic argument's schema, and a multiple option's schema, receive the entire `string[]`. It can validate individual elements, enforce collection rules, or transform the collection into a different shape. For example, `z.array(z.string()).transform(files => files.length)` produces a numeric argument value. Passthrough never enters this pipeline.

`ActionHandler<typeof app>` retains these output types for extracted handlers. `ArgumentConfig`, `StringOption`, and `OptionConfig` support configuration declarations with `satisfies`. A broad type annotation can erase schema details; `satisfies` preserves inference.

### Validation context

Core calls every schema through the Standard Schema options argument, under the `libraryOptions` key `validationContextKey`. `validationContext(options)` reads that channel and returns the `ValidationContext` core attached, or `undefined` when another caller ran the same schema. A schema library that ignores the argument, such as Zod, is unaffected: the extra argument changes nothing for a schema that does not read it.

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

Core re-exports the `StandardSchemaV1` type, so a custom validator depends on `@loomcli/core` alone. The annotation is what fixes the schema's input and output types; an unannotated object literal widens `version: 1` to `number` and resolves the output to `unknown`. The accessor answers for the contexts core produced alone. A value core did not produce reads as `undefined`.

| Field         | `phase: 'default'`       | `phase: 'invocation'`                                      |
| ------------- | ------------------------ | ---------------------------------------------------------- |
| `host`        | The captured `Host`      | The captured `Host`, the object the action receives        |
| `input`       | `{ kind, name, global }` | The same identity for the declaration under validation     |
| `command`     | absent                   | The routed path of canonical names; `[]` for the root      |
| `passthrough` | absent                   | The tail after the first bare `--`                         |
| `supplied`    | absent                   | The raw tokens of every declared input, before any default |

A default validates before any token is parsed, so its phase reports the host and the declaration alone. Every schema call of one invocation, the globals and the routed Command's own declarations alike, reports the same route, passthrough, and supplied inputs. The route, the passthrough tail, and every collected value are copies made for each call, so a schema that writes to them changes nothing that a later schema or the action reads. `host` is the captured object itself, shared with the action, as the table states.

`supplied` holds the tokens as the parser read them, before any schema runs and before any default applies. Every declared name of the routed Command, and every global name, is a key.

| Declared input and invocation                  | `supplied` value               |
| ---------------------------------------------- | ------------------------------ |
| Scalar argument or single option, supplied     | The one string                 |
| Variadic argument or multiple option, supplied | Every token, in supplied order |
| Scalar argument or single option, omitted      | `undefined`                    |
| Variadic argument or multiple option, omitted  | `[]`                           |
| Boolean option, supplied                       | The value of its spelling      |
| Boolean option, omitted                        | `undefined`                    |

An omitted Boolean reads as `undefined` here, because the polarity value is the absent value, not a supplied token. Absence rules do not change: an omitted optional value with no default never reaches its schema, and no context is produced for it, unless its declaration asks for that call with `validateOmitted: true`.

### Absence and defaults

| Declaration and input                           | Action value or failure                           |
| ----------------------------------------------- | ------------------------------------------------- |
| Optional value or argument omitted, no default  | `undefined`; schema is not called                 |
| Optional value omitted, `validateOmitted: true` | The validated output of `undefined`               |
| Optional multiple option omitted, no default    | The validated output of `[]`                      |
| Optional variadic argument omitted, no default  | The validated output of `[]`                      |
| Optional value omitted, declared default        | The validated default output                      |
| Supplied value, including an empty string       | Its validated output or input issues              |
| `required: true` value option omitted           | Input error; no dispatch                          |
| Required input with a declared default          | Developer declaration error                       |
| Invalid declared default                        | Developer declaration error, even when overridden |

A scalar rule about omission, such as "a file or piped stdin", cannot live in a schema by itself, because an omitted optional value never reaches one. `validateOmitted: true` is how that rule reads omission: core calls the schema with `undefined` as the value, in the invocation phase, with the full [validation context](#validation-context). A returned issue is an input issue like any other and returns code 2. No token was supplied, so it names the declaration by the spelling an operator would type: an option under its long form, as in `Option "--file": Supply a file or pipe JSON to stdin.`, a `shortOnly` option under its short spelling, and an argument under its name. The action value is the schema output alone, because the schema always runs.

```ts
import { Application, validationContext } from '@loomcli/core';
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

const configured = new Application('jsonkit').globalOption('file', {
  short: 'f',
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
});
```

The flag belongs to an optional scalar string option or scalar argument that declares a schema and no default. Every other declaration already decides its own absence, so the flag beside `required: true`, beside a `default`, beside `multiple: true` or `variadic: true`, on a Boolean option, or without `validate` is a compile error at the declaration call and a declaration error at build. The schema's input type must accept `undefined`, the way a declared default must satisfy that same input type. The flag is Boolean, the way `required` and `variadic` are: any other declared value, an explicit `undefined` included, is the declaration error `Option "file" validateOmitted must be Boolean. Use true or false.`

Defaults use the schema's input type, not its output type. In the example, `default: '0'` is valid and `default: 0` is a type error. Without a schema, a value default must be a string.

Omission does not invoke schema-internal defaults. An explicitly declared `default: undefined` does enter the schema when its input type accepts `undefined`. Successful schema outputs retain their type, including `undefined`; core does not replace them or validate them a second time.

Every `run()` checks the complete declarations, then validates all declared defaults before parsing invocation tokens. It awaits asynchronous defaults and reuses their transformed outputs for that invocation. Invalid defaults report the affected declaration, the schema explanation, and a correction with exit code 1. Default results are not cached across invocations.

Authoring captures configuration properties. Replacing a property on the original configuration object does not alter the declaration. An array default is copied at authoring, and the copy, not the declared array, reaches each invocation, so a later change to the declared array, and an action that mutates the collection it receives, reach neither the declaration nor the next invocation. The copy is shallow: a value nested inside the array, an object or an array of its own, is the same reference the declaration holds, so an action that mutates a nested value corrupts the declaration. A schema replaces the default with the value it returns, and an array it returns is copied for that invocation the same way, with the same shallow limit. Schema objects and other default objects are retained by reference; core does not clone arbitrary library objects or enforce validator purity.

### Issues and validator failures

Returned schema issues prevent dispatch and produce exit code 2. Core collects them across supplied inputs in authoring order, preserving each schema's own issue order. Async completion timing does not change diagnostic order. Each message identifies the argument or option and includes the schema explanation and any issue path. An empty issues array still denotes failure.

CLI structure errors, such as unknown options or repeated single-value options, occur before schema validation. They retain their existing diagnostics.

A validator that throws, rejects its promise, or returns a malformed result produces a developer error with exit code 1. Its diagnostic identifies the affected input and asks the author to fix the validator. Validation stops immediately and the action does not run. This failure is distinct from returned operator-input issues. Like every fault validation produces, it is held under [Invocation](#invocation) and raised at the dispatch boundary, so an invocation a middleware takes over, `--help` included, reports neither the issues nor the developer error.

### Input schema

A validated input carries the JSON Schema its validator publishes as a core fact, `schema` on every `ArgumentNode` and `OptionNode` under [Graph inspection](#graph-inspection). Build derives it through the [Standard JSON Schema](https://standardschema.dev/json-schema) channel, the converter `@standard-schema/spec` defines beside `validate`, and stores the plain result. The fact reaches every projection with no plugin installed, and it changes nothing at run time: validation is unchanged, and no rule reads the stored schema.

```ts
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@loomcli/core';

interface ArgumentNode {
  // ...the fields under Graph inspection...
  readonly schema: Readonly<Record<string, unknown>> | null;
}
// The field is on both `OptionNode` variants, the Boolean one included.

// The converter core calls, as the standard declares it beside `validate`. A schema library
// implements it once; a hand-written schema implements it with this type or omits it.
type Converter = StandardJSONSchemaV1['~standard']['jsonSchema'];
// `validate` takes a Standard Schema; one that also implements the converter publishes a shape.
type Validator = StandardSchemaV1 | (StandardSchemaV1 & StandardJSONSchemaV1);
```

```ts
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

- Build asks every validated argument and option whose `validate` value implements `StandardJSONSchemaV1` for its input-side schema: one call of `'~standard'.jsonSchema.input({ target: 'draft-2020-12' })`, with no `libraryOptions`. Under this contract `@loomcli/core` re-exports the `StandardJSONSchemaV1` type beside `StandardSchemaV1`, so a hand-written schema can declare the converter with the standard's own type.
- The stored value is the converter's return value, snapshotted the way a declared default is: arrays and plain objects copied and frozen at every depth, any other value kept as it is, so a write through the graph fails and the library's own object is never frozen. Core reads nothing inside it and adds, removes, and renames nothing: the `$schema` key the library writes, a `description` or `default` the author set on the schema, and any vendor keyword are the library's words. A projection that wants another form makes it from the fact and never asks core for one.
- The input side alone. The output side describes the value the action receives after the schema's transforms, which is the action's business. So `z.string().regex(/^[0-9]+$/).transform(Number)` publishes `{ type: 'string', pattern: '^[0-9]+$' }` beside `$schema`, and a projection describes what a caller supplies. Every token is a string, and the schema is the value the token must satisfy: `z.coerce.number().int().min(1)` publishes `type: 'integer'` with its bounds. A projection states that rule once and never per input.
- A variadic argument's and a multiple option's schema receives the whole `string[]`, so its schema describes the array, `{ type: 'array', items: { type: 'string' } }` for `z.array(z.string())`.
- On `schema`, `null` has one reading: the graph holds no published shape. An input without `validate`, a Boolean option, a validator without `jsonSchema`, and a converter that fails all read `null`. It never means unconstrained. A projection that needs a shape where the fact is `null` derives it from the node: a Boolean option is exact, and a string option or an argument is open, one string, or the whole `string[]` under `multiple` or `variadic`. `validated` answers a different question and is unchanged, so `validated: true` beside `schema: null` is an ordinary state. The Boolean variant carries the field, always `null` under this contract, so the node shape and every projection built on it hold unchanged if a later contract lets a Boolean option validate.
- A converter fails when it throws or returns anything but a plain object. A failure reads `null` under `inspect()` and `run()` alike: the graph holds no published shape, validation is unchanged, and nothing else happens. The contract of 2026-09-19 made the failure a `DeclarationError` from `inspect()` alone, naming the input, the target, and the converter's message, because an operator cannot correct an author's schema and the diagnostic belongs to development. That diagnostic is held while the question of how a run tells a development application from a distributed one is decided, and it ships with the answer. zod 4.5.4's converter does not throw on a transform's input side, so no schema in the examples meets it.
- The fact is computed in the projection step: one converter call per validated input, on every `inspect()` call and on every run that has a middleware chain, since the graph a middleware reads is the one `inspect()` returns. Two inputs that share one schema object each get their own call and their own copy. A run with no middleware calls no converter. The converter is synchronous by the standard's contract, so `inspect()` stays synchronous, and the [validation context](#validation-context) is never passed to it.
- A [plugin option](#plugin-options) reads `schema: null` beside `validated: false`. An option a lifecycle hook declares is a local option and publishes what its validator publishes, and core never edits the fact, so an alias a validator accepts on its input side is published with the rest. The [formatter](#formatter)'s `--format` therefore carries the enum of the view names alone: its validator's declared shape is that enum, and the `ndjson` mapping is applied before it reaches the enum, so the alias stays out of the published fact, a change this contract requires of the formatter.

### Example coverage

[textstat](../examples/textstat/src/application.ts) declares `metric` with a Zod enum and the default `'bytes'`. Its `min-bytes` schema transforms decimal digits into a non-negative safe integer with default `'0'`. `--minimum` is the deprecated spelling of the same threshold: it shares `min-bytes`'s schema and carries no default of its own, and when both are supplied the larger of the two thresholds applies. `--timing` is a hidden Boolean; when set, the action writes one `elapsed: <n>ms` line to stderr after the rows. The action uses the inferred values directly. Under [Input schema](#input-schema), `inspect()` reports `metric` with `{ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string', enum: ['bytes', 'words', 'lines'] }` beside its default, `min-bytes` and `--minimum` with the pattern schema their transform sits behind, `--timing` with `null`, `files` with `null`, because its hand-written schema declares no converter, and the `--format` option the formatter's hook declares with `enum: ['table', 'json', 'jsonl']`. It keeps a row for each source at or above the byte threshold and totals only retained sources. A selection the threshold filters entirely still prints the header, and a `total` row of zero when the invocation asked for one.

`files` is an optional variadic argument with a custom Standard Schema. Its validator reads the validation context: a nonempty list passes, and an empty list passes only when the invocation phase reports that `host.terminal.stdin.isTTY` is false. Otherwise it returns the issue `Supply file arguments or pipe text to stdin.`, which core reports as an input error. The action never reads the terminal. It counts each supplied file, or `host.stdin` when no file is supplied, and prints the row name `stdin` for the piped text. Every source is counted incrementally over its chunks, so a word or a multibyte character that a chunk boundary splits is counted once.

[jsonkit](../examples/jsonkit/src/application.ts) declares the same rule for one scalar. Its global `--file` carries a hand-written schema and `validateOmitted: true`, so the rule reads omission too. A supplied path passes unchanged. Omission passes only when the invocation phase reports that `host.terminal.stdin.isTTY` is false; otherwise the schema returns the issue `Supply a file or pipe JSON to stdin.`, so a terminal invocation with no file fails with code 2 before any action runs. The application overrides the `InputError` view, so the operator reads `jsonkit: --file: Supply a file or pipe JSON to stdin.` where core's default text would read `Invalid input: Option "--file": Supply a file or pipe JSON to stdin.` The shared reader then selects between the file and `host.stdin` and reads no terminal fact of its own. `inspect()` reports `--file` with `schema: null`, since the hand-written schema declares no converter, and `select`'s `--field` with the array schema `{ type: 'array', items: { type: 'string', minLength: 1 } }` beside the `$schema` key the library writes.

## Graph inspection

`inspect()` returns the declared graph as plain data. It answers in every authoring state, as `run()` and `name` do, and it is synchronous. It applies every rule `run()` applies before it reads a token, in the same order, except one, and one rule of its own: it does not pass a declared default through its schema, because that call can be asynchronous. So it applies the build and structural checks, every rule a single declaration carries, such as a Boolean option with `validate`, `required: true` beside a default, and a non-Boolean `required`, `variadic`, or `validateOmitted`, and the raw shape of a default declared without a schema. A rejected declaration throws the exported `DeclarationError`, which a consumer catches by class. `run()` reports the same message as a diagnostic with exit code 1, and it alone reports a default its schema rejects. A schema whose converter fails reads `null` on both paths under [Input schema](#input-schema) until its diagnostic is decided. `inspect()` reads no host facts, and it caches nothing: each call builds the graph anew.

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
      readonly scope: 'application' | 'plugin';
      readonly long: string | null;
      readonly short: string | null;
      readonly required: boolean;
      readonly multiple: boolean;
      readonly validated: boolean;
      readonly validateOmitted: boolean;
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly default: { readonly value: unknown } | undefined;
      readonly extensions: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly scope: 'application' | 'plugin';
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly polarity: 'positive' | 'negative' | 'both';
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly extensions: Readonly<Record<string, unknown>>;
    };
```

- `name` is `null` for the root, and `path` is the route from the root: `[]` for the root and `['cache', 'clear']` for a nested leaf. Children and declarations appear in authoring order.
- `aliases` holds the Command's [aliases](#aliases) in declaration order, and `[]` for the root and for a Command that declares none. A Command appears once, under its canonical name, so `path` never holds an alias. A completion consumer reads `aliases`; a help or manifest consumer omits them, because an alias is unadvertised.
- `hidden` and `deprecated` are the core facts [Hidden and deprecated members](#hidden-and-deprecated-members) describes: `hidden` is `false` unless the declaration says `true`, and `deprecated` is the declared message or `undefined`. The root reads `hidden: false` and `deprecated: undefined`. A listing projection omits a hidden node and marks a deprecated one, and the candidate list of a routing error is a listing; routing selects and parsing binds without reading either.
- The globals appear once on the graph and never inside a `CommandNode`. A help or manifest consumer combines the two sets for display.
- Spellings are the accepted CLI forms, read from the table the parser reads. `long` is `'--dry-run'` for the declared name `dry-run` and `null` under `shortOnly`, `short` is `'-f'`, and `negative` is `'--no-total'` for `both` and `negative` polarity alone.
- Schema objects stay private. `validated` says whether a schema exists, `validateOmitted` says whether the declaration sends its omission to that schema, and `schema` is the plain [input schema](#input-schema) that schema publishes through its converter, or `null` where the graph holds no published shape. `default` wraps the declared input value, so an explicit `default: undefined` reads apart from no default at all. The wrapped value is a snapshot: arrays and plain objects are copied and frozen to any depth, so a write through the graph fails and a later call reports the declared value again. Other objects are reported as they are.
- `version` is the string the Application declares, or `0.0.0` when it declares none, so it is never `undefined`. Every `description` is the core fact the declaration carries, or `undefined` when omitted. The root `CommandNode` reports the Application's description, the value `CommandGraph.description` holds, so a projection that walks nodes never special-cases the root. The graph names no plugin as the source of anything: which plugin contributed an option is provenance, and a projection describes the built product alone. An extension key carries its defining plugin's identity because that identity is the fact's name, the way a package name is part of an import, not a record of who installed what.
- `globals` holds the application's global options and every plugin option in one list, in the order the globals table holds them: the application's declarations, then each plugin's in installation order. `scope` is `'application'` for an option declared on the Application or on a Command, global or local, by the author or by a plugin's `onCommandAttach` hook, and `'plugin'` for a [plugin option](#plugin-options), the kind declared under a plugin's `options` in the globals table, which reaches no action; it names no plugin. A plugin entry on the string variant always reads `required: false`, `validated: false`, `validateOmitted: false`, and `schema: null`, so a projection does not branch on them; the Boolean variant carries `schema: null` and none of the other three.
- `result` is `null` on a Command that declares none, and otherwise the kind, the view names in record order, and the default, under [Results](#results). The names include every view a plugin's `onCommandAttach` hook added, and an option such a hook declared appears under the node's `options` like any local option, because the graph names no plugin as the source of anything.
- `extensions` holds each [extension value](#extensions) the declaration carries, keyed by extension identity, as the frozen plain-data output of its schema. A [collecting extension](#collecting-extensions) holds the frozen array of its values' outputs in collection order, and a declaration that carries none of its values has no key for it. `readExtension(node, descriptor)` is the typed read; the record is the projection-neutral form.
- The result is frozen, and its types are read-only, so a consumer reads it without copying it.

```ts
const graph = app.inspect();
const names = graph.root.children.map((child) => child.path.join(' '));
```

## Invocation

`run(options?)` returns `Promise<ExitCode>` and sets the same `process.exitCode`. It resolves execution failures through the output path.

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| 0    | Successful execution and core output                               |
| 1    | Expected action failure, internal failure, or invalid declarations |
| 2    | Invalid invocation inputs                                          |
| 130  | Cancelled by `SIGINT` or by a caller-supplied abort                |
| 143  | Cancelled by `SIGTERM`                                             |

Each invocation follows this order:

1. Capture host facts and apply overrides.
2. Build and validate the whole Command graph, including the globals table, every installed plugin, every command name, alias, and spelling, and every declared default. Then install the process listeners the validated [signals owner](#signals-and-cancellation) claimed; a build failure installs none.
3. Copy invocation tokens for input processing.
4. Consume global options and plugin options in a pre-scan that stops at the first bare `--`.
5. Route the remaining bare tokens to the selected Command.
6. Prepare the dispatch and hold its fault, raising nothing yet. A selected Command that is a group holds the missing-subcommand error, with the rank the routing errors have, and no token is parsed. Otherwise core parses the remaining tokens with that Command's own spellings, then validates the globals in authoring order and that Command's inputs in authoring order, and holds the first fault by the precedence below, a validator's own developer error included, so a takeover swallows a broken validator as it swallows an input fault.
7. Run the [middleware](#middleware) of each installed plugin whose activation matched, in installation order, loading each one as the chain reaches it. Each middleware reads the request. A middleware that takes over ends the invocation here, and a held fault is never raised. When the chain continues past its last middleware it reaches the dispatch boundary, where core raises the held fault, or reads the selected view and dispatches the action.
8. Await its action.
9. Unwind the middleware chain, finish pending core output, remove any process listeners, and set the exit status.

Error precedence follows these phases. A global structure error comes before a routing error, a routing error comes before a local structure error, and a local structure error comes before a schema issue. Unknown-command, missing-value, repetition, and unexpected-argument diagnostics return code 2. Local parsing and validation run ahead of the chain so that a middleware can read the invocation, and the held fault keeps its rank because it is raised at the point the chain would have parsed before this contract; a takeover never observes it. A run cancelled before the chain starts, an abort landing inside a validator included, resolves its cancellation code under [Signals and cancellation](#signals-and-cancellation), and the held fault is never raised; core awaits the validator in flight and starts no further one. A run cancelled while the chain is running and before it reaches the dispatch boundary never reaches it: the `next()` that would have reached it resolves `'cancelled'`, the held fault and any bad `view` assignment stay unobserved, and the code is the signal's; a cancellation that lands after the action dispatched changes nothing here, and `next()` still resolves `'dispatched'`. The held fault is what the run would have raised before this contract: the input error carrying every issue collected in authoring order, or a validator's developer error, which stops validation where it happens and takes the place of anything collected before it, as [Issues and validator failures](#issues-and-validator-failures) states. The consequence is that a schema runs on an invocation a middleware then takes over, `app get --help` included: this contract requires nothing of a validator it did not require before, so a validator that reads the host or awaits a network still does so on such an invocation, and one with a side effect performs it there. Whether a takeover should skip validation is the open question ADR-0028 records.

An action receives `{ args, options, passthrough, out, host, signal, style }`. The contextual `style` includes the installed theme's custom names. Its return value is ignored, including a resolved promise value. `run()` awaits action completion but does not render its return value. `signal` is the run's cancellation signal, which [Signals and cancellation](#signals-and-cancellation) describes; it never aborts unless a caller supplied a signal or an installed plugin owns the process signals.

The application can run again. Each call captures host facts and builds from its declarations. Core does not call `process.exit()`, consume stdin, or track unrelated background work. It installs process signal listeners only on behalf of an installed signals owner, for the duration of one run, and it re-raises a repeated signal so that the default disposition ends the process when no other listener remains.

## Host

`run({ host: partialHost })` overrides selected host fields. Omitted fields use process capture at invocation entry, before graph build. `run({ signal })` supplies a caller-owned `AbortSignal` that cancels the run, as [Signals and cancellation](#signals-and-cancellation) describes; it is the path for an embedding host or a test, and it composes with an installed signals owner. A `signal` slot holding a value that is not an `AbortSignal` is an internal error reported before the graph is built, `run() received a signal that is not an AbortSignal. Supply the signal of an AbortController.`, and the run returns 1.

| Field              | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| `argv`             | Application tokens without the runtime and script prefix      |
| `platform`         | Captured process platform string, such as `linux` or `win32` |
| `cwd`              | Working directory                                             |
| `env`              | Map of environment names to strings or `undefined`            |
| `stdin`            | Node `Readable` connection                                    |
| `stdout`, `stderr` | Node `Writable` connections                                   |
| `terminal`         | Each stream's `isTTY` value, plus output `columns` and `rows` |

An override replaces its whole field. An environment override replaces the captured map. Terminal facts remain independent of stream overrides. Automatic capture maps missing or zero output dimensions to `undefined`. Supplied terminal overrides retain their values.

The environment snapshot is a plain, case-sensitive map on every operating system, including Windows. Keys retain their original spelling; `Path` and `PATH` are distinct lookups. It does not retain the Windows `process.env` object's case-insensitive lookup.

Core copies argv, environment values, and terminal facts. It retains the supplied stream connections. Parsing does not modify `host.argv`. Application code owns file access and any stdin reads.

The public declarations include Node stream types. The package supplies their type dependency and an explicit declaration reference. Core exports the `Host` and `Out` types, so a helper extracted out of an action, such as a reader that opens a file or `host.stdin`, states its own parameters without reading them back off the action context.

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

`out.fatal()` synchronously throws the exported `FatalError` without an eager write. An uncaught `FatalError` prints its message once and returns code 1. A caught fatal error does not itself change success. Other exceptions use an internal-error diagnostic.

A broken output pipe returns code 1 through the failure path below.

### Rendered output

```ts
interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  row?: never; // a view has one shape; the row view of Results is the other
}
```

A view is a pure synchronous value that turns one typed value into marked text. Its `render` function, the view function, receives the data and an immutable context with `style` and `width(text)`. It holds no output handle. Existing one-argument view functions remain valid. Escape raw data with `style.escape()` before interpolating it into authored text. `out.render` is the neutral render call: a rendered value has no purpose and no destination parameter.

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

Every byte core or a plugin renders passes through one registry of views. A failure diagnostic, a semantic lane message, a help page, and a version line each render through a declared view, and an application replaces the function behind any of them through the `views` option. The registry has one override surface and one resolution, so branding a plugin's page and branding a failure class are the same call.

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
function override<Data>(key: DeclaredView<Data>, replacement: View<Data>): ViewOverride;
function override<Row>(key: DeclaredRowView<Row>, replacement: RowView<Row>): ViewOverride;
function override<Failure extends LoomError>(key: FailureClass<Failure>, replacement: View<Failure>): ViewOverride;
type ViewContribution = AnyDeclaredView | ViewOverride; // ViewOverride is opaque and branded
```

`view(identity, definition)` declares a view: an identity and its default function. The identity follows the plugin-identity convention, the package name with a suffix, so the help page is `@loomcli/plugins/help/page`; core's own views take `@loomcli/core/` as their prefix by the same convention, so the lanes are `@loomcli/core/lanes/<name>` and the incomplete-result line is `@loomcli/core/results/incomplete`. The data type is inferred from the function's first parameter when that parameter is an object type or a `readonly` array, and is stated for a primitive or a union, `view<string>(…)`, because inference runs through `Readonly<Data>`: a union parameter is either rejected or silently inferred as part of the union, so a union is always stated in full, and a view function's array parameter is always `readonly`, so a mutable array parameter is a compile error under any type argument. The value it returns satisfies `View<Data>`, so `out.render(page, helpPage)` type-checks the same way a bare view does, and the identity travels on the value. `DeclaredView` is invariant in `Data` through a private witness, so a declared view is never reassigned as a declared view of another data type, and a replacement that requires data the key does not carry is a compile error; a replacement that accepts wider data is valid, since it accepts the key's data, and a bare `View<Data>` keeps its ordinary assignability. The value is branded the way an extension value is, so a hand-built object with an `identity` field is a bare view to core: `out.render` renders it through its own function and consults no override.

The identity string reaches diagnostics and nothing else: an application never spells it, because a view is named by reference, exactly as an [extension descriptor](#extensions) is. `AnyDeclaredView` is the supertype a contribution list uses; it keeps `identity`, a view function of either shape over `never`, and the brand, and drops the invariance witness, because a list cannot carry one type parameter per element and an invariant type has no common supertype across data types. Every `DeclaredView<Data>` is assignable to it, and the shape rules on a `views` list stay type-rejected. `override` typing is compile-time alone. Core stores a replacement without a run-time witness for a declared-view key, so a JavaScript author's mismatched replacement surfaces through the output-view row of the [Failure contract](#failure-contract) when it throws.

A declared view is exported from a declarations module of the plugin that declares it, `<subpath>/views`, beside the `<subpath>/extension` module that holds its descriptors, so an application that overrides the help page imports `helpPage` from `@loomcli/plugins/help/views` and never the middleware. The two modules are separate because a declared view carries its default function and the modules it needs, while a descriptor module stays declarations alone, which is the promise a projection that imports another plugin's facts relies on. The default function loads with the entry module, which is the one cost this design accepts: a plugin's middleware module stays lazy under [Activation](#activation), and its default view functions are part of its entry cost. A view function is synchronous, so nothing inside it can wait for a lazy import; a plugin whose default function is heavy pays that cost at install, and help's page function is pure string building.

`override(key, replacement)` pairs a key with a replacement view and returns a `ViewOverride`. The key is a declared view or a failure class. Under a declared view the replacement is typed from the view's data, so a view that requires data the key does not carry is a compile error. Under a failure class, `FailureClass<Failure>` is an abstract constructor type, so `UsageError` and `LoomError` are valid keys and the replacement is typed from the class's instances, as [Failure views](#failure-views) describes. The replacement is any `View<Data>`; a declared view passed as the replacement contributes its function alone, and its own identity plays no part. An application lists its overrides under `views`; a plugin lists its declarations and its overrides together under its own `views`, as [Views from plugins](#views-from-plugins) describes. In this contract an application overrides and does not declare: `ApplicationOptions.views` is `readonly ViewOverride[]`, and an application declares no view under the results lane either, because a Command's result names bare views by view name, as [Results](#results) describes.

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

Every identity on the graph is compared the way an extension identity is: across every declared view core exports, every declared view a plugin lists, and every declared-view key an override carries, whether or not the view is declared by an installed plugin. Two distinct objects that share one identity are a `DeclarationError` at build, so an application that imports `helpPage` from one copy of the package while the installed plugin declares it from a second copy is told to deduplicate rather than left with a silent miss, the rule a second copy of an extension descriptor already meets. An override whose identity matches no declaration is inert: it is not a build error, it applies the moment a view with that object is rendered, and it never applies otherwise. An application can therefore brand a help page ahead of installing the plugin, and a shared override list holds in an application that omits it. A failure class never meets either case, because every failure class descends from `LoomError`, core keys each class's default text function as that class's default view, which carries no identity, and an application's own subclass is answered by the chain walk at throw time.

Every view declared in this section renders one whole value in one call. A second structural shape, the row view of [Row views](#row-views), renders a sequence one row at a time through a `row` function, with optional `head` and `tail`, and `view()` declares either shape; the two are told apart by the function present, so no declaration in this section changes and no cardinality field exists. A definition that carries both functions, or neither, is a `DeclarationError` at the `view()` call rather than a guess: `View "probe/both" carries render and row. Supply one of the two.` and `View "probe/none" carries neither render nor row. Supply a view with render or a row view with row.`

Build applies three rules to the registry, each a `DeclarationError` at build, reported the way [Failure views](#failure-views) describes for a build-time fault: two overrides for one key inside one contributor, two distinct declared-view objects that share one identity, and a `views` entry that is not an override on the Application, or neither a declared view nor an override on a plugin, which the types already reject and a JavaScript author alone reaches. [Graph build errors](#graph-build-errors) and [Plugin build errors](#plugin-build-errors) list the diagnostics. The registry is not an `inspect()` fact in this contract.

### Failure classes

Every failure `run()` reports is an instance of a public class. Each class carries the facts its sentence interpolates, so a view reads them instead of parsing prose. `message` is the sentence without its category prefix. The exit code is a field of the base, so a subclass inherits it and a view reads it.

```ts
abstract class LoomError extends Error {
  readonly exitCode: 1 | 2;
}
abstract class UsageError extends LoomError {} // exit 2: the invocation is wrong

type InputProblem =
  | { input: InputIdentity; spelling: string; reason: 'missing' }
  | {
      input: InputIdentity;
      spelling: string;
      reason: 'invalid';
      issues: readonly StandardSchemaV1.Issue[];
    };
```

| Class                     | Base         | Code | Facts                                  |
| ------------------------- | ------------ | ---- | -------------------------------------- |
| `InputError`              | `UsageError` | 2    | `problems`                             |
| `UnknownCommandError`     | `UsageError` | 2    | `token`, `candidates`                  |
| `NonCallableCommandError` | `UsageError` | 2    | `command`, `candidates`                |
| `UnexpectedArgumentError` | `UsageError` | 2    | `command`, `accepted`, `extra`         |
| `UnknownOptionError`      | `UsageError` | 2    | `spelling`                             |
| `MissingValueError`       | `UsageError` | 2    | `spelling`                             |
| `UnexpectedValueError`    | `UsageError` | 2    | `spelling`, `value`                    |
| `RepeatedOptionError`     | `UsageError` | 2    | `spelling`                             |
| `ShortGroupError`         | `UsageError` | 2    | `token`, `reason`                      |
| `DeclarationError`        | `LoomError`  | 1    | the declaration sentence alone         |
| `FatalError`              | `LoomError`  | 1    | the message `out.fatal()` received     |
| `InternalError`           | `LoomError`  | 1    | `cause`, the thrown value core wrapped |
| `ResultError`             | `InternalError` | 1 | `path`, `kind`, and an `undefined` `cause`; see [Results](#results) |

Core's default views add the category prefixes: `Invalid input: ` for every `UsageError`, `Invalid declaration: ` for `DeclarationError`, `Internal error: ` for `InternalError` and `ResultError`, and none for `FatalError`.

`InputError.problems` carries the whole validation phase in authoring order: each required input the invocation omitted, and each value a schema rejected with the issues that schema returned. `spelling` is the token an operator would type: `--file` for an option, `-F` for a `shortOnly` option, and the declared name for an argument. An omitted required argument is a `missing` problem like an omitted required option, so omission has one class whichever kind of input it names. An `invalid` problem always carries at least one issue: a schema that rejected a value and returned none reports `The schema rejected this value without an explanation.`, the sentence core's own text uses. Error precedence is unchanged, because routing and token errors still precede validation.

`issuePath(issue)` returns the dotted path an issue names inside a value, such as `1` for the second item of a collection, or `undefined` when the issue names the value itself, so a view positions an issue the way core's default text does.

`candidates` on `UnknownCommandError` and `NonCallableCommandError` holds the canonical child names in authoring order. An alias never appears in it, and neither does a hidden Command. A deprecated Command appears by name alone, because the list holds names and no message; its migration message lives on the help page.

`ShortGroupError.reason` is `'value-position'` for a value option that is not last in its group, and `'mixed-scope'` for a group that mixes a global letter with one the globals do not own. `ShortGroupError.token` holds what each reason names: the single option's spelling, such as `-d`, for `'value-position'`, and the whole group, such as `-qZ`, for `'mixed-scope'`.

`InternalError` wraps an unexpected exception or a non-error throw. Its message is the thrown error's message, or `An unknown error occurred.` A schema that throws stays a `DeclarationError`, because only a returned issue states a validation verdict.

`FatalError` is the class `out.fatal()` throws. An application can subclass it and override the view for the subclass, which is how one fatal type implies one diagnostic.

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

The view receives the failure instance and the stderr view context. It returns marked text that core resolves for stderr without adding a newline, so the view owns its trailing newline. Core's default diagnostics escape raw facts; `FatalError` retains the authored marked message supplied to `out.fatal()`. A working view cannot change the exit code, which is a fact of the class. A view that throws or returns a non-string is itself an internal failure, so that invocation returns 1 whichever code the original failure carried, except in a cancelled run, which keeps its signal's code under [Signals and cancellation](#signals-and-cancellation) and reports the view fault as text.

Resolution follows the one walk [Views](#views) defines: the application's overrides, then each installed plugin's overrides in installation order, then core's default text, with the thrown failure's prototype chain walked in full, most derived first, at each contributor before the next is consulted. An override for `UsageError` therefore brands every exit-2 failure at once, whatever any plugin registers beneath it, and within one contributor an override for a `FatalError` subclass beats one for `FatalError`. `DeclarationError` and `InternalError` reach overrides too, because an author-facing diagnostic is still output the application owns; a `DeclarationError` build raises reaches the application's overrides too, because core publishes the application's registry before it builds the plugins and the graph, with two bounds: a fault inside the application's own `views` list reports through core's default text, because that list is what failed, and a plugin's overrides are not consulted for a build-time fault, because build has not yet validated them. A `DeclarationError` raised at run time, such as a typed read through the wrong descriptor, resolves through every contributor like any other failure. Two overrides for one class by one contributor are such a build error; the same class overridden by the application and a plugin, or by two plugins, resolves first-in-wins, as [Views from plugins](#views-from-plugins) describes.

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

Its actions call `out.fatal(message)`, and its helpers throw `new FatalError(message)`. Both pass unescaped messages. The view escapes once, so helpers need no output or style context. Jsonkit and textstat use this pattern. The override applies to those applications; core's default `FatalError` view still accepts authored marked text.

### Failure contract

View and destination failures are internal errors and return code 1, except in a cancelled run as [Signals and cancellation](#signals-and-cancellation) defines it, where the code stays the signal's and the fault is reported as text; every row below reads with that carve-out and one more: a failure the chain or the action raised stays primary over a deferred view fault and keeps its own code, so an action that throws an `InputError` after an unawaited broken `out.render` returns 2. The rows speak of the chain, because a middleware calls `out.render` and the semantic methods under the same output contract an action has, and the help page is rendered by one.

| Failure                                           | Observation                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An output view throws or returns a non-string     | The `out.render` call rejects with the view's error, and nothing is written for that call under a whole view; a row view's pieces before the fault stand, under [Results](#results). Later output still writes. After the chain and the action have settled, core reports one `InternalError` through the registry, `Rendering output failed: <reason>`, and returns 1. A failure the chain or the action raised stays primary over it and keeps its own exit code, and one fault reports once: when the chain or the action raised any failure, core writes that failure's diagnostic and no separate internal error for the view fault, whether the failure is the view's own rejection returned by a middleware or a wrapper thrown around it; the `Rendering output failed` diagnostic appears only when the chain and the action returned normally. A takeover that would have returned 0 returns 1. |
| A lane view throws or returns a non-string        | The semantic call rejects with the view's error, and nothing is written for that call. The rest of the row above applies: later output still writes, and core reports one `InternalError` after the chain and the action have settled and returns 1.                                                                                |
| A destination write fails                         | The call rejects, later writes to that destination reject, core attempts one plain stderr fallback, and returns 1.                                                                                                                                                                                                |
| A failure view throws or returns a non-string     | Core writes the default text of the original failure, then `Internal error: Rendering the failure failed: <reason>`, through the plain fallback path on stderr, bypassing every override whichever contributor made it, and returns 1. The original failure stays primary.                                       |
| The fallback write fails                          | Reporting stops. `run()` still resolves 1.                                                                                                                                                                                                                                                                        |

Successful completion requires output completion. A view failure during the chain or the action makes the invocation unsuccessful even when the action or middleware returned normally and even when it caught the rejection. The fallback path calls no override and no lane; it calls core's default text function. A thenable a view returned receives a rejection handler and is otherwise ignored.

### Example coverage

[textstat](../examples/textstat/src/application.ts) prints a row per counted source, and a read failure on any source leaves stdout empty. The header names `COUNT`, then `SOURCE`. Counts right-align in a column as wide as the header or the widest count, a two-space gutter separates the columns, and the source column has no trailing padding. The total row is present only with `--total` and its source is `total`, so a selection that the byte threshold filters entirely still prints the header and one `total` row. The [table](#table) view produces these bytes from the column list, and the [table and records coverage](#table-and-records-example-coverage) pins them.

```text
COUNT  SOURCE
    6  one.txt
    2  two words.txt
    8  total
```

[jsonkit](../examples/jsonkit/src/views.ts) overrides three failure views and keeps core's text for every other class: two branded views and the literal `FatalError` view above. The branded views prefix the application name. The `InputError` view writes one line per problem, `jsonkit: <spelling>: <issue message>`, with ` at <path>` after the spelling when an issue carries a path, and `jsonkit: <spelling>: required` for an omission. The `UnknownCommandError` view writes `jsonkit: unknown command "<token>"; try <candidates>.`, and when the candidate list is empty it ends after the first clause, `jsonkit: unknown command "nope".`

| Invocation                              | stderr                                                    | Code |
| --------------------------------------- | --------------------------------------------------------- | ---- |
| `jsonkit select --field '' -f doc.json` | `jsonkit: --field at 0: Supply a nonempty field name.`    | 2    |
| `jsonkit get -f doc.json`               | `jsonkit: path: required`                                 | 2    |
| `jsonkit typo -f doc.json`              | `jsonkit: unknown command "typo"; try get, keys, select, fetch.` | 2    |
| `jsonkit get missing -f doc.json`       | `Path not found: missing`                                 | 1    |

The last row renders through the literal `FatalError` view, which escapes the message and adds nothing, so its bytes match core's text for a message that carries no marker.

The registry increment is proven when jsonkit's three failure overrides produce the bytes above unchanged, and when an override of `helpPage` in a test application changes `jsonkit --help` while `help()` stays installed. The acceptance tests cover the resolution order with one application override and one plugin override for a shared key, an application override for `UsageError` beside a plugin override for `InputError` resolving to the application's, an earlier plugin's `UsageError` override beside a later plugin's `InputError` override resolving to the earlier plugin's, a declared-view key from a second copy of a package rejected at build, an inert override for a view no plugin declares, an override of `lanes.warn` observed through `out.warn` with one newline, a hand-built object with an `identity` field rendered as a bare view, a help page and a version line whose graph facts carry marker characters printed literally, each build rule above, a broken lane view, a broken `helpPage` override under `jsonkit --help` returning 1 with one diagnostic on stderr, an action that throws an `InputError` after an unawaited broken `out.render` returning 2 with one diagnostic, and a broken failure view under the fallback path. The negative type checks gain the invariance cases, a replacement that requires data the key lacks and a declared view reassigned to another data type, and the retired `Renderer` cases move to `View`. Each case runs under Node and Bun.

### Results

A result is the typed value a Command produces for its consumer, as distinct from the messages it writes about its work. The results lane is opt-in in four steps, and each step pays for itself alone: a pack view rendered inside the action with no declaration, one declared result with a default view, the [formatter](#formatter) that lets a run select another view by name, and rows that render as they arrive. Nothing in the first step needs the rest, and a Command that declares no result behaves exactly as [Output and failures](#output-and-failures) describes.

The block restates `View` from [Rendered output](#rendered-output) beside the shapes and calls this section adds. The `views()` lines describe one method whose record type and presence follow the carried result: the implementation adds the member to the picked surface where a result is carried, so a declaration with none has no `views` member at all, and it may expose one signature per call with internal dispatch where overloads would make a rejection read as a complaint about the last overload.

```ts
interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  row?: never;
}
interface RowView<Row> {
  row: (row: Readonly<Row>, index: number, context: ViewContext) => string;
  head?: (context: ViewContext) => string;
  tail?: (count: number, context: ViewContext) => string;
  render?: never;
}
interface DeclaredRowView<Row> extends RowView<Row>, DeclaredViewBrand {
  readonly identity: string;
  readonly [invariant]: (row: Row) => Row; // the same private witness DeclaredView carries
}
type ResultViews<Value> = Readonly<Record<string, View<Value>>>;
type RowViews<Row> = Readonly<Record<string, View<readonly Row[]> | RowView<Row>>>;

function view<Data>(identity: string, definition: View<Data>): DeclaredView<Data>;
function view<Row>(identity: string, definition: RowView<Row>): DeclaredRowView<Row>;
function override<Row>(key: DeclaredRowView<Row>, replacement: RowView<Row>): ViewOverride;

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

A view renders one whole value in one call, as [Rendered output](#rendered-output) defines it; where the two shapes meet, this section calls it a whole view. A row view renders a sequence one row at a time: `row` receives one row, its zero-based index, and the view context, and returns the text for that row; `head` and `tail` return the text that opens and closes the sequence, and each defaults to the empty string. `head` receives the view context alone, because nothing about the sequence is known before it starts. `tail` receives the number of rows `row` was called with and then the view context, so a summary line reports a count no view has to accumulate, and the count is zero on an empty sequence. Every function is pure and synchronous, holds no output handle, and owns the newlines in the text it returns, because the write site appends nothing. The two shapes are exclusive: a whole view has `render` and no `row`, a row view has `row` and no `render`, the types reject a value with both, and build rejects one a JavaScript author writes, so core never guesses. `view(identity, definition)` declares either shape, and a declared row view carries the brand and the invariance witness a declared view carries, so `override` keyed by it takes a row view under the rules of [Views](#views) unchanged; a replacement supplies the whole shape, so an omitted `head` or `tail` replaces the default's with nothing. `AnyDeclaredView` and `ViewContribution` admit both shapes, as the type block there states.

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

The names `json` and `jsonl` carry a promise: a view under either name encodes as the formatter's view of that name does, whatever its `map` reshapes. The [manifest](#manifest) states the two encodings to an agent on the strength of the name alone, because a view's name is all the graph holds. Core enforces nothing here. An author who puts another view under `json` or `jsonl` breaks the promise the manifest makes for that Command, and a view that encodes differently takes another name.

The `views()` call reshapes the views after the fact. It is published in every state on a declaration that carries a result, and never on one that carries none, so an importing application can add a wide table or a mapped `json` to a Command it did not author without touching its action. Its record takes the shape the declaration carries, so a row view under a value result is the same compile error there as in the declaration. It merges by key: an existing key is replaced in place and keeps its position, and a new key is appended. `default` names the key that becomes the default view; a default once named persists through later calls that name none, and until one is named the first key is the default. Naming a key the record does not hold after the merge is a build error. Like `extend()`, `views()` returns a new immutable value. A result's view is replaced by name alone: the Application's override list reaches failures, lanes, and declared views by reference, and never a result's views, which carry no identity.

```ts
import { json } from '@loomcli/plugins/format';
import { table } from '@loomcli/plugins/table';

import { count } from './commands/count.js';
import type { Row } from './row.js';

const wide = table<Row>({ columns: ['source', 'count', { key: 'count', header: 'Share', format: share }] });
export const branded = count.views({ wide, json: json({ map: toWire }) }, { default: 'wide' });
```

The declaration is a graph fact. `inspect()` publishes `result` on every node, as [Graph inspection](#graph-inspection) lists it: `null` where none is declared, and otherwise `{ kind: 'value' | 'rows', views: readonly string[], default: string }`, the names in record order. No schema is part of the declaration; a projection that needs the shape of a result reads a fact the plugin that needs it defines.

#### Emitting a result

An action emits its result once through `out.results`. Core renders the selected view: the one a middleware named through `view` on its [context](#middleware) before the action dispatched, or the declaration's default when none did. Under `result<Value>` the argument is the value, and core renders the selected view over it and writes the text to stdout. Under `rows<Row>` the argument is any `Iterable<Row>` or `AsyncIterable<Row>`, an array included, so an action holds no opinion about whether its consumer wants a buffer or a stream. Under a row view core writes `head`, then each row's text as the source yields it, under the back-pressure and ordering rules of [Row views](#row-views), then `tail`. Under a whole view core collects every row and renders once at the end of the source, so a whole view over an unbounded source never completes, which is the author's choice and not a build error. An empty sequence still writes `head` and `tail`, and renders a whole view over an empty array. `results` is present on every `Out`, so no method is ever removed, and it accepts a value on the action's `out` of a Command that declares a result alone: on a Command with no declared result and on a middleware's `out` its argument is typed `never`, and a JavaScript caller reaches the `undeclared` or the `middleware` fault below; a call from a middleware is the `middleware` kind whatever the Command declares and whatever the action did.

The returned promise resolves when the last byte of the result is written and rejects on a view or a write failure. It is the ordering anchor for anything the action writes afterwards, so `await out.results(rows); await out.info('done')` puts the summary after the last row. The optional-await contract holds: an action that returns normally without awaiting the call still has its result written and accounted for before the invocation completes, because a pending sequence is open output, and the rows source is still drained.

A declared result is a promise the Command makes, and core holds the action to it from the moment the action runs. An action that returns normally without calling `out.results` fails with `ResultError`, exit 1, naming the Command. A failure raised before the call is that failure, because a failure is the outcome, not a missing result. A run cancelled under [Signals and cancellation](#signals-and-cancellation) raises no missing-result fault, because an action that reads `signal` and returns is the sanctioned path. A middleware that never dispatches raises none either, because the action never ran. A second call rejects with `ResultError` and turns a would-be 0 into 1, the rule a second `next()` follows in a middleware chain. `ResultError` extends `InternalError`, so an override of `InternalError` brands it and its default text carries the `Internal error: ` prefix; its `cause` is `undefined`, because it wraps no thrown value, it carries the Command's `path` and a `kind`, and an override keyed by the class itself reaches it alone.

```ts
class ResultError extends InternalError {
  readonly path: readonly string[];
  readonly kind: 'missing' | 'repeated' | 'undeclared' | 'middleware';
  readonly cause: undefined;
} // exit 1
```

| Fault                                              | Diagnostic                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The action returned without emitting               | `Internal error: Command "count" declares a result and its action returned without emitting one. Call out.results() once.` |
| The action emitted twice                           | `Internal error: Command "count" emitted its result twice. Call out.results() once.`                                        |
| `out.results` on a Command with no declared result | `Internal error: Command "get" declares no result. Declare one with result() or rows() before action().`                    |
| `out.results` from a middleware                    | `Internal error: A middleware called out.results() on Command "count". Only the action emits a result.`                     |

The root Command is named by that phrase rather than by a name, capitalized where it opens a sentence, as every diagnostic names it.

#### Stdout belongs to the result

On a Command that declares a result, nothing the action writes but the result reaches stdout. The action's `out` is its own channel object: `print` and `render` keep their signatures and write to stderr, decided at graph build from the declaration and never at run time from the selected view, so a script that captures stdout receives the result and nothing else the action wrote whichever view ran. The redirect moves the destination and the view context together, so capability detection and glyph selection follow the stream the bytes reach, `out.render(message, lanes.print)` included. `info`, `success`, `warn`, and `error` already write to stderr, and `fatal` still throws without writing. No method is removed, because an author denied a lane works around the framework rather than through it. On a Command with no declared result every method keeps the destination the table in [Output and failures](#output-and-failures) states. A middleware's `out` keeps those default destinations on every Command, so a help page rendered for a result Command still reaches stdout, and a middleware that prints to stdout after `next()` on a result Command owns what its consumer then reads.

#### A sequence that stops early

A rows sequence, under `out.results` or under `out.render` with a row view, can stop before it is complete: the source throws, the selected view's function throws or returns a non-string, under a row view mid-sequence or under a whole view once the source has ended, a write to the destination fails, the action fails while an unawaited sequence is pending, or the run is cancelled. In every case core stops requesting rows, writes no `tail`, and retracts nothing already written, so under a row view the rows already written stay on the call's destination, and under a whole view nothing was queued before the source ended, so the destination holds nothing from the sequence unless its one final write itself failed partway. Core then writes one line on stderr through the declared view `incompleteResult`, exported from core with the identity `@loomcli/core/results/incomplete`, over `{ path, yielded, written }`: `yielded` counts the rows the source produced, including one an in-flight request delivers after the stop, which is never written, and `written` counts the rows whose text core wrote, which is zero under a whole view. The line resolves through the registry the way `out.render` output does and follows the output-view row of the [Failure contract](#failure-contract): the view owns its newline, an override that returns the empty string silences it, and an override that throws writes nothing for it and is reported as a view fault only when nothing else is primary. The line prints for zero rows too, because an empty stdout and a failed stdout must not read the same. When stderr itself has already failed, the line goes through the plain fallback path and no further.

```text
Output is incomplete: Command "count" stopped after 4 rows, 3 written.
```

What follows the line is the fault's own report, when there is one. A value that iterates neither way is the source's own fault before the first row, reported as `Internal error: The result of Command "count" is not iterable.`, which the types reject and a JavaScript author alone reaches. A source that throws under an awaited call ends the invocation with that failure's exit code and its diagnostic; under a call the action did not await and had already returned from, it is a deferred fault that reports its own diagnostic and returns 1, the rule every post-settle fault follows. A view of either shape that throws or returns a non-string is the output-view fault of the [Failure contract](#failure-contract), rejection with the view's error included, so an action that awaits the call and lets a thrown failure class propagate keeps that class's code as it would for any view; the atomic rule there, nothing written for the call, is scoped to a whole view, and a row view's pieces before the fault stand. A write failure follows the destination row of the same contract, whose diagnostic is the report. An action that fails while its unawaited sequence is pending stays primary, and the sequence is stopped rather than drained. Under cancellation the code stays the signal's: from the moment the run is cancelled core requests no further rows and writes no further pieces, calls the source's `return`, and treats the sequence as stopped early, so a truncated result never reads as a complete one. A row an in-flight request delivers after the cancellation counts as yielded and is not written, a cancellation echo the source throws is silent, and when nothing else failed the line stands alone. A failure the action raises after `out.results` resolved is an ordinary failure, and the result it already wrote stands.

```ts
import { Application, incompleteResult, override } from '@loomcli/core';

const app = new Application('quiet', { views: [override(incompleteResult, { render: () => '' })] });
```

#### Result build errors

Build applies the rules below at every depth, each a `DeclarationError` with exit 1 under [Graph build errors](#graph-build-errors). The types already reject most of them, so they reach a JavaScript author alone: a `result()` or `rows()` call after `action()`, a second `result()` or `rows()` call, a row view under `result()`, a `views` entry that is neither shape or carries both `render` and `row`, and a `views()` call on a declaration with no result. The rest surface for every author at build: a key that is not a bare token or is integer-like, an empty record, a `default` that names no key, and a result on a Command with no action.

| Rejected declaration                          | Diagnostic                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A result declared after the action            | `Command "count" declares its result after its action. Declare result() or rows() before action().`                          |
| A second result declaration                   | `Command "count" declares two results. Declare one result() or rows() call.`                                                 |
| A result on a Command with no action          | `Command "count" declares a result and no action. Register an action or remove the result.`                                  |
| A views() call on a declaration with no result | `Command "get" reshapes its views and declares no result. Declare result() or rows() before action().`                      |
| A row view on a value result                  | `Command "get" names row view "records" on a value result. Supply a view with render, or declare the result with rows().`    |
| A views entry that is not a view              | `Command "count" names view "table" with a value that is not a view. Supply a view with render or a row view with row.`      |
| A views entry that carries both shapes        | `Command "count" names view "both" with render and row. Supply one of the two.`                                              |
| A view name that is not a bare token           | `Command "count" names view "wide table". Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.` |
| An empty views record                         | `Command "count" declares a result with no views. Name at least one view.`                                                   |
| A default that names no key                   | `Command "count" selects default view "wide", which it does not name. Name the view or select a named one.`                  |

#### Results example coverage

The results increment is proven when [textstat](../examples/textstat/src/application.ts) declares its table as a result with one whole view under the key `table` and prints the table bytes the [table and records coverage](#table-and-records-example-coverage) pins, with its `--timing` line still on stderr, and when a hidden jsonkit Command declares `rows<Entry>` over the document's paths with an application-authored row view as its default and a whole view under a second key, writes each row as an async generator yields it, and leaves a partial list and the incomplete line behind when the generator throws. The acceptance tests cover both shapes of `out.render` with a row view under a synchronous and an asynchronous iterable, `out.results` under each declaration with an array, a generator, and an async generator, back-pressure observed through a destination that delays its write callback and a source that records each request, so no second request precedes the first callback, a later `print` to the same destination landing after an unawaited sequence's last piece under a row view and under a whole view, an invocation that stays open while an unawaited sequence waits on a slow source and completes after it, `print` and `render` reaching stderr with stderr's capabilities on a result Command and stdout on a plain one, a middleware's `print` keeping stdout on a result Command, each `ResultError` kind with its exit code, its prefix, and an `undefined` cause, an `InternalError` override reaching a `ResultError`, a cancelled run with an unemitted result returning the signal's code and no missing-result diagnostic, each early stop of the previous section under a row view and under a whole view with the incomplete line carrying both counts before the report, a whole view that throws after a finite source ended, a cancelled source that returns leaving the line alone, an override of `incompleteResult` silencing it and one that throws leaving the primary report intact, an empty sequence under each view shape, `views()` replacing a key in place, appending a key, moving the default, and keeping a moved default through a later call, `inspect()` publishing the fact, and each build rule above. The positive type checks cover a declared row view in a plugin's `views` list and a library's neutral annotation and `command()` attachment of a declaration with a result. The negative type checks cover an iterable that is not the declared value passed under `result`, a value passed under `rows`, `out.results` on a Command with no result and on a middleware's `out`, a column that names a missing field through the declaration and through `out.render`, a value with both `render` and `row` in a declaration and in `views()`, a row view under `result` in a declaration and in `views()`, `result()` or `rows()` called after `action()`, and `views()` on a declaration with no result. Editor latency on `ActionHandler` over a declaration with a result is measured against the current baseline before the increment merges. Each case runs under Node and Bun.

## Plugins

Core installs no plugins. Every capability beyond authoring, graph build, invocation, host capture, output, and failures is a plugin that an Application installs explicitly, and a first-party plugin uses the same public contract as a third-party one. A plugin is a frozen value that `plugin(identity, definition)` returns. It holds the options it contributes, one middleware with its activation and a loader, the extensions it defines, the views it declares and overrides, one optional claim on the signals slot, and its [lifecycle hooks](#lifecycle-hooks), the functions core calls at named points of an Application's life. Creating and installing the value runs none of its code: a hook runs at graph build, and the middleware runs inside an invocation. An installed plugin costs its entry module and the declarations that module imports on an invocation that never reaches it, plus one call of each hook it implements at every point core calls it, since the graph builds on every invocation; its middleware module loads only when the chain reaches it.

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
  extensions?: readonly AnyExtension[];
  views?: readonly ViewContribution[];
  signals?: readonly ('SIGINT' | 'SIGTERM')[];
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
import { helpPage } from './views.js';

const options = { help: { description: 'Show this help.', short: 'h', type: 'boolean' } } satisfies PluginOptions;
export type HelpOptions = typeof options;

export function help(): Plugin<HelpOptions> {
  return plugin(`${Package.name}/help`, {
    extensions: [helpArgument, helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
    onCommandAttach: attachHelp,
    options,
    views: [helpPage],
  });
}
```

A plugin package written outside this repository enables `resolveJsonModule` to import its manifest this way. The compiler copies the manifest into the output directory beside the compiled modules, so the package's `exports` targets stay relative to the package root, and a module inside the output must not import its own package by name. `Package.name` types as `string`, never as a literal, so nothing keys on an identity at the type level. A package that ships one plugin uses `Package.name` alone as the identity; the example above ships several, so it appends the plugin's own name, as [First-party plugins](#first-party-plugins) describes.

### Identity and installation

A plugin's identity is a nonempty string. The convention is the package name for a package that ships one plugin, and `<package name>/<plugin>` for a package that ships several, both read from the package manifest so the identity and the package stay in sync. An application-local plugin names itself the same way, under the application's own name. Identity is fixed where the plugin is defined and never changes at installation, because the extensions a plugin defines carry that identity in modules the plugin's consumers import statically.

An Application installs plugins through `plugins` in its options object. Installation order is the order every plugin contribution composes in, so the application source shows the precedence. The list is the only way in: there is no install call on the fluent chain, no default set, and no removal. Replacing a first-party behavior means omitting one plugin and installing another. Build rejects a `plugins` entry that is not a plugin value and an identity installed twice.

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

import Package from '../package.json' with { type: 'json' };

export const jsonkit = new Application('jsonkit', {
  plugins: [help()],
  version: Package.version,
});
```

### Plugin options

A plugin declares options under `options`, keyed by name, with the parsing part of the `OptionConfig` shape, `type`, `short`, `shortOnly`, `polarity`, `multiple`, and `default`, plus the core facts `description`, `hidden`, and `deprecated`, and `extensions`. A plugin option declares no schema and no presence rule: build rejects `validate`, `validateOmitted`, and `required` on it, and a Boolean option keeps the inherited rule that it declares no default. Its value is what the parser produced, or the declared default when the option was omitted, which core fills before the chain without validation and copies afresh for each run. The type follows the declaration: `boolean` for a Boolean option, `string | undefined` for a string option, `string` when it declares a default, and `string[]` for a multiple option, whose default is a `string[]` under the ordinary rule and `[]` when omitted with no default. `PluginOptions` is the declaration record, `Readonly<Record<string, OptionConfig>>` restricted to the keys above, and `PluginOptionValues<Options>` maps each declaration through the same `OptionValue` an action's options use; both are exported, as `OptionsOf` is. A plugin that needs a richer value, such as a log level, reads the string and interprets it itself. A value it cannot use is the plugin's own diagnostic, thrown as whichever failure class the plugin chooses, and core never generates an input error for it.

Plugin options share the globals table with the application's global options: the pre-scan consumes them at any placement before the passthrough delimiter with the ordinary value rules, and every collision is a build error, by key or by spelling, against an application global, against a local option on any Command, or against another plugin's option. A structure fault in a plugin option, such as a missing value or a repeated occurrence, is the same pre-scan input error a global option produces, with the same precedence and the same wording, so the mixed-scope short group diagnostic says "global option" for a plugin letter too, because the pre-scan reads one table. Plugin options are not global options: a global value reaches every action, while a plugin option reaches its own plugin's middleware alone. An action never receives them, and a middleware never receives another plugin's options or the application's globals. `inspect()` lists both kinds in `globals` and tells them apart by `scope`.

### Middleware

An invocation runs one chain. After the global pre-scan and routing have selected a Command, and after core has parsed that Command's local tokens and validated the invocation, holding any fault it found, core runs the middleware of each installed plugin whose activation matched, in installation order. The selected Command's action terminates the chain. A middleware surrounds the whole request: it reads the request before the action runs, it can set the view the result renders through, and its code after `await next()` runs after the action. A middleware receives:

```ts
interface MiddlewareContext<Options extends PluginOptions = PluginOptions> {
  readonly options: PluginOptionValues<Options>;
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
type ChainOutcome = 'dispatched' | 'taken-over' | 'cancelled';
type Middleware<P extends Plugin | ((...args: never[]) => Plugin)> = (
  context: MiddlewareContext<OptionsOf<P>>,
) => Promise<void> | void;
```

- `options` holds the plugin's own option values, typed from its declaration. `Middleware` accepts the plugin type or its factory's type, with or without parameters, and the exported `OptionsOf` extracts the declared options from either, so `Middleware<typeof help>` reads them from the factory's annotated return type.
- `graph` is the frozen graph `inspect()` returns, and `command` is the routed node inside it, so `jsonkit get --help` renders help for `get`, `jsonkit --help` for the root, and `jsonkit cache --help` for the `cache` group. An unknown command fails in routing before any middleware runs, as it does today. The callable check on a group keeps its rank among the routing errors but is held and raised at the dispatch boundary, so a middleware can take over a group invocation and `jsonkit cache --verbose` still reports the missing subcommand when no middleware takes over.
- `request` is the routed Command's invocation after parsing and validation, the exported `Request`: the argument values under `args`, the local option values under `options`, each as the schema output an action receives, and the passthrough tokens. It is `null` while core holds a fault and on a group, so a middleware never reads a half-parsed invocation. The records are untyped: a middleware runs ahead of every action and the graph carries no type for a value, so it checks what it reads. Every array and plain object is copied and frozen to any depth, so a middleware that reaches into one reaches its own copy and contributes nothing to what the action receives, which is a later contract; a value that is neither, a class instance or a `Date` a schema produced, is shared by reference because core cannot copy it meaningfully. Global and plugin option values are not here; a plugin reads its own under `options`.
- `view` names the view the result renders through, on a Command that declares a [result](#results). It reads as the declaration's default until a middleware assigns one, and as `null` on a Command that declares none; it accepts a string alone. It is one value per run: the last assignment before the dispatch boundary wins, whichever middleware made it and whether or not that middleware had already called `next()`, and an assignment after the boundary changes nothing. A name the record does not hold, a non-string, or an assignment on a Command with no result is an internal error raised at the boundary, exit 1, naming the plugin, because a plugin that selects a view has the name checked first, as the [formatter](#formatter) does through its option's validator. Core spells no view name of its own.
- `next()` continues the invocation: every later middleware, then the dispatch boundary. The dispatch boundary is the point the chain reaches when its last middleware continues: there core raises a held fault, or else reads `view` and dispatches the action, so a held fault ranks ahead of a bad assignment. A held fault is raised there and not before, so a wrapper installed ahead of help still reaches help's takeover; the innermost `next()` rejects with it, the rejection propagates outward through every awaiting `next()`, and the fault keeps its exit code and rank, so a wrapping plugin sees a schema issue the way it sees an action failure. Otherwise it resolves when the rest of the chain has settled, with `'dispatched'` when the action ran, `'taken-over'` when a later middleware returned without calling its own `next()`, and `'cancelled'` when the run was cancelled before the action ran, so a wrapping plugin knows what it wrapped. `'cancelled'` wins over `'taken-over'`, so a later middleware that returns because it saw the abort reports as cancelled, the order the exit codes follow. It rejects with the failure the rest of the chain raised. Core records that failure when it is raised, so a middleware that catches the rejection changes its own control flow and not the exit code, the rule an action's caught output rejection already follows. A later middleware that catches the failure the rest of the chain raised and returns reports to its callers as `'taken-over'` when the action never ran and `'dispatched'` when it did, and the recorded failure still decides the exit code.
- `next` is live until the middleware's own result settles. Calling it twice, or calling it after the middleware has returned, is an internal error: the call rejects and nothing is parsed or dispatched. While the run is live the fault is reported after the primary outcome and turns a would-be 0 into 1; once `run()` has resolved, the call only rejects.
- A middleware that returns without calling `next()` has taken over the invocation. A held fault is never raised, nothing later in the chain runs, and the exit code is 0 unless the middleware throws, its output fails, or the run was cancelled, under the precedence in [Signals and cancellation](#signals-and-cancellation). So `jsonkit get --help` renders while `get` is missing its required `path`, and `jsonkit select --bogus --help` renders too, as they did when the chain ran ahead of parsing. Because the chain runs in installation order, `jsonkit --help --version` prints help when help is installed first.
- Core calls a plugin's `load` at the moment the chain reaches that plugin, not before. A takeover earlier in the chain therefore never loads a later plugin, and `jsonkit --help --version` never imports the version middleware module.
- Work after `await next()` returns, or in a `finally` around it, is the plugin's cleanup, and it runs in reverse installation order because the awaited calls unwind. A middleware reads the outcome directly: the value `next()` resolved, the failure it rejected with, or `signal.aborted` with a reason naming the signal. The order holds for a middleware that awaits `next()`. A middleware that calls `next()` without awaiting it still holds the chain open, because core awaits the middleware's own result and the downstream promise both, but its own cleanup then runs whenever it returns, ahead of the chain it started.
- `out` follows the output contract an action has, with the default destinations on every Command and `results` typed with a `never` argument, since a result is the action's promise under [Results](#results). Output a middleware issues counts toward completion the same way, and a middleware whose promise never settles holds the run open exactly as an action would.

A `FatalError` or other failure a middleware throws before its `next()` has settled, or without calling it, resolves through the failure path with that class's exit code. A throw during unwinding, after `next()` has already settled, is an internal error whatever class it carries: it is reported after the primary outcome and turns a would-be 0 into 1, the way a view failure does. The primary outcome keeps its code.

```ts
// src/middleware.ts, loaded only when --help or -h is supplied
import type { Middleware } from '@loomcli/core';

import type { help } from './plugin.js';
import { helpPage } from './views.js';

const middleware: Middleware<typeof help> = ({ command, graph, out }) => out.render({ command, graph }, helpPage);

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

A middleware declares what activates it, and there is no default. `activate` is a list of the plugin's own option names, or `'always'`. With a list, the middleware runs when any listed option is present in the invocation; present means supplied as a token, in any spelling including a negative Boolean form, so a declared default never activates anything. With `'always'`, the middleware runs on every invocation that reaches the chain.

Activation is evaluated from the pre-scan core has already run, before any middleware module loads. Core calls `load` only for a middleware whose activation matched and only when the chain reaches it, so an invocation of `jsonkit get -f doc.json` with help, version, and manifest plugins installed imports none of their middleware modules. Each plugin's entry module and the declarations it imports, its declared views included, load at install whatever the invocation. A plugin whose middleware must observe every invocation, such as a logging or color policy, declares `'always'` and pays for its module on every run that reaches it; a plugin that only acts on a request declares the options that make the request. The plugin author chooses, and the choice is visible in the descriptor.

An activation name that is not one of the plugin's declared options is a compile error when the plugin declares options, because the list is typed from the declaration. Build applies the same rule for JavaScript authors and for a plugin that declares no options at all, and it also rejects a middleware without `activate`, an empty list, and a middleware without `load`. A local option a plugin's `onCommandAttach` hook declared is not one of the plugin's options and cannot activate it: a middleware that reads such an option declares `'always'`, as the [formatter](#formatter) does. A `load` that throws, rejects, or resolves to a module with no default middleware function, is an internal error with code 1.

### Lifecycle hooks

A lifecycle hook is a function on the plugin definition that core calls at one named point of an Application's life. Its name is `on` followed by the event, with the subject where it carries meaning: `onCommandAttach` now, `onLog` later. A hook runs in sequence at its point; middleware wraps an invocation and keeps its name for that reason. Contributions from a middleware into an action's context and a hook after the action are direction, not contract, and wait for a plugin that needs them.

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

The hook includes the declared default in its description, as specified by the [help restyle](#help-and-version-restyle), and leaves the view names to the help page's [accepted values](#accepted-values), which read them from the option's schema.

- **When.** Graph build, once per Command, the root first and then each child depth first in authoring order; for each Command, every installed plugin's hook in installation order, each receiving what the previous returned. Core resolves each result record under [Result build errors](#result-build-errors) before the hooks, so `result` is exact, and runs those rules again over what the hooks returned. A hook is synchronous and costs one call per Command on every build.
- **What it receives.** The declaration unlocked, with its types erased: the facts `inspect()` publishes, including the extension values, and the four calls above. Each call returns a new value whose facts include what the call added, so `result.views` inside the hook lists the names the hook's own earlier calls appended. `extensions` is the record `inspect()` would publish for the Command at that hook: the author's layers, then every value an earlier hook or this hook's earlier `extend()` calls added, each validated and frozen. `readExtension` reads it through a Command-target descriptor, as it reads a `CommandNode`. Build validates a Command's author layers before the first hook runs on that Command, so a hook never reads an unvalidated value, and an invalid value the author declared on a Command is reported before any hook runs on it. A value passed to `extend()` is validated at the call: every rule under [Plugin build errors](#plugin-build-errors) that applies to a declaration's `extensions` applies there too, and it throws its `DeclarationError` from the call, which reports as itself. A hook that catches the throw continues, and the rejected value is not added. Only the value a hook returns carries its `extend()` values into the build, so a descriptor used in a call that threw, or in a value the hook discarded, registers nothing. Build stores the output validated at the call and runs no schema twice. The root arrives through the same surface with `name` `null`; `option()` on it declares a root-local option, and nothing declares a global. `result()`, `rows()`, `alias()`, `command()`, and `action()` are not published, because each changes what the action was compiled against or the graph's shape.
- **What it returns.** The value it received or one derived from it by those calls. Build rejects a hook that is not a function, one that returns anything else, and one that throws, under [Plugin build errors](#plugin-build-errors); a thrown `DeclarationError` reports as itself.
- **Types.** Nothing a hook adds reaches the action's types: a hook-declared option is in `options` at run time and absent from the typed `options`, and a middleware reads it through `request`, which is untyped for that reason. A rule the types reject for an author is reached by a hook's erased call and reported at build as it is for a JavaScript author.
- **Rules.** A hook's calls are exempt from the four closures `action()` applies, to arguments, options, aliases, and children, and from nothing else. An input a hook declares whose key or spelling the Command, the Application's globals, another plugin's options, or another plugin's hook already use is the hook-collision error, naming the plugin and the Command; the rule reads across kinds, so a hook-declared argument collides with an option and a hook-declared option collides with an argument. `arguments` and `options` show the Command's own names, so a hook sees that case before it causes it, and the other three surface at build. Hooks compose in sequence, not first-in-wins: a later hook sees and can replace what an earlier one added, `views()` by name included, except that a value of a [collecting extension](#collecting-extensions) joins the values before it and replaces none of them.
- **Names.** `AttachedCommand`, `CommandAttachHook`, and `ResultView` are exported. The private build handle the command module spells `AttachedCommand` today is renamed with the increment.

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


An extension is a typed fact a plugin defines and a declaration carries. `extension(identity, config)` returns a descriptor that is also a factory: calling it with a value returns a branded extension value, `ExtensionValue<Target>`, and a declaration lists those values under `extensions` in its config object. The key is overloaded on purpose: a plugin's own `extensions` lists the descriptors it defines, and every declaration's `extensions` lists the values those descriptors produce. An extension names one target, `'command'`, `'option'`, or `'argument'`, and one Standard Schema for its value. Each config object takes the values for its own target: `ApplicationOptions` and `CommandOptions` take `ExtensionValue<'command'>`, `StringOption` and `BooleanOption` take `ExtensionValue<'option'>`, on a global option declaration and on a plugin option alike, and `ArgumentConfig` takes `ExtensionValue<'argument'>`.

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

An extension value is keyed by its extension's identity and branded with its target, so it needs no field name and collides with no core key, and a value on the wrong target is a compile error at the config object. The call is typed from the schema's input type, so an unresolved descriptor or an ill-typed value fails to compile; identity strings and the remaining rules are checked at build. The value carries the input the author supplied and a private reference to the descriptor that produced it. Build validates the input once against the descriptor's schema, which must answer synchronously, and stores a copy of the output on the graph node under the identity, frozen to any depth, the way a declared default is stored, so a later change to the author's object changes nothing. `readExtension(node, descriptor)` takes the node kind the descriptor targets, `CommandNode` or the `AttachedCommand` a [lifecycle hook](#lifecycle-hooks) receives, `OptionNode`, or `ArgumentNode`, so a read against the wrong node kind is a compile error, and returns the stored output as a deeply read-only value, or `undefined` when the node carries no value for that identity, through an ordinary descriptor; through a collecting descriptor it returns an array, as [Collecting extensions](#collecting-extensions) states. It compares the descriptor by reference with the one that produced the value and throws a `DeclarationError` when they differ, so a read never returns output another schema produced. It runs no schema.

The stored output must be plain data: `string`, finite `number`, `boolean`, `null`, arrays, and objects whose prototype is `Object.prototype` or `null` with no accessors and no non-enumerable properties, to any depth and without cycles, with `undefined` property values dropped. That is the form the node can freeze and `inspect()` can report as the projection-neutral form. A schema that produces anything else, a `Date`, a `Map`, a class instance, a `bigint`, a `symbol`, or a function, is rejected at build; a date travels as a string and a map as an array of pairs.

One identity means one descriptor. Every descriptor on a graph, whether an installed plugin defines it or a carried value references it, is compared by reference, and build rejects two distinct descriptor objects that share an identity, because a read through one would return a value another schema produced. A second copy of one plugin package in `node_modules`, installed or not, trips this rule, which is the intended signal to deduplicate. A projection that reads another plugin's facts imports that plugin's descriptor module, which is declarations alone and never its middleware, and it never imports the plugin's implementation. A plugin that supplies values to another plugin's collecting extension imports that descriptor module the same way.

Build also rejects two values of one extension in one layer, one `extensions` list or one `extend()` call, a value the schema rejects, a schema that returns a promise, and an `extensions` entry that is not an extension value.

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

- **Declaration.** `collect: true` makes an extension collecting. Without it, or with `collect: false`, the extension is ordinary and keeps the replacement rule above. `extension()` publishes `collect` as `false` when the config omits it or holds `undefined`, and otherwise as given. Build rejects a descriptor whose `collect` is neither `true` nor `false`, a hand-built descriptor with no `collect` property included.
- **Collection.** A Command keeps every value of a collecting extension it carries, in collection order: the constructor's `extensions`, then each `extend()` layer in authoring order, then each value a lifecycle hook adds, hooks in installation order and each hook's `extend()` calls in call order. A later value never replaces an earlier one, and values never merge: each is its own validated output. One layer still holds at most one value of an extension, so two values in one `extensions` list or in one `extend()` call are the two-values error. An option and an argument have one layer and no hook call reaches them, so a collecting extension on either holds no value or one.
- **Storage.** Each value is validated by the descriptor's schema and stored as plain data, as any extension output is. The declaration's record holds the frozen array of outputs under the identity, and a declaration that carries no value of the extension has no key for it.
- **Read.** Through a collecting descriptor, `readExtension` returns the array, read-only to any depth, or `[]` when the node carries no value, so a reader never branches on absence. The by-reference descriptor check is unchanged.
- **Suppliers.** An author supplies a value as with any extension. A plugin supplies values from its `onCommandAttach` hook through `extend()`, importing the declaring plugin's declarations module, and the declaring plugin need not be installed; its values are then inert, as any extension value of an uninstalled plugin is. A value names no supplier: which plugin or which layer supplied it is provenance, and neither the node nor a read reports it.

The collecting extension is proven when public APIs alone show, under Node and Bun: help's values under `manifestCommand` on textstat's root and on jsonkit's root and `get`, read through `inspect()`, and in a fixture application with no manifest plugin installed; an author's `manifestCommand` value on jsonkit's `get` collected ahead of help's; `[]` from `readExtension` on a Command that carries neither; two values in one layer rejected; values from two layers and from two hooks kept in collection order; a hook reading an author value and an earlier hook's value through `readExtension`; an invalid author value reported ahead of a hook that throws; a value a hook passes to `extend()` rejected at the call with the invalid-value diagnostic, and a hook that catches that throw continuing without the value; each value's schema called once per build; an ordinary extension still replaced across layers and across hooks; a collecting extension on an option holding one value; and a `collect` that is not a Boolean rejected at build.

### Views from plugins

A plugin's `views` list holds the views it declares and the overrides it makes, in one list, the way `extensions` holds descriptors on a plugin and values on a declaration. A declared view is the value `view(identity, definition)` returned, and listing it is what puts its identity on the graph for the duplicate rule; an override is the value `override(key, view)` returned, and it enters the resolution [Views](#views) describes: the application's overrides first, then each plugin's in installation order, then the declaring contributor's default. A plugin can override a view another plugin declares. A plugin can list an override for its own declared view, and it resolves like any other, but the declared default is the place for that function. Two overrides for one key inside one contributor are a build error; the same key overridden by the application and by a plugin, or by two plugins, resolves first-in-wins.

Overriding a plugin's view replaces its function alone: the plugin stays installed and its middleware, options, and facts are unchanged. Replacing the capability itself still means omitting the plugin and installing another, the rule the [first-party plugins](#first-party-plugins) follow.

```ts
// src/help/plugin.ts
import { plugin } from '@loomcli/core';

import { attachHelp } from './attach.js';
import { helpArgument, helpCommand, helpInput } from './extension.js';
import { helpPage } from './views.js';

export function help(): Plugin<HelpOptions> {
  return plugin(`${Package.name}/help`, {
    extensions: [helpArgument, helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
    onCommandAttach: attachHelp,
    options,
    views: [helpPage],
  });
}
```

### Signals and cancellation

Every run creates one private cancellation controller and exposes its signal to each middleware and to the action context as `signal`. Two things can abort it. A caller passes `signal` in the run options, which is the path for an embedding host or a test; core subscribes to it at run entry and honors an abort at every phase boundary from then on. Or one installed plugin claims the signals slot by listing the signals it owns, `SIGINT`, `SIGTERM`, or both, and core installs a process listener for each once the graph has built and validated, and removes it on every exit path of that run, so an Application can run again and a test leaks no listener. The slot has one owner: a second claim is a build error naming both plugins, a signal outside the closed set is a build error, and a signal claimed twice is a build error, because core installs one listener per entry. An empty list claims nothing and leaves the slot free. With no owner and no run signal, core installs nothing.

```ts
export function signals() {
  return plugin(Package.name, { signals: ['SIGINT', 'SIGTERM'] });
}
```

The first cause to abort the controller fixes the run's cancellation reason and code: 130 for `SIGINT`, 143 for `SIGTERM`, and 130 for a caller-supplied abort. A later cause changes neither. Core keeps awaiting the chain: a middleware or action already running reads `signal` and finishes on its own terms, and core never ends the process on a first signal. Core starts nothing new after cancellation: a middleware the chain has not reached and an action not yet dispatched are skipped, a loader already in flight settles and its middleware is skipped, and the entries already running unwind in order. A loader has the standing an action has: a module import cannot be aborted, so core awaits it, and a loader that never settles holds the run open exactly as an action that ignores the signal does, until the force path or a supervisor ends the process. A cancelled run resolves its cancellation code whenever it ends after graph build with no declaration or internal failure raised before the chain starts, whether or not the chain was reached; such a failure ends the run with its own code, an abort that lands during build included. A run whose caller signal is already aborted at entry still builds and validates the graph, installs no process listeners, and otherwise resolves 130 having loaded no plugin and run no middleware or action.

Work that must happen at the moment of the signal, such as restoring the cursor or leaving raw mode, belongs in a synchronous listener the plugin adds to `signal` before it changes terminal state; it runs even when the action ignores the abort. For a run with a slot owner, any process signal that arrives after the run is cancelled, by any cause, is the force path: core removes its own listeners for that run and re-raises the signal. The default disposition then ends the process with the conventional status when no other listener remains. Core does not own the process. A re-raised signal reaches every listener still installed. An embedding host's own listener sees it. A second run in the same process that owns the slot receives the original signal and the re-raise alike, and applies its own rule to each: not yet cancelled, it cancels and absorbs the signal; already cancelled, it removes its listeners and re-raises in turn. The force path is defined for one slot-owning run per process. With several, each run applies its own rule to each signal it receives: a run not yet cancelled cancels and absorbs the signal, and a cancelled run removes its listeners and re-raises, so the process ends only once no run's listener remains. When a listener outside core keeps the process alive, the run that re-raised observes no further signals and keeps awaiting the chain. An embedding host that runs several Applications in one process supplies `run({ signal })` and installs no slot owner; with no owner, core holds no listener, and a process signal has its default effect. A listener that blocks the event loop delays the second signal's handling until it yields, as it delays everything else.

The signal decides the code whatever the action did afterward, because a script that sees 0 after an interrupt carries on as if the work finished. Core aborts the private signal with a reason it owns, the exported `CancellationReason`, `{ source: 'SIGINT' | 'SIGTERM' | 'caller', cause?: unknown }`, where `cause` carries the caller's own `signal.reason` when the caller aborted, so a middleware reads `source` and never infers a signal name. An API that rejects with `signal.reason`, as `fetch` does, throws that reason itself; a thrown value that is the reason, or an error named `AbortError`, is silent. Any other failure after cancellation is rendered as usual, and the code stays the signal's. A first signal that arrives after the chain has settled, while core is rendering a failure or finishing output, still cancels the run and decides its code; a further signal in that window changes the code no further, and for a slot owner the force path still applies until `run()` resolves. One rule orders every code: a cancelled run, as defined above, resolves its signal's code, and a broken failure view or destination in that run is reported as text without changing it; otherwise a broken failure view or destination forces 1 over the primary outcome, the accepted view rule; otherwise the primary failure or the action decides, and a throw during unwinding turns a would-be 0 into 1.

```ts
type ExitCode = 0 | 1 | 2 | 130 | 143;
```

The published `ExitCode` type widens from `0 | 1 | 2`, so a consumer that switches exhaustively on it gains two cases.

### Plugin build errors

Every rule below applies in `inspect()` and `run()` alike and returns code 1 through `run()`. Nineteen of them reach JavaScript authors alone, because the types already reject the declaration: every shape rule on the `plugins` slot and on one plugin's identity, definition, `options` record, single option declaration, `middleware` object, `onCommandAttach` function, `extensions` list, `views` list, and `signals` list; a `views` entry that is neither a declared view nor an override, since the list is typed as `ViewContribution[]`; the two `extensions` rules a plugin's own list carries, a value that is not a descriptor and a descriptor with no schema; a descriptor whose `collect` is not a Boolean, since `AnyExtension` requires one; an `extensions` entry on a declaration that is not an extension value; an extension value on the wrong target, since each config object's `extensions` slot is typed by target; a signal outside the closed set, since the `signals` list is typed by that set; and a plugin option with a schema or presence rule, since `PluginOptions` omits those keys. The activation-name rule reaches a TypeScript author only for a plugin that declares no options.

| Rejected declaration                             | Diagnostic                                                                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `plugins` value that is not an array           | `The Application plugins must be an array. Supply a list of plugin values.`                                                                                                             |
| A `plugins` entry that is not a plugin           | `The Application holds a value that is not a plugin. Supply the value returned by plugin(identity, definition).`                                                                        |
| An identity installed twice                      | `The Application installs plugin "@loomcli/plugins/help" twice. Install each plugin once.`                                                                                                      |
| An empty identity                                | `A plugin declares an empty identity. Supply a nonempty string, such as the package name.`                                                                                              |
| An identity that is not a string                 | `A plugin declares an identity that is not a string. Supply a nonempty string, such as the package name.`                                                                               |
| A definition that is not an object               | `Plugin "@loomcli/plugins/help" declares a definition that is not an object. Supply { options, middleware, extensions, views }.`                                                             |
| An `options` value that is not an object         | `Plugin "@loomcli/log" declares options that are not an object. Supply a record of option declarations.`                                                                                |
| A `middleware` value that is not an object       | `Plugin "@loomcli/plugins/help" declares middleware that is not an object. Supply { activate, load }.`                                                                                          |
| An option config that is not a declaration       | `Plugin "@loomcli/log" option "level" is not an option declaration. Supply { type, ... }.`                                                                                              |
| A plugin option with a schema or presence rule   | `Plugin "@loomcli/log" option "level" declares <validate, validateOmitted, or required>. Remove it; a plugin option carries no schema or presence rule, and the middleware interprets the value.` |
| A plugin option that repeats a global key        | `Option "help" is declared by plugin "@loomcli/plugins/help" and as a global option. Rename one declaration.`                                                                                    |
| A plugin option that repeats a local key         | `Option "help" is declared by plugin "@loomcli/plugins/help" and as a local option on Command "get". Rename the local option.` A local option a plugin's hook declared reports through the hook-collision row below instead.                                                                   |
| Two plugins declaring one option key             | `Option "verbose" is declared by plugin "@loomcli/log" and plugin "@acme/trace". Install one of them or rename the option.`                                                              |
| A plugin option spelling used elsewhere          | `Option spelling "-h" is used by plugin "@loomcli/plugins/help" option "help" and the global option "host". Change one declaration.`                                                             |
| A middleware without activation                  | `Plugin "@loomcli/plugins/help" declares middleware with no activation. Supply activate: 'always' or a list of the plugin's own option names.`                                                   |
| An empty activation list                         | `Plugin "@loomcli/plugins/help" declares middleware with an empty activation list. Name at least one of the plugin's options or use 'always'.`                                                   |
| An activation naming an undeclared option        | `Plugin "@loomcli/plugins/help" activates middleware on option "hlep", which it does not declare. Name one of the plugin's own options.`                                                         |
| A middleware without a loader                    | `Plugin "@loomcli/plugins/help" declares middleware with no load function. Supply load: () => import('./middleware.js').`                                                                       |
| A second claim on the signals slot               | `Plugin "@acme/trace" claims the signals slot, which plugin "@loomcli/signals" already holds. Install one owner.`                                                                       |
| A signal outside the closed set                  | `Plugin "@loomcli/signals" claims signal "SIGHUP". Claim SIGINT or SIGTERM.`                                                                                                             |
| A signal claimed twice                           | `Plugin "@loomcli/signals" claims signal "SIGINT" twice. Claim each signal once.`                                                                                                        |
| A plugin `extensions` entry that is not a descriptor | `Plugin "@loomcli/plugins/help" holds a value that is not an extension. Supply the value returned by extension(identity, config).`                                                          |
| An `extensions` entry that is not an extension   | `Command "get" holds a value that is not an extension value. Supply the value returned by calling an extension.`                                                                        |
| A descriptor that declares no schema             | `Command "get" holds extension "@loomcli/plugins/help/command", which declares no schema. Supply a Standard Schema v1 object that answers synchronously.`                                       |
| A descriptor whose `collect` is not a Boolean    | `Extension "@acme/notes/command" declares collect that is not a Boolean. Supply true or false, or build the descriptor with extension(identity, config).` |
| An extension value on the wrong target           | `Command "get" holds extension "@loomcli/plugins/help/input", which applies to options. Supply an extension that applies to Commands.`                                                          |
| Two values of one extension in one layer         | `Command "get" holds extension "@loomcli/plugins/help/command" twice. Supply one value.`                                                                                                         |
| Two descriptors sharing one identity             | `Extension "@loomcli/plugins/help/command" is defined twice. Install one copy of the package that defines it.`                                                                                   |
| An extension value its schema rejects            | `Command "get" holds an invalid "@loomcli/plugins/help/command" value: <issue message>. Correct the value.` Core adds the full stop after the message only when the message carries none, so a schema message that ends with its own is not doubled.                                                                                      |
| An extension schema that answers asynchronously  | `Extension "@loomcli/plugins/help/command" validates asynchronously. Supply a schema that answers synchronously.`                                                                                |
| An extension output that is not plain data       | `Extension "@loomcli/plugins/help/command" produced a value that is not plain data on Command "get". Return strings, numbers, booleans, null, arrays, and plain objects.`                       |
| A `views` value that is not an array             | `Plugin "@loomcli/plugins/help" declares views that are not an array. Supply a list of declared views and override values.`                                                                    |
| A `views` entry that is neither a view nor an override | `Plugin "@loomcli/plugins/help" holds a value that is not a view. Supply the value returned by view(identity, definition) or override(key, view).`                                          |
| Two distinct objects sharing one view identity   | `View "@loomcli/plugins/help/page" is declared by two distinct objects. Install one copy of the package that declares it.` A plugin's override key from a second copy of a package reports the same sentence.                                                                                        |
| An `extensions` value that is not an array       | `Plugin "@loomcli/plugins/help" declares extensions that are not an array. Supply a list of extension descriptors.`                                                                             |
| A `signals` value that is not an array           | `Plugin "@loomcli/signals" declares signals that are not an array. Supply a list of signal names.`                                                                                       |
| A plugin overriding one key twice                | `Plugin "@loomcli/plugins/help" overrides the view for "InputError" twice. Remove one override.` For a declared view the sentence reads `Plugin "@acme/brand" overrides view "@loomcli/plugins/help/page" twice. Remove one override.`                                                                                                |
| A hook that is not a function                    | `Plugin "@loomcli/plugins/format" declares onCommandAttach that is not a function. Supply a function of the Command.`                                                                                    |
| A hook that returns something else               | `Plugin "@loomcli/plugins/format" returned a value that is not the attached Command from onCommandAttach for Command "count". Return the value it received or a value derived from it.`                  |
| A hook that throws                               | `Plugin "@loomcli/plugins/format" failed in onCommandAttach for Command "count": <reason>.` A thrown `DeclarationError` reports as itself instead.                                                        |
| A hook-declared input that collides              | `Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as a local option. Rename the Command's option or omit the plugin.` A hook-declared argument reports the same way, `declares argument "tag"` in place of `declares option "format"`. The clause after "declared as" names what it collides with, one set shared by both kinds of hook-declared input: `a local option`, `a global option`, `an option of plugin "@acme/out"`, `an option plugin "@acme/out" declared through onCommandAttach`, `an argument`, or `an argument plugin "@acme/out" declared through onCommandAttach`. The remedy follows the target alone, whichever kind the hook declared: `Rename the Command's option or omit the plugin.` against a local option, `Rename the Command's argument or omit the plugin.` against an argument, `Rename the global option or omit the plugin.` against a global option, and `Install one of them.` against another plugin's input, whether the globals table holds the option or an earlier hook declared the option or the argument. A spelling collision reads `declares option "format" with spelling "-f" on Command "count", which "--file" already uses.` |

An `extensions` fault on the Application names the root Command, the declaration that carries the value, so it reads `The root Command holds ...`. A schema that throws where it is called rejected the value the only way it could, so it reports through the invalid-value row with the thrown reason as its message.

Six faults surface at invocation time rather than build, as internal errors with code 1: `Loading plugin "@loomcli/plugins/help" failed: <reason>` when `load` throws or rejects, with `the module exports no default middleware function.` as the reason when the loader resolves to a module that exports no default middleware function, `Plugin "@loomcli/plugins/help" called next() twice.`, `Plugin "@loomcli/plugins/help" called next() after its middleware returned.`, `Plugin "@loomcli/plugins/format" selected view "yaml", which Command "count" does not name.` when a middleware assigned `view` a name the routed Command's record does not hold, `Plugin "@loomcli/plugins/format" selected a view that is not a string on Command "count".` when the value assigned is not a string, and `Plugin "@loomcli/plugins/format" selected view "json" on Command "get", which declares no result.` The no-result sentence wins when both apply. The three `view` faults are raised at the dispatch boundary, and a takeover or a cancellation that never lets the chain reach it leaves a bad assignment unobserved. A typed read through a descriptor that did not produce the stored value throws a `DeclarationError`, `Extension "@loomcli/plugins/help/command" was read through a descriptor that did not define the stored value. Install one copy of the package that defines it.`, which the failure path reports with code 1 when it happens inside a run.

### Example coverage

The plugin increment is proven when both example applications install a plugin through `plugins` and public APIs alone. The acceptance tests cover the seam with in-repository fixture plugins rather than a published package: one with option-activated middleware whose implementation module records its own evaluation, so a test shows the module is never loaded on an invocation that does not supply its option and never loaded when an earlier middleware takes over; one with always-on middleware that wraps `next()` and observes each outcome value; one whose loader is pending when a caller abort lands, so a test shows the run resolves 130 once the loader settles and the middleware never runs; one that claims the signals slot, with a second claimant failing at build and no listener surviving a run; and one that defines an extension both examples attach to a Command. The first-party help and version plugins are specified in [First-party plugins](#first-party-plugins) and land after the seam exists.

## First-party plugins

`@loomcli/plugins` is the plugin pack: the one first-party package that ships every first-party plugin as its own subpath export, `@loomcli/plugins/<plugin>`. Each one is an ordinary plugin under the [contract above](#plugins): an entry module with the annotated factory at the subpath and the exported options type when it declares options, an extension module of declarations alone at `<subpath>/extension` when the plugin defines facts, a views module at `<subpath>/views` when it declares views, and a middleware module the entry loads lazily when the plugin acts on an invocation. A plugin's identity is `${Package.name}/<plugin>`, the convention for a package that ships several, so the help plugin is `@loomcli/plugins/help` and its descriptors are `@loomcli/plugins/help/command` and `@loomcli/plugins/help/input`. A subpath imports nothing from a sibling subpath except the sibling's declarations module at `<subpath>/extension`, which it imports to supply values to a [collecting extension](#collecting-extensions) the sibling declares; it never imports a sibling's entry, middleware, or views module. The package has no root export, so an application that installs one plugin bundles one, plus the declarations of any collecting extension that plugin supplies, and importing the package installs nothing. The package lives at `packages/plugins` and is released at the one synchronized version every first-party library shares. The pack ships help, version, the formatter, the [manifest](#manifest), the bare `theme(mapping)` factory of [Theme plugins and typed names](#theme-plugins-and-typed-names), and the `table` and `records` pack views of [Table](#table) and [Records](#records).

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

The help and version factories take no parameters, so an application installs each as it is. A spelling a plugin reserves is a build error for an application option that uses it, under [Plugin options](#plugin-options), and the application renames its own option. No first-party plugin claims the signals slot; the theme factory claims the theme slot, which is its whole contribution. Help needs no slot of its own, because being the only help plugin is not an invariant core has to hold: the same plugin installed twice fails on its identity, a second help plugin that shares a spelling fails on the option table, and a second one with its own spellings installs beside it and takes its turn in installation order. Replacing help means omitting `help()` and installing the other plugin; restyling its page means overriding `helpPage` under [Views](#views) while `help()` stays installed. Help's page and the version line each read the graph and their plugin's own option alone, so each is a projection in the sense [Graph inspection](#graph-inspection) gives the word: it adds nothing the graph does not hold. Help's hook restates help's own facts under the manifest's collecting extension, as [Help in the manifest](#help-in-the-manifest) states, so it adds no fact the graph did not already hold. The formatter is not one: its hook adds an option and two views to the graph, and its middleware reads the request, as [Formatter](#formatter) states.

### Version

```ts
// @loomcli/plugins/version/views
import type { CommandGraph, DeclaredView } from '@loomcli/core';

export declare const versionLine: DeclaredView<CommandGraph>;
```

For an Application that declares `version: '0.2.0'`:

```text
jsonkit v0.2.0
```

- **Style.** The application name uses `style.highlight.bold`, and the version, including its `v`, uses `style.primary`. One unstyled space separates them. Each graph string is escaped before styling. The line ends with exactly one newline and adds no logo, branding glyph, or label.
- **Policy.** Core resolves these semantic styles under the existing [rendering policy](#styles-and-rendering-policy). Installing `loomTheme()` supplies copper for highlight. The version plugin requires no theme, chooses no color, and reads no host capability.

`version()` declares one Boolean option, `version`, with the short spelling `V` and the description `Print the version.`, so an invocation spells it `-V` or `--version`, and a middleware activated by it. The middleware renders one line to stdout through the plugin's declared view, `versionLine`, a `DeclaredView<CommandGraph>` exported from `@loomcli/plugins/version/views` and listed in the plugin's `views`. Its default function returns the text `<name> v<version>\n` from `graph.name` and `graph.version`, with the styling above, and the middleware calls `out.render(graph, versionLine)` and returns without calling `next()`, so the exit code is 0, nothing later in the chain runs, the action never dispatches, and a fault core held from parsing or validation is never raised. An application overrides `versionLine` to restyle the line while `version()` stays installed. An application whose manifest reads `0.2.0` prints `jsonkit v0.2.0`. When the declared version already starts with a lowercase `v`, the line carries that `v` once, so a declared `v0.2.0` prints `jsonkit v0.2.0` too; an uppercase `V` or any other first character is printed after the added `v` as declared. The rule is rendering alone, and `graph.version` holds the declared string. The middleware reads no host fact, no extension, and no option beyond its own, and the routed Command does not change the line: `jsonkit get --version` prints the same line, because the version is a fact of the Application.

`version` is never absent on the graph. An Application that omits it declares `0.0.0`, which means unversioned, so `CommandGraph.version` is a `string` and no projection branches on its absence. An explicit `0.0.0` reads the same, and core keeps no record of which one the author wrote. A declared version follows the one-line rule every core fact string follows, so the line the plugin prints is one line; core otherwise neither validates nor normalizes it.

### Help

`help()` declares one Boolean option, `help`, with the short spelling `h` and the description `Show this help.`, a middleware activated by it, the three extensions below, and the `onCommandAttach` hook of [Help in the manifest](#help-in-the-manifest). The middleware renders the [help page](#the-help-page) of the routed Command through the plugin's declared view, `helpPage`, a `DeclaredView<HelpPage>` where `HelpPage` is `{ readonly graph: CommandGraph; readonly command: CommandNode }`. It calls `out.render({ command, graph }, helpPage)` and returns without calling `next()`, so the exit code is 0. The default function derives the page content from `graph` and `command` alone and ends the page with exactly one newline. The installed view escapes raw fragments before styling, as specified by the [help restyle](#help-and-version-restyle). Stdout holds the resolved page and one line terminator. An application overrides `helpPage` to change the page while `help()` stays installed, which is the acceptance target of the registry increment; the data it receives is the graph and the routed node, a replacement owns its own escaping, layout, and newline. The restyle retains `{ graph, command }` and adds no public structured page model or builder. `jsonkit --help` renders the root, `jsonkit get --help` renders `get`, and `jsonkit cache --help` renders the `cache` group, because the group's missing-subcommand fault is held before the chain and raised at the dispatch boundary, which the takeover never reaches. An unknown command still fails in routing, so `jsonkit nope --help` reports the unknown command. A fault core held from local parsing or validation is never raised under the takeover, so `jsonkit get --help` renders while `get` is missing its required `path`, and `jsonkit select --bogus --help` renders too. Like every plugin option, `--help` is consumed at any placement before `--`, and a structure fault the pre-scan reports still ranks ahead of the chain, so `textstat -ht` is the mixed-scope short group error rather than help. There is no `jsonkit help get` form: a `help` command would share the namespace with the application's own commands, and it would be a second way to say one thing.

The page is derived from the graph by the rules below and nothing else, so a test compares the bytes of `jsonkit --help` with a page written by hand.

#### Help extensions

Three descriptors are exported from `@loomcli/plugins/help/extension`, and all are help's own facts; every other fact the page prints is a core fact. Each field is optional, and the descriptor's schema carries every rule below, so build rejects a value that breaks one the way it rejects any extension value its schema rejects. The declared view is exported from `@loomcli/plugins/help/views`, a second declarations module, because it imports the page module: the page code loads with the plugin's entry module, the descriptor module stays declarations alone, and the middleware module holds nothing but the call. A graph fact that carries a marker character prints literally. The restyle escapes raw fragments before it adds style markers, and a replacement owns that escaping obligation.

```ts
// @loomcli/plugins/help/views
import type { CommandGraph, CommandNode, DeclaredView } from '@loomcli/core';

export interface HelpPage {
	readonly graph: CommandGraph;
	readonly command: CommandNode;
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

export const helpCommand = extension(`${Package.name}/help/command`, {
  schema: z.object({
    details: prose.optional(),
    examples: z.array(z.object({ command: line, note: line.optional() })).optional(),
  }),
  target: 'command',
});
export const helpInput = extension(`${Package.name}/help/input`, {
  schema: z.object({
    accepts: line.optional(),
    placeholder: z.string().regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.').optional(),
  }),
  target: 'option',
});
export const helpArgument = extension(`${Package.name}/help/argument`, {
  schema: z.object({ accepts: line.optional() }),
  target: 'argument',
});
```

`helpCommand` targets Commands, so a Command or the Application carries it. `details` is prose the page prints after the masthead, one authored line per page line, each indented two spaces, with line breaks kept and nothing wrapped; every line of it holds a character other than whitespace, so it adds no blank line of its own to the page and no line terminator at either end. `examples` lists invocations the page prints under EXAMPLES: `command` holds the tokens after the application name as one line, and `note` is one line printed under it. `helpInput` targets options, so a local option, a global option, and a plugin option carry it. `placeholder` is the word the page shows for a string option's value, `<path>` for a `--file` declared with `placeholder: 'path'`; it holds no whitespace, and without it the page shows the option's declared name. A `placeholder` on a Boolean option is accepted and never shown, because a Boolean option takes no value. `accepts` is one line the page prints as the input's [accepted values](#accepted-values), in place of any list help would derive from the schema; an `accepts` on a Boolean option is accepted and never shown, for the same reason. `helpArgument` targets arguments and carries `accepts` alone: an argument's placeholder is its declared name, which the author already chose, and its description is a core fact. The value a projection reads back through `readExtension` is the schema's output, deeply read-only, with an omitted field absent and an explicit `undefined` dropped, as every stored extension value drops it.

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

The page rules below define content and layout. The [help and version restyle](#help-and-version-restyle) adds semantic styles without changing that structure. Output is UTF-8, and no meaning depends on styling. The page reads the routed `CommandNode`, `graph.globals`, `graph.name`, and `graph.description`, plus the help extension values those nodes carry. It reads no host facts.

The page is a sequence of blocks separated by one blank line, and no block holds a blank line of its own. A block that has nothing to show is omitted. Section titles are upper case at the left margin, and every other line is indented two spaces, so a line at the left margin is the masthead, a section title, or the closing hint and nothing else. `<name>` below is the application name, and `<path>` is the name followed by the routed path, space-separated: `jsonkit`, `jsonkit get`, or `store cache clear`. A member is visible when it is not hidden.

1. **Masthead.** `<path> · <description>`, with a space, U+00B7, and a space as the separator, or `<path>` alone when the node has no description. When the routed Command is deprecated, a second line `  Deprecated: <message>` follows in the same block.
2. **Details.** The routed node's `details`, one authored line per page line, each indented two spaces. The page view splits on the same line terminators the schema recognizes, CRLF and each single terminator, and joins with LF, so an authored CR or NEL never reaches the page.
3. **USAGE.** One line per form, each beginning with `<path>`. The action form is `<path> <arguments> <required options> [options]`: each declared argument in declaration order as `<name>` when required and `[name]` when optional, with `...` inside the brackets for a variadic, so `<path>`, `[path]`, `<files...>`, and `[files...]`; then each visible required option, the node's own in declaration order and then the globals in `graph.globals` order, as `--long <placeholder>`, or `-s <placeholder>` for a `shortOnly` option, with `...` appended for a multiple option; then `[options]`, which is always present because the help option is one. A node with an action prints the action form. A node with a visible child prints the children form, `<path> <command> [options]`, after the action form when both apply. A group whose children are all hidden prints the children form alone, because it has no other form.
4. **COMMANDS.** For a node with a visible child, one row per visible child in authoring order. The left cell is the child's name, followed by ` <command>` when the child is a group and by ` [command]` when it has an action and children. The right cell follows the right-cell rule below, with `deprecated` as its one possible fact.
5. **ARGUMENTS.** For a node with arguments, one row per argument in declaration order. The left cell is the name, and the right cell follows the right-cell rule, with `default` as its one possible fact.
6. **OPTIONS.** The routed node's visible local options in declaration order, one row each; on the root page of an Application with no children, the visible globals follow them in `graph.globals` order, in this one section. The left cell is the spellings, then ` <placeholder>` for a string option: `-f, --file <path>` with both spellings, `    --explain` with a long spelling alone, indented four spaces so the long spellings align, and `-m <metric>` for a `shortOnly` string option. A Boolean option's long spelling follows its polarity: `--total` for `positive`, `--no-total` for `negative`, and `--[no-]total` for `both`. The right cell follows the right-cell rule. A Boolean option with `negative` polarity carries the fact `default: true`, because its absent value is `true` and both of its spellings set it to `false`; the other polarities carry no default fact, because their absent value is `false`.
7. **GLOBAL OPTIONS.** On every page except the root page of an Application with no children, the visible globals in `graph.globals` order, one row each under the OPTIONS rule, so the reader sees which options belong to this Command and which reach every Command.
8. **EXAMPLES.** For a node that carries `examples`, one entry each: `$ <name> <command>`, then the note on the next line indented two more spaces.
9. **Hint.** When the page printed COMMANDS: `Run <path> <command> --help for command details.`

The right-cell rule: the description when the member has one, then, for an option or an argument that has them, its [accepted values](#accepted-values) as one sentence, then, when any fact applies, one parenthesis holding the facts that apply, comma-separated, in this order: `required`, `repeatable` for a multiple option, `default: <value>`, and `deprecated: <message>`. One space separates the description from the accepted-values sentence, and help prints both as written, adding no punctuation between them; two spaces separate the text before the parenthesis from it; a member with neither description nor accepted values has the parenthesis as its whole right cell, with no leading spaces; and a member with none of the three has no right cell. The parenthesis begins at the first `  (` that is followed by `required`, `repeatable`, `default: `, or `deprecated: `, and it ends at the closing `)` that ends the row, and `deprecated` is always the last fact, so a reader splits the earlier facts on the comma and reads the text between `deprecated: ` and that closing parenthesis as the message. The page is a rendering for a reader; a consumer that needs a fact exactly, whatever a description, an accepted-values sentence, or a default holds, reads it from `inspect()`, which is the machine surface, and that includes a deprecated message, which may itself hold a comma or a parenthesis. A default value prints as it is when it is a string, as its elements separated by a space when it is an array of strings, as `JSON.stringify` renders it for any other value JSON can represent, and as `String(value)` renders it otherwise; an explicit `undefined` default prints no default fact, and a line terminator inside a rendered default prints as its JSON escape, so a row stays one line.

Within a section the rows are two columns: the left cell is padded to the longest left cell in that section plus two spaces, and a row with no right cell has no trailing padding. The view measures terminal columns with `context.width` and pads to the widest cell with core's `pad` from [Width, padding, and multiline lanes](#width-padding-and-multiline-lanes). Markup contributes no width, and Unicode follows core's existing measurement rules. Nothing wraps, so a long row runs past the terminal width, and terminal width is not read.

The root of jsonkit has an action and six children, of which `fetch` is deprecated and `debug` and `paths` are hidden, and declares one local option, `--format`, which the [formatter](#formatter) declared on it because it declares a result, so the restyled `jsonkit --help` has this text with color and modifiers disabled:

```text
jsonkit · Read and reshape one JSON document.

  With no subcommand, jsonkit summarizes the document and its top-level keys.

USAGE
  jsonkit [options]
  jsonkit <command> [options]

COMMANDS
  get     Read one value at a path.
  keys    List the keys at a path.
  select  Keep the named fields of the document.
  fetch   Read one value at a path.  (deprecated: Use get instead.)

OPTIONS
      --format <format>  Select the output format, records by default. One of: records, json, jsonl.

GLOBAL OPTIONS
  -f, --file <path>  The document to read. Omit it to read piped text.
  -h, --help         Show this help.
  -V, --version      Print the version.
      --manifest     Print this command's manifest as JSON.
      --explain      Explain the selected command and exit.

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
  -h, --help         Show this help.
  -V, --version      Print the version.
      --manifest     Print this command's manifest as JSON.
      --explain      Explain the selected command and exit.
```

textstat is one root Command with a variadic argument, five local options, of which `--minimum` is deprecated and `--timing` is hidden, a sixth local option `--format` that the [formatter](#formatter) declared on it because it declares a result, and no children, so its page folds the globals into OPTIONS. The restyled `textstat --help` has this text with color and modifiers disabled:

```text
textstat · Count bytes, words, or lines across text sources.

  With no files, textstat counts the text piped to it and names the source "stdin".

USAGE
  textstat [files...] [options]

ARGUMENTS
  files  The files to count. Omit them to read piped text.

OPTIONS
  -m, --metric <metric>        What each row counts. One of: bytes, words, lines.  (default: bytes)
      --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0)
      --minimum <minimum>      Drop a source smaller than this many bytes. The larger threshold wins.  (deprecated: Use --min-bytes instead.)
  -t, --total                  Add a total row.
      --format <format>        Select the output format, table by default. One of: table, json, jsonl.
  -h, --help                   Show this help.
  -V, --version                Print the version.
      --manifest               Print this command's manifest as JSON.
      --explain                Explain the selected command and exit.

EXAMPLES
  $ textstat one.txt two.txt
  $ textstat --metric words --total *.md
```

The deprecated child `fetch` carries its message as the last fact of its row, and its own page opens with `jsonkit fetch · Read one value at a path.` followed by `  Deprecated: Use get instead.`. The hidden child `debug` appears on no page above, and `jsonkit debug --help` prints its own page like any other. A group child `cache` with the description `Manage the cache.` would add the row `cache <command>  Manage the cache.`.

#### Accepted values

```text
OPTIONS
  -m, --metric <metric>        What each row counts. One of: bytes, words, lines.  (default: bytes)
      --format <format>        Select the output format, table by default. One of: table, json, jsonl.
```

An option or an argument row states the values the input accepts, so a reader chooses a valid value before the first run rather than learning it from a validation error. The sentence sits in the right cell after the description and before the facts, under the right-cell rule.

- **Authored.** An `accepts` value on the input's help extension, `helpInput` for an option and `helpArgument` for an argument, is the sentence, printed as written. It always wins, whatever the input's schema holds, so an author states a pattern, a range, or a long set in their own words. An `accepts` on a Boolean option is never shown.
- **Derived.** Without `accepts`, help derives the sentence from the input's [input schema](#input-schema) when that schema is a closed set of strings: an `enum` whose members are all strings, a single string `const`, or an `anyOf` whose members are each such an `enum` or `const`, flattened in order, and for a multiple option or a variadic argument the same shapes under `items`, because each token must be one of the values. Help reads `enum`, `const`, and `anyOf` at the schema's top level, or under `items` for a collection, and derives nothing when more than one of the three sits at the same level. Every other keyword beside them must leave each listed value accepted, so help derives only when each one is `type: 'string'` or an annotation, `$schema`, `$id`, `$comment`, `title`, `description`, `default`, `examples`, `readOnly`, `writeOnly`, or `deprecated`, and the same holds inside each `anyOf` member. Any other keyword, such as `pattern`, `minLength`, `format`, or `not`, may narrow the set, so it derives nothing, and the author states the set with `accepts`. For a collection, the array level may hold only `type: 'array'`, `items`, the annotations above, and `minItems`, `maxItems`, and `uniqueItems`, which bound how many tokens are given and not which values; any other array-level keyword, such as `prefixItems` or `contains`, derives nothing. The sentence is `One of: ` followed by the values in the schema's order, separated by a comma and a space, and a closing period: `One of: bytes, words, lines.`
- **Bounds.** A value that repeats prints once, at its first place, and counts once. A set of more than eight distinct values derives nothing, and neither does an empty set, any other shape, a `null` schema, or a set holding a member that is not a string; the row then prints as it would without accepted values. A member that is not a string derives nothing because the list prints tokens exactly, and help does not decide how a token spells a number, a Boolean, or `null`.
- **Quoting.** A value that is empty or holds whitespace, a comma, a double quote, or a control character prints as its JSON string, `One of: "a b", c.`, so the list splits unambiguously. A line terminator inside it prints as its JSON escape, as a rendered default's does, so a row stays one line, and DEL and the C1 controls, which JSON leaves raw, print as their lowercase `\uXXXX` escapes, so no control character reaches the terminal. Every value is escaped before styling, as every graph string on the page is.
- **Not the manifest's.** `accepts` is help's own fact for a human reader. Help does not supply it to the [manifest](#manifest), where an agent reads the exact `schema`.

The [formatter](#formatter)'s `--format` carries the enum of its view names, so its row derives them, and the formatter's description names only the default. A Command with more than eight view names prints none of them in help; `inspect()` and the manifest still carry the enum.

Compared with the page rules before this section, the changed rules are: the right cell gains the accepted-values sentence between the description and the facts, and a member with neither description nor sentence has the parenthesis alone; `helpInput` gains `accepts`; arguments gain `helpArgument`, where no help extension targeted them before; and the formatter's description drops the view names and states the default as `Select the output format, <default> by default.`

#### Accepted values acceptance

Accepted values are proven when public APIs alone produce these results under Node and Bun:

- **Example pages.** `textstat --help` prints the `--metric` and `--format` rows shown above, and `jsonkit --help` prints `--format` with `One of: records, json, jsonl.`. The quoted pages in this document and the example applications' help and manifest goldens are re-pinned for the formatter's new description.
- **Derived shapes.** Fixture applications prove each shape the Derived rule names, a string `enum`, a single string `const`, and an `anyOf` of them, at every level it can appear: at the top level, as an `anyOf` member, and under `items` for a multiple option and a variadic argument. At each level, one case holds `type: 'string'` beside the shape and one holds an annotation such as `default`, and both still derive, and one holds a narrowing keyword, such as `pattern` or `minLength`, and derives nothing. Beside those, fixtures cover an `anyOf` mixing an `enum` member and a `const` member, flattened in order, with a value repeating across members printing once; a schema holding only a narrowing keyword such as `pattern`, with no closed set, deriving nothing; an `enum` beside a `const` or an `anyOf` at the same level deriving nothing; an array-level `prefixItems` or `contains` deriving nothing, an array-level `minItems`, `maxItems`, `uniqueItems`, `default`, or `description` still deriving, a repeated value printing once, an empty set and a nullable enum deriving nothing, eight values printing, nine deriving nothing, a set holding a number deriving nothing, and an argument row deriving from its schema.
- **Authored.** An `accepts` wins over a derived list, prints for an input with a `null` or pattern schema, prints on an argument row through `helpArgument`, and is never shown on a Boolean option.
- **Text.** A value that is empty or holds a space, a comma, a double quote, a line terminator, or a control character prints as its JSON string, a marker character in a value prints literally, and a row with no description starts its right cell with the sentence.

#### Help and version restyle

```ts
// Existing view inputs remain unchanged.
import type { CommandGraph, DeclaredView } from '@loomcli/core';
import type { HelpPage } from '@loomcli/plugins/help/views';

// Exported from @loomcli/plugins/help/views and @loomcli/plugins/version/views.
declare const helpPage: DeclaredView<HelpPage>;
declare const versionLine: DeclaredView<CommandGraph>;
```

```text
OPTIONS
      --format <format>  Select the output format, records by default. One of: records, json, jsonl.
```

- **Scope.** It changes the default help and version views and the formatter's option description. The restyle itself adds no export, extension field, theme requirement, glyph, or rendering policy; the `accepts` field and `helpArgument` arrive with [accepted values](#accepted-values). The existing help and version takeover, output destination, invocation rules, and view override identities stay unchanged.
- **Content.** The page keeps its masthead, details, usage forms, section order, filtering, row facts, examples, hint, indentation, blank lines, and final newline. The application path remains first in the masthead. Neither default view adds a framework logo or branding glyph. Available view names print as the `--format` row's [accepted values](#accepted-values), with no separate section.
- **Escaping.** Graph strings, help extension strings, and rendered default values are literal data. The view escapes each raw fragment with `style.escape` before styling or measuring it. It never escapes the completed marked page or recovers semantic fields by parsing a rendered row. Authored markup in a description or example remains literal. Existing default serialization and line-terminator escaping remain unchanged. Embedded ANSI remains subject to core's separate rendering policy.
- **Measurement.** The two-column rule uses destination-aware `context.width` and core's deferred `pad`. This replaces JavaScript string-length padding. It preserves ASCII spacing while aligning wide and combining characters under core's existing rules. Styling never changes which members or sections appear, and neither view wraps or reads terminal width.
- **Policy.** Views return semantic marked strings. The installed theme and core's destination policy determine colors and modifiers. A missing theme leaves semantic colors unmapped, while explicit bold and italic still follow modifier policy. Under automatic policy, an ordinary pipe has no style escapes. At a capable terminal, `NO_COLOR` disables color but does not disable bold or italic. Explicit policy and `FORCE_COLOR` retain their existing precedence. The plain examples disable both colors and modifiers.
- **Replacement.** `helpPage` keeps `{ graph, command }`. `versionLine` keeps `CommandGraph`. Each override replaces the whole view through the existing registry. A replacement derives its own content and owns its layout, literal-data escaping, styles, and final newline. No public section model or builder is introduced.

The default help view applies this mapping. A style named below is a member of the run-specific `style` object.

| Page part | Style |
| --- | --- |
| Masthead application path | `highlight.bold` |
| Masthead middle dot | `dim` |
| Masthead description and details | `primary` |
| Section titles | `dim` |
| Application paths, child command names, and option spellings outside authored examples | `highlight` |
| Placeholders, including their brackets and variadic suffix, and argument labels in ARGUMENTS | `dim.italic` |
| Argument forms in USAGE, `[options]`, and the `<command>` or `[command]` markers in USAGE and COMMANDS | `dim.italic` |
| Option spelling separator `,` | `dim` |
| Descriptions in right cells | `primary` |
| Accepted-values sentences in right cells | `primary` |
| Fact parentheses, fact separators, `required`, `repeatable`, and `default: <value>` | `dim` |
| `deprecated: <message>` inside a fact list | `warning` |
| The entire `Deprecated: <message>` line below a masthead, excluding indentation | `warning` |
| Example `$` prompt | `dim` |
| Application name added before an authored example | `highlight` |
| Authored example command text | `primary` |
| Example note | `dim` |
| Hint words `Run` and `for command details.` | `dim` |
| Hint application path and `--help` | `highlight` |
| Hint `<command>` | `dim.italic` |

Indentation, padding, spaces between styled parts, and newlines are unstyled. Spaces inside a styled text value retain that value's style. A placeholder's internal `...`, and the `...` after a required multiple option's placeholder, share its dim italic style. The `--[no-]name` spelling is one highlighted option spelling, not a placeholder. Deprecated rows keep their name and description styles. Only the deprecation fact uses warning, with surrounding parentheses and separators still dim. The text stays explicit when color is off, and no warning glyph is added.

Examples remain opaque authored text. The view styles only the prompt and application name it adds, the whole authored command string, and the optional note. It does not parse shell syntax or highlight individual flags inside that string.

The formatter hook sets its description to `Select the output format, <default> by default.`, where `<default>` is the result's declared default name at that hook. The view names are not in the description: the option's schema is the enum of the names, in record order after `json` and `jsonl` are appended where absent, and the page prints them as the row's [accepted values](#accepted-values). A plugin whose hook changes the default installs before `format()` for the description to reflect that choice. Later hooks do not retroactively update the description. The description is ordinary literal graph text, so the whole sentence uses the description's `primary` style. It is not the right-cell `default:` fact, and the option still declares no parser default. An omitted `--format` preserves an earlier middleware's selection. Help does not infer formatter ownership from an option name or inspect the result to synthesize this sentence. A Command without the formatter has no synthetic format row or view list.

Compared with the previously accepted help page rules, the changed rules are: semantic styling replaces unconditional plain output, column width follows core's measurement, and the formatter description adds its declared default. The version line gains the styling in [Version](#version) without changing its text. All other content and invocation rules remain in force.

#### Help and version restyle acceptance

The implementation re-pins hand-written help pages and version lines against built processes under Node and Bun, including packed-consumer coverage. Plain and themed expectations are authored independently of the rendering helpers.

- Root, leaf, group, and hybrid pages retain their content rules. Cover hidden-member filtering, a directly requested hidden Command, a group with only hidden children, omitted empty sections, and root-only folding of globals.
- Compare complete plain text for jsonkit root, jsonkit select, and textstat against the examples above. Check one final newline, no trailing row padding, required and variadic forms, Boolean polarity, short-only options, and existing default serialization.
- Pin exact themed bytes for the style mapping, including placeholders beside highlighted spellings, the accepted-values sentence, dim fact punctuation around warning deprecation, literal example flags, notes, the hint, and the version line. Cover deprecation on both a row and a routed Command's masthead.
- Cover the named theme at truecolor, 256 colors, and 16 colors, a custom token mapping, an absent theme, an ordinary pipe, and a capable terminal with `NO_COLOR`. Check modifier policy independently, including fully disabled styles. Neither view chooses a fallback color or adds a glyph.
- Use wide and combining characters in names and placeholders, plus literal style-marker data in graph facts, defaults, and help extensions. Check alignment through core's measurement, literal marker output, and no interpretation of authored example syntax.
- Check formatter view order, custom and replaced view names, an unadvertised `ndjson` alias, and a declared default other than a pack view. An earlier hook changing the default updates the description. A later hook changing it leaves the description at its formatter-hook value. With the formatter absent, help invents no selector or view list. Inspect the formatter description and the absence of a parser default, and prove omission preserves an earlier middleware's selected view.
- Check version strings with a lowercase `v`, an uppercase `V`, an omitted version, and explicit `0.0.0`. Root and routed invocations print the same application version text, and raw marker-bearing strings stay literal.
- Keep the existing help and version override, takeover, fault precedence, stdout, and exit-code coverage. A replacement sees the same graph data, owns its newline, and can render its own styles without installing a replacement plugin.

### Formatter

The formatter is `@loomcli/plugins/format`. Its factory `format()` takes no parameters, declares no option in the globals table, and claims no slot. It ships two views, `json()` and `jsonl()`, one hook that puts `--format` on every Command that declares a [result](#results), and one always-on middleware that copies a supplied name into `view`. The plugin owns the encodings and the option; core owns the selection.

```ts
// @loomcli/plugins/format
function format(): Plugin<{}>;
function json<Data>(config?: { map?: (data: Readonly<Data>) => unknown }): View<Data>;
function jsonl<Data>(config?: { map?: (data: Readonly<Data>) => unknown }): View<Data>;
```

```ts
import { Application } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { table } from '@loomcli/plugins/table';
import { version } from '@loomcli/plugins/version';

export const textstat = new Application('textstat', { plugins: [help(), version(), format()] })
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
Invalid input: Option "--format": Supply one of table, json, jsonl.
$ jsonkit get --format json user.name -f doc.json
Invalid input: Unknown option "--format". Supply a declared option; prefix a hyphenated path with "./".
```

- **Views.** `json()` and `jsonl()` are whole views: under `result<Value>` they receive the value, and under `rows<Row>` core collects the sequence and they receive the array. `map` reshapes what they receive, identity by default. They are bare pack views under [Row views](#row-views), typed by contextual typing inside a `views` record and stated, `json<Summary>()`, when hoisted or written as the second argument of `out.render`. They render as ordinary views with the plugin uninstalled, so a Command that names `json: json()` first prints JSON by default with no `--format` anywhere.
- **Bytes.** `json()` writes `JSON.stringify(mapped, null, 2)` and one newline. `jsonl()` writes one line per element when the mapped value is an array, each `JSON.stringify(element)` and one newline, and one such line otherwise; an empty array prints nothing. `toJSON` is honored and an `undefined`, function, or symbol property is dropped, as `JSON.stringify` does. A value that encodes to nothing, `undefined` at the top, or that `JSON.stringify` throws on, a `bigint` or a cycle, makes the view throw, reported through the output-view row of the [Failure contract](#failure-contract). The text is data: each view escapes it through `style.escape` and replaces every character from U+007F to U+009F with its `\uXXXX` escape, four lowercase hex digits, so nothing the [rendering policy](#rendering-policies) would strip or read as a terminal control reaches it, and applies no style, so the bytes are the same under every capability.
- **The hook.** A Command with no result is returned unchanged. On one with a result, the hook appends `json` and then `jsonl` to the `views` record where the record lacks the key, so an author's own `json: json({ map })` or `json: myView` is kept as written and the default is unchanged, then declares the local string option `format` after the author's options, with no short spelling and no default, the description `Select the output format, <default> by default.`, where `<default>` is the declared default at that hook, and a validator that accepts each key and returns the issue `Supply one of <names>.` for anything else. The validator also accepts `ndjson` and transforms it to `jsonl`, unless the record names `ndjson` itself; `ndjson` is an unadvertised alias under [Aliases](#aliases). The validator maps `ndjson` to `jsonl` before it checks the record's keys, so the option's [input schema](#input-schema) is the enum of the record's keys and the unadvertised alias stays out of it. The option is an ordinary local option in every respect: parsed at local placement, on the help page as `--format <format>` with its description and its accepted values, under `options` in `inspect()` with `scope: 'application'`, reaching the action at run time under `options.format` and absent from its types. A key or spelling collision with an option the Command, the Application, or another plugin declares is the hook-collision build error, naming the plugin and the Command, and the developer resolves it; the plugin offers no rename. A plugin whose hook adds a view installs ahead of `format()` if `--format` is to accept its name. The same order lets the description reflect a hook's changed default.
- **The middleware.** `activate: 'always'`, because a hook-declared option cannot activate it. When the routed Command declares a result and `request` holds a string under `format`, it assigns that string to `view` and calls `next()`; when the option was omitted it assigns nothing, so an earlier plugin's selection stands. A held fault leaves `request` at `null` and is raised at the dispatch boundary unless a later middleware takes over, so `--format yaml` is the validator's issue, exit 2, and `--format yaml --help` with help installed after the formatter still prints the page. `--format` on a Command with no result is the unknown-option error, and `--format` twice or with no value follows the rules every string option follows.

```ts
// src/format/middleware.ts, loaded on every invocation that reaches it
import type { Middleware } from '@loomcli/core';

import type { format } from './plugin.js';

const middleware: Middleware<typeof format> = async (context) => {
  const selected = context.request?.options.format;
  if (context.view !== null && typeof selected === 'string') {
    context.view = selected;
  }
  await context.next();
};

export default middleware;
```

#### Formatter example coverage

The formatter increment is proven when both example applications install `format()` after `help()` and `version()` and ahead of the example plugin, and public APIs alone produce the transcript above: `textstat --format json one.txt` prints the rows as one indented array with the `--timing` line still on stderr, `textstat --format jsonl one.txt` prints one line per row, `textstat one.txt` prints its table, `jsonkit paths --format jsonl -f doc.json` prints one line per `Entry`, `--format ndjson` prints the same bytes, and `--format json` prints one indented array. `textstat --help` prints the page under [The help page](#the-help-page) with its `--format` row, whose description names the declared default, as specified by the [help restyle](#help-and-version-restyle), and whose [accepted values](#accepted-values) list the view names. `inspect()` reports `['table', 'json', 'jsonl']` on textstat's root and `['list', 'table', 'json', 'jsonl']` on `paths`. The acceptance tests cover both views under both units with an empty array and with a map, a `bigint` and a top-level `undefined` as view faults, U+009B and U+001B inside a string printed as escapes under `color: 'never'` and `'always'` alike, an author-declared `json` kept with its map and position, an author-declared `ndjson` key that the alias no longer serves, `--format yaml`, `--format` on a no-result Command, `--format` twice and with no value, an omitted `--format` leaving an earlier plugin's selection in place, `--format yaml --help` printing the page, and the hook-collision error against a local, a global, and another plugin's `format`. The lifecycle cases live with the [plugin example coverage](#example-coverage-3): a fixture hook declaring an option the action reads at run time and `request` carries, the hook receiving the root, `result` and `hasAction` read from a hook, two plugins' hooks in order with the later replacing a view, each hook build error, `request` holding values on a valid invocation and `null` under a held fault and on a group, a takeover under a held fault and under a throwing validator exiting 0 with no diagnostic, an always-on wrapper ahead of help reaching help's takeover, the held fault raised at the boundary with its code and rank and ranking ahead of a bad `view`, a run cancelled inside a validator and one cancelled mid-chain resolving the signal's code, `view` starting at the default and `null` on a no-result Command, the last assignment before the boundary winning across two middleware, an assignment after the boundary changing nothing, and each `view` fault raised at the boundary and unobserved under a takeover. Each case runs under Node and Bun.

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
import type { Plugin, PluginOptions, ResultNode } from '@loomcli/core';

const options = {
  manifest: { description: "Print this command's manifest as JSON.", type: 'boolean' },
} satisfies PluginOptions;
export type ManifestOptions = typeof options;
export declare function manifest(): Plugin<ManifestOptions>;

// The document the option prints, as JSON. The package exports no type for it.
interface ManifestDocument {
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly tokens: string;
  readonly exitCodes: { readonly '0': string; readonly '1': string; readonly '2': string; readonly '130': string; readonly '143': string };
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
```

`jsonkit get --manifest` prints the document below, abridged here to its first global; the full `globals` list continues with `--help`, `--version`, `--manifest`, and `--explain`.

```json
{
  "name": "jsonkit",
  "version": "0.0.0",
  "description": "Read and reshape one JSON document.",
  "tokens": "Every input is a string token. A schema describes the value one token must satisfy, or the whole list of tokens for a multiple option or a variadic argument, and a null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.",
  "exitCodes": {
    "0": "Successful execution and core output",
    "1": "Expected action failure, internal failure, or invalid declarations",
    "2": "Invalid invocation inputs",
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
      "long": "--file",
      "short": "-f",
      "required": false,
      "multiple": false,
      "schema": null,
      "default": null
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

- **The option.** `manifest()` takes no parameters and declares one Boolean [plugin option](#plugin-options), `manifest`, with no short spelling and the description `Print this command's manifest as JSON.`, and a middleware activated by it. Like `--help`, it is consumed at any placement before `--`. It lists `manifestCommand` under its `extensions`, declares no view, and claims no slot.
- **The takeover.** The middleware prints the document for the routed Command and returns without calling `next()`, so the exit code is 0, the action never dispatches, and a fault core held from parsing or validation is never raised: a group prints its own document, and `jsonkit get --manifest` prints while `path` is missing. An unknown Command still fails in routing, so `jsonkit nope --manifest` reports the unknown command, and a pre-scan structure fault still ranks ahead of the chain. An earlier-installed middleware that takes over wins, so in the example applications `jsonkit --help --manifest` prints help and `jsonkit --version --manifest` prints the version.
- **The slice.** `command` is the routed Command's entry with its visible descendants nested under `children`, and the envelope carries the Application's `name`, `version`, `description`, and `globals`, so a slice needs no second document. At the root the slice is the whole application. A hidden Command routed to directly prints its own slice, as its help page does.
- **What a listing omits.** A hidden Command, a hidden local option, and a hidden global or plugin option are omitted, as every listing omits them. Aliases never appear. A deprecated member appears with its migration message under `deprecated`.
- **The envelope.** `name`, `version`, and `description` are the graph's. `tokens` states the token rule once, so no entry repeats it: what a schema describes, that a `null` schema means unknown, and that an example omits the application name. `exitCodes` carries the five codes with the Meaning column's text from the [Invocation](#invocation) table, code formatting removed, and names no failure class. `encodings` states what the `json` and `jsonl` view names promise under [Declaring a result](#declaring-a-result). The three statements are fixed strings, the same in every document.
- **A Command entry.** It mirrors `CommandNode` without `aliases`, `hidden`, and `extensions`, and adds `details` and `examples` from the Command's [`manifestCommand`](#manifest-extension) values: `details` holds each value's `details`, one string per value that holds one, and `examples` concatenates each value's `examples`, both in collection order. At the root, `description` is the Application's, as the graph reports it.
- **An input entry.** An argument entry mirrors `ArgumentNode` without `validated`, `validateOmitted`, and `extensions`. An option entry mirrors its `OptionNode` variant without `hidden`, `scope`, and `extensions`, and on the string variant without `validated` and `validateOmitted`, so a plugin option and an application option read alike and the document names no plugin. `validated` and `validateOmitted` describe how core runs a schema, and an agent reads `schema: null` as unknown whatever they hold. `schema` is the graph's [input schema](#input-schema), copied verbatim. `default` is `{ "value": <declared value> }`, or `null` when the input declares no default or declares `undefined`. A hook-declared option, `--format` included, is an ordinary local option entry.
- **Absence.** Every field is present in every entry. An absent scalar reads `null`, an empty list reads `[]`, and a Command with no result reads `result: null`, which is how an agent learns that `--format` is absent there.
- **Key order.** Every object the plugin builds holds its keys in the order the type block lists them. `result` holds `kind`, `views`, and `default` in that order. A `schema` object and a default value keep the key order of the graph's snapshot, as JavaScript enumerates it.
- **Bytes.** The document is `JSON.stringify(document, null, 2)` and one newline, written to stdout with no style, so the bytes are the same under every capability. The text is escaped as the formatter's `json()` escapes it: through `style.escape`, with every character from U+007F to U+009F replaced by its `\uXXXX` escape in four lowercase hex digits. A declared default or a published schema that is not plain JSON data, meaning `null`, a Boolean, a finite number, a string, or an array or plain object holding only these, fails the write: the `out.render` call rejects as the output-view row of the [Failure contract](#failure-contract) states, nothing is written, and the middleware's rejection reports `Internal error: The manifest cannot encode the default of option "--odd" as JSON. Supply a value that is null, a Boolean, a finite number, a string, or an array or plain object of these.` with code 1, as a throwing help page reports; a schema reads `the schema of option "--odd"` in the same place, and an argument reads `argument "<name>"`. A declared default is snapshotted as the author wrote it and a hand-written converter's schema keeps whatever it returned, so a `bigint`, `NaN`, a function, a `Date`, or a `Map` in either would otherwise print a value the author never declared. The middleware writes through a bare view the plugin does not declare, so no override reaches it: the document is data, as a result's `json` output is, and an application that wants another document writes its own projection.
- **Stability.** The document carries no version of its own. The Application's `version` is its only version identity. A field keeps its meaning across releases, a later fact arrives as a new field, and a consumer ignores fields it does not know.

#### Manifest extension

```ts
// src/manifest/extension.ts, the declarations module of the @loomcli/plugins/manifest subpath
import Package from '../../package.json' with { type: 'json' };
import { extension } from '@loomcli/core';
import { z } from 'zod';

// The pack's shared line and prose rules, which help's schema also uses.
import { line, prose } from '../lines.js';

export const manifestCommand = extension(`${Package.name}/manifest/command`, {
  collect: true,
  schema: z.object({
    details: prose.optional(),
    examples: z.array(z.object({ command: line, note: line.optional() })).optional(),
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

The declarations module, `@loomcli/plugins/manifest/extension`, holds the collecting extension through which the author and any plugin give a Command's entry its `details` and `examples`. It is declarations alone, apart from the plugin's entry, so help supplies values through it whether or not the manifest is installed.

- **The extension.** `manifestCommand` is a [collecting extension](#collecting-extensions) on Commands with the identity `@loomcli/plugins/manifest/command`. `details` is prose under the rule help's `details` follows: every line holds a character other than whitespace, and line breaks are kept. `examples` lists invocations: `command` holds the tokens after the application name as one line, and `note` is one line.
- **Who supplies values.** A value is meant for an agent because it lands in the manifest. The author's own value is where an instruction goes that an agent needs beyond the help page. A plugin's value holds the facts that plugin chooses to project into the manifest, as help's hook does under [Help in the manifest](#help-in-the-manifest).
- **An empty value.** A value that holds neither field is accepted and stored, and the manifest prints nothing for it.

#### Manifest acceptance

The manifest is proven when both example applications install `manifest()` after `format()` and ahead of the example plugin, and public APIs alone produce these results under Node and Bun:

- **Pinned documents.** `textstat --manifest`, `jsonkit --manifest`, and `jsonkit get --manifest` print documents compared byte for byte. `jsonkit get`'s `details` holds the author's value ahead of help's. `jsonkit fetch --manifest` shows the deprecated Command's message. `jsonkit debug --manifest` prints the hidden Command's own slice, and the root document omits it.
- **An agent-shaped run.** A process test reads `textstat --manifest` alone, builds an invocation from it by choosing `--metric` from its schema's enum and `--format json` from the result's views, runs it, and parses stdout as the `json` encoding states.
- **Help pages.** Every help page lists the `--manifest` row among its options, and the golden pages are re-pinned for it.
- **Takeover and precedence.** `jsonkit get --manifest` without its required argument prints with exit 0, and so does `--manifest` on a group in a fixture application. An unknown Command still reports its routing error. `jsonkit --help --manifest` prints help and `jsonkit --version --manifest` prints the version. A `--manifest` token after `--` is not read as the option.
- **Entries.** Fixture applications cover: a hidden option and a hidden global omitted. An explicit `default: undefined` reads `null`. Two `manifestCommand` values with `details` produce two strings in collection order, and a value with neither field adds nothing. A U+009B inside a description prints as `\u009b`. A declared `bigint`, `NaN`, or function default, and a published schema holding `NaN`, fail the write. Keys follow the type block's order, `result` included, and no version field appears.
- **Packed consumers.** A consumer installs the packed pack, imports `@loomcli/plugins/manifest` and `@loomcli/plugins/manifest/extension`, compiles against their declarations, and runs `--manifest`.

### Example coverage

The [help restyle acceptance](#help-and-version-restyle-acceptance) pins these byte comparisons with color and modifiers disabled. Separate expectations cover themed output.

The first-party increment is proven when both example applications install `help()` and `version()` from `@loomcli/plugins` through `plugins`, ahead of the example plugin so that help and version win a tie, and public APIs alone produce the pages above. The examples move the prose the pages print onto help's own descriptors: jsonkit's root and `get`, and textstat's root, carry `helpCommand` values with the `details` and `examples` the pages show, where each `command` omits the application name, and jsonkit's `--file` carries `helpInput({ placeholder: 'path' })`; the example plugin keeps its own descriptor and values, because the two are separate facts. The acceptance tests compare bytes: `jsonkit --help`, `jsonkit select --help`, and `textstat --help` print the three pages, `jsonkit get --help` prints the `get` page with its `details` and example while `path` is missing, `jsonkit select --bogus --help` prints the `select` page, `jsonkit fetch --help` prints the deprecated page and `jsonkit debug --help` the hidden one, and `jsonkit cache --help` on a nested fixture prints a group page with the children form alone and a `cache <command>` row on its parent's page. `jsonkit --version` and `jsonkit get --version` print `jsonkit v0.0.0` while the example manifests hold `0.0.0`, and an Application that omits `version` prints the same line. `jsonkit --help --version` prints help and never imports the version middleware module. Each case runs under Node and Bun, the pattern the seam's coverage set.

## Styles and rendering policy

Core exports the style helpers, rendering context, and rendering policy described below. [ADR-0027](decisions/0027-core-resolves-marked-output-and-one-theme-contribution.md) governs this seam. The named [Loom theme](#loom-theme) and [explicit color fallbacks](#explicit-color-fallbacks) are implemented under ADR-0022 and ADR-0029.

### Strings and composition

Core exports `style`, `glyph`, and `pad`. Style calls accept one string and return an ordinary string containing internal markup. Interpolation, concatenation, arrays, and `join()` work without a wrapper type or a conversion step.

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

One Application installs at most one theme plugin. A second claim on the theme slot is a build-time `DeclarationError` that names both claimants. Zero themes is valid. Without a mapping, semantic tokens inherit their enclosing style; direct colors and modifiers still work under rendering policy.

In a bare theme, an omitted or undefined mapping contributes no style. An explicitly declared custom key with an undefined value still introduces that name.

Mapping values are unapplied concrete style chains: named terminal colors, modifiers, resets, custom colors, or their combinations. A mapping cannot reference any semantic token, including a core token. For example, `highlight: style.info.bold` fails the type contract. Shared concrete chain constants are valid. Build repeats these checks for JavaScript declarations.

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

The view context supplies `width(text): number`. It resolves glyph forms for that destination, ignores styling and hyperlink envelopes, and counts Unicode terminal columns. Combining marks add no column; wide characters occupy two. Emoji sequences follow the selected Unicode width implementation. Ambiguous-width characters count as one column. Measurement and padding use `@rockorager/uucode` 2.2.1 with bundled Unicode 17 data, pinned in the manifest and lockfile. It does not promise identical font rendering in every terminal.

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
