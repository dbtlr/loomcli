---
description: Public SDK, invocation phases, host capture, output, and failure behavior for named commands with global and local options, Standard Schema validation, and passthrough.
---

# Core reference

## Application declarations

`new Application(name)` creates an application with an unnamed root Command. The constructor takes no input type parameter. `new Application(name, globals)` shares one `GlobalOptions` value with the root and every attached Command.

```ts
import { Application } from '@loom/core';

const app = new Application('paths')
  .argument('files', { variadic: true, required: true })
  .action(({ args, out }) => out.print(args.files.join('\n')));

await app.run();
```

Every authoring call returns a new declaration value and never changes its receiver. `argument()`, `option()`, `action()`, and `command()` all follow this rule, so `const forked = base.option('verbose', { type: 'boolean' })` leaves `base` without `verbose`, and `base.command(child)` leaves both `base` and `forked` without the child. Keep the value each call returns. An extracted handler uses `ActionHandler<typeof app>` and a type-only import of its declaration. That helper reads the declared types, so it answers for a fresh declaration, a partly declared one, and one that already registered its action.

A declaration value publishes the authoring calls that are still valid for it. A fresh `Command` publishes `argument()`, `option()`, `command()`, and `action()`; a fresh `Application` publishes the same four calls for the unnamed root; `GlobalOptions` publishes `option()`. An `Application` keeps `inspect()`, `run()`, and its `name` in every state. The collected declarations stay private, so no consumer can read or replace them.

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

A scalar argument is optional when it omits `required` or declares `required: false`. It then binds the next bare token when one exists, and its action value is `string | undefined`, or the schema output or `undefined`. The presence rules are the option rules: `required: true` excludes `default`, a declared default removes `undefined` from the action value, and omission with no default is `undefined` with no call to the schema. An optional argument declares after every required one, and no argument declares after it, so `app keys` and `app keys a.b` both bind.

