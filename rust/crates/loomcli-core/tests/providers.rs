//! Providers through a run: opting in, nothing built before the dispatch boundary, the lifetimes'
//! closing order, failing openers and closes, cancellation during a build, the substituted opener,
//! and the `uses` faults at the call.
//!
//! Ported from the reference's `providers.test.ts` (every case a single run can hold; the nested
//! `invoke` lifetimes and the shutdown budget belong to the stages that own `invoke` and
//! signals), and the provider rows of `plugin-diagnostics.test.ts`. A provider's opener is a
//! function, not a module `load`, so the module-mocking tests become `RunOptions::substitute`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::__private::install_log_hook;
use loomcli_core::{
    Activation, Application, Command, Context, DeclarationError, EX_DATAERR, EX_SOFTWARE,
    EX_TEMPFAIL, EX_UNAVAILABLE, Error, Failure, FatalError, LogDestination, LogEvent, LogLevel,
    Opt, Persistent, Plugin, Provider, ProviderContext, Region, RegionCloser, RegionOptions,
    RunOptions, State, translate,
};
use loomcli_testing::{MockFields, mock_process};
use support::Ran;
use support::faults::{panic_message, panic_rule};
use tokio_util::sync::CancellationToken;

type Lines = Arc<Mutex<Vec<String>>>;

fn journal() -> Lines {
    Arc::default()
}

fn push(lines: &Lines, line: impl Into<String>) {
    lines.lock().unwrap().push(line.into());
}

fn read(lines: &Lines) -> Vec<String> {
    lines.lock().unwrap().clone()
}

/// A failure the database raises, which exits 69.
#[derive(Debug, Failure)]
#[failure(exit_code = EX_UNAVAILABLE)]
struct UnavailableError {
    #[failure(base)]
    base: FatalError,
}

/// A failure a translator answers, which exits 70.
#[derive(Debug, Failure)]
#[failure(exit_code = EX_SOFTWARE)]
struct BrokenError {
    #[failure(base)]
    base: FatalError,
}

/// A failure a close raises, which exits 75.
#[derive(Debug, Failure)]
#[failure(exit_code = EX_TEMPFAIL)]
struct BusyError {
    #[failure(base)]
    base: FatalError,
}

/// A failure the action raises, which exits 65.
#[derive(Debug, Failure)]
#[failure(exit_code = EX_DATAERR)]
struct RejectedError {
    #[failure(base)]
    base: FatalError,
}

fn rejected(message: &str) -> Error {
    RejectedError {
        base: FatalError::new(message),
    }
    .into()
}

/// A value that names itself.
struct Named {
    name: String,
}

/// An ephemeral provider with no inputs whose opener records its build and whose close records
/// its close. One factory, so every provider it returns has one opener type and differs by name.
fn recorded(lines: &Lines, name: &'static str) -> Provider<Named> {
    let opened = Arc::clone(lines);
    let closed = Arc::clone(lines);
    Provider::new(name, move |_: ProviderContext| {
        push(&opened, format!("open {name}"));
        async move {
            Ok(Named {
                name: name.to_owned(),
            })
        }
    })
    .close(move |value: Arc<Named>| {
        push(&closed, format!("close {}", value.name));
        async { Ok(()) }
    })
}

/// A persistent pool that reads the `label` global option, and an ephemeral session on it.
fn pool(lines: &Lines) -> Provider<Named, Persistent> {
    let opened = Arc::clone(lines);
    let closed = Arc::clone(lines);
    Provider::persistent("pool", move |ctx: ProviderContext| {
        let label = ctx
            .options
            .option::<Option<String>>("label")
            .unwrap()
            .unwrap_or_default();
        push(&opened, format!("open pool {label}"));
        async {
            Ok(Named {
                name: "pool".to_owned(),
            })
        }
    })
    .close(move |_: Arc<Named>| {
        push(&closed, "close pool");
        async { Ok(()) }
    })
}

fn session(lines: &Lines) -> Provider<Named> {
    let opened = Arc::clone(lines);
    let closed = Arc::clone(lines);
    Provider::new("session", move |_: ProviderContext| {
        push(&opened, "open session");
        async {
            Ok(Named {
                name: "session".to_owned(),
            })
        }
    })
    .uses([&pool(lines)])
    .close(move |_: Arc<Named>| {
        push(&closed, "close session");
        async { Ok(()) }
    })
}

