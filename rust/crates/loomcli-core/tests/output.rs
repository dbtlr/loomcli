//! Ports `output.test.ts`, `lanes.test.ts`, `render.test.ts`, `out-text.test.ts`, the lane and
//! registry cases of `views.test.ts`, `ci-rendering.test.ts`, and the view-context cases of
//! `columns.test.ts`: the semantic lanes, rendered and drawn views, a view's text without a write,
//! application overrides, and the rendering policy each destination resolves, end to end through
//! `Application::run` on the mock process.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::io;
use std::sync::{Arc, Mutex};

use loomcli_core::style::{Ansi16Color, ColorFallbacks};
use loomcli_core::{
    Application, Build, Context, DeclaredView, Done, FailureView, FailureViewContext, FatalError,
    NoInputs, NoResult, Out, OutputTerminal, ReleaseFacts, RenderingPolicy, RunOptions, Style,
    Switch, View, ViewContext, failure, lanes, nowrap, override_view, style, view,
};
use loomcli_testing::{MockFields, MockTerminal, StreamName, mock_process};
use support::streams::{Facts, Scripted, Seen, Swapped};
use support::{Ran, run, run_with};

type App = Application<NoInputs, NoResult, Done>;

/// A distributed build, whose defects read as the generic message.
fn distributed() -> ReleaseFacts {
    ReleaseFacts::new(Build::Distributed)
}

// output.test.ts

#[tokio::test]
async fn writes_finish_in_call_order_on_their_destination() {
    let app: App = Application::new("output").action(|ctx: Context| async move {
        ctx.out.print("one").await?;
        ctx.out.print("two").await?;
        ctx.out.print("three").await
    });
    let process = mock_process(MockFields::new().release(distributed()));
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(code.get(), 0);
    let written: Vec<_> = process
        .transcript()
        .into_iter()
        .map(|write| format!("{write:?}"))
        .collect();
    assert_eq!(
        written,
        [
            "Stdout(\"one\\n\")",
            "Stdout(\"two\\n\")",
            "Stdout(\"three\\n\")"
        ]
    );
}

#[tokio::test]
async fn semantic_output_preserves_whitespace() {
    let app: App = Application::new("output").action(|ctx: Context| async move {
        ctx.out.print(" \ntext\t").await?;
        ctx.out.info("info").await?;
        ctx.out.success("success").await?;
        ctx.out.warn("warn").await?;
        ctx.out.error("error").await
    });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: " \ntext\t\n".to_owned(),
            stderr: "ℹ info\n✔ success\n⚠ warn\n✘ error\n".to_owned(),
        }
    );
}

/// A run of `app` whose stdout, and stderr when `both`, refuse every write with `kind`.
async fn refused(app: &App, kind: io::ErrorKind, both: bool) -> (u8, String, Vec<Seen>) {
    let log = Arc::new(Mutex::new(Vec::new()));
    let mock = mock_process(MockFields::new().release(distributed()));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdout = Some(Scripted::refusing(0, kind, Arc::clone(&log)));
    if both {
        handle.stderr = Some(Scripted::refusing(0, kind, Arc::clone(&log)));
    }
    let code = app.run(RunOptions::new().process(Arc::new(handle))).await;
    let seen = log.lock().unwrap().clone();
    (code.get(), mock.stderr_text(), seen)
}

#[tokio::test]
async fn a_failed_write_cannot_escape_the_completion_boundary() {
    let printing: App = Application::new("output").action(|ctx: Context| async move {
        ctx.out.print("one").await?;
        ctx.out.print("two").await
    });
    let (code, stderr, _) = refused(&printing, io::ErrorKind::Other, false).await;
    assert_eq!(
        (code, stderr.as_str()),
        (1, "output: Something went wrong.\n")
    );
    // The action caught the write's failure, and the broken destination still fails the run.
    let caught = Arc::new(Mutex::new(Vec::new()));
    let events = Arc::clone(&caught);
    let catching: App = Application::new("output").action(move |ctx: Context| {
        let events = Arc::clone(&events);
        async move {
            if ctx.out.print("one").await.is_err() {
                events.lock().unwrap().push("caught");
            }
            Ok(())
        }
    });
    let (code, stderr, _) = refused(&catching, io::ErrorKind::Other, false).await;
    assert_eq!(
        (code, stderr.as_str()),
        (1, "output: Something went wrong.\n")
    );
    assert_eq!(*caught.lock().unwrap(), ["caught"]);
    // With stderr refusing too, nothing reports the failure, and the run still returns 1.
    let (code, stderr, _) = refused(&printing, io::ErrorKind::Other, true).await;
    assert_eq!((code, stderr.as_str()), (1, ""));
}

#[tokio::test]
async fn a_failed_report_gets_exactly_one_fallback_attempt() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let mock = mock_process(MockFields::new().release(distributed()));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stderr = Some(Scripted::refusing(
        0,
        io::ErrorKind::Other,
        Arc::clone(&log),
    ));
    let app: App = Application::new("output")
        .action(|ctx: Context| async move { Err(ctx.out.fatal("Expected failure.")) });
    let code = app.run(RunOptions::new().process(Arc::new(handle))).await;
    assert_eq!(code.get(), 1);
    assert_eq!(
        *log.lock().unwrap(),
        [
            Seen::Refused("Expected failure.\n".to_owned()),
            Seen::Refused("output: Something went wrong.\n".to_owned()),
        ]
    );
}

/// The text an error reads as: a foreign error's display, or a failure's message.
fn reason(error: &loomcli_core::Error) -> String {
    use loomcli_core::FailureFacts;
    error
        .foreign()
        .map(ToString::to_string)
        .or_else(|| error.failure().map(|failure| failure.message().to_owned()))
        .unwrap_or_default()
}

// lanes.test.ts

