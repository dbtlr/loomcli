//! Ready row sources share the Tokio runtime and observe mock SIGINT between pulls.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::task::{Context as TaskContext, Poll};

use loomcli_core::{
    Application, Context, Error, NoInputs, ProcessSignal, RowSource, RowView, RowViews, RowsResult,
    RunOptions, Stream, View,
};
use loomcli_testing::{MockFields, MockProcess, mock_process};
use tokio::sync::{Notify, oneshot};

const READY_ROWS: usize = 1024;

fn views(whole: bool) -> RowViews<&'static str> {
    if whole {
        RowViews::new().view(
            "selected",
            View::new(|rows: &[&str], _| format!("{}\n", rows.len())),
        )
    } else {
        RowViews::new().view(
            "selected",
            RowView::new(|_: &&str, _, _| "row\n".to_owned()).tail(|_, _| "tail\n".to_owned()),
        )
    }
}

async fn run(
    process: &Arc<MockProcess>,
    whole: bool,
    make_source: impl Fn() -> RowSource<&'static str> + Send + Sync + 'static,
) -> u8 {
    let app = Application::new("pace").rows(views(whole)).action(
        move |ctx: Context<NoInputs, RowsResult<&'static str>>| {
            let source = make_source();
            async move { ctx.out.results(source).await }
        },
    );
    app.run(RunOptions::new().process(Arc::clone(process) as _))
        .await
        .get()
}

fn stopped(process: &MockProcess, yielded: usize, written: usize) {
    assert_eq!(process.ended_by(), Some(ProcessSignal::Int));
    assert_eq!(
        process.stderr_text(),
        format!(
            "Output is incomplete: the root Command stopped after {yielded} rows, {written} written.\n"
        )
    );
    assert_eq!(process.stdout_text(), "row\n".repeat(written));
}

struct ReadyRows<F> {
    remaining: usize,
    before_row: F,
}

impl<F: FnMut() + Unpin> Stream for ReadyRows<F> {
    type Item = Result<&'static str, Error>;

    fn poll_next(mut self: Pin<&mut Self>, _: &mut TaskContext<'_>) -> Poll<Option<Self::Item>> {
        if self.remaining == 0 {
            return Poll::Ready(None);
        }
        self.remaining -= 1;
        (self.before_row)();
        Poll::Ready(Some(Ok("row")))
    }
}

#[tokio::test]
async fn an_always_ready_stream_allows_same_runtime_sigint_under_both_views() {
    for whole in [false, true] {
        let process = mock_process(MockFields::new());
        let first = Arc::new(Notify::new());
        let read = Arc::new(AtomicUsize::new(0));
        let signal = tokio::spawn({
            let first = Arc::clone(&first);
            let process = Arc::clone(&process);
            async move {
                first.notified().await;
                process.raise(ProcessSignal::Int);
            }
        });
        let status = run(&process, whole, {
            let read = Arc::clone(&read);
            move || {
                let read = Arc::clone(&read);
                let first = Arc::clone(&first);
                RowSource::stream(ReadyRows {
                    remaining: READY_ROWS,
                    before_row: move || {
                        if read.fetch_add(1, Ordering::Relaxed) == 0 {
                            first.notify_one();
                        }
                    },
                })
            }
        })
        .await;
        if status == 0 {
            signal.abort();
        }
        assert_eq!(status, 130);
        signal.await.unwrap();
        let yielded = read.load(Ordering::Relaxed);
        assert!((1..READY_ROWS).contains(&yielded));
        stopped(&process, yielded, if whole { 0 } else { yielded - 1 });
    }
}

#[tokio::test]
async fn an_iterator_stops_between_pulls_when_the_signal_arrives_during_a_row() {
    let process = mock_process(MockFields::new());
    let monitor = Arc::clone(&process);
    assert_eq!(
        run(&process, false, move || {
            let monitor = Arc::clone(&monitor);
            RowSource::iter((1..=READY_ROWS).map(move |index| {
                if index == 3 {
                    monitor.raise(ProcessSignal::Int);
                }
                "row"
            }))
        })
        .await,
        130
    );
    stopped(&process, 3, 2);
}

struct FirstPoll {
    ready: oneshot::Receiver<()>,
    reading: Arc<Notify>,
}

impl Stream for FirstPoll {
    type Item = Result<&'static str, Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<Option<Self::Item>> {
        self.reading.notify_one();
        Pin::new(&mut self.ready)
            .poll(cx)
            .map(|answer| answer.ok().map(|()| Ok("row")))
    }
}

#[tokio::test]
async fn a_row_delivered_after_pending_io_and_sigint_is_counted_but_unwritten() {
    let process = mock_process(MockFields::new());
    let reading = Arc::new(Notify::new());
    let (send, receive) = oneshot::channel();
    let receive = std::sync::Mutex::new(Some(receive));
    let signal = tokio::spawn({
        let reading = Arc::clone(&reading);
        let process = Arc::clone(&process);
        async move {
            reading.notified().await;
            process.raise(ProcessSignal::Int);
            send.send(()).unwrap();
        }
    });
    assert_eq!(
        run(&process, false, move || RowSource::stream(FirstPoll {
            ready: receive.lock().unwrap().take().unwrap(),
            reading: Arc::clone(&reading),
        }))
        .await,
        130
    );
    signal.await.unwrap();
    stopped(&process, 1, 0);
}

#[tokio::test]
async fn finite_ready_sources_complete_under_both_views() {
    for whole in [false, true] {
        for rows in [0, 1, READY_ROWS] {
            let process = mock_process(MockFields::new());
            assert_eq!(
                run(&process, whole, move || RowSource::iter(
                    std::iter::repeat_n("row", rows)
                ))
                .await,
                0
            );
            assert_eq!(process.ended_by(), None);
            assert_eq!(process.stderr_text(), "");
            let expected = if whole {
                format!("{rows}\n")
            } else {
                format!("{}tail\n", "row\n".repeat(rows))
            };
            assert_eq!(process.stdout_text(), expected);
        }
    }
}
