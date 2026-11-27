//! The counted progress cases from `progress-estimate.test.ts`.

#![allow(clippy::unwrap_used, missing_docs)]

mod support;

use std::time::Duration;

use loomcli_core::Context;
use loomcli_prompts::{ProgressSettings, ProgressUpdate, Spinner, progress};
use loomcli_testing::mock_process;

#[tokio::test(start_paused = true)]
async fn the_worked_sequence_draws_the_rate_and_time_left() {
    let frames = drawn(100, |ctx| async move {
        let copying = progress(
            &ctx,
            ProgressSettings::new("Copying files")
                .total(120.0)
                .estimate()
                .spinner(Spinner::new(["◐"], 60_000)),
        );
        let mut previous = 0;
        for (time, count) in [
            (500, 1.0),
            (3000, 10.0),
            (12000, 40.0),
            (13000, 70.0),
            (14000, 100.0),
        ] {
            tokio::time::sleep(Duration::from_millis(time - previous)).await;
            previous = time;
            copying.update(ProgressUpdate::new().completed(count));
        }
        copying.end_with("Done").await
    })
    .await;
    assert_eq!(
        frames
            .iter()
            .filter(|frame| frame.data.state == ProgressState::Running)
            .skip(1)
            .map(|frame| frame.text.as_str())
            .collect::<Vec<_>>(),
        [
            "◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 1/120 · 0.5s",
            "◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · 3.6/s · about 31s left",
            "◐ Copying files ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · 3.3/s · about 24s left",
            "◐ Copying files ▰▰▰▰▰▱▱▱▱▱ 70/120 · 13.0s · 6.0/s · about 9s left",
            "◐ Copying files ▰▰▰▰▰▰▰▰▱▱ 100/120 · 14.0s · 8.1/s · about 3s left",
        ]
    );
}

use loomcli_core::{Error, View, ViewContext};
use loomcli_prompts::Progress;
use loomcli_prompts::views::{ProgressLine, ProgressState, progress_line};
use std::future::Future;
use support::progress::{Frame, Frames, advance, app, builder, fields, mock, run, still};

async fn drawn<F, Fut>(columns: u16, action: F) -> Vec<Frame>
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    let frames = Frames::default();
    assert_eq!(
        run(
            builder().overrides([frames.view()]).action(action),
            &mock(columns, 24)
        )
        .await,
        0
    );
    frames.take()
}

async fn reports(line: &Progress, sequence: &[(u64, f64)]) {
    let mut previous = 0;
    for &(time, count) in sequence {
        advance(time - previous).await;
        previous = time;
        line.update(ProgressUpdate::new().completed(count));
    }
}

fn at(frames: &[Frame], elapsed: u64) -> &Frame {
    frames
        .iter()
        .rev()
        .find(|frame| frame.data.state == ProgressState::Running && frame.data.elapsed == elapsed)
        .unwrap()
}

#[tokio::test(start_paused = true)]
async fn timer_frames_hold_the_rate_and_count_down_to_zero() {
    let frames = drawn(100, |ctx| async move {
        let line = progress(
            &ctx,
            still("Copying files")
                .total(120.0)
                .estimate()
                .spinner(Spinner::new(["◐"], 500)),
        );
        reports(
            &line,
            &[
                (500, 1.0),
                (3000, 10.0),
                (12000, 40.0),
                (13000, 70.0),
                (14000, 100.0),
            ],
        )
        .await;
        advance(3500).await;
        line.end_with("Done").await
    })
    .await;
    assert_eq!(
        at(&frames, 12_500).text,
        "◐ Copying files ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.5s · 3.3/s · about 24s left"
    );
    assert_eq!(
        at(&frames, 16_000).text,
        "◐ Copying files ▰▰▰▰▰▰▰▰▱▱ 100/120 · 16.0s · 8.1/s · about 1s left"
    );
    assert_eq!(
        at(&frames, 17_500).text,
        "◐ Copying files ▰▰▰▰▰▰▰▰▱▱ 100/120 · 17.5s · 8.1/s · about 1s left"
    );
    assert!((at(&frames, 12_500).data.remaining.unwrap() - 23_089.74).abs() < 0.05);
    assert!((at(&frames, 16_000).data.remaining.unwrap() - 444.44).abs() < 0.05);
    assert_eq!(at(&frames, 17_000).data.remaining, Some(0.0));
    assert_eq!(at(&frames, 17_500).data.remaining, Some(0.0));
}

