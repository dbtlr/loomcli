//! Ports `skills-refresh.test.ts`: `refresh_skills` runs the new binary with `skills update`, pipes
//! its output into the host's streams, and resolves; a child that exits with a code, a binary that
//! cannot start, and a run that is cancelled while the child runs each add the pinned `warn` event
//! and resolve. Five cases run on the mock process; the two that need the runtime's own spawn run
//! on the real process handle with captured streams.

#![cfg(feature = "skills")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod skills_support;

use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, BoxFuture, Command, Context, Env, Group, LogDestination, LogEvent, NoInputs,
    NoResult, OutputStream, Plugin, ProcessFields, ProcessHandle, RunOptions, process_handle,
};
use loomcli_plugins::skills::{RefreshContext, refresh_skills};
use loomcli_testing::{MockFields, ProgramAnswer, ProgramCall, mock_process};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, Group>;

/// Where the mock runs the application and where the refreshed binary lies.
const WORK: &str = "/loom-test/work";
const BINARY: &str = "/loom-test/bin/notes";
const WARNING: &str = "Skills were not refreshed after the update.";

/// What a refresh run left.
struct Refreshed {
    code: u8,
    stdout: String,
    stderr: String,
    events: Vec<Value>,
    resolved: bool,
}

/// An application whose `refresh` Command calls `refresh_skills` with the binary at `path`, as a
/// self-update's `after_replace` would, and prints `resolved` once it returned.
fn refresh_application(
    path: &str,
    events: Arc<Mutex<Vec<Value>>>,
    resolved: Arc<AtomicBool>,
) -> App {
    let observer = Plugin::new("observer").on_log(move |event: &LogEvent, _: &LogDestination| {
        events.lock().unwrap().push(json!({
            "fields": event.fields,
            "level": event.level,
            "message": event.message,
        }));
    });
    let path = path.to_owned();
    Application::new("notes")
        .description("Refresh the skills.")
        .plugins((observer,))
        .command(
            Command::new("refresh")
                .description("Refresh the skills.")
                .action(move |ctx: Context| {
                    let path = path.clone();
                    let resolved = Arc::clone(&resolved);
                    async move {
                        refresh_skills(RefreshContext {
                            path: Path::new(&path),
                            host: &ctx.host,
                            signal: &ctx.signal,
                            log: &ctx.log,
                        })
                        .await?;
                        resolved.store(true, Ordering::SeqCst);
                        ctx.out.print("resolved").await
                    }
                }),
        )
}

async fn refresh_on_mock<F, A>(
    path: &str,
    script: F,
    signal: Option<CancellationToken>,
) -> Refreshed
where
    F: Fn(ProgramCall) -> A + Send + Sync + 'static,
    A: Future<Output = io::Result<ProgramAnswer>> + Send + 'static,
{
    let events = Arc::new(Mutex::new(Vec::new()));
    let resolved = Arc::new(AtomicBool::new(false));
    let app = refresh_application(path, Arc::clone(&events), Arc::clone(&resolved));
    let process = mock_process(
        MockFields::new()
            .argv(["refresh"])
            .cwd(WORK)
            .env("FROM_HOST", "yes")
            .script(path, script),
    );
    let mut options = RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>);
    if let Some(signal) = signal {
        options = options.signal(signal);
    }
    let code = app.run(options).await;
    let events = events.lock().unwrap().clone();
    Refreshed {
        code: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
        events,
        resolved: resolved.load(Ordering::SeqCst),
    }
}

async fn unstartable(call: ProgramCall) -> io::Result<ProgramAnswer> {
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("spawn {} ENOENT", call.command),
    ))
}