/// A provider whose close fails with a Busy failure.
fn throwing(name: &'static str, message: &'static str) -> Provider<String> {
    Provider::new(name, move |_: ProviderContext| async move {
        Ok(name.to_owned())
    })
    .close(move |_: Arc<String>| async move {
        Err(BusyError {
            base: FatalError::new(message),
        }
        .into())
    })
}

async fn run<I, R, S: State>(application: &Application<I, R, S>, argv: &[&str]) -> Ran {
    support::run(application, argv).await
}

/// A run with these options on a mock with these words, as the reference's own-process tests run.
async fn run_with_options<I, R, S: State>(
    application: &Application<I, R, S>,
    argv: &[&str],
    options: RunOptions,
) -> Ran {
    let process = mock_process(MockFields::new().argv(argv.iter().copied()));
    let code = application
        .run(options.process(Arc::clone(&process) as _))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// The application with an `on_log` hook that collects every event.
fn collecting<I, R, S>(
    application: Application<I, R, S>,
    events: &Arc<Mutex<Vec<LogEvent>>>,
) -> Application<I, R, S> {
    let events = Arc::clone(events);
    install_log_hook(application, move |event: &LogEvent, _: &LogDestination| {
        events.lock().unwrap().push(event.clone());
    })
}

// Opting in.

#[tokio::test]
async fn reads_each_listed_value_and_builds_a_dependency_without_providing_it() {
    let lines = journal();
    let base = recorded(&lines, "base");
    let derived = Provider::new("derived", |ctx: ProviderContext| async move {
        let base = ctx.provided(&recorded(&journal(), "base"))?;
        Ok(format!("derived from {}", base.name))
    })
    .uses([&base]);
    let app = Application::new("app").command(Command::new("get").uses([&derived]).action({
        let lines = Arc::clone(&lines);
        let derived = derived.clone();
        move |ctx: Context| {
            let lines = Arc::clone(&lines);
            let derived = derived.clone();
            async move {
                let value = ctx.provided(&derived)?;
                let unlisted = ctx
                    .provided(&recorded(&journal(), "base"))
                    .err()
                    .and_then(|error| {
                        error
                            .downcast_failure::<DeclarationError>()
                            .map(|fault| fault.sentence().to_owned())
                    })
                    .unwrap_or_default();
                push(&lines, format!("action {value}"));
                push(&lines, unlisted);
                Ok(())
            }
        }
    }));
    let ran = run(&app, &["get"]).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert_eq!(
        read(&lines),
        [
            "open base",
            "action derived from base",
            "The action read provider \"base\", which its uses does not list.",
            "close base"
        ]
    );
}

#[tokio::test]
async fn hands_an_opener_the_validated_globals_the_host_the_log_and_the_signal() {
    let seen = journal();
    let events: Arc<Mutex<Vec<LogEvent>>> = Arc::default();
    fn token(seen: &Lines) -> Provider<String> {
        let seen = Arc::clone(seen);
        Provider::new("token", move |ctx: ProviderContext| {
            ctx.log.info("Opening the token.", ());
            let token = ctx.options.option::<Option<String>>("token").unwrap();
            push(
                &seen,
                format!(
                    "{} {} {} {:?}",
                    token.clone().unwrap_or_default(),
                    ctx.host.argv.join(" "),
                    ctx.signal.is_cancelled(),
                    ctx.invoked_by
                ),
            );
            async move { Ok(format!("token {}", token.as_deref().unwrap_or("none"))) }
        })
    }
    let app = Application::new("app")
        .global_option("token", Opt::string())
        .command(Command::new("get").uses([&token(&seen)]).action({
            let seen = Arc::clone(&seen);
            move |ctx: Context| {
                let seen = Arc::clone(&seen);
                async move {
                    let provided = ctx.provided(&token(&journal()))?;
                    let option = ctx.option::<Option<String>>("token")?.unwrap_or_default();
                    push(&seen, format!("{provided} {option}"));
                    Ok(())
                }
            }
        }));
    let app = collecting(app, &events);
    assert_eq!(run(&app, &["--token", "abc", "get"]).await.status, 0);
    assert_eq!(
        read(&seen),
        ["abc --token abc get false Argv", "token abc abc"]
    );
    let events: Vec<(String, Option<String>)> = events
        .lock()
        .unwrap()
        .iter()
        .map(|event| (event.message.clone(), event.plugin.clone()))
        .collect();
    assert_eq!(events, [("Opening the token.".to_owned(), None)]);
}

#[tokio::test]
async fn hands_an_opener_out_style_and_the_graph_the_run_built() {
    let note = Provider::new("note", |ctx: ProviderContext| async move {
        ctx.out
            .warn(&format!(
                "Opened under {}.",
                ctx.style.escape(&ctx.graph.name)
            ))
            .await?;
        Ok(ctx.graph.name.clone())
    });
    let app = Application::new("app").command(Command::new("get").uses([&note]).action({
        let note = note.clone();
        move |ctx: Context| {
            let note = note.clone();
            async move {
                let name = ctx.provided(&note)?;
                ctx.out.print(&format!("action {name}")).await
            }
        }
    }));
    let ran = run(&app, &["get"]).await;
    assert_eq!(ran.status, 0);
    assert!(ran.stderr.contains("Opened under app."), "{}", ran.stderr);
    assert_eq!(ran.stdout, "action app\n");
}

#[tokio::test]
async fn builds_a_provider_reached_twice_once() {
    let lines = journal();
    fn pool(lines: &Lines) -> Provider<Named> {
        recorded(lines, "pool")
    }
    fn session(lines: &Lines) -> Provider<String> {
        Provider::new("session", |ctx: ProviderContext| async move {
            let pool = ctx.provided(&pool(&journal()))?;
            Ok(format!("session on {}", pool.name))
        })
        .uses([&pool(lines)])
    }
    let app = Application::new("app").command(
        Command::new("get")
            .uses((&session(&lines), &pool(&lines)))
            .action({
                let lines = Arc::clone(&lines);
                move |ctx: Context| {
                    let lines = Arc::clone(&lines);
                    async move {
                        let session = ctx.provided(&session(&journal()))?;
                        let pool = ctx.provided(&pool(&journal()))?;
                        push(&lines, format!("action {session} {}", pool.name));
                        Ok(())
                    }
                }
            }),
    );
    assert_eq!(run(&app, &["get"]).await.status, 0);
    assert_eq!(
        read(&lines),
        ["open pool", "action session on pool pool", "close pool"]
    );
}

#[tokio::test]
async fn covers_the_roots_own_action_through_the_applications_uses() {
    let lines = journal();
    let app = Application::new("app")
        .uses([&recorded(&lines, "root")])
        .action({
            let lines = Arc::clone(&lines);
            move |ctx: Context| {
                let lines = Arc::clone(&lines);
                async move {
                    let root = ctx.provided(&recorded(&journal(), "root"))?;
                    push(&lines, format!("action {}", root.name));
                    Ok(())
                }
            }
        });
    assert_eq!(run(&app, &[]).await.status, 0);
    assert_eq!(read(&lines), ["open root", "action root", "close root"]);
}

// Nothing before the boundary.

#[tokio::test]
async fn builds_nothing_for_a_takeover() {
    let lines = journal();
    let takeover =
        Plugin::new("test/takeover").middleware(Activation::Always, |_, _next| async { Ok(()) });
    let app = Application::new("app").plugins([takeover]).command(
        Command::new("get")
            .uses([&recorded(&lines, "value")])
            .action(|_: Context| async { Ok(()) }),
    );
    assert_eq!(run(&app, &["get"]).await.status, 0);
    assert!(read(&lines).is_empty());
}

#[tokio::test]
async fn closes_the_values_of_an_action_a_middleware_stopped_awaiting_before_the_run_resolves() {
    let lines = journal();
    let started = Arc::new(tokio::sync::Notify::new());
    let released = Arc::new(tokio::sync::Notify::new());
    let timer = Plugin::new("test/timer").middleware(Activation::Always, {
        let (started, released, lines) = (
            Arc::clone(&started),
            Arc::clone(&released),
            Arc::clone(&lines),
        );
        move |_, next| {
            let (started, released, lines) = (
                Arc::clone(&started),
                Arc::clone(&released),
                Arc::clone(&lines),
            );
            async move {
                // The timer fires once the action starts, which drops the `next` future.
                tokio::select! {
                    _ = next.run() => push(&lines, "timer:settled"),
                    () = started.notified() => push(&lines, "timer:timed out"),
                }
                released.notify_one();
                Ok(())
            }
        }
    });
    let app = Application::new("app").plugins([timer]).command(
        Command::new("get")
            .uses([&recorded(&lines, "value")])
            .action({
                let lines = Arc::clone(&lines);
                move |ctx: Context| {
                    let (started, released, lines) = (
                        Arc::clone(&started),
                        Arc::clone(&released),
                        Arc::clone(&lines),
                    );
                    async move {
                        let value = ctx.provided(&recorded(&journal(), "value"))?;
                        push(&lines, format!("action started with {}", value.name));
                        started.notify_one();
                        released.notified().await;
                        push(&lines, "action finished");
                        Ok(())
                    }
                }
            }),
    );
    let ran = run(&app, &["get"]).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (0, "", "")
    );
    assert_eq!(
        read(&lines),
        [
            "open value",
            "action started with value",
            "timer:timed out",
            "action finished",
            "close value",
        ]
    );
}

