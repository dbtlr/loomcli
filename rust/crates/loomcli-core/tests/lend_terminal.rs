//! Ports `lend-terminal.test.ts`: lending the terminal to a child program while live regions are
//! open, end to end through `Application::run` on a mock process whose streams sit on an 80-column
//! terminal. The screen's own suspend and resume during a lend are also unit tests in
//! `src/output/screen.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::future::Future;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Command, Context, Done, EndState, Error, NoInputs, NoResult, RegionOptions,
    RowSource, RowView, RowViews, RowsResult, RunOptions, View, ViewContext,
};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, mock_process};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, Done>;

fn text() -> View<str> {
    View::new(|value: &str, _: &ViewContext| value.to_owned())
}

fn terminal() -> Arc<MockProcess> {
    mock_process(MockFields::new().terminal(MockTerminal::new(80, 24)))
}

/// Runs an application whose action is `act` over the mock `act` receives, and answers the code.
async fn lend<F, Fut>(act: impl FnOnce(Arc<MockProcess>) -> F) -> (Arc<MockProcess>, u8)
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    let mock = terminal();
    let app: App = Application::new("lend").action(act(Arc::clone(&mock)));
    let code = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    (mock, code.get())
}

/// What stderr received after the first `start` bytes.
fn after(mock: &MockProcess, start: usize) -> String {
    mock.stderr_text()[start..].to_owned()
}

#[tokio::test]
async fn a_lend_holds_frames_passes_writes_and_draws_a_fresh_stack_without_erasing_child_output() {
    let (_, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.draw("before", &text()).await?;
                let start = mock.stderr_text().len();
                let lent = ctx
                    .out
                    .lend_terminal(|| async {
                        assert_eq!(after(&mock, start), "\n");
                        region.draw("after", &text()).await?;
                        ctx.out.draw("child", &text()).await?;
                        assert_eq!(after(&mock, start), "\nchild");
                        Ok::<_, Error>(42)
                    })
                    .await?;
                assert_eq!(lent, 42);
                assert_eq!(after(&mock, start), "\nchild\nafter");
                region.end(EndState::Ended, None).await
            }
        }
    })
    .await;
    assert_eq!(code, 0);
}

/// A sender a test hands to code that runs once.
type Once<T> = Arc<Mutex<Option<oneshot::Sender<T>>>>;

fn once<T>() -> (Once<T>, oneshot::Receiver<T>) {
    let (sender, receiver) = oneshot::channel();
    (Arc::new(Mutex::new(Some(sender))), receiver)
}

fn fire<T>(sender: &Once<T>, value: T) {
    if let Some(sender) = sender.lock().unwrap().take() {
        let _ = sender.send(value);
    }
}

#[tokio::test]
async fn a_failure_closes_regions_at_once_and_waits_for_every_lend_before_its_report() {
    let mock = terminal();
    let (closed, closing) = once::<()>();
    let (started, ready) = once::<()>();
    let (release, waiting) = once::<()>();
    let ready = Arc::new(Mutex::new(Some(ready)));
    let waiting = Arc::new(Mutex::new(Some(waiting)));
    let app: App = Application::new("lend").action(move |ctx: Context| {
        let (closed, started) = (Arc::clone(&closed), Arc::clone(&started));
        let ready = ready.lock().unwrap().take().unwrap();
        let waiting = waiting.lock().unwrap().take().unwrap();
        async move {
            let region = ctx.out.region(RegionOptions::new());
            region.on_close(move |_| fire(&closed, ()));
            region.draw("frame", &text()).await?;
            let out = ctx.out.clone();
            // The lend outlasts the action: its future is spawned, and the lend counts from the
            // call.
            let lent = ctx.out.lend_terminal(move || async move {
                fire(&started, ());
                let _ = waiting.await;
                let _ = out.draw("last-child", &text()).await;
            });
            drop(tokio::spawn(lent));
            let _ = ready.await;
            Err(ctx.out.fatal("failure-report"))
        }
    });
    let running = app.run(RunOptions::new().process(Arc::clone(&mock) as _));
    let watching = async {
        let _ = closing.await;
        assert!(!mock.stderr_text().contains("failure-report"));
        fire(&release, ());
    };
    let (code, ()) = tokio::join!(running, watching);
    assert_eq!(code.get(), 1);
    let stderr = mock.stderr_text();
    assert!(stderr.find("failure-report").unwrap() > stderr.find("last-child").unwrap());
}

