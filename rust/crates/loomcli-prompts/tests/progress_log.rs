//! Progress log cases through the mock process, from `progress-log.test.ts`.

#![allow(clippy::unwrap_used, missing_docs)]

mod support;

use loomcli_core::{Application, Context, RunOptions, SpawnOptions};
use loomcli_prompts::{ProgressSettings, progress};
use loomcli_testing::{MockFields, ProgramAnswer, mock_process};

#[tokio::test(start_paused = true)]
async fn failure_and_warning_keep_glyphless_lines_above_their_plain_ends() {
    let mock = mock_process(MockFields::new().env("NO_COLOR", "1").env("TERM", "xterm"));
    let app: support::App = Application::new("progress").action(|ctx: Context| async move {
        let line = progress(&ctx, ProgressSettings::new("Building").log_limit(2));
        line.log("First\nFetched 10%\rFetched 20%\r\nlast");
        line.fail().await?;
        let line = progress(&ctx, ProgressSettings::new("Installing"));
        line.log("missing\toptional package");
        line.warn().await
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        "ℹ Building\n  1 earlier line was dropped.\n  Fetched 20%\n  last\n✘ Building\nℹ Installing\n  missing optional package\n⚠ Installing\n"
    );
}

#[tokio::test(start_paused = true)]
async fn the_mock_child_writes_each_pipe_into_its_own_log_source() {
    let mock = mock_process(
        MockFields::new()
            .env("NO_COLOR", "1")
            .env("TERM", "xterm")
            .script("builder", |_| async {
                Ok(ProgramAnswer::new()
                    .code(1)
                    .stdout("partial output")
                    .stderr("partial error"))
            }),
    );
    let app: support::App = Application::new("progress").action(|ctx: Context| async move {
        let line = progress(&ctx, ProgressSettings::new("Building"));
        let stdout = line.log_output();
        let stderr = line.log_output();
        let child = ctx.host.spawn(
            "builder",
            ["run"],
            SpawnOptions::new()
                .stdout(stdout.child_stream())
                .stderr(stderr.child_stream()),
        );
        let _ = child.exited().await;
        stdout.finish();
        stderr.finish();
        line.fail().await
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        "ℹ Building\n  partial output\n  partial error\n✘ Building\n"
    );
}

use loomcli_core::{
    ChildStream, Error, FailureFacts, FatalError, InvocationOutcome, InvocationValues,
    InvokeOptions, Stream, View, ViewContext, escape,
};
use loomcli_prompts::views::{ProgressLine, ProgressState, progress_line};
use loomcli_prompts::{ProgressUpdate, TrackMessages};
use std::pin::Pin;
use std::task::{Context as PollContext, Poll};
use support::progress::{Frames, advance, app, builder, fields, mock, rows, run, still, terminal};
use tokio::sync::mpsc;

struct Chunks(mpsc::UnboundedReceiver<Result<String, Error>>);

impl Stream for Chunks {
    type Item = Result<String, Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut PollContext<'_>) -> Poll<Option<Self::Item>> {
        self.0.poll_recv(cx)
    }
}

fn channel() -> (mpsc::UnboundedSender<Result<String, Error>>, Chunks) {
    let (tx, rx) = mpsc::unbounded_channel();
    (tx, Chunks(rx))
}

async fn flush() {
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
}

#[tokio::test(start_paused = true)]
async fn log_text_waits_for_the_next_frame_and_keeps_only_the_newest_rows() {
    let frames = Frames::default();
    let watched = frames.clone();
    let action = builder().overrides([frames.view()]).action(move |ctx| {
        let frames = watched.clone();
        async move {
            let line = progress(
                &ctx,
                still("Installing dependencies").spinner(loomcli_prompts::Spinner::new(["◐"], 100)),
            );
            line.log("Resolving packages");
            assert!(frames.last().data.log.is_empty());
            advance(100).await;
            assert_eq!(
                frames.last().text,
                "◐ Installing dependencies · 0.1s\n  Resolving packages"
            );
            line.log("first\n\nthird\n");
            line.log("");
            line.log("a\r\nb");
            advance(100).await;
            assert_eq!(frames.last().data.log, ["first", "", "third", "a", "b"]);
            line.log("line 1\nline 2\nline 3");
            advance(100).await;
            assert_eq!(
                frames.last().data.log,
                ["a", "b", "line 1", "line 2", "line 3"]
            );
            line.log("line 4\nline 5\nline 6\nline 7");
            advance(100).await;
            assert_eq!(
                frames.last().data.log,
                ["line 3", "line 4", "line 5", "line 6", "line 7"]
            );
            line.end().await?;
            assert!(frames.last().data.log.is_empty());
            Ok(())
        }
    });
    let mock = mock(80, 24);
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        support::screen::replay(&mock.transcript(), 80, false).lines,
        ["✔ Installing dependencies · 0.4s"]
    );
}

