---
type: adr
title: ADR-0048 - A validator package declares one issue code per sentence, read through a typed descriptor
description: "@loomcli/validators exports issueCode(code, config), which declares one issue code with a parameter schema and the one sentence it prints. A validator built with createValidator rejects with the code's issue, and an author's failure view reads the typed parameters through code.read(issue) with no assertion. Codes are namespaced by package, parameters hold the rule's settings and never the rejected value, core is unchanged, and text() requires message beside pattern."
status: accepted
created: 2026-09-28
modified: 2026-09-28
---

# ADR-0048 - A validator package declares one issue code per sentence, read through a typed descriptor

## Context

[ADR-0037](0037-validators-ship-in-their-own-package-as-standard-schema-values.md) ships the validator catalog with one plain sentence per rejection and no issue code, and defers a code until it arrives with a reader. An author who wants other words for one catalog sentence, such as `--workers takes 1 to 64 workers.` in place of `Expected a whole number from 1 through 64.`, has no handle on the issue except its message text, which is not a contract.

[ADR-0046](0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) makes core keep every field a validator attaches to an issue, so a code and its parameters reach an `InputError` view with no core change. What is missing is a code grammar, a typed way to read parameters, and a rule for how many codes a package declares.

The catalog is not the only package that ships validators. A plugin or a library can ship validators built with `createValidator` that an author installs and then wants to reword. A schema library such as Zod already attaches its own `code` to its issues, with its own vocabulary.

Core's extension descriptors, `extension(identity, { schema, target })`, already show a pattern for a typed fact behind a string key: a descriptor value compared by identity, with a Standard Schema that validates the data and gives the read its type.

## Decision

- **Any `createValidator` package may declare codes.** A plugin or library that ships validators declares issue codes and parameters the same way the catalog does, so an author can reword its sentences. The catalog is the first such package and has no special tier. A third-party validator's own codes, such as Zod's, pass through untyped, because core keeps issue fields under ADR-0046.
- **The catalog package owns the mechanism.** `@loomcli/validators` exports `issueCode(code, { schema, message })`, which declares one code with its parameter schema and its sentence and returns a frozen descriptor. `code.issue(params)` builds the issue a `parse` function returns, and `code.read(issue)` reads it back. Core is unchanged. The factory can move to core later, re-exported from the catalog, if an author who does not use `createValidator` needs it.
- **A typed read with no assertion.** `code.read(issue)` returns the typed parameters, or `undefined` when the issue carries another code or its parameters fail the descriptor's schema. The schema's result gives the type, so the read needs no type assertion, no registry, and no module augmentation.
- **Namespaced codes.** A code is the declaring package's name, under the convention plugin identities follow, then `/` and a kebab-case rule name: `@loomcli/validators/integer-range`. Two packages cannot collide, and no code equals a schema library's bare code.
- **One code per sentence.** A validator package declares one code for each distinct sentence it prints. The code identifies that sentence, its parameters are exactly the sentence's blanks, and each code has one fixed parameter shape. Every sentence the package prints is therefore one an author can replace. Parameters hold the rule's settings, never the rejected value, under [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md).
- **No per-call rewording.** A factory takes no message argument that replaces its sentence. `text()`'s `message` stays, because it is the author's description of the pattern, not a rewording, and it becomes required whenever `pattern` is given. The default `Expected a value that matches the required pattern.` goes. All other rewording goes through an `InputError` view override keyed on a code.
- **Core's issues carry no code.** Core's own issues, the Boolean grammar `Use true, false, 1, or 0.` and `The validator rejected this value without an explanation.`, carry no code, and a missing input is a problem with no issue, which `InputProblem.reason` separates.

The contract, the type block, and the catalog's codes are in [Issue codes](../validators.md#issue-codes).

## Considered options

- **Codes in core.** Rejected for now. Core keeps issue fields and reads only `message` and `path`, so it needs nothing to carry a code. A code descriptor in core would be an API with one first-party user.
- **A code registry or module augmentation mapping code strings to parameter types.** Rejected. A global map of strings to types needs an assertion at the read or a declaration-merging step every package must repeat, and it cannot check parameters at run time.
- **Codes from the legacy grammar, `validation/<rule>`.** Rejected. Two packages that each ship a `port` rule would collide. The package name makes the namespace free.
- **One code per rule, with optional parameters.** Rejected. `integer()` prints four sentences, and a view that reads `{ min?, max? }` must branch on absence to know which one it replaces. One code per sentence keeps each parameter shape fixed.
- **A per-call `message` on every factory.** Rejected. It rewords one input at a time, spreads the author's words across declarations, and gives an application no single place to set its voice. An override keyed on a code rewords every input the rule serves.
- **Keep `text()`'s default pattern sentence.** Rejected. It tells the operator a pattern exists without saying what it accepts, which fails ADR-0047's second part.

## Consequences

The catalog declares 23 codes, one per sentence, listed in [Issue codes](../validators.md#issue-codes). Each catalog rejection carries `code` and `params` beside its `message`, and the message text is unchanged except where ADR-0047's audit rewrites it.

Making `text()`'s `message` required beside `pattern` breaks a call that passes a pattern alone, which now throws a `DeclarationError` and fails to type-check, so the implementation's change fragment is breaking and states the migration. Declaring codes is additive for every other factory.

A code, its parameter shape, and its sentence's blanks are part of the declaring package's public contract. Removing a code or changing its parameter shape breaks an author's override, so it is a breaking change of that package. Rewording a sentence without changing its blanks is not.

This record supersedes ADR-0037's clause that issues carry no code, which ADR-0037 carries as a dated entry.

## Status

Proposed 2026-09-28. Accepted 2026-09-28 with the implementation: `@loomcli/validators` exports `issueCode` and the catalog's 23 codes, every catalog rejection carries its code and parameters, `text()` requires `message` beside `pattern`, and an `InputError` override reads a catalog code's typed parameters through `read`, under Node.js and Bun.

## Changelog

- 2026-09-28: Proposed with the issue code contract.
- 2026-09-28: Accepted; `issueCode`, the catalog's 23 codes, and the required `text()` message ship under Node.js and Bun. `issue` and `read` declare `this: void`, so either can be passed or destructured apart from its descriptor, as [Issue codes](../validators.md#issue-codes) shows.
- 2026-09-28: Under [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md), core's issue for a validator that rejects with no issues now ends with its fix: `The validator rejected this value without an explanation. Supply a different value.` It still carries no code, so the "Core's issues carry no code" bullet holds with the longer sentence.
- 2026-09-29: A code may carry subpath segments between the package name and the rule name, `<package>[/<subpath>...]/<rule-name>`, each segment kebab-case, so a code can name the part of the package that owns it. This is the grammar of a diagnostic rule's identity under [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md). A code with no subpath, such as `@loomcli/validators/integer-range`, reads as before, and the catalog's codes are unchanged.