#[tokio::test]
async fn builds_nothing_for_a_held_input_fault() {
    let lines = journal();
    let app = Application::new("app").command(
        Command::new("get")
            .uses([&recorded(&lines, "value")])
            .argument("id", loomcli_core::Arg::string().required())
            .action(|_: Context| async { Ok(()) }),
    );
    let ran = run(&app, &["get"]).await;
    assert_eq!(ran.status, 2);
    assert!(ran.stderr.contains("id"));
    assert!(read(&lines).is_empty());
}

#[tokio::test]
async fn builds_nothing_for_a_command_that_opts_in_to_nothing_whose_reads_fault() {
    let lines = journal();
    let app = Application::new("app")
        .command(
            Command::new("used")
                .uses([&recorded(&lines, "value")])
                .action(|_: Context| async { Ok(()) }),
        )
        .command(Command::new("plain").action({
            let lines = Arc::clone(&lines);
            move |ctx: Context| {
                let lines = Arc::clone(&lines);
                async move {
                    let read = ctx.provided(&recorded(&journal(), "value")).is_err();
                    push(&lines, format!("action unlisted:{read}"));
                    Ok(())
                }
            }
        }));
    assert_eq!(run(&app, &["plain"]).await.status, 0);
    assert_eq!(read(&lines), ["action unlisted:true"]);
}

