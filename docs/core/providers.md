---
description: "Providers: typed values an action opts in to, such as a database pool or a session. The provider value, its opener, opting in through uses, the ephemeral and persistent lifetimes, when core builds and closes a value, and how a failing provider ends a run."
---

# Providers

A provider hands an action a typed value, such as a database pool, an authenticated session, or data derived from validated global options. A Command opts in to the providers it uses through `uses`, and its action reads each value under `provided`, typed by the provider. No plugin or Application installs a provider: a package may export one beside its plugin, and opting in is the whole connection. Core builds what the routed Command opted in to at the [dispatch boundary](../glossary.md#compilation-and-invocation) and closes it when the action settles. A provider gives a value and a [middleware](middleware.md) wraps a run, so a value an action reads comes from a provider and code that runs around a run is middleware. [ADR-0108](../decisions/0108-an-action-receives-provided-values-from-the-providers-its-command-opts-in-to.md) records the decision.

## The provider value

```ts
declare const providerTypes: unique symbol;

type Lifetime = 'ephemeral' | 'persistent';

interface Provider<
  Name extends string = string,
  Value = unknown,
  Globals = {},
  Life extends Lifetime = 'ephemeral',
  Uses extends readonly AnyProvider[] = [],
> {
  readonly name: Name;
  readonly lifetime: Life;
  readonly uses: Uses;
  /** Phantom key: it carries the value and globals types and holds no runtime value. */
  readonly [providerTypes]: { value: Value; globals: (value: Globals) => void };
}
type AnyProvider = Provider<string, unknown, never, Lifetime, readonly AnyProvider[]>;
type PersistentProvider = Provider<string, unknown, never, 'persistent', readonly AnyProvider[]>;
type ValueOf<Declared extends AnyProvider> = Declared[typeof providerTypes]['value'];
type GlobalsOf<Declared extends AnyProvider> = Declared[typeof providerTypes]['globals'] extends (value: infer Globals) => void
  ? Globals
  : never;
/** Each provider in a list mapped to its value under its name. */
type ProvidedValues<Uses extends readonly AnyProvider[]> = {
  readonly [Listed in Uses[number] as Listed['name']]: ValueOf<Listed>;
};

/** `lifetime` is required unless it is ephemeral, and `uses` unless the list is empty. */
type ProviderDefinition<Declared extends AnyProvider> = ('ephemeral' extends Declared['lifetime']
  ? { lifetime?: 'ephemeral' }
  : { lifetime: Declared['lifetime'] }) &
  (Declared['uses'] extends readonly []
    ? { uses?: readonly [] }
    : {
        uses: OptIn<Declared['uses']> & // no two different providers with one name in its closure
          (Declared['lifetime'] extends 'persistent' ? readonly PersistentProvider[] : unknown);
      }) & {
    load: () => Promise<{ default: Opener<Declared> }>;
    close?: (value: ValueOf<Declared>) => void | PromiseLike<void>;
  };

declare function provider<const Declared extends AnyProvider>(
  name: Declared['name'],
  definition: ProviderDefinition<Declared>,
): Declared;
```

```ts
// src/providers.ts in a database package: declarations only, so importing it opens nothing
import { provider } from '@loomcli/core';
import type { PluginOptionValues, Provider } from '@loomcli/core';

import type { DatabaseOptions } from './plugin.js';
import type { Pool } from './pool.js';
import type { Session } from './session.js';

export const acmePool: Provider<'acmePool', Pool, PluginOptionValues<DatabaseOptions>, 'persistent'> = provider('acmePool', {
  lifetime: 'persistent',
  load: () => import('./open-pool.js'),
  close: (pool) => pool.end(),
});

export const acmeSession: Provider<'acmeSession', Session, { token: string | undefined }, 'ephemeral', [typeof acmePool]> =
  provider('acmeSession', { uses: [acmePool], load: () => import('./open-session.js') });
```

`provider(name, definition)` returns a frozen provider value. The declaration's type annotation states the provider's types, as a plugin factory's return type states its options under [Plugin contract](plugin-contract.md), and `provider()` checks the definition against it.

- **The annotation.** `Provider<Name, Value, Globals, Lifetime, Uses>` names the key the value reads under in `provided`, the value's type, the [global options](commands.md) the provider reads, its lifetime, and the providers it uses. `provider()` takes its types from the annotation: a `name`, a `lifetime`, or a `uses` list that differs from it is a type error at the call, and so is an omitted `lifetime` on a persistent annotation, an omitted `uses` when the annotation lists providers, and an opener whose value or context differs, under [The opener](#the-opener). The globals are checked where a Command that opts in attaches, under [Opting in](#opting-in).
- **The name.** The name is the key the value reads under in an action's `provided`, so a name that reads as a JavaScript identifier, such as `acmePool`, reads as `provided.acmePool`. Core sets no grammar of its own on it.
- **The lifetime.** `'ephemeral'`, the default, lasts one run. `'persistent'` lasts the outermost run and is shared by every nested `invoke` inside it, under [Lifetimes](#lifetimes).
- **`uses`.** The providers this provider reads, whose values reach its opener under `provided`. A provider opts in to another the same way a Command does, and the lists' types compose, under [Opting in](#opting-in).
- **`load`.** Imports the module whose default export is the provider's [opener](#the-opener). Core calls it only when it builds the value, so a run that never builds the value never imports the module. `load` is the only way to give a provider its code.
- **`close`.** Closes the value at the end of its lifetime, in place of the disposal protocol, under [Closing](#closing). It receives the value the opener returned.
- **Names.** `provider`, `Provider`, `AnyProvider`, `Lifetime`, `ProviderDefinition`, `ProviderContext`, `ProvidedValues`, and `Opener` are exported.

## The opener

```ts
interface ProviderContext<Globals = {}, Provided = {}> {
  /** The validated global option values, frozen to every depth. */
  readonly options: Globals;
  /** The values of the providers this provider uses, each under its provider's name. */
  readonly provided: Provided;
  readonly host: Host;
  readonly out: Out;
  readonly style: ContextualStyle;
  readonly graph: CommandGraph;
  readonly log: Log;
  readonly signal: AbortSignal;
  readonly onShutdown: OnShutdown;
}

type Opener<Declared extends AnyProvider> = (
  context: ProviderContext<GlobalsOf<Declared>, ProvidedValues<Declared['uses']>>,
) => ValueOf<Declared> | Promise<ValueOf<Declared>>;
```

```ts
// src/open-session.ts, loaded only when a run builds the session
import type { Opener } from '@loomcli/core';

import type { acmeSession } from './providers.js';
import { Session } from './session.js';

const open: Opener<typeof acmeSession> = async ({ options, provided, signal }) =>
  Session.start(provided.acmePool, options.token, { signal });

export default open;
```

The opener is the function that builds a provider's value. It types itself from its own declaration, `Opener<typeof acmeSession>`, through a type-only import. `Opener` reads the declaration's members, so a factory that returns a provider whose name is a type parameter types its opener too. The declaration's annotation is the boundary that breaks the type cycle: the declaration names the opener's module only inside `load`, and the opener's `import type` is erased, so the module graph runs one way at run time.

- **`options`.** Every global option's validated value, typed by the globals the provider states, and frozen to every depth, as a middleware's `options` is. An ephemeral provider reads its own run's values; a persistent provider reads the outermost run's. A provider never reads a Command's local arguments or options, because every Command that opts in shares the global options alone.
- **`provided`.** The value of each provider this provider uses, under that provider's name.
- **`host`, `log`, `signal`, and `onShutdown`.** The run's [host](host.md), a [`log`](logging.md) that names no plugin, the run's [signal](signals.md#the-run-signal), and a run-scoped [`onShutdown`](signals.md#onshutdown). An ephemeral provider receives its run's; a persistent provider receives the outermost run's, so a nested run's cancellation never aborts a persistent build. An opener that starts a child program or holds a terminal registers an `onShutdown` handler, as any other code does.
- **`out`, `style`, and `graph`.** `out` is the channel object a [middleware](middleware.md) receives, with `results` typed with a `never` argument, because a result is the action's, so an opener warns through `out.warn` or writes a line at `-v` through `out.debug`, and `out.fatal()` throws a `FatalError` that takes the ordinary failure path. `style` is the contextual style a [configuration source](input-sources.md) receives, so an opener escapes raw data with `style.escape` before it writes it. `graph` is the frozen graph the run built, the one [`inspect()`](graph-inspection.md) returns, so an opener reads the application name as `graph.name`. An ephemeral provider receives its run's three, and a persistent provider the outermost run's. [ADR-0116](../decisions/0116-a-providers-opener-receives-out-style-and-the-graph.md) records the decision.
- **No prompts or request.** A provider asks nothing and reads no request. A later member can add the prompts library without breaking an opener.
- **No self-reference.** An opener types itself from its own declaration and from the value types it reads. Its declaration's type never depends on the opener's module.

## Opting in

```ts
interface CommandOptions<Uses extends readonly AnyProvider[] = []> {
  // ...the members under Commands and global options...
  uses?: Uses;
}

interface ApplicationOptions<Plugins extends readonly Plugin[] = readonly Plugin[], Uses extends readonly AnyProvider[] = []> {
  // ...the members under Application declarations...
  uses?: Uses; // the root's own action alone
}

interface ActionContext<Args, Options = {}, Result = unknown, Provided = {}> {
  // ...the members under Invocation...
  readonly provided: Provided;
}
```

```ts
// src/commands/get.ts
import { Command } from '@loomcli/core';
import { acmeSession } from 'acme-database/providers';

export const get = new Command('get', { uses: [acmeSession] })
  .argument('id', { required: true })
  .action(({ args, provided }) => provided.acmeSession.find(args.id));
```

A Command opts in through `uses` in its options object, and the Application opts in for its own root action through `uses` in its constructor's options. The action reads each value under `provided`, keyed by its provider's name.

- **`provided` holds the opt-ins.** `provided` holds the value of each provider the Command's `uses` lists, typed from the list, and nothing else. A provider those providers use is built but not provided: a Command that reads `acmePool` lists `acmePool`. `provided` is one member of the action context, so a member core adds to the context later never collides with a provider's name. An action whose Command opts in to nothing reads `{}`.
- **Globals are a requirement.** Opting in adds the global options of every provider the list reaches, the providers they use included, to the Command's global requirements. The Application's `command()` already rejects a Command whose global requirements its globals do not hold, and so does `plugin()` for a plugin's Commands, so a Command that opts in to a provider whose option-declaring plugin the Application no longer installs fails to compile where it reaches the Application. That is the author's ordinary error, which the types report. An action's `options` include those globals, because the Application declares them.
- **Requirements pass up.** A Command's `command()` adds a child's global requirements to its parent's and checks none of them, so the requirement meets the Application wherever the child sits, and a library's group that holds a Command that opts in compiles without the Application. The type error surfaces where the requirement first meets globals that do not hold it: the Application's `command()`, `plugin()`, or, where an Application's registration is visible, the `uses` of the Command that opts in, because such a Command's globals are that Application's. A `uses` list shared as a constant reaches the same requirement whether it is typed as a tuple or as an array.
- **The root's own action.** The Application's `uses` covers the root's action alone. Its globals are checked at the root's `action()` call, once `globalOption()` is closed.
- **Plugin Commands.** A plugin's [`commands`](plugin-contract.md#plugin-commands) accepts a Command whose global requirements its own plugin's options meet, checked at `plugin()`, so a database plugin ships `db migrate` that opts in to the pool its own `--database-url` configures. A plugin compiles without the Application, so it cannot require another plugin's options or the application's.
- **No inheritance.** A child Command does not inherit its parent's opt-ins, because a child is declared and typed before it attaches. Commands that share opt-ins share a constant list: `uses: databaseProviders`.
- **One name per closure.** Two different providers with one name, anywhere among the providers a list reaches, are a type error at that `uses`, on `new Command()`, `new Application()`, and `provider()` alike, when their types differ. Two that share one type, such as two values one generic factory returns, pass the types, so core rejects them where the list is declared, as [`@loomcli/core/provider-name-taken`](diagnostics.md#loomclicoreprovider-name-taken). One provider value reached twice, as when a Command lists `acmeSession` and `acmePool` and `acmeSession` uses `acmePool`, is one provider and is built once.
- **Name a distributed provider after its package.** A package that exports a provider prefixes its name with its own, such as `acmeSession` from `acme-database`, because an Application may opt in to providers from many packages and one name can mean only one provider.
- **Lifetime direction.** An ephemeral provider may use a persistent one. A persistent provider may not use an ephemeral one, because it would hold a value of one run inside a value that outlives it: `provider()` rejects that `uses`.
- **Not a graph fact.** An opt-in is not part of the [command graph](graph-inspection.md), so no projection reads it, under [ADR-0010](../decisions/0010-one-graph-serves-runtime-and-projections.md). The globals a provider reads are ordinary global options, which every projection already reads.
- **Middleware is unchanged.** A middleware never sees a provided value, and `next()` takes no argument.

## Lifetimes

A provided value lasts one run or the outermost run. The outermost run is the `run()` or `app.invoke` call at the top: every action's `invoke` is nested inside it, and each `app.invoke` is an outermost run of its own.

- **Ephemeral.** Built at each run's dispatch boundary and closed when that run's action settles. A nested `invoke` reaches its own dispatch boundary and builds its own ephemeral values, so an MCP tool call reads fresh data on every call.
- **Persistent.** Built the first time a run inside the outermost run needs it, at that run's dispatch boundary, and shared by every later run inside the outermost run that needs it. The outermost run closes it. So a pool the `mcp` Command's nested tool calls use is opened once for the server, under [MCP](../plugins/mcp.md). Two runs that first need it at once share one build. A build that fails fails every run awaiting it and leaves nothing behind, so the next run that needs the value builds it again.
- **No process lifetime.** Nothing outlives the outermost run, because no later point can await a close: `onShutdown` handlers are synchronous by design, and an open pool's sockets would keep the event loop alive after `run()` resolves. An embedding host that wants one value shared across many `app.invoke` calls has no way to share it yet.

## When core builds

Core builds at the dispatch boundary, the point the chain reaches when its last middleware continues. There core raises a held fault, or else checks the selected view, then builds what the routed Command opted in to, then dispatches the action.

- **Nothing before the boundary.** A takeover, `--help` included, builds nothing, and so does a run with a held fault or a bad view selection, a run cancelled before the boundary, and a run whose Command opts in to nothing.
- **Order.** Core builds one value at a time, each provider after the providers it uses, in the order each `uses` list names them. A persistent value already built in the outermost run is reused.
- **Cancellation during a build.** An opener reads the run's signal. When the signal aborts during a build, core lets the opener in flight settle, starts no further build, closes what it built under [Closing](#closing), and never dispatches the action, so `next()` resolves `'cancelled'` and the run resolves its cancellation code, whatever the opener in flight settles with. An opener that rejects with the signal's reason or an `AbortError` is silent, and any other rejection is rendered as a failure after cancellation with the signal's code, under [The run signal](signals.md#the-run-signal).
- **A failing opener.** An opener or a `load` that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path): a `FatalError` keeps its code, and a translator is offered any other throw. Core first closes what it built under [Closing](#closing), and the action never runs. The failure rejects `next()` as an action's failure does.

## Closing

Core closes each value it built at the end of its lifetime.

- **How.** Core calls the provider's `close(value)` when it declares one. Otherwise it calls the value's `[Symbol.asyncDispose]()`, or else its `[Symbol.dispose]()`. A value with none of them is left as it is. `close` serves a value that lacks the protocol, so the action reads the value itself rather than a wrapper around it.
- **When.** Every value closes at the point the action settles, before the chain unwinds. Once the action settles, core closes the [live regions](output.md#live-region) the action left open, so each region's last frame is written, then that run's ephemeral values, then, on the outermost run, the persistent values. Then the chain unwinds and any failure report renders. When the action throws, the regions it left open close with `'failure'`, and then its values close the same way. When a build fails or is cancelled, the same closes happen at the boundary in place of the action. A middleware's code after `await next()` therefore runs after every value of its run has closed.
- **Order.** Within a lifetime, values close in reverse build order, so a value closes before the values it used. Each close is awaited before the next starts.
- **A shutdown.** On a [shutdown](signals.md#the-shutdown), the closes run inside the shutdown budget like the rest of the run's unwind, and a close still running when the budget runs out is cut off. Every region already drew its cancelled line at the abort, before any close starts. On an ordinary end, a close takes as long as it takes.
- **A failing close.** Every value still closes when one close throws or rejects. On a run that had otherwise succeeded, the first throw fails the run through the ordinary failure path, as an action's throw does, and rejects `next()`. A close that throws on a run that already failed, or was cancelled, or after an earlier close threw, is an `error` [log event](logging.md), `A provider's close failed.`, with the thrown value under `error` and the provider's name under `provider`.

## Testing a Command that uses a provider

```ts
import { vi } from 'vitest';

// Every run that builds the pool in this test file reads the fake.
vi.mock('../src/open-pool.js', () => ({
  default: () => ({ end: async () => {}, query: async () => [] }),
}));
```

A provider's opener loads through `import()`, so the test runner's module mocking substitutes it: `vi.mock` in Vitest or `mock.module` in Bun, on the opener's module or on the driver beneath it. Core has no member that supplies a provided value to `run()` or `invoke`.

A unit test of an extracted handler states its provided values through `@loomcli/testing`'s [`actionContext`](../libs/testing.md#actioncontext), which builds the handler's context with no run, so no opener loads. The rule for a run is unchanged: `run()` and `invoke` still take no provided value.
