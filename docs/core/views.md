---
description: "The view registry: views, overrides, lanes, and the view context."
---

# Views

Every byte core or a plugin renders passes through one registry of views, except the line a [failure encoder](failure-views.md#failure-encoders) writes for a failed run in place of the failure's view. A failure diagnostic, a semantic lane message, a help page, and a version line each render through a declared view, and an application replaces the function behind any of them through the `views` option. The registry has one override surface and one resolution, so branding a plugin's page and branding a failure class are the same call.

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

`view(identity, definition)` declares a view: an identity and its default function. By the [identity convention](plugin-contract.md#identity-and-installation), the identity is the declaring plugin's identity with a suffix, so the help page is `@loomcli/plugins/help/page`; core's own views take `@loomcli/core/` as their prefix by the same convention, so the lanes are `@loomcli/core/lanes/<name>` and the incomplete-result line is `@loomcli/core/results/incomplete`. The data type is inferred from the function's first parameter when that parameter is an object type or a `readonly` array, and is stated for a primitive or a union, `view<string>(…)`, because inference runs through `Readonly<Data>`: a union parameter is either rejected or silently inferred as part of the union, so a union is always stated in full, and a view function's array parameter is always `readonly`, so a mutable array parameter is a compile error under any type argument. The value it returns satisfies `View<Data>`, so `out.render(page, helpPage)` type-checks the same way a bare view does, and the identity travels on the value. `DeclaredView` is invariant in `Data` through a private witness, so a declared view is never reassigned as a declared view of another data type, and a replacement that requires data the key does not carry is a compile error; a replacement that accepts wider data is valid, since it accepts the key's data, and a bare `View<Data>` keeps its ordinary assignability. The value is branded the way an extension value is, so a hand-built object with an `identity` field is a bare view to core: `out.render` renders it through its own function and consults no override.

The identity string reaches diagnostics and nothing else: an application never spells it, because a view is named by reference, exactly as an [extension descriptor](extensions.md) is. `AnyDeclaredView` is the supertype a contribution list uses; it keeps `identity`, a view function of either shape over `never`, and the brand, and drops the invariance witness, because a list cannot carry one type parameter per element and an invariant type has no common supertype across data types. Every `DeclaredView<Data>` is assignable to it, and the shape rules on a `views` list stay type-rejected. `override` typing is compile-time alone. Core stores a replacement without a run-time witness for a declared-view key, so a JavaScript author's mismatched replacement surfaces through the output-view row of the [Failure contract](failures.md#failure-contract) when it throws.

A declared view is exported from a declarations module of the plugin that declares it, `<subpath>/views`, beside the `<subpath>/extension` module that holds its descriptors, so an application that overrides the help page imports `helpPage` from `@loomcli/plugins/help/views` and never the middleware. The two modules are separate because a declared view carries its default function and the modules it needs, while a descriptor module stays declarations alone, which is the promise a projection that imports another plugin's facts relies on. The default function loads with the entry module, which is the one cost this design accepts: a plugin's middleware module stays lazy under [Activation](plugin-contract.md#activation), and its default view functions are part of its entry cost. A view function is synchronous, so nothing inside it can wait for a lazy import; a plugin whose default function is heavy pays that cost at install, and help's page function is pure string building.

`override(key, replacement)` pairs a key with a replacement view and returns a `ViewOverride`. The key is a declared view or a failure class, which `AnyOverrideKey` names. One signature serves every key: its type parameter is the key's type, and `ReplacementView<Key>` derives the replacement's type from it, so a key that is neither is rejected at the key and a mismatched replacement is reported as its own type against the one the key expects, such as `View<number>` against `View<readonly Row[]>`, rather than as a failure of every key kind. Under a declared view the replacement is typed from the view's data, so a view that requires data the key does not carry is a compile error. The declared-view branches are tried first, so a declared view is never read as a failure class. Under a failure class, `FailureClass<Failure>` is an abstract constructor type, so `UsageError` and `LoomError` are valid keys and the replacement is a `FailureView` typed from the class's instances, as [Failure view context](failure-views.md#failure-view-context) describes. A helper generic over a declared view's data or a failure class's instances forwards its key and replacement to `override` unchanged, and one generic over the key itself types its replacement as `ReplacementView<Key>`. Under a declared view the replacement is any `View<Data>`; a declared view passed as the replacement contributes its function alone, and its own identity plays no part. An application lists its overrides under `views`; a plugin lists its declarations and its overrides together under its own `views`, as [Views from plugins](plugin-contract.md#views-from-plugins) describes. In this contract an application overrides and does not declare: `ApplicationOptions.views` is `readonly ViewOverride[]`, and an application declares no view under the results lane either, because a Command's result names bare views by view name, as [Results](results.md) describes.

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

Resolution is one walk over one list of contributors: the application's overrides first, then each installed plugin's overrides in installation order, then the default function of the view that was declared. A declared-view key matches by reference. A failure-class key matches the thrown failure's prototype chain, most derived first, and the chain is walked in full at each contributor before the next contributor is consulted, so an application's override for `UsageError` beats a plugin's override for `InputError`. This is a deliberate correction to the 0.2.0 resolver, which merged every contributor's registrations into one class-keyed table before walking the chain, so that a plugin's more specific class won over the application's base class; the application owns its diagnostics, and installation order breaks ties among plugins alone. The write site decides the destination and a view carries none: `out.render` writes stdout, or stderr from the action of a Command that declares a [result](results.md), a lane writes its own destination, and a failure writes stderr directly, never through a lane. A result's own views are reached by view name and carry no identity, so this walk never touches them.

Core declares the seven lane views and exports them as `lanes`, one `DeclaredView<string>` per semantic method, declared as `view<string>(…)`. Each receives the original message string, line breaks and authored styles included, under the rules in [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes), with the view context of the write site that called it: stderr under `out.warn`, stdout under `out.print`, and stdout under `out.render` whichever lane view it was handed, or stderr under both from the action of a Command that declares a [result](results.md), so capability detection and glyph selection follow the stream the bytes reach. The default for `lanes.print` returns its message unchanged. A lane view is an ordinary declared view, so `out.render(message, lanes.print)` is legal and writes the message with no newline; the semantic method is the write site that appends one. The other six add their gutter, the matching glyph and one space for the four that existed first and the gutters under [Verbosity](verbosity.md) for `debug` and `trace`, and indent continuation lines by the measured gutter; that gutter is the default, not a rule outside the view, so an application that overrides `lanes.warn` owns it for every `out.warn` call in the run. Those six lanes also wrap the message at the view context's `columns` minus the measured gutter, as [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes) states, and an override owns the wrapping as well. The semantic method appends its one newline after the view, so a lane view returns none, and an override that returns the empty string still writes one newline. A message that is not a string gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): the lane view receives it as the call passed it. A call the run's [verbosity](verbosity.md) hides calls no lane view.

```ts
import { Application, lanes, override } from '@loomcli/core';

const app = new Application('quiet', {
  views: [override(lanes.warn, { render: (message, { style }) => style.dim(message) })],
});
```

Every identity on the graph is compared the way an extension identity is: across every declared view core exports, every declared view a plugin lists, and every declared-view key an override carries, whether or not the view is declared by an installed plugin. Two distinct objects that share one identity are a `DeclarationError` from the Application constructor, which holds every contributor, so an application that imports `helpPage` from one copy of the package while the installed plugin declares it from a second copy is told to deduplicate rather than left with a silent miss, the rule a second copy of an extension descriptor already meets. An override whose identity matches no declaration is inert: it is not a declaration error, it applies the moment a view with that object is rendered, and it never applies otherwise. An application can therefore brand a help page ahead of installing the plugin, and a shared override list holds in an application that omits it. A failure class never meets either case, because every failure class descends from `LoomError`, core keys each class's default text function as that class's default view, which carries no identity, and an application's own subclass is answered by the chain walk at throw time.

Every view declared in this section renders one whole value in one call. A second structural shape, the row view of [Row views](results.md#row-views), renders a sequence one row at a time through a `row` function, with optional `head` and `tail`, and `view()` declares either shape; the two are told apart by the function present, so no declaration in this section changes and no cardinality field exists. The types take a definition of one shape, so a definition whose `row` is a function is a row view and any other is a whole view.

Two rules guard the registry, each a `DeclarationError` thrown from the call that holds the list, `plugin()` for a plugin's list and the Application constructor for the application's and for the installed set: two distinct declared-view objects that share one identity, and a `views` entry another installed copy of `@loomcli/core` built. Two overrides for one key inside one contributor resolve to the first, as they do across contributors. [Command declaration errors](commands.md#command-declaration-errors) and [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) list the diagnostics. The registry is not an `inspect()` fact in this contract.
