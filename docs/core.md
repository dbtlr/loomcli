---
description: Public SDK, invocation phases, host capture, rendered and semantic output, the view registry, the failure classes and their views, and the plugin contract for named commands with global and local options, Standard Schema validation, passthrough, middleware, extensions, and cancellation.
---

# Core reference

Core resolves marked strings under a destination-aware [rendering policy](#styles-and-rendering-policy). The [view registry](#views) is implemented under accepted ADR-0021: the package exports `view`, `override`, `lanes`, `View`, and `ViewContext`, and the retired `failures`, `renderFailure`, `FailureRenderer`, `Renderer`, and `RendererContext` are gone. The named Loom palette remains a separate proposed increment. The results lane under [Results](#results) is implemented under accepted ADR-0023: `result()`, `rows()`, and `views()` are authoring calls, `out.results` is on every channel, and the package exports `RowView`, `DeclaredRowView`, `ResultError`, and `incompleteResult`.

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

Routing then reads the remaining bare tokens from the root downward. A bare token that matches a child's name, or one of its [aliases](#aliases), descends into that child. A bare token that matches no child, while the current Command has children, is an unknown-command error that lists the children's canonical names. The first hyphen token commits to the current Command. Later bare tokens are positional inputs for that Command, so a root with children reports that it accepts no arguments. A commit to a group is an input error, because a group registers no action of its own. That error ranks with the routing errors above, before any local parsing, and it is judged after the [middleware](#middleware) chain, so a plugin can take over a group invocation before the error is raised.

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

Authoring calls collect declarations; core validates them during `run()` and `inspect()`, before either one reads or dispatches any invocation token. This covers the globals table, every Command's spellings, every declared default, the view overrides, the options object's own shape, the order of the declaration calls, every result declaration, whose rules are listed under [Result build errors](#result-build-errors), and every installed plugin's declarations, whose rules are listed under [Plugin build errors](#plugin-build-errors). Each rule below returns code 1 and names both sides with a correction. Many reach JavaScript authors alone, because the types already reject the invalid declaration: arguments beside children in either declaration order, a local option that repeats a global option's key, a Command with several actions, an attached value that is not a Command, constructor options that contain a retired `globals` or `failures` property, a `views` entry that is not an `override` value, an argument, option, or alias declared after the action, a child attached after the action, an `alias()` call with no names, a global option declared after Command attachment or action registration, a version that is not a string, a description that is not a string, a `hidden` value that is not a Boolean, and a `deprecated` value that is not a string. The rest surface only at build time, for TypeScript and JavaScript authors alike: a description that is blank or holds a line terminator, a deprecated message that is blank or holds a line terminator, a version that is blank or holds a line terminator, a `hidden` or `deprecated` fact on the root or on an argument, two children with one name, a Command value attached under two parents, an invalid child name, an alias that repeats a name or alias under the same parent, an alias that repeats its own Command's name or another of its aliases, an invalid alias name, an invalid argument name, a global and a local option that share one spelling, a Command with neither children nor an action, a local option on a group, a variadic argument that is not last, two view overrides for one key inside one contributor, since the same key overridden across contributors resolves first-in-wins, an override key whose identity a distinct declared-view object already carries, an options slot on the Application or on a Command holding a value that is not a plain object even when it satisfies the options type structurally, and the two argument-order rules below. Build applies every rule at every depth, and a diagnostic names the Command that holds the fault. [`inspect()`](#graph-inspection) applies every one of these rules, and every rule a single declaration carries, so the only fault it leaves to `run()` is a declared default that its schema rejects.

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
| A global and a local option with one key                | `Option "file" is declared as a global option and as a local option on Command "get". Rename the local option.`                                                                                                                                                            |
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

A validator that throws, rejects its promise, or returns a malformed result produces a developer error with exit code 1. Its diagnostic identifies the affected input and asks the author to fix the validator. Validation stops immediately and the action does not run. This failure is distinct from returned operator-input issues.

### Example coverage

[textstat](../examples/textstat/src/application.ts) declares `metric` with a Zod enum and the default `'bytes'`. Its `min-bytes` schema transforms decimal digits into a non-negative safe integer with default `'0'`. `--minimum` is the deprecated spelling of the same threshold: it shares `min-bytes`'s schema and carries no default of its own, and when both are supplied the larger of the two thresholds applies. `--timing` is a hidden Boolean; when set, the action writes one `elapsed: <n>ms` line to stderr after the rows. The action uses the inferred values directly. It keeps a row for each source at or above the byte threshold and totals only retained sources. A selection the threshold filters entirely still prints the header, and a `total` row of zero when the invocation asked for one.

`files` is an optional variadic argument with a custom Standard Schema. Its validator reads the validation context: a nonempty list passes, and an empty list passes only when the invocation phase reports that `host.terminal.stdin.isTTY` is false. Otherwise it returns the issue `Supply file arguments or pipe text to stdin.`, which core reports as an input error. The action never reads the terminal. It counts each supplied file, or `host.stdin` when no file is supplied, and prints the row name `stdin` for the piped text. Every source is counted incrementally over its chunks, so a word or a multibyte character that a chunk boundary splits is counted once.

[jsonkit](../examples/jsonkit/src/application.ts) declares the same rule for one scalar. Its global `--file` carries a hand-written schema and `validateOmitted: true`, so the rule reads omission too. A supplied path passes unchanged. Omission passes only when the invocation phase reports that `host.terminal.stdin.isTTY` is false; otherwise the schema returns the issue `Supply a file or pipe JSON to stdin.`, so a terminal invocation with no file fails with code 2 before any action runs. The application overrides the `InputError` view, so the operator reads `jsonkit: --file: Supply a file or pipe JSON to stdin.` where core's default text would read `Invalid input: Option "--file": Supply a file or pipe JSON to stdin.` The shared reader then selects between the file and `host.stdin` and reads no terminal fact of its own.

## Graph inspection

`inspect()` returns the declared graph as plain data. It answers in every authoring state, as `run()` and `name` do, and it is synchronous. It applies every rule `run()` applies before it reads a token, in the same order, except one: it does not pass a declared default through its schema, because that call can be asynchronous. So it applies the build and structural checks, every rule a single declaration carries, such as a Boolean option with `validate`, `required: true` beside a default, and a non-Boolean `required`, `variadic`, or `validateOmitted`, and the raw shape of a default declared without a schema. A rejected declaration throws the exported `DeclarationError`, which a consumer catches by class. `run()` reports the same message as a diagnostic with exit code 1, and it alone reports a default its schema rejects. `inspect()` reads no host facts, and it caches nothing: each call builds the graph anew.

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
      readonly extensions: Readonly<Record<string, unknown>>;
    };
```

- `name` is `null` for the root, and `path` is the route from the root: `[]` for the root and `['cache', 'clear']` for a nested leaf. Children and declarations appear in authoring order.
- `aliases` holds the Command's [aliases](#aliases) in declaration order, and `[]` for the root and for a Command that declares none. A Command appears once, under its canonical name, so `path` never holds an alias. A completion or manifest consumer reads `aliases`; a help consumer omits them.
- `hidden` and `deprecated` are the core facts [Hidden and deprecated members](#hidden-and-deprecated-members) describes: `hidden` is `false` unless the declaration says `true`, and `deprecated` is the declared message or `undefined`. The root reads `hidden: false` and `deprecated: undefined`. A listing projection omits a hidden node and marks a deprecated one, and the candidate list of a routing error is a listing; routing selects and parsing binds without reading either.
- The globals appear once on the graph and never inside a `CommandNode`. A help or manifest consumer combines the two sets for display.
- Spellings are the accepted CLI forms, read from the table the parser reads. `long` is `'--dry-run'` for the declared name `dry-run` and `null` under `shortOnly`, `short` is `'-f'`, and `negative` is `'--no-total'` for `both` and `negative` polarity alone.
- Schema objects stay private. `validated` says whether a schema exists, and `validateOmitted` says whether the declaration sends its omission to that schema. `default` wraps the declared input value, so an explicit `default: undefined` reads apart from no default at all. The wrapped value is a snapshot: arrays and plain objects are copied and frozen to any depth, so a write through the graph fails and a later call reports the declared value again. Other objects are reported as they are.
- `version` is the string the Application declares, or `0.0.0` when it declares none, so it is never `undefined`. Every `description` is the core fact the declaration carries, or `undefined` when omitted. The root `CommandNode` reports the Application's description, the value `CommandGraph.description` holds, so a projection that walks nodes never special-cases the root. The graph names no plugin as the source of anything: which plugin contributed an option is provenance, and a projection describes the built product alone. An extension key carries its defining plugin's identity because that identity is the fact's name, the way a package name is part of an import, not a record of who installed what.
- `globals` holds the application's global options and every plugin option in one list, in the order the globals table holds them: the application's declarations, then each plugin's in installation order. `scope` is `'application'` for an option the application declared, global or local, and `'plugin'` for a [plugin option](#plugin-options), which reaches no action; it names no plugin. A plugin entry on the string variant always reads `required: false`, `validated: false`, and `validateOmitted: false`, so a projection does not branch on them; the Boolean variant carries none of those fields.
- `result` is `null` on a Command that declares none, and otherwise the kind, the presentation names in record order, and the default, under [Results](#results).
- `extensions` holds each [extension value](#extensions) the declaration carries, keyed by extension identity, as the frozen plain-data output of its schema. `readExtension(node, descriptor)` is the typed read; the record is the projection-neutral form.
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
6. Run the [middleware](#middleware) of each installed plugin whose activation matched, in installation order, loading each one as the chain reaches it. A middleware that takes over ends the invocation here.
7. Reject the invocation if the selected Command is a group, with the rank the routing errors have.
8. Parse the remaining tokens with that Command's own spellings.
9. Validate the globals in authoring order, then that Command's inputs in authoring order.
10. Await its action.
11. Unwind the middleware chain, finish pending core output, remove any process listeners, and set the exit status.

Error precedence follows these phases. A global structure error comes before a routing error, a routing error comes before a local structure error, and a local structure error comes before a schema issue. Unknown-command, missing-value, repetition, and unexpected-argument diagnostics return code 2.

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

The `results` row holds on a Command that declares a result, where the action's `print` and `render` move to stderr as [Results](#results) describes; on every other Command `results` takes a `never` argument and the other rows hold as written. Messages are marked strings. The five semantic methods render through core's lane views, described under [Views](#views), and append one newline. `print` has no prefix. By default the other methods add their matching glyph and one space, and indent continuation lines by the selected glyph width plus one, without repeating the glyph; that gutter belongs to the lane view, which an application can override. Semantic method identity remains distinct inside core. `out.render` is the neutral presentation call, and [Rendered output](#rendered-output) describes it.

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

A view is a pure synchronous value that turns one typed value into marked text. Its `render` function, the view function, receives the data and an immutable context with `style` and `width(text)`. It holds no output handle. Existing one-argument view functions remain valid. Escape raw data with `style.escape()` before interpolating it into authored text.

Newline ownership belongs to the write site, not to the view type. `out.render` and a failure diagnostic append nothing, so a view rendered through either owns its trailing newline. A semantic method appends one newline after its lane view, so a lane view returns none. Each write site below states which rule it follows.

`out.render(data, view)` resolves the view's marked text for its destination, stdout, or stderr from the action of a Command that declares a [result](#results), then writes it without adding a newline. The second argument is either a bare view, as below, or a [declared view](#views) that a plugin or core exported. A bare view is a presentation the action chose at the call site, and nothing can replace it. A declared view carries an identity, so an application can replace its function through `views` without touching the call site. `out.render` also accepts an iterable with a row view, the shape [Row views](#row-views) defines, and writes the sequence as the iterable yields it.

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
function override<Data>(key: DeclaredView<Data>, replacement: View<Data>): ViewOverride;
function override<Failure extends LoomError>(key: FailureClass<Failure>, replacement: View<Failure>): ViewOverride;
type ViewContribution = AnyDeclaredView | ViewOverride; // ViewOverride is opaque and branded
```

`view(identity, definition)` declares a view: an identity and its default function. The identity follows the plugin-identity convention, the package name with a suffix, so the help page is `@loomcli/plugins/help/page`; core's own views take `@loomcli/core/` as their prefix by the same convention, so the lanes are `@loomcli/core/lanes/<name>` and the incomplete-result line is `@loomcli/core/results/incomplete`. The data type is inferred from the function's first parameter when that parameter is an object type or a `readonly` array, and is stated for a primitive or a union, `view<string>(…)`, because inference runs through `Readonly<Data>`: a union parameter is either rejected or silently inferred as part of the union, so a union is always stated in full, and a view function's array parameter is always `readonly`, so a mutable array parameter is a compile error under any type argument. The value it returns satisfies `View<Data>`, so `out.render(page, helpPage)` type-checks the same way a bare view does, and the identity travels on the value. `DeclaredView` is invariant in `Data` through a private witness, so a declared view is never reassigned as a declared view of another data type, and a replacement that requires data the key does not carry is a compile error; a replacement that accepts wider data is valid, since it accepts the key's data, and a bare `View<Data>` keeps its ordinary assignability. The value is branded the way an extension value is, so a hand-built object with an `identity` field is a bare view to core: `out.render` renders it through its own function and consults no override.

The identity string reaches diagnostics and nothing else: an application never spells it, because a view is named by reference, exactly as an [extension descriptor](#extensions) is. `AnyDeclaredView` is the supertype a contribution list uses; it keeps `identity`, a view function of either shape over `never`, and the brand, and drops the invariance witness, because a list cannot carry one type parameter per element and an invariant type has no common supertype across data types. Every `DeclaredView<Data>` is assignable to it, and the shape rules on a `views` list stay type-rejected. `override` typing is compile-time alone. Core stores a replacement without a run-time witness for a declared-view key, so a JavaScript author's mismatched replacement surfaces through the output-view row of the [Failure contract](#failure-contract) when it throws.

A declared view is exported from a declarations module of the plugin that declares it, `<subpath>/views`, beside the `<subpath>/extension` module that holds its descriptors, so an application that overrides the help page imports `helpPage` from `@loomcli/plugins/help/views` and never the middleware. The two modules are separate because a declared view carries its default function and the modules it needs, while a descriptor module stays declarations alone, which is the promise a projection that imports another plugin's facts relies on. The default function loads with the entry module, which is the one cost this design accepts: a plugin's middleware module stays lazy under [Activation](#activation), and its default view functions are part of its entry cost. A view function is synchronous, so nothing inside it can wait for a lazy import; a plugin whose default function is heavy pays that cost at install, and help's page function is pure string building.

`override(key, replacement)` pairs a key with a replacement view and returns a `ViewOverride`. The key is a declared view or a failure class. Under a declared view the replacement is typed from the view's data, so a view that requires data the key does not carry is a compile error. Under a failure class, `FailureClass<Failure>` is an abstract constructor type, so `UsageError` and `LoomError` are valid keys and the replacement is typed from the class's instances, as [Failure views](#failure-views) describes. The replacement is any `View<Data>`; a declared view passed as the replacement contributes its function alone, and its own identity plays no part. An application lists its overrides under `views`; a plugin lists its declarations and its overrides together under its own `views`, as [Views from plugins](#views-from-plugins) describes. In this contract an application overrides and does not declare: `ApplicationOptions.views` is `readonly ViewOverride[]`, and an application declares no view under the results lane either, because a Command's result names bare views by presentation name, as [Results](#results) describes.

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

Resolution is one walk over one list of contributors: the application's overrides first, then each installed plugin's overrides in installation order, then the default function of the view that was declared. A declared-view key matches by reference. A failure-class key matches the thrown failure's prototype chain, most derived first, and the chain is walked in full at each contributor before the next contributor is consulted, so an application's override for `UsageError` beats a plugin's override for `InputError`. This is a deliberate correction to the 0.2.0 resolver, which merged every contributor's registrations into one class-keyed table before walking the chain, so that a plugin's more specific class won over the application's base class; the application owns its diagnostics, and installation order breaks ties among plugins alone. The write site decides the destination and a view carries none: `out.render` writes stdout, or stderr from the action of a Command that declares a [result](#results), a lane writes its own destination, and a failure writes stderr directly, never through a lane. A result's own views are reached by presentation name and carry no identity, so this walk never touches them.

Core declares the five lane views and exports them as `lanes`, one `DeclaredView<string>` per semantic method, declared as `view<string>(…)`. Each receives the original message string, line breaks and authored styles included, under the rules in [Width, padding, and multiline lanes](#width-padding-and-multiline-lanes), with the view context of the write site that called it: stderr under `out.warn`, stdout under `out.print`, and stdout under `out.render` whichever lane view it was handed, or stderr under both from the action of a Command that declares a [result](#results), so capability detection and glyph selection follow the stream the bytes reach. The default for `lanes.print` returns its message unchanged. A lane view is an ordinary declared view, so `out.render(message, lanes.print)` is legal and writes the message with no newline; the semantic method is the write site that appends one. The other four add their matching glyph and one space and indent continuation lines by the measured gutter; that gutter is the default, not a rule outside the view, so an application that overrides `lanes.warn` owns it for every `out.warn` call in the run. The semantic method appends its one newline after the view, so a lane view returns none, and an override that returns the empty string still writes one newline. The semantic method checks its argument before calling the lane view, so a non-string message is still rejected as today.

```ts
import { Application, lanes, override } from '@loomcli/core';

const app = new Application('quiet', {
  views: [override(lanes.warn, { render: (message, { style }) => style.dim(message) })],
});
```

Every identity on the graph is compared the way an extension identity is: across every declared view core exports, every declared view a plugin lists, and every declared-view key an override carries, whether or not the view is declared by an installed plugin. Two distinct objects that share one identity are a `DeclarationError` at build, so an application that imports `helpPage` from one copy of the package while the installed plugin declares it from a second copy is told to deduplicate rather than left with a silent miss, the rule a second copy of an extension descriptor already meets. An override whose identity matches no declaration is inert: it is not a build error, it applies the moment a view with that object is rendered, and it never applies otherwise. An application can therefore brand a help page ahead of installing the plugin, and a shared override list holds in an application that omits it. A failure class never meets either case, because every failure class descends from `LoomError`, core keys each class's default text function as that class's default view, which carries no identity, and an application's own subclass is answered by the chain walk at throw time.

Every view declared in this section renders one whole value in one call. A second structural shape, the row view of [Row views](#row-views), renders a sequence one row at a time through a `row` function, with optional `head` and `tail`, and `view()` declares either shape; the two are told apart by the function present, so no declaration in this section changes and no cardinality field exists.

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

[textstat](../examples/textstat/src/table.ts) holds its `Row` and `Table` types and one table view in its own module. The action collects a row per counted source and calls `out.render` once, after the last source is counted, so no core helper knows about columns and a read failure on any source leaves stdout empty. The header names the metric in upper case, then `SOURCE`. Counts right-align in a column as wide as the header or the widest count, a two-space gutter separates the columns, and the source column has no trailing padding. The total row is present only with `--total` and its source is `total`, so a selection that the byte threshold filters entirely still prints the header and one `total` row.

```text
BYTES  SOURCE
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

A result is the typed value a Command produces for its consumer, as distinct from the messages it writes about its work. The results lane is opt-in in four steps, and each step pays for itself alone: a pack view rendered inside the action with no declaration, one declared result with a default view, a formatter plugin that lets a run select another view by name, and rows that render as they arrive. Nothing in the first step needs the rest, and a Command that declares no result behaves exactly as [Output and failures](#output-and-failures) describes.

The block restates `View` from [Rendered output](#rendered-output) beside the shapes and calls this section adds. The `views()` lines describe one method whose record type and presence follow the carried result: the implementation intersects the member in where a result is carried, so a declaration with none has no `views` member at all, and it may expose one signature per call with internal dispatch where overloads would make a rejection read as a complaint about the last overload.

```ts
interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  row?: never;
}
interface RowView<Row> {
  row: (row: Readonly<Row>, index: number, context: ViewContext) => string;
  head?: (context: ViewContext) => string;
  tail?: (context: ViewContext) => string;
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

A view renders one whole value in one call, as [Rendered output](#rendered-output) defines it; where the two shapes meet, this section calls it a whole view. A row view renders a sequence one row at a time: `row` receives one row, its zero-based index, and the view context, and returns the text for that row; `head` and `tail` return the text that opens and closes the sequence, and each defaults to the empty string. Every function is pure and synchronous, holds no output handle, and owns the newlines in the text it returns, because the write site appends nothing. The two shapes are exclusive: a whole view has `render` and no `row`, a row view has `row` and no `render`, the types reject a value with both, and build rejects one a JavaScript author writes, so core never guesses. `view(identity, definition)` declares either shape, and a declared row view carries the brand and the invariance witness a declared view carries, so `override` keyed by it takes a row view under the rules of [Views](#views) unchanged; `AnyDeclaredView` and `ViewContribution` admit both shapes, as the type block there states.

`out.render` accepts a row view with an iterable, the second overload above. `out.render(rows, records)` renders `head`, then each row as the iterable yields it, then `tail`, and writes each piece in order on the call's destination. A synchronous or an asynchronous iterable is accepted. Core calls `row` for each item as it arrives, not inside the `out.render` call, and does not request the next item until the previous piece's write has completed, so a slow destination applies back-pressure to the source; a source that never ends never completes, which is the author's to avoid. The returned promise resolves when `tail` is written. A sequence call, under `out.render` with a row view or under `out.results` with either view shape, holds its place in its destination's order from the moment it is issued until its last piece is written, so a later call to the same destination, awaited or not, writes after the sequence, and the call-order rule of [Output and failures](#output-and-failures) reads at the granularity of calls. One consequence is a hazard the author owns: a source that itself writes to the sequence's destination waits behind the sequence, which waits on the source, so such a write is issued before or after the sequence or to the other destination. A pending sequence is open output: the invocation does not complete, under the rule that successful completion requires output completion, until every sequence it issued has ended. This is the first step of the lane: an action renders through a table or records view from the plugin pack with no declaration, no `--format`, and no change to its stdout.

```ts
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';

.action(async ({ out }) => {
  await out.render(rows, table({ columns: ['source', { key: 'count', header: 'Bytes', align: 'right' }] }));
  await out.render(walk(document), records({ identifier: 'path', fields: ['path', 'kind'] }));
});
```

A pack view is a configured factory, and what it returns is a bare view: it carries no identity, nothing replaces it by reference, and two calls with one configuration are two views. Its configuration is typed from the row type. When the factory call is written where a row type is already known, inside a `views` record or as the second argument of `out.render`, the row type flows in by contextual typing and a column that names a field the rows do not carry is a compile error on that string. A factory call hoisted into its own constant has no context, so it states its row type, `table<Row>({…})`, or its cell callbacks go unchecked. A `columns` or `fields` list is an ordered list whose entries are a bare key or `{ key, header?, align?, format? }`, where a bare key is `{ key }`, the list order is the column order, a header defaults to the key spelled as written, a key may appear twice, and `format` is a function that renders one cell. When the list is omitted every own key that appears in the rows is a column in first-seen order, cells stringify with `String(value)`, and an empty sequence prints nothing, because no key is known. A factory's return type names one shape, never a union of the two, so its value reaches both `out.render` overloads and a `views` record alike. Each factory's full configuration is its own plugin's contract, and so is the table's choice between a row view with declared widths and a whole view that measures every row, whether the factory renders through an inner declared view an application can override for every table at once, and whether and how the plugin publishes a configuration as a graph fact, since core sees a bare view and has nothing to key such a fact on.

#### Declaring a result

`result<Value>(declaration)` declares that the Command produces one value, and `rows<Row>(declaration)` declares that it produces a sequence of rows. Both are authoring calls on `Command` and on `Application` for its root action, both return a new value like every other authoring call, and `action()` removes both, because the action's `out.results` is typed from the declaration and an action registered before the type exists cannot be checked against it. Calling either removes the other, and a Command that declares a result must register an action, because a group can keep no promise. The type parameter is stated by the author and is the value under `result` and one row under `rows`. The result travels in the declared types beside the arguments, options, and globals, which is how `ActionHandler<typeof count>` types `out.results` in an extracted action, and the note in [Modular authoring](#modular-authoring) holds for `views()` as it holds for `extend()`: appending it inside a self-referencing initializer is circular, so an enriched value is derived from the completed declaration. The result's neutral type is `unknown`, so a library's neutral `Command` annotations and `command()` attachment keep compiling for a declaration with a result, and `views()` is published where a result is carried rather than where none is known, which the implementation's type checks prove.

```ts
// src/commands/count.ts
import { Command } from '@loomcli/core';
import { json } from '@loomcli/plugins/format';
import { table } from '@loomcli/plugins/table';

import { countFiles } from '../actions/count-files.js';
import type { Row } from '../table.js';

export const count = new Command('count')
  .argument('files', { required: true, variadic: true })
  .rows<Row>({ views: { table: table({ columns: ['source', 'count'] }), json: json() } })
  .action(countFiles);
```

`views` is a record keyed by presentation name, and its values are views in the sense [Views](#views) gives the word, reached by a name rather than by a reference. The first key is the default view, the one core renders when nothing selects another, and every key is the name a `--format` selection uses once a formatter plugin is installed, so the names are unique by construction and fixed before any such plugin exists. A key is a bare token under the rule Application names meet and is not an integer-like string, because such a key does not keep its authored position, and the record holds at least one entry. Under `result<Value>` every entry is a `View<Value>`. Under `rows<Row>` an entry is a `View<readonly Row[]>`, which core buffers the whole sequence for, or a `RowView<Row>`, which core feeds as rows arrive. Core knows no presentation name of its own, not even `text`: `json` and `jsonl` are views the formatter plugin declares as factories with an optional `map` that reshapes what the view receives before encoding. The two units receive different arguments, one row under `rows` and the whole value under `result`, and a type argument cannot tell them apart at run time, so the plugin offers one factory per unit and its contract names them. They render as ordinary views with the plugin uninstalled, and the plugin's contract states what installing it adds.

The `views()` call reshapes presentation after the fact. It is published in every state on a declaration that carries a result, and never on one that carries none, so an importing application can add a wide table or a mapped `json` to a Command it did not author without touching its action. Its record takes the shape the declaration carries, so a row view under a value result is the same compile error there as in the declaration. It merges by key: an existing key is replaced in place and keeps its position, and a new key is appended. `default` names the key that becomes the default view; a default once named persists through later calls that name none, and until one is named the first key is the default. Naming a key the record does not hold after the merge is a build error. Like `extend()`, `views()` returns a new immutable value. A result's presentation is replaced by name alone: the Application's override list reaches failures, lanes, and declared views by reference, and never a result's views, which carry no identity.

```ts
import { json } from '@loomcli/plugins/format';
import { table } from '@loomcli/plugins/table';

import { count } from './commands/count.js';
import type { Row } from './table.js';

const wide = table<Row>({ columns: ['source', 'count', { key: 'count', header: 'Share', format: share }] });
export const branded = count.views({ wide, json: json({ map: toWire }) }, { default: 'wide' });
```

The declaration is a graph fact. `inspect()` publishes `result` on every node, as [Graph inspection](#graph-inspection) lists it: `null` where none is declared, and otherwise `{ kind: 'value' | 'rows', views: readonly string[], default: string }`, the names in record order. No schema is part of the declaration; a projection that needs the shape of a result reads a fact the plugin that needs it defines.

#### Emitting a result

An action emits its result once through `out.results`. Under `result<Value>` the argument is the value, and core renders the resolved view over it and writes the text to stdout. Under `rows<Row>` the argument is any `Iterable<Row>` or `AsyncIterable<Row>`, an array included, so an action holds no opinion about whether its consumer wants a buffer or a stream. Under a row view core writes `head`, then each row's text as the source yields it, under the back-pressure and ordering rules of [Row views](#row-views), then `tail`. Under a whole view core collects every row and renders once at the end of the source, so a whole view over an unbounded source never completes, which is the author's choice and not a build error. An empty sequence still writes `head` and `tail`, and renders a whole view over an empty array. `results` is present on every `Out`, so no method is ever removed, and it accepts a value on the action's `out` of a Command that declares a result alone: on a Command with no declared result and on a middleware's `out` its argument is typed `never`, and a JavaScript caller reaches the `undeclared` or the `middleware` fault below; a call from a middleware is the `middleware` kind whatever the Command declares and whatever the action did.

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

The root Command is named `the root Command` in each sentence, as every diagnostic names it.

#### Stdout belongs to the result

On a Command that declares a result, nothing the action writes but the result reaches stdout. The action's `out` is its own channel object: `print` and `render` keep their signatures and write to stderr, decided at graph build from the declaration and never at run time from the selected view, so a script that captures stdout receives the result and nothing else the action wrote whichever presentation ran. The redirect moves the destination and the view context together, so capability detection and glyph selection follow the stream the bytes reach, `out.render(message, lanes.print)` included. `info`, `success`, `warn`, and `error` already write to stderr, and `fatal` still throws without writing. No method is removed, because an author denied a lane works around the framework rather than through it. On a Command with no declared result every method keeps the destination the table in [Output and failures](#output-and-failures) states. A middleware's `out` keeps those default destinations on every Command, so a help page rendered for a result Command still reaches stdout, and a middleware that prints to stdout after `next()` on a result Command owns what its consumer then reads.

#### A sequence that stops early

A rows sequence, under `out.results` or under `out.render` with a row view, can stop before it is complete: the source throws, the selected view's function throws or returns a non-string, under a row view mid-sequence or under a whole view once the source has ended, a write to the destination fails, the action fails while an unawaited sequence is pending, or the run is cancelled and the source then ends. In every case core stops requesting rows, writes no `tail`, and retracts nothing already written, so under a row view the rows already written stay on the call's destination, and under a whole view nothing was queued before the source ended, so the destination holds nothing from the sequence unless its one final write itself failed partway. Core then writes one line on stderr through the declared view `incompleteResult`, exported from core with the identity `@loomcli/core/results/incomplete`, over `{ path, yielded, written }`: `yielded` counts the rows the source produced before the stop, and `written` counts the rows whose text core wrote, which is zero under a whole view. The line resolves through the registry the way `out.render` output does and follows the output-view row of the [Failure contract](#failure-contract): the view owns its newline, an override that returns the empty string silences it, and an override that throws writes nothing for it and is reported as a view fault only when nothing else is primary. The line prints for zero rows too, because an empty stdout and a failed stdout must not read the same. When stderr itself has already failed, the line goes through the plain fallback path and no further.

```text
Output is incomplete: Command "count" stopped after 4 rows, 3 written.
```

What follows the line is the fault's own report, when there is one. A source that throws under an awaited call ends the invocation with that failure's exit code and its diagnostic; under a call the action did not await and had already returned from, it is a deferred fault that reports its own diagnostic and returns 1, the rule every post-settle fault follows. A view of either shape that throws or returns a non-string is the output-view fault of the [Failure contract](#failure-contract), rejection with the view's error included, so an action that awaits the call and lets a thrown failure class propagate keeps that class's code as it would for any view; the atomic rule there, nothing written for the call, is scoped to a whole view, and a row view's pieces before the fault stand. A write failure follows the destination row of the same contract, whose diagnostic is the report. An action that fails while its unawaited sequence is pending stays primary, and the sequence is stopped rather than drained. Under cancellation the code stays the signal's, a cancellation echo the source throws is silent, and a source that ends after the signal aborted, by returning or by throwing, is treated as stopped early, so a truncated result never reads as a complete one; when the source returned, the line stands alone. A failure the action raises after `out.results` resolved is an ordinary failure, and the result it already wrote stands.

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
| A presentation name that is not a bare token  | `Command "count" names view "wide table". Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.` |
| An empty views record                         | `Command "count" declares a result with no views. Name at least one view.`                                                   |
| A default that names no key                   | `Command "count" selects default view "wide", which it does not name. Name the view or select a named one.`                  |

#### Results example coverage

The results increment is proven when [textstat](../examples/textstat/src/application.ts) declares its table as `result<Table>` with its own whole view under the key `table` and prints the bytes in the [failure example coverage](#example-coverage-2) unchanged, with its `--timing` line still on stderr, and when a hidden jsonkit Command declares `rows<Entry>` over the document's paths with an application-authored row view as its default and a whole view under a second key, writes each row as an async generator yields it, and leaves a partial list and the incomplete line behind when the generator throws. The acceptance tests cover both shapes of `out.render` with a row view under a synchronous and an asynchronous iterable, `out.results` under each declaration with an array, a generator, and an async generator, back-pressure observed through a destination that delays its write callback and a source that records each request, so no second request precedes the first callback, a later `print` to the same destination landing after an unawaited sequence's last piece under a row view and under a whole view, an invocation that stays open while an unawaited sequence waits on a slow source and completes after it, `print` and `render` reaching stderr with stderr's capabilities on a result Command and stdout on a plain one, a middleware's `print` keeping stdout on a result Command, each `ResultError` kind with its exit code, its prefix, and an `undefined` cause, an `InternalError` override reaching a `ResultError`, a cancelled run with an unemitted result returning the signal's code and no missing-result diagnostic, each early stop of the previous section under a row view and under a whole view with the incomplete line carrying both counts before the report, a whole view that throws after a finite source ended, a cancelled source that returns leaving the line alone, an override of `incompleteResult` silencing it and one that throws leaving the primary report intact, an empty sequence under each view shape, `views()` replacing a key in place, appending a key, moving the default, and keeping a moved default through a later call, `inspect()` publishing the fact, and each build rule above. The positive type checks cover a declared row view in a plugin's `views` list and a library's neutral annotation and `command()` attachment of a declaration with a result. The negative type checks cover an iterable that is not the declared value passed under `result`, a value passed under `rows`, `out.results` on a Command with no result and on a middleware's `out`, a column that names a missing field through the declaration and through `out.render`, a value with both `render` and `row` in a declaration and in `views()`, a row view under `result` in a declaration and in `views()`, `result()` or `rows()` called after `action()`, and `views()` on a declaration with no result. Editor latency on `ActionHandler` over a declaration with a result is measured against the current baseline before the increment merges. Each case runs under Node and Bun.

## Plugins

Core installs no plugins. Every capability beyond authoring, graph build, invocation, host capture, output, and failures is a plugin that an Application installs explicitly, and a first-party plugin uses the same public contract as a third-party one. A plugin is a frozen value that `plugin(identity, definition)` returns. It holds declarations alone: the options it contributes, one middleware with its activation and a loader, the extensions it defines, the views it declares and overrides, and one optional claim on the signals slot. The value performs no work when it is created and no work when it is installed. An installed plugin costs its entry module and the declarations that module imports on an invocation that never reaches it; its middleware module loads only when the chain reaches it.

The optional [theme contribution](#plugindefinitiontheme-field) claims the single theme slot.

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  theme?: Theme & ThemeConstraint<Theme>;
  options?: Options;
  middleware?: {
    activate: 'always' | readonly (keyof Options & string)[];
    load: () => Promise<{ default: Middleware<Plugin<Options>> }>;
  };
  extensions?: readonly AnyExtension[];
  views?: readonly ViewContribution[];
  signals?: readonly ('SIGINT' | 'SIGTERM')[];
}
```

`Plugin<Options>` carries its options as a type parameter used in a read position alone and defaults to `Plugin<PluginOptions>`, so a `plugins` list holds plugins with different options the way `views` holds overrides for different keys. The parameter is therefore covariant, which is what lets `plugins`, `Middleware`, and `load` accept a narrower plugin; Command globals instead express a requirement on the receiving Application. `AnyExtension` is the descriptor supertype a plugin's `extensions` list uses: it publishes the identity and the target and erases both the schema and the factory call signature, because a schema-typed call signature relates only by schema identity and a list cannot name one schema per element. A descriptor is assignable to it; an extension value is not. A plugin that declares options and loads a middleware exports its options type and annotates its factory's return type. That annotation is the boundary that breaks the type cycle between the entry module, which names the middleware module in `load`, and the middleware module, which type-imports the plugin.

```ts
// src/help/plugin.ts, the entry module of the @loomcli/plugins/help subpath
import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { helpCommand, helpInput } from './extension.js';
import { helpPage } from './views.js';

const options = { help: { description: 'Show this help.', short: 'h', type: 'boolean' } } satisfies PluginOptions;
export type HelpOptions = typeof options;

export function help(): Plugin<HelpOptions> {
  return plugin(`${Package.name}/help`, {
    extensions: [helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
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

An invocation runs one chain. After the global pre-scan and routing have selected a Command, and before core checks that the Command is callable, parses its local tokens, validates, and dispatches, core runs the middleware of each installed plugin whose activation matched, in installation order. The selected Command's action terminates the chain. A middleware receives:

```ts
interface MiddlewareContext<Options extends PluginOptions> {
  readonly options: PluginOptionValues<Options>;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly host: Host;
  readonly out: Out;
  readonly signal: AbortSignal;
  readonly next: () => Promise<ChainOutcome>;
}
type ChainOutcome = 'dispatched' | 'taken-over' | 'cancelled';
type Middleware<P extends Plugin | ((...args: never[]) => Plugin)> = (
  context: MiddlewareContext<OptionsOf<P>>,
) => Promise<void> | void;
```

- `options` holds the plugin's own option values, typed from its declaration. `Middleware` accepts the plugin type or its factory's type, with or without parameters, and the exported `OptionsOf` extracts the declared options from either, so `Middleware<typeof help>` reads them from the factory's annotated return type.
- `graph` is the frozen graph `inspect()` returns, and `command` is the routed node inside it, so `jsonkit get --help` renders help for `get`, `jsonkit --help` for the root, and `jsonkit cache --help` for the `cache` group. An unknown command fails in routing before any middleware runs, as it does today. The callable check on a group keeps its rank among the routing errors but is judged after the chain, so a middleware can take over a group invocation and `jsonkit cache --verbose` still reports the missing subcommand when no middleware takes over.
- `next()` continues the invocation: the callable check, local parsing, validation, every later middleware, and the action. It resolves when the rest of the chain has settled, with `'dispatched'` when the action ran, `'taken-over'` when a later middleware returned without calling its own `next()`, and `'cancelled'` when the run was cancelled before the action ran, so a wrapping plugin knows what it wrapped. `'cancelled'` wins over `'taken-over'`, so a later middleware that returns because it saw the abort reports as cancelled, the order the exit codes follow. It rejects with the failure the rest of the chain raised. Core records that failure when it is raised, so a middleware that catches the rejection changes its own control flow and not the exit code, the rule an action's caught output rejection already follows. A later middleware that catches the failure the rest of the chain raised and returns reports to its callers as `'taken-over'` when the action never ran and `'dispatched'` when it did, and the recorded failure still decides the exit code.
- `next` is live until the middleware's own result settles. Calling it twice, or calling it after the middleware has returned, is an internal error: the call rejects and nothing is parsed or dispatched. While the run is live the fault is reported after the primary outcome and turns a would-be 0 into 1; once `run()` has resolved, the call only rejects.
- A middleware that returns without calling `next()` has taken over the invocation. The remaining tokens are never parsed, nothing later in the chain runs, and the exit code is 0 unless the middleware throws, its output fails, or the run was cancelled, under the precedence in [Signals and cancellation](#signals-and-cancellation). Because the chain runs in installation order, `jsonkit --help --version` prints help when help is installed first.
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

Activation is evaluated from the pre-scan core has already run, before any middleware module loads. Core calls `load` only for a middleware whose activation matched and only when the chain reaches it, so an invocation of `jsonkit get -f doc.json` with help, version, and manifest plugins installed imports none of their middleware modules. Each plugin's entry module and the declarations it imports, its declared views included, load at install whatever the invocation. A plugin whose middleware must observe every invocation, such as a logging or color policy, declares `'always'` and pays for its module on every run; a plugin that only acts on a request declares the options that make the request. The plugin author chooses, and the choice is visible in the descriptor.

An activation name that is not one of the plugin's declared options is a compile error when the plugin declares options, because the list is typed from the declaration. Build applies the same rule for JavaScript authors and for a plugin that declares no options at all, and it also rejects a middleware without `activate`, an empty list, and a middleware without `load`. A `load` that throws, rejects, or resolves to a module with no default middleware function, is an internal error with code 1.

### Extensions

`Command.extend(...values)` and `Application.extend(...values)` return new declarations and remain available after `action()`. They accept command-targeted extension values, including help details and examples on an imported library Command:

```ts
import { helpCommand } from '@loomcli/plugins/help/extension';
import { build } from 'command-library';

const customized = build.extend(helpCommand({ details: 'Build this application.' }));
const app = configured.command(customized);
```

Constructor `extensions` and each `extend()` call form successive layers. A later value from the same descriptor replaces its complete earlier value. Other descriptors remain. No fields merge and no arrays concatenate; schema defaults belong to the replacement output. Duplicate identities within one layer fail. Layers validate in authoring order, so replacement cannot hide an invalid earlier value or a conflicting descriptor reference. Replacement does not delete and reinsert keys; records use ordinary JavaScript object key ordering. The final record supports both inspection and `readExtension()`.

An empty call returns an equivalent new declaration. Extending preserves the action, inputs, aliases, children, core facts, Application environment, and authoring state. It never reopens input or action declarations. Core facts such as `description`, `hidden`, and `deprecated`, and option/argument extensions, retain their constructor or input-configuration rules. Hooks and events await their lifecycle design.


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

An extension value is keyed by its extension's identity and branded with its target, so it needs no field name and collides with no core key, and a value on the wrong target is a compile error at the config object. The call is typed from the schema's input type, so an unresolved descriptor or an ill-typed value fails to compile; identity strings and the remaining rules are checked at build. The value carries the input the author supplied and a private reference to the descriptor that produced it. Build validates the input once against the descriptor's schema, which must answer synchronously, and stores a copy of the output on the graph node under the identity, frozen to any depth, the way a declared default is stored, so a later change to the author's object changes nothing. `readExtension(node, descriptor)` takes the node kind the descriptor targets, `CommandNode`, `OptionNode`, or `ArgumentNode`, so a read against the wrong node kind is a compile error, and returns the stored output as a deeply read-only value, or `undefined` when the node carries no value for that identity. It compares the descriptor by reference with the one that produced the value and throws a `DeclarationError` when they differ, so a read never returns output another schema produced. It runs no schema.

The stored output must be plain data: `string`, finite `number`, `boolean`, `null`, arrays, and objects whose prototype is `Object.prototype` or `null` with no accessors and no non-enumerable properties, to any depth and without cycles, with `undefined` property values dropped. That is the form the node can freeze and `inspect()` can report as the projection-neutral form. A schema that produces anything else, a `Date`, a `Map`, a class instance, a `bigint`, a `symbol`, or a function, is rejected at build; a date travels as a string and a map as an array of pairs.

One identity means one descriptor. Every descriptor on a graph, whether an installed plugin defines it or a carried value references it, is compared by reference, and build rejects two distinct descriptor objects that share an identity, because a read through one would return a value another schema produced. A second copy of one plugin package in `node_modules`, installed or not, trips this rule, which is the intended signal to deduplicate. A projection that reads another plugin's facts imports that plugin's descriptor module, which is declarations alone and never its middleware, and it never imports the plugin's implementation.

Build also rejects two values of one extension on one declaration, a value the schema rejects, a schema that returns a promise, and an `extensions` entry that is not an extension value.

A fact whose plugin is not installed is inert for execution: no middleware acts on it, and core gives it no meaning. It still sits on the graph, `inspect()` reports it, and a projection that imports its descriptor can read it through `readExtension`. A Command library can therefore ship help facts into an application that installs no help plugin, or one that installs a different help plugin.

Core owns the facts every projection needs: `description` on the Application, on a Command, on an option, and on an argument, `version` on the Application, and `hidden` and `deprecated` on a Command and on an option, as [Hidden and deprecated members](#hidden-and-deprecated-members) describes. Each is optional in the declaration, and each states how an omitted declaration reads: `undefined` for a description and a deprecated message, `false` for `hidden`, and `0.0.0` for `version`, the one fact with a conventional sentinel for "unversioned". A description, a deprecated message, and a declared version are strings that hold a character other than whitespace and no line terminator, and `hidden` is a Boolean. Whitespace is the Unicode `White_Space` class, which covers the tab, the space, the no-break space, and every line terminator, and a line terminator is LF, VT, FF, CR, NEL, LS, or PS. They make a help page, a manifest, or a completion script minimally useful with no extension present, and an extension enriches them. A further fact of the same kind follows the same rule when it is specified, and states its own omitted reading. The convention for `version` is the package manifest's own field, as the installation example shows, so the graph and the published version stay in sync.

### Views from plugins

A plugin's `views` list holds the views it declares and the overrides it makes, in one list, the way `extensions` holds descriptors on a plugin and values on a declaration. A declared view is the value `view(identity, definition)` returned, and listing it is what puts its identity on the graph for the duplicate rule; an override is the value `override(key, view)` returned, and it enters the resolution [Views](#views) describes: the application's overrides first, then each plugin's in installation order, then the declaring contributor's default. A plugin can override a view another plugin declares. A plugin can list an override for its own declared view, and it resolves like any other, but the declared default is the place for that function. Two overrides for one key inside one contributor are a build error; the same key overridden by the application and by a plugin, or by two plugins, resolves first-in-wins.

Overriding a plugin's view is presentation replacement: the plugin stays installed and its middleware, options, and facts are unchanged. Replacing the capability itself still means omitting the plugin and installing another, the rule the [first-party plugins](#first-party-plugins) follow.

```ts
// src/help/plugin.ts
import { plugin } from '@loomcli/core';

import { helpCommand, helpInput } from './extension.js';
import { helpPage } from './views.js';

export function help(): Plugin<HelpOptions> {
  return plugin(`${Package.name}/help`, {
    extensions: [helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
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

Every rule below applies in `inspect()` and `run()` alike and returns code 1 through `run()`. Seventeen of them reach JavaScript authors alone, because the types already reject the declaration: every shape rule on the `plugins` slot and on one plugin's identity, definition, `options` record, single option declaration, `middleware` object, `extensions` list, `views` list, and `signals` list; a `views` entry that is neither a declared view nor an override, since the list is typed as `ViewContribution[]`; the two `extensions` rules a plugin's own list carries, a value that is not a descriptor and a descriptor with no schema; an `extensions` entry on a declaration that is not an extension value; an extension value on the wrong target, since each config object's `extensions` slot is typed by target; a signal outside the closed set, since the `signals` list is typed by that set; and a plugin option with a schema or presence rule, since `PluginOptions` omits those keys. The activation-name rule reaches a TypeScript author only for a plugin that declares no options.

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
| A plugin option that repeats a local key         | `Option "help" is declared by plugin "@loomcli/plugins/help" and as a local option on Command "get". Rename the local option.`                                                                   |
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
| An extension value on the wrong target           | `Command "get" holds extension "@loomcli/plugins/help/input", which applies to options. Supply an extension that applies to Commands.`                                                          |
| Two values of one extension on one declaration   | `Command "get" holds extension "@loomcli/plugins/help/command" twice. Supply one value.`                                                                                                         |
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

An `extensions` fault on the Application names the root Command, the declaration that carries the value, so it reads `The root Command holds ...`. A schema that throws where it is called rejected the value the only way it could, so it reports through the invalid-value row with the thrown reason as its message.

Three faults surface at invocation time rather than build, as internal errors with code 1: `Loading plugin "@loomcli/plugins/help" failed: <reason>` when `load` throws or rejects, with `the module exports no default middleware function.` as the reason when the loader resolves to a module that exports no default middleware function, `Plugin "@loomcli/plugins/help" called next() twice.`, and `Plugin "@loomcli/plugins/help" called next() after its middleware returned.` A typed read through a descriptor that did not produce the stored value throws a `DeclarationError`, `Extension "@loomcli/plugins/help/command" was read through a descriptor that did not define the stored value. Install one copy of the package that defines it.`, which the failure path reports with code 1 when it happens inside a run.

### Example coverage

The plugin increment is proven when both example applications install a plugin through `plugins` and public APIs alone. The acceptance tests cover the seam with in-repository fixture plugins rather than a published package: one with option-activated middleware whose implementation module records its own evaluation, so a test shows the module is never loaded on an invocation that does not supply its option and never loaded when an earlier middleware takes over; one with always-on middleware that wraps `next()` and observes each outcome value; one whose loader is pending when a caller abort lands, so a test shows the run resolves 130 once the loader settles and the middleware never runs; one that claims the signals slot, with a second claimant failing at build and no listener surviving a run; and one that defines an extension both examples attach to a Command. The first-party help and version plugins are specified in [First-party plugins](#first-party-plugins) and land after the seam exists.

## First-party plugins

`@loomcli/plugins` is the plugin pack: the one first-party package that ships every first-party plugin as its own subpath export, `@loomcli/plugins/<plugin>`. Each one is an ordinary plugin under the [contract above](#plugins): an entry module with the exported options type and the annotated factory at the subpath, an extension module of declarations alone at `<subpath>/extension` when the plugin defines facts, a views module at `<subpath>/views` when it declares views, and a middleware module the entry loads lazily. A plugin's identity is `${Package.name}/<plugin>`, the convention for a package that ships several, so the help plugin is `@loomcli/plugins/help` and its descriptors are `@loomcli/plugins/help/command` and `@loomcli/plugins/help/input`. A subpath imports nothing from a sibling subpath, and the package has no root export, so an application that installs one plugin bundles one, and importing the package installs nothing. The package lives at `packages/plugins` and is released at the one synchronized version every first-party library shares. Two plugins ship first, help and version.

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

Both factories take no parameters, so an application installs each plugin as it is. A spelling a plugin reserves is a build error for an application option that uses it, under [Plugin options](#plugin-options), and the application renames its own option. Neither plugin claims the signals slot, and neither needs a slot of its own, because being the only help plugin is not an invariant core has to hold: the same plugin installed twice fails on its identity, a second help plugin that shares a spelling fails on the option table, and a second one with its own spellings installs beside it and takes its turn in installation order. Replacing help means omitting `help()` and installing the other plugin; restyling its page means overriding `helpPage` under [Views](#views) while `help()` stays installed. Each plugin reads the graph and its own option alone, so each is a projection in the sense [Graph inspection](#graph-inspection) gives the word: it adds nothing the graph does not hold.

### Version

`version()` declares one Boolean option, `version`, with the short spelling `V` and the description `Print the version.`, so an invocation spells it `-V` or `--version`, and a middleware activated by it. The middleware renders one line to stdout through the plugin's declared view, `versionLine`, a `DeclaredView<CommandGraph>` exported from `@loomcli/plugins/version/views` and listed in the plugin's `views`. Its default function returns `<name> v<version>\n` from `graph.name` and `graph.version`, escaped the way the middleware escaped the line before this contract, and the middleware calls `out.render(graph, versionLine)` and returns without calling `next()`, so the exit code is 0 and nothing after routing runs. An application overrides `versionLine` to restyle the line while `version()` stays installed. An application whose manifest reads `0.2.0` prints `jsonkit v0.2.0`. When the declared version already starts with a lowercase `v`, the line carries that `v` once, so a declared `v0.2.0` prints `jsonkit v0.2.0` too; an uppercase `V` or any other first character is printed after the added `v` as declared. The rule is presentation alone, and `graph.version` holds the declared string. The middleware reads no host fact, no extension, and no option beyond its own, and the routed Command does not change the line: `jsonkit get --version` prints the same line, because the version is a fact of the Application.

`version` is never absent on the graph. An Application that omits it declares `0.0.0`, which means unversioned, so `CommandGraph.version` is a `string` and no projection branches on its absence. An explicit `0.0.0` reads the same, and core keeps no record of which one the author wrote. A declared version follows the one-line rule every core fact string follows, so the line the plugin prints is one line; core otherwise neither validates nor normalizes it.

### Help

`help()` declares one Boolean option, `help`, with the short spelling `h` and the description `Show this help.`, a middleware activated by it, and the two extensions below. The middleware renders the [help page](#the-help-page) of the routed Command through the plugin's declared view, `helpPage`, a `DeclaredView<HelpPage>` where `HelpPage` is `{ readonly graph: CommandGraph; readonly command: CommandNode }`. It calls `out.render({ command, graph }, helpPage)` and returns without calling `next()`, so the exit code is 0. The default function derives the page from `graph` and `command` alone, escapes it, and ends it with exactly one newline, so stdout holds the page and one line terminator, the bytes `out.print` produced before this contract. An application overrides `helpPage` to change the page while `help()` stays installed, which is the acceptance target of the registry increment; the data it receives is the graph and the routed node, a replacement owns its own escaping and newline, and a structured page model is a decision for the help restyle increment. `jsonkit --help` renders the root, `jsonkit get --help` renders `get`, and `jsonkit cache --help` renders the `cache` group, because the chain runs before the callable check. An unknown command still fails in routing, so `jsonkit nope --help` reports the unknown command. Local tokens are never parsed after the takeover, so `jsonkit get --help` renders while `get` is missing its required `path`, and `jsonkit select --bogus --help` renders too. Like every plugin option, `--help` is consumed at any placement before `--`, and a structure fault the pre-scan reports still ranks ahead of the chain, so `textstat -ht` is the mixed-scope short group error rather than help. There is no `jsonkit help get` form: a `help` command would share the namespace with the application's own commands, and it would be a second way to say one thing.

The page is derived from the graph by the rules below and nothing else, so a test compares the bytes of `jsonkit --help` with a page written by hand.

#### Help extensions

Two descriptors are exported from `@loomcli/plugins/help/extension`, and both are help's own facts; every other fact the page prints is a core fact. Each field is optional, and the descriptor's schema carries every rule below, so build rejects a value that breaks one the way it rejects any extension value its schema rejects. The declared view is exported from `@loomcli/plugins/help/views`, a second declarations module, because it imports the page module: the page code loads with the plugin's entry module, the descriptor module stays declarations alone, and the middleware module holds nothing but the call. The default function escapes the page it derives, the step the middleware performed before this contract, so a graph fact that carries a marker character prints literally; a replacement owns that escaping obligation.

```ts
// src/help/views.ts, the view declarations module of the @loomcli/plugins/help subpath
import Package from '../../package.json' with { type: 'json' };
import { view } from '@loomcli/core';
import type { CommandGraph, CommandNode } from '@loomcli/core';

import { renderPage } from './page.js';

export interface HelpPage {
  readonly graph: CommandGraph;
  readonly command: CommandNode;
}

export const helpPage = view<HelpPage>(`${Package.name}/help/page`, {
  render: ({ command, graph }, { style }) => `${style.escape(renderPage(graph, command))}\n`,
});
```

```ts
// src/help/extension.ts, the declarations module of the @loomcli/plugins/help subpath
import Package from '../../package.json' with { type: 'json' };
import { extension } from '@loomcli/core';
import { z } from 'zod';

const terminator = /[\n\v\f\r\u0085\u2028\u2029]/u;
const line = z.string().refine((value) => /\S/u.test(value) && !terminator.test(value), {
  message: 'Supply one line that holds a character other than whitespace.',
});
const prose = z.string().refine((value) => value.split(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/u).every((each) => /\S/u.test(each)), {
  message: 'Supply prose whose every line holds a character other than whitespace.',
});

export const helpCommand = extension(`${Package.name}/help/command`, {
  schema: z.object({
    details: prose.optional(),
    examples: z.array(z.object({ command: line, note: line.optional() })).optional(),
  }),
  target: 'command',
});
export const helpInput = extension(`${Package.name}/help/input`, {
  schema: z.object({ placeholder: z.string().regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.').optional() }),
  target: 'option',
});
```

`helpCommand` targets Commands, so a Command or the Application carries it. `details` is prose the page prints after the masthead, one authored line per page line, each indented two spaces, with line breaks kept and nothing wrapped; every line of it holds a character other than whitespace, so it adds no blank line of its own to the page and no line terminator at either end. `examples` lists invocations the page prints under EXAMPLES: `command` holds the tokens after the application name as one line, and `note` is one line printed under it. `helpInput` targets options, so a local option, a global option, and a plugin option carry it. `placeholder` is the word the page shows for a string option's value, `<path>` for a `--file` declared with `placeholder: 'path'`; it holds no whitespace, and without it the page shows the option's declared name. A `placeholder` on a Boolean option is accepted and never shown, because a Boolean option takes no value. Arguments carry no help extension: an argument's placeholder is its declared name, and its description is a core fact. The value a projection reads back through `readExtension` is the schema's output, deeply read-only, with an omitted field absent and an explicit `undefined` dropped, as every stored extension value drops it.

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

A projection that wants help's prose imports the descriptor module and reads the values with `readExtension`, as [Extensions](#extensions) describes, and never imports the help middleware.

#### The help page

The page is plain text on every host: no color, no glyph beyond the masthead's middle dot, and no terminal fact read, so one invocation prints the same bytes on a terminal, in a pipe, and under a test. The styling a themed view adds is a separate increment, and this page is complete without it because no meaning rides on presentation. Output is UTF-8. The page reads the routed `CommandNode`, `graph.globals`, `graph.name`, and `graph.description`, plus the help extension values those nodes carry.

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

The right-cell rule: the description when the member has one, then, when any fact applies, one parenthesis holding the facts that apply, comma-separated, in this order: `required`, `repeatable` for a multiple option, `default: <value>`, and `deprecated: <message>`. Two spaces separate a description from the parenthesis; a member with no description has the parenthesis as its whole right cell, with no leading spaces; and a member with neither description nor facts has no right cell. The parenthesis begins at the first `  (` that is followed by `required`, `repeatable`, `default: `, or `deprecated: `, and it ends at the closing `)` that ends the row, and `deprecated` is always the last fact, so a reader splits the earlier facts on the comma and reads the text between `deprecated: ` and that closing parenthesis as the message. The page is a rendering for a reader; a consumer that needs a fact exactly, whatever a description or a default holds, reads it from `inspect()`, which is the machine surface, and that includes a deprecated message, which may itself hold a comma or a parenthesis. A default value prints as it is when it is a string, as its elements separated by a space when it is an array of strings, as `JSON.stringify` renders it for any other value JSON can represent, and as `String(value)` renders it otherwise; an explicit `undefined` default prints no default fact, and a line terminator inside a rendered default prints as its JSON escape, so a row stays one line.

Within a section the rows are two columns: the left cell is padded to the longest left cell in that section plus two spaces, and a row with no right cell has no trailing padding. Nothing wraps, so a long row runs past the terminal width, and terminal width is not read.

The root of jsonkit has an action and five children, of which `fetch` is deprecated and `debug` is hidden, and declares no local option, so `jsonkit --help` prints:

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

GLOBAL OPTIONS
  -f, --file <path>  The document to read. Omit it to read piped text.
  -h, --help         Show this help.
  -V, --version      Print the version.
      --explain      Explain the selected command and exit.

EXAMPLES
  $ jsonkit -f doc.json
  $ jsonkit get user.name -f doc.json

Run jsonkit <command> --help for command details.
```

`select` is a leaf with one required multiple option and no `details` or `examples`, so `jsonkit select --help` prints:

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
      --explain      Explain the selected command and exit.
```

textstat is one root Command with a variadic argument, five local options, of which `--minimum` is deprecated and `--timing` is hidden, and no children, so its page folds the globals into OPTIONS, and `textstat --help` prints:

```text
textstat · Count bytes, words, or lines across text sources.

  With no files, textstat counts the text piped to it and names the source "stdin".

USAGE
  textstat [files...] [options]

ARGUMENTS
  files  The files to count. Omit them to read piped text.

OPTIONS
  -m, --metric <metric>        What each row counts.  (default: bytes)
      --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0)
      --minimum <minimum>      Drop a source smaller than this many bytes. The larger threshold wins.  (deprecated: Use --min-bytes instead.)
  -t, --total                  Add a total row.
  -h, --help                   Show this help.
  -V, --version                Print the version.
      --explain                Explain the selected command and exit.

EXAMPLES
  $ textstat one.txt two.txt
  $ textstat --metric words --total *.md
```

The deprecated child `fetch` carries its message as the last fact of its row, and its own page opens with `jsonkit fetch · Read one value at a path.` followed by `  Deprecated: Use get instead.`. The hidden child `debug` appears on no page above, and `jsonkit debug --help` prints its own page like any other. A group child `cache` with the description `Manage the cache.` would add the row `cache <command>  Manage the cache.`.

### Example coverage

The first-party increment is proven when both example applications install `help()` and `version()` from `@loomcli/plugins` through `plugins`, ahead of the example plugin so that help and version win a tie, and public APIs alone produce the pages above. The examples move the prose the pages print onto help's own descriptors: jsonkit's root and `get`, and textstat's root, carry `helpCommand` values with the `details` and `examples` the pages show, where each `command` omits the application name, and jsonkit's `--file` carries `helpInput({ placeholder: 'path' })`; the example plugin keeps its own descriptor and values, because the two are separate facts. The acceptance tests compare bytes: `jsonkit --help`, `jsonkit select --help`, and `textstat --help` print the three pages, `jsonkit get --help` prints the `get` page with its `details` and example while `path` is missing, `jsonkit select --bogus --help` prints the `select` page, `jsonkit fetch --help` prints the deprecated page and `jsonkit debug --help` the hidden one, and `jsonkit cache --help` on a nested fixture prints a group page with the children form alone and a `cache <command>` row on its parent's page. `jsonkit --version` and `jsonkit get --version` print `jsonkit v0.0.0` while the example manifests hold `0.0.0`, and an Application that omits `version` prints the same line. `jsonkit --help --version` prints help and never imports the version middleware module. Each case runs under Node and Bun, the pattern the seam's coverage set.

## Styles and rendering policy

Core exports the style helpers, rendering context, and rendering policy described below. [ADR-0027](decisions/0027-core-resolves-marked-output-and-one-theme-contribution.md) governs this seam. The named `loomTheme` palette remains proposed under ADR-0022.

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

The proposed `loomTheme(overrides?)` factory is not exported yet. It will supply Loom's seven default mappings and accept partial overrides. A supplied override will replace the complete token mapping; an omitted or undefined override will retain the named default. Its palette belongs to the named Loom theme increment.

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

Process fixtures run on Node and Bun. Captured Windows facts test glyph selection; these fixtures do not certify native Windows support. Named-theme whole-token replacement belongs to the separate palette increment.
