//! Ports process-end output through a mock process and its registered exit listener.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::future::{Future, poll_fn};
use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;

use loomcli_core::{
    Application, BoxFuture, Context, InputStream, LogDestination, LogEvent, OutputStream,
    ProcessHandle, ProcessSignal, RegionOptions, RunOptions, ShutdownCause, SignalEvent,
    SignalListener, SignalSource, View, ViewContext,
};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, StreamName, Write, mock_process};
use support::streams::Swapped;

const SHOW_CURSOR: &str = "\u{1b}[?25h";

/// The mock's signal source with its exit listeners available to the test.
struct ExitEvent {
    mock: Arc<MockProcess>,
    listeners: Mutex<Vec<(u64, SignalListener)>>,
}

impl ExitEvent {
    fn fire(&self, code: i32) {
        let listeners = self.listeners.lock().unwrap().clone();
        for (_, listener) in listeners {
            listener(Some(code));
        }
    }
}

impl SignalSource for ExitEvent {
    fn on(&self, event: SignalEvent, listener: SignalListener) -> u64 {
        let id = self.mock.signals().on(event, Arc::clone(&listener));
        if event == SignalEvent::Exit {
            self.listeners.lock().unwrap().push((id, listener));
        }
        id
    }

    fn off(&self, id: u64) {
        self.listeners
            .lock()
            .unwrap()
            .retain(|(held, _)| *held != id);
        self.mock.signals().off(id);
    }

    fn raise(&self, signal: ProcessSignal) {
        self.mock.raise(signal);
    }

    fn terminal(&self) -> Option<Arc<dyn InputStream>> {
        self.mock.signals().terminal()
    }
}

/// Holds the acknowledgment of one write after its bytes reach the stream. Every later write can
/// finish synchronously, including writes made by a process-end flush.
struct Pausing {
    stream: Arc<dyn OutputStream>,
    pause: AtomicBool,
    resume: tokio::sync::Notify,
}

impl Pausing {
    fn new(stream: Arc<dyn OutputStream>) -> Arc<Self> {
        Arc::new(Self {
            stream,
            pause: AtomicBool::new(false),
            resume: tokio::sync::Notify::new(),
        })
    }

    fn next(&self) {
        self.pause.store(true, Ordering::SeqCst);
    }
}

impl OutputStream for Pausing {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        Box::pin(async move {
            self.stream.write(bytes).await?;
            if self.pause.swap(false, Ordering::SeqCst) {
                self.resume.notified().await;
            }
            Ok(())
        })
    }
}

fn fixture(fields: MockFields) -> (Arc<ExitEvent>, Arc<Pausing>, RunOptions) {
    fixture_with_paused_stream(fields, StreamName::Stderr)
}

fn fixture_with_paused_stream(
    fields: MockFields,
    stream: StreamName,
) -> (Arc<ExitEvent>, Arc<Pausing>, RunOptions) {
    let mock = mock_process(fields);
    let signals = Arc::new(ExitEvent {
        mock: Arc::clone(&mock),
        listeners: Mutex::default(),
    });
    let pause = Pausing::new(match stream {
        StreamName::Stdout => mock.stdout(),
        StreamName::Stderr => mock.stderr(),
    });
    let mut handle = Swapped::new(mock);
    handle.signals = Some(Arc::clone(&signals) as _);
    match stream {
        StreamName::Stdout => handle.stdout = Some(Arc::clone(&pause) as _),
        StreamName::Stderr => handle.stderr = Some(Arc::clone(&pause) as _),
    }
    (signals, pause, RunOptions::new().process(Arc::new(handle)))
}

async fn start<F: Future>(mut future: Pin<&mut F>) {
    poll_fn(|context| {
        assert!(future.as_mut().poll(context).is_pending());
        Poll::Ready(())
    })
    .await;
}

fn literal(text: &str, _: &ViewContext) -> String {
    text.to_owned()
}