// Lifetimes.

#[tokio::test]
async fn closes_the_ephemeral_values_before_the_persistent_ones_of_the_outermost_run() {
    let lines = journal();
    let app = Application::new("app")
        .global_option("label", Opt::string())
        .command(Command::new("child").uses([&session(&lines)]).action({
            let lines = Arc::clone(&lines);
            move |_: Context| {
                push(&lines, "child");
                async { Ok(()) }
            }
        }));
    assert_eq!(run(&app, &["--label", "outer", "child"]).await.status, 0);
    assert_eq!(
        read(&lines),
        [
            "open pool outer",
            "open session",
            "child",
            "close session",
            "close pool"
        ]
    );
}

#[tokio::test]
async fn hands_an_opener_invoked_by_argv_under_run() {
    let seen = journal();
    let probe = {
        let seen = Arc::clone(&seen);
        Provider::new("probe", move |ctx: ProviderContext| {
            push(&seen, format!("{:?}", ctx.invoked_by));
            async { Ok(()) }
        })
    };
    let app = Application::new("app")
        .uses([&probe])
        .action(|_: Context| async { Ok(()) });
    assert_eq!(run(&app, &[]).await.status, 0);
    assert_eq!(read(&seen), ["Argv"]);
}

// Closing.

fn closer_word(closer: Option<RegionCloser>) -> &'static str {
    match closer {
        Some(RegionCloser::Completion) => "completion",
        Some(RegionCloser::Failure) => "failure",
        Some(RegionCloser::Cancellation) => "cancellation",
        Some(RegionCloser::End) => "end",
        _ => "open",
    }
}

type Opened = Arc<Mutex<Option<Region>>>;

/// A provider whose close records how the action's region was closed when it ran.
fn probe(lines: &Lines, opened: &Opened, prefix: &'static str) -> Provider<String> {
    let lines = Arc::clone(lines);
    let opened = Arc::clone(opened);
    Provider::new("probe", |_: ProviderContext| async {
        Ok("probe".to_owned())
    })
    .close(move |_: Arc<String>| {
        let closed_by = opened.lock().unwrap().as_ref().and_then(Region::closed_by);
        push(&lines, format!("{prefix}{}", closer_word(closed_by)));
        async { Ok(()) }
    })
}

