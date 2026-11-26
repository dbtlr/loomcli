//! The middleware chain through a run: activation from the tier that supplied an option, the chain
//! in installation order, `next` and the chain outcome, takeover without raising a held fault, the
//! failure of a middleware at each moment, and what a middleware reads: its options, its own
//! options under a held fault, the spellings, the request, the graph, and the view selection.
//!
//! Ported from the reference's `middleware.test.ts`, `middleware-spellings.test.ts`,
//! `own-options.test.ts`, `request.test.ts`, `plugin-options.test.ts` (activation and the
//! middleware reads), `control-options.test.ts` (run part), `failure-selection.test.ts` (the
//! selection a middleware assigns), `action-graph.test.ts`, and the takeover cases of
//! `parse.test.ts`. A loader, a frozen record, and a `next()` called twice or left unawaited have
//! no Rust form; `docs/deviations.md` records each.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Activation, AnyPlugin, Application, Arg, Build, ChainOutcome, Command, CommandNode, Context,
    Done, Error, FailureFacts, FailureHookContext, FailureView, FatalError, InputError,
    InputValues, InternalError, LoomError, MiddlewareContext, Next, NoInputs, NoOptions, NoResult,
    Opt, OptionNode, Plugin, ReleaseFacts, RowView, RowViews, RowsResult, View, ViewContext,
    failure, override_view,
};
use serde::Serialize;
use serde_json::{Value, json};
use support::validators::{Digits, Number, OneOf, OneOfUpper};
use support::{Ran, middleware_options_json as options_json};

type Calls = Arc<Mutex<Vec<String>>>;
type App = Application<NoInputs, NoResult, Done>;
type GroupApp = Application<NoInputs, NoResult, loomcli_core::Group>;

fn calls() -> Calls {
    Arc::default()
}

fn recorded(calls: &Calls) -> Vec<String> {
    calls.lock().unwrap().clone()
}

fn push(calls: &Calls, line: impl Into<String>) {
    calls.lock().unwrap().push(line.into());
}

/// The reference's `outcome` strings.
fn word(outcome: ChainOutcome) -> &'static str {
    match outcome {
        ChainOutcome::Dispatched => "dispatched",
        ChainOutcome::TakenOver => "taken-over",
        ChainOutcome::Cancelled => "cancelled",
    }
}

/// What a fixture prints for an error: a failure's message, or a foreign error's text, the
/// reference's `error.sentence ?? error.message`.
fn sentence(error: &Error) -> String {
    error.failure().map_or_else(
        || error.foreign().map(ToString::to_string).unwrap_or_default(),
        |failure| failure.message().to_owned(),
    )
}

/// A run in a distributed build, as every fixture of these files runs, with these variables.
async fn ran<I, R, S: loomcli_core::State>(
    application: &Application<I, R, S>,
    argv: &[&str],
    env: &[(&str, &str)],
) -> Ran {
    support::run_with(
        application,
        support::fields(argv, env).release(ReleaseFacts::new(Build::Distributed)),
    )
    .await
}

/// The same run in a development build.
async fn developed<I, R, S: loomcli_core::State>(
    application: &Application<I, R, S>,
    argv: &[&str],
    env: &[(&str, &str)],
) -> Ran {
    support::run_with(
        application,
        support::fields(argv, env).release(ReleaseFacts::new(Build::Development)),
    )
    .await
}

fn done(stdout: &str) -> Ran {
    Ran {
        status: 0,
        stdout: stdout.to_owned(),
        stderr: String::new(),
    }
}

fn env_is(host: &loomcli_core::Host, name: &str, value: &str) -> bool {
    host.env.get(name).map(String::as_str) == Some(value)
}

/// One option's value read by name from `values`, as the reference's JSON prints it, or `None` for
/// an absent value, which the JSON leaves out.
fn read_json(values: &InputValues, node: &OptionNode) -> Option<Value> {
    let name = node.name();
    let value = match node {
        OptionNode::Boolean(_) => values.option::<bool>(name).ok().map(|flag| json!(flag)),
        OptionNode::Count(_) => values.option::<u32>(name).ok().map(|count| json!(count)),
        OptionNode::String(string) if string.multiple => values
            .option::<Vec<String>>(name)
            .ok()
            .map(|list| json!(list)),
        _ => values
            .option::<Option<String>>(name)
            .ok()
            .flatten()
            .map(|text| json!(text))
            .or_else(|| {
                values
                    .option::<Option<u64>>(name)
                    .ok()
                    .flatten()
                    .map(|number| json!(number))
            }),
    };
    value.filter(|value| !value.is_null())
}

/// The routed request as the reference prints it: its arguments, local options, and passthrough.
fn request_json(command: &CommandNode, request: Option<&loomcli_core::Request>) -> String {
    let Some(request) = request else {
        return "null".to_owned();
    };
    let mut args = serde_json::Map::new();
    for argument in &command.arguments {
        if let Some(value) = request
            .values
            .argument::<Option<String>>(&argument.name)
            .ok()
            .flatten()
        {
            args.insert(argument.name.clone(), json!(value));
        }
    }
    let mut options = serde_json::Map::new();
    for node in &command.options {
        if let Some(value) = read_json(&request.values, node) {
            options.insert(node.name().to_owned(), value);
        }
    }
    json!({ "args": args, "options": options, "passthrough": request.passthrough }).to_string()
}

// The plugin fixture application (fixtures/plugins/invoke.mjs).

async fn get_action(ctx: Context) -> loomcli_core::Outcome {
    if env_is(&ctx.host, "LOOM_FIXTURE_ACTION", "fatal") {
        return Err(ctx.out.fatal("the action stopped the invocation"));
    }
    let values = support::values_json(&ctx);
    let path = values["args"]["path"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    ctx.out
        .print(&format!("get:{path}:{}", values["options"]))
        .await?;
    ctx.out
        .print(&format!("action-signal:true:{}", ctx.signal.is_cancelled()))
        .await
}

/// The fixture graph every scenario shares, under the plugins one scenario installs.
fn fixture(plugins: Vec<AnyPlugin>) -> App {
    let get = Command::new("get")
        .description("Read one value at a path.")
        .argument(
            "path",
            Arg::string().description("Dot path to read.").required(),
        )
        .option(
            "raw",
            Opt::boolean().description("Print the value unquoted."),
        )
        .action(get_action);
    let cache = Command::new("cache")
        .description("Manage the cache.")
        .command(
            Command::new("clear")
                .description("Clear the cache.")
                .action(|ctx: Context| async move { ctx.out.print("cleared").await }),
        );
    Application::new("app")
        .plugins(plugins)
        .description("A fixture application.")
        .version("1.2.0")
        .global_option(
            "file",
            Opt::string()
                .description("The document to read.")
                .short('f'),
        )
        .command(get)
        .command(cache)
        .action(|ctx: Context| async move { ctx.out.print("root").await })
}

/// The help plugin: `--help` and `-h` activate a middleware that takes the invocation over and
/// prints the routed path.
fn help(loaded: &Calls) -> Plugin {
    let loaded = Arc::clone(loaded);
    Plugin::new("@fixture/help")
        .option("help", Opt::boolean().short('h'))
        .middleware(Activation::options(["help"]), move |ctx, _next: Next| {
            push(&loaded, "loaded:help");
            async move {
                let path = if ctx.command.path.is_empty() {
                    "(root)".to_owned()
                } else {
                    ctx.command.path.join(" ")
                };
                ctx.out.print(&format!("help:{path}")).await
            }
        })
}

/// The version plugin: `--version` activates a middleware that takes over and prints the version.
fn version(loaded: &Calls) -> Plugin {
    let loaded = Arc::clone(loaded);
    Plugin::new("@fixture/version")
        .option("version", Opt::boolean())
        .middleware(Activation::options(["version"]), move |ctx, _next: Next| {
            push(&loaded, "loaded:version");
            async move {
                ctx.out
                    .print(&format!("version:{}", ctx.graph.version))
                    .await
            }
        })
}

/// An always-on wrapper that reports the outcome it wrapped and cleans up after it.
fn wrapper(label: &'static str, loaded: &Calls) -> Plugin {
    let loaded = Arc::clone(loaded);
    Plugin::new(format!("@fixture/{label}")).middleware(Activation::Always, move |ctx, next| {
        push(&loaded, format!("loaded:{label}"));
        async move {
            ctx.out.info(&format!("{label}:start")).await?;
            let outcome = next.run().await;
            match &outcome {
                Ok(outcome) => ctx.out.info(&format!("{label}:{}", word(*outcome))).await?,
                Err(error) => {
                    ctx.out
                        .info(&format!("{label}:rejected:{}", sentence(error)))
                        .await?;
                }
            }
            ctx.out.info(&format!("{label}:cleanup")).await?;
            outcome.map(|_| ())
        }
    })
}

/// A middleware that handles the failure of the rest of the chain and returns.
fn catching() -> Plugin {
    Plugin::new("@fixture/catching").middleware(Activation::Always, |ctx, next| async move {
        match next.run().await {
            Ok(outcome) => ctx.out.info(&format!("catching:{}", word(outcome))).await,
            Err(error) => {
                ctx.out
                    .info(&format!("catching:caught:{}", sentence(&error)))
                    .await
            }
        }
    })
}

fn plugins(list: Vec<Plugin>) -> Vec<AnyPlugin> {
    list.into_iter().map(Into::into).collect()
}

const GET: &str =
    "get:a.b:{\"help\":false,\"version\":false,\"raw\":false}\naction-signal:true:false\n";

// middleware.test.ts

#[tokio::test]
async fn an_invocation_that_supplies_no_plugin_option_runs_no_activated_middleware() {
    let loaded = calls();
    let app = fixture(plugins(vec![help(&loaded), version(&loaded)]));
    assert_eq!(ran(&app, &["get", "a.b"], &[]).await, done(GET));
    assert!(recorded(&loaded).is_empty());
}

#[tokio::test]
async fn a_takeover_earlier_in_the_chain_never_runs_a_later_middleware() {
    let loaded = calls();
    let app = fixture(plugins(vec![help(&loaded), version(&loaded)]));
    assert_eq!(
        ran(&app, &["--help", "--version", "get"], &[]).await,
        done("help:get\n")
    );
    assert_eq!(recorded(&loaded), ["loaded:help"]);
}

#[tokio::test]
async fn the_second_plugin_runs_and_takes_over_when_the_first_is_not_activated() {
    let loaded = calls();
    let app = fixture(plugins(vec![help(&loaded), version(&loaded)]));
    assert_eq!(
        ran(&app, &["--version"], &[]).await,
        done("version:1.2.0\n")
    );
    assert_eq!(recorded(&loaded), ["loaded:version"]);
}

#[tokio::test]
async fn a_takeover_never_raises_the_fault_core_held_and_resolves_0() {
    let loaded = calls();
    let app = fixture(plugins(vec![help(&loaded), version(&loaded)]));
    assert_eq!(
        ran(&app, &["-h", "get", "--nope"], &[]).await,
        done("help:get\n")
    );
}

#[tokio::test]
async fn a_middleware_takes_over_the_root_group_and_a_group_without_the_callable_check() {
    let loaded = calls();
    let app = fixture(plugins(vec![help(&loaded), version(&loaded)]));
    assert_eq!(ran(&app, &["--help"], &[]).await, done("help:(root)\n"));
    assert_eq!(
        ran(&app, &["--help", "cache"], &[]).await,
        done("help:cache\n")
    );
}

#[tokio::test]
async fn an_unknown_command_runs_the_always_middleware_and_fails_at_the_boundary() {
    let loaded = calls();
    let app = fixture(plugins(vec![
        wrapper("outer", &loaded),
        wrapper("inner", &loaded),
    ]));
    let sentence = "Unknown command \"nope\". Use one of: get, cache.";
    assert_eq!(
        ran(&app, &["nope"], &[]).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: format!(
                "ℹ outer:start\nℹ inner:start\nℹ inner:rejected:{sentence}\nℹ inner:cleanup\nℹ outer:rejected:{sentence}\nℹ outer:cleanup\napp: {sentence}\n"
            ),
        }
    );
    assert_eq!(recorded(&loaded), ["loaded:outer", "loaded:inner"]);
}

