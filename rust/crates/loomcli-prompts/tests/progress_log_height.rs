//! The shared terminal height cases from `progress-log-height.test.ts`.

#![allow(clippy::unwrap_used, missing_docs)]

mod support;

use loomcli_core::{Activation, Application, MiddlewareContext, Next, NoInputs, Plugin};
use loomcli_prompts::views::ProgressState;
use loomcli_prompts::{Progress, ProgressUpdate, progress};
use support::progress::{Frames, app, builder, mock, rows, run, still};

fn draw(lines: &[Progress]) {
    for line in lines {
        line.update(ProgressUpdate::new());
    }
}

#[tokio::test(start_paused = true)]
async fn the_terminal_budget_splits_in_opening_order_and_grows_after_an_end() {
    for (height, count, expected) in [
        (10, 2, vec![4, 4]),
        (24, 5, vec![4, 4, 4, 4, 3]),
        (10, 3, vec![3, 2, 2]),
    ] {
        let mock = mock(60, height);
        let recorded = Frames::default();
        let frames = recorded.clone();
        let read = mock.clone();
        let app = builder().overrides([recorded.view()]).action(move |ctx| {
            let frames = frames.clone();
            let read = read.clone();
            let expected = expected.clone();
            async move {
                let lines: Vec<_> = (1..=count)
                    .map(|n| {
                        let name = format!("install {n}");
                        let line = progress(&ctx, still(&name));
                        line.log(&rows(&format!("{name} line"), 6));
                        line
                    })
                    .collect();
                draw(&lines);
                for (index, share) in expected.into_iter().enumerate() {
                    assert_eq!(
                        frames
                            .lengths(&format!("install {}", index + 1))
                            .last()
                            .copied(),
                        Some(share)
                    );
                }
                let screen = support::screen::replay(&read.transcript(), 60, false).lines;
                assert_eq!(screen.len(), usize::from(height));
                for row in &screen {
                    assert_eq!(screen.iter().filter(|item| *item == row).count(), 1);
                }
                for line in &lines {
                    line.end().await?;
                }
                Ok(())
            }
        });
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(
            support::screen::replay(&mock.transcript(), 60, false).lines,
            (1..=count)
                .map(|n| format!("✔ install {n} · 0.0s"))
                .collect::<Vec<_>>()
        );
    }

    let mock = mock(60, 10);
    let frames = Frames::default();
    let app = builder()
        .overrides([frames.view()])
        .action(|ctx| async move {
            let lines = ["first", "second", "third"].map(|name| {
                let line = progress(&ctx, still(name));
                line.log(&rows(name, 6));
                line
            });
            draw(&lines);
            draw(&lines);
            lines[0].end().await?;
            draw(&lines);
            draw(&lines);
            lines[1].end().await?;
            lines[2].end().await
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(frames.lengths("first"), [0, 3, 3]);
    assert_eq!(frames.lengths("second"), [0, 2, 2, 4, 4]);
    assert_eq!(frames.lengths("third"), [0, 2, 2, 4, 4]);
}

#[tokio::test(start_paused = true)]
async fn opening_on_full_rows_redraws_preceding_lines_in_opening_order() {
    let mock = mock(60, 7);
    let frames = Frames::default();
    let app = builder()
        .overrides([frames.view()])
        .action(|ctx| async move {
            let first = progress(&ctx, still("first"));
            let second = progress(&ctx, still("second"));
            first.log(&rows("first line", 6));
            second.log(&rows("second line", 6));
            first.update(ProgressUpdate::new());
            second.update(ProgressUpdate::new());
            progress(&ctx, still("third")).clear().await?;
            first.end().await?;
            second.end().await
        });
    assert_eq!(run(app, &mock).await, 0);
    let opened: Vec<_> = frames
        .take()
        .into_iter()
        .filter(|frame| frame.data.state == ProgressState::Running)
        .map(|frame| (frame.data.label, frame.data.log.len()))
        .collect();
    assert_eq!(
        opened
            .iter()
            .map(|(label, count)| (label.as_str(), *count))
            .collect::<Vec<_>>(),
        [
            ("first", 0),
            ("second", 0),
            ("first", 3),
            ("second", 2),
            ("first", 2),
            ("second", 2),
            ("third", 0)
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn resizing_and_clearing_change_the_room_at_the_next_frame() {
    let mock = mock(60, 10);
    let read = mock.clone();
    let frames = Frames::default();
    let app = builder().overrides([frames.view()]).action(move |ctx| {
        let read = read.clone();
        async move {
            let lines = ["first", "second"].map(|name| {
                let line = progress(&ctx, still(name));
                line.log(&rows(name, 6));
                line
            });
            draw(&lines);
            read.resize(60, 4);
            draw(&lines);
            draw(&lines);
            read.resize(60, 10);
            draw(&lines);
            lines[0].clear().await?;
            draw(&lines);
            lines[1].end().await
        }
    });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(frames.lengths("first"), [0, 4, 0, 1, 4]);
    assert_eq!(frames.lengths("second"), [0, 4, 1, 1, 4, 5]);
}

#[tokio::test(start_paused = true)]
async fn zero_log_rows_take_no_share_and_unknown_height_leaves_each_log_unfitted() {
    for (height, own_rows, expected) in [(7, 0, [0, 5]), (0, 5, [5, 5])] {
        let frames = Frames::default();
        let app = builder()
            .overrides([frames.view()])
            .action(move |ctx| async move {
                let first = progress(&ctx, still("first").log_rows(own_rows));
                let second = progress(&ctx, still("second"));
                first.log(&rows("first", 6));
                second.log(&rows("second", 6));
                draw(&[first, second]);
                Ok(())
            });
        assert_eq!(run(app, &mock(60, height)).await, 0);
        assert_eq!(frames.lengths("first"), [0, expected[0]]);
        assert_eq!(frames.lengths("second"), [0, expected[1]]);
    }
}

#[tokio::test(start_paused = true)]
async fn middleware_and_action_share_the_height_until_the_actions_regions_close() {
    let frames = Frames::default();
    let around = Plugin::new("@fixture/around").middleware(
        Activation::Always,
        |ctx: MiddlewareContext<NoInputs>, next: Next| async move {
            let outside = progress(&ctx, still("outer"));
            outside.log(&rows("outer", 6));
            let outcome = next.run().await;
            outside.update(ProgressUpdate::new());
            outside.end().await?;
            outcome.map(|_| ())
        },
    );
    let app = Application::new("height")
        .plugins([around])
        .overrides([frames.view()])
        .action(|ctx| async move {
            let inside = progress(&ctx, still("inner"));
            inside.log(&rows("inner", 6));
            inside.update(ProgressUpdate::new());
            Ok(())
        });
    assert_eq!(run(app, &mock(60, 6)).await, 0);
    assert_eq!(frames.lengths("outer"), [0, 5]);
    assert_eq!(frames.lengths("inner"), [0, 2]);
}

#[tokio::test(start_paused = true)]
async fn concurrent_runs_keep_separate_layouts() {
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let one = async {
        let barrier = barrier.clone();
        let frames = Frames::default();
        let app = builder().overrides([frames.view()]).action(move |ctx| {
            let barrier = barrier.clone();
            async move {
                let line = progress(&ctx, still("alone"));
                line.log(&rows("line", 6));
                barrier.wait().await;
                line.update(ProgressUpdate::new());
                barrier.wait().await;
                line.end().await
            }
        });
        assert_eq!(run(app, &mock(60, 6)).await, 0);
        assert_eq!(frames.lengths("alone"), [0, 5]);
    };
    let two = async {
        let barrier = barrier.clone();
        let frames = Frames::default();
        let app = builder().overrides([frames.view()]).action(move |ctx| {
            let barrier = barrier.clone();
            async move {
                let line = progress(&ctx, still("separate"));
                line.log(&rows("line", 6));
                barrier.wait().await;
                line.update(ProgressUpdate::new());
                barrier.wait().await;
                line.end().await
            }
        });
        assert_eq!(run(app, &mock(60, 6)).await, 0);
        assert_eq!(frames.lengths("separate"), [0, 5]);
    };
    tokio::join!(one, two);
}

#[tokio::test(start_paused = true)]
async fn overrides_receive_the_height_fitted_rows_but_failure_keeps_the_whole_log() {
    let mock = mock(60, 6);
    let frames = Frames::default();
    let view = frames.render(|data, _| {
        Ok(std::iter::once(data.label.clone())
            .chain(data.log.iter().map(|row| format!("> {row}")))
            .collect::<Vec<_>>()
            .join("\n"))
    });
    let app = builder().overrides([view]).action(|ctx| async move {
        let lines = ["first", "second", "third"].map(|name| {
            let line = progress(&ctx, still(name));
            line.log(&rows(&format!("{name} line"), 6));
            line
        });
        draw(&lines);
        lines[2].fail().await?;
        lines[0].end().await?;
        lines[1].end().await
    });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(frames.lengths("third"), [0, 1]);
    assert!(
        frames
            .take()
            .iter()
            .any(|frame| frame.text == "third\n> third line 6")
    );
    assert_eq!(
        support::screen::replay(&mock.transcript(), 60, false).lines,
        [
            "  third line 1",
            "  third line 2",
            "  third line 3",
            "  third line 4",
            "  third line 5",
            "  third line 6",
            "third",
            "first",
            "second"
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn the_first_root_shrinks_before_the_second_root_draws_on_a_full_terminal() {
    let tty = mock(60, 6);
    let frames = Frames::default();
    let app = builder()
        .overrides([frames.view()])
        .action(|ctx| async move {
            let first = progress(&ctx, still("first"));
            first.log(&rows("first line", 6));
            first.update(ProgressUpdate::new());
            let second = progress(&ctx, still("second"));
            second.log(&rows("second line", 6));
            second.update(ProgressUpdate::new());
            draw(&[first.clone(), second.clone()]);
            draw(&[first.clone(), second.clone()]);
            first.end().await?;
            second.end().await
        });
    assert_eq!(run(app, &tty).await, 0);
    assert_eq!(frames.lengths("first"), [0, 5, 4, 2, 2]);
    assert_eq!(frames.lengths("second"), [0, 0, 2, 2]);
}

#[tokio::test(start_paused = true)]
async fn a_growing_log_leaves_another_trees_finished_rows() {
    let tty = mock(40, 6);
    let read = tty.clone();
    let action = app(move |ctx| {
        let read = read.clone();
        async move {
            let deploying = progress(&ctx, still("Deploying"));
            for step in 1..=3 {
                deploying.task(still(&format!("Step {step}"))).end().await?;
            }
            let watching = progress(&ctx, still("Watching"));
            watching.log(&rows("log", 5));
            watching.update(ProgressUpdate::new());
            assert_eq!(
                support::screen::replay(&read.transcript(), 40, false).lines,
                [
                    "◐ Deploying · 0.0s",
                    "  ✔ Step 1 · 0.0s",
                    "  ✔ Step 2 · 0.0s",
                    "  ✔ Step 3 · 0.0s",
                    "◐ Watching · 0.0s",
                    "  log 5",
                ]
            );
            watching.end().await?;
            deploying.end().await
        }
    });
    assert_eq!(run(action, &tty).await, 0);
}

#[tokio::test(start_paused = true)]
async fn finished_rows_after_a_shrink_leave_the_other_trees_rows() {
    let tty = mock(40, 12);
    let read = tty.clone();
    let action = app(move |ctx| {
        let read = read.clone();
        async move {
            let x = progress(&ctx, still("X"));
            let y = progress(&ctx, still("Y"));
            for step in 1..=4 {
                x.task(still(&format!("x{step}"))).end().await?;
                y.task(still(&format!("y{step}"))).end().await?;
            }
            x.update(ProgressUpdate::new());
            y.update(ProgressUpdate::new());
            assert_eq!(
                support::screen::replay(&read.transcript(), 40, false)
                    .lines
                    .len(),
                10
            );
            read.resize(40, 6);
            y.update(ProgressUpdate::new());
            assert_eq!(
                support::screen::replay(&read.transcript(), 40, false).lines,
                [
                    "◐ X · 0.0s",
                    "  ✔ x1 · 0.0s",
                    "  ✔ x2 · 0.0s",
                    "  ✔ x3 · 0.0s",
                    "  ✔ x4 · 0.0s",
                    "◐ Y · 0.0s"
                ]
            );
            y.end().await?;
            x.end().await
        }
    });
    assert_eq!(run(action, &tty).await, 0);
}
