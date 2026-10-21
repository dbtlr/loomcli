---
type: adr
title: ADR-0093 - A value that bypasses the types gets no rule
description: A declaration fault still throws at the call, the attach, or the build, whichever first holds the data proving it, as ADR-0034 settled. A runtime check exists only for a fault a type cannot express. A value that bypasses the types, from JavaScript or through any, and a construction built to break the code get no rule, and the platform's own error reports them. The hostile-value machinery goes as a class, and the checks a projection, the parser, a standard, or Loom's own writer needs stay. It supersedes ADR-0034.
status: proposed
created: 2026-10-20
modified: 2026-10-21
---

# ADR-0093 - A value that bypasses the types gets no rule

## Context

[ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md) moved each declaration fault to the earliest point that holds the data proving it. Its Context also gave the runtime checks their reason: TypeScript rejects most faults at the call site, and "the runtime guards exist for values that bypass the types, from JavaScript or through `any`."

That sentence made every value an author's code can hand to Loom a candidate for a rule, a Developer Diagnostic, and a test. The reference and the code followed it. Many of the rules core raises at declaration time re-check what TypeScript already rejects at the call. Core also holds machinery against values no author writes by accident: it reads every getter on a configuration once so a getter cannot answer twice, caps a prototype chain at 1,024 links so a proxy cannot loop a walk, and caps a defect's cause chain at 8. Each guard brought its own rule identity, explanation, and tests, and each taught the next contributor that a reachable value needs a rule.

The [principles](../principles.md) settle the question the other way. Principle 7 guides an author through types, then lint, then development diagnostics, and gives a value that bypasses the types no rule. Principle 8 gives a construction built to break the code no rule, no test, and no finding. Principle 1 trusts the author's code: a mistake in it fails through the ordinary failure path. A JavaScript author still meets the platform's own error, such as a `TypeError` when a list is not iterable, at the line that caused it.

## Decision

- **When a fault throws.** A declaration fault throws `DeclarationError` at the earliest of three moments that holds the data proving it: the call, the attach, or the build. Each check runs at the top of its function, before any side effect. Only the root, which later calls can still extend, and what lifecycle hooks contribute wait for graph build. A declared default or implied value its validator rejects stays a `run()` fault, because the validator may answer asynchronously. This is ADR-0034's decision, carried forward unchanged.
- **A check needs a reason a type cannot carry.** A runtime check exists for a fault a type cannot express: a plausible mistake that only the assembled application reveals, such as two plugins that claim one spelling, or a value the parser, a projection, a standard, or Loom's own writer cannot serve. A rule whose fault TypeScript already rejects at the call goes, whatever a JavaScript caller or a value cast through `any` could pass.
- **No rule for a construction built to break the code.** A getter that answers differently on a second read, a proxy whose trap throws, a cyclic or endless prototype or cause chain, and a static rewritten after a class is constructed get no rule and no test. When one reaches Loom, the platform's own error reports it, through the ordinary failure path when it surfaces in a run.
- **What goes as a class.** Among the removals, which the implementing phases list in full:
  - the getter capture-once copy of a configuration, the prototype-chain cap, the cause-chain cap, and the proxy-safe reads that serve them;
  - every re-check of a fault TypeScript rejects at the call, such as a wrong-shaped option configuration, a list that is not an array, or a hook that returns a value its type forbids;
  - probe-only rules, such as an empty-string choice, two man page names equal without ASCII case, and a NaN or negative progress count;
  - `checkPluginSettings` and its sibling export `checkShortSetting`, whose faults each factory's typed settings already reject;
  - the validator catalog's defenses against an author schema that throws or answers asynchronously;
  - the settings checks of the logging, skills, and prompts packages beyond their defaults and real conflicts between settings;
  - the lineage check on what an `onCommandAttach` hook returns;
  - the 64 MiB output buffer `loom build` sets on the Bun process it runs.