#[tokio::test]
async fn the_callable_check_still_rejects_a_group_when_no_middleware_takes_over() {
    let loaded = calls();
    let app = fixture(plugins(vec![
        wrapper("outer", &loaded),
        wrapper("inner", &loaded),
    ]));
    let sentence = "Command \"cache\" requires a subcommand. Use one of: clear.";
    assert_eq!(
        ran(&app, &["cache"], &[]).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: format!(
                "ℹ outer:start\nℹ inner:start\nℹ inner:rejected:{sentence}\nℹ inner:cleanup\nℹ outer:rejected:{sentence}\nℹ outer:cleanup\napp: {sentence}\n"
            ),
        }
    );
}

#[tokio::test]
async fn two_always_on_wrappers_unwind_in_reverse_installation_order() {
    let loaded = calls();
    let app = fixture(plugins(vec![
        wrapper("outer", &loaded),
        wrapper("inner", &loaded),
    ]));
    let ran = ran(&app, &["get", "a.b"], &[]).await;
    assert_eq!(ran.status, 0);
    assert_eq!(
        ran.stderr,
        "ℹ outer:start\nℹ inner:start\nℹ inner:dispatched\nℹ inner:cleanup\nℹ outer:dispatched\nℹ outer:cleanup\n"
    );
}

#[tokio::test]
async fn a_wrapper_reads_a_later_takeover_as_its_own_outcome() {
    let loaded = calls();
    let app = fixture(plugins(vec![wrapper("outer", &loaded), help(&loaded)]));
    let ran = ran(&app, &["--help", "get"], &[]).await;
    assert_eq!(
        ran.stderr,
        "ℹ outer:start\nℹ outer:taken-over\nℹ outer:cleanup\n"
    );
    assert_eq!(ran.stdout, "help:get\n");
}

/// A `next` the stashing middleware kept, which the caller installed ahead of it runs once the
/// stashing middleware has returned.
type Stash = Arc<Mutex<Option<Next>>>;

fn stashing(stash: &Stash) -> Plugin {
    let stash = Arc::clone(stash);
    Plugin::new("@fixture/stashing").middleware(Activation::Always, move |ctx, next| {
        *stash.lock().unwrap() = Some(next);
        async move { ctx.out.info("stashing:taken-over").await }
    })
}

fn stash_caller(stash: &Stash, escaping: bool) -> Plugin {
    let stash = Arc::clone(stash);
    Plugin::new("@fixture/stash-caller").middleware(Activation::Always, move |ctx, next| {
        let stash = Arc::clone(&stash);
        async move {
            let outcome = next.run().await?;
            ctx.out.info(&format!("caller:{}", word(outcome))).await?;
            let stashed = stash.lock().unwrap().take().unwrap();
            match stashed.run().await {
                Err(error) if !escaping => {
                    ctx.out.info(&format!("caller:{}", sentence(&error))).await
                }
                other => other.map(|_| ()),
            }
        }
    })
}