#[tokio::test]
async fn an_exit_event_writes_a_waiting_pipe_message_before_shutdown_handlers_and_only_once() {
    let (signals, pause, options) = fixture(MockFields::new());
    let mock = Arc::clone(&signals.mock);
    let handled = Arc::new(Mutex::new(None));
    let observed = Arc::clone(&handled);
    let app = Application::new("ship").action(move |ctx: Context| {
        let (signals, pause) = (Arc::clone(&signals), Arc::clone(&pause));
        let observed = Arc::clone(&observed);
        async move {
            let mock = Arc::clone(&signals.mock);
            let _handler = ctx.on_shutdown(move |event| {
                *observed.lock().unwrap() = Some((event.cause, event.code, mock.stderr_text()));
            });
            pause.next();
            let mut first = std::pin::pin!(ctx.out.error("first"));
            start(first.as_mut()).await;
            let mut message = std::pin::pin!(ctx.out.error("queued last"));
            start(message.as_mut()).await;
            signals.fire(1);
            assert_eq!(signals.mock.stderr_text(), "✘ first\n✘ queued last\n");
            pause.resume.notify_one();
            first.await?;
            message.await
        }
    });
    assert_eq!(app.run(options).await.get(), 0);
    assert_eq!(
        handled.lock().unwrap().take(),
        Some((
            ShutdownCause::Exit,
            1,
            "✘ first\n✘ queued last\n".to_owned()
        ))
    );
    assert_eq!(mock.stderr_text(), "✘ first\n✘ queued last\n");
}

#[tokio::test]
async fn an_exit_event_restores_the_cursor_only_on_a_terminal_when_nothing_is_queued() {
    for terminal in [false, true] {
        let mut fields = MockFields::new();
        if terminal {
            fields = fields.terminal(MockTerminal::new(80, 24));
        }
        let (signals, _, options) = fixture(fields);
        let app = Application::new("ship").action(move |ctx: Context| {
            let signals = Arc::clone(&signals);
            async move {
                ctx.out
                    .region(RegionOptions::new())
                    .draw("working", &View::new(literal))
                    .await?;
                let before = signals.mock.stderr_text().len();
                signals.fire(1);
                assert_eq!(
                    &signals.mock.stderr_text()[before..],
                    if terminal { SHOW_CURSOR } else { "" }
                );
                Ok(())
            }
        });
        assert_eq!(app.run(options).await.get(), 0);
    }
}

#[tokio::test]
async fn an_exit_event_interleaves_queued_messages_and_frames_on_stderr() {
    let (signals, pause, options) = fixture(MockFields::new().terminal(MockTerminal::new(80, 24)));
    let mock = Arc::clone(&signals.mock);
    let app = Application::new("ship").action(move |ctx: Context| {
        let (signals, pause) = (Arc::clone(&signals), Arc::clone(&pause));
        async move {
            let region = ctx.out.region(RegionOptions::new());
            region.draw("working 1/2", &View::new(literal)).await?;
            pause.next();
            let mut block = std::pin::pin!(ctx.out.error("block"));
            start(block.as_mut()).await;
            let mut first = std::pin::pin!(ctx.out.error("first"));
            start(first.as_mut()).await;
            let mut frame = std::pin::pin!(region.draw("working 2/2", &View::new(literal)));
            start(frame.as_mut()).await;
            let mut last = std::pin::pin!(ctx.out.warn("second"));
            start(last.as_mut()).await;
            let before = signals.mock.stderr_text().len();
            signals.fire(1);
            assert_eq!(
                &signals.mock.stderr_text()[before..],
                concat!(
                    "\r\u{1b}[J✘ first\nworking 1/2",
                    "\r\u{1b}[Jworking 2/2",
                    "\r\u{1b}[J⚠ second\nworking 2/2\u{1b}[?25h",
                )
            );
            pause.resume.notify_one();
            block.await?;
            first.await?;
            frame.await?;
            last.await
        }
    });
    assert_eq!(app.run(options).await.get(), 0);
    assert_eq!(
        mock.stderr_text(),
        concat!(
            "working 1/2\r\u{1b}[J✘ block\nworking 1/2",
            "\r\u{1b}[J✘ first\nworking 1/2\r\u{1b}[Jworking 2/2",
            "\r\u{1b}[J⚠ second\nworking 2/2\u{1b}[?25h\n",
        )
    );
}

