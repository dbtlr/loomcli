---
type: adr
title: ADR-0110 - A test calls one author function with a context the testing package builds
description: '@loomcli/testing exports actionContext, middlewareContext, failureHookContext, providerContext, and viewContext. Each is typed from the function under test and returns its concrete core context with no type assertion. The test states the function''s own data, and the builder fills every other member with one that does nothing, an empty answer, or, for next, invoke, host.spawn, and an omitted graph or command, a throw that tells the test to state it. Core exports plain, wrap, expandTabs, and contextualStyle, so a view context is built from core''s own pure functions. Nothing comes from core''s run machinery.'
status: proposed
created: 2026-10-26
modified: 2026-10-26
---

# ADR-0110 - A test calls one author function with a context the testing package builds

## Context

[ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) and [ADR-0109](0109-a-test-scripts-keys-on-the-mocks-keyboard-and-measures-and-validates-with-cores-own-functions.md) let a test run an Application in its own process on a mock, and that is the only public way to exercise an author function. A test of one action handler assembles an Application, routes an invocation to the handler's Command, runs its defaults and validators, builds its providers, and settles its output, then reads the outcome from the mock. Every stage the test did not mean to cover is in its scope, and a failure in any of them reads as a failure of the handler.

A unit test works well only when it isolates its scope. An action is a function, and its unit test calls it with an input. `ActionContext`, `MiddlewareContext`, `FailureHookContext`, `ProviderContext`, and `ViewContext` are public types, but only core's run machinery builds them. A hand-built action context needs some twenty members, so a test either writes them all or asserts a partial object into the type, which the repository's assertion rule exists to prevent.

ADR-0109 rejected a builder for a Command's whole input stage and left building contexts outside a run to the scopes that test one function. A view's context has its own gap: its `plain`, `wrap`, and `expandTabs` resolve marked text with core's internal resolver, and core publishes `width` for written text alone.

## Decision

- **Five builders.** `@loomcli/testing` exports `actionContext(handler, values)`, `middlewareContext(middleware, values)`, `failureHookContext(hook, values)`, `providerContext(opener, values)`, and `viewContext(view, values)`. Each infers its type parameters from the function's own type, such as `Action<Args, Options, Result, Stdin, Provided>` for an extracted handler typed `ActionHandler<typeof get>`, and returns the concrete core context type that function reads, with no type assertion. An `onFailure` hook takes `(failure, context)`, so `failureHookContext` returns the second argument and the test calls `hook(failure, context)`. `viewContext` serves a view and a row view.
- **The test states the function's own data.** It states the values the function reads, typed exactly as the function reads them, and no default, validator, or input source runs. A key whose type allows `undefined` may be omitted, and every other key is required, so a registered global option whose value is never `undefined`, such as a count or a Boolean, is required too, and one that may be unset, such as a string with no default, may be omitted. A record whose every key may be omitted may itself be omitted. `provided` holds the test's own values, typed from the handler's context. `stdin` is required when the handler's context requires it. `graph` and `command` may be omitted, and a read of an omitted one throws a sentence that tells the test to state it, such as from `application.inspect()`.
- **The builder fills the rest.** Every member the test does not state is the builder's, and a member the test states replaces it; `host`, `out`, and `log` are stated member by member.
  - A member that returns nothing does nothing: `out`'s semantic lanes, `out.render`, and `out.results` resolve and write nothing, `log`'s levels do nothing, `cancel` does nothing, and `onShutdown`, `onSuspend`, and `onResume` keep nothing and return a remover that does nothing.
  - A member that answers gives an empty answer: `out.draw` resolves `0`, `out.region()` returns a region whose methods do nothing, that is not live, whose `closedBy` stays `undefined`, and whose `signal` never aborts, and the context's `signal` never aborts.
  - `next`, `invoke`, and `host.spawn` return information the function reads, so each throws, or for `next` and `invoke` rejects with, a sentence that names the member and tells the test to state its own: `middlewareContext has no next for this middleware to call. Add next to its values, such as next: async () => 'dispatched'.`, `actionContext has no invoke for "sync". Add invoke to its values, such as invoke: async () => ({ status: 'completed', output: '', messages: '' }).`, and `actionContext has no spawn for "git". Add spawn to host in its values.` Each sentence opens with the builder that built the context.
  - `out.fatal` throws core's `FatalError` with the message, because its type is `never`.
  - `host` carries `mockProcess`'s sealed defaults, and a stated `host` replaces fields one by one as `mockProcess`'s fields replace its defaults. `raise` answers `false`. `style` is core's `contextualStyle`, `interactive` is `false`, `passthrough` is `[]`, and `supplied` is `{ args: {}, options: {} }`.