/// What one lane writes on a terminal `columns` wide, or off a terminal when `columns` is `None`.
async fn lane(
    name: &'static str,
    message: String,
    columns: Option<u16>,
    env: &[(&str, &str)],
    policy: Option<RenderingPolicy>,
) -> Ran {
    let app: App = Application::new("lanes")
        .description("Write one lane message.")
        .action(move |ctx: Context| {
            let message = message.clone();
            async move {
                match name {
                    "print" => ctx.out.print(&message).await,
                    "info" => ctx.out.info(&message).await,
                    "success" => ctx.out.success(&message).await,
                    "warn" => ctx.out.warn(&message).await,
                    _ => ctx.out.error(&message).await,
                }
            }
        });
    let mut fields = support::fields(&[], env).platform("linux");
    fields = fields.terminal(match columns {
        Some(columns) => MockTerminal::new(columns, 24),
        None => MockTerminal::new(80, 24).streams([]),
    });
    let process = mock_process(fields);
    let mut options = RunOptions::new().process(Arc::clone(&process) as _);
    if let Some(policy) = policy {
        options = options.rendering(policy);
    }
    let code = app.run(options).await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

const LONG: &str = "one two three four five six";

#[tokio::test]
async fn each_marked_lane_wraps_at_columns_minus_its_gutter() {
    for (name, mark) in [
        ("info", "ℹ"),
        ("success", "✔"),
        ("warn", "⚠"),
        ("error", "✘"),
    ] {
        assert_eq!(
            lane(name, LONG.to_owned(), Some(20), &[], None).await,
            Ran {
                status: 0,
                stdout: String::new(),
                stderr: format!("{mark} one two three four\n  five six\n"),
            },
            "{name}"
        );
    }
}

#[tokio::test]
async fn an_authored_line_break_keeps_its_gutter_and_each_line_wraps_alone() {
    let ran = lane(
        "warn",
        format!("{LONG}\nseven eight nine"),
        Some(12),
        &[],
        None,
    )
    .await;
    assert_eq!(
        ran.stderr,
        "⚠ one two\n  three four\n  five six\n  seven\n  eight nine\n"
    );
}

#[tokio::test]
async fn a_lane_leaves_the_message_unwrapped_off_a_terminal_and_without_room() {
    let piped = lane("warn", LONG.to_owned(), None, &[("COLUMNS", "10")], None).await;
    assert_eq!(piped.stderr, format!("⚠ {LONG}\n"));
    let narrow = lane("warn", LONG.to_owned(), Some(2), &[], None).await;
    assert_eq!(narrow.stderr, format!("⚠ {LONG}\n"));
    let three = lane("warn", "a b".to_owned(), Some(3), &[], None).await;
    assert_eq!(three.stderr, "⚠ a\n  b\n");
}

#[tokio::test]
async fn columns_narrows_the_width_a_lane_wraps_at() {
    let ran = lane(
        "info",
        LONG.to_owned(),
        Some(100),
        &[("COLUMNS", "20")],
        None,
    )
    .await;
    assert_eq!(ran.stderr, "ℹ one two three four\n  five six\n");
}

#[tokio::test]
async fn print_never_wraps() {
    assert_eq!(
        lane("print", LONG.to_owned(), Some(10), &[], None).await,
        Ran {
            status: 0,
            stdout: format!("{LONG}\n"),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_no_wrap_path_stays_on_one_line_and_the_text_around_it_wraps() {
    let path = "/Users/a/Library/Application Support/x";
    let ran = lane(
        "info",
        format!("Wrote {}", nowrap(path)),
        Some(32),
        &[],
        None,
    )
    .await;
    assert_eq!(ran.stderr, format!("ℹ Wrote\n  {path}\n"));
}

fn always() -> Option<RenderingPolicy> {
    Some(RenderingPolicy::new().color(Switch::Always))
}

#[tokio::test]
async fn a_style_that_spans_a_wrapped_break_continues_across_it() {
    let red = style().red().apply("aaa bbb");
    let ran = lane("warn", red, Some(5), &[], always()).await;
    assert_eq!(ran.stderr, "⚠ \u{1b}[31maaa\n  bbb\u{1b}[39m\n");
}

#[tokio::test]
async fn a_tab_expands_from_the_start_of_its_message_line() {
    let ran = lane("warn", "aaaaaa\tb c".to_owned(), Some(11), &[], None).await;
    assert_eq!(ran.stderr, "⚠ aaaaaa  b\n  c\n");
    let wrapped = lane("warn", "aaa bbbbbb\tc".to_owned(), Some(11), &[], None).await;
    assert_eq!(wrapped.stderr, "⚠ aaa\n  bbbbbb\n  c\n");
}

#[tokio::test]
async fn a_tab_inside_nowrap_or_a_style_expands_too() {
    let unbroken = lane(
        "warn",
        format!("{} c", nowrap("aaaaaa\tb")),
        Some(11),
        &[],
        None,
    )
    .await;
    assert_eq!(unbroken.stderr, "⚠ aaaaaa  b\n  c\n");
    let styled = lane(
        "warn",
        style().red().apply("aaaaaa\tb c"),
        Some(11),
        &[],
        always(),
    )
    .await;
    assert_eq!(styled.stderr, "⚠ \u{1b}[31maaaaaa  b\n  c\u{1b}[39m\n");
}

#[tokio::test]
async fn a_tab_stays_a_tab_off_a_terminal_and_in_print() {
    let piped = lane(
        "warn",
        "aaaaaa\tb c".to_owned(),
        None,
        &[("COLUMNS", "11")],
        None,
    )
    .await;
    assert_eq!(piped.stderr, "⚠ aaaaaa\tb c\n");
    let printed = lane("print", "aaaaaa\tb c".to_owned(), Some(11), &[], None).await;
    assert_eq!(printed.stdout, "aaaaaa\tb c\n");
}

// render.test.ts

#[derive(Clone)]
struct Row {
    count: usize,
    source: &'static str,
}

fn rows() -> Vec<Row> {
    vec![
        Row {
            count: 6,
            source: "one.txt",
        },
        Row {
            count: 2,
            source: "two words.txt",
        },
    ]
}

fn table() -> View<[Row]> {
    View::new(|rows: &[Row], _: &ViewContext| {
        rows.iter()
            .map(|row| format!("{}  {}\n", row.count, row.source))
            .collect::<String>()
    })
}

/// A run of an application whose action is `act`, in a distributed build.
async fn render_run<F, Fut>(act: F) -> Ran
where
    F: Fn(Out) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = loomcli_core::Outcome> + Send + 'static,
{
    let act = Arc::new(act);
    let app: App = Application::new("render").action(move |ctx: Context| {
        let act = Arc::clone(&act);
        async move { act(ctx.out).await }
    });
    run_with(&app, MockFields::new().release(distributed())).await
}

#[tokio::test]
async fn a_rendered_value_writes_the_view_text_to_stdout() {
    let ran = render_run(|out| async move { out.render(&rows(), &table()).await }).await;
    assert_eq!(ran.stdout, "6  one.txt\n2  two words.txt\n");
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
}

#[tokio::test]
async fn the_view_owns_every_byte_so_core_adds_no_newline() {
    let bare = View::new(|rows: &[Row], _: &ViewContext| {
        rows.iter()
            .map(|row| row.source)
            .collect::<Vec<_>>()
            .join(" ")
    });
    let ran = render_run(move |out| {
        let bare = bare.clone();
        async move { out.render(&rows(), &bare).await }
    })
    .await;
    assert_eq!(ran.stdout, "one.txt two words.txt");
}

#[tokio::test]
async fn a_rendered_value_and_a_plain_message_keep_the_order_issued() {
    let ran = render_run(|out| async move {
        out.print("before").await?;
        out.render(&rows(), &table()).await?;
        out.print("after").await
    })
    .await;
    assert_eq!(ran.stdout, "before\n6  one.txt\n2  two words.txt\nafter\n");
}

fn breaks() -> View<[Row]> {
    View::new(|_: &[Row], _: &ViewContext| -> Result<String, io::Error> {
        Err(io::Error::other("Cannot render the table."))
    })
}

#[tokio::test]
async fn an_action_that_catches_a_view_failure_decides_the_outcome() {
    let ran = render_run(|out| async move {
        match out.render(&rows(), &breaks()).await {
            Ok(()) => out.print("unreachable").await?,
            Err(error) => out.print(&format!("caught:{}", reason(&error))).await?,
        }
        out.print("after").await
    })
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: "caught:Cannot render the table.\nafter\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_view_failure_the_action_returns_fails_the_run() {
    let ran = render_run(|out| async move {
        out.render(&rows(), &breaks()).await?;
        out.print("unreachable").await
    })
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "render: Something went wrong.\n".to_owned(),
        }
    );
}

// out-text.test.ts

/// A view whose bytes name the color depth, the hyperlink policy, and the width it resolved at.
fn banner() -> View<str> {
    View::new(|name: &str, context: &ViewContext| {
        let sienna = context
            .style
            .hex_with(
                "#C97B36",
                ColorFallbacks::new()
                    .ansi16(Ansi16Color::Yellow)
                    .ansi256(172),
            )
            .expect("a valid color")
            .bold();
        let columns = context
            .columns
            .map_or_else(|| "undefined".to_owned(), |columns| columns.to_string());
        format!(
            "{} {LINK} {columns}\n",
            sienna.apply(&context.style.escape(name))
        )
    })
}

/// The visible text `docs`, linked, which a terminal keeps and every other destination strips.
const LINK: &str = "\u{1b}]8;;https://example.com\u{7}docs\u{1b}]8;;\u{7}";

/// What `out.text` returned and what `out.render` then wrote, from one action.
async fn text_and_render(fields: MockFields) -> (String, String) {
    let seen = Arc::new(Mutex::new(String::new()));
    let text = Arc::clone(&seen);
    let app: App = Application::new("banner").action(move |ctx: Context| {
        let text = Arc::clone(&text);
        async move {
            *text.lock().unwrap() = ctx.out.text("loom", &banner())?;
            ctx.out.render("loom", &banner()).await
        }
    });
    let process = mock_process(fields);
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(code.get(), 0);
    let text = seen.lock().unwrap().clone();
    (text, process.stdout_text())
}

#[tokio::test]
async fn out_text_returns_the_bytes_out_render_writes_next() {
    let cases = [
        support::fields(&[], &[("TERM", "xterm-256color")]).terminal(MockTerminal::new(40, 24)),
        support::fields(&[], &[("TERM", "xterm-256color")]).terminal(MockTerminal::new(100, 24)),
        support::fields(&[], &[("TERM", "xterm-256color")]),
        support::fields(&[], &[("NO_COLOR", "1"), ("TERM", "xterm-256color")])
            .terminal(MockTerminal::new(80, 24)),
        support::fields(&[], &[("FORCE_COLOR", "3")]),
        support::fields(&[], &[("COLUMNS", "60"), ("TERM", "xterm-256color")])
            .terminal(MockTerminal::new(100, 24)),
    ];
    for fields in cases {
        let (text, written) = text_and_render(fields).await;
        assert_ne!(written, "");
        assert_eq!(text, written);
    }
}

#[tokio::test]
async fn under_an_application_override_out_text_returns_the_override_bytes() {
    let declared: DeclaredView<str> = view(
        "test/out-text/banner",
        View::new(|name: &str, _: &ViewContext| format!("default {name}\n")),
    );
    let seen = Arc::new(Mutex::new(String::new()));
    let text = Arc::clone(&seen);
    let key = declared.clone();
    let app: App = Application::new("banner")
        .overrides([override_view(
            declared.clone(),
            View::new(|name: &str, context: &ViewContext| {
                format!("{} overridden\n", context.style.bold().apply(name))
            }),
        )])
        .action(move |ctx: Context| {
            let text = Arc::clone(&text);
            let key = key.clone();
            async move {
                *text.lock().unwrap() = ctx.out.text("loom", &key)?;
                ctx.out.render("loom", &key).await
            }
        });
    let ran = run_with(
        &app,
        support::fields(&[], &[("TERM", "xterm-256color")]).terminal(MockTerminal::new(80, 24)),
    )
    .await;
    assert_eq!(ran.stdout, "\u{1b}[1mloom\u{1b}[22m overridden\n");
    assert_eq!(*seen.lock().unwrap(), ran.stdout);
}

#[tokio::test]
async fn on_a_result_command_the_action_text_resolves_for_stderr_and_a_middlewares_for_stdout() {
    use loomcli_core::{Command, ResultViews, ValueResult};
    let seen = Arc::new(Mutex::new(String::new()));
    let text = Arc::clone(&seen);
    let get = Command::new("get")
        .result(ResultViews::new().view(
            "plain",
            View::new(|value: &String, _: &ViewContext| format!("{value}\n")),
        ))
        .action(move |ctx: Context<NoInputs, ValueResult<String>>| {
            let text = Arc::clone(&text);
            async move {
                *text.lock().unwrap() = ctx.out.text("loom", &banner())?;
                ctx.out.render("loom", &banner()).await?;
                ctx.out.results("done".to_owned()).await
            }
        });
    let middleware_text = Arc::new(Mutex::new(String::new()));
    let recorder = loomcli_core::Plugin::new("test/out-text/recorder").middleware(
        loomcli_core::Activation::Always,
        {
            let middleware_text = Arc::clone(&middleware_text);
            move |ctx, next: loomcli_core::Next| {
                let middleware_text = Arc::clone(&middleware_text);
                async move {
                    *middleware_text.lock().unwrap() = ctx.out.text("loom", &banner())?;
                    ctx.out.render("loom", &banner()).await?;
                    next.run().await.map(|_| ())
                }
            }
        },
    );
    let app = Application::new("banner").plugins([recorder]).command(get);
    let ran = run_with(
        &app,
        support::fields(&["get"], &[("TERM", "xterm-256color")])
            .terminal(MockTerminal::new(80, 24).streams([StreamName::Stderr])),
    )
    .await;
    assert_eq!(ran.status, 0);
    assert_eq!(
        *seen.lock().unwrap(),
        format!("\u{1b}[38;5;172;1mloom\u{1b}[39;22m {LINK} 80\n")
    );
    assert_eq!(ran.stderr, *seen.lock().unwrap());
    assert_eq!(*middleware_text.lock().unwrap(), "loom docs undefined\n");
    assert_eq!(ran.stdout, "loom docs undefined\ndone\n");
}

#[tokio::test]
async fn under_app_invoke_out_text_returns_the_plain_text_the_capture_holds() {
    let seen = Arc::new(Mutex::new(String::new()));
    let text = Arc::clone(&seen);
    let app: App = Application::new("banner").action(move |ctx: Context| {
        let text = Arc::clone(&text);
        async move {
            *text.lock().unwrap() = ctx.out.text("loom", &banner())?;
            ctx.out.render("loom", &banner()).await
        }
    });
    let outcome = app
        .invoke(
            &[],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<loomcli_core::Error>::new(),
            Some(mock_process(MockFields::new()) as _),
        )
        .await;
    let loomcli_core::InvocationOutcome::Completed { output, .. } = outcome else {
        panic!("the call completes");
    };
    assert_eq!(output, "loom docs undefined\n");
    assert_eq!(*seen.lock().unwrap(), "loom docs undefined\n");
}

#[tokio::test]
async fn an_action_that_only_calls_out_text_writes_nothing() {
    let app: App = Application::new("banner").action(|ctx: Context| async move {
        ctx.out.text("loom", &banner())?;
        Ok(())
    });
    let ran = run_with(
        &app,
        support::fields(&[], &[("TERM", "xterm-256color")]).terminal(MockTerminal::new(80, 24)),
    )
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: String::new(),
        }
    );
}

