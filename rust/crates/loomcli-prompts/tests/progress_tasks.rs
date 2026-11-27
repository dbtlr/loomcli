//! Progress task groups through the mock process, from `progress-tasks.test.ts`.

#![allow(clippy::unwrap_used, missing_docs)]

mod support;

use loomcli_core::{Application, Context, FatalError, RunOptions};
use loomcli_prompts::{ProgressSettings, progress};
use loomcli_testing::{MockFields, MockTerminal, StreamName, mock_process};

#[tokio::test(start_paused = true)]
async fn piped_failure_writes_the_open_task_ends_deepest_first() {
    let mock = mock_process(MockFields::new().env("NO_COLOR", "1").env("TERM", "xterm"));
    let app: support::App = Application::new("deploy").action(|ctx: Context| async move {
        let deploying = progress(&ctx, ProgressSettings::new("Deploying"));
        deploying
            .task(ProgressSettings::new("Building"))
            .task(ProgressSettings::new("Compiling"));
        Err(FatalError::new("The build failed. Fix the errors above, then deploy again.").into())
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        1
    );
    assert_eq!(
        mock.stderr_text(),
        "ℹ Deploying\nℹ   Building\nℹ     Compiling\n✘     Compiling\n✘   Building\n✘ Deploying\nThe build failed. Fix the errors above, then deploy again.\n"
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_task_keeps_its_log_above_its_end_when_its_tree_stays() {
    let mock = mock_process(
        MockFields::new()
            .env("NO_COLOR", "1")
            .env("TERM", "xterm")
            .terminal(MockTerminal::new(80, 15).streams([StreamName::Stderr])),
    );
    let app: support::App = Application::new("deploy").action(|ctx: Context| async move {
        let deploying = progress(&ctx, ProgressSettings::new("Deploying"));
        let building = deploying.task(ProgressSettings::new("Building"));
        building.log("tsc error TS2304");
        building.fail().await?;
        deploying.fail().await
    });
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        support::screen::replay(&mock.transcript(), 80, false).lines,
        [
            "✘ Deploying · 0.0s",
            "    tsc error TS2304",
            "  ✘ Building · 0.0s"
        ]
    );
}

use loomcli_core::{
    __private::observe_progress, Error, FailureFacts, InvocationOutcome, InvocationValues,
    InvokeOptions, ProcessSignal, ProgressEvent, View, ViewContext, lanes, override_view,
};
use loomcli_prompts::views::{ProgressLine, ProgressState, progress_line};
use loomcli_prompts::{Progress, ProgressUpdate, TrackMessages};
use std::sync::{Arc, Mutex};
use support::progress::{Frames, advance, app, builder, fields, mock, rows, run, still, terminal};

fn screen(mock: &loomcli_testing::MockProcess, columns: usize) -> Vec<String> {
    support::screen::replay(&mock.transcript(), columns, false).lines
}

async fn invoked(app: support::App) -> (String, Vec<ProgressEvent>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let watched = events.clone();
    let result = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new()
                .on_progress(move |event| watched.lock().unwrap().push(event.clone())),
            Some(mock_process(fields())),
        )
        .await;
    let messages = match result {
        InvocationOutcome::Completed { messages, .. }
        | InvocationOutcome::Failed { messages, .. } => messages,
        _ => panic!("invoke did not settle"),
    };
    let events = std::mem::take(&mut *events.lock().unwrap());
    (messages, events)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn racing_child_and_root_ends_follow_one_sequential_order() {
    const CHILD_FIRST: &str = "ℹ root\nℹ   child\n✘   child\n✔ root\n";
    const ROOT_FIRST: &str = "ℹ root\nℹ   child\n✔   child\n✔ root\n";

    let action = || {
        app(|ctx| async move {
            let root = progress(&ctx, still("root"));
            let child = root.task(still("child"));
            let barrier = Arc::new(tokio::sync::Barrier::new(2));
            let wait = barrier.clone();
            let worker = tokio::spawn(async move {
                wait.wait().await;
                child.fail().await
            });
            barrier.wait().await;
            let ended = root.end().await;
            worker.await.unwrap()?;
            ended
        })
    };
    for _ in 0..100 {
        let pipe = mock_process(fields());
        assert_eq!(run(action(), &pipe).await, 0);
        let text = pipe.stderr_text();
        assert!(
            matches!(text.as_str(), CHILD_FIRST | ROOT_FIRST),
            "{text:?}"
        );

        let (messages, events) = invoked(action()).await;
        let child_end = match messages.as_str() {
            CHILD_FIRST => "failed",
            ROOT_FIRST => "ended",
            _ => panic!("unexpected messages: {messages:?}"),
        };
        assert_eq!(
            event_rows(&events),
            [
                (1, "started", "root"),
                (2, "started", "child"),
                (2, child_end, "child"),
                (1, "ended", "root"),
            ]
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn racing_task_open_and_root_end_follow_one_sequential_order() {
    const CHILD_FIRST: &str = "ℹ root\nℹ   child\n✔   child\n✔ root\n";
    const ROOT_FIRST: &str = "ℹ root\n✔ root\n";

    let action = || {
        app(|ctx| async move {
            let root = progress(&ctx, still("root"));
            let opener = root.clone();
            let barrier = Arc::new(tokio::sync::Barrier::new(2));
            let wait = barrier.clone();
            let worker = tokio::spawn(async move {
                wait.wait().await;
                opener.task(still("child"));
            });
            barrier.wait().await;
            let ended = root.end().await;
            worker.await.unwrap();
            ended
        })
    };
    for _ in 0..100 {
        let pipe = mock_process(fields());
        assert_eq!(run(action(), &pipe).await, 0);
        let text = pipe.stderr_text();
        assert!(
            matches!(text.as_str(), CHILD_FIRST | ROOT_FIRST),
            "{text:?}"
        );

        let (messages, events) = invoked(action()).await;
        let expected: &[_] = match messages.as_str() {
            CHILD_FIRST => &[
                (1, "started", "root"),
                (2, "started", "child"),
                (2, "ended", "child"),
                (1, "ended", "root"),
            ],
            ROOT_FIRST => &[(1, "started", "root"), (1, "ended", "root")],
            _ => panic!("unexpected messages: {messages:?}"),
        };
        assert_eq!(event_rows(&events), expected);
    }
}

fn event_rows(events: &[ProgressEvent]) -> Vec<(u64, &'static str, &str)> {
    events
        .iter()
        .map(|event| (event.id, event.state.as_str(), event.label.as_str()))
        .collect()
}

async fn race_task_end_against_core_close(cancel: bool) -> (String, Vec<ProgressEvent>) {
    let pipe = mock_process(fields());
    let watched_pipe = pipe.clone();
    let events = Arc::new(Mutex::new(Vec::new()));
    let watched_events = events.clone();
    let (worker, joined) = tokio::sync::oneshot::channel();
    let worker = Mutex::new(Some(worker));
    let action = app(move |ctx| {
        let worker = worker.lock().unwrap().take().unwrap();
        let watched_pipe = watched_pipe.clone();
        async move {
            let root = progress(&ctx, still("root"));
            let child = root.task(still("child"));
            let barrier = Arc::new(tokio::sync::Barrier::new(2));
            let wait = barrier.clone();
            let task = tokio::spawn(async move {
                wait.wait().await;
                child.fail().await
            });
            worker.send(task).unwrap();
            barrier.wait().await;
            if cancel {
                watched_pipe.raise(ProcessSignal::Int);
                ctx.signal.throw_if_cancelled()
            } else {
                Err(FatalError::new("The deploy failed.").into())
            }
        }
    });
    let options = observe_progress(RunOptions::new().process(pipe.clone()), move |event| {
        watched_events.lock().unwrap().push(event.clone());
    });
    assert_eq!(
        action.run(options).await.get(),
        if cancel { 130 } else { 1 }
    );
    joined.await.unwrap().await.unwrap().unwrap();
    let events = std::mem::take(&mut *events.lock().unwrap());
    (pipe.stderr_text(), events)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn racing_task_end_and_action_failure_keep_the_child_line_before_the_root() {
    for _ in 0..100 {
        let (text, events) = race_task_end_against_core_close(false).await;
        assert_eq!(
            text,
            "ℹ root\nℹ   child\n✘   child\n✘ root\nThe deploy failed.\n"
        );
        let rows = event_rows(&events);
        assert_eq!(rows[..2], [(1, "started", "root"), (2, "started", "child")]);
        assert!(
            matches!(
                &rows[2..],
                [(2, "failed", "child"), (1, "failed", "root")]
                    | [(1, "failed", "root"), (2, "failed", "child")]
            ),
            "{rows:?}"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn racing_task_end_and_signal_follow_one_sequential_order() {
    for _ in 0..100 {
        let (text, events) = race_task_end_against_core_close(true).await;
        let ends = match text.as_str() {
            "ℹ root\nℹ   child\n✘   child\n" => {
                [(2, "failed", "child"), (1, "cancelled", "root")]
            }
            "ℹ root\nℹ   child\n" => [(1, "cancelled", "root"), (2, "cancelled", "child")],
            _ => panic!("unexpected stderr: {text:?}"),
        };
        assert_eq!(
            event_rows(&events),
            [
                (1, "started", "root"),
                (2, "started", "child"),
                ends[0],
                ends[1]
            ]
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a_signal_raised_by_the_child_end_observer_waits_to_close_the_root() {
    let pipe = mock_process(fields());
    let raising = pipe.clone();
    let events = Arc::new(Mutex::new(Vec::new()));
    let watched = events.clone();
    let action = app(|ctx| async move {
        let root = progress(&ctx, still("root"));
        root.task(still("child")).fail().await?;
        ctx.signal.throw_if_cancelled()
    });
    let options = observe_progress(RunOptions::new().process(pipe.clone()), move |event| {
        watched.lock().unwrap().push(event.clone());
        if event.state.as_str() == "failed" {
            raising.raise(ProcessSignal::Int);
        }
    });
    assert_eq!(action.run(options).await.get(), 130);
    assert_eq!(pipe.stderr_text(), "ℹ root\nℹ   child\n✘   child\n");
    assert_eq!(
        event_rows(&events.lock().unwrap()),
        [
            (1, "started", "root"),
            (2, "started", "child"),
            (2, "failed", "child"),
            (1, "cancelled", "root"),
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_delayed_view_cannot_paint_an_older_frame_over_a_newer_one() {
    let tty = mock(80, 24);
    let watched = tty.clone();
    let (view_started, started) = tokio::sync::oneshot::channel();
    let (release, view_release) = std::sync::mpsc::channel();
    let pause = Mutex::new(Some((view_started, view_release)));
    let render = Frames::default().render(move |data, _| {
        if data.label == "Older"
            && let Some((view_started, view_release)) = pause.lock().unwrap().take()
        {
            view_started.send(()).unwrap();
            view_release.recv().unwrap();
        }
        Ok(data.label.clone())
    });
    let gate = Mutex::new(Some((started, release)));
    let action = builder().overrides([render]).action(move |ctx| {
        let watched = watched.clone();
        let (started, release) = gate.lock().unwrap().take().unwrap();
        async move {
            let root = progress(&ctx, still("Starting"));
            let worker = root.clone();
            let older = tokio::spawn(async move {
                worker.update(ProgressUpdate::new().label("Older"));
            });
            started.await.unwrap();
            root.update(ProgressUpdate::new().label("Newer"));
            release.send(()).unwrap();
            older.await.unwrap();
            assert_eq!(screen(&watched, 80), ["Newer"]);
            root.clear().await
        }
    });
    assert_eq!(run(action, &tty).await, 0);
}

#[tokio::test(start_paused = true)]
async fn a_frame_takes_its_stderr_turn_when_the_tasks_budget_is_exhausted() {
    let tty = mock(80, 24);
    let watched = tty.clone();
    let action = app(move |ctx| {
        let watched = watched.clone();
        async move {
            let root = progress(&ctx, still("Starting"));
            let worker = root.clone();
            tokio::spawn(async move {
                while tokio::task::coop::has_budget_remaining() {
                    tokio::task::consume_budget().await;
                }
                worker.update(ProgressUpdate::new().label("Updated"));
                assert_eq!(screen(&watched, 80), ["◐ Updated · 0.0s"]);
            })
            .await
            .unwrap();
            root.clear().await
        }
    });
    assert_eq!(run(action, &tty).await, 0);
}

#[tokio::test(start_paused = true)]
async fn nested_tasks_draw_under_their_parents_in_opening_order() {
    let tty = mock(80, 24);
    let watched = tty.clone();
    let action = app(move |ctx| {
        let watched = watched.clone();
        async move {
            let deploying = progress(&ctx, still("Deploying"));
            let unrelated = progress(&ctx, still("Watching the logs"));
            let building = deploying.task(still("Building the image"));
            let compiling = building.task(still("Compiling"));
            compiling.task(still("Parsing"));
            let pushing = deploying.task(still("Pushing the image").total(3.0));
            pushing.update(ProgressUpdate::new().completed(1.0));
            assert_eq!(
                screen(&watched, 80),
                [
                    "◐ Deploying · 0.0s",
                    "  ◐ Building the image · 0.0s",
                    "    ◐ Compiling · 0.0s",
                    "      ◐ Parsing · 0.0s",
                    "  ◐ Pushing the image ▰▰▰▱▱▱▱▱▱▱ 1/3 · 0.0s",
                    "◐ Watching the logs · 0.0s",
                ]
            );
            deploying.end().await?;
            unrelated.end().await
        }
    });
    assert_eq!(run(action, &tty).await, 0);
    assert_eq!(
        screen(&tty, 80),
        ["✔ Deploying · 0.0s", "✔ Watching the logs · 0.0s"]
    );
}

#[tokio::test(start_paused = true)]
async fn every_task_end_appears_in_place_while_its_parent_runs() {
    for (end, expected) in [
        (0, Some("  ✔ Built the image · 0.1s")),
        (1, Some("  ℹ Built nothing · 0.1s")),
        (2, Some("  ✘ Building the image · 0.1s")),
        (3, Some("  ⚠ Built with 2 warnings · 0.1s")),
        (4, Some("  ✔ Built 3 layers · 0.1s")),
        (5, Some("  ✘ Ran out of space · 0.1s")),
        (6, None),
    ] {
        let tty = mock(80, 24);
        let watched = tty.clone();
        let action = app(move |ctx| {
            let watched = watched.clone();
            async move {
                let root = progress(&ctx, still("Deploying"));
                let task = root.task(still("Building the image"));
                let pushing = root.task(still("Pushing the image"));
                advance(100).await;
                match end {
                    0 => task.end_with("Built the image").await?,
                    1 => task.skip_with("Built nothing").await?,
                    2 => task.fail().await?,
                    3 => task.warn_with("Built with 2 warnings").await?,
                    4 => {
                        assert_eq!(
                            task.track(
                                async { Ok(3) },
                                TrackMessages::new()
                                    .done(|count: &i32| format!("Built {count} layers"))
                            )
                            .await?,
                            3
                        );
                    }
                    5 => {
                        let failure = task
                            .track(
                                async { Err::<(), Error>(FatalError::new("No space.").into()) },
                                TrackMessages::new().failed(|_| "Ran out of space".to_owned()),
                            )
                            .await
                            .unwrap_err();
                        assert_eq!(failure.failure().unwrap().message(), "No space.");
                    }
                    _ => task.clear().await?,
                }
                let expected: Vec<_> = ["◐ Deploying · 0.1s"]
                    .into_iter()
                    .chain(expected)
                    .chain(["  ◐ Pushing the image · 0.1s"])
                    .collect();
                assert_eq!(screen(&watched, 80), expected);
                advance(800).await;
                pushing.update(ProgressUpdate::new());
                if let Some(expected) = expected.get(1).filter(|_| end != 6) {
                    assert_eq!(screen(&watched, 80)[1], *expected);
                }
                root.end().await
            }
        });
        assert_eq!(run(action, &tty).await, 0);
        assert_eq!(screen(&tty, 80), ["✔ Deploying · 0.9s"]);
    }
}

#[tokio::test(start_paused = true)]
async fn a_parent_passes_its_outcome_to_open_tasks_and_controls_collapse() {
    for (end, keep, expected) in [
        (0, false, vec!["✔ Deployed · 0.1s"]),
        (1, false, vec!["ℹ Skipped · 0.1s"]),
        (
            0,
            true,
            vec![
                "✔ Deployed · 0.1s",
                "  ✔ Built the image · 0.1s",
                "  ✔ Pushing · 0.1s",
                "    ✔ Uploading · 0.1s",
            ],
        ),
        (
            1,
            true,
            vec![
                "ℹ Skipped · 0.1s",
                "  ✔ Built the image · 0.1s",
                "  ℹ Pushing · 0.1s",
                "    ℹ Uploading · 0.1s",
            ],
        ),
        (
            2,
            false,
            vec![
                "✘ Deploying · 0.1s",
                "  ✔ Built the image · 0.1s",
                "  ✘ Pushing · 0.1s",
                "    ✘ Uploading · 0.1s",
            ],
        ),
        (
            3,
            false,
            vec![
                "⚠ Deployed with problems · 0.1s",
                "  ✔ Built the image · 0.1s",
                "  ⚠ Pushing · 0.1s",
                "    ⚠ Uploading · 0.1s",
            ],
        ),
        (4, true, vec![]),
    ] {
        let tty = mock(80, 24);
        let action = app(move |ctx| async move {
            let settings = still("Deploying");
            let root = progress(
                &ctx,
                if keep {
                    settings.keep_tasks()
                } else {
                    settings
                },
            );
            let building = root.task(still("Building"));
            let pushing = root.task(still("Pushing").keep_tasks());
            pushing.task(still("Uploading"));
            advance(100).await;
            building.end_with("Built the image").await?;
            match end {
                0 => root.end_with("Deployed").await,
                1 => root.skip_with("Skipped").await,
                2 => root.fail().await,
                3 => root.warn_with("Deployed with problems").await,
                _ => root.clear().await,
            }
        });
        assert_eq!(run(action, &tty).await, 0);
        assert_eq!(screen(&tty, 80), expected);
    }
}

#[tokio::test(start_paused = true)]
async fn a_nested_group_follows_its_own_outcome_and_keep_setting() {
    for (failed, keep) in [(false, false), (false, true), (true, false)] {
        let tty = mock(80, 24);
        let watched = tty.clone();
        let action = app(move |ctx| {
            let watched = watched.clone();
            async move {
                let root = progress(&ctx, still("Deploying").keep_tasks());
                let settings = still("Building");
                let building = root.task(if keep {
                    settings.keep_tasks()
                } else {
                    settings
                });
                let compiling = building.task(still("Compiling"));
                compiling.log("compiler warning");
                compiling.update(ProgressUpdate::new());
                assert_eq!(
                    screen(&watched, 80),
                    [
                        "◐ Deploying · 0.0s",
                        "  ◐ Building · 0.0s",
                        "    ◐ Compiling · 0.0s",
                        "      compiler warning",
                    ]
                );
                if failed {
                    building.fail().await?;
                } else {
                    building.end().await?;
                }
                let running = screen(&watched, 80);
                assert_eq!(running.len(), if failed || keep { 3 } else { 2 });
                if failed {
                    assert_eq!(running[2], "    ✘ Compiling · 0.0s");
                }
                // Completion keeps the root's tasks and the nested group's own decision.
                Ok(())
            }
        });
        assert_eq!(run(action, &tty).await, 0);
        let ended = screen(&tty, 80);
        assert_eq!(ended[0], "✔ Deploying · 0.0s");
        assert_eq!(
            ended.len(),
            if failed {
                4
            } else if keep {
                3
            } else {
                2
            }
        );
    }
}

#[tokio::test(start_paused = true)]
async fn completion_collapses_a_failed_tasks_retained_log_and_handles_can_be_dropped() {
    let tty = mock(80, 24);
    let action = app(|ctx| async move {
        let root = progress(&ctx, still("Deploying"));
        let task = root.task(still("Building"));
        let clone = task.clone();
        drop(task);
        let work = tokio::spawn(async move {
            clone.log("compiler error");
            clone.fail().await
        });
        work.await.unwrap()?;
        drop(root);
        Ok(())
    });
    assert_eq!(run(action, &tty).await, 0);
    assert_eq!(screen(&tty, 80), ["✔ Deploying · 0.0s"]);
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_tree_keeps_each_lines_log_and_a_failing_run_writes_the_tree_before_its_report()
{
    for cancel in [false, true] {
        let tty = mock(80, 24);
        let action = app(move |ctx| async move {
            let root = progress(&ctx, still("Deploying").log_limit(1));
            root.log("dropped\nroot log");
            let task = root.task(still("Building").log_limit(1));
            task.log("dropped\nchild log");
            let child = task.task(still("Compiling"));
            child.log("compiler log");
            if cancel {
                ctx.cancel();
                Ok(())
            } else {
                Err(FatalError::new("The build failed.").into())
            }
        });
        assert_eq!(run(action, &tty).await, if cancel { 130 } else { 1 });
        let prefix = if cancel { "■" } else { "✘" };
        let suffix = if cancel { " (cancelled)" } else { " · 0.0s" };
        let mut expected = vec![
            "  1 earlier line was dropped.".to_owned(),
            "  root log".to_owned(),
            format!("{prefix} Deploying{suffix}"),
            "    1 earlier line was dropped.".to_owned(),
            "    child log".to_owned(),
            format!("  {prefix} Building{suffix}"),
            "      compiler log".to_owned(),
            format!("    {prefix} Compiling{suffix}"),
        ];
        if !cancel {
            expected.push("The build failed.".to_owned());
        }
        assert_eq!(screen(&tty, 80), expected);
    }
}

async fn out_of_order(ctx: Context) -> Result<(), Error> {
    let root = progress(&ctx, still("Deploying"));
    let building = root.task(still("Building the image"));
    let compiling = building.task(still("Compiling"));
    let pushing = root.task(still("Pushing the image"));
    compiling.end_with("Compiled").await?;
    pushing.log("npm error code E404");
    pushing.fail().await?;
    root.task(still("Cleaning up"));
    root.warn_with("Deployed with problems").await
}

const PLAIN_TASKS: &str = concat!(
    "ℹ Deploying\nℹ   Building the image\nℹ     Compiling\nℹ   Pushing the image\n",
    "✔     Compiled\n    npm error code E404\n✘   Pushing the image\nℹ   Cleaning up\n",
    "⚠   Building the image\n⚠   Cleaning up\n⚠ Deployed with problems\n",
);

#[tokio::test(start_paused = true)]
async fn all_plain_modes_and_invoke_write_task_lines_when_they_happen() {
    for (args, env, tty) in [
        (&[][..], ("TERM", "xterm"), false),
        (&[][..], ("TERM", "dumb"), true),
        (&[][..], ("CI", "true"), true),
        (&["--plain"][..], ("TERM", "xterm"), true),
    ] {
        let fields = fields().argv(args.iter().copied()).env(env.0, env.1);
        let mock = mock_process(if tty {
            fields.terminal(terminal(80, 24))
        } else {
            fields
        });
        assert_eq!(run(app(out_of_order), &mock).await, 0);
        assert_eq!(mock.stderr_text(), PLAIN_TASKS);
    }
    let mock = mock_process(fields().argv(["-q"]));
    assert_eq!(run(app(out_of_order), &mock).await, 0);
    assert_eq!(
        mock.stderr_text(),
        "    npm error code E404\n✘   Pushing the image\n⚠   Building the image\n⚠   Cleaning up\n⚠ Deployed with problems\n"
    );
    let (messages, _) = invoked(app(out_of_order)).await;
    assert_eq!(messages, PLAIN_TASKS);
}

#[tokio::test(start_paused = true)]
async fn plain_continuation_lines_and_lane_overrides_receive_the_task_indent() {
    let mock = mock_process(fields());
    let overrides = [
        override_view(
            lanes::info(),
            View::new(|text: &str, _| format!("info<{text}>")),
        ),
        override_view(
            lanes::success(),
            View::new(|text: &str, _| format!("ok<{text}>")),
        ),
    ];
    let action = builder().overrides(overrides).action(|ctx| async move {
        let root = progress(&ctx, still("Deploying"));
        let task = root.task(still("Building"));
        let writing = task.task(still("Compiling"));
        let label = format!("{}\nsecond line", "a".repeat(200));
        writing.end_with(&label).await?;
        task.end().await?;
        root.end().await
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(
        mock.stderr_text(),
        format!(
            "info<Deploying>\ninfo<  Building>\ninfo<    Compiling>\nok<    {}\n    second line>\nok<  Building>\nok<Deploying>\n",
            "a".repeat(200)
        )
    );
}

#[tokio::test(start_paused = true)]
async fn explicit_failure_reports_each_branch_in_postorder_and_relabels_only_the_root() {
    let action = app(|ctx| async move {
        let root = progress(&ctx, still("Deploying"));
        let building = root.task(still("Building").total(2.0));
        building.update(ProgressUpdate::new().completed(1.0));
        building.task(still("Compiling"));
        root.task(still("Pushing"));
        root.fail_with("Deploy failed").await
    });
    let (messages, events) = invoked(action).await;
    assert_eq!(
        messages,
        "ℹ Deploying\nℹ   Building\nℹ     Compiling\nℹ   Pushing\n✘     Compiling\n✘   Building\n✘   Pushing\n✘ Deploy failed\n"
    );
    assert_eq!(
        event_rows(&events),
        [
            (1, "started", "Deploying"),
            (2, "started", "Building"),
            (2, "updated", "Building"),
            (3, "started", "Compiling"),
            (4, "started", "Pushing"),
            (3, "failed", "Compiling"),
            (2, "failed", "Building"),
            (4, "failed", "Pushing"),
            (1, "failed", "Deploy failed"),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn core_close_reports_in_opening_order_and_writes_each_branch_in_postorder() {
    let action = app(|ctx| async move {
        let root = progress(&ctx, still("Deploying"));
        root.task(still("Building")).task(still("Compiling"));
        root.task(still("Pushing"));
        Err(FatalError::new("The deploy failed. Fix the errors above, then deploy again.").into())
    });
    let (messages, events) = invoked(action).await;
    assert_eq!(
        messages,
        "ℹ Deploying\nℹ   Building\nℹ     Compiling\nℹ   Pushing\n✘     Compiling\n✘   Building\n✘   Pushing\n✘ Deploying\nThe deploy failed. Fix the errors above, then deploy again.\n"
    );
    assert_eq!(
        event_rows(&events),
        [
            (1, "started", "Deploying"),
            (2, "started", "Building"),
            (3, "started", "Compiling"),
            (4, "started", "Pushing"),
            (1, "failed", "Deploying"),
            (2, "failed", "Building"),
            (3, "failed", "Compiling"),
            (4, "failed", "Pushing"),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn explicit_clear_reports_descendants_first_and_completion_writes_their_ends_first() {
    for clear in [false, true] {
        let action = app(move |ctx| async move {
            let root = progress(&ctx, still("Deploying"));
            root.task(still("Building")).task(still("Compiling"));
            if clear {
                root.clear().await?;
            }
            Ok(())
        });
        let (messages, events) = invoked(action).await;
        let starts = "ℹ Deploying\nℹ   Building\nℹ     Compiling\n";
        let (expected_messages, ends) = if clear {
            (
                starts.to_owned(),
                [
                    (3, "ended", "Compiling"),
                    (2, "ended", "Building"),
                    (1, "ended", "Deploying"),
                ],
            )
        } else {
            (
                format!("{starts}✔     Compiling\n✔   Building\n✔ Deploying\n"),
                [
                    (1, "ended", "Deploying"),
                    (2, "ended", "Building"),
                    (3, "ended", "Compiling"),
                ],
            )
        };
        assert_eq!(messages, expected_messages);
        let rows = event_rows(&events);
        assert_eq!(
            rows[..3],
            [
                (1, "started", "Deploying"),
                (2, "started", "Building"),
                (3, "started", "Compiling")
            ]
        );
        assert_eq!(rows[3..], ends);
    }
}

#[tokio::test(start_paused = true)]
async fn every_parent_end_makes_later_tasks_and_task_updates_inert() {
    for end in 0..5 {
        let action = app(move |ctx| async move {
            let root = progress(&ctx, still("Deploying"));
            let task = root.task(still("Building"));
            match end {
                0 => root.end().await?,
                1 => root.skip().await?,
                2 => root.warn().await?,
                3 => root.fail().await?,
                _ => root.clear().await?,
            }
            let late = task.task(still("Too late")).task(still("Also too late"));
            late.update(ProgressUpdate::new().completed(1.0));
            late.log("ignored");
            late.warn().await?;
            task.fail().await?;
            let work = async { Err::<(), Error>(FatalError::new("Work failed.").into()) };
            let error = task
                .track(
                    work,
                    TrackMessages::new().failed(|_| panic!("called after close")),
                )
                .await
                .unwrap_err();
            assert_eq!(error.failure().unwrap().message(), "Work failed.");
            assert_eq!(
                late.track(
                    async { Ok(3) },
                    TrackMessages::new().done(|_| panic!("called after close"))
                )
                .await?,
                3
            );
            Ok(())
        });
        let (messages, events) = invoked(action).await;
        assert!(!messages.contains("late"));
        assert_eq!(events.len(), 4);
    }
}

#[tokio::test(start_paused = true)]
async fn the_view_gets_depth_and_tasks_while_existing_flat_overrides_draw_kept_ends_individually() {
    let tty = mock(80, 24);
    let frames = Frames::default();
    let action = builder()
        .overrides([frames.render(|data, _| Ok(data.label.clone()))])
        .action(|ctx| async move {
            let root = progress(&ctx, still("Deploying"));
            let task = root.task(still("Building"));
            task.task(still("Compiling"));
            task.log("was a warning");
            root.fail().await
        });
    assert_eq!(run(action, &tty).await, 0);
    let frames = frames.take();
    assert_eq!(frames[2].data.depth, 0);
    assert_eq!(frames[2].data.tasks[0].depth, 1);
    assert_eq!(frames[2].data.tasks[0].tasks[0].depth, 2);
    assert_eq!(frames[2].text, "Deploying");
    assert!(frames[3..].iter().all(|frame| frame.data.tasks.is_empty()));
    assert_eq!(
        screen(&tty, 80),
        ["Deploying", "    was a warning", "Building", "Compiling"]
    );
}

#[tokio::test(start_paused = true)]
async fn opening_a_task_on_full_rows_first_shrinks_the_other_root() {
    let tty = mock(80, 6);
    let watched = tty.clone();
    let action = app(move |ctx| {
        let watched = watched.clone();
        async move {
            let first = progress(&ctx, still("Watching"));
            first.log("log a\nlog b\nlog c\nlog d\nlog e\nlog f");
            advance(100).await;
            first.update(ProgressUpdate::new());
            let root = progress(&ctx, still("Deploying"));
            root.task(still("Building"));
            assert_eq!(
                screen(&watched, 80),
                [
                    "◐ Watching · 0.1s",
                    "  log d",
                    "  log e",
                    "  log f",
                    "◐ Deploying · 0.0s",
                    "  ◐ Building · 0.0s",
                ]
            );
            Ok(())
        }
    });
    assert_eq!(run(action, &tty).await, 0);
}

#[tokio::test(start_paused = true)]
async fn finished_rows_yield_to_logs_and_a_new_root_but_kept_trees_print_every_task() {
    for logs_first in [false, true] {
        let tty = mock(80, 5);
        let watched = tty.clone();
        let action = app(move |ctx| {
            let watched = watched.clone();
            async move {
                let logged = logs_first.then(|| progress(&ctx, still("Watching")));
                let root = progress(&ctx, still("Deploying"));
                for step in 1..=6 {
                    root.task(still(&format!("Step {step}"))).end().await?;
                }
                let logged = logged.unwrap_or_else(|| progress(&ctx, still("Watching")));
                logged.log(&rows("log", 6));
                root.update(ProgressUpdate::new());
                logged.update(ProgressUpdate::new());
                root.update(ProgressUpdate::new());
                assert!(!screen(&watched, 80).iter().any(|row| row.contains("Step")));
                assert!(screen(&watched, 80).iter().any(|row| row == "  log 6"));
                root.fail().await?;
                logged.update(ProgressUpdate::new());
                assert!(screen(&watched, 80).iter().any(|row| row == "  log 3"));
                logged.end().await
            }
        });
        assert_eq!(run(action, &tty).await, 0);
        assert_eq!(
            screen(&tty, 80),
            [
                "✘ Deploying · 0.0s",
                "  ✔ Step 1 · 0.0s",
                "  ✔ Step 2 · 0.0s",
                "  ✔ Step 3 · 0.0s",
                "  ✔ Step 4 · 0.0s",
                "  ✔ Step 5 · 0.0s",
                "  ✔ Step 6 · 0.0s",
                "✔ Watching · 0.0s",
            ]
        );
    }
}

#[tokio::test(start_paused = true)]
async fn the_newest_finished_tasks_fill_only_the_rows_left_by_live_task_logs() {
    let tty = mock(80, 8);
    let watched = tty.clone();
    let frames = Frames::default();
    let action = builder().overrides([frames.view()]).action(move |ctx| {
        let watched = watched.clone();
        async move {
            let root = progress(&ctx, still("Deploying"));
            for (name, end) in [
                ("one", "Did one"),
                ("two", "Did two"),
                ("three", "Did three"),
                ("four", "Did four"),
            ] {
                let task = root.task(still(name));
                advance(100).await;
                task.end_with(end).await?;
            }
            let pushing = root.task(still("Pushing"));
            pushing.log("log a\nlog b\nlog c\nlog d\nlog e\nlog f");
            advance(100).await;
            pushing.update(ProgressUpdate::new());
            assert_eq!(
                screen(&watched, 80),
                [
                    "◐ Deploying · 0.5s",
                    "  ✔ Did four · 0.1s",
                    "  ◐ Pushing · 0.1s",
                    "    log b",
                    "    log c",
                    "    log d",
                    "    log e",
                    "    log f",
                ]
            );
            pushing.fail().await?;
            assert_eq!(screen(&watched, 80).len(), 6);
            root.fail().await
        }
    });
    assert_eq!(run(action, &tty).await, 0);
    assert!(
        frames
            .take()
            .iter()
            .all(|frame| frame.text.lines().count() <= 8)
    );
    assert_eq!(screen(&tty, 80).len(), 12);
}

#[tokio::test(start_paused = true)]
async fn live_task_logs_wait_for_a_frame_and_collapse_with_the_tree() {
    let tty = mock(80, 3);
    let watched = tty.clone();
    let action = app(move |ctx| {
        let watched = watched.clone();
        async move {
            let root = progress(&ctx, still("Deploying"));
            let task = root.task(still("Pushing"));
            task.log(&rows("task log", 5));
            assert_eq!(screen(&watched, 80).len(), 2);
            task.update(ProgressUpdate::new());
            assert_eq!(
                screen(&watched, 80),
                ["◐ Deploying · 0.0s", "  ◐ Pushing · 0.0s", "    task log 5"]
            );
            root.end().await
        }
    });
    assert_eq!(run(action, &tty).await, 0);
    assert_eq!(screen(&tty, 80), ["✔ Deploying · 0.0s"]);
}

fn base_line(label: impl Into<String>) -> ProgressLine {
    ProgressLine::new(ProgressState::Running, label)
        .frame("◓")
        .counts(Some(40.0), Some(120.0))
        .elapsed(12_000)
        .estimate(true, Some(10.0 / 3.0), Some(24_000.0), None)
}

async fn view_rows(columns: u16, data: Vec<ProgressLine>) -> String {
    let mock = mock_process(
        fields().terminal(MockTerminal::new(columns, 24).streams([StreamName::Stdout])),
    );
    let action = app(move |ctx| {
        let data = data.clone();
        async move {
            let view = View::new(|line: &ProgressLine, ctx: &ViewContext| {
                progress_line().render(line, ctx).map(|text| text + "\n")
            });
            for line in &data {
                ctx.out.render(line, &view).await?;
            }
            Ok(())
        }
    });
    assert_eq!(run(action, &mock).await, 0);
    mock.stdout_text()
}

#[tokio::test(start_paused = true)]
async fn every_width_keeps_running_rows_on_one_line_including_their_indent() {
    for columns in 1..=80 {
        let line = base_line("x".repeat(60));
        let rendered = view_rows(columns, vec![line.clone(), line.depth(2)]).await;
        let lines: Vec<_> = rendered.lines().collect();
        assert_eq!(lines.len(), 2);
        for line in lines {
            assert!(
                line.chars().count() <= usize::from(columns),
                "{columns}: {line:?}"
            );
        }
    }
}

#[tokio::test(start_paused = true)]
async fn the_default_view_drops_each_piece_in_order_at_narrow_widths() {
    for (columns, row) in [
        (
            69,
            "◓ Fetching records ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · 3.3/s · about 24s left",
        ),
        (
            68,
            "◓ Fetching records ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · about 24s left",
        ),
        (
            61,
            "◓ Fetching records ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · about 24s left",
        ),
        (60, "◓ Fetching records ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s"),
        (44, "◓ Fetching records ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s"),
        (36, "◓ Fetchin… ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s"),
        (29, "◓ … ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s"),
        (28, "◓ … 40/120 · 12.0s"),
        (18, "◓ … 40/120 · 12.0s"),
        (17, "◓ … 40/120"),
        (10, "◓ … 40/120"),
        (9, "◓ …"),
        (3, "◓ …"),
        (2, "◓ "),
        (1, "◓"),
    ] {
        assert_eq!(
            view_rows(columns, vec![base_line("Fetching records")]).await,
            format!("{row}\n")
        );
        assert_eq!(
            view_rows(columns + 4, vec![base_line("Fetching records").depth(2)]).await,
            format!("    {row}\n")
        );
    }
}

#[tokio::test(start_paused = true)]
async fn hand_built_trees_fit_finished_rows_but_standalone_ends_keep_multiline_labels() {
    let task = ProgressLine::new(ProgressState::Failed, "First\nSecond line is too long").depth(1);
    let root = ProgressLine::new(ProgressState::Running, "Root\nSecond line")
        .frame("◐")
        .tasks(vec![task.clone()]);
    let rendered = view_rows(40, vec![root, task]).await;
    assert_eq!(
        rendered,
        "◐ Root… · 0.0s\n  ✘ First… · 0.0s\n  ✘ First\nSecond line is too long · 0.0s\n"
    );
}

#[tokio::test(start_paused = true)]
async fn a_kept_tree_is_queued_before_its_waiter_and_before_other_stderr_writes() {
    let tty = mock(80, 24);
    let action = app(|ctx| async move {
        let first = progress(&ctx, still("Deploying"));
        first.task(still("Building")).log("compiler error");
        let second = progress(&ctx, still("Cleaning"));
        second.task(still("Removing")).log("permission denied");
        let first = first.fail();
        let second = second.warn();
        ctx.out.info("after both").await?;
        first.await?;
        second.await
    });
    assert_eq!(run(action, &tty).await, 0);
    assert_eq!(
        screen(&tty, 80),
        [
            "✘ Deploying · 0.0s",
            "    compiler error",
            "  ✘ Building · 0.0s",
            "⚠ Cleaning · 0.0s",
            "    permission denied",
            "  ⚠ Removing · 0.0s",
            "ℹ after both",
        ]
    );
}

fn _assert_owned_handle_traits() {
    fn owned<T: Clone + Send + Sync + 'static>() {}
    owned::<Progress>();
}

#[tokio::test(start_paused = true)]
async fn long_finished_rows_leave_no_stale_rows_after_collapse() {
    for (columns, height, count) in [(80, 24, 30), (40, 8, 10)] {
        let tty = mock(columns, height);
        let watched = tty.clone();
        let frames = Frames::default();
        let action = builder().overrides([frames.view()]).action(move |ctx| {
            let watched = watched.clone();
            async move {
                let root = progress(&ctx, still("Copying"));
                for index in 0..count {
                    let name = format!("Uploading packages/frontend/src/components/dashboard/widgets/Chart{index:02}.tsx");
                    root.task(still(&name)).end().await?;
                }
                root.update(ProgressUpdate::new());
                let mut expected = vec!["◐ Copying · 0.0s".to_owned()];
                for index in count + 1 - height..count {
                    expected.push(if columns == 80 {
                        format!("  ✔ Uploading packages/frontend/src/components/dashboard/widgets/Chart{index:02}… · 0.0s")
                    } else {
                        "  ✔ Uploading packages/frontend/… · 0.0s".to_owned()
                    });
                }
                assert_eq!(screen(&watched, usize::from(columns)), expected);
                root.end().await
            }
        });
        assert_eq!(run(action, &tty).await, 0);
        assert_eq!(screen(&tty, usize::from(columns)), ["✔ Copying · 0.0s"]);
        for frame in frames.take() {
            assert!(frame.text.lines().count() <= usize::from(height));
            assert!(
                frame
                    .text
                    .lines()
                    .all(|line| line.chars().count() <= usize::from(columns))
            );
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_new_root_takes_a_row_from_a_tree_of_finished_tasks() {
    let tty = mock(80, 10);
    let watched = tty.clone();
    let action = app(move |ctx| {
        let watched = watched.clone();
        async move {
            let root = progress(&ctx, still("Deploying"));
            for index in 0..12 {
                root.task(still(&format!("Step {index}"))).end().await?;
            }
            let watching = progress(&ctx, still("Watching"));
            assert_eq!(
                screen(&watched, 80),
                [
                    "◐ Deploying · 0.0s",
                    "  ✔ Step 4 · 0.0s",
                    "  ✔ Step 5 · 0.0s",
                    "  ✔ Step 6 · 0.0s",
                    "  ✔ Step 7 · 0.0s",
                    "  ✔ Step 8 · 0.0s",
                    "  ✔ Step 9 · 0.0s",
                    "  ✔ Step 10 · 0.0s",
                    "  ✔ Step 11 · 0.0s",
                    "◐ Watching · 0.0s",
                ]
            );
            root.end().await?;
            watching.end().await
        }
    });
    assert_eq!(run(action, &tty).await, 0);
}

#[tokio::test(start_paused = true)]
async fn a_finished_task_cannot_open_another_task_while_its_root_runs() {
    let (messages, events) = invoked(app(|ctx| async move {
        let tree = progress(&ctx, still("Deploying"));
        let finished = tree.task(still("Building"));
        finished.end().await?;
        let late = finished.task(still("Too late"));
        late.warn().await?;
        tree.end().await
    }))
    .await;
    assert_eq!(
        messages,
        "ℹ Deploying\nℹ   Building\n✔   Building\n✔ Deploying\n"
    );
    assert_eq!(
        events
            .iter()
            .map(|event| (event.label.as_str(), event.state.as_str()))
            .collect::<Vec<_>>(),
        [
            ("Deploying", "started"),
            ("Building", "started"),
            ("Building", "ended"),
            ("Deploying", "ended")
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn piped_cancellation_keeps_task_diagnostics_without_an_end_line() {
    let pipe = mock_process(fields());
    let action = app(|ctx| async move {
        let tree = progress(&ctx, still("Deploying"));
        tree.task(still("Building")).log("half built");
        ctx.cancel();
        Ok(())
    });
    assert_eq!(run(action, &pipe).await, 130);
    assert_eq!(
        pipe.stderr_text(),
        "ℹ Deploying\nℹ   Building\n    half built\n"
    );
}