#[tokio::test(start_paused = true)]
async fn streamed_chunks_join_split_crlf_and_overwrite_text_after_lone_carriage_returns() {
    let frames = Frames::default();
    let watched = frames.clone();
    let action = builder().overrides([frames.view()]).action(move |ctx| {
        let frames = watched.clone();
        async move {
            let line = progress(&ctx, still("Installing"));
            let (tx, rx) = channel();
            let done = line.log_stream(rx);
            for (text, expected) in [
                ("Fetching 10%\r", vec!["Fetching 10%"]),
                ("Fetching 20%\r", vec!["Fetching 20%"]),
                ("\nnpm http fe", vec!["Fetching 20%", "npm http fe"]),
                (
                    "tch GET 200 react-dom\nadded 2 packages\r",
                    vec![
                        "Fetching 20%",
                        "npm http fetch GET 200 react-dom",
                        "added 2 packages",
                    ],
                ),
            ] {
                tx.send(Ok(text.to_owned())).unwrap();
                flush().await;
                line.update(ProgressUpdate::new());
                assert_eq!(frames.last().data.log, expected);
            }
            drop(tx);
            done.await?;
            line.fail().await
        }
    });
    let mock = mock(80, 24);
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        support::screen::replay(&mock.transcript(), 80, false).lines,
        [
            "  Fetching 20%",
            "  npm http fetch GET 200 react-dom",
            "  added 2 packages",
            "✘ Installing · 0.0s",
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn split_utf8_waits_in_a_child_feed_until_the_scalar_is_complete() {
    let frames = Frames::default();
    let watched = frames.clone();
    let action = builder().overrides([frames.view()]).action(move |ctx| {
        let watched = watched.clone();
        async move {
            let line = progress(&ctx, still("Writing"));
            let output = line.log_output();
            let ChildStream::Stream(stream) = output.child_stream() else {
                unreachable!()
            };
            stream.write(b"done \xf0\x9f").await.unwrap();
            line.update(ProgressUpdate::new());
            assert_eq!(watched.last().data.log, ["done "]);
            stream.write(b"\x98\x80 ok\n").await.unwrap();
            output.finish();
            stream.write(b"ignored\n").await.unwrap();
            line.update(ProgressUpdate::new());
            assert_eq!(watched.last().data.log, ["done 😀 ok"]);
            line.end().await
        }
    });
    assert_eq!(run(action, &mock(80, 24)).await, 0);
}

#[tokio::test(start_paused = true)]
async fn a_child_destination_keeps_its_feed_after_the_output_handle_drops() {
    let mock = mock_process(fields().script("builder", |_| async {
        Ok(ProgramAnswer::new().stdout("unfinished"))
    }));
    let action = app(|ctx| async move {
        let line = progress(&ctx, still("Installing"));
        let output = line.log_output();
        let stream = output.child_stream();
        drop(output);
        let child = ctx
            .host
            .spawn("builder", ["run"], SpawnOptions::new().stdout(stream));
        let _ = child.exited().await;
        line.fail().await
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        mock.stderr_text(),
        "ℹ Installing\n  unfinished\n✘ Installing\n"
    );
}

#[tokio::test(start_paused = true)]
async fn display_limits_and_retention_are_independent() {
    let frames = Frames::default();
    let app = builder()
        .overrides([frames.view()])
        .action(|ctx| async move {
            for (label, rows_limit, kept) in [("Two", 2, 4), ("None", 0, 4), ("No retention", 5, 0)]
            {
                let line = progress(&ctx, still(label).log_rows(rows_limit).log_limit(kept));
                line.log(&rows("line", 4));
                line.update(ProgressUpdate::new());
                if label == "Two" {
                    line.end().await?;
                } else {
                    line.fail().await?;
                }
            }
            Ok(())
        });
    let mock = mock(80, 24);
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(frames.lengths("Two"), [0, 2]);
    assert_eq!(frames.lengths("None"), [0, 0]);
    assert_eq!(frames.lengths("No retention"), [0, 4]);
    assert_eq!(
        support::screen::replay(&mock.transcript(), 80, false).lines,
        [
            "✔ Two · 0.0s",
            "  line 1",
            "  line 2",
            "  line 3",
            "  line 4",
            "✘ None · 0.0s",
            "✘ No retention · 0.0s",
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn log_rows_remove_controls_expand_tabs_and_escape_bidi_and_line_separators() {
    let frames = Frames::default();
    let app = builder().overrides([frames.view()]).action(|ctx| async move {
        let line = progress(&ctx, still("Building"));
        line.log(&escape("\x1b[31merror\x1b[0m in a\x07b\x08c\n\tindented\tcell\nright\u{202e}left\nx\u{2028}y\n"));
        line.log(&ctx.style.bold().apply("marked"));
        line.update(ProgressUpdate::new());
        line.end().await
    });
    assert_eq!(run(app, &mock(80, 24)).await, 0);
    assert_eq!(
        frames.take()[1].text,
        "◐ Building · 0.0s\n  error in abc\n          indented        cell\n  right\\u202eleft\n  x\\u2028y\n  marked"
    );
}

#[tokio::test(start_paused = true)]
async fn log_rows_fit_graphemes_and_use_leading_columns_at_the_narrowest_widths() {
    for (columns, expected) in [
        (20, "  abcdefghijklmnopq…"),
        (30, "  abcdefghijklmnopqrstuvwxyz"),
        (3, "  …"),
        (2, "  "),
        (1, " "),
    ] {
        let frames = Frames::default();
        let action = builder()
            .overrides([frames.view()])
            .action(|ctx| async move {
                let line = progress(&ctx, still("B"));
                line.log("abcdefghijklmnopqrstuvwxyz");
                line.update(ProgressUpdate::new());
                line.end().await
            });
        assert_eq!(run(action, &mock(columns, 24)).await, 0);
        assert_eq!(frames.take()[1].text.split_once('\n').unwrap().1, expected);
    }
    let mock = mock_process(fields());
    let draw = View::new(|data: &ProgressLine, ctx: &ViewContext| {
        progress_line().render(data, ctx).map(|text| text + "\n")
    });
    let action = app(move |ctx| {
        let draw = draw.clone();
        async move {
            let data = ProgressLine::new(ProgressState::Running, "W")
                .frame("*")
                .log(vec!["wide 😀 text".to_owned(), "y".repeat(100)]);
            ctx.out.render(&data, &draw).await
        }
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        mock.stdout_text(),
        format!("* W · 0.0s\n  wide 😀 text\n  {}…\n", "y".repeat(77))
    );
}

#[tokio::test(start_paused = true)]
async fn successful_ends_remove_live_log_rows_without_a_blank_row() {
    let mock = mock(80, 24);
    let action = app(|ctx| async move {
        for label in ["End", "Skip", "Clear", "Track", "Completion"] {
            let line = progress(&ctx, still(label));
            line.log("Getting packages");
            line.update(ProgressUpdate::new());
            match label {
                "End" => line.end().await?,
                "Skip" => line.skip().await?,
                "Clear" => line.clear().await?,
                "Track" => line.track(async { Ok(()) }, TrackMessages::new()).await?,
                _ => {}
            }
        }
        Ok(())
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        support::screen::replay(&mock.transcript(), 80, false).lines,
        [
            "✔ End · 0.0s",
            "ℹ Skip · 0.0s",
            "✔ Track · 0.0s",
            "✔ Completion · 0.0s"
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn log_retention_reports_earlier_lines_and_uses_the_default_ring_limit() {
    for (count, limit, shown, first, dropped) in [
        (4, 3, 5, 2, "1 earlier line was dropped."),
        (20, 3, 5, 18, "17 earlier lines were dropped."),
        (20, 3, 10, 18, "17 earlier lines were dropped."),
        (3, 3, 5, 1, ""),
        (2203, 1000, 5, 1204, "1203 earlier lines were dropped."),
    ] {
        let mock = mock_process(fields());
        let action = app(move |ctx| async move {
            let settings = still("Installing").log_rows(shown);
            let settings = if limit == 1000 {
                settings
            } else {
                settings.log_limit(limit)
            };
            let line = progress(&ctx, settings);
            line.log(&rows("line", count));
            line.fail().await
        });
        assert_eq!(run(action, &mock).await, 0);
        let notice = if dropped.is_empty() {
            String::new()
        } else {
            format!("  {dropped}\n")
        };
        let expected: String = (first..=count).map(|n| format!("  line {n}\n")).collect();
        assert_eq!(
            mock.stderr_text(),
            format!("ℹ Installing\n{notice}{expected}✘ Installing\n")
        );
    }
}

#[tokio::test(start_paused = true)]
async fn one_long_line_retains_4096_code_points_and_carriage_return_restarts_the_bound() {
    let mock = mock_process(fields());
    let action = app(|ctx| async move {
        let line = progress(&ctx, still("Installing"));
        let (tx, rx) = channel();
        let done = line.log_stream(rx);
        for chunk in [
            "x".repeat(3000),
            format!(
                "{}\n{}\n{}\n",
                "x".repeat(3000),
                "😀".repeat(4097),
                "z".repeat(4096)
            ),
            format!("{}\rshort\n", "w".repeat(5000)),
        ] {
            tx.send(Ok(chunk)).unwrap();
        }
        drop(tx);
        done.await?;
        line.fail().await
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        mock.stderr_text(),
        format!(
            "ℹ Installing\n  {}…\n  {}…\n  {}\n  short\n✘ Installing\n",
            "x".repeat(4096),
            "😀".repeat(4096),
            "z".repeat(4096)
        )
    );
}

async fn plain_logs(ctx: Context) -> Result<(), Error> {
    let ok = progress(&ctx, still("Installing"));
    ok.log("fetched");
    ok.end_with("Installed").await?;
    let fail = progress(&ctx, still("Building"));
    fail.log("tsc error TS2304\n\tat src/main.ts");
    fail.fail().await?;
    let warn = progress(&ctx, still("Auditing"));
    warn.log("2 moderate");
    warn.warn().await
}

#[tokio::test(start_paused = true)]
async fn plain_and_quiet_modes_only_write_logs_at_failure_or_warning() {
    let expected = "ℹ Installing\n✔ Installed\nℹ Building\n  tsc error TS2304\n          at src/main.ts\n✘ Building\nℹ Auditing\n  2 moderate\n⚠ Auditing\n";
    for (args, env, tty) in [
        (&[][..], ("TERM", "xterm"), false),
        (&[][..], ("TERM", "dumb"), true),
        (&[][..], ("CI", "true"), true),
        (&[][..], ("ACCESSIBLE", "1"), true),
        (&["--plain"][..], ("TERM", "xterm"), true),
    ] {
        let fields = fields().argv(args.iter().copied()).env(env.0, env.1);
        let mock = mock_process(if tty {
            fields.terminal(terminal(80, 24))
        } else {
            fields
        });
        assert_eq!(run(app(plain_logs), &mock).await, 0);
        assert_eq!(mock.stderr_text(), expected);
    }
    let mock = mock_process(fields().argv(["-q"]));
    assert_eq!(run(app(plain_logs), &mock).await, 0);
    assert_eq!(
        mock.stderr_text(),
        "  tsc error TS2304\n          at src/main.ts\n✘ Building\n  2 moderate\n⚠ Auditing\n"
    );

    let outcome = app(plain_logs)
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock_process(fields())),
        )
        .await;
    let InvocationOutcome::Completed { messages, .. } = outcome else {
        panic!("invoke failed")
    };
    assert_eq!(messages, expected);
}

#[tokio::test(start_paused = true)]
async fn cancellation_flushes_open_sources_and_writes_no_plain_end() {
    for tty in [false, true] {
        let mock = if tty {
            mock(80, 24)
        } else {
            mock_process(fields())
        };
        let action = app(|ctx| async move {
            let line = progress(&ctx, still("Installing"));
            let (tx, rx) = channel();
            let done = line.log_stream(rx);
            tx.send(Ok("npm http fetch GET 200 react".to_owned()))
                .unwrap();
            flush().await;
            ctx.cancel();
            drop(tx);
            done.await
        });
        assert_eq!(run(action, &mock).await, 130);
        if tty {
            assert_eq!(
                support::screen::replay(&mock.transcript(), 80, false).lines,
                ["  npm http fetch GET 200 react", "■ Installing (cancelled)"]
            );
        } else {
            assert_eq!(
                mock.stderr_text(),
                "ℹ Installing\n  npm http fetch GET 200 react\n"
            );
        }
    }
}

#[tokio::test(start_paused = true)]
async fn ordinary_failure_keeps_an_open_sources_partial_line_ahead_of_the_report() {
    let mock = mock(80, 24);
    let action = app(|ctx| async move {
        let line = progress(&ctx, still("Building"));
        let (tx, rx) = channel();
        let done = line.log_stream(rx);
        tx.send(Ok("partial error".to_owned())).unwrap();
        flush().await;
        drop(done);
        drop(tx);
        Err(FatalError::new("The build failed. Check the log.").into())
    });
    assert_eq!(run(action, &mock).await, 1);
    assert_eq!(
        support::screen::replay(&mock.transcript(), 80, false).lines,
        [
            "  partial error",
            "✘ Building · 0.0s",
            "The build failed. Check the log."
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_stream_finishes_its_partial_line_on_error_and_keeps_running() {
    let mock = mock_process(fields());
    let action = app(|ctx| async move {
        let line = progress(&ctx, still("Installing"));
        let (tx, rx) = channel();
        let mut done = line.log_stream(rx);
        line.log("first");
        tx.send(Ok("unfinished".to_owned())).unwrap();
        assert!(std::future::poll_fn(|cx| Poll::Ready(done.as_mut().poll(cx).is_pending())).await);
        tx.send(Err(FatalError::new("The child stream broke.").into()))
            .unwrap();
        let error = done.await.unwrap_err();
        assert_eq!(
            error.failure().unwrap().message(),
            "The child stream broke."
        );
        line.log("after the error");
        line.fail().await
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        mock.stderr_text(),
        "ℹ Installing\n  first\n  unfinished\n  after the error\n✘ Installing\n"
    );
}

#[tokio::test(start_paused = true)]
async fn two_streams_interleave_completed_lines_then_their_open_sources_in_call_order() {
    let frames = Frames::default();
    let watched = frames.clone();
    let action = builder().overrides([frames.view()]).action(move |ctx| {
        let watched = watched.clone();
        async move {
            let line = progress(&ctx, still("Logging").log_rows(0));
            let (out, stdout) = channel();
            let (err, stderr) = channel();
            let stdout = line.log_stream(stdout);
            let stderr = line.log_stream(stderr);
            out.send(Ok("out 1\npartial out".to_owned())).unwrap();
            flush().await;
            err.send(Ok("err 1\npartial err".to_owned())).unwrap();
            flush().await;
            line.update(ProgressUpdate::new());
            assert!(watched.last().data.log.is_empty());
            line.fail().await?;
            out.send(Ok(" ignored after end".to_owned())).unwrap();
            err.send(Ok(" ignored after end".to_owned())).unwrap();
            drop(out);
            drop(err);
            stdout.await?;
            stderr.await?;
            Ok(())
        }
    });
    let tty = mock(80, 24);
    assert_eq!(run(action, &tty).await, 0);
    assert_eq!(
        support::screen::replay(&tty.transcript(), 80, false).lines,
        [
            "  out 1",
            "  err 1",
            "  partial out",
            "  partial err",
            "✘ Logging · 0.0s"
        ]
    );

    let frames = Frames::default();
    let watched = frames.clone();
    let action = builder().overrides([frames.view()]).action(move |ctx| {
        let watched = watched.clone();
        async move {
            let line = progress(&ctx, still("Logging"));
            let (out, stdout) = channel();
            let (err, stderr) = channel();
            let stdout = line.log_stream(stdout);
            let stderr = line.log_stream(stderr);
            err.send(Ok("err 1\nerr partial".to_owned())).unwrap();
            flush().await;
            out.send(Ok("out 1\nout partial 😀".to_owned())).unwrap();
            flush().await;
            line.update(ProgressUpdate::new());
            assert_eq!(
                watched.last().data.log,
                ["err 1", "out 1", "out partial 😀", "err partial"]
            );
            drop(out);
            drop(err);
            stdout.await?;
            stderr.await?;
            line.end().await?;
            let (tx, rx) = channel();
            line.log("late");
            let done = line.log_stream(rx);
            tx.send(Ok("late chunk".to_owned())).unwrap();
            tx.send(Err(FatalError::new("Late source error.").into()))
                .unwrap();
            assert_eq!(
                done.await.unwrap_err().failure().unwrap().message(),
                "Late source error."
            );
            Ok(())
        }
    });
    assert_eq!(run(action, &mock(80, 24)).await, 0);
    assert!(frames.last().data.log.is_empty());
}

#[tokio::test(start_paused = true)]
async fn concurrent_ends_and_other_writers_cannot_split_a_log_from_its_end() {
    for tty in [false, true] {
        let mock = if tty {
            mock(80, 24)
        } else {
            mock_process(fields())
        };
        let action = app(|ctx| async move {
            let a = progress(&ctx, still("A"));
            let b = progress(&ctx, still("B"));
            a.log("log A");
            b.log("log B");
            let (a, b, note) = tokio::join!(a.fail(), b.warn(), ctx.out.info("after both"));
            a?;
            b?;
            note
        });
        assert_eq!(run(action, &mock).await, 0);
        if tty {
            assert_eq!(
                support::screen::replay(&mock.transcript(), 80, false).lines,
                [
                    "  log A",
                    "✘ A · 0.0s",
                    "  log B",
                    "⚠ B · 0.0s",
                    "ℹ after both",
                ]
            );
        } else {
            assert_eq!(
                mock.stderr_text(),
                "ℹ A\nℹ B\n  log A\n✘ A\n  log B\n⚠ B\nℹ after both\n"
            );
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_kept_log_uses_its_glyphless_view_and_live_row_overrides_are_local() {
    let frames = Frames::default();
    let view = frames.render(|data, _| {
        Ok(std::iter::once(data.label.clone())
            .chain(data.log.iter().map(|text| format!("> {text}")))
            .collect::<Vec<_>>()
            .join("\n"))
    });
    let mock = mock(80, 24);
    let action = builder().overrides([view]).action(|ctx| async move {
        let line = progress(&ctx, still("Installing"));
        line.log("one\ntwo");
        line.update(ProgressUpdate::new());
        let failure = line.track(
            async { Err::<(), _>(FatalError::new("Not installed.").into()) },
            TrackMessages::new(),
        );
        assert_eq!(
            failure.await.unwrap_err().failure().unwrap().message(),
            "Not installed."
        );
        Ok(())
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(frames.take()[1].text, "Installing\n> one\n> two");
    assert_eq!(
        support::screen::replay(&mock.transcript(), 80, false).lines,
        ["  one", "  two", "Installing"]
    );
}

#[tokio::test(start_paused = true)]
async fn an_empty_log_writes_no_message_and_hand_built_logs_draw_in_every_state() {
    let mock = mock_process(fields());
    let action = app(|ctx| async move {
        let line = progress(&ctx, still("Installing"));
        line.fail().await?;
        let view = View::new(|line: &ProgressLine, ctx: &ViewContext| {
            progress_line().render(line, ctx).map(|text| text + "\n")
        });
        for state in [
            ProgressState::Running,
            ProgressState::Ended,
            ProgressState::Failed,
            ProgressState::Cancelled,
            ProgressState::Skipped,
            ProgressState::Warned,
        ] {
            let data = ProgressLine::new(state, "Building")
                .frame("◐")
                .log(vec!["output".to_owned()]);
            ctx.out.render(&data, &view).await?;
        }
        Ok(())
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(mock.stderr_text(), "ℹ Installing\n✘ Installing\n");
    assert_eq!(
        mock.stdout_text(),
        "◐ Building · 0.0s\n  output\n✔ Building · 0.0s\n  output\n✘ Building · 0.0s\n  output\n■ Building (cancelled)\n  output\nℹ Building · 0.0s\n  output\n⚠ Building · 0.0s\n  output\n"
    );
}

#[tokio::test(start_paused = true)]
async fn only_overflowing_live_log_rows_gain_an_ellipsis() {
    let frames = Frames::default();
    let action = builder()
        .overrides([frames.view()])
        .action(|ctx| async move {
            let line = progress(&ctx, still("B"));
            line.log("123456\n1234567");
            line.update(ProgressUpdate::new());
            line.end().await
        });
    assert_eq!(run(action, &mock(8, 24)).await, 0);
    let frame = &frames.take()[1];
    assert_eq!(
        frame.text.lines().skip(1).collect::<Vec<_>>(),
        ["  123456", "  12345…"]
    );
}

#[tokio::test(start_paused = true)]
async fn live_and_kept_logs_are_dim_and_the_end_label_keeps_its_style() {
    let tty = mock_process(
        MockFields::new()
            .env("TERM", "xterm")
            .terminal(terminal(80, 24)),
    );
    let action: support::App = Application::new("progress")
        .plugins([support::progress::dim_and_warning_theme()])
        .action(|ctx: Context| async move {
            let line = progress(&ctx, still("Auditing"));
            line.log("2 moderate");
            line.update(ProgressUpdate::new());
            line.warn().await
        });
    assert_eq!(run(action, &tty).await, 0);
    let stderr = tty.stderr_text();
    assert!(
        stderr.matches("\x1b[2m  2 moderate\x1b[22m").count() >= 2,
        "{stderr:?}"
    );
    assert!(stderr.contains("\x1b[33m⚠\x1b[39m Auditing "), "{stderr:?}");
}

#[tokio::test(start_paused = true)]
async fn two_tracks_that_fail_together_keep_their_own_diagnostics() {
    let tty = mock(80, 24);
    let action = app(|ctx| async move {
        let a = progress(&ctx, still("A"));
        let b = progress(&ctx, still("B"));
        a.log("log A");
        b.log("log B");
        let (a, b) = tokio::join!(
            a.track(
                async { Err::<(), Error>(FatalError::new("A failed.").into()) },
                TrackMessages::new()
            ),
            b.track(
                async { Err::<(), Error>(FatalError::new("B failed.").into()) },
                TrackMessages::new()
            ),
        );
        assert_eq!(a.unwrap_err().failure().unwrap().message(), "A failed.");
        assert_eq!(b.unwrap_err().failure().unwrap().message(), "B failed.");
        Ok(())
    });
    assert_eq!(run(action, &tty).await, 0);
    assert_eq!(
        support::screen::replay(&tty.transcript(), 80, false).lines,
        ["  log A", "✘ A · 0.0s", "  log B", "✘ B · 0.0s"]
    );
}

#[tokio::test(start_paused = true)]
async fn a_log_stream_completes_only_after_its_source_closes() {
    let pipe = mock_process(fields());
    let action = app(|ctx| async move {
        let line = progress(&ctx, still("Installing"));
        line.log("one");
        let (tx, rx) = channel();
        let mut completion = line.log_stream(rx);
        assert!(
            std::future::poll_fn(|cx| Poll::Ready(completion.as_mut().poll(cx).is_pending())).await
        );
        tx.send(Ok("two\n".to_owned())).unwrap();
        flush().await;
        assert!(
            std::future::poll_fn(|cx| Poll::Ready(completion.as_mut().poll(cx).is_pending())).await
        );
        drop(tx);
        completion.await?;
        line.fail().await
    });
    assert_eq!(run(action, &pipe).await, 0);
    assert_eq!(
        pipe.stderr_text(),
        "ℹ Installing\n  one\n  two\n✘ Installing\n"
    );
}

#[tokio::test(start_paused = true)]
async fn child_markup_delimiters_are_written_literally() {
    let mock = mock_process(fields().script("builder", |_| async {
        Ok(ProgramAnswer::new().stdout("pom \u{E000}x\u{E001}y\u{E002} \u{E003}E000 done\n"))
    }));
    let action = app(|ctx| async move {
        let line = progress(&ctx, still("Building"));
        let out = line.log_output();
        let child = ctx.host.spawn(
            "builder",
            ["run"],
            SpawnOptions::new().stdout(out.child_stream()),
        );
        let _ = child.exited().await;
        out.finish();
        line.fail().await
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        mock.stderr_text(),
        "ℹ Building\n  pom \u{E000}x\u{E001}y\u{E002} \u{E003}E000 done\n✘ Building\n"
    );
}
