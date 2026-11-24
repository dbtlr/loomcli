//! Ports `completion-refresh.test.ts`: `refresh_completion` runs the replaced binary with
//! `completion update`, passes its output through, and returns; a child that exits 1 and a path
//! that cannot start each add the pinned `warn` log event. The reference's self-update fixture is
//! the self-update package's, so the last case drives the same chain from an action that calls the
//! refresh as the self-update's `after_replace` step does, with the replaced binary a program that
//! runs the installation fixture.

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use completion_support::TempDir;
use completion_support::install::{digest, jsonkit};
use loomcli_core::{
    Application, Command, Context, Group, LogDestination, LogEvent, NoInputs, NoResult, Plugin,
    ProcessHandle, RunOptions,
};
use loomcli_plugins::completion::{RefreshContext, refresh_completion, test_support::bash_script};
use loomcli_testing::{MockFields, ProgramAnswer, ProgramCall, mock_process};
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Group>;

/// Where the mock runs the application and where the refreshed binary lies.
const WORK: &str = "/loom-test/work";
const REFRESHED: &str = "/loom-test/bin/jsonkit";
const WARNING: &str = "Completion was not refreshed after the update.";

struct Refreshed {
    code: u8,
    stdout: String,
    stderr: String,
    events: Vec<Value>,
    resolved: bool,
}

/// An application whose `refresh` Command calls the refresh with the binary at `path`, as a
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
        .description("Refresh.")
        .plugins((observer,))
        .command(
            Command::new("refresh")
                .description("Refresh.")
                .action(move |context: Context| {
                    let path = path.clone();
                    let resolved = Arc::clone(&resolved);
                    async move {
                        refresh_completion(RefreshContext {
                            path: Path::new(&path),
                            host: &context.host,
                            signal: &context.signal,
                            log: &context.log,
                        })
                        .await?;
                        resolved.store(true, Ordering::SeqCst);
                        context.out.print("resolved").await
                    }
                }),
        )
}

/// Runs the `refresh` Command on the mock against the binary at `path`, whose child is `script`.
async fn refresh<F, A>(path: &str, script: F) -> Refreshed
where
    F: Fn(ProgramCall) -> A + Send + Sync + 'static,
    A: std::future::Future<Output = io::Result<ProgramAnswer>> + Send + 'static,
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
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    let events = events.lock().unwrap().clone();
    Refreshed {
        code: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
        events,
        resolved: resolved.load(Ordering::SeqCst),
    }
}

#[tokio::test]
async fn runs_the_binary_with_completion_update_host_env_and_host_cwd_pipes_its_output_and_resolves()
 {
    let result = refresh(REFRESHED, |call: ProgramCall| async move {
        let printed = json!({
            "argv": call.args,
            "cwd": call.cwd,
            "from": call.env.get("FROM_HOST"),
        });
        Ok(ProgramAnswer::new()
            .stdout(format!("{printed}\n"))
            .stderr("child says hello\n"))
    })
    .await;
    assert_eq!(result.code, 0);
    let printed = result
        .stdout
        .lines()
        .find(|line| line.starts_with('{'))
        .unwrap();
    let printed: Value = serde_json::from_str(printed).unwrap();
    assert_eq!(printed["argv"], json!(["completion", "update"]));
    assert_eq!(printed["from"], "yes");
    assert!(printed["cwd"].as_str().unwrap().ends_with("work"));
    assert!(result.stderr.contains("child says hello\n"));
    assert!(result.resolved);
    assert!(result.events.is_empty());
}

#[tokio::test]
async fn adds_the_warn_event_with_the_exit_code_for_a_child_that_exits_1_and_resolves() {
    let result = refresh(REFRESHED, |_| async { Ok(ProgramAnswer::new().code(1)) }).await;
    assert_eq!(result.code, 0);
    assert!(result.resolved);
    assert_eq!(
        result.events,
        [
            json!({ "fields": { "code": 1, "path": REFRESHED }, "level": "warn", "message": WARNING })
        ]
    );
}