fn broken() -> View<str> {
    View::new(|_: &str, _: &ViewContext| -> Result<String, io::Error> {
        Err(io::Error::other("The view broke."))
    })
}

#[tokio::test]
async fn a_view_failure_from_out_text_is_returned_and_an_action_may_catch_it() {
    let app: App = Application::new("banner").action(|ctx: Context| async move {
        let error = ctx.out.text("loom", &broken()).expect_err("the view broke");
        assert_eq!(reason(&error), "The view broke.");
        Ok(())
    });
    assert_eq!(run(&app, &[]).await.status, 0);
}

#[tokio::test]
async fn a_failure_from_out_text_fails_the_run_as_the_same_one_from_out_render() {
    let text: App = Application::new("banner").action(|ctx: Context| async move {
        ctx.out.text("loom", &broken())?;
        Ok(())
    });
    let render: App = Application::new("banner")
        .action(|ctx: Context| async move { ctx.out.render("loom", &broken()).await });
    let fields = || MockFields::new().release(distributed());
    let rendered = run_with(&render, fields()).await;
    assert_eq!(rendered.status, 1);
    assert_eq!(run_with(&text, fields()).await, rendered);
}

// views.test.ts: the registry cases that need no plugin or failure view

#[derive(Clone)]
struct Page {
    title: &'static str,
}