#[tokio::test]
async fn an_exit_event_finishes_a_partly_handed_off_print_then_the_shared_terminal_queue() {
    let fields = MockFields::new().terminal(MockTerminal::new(80, 24).streams([
        loomcli_testing::StreamName::Stdout,
        loomcli_testing::StreamName::Stderr,
    ]));
    let (signals, pause, options) = fixture(fields);
    let mock = Arc::clone(&signals.mock);
    let app = Application::new("ship").action(move |ctx: Context| {
        let (signals, pause) = (Arc::clone(&signals), Arc::clone(&pause));
        async move {
            ctx.out
                .region(RegionOptions::new())
                .draw("working", &View::new(literal))
                .await?;
            pause.next();
            let mut first = std::pin::pin!(ctx.out.print("applied"));
            start(first.as_mut()).await;
            assert_eq!(signals.mock.stdout_text(), "");
            assert_eq!(signals.mock.stderr_text(), "working\r\u{1b}[J");

            let mut second = std::pin::pin!(ctx.out.error("failed"));
            start(second.as_mut()).await;
            let mut third = std::pin::pin!(ctx.out.print("retrying"));
            start(third.as_mut()).await;

            signals.fire(1);
            let transcript: String = signals
                .mock
                .transcript()
                .iter()
                .filter_map(|write| match write {
                    Write::Stdout(text) | Write::Stderr(text) => Some(text.as_str()),
                    _ => None,
                })
                .collect();
            assert_eq!(
                transcript,
                concat!(
                    "working\r\u{1b}[Japplied\nworking",
                    "\r\u{1b}[J✘ failed\nworking",
                    "\r\u{1b}[Jretrying\nworking\u{1b}[?25h",
                )
            );
            pause.resume.notify_one();
            first.await?;
            second.await?;
            third.await
        }
    });
    assert_eq!(app.run(options).await.get(), 0);
    assert_eq!(mock.stdout_text(), "applied\nretrying\n");
    assert_eq!(
        mock.stderr_text(),
        "working\r\u{1b}[Jworking\r\u{1b}[J✘ failed\nworking\r\u{1b}[Jworking\u{1b}[?25h\n"
    );
}

#[tokio::test]
async fn the_exit_event_draws_a_queued_first_frame_before_showing_the_cursor() {
    let (signals, pause, options) = fixture(MockFields::new().terminal(MockTerminal::new(80, 24)));
    let app = Application::new("ship").action(move |ctx: Context| {
        let (signals, pause) = (Arc::clone(&signals), Arc::clone(&pause));
        async move {
            pause.next();
            let mut block = std::pin::pin!(ctx.out.error("block"));
            start(block.as_mut()).await;
            let region = ctx.out.region(RegionOptions::new());
            let mut frame = std::pin::pin!(region.draw("first frame", &View::new(literal)));
            start(frame.as_mut()).await;
            signals.fire(1);
            assert_eq!(
                signals.mock.stderr_text(),
                "✘ block\nfirst frame\u{1b}[?25h"
            );
            pause.resume.notify_one();
            block.await?;
            frame.await
        }
    });
    assert_eq!(app.run(options).await.get(), 0);
}

