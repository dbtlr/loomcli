//! Streamed semantic messages through the public output surface.

#![allow(clippy::panic)]

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::task::Poll;

use loomcli_core::{Application, Context, Error, FailureFacts, RunOptions, StreamedMessage};
use loomcli_testing::{MockFields, mock_process};

#[tokio::test]
async fn the_run_waits_for_a_message_whose_completion_future_is_dropped() {
    let mock = mock_process(MockFields::new());
    let read = Arc::new(AtomicBool::new(false));
    let source_read = Arc::clone(&read);
    let app = Application::new("streamed").action(move |ctx: Context| {
        let read = Arc::clone(&source_read);
        async move {
            let mut parts = ["first\nsec", "ond"].into_iter();
            let source = PollStream(move |_: &mut std::task::Context<'_>| {
                read.store(true, Ordering::SeqCst);
                Poll::Ready(parts.next().map(|text| Ok(text.to_owned())))
            });
            drop(ctx.out.print(StreamedMessage::new(source)));
            Ok(())
        }
    });

    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert!(read.load(Ordering::SeqCst));
    assert_eq!(mock.stdout_text(), "first\nsecond\n");
}

#[tokio::test]
async fn an_unobserved_source_error_fails_after_the_received_text() {
    let mock = mock_process(MockFields::new());
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let mut parts = [
            Ok("partial".to_owned()),
            Err(ctx.out.fatal("The service hung up.")),
        ]
        .into_iter();
        let source = PollStream(move |_: &mut std::task::Context<'_>| Poll::Ready(parts.next()));
        drop(ctx.out.print(StreamedMessage::new(source)));
        Ok(())
    });

    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        1
    );
    assert_eq!(mock.stdout_text(), "partial\n");
    assert!(mock.stderr_text().contains("The service hung up."));
}

#[tokio::test]
async fn a_terminal_print_grows_at_the_cursor_before_the_next_chunk() {
    use loomcli_testing::{MockTerminal, StreamName};

    let mock = mock_process(
        MockFields::new().terminal(MockTerminal::new(40, 12).streams([StreamName::Stdout])),
    );
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let mut step = 0;
            let source = PollStream(move |_: &mut std::task::Context<'_>| {
                step += 1;
                Poll::Ready(match step {
                    1 => Some(Ok("one".to_owned())),
                    2 => {
                        assert_eq!(process.stdout_text(), "one");
                        Some(Ok(" two".to_owned()))
                    }
                    _ => None,
                })
            });
            ctx.out.print(StreamedMessage::new(source)).await
        }
    });

    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stdout_text(), "one two\n");
}

mod support;

use loomcli_core::{
    EndState, Opt, RegionOptions, RenderingPolicy, Switch, View, ViewContext, lanes, override_view,
    style,
};
use loomcli_testing::{MockTerminal, StreamName, Write};
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use support::screen::replay;
use support::streaming::{Destination, LANES, Lane, PollStream, bytes, chunks as message};

type Step = Pin<Box<dyn Future<Output = Result<String, Error>> + Send>>;

fn steps(parts: impl IntoIterator<Item = Step>) -> StreamedMessage {
    let mut parts: VecDeque<_> = parts.into_iter().collect();
    StreamedMessage::new(PollStream(move |cx: &mut std::task::Context<'_>| {
        let Some(next) = parts.front_mut() else {
            return Poll::Ready(None);
        };
        let result = std::task::ready!(next.as_mut().poll(cx));
        parts.pop_front();
        Poll::Ready(Some(result))
    }))
}

fn step(text: &'static str) -> Step {
    Box::pin(async move { Ok(text.to_owned()) })
}

#[tokio::test]
async fn all_five_lanes_use_the_joined_text_and_their_existing_level() {
    let destination = Destination {
        columns: None,
        term: "xterm-256color",
        policy: RenderingPolicy::new()
            .color(Switch::Always)
            .modifiers(Switch::Always),
    };
    for lane in LANES {
        for parts in [
            vec![
                "Fetched the ",
                "first page.\nThen the sec",
                "ond",
                " page.\n",
                "\nDone",
            ],
            vec!["a\r", "\nb\n", "\nc"],
            vec!["one\n", "two\n"],
            vec![],
        ] {
            let parts = parts.into_iter().map(str::to_owned).collect::<Vec<_>>();
            let streamed = destination.writes(lane, parts.clone(), true, false).await;
            let whole = destination.writes(lane, parts, false, false).await;
            assert_eq!(bytes(&streamed), bytes(&whole), "{lane:?}");
        }
    }
}

#[tokio::test]
async fn an_off_terminal_style_stays_open_across_completed_writes() {
    let destination = Destination {
        columns: None,
        term: "xterm",
        policy: RenderingPolicy::new().modifiers(Switch::Always),
    };
    let writes = destination
        .writes(
            Lane::Print,
            vec![style().bold().apply("a\nb"), "c\nd".to_owned()],
            true,
            false,
        )
        .await;
    assert_eq!(
        writes,
        [
            Write::Stdout("\x1b[1ma\n".to_owned()),
            Write::Stdout("b\x1b[22mc\n".to_owned()),
            Write::Stdout("d\n".to_owned()),
        ]
    );
}

#[tokio::test]
async fn a_print_in_the_action_on_a_result_command_moves_to_stderr() {
    use loomcli_core::ResultViews;
    let mock = mock_process(MockFields::new());
    let app = Application::new("streamed")
        .result(
            ResultViews::new().view("text", View::new(|value: &String, _| format!("{value}\n"))),
        )
        .action(|ctx| async move {
            ctx.out.print(message(["no", "te"])).await?;
            ctx.out.results("value".to_owned()).await
        });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stdout_text(), "value\n");
    assert_eq!(mock.stderr_text(), "note\n");
}

#[tokio::test]
async fn a_write_during_a_piped_message_lands_between_its_lines() {
    let mock = mock_process(MockFields::new());
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let out = ctx.out.clone();
        ctx.out
            .print(steps([
                step("one\ntw"),
                Box::pin(async move {
                    out.print("between").await?;
                    Ok("o\nth".to_owned())
                }),
                step("ree"),
            ]))
            .await
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stdout_text(), "one\nbetween\ntwo\nthree\n");
}