#[tokio::test]
async fn closes_in_reverse_build_order_after_the_regions_and_before_the_middleware_unwinds() {
    let lines = journal();
    let opened: Opened = Arc::default();
    let around = {
        let lines = Arc::clone(&lines);
        Plugin::new("test/around").middleware(Activation::Always, move |_, next| {
            let lines = Arc::clone(&lines);
            async move {
                next.run().await?;
                push(&lines, "after next");
                Ok(())
            }
        })
    };
    let app = Application::new("app").plugins([around]).command(
        Command::new("get")
            .uses((
                &probe(&lines, &opened, "close probe "),
                &recorded(&lines, "first"),
                &recorded(&lines, "second"),
            ))
            .action({
                let lines = Arc::clone(&lines);
                let opened = Arc::clone(&opened);
                move |ctx: Context| {
                    *opened.lock().unwrap() = Some(ctx.out.region(RegionOptions::new()));
                    push(&lines, "action");
                    async { Ok(()) }
                }
            }),
    );
    assert_eq!(run(&app, &["get"]).await.status, 0);
    assert_eq!(
        read(&lines),
        [
            "open first",
            "open second",
            "action",
            "close second",
            "close first",
            "close probe completion",
            "after next"
        ]
    );
}

#[tokio::test]
async fn closes_an_actions_regions_for_its_failure_before_its_values_close() {
    let lines = journal();
    let opened: Opened = Arc::default();
    let app = Application::new("app").command(
        Command::new("get")
            .uses([&probe(&lines, &opened, "close ")])
            .action({
                let opened = Arc::clone(&opened);
                move |ctx: Context| {
                    *opened.lock().unwrap() = Some(ctx.out.region(RegionOptions::new()));
                    async { Err(rejected("The action failed.")) }
                }
            }),
    );
    assert_eq!(run(&app, &["get"]).await.status, 65);
    let closed_by = opened.lock().unwrap().as_ref().and_then(Region::closed_by);
    assert_eq!(read(&lines), ["close failure"]);
    assert_eq!(closer_word(closed_by), "failure");
}

// Failures.

#[tokio::test]
async fn closes_what_was_built_when_an_opener_fails_and_never_runs_the_action() {
    let lines = journal();
    let broken = Provider::new("broken", |_: ProviderContext| async {
        Err::<String, Error>(
            UnavailableError {
                base: FatalError::new("The database refused the connection."),
            }
            .into(),
        )
    });
    let app = Application::new("app").command(
        Command::new("get")
            .uses((
                &recorded(&lines, "built"),
                &broken,
                &recorded(&lines, "never"),
            ))
            .action({
                let lines = Arc::clone(&lines);
                move |_: Context| {
                    push(&lines, "action");
                    async { Ok(()) }
                }
            }),
    );
    let ran = run(&app, &["get"]).await;
    assert_eq!(ran.status, 69);
    assert!(ran.stderr.contains("The database refused the connection."));
    assert_eq!(read(&lines), ["open built", "close built"]);
}

#[derive(Debug)]
struct RefusedError;

impl std::fmt::Display for RefusedError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("refused")
    }
}

impl std::error::Error for RefusedError {}

#[tokio::test]
async fn offers_a_failing_openers_foreign_error_to_the_translators() {
    let broken = Provider::new("broken", |_: ProviderContext| async {
        Err::<String, Error>(RefusedError.into())
    });
    let app = Application::new("app")
        .translators([translate(|_: RefusedError| {
            Ok(BrokenError {
                base: FatalError::new("The provider module could not load."),
            })
        })])
        .command(
            Command::new("get")
                .uses([&broken])
                .action(|_: Context| async { Ok(()) }),
        );
    let ran = run(&app, &["get"]).await;
    assert_eq!(ran.status, 70);
    assert!(ran.stderr.contains("The provider module could not load."));
}

fn close_events(events: &Arc<Mutex<Vec<LogEvent>>>) -> Vec<(LogLevel, serde_json::Value)> {
    events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| event.message == "A provider's close failed.")
        .map(|event| (event.level, serde_json::Value::Object(event.fields.clone())))
        .collect()
}

#[tokio::test]
async fn fails_a_run_that_had_succeeded_with_the_first_close_that_fails_and_logs_the_later_ones() {
    let events: Arc<Mutex<Vec<LogEvent>>> = Arc::default();
    let app = Application::new("app").command(
        Command::new("get")
            .uses((
                &throwing("first", "The first close failed."),
                &throwing("second", "The second close failed."),
            ))
            .action(|_: Context| async { Ok(()) }),
    );
    let app = collecting(app, &events);
    let ran = run(&app, &["get"]).await;
    assert_eq!(ran.status, 75);
    assert!(ran.stderr.contains("The second close failed."));
    assert!(!ran.stderr.contains("The first close failed."));
    assert_eq!(
        close_events(&events),
        [(
            LogLevel::Error,
            serde_json::json!({
                "error": {"message": "The first close failed.", "name": "BusyError"},
                "provider": "first"
            })
        )]
    );
}

