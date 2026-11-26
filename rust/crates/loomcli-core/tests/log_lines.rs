//! The reference log-line contract through argv and invocation by name.

#![allow(clippy::unwrap_used)]

use loomcli_core::{
    Application, Command, Context, InvocationOutcome, InvocationValues, InvokeOptions, LogFields,
    Opt, RunOptions,
};
use loomcli_testing::{MockFields, mock_process};
use serde_json::json;

async fn index(ctx: Context) -> loomcli_core::Outcome {
    ctx.log
        .trace("Looked in {dir}.", LogFields::new().field("dir", "/etc"));
    ctx.log.debug(
        "Read {file} in {ms} ms.",
        LogFields::new()
            .field("count", 3)
            .field("extra", "x y")
            .field("file", "/srv/a b.json")
            .field("ms", 12),
    );
    ctx.log.info(
        "Indexed {{sessions}} for {harness} {missing}.",
        LogFields::new()
            .field("harness", "claude")
            .field("when", "now"),
    );
    ctx.log.warn(
        "Skipped a line.",
        LogFields::new()
            .field("line", "a\u{0007}b")
            .field("note", ""),
    );
    ctx.log.error(
        "Gave up.",
        LogFields::new()
            .field("cause", json!({"code":"E"}))
            .field("tries", [1, 2]),
    );
    ctx.out.warn("warned").await
}

const TRACE: &str = "  ┆ Looked in /etc.\n";
const LINES: &str = concat!(
    "› Read /srv/a b.json in 12 ms. count=3 extra=\"x y\"\n",
    "› Indexed {sessions} for claude {missing}. when=now\n",
    "› Skipped a line. line=a\\u0007b note=\"\"\n",
    "› Gave up. cause={\"code\":\"E\"} tries=[1,2]\n",
);

#[tokio::test]
async fn verbosity_shows_template_lines_with_or_without_a_hook() {
    for hook in [false, true] {
        for (flag, expected) in [
            (None, String::new()),
            (Some("-q"), String::new()),
            (Some("-v"), LINES.to_owned()),
            (Some("-vv"), format!("{TRACE}{LINES}")),
        ] {
            let app = Application::new("notes")
                .global_option("verbose", Opt::count().short('v').verbose())
                .global_option("quiet", Opt::count().short('q').quiet())
                .action(index);
            let app = if hook {
                loomcli_core::__private::install_log_hook(app, |event, _| {
                    if event.fields.contains_key("file") {
                        assert_eq!(event.message, "Read {file} in {ms} ms.");
                    }
                })
            } else {
                app
            };
            let mock = mock_process(MockFields::new().argv(flag));
            let code = app.run(RunOptions::new().process(mock.clone())).await;
            assert_eq!(code.get(), 0);
            assert_eq!(mock.stdout_text(), "");
            assert_eq!(
                mock.stderr_text(),
                format!("{expected}⚠ warned\n"),
                "{flag:?}, {hook}"
            );
        }
    }
}