- **A repeated declaration resolves without a rule.** Declaring the same thing twice is not a conflict, so it gets no rule: a repeated alias or signal claim is deduplicated, a second extension value for one descriptor in one layer replaces the first whole, as a value in a later layer does, and a second view override of one key in one contributor loses to the first. This supersedes the clause of [ADR-0025](0025-completed-commands-accept-immutable-extension-configuration.md) that two values with the same identity within one layer are a declaration error. A collision between two different declarations, such as two options that claim one spelling or two plugins that claim one slot, stays a fault.
- **What stays, and why.** Each of these checks serves something Loom owns or an operator reaches:
  - the failure-code grammar, because agents and scripts branch on a failure code and its type is `string`;
  - the fault for one failure code with two meanings, because a machine reader would read one code as two failures;
  - the portable and declared name rules, because an operator types each name and the parser reads it;
  - the fault for two installed copies of core, because a value from one copy is unreadable through the other, which only the assembled application reveals;
  - the skill-path escape check, because the skills installer writes the operator's files;
  - systemd's 255-character unit name limit, because the service plugin writes a unit file under that standard;
  - `invalid-default` and `invalid-implied`, because a value the author declared is the author's fault and must never reach the operator as an input problem;
  - the install journal, because an operator can press Ctrl-C in the middle of an install.
- **`optional-argument-last` keeps one branch.** A required argument declared after an optional one stays a declaration fault, because the parser cannot tell which argument a lone bare word fills. An optional argument after another optional one is valid: bare words fill the optional arguments left to right, as clap and Cobra read them, and an argument that receives no word is omitted.

This record supersedes ADR-0034 whole. Every provision of ADR-0034 other than the reason quoted above is incorporated by reference, with its addenda, except the checks this record removes and the nesting cap [ADR-0094](0094-core-sets-no-structural-limit-and-a-projection-reports-its-own-limits.md) removes. Among ADR-0034's lists, those are a value of the wrong shape, a validator that is not a Standard Schema, and an invalid option configuration that TypeScript rejects at the call, the nesting cap in the Application's walk of a joining subtree, and the Consequence that a JavaScript author's bad call throws at import with a named rule, where now the platform's own error reports it. The rest is carried forward: the three moments and what each checks, one attach operation for `Command.command()`, `Application.command()`, and a plugin's `commands`, the typed child handle, the Application's walk of a joining subtree, and the dated entry for [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md)'s message. The records whose timing clauses ADR-0034 superseded, ADR-0002, ADR-0004, ADR-0010, ADR-0018, ADR-0022, ADR-0025, ADR-0026, and ADR-0033, keep their dated entries, because the moment each rule throws does not change. The clauses that give a JavaScript caller a rule in [ADR-0044](0044-a-global-option-declares-no-presence-rule.md) and [ADR-0057](0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md) end, and each carries a dated entry.

## Considered options

- **Keep the guards for JavaScript authors.** Rejected. A JavaScript author meets the platform's own error at the offending line, and a TypeScript author pays for every guard in rules, tests, and documentation that never fire for them. Lint, under [ADR-0098](0098-lint-is-the-author-guidance-lane.md), reaches a JavaScript author in the editor without a runtime rule.
- **Keep the guards and stop testing them.** Rejected. An untested guard drifts, and the guard still teaches that every reachable value needs a rule.

## Consequences

An application that compiles today behaves the same for its operator. A JavaScript author who passes a value the types reject sees the platform's error, or a defect from the run, in place of a named rule. Most removals relax a rule, so they ship as feature or fix fragments. Removing `checkPluginSettings` and `checkShortSetting` is breaking for a third-party plugin that imports them, and its migration is to delete the call. Each implementing phase classifies its own fragments.

The reference keeps the rows of each removed rule until the phase that removes the code, which also removes the rows.

## Status

Proposed. It moves to accepted with the release that removes the rules and machinery above from core, the plugin pack, the validator catalog, the prompts library, and the toolchain, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
