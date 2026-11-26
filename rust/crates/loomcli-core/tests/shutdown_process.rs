//! The shutdown where only a real process can show it, the part of `shutdown-process.test.ts` and
//! `cancellation.test.ts` a mock cannot express: a real ending signal reaches a run through the real
//! signal source, the run unwinds (except under `SIGQUIT`, which skips the budget), its
//! `on_shutdown` handler runs, and the process dies by the signal, so a shell reports 129, 130, 131,
//! or 143. An action that ignores its signal, or a provider's close that never settles, ends at its
//! budget; the handlers of the process, the
//! middleware, and the action run once, newest first, after the unwind; and a process-scoped
//! handler keeps core listening with no run, while a removed one is not called. A normal end
//! through `main` or `main_async` runs a pending process-scoped handler, and `main` inside a
//! runtime panics with core's `entry-point` diagnostic.
//!
//! The test runs this binary again as the probe, through `Application::main` on the real process,
//! because the re-raised signal ends the process that receives it. It has no test harness: its own
//! `main` is the parent unless the probe variable names a case. Every wait is bounded generously,
//! and the parent signals only after the probe announced it is ready.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

#[cfg(unix)]
fn main() -> std::process::ExitCode {
    match std::env::var(probe::CASE).ok().as_deref() {
        Some(case) => probe::run(case),
        None => {
            parent::run_all();
            std::process::ExitCode::SUCCESS
        }
    }
}

#[cfg(not(unix))]
fn main() {}

#[cfg(unix)]
mod probe {
    use std::future::{Future, pending, poll_fn};
    use std::io::Write;
    use std::pin::Pin;
    use std::task::Poll;

    use loomcli_core::{
        Activation, Application, CancellationSource, Context, EndingSignal, Error, Opt, Plugin,
        Provider, ProviderContext, RowSource, RowView, ShutdownCause, ShutdownEvent, Stream,
        StreamedMessage,
    };

    /// The variable that names the case the probe runs.
    pub const CASE: &str = "LOOMCLI_SHUTDOWN_PROBE";
    pub const PIPE_BUDGET_MS: u32 = 300;
    pub const LARGE_WRITE: usize = 4 * 1024 * 1024;

    /// One line on the real stdout, written at once, as a shell sees it.
    fn line(text: &str) {
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{text}");
        let _ = stdout.flush();
    }