fn page() -> DeclaredView<Page> {
    view(
        "@fixture/page",
        View::new(|data: &Page, _: &ViewContext| format!("page: {}\n", data.title)),
    )
}

fn branded(label: &'static str) -> View<Page> {
    View::new(move |data: &Page, _: &ViewContext| format!("{label}: {}\n", data.title))
}

/// An application that renders one page through `key` under `overrides`.
async fn rendering(key: DeclaredView<Page>, overrides: Vec<loomcli_core::ViewOverride>) -> Ran {
    let app: App = Application::new("views")
        .overrides(overrides)
        .action(move |ctx: Context| {
            let key = key.clone();
            async move { ctx.out.render(&Page { title: "one" }, &key).await }
        });
    run_with(&app, MockFields::new().release(distributed())).await
}

#[tokio::test]
async fn a_declared_view_with_no_override_renders_through_its_default() {
    assert_eq!(rendering(page(), vec![]).await.stdout, "page: one\n");
}

#[tokio::test]
async fn one_key_overridden_twice_in_one_contributor_resolves_to_the_first() {
    let overrides = vec![
        override_view(page(), branded("one")),
        override_view(page(), branded("two")),
    ];
    assert_eq!(rendering(page(), overrides).await.stdout, "one: one\n");
}

#[tokio::test]
async fn an_override_applies_the_moment_its_view_is_rendered() {
    let detached = view(
        "@fixture/detached",
        View::new(|data: &Page, _: &ViewContext| format!("detached: {}\n", data.title)),
    );
    let overrides = vec![override_view(detached.clone(), branded("app"))];
    assert_eq!(rendering(detached, overrides).await.stdout, "app: one\n");
}

#[tokio::test]
async fn an_override_for_a_view_never_rendered_is_inert() {
    let detached = view(
        "@fixture/detached",
        View::new(|data: &Page, _: &ViewContext| format!("detached: {}\n", data.title)),
    );
    let app: App = Application::new("views")
        .overrides([override_view(detached, branded("app"))])
        .option("file", loomcli_core::Opt::string().short('f').required())
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    assert_eq!(
        run_with(&app, MockFields::new().release(distributed())).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "views: Option \"--file\" is required. Supply a value.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_bare_view_consults_no_override() {
    let overrides = vec![override_view(page(), branded("app"))];
    let bare = branded("bare");
    let app: App = Application::new("views")
        .overrides(overrides)
        .action(move |ctx: Context| {
            let bare = bare.clone();
            async move { ctx.out.render(&Page { title: "one" }, &bare).await }
        });
    assert_eq!(run(&app, &[]).await.stdout, "bare: one\n");
}

#[tokio::test]
async fn an_override_keyed_by_a_declared_row_view_supersedes_its_whole_shape() {
    use loomcli_core::RowView;
    let records = view(
        "@fixture/records",
        RowView::new(|row: &Page, _, _: &ViewContext| format!("record: {}\n", row.title))
            .head(|_: &ViewContext| "RECORDS\n".to_owned()),
    );
    let replacement =
        RowView::new(|row: &Page, _, _: &ViewContext| format!("app: {}\n", row.title));
    let app: App = Application::new("views")
        .overrides([override_view(records.clone(), replacement)])
        .action(move |ctx: Context| {
            let records = records.clone();
            async move {
                let rows = vec![Page { title: "one" }, Page { title: "two" }];
                ctx.out.render(rows, &records).await
            }
        });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: "app: one\napp: two\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[test]
fn two_views_under_one_identity_with_different_types_are_two_package_copies() {
    let copy: DeclaredView<String> = view(
        "@fixture/page",
        View::new(|data: &String, _: &ViewContext| data.clone()),
    );
    let fault = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = Application::new("views").overrides([
            override_view(page(), branded("app")),
            override_view(
                copy,
                View::new(|data: &String, _: &ViewContext| data.clone()),
            ),
        ]);
    }))
    .expect_err("the call rejects the second copy");
    let message = fault.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(
        message.contains("@loomcli/core/two-package-copies"),
        "{message}"
    );
    assert!(
        message.contains(
            "View \"@fixture/page\" is declared by two distinct objects. Install one copy of the package that declares it."
        ) || message.contains("View \"@fixture/page\" is declared by two distinct objects."),
        "{message}"
    );
    // A lane's identity is core's own, so a view of another type under it is a second copy too.
    let lane = std::panic::catch_unwind(|| {
        let forged: DeclaredView<String> = view(
            "@loomcli/core/lanes/warn",
            View::new(|data: &String, _: &ViewContext| data.clone()),
        );
        let _ = Application::new("views").overrides([override_view(
            forged,
            View::new(|data: &String, _: &ViewContext| data.clone()),
        )]);
    });
    assert!(lane.is_err());
}

