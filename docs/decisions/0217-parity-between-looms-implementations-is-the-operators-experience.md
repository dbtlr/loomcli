---
type: adr
title: ADR-0217 - Parity between Loom's implementations is the operator's experience
description: Loom's implementations are at parity when the same application gives an operator the same look and feel and the same features for the same arguments, environment, and files. A limit of the programming language belongs to the language and the application, and no implementation changes for it. The API an author writes against is idiomatic to each language and is not mirrored. An implementation differs from the reference implementation where following it would surprise an author who writes in that language, and each such difference is a named deviation. Until the implementations share a set of cases that states what an operator sees, the TypeScript implementation is the reference implementation, and a feature enters through it first.
status: accepted
created: 2026-11-22
modified: 2026-11-22
---

# ADR-0217 - Parity between Loom's implementations is the operator's experience

## Context

Loom is one framework, implemented natively in more than one programming language in this repository. TypeScript is the first implementation, a Rust implementation is joining it, and Go and Python are planned. A second implementation differs from the first in many small ways. Without a rule, each difference becomes an argument about whether it is a defect.

[The principles](../principles.md) rank above this record. They and the reference pages are written for the TypeScript implementation today, so what they say about Node, Bun, and the JavaScript ecosystem binds that implementation.

## Decision

This record binds every [implementation](../glossary.md#implementations).

- **Parity is the operator's experience.** Implementations are at parity when the same application, written against each, gives an [operator](../glossary.md#people) the same experience for the same arguments, environment, and files: the same look and feel, and the same features for a person or an agent.
- **A limit of the programming language is not part of that experience.** Such a limit belongs to the language and to the application. Examples are the largest integer a language holds exactly, a string type that cannot hold a lone surrogate, a number beyond a double, the nesting depth a parser accepts, and the order JavaScript gives to integer-like keys. A difference that comes from such a limit is neither a defect nor a named deviation, and no implementation changes for it. Where a reference page states what an operator sees at such a limit, that statement binds the TypeScript implementation alone.
- **Author APIs are idiomatic and not mirrored.** The API an [author](../glossary.md#people) writes an application against follows the conventions of its programming language.
- **An implementation deviates where its authors would be surprised.** An implementation differs from the reference implementation where following it would surprise an author who writes in that language. Each such difference is a named deviation, recorded for that implementation with its reason. It may be a difference an operator sees.
- **A difference an operator gets is otherwise a defect.** A difference that changes what an operator gets, and is neither such a deviation nor a limit of the language, is a defect in what Loom ships. Whether a given difference is one is judged as any finding is, by [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write) and [principle 8](../principles.md#8-depth-follows-reach).
- **TypeScript is the reference implementation for now.** Until the implementations share a set of cases that states what an operator sees, the TypeScript implementation is the reference implementation. Its documents are the specification, and its tests decide what the correct behavior is. A feature enters through TypeScript, and another implementation follows. When a difference shows a defect in the reference implementation, the reference implementation is fixed first.

## Considered options

- **Equal bytes at every input, the limits of each language included.** Rejected. A limit of the language belongs to the language and the application, and it is not part of the operator's experience.

## Status

Accepted on merge. It governs how Loom's implementations are held to one another, which no release ships, so it binds from the merge rather than from a release cut.

## Changelog

- 2026-11-22: Accepted. It supersedes no record.