    fn name(signal: EndingSignal) -> &'static str {
        match signal {
            EndingSignal::Hup => "SIGHUP",
            EndingSignal::Int => "SIGINT",
            EndingSignal::Quit => "SIGQUIT",
            EndingSignal::Term => "SIGTERM",
        }
    }

    fn described(label: &str, event: ShutdownEvent) -> String {
        let cause = match event.cause {
            ShutdownCause::Signal(signal) => name(signal),
            ShutdownCause::Exit => "exit",
        };
        format!("{label}:{cause}:{}", event.code)
    }

    /// A handler that writes its label and event.
    fn writing(label: &'static str) -> impl FnOnce(ShutdownEvent) + Send + 'static {
        move |event| line(&described(label, event))
    }

    fn source(ctx: &Context) -> &'static str {
        match ctx.signal.reason().map(|reason| reason.source) {
            Some(CancellationSource::Signal(signal)) => name(signal),
            _ => "other",
        }
    }

    /// Runs the probe's case on the real process. `watching` waits on the run signal and returns;
    /// `ignoring` never returns, so the budget ends the shutdown; `order` registers handlers from
    /// the process, a middleware, and the action; `process-scoped` holds a handler with no run.
    pub fn run(case: &str) -> std::process::ExitCode {
        // `SIGQUIT`'s default action dumps core; the probe leaves no core file behind.
        let limit = rustix::process::getrlimit(rustix::process::Resource::Core);
        let _ = rustix::process::setrlimit(
            rustix::process::Resource::Core,
            rustix::process::Rlimit {
                current: Some(0),
                maximum: limit.maximum,
            },
        );
        match case {
            "exit-main" => exit_main(),
            "exit-main-async" => exit_main_async(),
            "main-in-runtime" => main_in_runtime(),
            "order" => order(),
            "process-scoped" => process_scoped(),
            "closing" => closing(),
            "stalled-stdout" => stalled_stdout(true),
            "drained-stdout" => stalled_stdout(false),
            "queued-stdout" => queued_stdout(QueuedStdout::Small),
            "oversized-stdout" => queued_stdout(QueuedStdout::Oversized),
            "handler-stdout" => queued_stdout(QueuedStdout::Handler),
            "stalled-stderr" => streamed_stderr(true),
            "drained-stderr" => streamed_stderr(false),
            "unfinished-stderr-with-stdout-write" => unfinished_stderr(false),
            "unfinished-stderr-with-warning" => unfinished_stderr(true),
            _ => watching(case == "ignoring"),
        }
    }

    async fn start<F: Future>(mut work: Pin<&mut F>) {
        poll_fn(|context| {
            assert!(work.as_mut().poll(context).is_pending());
            Poll::Ready(())
        })
        .await;
    }

    fn stalled_stdout(signalled: bool) -> std::process::ExitCode {
        use std::io::Read;

        Application::new("probe")
            .shutdown_timeout(PIPE_BUDGET_MS)
            .action(move |ctx: Context| async move {
                let out = ctx.out.clone();
                let runtime = tokio::runtime::Handle::current();
                // The action can queue more output while an earlier write fills the pipe.
                let writer = std::thread::spawn(move || {
                    runtime.block_on(out.print(&"x".repeat(LARGE_WRITE)))
                });
                // The parent releases us after it has seen the write start on stdout.
                std::io::stdin().read_exact(&mut [0]).unwrap();
                let mut queued = std::pin::pin!(ctx.out.print("pending stdout"));
                start(queued.as_mut()).await;
                let _kept = ctx.on_shutdown(|event| eprintln!("{}", described("handler", event)));
                eprintln!("ready");
                if !signalled {
                    queued.await?;
                    return writer.join().unwrap();
                }
                pending().await
            })
            .main()
    }

    struct StderrChunk {
        text: Option<String>,
        stays_open: bool,
        received: Option<tokio::sync::oneshot::Sender<()>>,
    }

    impl Stream for StderrChunk {
        type Item = Result<String, Error>;

        fn poll_next(
            mut self: Pin<&mut Self>,
            _: &mut std::task::Context<'_>,
        ) -> Poll<Option<Self::Item>> {
            match self.text.take() {
                Some(text) => Poll::Ready(Some(Ok(text))),
                None => {
                    if let Some(received) = self.received.take() {
                        received.send(()).unwrap();
                    }
                    if self.stays_open {
                        Poll::Pending
                    } else {
                        Poll::Ready(None)
                    }
                }
            }
        }
    }

    fn streamed_stderr(signalled: bool) -> std::process::ExitCode {
        Application::new("probe")
            .plugins([handler_records()])
            .shutdown_timeout(PIPE_BUDGET_MS)
            .action(move |ctx: Context| async move {
                let message = StreamedMessage::new(StderrChunk {
                    text: Some(format!("{}\nmore\npartial", "x".repeat(LARGE_WRITE))),
                    stays_open: signalled,
                    received: None,
                });
                if signalled {
                    // Leave stdout pending too, so both drains run when the shell merges them.
                    let view = RowView::new(|_: &(), _, _| String::new());
                    let mut sequence =
                        std::pin::pin!(ctx.out.render(RowSource::stream(WaitingRows), &view));
                    start(sequence.as_mut()).await;
                    let mut queued = std::pin::pin!(ctx.out.print("pending stdout"));
                    start(queued.as_mut()).await;
                    let log = ctx.log.clone();
                    let _kept = ctx.on_shutdown(move |_| log.info("handler record", ()));
                    ctx.out.info(message).await?;
                    pending().await
                } else {
                    ctx.out.info(message).await
                }
            })
            .main()
    }

    fn unfinished_stderr(block_stderr: bool) -> std::process::ExitCode {
        Application::new("probe")
            .global_option("verbose", Opt::count().short('v').verbose())
            .shutdown_timeout(PIPE_BUDGET_MS)
            .action(move |ctx: Context| async move {
                let (received, wait_for_fragment) = tokio::sync::oneshot::channel();
                let _partial = ctx.out.info(StreamedMessage::new(StderrChunk {
                    text: Some("partial ".to_owned()),
                    stays_open: true,
                    received: Some(received),
                }));
                // The reader asks for the next chunk after it has laid out the fragment.
                // Start filling the pipe then, before the fragment reaches stderr at shutdown.
                wait_for_fragment.await.unwrap();
                if block_stderr {
                    ctx.out.print("x").await?;
                    ctx.out.warn(&"y".repeat(LARGE_WRITE)).await?;
                } else {
                    ctx.out.print(&"x".repeat(LARGE_WRITE)).await?;
                }
                pending().await
            })
            .main()
    }

    /// Holds stdout's queue turn without writing to the pipe.
    struct WaitingRows;

    impl Stream for WaitingRows {
        type Item = Result<(), Error>;

        fn poll_next(
            self: Pin<&mut Self>,
            _: &mut std::task::Context<'_>,
        ) -> Poll<Option<Self::Item>> {
            Poll::Pending
        }
    }

    #[derive(Clone, Copy)]
    enum QueuedStdout {
        Small,
        Oversized,
        Handler,
    }

    fn handler_records() -> Plugin {
        Plugin::new("@fixture/records").on_log(|event, destination| {
            if event.message == "handler record"
                && let Some(stderr) = &destination.stderr
            {
                let mut record = stderr.write(b"handler record\n");
                let mut task = std::task::Context::from_waker(std::task::Waker::noop());
                assert!(matches!(
                    record.as_mut().poll(&mut task),
                    Poll::Ready(Ok(()))
                ));
            }
        })
    }

    fn queued_stdout(case: QueuedStdout) -> std::process::ExitCode {
        Application::new("probe")
            .plugins([handler_records()])
            .shutdown_timeout(PIPE_BUDGET_MS)
            .action(move |ctx: Context| async move {
                let rows = RowSource::stream(WaitingRows);
                let view = RowView::new(|_: &(), _, _| String::new());
                let mut sequence = std::pin::pin!(ctx.out.render(rows, &view));
                start(sequence.as_mut()).await;
                let text = if matches!(case, QueuedStdout::Small) {
                    "pending stdout".to_owned()
                } else {
                    "x".repeat(LARGE_WRITE)
                };
                let mut queued = std::pin::pin!(ctx.out.print(&text));
                start(queued.as_mut()).await;
                let flags = rustix::fs::fcntl_getfl(std::io::stdout()).unwrap();
                let (out, log) = (ctx.out.clone(), ctx.log.clone());
                let _kept = ctx.on_shutdown(move |event| {
                    // The drain changes only O_NONBLOCK. Compare that bit alone: macOS sets a
                    // kernel bit in F_GETFL once a descriptor has been written.
                    let nonblock = rustix::fs::OFlags::NONBLOCK;
                    assert_eq!(
                        rustix::fs::fcntl_getfl(std::io::stdout())
                            .unwrap()
                            .contains(nonblock),
                        flags.contains(nonblock),
                    );
                    if matches!(case, QueuedStdout::Handler) {
                        use std::io::Read;

                        eprintln!("drained");
                        std::io::stdin().read_exact(&mut [0]).unwrap();
                        let mut late = std::pin::pin!(out.print("late stdout"));
                        let mut task = std::task::Context::from_waker(std::task::Waker::noop());
                        assert!(late.as_mut().poll(&mut task).is_pending());
                        log.info("handler record", ());
                    }
                    eprintln!("{}", described("handler", event));
                });
                eprintln!("ready");
                pending().await
            })
            .main()
    }

    /// An application whose action holds a process-scoped handler and ends normally.
    fn ending() -> Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
        Application::new("probe").action(|_: Context| async {
            let _process = loomcli_core::on_shutdown(writing("process"));
            line("ran");
            Ok(())
        })
    }

    fn exit_main() -> std::process::ExitCode {
        ending().main()
    }

    /// An application on a runtime of its own awaits `main_async`, which fires the exit event as
    /// `main` does.
    fn exit_main_async() -> std::process::ExitCode {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(ending().main_async())
    }

    /// `main` inside a runtime panics with the `entry-point` diagnostic.
    fn main_in_runtime() -> std::process::ExitCode {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async { ending().main() })
    }

    fn order() -> std::process::ExitCode {
        let _process = loomcli_core::on_shutdown(writing("process"));
        let registering = Plugin::new("@fixture/registering").middleware(
            Activation::Always,
            |ctx, next| async move {
                let _kept = ctx.on_shutdown(writing("middleware"));
                next.run().await.map(|_| ())
            },
        );
        Application::new("probe")
            .plugins([registering])
            .action(|ctx: Context| async move {
                let _first = ctx.on_shutdown(writing("first"));
                let _second = ctx.on_shutdown(writing("second"));
                line("ready");
                ctx.signal.cancelled().await;
                line(&format!("unwound:{}", source(&ctx)));
                Ok(())
            })
            .main()
    }

    /// A provider whose close never settles, so a signal during it meets the budget.
    fn closing() -> std::process::ExitCode {
        let held = Provider::new("held", |_: ProviderContext| async {
            Ok("value".to_owned())
        })
        .close(|_: std::sync::Arc<String>| async {
            line("ready");
            std::future::pending::<()>().await;
            Ok(())
        });
        Application::new("probe")
            .shutdown_timeout(400)
            .uses([&held])
            .action(move |ctx: Context| {
                let held = held.clone();
                async move {
                    let _kept = ctx.on_shutdown(writing("handler"));
                    let _value = ctx.provided(&held)?;
                    Ok(())
                }
            })
            .main()
    }

    fn process_scoped() -> std::process::ExitCode {
        let removed = loomcli_core::on_shutdown(writing("removed"));
        let _kept = loomcli_core::on_shutdown(writing("kept"));
        removed.remove();
        line("ready");
        // The signal ends the process; the parent kills one that outlives this wait.
        std::thread::sleep(std::time::Duration::from_secs(30));
        line("slept through");
        std::process::ExitCode::SUCCESS
    }

    fn watching(ignoring: bool) -> std::process::ExitCode {
        Application::new("probe")
            .shutdown_timeout(300)
            .action(move |ctx: Context| async move {
                let _kept = ctx.on_shutdown(writing("handler"));
                line("ready");
                ctx.signal.cancelled().await;
                if ignoring {
                    std::future::pending::<()>().await;
                }
                line(&format!("action:{}", source(&ctx)));
                Ok(())
            })
            .main()
    }
}