#[tokio::test]
async fn an_override_of_a_lane_view_is_observed_through_its_semantic_method() {
    let warned: App = Application::new("views")
        .overrides([override_view(
            lanes::warn(),
            View::new(|message: &str, _: &ViewContext| format!("warned: {message}")),
        )])
        .action(|ctx: Context| async move { ctx.out.warn("careful").await });
    assert_eq!(
        run(&warned, &[]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "warned: careful\n".to_owned(),
        }
    );
    let empty: App = Application::new("views")
        .overrides([override_view(
            lanes::warn(),
            View::new(|_: &str, _: &ViewContext| String::new()),
        )])
        .action(|ctx: Context| async move { ctx.out.warn("careful").await });
    assert_eq!(run(&empty, &[]).await.stderr, "\n");
}

#[tokio::test]
async fn a_broken_lane_view_fails_its_own_call_which_the_action_catches() {
    let app: App = Application::new("views")
        .overrides([override_view(lanes::warn(), broken())])
        .action(|ctx: Context| async move {
            if ctx.out.warn("careful").await.is_err() {
                ctx.out.print("caught").await?;
            }
            Ok(())
        });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: "caught\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_lane_view_rendered_through_out_render_writes_no_newline() {
    let app: App = Application::new("views")
        .action(|ctx: Context| async move { ctx.out.render("bare", &lanes::print()).await });
    assert_eq!(run(&app, &[]).await.stdout, "bare");
}

// ci-rendering.test.ts

/// What stdout receives when an action prints `text` on a terminal under `env`.
async fn printed(env: &[(&str, &str)], text: fn(&Style) -> String) -> String {
    let app: App = Application::new("render")
        .action(move |ctx: Context| async move { ctx.out.print(&text(&ctx.style)).await });
    let ran = run_with(
        &app,
        support::fields(&[], env).terminal(MockTerminal::new(80, 24)),
    )
    .await;
    assert_eq!(ran.status, 0);
    ran.stdout
}

fn sienna(style: &Style) -> String {
    style
        .hex_with(
            "#C97B36",
            ColorFallbacks::new()
                .ansi16(Ansi16Color::Yellow)
                .ansi256(172),
        )
        .expect("a valid color")
        .bold()
        .apply("x")
}

#[tokio::test]
async fn under_ci_a_hex_style_follows_the_log_viewers_depth() {
    let truecolor = "\u{1b}[38;2;201;123;54;1mx\u{1b}[39;22m\n";
    let basic = "\u{1b}[33;1mx\u{1b}[39;22m\n";
    let indexed = "\u{1b}[38;5;172;1mx\u{1b}[39;22m\n";
    let cases: [(&[(&str, &str)], &str); 13] = [
        (&[("CI", "true"), ("GITHUB_ACTIONS", "true")], truecolor),
        (&[("CI", "true"), ("GITEA_ACTIONS", "true")], truecolor),
        (&[("CI", "true"), ("CIRCLECI", "true")], truecolor),
        (&[("CI", "true"), ("TRAVIS", "true")], basic),
        (&[("APPVEYOR", "True"), ("CI", "True")], basic),
        (&[("CI", "true"), ("GITLAB_CI", "true")], basic),
        (&[("BUILDKITE", "true"), ("CI", "true")], basic),
        (&[("CI", "true"), ("DRONE", "true")], basic),
        (&[("CI", "true"), ("CI_NAME", "codeship")], basic),
        (&[("CI", "true")], "x\n"),
        (&[("CI", "true"), ("FORCE_COLOR", "1")], indexed),
        (
            &[
                ("CI", "true"),
                ("FORCE_COLOR", "1"),
                ("GITHUB_ACTIONS", "true"),
            ],
            truecolor,
        ),
        (&[("CI", "false")], indexed),
    ];
    for (env, written) in cases {
        let mut env = env.to_vec();
        env.push(("TERM", "xterm-256color"));
        assert_eq!(printed(&env, sienna).await, written, "{env:?}");
    }
}

#[tokio::test]
async fn under_ci_an_embedded_hyperlink_is_stripped_to_its_text() {
    fn link(_: &Style) -> String {
        LINK.to_owned()
    }
    assert_eq!(
        printed(
            &[
                ("CI", "true"),
                ("GITHUB_ACTIONS", "true"),
                ("TERM", "xterm")
            ],
            link
        )
        .await,
        "docs\n"
    );
    assert_eq!(
        printed(&[("TERM", "xterm")], link).await,
        format!("{LINK}\n")
    );
}

// columns.test.ts: the view context's width

/// A view that reports the columns its context read, and whether wrap left a long line alone.
fn reading(label: &'static str) -> View<()> {
    View::new(move |_: &(), context: &ViewContext| {
        let long = vec!["word"; 20].join(" ");
        let whole = context.wrap(&long, context.columns) == long;
        let columns = context
            .columns
            .map_or_else(|| "undefined".to_owned(), |columns| columns.to_string());
        format!(
            "{label}:{columns}:{}\n",
            if whole { "whole" } else { "wrapped" }
        )
    })
}

/// What the destinations scenario writes for stdout and stderr facts and the variables.
async fn destinations(facts: Option<Facts>, env: &[(&str, &str)]) -> Ran {
    let app: App = Application::new("columns").action(|ctx: Context| async move {
        ctx.out.render(&(), &reading("stdout")).await?;
        ctx.out.draw(&(), &reading("stderr")).await?;
        let text = |columns: Option<u16>| {
            columns.map_or_else(|| "undefined".to_owned(), |columns| columns.to_string())
        };
        ctx.out
            .print(&format!(
                "host:{},{}",
                text(ctx.host.terminal.stdout().columns),
                text(ctx.host.terminal.stderr().columns)
            ))
            .await
    });
    let mock = mock_process(support::fields(&[], env));
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.terminal = facts.map(|facts| Arc::new(facts) as _);
    let code = app.run(RunOptions::new().process(Arc::new(handle))).await;
    Ran {
        status: code.get(),
        stdout: mock.stdout_text(),
        stderr: mock.stderr_text(),
    }
}