#[tokio::test]
async fn named_lines_follow_the_outermost_run() {
    let app = Application::new("notes")
        .global_option("verbose", Opt::count().short('v').verbose())
        .command(Command::new("index").action(index))
        .command(Command::new("nested").action(|ctx: Context| async move {
            let outcome = ctx
                .invoke(&["index"], InvocationValues::new(), InvokeOptions::new())
                .await;
            if let InvocationOutcome::Completed { messages, .. } = outcome {
                ctx.out.print(&messages).await?;
            }
            Ok(())
        }));
    let mock = mock_process(MockFields::new().argv(["-v", "nested"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stdout_text(), "⚠ warned\n");
    assert_eq!(mock.stderr_text(), LINES);

    let outcome = app
        .invoke(
            &["index"],
            InvocationValues::new().option("verbose", 2),
            InvokeOptions::new(),
            Some(mock),
        )
        .await;
    assert!(
        matches!(outcome, InvocationOutcome::Completed { messages, .. }
        if messages == format!("{TRACE}{LINES}⚠ warned\n"))
    );
}

#[tokio::test]
async fn ready_log_line_and_hook_write_reach_the_pipe_inside_the_call() {
    use loomcli_core::Plugin;

    let mock = mock_process(MockFields::new().argv(["-v"]));
    let app = Application::new("notes")
        .plugins([Plugin::new("fixture/probe").on_log(|_, destination| {
            if let Some(stderr) = &destination.stderr {
                let mut write = stderr.write(b"record\n");
                let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
                assert!(write.as_mut().poll(&mut cx).is_ready());
            }
        })])
        .global_option("verbose", Opt::count().short('v').verbose())
        .action({
            let mock = mock.clone();
            move |ctx: Context| {
                ctx.log.debug("Line.", ());
                assert_eq!(mock.stderr_text(), "› Line.\nrecord\n");
                for _ in 1..1_000 {
                    ctx.log.debug("Line.", ());
                }
                assert_eq!(mock.stderr_text(), "› Line.\nrecord\n".repeat(1_000));
                async { Ok(()) }
            }
        });
    assert_eq!(app.run(RunOptions::new().process(mock)).await.get(), 0);
}

#[tokio::test]
async fn a_failure_reaches_the_hook_without_a_duplicate_log_line() {
    let heard = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let app = loomcli_core::__private::install_log_hook(
        Application::new("notes")
            .global_option("verbose", Opt::count().short('v').verbose())
            .action(|ctx: Context| async move {
                ctx.log
                    .debug("Before {step}.", LogFields::new().field("step", "fail"));
                Err(ctx.out.fatal("It failed."))
            }),
        {
            let heard = heard.clone();
            move |event, _| heard.lock().unwrap().push(event.clone())
        },
    );
    let mock = mock_process(MockFields::new().argv(["-vv"]));
    let code = app.run(RunOptions::new().process(mock.clone())).await;
    assert_eq!(code.get(), 1);
    assert_eq!(
        mock.stderr_text()
            .lines()
            .filter(|line| line.starts_with('›'))
            .collect::<Vec<_>>(),
        ["› Before fail."]
    );
    let heard = heard.lock().unwrap();
    assert_eq!(heard[0].message, "Before {step}.");
    assert_eq!(heard[1].message, "It failed.");
    assert!(heard[1].failure.is_some());
}

#[tokio::test]
async fn error_text_escapes_controls_and_omits_stack_and_cause_in_both_positions() {
    let heard = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let value = json!({
        "name": "Error",
        "message": "bad\n[red]value",
        "cause": {"name": "Error", "message": "hidden cause"},
        "stack": "hidden stack",
    });
    let app = loomcli_core::__private::install_log_hook(
        Application::new("notes")
            .global_option("verbose", Opt::count().short('v').verbose())
            .action({
                let value = value.clone();
                move |ctx: Context| {
                    let fields = LogFields::new().field("error", &value);
                    ctx.log.debug("Placed {error}.", fields.clone());
                    ctx.log.debug("Trailing.", fields);
                    async { Ok(()) }
                }
            }),
        {
            let heard = heard.clone();
            move |event, _| heard.lock().unwrap().push(event.clone())
        },
    );
    let mock = mock_process(MockFields::new().argv(["-v"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        concat!(
            "› Placed Error: bad\\u000a[red]value.\n",
            "› Trailing. error=Error: bad\\u000a[red]value\n"
        )
    );
    assert_eq!(heard.lock().unwrap()[0].fields["error"], value);
}

#[tokio::test]
async fn placed_sentences_wrap_under_the_gutter() {
    use loomcli_testing::MockTerminal;

    let app = Application::new("notes")
        .global_option("verbose", Opt::count().short('v').verbose())
        .action(|ctx: Context| async move {
            ctx.log.debug(
                "Ignored {key}: {issue}",
                LogFields::new()
                    .field("key", "port")
                    .field("issue", "Choose a number between one and ten."),
            );
            Ok(())
        });
    let mock = mock_process(
        MockFields::new()
            .argv(["-v"])
            .env("NO_COLOR", "1")
            .terminal(MockTerminal::new(24, 24)),
    );
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        "› Ignored port: Choose a\n  number between one and\n  ten.\n"
    );
}

#[tokio::test]
async fn log_line_override_reads_the_same_event_and_can_drop_its_line() {
    use loomcli_core::{LogLine, View, log_line, override_view};

    let view = override_view(
        log_line(),
        View::new(|line: &LogLine, _| {
            assert_eq!(line.event.message, "Read {key}.");
            assert_eq!(line.fields[0].value, "[Redacted]");
            assert_eq!(line.text, format!("Read {}.", loomcli_core::nowrap("port")));
            String::new()
        }),
    );
    let app = Application::new("notes")
        .global_option("verbose", Opt::count().short('v').verbose())
        .log_redact(&["token"])
        .overrides([view])
        .action(|ctx: Context| async move {
            ctx.log.debug(
                "Read {key}.",
                LogFields::new()
                    .field("key", "port")
                    .field("token", "private"),
            );
            Ok(())
        });
    let mock = mock_process(MockFields::new().argv(["-v"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "");
}

#[tokio::test]
async fn debug_dims_its_glyph_and_fields_and_trace_fades_the_whole_line() {
    use loomcli_core::style::{Ansi16Color, Ansi256Fallbacks};
    use loomcli_core::{Plugin, ThemeMapping, style};
    use loomcli_testing::MockTerminal;

    let dim = style().ansi256_with(8, Ansi256Fallbacks::new().ansi16(Ansi16Color::BrightBlack));
    let app = Application::new("notes")
        .plugins([Plugin::new("fixture/theme").theme(ThemeMapping::new().entry("dim", dim))])
        .global_option("verbose", Opt::count().short('v').verbose())
        .action(index);
    let mock = mock_process(
        MockFields::new()
            .argv(["-vv"])
            .env("TERM", "xterm")
            .terminal(MockTerminal::new(80, 24)),
    );
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    let text = mock.stderr_text();
    let mut lines = text.lines();
    assert_eq!(
        lines.next(),
        Some("  \u{1b}[90;2m┆\u{1b}[39;22m \u{1b}[90;2mLooked in /etc.\u{1b}[39;22m")
    );
    assert_eq!(
        lines.next(),
        Some(
            "\u{1b}[90m›\u{1b}[39m Read /srv/a b.json in 12 ms. \u{1b}[90mcount=3 extra=\"x y\"\u{1b}[39m"
        )
    );
}

#[tokio::test]
async fn log_view_errors_are_reported_after_the_action_failure_in_order() {
    use loomcli_core::{FatalError, InputError, LogLine, View, log_line, override_view};

    let app = Application::new("notes")
        .global_option("verbose", Opt::count().short('v').verbose())
        .overrides([override_view(
            log_line(),
            View::new(|line: &LogLine, _| -> Result<String, FatalError> {
                Err(FatalError::new(&line.event.message))
            }),
        )])
        .action(|ctx: Context| async move {
            ctx.log.info("First view failure.", ());
            ctx.log.info("Second view failure.", ());
            Err(InputError::new("The action failed.", Vec::new()).into())
        });
    let mock = mock_process(MockFields::new().argv(["-v"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        2
    );
    let output = mock.stderr_text();
    let action = output.find("The action failed.").unwrap();
    let first = output.find("First view failure.").unwrap();
    let second = output.find("Second view failure.").unwrap();
    assert!(action < first && first < second, "{output}");
}
