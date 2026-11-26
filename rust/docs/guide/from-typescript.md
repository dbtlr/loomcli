---
description: For someone who knows the TypeScript Loom CLI. How each package and concept maps to the Rust port, the authoring differences, and the deviations register in summary.
---

# Coming from TypeScript

Loom CLI for Rust is a port of the TypeScript [Loom CLI](https://github.com/dbtlr/loomcli). The operator surface is the same: the grammar, every message, help page, table, exit code, manifest, MCP schema and result, completion answer, and file written on disk match the reference byte for byte, and the conformance cases captured from the reference examples check it ([ADR-0002](../decisions/0002-the-typescript-reference-is-the-behavioral-contract.md)); while the port catches up, the cases it has yet to match are listed in [behind.json](../../conformance/behind.json) ([ADR-0006](../decisions/0006-rust-tracks-the-shared-conformance-cases-it-is-behind-on-in-a-list-apart-from-deviations.md)). An agent that has learned one Loom application has learned them all, in either language. The authoring surface is Rust-native: it keeps the reference's vocabulary and its fluent shape, and uses Rust's own mechanisms where TypeScript's do not exist.

The reference's documents under `docs/core`, `docs/plugins`, `docs/libs`, and `docs/toolchain` still describe the behavior. This page tells you where each thing lives in Rust; [docs/deviations.md](../deviations.md) lists every place the port chooses to behave differently, and [behind.json](../../conformance/behind.json) the cases it has yet to match.

## Packages and crates

| TypeScript package | Rust crate | Notes |
| --- | --- | --- |
| `@loomcli/core` | `loomcli-core` | The crate root re-exports every public name, as the reference's one barrel does. It owns its parser and does not build on Clap ([ADR-0001](../decisions/0001-core-owns-its-parser-and-does-not-build-on-clap.md)). |
| `@loomcli/core` (`style`) | `loomcli-style` | Re-exported by core as `loomcli_core::style`. |
| TypeScript's inference | `loomcli-derive` | `#[derive(Inputs)]` and `#[derive(Failure)]`, re-exported by core. |
| `@loomcli/validators` | `loomcli-validators` | |
| `@loomcli/plugins` | `loomcli-plugins` | One module and one Cargo feature per plugin in place of one subpath each. |
| `@loom/mcp` (private) | `loomcli-mcp` | |
| `@loomcli/prompts` | `loomcli-prompts` | |
| `@loomcli/testing` | `loomcli-testing` | |
| `@loomcli/loom` | `cargo-loom`, not in this tree | The `loom` bin is the cargo subcommand `cargo loom`. The crate stays out of the workspace until its adapter is designed (see [Shipping](shipping.md#the-toolchain-is-not-in-this-tree)). |
| `@loomcli/eslint-plugin` | none | Its rules become compile errors, call faults, a `clippy.toml`, and a test (see [Lint rules](#lint-rules)). |

## Concepts

| TypeScript | Rust |
| --- | --- |
| `new Application(name, { description, version, plugins })` | `Application::new(name).plugins((…)).description(…).version(…)`. Each call consumes the value and returns the next one. `plugins` comes first and once. |
| `new Command(name, {...})`, `argument()`, `option()`, `command()`, `action()` | `Command::new(name)` with the same calls. A type state replaces the typed authoring order: `argument()` after `command()`, or any call but `extend()` and `views()` after `action()`, does not compile. |
| `args` and `options` inferred from the chain | A struct with `#[derive(Inputs)]`, applied by `inputs::<I>()` and read as `context.inputs`. The builder calls stay available, read by name with `context.option::<T>(name)` ([ADR-0004](../decisions/0004-one-dynamic-builder-and-a-derive-that-expands-to-it.md)). |
| `globalOption()` and `Register` | `global_option()`, or `globals::<G>()` with a derived struct, read back with `context.globals::<G>()`. |
| The option config object (`type`, `short`, `env`, `required`, …) | One builder per kind, `Opt::string()`, `Opt::boolean()`, `Opt::count()`, `Opt::content()`, each with the setters its kind takes. |
| A Standard Schema validator | The `Validator` trait: `validate(&str, &ValidationContext) -> Result<Output, Vec<Issue>>`, plus `input_schema()`. Validators are synchronous. |
| An async action | An `async fn` or closure taking `Context<I, R>` and returning `Outcome`, `Result<(), Error>`, on tokio ([ADR-0003](../decisions/0003-a-run-is-asynchronous-on-tokio.md)). |
| `run()` | `run(RunOptions)`; `main()` builds a runtime and returns `std::process::ExitCode`; `main_async()` runs inside a runtime the program owns. |
| `invoke()` | `Application::invoke(path, values, options, process)` and `context.invoke(path, values, options)`. Values are JSON. |
| `result({ views })`, `rows({ views })` | `.result(ResultViews::new().view(…))` and `.rows(RowViews::new().view(…))`. The value or row type is `Serialize`. |
| `view(identity, def)`, `override(key, view)` | `view(identity, View::new(…))` and `override_view(key, view)`. |
| The application's `views` option | `Application::overrides([...])`. |
| A failure class and its prototype chain | A struct with `#[derive(Failure)]` holding its parent class in a `#[failure(base)]` field. `failure.is::<F>()` and `downcast_ref::<F>()` walk the chain as `instanceof` does. |
| A thrown foreign error and a translator | An `Err` of any `std::error::Error`, converted by `?`, and `translate(|e: E| Ok(MyFailure::new(e)))`, which matches that exact type. |
| `plugin(identity, definition)` | `Plugin::new(identity)` with one setter per capability; a factory function returns it ([ADR-0005](../decisions/0005-a-plugin-is-a-value-any-crate-exports.md)). |
| `extension(identity, { schema, target })` | `Extension::new(identity)` or `Extension::collecting(identity)`, a constant typed by its target and its `Serialize + DeserializeOwned` value type, with `.check(fn)` for value rules. |
| A middleware loaded lazily on activation | A function registered with `middleware(Activation, handler)`. Nothing loads; the activation still decides whether it joins the chain. |
| `next()`, called at most once | `next.run().await`, which consumes `next`. |
| `AbortSignal` and `cancel()` | `context.signal` (a `RunSignal` over a `CancellationToken`) and `context.cancel()`. |
| `onShutdown`, `onSuspend`, `onResume` | `context.on_shutdown`, `on_suspend`, `on_resume`; handlers are synchronous. |
| `mockProcess` and the context builders | `mock_process(MockFields)`, `action_context`, `middleware_context`, `failure_hook_context`, `provider_context`, `view_context`. |
| `assertAssembles` | `assert_assembles(&app)`, plus `assert_described(&app)` for the `undescribed` rule. |
| A provider and module mocking in tests | `Provider::new` or `Provider::persistent`, shared through a factory function, and `RunOptions::substitute(&provider, opener)` in tests. |
| `__LOOM_RELEASE__` | `LOOM_RELEASE`, set by `cargo loom build` and baked by core's build script. |
| A skills folder baked in by `loom build` | Embedded data: `SkillFile::embedded(path, include_bytes!(…))`. |

Rust casing and reserved words rename a few calls: `override` is `override_view`, the pack's `box` view is `boxed`, `globalOption` is `global_option`, and `new DeclarationError(sentence)` is `DeclarationError::sentence_only(sentence)`. The [core API design](../design/core-api.md#naming-differences) lists them.

## Lint rules

| ESLint rule | Rust form |
| --- | --- |
| `discarded-declaration` | `#[must_use]` on every builder, so the compiler warns. |
| `name-shape` | A declaration fault at the call. |
| `host-bypass` | A `clippy.toml` `disallowed-methods` list that `cargo loom init` writes. The toolchain is not in this tree. |
| `undescribed` | `loomcli_testing::assert_described`, a test the application keeps. |
| `strict-configuration-schema` | serde's default, which ignores unknown keys. |
| `unrooted-configuration` | The root markers live in `config::Scope::Project { root }`, so the choice shows at the call. |

## Deviations in summary

The register, [docs/deviations.md](../deviations.md), holds one row per difference with its reason. Its themes:

- **Rust-only diagnostics.** The eight rules are `@loomcli/core/passthrough-declared-twice`, `@loomcli/core/terminal-need-declared-twice`, `@loomcli/core/option-config`, `@loomcli/core/plugin-option-name`, `@loomcli/core/input-read`, `@loomcli/core/handler-registered-twice`, `@loomcli/core/entry-point`, and `@loomcli/core/result-transform`. Rust checks some rules at declaration or read time that TypeScript checks at compile time. `entry-point` checks how the application starts its runtime, and `result-transform` checks a typed transform when the result is emitted. A persistent provider using an ephemeral one still fails at compile time. Some faults become unreachable (`command-attached-twice`, `foreign-value`, `foreign-graph`).
- **A declaration fault panics.** A fault at an authoring call panics at the author's line with the whole Developer Diagnostic as the message, and the process exits 101 under Rust's panic header, where the reference's uncaught throw exits 1. Build faults still render through `run()` and exit 1.
- **Diagnostics speak Rust.** A finding rebuilds the declaration as Rust builder calls, and a defect's evidence is the Rust error chain and a captured backtrace.
- **Futures run when awaited.** An output call writes when it is awaited, a `Next` future decides its liveness when first polled, and a panic in author code is Rust's own report, which core does not catch.
- **Validators are synchronous**, and `text().pattern` compiles with the `regex` crate after translating the ECMAScript classes, so lookaround and backreferences are faults.
- **Data is serde's.** Extension values, results, log fields, and configuration files are serde data. An integer beyond 2^53 keeps its digits; a lone surrogate escape, a number such as `1e400`, and nesting past 128 levels cannot be held, so MCP answers such a line with a parse error and jsonkit reports such a document as invalid JSON. A view record keeps its call order where JavaScript moves integer-like names first.
- **The host.** `publish_env` adds to a table every real handle reads rather than writing the process environment, a detached child keeps the run's session, `SIGTSTP` stops the process with `SIGSTOP` once core has listened for it, and `set_exit_code` writes nothing because a Rust process exits with what `main` returns.
- **Shipping.** The toolchain is `cargo loom`, which is not in this tree, and reads `Cargo.toml`; `cargo loom build` writes `SHA256SUMS` beside the binary; `init` writes `loom.config.json` and `clippy.toml` and no TypeScript configuration; malformed release facts fail the build; skills are embedded data.
- **Plugins' settings are builders.** A factory takes a builder in place of an options object, and a finding rebuilds the setter call that took the bad value.