fn written(stdout: &str, stderr: &str, host: &str) -> Ran {
    Ran {
        status: 0,
        stdout: format!("stdout:{stdout}\nhost:{host}\n"),
        stderr: format!("stderr:{stderr}\n"),
    }
}

fn terminal(stdout: (bool, Option<u16>), stderr: (bool, Option<u16>)) -> Facts {
    Facts {
        stdin: false,
        stdout: OutputTerminal::new(stdout.0, stdout.1, Some(24)),
        stderr: OutputTerminal::new(stderr.0, stderr.1, Some(24)),
        stated: None,
    }
}

#[tokio::test]
async fn a_view_reads_the_width_of_the_destination_it_renders_for() {
    assert_eq!(
        destinations(Some(terminal((true, Some(100)), (true, Some(60)))), &[]).await,
        written("100:whole", "60:wrapped", "100,60")
    );
    assert_eq!(
        destinations(Some(terminal((false, Some(100)), (true, Some(60)))), &[]).await,
        written("undefined:whole", "60:wrapped", "100,60")
    );
}

#[tokio::test]
async fn a_pipe_reads_no_columns_with_columns_set() {
    assert_eq!(
        destinations(None, &[("COLUMNS", "60")]).await,
        written("undefined:whole", "undefined:whole", "undefined,undefined")
    );
    assert_eq!(
        destinations(
            Some(terminal((false, Some(100)), (false, Some(100)))),
            &[("COLUMNS", "60")]
        )
        .await,
        written("undefined:whole", "undefined:whole", "100,100")
    );
}

#[tokio::test]
async fn a_valid_columns_narrows_a_terminal_and_an_invalid_one_reads_nothing() {
    for (value, expected) in [("60", 60), ("150", 100), ("060", 60), ("100", 100)] {
        let ran = destinations(
            Some(terminal((true, Some(100)), (true, Some(100)))),
            &[("COLUMNS", value)],
        )
        .await;
        let shape = if expected < 100 { "wrapped" } else { "whole" };
        assert_eq!(
            ran.stdout,
            format!("stdout:{expected}:{shape}\nhost:100,100\n")
        );
        assert_eq!(ran.stderr, format!("stderr:{expected}:{shape}\n"));
    }
    for value in [
        " 60",
        "+60",
        "60 ",
        "6e1",
        "0",
        "abc",
        "-5",
        "60.5",
        "",
        "9007199254740992",
    ] {
        let ran = destinations(
            Some(terminal((true, Some(100)), (true, Some(100)))),
            &[("COLUMNS", value)],
        )
        .await;
        assert_eq!(ran.stdout, "stdout:100:whole\nhost:100,100\n", "{value:?}");
    }
}

#[tokio::test]
async fn a_terminal_that_reports_no_width_reads_a_valid_columns() {
    let unknown = || terminal((true, None), (true, None));
    assert_eq!(
        destinations(Some(unknown()), &[("COLUMNS", "60")]).await,
        written("60:wrapped", "60:wrapped", "undefined,undefined")
    );
    assert_eq!(
        destinations(Some(unknown()), &[]).await,
        written("undefined:whole", "undefined:whole", "undefined,undefined")
    );
}

#[tokio::test]
async fn core_reads_the_width_for_each_render_just_before_the_view() {
    use loomcli_core::{Command, RowSource, RowView};
    let mock = mock_process(
        MockFields::new()
            .argv(["pieces"])
            .terminal(MockTerminal::new(100, 24)),
    );
    let resize = Arc::clone(&mock);
    let pieces = Command::new("pieces").action(move |ctx: Context| {
        let at = Arc::clone(&resize);
        async move {
            at.resize(61, 24);
            ctx.out.render(&(), &reading("render")).await?;
            at.resize(62, 24);
            ctx.out.info("message").await?;
            at.resize(63, 24);
            ctx.out.draw(&(), &reading("draw")).await?;
            at.resize(70, 24);
            let source = {
                let at = Arc::clone(&at);
                let mut step = 0;
                RowSource::Iter(Box::new(std::iter::from_fn(move || {
                    step += 1;
                    match step {
                        1 => {
                            at.resize(71, 24);
                            Some("a")
                        }
                        2 => {
                            at.resize(72, 24);
                            Some("b")
                        }
                        _ => {
                            at.resize(73, 24);
                            None
                        }
                    }
                })))
            };
            let view =
                RowView::new(|row: &&'static str, _, context: &ViewContext| line(row, context))
                    .head(|context: &ViewContext| line("head", context))
                    .tail(|_, context: &ViewContext| line("tail", context));
            ctx.out.render(source, &view).await?;
            at.resize(90, 24);
            Err(ctx.out.fatal("Stop."))
        }
    });
    // A lane message and a failure read the width too, through overrides that report it.
    let app = Application::new("columns")
        .overrides([
            override_view(
                lanes::info(),
                View::new(|message: &str, context: &ViewContext| {
                    line(message, context).trim_end().to_owned()
                }),
            ),
            override_view(
                failure::<FatalError>(),
                FailureView::new(|_: &FatalError, context: &FailureViewContext| {
                    line("failure", &context.view_context)
                }),
            ),
        ])
        .command(pieces);
    let code = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 1);
    assert_eq!(
        mock.stdout_text(),
        "render:61:wrapped\nhead:70:wrapped\na:71:wrapped\nb:72:wrapped\ntail:73:wrapped\n"
    );
    assert_eq!(
        mock.stderr_text(),
        "message:62:wrapped\ndraw:63:wrapped\nfailure:90:wrapped\n"
    );
}

#[tokio::test]
async fn an_invocation_by_name_reads_no_columns_with_columns_set() {
    use loomcli_core::{Command, InvocationOutcome, InvocationValues, InvokeOptions};
    let app = Application::new("columns").command(Command::new("show").action(
        |ctx: Context| async move {
            ctx.out.render(&(), &reading("stdout")).await?;
            ctx.out
                .render(
                    &(),
                    &View::new(|_: &(), context: &ViewContext| {
                        context
                            .columns
                            .map_or_else(|| "undefined".to_owned(), |columns| columns.to_string())
                    }),
                )
                .await
        },
    ));
    let mock = mock_process(
        MockFields::new()
            .env("COLUMNS", "60")
            .terminal(MockTerminal::new(100, 24)),
    );
    let outcome = app
        .invoke(
            &["show"],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock as _),
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
        ("stdout:undefined:whole\nundefined", "")
    );
}

/// A stream of rows that runs `next` for each item it yields.
struct Stepped<F>(F);