A variadic argument follows the presence rules of a [multiple option](#repeated-string-values). `required: true` means at least one token and excludes `default`; without it the argument is optional and can declare a default. Its action value is `string[]`, or the schema output, and never `undefined`: an empty tail is an accurate empty collection, so it enters the schema like a supplied one. A default is a `string[]`, or the schema's input type when the declaration validates, and each invocation receives its own copy when no schema replaces it.

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

The long spelling uses the exact declared name. `dryRun` produces `--dryRun`; `dry-run` produces `--dry-run`. Names are case-sensitive. They cannot be empty, start with a hyphen, or contain whitespace or `=`. A `short` alias is one ASCII letter and is case-sensitive.

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

The parser preserves empty values. After parsing, value inputs pass through their declared validation schemas. A declared default fills only an omitted optional value.

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

`new Command(name, globals?)` declares a named Command with `argument()`, `option()`, `command()`, and `action()`. A command name is a nonempty string without a leading hyphen, whitespace, or `=`. Names stay plain strings; no handler object is keyed by command name. `new Application(name, globals?).command(child)` attaches one child to the root, and `command()` on a named Command attaches one child to it, so a graph nests to any depth. Both constructors omit the second argument when the application declares no globals.

The action `options` object is the intersection of the global values and the selected Command's local values. A sibling Command's local options never appear in it. `.option()` rejects a name the globals already own, both at compile time and during graph build.

### Nested Commands and groups

`command()` belongs to a named Command and to the unnamed root alike, so children attach at any depth. A child holds the same `GlobalOptions` value as its Application wherever it sits, and build walks the whole tree: it checks that value, the child names of each parent, and every per-Command rule at every level. A diagnostic that names a parent names the Command that holds the fault, so a nested parent reads as `Command "cache"`.

A Command with children and no action is a group. The unnamed root may be a group too. A group holds children alone: a local option on it reaches no handler, because locals never inherit, so build rejects the declaration. A Command with children and an action keeps its options for that action and runs it when routing selects no child. A Command with neither children nor an action keeps the no-action build error.

```ts
import { Application, Command } from '@loom/core';

import { clearCache, listCache, summarize } from './actions.js';
import { globals } from './globals.js';

const clear = new Command('clear', globals).option('force', { type: 'boolean' }).action(clearCache);
const list = new Command('list', globals).action(listCache);
const cache = new Command('cache', globals).command(clear).command(list);

export const store = new Application('store', globals).command(cache).action(summarize);
```

Routing reads a nested graph the way it reads a flat one. Bare tokens descend from the root, and the first hyphen token commits to the Command they reach, so `store cache clear --force` dispatches `clear` with the global values and its own locals. An unknown child lists the children of the Command that holds it, at every depth.

An invocation that commits to a group fails before local parsing, with code 2. The diagnostic ranks with the routing errors, so `store cache --verbose` reports the missing subcommand rather than the unknown option.

### Modular authoring

Globals are a value, so a Command in its own module knows the global types without importing the application. Module dependencies flow one way: globals, then commands, then the application. The `jsonkit` example uses this layout.

| Module                                                                  | Contents                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/globals.ts`                                                        | the shared `GlobalOptions` value                                                                             |
| `src/commands/get.ts`, `src/commands/keys.ts`, `src/commands/select.ts` | one `Command` each                                                                                           |
| `src/actions/*.ts`                                                      | one `ActionHandler<typeof declaration>` each                                                                 |
| `src/application.ts`                                                    | the root: `new Application('jsonkit', globals).command(get).command(keys).command(select).action(summarize)` |
| `src/main.ts`                                                           | `await jsonkit.run()`                                                                                        |

The application module is the root's authoring file. It declares the root action and attaches the children, and it is the declaration the root action type-imports. One Application value exists, so there is no separate root value to run by mistake.

An action type-imports its own declaration. The import is erased, so the cycle between a Command and its action exists only in types. The types register that action with the last call in the chain: `action()` returns a value with no declaration call left, so a later `argument()`, `option()`, or `command()` does not compile. The rule also keeps a type-imported handler resolvable. TypeScript resolves the declared type of a variable from its outermost call without checking that call's arguments, but it checks the arguments of every inner call, so a type-imported handler passed to an inner call reports a circular reference.

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

Routing then reads the remaining bare tokens from the root downward. A bare token that matches no child, while the current Command has children, is an unknown-command error that lists the choices. The first hyphen token commits to the current Command. Later bare tokens are positional inputs for that Command, so a root with children reports that it accepts no arguments. A commit to a group is an input error, because a group registers no action of its own. That error ranks with the routing errors above, before any local parsing.

Values win over route names. In `jsonkit --file keys get name`, the value of `--file` is `keys`, and routing sees `get name`. A global supplied more than once fails as a repeated option at any placement.

The selected Command then parses the remaining tokens with its own spellings and the existing passthrough rule. One validation pass checks the globals in authoring order, then that Command's declarations in authoring order.

A missing required option is a validation-phase issue, so it loses to routing and to local structure errors. `jsonkit get` reports the missing `path` argument, not the missing `--file`, and `jsonkit nope` reports the unknown command.

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

Core builds and validates the whole graph before it reads any invocation token. This covers the globals table, every Command's spellings, every declared default, and the order of the declaration calls. Each rule below returns code 1 and names both sides with a correction. Seven of them reach JavaScript authors alone, because the types already remove the call that breaks them: arguments beside children in either declaration order, a local option that repeats a global option's key, a Command with several actions, an attached value that is not a Command, a globals value that is not a GlobalOptions, an argument or option declared after the action, and a child attached after the action. The rest surface only at build time, for TypeScript and JavaScript authors alike: two children with one name, an invalid child name, an invalid argument name, a child holding another GlobalOptions value, a global and a local option that share one spelling, a Command with neither children nor an action, a local option on a group, a variadic argument that is not last, and the two argument-order rules below. Build applies every rule at every depth, and a diagnostic names the Command that holds the fault. [`inspect()`](#graph-inspection) applies every one of these rules, and every rule a single declaration carries, so the only fault it leaves to `run()` is a declared default that its schema rejects.

| Rejected declaration                                    | Diagnostic                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Command that declares arguments and attaches children | `The root Command declares argument "files" and attaches child "get". Move the argument into a child Command or remove the children.`                                                                         |
| Two children with one name                              | `The root Command attaches two children named "get". Rename or remove one.`                                                                                                                                   |
| An invalid child name                                   | `The root Command attaches a child named "bad name". Use a nonempty name without a leading hyphen, whitespace, or "=".`                                                                                       |
| An invalid argument name                                | `The root Command declares an argument named "bad name". Use a nonempty name without a leading hyphen, whitespace, or "=".`                                                                                   |
| A child with another globals value                      | `Command "get" holds a different GlobalOptions value than its Application. Share one GlobalOptions value across the declarations.` A child whose globals type differs is also a compile error at `command()`. |
| A global and a local option with one key                | `Option "file" is declared as a global option and as a local option on Command "get". Rename the local option.`                                                                                               |
| A global and a local option with one spelling           | `Option spelling "-f" is used by the global option "file" and the local option "force" on Command "get". Change one declaration.`                                                                             |
| A Command with neither children nor an action           | `Command "get" has no action. Register an action.`                                                                                                                                                            |
| A group that declares a local option                    | `Command "cache" declares option "verbose" but registers no action to receive it. Register an action or remove the option.` The root form reads `The root Command declares option "verbose" ...`.             |
| A Command with several actions                          | `Command "get" has multiple actions. Register one action.`                                                                                                                                                    |
| An attached value that is not a Command                 | `The root Command attaches a value that is not a Command. Attach the value returned by new Command(name).`                                                                                                    |
| A globals value that is not a GlobalOptions             | `The Application holds a value that is not a GlobalOptions declaration. Supply the value returned by new GlobalOptions().`                                                                                    |
| A variadic argument that is not last                    | `Argument "paths" is variadic and precedes argument "path" on Command "get". Declare the variadic argument last.`                                                                                             |
| An optional argument before a required one              | `Argument "path" is optional and precedes required argument "name" on Command "keys". Declare optional arguments after required ones.`                                                                        |
| An argument after an optional one                       | `Argument "extra" follows optional argument "path" on the root Command. Declare an optional argument last.`                                                                                                   |
| An argument or option declared after the action         | `Command "get" declares option "raw" after its action. Declare arguments and options before action().`                                                                                                        |
| A child attached after the action                       | `The root Command attaches child "get" after its action. Attach children before action().`                                                                                                                    |

Local options on separate Commands can reuse names and spellings, with a different value shape on each one, so `--field` and `-F` can collect strings on one Command, read as a Boolean with `--no-field` on a sibling, and carry a validated scalar on a nested leaf. Each action sees only its own Command's declarations. Core holds one globals table and never copies it into a Command.

### Example coverage

[jsonkit](../examples/jsonkit/src/application.ts) declares one required global `--file`, a root summary action, a `get` Command with a required scalar `path`, a `keys` Command with an optional scalar `path`, and a `select` Command. `select` declares `--field` as a required multiple option with the alias `-F` and the schema `z.array(z.string().nonempty('Supply a nonempty field name.'))`, so its action receives `string[]` and prints the requested top-level keys in supplied order. A field the document does not hold is skipped with a warning on stderr while the rest still print, which is the example use of a non-fatal `out` channel. An omitted `keys` path lists the root; a supplied one resolves with the syntax `get` uses, through the resolver both Commands share. Each action is a separate module typed with `ActionHandler`, and all four read their document through one shared helper.

## Standard Schema validation

Value options and arguments, scalar and variadic alike, accept a `validate` property containing a [Standard Schema v1](https://standardschema.dev/) object. Core calls the standard interface directly. A compatible library needs no adapter or plugin. Boolean options do not accept `validate`, `default`, or `required`; their polarity controls their absent value.

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

const upper = {
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

Core re-exports the `StandardSchemaV1` type, so a custom validator depends on `@loom/core` alone. The accessor answers for the contexts core produced alone. A value another caller writes under the same key reads as `undefined`.

| Field         | `phase: 'default'`       | `phase: 'invocation'`                                      |
| ------------- | ------------------------ | ---------------------------------------------------------- |
| `host`        | The captured `Host`      | The captured `Host`, the object the action receives        |
| `input`       | `{ kind, name, global }` | The same identity for the declaration under validation     |
| `command`     | absent                   | The routed path of names; `[]` for the unnamed root        |
| `passthrough` | absent                   | The tail after the first bare `--`                         |
| `supplied`    | absent                   | The raw tokens of every declared input, before any default |

A default validates before any token is parsed, so its phase reports the host and the declaration alone. Every schema call of one invocation, the globals and the routed Command's own declarations alike, reports the same route, passthrough, and supplied inputs.

`supplied` holds the tokens as the parser read them, before any schema runs and before any default applies. Every declared name of the routed Command, and every global name, is a key.

| Declared input and invocation                  | `supplied` value               |
| ---------------------------------------------- | ------------------------------ |
| Scalar argument or single option, supplied     | The one string                 |
| Variadic argument or multiple option, supplied | Every token, in supplied order |
| Scalar argument or single option, omitted      | `undefined`                    |
| Variadic argument or multiple option, omitted  | `[]`                           |
| Boolean option, supplied                       | The value of its spelling      |
| Boolean option, omitted                        | `undefined`                    |

An omitted Boolean reads as `undefined` here, because the polarity value is the absent value, not a supplied token. Absence rules do not change: an omitted optional value with no default never reaches its schema, so no context is produced for it.

### Absence and defaults

| Declaration and input                          | Action value or failure                           |
| ---------------------------------------------- | ------------------------------------------------- |
| Optional value or argument omitted, no default | `undefined`; schema is not called                 |
| Optional multiple option omitted, no default   | The validated output of `[]`                      |
| Optional variadic argument omitted, no default | The validated output of `[]`                      |
| Optional value omitted, declared default       | The validated default output                      |
| Supplied value, including an empty string      | Its validated output or input issues              |
| `required: true` value option omitted          | Input error; no dispatch                          |
| Required input with a declared default         | Developer declaration error                       |
| Invalid declared default                       | Developer declaration error, even when overridden |

Defaults use the schema's input type, not its output type. In the example, `default: '0'` is valid and `default: 0` is a type error. Without a schema, a value default must be a string.

Omission does not invoke schema-internal defaults. An explicitly declared `default: undefined` does enter the schema when its input type accepts `undefined`. Successful schema outputs retain their type, including `undefined`; core does not replace them or validate them a second time.

Every `run()` checks the complete declarations, then validates all declared defaults before parsing invocation tokens. It awaits asynchronous defaults and reuses their transformed outputs for that invocation. Invalid defaults report the affected declaration, the schema explanation, and a correction with exit code 1. Default results are not cached across invocations.

Authoring captures configuration properties. Replacing a property on the original configuration object does not alter the declaration. An array default is copied at authoring, and each invocation receives its own copy when no schema replaces it, so a later change to the declared array, and an action that mutates its collection, reach neither the declaration nor the next invocation. Schema objects and other default objects are retained by reference; core does not clone arbitrary library objects or enforce validator purity.

### Issues and validator failures

Returned schema issues prevent dispatch and produce exit code 2. Core collects them across supplied inputs in authoring order, preserving each schema's own issue order. Async completion timing does not change diagnostic order. Each message identifies the argument or option and includes the schema explanation and any issue path. An empty issues array still denotes failure.

CLI structure errors, such as unknown options, repeated single-value options, or missing required positional values, occur before schema validation. They retain their existing diagnostics.

A validator that throws, rejects its promise, or returns a malformed result produces a developer error with exit code 1. Its diagnostic identifies the affected input and asks the author to fix the validator. Validation stops immediately and the action does not run. This failure is distinct from returned operator-input issues.

### Example coverage

[textstat](../examples/textstat/src/application.ts) declares `metric` with a Zod enum and the default `'bytes'`. Its `min-bytes` schema transforms decimal digits into a non-negative safe integer with default `'0'`. The action uses the inferred values directly. It includes files at or above the byte threshold and totals only retained files. No retained files produces no file rows and a zero total when requested.

## Graph inspection

`inspect()` returns the declared graph as plain data. It answers in every authoring state, as `run()` and `name` do, and it is synchronous. It applies every rule `run()` applies before it reads a token, in the same order, except one: it does not pass a declared default through its schema, because that call can be asynchronous. So it applies the build and structural checks, every rule a single declaration carries, such as a Boolean option with `validate`, `required: true` beside a default, and a non-Boolean `required` or `variadic`, and the raw shape of a default declared without a schema. A rejected declaration throws the exported `DeclarationError`, which a consumer catches by class. `run()` reports the same message as a diagnostic with exit code 1, and it alone reports a default its schema rejects. `inspect()` reads no host facts, and it caches nothing: each call builds the graph anew.

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
- The globals appear once on the graph and never inside a `CommandNode`. A help or manifest consumer combines the two sets for display.
- Spellings are the accepted CLI forms, read from the table the parser reads. `long` is `'--dry-run'` for the declared name `dry-run` and `null` under `shortOnly`, `short` is `'-f'`, and `negative` is `'--no-total'` for `both` and `negative` polarity alone.
- Schema objects stay private. `validated` says whether a schema exists. `default` wraps the declared input value, so an explicit `default: undefined` reads apart from no default at all. The wrapped value is a snapshot: arrays and plain objects are copied and frozen to any depth, so a write through the graph fails and a later call reports the declared value again. Other objects are reported as they are.
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
2. Build and validate the whole Command graph, including the globals table, every command name and spelling, and every declared default.
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

The public declarations include Node stream types. The package supplies their type dependency and an explicit declaration reference.

## Output and failures

| Method                 | Default destination | Return          |
| ---------------------- | ------------------- | --------------- |
| `out.print(message)`   | stdout              | `Promise<void>` |
| `out.info(message)`    | stderr              | `Promise<void>` |
| `out.success(message)` | stderr              | `Promise<void>` |
| `out.warn(message)`    | stderr              | `Promise<void>` |
| `out.error(message)`   | stderr              | `Promise<void>` |
| `out.fatal(message)`   | Failure path        | `never`         |

Messages are strings. The initial renderer appends one newline and preserves all supplied whitespace. Semantic method identity remains distinct inside core.

Nonfatal labels do not change success. Calls can omit `await`; core still accounts for their output and failures before completion. Awaiting a call observes its write completion or rejection. Catching that rejection does not make the invocation successful.

Writes preserve call order within a destination. Separate stdout and stderr captures have no shared observable order. Core does not close host streams.

`out.fatal()` synchronously throws the exported `FatalError` without an eager write. An uncaught `FatalError` prints its message once and returns code 1. A caught fatal error does not itself change success. Other exceptions use an internal-error diagnostic.

If output or diagnostic rendering fails, core attempts one plain stderr fallback and returns code 1. If fallback setup or writing fails, reporting stops. A broken output pipe follows this same failure path and returns code 1.

Help output, stdin selection, custom renderers, and plugins are outside this increment.
