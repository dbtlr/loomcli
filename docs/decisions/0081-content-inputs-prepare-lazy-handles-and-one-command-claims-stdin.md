---
type: adr
title: ADR-0081 - Content inputs prepare lazy handles with at most one stdin target per Command
description: Native content arguments and local options prepare lazy file handles, and at most one input per Command may claim nonterminal stdin. Core checks paths, presence, and content collection bounds before middleware, holds their input problems until dispatch, and publishes the declaration facts on the graph.
status: accepted
created: 2026-10-14
modified: 2026-10-16
---

# ADR-0081 - Content inputs prepare lazy handles with at most one stdin target per Command

## Context

Commands that read documents need file paths, piped input, or both. A path validator checks one supplied word, but cannot express source assembly for a collection. Under [ADR-0036](0036-each-value-passes-the-same-validator.md), an action checks whether files or stdin are present. Separate helpers in textstat and jsonkit then repeat source selection and lazy reads.

A native content input gives those Commands one declaration for supplied paths, source presence, and stdin placement. The action chooses when and how to read content. Ordinary value inputs keep Standard Schema validation.

## Decision

### Declarations and action values

An argument or local option declares `type: 'content'`. Each supplied word is a file path, and each action value is a lazy `Content` handle. A scalar receives one handle, or `undefined` when optional and absent. A collection uses the existing `variadic: true` or `multiple: true` declaration and receives an array of handles.

Content inputs declare no custom `validate`, `validateOmitted`, default, or implied value. They are local inputs, never global options. Checks that read content belong to the action.

A content option uses the existing value class of a string option that takes a separate value. Routing and parent-to-child binding follow [ADR-0055](0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md) and [ADR-0057](0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md). Content adds no new parsing class.

An input carrying `stdin: true` is its Command's stdin target. A Command may instead declare `.stdin({ description, required })`, a stdin-only input that consumes no word. The action context and the middleware's request expose its handle separately as `stdin`, with `undefined` for an absent optional declaration. Content argument and option handles remain in the ordinary argument and local option values.

A Command has at most one stdin target. A second `stdin: true` input, a second `.stdin()` declaration, or a combination of the two is a declaration fault. The claim belongs to that Command and does not inherit.

`min` and `max` are source-count bounds on content collections alone. Core checks them after stdin assembly. `required: true` means at least one assembled source, including stdin. Other collection rules remain the action's business.

An optional content collection with no sources receives `[]` unless `min` is positive. A positive `min` applies to zero sources too, so that absence fails the minimum requirement.

### Source assembly

Content source assembly runs after the ordinary input-source stage has filled options from the environment and configuration. Stdin assembly adds no environment or configuration tier and changes no source precedence.

Available stdin means an argv invocation whose `host.terminal.stdin.isTTY` is false. Core uses this host fact without reading stdin or inferring whether bytes are waiting. An empty nonterminal stream is still an available source. An invocation by name has no available stdin, regardless of its internal placeholder stream.

With no stdin target, content handling leaves stdin unread. A scalar target uses its explicit path when argv, the environment, or configuration supplied one. Otherwise available stdin fills it. Unused nonterminal stdin does not reject a scalar explicit path.

A collection target keeps its file entries in supplied order and automatically appends available stdin, unless explicit `-` already places stdin. Only the stdin target accepts `-`; another content input rejects it. A literal file named `-` is addressed as `./-`.

Explicit `-` requires available stdin. Terminal stdin produces an input issue before the action, rather than starting keyboard interaction. Repeated `-` entries remain separate entries at their supplied positions, sharing one stream. Core adds no deduplication, buffering, or replay.

Scalar content options keep existing environment and configuration binding semantics, including argv precedence, empty environment values, and failures from a supplying tier. Multiple content options keep the existing prohibition on environment binding. Source-filled paths are explicit values for assembly, and an invalid explicit path never falls back to stdin.

Automatically appended stdin counts even when files were supplied. Three files with `max: 3` and available stdin therefore fail the bound. A required collection with no paths succeeds with empty nonterminal stdin, because requiredness counts sources rather than bytes.

### Preparation and lazy reads

Core resolves paths against `host.cwd` using the host platform's path rules and follows symlinks. A supplied file source must exist, be readable, and not be a directory. Readable FIFO and device sources are accepted, including sources used by process substitution.

Preparation probes metadata and readability without opening or reading content. When no source is supplied or assembled, requiredness or a positive `min` produces an `InputProblem` with reason `missing` and no issues. An invalid supplied path, an unavailable explicit `-`, or a count violation with nonzero sources produces reason `invalid` with ordinary issues. Native content issues carry no code, preserving [ADR-0048](0048-a-validator-package-declares-one-issue-code-per-sentence.md). Core aggregates content problems with other validation problems in one `InputError`, with exit 2.

Preparation runs inside the held validation phase before middleware. Its faults reach the dispatch boundary, so a help or version takeover can complete without raising them. A rejected path is never rescued by available stdin. A successful probe does not promise that a later read will succeed after the filesystem changes.

Each `Content` handle exposes these facts and reads:

