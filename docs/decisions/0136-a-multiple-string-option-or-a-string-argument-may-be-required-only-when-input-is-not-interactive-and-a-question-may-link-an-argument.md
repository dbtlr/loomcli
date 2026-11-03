---
type: adr
title: ADR-0136 - A multiple string option or a string argument may be required only when input is not interactive, and a question may link an argument
description: Conditional requiredness, required non-interactive, widens from a local string option that takes one value to every local string option, multiple included, and to a string argument, scalar or variadic. With interaction off the input is required exactly as required true is; with interaction on an omission is absence, undefined for a scalar and an empty list for a collected input. Such an argument counts as required for the argument order and help usage, and inspect() publishes requiredWhen on the argument node. A text, secret, or select question may link a scalar string argument with argument, never beside option, under the same resolution as a linked option, and missingInputError names an argument as { argument }. This narrows ADR-0082's conditional requiredness and link clauses and ADR-0036's structural at-least-one rule.
status: proposed
created: 2026-11-03
modified: 2026-11-03
---

# ADR-0136 - A multiple string option or a string argument may be required only when input is not interactive, and a question may link an argument

## Context

[ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) lets a local string option that takes one value declare `required: 'non-interactive'`, and lets a text, secret, or select question link such an option. Two inputs a wizard asks for fall outside it.

- **A positional operand.** Command-line convention puts a Command's main operand in an argument: `git clone <url>`, `npm init <name>`. An application that wants to ask for it at a terminal today declares the argument optional, so a script that omits it reaches the action, and the action reports the omission in its own words after its presentation. The alternative is to move the operand into an option, which breaks the convention its operators already know.
- **A list.** A multiple string option, such as `--tag`, is the input a question that takes several values answers. It cannot declare the conditional rule, so a script that omits it reads an empty list where the author wanted a required one.

Several facts in core already fit the change.

- **Supplied arguments.** The `supplied` record the action reads holds `args`, the raw token of a scalar argument and the tokens of a variadic one, so a question can tell a supplied argument from an omitted one without a new member.
- **One absent path.** Core's absence step already reads a collected input, a multiple option or a variadic argument, as `[]` when nothing supplied it, and it already builds the at-least-one sentence for a required one.
- **Argument order.** [`@loomcli/core/optional-argument-last`](../core/diagnostics.md#loomclicoreoptional-argument-last) keeps a required argument from following an optional one, because bare words fill arguments left to right.
- **Shared names.** An argument and an option of one Command may share a name, outside a plugin's hook, so a bare name does not say which input it means.

## Decision

- **Conditional requiredness widens.** A local string option, whether it takes one value or is multiple, and a string argument, scalar or variadic, may declare `required: 'non-interactive'`. A content, Boolean, or counted option, a content argument, and a global option still declare no such rule, and the types reject it there. A default or `validateOmitted` beside it stays the declaration error it is beside `required: true`.
- **With interaction off, it is required.** An omission is a `missing` problem of the run's `InputError`, exit 2 before the action, exactly as `required: true` reports it, and the sentence adds `when input is not interactive`: `Option "--tag" is required when input is not interactive. Supply at least one value.`, `Argument "url" requires a value when input is not interactive. Supply a value for "url".`, and `at least one value` for a variadic argument.
- **With interaction on, an omission is absence.** A scalar reads `undefined`, a multiple option and a variadic argument read `[]`, and no validator runs, as [Absence and defaults](../core/validation.md#absence-and-defaults) reads an optional input.
- **An argument's place.** An argument that declares the rule counts as required for the argument order, so it never follows an optional argument, and a variadic one is last, as every variadic argument is.
- **What the projections say.** The argument node gains `requiredWhen`, `'non-interactive'` for such an argument and `null` otherwise, beside `required: false`, as the string option node already carries it, and the manifest copies it on every argument entry. Help prints the fact `required when not interactive` on the input's row. It leaves such an option out of the usage line, as ADR-0082 rules, and prints such an argument in the usage line as a required one, `<url>` or `<files...>`. An MCP tool schema lists the input as required, because a tool call is never interactive.
- **A question links an argument.** A question's `argument` setting names an argument of the routed Command, as `option` names a local option. Text, secret, and select link a scalar string argument. The types reject `argument` beside `option`, `argument` on confirm, because no argument is Boolean, and `skipIfSupplied` without either. The library checks at the call that the routed Command declares the argument and that it is a scalar string argument, under the rule `@loomcli/prompts/link`. A linked argument resolves as a linked option does under ADR-0082: its raw value in `supplied.args` prefills the question, its validated value in `args` answers a skipped one, and the question's validation context identifies it with `kind: 'argument'`.
- **The missing input names an argument.** `missingInputError(context, input)` takes the name of a local option, as before, or `{ argument: name }` for an argument, because a bare name may name both.
- **One value per question, for now.** The link rule still rejects a multiple option and a variadic argument for text, secret, and select, each of which answers one value. A question kind that answers several values decides its own link when it is recorded.

The contract is in [Interaction](../core/interaction.md) and the [prompts reference](../libs/prompts.md#linking-an-input). The key reader, the line editing of a typed line, and the frame's cursor that ship beside this record change no record, and the prompts reference states them.

## Considered options

- **Keep an argument's `required` Boolean, and ask for an operand through an option.** Rejected. Moving a main operand into an option breaks the convention an operator brings from other tools, under [principle 6](../principles.md#6-standards-before-inventions), and an optional argument with a linked question reports a script's omission only from inside the action.
- **Print such an argument as optional in usage, `[url]`.** Rejected. With interaction off it is required, and a script reads the usage line to learn what to supply. At a terminal the question explains itself, and the argument's place is fixed, so no later argument can be supplied without it.
- **Count such an argument as optional for the argument order.** Rejected. An optional argument before a conditionally required one would take the operator's only word when interaction is off, so `app x` would bind the optional one and report the other missing, a reading no operator predicts.
- **Resolve a bare name passed to `missingInputError` to an argument when no option has it.** Rejected. An argument and an option may share a name, so the call would change meaning when an option is added.
- **One `input` setting on a question that names either kind.** Rejected for the same ambiguity, and because it would replace the `option` setting every linked question already uses.

## Consequences

- `UnmarkedStringOption`, `ScalarArgument`, and `VariadicArgument` accept `required: 'non-interactive'`, and the action types read a scalar as possibly `undefined` and a collected input as an array. `ArgumentNode` and the manifest's argument entry gain `requiredWhen`, a member added to a node core builds, which [the changelog rules](../../.changes/README.md) count as compatible.
- `TextSettings`, `SecretSettings`, and `SelectSettings` gain `argument`, and the question functions gain `Args` and `Argument` type parameters after their existing ones, so a call that passes type arguments explicitly keeps compiling.
- The glossary's Conditional requiredness covers the new inputs, and Linked option becomes Linked input, whose two forms are a linked option and a linked argument.
- ADR-0082's conditional requiredness clause, which named a local string option that takes one value, and its link clause, which named a local option alone, are narrowed by this record. ADR-0036's rule that `required: true` is the structural rule for at least one value gains `required: 'non-interactive'` beside it, with interaction off. ADR-0082 and ADR-0036 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-03: Proposed with the contract for line editing, the key table, and linking arguments (LM-349). It narrows ADR-0082's conditional requiredness and link clauses and ADR-0036's structural at-least-one rule. ADR-0082 and ADR-0036 carry dated entries.
