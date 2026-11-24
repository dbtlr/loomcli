//! Running one child process with piped streams, the capture timeout, and the session wait rule.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

/// The per-case timeout capture uses.
pub const TIMEOUT: Duration = Duration::from_secs(30);

/// One stdin line of a scripted session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionStep {
    /// The exact bytes sent, line feed included.
    pub line: Vec<u8>,
    /// Whether the harness waits for one more stdout line after sending it.
    pub answered: bool,
}

/// What the child reads on stdin.
#[derive(Debug, Clone)]
pub enum Input {
    /// All bytes at once, then stdin closes. Empty means an empty pipe.
    Text(Vec<u8>),
    /// One line at a time, waiting after each answered line.
    Session(Vec<SessionStep>),
}

/// The process to run.
#[derive(Debug, Clone)]
pub struct Spec {
    /// The binary.
    pub program: PathBuf,
    /// Arguments after the program name.
    pub args: Vec<String>,
    /// Working directory.
    pub cwd: PathBuf,
    /// The whole environment; nothing is inherited.
    pub env: Vec<(String, String)>,
}

/// What the child produced.
#[derive(Debug, Clone, Default)]
pub struct Raw {
    /// Exit code, or `None` when a signal ended the process.
    pub code: Option<i32>,
    /// Whether the harness killed the child at the timeout.
    pub timed_out: bool,
    /// Raw stdout.
    pub stdout: Vec<u8>,
    /// Raw stderr.
    pub stderr: Vec<u8>,
}

fn read_stream(mut stream: impl Read, lines: Option<&AtomicUsize>) -> Vec<u8> {
    let mut all = Vec::new();
    let mut chunk = [0u8; 8192];
    while let Ok(n) = stream.read(&mut chunk) {
        if n == 0 {
            break;
        }
        all.extend_from_slice(&chunk[..n]);
        if let Some(counter) = lines {
            counter.fetch_add(
                chunk[..n].iter().filter(|b| **b == b'\n').count(),
                Ordering::SeqCst,
            );
        }
    }
    all
}

/// Runs the process to completion or the timeout.
pub fn run_process(spec: &Spec, input: &Input, timeout: Duration) -> Result<Raw, String> {
    let mut child = Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .env_clear()
        .envs(spec.env.iter().map(|(k, v)| (k, v)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start {}: {e}", spec.program.display()))?;
    let deadline = Instant::now() + timeout;
    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe")?;
    let mut stdin = child.stdin.take();
    let lines = Arc::new(AtomicUsize::new(0));
    let out_done = Arc::new(AtomicBool::new(false));
    let out_thread = {
        let (lines, out_done) = (Arc::clone(&lines), Arc::clone(&out_done));
        thread::spawn(move || {
            let bytes = read_stream(stdout, Some(&lines));
            out_done.store(true, Ordering::SeqCst);
            bytes
        })
    };
    let err_thread = thread::spawn(move || read_stream(stderr, None));

    match input {
        Input::Text(bytes) => {
            if let Some(pipe) = stdin.as_mut() {
                // A child that exits without reading closes the pipe; that is not an error here.
                let _ = pipe.write_all(bytes);
            }
        }
        Input::Session(steps) => {
            let mut target = 0;
            for step in steps {
                if let Some(pipe) = stdin.as_mut() {
                    let _ = pipe.write_all(&step.line).and_then(|()| pipe.flush());
                }
                if step.answered {
                    target += 1;
                    while lines.load(Ordering::SeqCst) < target
                        && !out_done.load(Ordering::SeqCst)
                        && Instant::now() < deadline
                    {
                        thread::sleep(Duration::from_millis(1));
                    }
                }
            }
        }
    }
    drop(stdin);

    let mut timed_out = false;
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                timed_out = true;
                let _ = child.kill();
                break child.wait().map_err(|e| e.to_string())?;
            }
            None => thread::sleep(Duration::from_millis(2)),
        }
    };
    let stdout = out_thread.join().map_err(|_| "stdout reader panicked")?;
    let stderr = err_thread.join().map_err(|_| "stderr reader panicked")?;
    Ok(Raw {
        code: if timed_out { None } else { status.code() },
        timed_out,
        stdout,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn sh(script: &str) -> Spec {
        Spec {
            program: PathBuf::from("/bin/sh"),
            args: vec!["-c".into(), script.into()],
            cwd: std::env::temp_dir(),
            env: vec![("PATH".into(), "/usr/bin:/bin".into())],
        }
    }

    #[test]
    fn captures_streams_exit_code_and_stdin_text() {
        let raw = run_process(
            &sh("cat; echo err >&2; exit 3"),
            &Input::Text(b"hi".to_vec()),
            TIMEOUT,
        )
        .unwrap();
        assert_eq!(
            (raw.stdout.as_slice(), raw.stderr.as_slice(), raw.code),
            (&b"hi"[..], &b"err\n"[..], Some(3))
        );
    }

    #[test]
    fn the_environment_is_exactly_what_the_spec_states() {
        let raw =
            run_process(&sh("echo \"[$HOME][$FOO]\""), &Input::Text(vec![]), TIMEOUT).unwrap();
        assert_eq!(raw.stdout, b"[][]\n");
    }

    #[test]
    fn a_session_waits_for_an_answer_before_the_next_line() {
        // The script answers each line it reads; the second line is only sent after the first answer.
        let steps = vec![
            SessionStep {
                line: b"one\n".to_vec(),
                answered: true,
            },
            SessionStep {
                line: b"note\n".to_vec(),
                answered: false,
            },
            SessionStep {
                line: b"two\n".to_vec(),
                answered: true,
            },
        ];
        let raw = run_process(
            &sh("while read l; do echo \"got $l\"; done"),
            &Input::Session(steps),
            TIMEOUT,
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(raw.stdout).unwrap(),
            "got one\ngot note\ngot two\n"
        );
    }

    #[test]
    fn a_hung_child_is_killed_at_the_timeout() {
        let raw = run_process(
            &sh("sleep 5"),
            &Input::Text(vec![]),
            Duration::from_millis(100),
        )
        .unwrap();
        assert!(raw.timed_out);
        assert_eq!(raw.code, None);
    }
}