#[tokio::test]
async fn an_immediate_signal_shutdown_drains_the_write_queue_in_that_step() {
    for (signal, status, terminal) in [
        (ProcessSignal::Quit, 131, true),
        (ProcessSignal::Term, 143, false),
    ] {
        let mut fields = MockFields::new();
        if terminal {
            fields = fields.terminal(MockTerminal::new(80, 24));
        }
        let (signals, pause, options) = fixture(fields);
        let app = Application::new("ship")
            .shutdown_timeout(0)
            .action(move |ctx: Context| {
                let (signals, pause) = (Arc::clone(&signals), Arc::clone(&pause));
                async move {
                    pause.next();
                    let mut block = std::pin::pin!(ctx.out.error("block"));
                    start(block.as_mut()).await;
                    let mut message = std::pin::pin!(ctx.out.error("The deploy was interrupted."));
                    start(message.as_mut()).await;
                    signals.mock.raise(signal);
                    assert_eq!(
                        signals.mock.stderr_text(),
                        format!(
                            "✘ block\n✘ The deploy was interrupted.\n{}",
                            if terminal { SHOW_CURSOR } else { "" }
                        ),
                    );
                    assert_eq!(signals.mock.ended_by(), Some(signal));
                    pause.resume.notify_one();
                    block.await?;
                    message.await
                }
            });
        assert_eq!(app.run(options).await.get(), status);
    }
}

#[test]
fn sigquit_drains_the_last_completed_layout_while_a_lane_view_is_blocked() {
    // The second view call lays out the second chunk.
    sigquit_while_the_second_view_call_is_blocked(vec!["first\npartial", " in flight"]);
}

#[test]
fn sigquit_drains_the_last_completed_layout_while_the_final_layouts_view_is_blocked() {
    // The source ends after one chunk, so the second view call lays out the final layout.
    sigquit_while_the_second_view_call_is_blocked(vec!["first\npartial"]);
}

/// Prints `parts` as one streamed message, blocks the lane view on its second call, raises
/// SIGQUIT, and asserts the drain wrote the first call's layout before the view returned.
fn sigquit_while_the_second_view_call_is_blocked(parts: Vec<&'static str>) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    use loomcli_core::{lanes, override_view};
    use support::streaming::chunks;

    let mock = mock_process(MockFields::new());
    let (entered, rendering) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let blocked = Mutex::new(Some(blocked));
    let calls = AtomicUsize::new(0);
    let view = View::new(move |text: &str, _| {
        if calls.fetch_add(1, Ordering::SeqCst) == 1
            && let Some(blocked) = blocked.lock().unwrap().take()
        {
            entered.send(()).unwrap();
            blocked.recv().unwrap();
        }
        text.to_owned()
    });
    let app = Application::new("streamed")
        .overrides([override_view(lanes::print(), view)])
        .action(move |ctx: Context| {
            let parts = parts.clone();
            async move { ctx.out.print(chunks(parts)).await }
        });
    let process = mock.clone();
    let run = std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(app.run(RunOptions::new().process(process)))
            .get()
    });

    // The signal cannot start until the second view call has begun. That view stays blocked
    // until the signal has returned or the test has detected a stalled shutdown.
    let limit = Duration::from_secs(5);
    rendering.recv_timeout(limit).unwrap();
    let (finished, drained) = mpsc::channel();
    let signalled = std::thread::spawn(move || {
        mock.raise(ProcessSignal::Quit);
        finished
            .send((mock.ended_by(), mock.stdout_text()))
            .unwrap();
    });
    let at_reraise = drained.recv_timeout(limit);
    release.send(()).unwrap();
    signalled.join().unwrap();
    let status = run.join().unwrap();
    assert_eq!(
        at_reraise.expect("SIGQUIT did not re-raise while the lane view was blocked"),
        (Some(ProcessSignal::Quit), "first\npartial\n".to_owned()),
    );
    assert_eq!(status, 131);
}