#[tokio::test]
async fn hidden_messages_read_to_end_and_return_a_sources_error() {
    for fails in [false, true] {
        let observed = Arc::new(AtomicBool::new(false));
        let read = observed.clone();
        let app = Application::new("streamed")
            .global_option("quiet", Opt::count().short('q').quiet())
            .action(move |ctx: Context| {
                let read = read.clone();
                async move {
                    let source = steps([
                        step("hidden\npartial"),
                        Box::pin(async move {
                            read.store(true, Ordering::SeqCst);
                            if fails {
                                Err(loomcli_core::FatalError::new("hidden source").into())
                            } else {
                                Ok(" end".to_owned())
                            }
                        }),
                    ]);
                    let done = ctx.out.info(source).await;
                    assert_eq!(done.is_err(), fails);
                    Ok(())
                }
            });
        let mock = mock_process(MockFields::new().argv(["-q"]));
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert!(observed.load(Ordering::SeqCst));
        assert_eq!(mock.stderr_text(), "");
    }
}

#[tokio::test]
async fn a_caught_source_error_writes_the_last_line_without_a_marker() {
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let source = steps([
            step("first\nsec"),
            step("ond"),
            Box::pin(async { Err(loomcli_core::FatalError::new("The service hung up.").into()) }),
        ]);
        let error = ctx.out.warn(source).await.err();
        assert_eq!(
            error
                .as_ref()
                .and_then(Error::failure)
                .map(|failure| failure.message()),
            Some("The service hung up.")
        );
        Ok(())
    });
    let mock = mock_process(MockFields::new());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "⚠ first\n  second\n");
}

struct Dropped(Arc<AtomicBool>);

impl Drop for Dropped {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn stalled(
    text: &'static str,
    waiting: Arc<tokio::sync::Notify>,
    dropped: Arc<AtomicBool>,
) -> StreamedMessage {
    let mut first = Some(text);
    let dropped = Dropped(dropped);
    StreamedMessage::new(PollStream(move |_: &mut std::task::Context<'_>| {
        let _keep = &dropped;
        if let Some(text) = first.take() {
            Poll::Ready(Some(Ok(text.to_owned())))
        } else {
            waiting.notify_one();
            Poll::Pending
        }
    }))
}

fn terminal() -> Arc<loomcli_testing::MockProcess> {
    mock_process(
        MockFields::new()
            .terminal(MockTerminal::new(40, 24).streams([StreamName::Stdout, StreamName::Stderr])),
    )
}

fn panicking_source() -> StreamedMessage {
    steps([
        step("partial"),
        Box::pin(async { panic!("The source panicked.") }),
    ])
}

fn assert_panic<T>(result: Result<T, tokio::task::JoinError>, message: &str) {
    let payload = result.err().filter(tokio::task::JoinError::is_panic);
    assert_eq!(
        payload
            .map(tokio::task::JoinError::into_panic)
            .as_ref()
            .and_then(|payload| payload.downcast_ref::<&str>())
            .copied(),
        Some(message),
    );
}

#[tokio::test]
async fn an_awaited_source_panic_closes_its_terminal_row_before_unwinding_in_the_caller() {
    let mock = terminal();
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let out = ctx.out.clone();
        assert_panic(
            tokio::spawn(async move { out.info(panicking_source()).await }).await,
            "The source panicked.",
        );
        ctx.out.warn("after").await?;
        ctx.out.print("after2").await
    });

    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "ℹ partial\r\x1b[Jℹ partial\n⚠ after\n");
    assert_eq!(mock.stdout_text(), "after2\n");
}

#[tokio::test]
async fn a_source_panic_ends_its_print_line_before_releasing_the_terminal() {
    let mock = terminal();
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let ready = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let source_ready = ready.clone();
        let source_release = release.clone();
        let out = ctx.out.clone();
        let completion = tokio::spawn(async move {
            out.print(steps([
                step("partial"),
                Box::pin(async move {
                    source_ready.notify_one();
                    source_release.notified().await;
                    panic!("The source panicked.");
                }),
            ]))
            .await
        });
        ready.notified().await;
        let mut warning = std::pin::pin!(ctx.out.warn("after"));
        let mut print = std::pin::pin!(ctx.out.print("after2"));
        std::future::poll_fn(|cx| {
            assert!(warning.as_mut().poll(cx).is_pending());
            assert!(print.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        release.notify_one();
        let (joined, warning, print) = tokio::join!(completion, warning, print);
        assert_panic(joined, "The source panicked.");
        warning?;
        print
    });

    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.transcript(),
        [
            Write::Stdout("partial".to_owned()),
            Write::Stdout("\n".to_owned()),
            Write::Stderr("⚠ after\n".to_owned()),
            Write::Stdout("after2\n".to_owned()),
        ],
    );
}

#[tokio::test]
async fn an_unawaited_source_panic_flushes_its_piped_line_before_unwinding_in_the_run() {
    let mock = mock_process(MockFields::new());
    let process = mock.clone();
    let app = Application::new("streamed").action(|ctx: Context| async move {
        drop(ctx.out.print(panicking_source()));
        Ok(())
    });

    assert_panic(
        tokio::spawn(async move { app.run(RunOptions::new().process(process)).await }).await,
        "The source panicked.",
    );
    assert_eq!(mock.stdout_text(), "partial\n");
    assert_eq!(mock.stderr_text(), "");
}

#[tokio::test]
async fn a_lane_view_panic_finishes_the_previous_layout_and_unwinds_in_the_run() {
    let mock = terminal();
    let process = mock.clone();
    let view = View::new(|text: &str, _| {
        if text == "partial more" {
            panic!("The lane view panicked.");
        }
        text.to_owned()
    });
    let app = Application::new("streamed")
        .overrides([override_view(lanes::info(), view)])
        .action(|ctx: Context| async move { ctx.out.info(message(["partial", " more"])).await });

    assert_panic(
        tokio::spawn(async move { app.run(RunOptions::new().process(process)).await }).await,
        "The lane view panicked.",
    );
    assert_eq!(mock.stderr_text(), "partial\r\x1b[Jpartial\n");
    assert_eq!(mock.stdout_text(), "");
}

