//! The plain switch from `plain-switch.test.ts`, through `Application::run`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_core::{Application, Arg, Context, Opt, RegionOptions, RunOptions};
use loomcli_testing::{MockFields, MockTerminal, mock_process};

#[tokio::test]
async fn the_mark_and_accessible_control_both_kinds_of_region() {
    let app = Application::new("notes")
        .global_option("plain", Opt::boolean().plain().aliases(["accessible"]))
        .argument("words", Arg::string().variadic())
        .action(|ctx: Context| async move {
            let plain = ctx.option::<bool>("plain")?;
            let output_live = ctx.out.region(RegionOptions::new()).live();
            let input_live = ctx.out.region(RegionOptions::new().input()).live();
            ctx.out
                .print(&format!("{output_live} {input_live} {plain}"))
                .await
        });
    for (argv, accessible, live, plain) in [
        (&[][..], None, true, false),
        (&["--plain"][..], None, false, true),
        (&["--accessible"][..], None, false, true),
        (&["word", "--plain"][..], None, false, true),
        (&["--", "--plain"][..], None, true, false),
        (&[][..], Some("1"), false, false),
        (&[][..], Some("0"), false, false),
        (&[][..], Some("false"), false, false),
        (&[][..], Some(""), true, false),
    ] {
        let mut mock = MockFields::new()
            .argv(argv.iter().copied())
            .env("TERM", "xterm-256color")
            .terminal(MockTerminal::new(40, 24));
        if let Some(accessible) = accessible {
            mock = mock.env("ACCESSIBLE", accessible);
        }
        let mock = mock_process(mock);
        let code = app.run(RunOptions::new().process(mock.clone())).await;
        assert_eq!(code.get(), 0, "{argv:?} {accessible:?}");
        assert_eq!(
            mock.stdout_text(),
            format!("{live} {live} {plain}\n"),
            "{argv:?} {accessible:?}"
        );
    }
}

#[tokio::test]
async fn accessible_works_without_a_mark() {
    let app = Application::new("notes").action(|ctx: Context| async move {
        let live = ctx.out.region(RegionOptions::new()).live();
        ctx.out.print(&live.to_string()).await
    });
    for (accessible, live) in [("", "true\n"), ("1", "false\n")] {
        let mock = mock_process(
            MockFields::new()
                .env("ACCESSIBLE", accessible)
                .terminal(MockTerminal::new(40, 24)),
        );
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stdout_text(), live);
    }
}

#[tokio::test]
async fn the_boolean_parser_still_rejects_an_attached_value_and_repetition() {
    let app = Application::new("notes")
        .global_option("plain", Opt::boolean().plain())
        .action(|_: Context| async { panic!("parsing must reject the invocation") });
    for (argv, message) in [
        (
            &["--plain=yes"][..],
            "Boolean option \"--plain\" does not accept a value. Supply the flag alone.",
        ),
        (
            &["--plain", "--plain"][..],
            "Option \"--plain\" can be supplied only once. Remove the repeated option.",
        ),
    ] {
        let mock = mock_process(MockFields::new().argv(argv.iter().copied()));
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            2
        );
        assert_eq!(mock.stderr_text(), format!("notes: {message}\n"));
    }
}

#[tokio::test]
async fn an_input_region_waits_for_its_turn_on_a_terminal_even_with_the_switch_on() {
    use loomcli_core::{EndState, View, ViewContext};

    let app = Application::new("notes").action(|ctx: Context| async move {
        let first = ctx.out.region(RegionOptions::new().input());
        let second = ctx.out.region(RegionOptions::new().input());
        let view = View::new(|_: &str, _: &ViewContext| -> String {
            panic!("a plain region calls no view")
        });
        first.draw("first", &view).await?;
        let pending = second.draw("second", &view);
        let mut pending = std::pin::pin!(pending);
        std::future::poll_fn(|cx| {
            assert!(pending.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        first.end(EndState::Ended, None).await?;
        pending.await?;
        second.end(EndState::Ended, None).await
    });
    let mock = mock_process(
        MockFields::new()
            .env("ACCESSIBLE", "1")
            .terminal(MockTerminal::new(40, 24)),
    );
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "");
}

#[tokio::test]
async fn an_input_region_off_the_terminal_opens_at_once() {
    use loomcli_core::{View, ViewContext};

    let app = Application::new("notes").action(|ctx: Context| async move {
        let _first = ctx.out.region(RegionOptions::new().input());
        let second = ctx.out.region(RegionOptions::new().input());
        second
            .draw(
                "second",
                &View::new(|_: &str, _: &ViewContext| -> String {
                    panic!("a piped region calls no view")
                }),
            )
            .await?;
        ctx.out.info("done").await
    });
    let mock = mock_process(MockFields::new().env("ACCESSIBLE", "1"));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "ℹ done\n");
}

#[tokio::test]
async fn plain_draw_keeps_controls_only_under_the_preserve_policy() {
    use loomcli_core::{RenderingPolicy, TerminalControls, View, ViewContext};
    for (policy, expected) in [
        (RenderingPolicy::new(), "up"),
        (
            RenderingPolicy::new().terminal_controls(TerminalControls::Preserve),
            "\u{1b}[1Aup",
        ),
    ] {
        let app = Application::new("notes")
            .rendering(policy)
            .action(|ctx: Context| async move {
                ctx.out
                    .draw(
                        &(),
                        &View::new(|_: &(), _: &ViewContext| "\u{1b}[1Aup".to_owned()),
                    )
                    .await?;
                Ok(())
            });
        let mock = mock_process(
            MockFields::new()
                .env("ACCESSIBLE", "1")
                .terminal(MockTerminal::new(40, 24)),
        );
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stderr_text(), expected);
    }
}