#[tokio::test]
async fn runs_the_binary_with_skills_update_host_env_and_host_cwd_pipes_its_output_and_resolves() {
    let result = refresh_on_mock(
        BINARY,
        |call: ProgramCall| async move {
            let printed = json!({
                "argv": call.args,
                "cwd": call.cwd,
                "from": call.env.get("FROM_HOST"),
            });
            Ok(ProgramAnswer::new()
                .stdout(format!("{printed}\n"))
                .stderr("child says hello\n"))
        },
        None,
    )
    .await;
    assert_eq!(result.code, 0);
    let printed = result
        .stdout
        .lines()
        .find(|line| line.starts_with('{'))
        .unwrap();
    let printed: Value = serde_json::from_str(printed).unwrap();
    assert_eq!(printed["argv"], json!(["skills", "update"]));
    assert_eq!(printed["from"], "yes");
    assert!(printed["cwd"].as_str().unwrap().ends_with("work"));
    assert!(result.stdout.ends_with("resolved\n"));
    assert!(result.stderr.contains("child says hello\n"));
    assert!(result.resolved);
    assert!(result.events.is_empty());
}

#[tokio::test]
async fn adds_the_warn_event_with_the_exit_code_for_a_child_that_exits_1_and_resolves() {
    let result = refresh_on_mock(
        BINARY,
        |_| async { Ok(ProgramAnswer::new().code(1).stderr("the child failed\n")) },
        None,
    )
    .await;
    assert_eq!(result.code, 0);
    assert!(result.stderr.contains("the child failed\n"));
    assert!(result.resolved);
    assert_eq!(
        result.events,
        [json!({ "fields": { "code": 1, "path": BINARY }, "level": "warn", "message": WARNING })]
    );
}

fn assert_unstarted(result: &Refreshed, path: &str, line: &str) {
    assert_eq!(result.code, 0);
    assert_eq!(result.stderr, line);
    assert!(result.resolved);
    let [event] = result.events.as_slice() else {
        panic!("not one event: {:?}", result.events);
    };
    assert_eq!(event["level"], "warn");
    assert_eq!(event["message"], WARNING);
    assert_eq!(event["fields"]["path"], path);
    assert!(event["fields"]["error"].is_string());
    assert!(event["fields"].get("code").is_none());
}

#[tokio::test]
async fn adds_the_warn_event_with_the_error_and_writes_the_pinned_line_for_a_path_that_cannot_start()
 {
    let path = "/loom-test/missing/notes";
    let result = refresh_on_mock(path, unstartable, None).await;
    assert_unstarted(
        &result,
        path,
        &format!(
            "The skills were not refreshed because {path} could not start. Run notes skills update.\n"
        ),
    );
}

#[tokio::test]
async fn escapes_control_characters_in_the_path_the_line_repeats() {
    let result = refresh_on_mock("/loom-test/missing/no\u{7}tes", unstartable, None).await;
    assert_eq!(
        result.stderr,
        "The skills were not refreshed because /loom-test/missing/no\\u0007tes could not start. Run no\\u0007tes skills update.\n"
    );
}

#[tokio::test]
async fn reports_the_shell_status_of_the_signal_for_a_child_with_no_sigterm_handler_and_exits_130()
{
    let controller = CancellationToken::new();
    let cancel = controller.clone();
    // The child cancels the run once it has started, and runs until it is ended.
    let result = refresh_on_mock(
        BINARY,
        move |call: ProgramCall| {
            let cancel = cancel.clone();
            async move {
                cancel.cancel();
                call.signal.cancelled().await;
                Ok(ProgramAnswer::new())
            }
        },
        Some(controller),
    )
    .await;
    assert_eq!(result.code, 130);
    assert!(result.resolved);
    assert_eq!(
        result.events,
        [json!({ "fields": { "code": 143, "path": BINARY }, "level": "warn", "message": WARNING })]
    );
}

// The two cases that need the runtime's own spawn.

/// A stream that keeps what it is given.
#[derive(Default)]
struct Sink(Mutex<Vec<u8>>);

impl Sink {
    fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

impl OutputStream for Sink {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Box::pin(async { Ok(()) })
    }
}

