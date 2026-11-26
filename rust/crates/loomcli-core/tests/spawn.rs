//! The real handle's child programs, under `host.md`'s Child programs: the reference's
//! `spawn.test.ts` cases that start a real child. Each child is `/bin/sh` running shell builtins
//! alone, with an environment the case supplies.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_core::{
    BoxFuture, Child, ChildExit, ChildOutput, ChildStream, Env, InputStream, KillSignal,
    OutputStream, ProcessFields, ProcessHandle, ProcessSignal, SpawnOptions, SpawnRequest,
    process_handle,
};
use tokio_util::sync::CancellationToken;

const SHELL: &str = "/bin/sh";

/// The directory each child runs in.
fn place() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("spawn");
    std::fs::create_dir_all(&root).unwrap();
    root
}

/// The real handle's spawn of one shell script, with the place filled, as core calls it.
fn start(handle: &Arc<dyn ProcessHandle>, script: &str, options: SpawnOptions) -> Child {
    handle.spawn(SpawnRequest::attached(
        SHELL,
        ["-c", script],
        place(),
        Env::new(),
        options,
    ))
}

fn real() -> Arc<dyn ProcessHandle> {
    process_handle(ProcessFields::new().env(Env::new()))
}

/// The exit of a child that exited, failing the case for one that never started.
async fn exit_of(child: &Child) -> (i32, ChildOutput, ChildOutput) {
    match child.exited().await {
        ChildExit::Exited {
            code,
            stdout,
            stderr,
        } => (code, stdout, stderr),
        ChildExit::Unstarted { error } => panic!("the child did not start: {error}"),
        _ => panic!("an unknown exit"),
    }
}

/// A stream that keeps the bytes written to it.
#[derive(Default)]
struct Sink(Mutex<Vec<u8>>);

impl Sink {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }
}

impl OutputStream for Sink {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Box::pin(async { Ok(()) })
    }
}

/// A piped stdin that yields its bytes once, then ends.
struct Piped(Mutex<Vec<u8>>);

impl InputStream for Piped {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        let mut held = self.0.lock().unwrap();
        let count = buffer.len().min(held.len());
        buffer[..count].copy_from_slice(&held[..count]);
        held.drain(..count);
        Box::pin(async move { Ok(count) })
    }
}

/// The shell script that copies one line of stdin, without its line break, to stdout.
const ECHO_LINE: &str = "IFS= read -r line; printf %s \"$line\"";

/// A script that runs until a signal ends it.
const FOREVER: &str = "while :; do :; done";

#[tokio::test]
async fn a_captured_stream_answers_the_bytes_the_child_wrote_and_their_utf8_text() {
    let child = start(
        &real(),
        "printf '\\150\\303\\251\\377'; printf warned >&2",
        SpawnOptions::new(),
    );
    let (code, stdout, stderr) = exit_of(&child).await;
    assert_eq!(code, 0);
    assert_eq!(stdout.bytes, [0x68, 0xc3, 0xa9, 0xff]);
    assert_eq!(stdout.text, "h\u{e9}\u{fffd}");
    assert_eq!(stderr.text, "warned");
}

#[tokio::test]
async fn an_ignored_stream_answers_nothing_and_a_stream_receives_the_bytes_as_the_child_writes_them()
 {
    let received = Arc::new(Sink::default());
    let options = SpawnOptions::new()
        .stdout(ChildStream::Ignore)
        .stderr(ChildStream::Stream(
            Arc::clone(&received) as Arc<dyn OutputStream>
        ));
    let child = start(&real(), "printf out; printf err >&2", options);
    let (_, stdout, stderr) = exit_of(&child).await;
    assert!(stdout.bytes.is_empty());
    assert_eq!(stderr.text, "");
    assert_eq!(received.text(), "err");
}

#[tokio::test]
async fn inherit_of_a_stream_that_is_not_the_processs_pipes_into_the_handles_stream() {
    let stdout = Arc::new(Sink::default());
    let handle = process_handle(
        ProcessFields::new()
            .env(Env::new())
            .stdout(Arc::clone(&stdout) as Arc<dyn OutputStream>),
    );
    let child = start(
        &handle,
        "printf through",
        SpawnOptions::new().stdout(ChildStream::Inherit),
    );
    let (_, captured, _) = exit_of(&child).await;
    assert_eq!(captured.text, "");
    assert_eq!(stdout.text(), "through");
}

#[tokio::test]
async fn stdin_inherit_of_a_stream_that_is_not_the_processs_pipes_the_handles_stdin_into_the_child()
{
    let handle = process_handle(
        ProcessFields::new()
            .env(Env::new())
            .stdin(Arc::new(Piped(Mutex::new(b"typed".to_vec())))),
    );
    let child = start(&handle, ECHO_LINE, SpawnOptions::new().inherit_stdin());
    let (_, stdout, _) = exit_of(&child).await;
    assert_eq!(stdout.text, "typed");
}