#[cfg(unix)]
mod parent {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::fd::OwnedFd;
    use std::os::unix::net::UnixStream;
    use std::os::unix::process::ExitStatusExt;
    use std::process::{Child, ChildStderr, ChildStdout, Command, ExitStatus, Stdio};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use rustix::process::{Pid, Signal, kill_process};

    const INFO_PREFIX: &[u8] = "ℹ ".as_bytes();

    /// What the probe printed and how it ended: the status a shell reports, and the time from the
    /// signal to its end.
    struct Ended {
        status: Option<i32>,
        stdout: String,
        elapsed: Duration,
    }

    /// Starts the probe on `case`, waits for its ready line, sends it `signal`, and waits for it to
    /// end. A probe that never announces itself or never ends is killed after 30 seconds.
    fn signalled(case: &str, signal: Signal) -> Ended {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .env(super::probe::CASE, case)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pid = Pid::from_child(&child);
        let (sender, ready) = mpsc::channel();
        let mut reader = BufReader::new(child.stdout.take().unwrap());
        let reading = std::thread::spawn(move || {
            let mut first = String::new();
            let _ = reader.read_line(&mut first);
            let _ = sender.send(first.clone());
            let mut rest = String::new();
            let _ = reader.read_to_string(&mut rest);
            first + &rest
        });
        let announced = ready.recv_timeout(Duration::from_secs(30));
        if announced.as_deref() != Ok("ready\n") {
            let _ = child.kill();
            panic!("the probe never announced it was ready: {announced:?}");
        }
        let sent = Instant::now();
        kill_process(pid, signal).unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                panic!("the probe never ended after {signal:?}");
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let elapsed = sent.elapsed();
        Ended {
            status: status
                .code()
                .or_else(|| status.signal().map(|number| 128 + number)),
            stdout: reading.join().unwrap(),
            elapsed,
        }
    }