- **A view context from core's pure functions.** Core exports `plain`, `wrap`, and `expandTabs` beside `width`, and `contextualStyle`. A built view context's `columns` and `background` are `undefined` unless the test states them, as for a destination that is not a terminal; its `plain`, `wrap`, and `expandTabs` are core's exports, and its `width(text)` is core's `width` of `plain(text)`. A run's view context keeps its destination's glyph forms, which a run selects from its environment; the exports read no environment, so they resolve every glyph in its main form, the form every destination selects unless `TERM` is `linux`. `contextualStyle` has the members the imported `style` has, apart from `adaptive`, and reads every other name as a token, so a function that names its theme's tokens runs with no theme installed.
- **Nothing from core's run machinery.** No Application, Command, or plugin is a builder's subject, and a builder reads no view registry, theme, or settle step.
- **Functions with no builder.** An inline `.action()` handler has no public way to reach it, so it is tested through `app.invoke`, and the reference tells an author to extract a handler, the modular authoring pattern, to unit-test it. `onCommandAttach` and `onGraphBuilt` read a built graph, so a test installs the plugin on a small Application and reads `application.inspect()`. The arguments of `onLog` and `onEnvironment` are plain values and functions a test writes by hand.

The rules are stated in [Testing one function alone](../libs/testing.md#testing-one-function-alone) and [Marked text outside a run](../core/styles.md#marked-text-outside-a-run).

## Considered options

- **Core runs and settles the action alone.** Rejected. An entry that runs one action and settles its output is a run with fewer stages: it still builds the output channel, the providers, and the settle step, so the test reaches core's machinery rather than the function.
- **Core's real members over a mock.** A context whose `out`, `log`, and signals are core's own, writing to a `mockProcess`. Rejected, because it builds an application's machinery, a view registry, a theme, and a rendering policy, inside the unit test, which is what a run on a mock already does.
- **One generic `contextFor(function, values)`.** Rejected. Its return type is the context parameter of whatever function it receives, which needs a pinned type assertion, and it needs a rule for which parameter is the context, because an `onFailure` hook's is its second.
- **A declaration as the subject.** A builder that takes a Command or a plugin. Rejected. The subject is the function the test calls: a Command reaches an inline handler only through the run machinery, and a plugin holds several functions.
- **`next` and `invoke` resolve invented answers.** Such as `'dispatched'` from `next` and a completed outcome with empty output from `invoke`. Rejected. The function reads the answer and branches on it, so an invented answer can pass a test the function would fail, and a sentence that names the member tells the test to state the answer it means.
- **A core `attachedCommand` builder for `onCommandAttach`.** Rejected. The hook reads a Command as graph build attaches it, and a test that installs the plugin on a small Application reads the same thing through `inspect()`, so a second way to build one is not needed.
- **A built style over core's tokens alone.** Rejected. `ContextualStyle` names the registered Application's theme tokens, so a style without them would compile and then throw at the first theme token a function names.

## Consequences

The five context types stay public for use, not construction. An author reads them and never builds them; Loom's own testing package builds them, and its build fails in the same change when core adds a required member to one of them, so that change also fills the member in the builder. Adding a member to one of these contexts therefore stays non-breaking under the changelog rule for objects core constructs. A member a later release adds follows the classes above: one that returns nothing does nothing, one that answers gives an empty answer, and one whose answer the function reads throws a sentence.

The reference tells an author to extract an action handler to unit-test it. A test of `run()` or `invoke` still substitutes a provider's opener through module mocking, because a run takes no provided value. Core gains four exports. ADR-0109's rejection of a testing subpath with its own `plain` stands: core's `plain` reads marked text, which no runtime function reads, and text a stream received is still stripped with `stripVTControlCharacters`.

## Status

Proposed. It moves to accepted with the release that ships the five builders and core's `plain`, `wrap`, `expandTabs`, and `contextualStyle`, once each builder returns its core context with no type assertion and Loom's own tests call a first-party middleware, `onFailure` hook, opener, and view through them under Node and Bun.

## Changelog

- 2026-10-26: Proposed.