#[tokio::test(start_paused = true)]
async fn only_counted_updates_are_samples_and_two_must_span_a_second() {
    let frames = drawn(100, |ctx| async move {
        let line = progress(&ctx, still("Copying files").total(120.0).estimate());
        advance(1500).await;
        line.update(ProgressUpdate::new().label("Copying the files"));
        line.update(ProgressUpdate::new().total(130.0));
        reports(&line, &[(500, 1.0), (1400, 4.0), (1500, 5.0)]).await;
        line.end_with("Done").await
    })
    .await;
    assert_eq!(
        at(&frames, 2900).text,
        "◐ Copying the files ▱▱▱▱▱▱▱▱▱▱ 4/130 · 2.9s"
    );
    assert_eq!(
        at(&frames, 3000).text,
        "◐ Copying the files ▱▱▱▱▱▱▱▱▱▱ 5/130 · 3.0s · 4.0/s · about 32s left"
    );
    assert!(
        frames[..5]
            .iter()
            .all(|frame| frame.data.rate.is_none() && frame.data.remaining.is_none())
    );
}

#[tokio::test(start_paused = true)]
async fn a_line_without_a_count_has_no_estimate() {
    let frames = drawn(80, |ctx| async move {
        let line = progress(&ctx, still("Building the index").estimate());
        advance(5000).await;
        line.update(ProgressUpdate::new().label("Building the index again"));
        line.end_with("Done").await
    })
    .await;
    assert_eq!(at(&frames, 5000).text, "◐ Building the index again · 5.0s");
    assert!(frames.iter().all(|frame| frame.data.estimate
        && frame.data.rate.is_none()
        && frame.data.remaining.is_none()));
}

#[tokio::test(start_paused = true)]
async fn a_stalled_count_shows_zero_rate_and_no_time_left() {
    let frames = drawn(100, |ctx| async move {
        let line = progress(
            &ctx,
            still("Copying files").total(120.0).estimate().unit("files"),
        );
        reports(&line, &[(500, 5.0), (2000, 5.0)]).await;
        line.end().await
    })
    .await;
    let frame = at(&frames, 2000);
    assert_eq!(
        frame.text,
        "◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 5/120 · 2.0s · 0 files/s"
    );
    assert_eq!((frame.data.rate, frame.data.remaining), (Some(0.0), None));
}

#[tokio::test(start_paused = true)]
async fn a_backward_count_restarts_short_and_long_windows() {
    for history_length in [2, 20] {
        let frames = drawn(100, move |ctx| async move {
            let line = progress(&ctx, still("Copying files").total(120.0).estimate());
            let history: Vec<_> = (1..=history_length).map(|i| (i * 1000, i as f64)).collect();
            reports(&line, &history).await;
            reports(&line, &[(1000, 0.0), (1500, 3.0), (2000, 5.0)]).await;
            line.end().await
        })
        .await;
        let reset = (history_length + 1) * 1000;
        assert_eq!(at(&frames, reset).data.rate, None);
        assert_eq!(at(&frames, reset + 500).data.rate, None);
        assert_eq!(at(&frames, reset + 1000).data.rate, Some(5.0));
    }
}

#[tokio::test(start_paused = true)]
async fn rate_and_time_left_follow_total_changes_and_completion() {
    let frames = drawn(100, |ctx| async move {
        let line = progress(&ctx, still("Copying files").total(20.0).estimate());
        reports(&line, &[(1000, 0.0), (2000, 10.0)]).await;
        advance(100).await;
        line.update(ProgressUpdate::new().total(40.0));
        reports(&line, &[(900, 40.0), (1900, 41.0)]).await;
        line.end().await
    })
    .await;
    assert_eq!(at(&frames, 2000).data.remaining, Some(1000.0));
    assert_eq!(at(&frames, 2100).data.remaining, Some(2900.0));
    assert_eq!(at(&frames, 2100).data.rate, Some(10.0));
    assert_eq!(
        (
            at(&frames, 3000).data.rate,
            at(&frames, 3000).data.remaining
        ),
        (Some(20.0), None)
    );
    assert_eq!(at(&frames, 4000).data.remaining, None);
}