#[tokio::test]
async fn a_next_a_middleware_kept_and_ran_after_it_returned_fails_and_dispatches_nothing() {
    let stash: Stash = Arc::default();
    let app = fixture(plugins(vec![stash_caller(&stash, false), stashing(&stash)]));
    assert_eq!(
        ran(&app, &["get", "a.b"], &[]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "ℹ stashing:taken-over\nℹ caller:taken-over\nℹ caller:Plugin \"@fixture/stashing\" called next() after its middleware returned.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_next_misuse_that_escapes_is_the_runs_defect() {
    let stash: Stash = Arc::default();
    let app = fixture(plugins(vec![stash_caller(&stash, true), stashing(&stash)]));
    let ran = ran(&app, &["get", "a.b"], &[]).await;
    assert_eq!(ran.status, 1);
    assert!(
        ran.stderr.ends_with("app: Something went wrong.\n"),
        "{}",
        ran.stderr
    );
    let developed = developed(&app, &["get", "a.b"], &[]).await;
    assert_eq!(developed.status, 1);
    assert_eq!(
        developed
            .stderr
            .matches("@loomcli/core/next-misuse")
            .count(),
        1
    );
    assert!(
        developed
            .stderr
            .contains("Plugin \"@fixture/stashing\" called next() after its middleware returned.")
    );
}

#[tokio::test]
async fn a_next_misuse_that_escapes_reaches_the_view_the_application_registered_for_its_class() {
    let stash: Stash = Arc::default();
    let app = Application::new("app")
        .plugins(plugins(vec![stash_caller(&stash, true), stashing(&stash)]))
        .overrides([override_view(
            failure::<InternalError>(),
            FailureView::new(|failure: &InternalError, _| {
                format!("app internal: {}\n", failure.message())
            }),
        )])
        .action(|ctx: Context| async move { ctx.out.print("root").await });
    assert_eq!(
        ran(&app, &[], &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "ℹ stashing:taken-over\nℹ caller:taken-over\napp internal: Plugin \"@fixture/stashing\" called next() after its middleware returned.\n".to_owned(),
        }
    );
}

/// The two signals between a middleware that stops awaiting its `next` and the action it ran:
/// the action has started, and the middleware has let it go.
#[derive(Clone, Default)]
struct Handoff {
    started: Arc<tokio::sync::Notify>,
    released: Arc<tokio::sync::Notify>,
}

/// A middleware that stops awaiting `next` once the action starts, as a timeout does, says so,
/// lets the action go on, and returns.
fn abandoning(handoff: &Handoff, entry: &Calls) -> Plugin {
    let handoff = handoff.clone();
    let entry = Arc::clone(entry);
    Plugin::new("@fixture/abandoning").middleware(Activation::Always, move |ctx, next| {
        let handoff = handoff.clone();
        let entry = Arc::clone(&entry);
        async move {
            tokio::select! {
                reached = next.run() => {
                    push(&entry, format!("received:{:?}", reached.map(word).map_err(|e| sentence(&e))));
                }
                () = handoff.started.notified() => {}
            }
            ctx.out.info("abandoning:gave up").await?;
            handoff.released.notify_one();
            Ok(())
        }
    })
}

/// A wrapper that reports what its `next` settled with.
fn reporting() -> Plugin {
    Plugin::new("@fixture/reporting").middleware(Activation::Always, |ctx, next| async move {
        match next.run().await {
            Ok(outcome) => ctx.out.info(&format!("reporting:{}", word(outcome))).await,
            Err(error) => {
                ctx.out
                    .info(&format!("reporting:failed:{}", sentence(&error)))
                    .await?;
                Err(error)
            }
        }
    })
}

/// An application whose `get` action signals that it started, waits until it is let go, and then
/// finishes or fails by `LOOM_FIXTURE_ACTION`.
fn handed_off(list: Vec<Plugin>, handoff: &Handoff) -> GroupApp {
    let handoff = handoff.clone();
    Application::new("app")
        .plugins(plugins(list))
        .command(Command::new("get").action(move |ctx: Context| {
            let handoff = handoff.clone();
            async move {
                ctx.out.print("action started").await?;
                handoff.started.notify_one();
                handoff.released.notified().await;
                if env_is(&ctx.host, "LOOM_FIXTURE_ACTION", "fatal") {
                    return Err(ctx.out.fatal("the action failed"));
                }
                ctx.out.print("action finished").await
            }
        }))
}

#[tokio::test]
async fn a_next_the_middleware_stopped_awaiting_still_runs_the_action_to_its_end() {
    let handoff = Handoff::default();
    let entry = calls();
    let app = handed_off(vec![reporting(), abandoning(&handoff, &entry)], &handoff);
    assert_eq!(
        ran(&app, &["get"], &[]).await,
        Ran {
            status: 0,
            stdout: "action started\naction finished\n".to_owned(),
            stderr: "ℹ abandoning:gave up\nℹ reporting:dispatched\n".to_owned(),
        }
    );
    assert!(recorded(&entry).is_empty());
}

#[tokio::test]
async fn a_failure_of_a_next_the_middleware_stopped_awaiting_is_its_entrys_failure() {
    let handoff = Handoff::default();
    let entry = calls();
    let app = handed_off(vec![reporting(), abandoning(&handoff, &entry)], &handoff);
    assert_eq!(
        ran(&app, &["get"], &[("LOOM_FIXTURE_ACTION", "fatal")]).await,
        Ran {
            status: 1,
            stdout: "action started\n".to_owned(),
            stderr:
                "ℹ abandoning:gave up\nℹ reporting:failed:the action failed\nthe action failed\n"
                    .to_owned(),
        }
    );
    assert!(recorded(&entry).is_empty());
}

#[tokio::test]
async fn a_failure_returned_into_a_spawned_task_whose_handle_was_dropped_is_lost() {
    // docs/deviations.md: a `Next` future that returned its failure handed it to its caller, which
    // here is a task nothing awaits; the reference reports a `next()` no code observed.
    let started = Arc::new(tokio::sync::Notify::new());
    let spawner = Plugin::new("@fixture/spawner").middleware(Activation::Always, {
        let started = Arc::clone(&started);
        move |_, next| {
            let started = Arc::clone(&started);
            async move {
                drop(tokio::spawn(next.run()));
                started.notified().await;
                Ok(())
            }
        }
    });
    let app = Application::new("app")
        .plugins([spawner])
        .command(Command::new("get").action(move |ctx: Context| {
            let started = Arc::clone(&started);
            async move {
                started.notify_one();
                Err(ctx.out.fatal("the action failed"))
            }
        }));
    assert_eq!(ran(&app, &["get"], &[]).await, done(""));
}

/// A middleware that reports what the rest of the chain raised and then fails with a foreign error.
fn recatching() -> Plugin {
    Plugin::new("@fixture/recatching").middleware(Activation::Always, |ctx, next| async move {
        if let Err(error) = next.run().await {
            ctx.out
                .info(&format!("recatching:{}", sentence(&error)))
                .await?;
            return Err(Error::from_foreign(
                "the plugin failed after catching".into(),
            ));
        }
        Ok(())
    })
}

#[tokio::test]
async fn a_middleware_that_catches_and_fails_with_its_own_error_exits_with_that_failure() {
    let app = fixture(plugins(vec![recatching()]));
    assert_eq!(
        ran(&app, &["get"], &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "ℹ recatching:Argument \"path\" requires a value. Supply a value for \"path\".\napp: Something went wrong.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_middleware_that_catches_the_held_fault_decides_the_outcome_read_as_taken_over() {
    let loaded = calls();
    let app = fixture(plugins(vec![wrapper("outer", &loaded), catching()]));
    assert_eq!(
        ran(&app, &["get"], &[]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "ℹ outer:start\nℹ catching:caught:Argument \"path\" requires a value. Supply a value for \"path\".\nℹ outer:taken-over\nℹ outer:cleanup\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_middleware_that_catches_the_actions_failure_decides_the_outcome_read_as_dispatched() {
    let loaded = calls();
    let app = fixture(plugins(vec![wrapper("outer", &loaded), catching()]));
    assert_eq!(
        ran(&app, &["get", "a.b"], &[("LOOM_FIXTURE_ACTION", "fatal")]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "ℹ outer:start\nℹ catching:caught:the action stopped the invocation\nℹ outer:dispatched\nℹ outer:cleanup\n".to_owned(),
        }
    );
    let alone = fixture(plugins(vec![catching()]));
    assert_eq!(
        ran(&alone, &["get", "a.b"], &[("LOOM_FIXTURE_ACTION", "fatal")]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "ℹ catching:caught:the action stopped the invocation\n".to_owned(),
        }
    );
}

/// A middleware that fails before `next` or while unwinding after it, by `LOOM_FIXTURE_THROW`.
fn throwing() -> Plugin {
    Plugin::new("@fixture/throwing").middleware(Activation::Always, |ctx, next| async move {
        let mode = ctx
            .host
            .env
            .get("LOOM_FIXTURE_THROW")
            .cloned()
            .unwrap_or_default();
        if mode == "fatal" {
            return Err(ctx.out.fatal("the plugin stopped the invocation"));
        }
        if mode == "usage" {
            return Err(InputError::new("the plugin rejected the invocation", Vec::new()).into());
        }
        let outcome = next.run().await?;
        ctx.out.info(&format!("throwing:{}", word(outcome))).await?;
        if mode == "unwind-usage" {
            return Err(InputError::new("the plugin rejected the outcome", Vec::new()).into());
        }
        Err(Error::from_foreign(
            "the plugin failed while unwinding".into(),
        ))
    })
}

#[tokio::test]
async fn a_failure_before_next_resolves_through_the_failure_path_with_its_own_code() {
    let app = fixture(plugins(vec![throwing()]));
    assert_eq!(
        ran(&app, &["get", "a.b"], &[("LOOM_FIXTURE_THROW", "fatal")]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "the plugin stopped the invocation\n".to_owned(),
        }
    );
    assert_eq!(
        ran(&app, &["get", "a.b"], &[("LOOM_FIXTURE_THROW", "usage")]).await,
        support::usage("app: the plugin rejected the invocation")
    );
}

#[tokio::test]
async fn a_middleware_failure_before_next_wins_over_a_held_missing_argument() {
    let app = fixture(plugins(vec![throwing()]));
    assert_eq!(
        ran(&app, &["get"], &[("LOOM_FIXTURE_THROW", "fatal")]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "the plugin stopped the invocation\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_failure_while_unwinding_is_the_middlewares_failure_with_its_own_class_and_code() {
    let app = fixture(plugins(vec![throwing()]));
    let get = "get:a.b:{\"raw\":false}\naction-signal:true:false\n";
    assert_eq!(
        ran(&app, &["get", "a.b"], &[("LOOM_FIXTURE_THROW", "unwind")]).await,
        Ran {
            status: 1,
            stdout: get.to_owned(),
            stderr: "ℹ throwing:dispatched\napp: Something went wrong.\n".to_owned(),
        }
    );
    assert_eq!(
        ran(
            &app,
            &["get", "a.b"],
            &[("LOOM_FIXTURE_THROW", "unwind-usage")]
        )
        .await,
        Ran {
            status: 2,
            stdout: get.to_owned(),
            stderr: "ℹ throwing:dispatched\napp: the plugin rejected the outcome\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn the_run_signal_reaches_the_middleware_and_the_action_and_nothing_cancels_it() {
    let signals =
        Plugin::new("@fixture/signals").middleware(Activation::Always, |ctx, next| async move {
            ctx.out
                .print(&format!(
                    "middleware-signal:true:{}",
                    ctx.signal.is_cancelled()
                ))
                .await?;
            next.run().await.map(|_| ())
        });
    let app = fixture(plugins(vec![signals]));
    assert_eq!(
        ran(&app, &["get", "a.b"], &[]).await,
        done("middleware-signal:true:false\nget:a.b:{\"raw\":false}\naction-signal:true:false\n")
    );
}

/// The stage's end-to-end check: a plugin that prints a help-like page and ends the run without
/// continuing writes its exact bytes and exits 0 while the routed Command holds a fault.
#[tokio::test]
async fn a_help_like_plugin_that_never_continues_prints_its_page_and_exits_0_under_a_held_fault() {
    let page = Plugin::new("@fixture/page")
        .option("help", Opt::boolean().short('h'))
        .middleware(Activation::options(["help"]), |ctx, _next| async move {
            let command = &ctx.command;
            let usage = format!(
                "Usage: {} {} <{}>",
                ctx.graph.name,
                command.path.join(" "),
                command.arguments[0].name
            );
            ctx.out.print(&usage).await?;
            ctx.out.print("").await?;
            ctx.out
                .print(command.description.as_deref().unwrap_or_default())
                .await
        });
    let app = fixture(plugins(vec![page]));
    // `get` misses its required argument and `--bogus` is no declared option: both are held.
    for argv in [
        &["get", "--help"][..],
        &["get", "--bogus", "-h"],
        &["--help", "get", "a.b", "extra"],
    ] {
        assert_eq!(
            ran(&app, argv, &[]).await,
            done("Usage: app get <path>\n\nRead one value at a path.\n"),
            "{argv:?}"
        );
    }
}

// plugin-options.test.ts: activation and every middleware read of `options`.

/// The settings plugin: four options of its own, which activate its middleware.
fn settings() -> Plugin {
    Plugin::new("@fixture/settings")
        .option(
            "cache",
            Opt::boolean().polarity(loomcli_core::Polarity::Both),
        )
        .option("mode", Opt::string().default("plain").short('m'))
        .option("quiet", Opt::boolean().short('q'))
        .option("tags", Opt::string().default(["one"]).multiple())
        .middleware(
            Activation::options(["cache", "mode", "quiet", "tags"]),
            |ctx, next| async move {
                ctx.out
                    .print(&format!("settings:{}", options_json(&ctx)))
                    .await?;
                next.run().await.map(|_| ())
            },
        )
}

/// A plugin whose validated `level` reads `debug`, `info`, or `warn` in upper case, and whose
/// always-on middleware prints the options it reads.
fn level() -> Plugin {
    Plugin::new("@fixture/level")
        .option(
            "level",
            Opt::string()
                .env(["FIXTURE_LEVEL"])
                .short('l')
                .validate(OneOfUpper(
                    &["debug", "info", "warn"],
                    "Use debug, info, or warn.",
                )),
        )
        .middleware(Activation::Always, |ctx, next| async move {
            ctx.out
                .print(&format!("observed:{}", options_json(&ctx)))
                .await?;
            next.run().await.map(|_| ())
        })
}

const DEFAULTS: &str = "\"cache\":false,\"mode\":\"plain\",\"quiet\":false,\"tags\":[\"one\"]";

#[tokio::test]
async fn a_declared_default_never_activates_a_middleware() {
    let app = fixture(plugins(vec![settings()]));
    assert_eq!(
        ran(&app, &["get", "a.b"], &[]).await,
        done(&format!(
            "get:a.b:{{{DEFAULTS},\"raw\":false}}\naction-signal:true:false\n"
        ))
    );
}

#[tokio::test]
async fn every_spelling_of_a_listed_option_activates_the_middleware() {
    let app = fixture(plugins(vec![settings()]));
    for token in ["--quiet", "-q", "--no-cache"] {
        let ran = ran(&app, &[token, "get", "a.b"], &[]).await;
        assert_eq!(ran.status, 0);
        assert!(ran.stdout.contains("settings:"), "{token}");
    }
}

#[tokio::test]
async fn a_plugins_option_values_reach_its_own_middleware_and_every_action() {
    let app = fixture(plugins(vec![settings()]));
    let values = "\"cache\":false,\"mode\":\"fancy\",\"quiet\":true,\"tags\":[\"a\",\"b\"]";
    assert_eq!(
        ran(
            &app,
            &[
                "-q", "--mode", "fancy", "--tags", "a", "--tags", "b", "get", "a.b"
            ],
            &[]
        )
        .await,
        done(&format!(
            "settings:{{{values}}}\nget:a.b:{{{values},\"raw\":false}}\naction-signal:true:false\n"
        ))
    );
    let values = "\"cache\":false,\"mode\":\"fancy\",\"quiet\":false,\"tags\":[\"one\"]";
    assert_eq!(
        ran(&app, &["get", "a.b", "--mode", "fancy"], &[])
            .await
            .stdout,
        format!(
            "settings:{{{values}}}\nget:a.b:{{{values},\"raw\":false}}\naction-signal:true:false\n"
        )
    );
}

#[tokio::test]
async fn a_plugins_validated_option_reaches_every_middleware_and_the_action_as_its_output() {
    let app = fixture(plugins(vec![settings(), level()]));
    let values =
        format!("{DEFAULTS},\"level\":\"INFO\"").replace("\"quiet\":false", "\"quiet\":true");
    assert_eq!(
        ran(&app, &["-q", "--level", "info", "get", "a.b"], &[]).await,
        done(&format!(
            "settings:{{{values}}}\nobserved:{{{values}}}\nget:a.b:{{{values},\"raw\":false}}\naction-signal:true:false\n"
        ))
    );
}

#[tokio::test]
async fn a_rejected_global_leaves_options_none_and_a_local_fault_leaves_them_set() {
    let app = fixture(plugins(vec![settings(), level()]));
    assert_eq!(
        ran(&app, &["--level", "loud", "get", "a.b"], &[]).await,
        Ran {
            status: 2,
            stdout: "observed:null\n".to_owned(),
            stderr: "app: Option \"--level\": Use debug, info, or warn.\n".to_owned(),
        }
    );
    assert_eq!(
        ran(&app, &["-l", "loud", "get"], &[]).await,
        Ran {
            status: 2,
            stdout: "observed:null\n".to_owned(),
            stderr: "app: Option \"--level\": Use debug, info, or warn.\napp: Argument \"path\" requires a value. Supply a value for \"path\".\n".to_owned(),
        }
    );
    assert_eq!(
        ran(&app, &["get", "a.b"], &[("FIXTURE_LEVEL", "loud")]).await,
        Ran {
            status: 2,
            stdout: "observed:null\n".to_owned(),
            stderr: "app: Option \"--level\" (from FIXTURE_LEVEL): Use debug, info, or warn.\n"
                .to_owned(),
        }
    );
    assert!(
        ran(&app, &["get", "a.b"], &[("FIXTURE_LEVEL", "warn")])
            .await
            .stdout
            .contains(&format!("observed:{{{DEFAULTS},\"level\":\"WARN\"}}"))
    );
    let values = format!("observed:{{{DEFAULTS},\"level\":\"WARN\"}}\n");
    assert_eq!(
        ran(&app, &["--level", "warn", "get", "a.b", "--nope"], &[]).await,
        Ran {
            status: 2,
            stdout: values.clone(),
            stderr: "app: Unknown option \"--nope\". Supply a declared option, or pass it as an argument after \"--\".\n".to_owned(),
        }
    );
    assert_eq!(
        ran(&app, &["--level", "warn", "get"], &[]).await,
        Ran {
            status: 2,
            stdout: values,
            stderr: "app: Argument \"path\" requires a value. Supply a value for \"path\".\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn a_groups_missing_subcommand_leaves_options_set_and_a_rejected_global_makes_them_none() {
    let app = fixture(plugins(vec![settings(), level()]));
    assert_eq!(
        ran(&app, &["--level", "debug", "cache"], &[]).await.stdout,
        format!("observed:{{{DEFAULTS},\"level\":\"DEBUG\"}}\n")
    );
    assert_eq!(
        ran(&app, &["--level", "loud", "cache"], &[]).await,
        Ran {
            status: 2,
            stdout: "observed:null\n".to_owned(),
            stderr: "app: Command \"cache\" requires a subcommand. Use one of: clear.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_structural_fault_in_a_plugins_option_is_held_and_the_faulted_occurrence_activates_nothing()
 {
    let app = fixture(plugins(vec![settings()]));
    assert_eq!(
        ran(&app, &["--mode"], &[]).await,
        support::usage("app: Option \"--mode\" requires a value. Supply a value after \"--mode\".")
    );
    assert_eq!(
        ran(&app, &["-q", "get", "a.b", "-q"], &[]).await,
        Ran {
            status: 2,
            stdout: "settings:null\n".to_owned(),
            stderr: "app: Option \"-q\" can be supplied only once. Remove the repeated option.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn a_plugins_letters_read_in_a_short_group_like_any_global_options() {
    let app = fixture(plugins(vec![settings()]));
    let values = "\"cache\":false,\"mode\":\"fancy\",\"quiet\":true,\"tags\":[\"one\"]";
    assert_eq!(
        ran(&app, &["-qmfancy", "get", "a.b"], &[]).await.stdout,
        format!(
            "settings:{{{values}}}\nget:a.b:{{{values},\"raw\":false}}\naction-signal:true:false\n"
        )
    );
    assert_eq!(
        ran(&app, &["-Zq", "get", "a.b"], &[]).await,
        support::usage(
            "app: Unknown option \"-Z\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
}

// middleware-spellings.test.ts

/// The spelled plugin's middleware prints the spellings it reads, as JSON.
fn spelled() -> Plugin {
    Plugin::new("@fixture/spelled")
        .option(
            "flag",
            Opt::boolean()
                .polarity(loomcli_core::Polarity::Both)
                .short('f'),
        )
        .option("level", Opt::string().env(["FIXTURE_LEVEL"]))
        .option("mode", Opt::string().default("plain"))
        .option("name", Opt::string().multiple().short('n'))
        .option("quiet", Opt::boolean().short('q'))
        .middleware(Activation::Always, |ctx, next| async move {
            let spellings: serde_json::Map<String, Value> = ctx
                .spellings
                .iter()
                .map(|(name, spelling)| (name.to_owned(), json!(spelling)))
                .collect();
            ctx.out
                .print(&format!("options:{}", options_json(&ctx)))
                .await?;
            ctx.out
                .print(&format!("spellings:{}", Value::Object(spellings)))
                .await?;
            next.run().await.map(|_| ())
        })
}

fn spelling_app() -> App {
    Application::new("app")
        .plugins((
            spelled(),
            Plugin::new("@fixture/neighbor").option("loud", Opt::boolean()),
        ))
        .global_option("file", Opt::string().short('F'))
        .option("local", Opt::boolean())
        .action(|ctx: Context| async move { ctx.out.print("root").await })
}

/// The spellings record one run's middleware read.
async fn spellings_of(argv: &[&str], env: &[(&str, &str)]) -> (Value, Value) {
    let ran = ran(&spelling_app(), argv, env).await;
    assert_eq!(ran.stderr, "", "{argv:?}");
    let read = |label: &str| -> Value {
        ran.stdout
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{label}:")))
            .map(|text| serde_json::from_str(text).unwrap())
            .unwrap_or(Value::Null)
    };
    (read("options"), read("spellings"))
}

#[tokio::test]
async fn a_middleware_reads_the_spelling_that_supplied_each_of_its_options() {
    let cases: [(&[&str], Value); 8] = [
        (&["--flag"], json!({"flag": "--flag"})),
        (&["-f"], json!({"flag": "-f"})),
        (&["--no-flag"], json!({"flag": "--no-flag"})),
        (&["--mode=fancy"], json!({"mode": "--mode"})),
        (&["--name=a"], json!({"name": "--name"})),
        (&["-qf"], json!({"flag": "-f", "quiet": "-q"})),
        (&["-n", "a", "--name", "b"], json!({"name": "--name"})),
        (&["--name", "a", "-n", "b"], json!({"name": "-n"})),
    ];
    for (argv, expected) in cases {
        assert_eq!(spellings_of(argv, &[]).await.1, expected, "{argv:?}");
    }
}

#[tokio::test]
async fn an_option_filled_by_an_input_source_or_left_to_its_default_has_no_spelling() {
    let (options, spellings) = spellings_of(&[], &[("FIXTURE_LEVEL", "debug")]).await;
    support::assert_matches(&options, &json!({"level": "debug", "mode": "plain"}));
    assert_eq!(spellings, json!({}));
}

#[tokio::test]
async fn another_plugin_and_the_application_keep_their_spellings_from_a_middleware() {
    assert_eq!(
        spellings_of(&["--loud", "-F", "doc.json", "--local", "-q"], &[])
            .await
            .1,
        json!({"quiet": "-q"})
    );
}

// own-options.test.ts

/// The owning plugin: a validated global option and a spare one of its own, and a validated local
/// option its hook declares on every Command with an action. Its middleware prints the record.
fn owning(validated: &Calls) -> Plugin {
    let mine = Arc::clone(validated);
    let local = Arc::clone(validated);
    Plugin::new("@fixture/owning")
        .option("mine", Opt::string().validate(Word(mine)))
        .option("spare", Opt::string())
        .on_command_attach(move |command| {
            if command.has_action() {
                command.option("local", Opt::string().validate(Word(Arc::clone(&local))))?;
            }
            Ok(())
        })
        .middleware(Activation::Always, |ctx, next| async move {
            let mut own = serde_json::Map::new();
            // The record holds only the options a pass validated, as the reference's keys do.
            for name in ["local", "mine", "spare"]
                .into_iter()
                .filter(|name| ctx.own_options.validated(name))
            {
                match ctx.own_options.option::<Option<String>>(name) {
                    Ok(Some(value)) => {
                        own.insert(name.to_owned(), json!(value));
                    }
                    Ok(None) => {
                        own.insert(name.to_owned(), json!("<undefined>"));
                    }
                    // A name the plugin's record does not hold on this Command.
                    Err(_) => {}
                }
            }
            ctx.out.print(&Value::Object(own).to_string()).await?;
            next.run().await.map(|_| ())
        })
}

/// A validator that accepts lowercase words and answers them in upper case, rejects `bad`, and
/// records each call.
struct Word(Calls);

impl loomcli_core::Validator for Word {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        push(&self.0, input);
        if !input.is_empty() && input.chars().all(|c| c.is_ascii_lowercase()) && input != "bad" {
            Ok(input.to_uppercase())
        } else {
            Err(vec![loomcli_core::Issue::new("Use a lowercase word.")])
        }
    }
}

fn owns(validated: &Calls, failing_source: bool) -> GroupApp {
    const SETTINGS: loomcli_core::Extension<loomcli_core::OptionTarget, String> =
        loomcli_core::Extension::new("@fixture/settings/key");
    let mut list: Vec<AnyPlugin> = vec![
        owning(validated).into(),
        Plugin::new("@fixture/other")
            .option("theirs", Opt::string())
            .into(),
    ];
    let mut fed = Opt::string();
    if failing_source {
        list.push(
            Plugin::new("@fixture/settings")
                .extensions([SETTINGS])
                .source(loomcli_core::ConfigurationSource::new(
                    &SETTINGS,
                    |_: loomcli_core::SourceContext<NoOptions>| async {
                        Err(InputError::new("The settings file cannot be read.", Vec::new()).into())
                    },
                ))
                .into(),
        );
        fed = fed.extend([SETTINGS.value("fed".to_owned())]);
    }
    Application::new("owns")
        .plugins(list)
        .global_option("app", Opt::string())
        .global_option("fed", fed)
        .command(
            Command::new("get")
                .option("depth", Opt::string().validate(Digits("Use digits.")))
                .action(|_: Context| async { Ok(()) }),
        )
}

/// The record the owning middleware printed, the run's status, its stderr, and each validator call.
async fn owned(argv: &[&str], failing_source: bool) -> (Value, u8, String, Vec<String>) {
    let validated = calls();
    let ran = ran(&owns(&validated, failing_source), argv, &[]).await;
    let record = ran
        .stdout
        .lines()
        .next()
        .map_or(Value::Null, |line| serde_json::from_str(line).unwrap());
    (record, ran.status, ran.stderr, recorded(&validated))
}

#[tokio::test]
async fn a_middleware_reads_its_plugins_own_validated_options_global_and_hook_declared() {
    let (own, status, stderr, calls) = owned(
        &[
            "get", "--mine", "abc", "--local", "xyz", "--app", "q", "--theirs", "t",
        ],
        false,
    )
    .await;
    assert_eq!(
        own,
        json!({"local": "XYZ", "mine": "ABC", "spare": "<undefined>"})
    );
    assert_eq!((status, stderr.as_str()), (0, ""));
    assert_eq!(calls, ["abc", "xyz"]);
}

#[tokio::test]
async fn its_own_options_stand_under_a_validation_problem_on_another_input() {
    let (own, status, ..) = owned(
        &["get", "--mine", "abc", "--local", "xyz", "--depth", "x"],
        false,
    )
    .await;
    assert_eq!(
        own,
        json!({"local": "XYZ", "mine": "ABC", "spare": "<undefined>"})
    );
    assert_eq!(status, 2);
}

#[tokio::test]
async fn under_a_held_structural_fault_core_validates_a_hook_declared_option_whose_tokens_parsed() {
    let (own, status, stderr, _) = owned(
        &["get", "--mine", "abc", "--local", "xyz", "--bogus"],
        false,
    )
    .await;
    assert_eq!(
        own,
        json!({"local": "XYZ", "mine": "ABC", "spare": "<undefined>"})
    );
    assert_eq!(status, 2);
    assert!(stderr.contains("owns: Unknown option \"--bogus\"."));
    let (own, status, stderr, _) = owned(&["get", "--bogus", "--local", "bad"], false).await;
    assert_eq!(own, json!({"mine": "<undefined>", "spare": "<undefined>"}));
    assert_eq!(status, 2);
    assert_eq!(
        stderr,
        "owns: Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
    );
}

#[tokio::test]
async fn an_option_is_absent_when_its_validator_rejected_it_or_its_own_occurrence_faulted() {
    let undefined = json!("<undefined>");
    let (own, ..) = owned(&["get", "--local", "bad"], false).await;
    assert_eq!(own, json!({"mine": undefined, "spare": undefined}));
    let (own, ..) = owned(&["get", "--mine", "bad", "--local", "xyz"], false).await;
    assert_eq!(own, json!({"local": "XYZ", "spare": undefined}));
    for argv in [
        &["get", "--bogus", "--local"][..],
        &["get", "--local", "abc", "--local", "def"],
        &["get", "--bogus"],
    ] {
        let (own, ..) = owned(argv, false).await;
        assert_eq!(
            own,
            json!({"mine": undefined, "spare": undefined}),
            "{argv:?}"
        );
    }
    let (own, ..) = owned(
        &["get", "--mine", "abc", "--mine", "def", "--local", "xyz"],
        false,
    )
    .await;
    assert_eq!(own, json!({"local": "XYZ", "spare": undefined}));
}

#[tokio::test]
async fn under_an_input_source_fault_core_validates_its_own_options_whose_tokens_parsed() {
    let (own, status, stderr, calls) =
        owned(&["get", "--mine", "abc", "--local", "xyz"], true).await;
    // An option the invocation omitted has no tokens, so no pass validates it and it is absent.
    assert_eq!(own, json!({"local": "XYZ", "mine": "ABC"}));
    assert_eq!(status, 2);
    assert_eq!(stderr, "owns: The settings file cannot be read.\n");
    assert_eq!(calls, ["abc", "xyz"]);
}

// request.test.ts

/// The request fixture (fixtures/plugins/request.mjs).
#[derive(Clone, Serialize)]
struct Row {
    source: String,
}

fn rows() -> Vec<Row> {
    ["one.txt", "two words.txt"]
        .into_iter()
        .map(|source| Row {
            source: source.to_owned(),
        })
        .collect()
}

fn count_command() -> Command<NoInputs, RowsResult<Row>> {
    Command::new("count")
        .description("The count command.")
        .rows(
            RowViews::new()
                .view(
                    "list",
                    RowView::new(|row: &Row, index: usize, _: &ViewContext| {
                        format!("{index}: {}\n", row.source)
                    })
                    .head(|_: &ViewContext| "PATHS\n".to_owned())
                    .tail(|_: usize, _: &ViewContext| "END\n".to_owned()),
                )
                .view(
                    "total",
                    View::new(|all: &[Row], _: &ViewContext| format!("{} rows\n", all.len())),
                )
                .view(
                    "wide",
                    RowView::new(|row: &Row, _: usize, _: &ViewContext| {
                        format!("[{}]\n", row.source)
                    }),
                ),
        )
        .action(
            |ctx: Context<NoInputs, RowsResult<Row>>| async move { ctx.out.results(rows()).await },
        )
}

fn request_app(list: Vec<AnyPlugin>) -> App {
    let get = Command::new("get")
        .description("The get command.")
        .argument("path", Arg::string().description("The path argument.").required())
        .option(
            "depth",
            Opt::string()
                .description("The depth option.")
                .validate(Number("Use decimal digits.")),
        )
        .option("raw", Opt::boolean().description("The raw option."))
        .passthrough(loomcli_core::Passthrough::new())
        .action(|ctx: Context| async move {
            let values = support::values_json(&ctx);
            let line = json!({"args": values["args"], "options": values["options"], "passthrough": ctx.passthrough});
            ctx.out.print(&format!("get:{line}")).await
        });
    let cache = Command::new("cache")
        .description("The cache command.")
        .command(
            Command::new("clear")
                .description("The clear command.")
                .action(|ctx: Context| async move { ctx.out.print("cleared").await }),
        );
    Application::new("app")
        .plugins(list)
        .description("The app application.")
        .version("1.2.0")
        .global_option(
            "file",
            Opt::string().description("The file option.").short('f'),
        )
        .command(get)
        .command(count_command())
        .command(cache)
        .action(|ctx: Context| async move { ctx.out.print("root").await })
}

/// Prints what the chain reads before the action runs, then continues.
fn reader() -> Plugin {
    Plugin::new("@fixture/reader").middleware(Activation::Always, |ctx, next| async move {
        ctx.out
            .print(&format!(
                "request:{}",
                request_json(&ctx.command, ctx.request.as_ref())
            ))
            .await?;
        ctx.out
            .print(&format!(
                "view:{}",
                ctx.view().unwrap_or_else(|| "null".to_owned())
            ))
            .await?;
        next.run().await.map(|_| ())
    })
}

/// Takes the invocation over, as a help plugin does, and says whether a request was read.
fn taking() -> Plugin {
    Plugin::new("@fixture/help")
        .option("help", Opt::boolean().short('h'))
        .middleware(Activation::options(["help"]), |ctx, _next| async move {
            let read = if ctx.request.is_some() {
                "request"
            } else {
                "null"
            };
            ctx.out.print(&format!("help:{read}")).await
        })
}

/// Assigns the view its variable names, before or after it continues.
fn selector(key: &'static str, after: bool) -> Plugin {
    Plugin::new(format!("@fixture/{key}")).middleware(
        Activation::Always,
        move |ctx, next| async move {
            let variable = format!("LOOM_FIXTURE_VIEW_{}", key.to_uppercase());
            let name = ctx.host.env.get(&variable).cloned();
            if let (false, Some(name)) = (after, &name) {
                ctx.select_view(name);
            }
            next.run().await?;
            if let (true, Some(name)) = (after, &name) {
                ctx.select_view(name);
            }
            Ok(())
        },
    )
}

/// An always-on wrapper that prints the outcome it wrapped.
fn outcome_wrapper() -> Plugin {
    Plugin::new("@fixture/wrapper").middleware(Activation::Always, |ctx, next| async move {
        let outcome = next.run().await?;
        ctx.out.print(&format!("wrapper:{}", word(outcome))).await
    })
}

#[tokio::test]
async fn a_middleware_reads_the_parsed_args_the_local_options_and_the_passthrough_words() {
    let app = request_app(plugins(vec![reader()]));
    assert_eq!(
        ran(
            &app,
            &[
                "get", "a.b", "--depth", "3", "-f", "doc.json", "--", "x", "y"
            ],
            &[]
        )
        .await,
        done(
            "request:{\"args\":{\"path\":\"a.b\"},\"options\":{\"depth\":3,\"raw\":false},\"passthrough\":[\"x\",\"y\"]}\nview:null\nget:{\"args\":{\"path\":\"a.b\"},\"options\":{\"file\":\"doc.json\",\"depth\":3,\"raw\":false},\"passthrough\":[\"x\",\"y\"]}\n"
        )
    );
}

#[tokio::test]
async fn the_request_is_none_under_a_held_fault_and_on_a_group() {
    let app = request_app(plugins(vec![reader()]));
    assert_eq!(
        ran(&app, &["get", "a.b", "--depth", "x"], &[]).await,
        Ran {
            status: 2,
            stdout: "request:null\nview:null\n".to_owned(),
            stderr: "app: Option \"--depth\": Use decimal digits.\n".to_owned(),
        }
    );
    assert_eq!(
        ran(&app, &["get", "a.b", "--nope"], &[]).await,
        Ran {
            status: 2,
            stdout: "request:null\nview:null\n".to_owned(),
            stderr: "app: Unknown option \"--nope\". Supply a declared option; prefix a hyphenated path with \"./\".\n".to_owned(),
        }
    );
    assert_eq!(
        ran(&app, &["cache"], &[]).await,
        Ran {
            status: 2,
            stdout: "request:null\nview:null\n".to_owned(),
            stderr: "app: Command \"cache\" requires a subcommand. Use one of: clear.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_takeover_under_a_held_fault_exits_0_with_no_diagnostic() {
    let app = request_app(plugins(vec![taking()]));
    assert_eq!(
        ran(&app, &["get", "--help"], &[]).await,
        done("help:null\n")
    );
}

#[tokio::test]
async fn a_successful_validator_effect_precedes_a_takeover() {
    let effects = calls();
    let validating = Arc::clone(&effects);
    let taking = Arc::clone(&effects);
    let app = Application::new("app")
        .plugins([Plugin::new("@fixture/help")
            .option("help", Opt::boolean().short('h'))
            .middleware(Activation::options(["help"]), move |ctx, _next| {
                let effects = Arc::clone(&taking);
                async move {
                    push(&effects, "takeover");
                    ctx.out
                        .print(&format!("effects:{}", recorded(&effects).join(",")))
                        .await?;
                    let read = if ctx.request.is_some() {
                        "request"
                    } else {
                        "null"
                    };
                    ctx.out.print(&format!("help:{read}")).await
                }
            })])
        .command(
            Command::new("get")
                .argument(
                    "path",
                    Arg::string().required().validate(Effect(validating)),
                )
                .action(|_: Context| async { Ok(()) }),
        );
    assert_eq!(
        ran(&app, &["get", "a.b", "--help"], &[]).await,
        done("effects:validation,takeover\nhelp:request\n")
    );
}

/// A validator whose acceptance has an effect.
struct Effect(Calls);

impl loomcli_core::Validator for Effect {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        push(&self.0, "validation");
        Ok(input.to_owned())
    }
}

#[tokio::test]
async fn an_always_on_wrapper_installed_ahead_of_a_takeover_still_reaches_the_takeover() {
    let app = request_app(plugins(vec![outcome_wrapper(), taking()]));
    assert_eq!(
        ran(&app, &["get", "--help"], &[]).await,
        done("help:null\nwrapper:taken-over\n")
    );
}

#[tokio::test]
async fn the_held_fault_raised_at_the_boundary_keeps_its_exit_code_and_its_rank() {
    let app = request_app(Vec::new());
    assert_eq!(
        ran(&app, &["get"], &[]).await,
        support::usage("app: Argument \"path\" requires a value. Supply a value for \"path\".")
    );
    assert_eq!(
        ran(&app, &["cache"], &[]).await,
        support::usage("app: Command \"cache\" requires a subcommand. Use one of: clear.")
    );
}

#[tokio::test]
async fn a_held_fault_ranks_ahead_of_a_bad_view_assignment() {
    let app = request_app(plugins(vec![selector("first", false)]));
    assert_eq!(
        ran(
            &app,
            &["count", "--nope"],
            &[("LOOM_FIXTURE_VIEW_FIRST", "yaml")]
        )
        .await,
        support::usage(
            "app: Unknown option \"--nope\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
}

#[tokio::test]
async fn a_run_cancelled_inside_a_validator_resolves_the_signal_code_and_raises_no_held_fault() {
    let token = tokio_util::sync::CancellationToken::new();
    let app = Application::new("app")
        .plugins(plugins(vec![reader()]))
        .command(
            Command::new("get")
                .argument(
                    "path",
                    Arg::string()
                        .required()
                        .validate(support::validators::Cancelling::new(&token)),
                )
                .action(|ctx: Context| async move { ctx.out.print("get").await }),
        )
        .action(|ctx: Context| async move { ctx.out.print("root").await });
    let process = loomcli_testing::mock_process(
        loomcli_testing::MockFields::new()
            .argv(["get", "a.b"])
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = app
        .run(
            loomcli_core::RunOptions::new()
                .process(Arc::clone(&process) as _)
                .signal(token),
        )
        .await;
    assert_eq!(code.get(), 130);
    assert_eq!(process.stderr_text(), "");
    assert_eq!(process.stdout_text(), "");
}

#[tokio::test]
async fn a_run_cancelled_mid_chain_never_reaches_the_boundary_and_raises_no_held_fault() {
    let token = tokio_util::sync::CancellationToken::new();
    let cancel = token.clone();
    let canceller =
        Plugin::new("@fixture/canceller").middleware(Activation::Always, move |ctx, next| {
            ctx.set_exit_code(loomcli_core::ExitCode::new(77));
            cancel.cancel();
            async move { next.run().await.map(|_| ()) }
        });
    let app = request_app(plugins(vec![canceller]));
    let process = loomcli_testing::mock_process(
        loomcli_testing::MockFields::new()
            .argv(["get"])
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = app
        .run(
            loomcli_core::RunOptions::new()
                .process(Arc::clone(&process) as _)
                .signal(token),
        )
        .await;
    assert_eq!(code.get(), 130);
    assert_eq!(process.stderr_text(), "");
    assert_eq!(process.stdout_text(), "");
}

#[tokio::test]
async fn view_reads_the_declarations_default_until_a_middleware_assigns_one() {
    let app = request_app(plugins(vec![reader()]));
    assert_eq!(
        ran(&app, &["count"], &[]).await,
        done(
            "request:{\"args\":{},\"options\":{},\"passthrough\":[]}\nview:list\nPATHS\n0: one.txt\n1: two words.txt\nEND\n"
        )
    );
    assert!(
        ran(&app, &["get", "a.b"], &[])
            .await
            .stdout
            .contains("view:null\n")
    );
}

#[tokio::test]
async fn view_reads_none_after_an_assignment_on_a_command_that_declares_no_result() {
    let app = request_app(plugins(vec![selector("first", false), reader()]));
    let env = [("LOOM_FIXTURE_VIEW_FIRST", "json")];
    let ran_once = ran(&app, &["get", "a.b"], &env).await;
    assert!(ran_once.stdout.contains("view:null\n"));
    assert_eq!(ran_once.status, 1);
    assert_eq!(ran_once.stderr, "app: Something went wrong.\n");
    assert!(developed(&app, &["get", "a.b"], &env).await.stderr.contains(
        "\n\nPlugin \"@fixture/first\" selected view \"json\" on Command \"get\", which declares no result.\n"
    ));
}

#[tokio::test]
async fn the_last_assignment_before_the_boundary_wins_across_two_middleware() {
    let app = request_app(plugins(vec![
        selector("first", false),
        selector("second", false),
    ]));
    assert_eq!(
        ran(
            &app,
            &["count"],
            &[
                ("LOOM_FIXTURE_VIEW_FIRST", "wide"),
                ("LOOM_FIXTURE_VIEW_SECOND", "total")
            ]
        )
        .await,
        done("2 rows\n")
    );
}

#[tokio::test]
async fn an_assignment_after_the_boundary_changes_nothing() {
    let app = request_app(plugins(vec![selector("late", true)]));
    assert_eq!(
        ran(&app, &["count"], &[("LOOM_FIXTURE_VIEW_LATE", "total")]).await,
        done("PATHS\n0: one.txt\n1: two words.txt\nEND\n")
    );
}

#[tokio::test]
async fn a_view_name_the_record_does_not_hold_is_a_view_selection_defect_naming_the_plugin() {
    let app = request_app(plugins(vec![selector("first", false)]));
    let env = [("LOOM_FIXTURE_VIEW_FIRST", "yaml")];
    assert_eq!(
        ran(&app, &["count"], &env).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "app: Something went wrong.\n".to_owned(),
        }
    );
    let stderr = developed(&app, &["count"], &env).await.stderr;
    assert!(
        stderr.starts_with("-- INVALID VIEW SELECTION -"),
        "{stderr}"
    );
    assert!(
        stderr
            .lines()
            .next()
            .unwrap()
            .ends_with(" @loomcli/core/view-selection")
    );
    assert!(stderr.contains(
        "\n\nPlugin \"@fixture/first\" selected view \"yaml\", which Command \"count\" does not name.\n"
    ));
}

#[tokio::test]
async fn a_selection_on_a_command_that_declares_no_result_is_an_internal_error_naming_the_plugin() {
    let app = request_app(plugins(vec![selector("first", false)]));
    let env = [("LOOM_FIXTURE_VIEW_FIRST", "json")];
    let ran_once = ran(&app, &["get", "a.b"], &env).await;
    assert_eq!(ran_once.status, 1);
    assert_eq!(ran_once.stderr, "app: Something went wrong.\n");
    assert!(developed(&app, &["get", "a.b"], &env).await.stderr.contains(
        "\n\nPlugin \"@fixture/first\" selected view \"json\" on Command \"get\", which declares no result.\n"
    ));
}

#[tokio::test]
async fn a_bad_view_assignment_stays_unobserved_under_a_takeover() {
    let app = request_app(plugins(vec![selector("first", false), taking()]));
    assert_eq!(
        ran(
            &app,
            &["get", "--help"],
            &[("LOOM_FIXTURE_VIEW_FIRST", "json")]
        )
        .await,
        done("help:null\n")
    );
}

#[tokio::test]
async fn out_results_renders_the_whole_or_row_view_a_middleware_selected() {
    let app = request_app(plugins(vec![selector("first", false)]));
    assert_eq!(
        ran(&app, &["count"], &[("LOOM_FIXTURE_VIEW_FIRST", "total")]).await,
        done("2 rows\n")
    );
    assert_eq!(
        ran(&app, &["count"], &[("LOOM_FIXTURE_VIEW_FIRST", "wide")]).await,
        done("[one.txt]\n[two words.txt]\n")
    );
}

// control-options.test.ts (run part)

/// The control-options fixture: four declarers, each declaring an option marked by `control` when
/// `marked` holds, beside one option that declares no mark.
fn declared(marked: bool, seen: &Calls) -> GroupApp {
    let middleware_seen = Arc::clone(seen);
    let action_seen = Arc::clone(seen);
    let declarer = Plugin::new("@fixture/declarer")
        .option(
            "depth",
            if marked {
                Opt::string().control().validate(Number("Use a number."))
            } else {
                Opt::string().validate(Number("Use a number."))
            },
        )
        .on_command_attach(move |command| {
            if command.name() == Some("get") {
                command.option(
                    "trace",
                    if marked {
                        Opt::boolean().control()
                    } else {
                        Opt::boolean()
                    },
                )?;
            }
            Ok(())
        })
        .middleware(Activation::options(["depth"]), move |ctx, next| {
            let seen = Arc::clone(&middleware_seen);
            async move {
                let depth = ctx
                    .options
                    .as_ref()
                    .and_then(|_| ctx.option::<Option<u64>>("depth").ok().flatten());
                push(
                    &seen,
                    format!(
                        "middleware:{}",
                        depth.map_or_else(|| "undefined".to_owned(), |depth| depth.to_string())
                    ),
                );
                next.run().await.map(|_| ())
            }
        });
    Application::new("probe")
        .plugins([declarer])
        .global_option(
            "level",
            if marked {
                Opt::string().control()
            } else {
                Opt::string()
            },
        )
        .command(
            Command::new("get")
                .option(
                    "raw",
                    if marked {
                        Opt::boolean().control()
                    } else {
                        Opt::boolean()
                    },
                )
                .option("field", Opt::string())
                .action(move |ctx: Context| {
                    let seen = Arc::clone(&action_seen);
                    async move {
                        let values = support::values_json(&ctx);
                        push(&seen, format!("action:{}", values["options"]));
                        Ok(())
                    }
                }),
        )
}

#[tokio::test]
async fn a_marked_option_parses_validates_activates_and_reaches_the_action_as_an_unmarked_one() {
    let mut outcomes = Vec::new();
    for marked in [true, false] {
        let seen = calls();
        let app = declared(marked, &seen);
        let first = ran(
            &app,
            &[
                "get", "--raw", "--trace", "--depth", "3", "--level", "high", "--field", "name",
            ],
            &[],
        )
        .await;
        let second = ran(&app, &["get", "--depth", "deep"], &[]).await;
        outcomes.push((
            first.status,
            second.status,
            recorded(&seen),
            format!("{}{}", first.stderr, second.stderr),
        ));
    }
    assert_eq!(outcomes[0], outcomes[1]);
    assert_eq!(
        outcomes[0],
        (
            0,
            2,
            vec![
                "middleware:3".to_owned(),
                "action:{\"level\":\"high\",\"depth\":3,\"raw\":true,\"field\":\"name\",\"trace\":true}"
                    .to_owned(),
                "middleware:undefined".to_owned(),
            ],
            "probe: Option \"--depth\": Use a number.\n".to_owned(),
        )
    );
}

// failure-selection.test.ts: the selection a middleware assigns.

/// The selecting plugin: its global `--pick` selects the view through its middleware, and its
/// failure hook reports the selection the hook context reads.
fn selecting() -> Plugin {
    Plugin::new("@fixture/selecting")
        .option(
            "pick",
            Opt::string().validate(OneOf(
                &["table", "json", "bad"],
                "Supply one of table, json, bad.",
            )),
        )
        .middleware(Activation::Always, |ctx, next| async move {
            let picked = ctx
                .options
                .as_ref()
                .and_then(|_| ctx.option::<Option<String>>("pick").ok().flatten());
            if let (Some(_), Some(picked)) = (ctx.view(), picked) {
                ctx.select_view(&picked);
            }
            next.run().await.map(|_| ())
        })
        .on_failure(
            |_: &dyn loomcli_core::Failure, context: &FailureHookContext| {
                selection_line(
                    "hook",
                    context.view.as_deref(),
                    context.media_type.as_deref(),
                )
            },
        )
}

fn selection_line(reader: &str, view: Option<&str>, media_type: Option<&str>) -> String {
    format!(
        "{reader}:{}:{}",
        view.unwrap_or("undefined"),
        media_type.unwrap_or("undefined")
    )
}

fn picks() -> GroupApp {
    let render = |data: &Value, _: &ViewContext| format!("{data}\n");
    let list = Command::new("list")
        .option(
            "depth",
            Opt::string().validate(Digits("Use decimal digits.")),
        )
        .rows(
            RowViews::new()
                .view(
                    "json",
                    View::new(move |rows: &[Value], context: &ViewContext| {
                        render(&json!(rows), context)
                    })
                    .media_type("application/json"),
                )
                .view(
                    "table",
                    View::new(move |rows: &[Value], context: &ViewContext| {
                        render(&json!(rows), context)
                    }),
                ),
        )
        .views(RowViews::new().default_view("table"))
        .action(|_: Context<NoInputs, RowsResult<Value>>| async move {
            Err(FatalError::new("Refused.").into())
        });
    let get = Command::new("get")
        .action(|_: Context| async move { Err(FatalError::new("Refused.").into()) });
    Application::new("picks")
        .plugins([selecting()])
        .overrides([override_view(
            failure::<LoomError>(),
            FailureView::new(|_: &LoomError, context| {
                std::iter::once(selection_line(
                    "view",
                    context.view.as_deref(),
                    context.media_type.as_deref(),
                ))
                .chain(context.hints.iter().cloned())
                .map(|line| format!("{line}\n"))
                .collect::<String>()
            }),
        )])
        .command(list)
        .command(get)
}

fn selection(view: &str, media_type: &str) -> String {
    format!("view:{view}:{media_type}\nhook:{view}:{media_type}\n")
}

#[tokio::test]
async fn after_dispatch_the_selection_is_the_view_the_boundary_read_else_the_default() {
    let app = picks();
    assert_eq!(
        ran(&app, &["list", "--pick", "json"], &[]).await.stderr,
        selection("json", "application/json")
    );
    assert_eq!(
        ran(&app, &["list"], &[]).await.stderr,
        selection("table", "undefined")
    );
}

#[tokio::test]
async fn a_held_fault_reads_the_selection_a_middleware_assigned_before_the_boundary() {
    let app = picks();
    assert_eq!(
        ran(&app, &["list", "--pick", "json", "--depth", "x"], &[])
            .await
            .stderr,
        selection("json", "application/json")
    );
    assert_eq!(
        ran(&app, &["list", "--pick", "json", "--bogus"], &[])
            .await
            .stderr,
        selection("json", "application/json")
    );
    assert_eq!(
        ran(&app, &["list", "--depth", "x"], &[]).await.stderr,
        selection("table", "undefined")
    );
}

#[tokio::test]
async fn a_rejected_selection_assigns_nothing_and_an_assigned_name_the_result_lacks_selects_nothing()
 {
    let app = picks();
    assert_eq!(
        ran(&app, &["list", "--pick", "yaml"], &[]).await.stderr,
        selection("table", "undefined")
    );
    assert_eq!(
        ran(&app, &["list", "--pick", "bad", "--bogus"], &[])
            .await
            .stderr,
        selection("undefined", "undefined")
    );
    assert_eq!(
        ran(&app, &["get", "--pick", "json"], &[]).await.stderr,
        selection("undefined", "undefined")
    );
}

// action-graph.test.ts

#[tokio::test]
async fn an_action_reads_the_graph_and_routed_node_the_middleware_read() {
    type Seen = Arc<Mutex<Option<(Arc<loomcli_core::CommandGraph>, Arc<CommandNode>)>>>;
    let seen: Seen = Arc::default();
    let observing = {
        let seen = Arc::clone(&seen);
        Plugin::new("@fixture/observer").middleware(Activation::Always, move |ctx, next| {
            *seen.lock().unwrap() = Some((Arc::clone(&ctx.graph), Arc::clone(&ctx.command)));
            async move { next.run().await.map(|_| ()) }
        })
    };
    let report = move |seen: Seen| {
        move |ctx: Context| {
            let seen = Arc::clone(&seen);
            async move {
                let words: Vec<&str> = ctx.command.path.iter().map(String::as_str).collect();
                let own = ctx
                    .graph
                    .command(&words)
                    .is_some_and(|node| Arc::ptr_eq(node, &ctx.command));
                let (same_graph, same_command) = seen.lock().unwrap().as_ref().map_or(
                    (Value::Null, Value::Null),
                    |(graph, command)| {
                        (
                            json!(Arc::ptr_eq(graph, &ctx.graph)),
                            json!(Arc::ptr_eq(command, &ctx.command)),
                        )
                    },
                );
                ctx.out
                    .print(
                        &json!({
                            "name": ctx.graph.name,
                            "own": own,
                            "path": ctx.command.path,
                            "sameCommand": same_command,
                            "sameGraph": same_graph,
                        })
                        .to_string(),
                    )
                    .await
            }
        }
    };
    let app = Application::new("observed")
        .plugins([observing])
        .command(
            Command::new("cache").command(
                Command::new("list")
                    .alias("l")
                    .action(report(Arc::clone(&seen))),
            ),
        )
        .action(report(Arc::clone(&seen)));
    let expected = |path: Value| json!({"name": "observed", "own": true, "path": path, "sameCommand": true, "sameGraph": true});
    assert_eq!(
        support::dispatched(&app, &["cache", "l"]).await,
        expected(json!(["cache", "list"]))
    );
    assert_eq!(support::dispatched(&app, &[]).await, expected(json!([])));
    let unseen: Seen = Arc::default();
    let plugged = Application::new("plugged")
        .plugins([Plugin::new("@fixture/doctor")
            .commands([Command::new("doctor").action(report(Arc::clone(&unseen)))])])
        .action(report(Arc::clone(&unseen)));
    assert_eq!(
        support::dispatched(&plugged, &["doctor"]).await,
        json!({"name": "plugged", "own": true, "path": ["doctor"], "sameCommand": null, "sameGraph": null})
    );
}

#[tokio::test]
async fn a_middleware_without_options_reads_none_typed_and_its_by_name_reads_of_undeclared_names_fault()
 {
    let app = Application::new("app")
        .plugins([Plugin::new("@fixture/reads")
            .option("mode", Opt::string())
            .middleware(
                Activation::Always,
                |ctx: MiddlewareContext<NoOptions>, next| async move {
                    let unknown = ctx.option::<Option<String>>("nope").unwrap_err();
                    let own = ctx.own_options.option::<bool>("mode").unwrap_err();
                    ctx.out
                        .print(&format!(
                            "{}|{}|{}",
                            unknown
                                .downcast_failure::<loomcli_core::DeclarationError>()
                                .unwrap()
                                .sentence(),
                            own.downcast_failure::<loomcli_core::DeclarationError>()
                                .unwrap()
                                .sentence(),
                            ctx.own_options
                                .option::<Option<String>>("mode")
                                .unwrap()
                                .unwrap()
                        ))
                        .await?;
                    next.run().await.map(|_| ())
                },
            )])
        .action(|_: Context| async { Ok(()) });
    assert_eq!(
        ran(&app, &["--mode", "x"], &[]).await.stdout,
        "The inputs read option \"nope\", which the routed Command does not declare.|The inputs read option \"mode\" as another type than its declaration produces.|x\n"
    );
}

#[tokio::test]
async fn a_bool_read_of_a_global_the_run_holds_no_value_for_faults_naming_the_missing_value() {
    let app = Application::new("app")
        .plugins([Plugin::new("@fixture/peek").middleware(
            Activation::Always,
            |ctx: MiddlewareContext<NoOptions>, next| async move {
                let held = ctx.option::<bool>("peek").unwrap_err();
                let optional = ctx.option::<Option<bool>>("peek").unwrap();
                let fault = held
                    .downcast_failure::<loomcli_core::DeclarationError>()
                    .unwrap();
                ctx.out
                    .print(&format!(
                        "{}|{}|{optional:?}",
                        fault.sentence(),
                        fault.correction().join(" ")
                    ))
                    .await?;
                next.run().await.map(|_| ())
            },
        )])
        .global_option("peek", Opt::boolean().short('k'))
        .global_option(
            "profile",
            Opt::string().short('p').validate(Digits("Use digits.")),
        )
        .action(|_: Context| async { Ok(()) });
    let ran = ran(&app, &["-k", "-p", "bad"], &[]).await;
    assert_eq!(
        ran,
        Ran {
            status: 2,
            stdout: "The inputs read option \"peek\" as a type that always holds a value, \
                     and the run holds none for it.|\
                     Read an input that may hold no value as Option<T>: Option<bool> for a \
                     Boolean option and Option<u32> for a counted one. A middleware reads every \
                     global option as absent while its options are None, which they are when a \
                     global option did not validate.|None\n"
                .to_owned(),
            stderr: "app: Option \"--profile\": Use digits.\n".to_owned(),
        }
    );
}

// parse.test.ts: help taking an invocation over, and the middleware's `options` and `request`.

fn kit(observed: bool) -> GroupApp {
    let help = Plugin::new("@fixture/help")
        .option("help", Opt::boolean().short('h'))
        .middleware(Activation::options(["help"]), |ctx, _next| async move {
            ctx.out
                .print(&format!("help:[{}]", ctx.command.path.join(" ")))
                .await
        });
    let observer =
        Plugin::new("@fixture/observer").middleware(Activation::Always, |ctx, next| async move {
            let request = if ctx.request.is_some() {
                "request"
            } else {
                "null"
            };
            ctx.out
                .print(&format!("observed:{}:{request}", options_json(&ctx)))
                .await?;
            next.run().await.map(|_| ())
        });
    let list: Vec<AnyPlugin> = if observed {
        plugins(vec![observer, help])
    } else {
        plugins(vec![help])
    };
    Application::new("kit")
        .plugins(list)
        .global_option("file", Opt::string().short('f'))
        .global_option("quiet", Opt::boolean().short('q'))
        .command(
            Command::new("get")
                .argument("path", Arg::string().required())
                .option("pretty", Opt::boolean().short('p'))
                .option("raw", Opt::boolean().short('r'))
                .option("depth", Opt::string().short('d'))
                .action(support::report),
        )
        .command(
            Command::new("keys")
                .argument("path", Arg::string())
                .option("raw", Opt::boolean().short('r'))
                .action(support::report),
        )
        .command(
            Command::new("cache")
                .command(
                    Command::new("clear")
                        .option("force", Opt::boolean())
                        .action(support::report),
                )
                .command(Command::new("list").action(support::report)),
        )
}

#[tokio::test]
async fn a_misplaced_option_is_held_so_help_takes_it_over_on_the_command_routing_reached() {
    let app = kit(false);
    assert_eq!(
        ran(
            &app,
            &["-qp", "-f", "data.json", "get", "a.b", "--help"],
            &[]
        )
        .await,
        done("help:[]\n")
    );
    assert_eq!(
        ran(&app, &["cache", "--verbose", "-h"], &[]).await.stdout,
        "help:[cache]\n"
    );
}

#[tokio::test]
async fn parsing_continues_past_a_fault_so_help_after_it_still_takes_the_invocation_over() {
    let app = kit(false);
    for argv in [
        &["--file", "--help"][..],
        &["--help", "--help"],
        &["-hx"],
        &["get", "--nope", "-h"],
    ] {
        let ran = ran(&app, argv, &[]).await;
        assert_eq!(ran.status, 0, "{argv:?}");
        assert!(ran.stdout.starts_with("help:["), "{argv:?}: {}", ran.stdout);
        assert_eq!(ran.stdout.lines().count(), 1, "{argv:?}");
    }
}

#[tokio::test]
async fn options_is_none_when_a_global_option_faults_and_a_local_fault_leaves_it_set() {
    let app = kit(true);
    let values = "{\"quiet\":false,\"help\":false}";
    assert!(
        ran(&app, &["get", "a.b"], &[])
            .await
            .stdout
            .starts_with(&format!("observed:{values}:request\n"))
    );
    for argv in [&["get", "a.b", "--nope"][..], &["cache"]] {
        assert_eq!(
            ran(&app, argv, &[]).await.stdout,
            format!("observed:{values}:null\n"),
            "{argv:?}"
        );
    }
    for argv in [
        &["get", "a.b", "-q", "-q"][..],
        &["--quiet=yes", "get", "a.b"],
        &["get", "a.b", "--nope", "--file"],
    ] {
        let ran = ran(&app, argv, &[]).await;
        assert_eq!(ran.stdout, "observed:null:null\n", "{argv:?}");
        assert_eq!(ran.status, 2);
    }
}

// translators.test.ts: the middleware cases.

#[derive(Debug)]
struct SyntaxError;

impl std::fmt::Display for SyntaxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Unexpected token.")
    }
}

impl std::error::Error for SyntaxError {}

#[derive(Debug, loomcli_core::Failure)]
#[failure(exit_code = loomcli_core::EX_UNAVAILABLE)]
struct UnavailableError {
    #[failure(base)]
    base: FatalError,
}

/// The application's translator, which records each call and answers with the 69 failure.
fn answering(calls: &Calls) -> loomcli_core::Translation {
    let calls = Arc::clone(calls);
    loomcli_core::translate(move |_: SyntaxError| {
        push(&calls, "application:SyntaxError");
        Ok(UnavailableError {
            base: FatalError::new("Unavailable from application."),
        })
    })
}

fn ending(action_fails: bool, plugin: Plugin, calls: &Calls) -> App {
    Application::new("translators")
        .plugins([plugin])
        .translators([answering(calls)])
        .action(move |ctx: Context| async move {
            if action_fails {
                Err(SyntaxError.into())
            } else {
                ctx.out.print("dispatched").await
            }
        })
}

fn translated(stdout: &str) -> Ran {
    Ran {
        status: 69,
        stdout: stdout.to_owned(),
        stderr: "Unavailable from application.\n".to_owned(),
    }
}

#[tokio::test]
async fn a_foreign_error_from_a_middleware_before_next_reaches_the_translator() {
    let calls = calls();
    let throwing = Plugin::new("@fixture/throwing")
        .middleware(Activation::Always, |_, _next| async {
            Err(SyntaxError.into())
        });
    assert_eq!(
        ran(&ending(false, throwing, &calls), &[], &[]).await,
        translated("")
    );
    assert_eq!(recorded(&calls), ["application:SyntaxError"]);
}

#[tokio::test]
async fn a_middleware_that_awaits_next_handles_the_raw_error_not_the_translated_failure() {
    let calls = calls();
    let raw = {
        let calls = Arc::clone(&calls);
        Plugin::new("@fixture/raw").middleware(Activation::Always, move |_, next| {
            let calls = Arc::clone(&calls);
            async move {
                let outcome = next.run().await;
                if let Err(error) = &outcome {
                    let raw = error
                        .foreign()
                        .is_some_and(|foreign| foreign.is::<SyntaxError>());
                    push(&calls, format!("caught:raw:{raw}"));
                }
                outcome.map(|_| ())
            }
        })
    };
    assert_eq!(
        ran(&ending(true, raw, &calls), &[], &[]).await,
        translated("")
    );
    assert_eq!(
        recorded(&calls),
        ["caught:raw:true", "application:SyntaxError"]
    );
}

#[tokio::test]
async fn an_error_a_middleware_handled_is_never_offered_and_the_middleware_decides_the_outcome() {
    let calls = calls();
    let catching = {
        let calls = Arc::clone(&calls);
        Plugin::new("@fixture/catching").middleware(Activation::Always, move |_, next| {
            let calls = Arc::clone(&calls);
            async move {
                if next.run().await.is_err() {
                    push(&calls, "caught");
                }
                Ok(())
            }
        })
    };
    assert_eq!(
        ran(&ending(true, catching, &calls), &[], &[]).await,
        done("")
    );
    assert_eq!(recorded(&calls), ["caught"]);
}

#[tokio::test]
async fn a_middleware_error_while_unwinding_is_offered_to_the_translators() {
    let calls = calls();
    let unwinding =
        Plugin::new("@fixture/unwinding").middleware(Activation::Always, |_, next| async move {
            next.run().await?;
            Err(SyntaxError.into())
        });
    assert_eq!(
        ran(&ending(false, unwinding, &calls), &[], &[]).await,
        translated("dispatched\n")
    );
    assert_eq!(recorded(&calls), ["application:SyntaxError"]);
}

#[tokio::test]
async fn a_translated_source_failure_is_held_so_a_takeover_reports_nothing() {
    const KEY: loomcli_core::Extension<loomcli_core::OptionTarget, String> =
        loomcli_core::Extension::new("@fixture/translators/key");
    let calls = calls();
    let source = Plugin::new("@fixture/source").extensions([KEY]).source(
        loomcli_core::ConfigurationSource::new(
            &KEY,
            |_: loomcli_core::SourceContext<NoOptions>| async { Err(SyntaxError.into()) },
        ),
    );
    let takeover = Plugin::new("@fixture/takeover")
        .middleware(Activation::Always, |ctx, _next| async move {
            ctx.out.print("took over").await
        });
    let app = Application::new("translators")
        .plugins((source, takeover))
        .translators([answering(&calls)])
        .global_option(
            "limit",
            Opt::string().extend([KEY.value("limit".to_owned())]),
        )
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    assert_eq!(ran(&app, &[], &[]).await, done("took over\n"));
    assert_eq!(recorded(&calls), ["application:SyntaxError"]);
}
