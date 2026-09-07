---
description: Public SDK, invocation phases, host capture, rendered and semantic output, and the failure classes and renderers for named commands with global and local options, Standard Schema validation, and passthrough.
---

# Core reference

## Application declarations

`new Application(name)` creates an application with an unnamed root Command. The constructor takes no input type parameter. `new Application(name, options)` takes one options object. `globals` shares one `GlobalOptions` value with the root and every attached Command, and `failures` registers the renderers described in [Failure renderers](#failure-renderers).

```ts
interface ApplicationOptions<Globals = {}> {
  globals?: GlobalOptions<Globals>;
  failures?: readonly FailureRenderer[];
}
```

```ts
import { Application } from '@loom/core';

const app = new Application('paths')
  .argument('files', { variadic: true, required: true })
  .action(({ args, out }) => out.print(args.files.join('\n')));

await app.run();
```

Every authoring call returns a new declaration value and never changes its receiver. `argument()`, `option()`, `alias()`, `action()`, and `command()` all follow this rule, so `const forked = base.option('verbose', { type: 'boolean' })` leaves `base` without `verbose`, and `base.command(child)` leaves both `base` and `forked` without the child. Keep the value each call returns. An extracted handler uses `ActionHandler<typeof app>` and a type-only import of its declaration. That helper reads the declared types, so it answers for a fresh declaration, a partly declared one, and one that already registered its action.

A declaration value publishes the authoring calls that are still valid for it. A fresh `Command` publishes `argument()`, `option()`, `alias()`, `command()`, and `action()`; a fresh `Application` publishes `argument()`, `option()`, `command()`, and `action()` for the unnamed root, which has no name to alias; `GlobalOptions` publishes `option()`. An `Application` keeps `inspect()`, `run()`, and its `name` in every state. The collected declarations stay private, so no consumer can read or replace them.

Declare arguments and options, attach the children, then register the action last. Each call removes the calls it invalidates, so this order is a compile-time rule and not advice.

| Call         | Removed from the value it returns                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `argument()` | `command()`, because one Command declares arguments or attaches children, never both                        |
| `command()`  | `argument()`, the same rule read from the other side                                                        |
| `option()`   | nothing                                                                                                     |
| `action()`   | every declaration call; an Application keeps `inspect()`, `run()`, and `name`, a Command its inferred types |

Arguments and children exclude each other at the second call, so `.argument('files', config).command(child)` does not compile. A declaration that registers no action stays open, so a group keeps `option()` and `command()` available. Only an `Application` publishes `inspect()`, `run()`, and `name`, in every state; a named `Command` publishes its authoring calls alone. The type states do not read what a group holds, so build rejects an option declared on a Command that registers no action: a local option never reaches a child's action. A Command with children and no action is a group, and routing sends its invocations on to one of its children. A Command with neither children nor an action is a build error. `command()` accepts a Command in any state, because a child's own `action()` is the call that finished it.

`Command` and `Application` take a fourth type parameter that lists the authoring calls a value still offers. It defaults to `never`, so `Command<Args, Options, Globals>` and `Application<Args, Options, Globals>` accept a declaration in any state, one that registered its action included. Write the parameter only to require a state. The fresh states are the exported `CommandMethod` and `ApplicationMethod` unions, which also let a consumer emit declarations for a value that has not registered its action. An explicit `any` in that position removes the lock, as `any` does anywhere else.

JavaScript authors reach the same rules at graph build, which reports a declaration made after the action, and arguments declared beside children. Both are listed in [Graph build errors](#graph-build-errors).

TypeScript requires one statically known name for each `argument()` and `option()` declaration. Literal-typed constants such as `const name = 'metric'` are valid. Widened `string` types, unions such as `'left' | 'right'`, and open template types are rejected. One declaration creates one handler key, so its type cannot promise several possible keys at once. A rejected name reports the missing property `'Declaration names must be one literal string'`. JavaScript declarations still undergo graph validation during `run()`.

A Command accepts arguments in declaration order. A scalar argument, with optional `variadic: false`, binds one token and produces one `string`, or the schema output when validated. A variadic argument, `{ variadic: true }`, must be last and takes the remaining tokens.

A scalar argument is optional when it omits `required` or declares `required: false`. It then binds the next bare token when one exists, and its action value is `string | undefined`, or the schema output or `undefined`. The presence rules are the option rules: `required: true` excludes `default`, a declared default removes `undefined` from the action value, and omission with no default is `undefined` with no call to the schema. A validated optional argument can declare `validateOmitted: true` to send its omission to its own schema, as [Absence and defaults](#absence-and-defaults) describes. An optional argument declares after every required one, and no argument declares after it, so `app keys` and `app keys a.b` both bind.

A variadic argument follows the presence rules of a [multiple option](#repeated-string-values). `required: true` means at least one token and excludes `default`; without it the argument is optional and can declare a default. Its action value is `string[]`, or the schema output, and never `undefined`: an empty tail is an accurate empty collection, so it enters the schema like a supplied one. A default is a `string[]`, or the schema's input type when the declaration validates, and it reaches each invocation as its own copy.

```ts
const keys = new Command('keys', globals).argument('path', {}).action(({ args, out }) => {
  const path: string | undefined = args.path;
  return out.print(path ?? 'the root');
});
```

Bare tokens before `--` retain their order as positional inputs. Local options can appear before, between, or after these inputs. A hyphenated file path uses an explicit relative path such as `./-notes.txt`.

Application methods apply the same declaration transitions as a Command to the unnamed root's state. Build produces a graph with that root, and routing selects the Command for normal validation and dispatch. There is no separate root action runner.

Graph build rejects invalid and duplicate argument names, a variadic argument that is not last, an argument that follows an optional one, an optional argument that precedes a required one, multiple actions, a Command with neither children nor an action, a local option on a group, and a declaration made after the action. Authoring calls collect declarations before this validation. No action runs after a build or input failure.

## Local options

```ts
import { Application } from '@loom/core';

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

Graph construction rejects duplicate option keys and spelling collisions, including generated negative forms and short aliases. It also rejects invalid names, aliases, types, polarity, and short-only combinations. These errors occur during `run()`, before input parsing or dispatch. Authoring calls capture configuration values, so later changes to the original configuration object do not change the declaration.

Each option without `multiple` can occur only once per invocation. Repetition fails across every accepted spelling, including `--metric words -m bytes`, `--total -t`, `-tt`, and `--total --no-total`. A `multiple` option collects its repetitions instead, as [Repeated string values](#repeated-string-values) describes. An unknown option, missing value, or invalid token form also prevents dispatch. Diagnostics identify the affected option and give a correction. Declaration errors return code 1; invocation errors return code 2. A declaration diagnostic names the declaration, as in `Option "field"`, because the author edits the declaration to fix it. An input diagnostic names the supplied spelling, as in `Option "--field"`, because the operator changes that token. An argument declares and reads under one name, so its diagnostics use it throughout. A broken validator is a fault in the declaration, so it names the declaration even when a supplied value reached it. Command names, child attachment, and collisions between a global and a local option have their own rules, described in [Commands and global options](#commands-and-global-options).

### Passthrough

The first bare `--` ends core parsing. Every following token reaches the action in `passthrough: string[]`, with order, values, and token boundaries intact. The delimiter is excluded. Later `--` tokens are ordinary passthrough values.

Passthrough is always available and is empty when no tail exists. It does not satisfy required positional arguments. Core does not parse it as options or arguments, validate it, or transform it. Parsing leaves `host.argv` intact.

## Commands and global options

`new GlobalOptions()` declares the options that every Command in one application shares. It has `option()` alone; it declares no arguments and no action. Like every authoring call, `option()` returns a new value and leaves its receiver unchanged; the value the declarations receive is the application's globals. An empty `GlobalOptions` value is legal, and every Command in that graph then declares its own options.

```ts
import { GlobalOptions } from '@loom/core';

export const globals = new GlobalOptions().option('file', {
  required: true,
  short: 'f',
  type: 'string',
});
```

Global names, aliases, polarity, defaults, and schemas follow the local-option rules above. A global value reaches every action, so `options.file` has one type in the root action and in each Command action.

`new Command(name, globals?)` declares a named Command with `argument()`, `option()`, `alias()`, `command()`, and `action()`. A command name is a nonempty string without a leading hyphen, whitespace, or `=`. Names stay plain strings; no handler object is keyed by command name. `new Application(name, { globals }).command(child)` attaches one child to the root, and `command()` on a named Command attaches one child to it, so a graph nests to any depth. A Command takes its globals positionally, because the globals are the only thing it configures. Both constructors omit the second argument when the application declares no globals.

The action `options` object is the intersection of the global values and the selected Command's local values. A sibling Command's local options never appear in it. `.option()` rejects a name the globals already own, both at compile time and during graph build.

### Nested Commands and groups

`command()` belongs to a named Command and to the unnamed root alike, so children attach at any depth. A child holds the same `GlobalOptions` value as its Application wherever it sits, and build walks the whole tree: it checks that value, the child names of each parent, and every per-Command rule at every level. A diagnostic that names a parent names the Command that holds the fault, so a nested parent reads as `Command "cache"`. The graph is a tree: one Command value attaches at one point in an Application's graph, and build rejects a value attached under two parents, so a Command that belongs in two places comes from a function that returns a fresh value for each placement. A separate Application may attach the same value, because each build claims its nodes anew.

A Command with children and no action is a group. The unnamed root may be a group too. A group holds children alone: a local option on it reaches no handler, because locals never inherit, so build rejects the declaration. A Command with children and an action keeps its options for that action and runs it when routing selects no child. A Command with neither children nor an action keeps the no-action build error.

```ts
import { Application, Command } from '@loom/core';

import { clearCache, listCache, summarize } from './actions.js';
import { globals } from './globals.js';

const clear = new Command('clear', globals).option('force', { type: 'boolean' }).action(clearCache);
const list = new Command('list', globals).action(listCache);
const cache = new Command('cache', globals).command(clear).command(list);

export const store = new Application('store', { globals }).command(cache).action(summarize);
```

Routing reads a nested graph the way it reads a flat one. Bare tokens descend from the root, and the first hyphen token commits to the Command they reach, so `store cache clear --force` dispatches `clear` with the global values and its own locals. An unknown child lists the children of the Command that holds it, at every depth.

An invocation that commits to a group fails before local parsing, with code 2. The diagnostic ranks with the routing errors, so `store cache --verbose` reports the missing subcommand rather than the unknown option.

### Hidden aliases

`alias(name, ...names)` on a named Command declares hidden aliases: other bare tokens that route to that Command. An alias changes routing alone. The routed path, every diagnostic, and the validation context report the canonical name, and the candidate list of an unknown-command or missing-subcommand error holds canonical names alone. A hidden alias is a routing courtesy for a synonym an operator may type, not a second name the application advertises. It is not an option's short alias, which is a spelling of one option and appears in every projection.

Aliases belong to the Command value, so a group carries them like any other named Command, and the unnamed root declares none. The call is variadic and repeatable: `.alias('ls', 'list')` and `.alias('ls').alias('list')` declare the same set, in that order. A call with no names does not compile. An alias follows the child name rule, and every canonical name and alias under one parent shares one namespace, so build rejects an alias that repeats a sibling's name, a sibling's alias, another alias of its own Command, or its own Command's canonical name. Like every other declaration call, `alias()` precedes `action()`.

```ts
const list = new Command('list', globals).alias('ls').action(listCache);
const cache = new Command('cache', globals).command(clear).command(list);
```

`store cache ls` and `store cache list` both dispatch `list`, and the validation context reports `['cache', 'list']` for either spelling. `store cache nope` still lists `clear, list`.

### Modular authoring

Globals are a value, so a Command in its own module knows the global types without importing the application. Module dependencies flow one way: globals, then commands, then the application. The `jsonkit` example uses this layout.

| Module                                                                  | Contents                                                                                                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/globals.ts`                                                        | the shared `GlobalOptions` value                                                                                                                |
| `src/commands/get.ts`, `src/commands/keys.ts`, `src/commands/select.ts` | one `Command` each                                                                                                                              |
| `src/actions/*.ts`                                                      | one `ActionHandler<typeof declaration>` each                                                                                                    |
| `src/failures.ts`                                                       | one `Renderer` per branded failure class                                                                                                        |
| `src/application.ts`                                                    | the root: the options object with `globals` and the failure registrations, then `.command(get).command(keys).command(select).action(summarize)` |
| `src/main.ts`                                                           | `await jsonkit.run()`                                                                                                                           |

The application module is the root's authoring file. It declares the root action and attaches the children, and it is the declaration the root action type-imports. One Application value exists, so there is no separate root value to run by mistake.

An action type-imports its own declaration. The import is erased, so the cycle between a Command and its action exists only in types. The types register that action with the last call in the chain: `action()` returns a value with no declaration call left, so a later `argument()`, `option()`, `alias()`, or `command()` does not compile. The rule also keeps a type-imported handler resolvable. TypeScript resolves the declared type of a variable from its outermost call without checking that call's arguments, but it checks the arguments of every inner call, so a type-imported handler passed to an inner call reports a circular reference.

```ts
// src/commands/get.ts
import { Command } from '@loom/core';

import { getValue } from '../actions/get-value.js';
import { globals } from '../globals.js';

export const get = new Command('get', globals)
  .argument('path', { required: true })
  .action(getValue);

// src/actions/get-value.ts
import type { ActionHandler } from '@loom/core';

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

Routing then reads the remaining bare tokens from the root downward. A bare token that matches a child's name, or one of its [hidden aliases](#hidden-aliases), descends into that child. A bare token that matches no child, while the current Command has children, is an unknown-command error that lists the children's canonical names. The first hyphen token commits to the current Command. Later bare tokens are positional inputs for that Command, so a root with children reports that it accepts no arguments. A commit to a group is an input error, because a group registers no action of its own. That error ranks with the routing errors above, before any local parsing.

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

Authoring calls collect declarations; core validates them during `run()` and `inspect()`, before either one reads or dispatches any invocation token. This covers the globals table, every Command's spellings, every declared default, the failure renderer registrations, the options object's own shape, and the order of the declaration calls. Each rule below returns code 1 and names both sides with a correction. Ten of them reach JavaScript authors alone, because the types already remove the call that breaks them: arguments beside children in either declaration order, a local option that repeats a global option's key, a Command with several actions, an attached value that is not a Command, a globals value that is not a GlobalOptions, a `failures` entry that is not a `renderFailure` value, an argument, option, or alias declared after the action, a child attached after the action, an `alias()` call with no names, and an options slot holding a positional GlobalOptions value. The rest surface only at build time, for TypeScript and JavaScript authors alike: two children with one name, a Command value attached under two parents, an invalid child name, an alias that repeats a name or alias under the same parent, an alias that repeats its own Command's name or another of its aliases, an invalid alias name, an invalid argument name, a child holding another GlobalOptions value, a global and a local option that share one spelling, a Command with neither children nor an action, a local option on a group, a variadic argument that is not last, two failure renderers for one class, an options slot holding a value that is not a plain object even when it satisfies the options type structurally, and the two argument-order rules below. Build applies every rule at every depth, and a diagnostic names the Command that holds the fault. [`inspect()`](#graph-inspection) applies every one of these rules, and every rule a single declaration carries, so the only fault it leaves to `run()` is a declared default that its schema rejects.

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
| A child with another globals value                      | `Command "get" holds a different GlobalOptions value than its Application. Share one GlobalOptions value across the declarations.` A child whose globals type differs is also a compile error at `command()`.                                                              |
| A global and a local option with one key                | `Option "file" is declared as a global option and as a local option on Command "get". Rename the local option.`                                                                                                                                                            |
| A global and a local option with one spelling           | `Option spelling "-f" is used by the global option "file" and the local option "force" on Command "get". Change one declaration.`                                                                                                                                          |
| A Command with neither children nor an action           | `Command "get" has no action. Register an action.`                                                                                                                                                                                                                         |
| A group that declares a local option                    | `Command "cache" declares option "verbose" but registers no action to receive it. Register an action or remove the option.` The root form reads `The root Command declares option "verbose" ...`.                                                                          |
| A Command with several actions                          | `Command "get" has multiple actions. Register one action.`                                                                                                                                                                                                                 |
| An attached value that is not a Command                 | `The root Command attaches a value that is not a Command. Attach the value returned by new Command(name).`                                                                                                                                                                 |
| A globals value that is not a GlobalOptions             | `The Application holds a value that is not a GlobalOptions declaration. Supply the value returned by new GlobalOptions().`                                                                                                                                                 |
| An options slot that holds no options object            | `The Application takes an options object. Supply { globals } instead of a positional GlobalOptions value.` for the retired positional form, and `The Application options must be an object. Supply { globals, failures }.` for any other value that is not a plain object. |
| A failures entry that is not a registration             | `The Application holds a value that is not a failure renderer. Supply the value returned by renderFailure(type, renderer).`                                                                                                                                                |
| Two failure renderers for one class                     | `The Application registers two failure renderers for "InputError". Remove one registration.`                                                                                                                                                                               |
| A variadic argument that is not last                    | `Argument "paths" is variadic and precedes argument "path" on Command "get". Declare the variadic argument last.`                                                                                                                                                          |
| An optional argument before a required one              | `Argument "path" is optional and precedes required argument "name" on Command "keys". Declare optional arguments after required ones.`                                                                                                                                     |
| An argument after an optional one                       | `Argument "extra" follows optional argument "path" on the root Command. Declare an optional argument last.`                                                                                                                                                                |
| An argument or option declared after the action         | `Command "get" declares option "raw" after its action. Declare arguments and options before action().`                                                                                                                                                                     |
| A child attached after the action                       | `The root Command attaches child "get" after its action. Attach children before action().`                                                                                                                                                                                 |

Local options on separate Commands can reuse names and spellings, with a different value shape on each one, so `--field` and `-F` can collect strings on one Command, read as a Boolean with `--no-field` on a sibling, and carry a validated scalar on a nested leaf. Each action sees only its own Command's declarations. Core holds one globals table and never copies it into a Command.

### Example coverage

[jsonkit](../examples/jsonkit/src/application.ts) declares one optional global `--file`, a root summary action, a `get` Command with a required scalar `path`, a `keys` Command with an optional scalar `path` and the hidden alias `ls`, and a `select` Command. `jsonkit ls` lists keys exactly as `jsonkit keys` does, and `jsonkit typo` still offers `get, keys, select`. `select` declares `--field` as a required multiple option with the alias `-F` and the schema `z.array(z.string().nonempty('Supply a nonempty field name.'))`, so its action receives `string[]` and prints the requested top-level keys in supplied order. A field the document does not hold is skipped with a warning on stderr while the rest still print, which is the example use of a non-fatal `out` channel. An omitted `keys` path lists the root; a supplied one resolves with the syntax `get` uses, through the resolver both Commands share. Each action is a separate module typed with `ActionHandler`, and all four read their document through one shared reader. That reader selects the source: a supplied `--file` streams from disk, and without one the document streams from `host.stdin`. A read failure names the file or `stdin`, and a parse failure names the document the same way. The rule that one of the two sources must exist belongs to the `--file` declaration, not to the reader, and the [schema example coverage](#example-coverage-1) describes it.

## Standard Schema validation

Value options and arguments, scalar and variadic alike, accept a `validate` property containing a [Standard Schema v1](https://standardschema.dev/) object. Core calls the standard interface directly. A compatible library needs no adapter or plugin. Boolean options do not accept `validate`, `default`, `required`, or `validateOmitted`; their polarity controls their absent value.

```ts
import { Application } from '@loom/core';
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
import { validationContext } from '@loom/core';
import type { StandardSchemaV1 } from '@loom/core';

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

Core re-exports the `StandardSchemaV1` type, so a custom validator depends on `@loom/core` alone. The annotation is what fixes the schema's input and output types; an unannotated object literal widens `version: 1` to `number` and resolves the output to `unknown`. The accessor answers for the contexts core produced alone. A value core did not produce reads as `undefined`.

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
import { GlobalOptions, validationContext } from '@loom/core';
import type { StandardSchemaV1 } from '@loom/core';

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

const globals = new GlobalOptions().option('file', {
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

CLI structure errors, such as unknown options, repeated single-value options, or missing required positional values, occur before schema validation. They retain their existing diagnostics.

A validator that throws, rejects its promise, or returns a malformed result produces a developer error with exit code 1. Its diagnostic identifies the affected input and asks the author to fix the validator. Validation stops immediately and the action does not run. This failure is distinct from returned operator-input issues.

### Example coverage

[textstat](../examples/textstat/src/application.ts) declares `metric` with a Zod enum and the default `'bytes'`. Its `min-bytes` schema transforms decimal digits into a non-negative safe integer with default `'0'`. The action uses the inferred values directly. It keeps a row for each source at or above the byte threshold and totals only retained sources. A selection the threshold filters entirely still prints the header, and a `total` row of zero when the invocation asked for one.

`files` is an optional variadic argument with a custom Standard Schema. Its validator reads the validation context: a nonempty list passes, and an empty list passes only when the invocation phase reports that `host.terminal.stdin.isTTY` is false. Otherwise it returns the issue `Supply file arguments or pipe text to stdin.`, which core reports as an input error. The action never reads the terminal. It counts each supplied file, or `host.stdin` when no file is supplied, and prints the row name `stdin` for the piped text. Every source is counted incrementally over its chunks, so a word or a multibyte character that a chunk boundary splits is counted once.

[jsonkit](../examples/jsonkit/src/globals.ts) declares the same rule for one scalar. Its global `--file` carries a hand-written schema and `validateOmitted: true`, so the rule reads omission too. A supplied path passes unchanged. Omission passes only when the invocation phase reports that `host.terminal.stdin.isTTY` is false; otherwise the schema returns the issue `Supply a file or pipe JSON to stdin.`, so a terminal invocation with no file fails with code 2 before any action runs. The application registers its own `InputError` renderer, so the operator reads `jsonkit: --file: Supply a file or pipe JSON to stdin.` where core's default text would read `Invalid input: Option "--file": Supply a file or pipe JSON to stdin.` The shared reader then selects between the file and `host.stdin` and reads no terminal fact of its own.

## Graph inspection

`inspect()` returns the declared graph as plain data. It answers in every authoring state, as `run()` and `name` do, and it is synchronous. It applies every rule `run()` applies before it reads a token, in the same order, except one: it does not pass a declared default through its schema, because that call can be asynchronous. So it applies the build and structural checks, every rule a single declaration carries, such as a Boolean option with `validate`, `required: true` beside a default, and a non-Boolean `required`, `variadic`, or `validateOmitted`, and the raw shape of a default declared without a schema. A rejected declaration throws the exported `DeclarationError`, which a consumer catches by class. `run()` reports the same message as a diagnostic with exit code 1, and it alone reports a default its schema rejects. `inspect()` reads no host facts, and it caches nothing: each call builds the graph anew.

```ts
import { DeclarationError } from '@loom/core';

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
  readonly globals: readonly OptionNode[];
  readonly root: CommandNode;
}
interface CommandNode {
  readonly name: string | null;
  readonly aliases: readonly string[];
  readonly path: readonly string[];
  readonly hasAction: boolean;
  readonly arguments: readonly ArgumentNode[];
  readonly options: readonly OptionNode[];
  readonly children: readonly CommandNode[];
}
interface ArgumentNode {
  readonly name: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly validated: boolean;
  readonly validateOmitted: boolean;
  readonly default: { readonly value: unknown } | undefined;
}
type OptionNode =
  | {
      readonly type: 'string';
      readonly name: string;
      readonly long: string | null;
      readonly short: string | null;
      readonly required: boolean;
      readonly multiple: boolean;
      readonly validated: boolean;
      readonly validateOmitted: boolean;
      readonly default: { readonly value: unknown } | undefined;
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly polarity: 'positive' | 'negative' | 'both';
    };
```

- `name` is `null` for the root, and `path` is the route from the root: `[]` for the root and `['cache', 'clear']` for a nested leaf. Children and declarations appear in authoring order.
- `aliases` holds the Command's [hidden aliases](#hidden-aliases) in declaration order, and `[]` for the root and for a Command that declares none. A Command appears once, under its canonical name, so `path` never holds an alias. A completion or manifest consumer reads `aliases`; a help consumer omits them.
- The globals appear once on the graph and never inside a `CommandNode`. A help or manifest consumer combines the two sets for display.
- Spellings are the accepted CLI forms, read from the table the parser reads. `long` is `'--dry-run'` for the declared name `dry-run` and `null` under `shortOnly`, `short` is `'-f'`, and `negative` is `'--no-total'` for `both` and `negative` polarity alone.
- Schema objects stay private. `validated` says whether a schema exists, and `validateOmitted` says whether the declaration sends its omission to that schema. `default` wraps the declared input value, so an explicit `default: undefined` reads apart from no default at all. The wrapped value is a snapshot: arrays and plain objects are copied and frozen to any depth, so a write through the graph fails and a later call reports the declared value again. Other objects are reported as they are.
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

Each invocation follows this order:

1. Capture host facts and apply overrides.
2. Build and validate the whole Command graph, including the globals table, every command name, alias, and spelling, and every declared default.
3. Copy invocation tokens for input processing.
4. Consume global options in a pre-scan that stops at the first bare `--`.
5. Route the remaining bare tokens to the selected Command.
6. Parse the remaining tokens with that Command's own spellings.
7. Validate the globals in authoring order, then that Command's inputs in authoring order.
8. Await its action.
9. Finish pending core output and set the exit status.

Error precedence follows these phases. A global structure error comes before a routing error, a routing error comes before a local structure error, and a local structure error comes before a schema issue. Unknown-command, missing-value, repetition, and unexpected-argument diagnostics return code 2.

An action receives `{ args, options, passthrough, out, host }`. Its return value is ignored, including a resolved promise value. `run()` awaits action completion but does not render its return value.

The application can run again. Each call captures host facts and builds from its declarations. Core does not call `process.exit()`, consume stdin, track unrelated background work, or provide signal and cleanup handlers.

## Host

`run({ host: partialHost })` overrides selected host fields. Omitted fields use process capture at invocation entry, before graph build.

| Field              | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| `argv`             | Application tokens without the runtime and script prefix      |
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
| `out.render(data, renderer)` | stdout              | `Promise<void>` |
| `out.fatal(message)`         | Failure path        | `never`         |

Messages are strings. The five semantic methods append one newline and preserve all supplied whitespace. Semantic method identity remains distinct inside core. `out.render` is the neutral presentation call, and [Rendered output](#rendered-output) describes it.

Nonfatal labels do not change success. Calls can omit `await`; core still accounts for their output and failures before completion. Awaiting a call observes its write completion or rejection. Catching that rejection does not make the invocation successful.

Writes preserve call order within a destination. Separate stdout and stderr captures have no shared observable order. Core does not close host streams.

`out.fatal()` synchronously throws the exported `FatalError` without an eager write. An uncaught `FatalError` prints its message once and returns code 1. A caught fatal error does not itself change success. Other exceptions use an internal-error diagnostic.

A broken output pipe returns code 1 through the failure path below.

### Rendered output

```ts
interface Renderer<Data> {
  render: (data: Readonly<Data>) => string;
}
```

`out.render(data, renderer)` writes the renderer's text to stdout. A renderer turns one value into the exact bytes core writes, the trailing newline included: core appends nothing and strips nothing. It is synchronous and pure. It receives the value alone, returns a string, and holds no output handle, so an application owns its presentation without owning the destination.

```ts
import { Application } from '@loom/core';
import type { Renderer } from '@loom/core';

interface Row {
  count: number;
  source: string;
}

const table: Renderer<readonly Row[]> = {
  render: (rows) => rows.map((row) => `${String(row.count)}  ${row.source}\n`).join(''),
};

const app = new Application('counts')
  .argument('files', { required: true, variadic: true })
  .action(({ args, out }) => {
    const rows: readonly Row[] = args.files.map((source) => ({ count: source.length, source }));
    return out.render(rows, table);
  });
```

A rendered value has no semantic identity: no purpose parameter and no destination parameter. The five semantic methods keep their string-only signatures and their own destinations.

Core calls the renderer synchronously inside the `out.render` call, then queues its text on stdout. Call order within a destination holds across both forms, so a rendered table and a plain `print` write in the order the action issued them. The optional-await contract is unchanged: the returned promise resolves on write completion and rejects on a renderer or write failure, and catching that rejection changes the action's control flow, not the invocation result.

The type parameter is inferred from the value, so `out.render(rows, table)` checks the renderer against the rows it receives. A renderer for another value type, and one that returns anything but a string, are compile errors.

### Failure classes

Every failure `run()` reports is an instance of a public class. Each class carries the facts its sentence interpolates, so a renderer reads them instead of parsing prose. `message` is the sentence without its category prefix. The exit code is a field of the base, so a subclass inherits it and a renderer reads it.

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

Core's default renderers add the category prefixes: `Invalid input: ` for every `UsageError`, `Invalid declaration: ` for `DeclarationError`, `Internal error: ` for `InternalError`, and none for `FatalError`.

`InputError.problems` carries the whole validation phase in authoring order: each required input the invocation omitted, and each value a schema rejected with the issues that schema returned. `spelling` is the token an operator would type: `--file` for an option, `-F` for a `shortOnly` option, and the declared name for an argument. An omitted required argument is a `missing` problem like an omitted required option, so omission has one class whichever kind of input it names. An `invalid` problem always carries at least one issue: a schema that rejected a value and returned none reports `The schema rejected this value without an explanation.`, the sentence core's own text uses. Error precedence is unchanged, because routing and token errors still precede validation.

`issuePath(issue)` returns the dotted path an issue names inside a value, such as `1` for the second item of a collection, or `undefined` when the issue names the value itself, so a renderer positions an issue the way core's default text does.

`candidates` on `UnknownCommandError` and `NonCallableCommandError` holds the canonical child names in authoring order. A hidden alias never appears in it.

`ShortGroupError.reason` is `'value-position'` for a value option that is not last in its group, and `'mixed-scope'` for a group that mixes a global letter with one the globals do not own. `ShortGroupError.token` holds what each reason names: the single option's spelling, such as `-d`, for `'value-position'`, and the whole group, such as `-qZ`, for `'mixed-scope'`.

`InternalError` wraps an unexpected exception or a non-error throw. Its message is the thrown error's message, or `An unknown error occurred.` A schema that throws stays a `DeclarationError`, because only a returned issue states a validation verdict.

`FatalError` is the class `out.fatal()` throws. An application can subclass it and register a renderer for the subclass, which is how one fatal type implies one diagnostic.

### Failure renderers

An application registers renderers for these classes through the constructor options object. `renderFailure` pairs one class with a renderer for its instances; it is the typed path for a class-keyed list, because an array literal cannot carry a different type parameter per element.

```ts
import { Application, InputError, renderFailure, UnknownCommandError } from '@loom/core';

import { summarize } from './actions/summarize.js';
import { inputProblems, unknownCommand } from './failures.js';
import { globals } from './globals.js';

export const jsonkit = new Application('jsonkit', {
  failures: [
    renderFailure(InputError, inputProblems),
    renderFailure(UnknownCommandError, unknownCommand),
  ],
  globals,
}).action(summarize);
```

The renderer receives the failure instance and returns the diagnostic core writes to stderr. Like `out.render`, the renderer owns every byte core writes, the trailing newline included: core appends nothing and strips nothing. A working renderer cannot change the exit code, which is a fact of the class. A renderer that throws or returns a non-string is itself an internal failure, so that invocation returns 1 whichever code the original failure carried.

Resolution walks the thrown failure's prototype chain, most derived first, through the application's registrations, and falls to core's default text when none answers. A registration for `UsageError` therefore brands every exit-2 failure at once, and a registration for a `FatalError` subclass beats one for `FatalError`. `DeclarationError` and `InternalError` reach registered renderers too, because an author-facing diagnostic is still output the application owns. Two registrations for one class are a `DeclarationError` at build, reported through core's default rendering.

### Failure contract

Renderer and destination failures are internal errors and return code 1.

| Failure                                           | Observation                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An output renderer throws or returns a non-string | The `out.render` call rejects with the renderer's error, and nothing is written for that call. Later output still writes. After the action completes, core reports one `InternalError` through the registry, `Rendering output failed: <reason>`, and returns 1. An action failure stays primary over it. |
| A destination write fails                         | The call rejects, later writes to that destination reject, core attempts one plain stderr fallback, and returns 1.                                                                                                                                                                                        |
| A failure renderer throws or returns a non-string | Core writes the default text of the original failure, then `Internal error: Rendering the failure failed: <reason>`, through the plain fallback path on stderr, bypassing every registration, and returns 1. The original failure stays primary.                                                          |
| The fallback write fails                          | Reporting stops. `run()` still resolves 1.                                                                                                                                                                                                                                                                |

Successful completion requires output completion. A renderer failure during the action makes the invocation unsuccessful even when the action returned normally and even when it caught the rejection. The fallback path calls no renderer. A thenable a renderer returned receives a rejection handler and is otherwise ignored.

### Example coverage

[textstat](../examples/textstat/src/table.ts) holds its `Row` and `Table` types and one table renderer in its own module. The action collects a row per counted source and calls `out.render` once, after the last source is counted, so no core helper knows about columns and a read failure on any source leaves stdout empty. The header names the metric in upper case, then `SOURCE`. Counts right-align in a column as wide as the header or the widest count, a two-space gutter separates the columns, and the source column has no trailing padding. The total row is present only with `--total` and its source is `total`, so a selection that the byte threshold filters entirely still prints the header and one `total` row.

```text
BYTES  SOURCE
    6  one.txt
    2  two words.txt
    8  total
```

[jsonkit](../examples/jsonkit/src/failures.ts) registers two renderers and keeps core's text for every other class. Both prefix the application name. The `InputError` renderer writes one line per problem, `jsonkit: <spelling>: <issue message>`, with ` at <path>` after the spelling when an issue carries a path, and `jsonkit: <spelling>: required` for an omission. The `UnknownCommandError` renderer writes `jsonkit: unknown command "<token>"; try <candidates>.`

| Invocation                              | stderr                                                    | Code |
| --------------------------------------- | --------------------------------------------------------- | ---- |
| `jsonkit select --field '' -f doc.json` | `jsonkit: --field at 0: Supply a nonempty field name.`    | 2    |
| `jsonkit get -f doc.json`               | `jsonkit: path: required`                                 | 2    |
| `jsonkit typo -f doc.json`              | `jsonkit: unknown command "typo"; try get, keys, select.` | 2    |
| `jsonkit get missing -f doc.json`       | `Path not found: missing`                                 | 1    |

The last row is an unregistered class inside an application that registers others: the fatal path keeps core's text.

Help output and plugins are outside this increment.
