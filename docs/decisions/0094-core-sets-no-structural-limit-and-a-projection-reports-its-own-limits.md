---
type: adr
title: ADR-0094 - Core sets no structural limit, and a projection reports its own limits
description: Core caps neither how deep a Command path nests nor how deep a declared default nests. A projection that cannot serve a shape the author declared, such as an MCP tool name longer than the protocol allows or a man page file name the file system cannot hold, reports it in a Developer Diagnostic that names the projection and the Command path. One example application gains a three-level path. It supersedes ADR-0035 and ADR-0053.
status: proposed
created: 2026-10-20
modified: 2026-10-22
---

# ADR-0094 - Core sets no structural limit, and a projection reports its own limits

## Context

Two records cap the shape of what an author declares. [ADR-0035](0035-a-command-path-nests-at-most-two-levels-below-the-root.md) holds a Command path to two levels below the root, so `app a b c` is a declaration error. Its reasons were that an operator cannot discover a deep path and that every walk over the graph must handle any depth. [ADR-0053](0053-a-declared-default-nests-at-most-ten-levels.md) holds a declared default to 10 nested arrays and plain objects and rejects a default that holds itself, because each reader of the default walks it recursively and a deep enough default overflows the call stack.

Both caps are Loom's opinion about the author's structure. Principle 4 lets a rule prescribe how an author builds only when a projection cannot work without it, and has the rule name that projection. Real applications nest deeper than two levels: `gh repo deploy-key add` is three levels below `gh`. A walk over the graph is bounded by the graph the author wrote, so a depth cap protects no reader that the graph itself does not already bound. A default deep enough to overflow a stack, or one that holds itself, is the author's value. Principle 1 lets it fail through the ordinary failure path, as the platform reports it.

Some limits are real, and they belong to a projection. The MCP plugin flattens a path into a tool name, and a protocol limit on its length is the plugin's to state. The manpage plugin names a page file from the path, and a file system limit on its name is that plugin's to state. When core enforces a limit for them, the fault names the wrong owner, and an author cannot tell which projection needs the shape changed.

## Decision

- **No nesting cap.** `command()` attaches a child at any level, whether or not the child has children of its own, and core accepts a path of any depth: routing, validation, help, the manifest, and completion serve it. Each projection plugin, such as man pages or MCP, either serves the path or reports its own limit, as the next bullet states. `@loomcli/core/nesting-depth` goes.
- **No default depth cap.** A declared default nests as deep as the author writes it. `@loomcli/core/default-depth` goes. A default that holds itself, or that nests deeply enough to overflow a reader, fails with the platform's own error where the declaring call copies it or where a reader walks it, as any author value that overflows the stack does.
- **A projection reports its own limits.** A projection that cannot serve a shape the author declared reports it in a Developer Diagnostic that names the projection and the Command path. A projection plugin reports it as a declaration fault through its `onGraphBuilt` hook under [ADR-0060](0060-ongraphbuilt-judges-the-built-graph-and-never-contributes.md), as the MCP plugin already reports two Commands that flatten to one tool name. Examples are an MCP tool name longer than the protocol allows and a man page file name the file system cannot hold. Core states no limit on a projection's behalf.
- **An example nests three levels.** One example application gains a three-level Command path, so routing, help, completion, and the projections it installs run on a path deeper than two levels in CI.

This record supersedes ADR-0035 and ADR-0053 whole. Neither keeps a provision that binds without its cap. ADR-0053's rule that a converter's input schema takes no cap, under [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md), stands as ADR-0030 states it.

## Considered options

- **Raise the caps.** Rejected. A higher constant is still Loom's opinion about the author's structure, and it still names core as the owner of a limit no core reader needs.
- **A public, configurable cap.** Rejected, as ADR-0035 rejected it: it is a second way to shape one job, and every projection must still handle any depth.

## Consequences

Removing a cap relaxes a rule, so an application that builds today builds unchanged. An application may now nest Commands deeper than two levels, and a projection plugin that cannot serve the result says so at build. [ADR-0078](0078-the-completion-plugin-installs-a-script-and-one-startup-line-per-shell.md)'s reason for taking the shell as an argument of `completion install` no longer holds, and the shape stays as [ADR-0101](0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md) carries it forward.

## Status

Proposed. It moves to accepted with the release that removes both caps and ships the example's three-level path, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
- 2026-10-22: Build no longer snapshots a converter's input schema, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md), so the sentence on ADR-0053's rule says that the schema takes no cap rather than that its snapshot takes none.
