---
type: adr
title: ADR-0001 - Core owns its parser, graph, and rendering, and does not build on Clap
description: loomcli-core implements the reference grammar, command graph, and rendering itself. Clap is not a dependency, because its parser, error model, and built-in help each conflict with a rule of the reference contract.
status: accepted
created: 2026-11-12
modified: 2026-11-12
---

# ADR-0001 - Core owns its parser, graph, and rendering, and does not build on Clap

## Context

The port has two ways to parse an invocation: build on Clap, the standard Rust argument parser, or implement the reference's own grammar. The goal that decides it is one consistent interface: an operator or an agent moving between a TypeScript Loom application and a Rust one meets the same grammar, the same messages, the same exit codes, and the same projections.

Core implements the grammar itself. Five rules of the reference contract cannot be met through Clap without disabling or re-deriving the part of Clap that would have been the reason to use it:

- **Held faults.** After the first structural fault, the reference parser keeps reading so every global option is found, and raises the fault only at the dispatch boundary. That is how `app get --help` prints help while `get` is missing an argument, and how `--format json` still selects the failure encoding. Clap stops at the first error.
- **Routing on globals, then one table.** A global option is accepted before, between, and after command names; a parent's own option rebinds to the routed command by its typed spelling; an option's value outranks a command name. The typed spelling (`-h` or `--help`) is a fact middleware reads. Clap's subcommand model fixes where an option may appear and does not expose the spelling.
- **One parser for a partial invocation.** Completion reads a partial command line with the same grammar the run uses, so a candidate list never disagrees with the parser. Clap's completion is a separate engine.
- **Input tiers.** argv, environment, a configuration source, and the declared default resolve through one stage, and an option group withdraws lower-tier members before validation. Clap resolves environment and defaults inside its parser with its own precedence.
- **Every rendered byte passes through one view registry.** Usage failures are public failure classes with replaceable views and machine encoders. Clap renders its own errors and help and exits the process itself.

Building on Clap would leave core holding a second model of every command and option, kept in step with Clap's, with Clap's rendering switched off. The parser is a small share of the framework; the graph, the plugin contract, and the projections are the bulk, and Clap offers none of them.

## Considered options

- **Build on Clap's builder API and translate its errors.** Rejected for the five rules above. The translated errors would still follow Clap's grammar at the edges, so the interface would differ from the reference in ways an operator notices.
- **Use Clap's lexer (`clap_lex`) alone.** Rejected. The reference tokenization is short and specific, such as `-5` being a plain word and a short group following POSIX `getopt`, and a dependency that must be configured to match it is more to maintain than the rule itself.
- **Offer a Clap adapter beside the native parser.** Rejected as a second mechanism for one concept.

## Consequences

Core carries a parser, and its tests are the reference's parser tests. An author who knows Clap learns a different declaration API; [ADR-0004](0004-one-dynamic-builder-and-a-derive-that-expands-to-it.md) keeps that API close to what a Rust author expects.

## Status

Accepted on 2026-11-12. The code that enforces this record has landed: `loomcli-core` holds its own parser (`invocation::parse`), the command graph, and the view registry, depends on no Clap crate, and the completion plugin reads partial command lines through core's `locate`.