#[tokio::test]
async fn the_action_failure_ends_its_held_print_line_before_the_failure_report() {
    for terminal_output in [false, true] {
        let dropped = Arc::new(AtomicBool::new(false));
        let drop_observed = dropped.clone();
        let app = Application::new("streamed").action(move |ctx: Context| {
            let dropped = drop_observed.clone();
            async move {
                let ready = Arc::new(tokio::sync::Notify::new());
                drop(
                    ctx.out
                        .print(stalled("Partial answer", ready.clone(), dropped)),
                );
                ready.notified().await;
                Err(ctx.out.fatal("No more results."))
            }
        });
        let mock = if terminal_output {
            terminal()
        } else {
            mock_process(MockFields::new())
        };
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            1
        );
        assert!(dropped.load(Ordering::SeqCst));
        let all = bytes(&mock.transcript());
        assert!(all.starts_with("Partial answer\n"), "{all:?}");
        assert!(all.contains("No more results."));
    }
}

#[tokio::test]
async fn cancellation_finishes_every_message_and_drops_each_source() {
    let dropped_first = Arc::new(AtomicBool::new(false));
    let dropped_second = Arc::new(AtomicBool::new(false));
    let drop_observed = (dropped_first.clone(), dropped_second.clone());
    let app = Application::new("streamed").action(move |ctx: Context| {
        let observed = drop_observed.clone();
        async move {
            let first = Arc::new(tokio::sync::Notify::new());
            let second = Arc::new(tokio::sync::Notify::new());
            let one = ctx.out.print(stalled("first", first.clone(), observed.0));
            let two = ctx.out.info(stalled("second", second.clone(), observed.1));
            first.notified().await;
            second.notified().await;
            ctx.cancel();
            one.await?;
            two.await
        }
    });
    let mock = mock_process(MockFields::new());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        130
    );
    assert!(dropped_first.load(Ordering::SeqCst));
    assert!(dropped_second.load(Ordering::SeqCst));
    assert_eq!(mock.stdout_text(), "first\n");
    assert_eq!(mock.stderr_text(), "ℹ second\n");
}

#[tokio::test]
async fn messages_started_after_abort_stop_without_reading_even_when_hidden() {
    let app = Application::new("streamed")
        .global_option("quiet", Opt::count().short('q').quiet())
        .action(|ctx: Context| async move {
            ctx.cancel();
            let source = || {
                StreamedMessage::new(PollStream(|_: &mut std::task::Context<'_>| {
                    Poll::Ready(Some(Err(loomcli_core::FatalError::new(
                        "polled after abort",
                    )
                    .into())))
                }))
            };
            ctx.out.info(source()).await?;
            ctx.out.print(source()).await
        });
    let mock = mock_process(MockFields::new().argv(["-q"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        130
    );
    assert_eq!(mock.stdout_text(), "\n");
    assert_eq!(mock.stderr_text(), "");
}

#[tokio::test]
async fn a_wrapping_lane_draws_above_the_input_region_and_moves_finished_rows_to_scrollback() {
    let mock = terminal();
    let process = mock.clone();
    let snapshots = Arc::new(Mutex::new(Vec::new()));
    let observed = snapshots.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        let observed = observed.clone();
        async move {
            let question = ctx.out.region(RegionOptions::new().input());
            question
                .draw("Continue?", &View::new(|text: &str, _| text.to_owned()))
                .await?;
            let out = ctx.out.clone();
            ctx.out
                .info(steps([
                    step("first row\nlast"),
                    Box::pin(async move {
                        observed
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .push(replay(&process.transcript(), 40, true).lines);
                        out.warn("between rows").await?;
                        question.end(EndState::Ended, None).await?;
                        Ok(" row".to_owned())
                    }),
                ]))
                .await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        snapshots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_slice(),
        &[vec!["ℹ first row", "  last", "Continue?"]],
    );
    assert_eq!(
        replay(&mock.transcript(), 40, true).lines,
        ["ℹ first row", "⚠ between rows", "Continue?", "  last row"]
    );
}

#[tokio::test]
async fn a_wrapping_lane_keeps_the_first_layouts_context_and_a_caught_view_error_keeps_its_text() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let layouts = calls.clone();
    let view = View::new(move |text: &str, context: &ViewContext| {
        layouts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((text.to_owned(), context as *const ViewContext as usize));
        if text.ends_with("bad") {
            Err(loomcli_core::FatalError::new("Cannot draw this chunk."))
        } else {
            Ok(text.to_owned())
        }
    });
    let app = Application::new("streamed")
        .overrides([override_view(lanes::info(), view)])
        .action(|ctx: Context| async move {
            let result = ctx.out.info(message(["one\nsec", "ond", "bad"])).await;
            assert!(result.is_err());
            Ok(())
        });
    let mock = terminal();
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        replay(&mock.transcript(), 40, true).lines,
        ["one", "second"]
    );
    let layouts = calls
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    assert_eq!(
        layouts
            .iter()
            .map(|(text, _)| text.as_str())
            .collect::<Vec<_>>(),
        [
            "one\nsec",
            "one\nsecond",
            "one\nsecondbad",
            "one\nsecondbad"
        ]
    );
    assert!(layouts.windows(2).all(|pair| pair[0].1 == pair[1].1));
}

#[tokio::test]
async fn a_chunk_layout_error_finishes_with_the_whole_text_if_the_view_accepts_it() {
    let view = View::new(|text: &str, _| {
        if text == "partial answer" {
            Err(loomcli_core::FatalError::new("The view refused the chunk."))
        } else {
            Ok(format!("view: {text}"))
        }
    });
    let app = Application::new("streamed")
        .overrides([override_view(lanes::info(), view)])
        .action(|ctx: Context| async move {
            let result = ctx.out.info(message(["partial", " answer "])).await;
            assert_eq!(
                result
                    .as_ref()
                    .err()
                    .and_then(Error::failure)
                    .map(FailureFacts::message),
                Some("The view refused the chunk.")
            );
            Ok(())
        });
    let mock = mock_process(MockFields::new());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "view: partial answer \n");
}

#[tokio::test]
async fn an_oversize_unfinished_row_waits_for_its_line_break() {
    let destination = Destination {
        columns: Some(20),
        term: "xterm",
        policy: RenderingPolicy::new(),
    };
    let mock = mock_process(destination.fields());
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            ctx.out
                .info(steps([
                    step("see https://example.com/a/"),
                    Box::pin(async move {
                        assert_eq!(process.stderr_text(), "ℹ see\n");
                        assert_eq!(replay(&process.transcript(), 20, true).lines, ["ℹ see"]);
                        Ok("very/long/path/to/the/page done".to_owned())
                    }),
                ]))
                .await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    let whole = destination
        .writes(
            Lane::Info,
            vec!["see https://example.com/a/very/long/path/to/the/page done".to_owned()],
            false,
            false,
        )
        .await;
    assert_eq!(
        replay(&mock.transcript(), 20, true).lines,
        replay(&whole, 20, true).lines
    );
}