impl<F> futures_core::Stream for Stepped<F>
where
    F: FnMut() -> Option<Result<&'static str, loomcli_core::Error>> + Unpin,
{
    type Item = Result<&'static str, loomcli_core::Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::task::Poll::Ready((self.0)())
    }
}

/// Runs the width scenario's `argv` on a terminal 100 columns wide that `act` resizes.
async fn widths(argv: &str) -> Ran {
    use loomcli_core::{
        Command, FatalError, ResultViews, RowSource, RowView, RowViews, incomplete_result,
    };
    let mock = mock_process(
        MockFields::new()
            .argv([argv])
            .release(distributed())
            .terminal(MockTerminal::new(100, 24)),
    );
    let at = {
        let mock = Arc::clone(&mock);
        move |columns: u16| mock.resize(columns, 24)
    };
    let result = {
        let at = at.clone();
        Command::new("result")
            .result(ResultViews::new().view(
                "text",
                View::new(|_: &(), context: &ViewContext| line("result", context)),
            ))
            .action(
                move |ctx: Context<NoInputs, loomcli_core::ValueResult<()>>| {
                    at(65);
                    async move { ctx.out.results(()).await }
                },
            )
    };
    let whole = {
        let at = at.clone();
        Command::new("whole")
            .rows(RowViews::new().view(
                "text",
                View::new(|_: &[&'static str], context: &ViewContext| line("whole", context)),
            ))
            .action(
                move |ctx: Context<NoInputs, loomcli_core::RowsResult<&'static str>>| {
                    let at = at.clone();
                    async move {
                        at(80);
                        let mut step = 0;
                        let rows = std::iter::from_fn(move || {
                            step += 1;
                            if step == 1 {
                                Some("a")
                            } else {
                                at(81);
                                None
                            }
                        });
                        ctx.out.results(RowSource::Iter(Box::new(rows))).await
                    }
                },
            )
    };
    let stopped = {
        let at = at.clone();
        Command::new("stopped").action(move |ctx: Context| {
            let at = at.clone();
            async move {
                at(30);
                let mut step = 0;
                let rows = Stepped(move || {
                    step += 1;
                    if step == 1 {
                        Some(Ok("a"))
                    } else {
                        at(44);
                        Some(Err(FatalError::new("The source broke.").into()))
                    }
                });
                let view =
                    RowView::new(|row: &&'static str, _, context: &ViewContext| line(row, context));
                ctx.out.render(RowSource::stream(rows), &view).await
            }
        })
    };
    let app = Application::new("columns")
        .overrides([override_view(
            incomplete_result(),
            View::new(
                |_: &loomcli_core::IncompleteResult, context: &ViewContext| {
                    line("incomplete", context)
                },
            ),
        )])
        .command(result)
        .command(whole)
        .command(stopped);
    let code = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    Ran {
        status: code.get(),
        stdout: mock.stdout_text(),
        stderr: mock.stderr_text(),
    }
}

#[tokio::test]
async fn a_result_render_reads_the_width_at_its_render() {
    assert_eq!(
        widths("result").await,
        Ran {
            status: 0,
            stdout: "result:65:wrapped\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_whole_view_over_a_sequence_reads_the_width_after_the_source_ends() {
    assert_eq!(
        widths("whole").await,
        Ran {
            status: 0,
            stdout: "whole:81:wrapped\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn the_incomplete_result_line_reads_the_width_when_it_renders() {
    assert_eq!(
        widths("stopped").await,
        Ran {
            status: 1,
            stdout: "a:30:wrapped\n".to_owned(),
            stderr: "incomplete:44:wrapped\nThe source broke.\n".to_owned(),
        }
    );
}

/// The line `reading` writes, for a row view's pieces.
fn line(label: &str, context: &ViewContext) -> String {
    let long = vec!["word"; 20].join(" ");
    let whole = context.wrap(&long, context.columns) == long;
    let columns = context
        .columns
        .map_or_else(|| "undefined".to_owned(), |columns| columns.to_string());
    format!(
        "{label}:{columns}:{}\n",
        if whole { "whole" } else { "wrapped" }
    )
}

#[tokio::test]
async fn out_draw_counts_rows_against_the_real_stderr_width() {
    let mock = mock_process(
        support::fields(&[], &[("COLUMNS", "60")]).terminal(MockTerminal::new(100, 24)),
    );
    let resize = Arc::clone(&mock);
    let seen = Arc::new(Mutex::new((Vec::new(), Vec::new())));
    let report = Arc::clone(&seen);
    let app: App = Application::new("columns").action(move |ctx: Context| {
        let at = Arc::clone(&resize);
        let report = Arc::clone(&report);
        async move {
            let text = format!("{}\n", "x".repeat(80));
            let watching = {
                let report = Arc::clone(&report);
                View::new(move |text: &str, context: &ViewContext| {
                    report.lock().unwrap().0.push(context.columns);
                    text.to_owned()
                })
            };
            let first = ctx.out.draw(text.as_str(), &watching).await?;
            at.resize(40, 24);
            let second = ctx.out.draw(text.as_str(), &watching).await?;
            report.lock().unwrap().1 = vec![first, second];
            Ok(())
        }
    });
    let code = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 0);
    let (columns, counted) = seen.lock().unwrap().clone();
    assert_eq!(columns, [Some(60), Some(40)]);
    assert_eq!(counted, [1, 2]);
}

#[tokio::test]
async fn a_bare_failure_line_stays_one_line_per_sentence_on_a_narrow_terminal() {
    use loomcli_core::{Arg, Command};
    let app = Application::new("columns")
        .description("Fail.")
        .command(
            Command::new("need")
                .description("Need an argument.")
                .argument(
                    "name",
                    Arg::string().description("The required name.").required(),
                )
                .action(|_: Context| async { Ok(()) }),
        )
        .command(
            Command::new("stop")
                .description("Stop.")
                .action(|ctx: Context| async move {
                    Err(ctx.out.fatal(
                        "The configuration file names a profile that this machine does not have.",
                    ))
                }),
        )
        .command(
            Command::new("crash")
                .description("Crash.")
                .action(|_: Context| async {
                    Err(std::io::Error::other("The fixture broke on purpose.").into())
                }),
        );
    for argv in [
        &["need", "--unknown-option-name"][..],
        &["need"],
        &["stop"],
        &["crash"],
        &["missing-command-name"],
    ] {
        for tty in [true, false] {
            let streams = if tty {
                vec![StreamName::Stdout, StreamName::Stderr]
            } else {
                vec![]
            };
            let ran = run_with(
                &app,
                MockFields::new()
                    .argv(argv.iter().copied())
                    .release(distributed())
                    .terminal(MockTerminal::new(20, 24).streams(streams)),
            )
            .await;
            assert_ne!(ran.status, 0);
            let line = ran.stderr.trim_end();
            assert!(line.len() > 20 && !line.contains('\n'), "{line:?}");
        }
    }
}

/// The `failure` scenario's application on a terminal 20 columns wide, or piped, under `overrides`.
async fn narrow_failure(argv: &str, tty: bool, overrides: Vec<loomcli_core::ViewOverride>) -> Ran {
    use loomcli_core::{Command, InputError};
    let path = "/Users/a/Application Support/x.json";
    let app = Application::new("columns")
        .description("Fail.")
        .overrides(overrides)
        .command(
            Command::new("stop")
                .description("Stop.")
                .action(|ctx: Context| async move {
                    Err(ctx.out.fatal(
                        "The configuration file names a profile that this machine does not have.",
                    ))
                }),
        )
        // A path inside nowrap, in an InputError's message and in a FatalError's message.
        .command(Command::new("reject").description("Reject.").action(
            move |_: Context| async move {
                Err(InputError::new(
                    format!(
                        "Option \"--config\": File \"{}\" cannot be read.",
                        nowrap(path)
                    ),
                    Vec::new(),
                )
                .into())
            },
        ))
        .command(Command::new("refuse").description("Refuse.").action(
            move |ctx: Context| async move {
                Err(ctx.out.fatal(format!("{} cannot be read.", nowrap(path))))
            },
        ));
    let streams = if tty {
        vec![StreamName::Stdout, StreamName::Stderr]
    } else {
        vec![]
    };
    run_with(
        &app,
        MockFields::new()
            .argv([argv])
            .release(distributed())
            .terminal(MockTerminal::new(20, 24).streams(streams)),
    )
    .await
}

#[tokio::test]
async fn a_nowrap_frame_shows_in_an_input_errors_default_text_and_resolves_in_a_fatal_errors() {
    let framed = |text: &str| text.chars().any(|c| ('\u{e000}'..='\u{e003}').contains(&c));
    for tty in [true, false] {
        for (argv, resolved) in [("reject", false), ("refuse", true)] {
            let ran = narrow_failure(argv, tty, Vec::new()).await;
            assert!(
                ran.stderr.contains("/Users/a/Application Support/x.json"),
                "{argv}: {:?}",
                ran.stderr
            );
            assert_eq!(framed(&ran.stderr), !resolved, "{argv}: {:?}", ran.stderr);
            assert_eq!(
                ran.stderr.contains("[\"nowrap\"]"),
                !resolved,
                "{argv}: {:?}",
                ran.stderr
            );
        }
    }
}

#[tokio::test]
async fn a_failure_view_override_receives_the_columns_and_wraps_its_own_text() {
    use loomcli_core::FailureFacts;
    let wrapping = override_view(
        failure::<FatalError>(),
        FailureView::new(|failure: &FatalError, context: &FailureViewContext| {
            let view = &context.view_context;
            let columns = view
                .columns
                .map_or_else(|| "undefined".to_owned(), |columns| columns.to_string());
            format!("{columns}|{}\n", view.wrap(failure.message(), view.columns))
        }),
    );
    assert_eq!(
        narrow_failure("stop", true, vec![wrapping]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr:
                "20|The configuration\nfile names a profile\nthat this machine\ndoes not have.\n"
                    .to_owned(),
        }
    );
}

// style.test.ts: the run-level cases

/// A run on a Linux console holding stderr alone, under `policy`, of an action that writes through
/// `act`.
async fn styled<F, Fut>(env: &[(&str, &str)], policy: RenderingPolicy, act: F) -> Ran
where
    F: Fn(Out) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = loomcli_core::Outcome> + Send + 'static,
{
    let act = Arc::new(act);
    let app: App = Application::new("styles")
        .rendering(policy)
        .action(move |ctx: Context| {
            let act = Arc::clone(&act);
            async move { act(ctx.out).await }
        });
    let mut env = env.to_vec();
    env.push(("TERM", "linux"));
    run_with(
        &app,
        support::fields(&[], &env)
            .platform("linux")
            .terminal(MockTerminal::new(80, 24).streams([StreamName::Stderr])),
    )
    .await
}

#[tokio::test]
async fn each_run_captures_fresh_capability_facts() {
    let red = || {
        async |out: Out| {
            out.render(
                &style().red().apply("X"),
                &View::new(|value: &String, _: &ViewContext| value.clone()),
            )
            .await
        }
    };
    let forced = styled(&[("FORCE_COLOR", "1")], RenderingPolicy::new(), red()).await;
    let plain = styled(&[("FORCE_COLOR", "")], RenderingPolicy::new(), red()).await;
    assert_eq!(
        format!("{}{}", forced.stdout, plain.stdout),
        "\u{1b}[31mX\u{1b}[39mX"
    );
}

#[tokio::test]
async fn styles_compose_and_restore_the_enclosing_foreground() {
    let ran = styled(
        &[],
        RenderingPolicy::new()
            .color(Switch::Always)
            .modifiers(Switch::Always),
        |out: Out| async move {
            let blue = style().blue().apply("B");
            out.print(&style().red().apply(&format!("A{blue}C"))).await
        },
    )
    .await;
    assert_eq!(ran.stdout, "\u{1b}[31mA\u{1b}[34mB\u{1b}[31mC\u{1b}[39m\n");
}

#[tokio::test]
async fn one_policy_resolves_stdout_and_stderr_separately() {
    let ran = styled(&[], RenderingPolicy::new(), |out: Out| async move {
        out.print(&style().red().apply("plain")).await?;
        out.info(&format!("{}\nnext", style().red().apply("ready")))
            .await
    })
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: "plain\n".to_owned(),
            stderr: "i \u{1b}[31mready\u{1b}[39m\n  next\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_theme_contributes_concrete_chains_and_contextual_names_without_changing_glyph_identity()
{
    let palette = loomcli_core::Plugin::new("palette").theme(
        loomcli_core::ThemeMapping::new()
            .entry("identifier", style().cyan())
            .entry("info", style().green().bold()),
    );
    let app: App = Application::new("styles")
        .plugins([palette])
        .rendering(
            RenderingPolicy::new()
                .color(Switch::Always)
                .modifiers(Switch::Always),
        )
        .action(|ctx: Context| async move {
            ctx.out.info("ready").await?;
            ctx.out
                .print(&ctx.style.token("identifier").apply("custom"))
                .await
        });
    let ran = run_with(
        &app,
        support::fields(&[], &[("FORCE_COLOR", ""), ("TERM", "linux")])
            .platform("linux")
            .terminal(MockTerminal::new(80, 24).streams([StreamName::Stderr])),
    )
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: "\u{1b}[36mcustom\u{1b}[39m\n".to_owned(),
            stderr: "\u{1b}[32;1mi\u{1b}[39;22m ready\n".to_owned(),
        }
    );
}
