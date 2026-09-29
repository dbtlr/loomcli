---
type: adr
title: ADR-0049 - A translator turns a foreign throw into a failure class
description: The Application and plugins register translators keyed by a foreign error class, resolved in the order view overrides resolve. A throw from an action, a middleware, or an input source that is not a LoomError is offered to them before core wraps it as a defect, and the first failure returned wins. A broken translator is a defect, and a failure keeps its cause only when the author passes one.
status: accepted
created: 2026-09-29
modified: 2026-09-29
---

# ADR-0049 - A translator turns a foreign throw into a failure class

## Context

[ADR-0045](0045-a-failure-class-declares-its-exit-code.md) lets an author's failure class choose its exit code, but only a failure the author constructs carries one. A library throws its own errors: `JSON.parse` throws a `SyntaxError`, a fetch client throws a `TypeError` for a refused connection, and Node reports a missing file as an `Error` whose `code` is `ENOENT`. Core wraps every such throw as an `InternalError` with exit 1, which [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md) makes a defect: the operator sees one generic message.

An author who wants the right code and sentence today catches the throw in every action that calls the library. When many Commands share one client, the mapping repeats in each of them, and a Command that forgets it ships a defect. A plugin that wraps a client cannot map its own errors for the actions that use it.

View overrides already have a registry that the application and plugins contribute to, keyed by class and resolved first-in-wins: the application first, then each plugin in installation order, with the prototype chain walked in full at each contributor ([ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md)).

## Decision

- **Keyed by class.** `translate(ForeignClass, translator)` pairs an error class with a function that receives the thrown instance, typed from the class, and returns a `LoomError` or `undefined`. `undefined` passes the throw to the next translator. An error that shares its class with others, such as a Node system error, is keyed on that class and told apart inside the function by its own fields.
- **Registered by the application and plugins.** `ApplicationOptions.translators` and `PluginDefinition.translators` each list translations. Resolution follows the override walk: the application's list, then each plugin's in installation order, the thrown value's prototype chain walked in full at each contributor, most derived first, and within one contributor the list order. The first translator that returns a failure wins.
- **What reaches a translator.** A throw from the code that does the application's work: an action, a middleware before its `next()` has settled, and an input source, the configuration source included. A middleware's own throw during unwinding, after its `next()` has settled, is never offered and stays the unwinding internal error. A value that is a `LoomError` is never offered, and neither is a value that is not an object with a prototype chain a class can match, such as a thrown string. A cancellation echo, the signal's reason or an `AbortError` in a cancelled run, is never offered and keeps its cancellation code. A throw from Loom's own contracts, a failure view, an `onFailure` hook, a validator, a plugin loader, `next()` misuse, and the result contract, is never offered: each is a defect in the code that broke the contract.
- **Where it happens.** Core offers the throw once, at the point it would otherwise wrap it as a defect. A middleware that awaits `next()` still sees the action's own throw, as it does today, and a translated failure then reports like any failure the action raised: it resolves its class's exit code, `onFailure` hooks receive it, and its view renders it.
- **A broken translator is a defect.** A translator that throws, or returns a value that is not a `LoomError`, is reported as a defect, and core offers the throw to no later translator.
- **The cause is the author's.** `LoomError` and the failure classes an author constructs, `FatalError`, `InputError`, and `DeclarationError`, accept the standard `ErrorOptions` as their last constructor parameter, so a translator keeps the foreign throw with `{ cause: error }`. Core never sets a cause on a failure it did not construct.
- **Synchronous.** A translator runs synchronously and receives the thrown value alone.

The contract, the type block, and the acceptance are in [Translators](../core.md#translators).

## Considered options

- **A catch in each action.** Rejected by the shaping. It repeats the mapping for every Command that shares a client, and a plugin cannot map errors for the actions that use it.
- **One function over any thrown value, `(thrown: unknown) => LoomError | undefined`.** Rejected. Every translator narrows `unknown` by hand, and nothing in the declaration says what it handles. A class key gives the function a typed argument without an assertion.
- **Translating throws from views, hooks, validators, and loaders.** Rejected. Each is a broken contract only the author can fix, and a translator would turn the defect into a tidy exit code.
- **Core attaching the original throw as `cause`.** Rejected. It mutates an object the author built, and the platform's own `{ cause }` option already expresses it.
- **Trying the next translator after one throws.** Rejected. A broken translator stays loud instead of being hidden behind a later one.

## Consequences

jsonkit's reader drops its `JSON.parse` catch: the application registers a translator for `SyntaxError` that returns its own data-error class, which exits 65. An untranslated throw still reports as a defect with exit 1.

A translated failure is an operator failure, so it prints the same text in a development build and a distributed one under [ADR-0050](0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md). What keeps a broad translator from hiding a bug is structural: it names the class it handles, the application's translators run first, and only application work reaches it.

A plugin that ships translators for its client's errors can declare the failures they produce in the manifest's collecting extension, as help supplies its facts there.

## Status

Proposed 2026-09-29. Accepted 2026-09-29 with the implementation: `@loomcli/core` exports `translate`, `Translation`, `Translator`, and `ErrorClass`, the Application and plugins register translations, a foreign throw from an action, a middleware before its `next()` has settled, and a configuration source reaches them, and jsonkit's reader holds no `JSON.parse` catch, so a malformed document exits 65, under Node.js and Bun.

## Changelog

- 2026-09-29: Proposed with the translator contract.
- 2026-09-29: Accepted with the implementation. A view's failure that an action or a source lets propagate is never offered, because it is a defect in the view.
- 2026-09-29: The offered sites follow "at the point it would otherwise wrap it as a defect" wherever the application's own work throws. A row source the action hands to `out.results()` or to `out.render()` with a row view, and that throws after the action settled, is offered where core reports it as a deferred fault, and a translated failure there replaces the internal error and sets its own code over a would-be 0. A destination write failure the action awaits and lets propagate is offered, and a failure a translator returns for it reports in place of the plain fallback line with its own code.
- 2026-09-29: A broken translator's defect reports under `@loomcli/core/broken-translator` by build, as [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md) states: a development build prints its Developer Diagnostic, with the translator's throw and the original throw under it, and a distributed build the generic defect message.