#[tokio::test]
async fn an_oversize_unfinished_row_does_not_redraw_the_region_between_finished_rows() {
    let mock = mock_process(
        MockFields::new()
            .terminal(MockTerminal::new(20, 24).streams([StreamName::Stdout, StreamName::Stderr])),
    );
    let process = mock.clone();
    let snapshot = Arc::new(Mutex::new(String::new()));
    let read = snapshot.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        let read = read.clone();
        async move {
            let region = ctx.out.region(RegionOptions::new());
            region
                .draw("Working", &View::new(|text: &str, _| text.to_owned()))
                .await?;
            ctx.out
                .info(steps([
                    step("see https://example.com/a/"),
                    step("very"),
                    step("/long"),
                    step("/path"),
                    step("/to"),
                    Box::pin(async move {
                        *read
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner) =
                            process.stderr_text();
                        Ok(" done".to_owned())
                    }),
                ]))
                .await?;
            region.end(EndState::Ended, None).await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        *snapshot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        "Working\r\x1b[Jℹ see\nWorking"
    );
}

#[tokio::test]
async fn a_failed_write_drops_its_source_and_makes_no_closing_write() {
    use support::streams::{Scripted, Seen, Swapped};
    let wrote = Arc::new(Mutex::new(Vec::new()));
    let dropped = Arc::new(AtomicBool::new(false));
    let mock = mock_process(MockFields::new());
    let mut handle = Swapped::new(mock.clone());
    let stdout = Scripted::refusing(0, std::io::ErrorKind::BrokenPipe, wrote.clone());
    handle.stdout = Some(stdout);
    let drop_observed = dropped.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let dropped = drop_observed.clone();
        async move {
            let waiting = Arc::new(tokio::sync::Notify::new());
            let result = ctx
                .out
                .print(stalled("first\npartial", waiting, dropped))
                .await;
            assert!(result.is_err());
            Ok(())
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(Arc::new(handle)))
            .await
            .get(),
        141
    );
    assert!(dropped.load(Ordering::SeqCst));
    assert_eq!(
        wrote
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_slice(),
        &[Seen::Refused("first\n".to_owned())]
    );
}

#[tokio::test]
async fn a_closed_pipe_resumes_the_panic_from_its_cancellation_layout() {
    use support::streams::{Scripted, Seen, Swapped};

    let writes = Arc::new(Mutex::new(Vec::new()));
    let mut process = Swapped::new(mock_process(MockFields::new()));
    process.stdout = Some(Scripted::refusing(
        0,
        std::io::ErrorKind::BrokenPipe,
        writes.clone(),
    ));
    let view = View::new(|text: &str, _| {
        if text == "first\npartial " {
            panic!("The view refused the cancellation layout.");
        }
        text.to_owned()
    });
    let app = Application::new("streamed")
        .overrides([override_view(lanes::print(), view)])
        .action(
            |ctx: Context| async move { ctx.out.print(steps([step("first\npartial ")])).await },
        );

    assert_panic(
        tokio::spawn(async move { app.run(RunOptions::new().process(Arc::new(process))).await })
            .await,
        "The view refused the cancellation layout.",
    );
    assert_eq!(
        writes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_slice(),
        &[Seen::Refused("first\n".to_owned())],
    );
}

#[tokio::test]
async fn a_lend_holds_unfinished_rows_and_reclaims_the_terminal_below_the_child() {
    let mock = terminal();
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let out = ctx.out.clone();
            ctx.out
                .info(steps([
                    step("one"),
                    Box::pin(async move {
                        out.lend_terminal(|| async {
                            assert_eq!(replay(&process.transcript(), 40, true).lines, ["ℹ one"]);
                            out.print("from the child").await
                        })
                        .await?;
                        Ok(" two\nlast".to_owned())
                    }),
                ]))
                .await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    let lines = replay(&mock.transcript(), 40, true).lines;
    assert_eq!(
        lines.last().map(String::as_str),
        Some("  last"),
        "{lines:?}"
    );
    assert!(
        lines.iter().any(|line| line == "from the child"),
        "{lines:?}"
    );
}

#[tokio::test]
async fn a_print_with_a_live_frame_or_unfinished_row_writes_whole_lines() {
    for region in [false, true] {
        let mock = terminal();
        let process = mock.clone();
        let app = Application::new("streamed").action(move |ctx: Context| {
            let process = process.clone();
            async move {
                let done;
                let live;
                let out = ctx.out.clone();
                if region {
                    live = Some(ctx.out.region(RegionOptions::new()));
                    if let Some(live) = &live {
                        live.draw("frame", &View::new(|text: &str, _| text.to_owned()))
                            .await?;
                    }
                    done = None;
                } else {
                    live = None;
                    let ready = Arc::new(tokio::sync::Notify::new());
                    let let_end = Arc::new(tokio::sync::Notify::new());
                    let released = let_end.clone();
                    done = Some((
                        ctx.out.info(steps([
                            step("unfinished"),
                            Box::pin(async move {
                                ready.notify_one();
                                released.notified().await;
                                Ok(" row".to_owned())
                            }),
                        ])),
                        let_end,
                    ));
                    // The started message is registered even before its first read.
                }
                ctx.out
                    .print(steps([
                        step("one"),
                        Box::pin(async move {
                            assert_eq!(process.stdout_text(), "");
                            Ok(" two\n".to_owned())
                        }),
                    ]))
                    .await?;
                if let Some((done, release)) = done {
                    release.notify_one();
                    done.await?;
                }
                if let Some(live) = live {
                    live.end(EndState::Ended, None).await?;
                }
                out.print(message(["last"])).await
            }
        });
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stdout_text(), "one two\nlast\n");
    }
}