    /// Runs the probe on `case` to its own end and reads its status, stdout, and stderr.
    fn finished(case: &str) -> (Option<i32>, String, String) {
        let output = Command::new(std::env::current_exe().unwrap())
            .env(super::probe::CASE, case)
            .env_remove("RUST_BACKTRACE")
            .stdin(Stdio::null())
            .output()
            .unwrap();
        (
            output.status.code(),
            String::from_utf8(output.stdout).unwrap(),
            String::from_utf8(output.stderr).unwrap(),
        )
    }

    /// A normal end through `main` or `main_async` fires the process's exit event, so a pending
    /// process-scoped handler runs with the run's code.
    fn main_and_main_async_run_a_pending_handler_at_a_normal_end() {
        for case in ["exit-main", "exit-main-async"] {
            let (status, stdout, stderr) = finished(case);
            assert_eq!(
                (status, stdout.as_str(), stderr.as_str()),
                (Some(0), "ran\nprocess:exit:0\n", ""),
                "{case}"
            );
        }
    }

    /// `main` on a thread that drives a runtime panics with core's diagnostic, not tokio's.
    fn main_inside_a_runtime_panics_with_the_entry_point_diagnostic() {
        let (status, stdout, stderr) = finished("main-in-runtime");
        assert_eq!((status, stdout.as_str()), (Some(101), ""), "{stderr}");
        assert!(
            stderr.contains("@loomcli/core/entry-point")
                && stderr.contains("Application \"probe\" called main inside a tokio runtime.")
                && stderr.contains("Await main_async() from an async main")
                && !stderr.contains("Cannot start a runtime"),
            "{stderr}"
        );
    }

    /// A cooperative action unwinds, its handler runs after the unwind, and the process dies by
    /// `SIGINT`, so a shell reports 130.
    fn a_sigint_unwinds_the_run_runs_its_handler_and_the_process_dies_by_it() {
        let ended = signalled("watching", Signal::INT);
        assert_eq!(ended.status, Some(130), "{}", ended.stdout);
        assert_eq!(
            ended.stdout, "ready\naction:SIGINT\nhandler:SIGINT:130\n",
            "the run unwinds, then its handler runs"
        );
    }

    /// An action that ignores its signal ends at its budget, and not before it, and its handler
    /// still runs.
    fn an_action_that_ignores_its_signal_ends_at_its_budget_with_its_handler_run() {
        let ended = signalled("ignoring", Signal::INT);
        assert_eq!(ended.status, Some(130), "{}", ended.stdout);
        assert_eq!(ended.stdout, "ready\nhandler:SIGINT:130\n");
        assert!(
            ended.elapsed >= Duration::from_millis(250),
            "{:?}",
            ended.elapsed
        );
    }

    /// Every other ending signal: the process dies by it with its status, and the run unwinds first
    /// except under `SIGQUIT`, which skips the budget.
    fn each_ending_signal_ends_the_process_by_it_with_its_status() {
        for (signal, label, status) in [
            (Signal::HUP, "SIGHUP", 129),
            (Signal::QUIT, "SIGQUIT", 131),
            (Signal::TERM, "SIGTERM", 143),
        ] {
            let ended = signalled("watching", signal);
            assert_eq!(ended.status, Some(status), "{label}: {}", ended.stdout);
            if signal == Signal::QUIT {
                // The runtime's worker may resume the action between its cancellation and the
                // re-raise, a recorded deviation, so its line may be there or not.
                let stdout = ended.stdout.replace("action:SIGQUIT\n", "");
                assert_eq!(stdout, "ready\nhandler:SIGQUIT:131\n");
            } else {
                assert_eq!(
                    ended.stdout,
                    format!("ready\naction:{label}\nhandler:{label}:{status}\n")
                );
            }
        }
    }

    /// The handlers of the process, the middleware, and the action run once, newest first, after
    /// the run unwound.
    fn every_handler_runs_once_newest_first_after_the_unwind() {
        let ended = signalled("order", Signal::INT);
        assert_eq!(ended.status, Some(130), "{}", ended.stdout);
        assert_eq!(
            ended.stdout,
            "ready\nunwound:SIGINT\nsecond:SIGINT:130\nfirst:SIGINT:130\nmiddleware:SIGINT:130\nprocess:SIGINT:130\n"
        );
    }

    /// A process-scoped handler keeps core listening with no run, so a signal runs it and ends the
    /// process by the signal; a removed one is not called.
    fn a_process_scoped_handler_keeps_core_listening_with_no_run() {
        let ended = signalled("process-scoped", Signal::HUP);
        assert_eq!(ended.status, Some(129), "{}", ended.stdout);
        assert_eq!(ended.stdout, "ready\nkept:SIGHUP:129\n");
    }

    /// A signal during a provider's close that never settles ends the process at the budget, and
    /// not before it.
    fn a_signal_during_a_providers_close_ends_at_the_budget() {
        let ended = signalled("closing", Signal::INT);
        assert_eq!(ended.status, Some(130), "{}", ended.stdout);
        assert_eq!(ended.stdout, "ready\nhandler:SIGINT:130\n");
        assert!(
            ended.elapsed >= Duration::from_millis(350),
            "{:?}",
            ended.elapsed
        );
    }