#[tokio::test]
async fn logs_a_close_that_fails_on_a_run_that_already_failed() {
    let events: Arc<Mutex<Vec<LogEvent>>> = Arc::default();
    let failing = Provider::new("failing", |_: ProviderContext| async {
        Ok("value".to_owned())
    })
    .close(|_: Arc<String>| async { Err(Error::from_foreign("socket gone".into())) });
    let app = Application::new("app").command(
        Command::new("get")
            .uses([&failing])
            .action(|_: Context| async { Err(rejected("The action failed.")) }),
    );
    let app = collecting(app, &events);
    let ran = run(&app, &["get"]).await;
    assert_eq!(ran.status, 65);
    assert!(ran.stderr.contains("The action failed."));
    assert_eq!(
        close_events(&events),
        [(
            LogLevel::Error,
            serde_json::json!({
                "error": {"message": "socket gone", "name": "Error"},
                "provider": "failing"
            })
        )]
    );
}

// Cancellation.

#[tokio::test]
async fn a_cancellation_during_a_build_lets_the_opener_settle_closes_what_was_built_and_skips_the_action()
 {
    let lines = journal();
    let token = CancellationToken::new();
    let slow = {
        let lines = Arc::clone(&lines);
        let token = token.clone();
        let closed = Arc::clone(&lines);
        Provider::new("slow", move |_: ProviderContext| {
            push(&lines, "open slow");
            token.cancel();
            async move {
                tokio::task::yield_now().await;
                Ok(Named {
                    name: "slow".to_owned(),
                })
            }
        })
        .close(move |_: Arc<Named>| {
            push(&closed, "close slow");
            async { Ok(()) }
        })
    };
    let app = Application::new("app").command(
        Command::new("get")
            .uses((
                &recorded(&lines, "built"),
                &slow,
                &recorded(&lines, "never"),
            ))
            .action({
                let lines = Arc::clone(&lines);
                move |_: Context| {
                    push(&lines, "action");
                    async { Ok(()) }
                }
            }),
    );
    let ran = run_with_options(&app, &["get"], RunOptions::new().signal(token)).await;
    assert_eq!(ran.status, 130);
    assert_eq!(ran.stderr, "");
    assert_eq!(
        read(&lines),
        ["open built", "open slow", "close slow", "close built"]
    );
}

#[tokio::test]
async fn reports_an_openers_error_after_cancellation_under_the_signals_code() {
    let token = CancellationToken::new();
    let slow = {
        let token = token.clone();
        Provider::new("slow", move |_: ProviderContext| {
            token.cancel();
            async { Err::<String, Error>(Error::from_foreign("The handshake broke.".into())) }
        })
    };
    let app = Application::new("app").command(
        Command::new("get")
            .uses([&slow])
            .action(|_: Context| async { Ok(()) }),
    );
    let ran = run_with_options(&app, &["get"], RunOptions::new().signal(token)).await;
    assert_eq!(ran.status, 130);
    assert!(
        ran.stderr.contains("The handshake broke."),
        "{}",
        ran.stderr
    );
}

// Substitution: the Rust counterpart of the reference's module mocking of an opener.

#[tokio::test]
async fn a_substituted_opener_builds_the_value_for_every_run_inside_the_one_it_starts() {
    let lines = journal();
    let app = Application::new("app").command(
        Command::new("get")
            .uses([&recorded(&lines, "pool")])
            .action({
                let lines = Arc::clone(&lines);
                move |ctx: Context| {
                    let lines = Arc::clone(&lines);
                    async move {
                        let pool = ctx.provided(&recorded(&journal(), "pool"))?;
                        push(&lines, format!("action {}", pool.name));
                        Ok(())
                    }
                }
            }),
    );
    let options =
        RunOptions::new().substitute(&recorded(&lines, "pool"), |_: ProviderContext| async {
            Ok(Named {
                name: "fake".to_owned(),
            })
        });
    assert_eq!(run_with_options(&app, &["get"], options).await.status, 0);
    // The provider keeps its own close.
    assert_eq!(read(&lines), ["action fake", "close fake"]);
}