#[tokio::test]
async fn stdout_alone_holds_its_own_line_but_stderr_can_write() {
    let mock = mock_process(
        MockFields::new().terminal(MockTerminal::new(40, 24).streams([StreamName::Stdout])),
    );
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let waiting = Arc::new(tokio::sync::Notify::new());
            let let_end = Arc::new(tokio::sync::Notify::new());
            let ready = waiting.clone();
            let released = let_end.clone();
            let done = ctx.out.print(steps([
                step("first"),
                Box::pin(async move {
                    ready.notify_one();
                    released.notified().await;
                    Ok(" row".to_owned())
                }),
            ]));
            waiting.notified().await;
            ctx.out.warn("stderr can write").await?;
            assert_eq!(process.stdout_text(), "first");
            let mut pending = std::pin::pin!(ctx.out.print("after"));
            let offered = std::future::poll_fn(|cx| Poll::Ready(pending.as_mut().poll(cx))).await;
            assert!(offered.is_pending());
            let_end.notify_one();
            done.await?;
            pending.await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stdout_text(), "first row\nafter\n");
    assert_eq!(mock.stderr_text(), "⚠ stderr can write\n");
}

#[tokio::test]
async fn other_messages_on_a_shared_terminal_wait_for_the_streamed_print_line() {
    let mock = terminal();
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let at_first = Arc::new(tokio::sync::Notify::new());
            let finish_first = Arc::new(tokio::sync::Notify::new());
            let at_second = Arc::new(tokio::sync::Notify::new());
            let finish_second = Arc::new(tokio::sync::Notify::new());
            let print = ctx.out.print(steps([
                step("first li"),
                paused_step(&at_first, &finish_first, "ne\nsecond"),
                paused_step(&at_second, &finish_second, " line"),
            ]));
            at_first.notified().await;
            let mut warning = std::pin::pin!(ctx.out.warn("A warning."));
            let mut note = std::pin::pin!(ctx.out.print("A note."));
            std::future::poll_fn(|cx| {
                assert!(warning.as_mut().poll(cx).is_pending());
                assert!(note.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            assert_eq!(bytes(&process.transcript()), "first li");

            finish_first.notify_one();
            let inspect = async {
                at_second.notified().await;
                assert_eq!(
                    bytes(&process.transcript()),
                    "first line\n⚠ A warning.\nA note.\nsecond"
                );
                finish_second.notify_one();
                Ok(())
            };
            tokio::try_join!(warning, note, print, inspect)?;
            Ok(())
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        bytes(&mock.transcript()),
        "first line\n⚠ A warning.\nA note.\nsecond line\n"
    );
}

fn paused_step(
    ready: &Arc<tokio::sync::Notify>,
    release: &Arc<tokio::sync::Notify>,
    text: &'static str,
) -> Step {
    let ready = ready.clone();
    let release = release.clone();
    Box::pin(async move {
        ready.notify_one();
        release.notified().await;
        Ok(text.to_owned())
    })
}

async fn region_held_behind_print_line(suspend: bool) {
    use loomcli_core::ProcessSignal;

    let mock = terminal();
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let at_first = Arc::new(tokio::sync::Notify::new());
            let finish_first = Arc::new(tokio::sync::Notify::new());
            let print = ctx.out.print(steps([
                step("first li"),
                paused_step(&at_first, &finish_first, "ne\n"),
            ]));
            at_first.notified().await;

            let region = ctx.out.region(RegionOptions::new());
            let view = View::new(|text: &str, _| text.to_owned());
            let mut draw = std::pin::pin!(region.draw("Working", &view));
            std::future::poll_fn(|cx| {
                assert!(draw.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            assert_eq!(bytes(&process.transcript()), "first li");
            if suspend {
                process.raise(ProcessSignal::Tstp);
                assert_eq!(bytes(&process.transcript()), "first li\x1b[?25h");
                process.raise(ProcessSignal::Cont);
            }
            finish_first.notify_one();
            print.await?;
            draw.await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    let written = if suspend {
        "first li\x1b[?25hne\nWorking\n"
    } else {
        "first line\nWorking\n"
    };
    assert_eq!(bytes(&mock.transcript()), written);
    assert_eq!(
        replay(&mock.transcript(), 40, true).lines,
        ["first line", "Working"]
    );
}

#[tokio::test]
async fn a_region_opened_during_a_streamed_print_line_draws_after_the_line() {
    region_held_behind_print_line(false).await;
}

#[tokio::test]
async fn a_suspend_during_a_streamed_print_line_keeps_a_held_frame_behind_the_line() {
    region_held_behind_print_line(true).await;
}

#[tokio::test]
async fn two_streamed_prints_take_the_terminal_one_line_at_a_time() {
    let mock = terminal();
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let ready = Arc::new(tokio::sync::Notify::new());
        let let_end = Arc::new(tokio::sync::Notify::new());
        let ready_step = ready.clone();
        let end_step = let_end.clone();
        let first = ctx.out.print(steps([
            step("one"),
            Box::pin(async move {
                ready_step.notify_one();
                end_step.notified().await;
                Ok(" done\n".to_owned())
            }),
        ]));
        ready.notified().await;
        let second = ctx.out.print(message(["two", " done"]));
        let_end.notify_one();
        first.await?;
        second.await
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stdout_text(), "one done\ntwo done\n");
}

#[tokio::test]
async fn a_stop_unblocks_a_source_that_awaits_its_own_terminal() {
    let mock = terminal();
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let entered = Arc::new(tokio::sync::Notify::new());
        let ready = entered.clone();
        let out = ctx.out.clone();
        let done = ctx.out.print(steps([
            step("one"),
            Box::pin(async move {
                ready.notify_one();
                out.warn("self wait").await?;
                Ok("late".to_owned())
            }),
        ]));
        entered.notified().await;
        ctx.cancel();
        done.await
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        130
    );
    assert_eq!(mock.stdout_text(), "one\n");
    assert_eq!(mock.stderr_text(), "");
}

#[tokio::test]
async fn a_streamed_print_lets_a_stderr_write_pass_while_a_stdout_sequence_is_open() {
    use loomcli_core::{RowSource, RowView};
    let mock = terminal();
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let ready = Arc::new(tokio::sync::Notify::new());
        let released = Arc::new(tokio::sync::Notify::new());
        let mut wait = Box::pin(released.clone().notified_owned());
        let mut pending = Some("row");
        let notify = ready.clone();
        let rows = RowSource::stream(PollStream(move |cx: &mut std::task::Context<'_>| {
            notify.notify_one();
            std::task::ready!(wait.as_mut().poll(cx));
            Poll::Ready(pending.take().map(Ok))
        }));
        let out = ctx.out.clone();
        let sequence = tokio::spawn(async move {
            out.render(rows, &RowView::new(|row: &&str, _, _| format!("{row}\n")))
                .await
        });
        ready.notified().await;
        let streamed = ctx.out.print(message(["print ", "line\n"]));
        ctx.out.warn("not held").await?;
        released.notify_one();
        sequence.await.map_err(Error::from)??;
        streamed.await
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(bytes(&mock.transcript()), "⚠ not held\nrow\nprint line\n");
}

#[tokio::test]
async fn named_invocations_capture_streamed_lanes_as_plain_text() {
    use loomcli_core::{InvocationOutcome, InvocationValues, InvokeOptions};
    let app = Application::new("streamed").action(|ctx: Context| async move {
        ctx.out
            .print(message([style().red().apply("one\n"), "two".to_owned()]))
            .await?;
        ctx.out.warn(message(["warn", "ing"])).await
    });
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    match outcome {
        InvocationOutcome::Completed {
            messages, output, ..
        } => {
            assert_eq!(output, "one\ntwo\n");
            assert_eq!(messages, "⚠ warning\n");
        }
        other => panic!("unexpected invocation outcome: {other:?}"),
    }
}

#[tokio::test]
async fn environment_preparation_uses_the_warn_lane_for_streams() {
    use loomcli_core::{EnvironmentContext, Plugin};
    let app = Application::new("streamed")
        .plugins([Plugin::new("fixture/streamed-environment").on_environment(
            |ctx: EnvironmentContext| async move {
                ctx.warn(message(["before ", "the action"])).await?;
                Ok(std::collections::BTreeMap::new())
            },
        )])
        .action(|ctx: Context| async move { ctx.out.print("after").await });
    let mock = mock_process(MockFields::new());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(bytes(&mock.transcript()), "⚠ before the action\nafter\n");
}

#[tokio::test]
async fn an_unfinished_row_that_cannot_be_erased_stays_as_drawn_after_a_resize() {
    let mock = terminal();
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let region = ctx.out.region(RegionOptions::new());
            region
                .draw("Working", &View::new(|text: &str, _| text.to_owned()))
                .await?;
            ctx.out
                .info(steps([
                    step("one two three four five six"),
                    Box::pin(async move {
                        assert_eq!(
                            process.stderr_text(),
                            "Working\r\x1b[Jℹ one two three four five six\nWorking"
                        );
                        assert_eq!(
                            replay(&process.transcript(), 40, true).lines,
                            ["ℹ one two three four five six", "Working"],
                        );
                        process.resize(15, 24);
                        Ok(" seven eight nine ten eleven".to_owned())
                    }),
                ]))
                .await?;
            region.end(EndState::Ended, None).await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        concat!(
            "Working\r\x1b[Jℹ one two three four five six\nWorking",
            "\r\x1b[Jℹ one two three four five six seven\nWorking",
            "\r\x1b[J  eight nine ten eleven\nWorking\n",
        ),
    );
    // The initial row wraps to the same places when replayed at the narrowed width.
    assert_eq!(
        replay(&mock.transcript(), 15, true).lines,
        [
            "ℹ one two three",
            " four five six",
            "ℹ one two three",
            " four five six",
            "seven",
            "  eight nine te",
            "n eleven",
            "Working",
        ],
    );
}

async fn unfinished_rows_left_after_a_resize(short_tail: &'static str, expected: &str) {
    let mock = terminal();
    let process = mock.clone();
    let narrowed_at = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let snapshot = narrowed_at.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        let snapshot = snapshot.clone();
        async move {
            let short_started = Arc::new(tokio::sync::Notify::new());
            let finish_short = Arc::new(tokio::sync::Notify::new());
            let short = ctx.out.info(steps([
                step("Short"),
                paused_step(&short_started, &finish_short, short_tail),
            ]));
            short_started.notified().await;
            ctx.out
                .warn(steps([
                    step("one two three four five six"),
                    Box::pin(async move {
                        let before = process.stderr_text();
                        assert_eq!(
                            before,
                            "ℹ Short\r\x1b[Jℹ Short\n⚠ one two three four five six"
                        );
                        process.resize(15, 24);
                        snapshot.store(before.len(), Ordering::SeqCst);
                        Ok(" seven".to_owned())
                    }),
                ]))
                .await?;
            finish_short.notify_one();
            short.await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        &mock.stderr_text()[narrowed_at.load(Ordering::SeqCst)..],
        expected,
    );
}

#[tokio::test]
async fn leaving_one_wide_unfinished_row_keeps_every_unfinished_row_as_drawn() {
    unfinished_rows_left_after_a_resize("", "\n⚠ one two three four five six seven\nℹ Short\n")
        .await;
}

#[tokio::test]
async fn a_message_whose_unfinished_row_was_left_as_drawn_does_not_redraw() {
    unfinished_rows_left_after_a_resize(
        " more",
        "\n⚠ one two three four five six seven\nℹ Short more\n",
    )
    .await;
}

#[tokio::test]
async fn an_oversize_stream_defers_the_resize_until_it_finishes_a_row() {
    let mock = terminal();
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let region = ctx.out.region(RegionOptions::new());
            region
                .draw("Working", &View::new(|text: &str, _| text.to_owned()))
                .await?;
            let ready = Arc::new(tokio::sync::Notify::new());
            let release = Arc::new(tokio::sync::Notify::new());
            let long = ctx.out.info(steps([
                step("one two three four five"),
                paused_step(&ready, &release, " six"),
                paused_step(&ready, &release, " seven"),
                paused_step(&ready, &release, "\n"),
                paused_step(&ready, &release, ""),
            ]));
            ready.notified().await;
            process.resize(20, 24);
            release.notify_one();
            ready.notified().await;

            let warning_started = Arc::new(tokio::sync::Notify::new());
            let finish_warning = Arc::new(tokio::sync::Notify::new());
            let warning = ctx.out.warn(steps([
                step("second message"),
                paused_step(&warning_started, &finish_warning, ""),
            ]));
            warning_started.notified().await;
            let before = process.stderr_text();
            assert_eq!(
                before,
                concat!(
                    "Working\r\x1b[Jℹ one two three four five\nWorking",
                    "\r\x1b[JWorking\r\x1b[J⚠ second message\nWorking",
                ),
            );

            process.resize(10, 24);
            release.notify_one();
            ready.notified().await;
            assert_eq!(process.stderr_text(), before);

            release.notify_one();
            ready.notified().await;
            assert_eq!(
                &process.stderr_text()[before.len()..],
                "\r\x1b[Jℹ one two three four five six seven\nWorking",
            );
            release.notify_one();
            finish_warning.notify_one();
            long.await?;
            warning.await?;
            region.end(EndState::Ended, None).await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
}

#[tokio::test]
async fn a_suspend_erases_the_unfinished_row_and_resume_draws_it_again() {
    use loomcli_core::ProcessSignal;
    let mock = terminal();
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let process = process.clone();
            ctx.out
                .warn(steps([
                    step("working"),
                    Box::pin(async move {
                        process.raise(ProcessSignal::Tstp);
                        Ok(" again".to_owned())
                    }),
                ]))
                .await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert!(mock.stderr_text().contains("\r\x1b[J\x1b[?25h"));
    assert_eq!(
        replay(&mock.transcript(), 40, true).lines,
        ["⚠ working again"]
    );
}

#[tokio::test]
async fn cancellation_closes_streamed_rows_before_the_progress_frame() {
    let mock = terminal();
    let app = Application::new("streamed").action(|ctx: Context| async move {
        let region = ctx.out.region(RegionOptions::new());
        region
            .draw("running", &View::new(|text: &str, _| text.to_owned()))
            .await?;
        region.on_close(|region| {
            drop(region.draw(
                "cancelled progress",
                &View::new(|text: &str, _| text.to_owned()),
            ));
        });
        let waiting = Arc::new(tokio::sync::Notify::new());
        let done = ctx.out.info(stalled(
            "received",
            waiting.clone(),
            Arc::new(AtomicBool::new(false)),
        ));
        waiting.notified().await;
        ctx.cancel();
        done.await
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        130
    );
    assert_eq!(
        replay(&mock.transcript(), 40, true).lines,
        ["ℹ received", "cancelled progress"]
    );
}

#[tokio::test]
async fn styles_close_after_a_final_line_break_on_every_piped_lane() {
    let destination = Destination {
        columns: None,
        term: "xterm-256color",
        policy: RenderingPolicy::new()
            .color(Switch::Always)
            .modifiers(Switch::Always),
    };
    let plain = |text: &str| (text.to_owned(), false);
    let bold = |text: &str| (style().bold().apply(text), true);
    let texts = [
        vec![plain("Fetched the page.\n")],
        vec![plain("one\n\ntwo\n")],
        vec![bold("Answer ready.\n")],
        vec![plain("Then "), bold("bold\nend\n")],
        vec![bold("a\n"), plain("b\n")],
        vec![plain("\x1b[31mred\nstill red\n")],
        vec![
            (
                loomcli_core::pad("ab\ncd", 4, loomcli_core::Alignment::Left).unwrap_or_default(),
                true,
            ),
            plain("\nnext\n"),
        ],
    ];
    for lane in LANES {
        for segments in &texts {
            let text: String = segments.iter().map(|(text, _)| text.as_str()).collect();
            let whole = destination
                .writes(lane, vec![text.clone()], false, false)
                .await;
            let mut cuts = Vec::new();
            let mut start = 0;
            for (segment, protected) in segments {
                if !protected {
                    cuts.extend(segment.char_indices().skip(1).map(|(at, _)| start + at));
                }
                start += segment.len();
                cuts.push(start);
            }
            for split in cuts.into_iter().filter(|&at| at < text.len()) {
                let parts = vec![text[..split].to_owned(), text[split..].to_owned()];
                let writes = destination.writes(lane, parts.clone(), true, false).await;
                assert_eq!(bytes(&writes), bytes(&whole), "{lane:?} {parts:?}");
            }
        }
    }
}

#[tokio::test]
async fn the_last_layouts_error_keeps_the_previous_text_for_caught_and_unobserved_calls() {
    let failures: &[(&[&str], &str, &str)] = &[
        (&[], "", "\n"),
        (&["Hello", " "], "Hello ", "Hello\n"),
        (
            &["first\nsec", "ond.\t"],
            "first\nsecond.\t",
            "first\nsecond.\n",
        ),
    ];
    for (parts, refuse, written) in failures {
        for catch in [false, true] {
            let refuse = (*refuse).to_owned();
            let view = View::new(move |text: &str, _| {
                if text == refuse {
                    Err(loomcli_core::FatalError::new("The view refused the text."))
                } else {
                    Ok(text.to_owned())
                }
            });
            let parts = parts.to_vec();
            let app = Application::new("streamed")
                .overrides([override_view(lanes::info(), view)])
                .action(move |ctx: Context| {
                    let source = message(parts.clone());
                    async move {
                        let done = ctx.out.info(source);
                        if catch {
                            assert!(done.await.is_err());
                        } else {
                            drop(done);
                        }
                        Ok(())
                    }
                });
            let mock = mock_process(MockFields::new());
            let code = app.run(RunOptions::new().process(mock.clone())).await;
            if catch {
                assert_eq!(code.get(), 0);
                assert_eq!(mock.stderr_text(), *written);
            } else {
                assert_eq!(code.get(), 1);
                assert!(mock.stderr_text().starts_with(written));
                assert!(mock.stderr_text().contains("The view refused the text."));
            }
        }
    }
}

#[tokio::test]
async fn print_leaves_long_graphemes_and_resizes_to_the_terminal() {
    for (from, to, text) in [
        (20, 10, "aaaaaaaaaabbbbbbbbbbcccc"),
        (10, 30, "aaaaaaaaaabbbbbbbbbbcccc"),
        (
            40,
            80,
            "The model answered with a paragraph that runs past the edge",
        ),
        (
            40,
            20,
            "The model answered with a paragraph that runs past the edge",
        ),
        (20, 10, "Great ❤️ work on this, the tests"),
        (20, 10, "Great ⚠️ work on this, the tests"),
        (20, 10, "Great ✔️ work on this, the tests"),
        (20, 10, "Great 👨‍👩‍👧 work on this, the tests"),
        (16, 10, "ab 👨‍👩‍👧 cd efg then more letters"),
    ] {
        let mock = mock_process(MockFields::new().terminal(
            MockTerminal::new(from, 24).streams([StreamName::Stdout, StreamName::Stderr]),
        ));
        let process = mock.clone();
        let app = Application::new("streamed").action(move |ctx: Context| {
            let process = process.clone();
            async move {
                ctx.out
                    .print(steps([
                        step(text),
                        Box::pin(async move {
                            process.resize(to, 24);
                            Ok(" and it ships".to_owned())
                        }),
                    ]))
                    .await
            }
        });
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(bytes(&mock.transcript()), format!("{text} and it ships\n"));
    }
}

#[tokio::test]
async fn a_terminal_print_chunk_layout_panic_finishes_with_the_whole_received_text() {
    let mock = terminal();
    let process = mock.clone();
    let view = View::new(|text: &str, _| {
        if text == "partial answer" {
            panic!("The view refused the chunk.");
        }
        text.to_owned()
    });
    let app = Application::new("streamed")
        .overrides([override_view(lanes::print(), view)])
        .action(
            |ctx: Context| async move { ctx.out.print(message(["partial", " answer "])).await },
        );

    assert_panic(
        tokio::spawn(async move { app.run(RunOptions::new().process(process)).await }).await,
        "The view refused the chunk.",
    );
    assert_eq!(mock.stdout_text(), "partial answer \n");
}

#[tokio::test]
async fn a_terminal_print_whose_final_layout_also_panics_writes_only_its_unwritten_text() {
    let mock = terminal();
    let process = mock.clone();
    let view = View::new(|text: &str, _| {
        if text.contains("answer") {
            panic!("The view refused the text.");
        }
        text.to_owned()
    });
    let app = Application::new("streamed")
        .overrides([override_view(lanes::print(), view)])
        .action(
            |ctx: Context| async move { ctx.out.print(message(["partial", " answer "])).await },
        );

    assert_panic(
        tokio::spawn(async move { app.run(RunOptions::new().process(process)).await }).await,
        "The view refused the text.",
    );
    assert_eq!(mock.stdout_text(), "partial\n");
}

#[tokio::test]
async fn a_final_layout_panic_at_cancellation_closes_the_row_before_unwinding() {
    let mock = terminal();
    let process = mock.clone();
    let view = View::new(|text: &str, _| {
        if text == "partial " {
            panic!("The view refused the final layout.");
        }
        text.to_owned()
    });
    let app = Application::new("streamed")
        .overrides([override_view(lanes::info(), view)])
        .action(|ctx: Context| async move {
            let waiting = Arc::new(tokio::sync::Notify::new());
            let done = ctx.out.info(stalled(
                "partial ",
                waiting.clone(),
                Arc::new(AtomicBool::new(false)),
            ));
            waiting.notified().await;
            ctx.cancel();
            ctx.out.warn("after").await?;
            done.await
        });

    assert_panic(
        tokio::spawn(async move { app.run(RunOptions::new().process(process)).await }).await,
        "The view refused the final layout.",
    );
    assert_eq!(mock.stderr_text(), "partial\r\x1b[Jpartial\n⚠ after\n");
}

/// Runs an action whose spawned task awaits a streamed message only after the run has settled.
async fn late_waiter(
    source: fn() -> StreamedMessage,
) -> (
    Result<loomcli_core::ExitCode, tokio::task::JoinError>,
    Result<Result<(), Error>, tokio::task::JoinError>,
) {
    let (send_waiter, receive_waiter) = tokio::sync::oneshot::channel();
    let send_waiter = Arc::new(Mutex::new(Some(send_waiter)));
    let release = Arc::new(tokio::sync::Notify::new());
    let release_in_app = release.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let release = release_in_app.clone();
        let send_waiter = send_waiter
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        async move {
            let (started, start) = tokio::sync::oneshot::channel();
            let waiter = tokio::spawn(async move {
                let call = ctx.out.print(source());
                let _ = started.send(());
                release.notified().await;
                call.await
            });
            let _ = start.await;
            if let Some(send_waiter) = send_waiter {
                let _ = send_waiter.send(waiter);
            }
            Ok(())
        }
    });
    let run = tokio::spawn(async move {
        app.run(RunOptions::new().process(mock_process(MockFields::new())))
            .await
    })
    .await;
    release.notify_one();
    let joined = match receive_waiter.await {
        Ok(waiter) => waiter.await,
        Err(_) => panic!("The action never handed over its waiter."),
    };
    (run, joined)
}

