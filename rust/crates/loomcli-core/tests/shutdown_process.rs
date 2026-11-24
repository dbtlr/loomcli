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
    use std::io::Write;

    use loomcli_core::{
        Activation, Application, CancellationSource, Context, EndingSignal, Plugin, Provider,
        ProviderContext, ShutdownCause, ShutdownEvent,
    };

    /// The variable that names the case the probe runs.
    pub const CASE: &str = "LOOMCLI_SHUTDOWN_PROBE";

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
            _ => watching(case == "ignoring"),
        }
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
    use std::io::{BufRead, BufReader, Read};
    use std::os::unix::process::ExitStatusExt;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use rustix::process::{Pid, Signal, kill_process};

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

    pub fn run_all() {
        let cases: [(&str, fn()); 8] = [
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
        ];
        for (name, case) in cases {
            case();
            println!("test {name} ... ok");
        }
        println!("test result: ok. {} passed; 0 failed", cases.len());
    }
}