// plugin-diagnostics.test.ts: the provider rows.

fn secret(name: &'static str) -> Provider<String> {
    Provider::new(name, |_: ProviderContext| async { Ok(String::new()) })
}

fn number(name: &'static str) -> Provider<u32> {
    Provider::new(name, |_: ProviderContext| async { Ok(0) })
}

const NAME_TAKEN_CORRECTION: &str = "Give each provider its own name. A package that exports a provider prefixes its name with its own, such as \"acmeToken\", so it never meets another package's.";

#[test]
fn two_different_providers_with_one_name_fault_at_a_commands_uses() {
    let message = panic_message(|| {
        let _ = Command::new("get").uses((&secret("token"), &number("token")));
    });
    assert_eq!(panic_rule(&message), "provider-name-taken");
    assert!(
        message.contains("\n\nCommand \"get\" reaches two different providers named \"token\".\n")
    );
    assert!(message.contains(NAME_TAKEN_CORRECTION));
    assert!(message.contains("Command::new(\"get\")"), "{message}");
}

#[test]
fn two_different_providers_with_one_name_in_a_providers_closure_fault_at_its_uses() {
    let message = panic_message(|| {
        let first =
            Provider::new("first", |_: ProviderContext| async { Ok(1u8) }).uses([&secret("token")]);
        let second = Provider::new("second", |_: ProviderContext| async { Ok(2u16) })
            .uses([&number("token")]);
        let _ = Provider::new("client", |_: ProviderContext| async { Ok(3u64) })
            .uses((&first, &second));
    });
    assert_eq!(panic_rule(&message), "provider-name-taken");
    assert!(
        message
            .contains("\n\nProvider \"client\" reaches two different providers named \"token\".\n")
    );
}

#[test]
fn two_different_providers_with_one_name_fault_at_the_applications_uses() {
    let message = panic_message(|| {
        let _ = Application::new("probe").uses((&secret("token"), &number("token")));
    });
    assert_eq!(panic_rule(&message), "provider-name-taken");
    assert!(
        message.contains("\n\nThe Application reaches two different providers named \"token\".\n")
    );
}

#[tokio::test]
async fn one_factorys_provider_reached_twice_is_one_provider() {
    let lines = journal();
    let app = Application::new("app").command(
        Command::new("get")
            .uses([&recorded(&lines, "pool")])
            .uses([&recorded(&lines, "pool")])
            .action(|_: Context| async { Ok(()) }),
    );
    assert_eq!(run(&app, &["get"]).await.status, 0);
    assert_eq!(read(&lines), ["open pool", "close pool"]);
}

// Lifetimes under invocation by name.

/// The outcome's status word, as the reference's outcome reads it.
fn status<M>(outcome: &loomcli_core::InvocationOutcome<M>) -> &'static str {
    match outcome {
        loomcli_core::InvocationOutcome::Completed { .. } => "completed",
        loomcli_core::InvocationOutcome::Failed { .. } => "failed",
        _ => "cancelled",
    }
}

#[tokio::test]
async fn a_nested_invoke_shares_a_persistent_value_and_rebuilds_an_ephemeral_one() {
    let lines = journal();
    let app = Application::new("app")
        .global_option("label", Opt::string())
        .command(Command::new("child").uses([&session(&lines)]).action({
            let lines = Arc::clone(&lines);
            move |_: Context| {
                let lines = Arc::clone(&lines);
                async move {
                    push(&lines, "child");
                    Ok(())
                }
            }
        }))
        .command(Command::new("parent").uses([&pool(&lines)]).action({
            let lines = Arc::clone(&lines);
            move |ctx: Context| {
                let lines = Arc::clone(&lines);
                async move {
                    let inner = loomcli_core::InvocationValues::new().option("label", "inner");
                    let _ = ctx
                        .invoke(&["child"], inner, loomcli_core::InvokeOptions::new())
                        .await;
                    let _ = ctx
                        .invoke(
                            &["child"],
                            loomcli_core::InvocationValues::new(),
                            loomcli_core::InvokeOptions::new(),
                        )
                        .await;
                    push(&lines, "parent");
                    Ok(())
                }
            }
        }));
    assert_eq!(run(&app, &["--label", "outer", "parent"]).await.status, 0);
    assert_eq!(
        read(&lines),
        [
            "open pool outer",
            "open session",
            "child",
            "close session",
            "open session",
            "child",
            "close session",
            "parent",
            "close pool",
        ]
    );
}