#[tokio::test]
async fn log_hook_records_follow_polled_messages_on_pipes_and_shared_terminals() {
    for (terminal, frame, expected) in [
        (false, false, "ℹ lane\n[REC] after\n"),
        (true, false, "before\n[REC] after\n"),
        (
            true,
            true,
            "FRAME\r\u{1b}[Jbefore\nFRAME\r\u{1b}[J[REC] after\nFRAME\n",
        ),
    ] {
        let mut fields = MockFields::new();
        if terminal {
            fields = fields.terminal(
                MockTerminal::new(80, 24).streams([StreamName::Stdout, StreamName::Stderr]),
            );
        }
        let held = if terminal && !frame {
            StreamName::Stdout
        } else {
            StreamName::Stderr
        };
        let (signals, pause, options) = fixture_with_paused_stream(fields, held);
        let mock = Arc::clone(&signals.mock);
        let app = loomcli_core::__private::install_log_hook(
            Application::new("ship").action(move |ctx: Context| {
                let pause = Arc::clone(&pause);
                async move {
                    if frame {
                        ctx.out
                            .region(RegionOptions::new())
                            .draw("FRAME", &View::new(literal))
                            .await?;
                    }
                    pause.next();
                    let mut message = std::pin::pin!(async {
                        if terminal {
                            ctx.out.print("before").await
                        } else {
                            ctx.out.info("lane").await
                        }
                    });
                    start(message.as_mut()).await;
                    ctx.log.info("after", ());
                    pause.resume.notify_one();
                    message.await
                }
            }),
            |event: &LogEvent, destination: &LogDestination| {
                if let Some(stderr) = &destination.stderr {
                    drop(stderr.write(format!("[REC] {}\n", event.message).as_bytes()));
                }
            },
        );
        assert_eq!(app.run(options).await.get(), 0);
        let writes = mock.transcript();
        let bytes: String = writes
            .iter()
            .filter_map(|write| match write {
                Write::Stdout(text) | Write::Stderr(text) => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(bytes, expected);
    }
}

#[tokio::test]
async fn zero_shutdown_budget_drains_a_record_queued_during_cancellation() {
    let (signals, _, options) = fixture(MockFields::new());
    let mock = Arc::clone(&signals.mock);
    let app = loomcli_core::__private::install_log_hook(
        Application::new("ship")
            .shutdown_timeout(0)
            .action(move |ctx: Context| {
                let signals = Arc::clone(&signals);
                async move {
                    let region = ctx.out.region(RegionOptions::new());
                    region.on_close(move |_| ctx.log.info("Stopped before the upload.", ()));
                    signals.mock.raise(ProcessSignal::Term);
                    assert_eq!(signals.mock.ended_by(), Some(ProcessSignal::Term));
                    assert_eq!(signals.mock.stderr_text(), "✘ Stopped before the upload.\n");
                    Ok(())
                }
            }),
        |event: &LogEvent, destination: &LogDestination| {
            if let Some(stderr) = &destination.stderr {
                drop(stderr.write(format!("✘ {}\n", event.message).as_bytes()));
            }
        },
    );
    assert_eq!(app.run(options).await.get(), 143);
    assert_eq!(mock.stderr_text(), "✘ Stopped before the upload.\n");
}

/// Holds a sequence's first row until another write is queued behind the sequence.
struct HeldRow(Option<tokio::sync::oneshot::Receiver<&'static str>>);

impl loomcli_core::Stream for HeldRow {
    type Item = Result<&'static str, loomcli_core::Error>;

    fn poll_next(
        mut self: Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        let Some(receiver) = self.0.as_mut() else {
            return Poll::Ready(None);
        };
        let read = std::task::ready!(Pin::new(receiver).poll(context));
        self.0 = None;
        Poll::Ready(read.ok().map(Ok))
    }
}

#[tokio::test]
async fn an_exit_event_keeps_a_queued_row_ahead_of_the_write_waiting_for_its_sequence() {
    use loomcli_core::{RowSource, RowView};

    let fields = MockFields::new()
        .terminal(MockTerminal::new(80, 24).streams([StreamName::Stdout, StreamName::Stderr]));
    let (signals, pause, options) = fixture(fields);
    let mock = Arc::clone(&signals.mock);
    let app = Application::new("ship").action(move |ctx: Context| {
        let (signals, pause) = (Arc::clone(&signals), Arc::clone(&pause));
        async move {
            pause.next();
            let mut block = std::pin::pin!(ctx.out.warn("block"));
            start(block.as_mut()).await;

            let (ready, row) = tokio::sync::oneshot::channel();
            let view = RowView::new(|row: &&str, _, _| format!("{row}\n"));
            let mut sequence =
                std::pin::pin!(ctx.out.render(RowSource::stream(HeldRow(Some(row))), &view));
            start(sequence.as_mut()).await;
            let mut waiting = std::pin::pin!(ctx.out.print("waiting"));
            start(waiting.as_mut()).await;
            ready.send("row").unwrap();
            start(sequence.as_mut()).await;

            signals.fire(1);
            assert_eq!(signals.mock.stdout_text(), "row\nwaiting\n");
            pause.resume.notify_one();
            block.await?;
            sequence.await?;
            waiting.await
        }
    });
    assert_eq!(app.run(options).await.get(), 0);
    assert_eq!(mock.stdout_text(), "row\nwaiting\n");
    assert_eq!(mock.stderr_text(), "⚠ block\n\u{1b}[?25h");
}

#[tokio::test]
async fn a_shutdown_handlers_log_drains_the_warning_it_queued_after_the_end() {
    let (signals, pause, options) = fixture(MockFields::new().argv(["-v"]));
    let mock = Arc::clone(&signals.mock);
    let app = loomcli_core::__private::install_log_hook(
        Application::new("ship")
            .global_option("verbose", loomcli_core::Opt::count().short('v').verbose())
            .action(move |ctx: Context| {
                let (signals, pause) = (Arc::clone(&signals), Arc::clone(&pause));
                async move {
                    pause.next();
                    let mut hold = std::pin::pin!(ctx.out.warn("leaving"));
                    start(hold.as_mut()).await;
                    let out = ctx.out.clone();
                    let log = ctx.log.clone();
                    let _kept = ctx.on_shutdown(move |_| {
                        let mut warning = std::pin::pin!(out.warn("handler warn"));
                        let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
                        assert!(warning.as_mut().poll(&mut cx).is_pending());
                        log.info("handler record", ());
                    });
                    signals.fire(7);
                    pause.resume.notify_one();
                    hold.await
                }
            }),
        |event, destination| {
            if let Some(stderr) = &destination.stderr {
                let bytes = format!("[REC] {}\n", event.message);
                let mut write = stderr.write(bytes.as_bytes());
                let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
                assert!(write.as_mut().poll(&mut cx).is_ready());
            }
        },
    );
    assert_eq!(app.run(options).await.get(), 0);
    assert_eq!(
        mock.stderr_text(),
        "⚠ leaving\n⚠ handler warn\n› handler record\n[REC] handler record\n"
    );
}

#[tokio::test]
async fn exit_finishes_received_streamed_print_before_the_waiting_terminal_writes() {
    use loomcli_core::{Error, Stream, StreamedMessage};

    struct HeldLine(Option<String>, Arc<tokio::sync::Notify>);

    impl Stream for HeldLine {
        type Item = Result<String, Error>;

        fn poll_next(
            mut self: std::pin::Pin<&mut Self>,
            _: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Option<Self::Item>> {
            if let Some(text) = self.0.take() {
                std::task::Poll::Ready(Some(Ok(text)))
            } else {
                self.1.notify_one();
                std::task::Poll::Pending
            }
        }
    }

    let fields = MockFields::new()
        .terminal(MockTerminal::new(80, 24).streams([StreamName::Stdout, StreamName::Stderr]));
    let (signals, _pause, options) = fixture(fields);
    let source = signals.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let signals = source.clone();
        async move {
            let ready = Arc::new(tokio::sync::Notify::new());
            let done = ctx.out.print(StreamedMessage::new(HeldLine(
                Some("first\nsecond".to_owned()),
                Arc::clone(&ready),
            )));
            ready.notified().await;
            let mut after = std::pin::pin!(ctx.out.warn("after"));
            assert!(
                std::future::poll_fn(|cx| std::task::Poll::Ready(after.as_mut().poll(cx)))
                    .await
                    .is_pending()
            );
            signals.fire(1);
            assert_eq!(signals.mock.stdout_text(), "first\nsecond\n");
            assert!(signals.mock.stderr_text().contains("after"));
            done.await?;
            after.await?;
            Ok(())
        }
    });
    let _ = app.run(options).await;
    assert_eq!(signals.mock.stdout_text(), "first\nsecond\n");
    assert!(signals.mock.stderr_text().contains("after"));
}

#[derive(Clone, Copy, Debug)]
enum StreamEnd {
    Exit,
    Signal(ProcessSignal, u8),
    WhileQueuing { hops: usize, ends_line: bool },
}

#[tokio::test]
async fn a_colored_held_print_finishes_before_warnings_and_log_writes_at_exit_or_shutdown() {
    use loomcli_core::{Error, Opt, RenderingPolicy, StreamedMessage, Switch};
    use support::streaming::{PollStream, bytes};

    let ordinary = [
        (StreamEnd::Exit, false),
        (StreamEnd::Exit, true),
        (StreamEnd::Signal(ProcessSignal::Term, 143), false),
        (StreamEnd::Signal(ProcessSignal::Quit, 131), true),
    ];
    let queued = (0..5).flat_map(|hops| {
        [false, true].map(|ends_line| (StreamEnd::WhileQueuing { hops, ends_line }, false))
    });
    for (end, warn) in ordinary.into_iter().chain(queued) {
        let fields = MockFields::new()
            .argv(["-v"])
            .terminal(MockTerminal::new(80, 24).streams([StreamName::Stdout, StreamName::Stderr]));
        let (signals, _, options) = fixture(fields);
        let source = signals.clone();
        let app = loomcli_core::__private::install_log_hook(
            Application::new("app")
                .global_option("verbose", Opt::count().short('v').verbose())
                .shutdown_timeout(0)
                .action(move |ctx: Context| {
                    let signals = source.clone();
                    async move {
                        let after_first = Arc::new(tokio::sync::Notify::new());
                        let take_second = Arc::new(tokio::sync::Notify::new());
                        let after_second = Arc::new(tokio::sync::Notify::new());
                        let ready = after_first.clone();
                        let observed = after_second.clone();
                        let mut release = Box::pin(take_second.clone().notified_owned());
                        let next = if matches!(
                            end,
                            StreamEnd::WhileQueuing {
                                ends_line: true,
                                ..
                            }
                        ) {
                            " part-b\n"
                        } else {
                            " part-b"
                        };
                        let mut first = Some("part-a \x1b[31mred");
                        let mut second = Some(next);
                        let producer = PollStream(move |cx: &mut std::task::Context<'_>| {
                            if let Some(text) = first.take() {
                                return Poll::Ready(Some(Ok::<String, Error>(text.to_owned())));
                            }
                            if second.is_some() {
                                ready.notify_one();
                                std::task::ready!(release.as_mut().poll(cx));
                                return Poll::Ready(second.take().map(|text| Ok(text.to_owned())));
                            }
                            observed.notify_one();
                            Poll::Pending
                        });
                        let done = ctx.out.print(StreamedMessage::new(producer));
                        after_first.notified().await;
                        let mut warning = std::pin::pin!(ctx.out.warn("mid-stream warning"));
                        if warn {
                            start(warning.as_mut()).await;
                        }
                        ctx.log.info("mid-stream", ());
                        take_second.notify_one();
                        if let StreamEnd::WhileQueuing { hops, .. } = end {
                            for _ in 0..hops {
                                tokio::task::yield_now().await;
                            }
                        } else {
                            after_second.notified().await;
                        }
                        match end {
                            StreamEnd::Exit | StreamEnd::WhileQueuing { .. } => signals.fire(4),
                            StreamEnd::Signal(signal, _) => signals.mock.raise(signal),
                        }
                        let output = bytes(&signals.mock.transcript());
                        let Some((line, later)) = output.split_once("\x1b[39m\n") else {
                            panic!("held line did not close for {end:?}: {output:?}");
                        };
                        assert!(
                            line.starts_with("part-a \x1b[31mred"),
                            "{end:?}: {output:?}"
                        );
                        assert!(!later.contains(" part-b"), "{end:?}: {output:?}");
                        if !matches!(end, StreamEnd::WhileQueuing { .. }) {
                            assert!(line.ends_with(" part-b"), "{end:?}: {output:?}");
                        }
                        let expected = if warn { "⚠ mid-stream warning\n" } else { "" };
                        assert!(
                            later.starts_with(&format!(
                                "{expected}› mid-stream\n[REC] mid-stream\n"
                            )),
                            "{end:?}: {output:?}"
                        );
                        done.await?;
                        if warn {
                            warning.await?;
                        }
                        Ok(())
                    }
                }),
            |event: &LogEvent, destination: &LogDestination| {
                if let Some(stderr) = &destination.stderr {
                    drop(stderr.write(format!("[REC] {}\n", event.message).as_bytes()));
                }
            },
        );
        let code = app
            .run(options.rendering(RenderingPolicy::new().color(Switch::Always)))
            .await;
        let status = match end {
            StreamEnd::Signal(_, status) => status,
            _ => 0,
        };
        assert_eq!(code.get(), status, "{end:?}");
    }
}

#[tokio::test]
async fn a_new_terminal_print_line_waits_for_earlier_stdout_writes() {
    use support::streaming::chunks;

    let fields = MockFields::new()
        .terminal(MockTerminal::new(80, 24).streams([StreamName::Stdout, StreamName::Stderr]));
    let (signals, pause, options) = fixture_with_paused_stream(fields, StreamName::Stdout);
    let target = pause.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let pause = target.clone();
        async move {
            pause.next();
            let mut first = std::pin::pin!(ctx.out.print("first"));
            start(first.as_mut()).await;
            let mut second = std::pin::pin!(ctx.out.print("second"));
            start(second.as_mut()).await;
            let third = ctx.out.print(chunks(["third", " line"]));

            tokio::task::yield_now().await;
            pause.resume.notify_one();
            let (first, second, third) = tokio::join!(first, second, third);
            first?;
            second?;
            third
        }
    });
    assert_eq!(app.run(options).await.get(), 0);
    assert_eq!(signals.mock.stdout_text(), "first\nsecond\nthird line\n");
}

