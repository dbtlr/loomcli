---
type: adr
title: ADR-0017 - Plugins participate through one middleware chain with declared activation
description: Every plugin that acts on an invocation does so through one middleware seam between routing and local parsing, taking over by not calling next() or wrapping the rest of the chain. A middleware declares what activates it, and core loads its implementation only when the activation matches.
status: proposed
created: 2026-09-08
modified: 2026-09-08
---

# ADR-0017 - Plugins participate through one middleware chain with declared activation

## Context

Help, version, manifest, completion, logging, color policy, and timing all need to act on an invocation. Two of those needs differ in kind. Help and its relatives take over when one option appears. Logging and its relatives wrap every invocation and read their options as settings. A framework that gives each need its own mechanism grows a terminal-option entity for the first and a hook set for the second, and a plugin that grows from one need to the other migrates between mechanisms.

The seam sits after the global pre-scan and routing and before the callable check, local parsing, and validation. Help on `app get --help` must render while `get` is missing its required argument, and help on a group must render while the group is not callable, so a seam that wraps only the action can never serve help. An unknown command still fails in routing first. The callable check on a group keeps the rank ADR-0004 gives it, ahead of local parsing, but it is judged after the chain rather than inside routing; ADR-0004 carries a dated entry for that placement.

A plugin's options are structural: type, spellings, polarity, multiple, and default, with no schema and no presence rule. A schema on a plugin option would have to run before local parsing, where the validation context every schema is promised cannot exist, and its issue would have to rank somewhere the existing precedence does not describe. The middleware reads parsed values and interprets them itself, and a value it cannot use is the plugin's own diagnostic.

A middleware declares its activation: a list of the plugin's own option names, or always. There is no default. With a list, core evaluates presence from the pre-scan it already ran and calls the plugin's loader only when an option is present, so an installed plugin costs one small module on an invocation that never reaches it. The startup cost of a plugin is therefore the plugin author's explicit choice, visible in the descriptor.

Cleanup is the unwinding side of the chain. A middleware's code after `await next()` returns, or in its `finally`, runs in reverse installation order and can read the outcome directly: the value `next()` resolved, which says whether the action ran, a later middleware took over, or cancellation stopped the chain, the failure it rejected with, or the run signal aborted with a reason naming the signal. The order holds for a middleware that awaits `next()`; one that does not forfeits it. `next` lives until the middleware's own result settles, so a call after that, like a second call, is an internal error that dispatches nothing.

## Considered options

- **Terminal options as a routing-level entity.** Rejected. The earlier design routed a plugin option to its own dispatch with its own formatter attachment and option resolution, a second mechanism beside the action path that surprised authors and could not express an always-on participant.
- **Separate hooks: before, after, and on error.** Rejected. Three hooks with a finish sentinel are the same chain cut into pieces, and the after hook cannot see why it is running without a separate outcome parameter.
- **Two kinds, handlers and middleware.** Rejected. Both are entries in one chain at one phase; a plugin that grows from a takeover to a wrapper would migrate between two mechanisms.
- **Activation inferred from any of the plugin's options.** Rejected. It conflates the options a plugin reads with the options that wake it, and a logger's level option would wake a plugin that must already be present.
- **A default activation.** Rejected. Always makes a forgotten field cost every invocation; lazy makes a logger's sink never install. Silence should not pick the expensive or the broken behavior.
- **A separate shutdown contribution with a fixed budget.** Rejected. Unwinding gives reverse order, a typed reason, and lazy agreement for free, and core awaits cleanup the way it awaits actions.
- **Schemas and presence rules on plugin options.** Rejected for this increment. Validating before the chain contradicts the error precedence and starves the validation context of local inputs; validating inside the chain lets an earlier middleware run before a later plugin's option is rejected. No plugin on the roadmap needs one, and a plugin that does can interpret the string itself. The rule can be revisited when a plugin author shows a case that needs it.

## Consequences

A plugin's options are visible to its own middleware alone. Actions do not receive them until a typed context contribution exists, which is deferred. A provider-style plugin that opens a resource before validation pays that open on an invocation that then fails validation; a lazily acquired resource with core-owned disposal is the intended answer and is also deferred.

## Status

Proposed. The record moves to accepted with the code that runs the chain, enforces the activation rules at build, and proves under test that an unused plugin's implementation module is never loaded.