#[tokio::test]
async fn a_lend_without_a_drawn_frame_writes_nothing_and_returns_the_works_error() {
    let (mock, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                let lent: Result<(), Error> = ctx
                    .out
                    .lend_terminal(|| async { Err(Error::from_foreign("work".into())) })
                    .await;
                assert_eq!(lent.unwrap_err().foreign().unwrap().to_string(), "work");
                assert_eq!(mock.stderr_text(), "");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(mock.stderr_text(), "");
}

#[tokio::test]
async fn a_lend_with_no_drawn_region_preserves_the_partial_row_for_the_next_region() {
    let (mock, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                ctx.out.draw("partial", &text()).await?;
                assert_eq!(ctx.out.lend_terminal(|| async { 42 }).await, 42);
                let region = ctx.out.region(RegionOptions::new());
                region.draw("frame", &text()).await?;
                assert_eq!(mock.stderr_text(), "partial\nframe");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(code, 0);
    drop(mock);
}

#[tokio::test]
async fn nested_lends_add_no_rows_and_closed_frames_follow_child_output_in_close_order() {
    let (_, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                let first = ctx.out.region(RegionOptions::new());
                let second = ctx.out.region(RegionOptions::new());
                first.draw("one", &text()).await?;
                second.draw("two", &text()).await?;
                let start = mock.stderr_text().len();
                ctx.out
                    .lend_terminal(|| async {
                        ctx.out
                            .lend_terminal(|| async {
                                second.draw("two-final", &text()).await?;
                                second.end(EndState::Ended, None).await?;
                                first.draw("one-final", &text()).await?;
                                first.end(EndState::Ended, None).await?;
                                ctx.out.draw("child", &text()).await?;
                                Ok::<_, Error>(())
                            })
                            .await?;
                        assert_eq!(after(&mock, start), "\nchild");
                        Ok::<_, Error>(())
                    })
                    .await?;
                assert_eq!(after(&mock, start), "\nchild\ntwo-final\none-final\n");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(code, 0);
}

#[tokio::test]
async fn a_region_first_drawn_during_a_lend_that_started_with_nothing_drawn_is_held_until_it_ends()
{
    let (_, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                let region = ctx.out.region(RegionOptions::new());
                ctx.out
                    .lend_terminal(|| async {
                        region.draw("LIVE", &text()).await?;
                        assert_eq!(mock.stderr_text(), "");
                        Ok::<_, Error>(())
                    })
                    .await?;
                assert_eq!(mock.stderr_text(), "\nLIVE");
                region.end(EndState::Ended, None).await
            }
        }
    })
    .await;
    assert_eq!(code, 0);
}

#[tokio::test]
async fn a_region_opened_during_a_lend_draws_below_the_child_output_once_the_lend_ends() {
    let (_, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                ctx.out
                    .lend_terminal(|| async {
                        let region = ctx.out.region(RegionOptions::new());
                        region.draw("LIVE", &text()).await?;
                        ctx.out.draw("child-write", &text()).await?;
                        assert_eq!(mock.stderr_text(), "child-write");
                        Ok::<_, Error>(())
                    })
                    .await?;
                assert_eq!(mock.stderr_text(), "child-write\nLIVE");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(code, 0);
}

#[tokio::test]
async fn a_lend_after_a_frame_that_ended_its_row_writes_no_line_break_of_its_own() {
    let (_, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.draw("A\n", &text()).await?;
                let start = mock.stderr_text().len();
                ctx.out
                    .lend_terminal(|| async { ctx.out.draw("child", &text()).await })
                    .await?;
                assert_eq!(after(&mock, start), "child\nA\n");
                region.end(EndState::Ended, None).await
            }
        }
    })
    .await;
    assert_eq!(code, 0);
}

