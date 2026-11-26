//! Ports the run-level cases of `verbosity.test.ts`, `color.test.ts`, and `background.test.ts`:
//! the run-wide marks settled from argv, color right after host capture, the background before graph
//! build, and verbosity right after it, and what each changes in the bytes a run writes, end to end
//! through `Application::run`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::io;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Arg, Background, BackgroundPolicy, Build, Command, Context, FailureFacts,
    FailureView, Group, InvocationOutcome, InvocationValues, InvokeOptions, NoInputs, NoResult,
    Opt, OutputTerminal, ReleaseFacts, RenderingPolicy, ResultViews, RowViews, RowsResult,
    RunOptions, Switch, UsageError, ValueResult, View, ViewContext, failure, override_view, style,
};
use loomcli_testing::{MockTerminal, mock_process};
use serde_json::{Value, json};
use support::Ran;
use support::streams::{Facts, Keys, Swapped};
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, Group>;

fn distributed() -> ReleaseFacts {
    ReleaseFacts::new(Build::Distributed)
}

// verbosity.test.ts

/// Writes every lane once, then the counts the action read on stdout.
async fn every_lane(ctx: Context) -> loomcli_core::Outcome {
    ctx.log.trace("trace", ());
    ctx.log.debug("debug", ());
    ctx.out.info("info").await?;
    ctx.out.success("success").await?;
    ctx.out.warn("warn").await?;
    ctx.out.error("error").await?;
    ctx.out.print("print").await?;
    ctx.out
        .render(
            "render",
            &View::new(|data: &str, _: &ViewContext| format!("{data}\n")),
        )
        .await?;
    ctx.out
        .draw(
            "draw",
            &View::new(|data: &str, _: &ViewContext| format!("[{data}]")),
        )
        .await?;
    let quiet = ctx.option::<u32>("quiet")?;
    let verbose = ctx.option::<u32>("verbose")?;
    ctx.out
        .print(&json!({ "quiet": quiet, "verbose": verbose }).to_string())
        .await
}

/// The fetchit application, which marks its own `-v, --verbose` and `-q, --quiet` unless a variant
/// leaves the marks out.
fn fetchit(variant: &str) -> App {
    let unmarked = variant == "unmarked";
    let mut verbose = Opt::count().short('v').description("Show more detail.");
    verbose = if variant == "short-only" {
        verbose.short_only()
    } else {
        verbose.aliases(["loud"])
    };
    let mut quiet = Opt::count()
        .short('q')
        .description("Hide info and success messages.");
    if !unmarked {
        verbose = verbose.verbose();
        quiet = quiet.quiet();
    }
    let mut app = Application::new("fetchit")
        .plugins(fetchit_plugins(variant))
        .description("Fetch records.");
    if variant == "override" {
        app = app.overrides([override_view(
            loomcli_core::log_line(),
            View::new(
                |_: &loomcli_core::LogLine, _: &ViewContext| -> Result<String, io::Error> {
                    Err(io::Error::other("The log-line view was called."))
                },
            ),
        )]);
    }
    let get = Command::new("get")
        .passthrough(loomcli_core::Passthrough::new())
        .description("Fetch one URL.")
        .option(
            "field",
            Opt::string().short('F').description("A field to keep."),
        )
        .argument("url", Arg::string().description("The URL to fetch."));
    let get = if variant == "long" {
        get.action(|ctx: Context| async move {
            let message = "one two three four five six seven eight nine ten";
            ctx.log.debug(message, ());
            ctx.log.trace(message, ());
            Ok(())
        })
    } else {
        get.action(every_lane)
    };
    app.global_option("verbose", verbose)
        .global_option("quiet", quiet)
        .command(get)
        .command(
            Command::new("show")
                .description("Show one record.")
                .result(ResultViews::new().view(
                    "plain",
                    View::new(|data: &String, _: &ViewContext| format!("{data}\n")),
                ))
                .action(|ctx: Context<NoInputs, ValueResult<String>>| async move {
                    ctx.log.debug("debug", ());
                    ctx.log.trace("trace", ());
                    ctx.out.results("record".to_owned()).await
                }),
        )
        .command(
            Command::new("list")
                .description("List records that stop early.")
                .rows(RowViews::new().view(
                    "lines",
                    loomcli_core::RowView::new(|row: &String, _, _: &ViewContext| {
                        format!("{}\n", Value::from(row.as_str()))
                    }),
                ))
                .action(|ctx: Context<NoInputs, RowsResult<String>>| async move {
                    let rows = vec![
                        Ok("first".to_owned()),
                        Err(io::Error::other("The source broke.").into()),
                    ];
                    ctx.out
                        .results(loomcli_core::RowSource::stream(Rows(rows.into())))
                        .await
                }),
        )
        .command(
            Command::new("fail")
                .description("Fail.")
                .action(|ctx: Context| async move { Err(ctx.out.fatal("It failed.")) }),
        )
        .command(
            Command::new("nested")
                .description("Fetch by name inside this run.")
                .action(|ctx: Context| async move {
                    let outcome = ctx
                        .invoke(
                            &["get"],
                            loomcli_core::InvocationValues::new().arg("url", "u"),
                            loomcli_core::InvokeOptions::<loomcli_core::Error>::new(),
                        )
                        .await;
                    let messages = match outcome {
                        loomcli_core::InvocationOutcome::Completed { messages, .. }
                        | loomcli_core::InvocationOutcome::Failed { messages, .. } => messages,
                        _ => String::new(),
                    };
                    ctx.out.print(&Value::from(messages).to_string()).await
                }),
        )
}

/// The binding of the `config` variant's source.
const FETCHIT_KEY: loomcli_core::Extension<loomcli_core::OptionTarget, String> =
    loomcli_core::Extension::new("@fixture/fetchit/key");

/// The plugins a fetchit variant installs: a hook that declares `get`'s own `-x`, a configuration
/// source that writes a debug line, an environment hook that warns, a middleware that writes a
/// debug and an info line, or a graph hook that rejects the graph.
fn fetchit_plugins(variant: &str) -> Vec<loomcli_core::Plugin> {
    use loomcli_core::Plugin;
    match variant {
        "hooked" => vec![Plugin::new("@fixture/hooked").on_command_attach(|command| {
            if command.name() == Some("get") {
                command.option("extra", Opt::boolean().short('x'))?;
            }
            Ok(())
        })],
        "config" => vec![
            Plugin::new("@fixture/config")
                .option(
                    "region",
                    Opt::string().extend([FETCHIT_KEY.value("region".to_owned())]),
                )
                .extensions([loomcli_core::AnyExtension::from(FETCHIT_KEY)])
                .source(loomcli_core::ConfigurationSource::new(
                    &FETCHIT_KEY,
                    |context: loomcli_core::SourceContext<NoInputs>| async move {
                        context.log.debug("Read .fetchit.json.", ());
                        Ok(std::collections::BTreeMap::new())
                    },
                )),
        ],
        "dotenv" => vec![Plugin::new("@fixture/dotenv").on_environment(|context| async move {
            context
                .warn("Skipped FETCHIT_TOKEN on line 1 of .env: the line is not a valid assignment. Correct the line, or remove it.")
                .await?;
            Ok(std::collections::BTreeMap::new())
        })],
        "middleware" => vec![Plugin::new("@fixture/middleware").middleware(
            loomcli_core::Activation::Always,
            |ctx, next: loomcli_core::Next| async move {
                ctx.log.debug("middleware debug", ());
                ctx.out.info("middleware info").await?;
                next.run().await.map(|_| ())
            },
        )],
        "graph" => vec![Plugin::new("@fixture/judge").on_graph_built(|_| {
            Err(loomcli_core::DeclarationError::sentence_only("The judge rejects the graph.").into())
        })],
        _ => Vec::new(),
    }
}

