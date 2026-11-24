---
type: adr
title: ADR-0218 - The formatter declares --fields only on a Command it appended a json or jsonl view to
description: The formatter's hook declares --fields on a Command that declares a result only when it appended json, jsonl, or both to that Command's views. A Command whose author declares both views gets --format and no --fields, so its help page, inspect(), and completion list no option that could only fail, and an option named fields there is the author's. A group keeps its hidden --fields. This supersedes in part ADR-0183's rule that the hook declares fields beside every --format it declares.
status: proposed
created: 2026-11-24
modified: 2026-11-24
---

# ADR-0218 - The formatter declares --fields only on a Command it appended a json or jsonl view to

## Context

[ADR-0183](0183-a-middleware-may-set-one-result-transform-that-reshapes-a-result-before-its-view.md) has the formatter's hook declare `--fields` beside every `--format` it declares, and has `--fields` apply only under the `json` and `jsonl` views the hook appended. An author-declared JSON view is excluded, because its author shapes the data themselves. A Command whose author declares both `json` and `jsonl` therefore lists `--fields` on its help page and in `inspect()`, and every use of the option fails with exit 2: `Option "--fields" applies only to output the formatter provides, and the formatter provides none here. Remove the option.`

An application that declares its own json and jsonl views on every result Command advertises, on every one of those pages, an option that can never succeed. The MCP projection already leaves `--fields` off tool inputs, because it is a control option, so only the listings an operator reads carry it.

## Decision

- **Where the hook declares `--fields`.** On a Command that declares a result, the hook declares `--fields` after `--format` only when it appended at least one of `json` and `jsonl` to the Command's views. A Command whose author declares both gets `--format` over its views and no `--fields`. No setting changes this.
- **What follows.** That Command's help page, `inspect()` node, and completion list no `--fields`. An operator who types it gets core's unknown-option error, exit 2, as for any option the Command does not declare. An option named `fields` that the Command itself declares there is no longer the hook-collision build error, and the formatter's middleware leaves its value to its author. An Application's or another plugin's `fields` option is global, so it still collides with the `--fields` the formatter declares on every Command it appended a view to and, hidden, on the root and every other group.
- **What stays.** Every other rule of ADR-0183 stands. A Command with one formatter-appended view keeps `--fields`, and under the author's view `--fields` still fails with the refusal that names the formatter's view the Command has. A group keeps its hidden `--fields`: a group declares no result, so the hook appends no view to it, and its option exists so that routing binds an occurrence before the subcommand to the child's own `--fields`.

## Considered options

- **A setting that turns `--fields` off.** Rejected. Whether `--fields` can succeed follows from the views the hook appended, which the hook already knows, so a setting would let an author restate a fact or contradict it.
- **Keep the option and its refusal.** Rejected. A listing that offers an option whose every use fails misleads the operator and costs an agent a failed run to learn it.

## Consequences

This supersedes in part ADR-0183's **The formatter's `--fields`** clause that the hook declares `fields` beside every `--format` it declares, and its consequence that every Command the formatter gives `--format` gains `--fields`. ADR-0183 carries a dated entry. The wrong-view refusal's sentence for a Command with no formatter-appended view, `... and the formatter provides none here. Remove the option.`, has no run that reaches it and leaves the format plugin's message module. The [formatter reference](../plugins/format.md) and the glossary's Formatter entry carry the rule.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-24: Proposed with the formatter's `--fields` limited to Commands it appended a view to (LM-669). ADR-0183 carries a dated entry.