#[tokio::test(start_paused = true)]
async fn a_line_without_a_total_draws_its_named_rate_alone() {
    let frames = drawn(100, |ctx| async move {
        let line = progress(&ctx, still("Reading rows").estimate().unit("rows"));
        reports(&line, &[(500, 20.0), (3000, 29.0)]).await;
        line.end().await
    })
    .await;
    assert_eq!(
        at(&frames, 3000).text,
        "◐ Reading rows 29 · 3.0s · 3.6 rows/s"
    );
    assert_eq!(at(&frames, 3000).data.remaining, None);
}

#[tokio::test(start_paused = true)]
async fn overrides_receive_figures_with_the_display_off_and_on_end_frames() {
    for show in [false, true] {
        let frames = drawn(100, move |ctx| async move {
            let settings = still("Copying files").total(120.0).unit("files");
            let line = progress(&ctx, if show { settings.estimate() } else { settings });
            reports(&line, &[(500, 1.0), (3000, 10.0)]).await;
            line.end_with("Done").await
        })
        .await;
        assert_eq!(frames[0].data.estimate, show);
        assert_eq!(frames[0].data.unit.as_deref(), Some("files"));
        assert_eq!(frames[0].data.rate, None);
        let frame = at(&frames, 3000);
        assert_eq!(frame.data.rate, Some(3.6));
        assert!(frame.data.remaining.unwrap() > 30_000.0);
        assert_eq!(frame.text.contains("files/s"), show);
        let end = frames.last().unwrap();
        assert_eq!(end.text, "✔ Done · 3.0s");
        assert_eq!(end.data.rate, frame.data.rate);
        assert_eq!(end.data.remaining, frame.data.remaining);
    }
}

#[tokio::test(start_paused = true)]
async fn plain_start_and_end_have_neither_rate_nor_time_left() {
    let mock = mock_process(fields());
    let action = app(|ctx| async move {
        let line = progress(&ctx, still("Copying files").total(120.0).estimate());
        reports(&line, &[(500, 1.0), (3000, 10.0)]).await;
        line.end_with("Done").await
    });
    assert_eq!(run(action, &mock).await, 0);
    assert_eq!(mock.stderr_text(), "ℹ Copying files\n✔ Done\n");
}

#[tokio::test(start_paused = true)]
async fn a_narrow_row_drops_the_rate_before_time_left_and_clips_the_label() {
    for (width, expected) in [
        (
            65,
            "◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · 3.6/s · about 31s left",
        ),
        (
            64,
            "◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · about 31s left",
        ),
        (
            57,
            "◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · about 31s left",
        ),
        (56, "◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s"),
        (40, "◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s"),
        (39, "◐ Copying fil… ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s"),
    ] {
        let frames = drawn(width, |ctx| async move {
            let line = progress(&ctx, still("Copying files").total(120.0).estimate());
            reports(&line, &[(500, 1.0), (3000, 10.0)]).await;
            line.end().await
        })
        .await;
        assert_eq!(at(&frames, 3000).text, expected);
    }
}