/// A stream over these items, each at once.
struct Rows(std::collections::VecDeque<Result<String, loomcli_core::Error>>);

impl futures_core::Stream for Rows {
    type Item = Result<String, loomcli_core::Error>;
    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::task::Poll::Ready(self.0.pop_front())
    }
}

/// One run of a fetchit variant, piped or on a terminal 40 columns wide.
async fn run_fetchit(variant: &str, tty: bool, argv: &[&str], env: &[(&str, &str)]) -> Ran {
    let mut env = env.to_vec();
    if !env.iter().any(|(name, _)| *name == "TERM") {
        env.push(("TERM", "xterm"));
    }
    let mut fields = support::fields(argv, &env).release(distributed());
    if tty {
        fields = fields.terminal(MockTerminal::new(40, 24));
    }
    support::run_with(&fetchit(variant), fields).await
}

const DEFAULT: &str = "ℹ info\n✔ success\n⚠ warn\n✘ error\n[draw]";
const DEBUG: &str = "› debug\nℹ info\n✔ success\n⚠ warn\n✘ error\n[draw]";
const QUIET: &str = "⚠ warn\n✘ error\n[draw]";
const TRACE: &str = "  ┆ trace\n› debug\nℹ info\n✔ success\n⚠ warn\n✘ error\n[draw]";

#[tokio::test]
async fn each_verbosity_writes_the_lanes_it_shows() {
    for (flags, stderr) in [
        (&[][..], DEFAULT),
        (&["-v"], DEBUG),
        (&["-vv"], TRACE),
        (&["-vvv"], TRACE),
        (&["-q"], QUIET),
        (&["-qq"], QUIET),
        (&["-v", "-q"], DEFAULT),
        (&["-vv", "-q"], DEBUG),
    ] {
        let mut argv = flags.to_vec();
        argv.extend(["get", "u"]);
        let ran = run_fetchit("own", false, &argv, &[]).await;
        assert_eq!((ran.status, ran.stderr.as_str()), (0, stderr), "{flags:?}");
    }
}

#[tokio::test]
async fn a_letter_an_on_command_attach_hook_declared_reads_beside_v_in_one_group() {
    let ran = run_fetchit("hooked", false, &["get", "-vx", "u"], &[]).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, DEBUG));
}

#[tokio::test]
async fn a_configuration_sources_debug_line_prints_under_v_and_not_without_it() {
    let verbose = run_fetchit("config", false, &["-v", "get", "u"], &[]).await;
    assert!(
        verbose.stderr.contains("\u{203a} Read .fetchit.json.\n"),
        "{}",
        verbose.stderr
    );
    let plain = run_fetchit("config", false, &["get", "u"], &[]).await;
    assert!(
        !plain.stderr.contains("Read .fetchit.json."),
        "{}",
        plain.stderr
    );
}

#[tokio::test]
async fn an_environment_hooks_warning_prints_under_q() {
    let ran = run_fetchit("dotenv", false, &["-q", "show"], &[]).await;
    assert_eq!(
        ran.stderr,
        "\u{26a0} Skipped FETCHIT_TOKEN on line 1 of .env: the line is not a valid assignment. Correct the line, or remove it.\n"
    );
}

#[tokio::test]
async fn a_middlewares_out_follows_the_runs_verbosity() {
    let verbose = run_fetchit("middleware", false, &["-v", "get", "u"], &[]).await;
    assert!(
        verbose.stderr.contains("\u{203a} middleware debug\n"),
        "{}",
        verbose.stderr
    );
    let plain = run_fetchit("middleware", false, &["get", "u"], &[]).await;
    assert!(
        plain.stderr.contains("\u{2139} middleware info\n"),
        "{}",
        plain.stderr
    );
    assert!(
        !plain.stderr.contains("middleware debug"),
        "{}",
        plain.stderr
    );
    let quiet = run_fetchit("middleware", false, &["-q", "get", "u"], &[]).await;
    assert!(
        !quiet.stderr.contains("middleware info"),
        "{}",
        quiet.stderr
    );
}

#[tokio::test]
async fn a_declaration_error_from_graph_build_prints_under_q() {
    let ran = support::run_with(
        &fetchit("graph"),
        support::fields(&["-q", "get", "u"], &[("TERM", "xterm")])
            .release(ReleaseFacts::new(Build::Development)),
    )
    .await;
    assert_eq!(ran.status, 1);
    assert!(
        ran.stderr.contains("The judge rejects the graph."),
        "{}",
        ran.stderr
    );
}

/// The outcome an invocation by name of `get u` with this `verbose` value captures.
async fn by_name(verbose: Value) -> loomcli_core::InvocationOutcome<loomcli_core::Error> {
    fetchit("own")
        .invoke(
            &["get"],
            loomcli_core::InvocationValues::new()
                .arg("url", "u")
                .option("verbose", verbose),
            loomcli_core::InvokeOptions::new(),
            Some(mock_process(loomcli_testing::MockFields::new()) as _),
        )
        .await
}

#[tokio::test]
async fn invoke_with_verbose_2_captures_the_debug_and_trace_lines_in_messages() {
    let loomcli_core::InvocationOutcome::Completed { messages, .. } = by_name(json!(2)).await
    else {
        panic!("the call completes");
    };
    assert_eq!(messages, TRACE);
}

#[tokio::test]
async fn a_calls_log_lines_go_to_the_parent_run_instead_of_its_capture() {
    let ran = run_fetchit("own", false, &["-vv", "nested"], &[]).await;
    assert_eq!(ran.stdout, format!("{}\n", Value::from(DEFAULT)));
    assert_eq!(ran.stderr, "  ┆ trace\n› debug\n");
}

#[tokio::test]
async fn verbose_1_5_fails_with_its_counted_option_issue_and_exit_2() {
    let loomcli_core::InvocationOutcome::Failed { exit_code, .. } = by_name(json!(1.5)).await
    else {
        panic!("the call fails");
    };
    assert_eq!(exit_code.get(), 2);
}

#[tokio::test]
async fn print_and_render_write_at_every_verbosity() {
    let ran = run_fetchit("own", false, &["-q", "get", "u"], &[]).await;
    assert_eq!(ran.stdout, "print\nrender\n{\"quiet\":1,\"verbose\":0}\n");
}

