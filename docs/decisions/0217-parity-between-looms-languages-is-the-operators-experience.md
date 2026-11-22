---
type: adr
title: ADR-0217 - Parity between Loom's languages is the operator's experience
description: Loom's implementations in different languages are at parity when the same application gives an operator the same look and feel and the same features for the same arguments, environment, and files. A limit of the language is the language's and the application's, and no implementation changes for it. The API an author writes against is idiomatic to each language and is not mirrored; each departure from the reference is recorded for its language. Until the implementations share a set of cases that states what an operator sees, the TypeScript implementation is the reference, and a feature enters through it first.
status: accepted
created: 2026-11-22
modified: 2026-11-22
---

# ADR-0217 - Parity between Loom's languages is the operator's experience

## Context

Loom is one framework, implemented natively in more than one language in this repository. TypeScript is the first implementation, a Rust implementation is joining it, and Go and Python are planned. A second implementation differs from the first in many small ways. Without a rule, each difference becomes an argument about whether it is a defect.

## Decision

This record binds every implementation, in every language.

- **Parity is the operator's experience.** Parity between implementations is what an [operator](../glossary.md#people) gets: the look and feel, and the features a person or an agent gets. The same application, written in each language, gives the same experience for the same arguments, environment, and files.
- **A limit of the language is not part of that experience.** Such a limit belongs to the language and to the application. Examples are the largest integer a language holds exactly, a string type that cannot hold a lone surrogate, a number beyond a double, the nesting depth a parser accepts, and the order JavaScript gives to integer-like keys. A difference that comes from a limit of the language is not a deviation, and no implementation changes for it.
- **Author APIs are idiomatic and not mirrored.** The API an [author](../glossary.md#people) writes an application against follows the conventions of its language. An implementation departs from the reference where following the reference would surprise an author who writes in that language, and each departure is recorded for that language.
- **Any other difference is a defect.** A difference that changes what an operator gets, and is neither a recorded departure nor a limit of the language, is a defect in the implementation that differs, under [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write).
- **TypeScript is the reference for now.** Until the implementations share a set of cases that states what an operator sees, the TypeScript implementation is the reference. Its documents are the specification, and its tests decide what the correct behavior is. A feature enters through TypeScript, and the other languages follow.

## Considered options

- **Equal bytes at every input, the limits of each language included.** Rejected. A limit of the language belongs to the language and the application, and it is not a difference in what an operator experiences.