#[tokio::test]
async fn input_is_the_childs_whole_stdin_text_or_bytes_and_no_input_is_an_ended_stdin() {
    let handle = real();
    let text = start(&handle, ECHO_LINE, SpawnOptions::new().input("piped text"));
    let bytes = start(
        &handle,
        ECHO_LINE,
        SpawnOptions::new().input(vec![1_u8, 2, 3]),
    );
    let none = start(&handle, ECHO_LINE, SpawnOptions::new());
    assert_eq!(exit_of(&text).await.1.text, "piped text");
    assert_eq!(exit_of(&bytes).await.1.bytes, [1, 2, 3]);
    assert_eq!(exit_of(&none).await.1.text, "");
}

#[tokio::test]
async fn the_exit_code_is_the_code_the_child_exited_with() {
    let child = start(&real(), "exit 3", SpawnOptions::new());
    assert_eq!(exit_of(&child).await.0, 3);
}

#[tokio::test]
async fn a_cancellation_of_signal_ends_the_child_with_sigterm_128_plus_its_number() {
    let signal = CancellationToken::new();
    let child = start(&real(), FOREVER, SpawnOptions::new().signal(signal.clone()));
    tokio::time::sleep(Duration::from_millis(200)).await;
    signal.cancel();
    assert_eq!(exit_of(&child).await.0, 143);
}

#[tokio::test]
async fn a_signal_already_cancelled_ends_the_child_as_soon_as_it_starts() {
    let signal = CancellationToken::new();
    signal.cancel();
    let child = start(&real(), FOREVER, SpawnOptions::new().signal(signal));
    assert_eq!(exit_of(&child).await.0, 143);
}

#[tokio::test]
async fn kill_delivers_the_signal_it_names_and_the_code_is_128_plus_its_number() {
    let child = start(&real(), FOREVER, SpawnOptions::new());
    tokio::time::sleep(Duration::from_millis(200)).await;
    child.kill(KillSignal::Signal(ProcessSignal::Hup));
    assert_eq!(exit_of(&child).await.0, 129);
    // A kill once the child has exited does nothing.
    child.kill(KillSignal::Signal(ProcessSignal::Term));
}

#[tokio::test]
async fn kill_of_sigkill_ends_a_child_that_ignores_sigterm_with_the_code_137() {
    let ready = Arc::new(Sink::default());
    let options = SpawnOptions::new().stdout(ChildStream::Stream(
        Arc::clone(&ready) as Arc<dyn OutputStream>
    ));
    let child = start(
        &real(),
        "trap '' TERM; printf ready; while :; do :; done",
        options,
    );
    // The child says ready once it ignores SIGTERM, so the kills never land before its trap.
    for _ in 0..1000 {
        if !ready.text().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(ready.text(), "ready");
    child.kill(KillSignal::Signal(ProcessSignal::Term));
    child.kill(KillSignal::Kill);
    assert_eq!(exit_of(&child).await.0, 137);
}

#[tokio::test]
async fn a_command_no_program_answers_to_is_unstarted_with_the_platforms_error() {
    let handle = real();
    let mut env = Env::new();
    env.insert("PATH".to_owned(), "/loom-test/nowhere".to_owned());
    let missing = handle.spawn(SpawnRequest::attached(
        "loom-test-no-such-program",
        Vec::<String>::new(),
        place(),
        env,
        SpawnOptions::new(),
    ));
    match missing.exited().await {
        ChildExit::Unstarted { error } => assert_eq!(error.kind(), io::ErrorKind::NotFound),
        _ => panic!("a missing program never starts"),
    }
    let nowhere = handle.spawn(SpawnRequest::attached(
        SHELL,
        Vec::<String>::new(),
        "/loom-test/nowhere",
        Env::new(),
        SpawnOptions::new(),
    ));
    assert!(matches!(
        nowhere.exited().await,
        ChildExit::Unstarted { .. }
    ));
}

#[tokio::test]
async fn a_detached_child_runs_in_a_process_group_of_its_own_with_every_stream_ignored() {
    let marker = place().join(format!("detached-{}", std::process::id()));
    let _ = std::fs::remove_file(&marker);
    let script = format!(
        "printf %s $$ > '{}'; printf lost; {FOREVER}",
        marker.display()
    );
    let child = real().spawn(SpawnRequest::detached(
        SHELL,
        ["-c", &script],
        place(),
        Env::new(),
    ));
    let mut pid = String::new();
    for _ in 0..1000 {
        pid = std::fs::read_to_string(&marker).unwrap_or_default();
        if !pid.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let pid = rustix::process::Pid::from_raw(pid.trim().parse().unwrap()).unwrap();
    assert_eq!(rustix::process::getpgid(Some(pid)).unwrap(), pid);
    child.kill(KillSignal::Signal(ProcessSignal::Term));
    let (code, stdout, _) = exit_of(&child).await;
    assert_eq!(code, 143);
    assert!(stdout.bytes.is_empty());
    let _ = std::fs::remove_file(&marker);
}

#[tokio::test]
async fn a_child_started_outside_a_runtime_never_starts() {
    let handle = real();
    let child = std::thread::spawn(move || {
        handle.spawn(SpawnRequest::attached(
            SHELL,
            ["-c", "exit 0"],
            place(),
            Env::new(),
            SpawnOptions::new(),
        ))
    })
    .join()
    .unwrap();
    assert!(matches!(child.exited().await, ChildExit::Unstarted { .. }));
}

// What core passes the handle from a run, an invocation by name, and an action's invoke.

/// One spawn request a recording handle received: its working directory, environment, each
/// output stream's kind, and its stdin.
#[derive(Debug, PartialEq)]
struct Received {
    cwd: PathBuf,
    env: Env,
    stdout: &'static str,
    stderr: &'static str,
    inherits_stdin: bool,
    input: Option<Vec<u8>>,
}

fn kind(stream: &ChildStream) -> &'static str {
    match stream {
        ChildStream::Capture => "capture",
        ChildStream::Ignore => "ignore",
        ChildStream::Inherit => "inherit",
        ChildStream::Stream(_) => "stream",
        _ => "other",
    }
}

/// A mock process at `/work` with `PATH=/bin` that records each spawn request and then lets the
/// mock answer it.
struct Recording {
    mock: Arc<loomcli_testing::MockProcess>,
    calls: Mutex<Vec<Received>>,
}

impl Recording {
    fn new(argv: &[&str]) -> Arc<Self> {
        let mock = loomcli_testing::mock_process(
            loomcli_testing::MockFields::new()
                .argv(argv.iter().copied())
                .cwd("/work")
                .env("PATH", "/bin")
                .script("git", |_| async {
                    Ok(loomcli_testing::ProgramAnswer::new())
                }),
        );
        Arc::new(Self {
            mock,
            calls: Mutex::default(),
        })
    }

    fn calls(&self) -> std::sync::MutexGuard<'_, Vec<Received>> {
        self.calls.lock().unwrap()
    }
}