#[tokio::test]
async fn plain_shutdown_shows_the_cursor_only_under_the_preserve_policy() {
    use loomcli_core::{ProcessSignal, RenderingPolicy, TerminalControls};
    use loomcli_testing::StreamName;
    for (policy, expected) in [
        (RenderingPolicy::new(), "ℹ working\n"),
        (
            RenderingPolicy::new().terminal_controls(TerminalControls::Preserve),
            "ℹ working\n\u{1b}[?25h",
        ),
    ] {
        let ready = std::sync::Arc::new(tokio::sync::Notify::new());
        let app = Application::new("notes").rendering(policy).action({
            let ready = ready.clone();
            move |ctx: Context| {
                let ready = ready.clone();
                async move {
                    ctx.out.info("working").await?;
                    ready.notify_one();
                    ctx.signal.token().cancelled().await;
                    Ok(())
                }
            }
        });
        let mock = mock_process(
            MockFields::new()
                .env("ACCESSIBLE", "1")
                .terminal(MockTerminal::new(40, 24).streams([StreamName::Stderr])),
        );
        let running = app.run(RunOptions::new().process(mock.clone()));
        let (code, ()) = tokio::join!(running, async {
            ready.notified().await;
            mock.raise(ProcessSignal::Int);
        });
        assert_eq!(code.get(), 130);
        for _ in 0..4 {
            tokio::task::yield_now().await;
        }
        assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
        assert_eq!(mock.stderr_text(), expected);
    }
}

#[tokio::test]
async fn plain_preserves_verbosity_and_the_interaction_decision() {
    use loomcli_core::Polarity;
    let app = Application::new("notes")
        .global_option("plain", Opt::boolean().plain())
        .global_option("quiet", Opt::count().quiet().short('q'))
        .global_option(
            "input",
            Opt::boolean().interaction().polarity(Polarity::Negative),
        )
        .action(|ctx: Context| async move {
            ctx.out.info("info").await?;
            ctx.out.warn("shown").await?;
            ctx.out.print(&ctx.interactive.to_string()).await
        });
    for (argv, interactive, stderr) in [
        (&["--plain"][..], "true\n", "ℹ info\n⚠ shown\n"),
        (
            &["--plain", "--no-input"][..],
            "false\n",
            "ℹ info\n⚠ shown\n",
        ),
        (&["--plain", "-q"][..], "true\n", "⚠ shown\n"),
    ] {
        let mock = mock_process(
            MockFields::new()
                .argv(argv.iter().copied())
                .terminal(MockTerminal::new(40, 24).keys(Vec::<&str>::new())),
        );
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stdout_text(), interactive);
        assert_eq!(mock.stderr_text(), stderr);
    }
}

#[tokio::test]
async fn plain_keeps_the_color_decision() {
    use loomcli_testing::StreamName;
    let app = Application::new("notes")
        .global_option("plain", Opt::boolean().plain())
        .action(|ctx: Context| async move { ctx.out.print(&ctx.style.red().apply("shown")).await });
    for (name, expected) in [
        ("NO_COLOR", "shown\n"),
        ("FORCE_COLOR", "\u{1b}[31mshown\u{1b}[39m\n"),
    ] {
        let mock = mock_process(
            MockFields::new()
                .argv(["--plain"])
                .env("TERM", "xterm-256color")
                .env("COLORTERM", "truecolor")
                .env(name, "1")
                .terminal(MockTerminal::new(40, 24).streams([StreamName::Stdout])),
        );
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stdout_text(), expected);
    }
}

#[test]
fn a_second_plain_mark_fails_and_inspection_identifies_the_one_mark() {
    let fault = std::panic::catch_unwind(|| {
        Application::new("notes")
            .global_option("plain", Opt::boolean().plain())
            .global_option("accessible", Opt::boolean().plain())
    })
    .err()
    .expect("two plain marks are a declaration fault");
    let fault = fault.downcast::<String>().unwrap();
    assert!(fault.contains("@loomcli/core/plain-mark"), "{fault}");
    assert!(fault.contains("both declare plain"), "{fault}");
    let app = Application::new("notes")
        .global_option("plain", Opt::boolean().plain())
        .global_option("quiet", Opt::boolean())
        .action(|_: Context| async { Ok(()) });
    let graph = app.inspect().unwrap();
    for (node, marked) in graph.globals.iter().zip([true, false]) {
        let node = serde_json::to_value(node).unwrap();
        assert_eq!(node["plain"], marked);
    }
}
