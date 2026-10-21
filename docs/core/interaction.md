---
description: "The interaction decision: whether a run may ask the operator, and conditional requiredness."
---

# Interaction

Each run decides once whether it may ask the operator questions. Core computes the decision, a local option's conditional presence rule reads it before the action, and the action reads it as `interactive`, so a [question](../libs/prompts.md) and the validation phase never disagree. [ADR-0082](../decisions/0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) records the decision.

```ts
import { Application } from '@loomcli/core';

const app = new Application('mimir')
  .globalOption('input', {
    type: 'boolean',
    polarity: 'negative',
    interaction: true,
    description: 'Ask no questions, and take every answer from options.',
  })
  .option('port', { type: 'string', required: 'non-interactive' })
  .action(({ interactive, supplied, options }) => {
    const port: string | undefined = options.port; // undefined only when interactive
    const typed = supplied.options.port; // the raw supplied value, never a default
    // ...
  });
```

- **The decision.** After the [input-source stage](input-sources.md) and before the validation pass, core sets the run's decision to on when `host.terminal.stdin.isTTY` and `host.terminal.stderr.isTTY` are both true and the marked option, when the application declares one, does not read `false`. Stdout plays no part, so `mimir setup > setup.log` still asks. A host override decides as the facts it supplies say, and an [invocation by name](invocation.md#invocation-by-name), with no terminal, is off, which makes every [MCP](../plugins/mcp.md) tool call off. A run that never reaches validation, such as one that ends at an unknown command, computes nothing.
- **The mark.** `interaction: true` on a Boolean global option, the application's or a plugin's, makes its final value the application's intent: the value argv, its environment binding, or the configuration source supplied, else its polarity's absent value. `false` turns interaction off, and `true` leaves the decision to the terminal facts, so the intent can turn interaction off and never on. An occurrence that faulted supplies nothing, so the absent value applies. `inspect()` publishes `interaction` on each Boolean option node, `true` on the marked one, and the manifest copies it. The [interaction plugin](../plugins/interaction.md) declares a marked `--no-input`.
- **Conditional requiredness.** A local string option that takes one value may declare `required: 'non-interactive'`. With interaction off, it is required, exactly as `required: true` is, and an omission is a `missing` problem of the run's `InputError`, in authoring order, exit 2 before the chain reaches the action, whose sentence reads `Option "--port" is required when input is not interactive. Supply a value.`, or `Option "port" is required when input is not interactive. Supply a value.` by name. With interaction on, an omission is plain absence: `undefined`, and no validator runs. The action value keeps `undefined` in its type. A default or `validateOmitted` beside it is the same declaration error as beside `required: true`. A multiple, content, Boolean, or counted option, an argument, and a global option declare no such rule: an argument's `required` stays Boolean, and a global option declares no presence rule under [ADR-0044](../decisions/0044-a-global-option-declares-no-presence-rule.md). `inspect()` publishes it as `required: false` and `requiredWhen: 'non-interactive'`, so a reader of `required` keeps its meaning, and the manifest copies both. Help prints the fact `required when not interactive` and leaves the option out of the usage line, and an MCP tool schema lists it as required.
- **`interactive`.** The action context's `interactive` is the decision, a Boolean. An action's `invoke` and `app.invoke` compute their own, which is off.
- **`supplied`.** The action context's `supplied` is the record the [validation context](validation.md#validation-context) calls `supplied`: the raw value of every input any tier supplied, and `undefined` for an omitted scalar input, an input left to its declared default, and an omitted Boolean or counted option, whose absent value is not supplied. It says whether a value was supplied and never which tier supplied it. Core builds the action's record once per run, after the input-source stage, frozen to every depth, from the same values each validator's per-call copy holds, so the action reads what the validators read and a validator's write to its copy changes nothing the action reads. Under an invocation by name it holds the raw values the call's `values` lowered to and the tiers filled. The type is the exported `SuppliedInputs`.
- **`missingInputError(context, name)`.** Core exports the function that builds the `InputError` core reports for an omitted local option of the routed Command, so a library that finds an option missing inside the action reports it in core's words: one `missing` problem, named by spelling from argv and by declared name from an invocation by name, with the sentence `Option "--database-url" is required when input is not interactive. Supply a value.` when interaction is off and `Option "--database-url" is required. Supply a value.` when it is on. For argv, a Boolean option's fix names the spellings its polarity accepts in place of a value: `Supply "--install" or "--no-install".`, `Supply "--install".` for a positive option, and `Supply "--no-install".` for a negative one. Under an invocation by name, the fix remains `Supply a value.` for every option kind. The caller throws it, and the run exits 2. A name that is not a local option of the routed Command throws a `DeclarationError` under `@loomcli/core/missing-input-name`: `missingInputError() received option "prot", which Command "setup" does not declare. Supply the name of a local option of the routed Command.`

| Rejected declaration | Diagnostic | Rule |
| --- | --- | --- |
| Two marked options in one Application | `Global option "input" and plugin "@acme/batch" option "quiet" both declare interaction. Mark one option.` Each option is named as [Input declaration errors](options.md#input-declaration-errors) names it, and the fault throws from the call that brings the second mark into the Application, as a [spelling collision](options.md#declaration-and-invocation-errors) does. | `@loomcli/core/interaction-mark` |

The types reject `interaction` on `option()` and on every option type but `boolean`, and `required: 'non-interactive'` on an argument, a multiple, content, Boolean, or counted option, and a global option.

### Interaction acceptance

- **The decision.** With stdin and stderr terminals and no mark, `interactive` is `true`. It is `false` with stdin piped, with stderr redirected, under `--no-input` from the interaction plugin, under its bound variable set to `false`, from the configuration source, under `app.invoke`, under an action's `invoke`, and in an MCP tool call. A piped stdout leaves it `true`, and a marked option that reads `true` with stdin piped leaves it `false`.
- **Conditional requiredness.** With interaction off, an omitted `required: 'non-interactive'` option fails with exit 2 before the action and the sentence above, beside any other input problem in authoring order, by declared name under `invoke` and in an MCP tool call, and a supplied one validates and reaches the action. With interaction on, the omitted option reaches the action as `undefined`. Each declaration error above throws from its call, and help, the manifest, and the MCP schema print the facts above.
- **`supplied` and `missingInputError`.** `supplied` matches the validation context's record for argv, environment, configuration, and by-name values, holds `undefined` for a defaulted option, and rejects writes at every depth. `missingInputError` builds both sentences by spelling and by name, and rejects a global option and an undeclared name.
