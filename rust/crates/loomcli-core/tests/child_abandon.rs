//! Real child abandonment, ported from the reference's `spawn.test.ts`.

#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::panic)]

use std::future::pending;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_core::{
    BoxFuture, Child, ChildExit, ChildStream, Env, InputStream, KillSignal, OutputStream,
    ProcessFields, ProcessHandle, ProcessSignal, SpawnOptions, SpawnRequest, process_handle,
};
use loomcli_testing::{MockFields, mock_process};
use rustix::process::{Pid, test_kill_process};
use tokio::sync::{Mutex as AsyncMutex, mpsc};
use tokio_util::sync::CancellationToken;

const LIMIT: Duration = Duration::from_secs(8);
const WAIT_FOR_STOP: &str =
    "n=0; while [ ! -f stop ] && [ \"$n\" -lt 500 ]; do n=$((n+1)); /bin/sleep 0.02; done";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn sandbox() -> PathBuf {
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("child-abandon-{}-{id}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn start(cwd: &Path, script: &str, options: SpawnOptions) -> Child {
    let mock = mock_process(MockFields::new());
    start_with_input(cwd, script, options, mock.stdin())
}

fn start_with_input(
    cwd: &Path,
    script: &str,
    options: SpawnOptions,
    stdin: Arc<dyn InputStream>,
) -> Child {
    let handle = process_handle(ProcessFields::new().stdin(stdin));
    handle.spawn(SpawnRequest::attached(
        "/bin/sh",
        ["-c", script],
        cwd,
        Env::new(),
        options,
    ))
}

async fn ready<T>(mut check: impl FnMut() -> Option<T>) -> T {
    tokio::time::timeout(LIMIT, async {
        loop {
            if let Some(value) = check() {
                return value;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

async fn file(path: &Path) -> String {
    ready(|| std::fs::read_to_string(path).ok()).await
}

async fn text(path: &Path) -> String {
    ready(|| {
        std::fs::read_to_string(path)
            .ok()
            .filter(|value| !value.is_empty())
    })
    .await
}

async fn pid_at(path: &Path) -> Pid {
    ready(|| {
        let pid = std::fs::read_to_string(path).ok()?.trim().parse().ok()?;
        Pid::from_raw(pid)
    })
    .await
}

async fn exited(child: &Child) -> ChildExit {
    tokio::time::timeout(LIMIT, child.exited()).await.unwrap()
}

#[tokio::test]
async fn an_abandoned_child_can_outlive_its_host() {
    let cwd = sandbox();
    let mut probe = tokio::process::Command::new(std::env::current_exe().unwrap());
    probe
        .args(["--ignored", "--exact", "abandon_process_probe"])
        .kill_on_drop(true)
        .current_dir(&cwd)
        .env_clear();
    let result = tokio::time::timeout(LIMIT, probe.output())
        .await
        .unwrap()
        .unwrap();
    let pid = pid_at(&cwd.join("pid")).await;
    let alive = test_kill_process(pid);
    std::fs::write(cwd.join("stop"), "").unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stdout)
    );
    assert!(
        result.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(alive, Ok(()));
}

#[tokio::test]
#[ignore = "launched by an_abandoned_child_can_outlive_its_host"]
async fn abandon_process_probe() {
    let cwd = std::env::current_dir().unwrap();
    let script = format!("printf 'started\\n'; printf '%s\\n' \"$$\" > pid; {WAIT_FOR_STOP}");
    let child = start(&cwd, &script, SpawnOptions::new());
    pid_at(&cwd.join("pid")).await;
    // The PID file and the output pipe are delivered separately.
    tokio::time::sleep(Duration::from_millis(60)).await;
    child.abandon();
    assert!(matches!(exited(&child).await,
        ChildExit::Abandoned { stdout, stderr } if stdout.bytes == b"started\n" && stderr.bytes.is_empty()));
}

#[tokio::test]
async fn abandon_preserves_a_settled_exit_or_failed_start() {
    let cwd = sandbox();
    let child = start(&cwd, "printf ready; exit 7", SpawnOptions::new());
    assert!(matches!(
        exited(&child).await,
        ChildExit::Exited { code: 7, .. }
    ));
    child.abandon();
    assert!(matches!(exited(&child).await,
        ChildExit::Exited { code: 7, stdout, .. } if stdout.text == "ready"));

    let missing = process_handle(ProcessFields::new()).spawn(SpawnRequest::attached(
        cwd.join("missing").to_string_lossy(),
        Vec::<String>::new(),
        &cwd,
        Env::new(),
        SpawnOptions::new(),
    ));
    let ChildExit::Unstarted { error: initial } = exited(&missing).await else {
        panic!("the missing program cannot start");
    };
    missing.abandon();
    assert!(
        matches!(exited(&missing).await, ChildExit::Unstarted { error } if Arc::ptr_eq(&error, &initial))
    );
}

#[tokio::test]
async fn a_kill_or_cancel_can_still_signal_a_live_child() {
    for cancel in [false, true] {
        let cwd = sandbox();
        let signal = CancellationToken::new();
        let script =
            format!("trap 'printf ended > ended; exit 0' TERM; : > ready; {WAIT_FOR_STOP}");
        let child = start(&cwd, &script, SpawnOptions::new().signal(signal.clone()));
        file(&cwd.join("ready")).await;
        child.abandon();
        assert!(matches!(exited(&child).await, ChildExit::Abandoned { .. }));
        assert!(!cwd.join("ended").exists());
        if cancel {
            signal.cancel();
        } else {
            child.kill(KillSignal::Signal(ProcessSignal::Term));
        }
        assert_eq!(text(&cwd.join("ended")).await, "ended");
        assert!(matches!(exited(&child).await, ChildExit::Abandoned { .. }));
    }
}

#[tokio::test]
async fn an_abandoned_detached_child_has_empty_output() {
    let cwd = sandbox();
    let script = format!("printf ready > ready; {WAIT_FOR_STOP}");
    let handle = process_handle(ProcessFields::new());
    let child = handle.spawn(SpawnRequest::detached(
        "/bin/sh",
        ["-c", &script],
        &cwd,
        Env::new(),
    ));
    file(&cwd.join("ready")).await;
    child.abandon();
    std::fs::write(cwd.join("stop"), "").unwrap();
    assert!(matches!(exited(&child).await,
        ChildExit::Abandoned { stdout, stderr } if stdout.bytes.is_empty() && stderr.bytes.is_empty()));
}

#[tokio::test]
async fn abandonment_keeps_a_reported_status_with_open_descendant_pipes() {
    let cwd = sandbox();
    let script = format!("printf started; ({WAIT_FOR_STOP}) & printf '%s\\n' \"$$\" > pid; exit 7");
    let child = start(&cwd, &script, SpawnOptions::new());
    let pid = pid_at(&cwd.join("pid")).await;
    ready(|| (test_kill_process(pid) == Err(rustix::io::Errno::SRCH)).then_some(())).await;
    let mut exit = std::pin::pin!(child.exited());
    std::future::poll_fn(|cx| {
        assert!(exit.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    child.abandon();
    std::fs::write(cwd.join("stop"), "").unwrap();
    assert!(matches!(exited(&child).await,
        ChildExit::Exited { code: 7, stdout, .. } if stdout.text == "started"));
}

#[derive(Default)]
struct HeldWriter(Mutex<Vec<u8>>);

impl OutputStream for HeldWriter {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Box::pin(pending())
    }
}

#[tokio::test]
async fn abandonment_releases_a_blocked_destination_and_drains_the_pipe() {
    let cwd = sandbox();
    let held = Arc::new(HeldWriter::default());
    let script = format!(
        "printf before >&2; {WAIT_FOR_STOP}; i=0; while [ \"$i\" -lt 2048 ]; do printf '%1024s' '' >&2; i=$((i+1)); done; printf drained > done"
    );
    let child = start(
        &cwd,
        &script,
        SpawnOptions::new().stderr(ChildStream::Stream(held.clone())),
    );
    ready(|| (!held.0.lock().unwrap().is_empty()).then_some(())).await;
    child.abandon();
    std::fs::write(cwd.join("stop"), "").unwrap();
    assert!(matches!(exited(&child).await,
        ChildExit::Abandoned { stdout, stderr } if stdout.bytes.is_empty() && stderr.bytes.is_empty()));
    assert_eq!(text(&cwd.join("done")).await, "drained");
    assert_eq!(*held.0.lock().unwrap(), b"before");
}

#[tokio::test]
async fn an_abandoned_capture_drains_later_bytes_without_changing_its_exit() {
    let cwd = sandbox();
    let script = format!(
        "printf before; : > ready; {WAIT_FOR_STOP}; i=0; while [ \"$i\" -lt 2048 ]; do printf '%1024s' ''; i=$((i+1)); done; printf drained > done"
    );
    let child = start(&cwd, &script, SpawnOptions::new());
    file(&cwd.join("ready")).await;
    tokio::time::sleep(Duration::from_millis(60)).await;
    child.abandon();
    std::fs::write(cwd.join("stop"), "").unwrap();
    assert_eq!(text(&cwd.join("done")).await, "drained");
    assert!(
        matches!(exited(&child).await, ChildExit::Abandoned { stdout, .. } if stdout.text == "before")
    );
}

struct Stdin(AsyncMutex<mpsc::Receiver<&'static [u8]>>);

impl InputStream for Stdin {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            let Some(bytes) = self.0.lock().await.recv().await else {
                return Ok(0);
            };
            buffer[..bytes.len()].copy_from_slice(bytes);
            Ok(bytes.len())
        })
    }
}

#[tokio::test]
async fn abandonment_closes_piped_stdin_and_leaves_its_source_open() {
    let cwd = sandbox();
    let (sender, receiver) = mpsc::channel(1);
    let source = Arc::new(Stdin(AsyncMutex::new(receiver)));
    let child = start_with_input(
        &cwd,
        "IFS= read -r first; : > ready; IFS= read -r rest; printf '%s%s' \"$first\" \"$rest\" > input",
        SpawnOptions::new().inherit_stdin(),
        source.clone(),
    );
    sender.send(b"before\n").await.unwrap();
    file(&cwd.join("ready")).await;
    child.abandon();
    assert_eq!(text(&cwd.join("input")).await, "before");
    sender.send(b"after").await.unwrap();
    let mut bytes = [0_u8; 8];
    let read = tokio::time::timeout(LIMIT, source.read(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&bytes[..read], b"after");
}

#[tokio::test]
async fn abandonment_drops_input_that_was_not_written_to_the_pipe() {
    let cwd = sandbox();
    let length = 8 * 1024 * 1024;
    let script = format!(": > ready; {WAIT_FOR_STOP}; /usr/bin/wc -c > count");
    let child = start(&cwd, &script, SpawnOptions::new().input(vec![b'x'; length]));
    file(&cwd.join("ready")).await;
    child.abandon();
    std::fs::write(cwd.join("stop"), "").unwrap();
    let count = ready(|| {
        std::fs::read_to_string(cwd.join("count"))
            .ok()?
            .trim()
            .parse::<usize>()
            .ok()
    })
    .await;
    assert!(count < length);
}