#[tokio::test(start_paused = true)]
async fn the_default_view_formats_figures_and_uses_eighty_columns_when_width_is_unknown() {
    let mock = mock_process(fields());
    let action = app(|ctx| async move {
        let draw = View::new(|data: &ProgressLine, ctx: &ViewContext| {
            progress_line().render(data, ctx).map(|text| text + "\n")
        });
        for (show, label, rate, left, unit) in [
            (true, "Work".to_owned(), Some(1204.9), None, None),
            (
                true,
                "Work".to_owned(),
                Some(10.0 / 3.0),
                None,
                Some("files"),
            ),
            (true, "Work".to_owned(), Some(0.25), None, Some("files")),
            (true, "Work".to_owned(), Some(1.0 / 7200.0), None, None),
            (true, "Work".to_owned(), Some(0.0), None, Some("files")),
            (true, "Work".to_owned(), Some(1.0), Some(0.0), None),
            (true, "Work".to_owned(), Some(1.0), Some(5000.0), None),
            (true, "Work".to_owned(), Some(1.0), Some(59_001.0), None),
            (true, "Work".to_owned(), Some(1.0), Some(89_000.0), None),
            (true, "Work".to_owned(), Some(1.0), Some(90_000.0), None),
            (true, "Work".to_owned(), Some(1.0), Some(180_000.0), None),
            (true, "Work".to_owned(), Some(1.0), Some(3_570_000.0), None),
            (true, "Work".to_owned(), Some(1.0), Some(7_200_000.0), None),
            (true, "x".repeat(50), Some(10.0 / 3.0), Some(24_000.0), None),
            (false, "Work".to_owned(), Some(1.0), Some(5000.0), None),
            (true, "Work".to_owned(), None, Some(5000.0), None),
            (true, "Work".to_owned(), Some(10.0), None, None),
            (true, "Work".to_owned(), Some(1.0 / 60.0), None, None),
            (true, "Work".to_owned(), Some(1.0), Some(4_000_000.0), None),
        ] {
            let row = ProgressLine::new(ProgressState::Running, label)
                .frame("*")
                .estimate(show, rate, left, unit.map(str::to_owned));
            ctx.out.render(&row, &draw).await?;
        }
        Ok(())
    });
    assert_eq!(run(action, &mock).await, 0);
    let output = mock.stdout_text();
    assert_eq!(
        output.lines().collect::<Vec<_>>(),
        [
            "* Work · 0.0s · 1204/s",
            "* Work · 0.0s · 3.3 files/s",
            "* Work · 0.0s · 15 files/min",
            "* Work · 0.0s · 0.5/h",
            "* Work · 0.0s · 0 files/s",
            "* Work · 0.0s · 1.0/s · about 1s left",
            "* Work · 0.0s · 1.0/s · about 5s left",
            "* Work · 0.0s · 1.0/s · about 1m left",
            "* Work · 0.0s · 1.0/s · about 1m left",
            "* Work · 0.0s · 1.0/s · about 2m left",
            "* Work · 0.0s · 1.0/s · about 3m left",
            "* Work · 0.0s · 1.0/s · about 1h left",
            "* Work · 0.0s · 1.0/s · about 2h left",
            &format!("* {} · 0.0s · about 24s left", "x".repeat(50)),
            "* Work · 0.0s",
            "* Work · 0.0s",
            "* Work · 0.0s · 10/s",
            "* Work · 0.0s · 1.0/min",
            "* Work · 0.0s · 1.0/s · about 1h left",
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn float_noise_does_not_change_the_rate_or_time_left_digits() {
    for (time, expected) in [(2000, "· 12/min ·"), (3000, "· 6.0/min · about 7s left")] {
        let frames = drawn(100, move |ctx| async move {
            let line = progress(&ctx, still("Copying files").total(1.0).estimate());
            reports(&line, &[(1000, 0.1), (time, 0.3)]).await;
            line.end().await
        })
        .await;
        assert!(at(&frames, time).text.contains(expected));
    }
}

#[tokio::test(start_paused = true)]
async fn a_handle_moved_to_a_worker_uses_the_runs_clock() {
    let frames = drawn(100, |ctx| async move {
        let line = progress(&ctx, still("Copying").total(120.0).estimate());
        advance(500).await;
        line.update(ProgressUpdate::new().completed(1.0));
        advance(2500).await;
        let worker = line.clone();
        std::thread::spawn(move || worker.update(ProgressUpdate::new().completed(10.0)))
            .join()
            .unwrap();
        line.end().await
    })
    .await;
    assert_eq!(at(&frames, 3000).data.rate, Some(3.6));
    assert_eq!(
        at(&frames, 3000).text,
        "◐ Copying ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · 3.6/s · about 31s left"
    );
}
