---
description: What the Rust implementation ports, where its behavioral contract lives in this repository, and the conventions every change under rust/ follows.
---

# Loom CLI for Rust

This workspace is the Rust implementation of [Loom CLI](../README.md), a framework for agent-first command-line applications whose reference implementation is the TypeScript workspace beside it. An author declares one command graph, and people, agents, and automation are all served from it: help, a machine-readable manifest, MCP tools, shell completion, structured output, and structured failures.

## The contract is the TypeScript reference

The reference is the TypeScript workspace at [`../typescript`](../typescript) and the repository's shared documents at [`../docs`](../docs). They bind this port, and the repository's [AGENTS.md](../AGENTS.md) holds the rules every language follows. [ADR-0217](../docs/decisions/0217-parity-between-looms-implementations-is-the-operators-experience.md) states what parity between the two implementations covers.

- In the [principles](../docs/principles.md), "Node and Bun underneath" reads as "std and tokio underneath", and "types, then lint, then diagnostics" reads as "types, then `#[must_use]` and clippy, then diagnostics".
- `../docs/core`, `../docs/plugins`, `../docs/libs`, and `../docs/toolchain` state behavior. Open the page for the area under change, and the decision records it cites, before writing code.
- `../typescript/packages/*/tests` are the behavioral oracle. Port a behavior's test cases with the behavior, and give each reference test file a row in its crate's test map (`crates/<crate>/tests/README.md`, or a page under [`crates/loomcli-plugins/tests/maps/`](crates/loomcli-plugins/tests/maps/)): ported, partly ported with what remains, or not applicable with why.

Parity is the experience [ADR-0217](../docs/decisions/0217-parity-between-looms-implementations-is-the-operators-experience.md) names, not a copy of the reference's code: the same operator contract, the same benefits for an agent, and the same batteries-included features for an author, so an author never builds what the reference gives them. The contract covers messages, help pages, tables, manifest and MCP JSON, completion output, and exit codes, and the shared conformance cases hold those byte for byte, except at a limit of the programming language. The authoring API is Rust-native and follows the port's own [decision records](docs/decisions/README.md) and [core API design](docs/design/core-api.md).

How the port produces that experience is its own. A difference that leaves the experience intact, such as a Rust-native mechanism or a failure path that behaves better than the reference's, is decided in the work and recorded as a deviation; when it shows a defect in the reference, file the reference fix too. A difference that would change the experience for an operator, an agent, or an author is not decided in the work: bring it to the project's maintainers with its background, the problem it solves, when it happens, each option's effect on operators, agents, and authors, and a recommendation.

A difference from the reference contract that the port chooses is a **deviation**. Record each one in `docs/deviations.md` with its reason, and list the cases it changes in [conformance/accepted.json](conformance/accepted.json), in the change that introduces it. Any other difference is a defect. One the shared cases show and [conformance/behind.json](conformance/behind.json) lists is known and owed to the catch-up, as [ADR-0006](docs/decisions/0006-rust-tracks-the-shared-conformance-cases-it-is-behind-on-in-a-list-apart-from-deviations.md) records.

## Where things are

- [README.md](README.md): the crate map, the checks, and the conformance harness; the guides under [docs/guide](docs/guide/application.md) document the framework for authors and agents. Every Rust example in them compiles as a doctest of `docs/check`, so a change that breaks one fails `cargo test --workspace --all-features --doc`.
- [docs/design/core-api.md](docs/design/core-api.md): the authoring contract, concept by concept, and where each rule is enforced.
- [docs/decisions/README.md](docs/decisions/README.md): the decisions that shape the port, held to the same rules as the repository's records.
- `../conformance/`: the conformance cases both languages share, invocations of the examples with the stdout, stderr, exit code, and files the TypeScript reference produces. The Rust examples reproduce them, except the cases [conformance/accepted.json](conformance/accepted.json) and [conformance/behind.json](conformance/behind.json), under `rust/`, list; Rust work only shrinks the second.
- The toolchain, the `cargo-loom` crate, is not in this tree; [Shipping](docs/guide/shipping.md#the-toolchain-is-not-in-this-tree) says what that leaves out.

## Checks

Every command here runs from `rust/`, on the toolchain `rust-toolchain.toml` pins. A change is done when these pass for the crates it touches, and the whole workspace still builds:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

A change to an example or to the operator surface also passes the conformance harness, which [../conformance/README.md](../conformance/README.md#running-the-harness) describes:

```sh
cargo build -p jsonkit -p textstat
cargo run -p conformance-harness
```

## Conventions

- **Operator-reachable code returns failures.** A panic, `unwrap`, or `expect` is for tests and for invariants a comment proves. Everything an operator can trigger ends in a failure class with a message that says what went wrong and what to do instead.
- **Bytes are the product.** Tests assert exact stdout, stderr, and exit code for operator output, through the public surface with a mock process handle. Tests never read the real environment, terminal, clock, or home folder.
- **Operator messages live in message modules.** Each sentence Loom says to an operator lives in the `messages.rs` of the concept module whose code raises or writes it: a failure's sentence, a hint line under a failure, a `-v` or `-vv` line, and a plugin's notice, warning, or confirmation. A concept module is a module directly under a crate's `src`. A flat crate keeps one `src/messages.rs`, and so do the top-level files of a crate with folders. Write each sentence as a `fn` of the values it repeats that returns the `String`, or a `const` when it repeats none, and have the raising or writing code build the failure or write the line. Fixed labels and Developer Diagnostics stay where they are. The reference's [ADR-0164](../docs/decisions/0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md) records the rule; phrases and wording modules wait for the port's localization design.
- **A message never repeats an input value.** It may be a secret. Every name, spelling, path, or other text a sentence repeats passes through the control-character escape inside the message module. An issue's sentence is the exception: a validator wrote it, and a sentence repeats it as written after its input's subject, so a multi-line issue keeps its line breaks.
- **`unsafe` is forbidden** workspace-wide. Reach terminal and signal facilities through a dependency.
- **Dependencies are few.** Add one to `[workspace.dependencies]` in `rust/Cargo.toml`, and state why in the commit message. Hand-written protocol code (MCP, the markdown subset, roff, completion scripts) stays hand-written, as in the reference.
- **Public items carry rustdoc** that states the contract. Types Loom builds and the author reads are `#[non_exhaustive]`; types the author builds use builders.
- **JSON keeps declaration order.** `serde_json` runs with `preserve_order`, and number and escape formatting match `JSON.stringify` where a document is operator output.
- **Paths are configurable.** Code and tests name no machine-specific path.
- **The reference is read, not loaded.** Nothing under `rust/` reads a file under `../typescript` at build or test time. The shared conformance cases are captured from the reference into `../conformance/`; any other fact the port takes from the reference, such as a copied rule table, is captured into `rust/` and names the revision it came from.
- **Scratch lives in `.scratch/`.** When several agents build at once, each sets `CARGO_TARGET_DIR=.scratch/target-<name>`. Each also passes a job cap, such as `-j 4`, to every cargo command that compiles (`build`, `check`, `clippy`, `test`, `run`), because each target directory compiles the workspace from scratch.
- **Commits** use `type(scope): summary`, such as `feat(core): route an invocation on global options`. When others are working in the same checkout, commit with an explicit pathspec: `git add <paths> && git commit -m "<message>" -- <paths>`.

## Judging review findings here

Under the repository's [two tests](../AGENTS.md#judging-review-findings), what this implementation ships is the library crates under `crates/` and the files they write. The examples and the conformance harness exercise it and ship nothing. The toolchain is not in this tree, so no layout case applies yet.
