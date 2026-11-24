---
description: How to write a third-party Loom plugin crate from scratch. Identity, options, middleware and activation, Commands, hooks, extensions ordinary and collecting, views and overrides, and failure hints, with the explain and doctor example crates as worked cases.
---

# Writing a plugin

A plugin is a value. A crate that depends on `loomcli-core` exports a factory function that builds one with `Plugin::new(identity)`, and an application lists it in `Application::plugins` beside the first-party ones. The first-party plugins use this same public builder and nothing more, so a plugin crate can do anything they do. [ADR-0005](../decisions/0005-a-plugin-is-a-value-any-crate-exports.md) records the decision.

This guide builds plugin crates part by part. Every example compiles and runs as a doctest. The two private example crates are the worked cases: [explain](../../examples/explain) adds a global option, an extension, a middleware, and a failure hint, and [doctor](../../examples/doctor) attaches one Command. The [plugin contract section](../design/core-api.md#8-the-plugin-contract) of the core API design states every rule.

## The crate and its identity

A plugin crate depends on `loomcli-core` and `serde`, and on `loomcli-plugins` only to supply values to a first-party plugin's extensions, through that plugin's `-extension` feature:

```toml
[dependencies]
loomcli-core = { path = "../loomcli/rust/crates/loomcli-core" }
serde = { version = "1", features = ["derive"] }

[dev-dependencies]
loomcli-testing = { path = "../loomcli/rust/crates/loomcli-testing" }
tokio = { version = "1", features = ["macros", "rt"] }
```

A plugin's identity is its package name, or `<package>/<plugin>` when a package ships several, such as `@loomcli/plugins/help`. Every extension and declared view the plugin defines takes its identity as a prefix, such as `@loom/explain/command`. An application that installs one identity twice fails at the `plugins()` call.

The factory function returns the plugin, or a settings builder that converts into one. It reads no environment: everything a run needs arrives through the contexts core hands the plugin's functions.

## Options

A plugin declares global options, with `options::<O>()` for a derived struct or `option(name, opt)` one at a time. They are global options in every respect: accepted anywhere on the command line, listed under GLOBAL OPTIONS in help, and published by the manifest. The application's own options cannot reuse their names or spellings. Mark an option `control` when it says how the run behaves rather than what the Command works on, as `--help`, `--format`, and `--explain` do; MCP tools leave control options out.

A factory that lets the application choose a spelling applies it after the declaration with `Plugin::short(name, letter)` or `Plugin::env(name, variables)`, as `format().short('o')` does.

## Middleware and activation

A plugin holds at most one middleware, and its activation decides whether the middleware joins the chain for a run. `Activation::Always` joins every run; `Activation::options(["explain"])` joins only when one of the listed options was supplied, by a token, a variable, or the configuration file, but never by a declared default.

The middleware receives a `MiddlewareContext<O>`, whose `options` field holds the plugin's own options, typed, and a `Next`. `next.run().await` runs the rest of the chain and the action, and resolves `ChainOutcome::Dispatched`, `TakenOver`, or `Cancelled`, or the failure the rest raised. Dropping `next` takes the invocation over: the action never runs, and the held faults of the routed Command's inputs are never raised. `Next::run` consumes `next`, so a second call does not compile.

```rust
use std::time::Instant;

use loomcli_core::{
    Activation, Application, Context, Inputs, MiddlewareContext, Next, Outcome, Plugin,
    RunOptions,
};
use loomcli_testing::{MockFields, mock_process};

/// The timing plugin's options.
#[derive(Inputs)]
pub struct TimingOptions {
    /// Report how long the command took.
    #[option(control)]
    pub timing: bool,
}

async fn time_the_run(context: MiddlewareContext<TimingOptions>, next: Next) -> Outcome {
    let started = Instant::now();
    next.run().await?;
    let elapsed = started.elapsed().as_millis();
    context.out.info(&format!("Took {elapsed} ms.")).await
}

/// The timing plugin: `--timing` reports the run's duration on stderr.
pub fn timing() -> Plugin<TimingOptions> {
    Plugin::new("@acme/timing")
        .options::<TimingOptions>()
        .middleware(Activation::options(["timing"]), time_the_run)
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let app = Application::new("hello")
        .plugins((timing(),))
        .description("Say hello.")
        .action(|context: Context| async move { context.out.print("Hello.").await });
    let process = mock_process(MockFields::new().argv(["--timing"]));
    app.run(RunOptions::new().process(process.clone())).await;
    assert_eq!(process.stdout_text(), "Hello.\n");
    assert!(process.stderr_text().starts_with("ℹ Took "));
}
```

The middleware can also read the routed Command (`context.command`), the graph, the request's arguments and local options by name (`context.request`), the spelling the operator typed for each of its options (`context.spellings`), and the host. `context.select_view(name)` chooses the result view, which is how the formatter's `--format` works.

## Commands

`commands(list)` attaches ordinary Commands to the root of the application that installs the plugin, ahead of the application's own. They are declared like any other Command. Doctor is the whole case: one Command that renders a few checks through the pack views.

```rust
use loomcli_core::{Application, Command, Context, Outcome, Plugin, RunOptions};
use loomcli_plugins::boxed::{BoxConfig, boxed};
use loomcli_plugins::heading::{HeadingConfig, heading};
use loomcli_plugins::list::{ListConfig, list};
use loomcli_plugins::rule::rule;
use loomcli_testing::{MockFields, mock_process};

/// Reports the checks: a heading, a list of two checks, a rule, and the verdict in a box.
async fn check_host(context: Context) -> Outcome {
    let Context { host, out, .. } = context;
    let output = if host.terminal.stdout().is_tty {
        "a terminal"
    } else {
        "not a terminal"
    };
    out.render("Host checks", &heading(HeadingConfig::new())).await?;
    let checks = vec![
        format!("Platform: {}", host.platform),
        format!("Output: {output}"),
    ];
    out.render(&checks, &list(ListConfig::<String>::new())).await?;
    out.render("", &rule()).await?;
    out.render("All checks passed.", &boxed(BoxConfig::new().title("Result")))
        .await
}

/// A plugin that attaches one ordinary Command to the root of the Application that installs it.
pub fn doctor() -> Plugin {
    Plugin::new("@loom/doctor").commands([Command::new("doctor")
        .description("Check the host this application runs on.")
        .action(check_host)])
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let app = Application::new("notes")
        .plugins((doctor(),))
        .description("Keep notes.")
        .action(|context: Context| async move { context.out.print("notes").await });
    let process = mock_process(MockFields::new().argv(["doctor"]));
    app.run(RunOptions::new().process(process.clone())).await;
    assert_eq!(
        process.stdout_text(),
        concat!(
            "Host checks\n",
            "───────────\n",
            "● Platform: linux\n",
            "● Output: not a terminal\n",
            "────────────────────────────────────────────────────────────────────────────────\n",
            "╭─ Result ───────────╮\n",
            "│ All checks passed. │\n",
            "╰────────────────────╯\n",
        )
    );
}
```

The mock process reports the platform `linux` on every host, so the test reads the same bytes everywhere. A root that declares arguments cannot hold children, so an application whose root takes arguments cannot install a plugin that attaches Commands.

## Hooks

A plugin registers at most one handler per hook; a second registration panics at the call under `@loomcli/core/handler-registered-twice`.

| Hook | Called | Returns |
| --- | --- | --- |
| `on_command_attach(Fn(&mut AttachedCommand))` | At graph build, once per Command, root first, depth first. | `Result<(), Error>`. The hook edits the Command in place: `option`, `argument`, the three group calls, `views`, and `extend`. |
| `on_graph_built(Fn(&CommandGraph))` | Once the graph is built and frozen. | `Ok(())`, or a `DeclarationError` that rejects the graph. |
| `on_failure(Fn(&dyn Failure, &FailureHookContext))` | Once per rendered failure, before its view. | Hint lines: `()`, `Option<String>`, `String`, `Vec<String>`, or a `Result` of one. |
| `on_log(Fn(&LogEvent, &LogDestination))` | Once per log event. | `()` or a `Result`. |
| `on_environment(Fn(EnvironmentContext) -> Future)` | Once per run, before any input validates. | The variables to add, `EnvironmentAdditions`. A variable the environment already holds wins. |

An attach hook's calls return their declaration fault instead of panicking, so the hook propagates it with `?` as a build fault or handles it and continues. A build fault exits 1, with the Developer Diagnostic in a development build and the generic message in a distributed one.

```rust
use loomcli_core::{
    Application, AttachedCommand, CommandGraph, Context, DeclarationError, DiagnosticParts,
    DiagnosticRule, EnvironmentAdditions, EnvironmentContext, Error, Opt, Plugin, diagnostic_rule,
};

/// The rule the graph check reports under.
const RESERVED_NAME: DiagnosticRule = diagnostic_rule(
    "@acme/stamp/reserved-name",
    "A Command uses a name the stamp plugin reserves.",
    "The stamp plugin attaches nothing named stamp, but its operators read stamp as its own word.",
);

/// Declares `--stamp` on every Command that has an action.
fn add_stamp(command: &mut AttachedCommand) -> Result<(), Error> {
    if command.has_action() {
        command.option("stamp", Opt::string().description("A label for this run's log events."))?;
    }
    Ok(())
}

/// Rejects a graph with a Command named stamp.
fn judge(graph: &CommandGraph) -> Result<(), Error> {
    if graph.root.children.iter().any(|child| child.name.as_deref() == Some("stamp")) {
        return Err(DeclarationError::new(
            RESERVED_NAME,
            DiagnosticParts::new("Command \"stamp\" uses a name the stamp plugin reserves.")
                .correction("Rename the Command."),
        )
        .into());
    }
    Ok(())
}

/// Supplies a default for `STAMP_ZONE` when the environment does not set it.
async fn zone(_context: EnvironmentContext) -> Result<EnvironmentAdditions, Error> {
    Ok(EnvironmentAdditions::from([("STAMP_ZONE".to_owned(), "UTC".to_owned())]))
}

pub fn stamp() -> Plugin {
    Plugin::new("@acme/stamp")
        .on_command_attach(add_stamp)
        .on_graph_built(judge)
        .on_environment(zone)
        .on_log(|event, _destination| {
            // An on_log hook observes every event; the logging plugin writes them to a file.
            let _ = (&event.level, &event.message);
        })
}

let app = Application::new("hello")
    .plugins((stamp(),))
    .description("Say hello.")
    .action(|context: Context| async move { context.out.print("Hello.").await });
let graph = app.inspect().unwrap();
assert_eq!(graph.root.options[0].name(), "stamp");
```

## Extensions

An extension is a typed fact a plugin defines, which a Command, an option, or an argument carries, and which the graph publishes under the extension's identity. The value type is plain data, `Serialize + DeserializeOwned`, so the graph and the manifest can hold it. The descriptor is a constant in a module of declarations alone, so a crate can supply values without installing the plugin:

```rust
use loomcli_core::{Collecting, CommandTarget, Extension, Issue};
use serde::{Deserialize, Serialize};

/// What `--explain` prints for a Command beside its description.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExplainFacts {
    /// The explanation.
    pub details: String,
    /// Example command lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<String>>,
}

/// One value per Command.
pub const EXPLAIN_COMMAND: Extension<CommandTarget, ExplainFacts> =
    Extension::new("@loom/explain/command");

fn one_word(tag: &String) -> Result<(), Vec<Issue>> {
    if tag.is_empty() || tag.contains(char::is_whitespace) {
        return Err(vec![Issue::new("Supply one word as a tag.")]);
    }
    Ok(())
}

/// A collecting extension: the author and every plugin may add values, which read back as a list.
pub const TAGS: Extension<CommandTarget, String, Collecting> =
    Extension::collecting("@acme/tagger/tags").check(one_word);
```

- `DESCRIPTOR.value(v)` makes a value, and a declaration carries it through `extend([...])`. The descriptor's `check` judges it at that call, so a rejected value panics at the author's line, or returns the fault from a hook's `extend`.
- A plugin lists the descriptors it defines in `Plugin::extensions([...])`.
- `read_extension(&node, &DESCRIPTOR)` reads a value back typed: `Option<V>` for an ordinary extension, and `Vec<V>` for a collecting one, the author's values first.
- A collecting extension is how one plugin supplies facts to another's projection. The help plugin adds each Command's details and examples to the manifest's `MANIFEST_COMMAND` from its attach hook, so the manifest carries them without depending on help.

```rust
use loomcli_core::{Application, Collecting, Command, CommandTarget, Context, Extension, Plugin, read_extension};

pub const TAGS: Extension<CommandTarget, String, Collecting> =
    Extension::collecting("@acme/tagger/tags");

/// Tags every Command that has an action with `cli`.
pub fn tagger() -> Plugin {
    Plugin::new("@acme/tagger")
        .extensions([TAGS])
        .on_command_attach(|command| {
            if command.has_action() {
                command.extend([TAGS.value("cli".to_owned())])?;
            }
            Ok(())
        })
}

let app = Application::new("notes")
    .plugins((tagger(),))
    .description("Keep notes.")
    .command(
        Command::new("add")
            .description("Add a note.")
            .extend([TAGS.value("write".to_owned())])
            .action(|context: Context| async move { context.out.print("added").await }),
    );
let graph = app.inspect().unwrap();
let add = graph.command(&["add"]).unwrap();
assert_eq!(read_extension(&*add, &TAGS).unwrap(), vec!["write", "cli"]);
```

## Views and overrides

Every byte a plugin writes goes through a view, so an application can restyle it. A plugin declares a view under an identity with `view(identity, View::new(...))`, lists it in `Plugin::views([...])`, and renders through it with `out.render`. An application replaces it with `override_view(&declared, replacement)` in `Application::overrides`; the first override in installation order wins, the application's ahead of every plugin's.

```rust
use loomcli_core::{
    Activation, Application, Context, DeclaredView, Inputs, MiddlewareContext, Next, Outcome,
    Plugin, RunOptions, View, override_view, view,
};
use loomcli_testing::{MockFields, mock_process};

/// The line `--whoami` prints, declared so an application can restyle it.
pub fn whoami_line() -> DeclaredView<str> {
    view("@acme/whoami/line", View::new(|name: &str, _| format!("You are {name}.\n")))
}

/// The plugin's options.
#[derive(Inputs)]
pub struct WhoamiOptions {
    /// Print who runs the application and exit.
    #[option(control)]
    pub whoami: bool,
}

async fn print_user(context: MiddlewareContext<WhoamiOptions>, _next: Next) -> Outcome {
    let name = context.host.env.get("USER").cloned().unwrap_or_default();
    context.out.render(name.as_str(), &whoami_line()).await
}

pub fn whoami() -> Plugin<WhoamiOptions> {
    Plugin::new("@acme/whoami")
        .options::<WhoamiOptions>()
        .views([whoami_line()])
        .middleware(Activation::options(["whoami"]), print_user)
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let app = Application::new("notes")
        .plugins((whoami(),))
        .description("Keep notes.")
        .overrides([override_view(
            whoami_line(),
            View::new(|name: &str, _| format!("user: {name}\n")),
        )])
        .action(|context: Context| async move { context.out.print("notes").await });
    let process = mock_process(MockFields::new().argv(["--whoami"]).env("USER", "ada"));
    app.run(RunOptions::new().process(process.clone())).await;
    assert_eq!(process.stdout_text(), "user: ada\n");
}
```

A plugin may also override another plugin's declared view, or a failure class's view with `override_view(failure::<F>(), FailureView::new(...))`, and register translators and failure encoders for a media type, as the formatter does for `application/json`.

## The explain plugin: options, an extension, middleware, and a hint

[examples/explain](../../examples/explain) is the reference's private example plugin, ported. `--explain` explains the routed Command from its description and the `EXPLAIN_COMMAND` value it carries, and takes the invocation over without validating anything else. Its failure hook points an operator who typed an unknown option at that explanation. The crate keeps the extension in a module of its own, `explain::extension`, so jsonkit's Command modules supply values to it. Here is the whole plugin in one block, with a run:

```rust
use loomcli_core::{
    Activation, Application, Command, CommandGraph, CommandNode, CommandTarget, Context, Error,
    Extension, Failure, FailureHookContext, Inputs, InvokedBy, MiddlewareContext, Next, Outcome,
    Plugin, RunOptions, UnknownOptionError, read_extension,
};
use loomcli_testing::{MockFields, mock_process};
use serde::{Deserialize, Serialize};

/// What `--explain` prints for a Command beside its description.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExplainFacts {
    /// The explanation.
    pub details: String,
    /// Example command lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<String>>,
}

/// `@loom/explain/command`.
pub const EXPLAIN_COMMAND: Extension<CommandTarget, ExplainFacts> =
    Extension::new("@loom/explain/command");

/// The plugin's options.
#[derive(Inputs)]
pub struct ExplainOptions {
    /// Explain the selected command and exit.
    #[option(short = 'e', control)]
    pub explain: bool,
}

/// The routed path, the description, then the details and examples the declaration carries.
fn lines(command: &CommandNode, graph: &CommandGraph) -> Result<Vec<String>, Error> {
    let routed = !command.path.is_empty();
    let description = if routed {
        command.description.clone()
    } else {
        graph.description.clone()
    };
    let mut lines = vec![if routed {
        format!("{} {}", graph.name, command.path.join(" "))
    } else {
        graph.name.clone()
    }];
    lines.extend(description);
    if let Some(explanation) = read_extension(command, &EXPLAIN_COMMAND)? {
        lines.push(explanation.details);
        lines.extend(
            explanation
                .examples
                .unwrap_or_default()
                .into_iter()
                .map(|example| format!("  {example}")),
        );
    }
    Ok(lines)
}

/// Explains the routed Command and drops `next`, which takes the invocation over.
async fn explain_command(context: MiddlewareContext<ExplainOptions>, _next: Next) -> Outcome {
    for line in lines(&context.command, &context.graph)? {
        context.out.print(&line).await?;
    }
    Ok(())
}

/// Points an operator who typed an unknown option at the explanation of the Command they reached.
fn explain_hint(failure: &dyn Failure, context: &FailureHookContext) -> Option<String> {
    if !failure.is::<UnknownOptionError>() || context.invoked_by != InvokedBy::Argv {
        return None;
    }
    let command: Vec<&str> = std::iter::once(context.application.as_str())
        .chain(context.path.iter().map(String::as_str))
        .chain(std::iter::once("--explain"))
        .collect();
    Some(format!("Run \"{}\" to explain this command.", command.join(" ")))
}

/// The explain plugin.
pub fn explain() -> Plugin<ExplainOptions> {
    Plugin::new("@loom/explain")
        .options::<ExplainOptions>()
        .extensions([EXPLAIN_COMMAND])
        .middleware(Activation::options(["explain"]), explain_command)
        .on_failure(explain_hint)
}

fn notes() -> Application<loomcli_core::NoInputs, loomcli_core::NoResult> {
    Application::new("notes")
        .plugins((explain(),))
        .description("Keep notes.")
        .command(
            Command::new("add")
                .description("Add a note.")
                .extend([EXPLAIN_COMMAND.value(ExplainFacts {
                    details: "The note's text is one argument.".to_owned(),
                    examples: Some(vec!["notes add \"Buy milk\"".to_owned()]),
                })])
                .action(|context: Context| async move { context.out.print("added").await }),
        )
        .action(|context: Context| async move { context.out.print("notes").await })
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let process = mock_process(MockFields::new().argv(["add", "--explain"]));
    notes().run(RunOptions::new().process(process.clone())).await;
    assert_eq!(
        process.stdout_text(),
        "notes add\nAdd a note.\nThe note's text is one argument.\n  notes add \"Buy milk\"\n"
    );

    let process = mock_process(MockFields::new().argv(["add", "--quiet"]));
    let code = notes().run(RunOptions::new().process(process.clone())).await;
    assert_eq!(code.get(), 2);
    assert_eq!(
        process.stderr_text(),
        concat!(
            "notes: Unknown option \"--quiet\". Supply a declared option; prefix a hyphenated path with \"./\".\n",
            "Run \"notes add --explain\" to explain this command.\n",
        )
    );
}
```

Points the case shows:

- **Activation.** The middleware joins the chain only when `--explain` is supplied, so every other run pays nothing for it.
- **Taking over.** The middleware never runs `next`, so the action does not run and the Command's own inputs are never validated: `jsonkit get --explain` explains `get` without the document `get` requires.
- **Reading an extension.** `read_extension` returns the stored value typed, or `None` for a Command that carries none. A stored value of another type is a declaration fault on the ordinary failure path.
- **The hint.** The hook receives every rendered failure, keys on its class with `is::<UnknownOptionError>()`, which walks the class chain, and interpolates only declared names, never a word the operator typed. An invocation by name, such as an MCP tool call, gets no hint.

## Testing a plugin

Test a plugin on a small application of its own, through `run` on a mock process, as the blocks above do. `loomcli_testing::assert_assembles` catches a declaration fault the plugin's hooks raise, and `middleware_context`, `failure_hook_context`, and `provider_context` build the context for one function when a unit test is clearer. [examples/explain/tests/explain.rs](../../examples/explain/tests/explain.rs) and [examples/doctor/tests/doctor.rs](../../examples/doctor/tests/doctor.rs) are the examples' own tests.