#[tokio::test]
async fn every_form_settles_what_the_ordinary_parse_reads() {
    for (argv, stderr) in [
        (&["-vq", "get", "u"][..], DEFAULT),
        (&["-qv", "get", "u"], DEFAULT),
        (&["--verbose", "-v", "get", "u"], TRACE),
        (&["--loud", "get", "u"], DEBUG),
        (&["get", "-vF", "name", "u"], DEBUG),
        (&["-v", "get", "u", "-v"], TRACE),
        (&["get", "u", "--", "-v"], DEFAULT),
    ] {
        let ran = run_fetchit("own", false, argv, &[]).await;
        assert_eq!(ran.stderr, stderr, "{argv:?}");
    }
    let short_only = run_fetchit("short-only", false, &["-vv", "get", "u"], &[]).await;
    assert_eq!(short_only.stderr, TRACE);
}

#[tokio::test]
async fn an_occurrence_the_parse_faults_counts_nothing() {
    let ran = run_fetchit("own", false, &["--verbose=2", "get", "u"], &[]).await;
    assert_eq!(ran.status, 2);
    assert!(!ran.stderr.contains('›'), "{}", ran.stderr);
    assert!(ran.stderr.contains("\"--verbose\""), "{}", ran.stderr);
}

#[tokio::test]
async fn an_unknown_command_and_a_failure_print_under_quiet() {
    let unknown = run_fetchit("own", false, &["-q", "nope"], &[]).await;
    assert_eq!(unknown.status, 2);
    assert!(unknown.stderr.contains("\"nope\""), "{}", unknown.stderr);
    let failed = run_fetchit("own", false, &["-q", "fail"], &[]).await;
    assert_eq!(failed.status, 1);
    assert!(failed.stderr.contains("It failed."), "{}", failed.stderr);
}