impl ProcessHandle for Recording {
    fn argv(&self) -> Vec<String> {
        self.mock.argv()
    }
    fn program(&self) -> Vec<String> {
        self.mock.program()
    }
    fn env(&self) -> Env {
        self.mock.env()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.mock.cwd()
    }
    fn home(&self) -> PathBuf {
        self.mock.home()
    }
    fn tmpdir(&self) -> PathBuf {
        self.mock.tmpdir()
    }
    fn platform(&self) -> String {
        self.mock.platform()
    }
    fn arch(&self) -> String {
        self.mock.arch()
    }
    fn libc(&self) -> Option<loomcli_core::Libc> {
        self.mock.libc()
    }
    fn uid(&self) -> Option<u32> {
        self.mock.uid()
    }
    fn time_zone(&self) -> String {
        self.mock.time_zone()
    }
    fn release(&self) -> loomcli_core::ReleaseFacts {
        self.mock.release()
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        self.mock.stdin()
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        self.mock.stdout()
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        self.mock.stderr()
    }
    fn terminal(&self) -> Arc<dyn loomcli_core::ProcessTerminal> {
        self.mock.terminal()
    }
    fn signals(&self) -> Arc<dyn loomcli_core::SignalSource> {
        self.mock.signals()
    }
    fn spawn(&self, request: SpawnRequest) -> Child {
        if let Some(options) = &request.attached {
            self.calls.lock().unwrap().push(Received {
                cwd: request.cwd.clone(),
                env: request.env.clone(),
                stdout: kind(options.stdout_stream()),
                stderr: kind(options.stderr_stream()),
                inherits_stdin: options.inherits_stdin(),
                input: options.stdin_input().map(<[u8]>::to_vec),
            });
        }
        self.mock.spawn(request)
    }
    fn set_exit_code(&self, code: loomcli_core::ExitCode) {
        self.mock.set_exit_code(code);
    }
}

fn path_env(pairs: &[(&str, &str)]) -> Env {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect()
}

/// An application whose action starts `git` with every stream inherited.
fn starting() -> loomcli_core::Application {
    loomcli_core::Application::new("notes").action(|ctx: loomcli_core::Context| async move {
        let child = ctx.host.spawn(
            "git",
            ["status"],
            SpawnOptions::new()
                .stdout(ChildStream::Inherit)
                .stderr(ChildStream::Inherit)
                .inherit_stdin(),
        );
        let _ = child.exited().await;
        Ok(())
    })
}

