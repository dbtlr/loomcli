---
type: adr
title: ADR-0056 - An option alias is an unadvertised long spelling of one option
description: An option declares aliases, each one more long spelling that binds the one option it belongs to. An alias is unadvertised, as a Command's alias is under ADR-0002, so no listing shows it, and it carries no deprecation message of its own.
status: proposed
created: 2026-10-04
modified: 2026-10-04
---

# ADR-0056 - An option alias is an unadvertised long spelling of one option

## Context

An option has one long spelling, derived from its declared name, and an optional short alias. A renamed option therefore cannot keep its old spelling. The only workaround is a second option under the old name, which the action merges with the new one. Each of the two options then resolves its own input sources, so an environment variable bound to the new option can override a value the operator typed under the old spelling. textstat shipped that workaround as a deprecated `--minimum` merged with `--min-bytes` by `Math.max`, and `TEXTSTAT_MIN_BYTES=5 textstat --minimum 1` applied 5.

A Command already has aliases under [ADR-0002](0002-command-graph-is-a-tree-with-hidden-aliases.md): unadvertised synonyms that route to the one Command. An option alias follows the same doctrine. The `aliases` key on an option's config declares bare names, and each name adds its long spelling, plus the negative spelling when the option's polarity generates one, to the table the option's other spellings sit in. The spelling binds the declared option, so the action key, repetition, input sources, and validation see one option whichever spelling the operator typed. A fault the parser finds names the spelling the operator typed, as it does for a short alias, and a fault validation finds names the option's canonical spelling. Help, the manifest, completion, and suggestions never list an alias. `locate` resolves one, and `inspect()` publishes the declared names as `aliases` on the option's node, as it does for a Command.

An alias name follows the rule the option's own declared name follows, because both become a long spelling of one option. `shortOnly` removes every long spelling, so it cannot combine with an alias.

## Considered options

- **A deprecation message on each alias.** Rejected. ADR-0002 already rejected advertised aliases with deprecation messages. A deprecation message is shown beside the member in a listing, and no listing shows an alias, so the message would have nowhere to appear. An option that is itself retired keeps its own `deprecated` fact.
- **A second option merged in the action.** Rejected. Two options resolve their sources separately, so precedence breaks across the old and new spellings, and every projection lists the old option as its own member.
- **An alias that adds only the positive long spelling.** Rejected. Renaming a Boolean option that declares a negative form would then break `--no-<old>`, which is the spelling the rename was meant to keep.
- **Portable names for option aliases, as Command aliases use.** Rejected. An alias is a long spelling of an option, so it answers the option name rule, and an alias could not otherwise keep an option name that the portable rule refuses.

## Status

Proposed 2026-10-04 with the contract in [Option aliases](../core.md#option-aliases). It moves to accepted inside the release PR of the release that ships the implementation: an alias of a local, global, plugin, or hook-declared option binding that option, `TEXTSTAT_MIN_BYTES=5 textstat --minimum 1` applying 1, help, the manifest, completion, and suggestions listing no alias, and the alias declaration faults marking the alias, under Node and Bun.