#[tokio::test]
async fn a_waiter_after_the_run_resumed_its_panic_does_not_succeed() {
    let (run, joined) = late_waiter(panicking_source).await;
    assert_panic(run, "The source panicked.");
    assert!(joined.is_err_and(|error| error.is_panic()));
}

#[tokio::test]
async fn a_waiter_after_the_run_reported_its_failure_does_not_succeed() {
    fn failing() -> StreamedMessage {
        steps([
            step("partial"),
            Box::pin(async { Err(loomcli_core::FatalError::new("The service hung up.").into()) }),
        ])
    }
    let (run, joined) = late_waiter(failing).await;
    assert_eq!(run.map(|code| code.get()).ok(), Some(1));
    assert!(matches!(joined, Ok(Err(_))));
}

#[tokio::test]
async fn a_fitting_update_to_a_row_left_as_drawn_redraws_the_region_stack() {
    let mock = terminal();
    let process = mock.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let process = process.clone();
        async move {
            let region = ctx.out.region(RegionOptions::new());
            region
                .draw("Working", &View::new(|text: &str, _| text.to_owned()))
                .await?;
            let short_started = Arc::new(tokio::sync::Notify::new());
            let finish_short = Arc::new(tokio::sync::Notify::new());
            let short = ctx.out.info(steps([
                step("Short"),
                paused_step(&short_started, &finish_short, " more"),
                paused_step(&short_started, &finish_short, ""),
            ]));
            short_started.notified().await;
            let narrowed = process.clone();
            ctx.out
                .warn(steps([
                    step("one two three four five six"),
                    Box::pin(async move {
                        narrowed.resize(15, 24);
                        Ok(" seven".to_owned())
                    }),
                ]))
                .await?;
            let before = process.stderr_text().len();
            finish_short.notify_one();
            short_started.notified().await;
            assert_eq!(&process.stderr_text()[before..], "\r\x1b[JWorking");
            finish_short.notify_one();
            short.await?;
            region.end(EndState::Ended, None).await
        }
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
}
