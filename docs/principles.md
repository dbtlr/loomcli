---
description: Loom's mission and the eight principles that decide how deep a solution goes, what a test covers, and which review findings are defects.
---

# Principles

Loom is a toolkit, not the application. The author ships the application, and Loom gives them type-safe lanes to assemble it simply, with sane defaults for the people and agents who run it, so no application rebuilds the same machinery. Loom is not paternalistic: it gives the author safe, predictable lanes and leaves the application's choices to them. An application assembles the way a TanStack Router route tree does: declarations compose into one typed tree, and inference carries each declaration's types to the code that reads them.

These principles rank above the [decision records](decisions/README.md) and the [core reference](core.md). Check a design, a test, or a review finding against them first. When a record or a contract rule conflicts with a principle, a superseding record reworks it.

## 1. Loom owns what it ships; the author owns what they write

Loom finishes its own part: parsing, routing, rendering, every projection, the toolchain, the installer, and every surface an operator reaches through them. A defect there is fixed, even when the contract specifies the defective outcome and even when only a hand-typed hidden spelling reaches it.

The author's code is trusted. An action, validator, view, hook, translator, or declared default may be good or bad, and a mistake in it fails the run through the ordinary failure path as a [defect](glossary.md#failures) the author fixes. Loom adds no guard, limit, timer, freeze, or special recovery rule for what an author's code creates, throws, or hands back, and it ships no capability an application does not need, such as a JSON validator for arguments.

Loom is general-purpose, so it does not decide how an application behaves. One action streams a response from a service, and another runs a terminal interface that an operator works in for twelve hours. Loom cannot know which, and an application that needs a timeout or a limit sets it in its own action. Node and Bun are always underneath, and an author who needs something Loom does not offer uses them directly.

## 2. The operator's experience is the product

The [operator](glossary.md#people) is the person or agent who runs the application. Output fits the real screen at the moment it is drawn, every message Loom ships says what went wrong and what to do instead, and an agent reads the same facts a person does from the one command graph. Depth belongs here, and polish on what the operator sees is never cosmetic.

## 3. Forgiving, and helpful when it counts

Loom forgives authors and operators where it can. It accepts what common tools accept, relaxes a rule rather than adding one, and asks for no ceremony that a projection does not need. Forgiveness never means guessing in silence: when a change is required or a fault is raised, Loom is helpful above all. Its message says what went wrong and what to do instead, for the operator in a [failure](glossary.md#failures) and for the author in a Developer Diagnostic.

## 4. Defaults, not handcuffs

Every capability is a default the author can replace, skip, or route around. Core installs no plugin, and a first-party plugin uses the same public contract as any other. A rule prescribes how an author builds only when a projection cannot work without it, and the rule names that projection.

## 5. One system per concept

A concept has one mechanism and one name. A thing a plugin supplies is the ordinary thing attached from a different point. Before adding a lane, check whether the ordinary path already covers the case, and merge parallel kinds of one thing into one.

## 6. Standards before inventions

Loom meets the standards that already exist and uses them, so an application works with the tools around it and an operator's habits carry over. Where the command-line or JavaScript ecosystem has an accepted standard, such as getopt, no-color.org, sysexits, Cobra's completion protocol, Standard Schema, MCP, ESLint, or a test runner, Loom follows it. A Loom-only mechanism is a named deviation with its reason.

## 7. Guide with types, then lint, then diagnostics

Loom steers an author toward a well-built application through three lanes, in order:

1. A type turns the mistake into a compile error.
2. A lint rule the author installs catches what a type cannot express. Lint runs through ESLint or oxlint, the ecosystem's standard tools, so the author sees it in the editor as they type and in CI, and Loom builds no check framework of its own for it. Loom ships no lint rules yet.
3. A development diagnostic reports a plausible mistake that only the assembled application reveals, such as two plugins that claim one spelling.

A value that bypasses the types, from JavaScript or through `any`, and a construction built to break the code, such as a proxy whose trap throws, gets no rule. The platform's own error reports it.

## 8. Depth follows reach

[Reach](glossary.md#people) is who can supply a value or set off a behavior. Specification, tests, and review effort scale with it:

| Reach | Depth |
| --- | --- |
| An operator, through what Loom ships | Specified, tested, and reviewed in full. A defect is fixed. |
| Only the author's own code | Fails through the ordinary failure path. At most one test shows that it does. |
| Only a construction built to break the code | No rule, no test, and no finding. |

Plausibility bounds operator reach. Command-line length bounds what an operator types, and an operator writes ordinary values into a configuration file by hand. A value that no operator plausibly produces, such as an integer beyond the safe range in a configuration file, is a probe.

A test states a behavior someone relies on, and reaches it through the public surface. Assertions on exact bytes belong where the bytes are the product, which is operator output.

A review seat probes what Loom ships and what an operator can reach. [Judging review findings](../AGENTS.md#judging-review-findings) applies principles 1 and 8 to each finding.
