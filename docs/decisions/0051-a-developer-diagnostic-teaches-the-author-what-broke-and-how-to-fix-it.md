---
type: adr
title: ADR-0051 - A Developer Diagnostic teaches the author what broke and how to fix it
description: A declaration fault or a defect shows the author a Developer Diagnostic with a headline, a rule identity, the sentence, findings, an explanation, a correction, and a docs link. Rules are declared once as diagnosticRule descriptors namespaced by package, and DeclarationError takes the structured diagnostic publicly beside its sentence-only form. Findings rebuild the declaration from graph facts, a defect shows the author's source lines through an optional Host reader, and a thrown fault carries the diagnostic in its message. In a development build the diagnostic renders ahead of every view override.
status: proposed
created: 2026-09-29
modified: 2026-09-29
---

# ADR-0051 - A Developer Diagnostic teaches the author what broke and how to fix it

## Context

Core raises a `DeclarationError` from well over a hundred sites and an `InternalError` from about twenty, and the pack and the catalog raise their own. Each is one crafted sentence: what is wrong and what to do. The author reads it as an uncaught exception at the offending call, or as `Invalid declaration: <sentence>` from `run()`. The sentence says what to change, but not why the rule exists, which of several fixes fits, or which declaration broke it when the sentence cannot name it.

Compilers in the Elm tradition answer this with a diagnostic in several parts: a headline, the offending code with the part at fault marked, an explanation that teaches the rule, and one correction.

[ADR-0050](0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md) decides when the author sees it: in a development build, for a defect or a declaration fault core reports. [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md) throws most declaration faults at the authoring call, while the module loads and before the Application exists. Such a fault is an uncaught exception, and the runtime prints it. Node and Bun print an uncaught error differently: Bun ignores a replaced `stack` and a custom inspect function and always prints the source line, `Name: message`, and the frames. Only `message` reaches both.

Core records no source location for a declaration, and `Host` holds no file access.

## Decision

- **The anatomy.** A Developer Diagnostic has six parts, in order: a banner holding the headline and the rule identity, the sentence, the findings, the explanation, the correction, and the docs link. Parts a fault does not carry are left out.
- **A rule is a descriptor.** `diagnosticRule(identity, { headline, explanation, docs })` declares one rule and returns a frozen descriptor, the pattern `extension()` and `issueCode()` follow. The parts that hold at every site belong to the rule, and the parts that differ belong to the fault.
- **Identity.** A rule's identity is the declaring package's name, `/`, and a kebab-case rule name, `@loomcli/core/plugin-option-collision`, the grammar of [ADR-0048](0048-a-validator-package-declares-one-issue-code-per-sentence.md)'s issue codes. There is one rule for each distinct reason a declaration is wrong, not one for each sentence: the sites that reject a non-Boolean `required`, `variadic`, or `validateOmitted` share one rule.
- **Public anatomy.** `DeclarationError` takes a rule and the fault's parts, the sentence, the findings, and the correction. Core, `@loomcli/plugins`, `@loomcli/validators`, and a third-party plugin fill it the same way. The sentence-only constructor stays, and it renders the banner and the sentence. `InternalError` takes the same structured form beside its current constructor, for the defects core raises.
- **Findings rebuild the declaration.** A finding names the Command path where the declaration sits, the authoring call, and the arguments core holds, and marks the part at fault with an optional note. The diagnostic rebuilds the call from those facts. It prints no file or line, captures no stack at a declaration, and reads no file, so it reads the same under Node, Bun, a bundle, and a compiled binary. A fault between two declarations carries a finding for each.
- **A defect shows the author's source.** In a development build, a defect's findings are the lines around the first frame of its cause's stack that lies under the working directory and outside any `node_modules` directory, read through an optional `Host` capability, `readSource(path, cwd)`, with the part at fault marked. The read happens only in a development build and only while core reports a defect, only for a file whose path lies under the working directory, which the captured reader checks again after resolving symbolic links, because a thrown value's stack can be forged. A read that fails, or a frame that qualifies nowhere, falls back to the frame's location alone. Process capture supplies the capability, and a test supplies it through the host override.
- **Ahead of every override.** The Developer Diagnostic is not a view. In a development build, core renders it for a defect or a declaration fault it reports before any view override is consulted, so no application or plugin override can hide a fault from the author. Hints from `onFailure` hooks print under it. In a distributed build, `DeclarationError` and `InternalError` report through the view registry as today, and their default text is the generic message of ADR-0050, which `override(InternalError, view)` replaces.
- **A thrown fault carries it in its message.** A `DeclarationError` holds the whole diagnostic, as plain text, in `message`, and its parts on fields of their own. A fault thrown at a call or an attach still throws there and stops the module, so no code runs after it, and the runtime prints the diagnostic under its own source line in either build. The fault fires on every start, so a distributed application cannot ship with one.
- **The docs link is optional.** A rule may name a page. Core's own rules name none until a Loom documentation site exists, and a third-party plugin may link its own.

