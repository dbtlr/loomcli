---
type: adr
title: ADR-0003 - Global options are one application-owned value, and nothing inherits along a path
description: The globals table lives on the graph once and is consumed in a pre-scan before routing. A local option reaches its own Command's action alone, and the first hyphen token commits routing.
status: accepted
created: 2026-09-07
modified: 2026-09-08
---

# ADR-0003 - Global options are one application-owned value, and nothing inherits along a path

## Context

Most command frameworks let a parent's options flow down to its children. That makes a Command's contract depend on where it is mounted, which is exactly the coupling ADR-0001 removes.

Loom has two ownership levels and no inheritance between Commands. A `GlobalOptions` value is declared once, passed to every Command as a value, and held on the graph once. It is never copied into a Command, never appears inside a `CommandNode`, and reaches every action with one type. A local option is declared on one Command and reaches that Command's action alone. A group therefore cannot declare a local option, because no handler could receive it, and build rejects the declaration.

Invocation reads tokens in phases. The pre-scan consumes global spellings anywhere before the first bare `--` and removes them from the router stream. Routing then reads bare tokens from the root downward, and the first hyphen token commits to the Command reached so far. Later bare tokens are positional inputs for that Command even when they match a child's name. Values win over route names.

## Considered options

- **Copying the globals into every Command's spelling table.** Rejected. It was the earlier specification's approach. One table keeps one definition of each global and lets a diagnostic name the owner precisely.
- **Inherited parent options.** Rejected. A Command's `options` type would depend on its mount point, and a module could not know its own handler type without importing the application.
- **Router lookahead past a local option to find a later command name.** Rejected. Commands may reuse spellings with different value shapes, so a lookahead cannot tell a value from a route without parsing every candidate. Committing at the first hyphen token keeps selection explicit.

## Consequences

Local options on separate Commands can reuse names and spellings with different shapes. A global and a local option cannot share a key or a spelling. A short group that mixes a global letter with a non-global letter is a usage error, `ShortGroupError` with reason `'mixed-scope'`, because the pre-scan reads the globals alone.

## Changelog

- 2026-09-08: ADR-0013 and ADR-0017, proposed, add plugin options to the globals table. They share the table, the pre-scan, and the collision rules with the application's global options, and `inspect()` lists both kinds in `globals`, but a plugin option reaches its own plugin's middleware alone and never an action. `OptionNode` gains `scope`, `'application'` or `'plugin'`, so a projection can tell which entries reach an action without the graph naming a plugin. The mixed-scope short group diagnostic keeps saying "global option" for a plugin letter, because the pre-scan reads one table. The two ownership levels, the absence of inheritance, and the routing rules are unchanged. This entry binds when ADR-0017 is accepted.