- `kind`: `file` or `stdin`.
- `name`: the original file spelling or `stdin`.
- `path`: the resolved absolute file path, or `undefined` for stdin.
- `text()`: read the remaining content as UTF-8 text.
- `stream()`: obtain a readable byte stream.

Creating a handle reads no content. Each file read opens afresh. Stdin handles share the invocation's existing stream at its current position. A read to EOF leaves later stdin reads empty, and a partial read leaves the remainder. Core adds no size limit or time limit.

### Invocation by name and projections

`invoke()` and MCP calls supply file paths and receive file handles. They neither append stdin nor accept `-`, which produces an `InputError`. A required stdin-only input fails these calls. An optional stdin-only input is absent. MCP transport stdin never becomes content input, and this decision adds no stream-supplying API to `invoke()`.

Named calls reject paths resolving to the process stdin pipe or device, including `/dev/stdin` and symlinks when they resolve to that source. Ordinary regular-file paths open independently and remain allowed, even when stdin is redirected from the same file. Other readable FIFO and device sources remain accepted, and argv calls keep their existing source rules. Preparation probes metadata without reading content; actions control later reads through accepted handles.

The author decides whether a Command opts into MCP. Core adds no automatic restriction on opting in a Command that requires stdin. Its named call fails through the ordinary input failure path.

The graph carries native content type, stdin claims, standalone stdin description and requiredness, and content collection bounds as core facts. Each native content path publishes `schema: { type: 'string', minLength: 1 }`. The schema describes a caller's supplied path rather than the handle an action receives. Collection flags and bounds remain separate facts. MCP's whole tool `inputSchema` remains a separate projection.

Help describes standalone stdin in an Input section, with requiredness and pipe or redirection examples. Content input rows describe automatic stdin inclusion and explicit `-` placement when they claim stdin. Machine projections expose the declaration facts and describe supplied paths rather than handle objects.

## Superseded clauses

This record replaces only the following clauses. Each earlier record remains accepted for its other decisions.

- [ADR-0005](0005-validation-delegates-to-standard-schema.md): the claim that core has no native validation is narrowed for `type: 'content'`. Native content preparation needs no Standard Schema object, and content inputs reject `validate`.
- [ADR-0006](0006-absence-rules-and-no-lenient-input.md): `-` is a stdin operand only on the native content stdin target. Native content presence follows assembled sources, including stdin, rather than `validateOmitted` or an action check. Its default rules do not apply to native content, which rejects defaults.
- [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md): application ownership of file access and stdin reads is narrowed for native content preparation and the lazy reads its handles expose. Core performs file probes but reads no content before a handle is used.
- [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md): native content paths have a core-published input schema without a validator or a Standard JSON Schema converter. The graph remains the source for every projection.
- [ADR-0036](0036-each-value-passes-the-same-validator.md): native content collections need no per-value validator. Core checks their presence and count bounds after stdin assembly, before middleware. Ordinary collections retain per-value validation and action-owned collection rules.
- [ADR-0059](0059-a-command-runs-by-name-through-invoke.md): equivalence to argv input is narrowed for native content stdin. An invocation by name has no available stdin, even when called from an action whose argv invocation has one.

## Considered options

- **A file-or-stdin catalog validator.** Rejected. Per-value validation cannot assemble sources or place stdin within a collection without moving collection behavior into each action.
- **Keep source assembly in application helpers.** Rejected. The graph would omit requiredness and stdin claims, and projections could not describe those inputs from the declaration.
- **Require explicit `-` whenever files are supplied.** Rejected. A collection target deliberately combines supplied files with available stdin. Authors choose whether to claim stdin.
- **Read or peek at stdin to decide whether it counts.** Rejected. Empty input is a source, and source preparation must leave reads to the action.
- **Restrict file sources to regular files.** Rejected. Process substitution produces readable filesystem sources such as FIFOs and devices.
- **Add defaults, implied values, custom content validation, or named streams.** Rejected for this contract. They add source-selection or read behavior beyond the native input's purpose.

## Consequences

A collection that claims stdin also claims inherited nonterminal stdin, even when the operator supplied file paths. That stream may be empty or remain open. Automatic inclusion can affect source counts or cause a later action read to wait. Core deliberately makes no inference about pending bytes. The author controls this behavior by choosing whether the input claims stdin.

textstat replaces its file collection and stdin helper with native content. jsonkit replaces its helper and global `--file` with a content option on each document-reading Command, including its root action. Other Commands have no file option. The canonical example is `jsonkit select --file doc.json`. Since both the root and `select` declare `--file`, ordinary routing also accepts `jsonkit --file doc.json select`. Routing binds the root's own option to the child's option because both share one value class.

## Status

Accepted in 0.13.0.

## Changelog

- 2026-10-30: [ADR-0127](0127-a-multiple-option-binds-a-variable-whose-value-its-authors-delimiter-splits-into-the-list.md), proposed, narrows the prohibition on environment binding for a multiple content option: one binds a variable when its declaration also names `envDelimiter`, and each item the delimiter splits out is read as a path. The scalar content option's binding, argv precedence, and every other rule here stand. It binds when that record is accepted.
