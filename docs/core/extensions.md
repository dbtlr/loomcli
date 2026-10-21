---
description: Descriptor-keyed extension values and how core collects them.
---

# Extensions

`Command.extend(...values)` and `Application.extend(...values)` return new declarations and remain available after `action()`. They accept command-targeted extension values, including help details and examples on an imported library Command:

```ts
import { helpCommand } from '@loomcli/plugins/help/extension';
import { build } from 'command-library';

const customized = build.extend(helpCommand({ details: 'Build this application.' }));
const app = configured.command(customized);
```

Constructor `extensions` and each `extend()` call form successive layers. A later value of an ordinary extension replaces its complete earlier value, and a [collecting extension](#collecting-extensions) keeps both. Other descriptors remain. No fields merge and no arrays concatenate; schema defaults belong to the replacement output. Duplicate identities within one layer fail. Layers validate in authoring order, so replacement cannot hide an invalid earlier value or a conflicting descriptor reference. Replacement does not delete and reinsert keys; records use ordinary JavaScript object key ordering. The final record supports both inspection and `readExtension()`.

An empty call returns an equivalent new declaration. Extending preserves the action, inputs, aliases, children, core facts, Application environment, and authoring state. It never reopens input or action declarations. Core facts such as `description`, `hidden`, and `deprecated`, and option/argument extensions, retain their constructor or input-configuration rules. A plugin reaches a completed declaration only through `onCommandAttach` under [Lifecycle hooks](lifecycle-hooks.md), where `extend()` is one of the calls it may make.

An extension is a typed fact a plugin defines and a declaration carries. `extension(identity, config)` takes an identity under the [identity convention](plugin-contract.md#identity-and-installation) and returns a descriptor that is also a factory: calling it with a value returns a branded extension value, `ExtensionValue<Target>`, and a declaration lists those values under `extensions` in its config object. The key is overloaded on purpose: a plugin's own `extensions` lists the descriptors it defines, and every declaration's `extensions` lists the values those descriptors produce. An extension names one target, `'command'`, `'option'`, or `'argument'`, and one Standard Schema for its value. Each config object takes the values for its own target: `ApplicationOptions` and `CommandOptions` take `ExtensionValue<'command'>`, `StringOption`, `BooleanOption`, and `CountOption` take `ExtensionValue<'option'>`, on every global option declaration, whoever declares it, and `ArgumentConfig` takes `ExtensionValue<'argument'>`.

```ts
// src/help/extension.ts, abbreviated: the shipped module in First-party plugins adds the value rules
import { extension } from '@loomcli/core';
import { array, object, optional, string } from 'valibot';

import { packageName } from '../constants.js';

export const helpCommand = extension(`${packageName}/help/command`, {
  schema: object({
    details: optional(string()),
    examples: optional(array(object({ command: string(), note: optional(string()) }))),
  }),
  target: 'command',
});
export const helpInput = extension(`${packageName}/help/input`, {
  schema: object({ placeholder: optional(string()) }),
  target: 'option',
});
```

```ts
const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [helpCommand({ examples: [{ command: 'get user.name', note: 'a nested key' }] })],
}).argument('path', { required: true, description: 'Dot path to read.' });
```

An extension value is keyed by its extension's identity and branded with its target, so it needs no field name and collides with no core key, and a value on the wrong target is a compile error at the config object. The call is typed from the schema's input type, so an unresolved descriptor or an ill-typed value fails to compile; identity strings and the remaining rules are checked at the call that receives the value. The value carries the input the author supplied and a private reference to the descriptor that produced it. That call validates the input once against the descriptor's schema, which must answer synchronously, and stores a copy of the output on the graph node under the identity, frozen to any depth, as a declared default is stored but without a default's depth limit, so a later change to the author's object changes nothing. `readExtension(node, descriptor)` takes the node kind the descriptor targets, `CommandNode` or the `AttachedCommand` a [lifecycle hook](lifecycle-hooks.md) receives, `OptionNode`, or `ArgumentNode`, so a read against the wrong node kind is a compile error, and returns the stored output as a deeply read-only value, or `undefined` when the node carries no value for that identity, through an ordinary descriptor; through a collecting descriptor it returns an array, as [Collecting extensions](#collecting-extensions) states. It compares the descriptor by reference with the one that produced the value and throws a `DeclarationError` when they differ, so a read never returns output another schema produced. It runs no schema.

The stored output must be plain data: `string`, finite `number`, `boolean`, `null`, arrays, and objects whose prototype is `Object.prototype` or `null` with no accessors and no non-enumerable properties, to any depth and without cycles, with `undefined` property values dropped. That is the form the node can freeze and `inspect()` can report as the projection-neutral form. A schema that produces anything else, a `Date`, a `Map`, a class instance, a `bigint`, a `symbol`, or a function, is rejected at that call; a date travels as a string and a map as an array of pairs.

One identity means one descriptor. Every descriptor on a graph, whether an installed plugin defines it or a carried value references it, is compared by reference, and two distinct descriptor objects that share an identity are a declaration error at the first moment both reach one declaration or one Application, under [Declaration faults](declaration-faults.md), because a read through one would return a value another schema produced. A second copy of one plugin package in `node_modules`, installed or not, trips this rule, which is the intended signal to deduplicate. A projection that reads another plugin's facts imports that plugin's descriptor module, which is declarations alone and never its middleware, and it never imports the plugin's implementation. A plugin that supplies values to another plugin's collecting extension imports that descriptor module the same way.

The call also rejects a value the schema rejects, a schema that does not answer synchronously, and an extension value another installed copy of `@loomcli/core` built. A second value of one extension in one layer, one `extensions` list or one `extend()` call, replaces the first whole, as a value in a later layer does.

A fact whose plugin is not installed is inert for execution: no middleware or hook of the declaring plugin acts on it, because none runs, and core gives it no meaning. Another plugin's hook or middleware may read it through the descriptor, as a projection does. It still sits on the graph, `inspect()` reports it, and a projection that imports its descriptor can read it through `readExtension`. A Command library can therefore ship help facts into an application that installs no help plugin, or one that installs a different help plugin.

Core owns the facts every projection needs: `description` on the Application, on a Command, on an option, and on an argument, `version` on the Application, and `hidden` and `deprecated` on a Command and on an option, as [Hidden and deprecated members](commands.md#hidden-and-deprecated-members) describes. Each is optional in the declaration, and each states how an omitted declaration reads: `undefined` for a description and a deprecated message, `false` for `hidden`, and `0.0.0` for `version`, the one fact with a conventional sentinel for "unversioned". A description, a deprecated message, and a declared version are strings, and `hidden` is a Boolean. Core prints each string as the author wrote it and judges none of them; help, the manifest, MCP, man pages, completion, and the service unit print a description or a deprecated message on one line, so each line break in it, CRLF or one of LF, VT, FF, CR, NEL, LS, and PS, reads as a space there. They make a help page, a manifest, or a completion script minimally useful with no extension present, and an extension enriches them. A further fact of the same kind states its own omitted reading when it is specified. The convention for `version` is the package manifest's own field, as the installation example shows, so the graph and the published version stay in sync.

## Collecting extensions

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
export const notesCommand = extension(`${packageName}/command`, {
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

A collecting extension lets an open set of suppliers give facts to the one plugin that declares it. The author and any plugin supply values, each value is kept, and the declaring plugin reads them all and needs no code for any supplier. [ADR-0031](../decisions/0031-a-plugin-supplies-facts-to-another-plugins-projection-through-a-collecting-extension.md) records the decision.

- **Declaration.** `collect: true` makes an extension collecting. Without it, or with `collect: false`, the extension is ordinary and keeps the replacement rule above. `extension()` publishes `collect` as `false` when the config omits it or holds `undefined`, and otherwise as given. The types take a Boolean `collect`.
- **Collection.** A Command keeps every value of a collecting extension it carries, in collection order: the constructor's `extensions`, then each `extend()` layer in authoring order, then each value a lifecycle hook adds, hooks in installation order and each hook's `extend()` calls in call order. A later value never replaces an earlier one, and values never merge: each is its own validated output. One layer still holds at most one value of an extension, so two values in one `extensions` list or in one `extend()` call are the two-values error. An option and an argument have one layer and no hook call reaches them, so a collecting extension on either holds no value or one.
- **Storage.** Each value is validated by the descriptor's schema and stored as plain data, as any extension output is. The declaration's record holds the frozen array of outputs under the identity, and a declaration that carries no value of the extension has no key for it.
- **Read.** Through a collecting descriptor, `readExtension` returns the array, read-only to any depth, or `[]` when the node carries no value, so a reader never branches on absence. The by-reference descriptor check is unchanged.
- **Suppliers.** An author supplies a value as with any extension. A plugin supplies values from its `onCommandAttach` hook through `extend()`, importing the declaring plugin's declarations module, and the declaring plugin need not be installed; its values are then inert, as any extension value of an uninstalled plugin is. A value names no supplier: which plugin or which layer supplied it is provenance, and neither the node nor a read reports it.

The collecting extension is proven when public APIs alone show, under Node and Bun: help's values under `manifestCommand` on textstat's root and on jsonkit's root and `get`, read through `inspect()`, and in a fixture application with no manifest plugin installed; an author's `manifestCommand` value on jsonkit's `get` collected ahead of help's; `[]` from `readExtension` on a Command that carries neither; two values in one layer rejected; values from two layers and from two hooks kept in collection order; a hook reading an author value and an earlier hook's value through `readExtension`; an invalid author value reported ahead of a hook that throws; a value a hook passes to `extend()` rejected at the call with the invalid-value diagnostic, and a hook that catches that throw continuing without the value; each value's schema called once; an ordinary extension still replaced across layers and across hooks; a collecting extension on an option holding one value; and a `collect` that is not a Boolean rejected.
