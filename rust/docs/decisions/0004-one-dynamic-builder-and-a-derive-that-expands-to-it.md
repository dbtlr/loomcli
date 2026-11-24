---
type: adr
title: ADR-0004 - Declarations are one dynamic builder, and a derive that expands to it carries the types
description: Application and Command are immutable builder values that produce the command graph. A derive on an input struct expands to those builder calls and to a typed extraction, so an action reads typed fields while plugins and the graph use the one dynamic representation.
status: accepted
created: 2026-11-12
modified: 2026-11-12
---

# ADR-0004 - Declarations are one dynamic builder, and a derive that expands to it carries the types

## Context

In the reference, a fluent builder declares a Command, and TypeScript infers the action's argument and option types from the accumulated calls. Rust has no structural inference across a builder chain. The port needs the reference's two properties at once: a fluent declaration that reads like the reference, and an action whose inputs are typed by the declaration.

There is one runtime representation. `Application` and `Command` are builder values: each call consumes the value and returns the next, and the result is the command graph. Plugins declare options and attach commands through the same builder, and `on_command_attach` hooks receive it.

```rust
pub fn select() -> Command {
    Command::new("select")
        .description("Keep the named fields of the document.")
        .extend([HELP_COMMAND.value(HelpCommandFacts::new().section(&["Document commands", "Reshape"]))])
        .inputs::<SelectInputs>()
        .action(select_fields)
}
```

A struct carries the types. `#[derive(Inputs)]` expands to the builder calls for each field and to an extraction that fills the struct from the validated invocation. The field type decides the declaration: `bool` is a Boolean option, `u8` under `count` is a counted option, `Vec<T>` is a multiple option or a variadic argument, `Option<T>` is optional, `Content` is a content input, and a validator's output type is the field type.

```rust
#[derive(Inputs)]
struct SelectInputs {
    /// The document to read. Omit it to read piped text.
    #[option(short = 'f', stdin)]
    file: Content,
    /// A field to keep. Repeat it for several.
    #[option(short = 'F', required, validate = text())]
    field: Vec<String>,
}

async fn select_fields(ctx: Context<SelectInputs>) -> Outcome {
    let document = ctx.inputs.file.text().await?;
    // ...
}
```

The derive adds nothing the builder cannot express: the same declaration is writable by hand as `.option("field", Opt::string().short('F').required().multiple().validate(text()))`, with the action reading `ctx.option::<Vec<String>>("field")`. The dynamic read is what a plugin uses for an option it did not declare.

The reference's compile-time authoring order (arguments or children, action last) becomes typestate where it is cheap and a declaration fault at the call where it is not. Dropped builder results are caught by `#[must_use]`.

## Considered options

- **Builder only, with stringly-typed reads.** Rejected as the main lane. A misspelled name or a wrong type would surface when the action runs, and the principle ranks types first.
- **Derive only, as Clap's derive does.** Rejected. Plugins contribute options to commands they have never seen, and the graph must exist as data, so a dynamic builder exists regardless; hiding it would give plugins a second API.
- **Typed keys declared as constants and passed to both the declaration and the read.** Rejected. Every input would be declared in two places, the constant and the builder call.

## Consequences

The workspace carries a procedural-macro crate. The derive's expansion is part of the public contract, because an author may write it by hand.

## Status

Accepted on 2026-11-12. The code that enforces this record has landed: `Application` and `Command` are the one builder, `loomcli-derive`'s `#[derive(Inputs)]` expands to its calls against public items alone, and plugins and hooks declare through the same builder.