#[tokio::test]
async fn a_piped_message_that_has_not_written_keeps_its_call_place_at_exit() {
    use loomcli_core::{Error, StreamedMessage};
    use support::streaming::PollStream;

    let (signals, pause, options) =
        fixture_with_paused_stream(MockFields::new(), StreamName::Stdout);
    let observe = signals.clone();
    let paused = pause.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let signals = observe.clone();
        let paused = paused.clone();
        async move {
            paused.next();
            let mut first = std::pin::pin!(ctx.out.print("first"));
            start(first.as_mut()).await;

            let ready = Arc::new(tokio::sync::Notify::new());
            let waiting = ready.clone();
            let mut part = Some("unwritten");
            let done = ctx.out.print(StreamedMessage::new(PollStream(
                move |_: &mut std::task::Context<'_>| {
                    if let Some(text) = part.take() {
                        Poll::Ready(Some(Ok::<_, Error>(text.to_owned())))
                    } else {
                        waiting.notify_one();
                        Poll::Pending
                    }
                },
            )));
            ready.notified().await;
            let mut last = std::pin::pin!(ctx.out.print("last"));
            start(last.as_mut()).await;

            signals.fire(0);
            assert_eq!(signals.mock.stdout_text(), "first\nunwritten\nlast\n");
            paused.resume.notify_one();
            first.await?;
            done.await?;
            last.await
        }
    });
    assert_eq!(app.run(options).await.get(), 0);
    assert_eq!(signals.mock.stdout_text(), "first\nunwritten\nlast\n");
}