#[tokio::test]
async fn the_env_core_fills_holds_what_environment_preparation_added() {
    let handle = Recording::new(&[]);
    let dotenv = loomcli_core::Plugin::new("@fixture/dotenv").on_environment(|_| async {
        Ok(std::collections::BTreeMap::from([(
            "ADDED".to_owned(),
            "by-dotenv".to_owned(),
        )]))
    });
    let app = loomcli_core::Application::new("notes")
        .plugins([dotenv])
        .action(|ctx: loomcli_core::Context| async move {
            let _ = ctx
                .host
                .spawn("git", ["status"], SpawnOptions::new())
                .exited()
                .await;
            Ok(())
        });
    let code = app
        .run(loomcli_core::RunOptions::new().process(Arc::clone(&handle) as _))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        handle.calls()[0].env,
        path_env(&[("ADDED", "by-dotenv"), ("PATH", "/bin")])
    );
}

#[tokio::test]
async fn an_argv_run_passes_inherit_for_each_stream_that_is_the_handles_own() {
    let handle = Recording::new(&[]);
    let code = starting()
        .run(loomcli_core::RunOptions::new().process(Arc::clone(&handle) as _))
        .await;
    assert_eq!(code.get(), 0);
    let calls = handle.calls();
    assert_eq!(
        (calls[0].stdout, calls[0].stderr, calls[0].inherits_stdin),
        ("inherit", "inherit", true)
    );
}

#[tokio::test]
async fn app_invoke_passes_its_capture_sinks_as_streams_in_place_of_inherit_and_no_stdin() {
    let handle = Recording::new(&[]);
    let outcome = starting()
        .invoke(
            &[],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<loomcli_core::Error>::new(),
            Some(Arc::clone(&handle) as _),
        )
        .await;
    assert!(matches!(
        outcome,
        loomcli_core::InvocationOutcome::Completed { .. }
    ));
    let calls = handle.calls();
    assert_eq!(
        (
            calls[0].stdout,
            calls[0].stderr,
            calls[0].inherits_stdin,
            calls[0].input.clone()
        ),
        ("stream", "stream", false, None)
    );
}

#[tokio::test]
async fn an_actions_invoke_passes_streams_to_its_runs_handle_in_place_of_inherit() {
    let handle = Recording::new(&["outer"]);
    let app = loomcli_core::Application::new("notes")
        .command(
            loomcli_core::Command::new("child")
                .description("Start git.")
                .action(|ctx: loomcli_core::Context| async move {
                    let _ = ctx
                        .host
                        .spawn(
                            "git",
                            Vec::<String>::new(),
                            SpawnOptions::new()
                                .stdout(ChildStream::Inherit)
                                .inherit_stdin(),
                        )
                        .exited()
                        .await;
                    Ok(())
                }),
        )
        .command(
            loomcli_core::Command::new("outer")
                .description("Invoke child.")
                .action(|ctx: loomcli_core::Context| async move {
                    let outcome = ctx
                        .invoke(
                            &["child"],
                            loomcli_core::InvocationValues::new(),
                            loomcli_core::InvokeOptions::<loomcli_core::Error>::new(),
                        )
                        .await;
                    assert!(matches!(
                        outcome,
                        loomcli_core::InvocationOutcome::Completed { .. }
                    ));
                    Ok(())
                }),
        );
    let code = app
        .run(loomcli_core::RunOptions::new().process(Arc::clone(&handle) as _))
        .await;
    assert_eq!(code.get(), 0);
    let calls = handle.calls();
    assert_eq!(
        (
            calls[0].cwd.clone(),
            calls[0].env.clone(),
            calls[0].stdout,
            calls[0].inherits_stdin,
            calls[0].input.clone()
        ),
        (
            PathBuf::from("/work"),
            path_env(&[("PATH", "/bin")]),
            "stream",
            false,
            None
        )
    );
}

#[cfg(unix)]
#[tokio::test]
async fn abandoning_settles_every_waiter_without_ending_the_child() {
    let started = Arc::new(Sink::default());
    let child = start(
        &real(),
        "printf ready >&2; exec /bin/sleep 10",
        SpawnOptions::new().stderr(ChildStream::Stream(started.clone())),
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        while started.text().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut first = std::pin::pin!(child.exited());
    std::future::poll_fn(|cx| {
        assert!(first.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;

    child.abandon();
    child.abandon();
    let (left, right) = tokio::join!(first, child.exited());
    child.kill(KillSignal::Kill);
    for exit in [left, right] {
        assert!(matches!(exit, ChildExit::Abandoned { stdout, stderr }
            if stdout.bytes.is_empty() && stderr.bytes.is_empty()));
    }
}