#[tokio::test]
async fn a_persistent_value_first_needed_in_nested_runs_is_built_once_from_the_outermost_options() {
    let lines = journal();
    let app = Application::new("app")
        .global_option("label", Opt::string())
        .command(
            Command::new("child")
                .uses([&session(&lines)])
                .action(|_: Context| async { Ok(()) }),
        )
        .command(Command::new("parent").action({
            let lines = Arc::clone(&lines);
            move |ctx: Context| {
                let lines = Arc::clone(&lines);
                async move {
                    let values =
                        |label: &str| loomcli_core::InvocationValues::new().option("label", label);
                    let _ = tokio::join!(
                        ctx.invoke(&["child"], values("a"), loomcli_core::InvokeOptions::new()),
                        ctx.invoke(&["child"], values("b"), loomcli_core::InvokeOptions::new()),
                    );
                    push(&lines, "parent");
                    Ok(())
                }
            }
        }));
    assert_eq!(run(&app, &["--label", "outer", "parent"]).await.status, 0);
    let lines = read(&lines);
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.starts_with("open pool"))
            .collect::<Vec<_>>(),
        ["open pool outer"]
    );
    assert_eq!(lines[lines.len() - 2..], ["parent", "close pool"]);
}

#[tokio::test]
async fn an_opener_reads_invoked_by_name_under_invoke_and_argv_otherwise() {
    let seen = journal();
    let probe = Provider::new("probe", {
        let seen = Arc::clone(&seen);
        move |ctx: ProviderContext| {
            push(&seen, format!("{:?}", ctx.invoked_by));
            async { Ok(()) }
        }
    });
    let app = Application::new("app")
        .uses([&probe])
        .action(|_: Context| async { Ok(()) });
    run(&app, &[]).await;
    let _ = app
        .invoke(
            &[],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::new(),
            Some(mock_process(MockFields::new()) as _),
        )
        .await;
    assert_eq!(read(&seen), ["Argv", "Name"]);
}

#[tokio::test]
async fn each_app_invoke_builds_its_persistent_value_again() {
    let lines = journal();
    let app = Application::new("app")
        .global_option("label", Opt::string())
        .command(
            Command::new("get")
                .uses([&pool(&lines)])
                .action(|_: Context| async { Ok(()) }),
        );
    let process = mock_process(MockFields::new());
    for label in ["one", "two"] {
        let _ = app
            .invoke(
                &["get"],
                loomcli_core::InvocationValues::new().option("label", label),
                loomcli_core::InvokeOptions::new(),
                Some(Arc::clone(&process) as _),
            )
            .await;
    }
    assert_eq!(
        read(&lines),
        ["open pool one", "close pool", "open pool two", "close pool"]
    );
}

#[tokio::test]
async fn a_failed_persistent_value_is_built_again_in_the_next_run_that_needs_it() {
    let lines = journal();
    let attempts = Arc::new(Mutex::new(0));
    let flaky = Provider::persistent("flaky", {
        let attempts = Arc::clone(&attempts);
        move |_: ProviderContext| {
            let attempts = Arc::clone(&attempts);
            async move {
                let mut attempts = attempts.lock().unwrap();
                *attempts += 1;
                if *attempts == 1 {
                    return Err(UnavailableError {
                        base: FatalError::new("The pool is down."),
                    }
                    .into());
                }
                Ok("up".to_owned())
            }
        }
    });
    let app = Application::new("app")
        .command(Command::new("child").uses([&flaky]).action({
            let (lines, flaky) = (Arc::clone(&lines), flaky.clone());
            move |ctx: Context| {
                let (lines, flaky) = (Arc::clone(&lines), flaky.clone());
                async move {
                    push(&lines, format!("child {}", ctx.provided(&flaky)?));
                    Ok(())
                }
            }
        }))
        .command(Command::new("parent").action({
            let lines = Arc::clone(&lines);
            move |ctx: Context| {
                let lines = Arc::clone(&lines);
                async move {
                    let call = || {
                        ctx.invoke(
                            &["child"],
                            loomcli_core::InvocationValues::new(),
                            loomcli_core::InvokeOptions::new(),
                        )
                    };
                    let first = call().await;
                    let second = call().await;
                    push(&lines, format!("{} {}", status(&first), status(&second)));
                    Ok(())
                }
            }
        }));
    assert_eq!(run(&app, &["parent"]).await.status, 0);
    assert_eq!(read(&lines), ["child up", "failed completed"]);
}