#[tokio::test]
async fn adds_the_warn_event_and_writes_the_pinned_line_for_a_path_that_cannot_start() {
    let path = "/loom-test/missing/jsonkit";
    // An error stands for a binary that could not start, as a missing file cannot.
    let result = refresh(path, |call: ProgramCall| async move {
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("spawn {} ENOENT", call.command),
        ))
    })
    .await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stderr,
        format!(
            "Completion was not refreshed because {path} could not start. Run jsonkit completion update.\n"
        )
    );
    assert!(result.resolved);
    let [event] = result.events.as_slice() else {
        panic!("not one event: {:?}", result.events);
    };
    assert_eq!(event["level"], "warn");
    assert_eq!(event["message"], WARNING);
    assert_eq!(event["fields"]["path"], path);
    assert!(event["fields"]["error"].is_string());
}

/// A program that stands for the replaced binary: once the update wrote its bytes at its path it
/// runs the installation fixture with the arguments it was given.
fn replacing_binary(
    bytes: &'static str,
    home: PathBuf,
    data: PathBuf,
    state: PathBuf,
) -> impl Fn(
    ProgramCall,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = io::Result<ProgramAnswer>> + Send>>
+ Send
+ Sync
+ 'static {
    move |call: ProgramCall| {
        let (home, data, state) = (home.clone(), data.clone(), state.clone());
        Box::pin(async move {
            if fs::read_to_string(&call.command)? != bytes {
                return Err(io::Error::other(format!(
                    "{} is not the new jsonkit binary.",
                    call.command
                )));
            }
            let process = mock_process(
                MockFields::new()
                    .argv(call.args.clone())
                    .cwd(call.cwd.clone())
                    .home(&home)
                    .env("HOME", &home.to_string_lossy())
                    .env("XDG_DATA_HOME", &data.to_string_lossy())
                    .env("XDG_STATE_HOME", &state.to_string_lossy())
                    .uid(Some(completion_support::install::current_uid())),
            );
            let code = jsonkit()
                .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
                .await;
            Ok(ProgramAnswer::new()
                .code(i32::from(code.get()))
                .stdout(process.stdout_text())
                .stderr(process.stderr_text()))
        })
    }
}

#[tokio::test]
async fn a_refresh_after_a_binary_replacement_rewrites_a_recorded_script_to_the_replaced_binarys_version()
 {
    let root = TempDir::new("loom-completion-update");
    let (home, data, state, bin) = (
        root.path.join("home"),
        root.path.join("data"),
        root.path.join("state"),
        root.path.join("bin"),
    );
    let installation = state.join("jsonkit/installation");
    for directory in [&home, &data, &state, &bin, &installation] {
        fs::create_dir_all(directory).unwrap();
    }
    // The old version installed its Bash script, so the record lists it and the file holds it.
    let script = data.join("jsonkit/completion/jsonkit.bash");
    fs::create_dir_all(script.parent().unwrap()).unwrap();
    fs::write(&script, "old script\n").unwrap();
    fs::write(
        installation.join("completion.bash.json"),
        format!(
            "{}\n",
            json!({
                "format": 1,
                "state": "committed",
                "directories": [],
                "files": [{ "path": script, "digest": digest("old script\n") }],
            })
        ),
    )
    .unwrap();
    // The update wrote the new version's bytes at the binary's path.
    let bytes = "jsonkit 1.5.0 binary\n";
    let binary = bin.join("jsonkit");
    fs::write(&binary, bytes).unwrap();
    let binary_text = binary.to_string_lossy().into_owned();
    let events = Arc::new(Mutex::new(Vec::new()));
    let resolved = Arc::new(AtomicBool::new(false));
    let app = refresh_application(&binary_text, Arc::clone(&events), Arc::clone(&resolved));
    let process = mock_process(
        MockFields::new()
            .argv(["refresh"])
            .cwd(&root.path)
            .env("HOME", &home.to_string_lossy())
            .env("XDG_STATE_HOME", &state.to_string_lossy())
            .script(
                &binary_text,
                replacing_binary(bytes, home.clone(), data.clone(), state.clone()),
            ),
    );
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 0, "{}", process.stderr_text());
    assert!(
        process.stderr_text().contains(&format!(
            "Updated the bash completion script in {}.",
            script.display()
        )),
        "{}",
        process.stderr_text()
    );
    assert_eq!(fs::read_to_string(&script).unwrap(), bash_script("jsonkit"));
    assert!(resolved.load(Ordering::SeqCst));
    assert!(events.lock().unwrap().is_empty());
}