    fn stdout_probe(case: &str, in_flight: bool) -> (Child, ChildStdout, BufReader<ChildStderr>) {
        let mut child = spawn_stdout_probe(case, Stdio::piped(), Stdio::piped());
        let mut stdout = child.stdout.take().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let (child, stdout, stderr) = ready_stdout_probe(child, move || {
            if in_flight {
                let mut first = [0];
                stdout.read_exact(&mut first).unwrap();
                assert_eq!(first, *b"x");
                stdin.write_all(b"1").unwrap();
            }
            stdout
        });
        (child, stdout, stderr)
    }

    fn spawn_stdout_probe(case: &str, stdin: Stdio, stdout: Stdio) -> Child {
        Command::new(std::env::current_exe().unwrap())
            .env(super::probe::CASE, case)
            .stdin(stdin)
            .stdout(stdout)
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }

    fn ready_stdout_probe<T: Send + 'static>(
        mut child: Child,
        before_ready: impl FnOnce() -> T + Send + 'static,
    ) -> (Child, T, BufReader<ChildStderr>) {
        let stderr = BufReader::new(child.stderr.take().unwrap());
        wait_for_probe_line(child, stderr, "ready\n", before_ready)
    }

    fn wait_for_probe_line<T: Send + 'static>(
        mut child: Child,
        mut stderr: BufReader<ChildStderr>,
        expected: &str,
        before_read: impl FnOnce() -> T + Send + 'static,
    ) -> (Child, T, BufReader<ChildStderr>) {
        let (sender, ready) = mpsc::channel();
        let reading = std::thread::spawn(move || {
            let value = before_read();
            let mut line = String::new();
            stderr.read_line(&mut line).unwrap();
            sender.send(line).unwrap();
            (value, stderr)
        });
        let announced = ready.recv_timeout(Duration::from_secs(30));
        if announced.as_deref() != Ok(expected) {
            let _ = child.kill();
            child.wait().unwrap();
            panic!("the probe did not report {expected:?}: {announced:?}");
        }
        let (value, stderr) = reading.join().unwrap();
        (child, value, stderr)
    }

    fn wait_for_probe(child: &mut Child, timeout: Duration, failure: &str) -> ExitStatus {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                return status;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                child.wait().unwrap();
                panic!("{failure}");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn signal_stdout_probe(case: &str, signal: Signal, name: &str) -> Vec<u8> {
        let (mut child, mut stdout, mut stderr) = stdout_probe(case, case == "stalled-stdout");
        end_stdout_probe(&mut child, &mut stderr, signal, name, case);

        // Keep the reader open and stalled until after the child's re-raise.
        let mut rest = Vec::new();
        stdout.read_to_end(&mut rest).unwrap();
        rest
    }

    fn end_stdout_probe(
        child: &mut Child,
        mut stderr: impl Read,
        signal: Signal,
        name: &str,
        case: &str,
    ) {
        let number = signal.as_raw();
        let budget = Duration::from_millis(u64::from(super::probe::PIPE_BUDGET_MS));
        let sent = Instant::now();
        kill_process(Pid::from_child(child), signal).unwrap();
        let status = wait_for_probe(
            child,
            budget + Duration::from_secs(2),
            &format!("the {case} probe outlived its shutdown budget after {name}"),
        );
        assert_eq!(status.signal(), Some(number), "{name}: {status}");
        assert!(sent.elapsed() >= budget.saturating_sub(Duration::from_millis(50)));

        let mut report = String::new();
        stderr.read_to_string(&mut report).unwrap();
        assert_eq!(report, format!("handler:{name}:{}\n", 128 + number));
    }

    fn signals_end_the_process_when_the_stdout_reader_stalls() {
        for (signal, name) in [(Signal::TERM, "SIGTERM"), (Signal::INT, "SIGINT")] {
            let stdout = signal_stdout_probe("stalled-stdout", signal, name);
            assert!(stdout.iter().all(|byte| *byte == b'x'));
        }
    }

    fn signals_end_the_process_when_the_stdout_socket_reader_stalls() {
        let (mut reader, writer) = UnixStream::pair().unwrap();
        rustix::net::sockopt::set_socket_send_buffer_size(&writer, 4096).unwrap();
        let child = spawn_stdout_probe(
            "oversized-stdout",
            Stdio::null(),
            Stdio::from(OwnedFd::from(writer)),
        );
        let (mut child, (), stderr) = ready_stdout_probe(child, || ());
        end_stdout_probe(
            &mut child,
            stderr,
            Signal::TERM,
            "SIGTERM",
            "stalled socket",
        );

        // Keep the socket open and unread until the child re-raises the signal.
        let mut stdout = Vec::new();
        reader.read_to_end(&mut stdout).unwrap();
        assert!(!stdout.is_empty());
        assert!(stdout.len() < super::probe::LARGE_WRITE);
        assert!(stdout.iter().all(|byte| *byte == b'x'));
    }

    fn shutdown_keeps_stdout_a_prefix_after_a_handler_logs() {
        let (mut reader, writer) = UnixStream::pair().unwrap();
        rustix::net::sockopt::set_socket_send_buffer_size(&writer, 4096).unwrap();
        let mut child = spawn_stdout_probe(
            "handler-stdout",
            Stdio::piped(),
            Stdio::from(OwnedFd::from(writer)),
        );
        let mut stdin = child.stdin.take().unwrap();
        let (child, (), stderr) = ready_stdout_probe(child, || ());
        kill_process(Pid::from_child(&child), Signal::TERM).unwrap();
        let (mut child, (), mut stderr) = wait_for_probe_line(child, stderr, "drained\n", || ());

        // Make room for the handler's later write after the original drain hit backpressure.
        let mut stdout = Vec::new();
        reader.set_nonblocking(true).unwrap();
        let result = reader.read_to_end(&mut stdout);
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
        reader.set_nonblocking(false).unwrap();
        assert!(!stdout.is_empty());
        assert!(stdout.len() < super::probe::LARGE_WRITE);
        stdin.write_all(b"1").unwrap();
        let status = wait_for_probe(
            &mut child,
            Duration::from_secs(2),
            "the probe never finished after its shutdown handler logged",
        );
        assert_eq!(status.signal(), Some(Signal::TERM.as_raw()));
        let mut report = String::new();
        stderr.read_to_string(&mut report).unwrap();
        assert_eq!(report, "handler record\nhandler:SIGTERM:143\n");
        assert_eq!(reader.read_to_end(&mut stdout).unwrap(), 0);
        assert!(stdout.iter().all(|byte| *byte == b'x'));
    }

    fn shutdown_does_not_block_on_a_fresh_stdout_write() {
        let stdout = signal_stdout_probe("oversized-stdout", Signal::TERM, "SIGTERM");
        assert!(stdout.len() < super::probe::LARGE_WRITE);
        assert!(stdout.iter().all(|byte| *byte == b'x'));
    }

    fn shutdown_sends_queued_bytes_that_fit_in_the_stdout_pipe() {
        let stdout = signal_stdout_probe("queued-stdout", Signal::TERM, "SIGTERM");
        assert_eq!(stdout, b"pending stdout\n");
    }

    fn shutdown_restores_stdout_flags_when_the_pipe_cannot_be_reopened() {
        use rustix::fs::{OFlags, fcntl_getfl};
        use rustix::io::{FdFlags, fcntl_setfd};

        for (case, closed) in [
            ("queued-stdout", false),
            ("oversized-stdout", false),
            ("queued-stdout", true),
        ] {
            let (reader, writer) = rustix::pipe::pipe().unwrap();
            fcntl_setfd(&reader, FdFlags::CLOEXEC).unwrap();
            fcntl_setfd(&writer, FdFlags::CLOEXEC).unwrap();
            // An unprivileged Linux process can write the inherited pipe, but cannot reopen it.
            #[cfg(target_os = "linux")]
            rustix::fs::fchmod(&writer, rustix::fs::Mode::empty()).unwrap();
            let mut reader = (!closed).then_some(std::fs::File::from(reader));
            let saved = fcntl_getfl(&writer).unwrap();
            assert!(!saved.contains(OFlags::NONBLOCK));
            let child = spawn_stdout_probe(
                case,
                Stdio::null(),
                Stdio::from(writer.try_clone().unwrap()),
            );
            let (mut child, (), stderr) = ready_stdout_probe(child, || ());
            end_stdout_probe(&mut child, stderr, Signal::TERM, "SIGTERM", case);
            // The drain changes only O_NONBLOCK; macOS also sets a kernel bit once written.
            assert!(!fcntl_getfl(&writer).unwrap().contains(OFlags::NONBLOCK));
            drop(writer);
            if let Some(reader) = &mut reader {
                let mut bytes = Vec::new();
                reader.read_to_end(&mut bytes).unwrap();
                if case == "oversized-stdout" {
                    assert!(!bytes.is_empty());
                    assert!(bytes.len() < super::probe::LARGE_WRITE);
                    assert!(bytes.iter().all(|byte| *byte == b'x'));
                } else {
                    assert_eq!(bytes, b"pending stdout\n");
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    fn shutdown_waits_for_in_flight_terminal_stdout() {
        use rustix::pty::{OpenptFlags, ioctl_tiocgptpeer, openpt, unlockpt};
        use rustix::termios::{OptionalActions, tcgetattr, tcsetattr};

        let flags = OpenptFlags::RDWR | OpenptFlags::NOCTTY | OpenptFlags::CLOEXEC;
        let master = openpt(flags).unwrap();
        unlockpt(&master).unwrap();
        let terminal = ioctl_tiocgptpeer(&master, flags).unwrap();
        let mut mode = tcgetattr(&terminal).unwrap();
        mode.make_raw();
        tcsetattr(&terminal, OptionalActions::Now, &mode).unwrap();
        let mut reader = std::fs::File::from(master);
        let mut child = spawn_stdout_probe("stalled-stdout", Stdio::piped(), Stdio::from(terminal));
        let mut stdin = child.stdin.take().unwrap();
        let (mut child, mut reader, mut stderr) = ready_stdout_probe(child, move || {
            let mut first = [0];
            reader.read_exact(&mut first).unwrap();
            assert_eq!(first, *b"x");
            stdin.write_all(b"1").unwrap();
            reader
        });

        kill_process(Pid::from_child(&child), Signal::TERM).unwrap();
        let budget = Duration::from_millis(u64::from(super::probe::PIPE_BUDGET_MS));
        std::thread::sleep(budget + Duration::from_millis(500));
        let reading = std::thread::spawn(move || {
            let mut stdout = Vec::new();
            // Linux reports a terminal hangup as EIO on the master.
            if let Err(error) = reader.read_to_end(&mut stdout) {
                assert_eq!(
                    error.raw_os_error(),
                    Some(rustix::io::Errno::IO.raw_os_error())
                );
            }
            stdout
        });
        let status = wait_for_probe(
            &mut child,
            Duration::from_secs(10),
            "the terminal probe never finished after stdout resumed",
        );
        assert_eq!(status.signal(), Some(Signal::TERM.as_raw()));
        let mut report = String::new();
        stderr.read_to_string(&mut report).unwrap();
        assert_eq!(report, "handler:SIGTERM:143\n");
        let stdout = reading.join().unwrap();
        assert_eq!(
            stdout.len(),
            super::probe::LARGE_WRITE + b"pending stdout\n".len()
        );
        let (first, rest) = stdout.split_at(super::probe::LARGE_WRITE - 1);
        assert!(first.iter().all(|byte| *byte == b'x'));
        assert_eq!(rest, b"\npending stdout\n");
    }

    fn a_normal_run_finishes_queued_stdout_after_the_reader_resumes() {
        let (mut child, mut stdout, _) = stdout_probe("drained-stdout", true);
        let reading = std::thread::spawn(move || {
            let mut rest = Vec::new();
            stdout.read_to_end(&mut rest).unwrap();
            rest
        });
        let status = wait_for_probe(
            &mut child,
            Duration::from_secs(30),
            "the probe never finished after stdout resumed",
        );
        assert!(status.success(), "{status}");
        let stdout = reading.join().unwrap();
        let (first, rest) = stdout.split_at(super::probe::LARGE_WRITE - 1);
        assert!(first.iter().all(|byte| *byte == b'x'));
        assert_eq!(rest, b"\npending stdout\n");
    }

    fn spawn_stderr_probe(case: &str, stdout: Stdio, stderr: Stdio) -> Child {
        Command::new(std::env::current_exe().unwrap())
            .env(super::probe::CASE, case)
            .env("TERM", "dumb")
            .env_remove("FORCE_COLOR")
            .args((case == "unfinished-stderr-with-warning").then_some("-v"))
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .spawn()
            .unwrap()
    }

    fn wait_for_probe_byte<R: Read + Send + 'static>(
        child: &mut Child,
        mut reader: R,
        expected: u8,
    ) -> R {
        let (sender, started) = mpsc::channel();
        let reading = std::thread::spawn(move || {
            let mut first = [0];
            sender
                .send(reader.read_exact(&mut first).map(|()| first))
                .unwrap();
            reader
        });
        let first = started.recv_timeout(Duration::from_secs(30));
        if !matches!(first, Ok(Ok([byte])) if byte == expected) {
            let _ = child.kill();
            child.wait().unwrap();
            panic!("the probe write did not start with byte {expected:#x}: {first:?}");
        }
        reading.join().unwrap()
    }

    fn end_stderr_probe(
        child: &mut Child,
        reader: impl Read + Send + 'static,
        expected: u8,
        case: &str,
    ) {
        let _stalled = wait_for_probe_byte(child, reader, expected);
        let budget = Duration::from_millis(u64::from(super::probe::PIPE_BUDGET_MS));
        let sent = Instant::now();
        kill_process(Pid::from_child(child), Signal::TERM).unwrap();
        let status = wait_for_probe(
            child,
            budget + Duration::from_secs(2),
            &format!("the {case} probe outlived its shutdown budget after SIGTERM"),
        );
        assert_eq!(status.signal(), Some(Signal::TERM.as_raw()), "{status}");
        assert!(sent.elapsed() >= budget.saturating_sub(Duration::from_millis(50)));
    }

    fn open_probe_fifo() -> (std::fs::File, OwnedFd) {
        use rustix::fs::{Mode, OFlags, open};

        let fifo = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("shutdown-stderr-{}.fifo", std::process::id()));
        assert!(
            Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );
        let reader = open(
            &fifo,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .unwrap();
        let writer = open(&fifo, OFlags::WRONLY | OFlags::CLOEXEC, Mode::empty()).unwrap();
        std::fs::remove_file(&fifo).unwrap();
        rustix::fs::fcntl_setfl(&reader, OFlags::empty()).unwrap();
        (std::fs::File::from(reader), writer)
    }

    fn sigterm_ends_the_process_when_the_stderr_fifo_reader_stalls() {
        let (reader, writer) = open_probe_fifo();
        let mut child = spawn_stderr_probe("stalled-stderr", Stdio::null(), Stdio::from(writer));
        end_stderr_probe(&mut child, reader, INFO_PREFIX[0], "stalled stderr FIFO");
    }

    fn sigterm_ends_the_process_when_a_reader_of_merged_stdout_and_stderr_stalls() {
        use rustix::io::{FdFlags, fcntl_setfd};

        let (reader, writer) = rustix::pipe::pipe().unwrap();
        fcntl_setfd(&reader, FdFlags::CLOEXEC).unwrap();
        fcntl_setfd(&writer, FdFlags::CLOEXEC).unwrap();
        let mut child = spawn_stderr_probe(
            "stalled-stderr",
            Stdio::from(writer.try_clone().unwrap()),
            Stdio::from(writer),
        );
        end_stderr_probe(
            &mut child,
            std::fs::File::from(reader),
            INFO_PREFIX[0],
            "stalled merged pipe",
        );
    }

    fn sigterm_ends_the_process_when_stdout_holds_the_shared_fifo() {
        let (reader, writer) = open_probe_fifo();
        let mut child = spawn_stderr_probe(
            "unfinished-stderr-with-stdout-write",
            Stdio::from(writer.try_clone().unwrap()),
            Stdio::from(writer),
        );
        end_stderr_probe(&mut child, reader, b'x', "stdout write to the shared FIFO");
    }

    fn sigterm_ends_the_process_when_a_warning_blocks_stderr() {
        let mut child = spawn_stderr_probe(
            "unfinished-stderr-with-warning",
            Stdio::null(),
            Stdio::piped(),
        );
        let reader = child.stderr.take().unwrap();
        end_stderr_probe(
            &mut child,
            reader,
            "⚠ ".as_bytes()[0],
            "stalled stderr warning",
        );
    }

    fn a_normal_run_finishes_streamed_stderr_after_the_reader_resumes() {
        let mut child = spawn_stderr_probe("drained-stderr", Stdio::null(), Stdio::piped());
        let reader = child.stderr.take().unwrap();
        let mut reader = wait_for_probe_byte(&mut child, reader, INFO_PREFIX[0]);
        assert!(child.try_wait().unwrap().is_none());
        let reading = std::thread::spawn(move || {
            let mut bytes = vec![INFO_PREFIX[0]];
            reader.read_to_end(&mut bytes).unwrap();
            bytes
        });
        let status = wait_for_probe(
            &mut child,
            Duration::from_secs(30),
            "the probe never finished after stderr resumed",
        );
        assert!(status.success(), "{status}");
        let bytes = reading.join().unwrap();
        let message = bytes.strip_prefix(INFO_PREFIX).unwrap();
        let (first, rest) = message.split_at(super::probe::LARGE_WRITE);
        assert!(first.iter().all(|byte| *byte == b'x'));
        assert_eq!(rest, b"\n  more\n  partial\n");
    }

    pub fn run_all() {
        let cases: &[(&str, fn())] = &[
            (
                "main_and_main_async_run_a_pending_handler_at_a_normal_end",
                main_and_main_async_run_a_pending_handler_at_a_normal_end,
            ),
            (
                "main_inside_a_runtime_panics_with_the_entry_point_diagnostic",
                main_inside_a_runtime_panics_with_the_entry_point_diagnostic,
            ),
            (
                "a_sigint_unwinds_the_run_runs_its_handler_and_the_process_dies_by_it",
                a_sigint_unwinds_the_run_runs_its_handler_and_the_process_dies_by_it,
            ),
            (
                "an_action_that_ignores_its_signal_ends_at_its_budget_with_its_handler_run",
                an_action_that_ignores_its_signal_ends_at_its_budget_with_its_handler_run,
            ),
            (
                "each_ending_signal_ends_the_process_by_it_with_its_status",
                each_ending_signal_ends_the_process_by_it_with_its_status,
            ),
            (
                "every_handler_runs_once_newest_first_after_the_unwind",
                every_handler_runs_once_newest_first_after_the_unwind,
            ),
            (
                "a_process_scoped_handler_keeps_core_listening_with_no_run",
                a_process_scoped_handler_keeps_core_listening_with_no_run,
            ),
            (
                "a_signal_during_a_providers_close_ends_at_the_budget",
                a_signal_during_a_providers_close_ends_at_the_budget,
            ),
            (
                "signals_end_the_process_when_the_stdout_reader_stalls",
                signals_end_the_process_when_the_stdout_reader_stalls,
            ),
            (
                "signals_end_the_process_when_the_stdout_socket_reader_stalls",
                signals_end_the_process_when_the_stdout_socket_reader_stalls,
            ),
            (
                "shutdown_keeps_stdout_a_prefix_after_a_handler_logs",
                shutdown_keeps_stdout_a_prefix_after_a_handler_logs,
            ),
            (
                "shutdown_does_not_block_on_a_fresh_stdout_write",
                shutdown_does_not_block_on_a_fresh_stdout_write,
            ),
            (
                "shutdown_sends_queued_bytes_that_fit_in_the_stdout_pipe",
                shutdown_sends_queued_bytes_that_fit_in_the_stdout_pipe,
            ),
            (
                "shutdown_restores_stdout_flags_when_the_pipe_cannot_be_reopened",
                shutdown_restores_stdout_flags_when_the_pipe_cannot_be_reopened,
            ),
            #[cfg(target_os = "linux")]
            (
                "shutdown_waits_for_in_flight_terminal_stdout",
                shutdown_waits_for_in_flight_terminal_stdout,
            ),
            (
                "a_normal_run_finishes_queued_stdout_after_the_reader_resumes",
                a_normal_run_finishes_queued_stdout_after_the_reader_resumes,
            ),
            (
                "a_normal_run_finishes_streamed_stderr_after_the_reader_resumes",
                a_normal_run_finishes_streamed_stderr_after_the_reader_resumes,
            ),
            (
                "sigterm_ends_the_process_when_the_stderr_fifo_reader_stalls",
                sigterm_ends_the_process_when_the_stderr_fifo_reader_stalls,
            ),
            (
                "sigterm_ends_the_process_when_a_reader_of_merged_stdout_and_stderr_stalls",
                sigterm_ends_the_process_when_a_reader_of_merged_stdout_and_stderr_stalls,
            ),
            (
                "sigterm_ends_the_process_when_stdout_holds_the_shared_fifo",
                sigterm_ends_the_process_when_stdout_holds_the_shared_fifo,
            ),
            (
                "sigterm_ends_the_process_when_a_warning_blocks_stderr",
                sigterm_ends_the_process_when_a_warning_blocks_stderr,
            ),
        ];
        for (name, case) in cases {
            case();
            println!("test {name} ... ok");
        }
        println!("test result: ok. {} passed; 0 failed", cases.len());
    }
}