The contract, the type block, and the acceptance are in [Developer Diagnostics](../core.md#developer-diagnostics).

## Considered options

- **A frame over the sentence core already has.** A banner, the sentence, where the run was, and the cause chain, with no explanation or rule identity. Rejected in favor of the full anatomy: the author learns why the rule exists and which fix fits, and the rule identity gives later tooling a stable key.
- **Real source locations for declarations.** Capturing a stack at every declaration call and reading the author's file. Rejected. It costs a stack capture on every run, distributed ones included, because the packet arrives after most declarations; a bundle reports bundle positions without source maps; and Node and Bun format stacks differently. A static `loom check` can attach real file and line to the same findings later at no run-time cost.
- **An internal anatomy for core alone.** Rejected. The pack and the catalog would reach the author in a plainer form than core, and first-party plugins would have a lane third-party plugins lack.
- **Holding a fault raised after the Application exists until `run()`.** Rejected. Code that should not run would run in between. A fault stops the run where it is found.
- **Putting the diagnostic in `stack` or a custom inspect function.** Rejected. Bun ignores both, so only `message` reaches the operator's terminal on both runtimes.
- **Letting an override win in development.** Rejected. A plugin that overrides `InternalError` would hide every defect from the author, and author faults are build and configuration mistakes no author overrides.

## Consequences

Every declaration rule in core, the pack, and the catalog gains a descriptor, findings, and an explanation. That is work grouped by rule family, and each family pins its rendered diagnostics.

A `DeclarationError`'s `message` becomes multi-line, and a view or test that reads it reads the whole diagnostic. The sentence alone stays on its own field. A change to diagnostic text is not breaking. The structured constructors are additions beside the existing ones, so no existing plugin stops compiling.

`Host` gains one optional member, so an existing host override still type-checks.

A declaration fault thrown before the Application exists shows its diagnostic without the rule's coordinates when the call has no Command yet, and the runtime's own source line stands in for them.

## Status

Proposed. It moves to accepted with the implementation that renders the Developer Diagnostic for defects and declaration faults under the rules above, gives every declaration rule in core, the pack, and the catalog a descriptor, and passes the acceptance in [Developer Diagnostics](../core.md#developer-diagnostics).

## Changelog

- 2026-09-29: Proposed with the development build contract.
- 2026-09-29: The implementation renders the anatomy, declares rules through `diagnosticRule()`, gives `DeclarationError` and `InternalError` their structured constructors, carries each of core's defects under a rule of its own, reads a defect's source through `Host.readSource`, and renders the diagnostic ahead of every override in a development build. A throwing validator reports under `@loomcli/core/validator-failed`. Two facts the implementation settles: a declaration fault's sentence keeps the line breaks its author wrote, while a defect's sentence, which can carry a thrown reason, stays on one line; and a defect whose cause is not an Error prints the thrown value. The record stays proposed until every declaration rule in core, the pack, and the catalog carries its descriptor, findings, and explanation.
- 2026-09-29: The Command and naming family carries its rules: names, aliases, nesting, children, actions, results, views, and the core facts each declaration holds. A fault about a child as a whole marks the call that attached it, and a Command value prints in a finding as `new Command('get')`. A root with nothing to run carries no finding, because no call declared the absence.