#[tokio::test]
async fn debug_and_trace_reach_stderr_on_a_result_command() {
    assert_eq!(
        run_fetchit("own", false, &["-vv", "show"], &[]).await,
        Ran {
            status: 0,
            stdout: "record\n".to_owned(),
            stderr: "› debug\n  ┆ trace\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn the_incomplete_line_and_the_failure_print_under_quiet() {
    let ran = run_fetchit("own", false, &["-q", "list"], &[]).await;
    assert_eq!(ran.stdout, "\"first\"\n");
    assert!(
        ran.stderr.contains("Output is incomplete:"),
        "{}",
        ran.stderr
    );
    assert!(
        ran.stderr.contains("Something went wrong."),
        "{}",
        ran.stderr
    );
    assert_eq!(ran.status, 1);
}

#[tokio::test]
async fn under_no_color_a_trace_line_keeps_faint() {
    let ran = run_fetchit("own", true, &["-vv", "show"], &[("NO_COLOR", "1")]).await;
    assert_eq!(
        ran.stderr,
        "› debug\n  \u{1b}[2m┆\u{1b}[22m \u{1b}[2mtrace\u{1b}[22m\n"
    );
}

#[tokio::test]
async fn a_long_message_wraps_right_of_its_gutter() {
    let ran = run_fetchit(
        "long",
        true,
        &["-vv", "get", "u"],
        &[("NO_COLOR", "1"), ("TERM", "dumb")],
    )
    .await;
    assert_eq!(
        ran.stderr.split('\n').collect::<Vec<_>>(),
        [
            "› one two three four five six seven",
            "  eight nine ten",
            "  ┆ one two three four five six seven",
            "    eight nine ten",
            "",
        ]
    );
}

#[tokio::test]
async fn a_hidden_event_skips_the_log_line_view_and_a_visible_error_fails_the_run() {
    assert_eq!(
        run_fetchit("override", false, &["get", "u"], &[])
            .await
            .status,
        0
    );
    assert_eq!(
        run_fetchit("override", false, &["-v", "get", "u"], &[])
            .await
            .status,
        1
    );
}

#[tokio::test]
async fn an_application_with_neither_mark_ignores_the_spellings() {
    for flags in [["-vv"], ["-q"]] {
        let mut argv = flags.to_vec();
        argv.extend(["get", "u"]);
        assert_eq!(
            run_fetchit("unmarked", false, &argv, &[]).await.stderr,
            DEFAULT
        );
    }
}

#[tokio::test]
async fn the_options_read_the_counts_the_operator_typed() {
    let ran = run_fetchit("own", false, &["-vvv", "-qq", "get", "u"], &[]).await;
    assert!(
        ran.stdout.contains("{\"quiet\":2,\"verbose\":3}\n"),
        "{}",
        ran.stdout
    );
}

// color.test.ts

/// The notes application, which marks its own `--[no-]color` unless the variant leaves it out.
fn notes(variant: &str) -> App {
    let mut option = Opt::boolean()
        .polarity(loomcli_core::Polarity::Both)
        .aliases(["colour"])
        .control()
        .description("Turn color on or off, overriding NO_COLOR.");
    if variant != "unmarked" {
        option = option.color();
    }
    // A usage failure's line, styled with a color and bold, so a case reads both from its bytes.
    let usage_line = override_view(
        failure::<UsageError>(),
        FailureView::new(
            |failure: &UsageError, context: &loomcli_core::FailureViewContext| {
                let style = &context.view_context.style;
                let message = style.escape(failure.message());
                format!("{}\n", style.bold().red().apply(&message))
            },
        ),
    );
    let mut app = Application::new("notes")
        .description("Keep notes.")
        .plugins(notes_plugins(variant))
        .overrides([usage_line]);
    match variant {
        "app-always" => app = app.rendering(RenderingPolicy::new().color(Switch::Always)),
        "app-never" => app = app.rendering(RenderingPolicy::new().color(Switch::Never)),
        _ => {}
    }
    app.global_option("color", option).command(
        Command::new("save")
            .description("Save a note.")
            .argument(
                "words",
                Arg::string()
                    .description("The words of the note.")
                    .variadic(),
            )
            .action(|ctx: Context| async move {
                ctx.out
                    .info(&ctx.style.bold().apply(&style().red().apply("Saved.")))
                    .await?;
                let color = ctx.option::<bool>("color")?;
                ctx.out.print(&json!({ "color": color }).to_string()).await
            }),
    )
}

/// The binding of the notes `config` variant's source.
const NOTES_KEY: loomcli_core::Extension<loomcli_core::OptionTarget, String> =
    loomcli_core::Extension::new("@fixture/notes/key");

/// The plugins a notes variant installs, each standing for the reference's: an environment hook
/// that warns as dotenv does of a malformed `.env` line, a configuration source that warns as the
/// configuration plugin does of a malformed file, or a graph hook that rejects the graph beside a
/// theme that colors the error style.
fn notes_plugins(variant: &str) -> Vec<loomcli_core::Plugin> {
    use loomcli_core::Plugin;
    match variant {
        "dotenv" => vec![Plugin::new("@fixture/dotenv").on_environment(|context| async move {
            context
                .warn("Skipped NOTES_TOKEN on line 1 of .env: the line is not a valid assignment. Correct the line, or remove it.")
                .await?;
            Ok(std::collections::BTreeMap::new())
        })],
        "config" => vec![
            Plugin::new("@fixture/config")
                .option(
                    "tint",
                    Opt::string().extend([NOTES_KEY.value("tint".to_owned())]),
                )
                .extensions([loomcli_core::AnyExtension::from(NOTES_KEY)])
                .source(loomcli_core::ConfigurationSource::new(
                    &NOTES_KEY,
                    |context: loomcli_core::SourceContext<NoInputs>| async move {
                        context
                            .out
                            .warn("Skipped .notes.json: the file is not valid JSON.")
                            .await?;
                        Ok(std::collections::BTreeMap::new())
                    },
                )),
        ],
        // The reference's theme colors the Developer Diagnostic's banner, which core leaves plain.
        "graph" => vec![
            Plugin::new("@fixture/theme")
                .theme(loomcli_core::ThemeMapping::new().entry("error", style().red())),
            Plugin::new("@fixture/judge").on_graph_built(|_| {
                Err(
                    loomcli_core::DeclarationError::sentence_only("The judge rejects the graph.")
                        .into(),
                )
            }),
        ],
        _ => Vec::new(),
    }
}

/// One run of a notes variant, on a capable terminal or piped. The `graph` variant runs in a
/// development build, whose Developer Diagnostic shows the rejection.
async fn run_notes(variant: &str, tty: bool, argv: &[&str], env: &[(&str, &str)]) -> Ran {
    let mut env = env.to_vec();
    env.push(("TERM", "xterm"));
    let release = if variant == "graph" {
        ReleaseFacts::new(Build::Development)
    } else {
        distributed()
    };
    let mut fields = support::fields(argv, &env).release(release);
    if tty {
        fields = fields.terminal(MockTerminal::new(80, 24));
    }
    let process = mock_process(fields);
    let mut options = RunOptions::new().process(Arc::clone(&process) as _);
    match variant {
        "run-always" => options = options.rendering(RenderingPolicy::new().color(Switch::Always)),
        "run-never" => options = options.rendering(RenderingPolicy::new().color(Switch::Never)),
        _ => {}
    }
    let code = notes(variant).run(options).await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// Whether some SGR sequence in the text sets a color, and whether one sets bold.
fn styles(text: &str) -> (bool, bool) {
    let (mut bold, mut color) = (false, false);
    for sequence in text.split('\u{1b}').skip(1) {
        let Some(parameters) = sequence
            .strip_prefix('[')
            .and_then(|rest| rest.split_once('m'))
            .map(|(parameters, _)| parameters)
        else {
            continue;
        };
        let numbers: Vec<u32> = parameters
            .split(';')
            .map(|number| number.parse().unwrap_or(0))
            .collect();
        let mut index = 0;
        while let Some(number) = numbers.get(index) {
            match number {
                38 | 48 => {
                    color = true;
                    index += if numbers.get(index + 1) == Some(&5) {
                        2
                    } else {
                        4
                    };
                }
                30..=37 | 40..=47 | 90..=97 | 100..=107 => color = true,
                1 => bold = true,
                _ => {}
            }
            index += 1;
        }
    }
    (bold, color)
}

/// A run's status and the styles on its stderr: `(status, bold, color)`.
async fn printed(
    variant: &str,
    tty: bool,
    argv: &[&str],
    env: &[(&str, &str)],
) -> (u8, bool, bool) {
    let ran = run_notes(variant, tty, argv, env).await;
    let (bold, color) = styles(&ran.stderr);
    (ran.status, bold, color)
}

#[tokio::test]
async fn on_a_capable_terminal_no_color_keeps_bold() {
    assert_eq!(
        printed("marked", true, &["save"], &[]).await,
        (0, true, true)
    );
    assert_eq!(
        printed("marked", true, &["save", "--no-color"], &[]).await,
        (0, true, false)
    );
    assert_eq!(
        printed(
            "marked",
            true,
            &["save", "--no-color"],
            &[("FORCE_COLOR", "1")]
        )
        .await,
        (0, true, false)
    );
}

#[tokio::test]
async fn piped_color_prints_color_and_no_bold() {
    assert_eq!(
        printed("marked", false, &["save"], &[]).await,
        (0, false, false)
    );
    assert_eq!(
        printed("marked", false, &["save", "--color"], &[]).await,
        (0, false, true)
    );
}

#[tokio::test]
async fn the_last_spelling_wins_and_the_parse_still_reports_the_repetition() {
    let off = run_notes("marked", true, &["save", "--color", "--no-color"], &[]).await;
    assert_eq!(off.status, 2);
    assert!(
        off.stderr.contains(
            "Option \"--no-color\" can be supplied only once. Remove the repeated option."
        ),
        "{}",
        off.stderr
    );
    assert_eq!(styles(&off.stderr), (true, false));
    let on = run_notes("marked", false, &["save", "--no-color", "--color"], &[]).await;
    assert_eq!(on.status, 2);
    assert!(
        on.stderr
            .contains("Option \"--color\" can be supplied only once. Remove the repeated option."),
        "{}",
        on.stderr
    );
    assert_eq!(styles(&on.stderr), (false, true));
}

#[tokio::test]
async fn a_spelling_after_the_bare_delimiter_changes_nothing_and_an_alias_works() {
    assert_eq!(
        printed("marked", false, &["save", "--", "--color"], &[]).await,
        (0, false, false)
    );
    assert_eq!(
        printed(
            "marked",
            true,
            &["save", "--no-color", "--", "--color"],
            &[]
        )
        .await,
        (0, true, false)
    );
    assert_eq!(
        printed("marked", true, &["save", "--no-colour"], &[]).await,
        (0, true, false)
    );
    assert_eq!(
        printed("marked", false, &["--colour", "save"], &[]).await,
        (0, false, true)
    );
}

#[tokio::test]
async fn the_choice_overrides_no_color_and_force_color() {
    assert_eq!(
        printed("marked", true, &["save", "--color"], &[("NO_COLOR", "1")]).await,
        (0, true, true)
    );
    assert_eq!(
        printed(
            "marked",
            false,
            &["save", "--no-color"],
            &[("FORCE_COLOR", "1")]
        )
        .await,
        (0, true, false)
    );
}

#[tokio::test]
async fn with_neither_spelling_every_byte_matches_the_unmarked_application() {
    for tty in [true, false] {
        for no_color in [None, Some("1")] {
            for force_color in [None, Some("1")] {
                let mut env = Vec::new();
                if let Some(value) = no_color {
                    env.push(("NO_COLOR", value));
                }
                if let Some(value) = force_color {
                    env.push(("FORCE_COLOR", value));
                }
                assert_eq!(
                    run_notes("marked", tty, &["save"], &env).await,
                    run_notes("unmarked", tty, &["save"], &env).await
                );
            }
        }
    }
}

#[tokio::test]
async fn the_choice_beats_the_declared_color() {
    for variant in ["app-always", "run-always"] {
        assert_eq!(
            printed(variant, true, &["save", "--no-color"], &[]).await,
            (0, true, false)
        );
    }
    for variant in ["app-never", "run-never"] {
        assert_eq!(
            printed(variant, false, &["save"], &[]).await,
            (0, false, false)
        );
        assert_eq!(
            printed(variant, false, &["save", "--color"], &[]).await,
            (0, false, true)
        );
    }
}

#[tokio::test]
async fn a_word_that_attaches_a_value_supplies_no_choice() {
    let ran = run_notes("marked", true, &["save", "--color=x"], &[]).await;
    assert_eq!(ran.status, 2);
    assert!(
        ran.stderr
            .contains("Boolean option \"--color\" does not accept a value. Supply the flag alone."),
        "{}",
        ran.stderr
    );
    assert_eq!(styles(&ran.stderr), (true, true));
    assert_eq!(
        printed("marked", false, &["save", "--color=x"], &[]).await,
        (2, false, false)
    );
    assert_eq!(
        printed("marked", true, &["save", "--color=x"], &[("NO_COLOR", "1")]).await,
        (2, true, false)
    );
}

#[tokio::test]
async fn each_line_before_the_chain_follows_the_choice() {
    for (variant, argv, status, line) in [
        ("marked", &["nope"][..], 2, "Unknown command \"nope\"."),
        (
            "dotenv",
            &["save"],
            0,
            "Skipped NOTES_TOKEN on line 1 of .env",
        ),
        ("config", &["save"], 0, "Skipped .notes.json"),
        ("graph", &["save"], 1, "The judge rejects the graph."),
    ] {
        let mut off_words = argv.to_vec();
        off_words.push("--no-color");
        let off = run_notes(variant, true, &off_words, &[]).await;
        assert_eq!(off.status, status, "{variant}");
        assert!(off.stderr.contains(line), "{variant}: {}", off.stderr);
        assert!(!styles(&off.stderr).1, "{variant}: {}", off.stderr);
        let mut on_words = argv.to_vec();
        on_words.push("--color");
        let on = run_notes(variant, false, &on_words, &[]).await;
        assert_eq!(on.status, status, "{variant}");
        assert!(on.stderr.contains(line), "{variant}: {}", on.stderr);
        assert!(styles(&on.stderr).1, "{variant}: {:?}", on.stderr);
    }
}

#[tokio::test]
async fn an_invocation_by_name_captures_plain_text_under_force_color_and_a_declared_always() {
    let process = mock_process(
        support::fields(&[], &[("FORCE_COLOR", "1"), ("TERM", "xterm")])
            .terminal(MockTerminal::new(80, 24))
            .release(distributed()),
    );
    let outcome = notes("app-always")
        .invoke(
            &["save"],
            InvocationValues::new().option("color", true),
            InvokeOptions::new(),
            Some(process as _),
        )
        .await;
    let InvocationOutcome::Completed {
        output, messages, ..
    } = outcome
    else {
        panic!("the invocation completes");
    };
    assert_eq!(
        (output.as_str(), messages.as_str()),
        ("{\"color\":true}\n", "\u{2139} Saved.\n")
    );
}

#[tokio::test]
async fn the_action_reads_what_the_operator_typed() {
    for (argv, color) in [
        (&["--color"][..], true),
        (&["--no-color"], false),
        (&[], false),
        (&["--colour"], true),
    ] {
        let mut words = vec!["save"];
        words.extend(argv);
        let ran = run_notes("marked", true, &words, &[]).await;
        assert_eq!(ran.stdout, format!("{{\"color\":{color}}}\n"), "{argv:?}");
    }
}

#[tokio::test]
async fn an_unreadable_working_directory_line_holds_no_style() {
    let removed = |variant: &'static str| async move {
        let fields = support::fields(
            &["save", "--color"],
            &[("FORCE_COLOR", "1"), ("TERM", "xterm")],
        )
        .terminal(MockTerminal::new(80, 24))
        .cwd_with(|| Err(io::Error::from(io::ErrorKind::NotFound)));
        support::run_with(&notes(variant), fields).await
    };
    let marked = removed("marked").await;
    assert_eq!(marked.status, 1);
    assert!(!marked.stderr.contains('\u{1b}'), "{}", marked.stderr);
    assert_eq!(marked, removed("unmarked").await);
}

// background.test.ts

/// The three queries core writes, once, to stderr.
const QUERY: &str = "\u{1b}]11;?\u{1b}\\\u{1b}[?996n\u{1b}[c";
const DA1: &str = "\u{1b}[?62;22c";

fn light() -> String {
    format!("\u{1b}]11;rgb:ffff/ffff/f0f0\u{1b}\\{DA1}")
}

/// One background scenario: who reads the background, the streams' kinds, the variables, the
/// replies stdin holds, and what else the run is given.
struct Scene {
    mark: bool,
    terminals: (bool, bool, bool),
    env: Vec<(&'static str, &'static str)>,
    keys: Arc<Keys>,
    stated: Option<Background>,
    declared: Option<BackgroundPolicy>,
    argv: Vec<&'static str>,
    token: Option<CancellationToken>,
}

impl Scene {
    fn new(replies: &str) -> Self {
        Self {
            mark: true,
            terminals: (true, true, true),
            env: vec![("COLORTERM", "truecolor"), ("TERM", "xterm-256color")],
            keys: Keys::typing(&[replies]),
            stated: None,
            declared: None,
            argv: Vec::new(),
            token: None,
        }
    }
}

/// What a background run did: the code, the background the action and a view read, the bytes on
/// stderr, and the raw-mode switches.
#[derive(Debug, PartialEq)]
struct Settled {
    code: u8,
    action: Option<Background>,
    view: Option<Background>,
    stderr: String,
    modes: Vec<bool>,
}

async fn settle(scene: Scene) -> Settled {
    let seen = Arc::new(Mutex::new((None, None)));
    let record = Arc::clone(&seen);
    let act = move |ctx: Context| {
        let record = Arc::clone(&record);
        async move {
            let view = View::new(|_: &(), context: &ViewContext| {
                context
                    .background
                    .map_or("none", Background::name)
                    .to_owned()
            });
            let read = ctx.out.text(&(), &view)?;
            *record.lock().unwrap() = (ctx.host.terminal.background, Background::from_name(&read));
            Ok(())
        }
    };
    let policy = scene
        .declared
        .map_or_else(RenderingPolicy::new, |declared| {
            RenderingPolicy::new().background(declared)
        });
    let base = Application::new("notes")
        .description("Keep notes.")
        .rendering(policy);
    let app = if scene.mark {
        base.global_option(
            "background",
            Opt::string()
                .aliases(["tint"])
                .background()
                .description("The terminal's background."),
        )
        .action(act)
    } else {
        base.action(act)
    };
    let mock = mock_process(support::fields(&scene.argv, &scene.env));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdin = Some(Arc::clone(&scene.keys) as _);
    let (stdin, stdout, stderr) = scene.terminals;
    handle.terminal = Some(Arc::new(Facts {
        stdin,
        stdout: OutputTerminal::new(stdout, Some(80), Some(24)),
        stderr: OutputTerminal::new(stderr, Some(80), Some(24)),
        stated: scene.stated,
    }));
    let mut options = RunOptions::new().process(Arc::new(handle));
    if let Some(token) = scene.token {
        options = options.signal(token);
    }
    let code = app.run(options).await;
    let (action, view) = *seen.lock().unwrap();
    let modes = scene.keys.switches.lock().unwrap().clone();
    Settled {
        code: code.get(),
        action,
        view,
        stderr: mock.stderr_text(),
        modes,
    }
}

#[tokio::test]
async fn the_answered_path_writes_the_queries_once_reads_light_and_restores_the_mode() {
    assert_eq!(
        settle(Scene::new(&light())).await,
        Settled {
            code: 0,
            action: Some(Background::Light),
            view: Some(Background::Light),
            stderr: QUERY.to_owned(),
            modes: vec![true, false],
        }
    );
}

#[tokio::test]
async fn typeahead_around_the_replies_goes_back_to_stdin_in_order() {
    let scene = Scene::new(&format!("b\u{1b}]11;rgb:0/0/0\u{7}c\u{1b}[?997;2nd{DA1}e"));
    let keys = Arc::clone(&scene.keys);
    let settled = settle(scene).await;
    assert_eq!(settled.action, Some(Background::Dark));
    assert_eq!(*keys.pushed.lock().unwrap(), b"bcde");
}

#[tokio::test]
async fn a_stream_that_is_not_a_terminal_skips_the_query_and_reads_nothing() {
    for terminals in [
        (true, false, true),
        (false, true, true),
        (true, true, false),
        (false, false, false),
    ] {
        let mut scene = Scene::new(&light());
        scene.terminals = terminals;
        scene
            .env
            .extend([("COLORFGBG", "0;15"), ("FORCE_COLOR", "1")]);
        let settled = settle(scene).await;
        assert_eq!(
            (
                settled.stderr.as_str(),
                settled.modes.as_slice(),
                settled.action
            ),
            ("", &[][..], None),
            "{terminals:?}"
        );
    }
}

#[tokio::test]
async fn a_skip_writes_no_query_and_colorfgbg_answers() {
    let skips: Vec<(Vec<(&str, &str)>, bool)> = vec![
        (
            vec![("COLORTERM", "truecolor"), ("TERM", "xterm-256color")],
            true,
        ),
        (vec![("COLORTERM", "truecolor")], false),
        (
            vec![
                ("COLORTERM", "truecolor"),
                ("FORCE_COLOR", "1"),
                ("TERM", "dumb"),
            ],
            false,
        ),
        (
            vec![
                ("COLORTERM", "truecolor"),
                ("TERM", "xterm-256color"),
                ("STY", "1234.pts-0.host"),
            ],
            false,
        ),
        (
            vec![
                ("COLORTERM", "truecolor"),
                ("TERM", "xterm-256color"),
                ("INSIDE_EMACS", "29.1,comint"),
            ],
            false,
        ),
        (
            vec![
                ("CI", "true"),
                ("COLORTERM", "truecolor"),
                ("GITHUB_ACTIONS", "true"),
                ("TERM", "xterm-256color"),
            ],
            false,
        ),
    ];
    for (env, refuses_raw) in skips {
        let mut scene = Scene::new(&light());
        scene.env = env.clone();
        scene.env.push(("COLORFGBG", "0;15"));
        if refuses_raw {
            scene.keys = Arc::new(Keys {
                refuses_raw: true,
                ..Keys::default()
            });
        }
        let settled = settle(scene).await;
        assert_eq!(
            (
                settled.stderr.as_str(),
                settled.modes.as_slice(),
                settled.action
            ),
            ("", &[][..], Some(Background::Light)),
            "{env:?}"
        );
    }
}

#[tokio::test]
async fn an_earlier_source_settles_the_run_with_no_query() {
    let cases: Vec<(Scene, Option<Background>)> = vec![
        (
            Scene {
                argv: vec!["--background=dark"],
                ..Scene::new(&light())
            },
            Some(Background::Dark),
        ),
        (
            Scene {
                declared: Some(BackgroundPolicy::Dark),
                ..Scene::new(&light())
            },
            Some(Background::Dark),
        ),
        (
            Scene {
                stated: Some(Background::Dark),
                ..Scene::new(&light())
            },
            Some(Background::Dark),
        ),
        (
            Scene {
                env: vec![
                    ("COLORTERM", "truecolor"),
                    ("NO_COLOR", "1"),
                    ("TERM", "xterm-256color"),
                ],
                ..Scene::new(&light())
            },
            None,
        ),
        (
            Scene {
                env: vec![("COLORTERM", "truecolor"), ("TERM", "linux")],
                ..Scene::new(&light())
            },
            Some(Background::Dark),
        ),
        (
            Scene {
                mark: false,
                ..Scene::new(&light())
            },
            None,
        ),
    ];
    for (scene, expected) in cases {
        let settled = settle(scene).await;
        assert_eq!(
            (
                settled.stderr.as_str(),
                settled.modes.as_slice(),
                settled.action
            ),
            ("", &[][..], expected)
        );
    }
}

#[tokio::test]
async fn a_run_already_cancelled_writes_no_query() {
    let token = CancellationToken::new();
    token.cancel();
    let settled = settle(Scene {
        token: Some(token),
        ..Scene::new(&light())
    })
    .await;
    assert_eq!((settled.stderr.as_str(), settled.code), ("", 130));
}

#[tokio::test]
async fn a_stated_or_declared_background_reads_without_a_reader() {
    for scene in [
        Scene {
            mark: false,
            declared: Some(BackgroundPolicy::Light),
            ..Scene::new("")
        },
        Scene {
            mark: false,
            stated: Some(Background::Light),
            ..Scene::new("")
        },
    ] {
        let settled = settle(scene).await;
        assert_eq!(
            (settled.action, settled.view),
            (Some(Background::Light), Some(Background::Light))
        );
    }
}

#[tokio::test]
async fn the_operator_choice_settles_the_run() {
    for (argv, settled) in [
        (vec!["--background", "light"], Background::Light),
        (vec!["--background=light"], Background::Light),
        (
            vec!["--background=light", "--background=dark"],
            Background::Dark,
        ),
        (vec!["--tint=light"], Background::Light),
    ] {
        let scene = Scene {
            argv: argv.clone(),
            stated: Some(Background::Dark),
            ..Scene::new("")
        };
        let ran = settle(scene).await;
        if ran.code == 0 {
            assert_eq!(ran.action, Some(settled), "{argv:?}");
        } else {
            // The repeated option fails the parse; the choice settled before it.
            assert_eq!(ran.code, 2, "{argv:?}");
        }
    }
    let after = settle(Scene {
        argv: vec!["--", "--background=light"],
        stated: Some(Background::Dark),
        ..Scene::new("")
    })
    .await;
    assert_ne!(after.action, Some(Background::Light));
}

// background.test.ts: the readers a middleware and a failure view are, the failure path of a
// choice that supplies nothing, an invocation by name, the signal cases of the wait, environment
// preparation after settlement, and themed tokens through a plugin's theme claim.

/// A signal source that forwards to the mock's and answers `keys` as its own terminal, so an
/// interrupt key read during the wait is raised on it.
struct KeyedSignals {
    inner: Arc<dyn loomcli_core::SignalSource>,
    keys: Arc<Keys>,
    /// Each signal core raised, with whether stdin was raw as it did.
    raised: Arc<Mutex<Vec<(bool, loomcli_core::ProcessSignal)>>>,
}

impl loomcli_core::SignalSource for KeyedSignals {
    fn on(&self, event: loomcli_core::SignalEvent, listener: loomcli_core::SignalListener) -> u64 {
        self.inner.on(event, listener)
    }
    fn off(&self, id: u64) {
        self.inner.off(id);
    }
    fn raise(&self, signal: loomcli_core::ProcessSignal) {
        self.raised
            .lock()
            .unwrap()
            .push((*self.keys.raw.lock().unwrap(), signal));
        self.inner.raise(signal);
    }
    fn terminal(&self) -> Option<Arc<dyn loomcli_core::InputStream>> {
        Some(Arc::clone(&self.keys) as _)
    }
}

/// What each reader of one background run saw: `None` for a reader that never ran, and
/// `Some(None)` for one that read no background.
#[derive(Debug, Default, PartialEq)]
struct Readers {
    action: Option<Option<Background>>,
    view: Option<Option<Background>>,
    middleware: Option<Option<Background>>,
    failure: Option<Option<Background>>,
}

/// One scenario of the full fixture: the background scene, whether the action fails, the variables
/// an environment hook imports, and whether the theme adapts.
struct Staged {
    scene: Scene,
    fail: bool,
    prepare: Vec<(&'static str, &'static str)>,
    adaptive: bool,
    keyed: bool,
    quit_after: Option<std::time::Duration>,
}

impl Staged {
    fn new(scene: Scene) -> Self {
        Self {
            scene,
            fail: false,
            prepare: Vec::new(),
            adaptive: false,
            keyed: false,
            quit_after: None,
        }
    }
}

/// What a staged run did: its code, its readers, its stdout and stderr, the raw-mode switches, and
/// the signal that ended the process.
struct Staging {
    code: u8,
    readers: Readers,
    stdout: String,
    stderr: String,
    modes: Vec<bool>,
    ended_by: Option<loomcli_core::ProcessSignal>,
    raised: Vec<(bool, loomcli_core::ProcessSignal)>,
}

/// The fixture's theme: an adaptive `accent` whose sides print apart, and a plain `plain`.
fn adaptive_theme() -> loomcli_core::Plugin {
    let dark = style()
        .hex_with(
            "#102030",
            loomcli_core::style::ColorFallbacks::new()
                .ansi16(loomcli_core::style::Ansi16Color::Blue)
                .ansi256(17),
        )
        .unwrap();
    let light = style()
        .hex_with(
            "#F0E0D0",
            loomcli_core::style::ColorFallbacks::new()
                .ansi16(loomcli_core::style::Ansi16Color::Yellow)
                .ansi256(223),
        )
        .unwrap();
    loomcli_core::Plugin::new("@fixture/theme").theme(
        loomcli_core::ThemeMapping::new()
            .entry("accent", loomcli_core::adaptive(&dark, &light).unwrap())
            .entry("plain", style().cyan()),
    )
}

async fn stage(staged: Staged) -> Staging {
    let Staged {
        scene,
        fail,
        prepare,
        adaptive,
        keyed,
        quit_after,
    } = staged;
    let readers = Arc::new(Mutex::new(Readers::default()));
    let observe = loomcli_core::Plugin::new("@fixture/observe").middleware(
        loomcli_core::Activation::Always,
        {
            let readers = Arc::clone(&readers);
            move |ctx, next: loomcli_core::Next| {
                readers.lock().unwrap().middleware = Some(ctx.host.terminal.background);
                async move { next.run().await.map(|_| ()) }
            }
        },
    );
    let mut plugins = vec![observe];
    if adaptive {
        plugins.insert(0, adaptive_theme());
    }
    if !prepare.is_empty() {
        plugins.push(
            loomcli_core::Plugin::new("@fixture/prepare").on_environment(move |_| {
                let prepare = prepare.clone();
                async move {
                    Ok(prepare
                        .iter()
                        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                        .collect())
                }
            }),
        );
    }
    let failure_line = override_view(
        loomcli_core::failure::<loomcli_core::LoomError>(),
        loomcli_core::FailureView::new({
            let readers = Arc::clone(&readers);
            move |failure: &loomcli_core::LoomError, context| {
                readers.lock().unwrap().failure = Some(context.view_context.background);
                format!("{}\n", loomcli_core::FailureFacts::message(failure))
            }
        }),
    );
    let act = {
        let readers = Arc::clone(&readers);
        move |ctx: Context| {
            let readers = Arc::clone(&readers);
            async move {
                readers.lock().unwrap().action = Some(ctx.host.terminal.background);
                let view = View::new({
                    let readers = Arc::clone(&readers);
                    move |_: &str, context: &ViewContext| {
                        readers.lock().unwrap().view = Some(context.background);
                        String::new()
                    }
                });
                ctx.out.render("", &view).await?;
                if adaptive {
                    ctx.out
                        .print(&format!(
                            "{} {}",
                            ctx.style.token("accent").apply("accent"),
                            ctx.style.token("plain").apply("plain")
                        ))
                        .await?;
                }
                if fail {
                    return Err(ctx.out.fatal("The action failed."));
                }
                Ok(())
            }
        }
    };
    let policy = scene
        .declared
        .map_or_else(RenderingPolicy::new, |declared| {
            RenderingPolicy::new().background(declared)
        });
    let base = Application::new("notes")
        .plugins(plugins)
        .description("Keep notes.")
        .rendering(policy)
        .overrides([failure_line]);
    let app = if scene.mark {
        base.global_option(
            "background",
            Opt::string()
                .aliases(["tint"])
                .background()
                .description("The terminal's background."),
        )
        .action(act)
    } else {
        base.action(act)
    };
    let mock = mock_process(support::fields(&scene.argv, &scene.env));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdin = Some(Arc::clone(&scene.keys) as _);
    let raised: Arc<Mutex<Vec<(bool, loomcli_core::ProcessSignal)>>> = Arc::default();
    if keyed {
        handle.signals = Some(Arc::new(KeyedSignals {
            inner: loomcli_core::ProcessHandle::signals(&*mock),
            keys: Arc::clone(&scene.keys),
            raised: Arc::clone(&raised),
        }));
    }
    let (stdin, stdout, stderr) = scene.terminals;
    handle.terminal = Some(Arc::new(Facts {
        stdin,
        stdout: OutputTerminal::new(stdout, Some(80), Some(24)),
        stderr: OutputTerminal::new(stderr, Some(80), Some(24)),
        stated: scene.stated,
    }));
    let mut options = RunOptions::new().process(Arc::new(handle));
    if let Some(token) = scene.token {
        options = options.signal(token);
    }
    let running = app.run(options);
    let quitting = {
        let mock = Arc::clone(&mock);
        async move {
            if let Some(after) = quit_after {
                tokio::time::sleep(after).await;
                mock.raise(loomcli_core::ProcessSignal::Quit);
            }
        }
    };
    let (code, ()) = tokio::join!(running, quitting);
    let modes = scene.keys.switches.lock().unwrap().clone();
    let readers = std::mem::take(&mut *readers.lock().unwrap());
    Staging {
        code: code.get(),
        readers,
        stdout: mock.stdout_text(),
        stderr: mock.stderr_text(),
        modes,
        ended_by: mock.ended_by(),
        raised: raised.lock().unwrap().clone(),
    }
}

#[tokio::test]
async fn a_middleware_and_a_failure_view_read_the_settled_background() {
    let answered = stage(Staged::new(Scene::new(&light()))).await;
    assert_eq!(
        answered.readers,
        Readers {
            action: Some(Some(Background::Light)),
            view: Some(Some(Background::Light)),
            middleware: Some(Some(Background::Light)),
            failure: None,
        }
    );
    let failed = stage(Staged {
        fail: true,
        ..Staged::new(Scene::new(&light()))
    })
    .await;
    assert_eq!(failed.code, 1);
    assert_eq!(failed.readers.failure, Some(Some(Background::Light)));
}

#[tokio::test]
async fn a_choice_that_supplies_nothing_fails_the_parse_and_the_failure_view_reads_the_stated_side()
{
    for argv in [
        vec!["--background", "--verbose"],
        vec!["--background", "--"],
    ] {
        let failed = stage(Staged::new(Scene {
            argv: argv.clone(),
            stated: Some(Background::Dark),
            ..Scene::new("")
        }))
        .await;
        assert_eq!(failed.code, 2, "{argv:?}");
        assert_eq!(
            failed.readers.failure,
            Some(Some(Background::Dark)),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn an_invocation_by_name_reads_no_background_under_a_light_policy() {
    let readers = Arc::new(Mutex::new(Readers::default()));
    let app = Application::new("notes")
        .rendering(RenderingPolicy::new().background(BackgroundPolicy::Light))
        .action({
            let readers = Arc::clone(&readers);
            move |ctx: Context| {
                let readers = Arc::clone(&readers);
                async move {
                    readers.lock().unwrap().action = Some(ctx.host.terminal.background);
                    let view = View::new({
                        let readers = Arc::clone(&readers);
                        move |_: &str, context: &ViewContext| {
                            readers.lock().unwrap().view = Some(context.background);
                            String::new()
                        }
                    });
                    ctx.out.render("", &view).await
                }
            }
        });
    let outcome = app
        .invoke(
            &[],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<loomcli_core::Error>::new(),
            Some(mock_process(loomcli_testing::MockFields::new()) as _),
        )
        .await;
    assert!(matches!(
        outcome,
        loomcli_core::InvocationOutcome::Completed { .. }
    ));
    let readers = readers.lock().unwrap();
    assert_eq!((readers.action, readers.view), (Some(None), Some(None)));
}

#[tokio::test]
async fn a_shutdown_during_the_wait_leaves_raw_mode_before_the_signal_is_raised_again() {
    // A terminal that never answers, so the wait lasts until the signal arrives.
    let mut scene = Scene::new("");
    scene.keys = Keys::typing(&[]);
    let quit = stage(Staged {
        quit_after: Some(std::time::Duration::from_millis(50)),
        keyed: true,
        ..Staged::new(scene)
    })
    .await;
    assert_eq!(quit.code, 131);
    assert_eq!(quit.raised, [(false, loomcli_core::ProcessSignal::Quit)]);
    assert_eq!(
        (quit.modes.first(), quit.modes.last()),
        (Some(&true), Some(&false))
    );
    assert_eq!(quit.ended_by, Some(loomcli_core::ProcessSignal::Quit));
    assert_eq!(quit.readers.action, None);
}

#[tokio::test]
async fn ctrl_c_read_during_the_wait_ends_the_run_by_sigint_with_status_130() {
    let ended = stage(Staged {
        keyed: true,
        ..Staged::new(Scene::new(&format!("\u{3}{}", light())))
    })
    .await;
    assert_eq!(ended.code, 130);
    assert_eq!(
        ended.raised.first(),
        Some(&(false, loomcli_core::ProcessSignal::Int))
    );
    assert_eq!(ended.ended_by, Some(loomcli_core::ProcessSignal::Int));
    assert_eq!(
        ended.readers,
        Readers::default(),
        "no reader runs: the action, the middleware, and the view are unread"
    );
    assert_eq!(ended.stdout, "");
}

/// Variables a scene's process holds.
type Variables = Vec<(&'static str, &'static str)>;

/// The action's printed line with the adaptive token in one color.
fn themed_line(color: &str) -> String {
    format!("\u{1b}[{color}maccent\u{1b}[39m \u{1b}[36mplain\u{1b}[39m\n")
}

#[tokio::test]
async fn an_adaptive_token_resolves_to_the_side_the_background_names_at_each_depth() {
    let depths: [(Variables, &str, &str); 3] = [
        (
            vec![("COLORTERM", "truecolor"), ("TERM", "xterm-256color")],
            "38;2;16;32;48",
            "38;2;240;224;208",
        ),
        (vec![("TERM", "xterm-256color")], "38;5;17", "38;5;223"),
        (vec![("TERM", "xterm")], "34", "33"),
    ];
    for (env, dark, light) in depths {
        let run = |stated: Option<Background>, stdin: bool| {
            let env = env.clone();
            async move {
                let mut scene = Scene::new("");
                scene.mark = false;
                scene.env = env;
                scene.stated = stated;
                scene.terminals = (stdin, true, true);
                stage(Staged {
                    adaptive: true,
                    ..Staged::new(scene)
                })
                .await
                .stdout
            }
        };
        assert_eq!(run(Some(Background::Light), true).await, themed_line(light));
        assert_eq!(run(Some(Background::Dark), true).await, themed_line(dark));
        assert_eq!(run(None, false).await, themed_line(dark));
    }
}

#[tokio::test]
async fn a_color_change_during_preparation_leaves_the_background_as_settled() {
    let mut scene = Scene::new(&light());
    scene.mark = false;
    scene.env.push(("NO_COLOR", "1"));
    let staged = stage(Staged {
        adaptive: true,
        prepare: vec![("FORCE_COLOR", "1")],
        ..Staged::new(scene)
    })
    .await;
    assert_eq!(staged.stderr, "", "no query is written");
    assert_eq!(staged.readers.action, Some(None));
    assert_eq!(staged.stdout, themed_line("38;2;16;32;48"));
}

#[tokio::test]
async fn an_imported_variable_leaves_the_query_and_the_settled_background_unchanged() {
    let dark = format!("\u{1b}]11;rgb:0/0/0\u{7}{DA1}");
    for prepare in [("COLORFGBG", "0;15"), ("TERM", "linux"), ("STY", "1")] {
        let mut scene = Scene::new(&dark);
        scene.mark = false;
        let staged = stage(Staged {
            adaptive: true,
            prepare: vec![prepare],
            ..Staged::new(scene)
        })
        .await;
        assert_eq!(staged.stderr, QUERY, "{prepare:?}");
        assert_eq!(
            staged.readers.action,
            Some(Some(Background::Dark)),
            "{prepare:?}"
        );
    }
}
