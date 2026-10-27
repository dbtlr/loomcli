---
description: "How an Application is declared: its name, version, description, root Command, plugins, and the facts it carries."
---

# Application declarations

`new Application(name)` creates an application with an unnamed root Command. The name is a [portable name](../glossary.md#names-and-routing): `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, not starting with `-` or `.`, because an operator types it as a command at the shell prompt. Core exports the predicate as `isPortableName(name)`, which the [lint plugin](../libs/eslint-plugin.md) calls to judge a literal name as core does. The constructor takes no input type parameter. `new Application(name, options)` takes one options object. `plugins` installs the plugins described in [Plugins](plugin-contract.md) in composition order, and `views` holds the view overrides described in [Views](views.md), which is where an application replaces the view function of a failure class, a lane, a help page, or any other declared view. `description` and `version` are core graph facts every projection reads, and `extensions` carries the root's [extension values](extensions.md). An omitted `version` is `0.0.0`, which means unversioned, so the graph always carries one; the root cannot be hidden or deprecated, so the Application options carry neither fact. `translators` holds the application's [translators](failures.md#translators). `shutdown.timeout` is the [shutdown budget](signals.md#the-shutdown), the milliseconds a run gets to unwind after an ending signal, 500 unless the application sets another; it is a whole number from 0 through 2147483647, and any other value is a declaration error from the constructor. A larger budget makes every cancelled run take longer to end when its work does not stop, so an application keeps its unwind short and the budget small. `uses` lists the [providers](providers.md) whose values the root's own action reads under `provided`; a child Command opts in through its own options. `postInstall` declares the [post-install message and command](#the-post-install-declaration) the installer script prints and runs. The build an application runs as is not an option: core reads it from the [release facts](release-facts.md) the build baked in.

```ts
interface ApplicationOptions<Plugins extends readonly Plugin[] = readonly Plugin[], Uses extends readonly AnyProvider[] = []> {
  plugins?: Plugins;
  rendering?: RenderingPolicy;
  views?: readonly ViewOverride[];
  translators?: readonly Translation[];
  description?: string;
  version?: string;
  extensions?: readonly ExtensionValue<'command'>[];
  shutdown?: { readonly timeout?: number };
  uses?: Uses; // see Providers
  postInstall?: PostInstall; // see The post-install declaration
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

**Recognizing an Application.** `value instanceof Application` holds for an Application in every authoring state, whichever declaring calls returned it, and fails for a `Command`. It narrows the value to the default `Application`, which publishes `inspect()`, `check()`, `run()`, `invoke()`, `extend()`, and `name` and no authoring call, because a recognized value may be past any of them.

A declaration value publishes the authoring calls that are still valid for it. `Command` and `Application` always publish `extend()`, outside the authoring-state parameter. A fresh `Command` publishes `argument()`, `option()`, `alias()`, `result()`, `rows()`, `command()`, and `action()`; a fresh `Application` publishes `argument()`, `option()`, `result()`, `rows()`, `command()`, and `action()` for the unnamed root, which has no name to alias. An Application also publishes `globalOption()` until its first `command()` or `action()` call. A declaration that carries a result publishes `views()` in every state, as [Results](results.md) describes. An `Application` keeps `inspect()`, `check()`, `run()`, `invoke()`, and its `name` in every state. The collected declarations stay private, so no consumer can read or replace them.

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

Arguments and children exclude each other at the second call, so `.argument('files', config).command(child)` does not compile. A declaration that registers no action stays open, so a group keeps `option()` and `command()` available. Only an `Application` publishes `inspect()`, `check()`, `run()`, `invoke()`, and `name`, in every state; a named `Command` publishes its authoring calls alone. The type states do not read what a group holds, so attach rejects an option declared on a Command that registers no action, and build applies the rule to the root: a local option never reaches a child's action. A Command with children and no action is a group, and routing sends its invocations on to one of its children. A Command with neither children nor an action is a declaration error, from attach or, for the root, from build. `command()` accepts a Command in any state, because a child's own `action()` is the call that finished it.

`Command` and `Application` take a fourth type parameter that lists the authoring calls a value still offers. It defaults to `never`, so `Command<Args, Options, Globals>` and `Application<Args, Options, Globals>` accept a declaration in any state, one that registered its action included. Write the parameter only to require a state. The fresh states are the exported `CommandMethod` and `ApplicationMethod` unions, which also let a consumer emit declarations for a value that has not registered its action. An explicit `any` in that position removes the lock, as `any` does anywhere else.

A value that bypasses these types, from JavaScript or through `any`, gets no rule of Loom's: the platform's own error reports it, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). [Declaration faults](declaration-faults.md) names the moment of every rule a type cannot express. A plugin's [Commands](plugin-contract.md#plugin-commands) join the root when the Application is constructed, outside the authoring types, so a root that declares arguments meets the arguments-beside-children rule at its `argument()` call for every author when a plugin brings Commands.

TypeScript requires one statically known name for each `argument()`, `option()`, and `globalOption()` declaration. Literal-typed constants such as `const name = 'metric'` are valid. Widened `string` types, unions such as `'left' | 'right'`, and open template types are rejected. One declaration creates one handler key, so its type cannot promise several possible keys at once. A rejected name reports the missing property `'Declaration names must be one literal string'`. A JavaScript declaration's name is checked at the call instead.

A Command accepts arguments in declaration order. A scalar argument, with optional `variadic: false`, binds one token and produces one `string`, or the validator output when validated. A variadic argument, `{ variadic: true }`, must be last and takes the remaining tokens.

A scalar argument is optional when it omits `required` or declares `required: false`. It then binds the next bare token when one exists, and its action value is `string | undefined`, or the validator output or `undefined`. The presence rules are the option rules: `required: true` excludes `default`, a declared default removes `undefined` from the action value, and omission with no default is `undefined` with no call to the validator. A validated optional argument can declare `validateOmitted: true` to send its omission to its own validator, as [Absence and defaults](validation.md#absence-and-defaults) describes. An optional argument declares after every required one. Optional arguments may follow one another, and bare words fill them left to right, as clap and Cobra read them, so `app keys` and `app keys a.b` both bind.

A variadic argument follows the presence rules of a [multiple option](options.md#repeated-string-values). `required: true` means at least one token and excludes `default`; without it the argument is optional and can declare a default. Its action value is `string[]`, or the array of its validator's outputs, and never `undefined`: an empty tail is an accurate empty list, and it calls no validator. A default is a `string[]`, or an array of the validator's input type when the declaration validates, each value passes through the validator, and it reaches each invocation as its own copy.

```ts
const keys = new Command('keys').argument('path', {}).action(({ args, out }) => {
  const path: string | undefined = args.path;
  return out.print(path ?? 'the root');
});
```

Bare tokens before `--` retain their order as positional inputs. Local options can appear before, between, or after these inputs. A hyphenated file path uses an explicit relative path such as `./-notes.txt`.

Application methods apply the same declaration transitions as a Command to the unnamed root's state. Build produces a graph with that root, and routing selects the Command for normal validation and dispatch. There is no separate root action runner. An action is lazy by definition: registering it runs nothing, and core calls it only when routing selects its Command and the invocation reaches the dispatch boundary, whether the application or a [plugin](plugin-contract.md#plugin-commands) attached that Command.

`argument()` rejects an invalid or repeated argument name, a variadic argument that is not last, and a required argument that follows an optional one; optional arguments may follow each other, and bare words fill them left to right. The types close every declaration call after `action()`. Attach rejects a Command with neither children nor an action, and graph build applies the same rule to the root. [Declaration faults](declaration-faults.md) names the moment of every rule. No action runs after a declaration or input failure.

## The post-install declaration

```ts
interface PostInstall {
  readonly message?: string;
  readonly command?: readonly [string, ...string[]];
}
interface CommandGraph {
  // ...
  readonly postInstall: PostInstall | undefined;
}
```

```ts
const app = new Application('mimir', {
  postInstall: { command: ['setup'], message: 'Run mimir init in a project to start tracking work.' },
  plugins: [help(), mcp(), skills({ skills })],
}).command(setup);
```

`postInstall` declares what the [installer script](../toolchain/install.md) does after it installs and records the binary: `command` is the argument words of the [post-install command](../toolchain/install.md#the-post-install-command), which it runs as the installed binary with those words, and `message` is the [post-install message](../toolchain/install.md#the-post-install-message), which it prints last. It is an installation fact, as the [installation record](installation-record.md) and the [release facts](release-facts.md) are, and core never acts on it at run time. [ADR-0113](../decisions/0113-an-application-declares-a-post-install-message-and-command-that-the-installer-script-prints-and-runs.md) records the decision.

- **On the graph.** The built graph carries it as `CommandGraph.postInstall`, the members the author declared, frozen, or `undefined` when the Application declares neither member. `inspect()` reports it, and `loom init` reads it from there.
- **The words.** `command` holds what an operator types after the application's name, such as `['setup']` or `['completion', 'install', '--shell', 'zsh']`, and the type rejects an empty list. One command, not a list of them: an application with several steps writes a Command that runs them. Core judges no character of a word or of the message, and init quotes each for the shell.
- **The words route.** In a [development build](release-facts.md#development-builds), `inspect()` and `run()` route the words as an invocation's argv routes, global options included, and report the build fault [`@loomcli/core/post-install-unrouted`](declaration-faults.md#at-build) when routing selects no Command, or a Command with no action, such as a group; [`check()`](graph-inspection.md#checking-the-declarations) and the assembly check report it in every build, as they report a failing converter. The routed Command's own arguments and options are not parsed, so words its parser rejects fail at install, under the script's failure line. A distributed `inspect()` and `run()` run no such check.
- **Names.** `PostInstall` is exported from `@loomcli/core`.

## When author code fails

An action that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Registering an action runs nothing, so a mistake in a declaration surfaces as a [declaration fault](declaration-faults.md) before any action runs.