#[tokio::test]
async fn a_run_that_reports_no_failure_writes_its_incomplete_result_line_once_every_lend_has_settled()
 {
    let mock = mock_process(
        MockFields::new()
            .argv(["count"])
            .terminal(MockTerminal::new(80, 24)),
    );
    let caller = CancellationToken::new();
    let count = Command::new("count")
        .rows(RowViews::new().view(
            "list",
            RowView::new(|row: &String, _, _: &ViewContext| format!("{row}\n")),
        ))
        .action({
            let (mock, caller) = (Arc::clone(&mock), caller.clone());
            move |ctx: Context<NoInputs, RowsResult<String>>| {
                let (mock, caller) = (Arc::clone(&mock), caller.clone());
                async move {
                    // The lend outlasts the action. It ends once the line has landed or the turns
                    // run out; only a run that writes the line during the lend lands it first.
                    let out = ctx.out.clone();
                    let lent = ctx.out.lend_terminal(move || async move {
                        for _ in 0..100 {
                            if mock.stderr_text().contains("incomplete") {
                                break;
                            }
                            tokio::task::yield_now().await;
                        }
                        let _ = out.draw("child\n", &text()).await;
                    });
                    drop(tokio::spawn(lent));
                    let mut step = 0;
                    let rows = RowSource::Iter(Box::new(std::iter::from_fn(move || {
                        step += 1;
                        match step {
                            1 => Some("one".to_owned()),
                            _ => {
                                caller.cancel();
                                None
                            }
                        }
                    })));
                    let _ = ctx.out.results(rows).await;
                    Ok(())
                }
            }
        });
    let app = Application::new("lend").command(count);
    let code = app
        .run(
            RunOptions::new()
                .process(Arc::clone(&mock) as _)
                .signal(caller.clone()),
        )
        .await;
    assert_eq!(code.get(), 130);
    let stderr = mock.stderr_text();
    assert!(stderr.contains("Output is incomplete"), "{stderr}");
    assert!(stderr.find("child").unwrap() < stderr.find("Output is incomplete").unwrap());
}

#[tokio::test]
async fn suspend_and_resume_during_a_lend_write_nothing() {
    let (_, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.draw("frame", &text()).await?;
                let out = ctx.out.clone();
                ctx.out
                    .lend_terminal(|| async move {
                        let before = mock.stderr_text();
                        mock.raise(loomcli_core::ProcessSignal::Tstp);
                        out.draw("", &text()).await?;
                        assert_eq!(mock.stderr_text(), before);
                        Ok::<_, Error>(())
                    })
                    .await
            }
        }
    })
    .await;
    assert_eq!(code, 0);
}

#[tokio::test]
async fn suspend_and_resume_during_a_lend_that_started_with_nothing_drawn_write_nothing() {
    let (_, code) = lend(|mock| {
        move |ctx: Context| {
            let mock = Arc::clone(&mock);
            async move {
                let region = ctx.out.region(RegionOptions::new());
                let out = ctx.out.clone();
                ctx.out
                    .lend_terminal(|| {
                        let region = region.clone();
                        let mock = Arc::clone(&mock);
                        async move {
                            region.draw("LIVE", &text()).await?;
                            mock.raise(loomcli_core::ProcessSignal::Tstp);
                            out.draw("", &text()).await?;
                            assert_eq!(mock.stderr_text(), "");
                            Ok::<_, Error>(())
                        }
                    })
                    .await?;
                assert_eq!(mock.stderr_text(), "\nLIVE");
                region.end(EndState::Ended, None).await
            }
        }
    })
    .await;
    assert_eq!(code, 0);
}
