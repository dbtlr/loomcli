//! The real signal source, under `signals.md`'s Listening: with no listener for a signal, the
//! signal has its default effect, so the process ends at once with the shell's status, or stops on
//! `SIGTSTP`, even after core listened for it and stopped. Each case runs in a child process, this
//! test binary run again on the one child case, because the signal's default action ends or stops
//! the process that receives it.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use loomcli_core::{ProcessFields, ProcessSignal, SignalEvent, process_handle};
use rustix::process::{Pid, Signal, WaitOptions, kill_process, waitpid};

/// The variable that names the signal the child case sends itself. The parent cases set it on the
/// child alone.
const CHILD: &str = "LOOMCLI_TEST_SIGNAL_CHILD";

/// The child's part: listen for the signal, stop listening, then receive it from outside the
/// signal source, as a terminal key or another process delivers it. A child that survives says so.
#[test]
fn signal_child() {
    let Some(name) = std::env::var_os(CHILD) else {
        return;
    };
    let (event, signal) = match name.to_str() {
        Some("term") => (ProcessSignal::Term, Signal::TERM),
        Some("int") => (ProcessSignal::Int, Signal::INT),
        Some("tstp") => (ProcessSignal::Tstp, Signal::TSTP),
        _ => panic!("an unknown signal"),
    };
    let signals = process_handle(ProcessFields::new()).signals();
    let id = signals.on(SignalEvent::Signal(event), Arc::new(|_| {}));
    signals.off(id);
    kill_process(rustix::process::getpid(), signal).unwrap();
    std::thread::sleep(Duration::from_secs(5));
    print!("survived");
}

/// Starts the child case with `signal` named.
fn child(signal: &str) -> std::process::Child {
    Command::new(std::env::current_exe().unwrap())
        .args(["signal_child", "--exact", "--nocapture", "--test-threads=1"])
        .env(CHILD, signal)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

/// The status a shell reports for the child: its exit code, or 128 plus the signal that ended it,
/// with whether it survived the signal.
fn ended(signal: &str) -> (Option<i32>, bool) {
    use std::os::unix::process::ExitStatusExt;
    let output = child(signal).wait_with_output().unwrap();
    let status = output
        .status
        .code()
        .or_else(|| output.status.signal().map(|number| 128 + number));
    (
        status,
        String::from_utf8_lossy(&output.stdout).contains("survived"),
    )
}

#[test]
fn an_external_sigterm_after_the_last_listener_goes_ends_the_process_with_143() {
    assert_eq!(ended("term"), (Some(143), false));
}

#[test]
fn an_external_sigint_after_the_last_listener_goes_ends_the_process_with_130() {
    assert_eq!(ended("int"), (Some(130), false));
}

#[test]
fn an_external_sigtstp_after_the_last_listener_goes_stops_the_process() {
    let mut child = child("tstp");
    let pid = Pid::from_child(&child);
    let (_, status) = waitpid(Some(pid), WaitOptions::UNTRACED)
        .unwrap()
        .expect("the child changes state");
    let stopped = status.stopped();
    kill_process(pid, Signal::KILL).unwrap();
    let _ = child.wait();
    assert!(stopped, "the child stops rather than running on or ending");
    // `signal-hook` stops the process with `SIGSTOP`, a recorded deviation.
    assert_eq!(status.stopping_signal(), Some(Signal::STOP.as_raw()));
}
