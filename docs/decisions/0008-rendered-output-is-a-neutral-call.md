---
type: adr
title: ADR-0008 - Rendered output is a separate neutral call with a pure synchronous renderer
description: out.render(value, renderer) is the one presentation call. A Renderer turns one value into the exact bytes core writes and holds no output handle. The five semantic methods stay string-only with fixed destinations.
status: accepted
created: 2026-09-07
modified: 2026-09-07
---

# ADR-0008 - Rendered output is a separate neutral call with a pure synchronous renderer

## Context

Structured output needs a presentation step, and an application must own its presentation without owning the destination.

`out.render(data, renderer)` writes the renderer's text to stdout. A `Renderer<Data>` is a value with one `render` property that receives the data alone, returns a string, and is synchronous and pure. Core appends nothing and strips nothing, so the trailing newline belongs to the renderer. A rendered value has no semantic identity: no purpose parameter and no destination parameter. The five semantic methods keep their string-only signatures and their fixed default destinations. Call order within a destination holds across both forms.

A renderer failure rejects only its own call, later output still writes, and core reports one `InternalError` after the action with exit 1. An action failure stays primary over it.

## Considered options

- **Overloads on the semantic methods that accept a value and a renderer.** Rejected. It blurs "a message with a purpose" and "a value with a presentation", and it makes the data type harder to infer.
- **A purpose or destination parameter on `render`.** Rejected. A rendered value is neutral; the application decides what it is by choosing the renderer.
- **Text-first or factory-shaped renderer contracts from the long-term specification.** Rejected. One object with one `render` property is the smallest shape that infers its data type from the value.
- **A renderer that receives the output handle.** Rejected. A renderer that can write is a renderer that can write twice or to the wrong stream.

## Consequences

Formatters, tables, and terminal styling live in the application or in future plugins, not in core. The type parameter is inferred from the value, so a renderer for another type is a compile error.