/// Runs the refresh application on the real process handle against the binary at `path`, with the
/// streams captured, cancelling the run once the marker file appears.
async fn refresh_on_real_process(
    path: &str,
    root: &Path,
    marker: &Path,
) -> (u8, String, Vec<Value>, bool) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let resolved = Arc::new(AtomicBool::new(false));
    let app = refresh_application(path, Arc::clone(&events), Arc::clone(&resolved));
    let stderr = Arc::new(Sink::default());
    let env: Env = [
        ("FROM_HOST".to_owned(), "yes".to_owned()),
        ("MARK".to_owned(), marker.to_string_lossy().into_owned()),
        (
            "TERM_FILE".to_owned(),
            root.join("term").to_string_lossy().into_owned(),
        ),
        ("PATH".to_owned(), std::env::var("PATH").unwrap_or_default()),
    ]
    .into();
    let handle = process_handle(
        ProcessFields::new()
            .argv(["refresh"])
            .cwd(root)
            .env(env)
            .stdout(Arc::new(Sink::default()))
            .stderr(Arc::clone(&stderr) as _),
    );
    let token = CancellationToken::new();
    let finished = Arc::new(AtomicBool::new(false));
    let watcher = {
        let (token, marker, finished) = (token.clone(), marker.to_owned(), Arc::clone(&finished));
        std::thread::spawn(move || {
            while !finished.load(Ordering::SeqCst) {
                if marker.exists() {
                    token.cancel();
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        })
    };
    let code = app
        .run(RunOptions::new().process(handle).signal(token))
        .await;
    finished.store(true, Ordering::SeqCst);
    watcher.join().unwrap();
    let events = events.lock().unwrap().clone();
    (
        code.get(),
        stderr.text(),
        events,
        resolved.load(Ordering::SeqCst),
    )
}

fn real_root() -> (PathBuf, impl Drop) {
    struct Remove(PathBuf);
    impl Drop for Remove {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let root = skills_support::temporary_root("loom-skills-refresh");
    (root.clone(), Remove(root))
}

#[tokio::test]
async fn adds_the_warn_event_and_writes_the_pinned_line_for_a_file_the_runtime_fails_on_starting_and_resolves()
 {
    let (root, _remove) = real_root();
    // A path through a regular file fails with ENOTDIR on every platform.
    let child = root.join("child");
    std::fs::write(&child, "not a directory\n").unwrap();
    let path = child.join("notes").to_string_lossy().into_owned();
    let (code, stderr, events, resolved) =
        refresh_on_real_process(&path, &root, &root.join("abort")).await;
    assert_eq!(code, 0);
    assert_eq!(
        stderr,
        format!(
            "The skills were not refreshed because {path} could not start. Run notes skills update.\n"
        )
    );
    assert!(resolved);
    let [event] = events.as_slice() else {
        panic!("not one event: {events:?}");
    };
    assert_eq!(event["level"], "warn");
    assert_eq!(event["message"], WARNING);
    assert_eq!(event["fields"]["path"], path.as_str());
    assert!(event["fields"]["error"].is_string());
    assert!(event["fields"].get("code").is_none());
}

#[tokio::test]
async fn ends_the_child_with_sigterm_when_the_run_is_cancelled_while_it_runs_warns_with_its_code_and_resolves()
 {
    let (root, _remove) = real_root();
    let marker = root.join("abort");
    let child = root.join("child.sh");
    // The child writes the marker once its handler is installed, and the run is cancelled on it.
    std::fs::write(
        &child,
        "#!/bin/sh\ntrap 'echo term > \"$TERM_FILE\"; exit 7' TERM\necho started > \"$MARK\"\nwhile :; do sleep 0.05; done\n",
    )
    .unwrap();
    std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = child.to_string_lossy().into_owned();
    let (code, _stderr, events, resolved) = refresh_on_real_process(&path, &root, &marker).await;
    assert_eq!(code, 130);
    assert_eq!(
        std::fs::read_to_string(root.join("term")).unwrap(),
        "term\n"
    );
    assert!(resolved);
    assert_eq!(
        events,
        [json!({ "fields": { "code": 7, "path": path }, "level": "warn", "message": WARNING })]
    );
}
