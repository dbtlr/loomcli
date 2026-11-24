//! Ports the shared refresh of `completion-refresh.test.ts`, `manpage-refresh.test.ts`,
//! `skills-refresh.test.ts`, and `host-facts.test.ts`: `refresh_by_running` with each installing
//! plugin's words and sentences, run from an action on the mock process. Also states the
//! application-folder refusals the installing plugins share, end to end.

#![cfg(feature = "installation")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Command, Context, Error, Group, LogDestination, LogEvent, NoInputs, NoResult,
    Plugin, ProcessHandle, RunOptions,
};
use loomcli_plugins::installation_test_support::{
    Refresh, RefreshContext, absolute_variable, home_of, record_directory, refresh_by_running,
    required_home,
};
use loomcli_testing::{MockFields, MockProcess, ProgramAnswer, ProgramCall, mock_process};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, Group>;

/// Where the mock runs the application and where the refreshed binary lies.
const WORK: &str = "/loom-test/work";

const COMPLETION: Refresh = Refresh {
    words: &["completion", "update"],
    warning: "Completion was not refreshed after the update.",
    not_started: |path, name| {
        format!(
            "Completion was not refreshed because {path} could not start. Run {name} completion update.\n"
        )
    },
};

const MANPAGE: Refresh = Refresh {
    words: &["manpage", "update"],
    warning: "Man pages were not refreshed after the update.",
    not_started: |path, name| {
        format!(
            "The man pages were not refreshed because {path} could not start. Run {name} manpage update.\n"
        )
    },
};

const SKILLS: Refresh = Refresh {
    words: &["skills", "update"],
    warning: "Skills were not refreshed after the update.",
    not_started: |path, name| {
        format!(
            "The skills were not refreshed because {path} could not start. Run {name} skills update.\n"
        )
    },
};

/// What a refresh run left: its exit code, its streams, the log events an observer saw, and
/// whether the refresh returned.
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
    refresh: Refresh,
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
                .action(move |ctx: Context| {
                    let path = path.clone();
                    let resolved = Arc::clone(&resolved);
                    async move {
                        refresh_by_running(
                            RefreshContext {
                                path: Path::new(&path),
                                host: &ctx.host,
                                signal: &ctx.signal,
                                log: &ctx.log,
                            },
                            &refresh,
                        )
                        .await;
                        resolved.store(true, Ordering::SeqCst);
                        ctx.out.print("resolved").await
                    }
                }),
        )
}

/// Runs the `refresh` Command on the mock against the binary at `path`, whose child is `script`.
async fn refresh_on_mock<F, A>(
    refresh: Refresh,
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
    let app = refresh_application(refresh, path, Arc::clone(&events), Arc::clone(&resolved));
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

/// A child that prints its words, working directory, and `FROM_HOST`, and greets on stderr.
async fn greeting(call: ProgramCall) -> io::Result<ProgramAnswer> {
    let printed = json!({
        "argv": call.args,
        "cwd": call.cwd,
        "from": call.env.get("FROM_HOST"),
    });
    Ok(ProgramAnswer::new()
        .stdout(format!("{printed}\n"))
        .stderr("child says hello\n"))
}

/// A child that could not start, as a missing file cannot.
async fn unstartable(call: ProgramCall) -> io::Result<ProgramAnswer> {
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("spawn {} ENOENT", call.command),
    ))
}

/// A run's refresh runs the binary with the words, `host.env`, and `host.cwd`, passes its output
/// through, adds no event, and returns.
async fn runs_the_binary_with_its_words(refresh: Refresh, path: &str, words: [&str; 2]) {
    let result = refresh_on_mock(refresh, path, greeting, None).await;
    assert_eq!(result.code, 0);
    let printed = result
        .stdout
        .lines()
        .find(|line| line.starts_with('{'))
        .unwrap();
    let printed: Value = serde_json::from_str(printed).unwrap();
    assert_eq!(printed["argv"], json!(words));
    assert_eq!(printed["from"], "yes");
    assert!(printed["cwd"].as_str().unwrap().ends_with("work"));
    assert!(result.stdout.ends_with("resolved\n"));
    assert!(result.stderr.contains("child says hello\n"));
    assert!(result.resolved);
    assert!(result.events.is_empty());
}

/// A child that exits 1 adds the warn event with its code and the path, and the refresh returns.
async fn warns_with_the_exit_code(refresh: Refresh, path: &str) {
    let result = refresh_on_mock(
        refresh,
        path,
        |_| async { Ok(ProgramAnswer::new().code(1).stderr("the child failed\n")) },
        None,
    )
    .await;
    assert_eq!(result.code, 0);
    assert!(result.stderr.contains("the child failed\n"));
    assert!(result.resolved);
    assert_eq!(
        result.events,
        [
            json!({ "fields": { "code": 1, "path": path }, "level": "warn", "message": refresh.warning })
        ]
    );
}

/// A binary that cannot start writes the pinned line and adds the warn event with its error and
/// the path, and the refresh returns.
async fn writes_the_pinned_line_when_it_cannot_start(refresh: Refresh, path: &str, line: &str) {
    let result = refresh_on_mock(refresh, path, unstartable, None).await;
    assert_eq!(result.code, 0);
    assert_eq!(result.stderr, line);
    assert!(result.resolved);
    let [event] = result.events.as_slice() else {
        panic!("not one event: {:?}", result.events);
    };
    assert_eq!(event["level"], "warn");
    assert_eq!(event["message"], refresh.warning);
    assert_eq!(event["fields"]["path"], path);
    assert!(event["fields"]["error"].is_string());
    assert!(event["fields"].get("code").is_none());
}

// completion-refresh.test.ts

#[tokio::test]
async fn completion_runs_the_binary_with_completion_update_host_env_and_host_cwd_pipes_its_output_and_resolves()
 {
    runs_the_binary_with_its_words(
        COMPLETION,
        "/loom-test/bin/jsonkit",
        ["completion", "update"],
    )
    .await;
}

#[tokio::test]
async fn completion_adds_the_warn_event_with_the_exit_code_for_a_child_that_exits_1_and_resolves() {
    warns_with_the_exit_code(COMPLETION, "/loom-test/bin/jsonkit").await;
}

#[tokio::test]
async fn completion_adds_the_warn_event_and_writes_the_pinned_line_for_a_path_that_cannot_start() {
    writes_the_pinned_line_when_it_cannot_start(
        COMPLETION,
        "/loom-test/missing/jsonkit",
        "Completion was not refreshed because /loom-test/missing/jsonkit could not start. Run jsonkit completion update.\n",
    )
    .await;
}

// manpage-refresh.test.ts

#[tokio::test]
async fn manpage_runs_the_binary_with_manpage_update_host_env_and_host_cwd_pipes_its_output_and_resolves()
 {
    runs_the_binary_with_its_words(MANPAGE, "/loom-test/bin/notes", ["manpage", "update"]).await;
}

#[tokio::test]
async fn manpage_adds_the_warn_event_with_the_exit_code_for_a_child_that_exits_1_and_resolves() {
    warns_with_the_exit_code(MANPAGE, "/loom-test/bin/notes").await;
}

#[tokio::test]
async fn manpage_adds_the_warn_event_and_writes_the_pinned_line_for_a_path_that_cannot_start_and_resolves()
 {
    writes_the_pinned_line_when_it_cannot_start(
        MANPAGE,
        "/loom-test/missing/notes",
        "The man pages were not refreshed because /loom-test/missing/notes could not start. Run notes manpage update.\n",
    )
    .await;
}

// skills-refresh.test.ts

#[tokio::test]
async fn skills_runs_the_binary_with_skills_update_host_env_and_host_cwd_pipes_its_output_and_resolves()
 {
    runs_the_binary_with_its_words(SKILLS, "/loom-test/bin/notes", ["skills", "update"]).await;
}

#[tokio::test]
async fn skills_adds_the_warn_event_with_the_exit_code_for_a_child_that_exits_1_and_resolves() {
    warns_with_the_exit_code(SKILLS, "/loom-test/bin/notes").await;
}

#[tokio::test]
async fn skills_adds_the_warn_event_with_the_error_and_writes_the_pinned_line_for_a_path_that_cannot_start()
 {
    writes_the_pinned_line_when_it_cannot_start(
        SKILLS,
        "/loom-test/missing/notes",
        "The skills were not refreshed because /loom-test/missing/notes could not start. Run notes skills update.\n",
    )
    .await;
}

#[tokio::test]
async fn skills_escapes_control_characters_in_the_path_the_line_repeats() {
    let result = refresh_on_mock(SKILLS, "/loom-test/missing/no\u{7}tes", unstartable, None).await;
    assert_eq!(
        result.stderr,
        "The skills were not refreshed because /loom-test/missing/no\\u0007tes could not start. Run no\\u0007tes skills update.\n"
    );
}

#[tokio::test]
async fn skills_reports_the_shell_status_of_the_signal_for_a_child_with_no_sigterm_handler_and_exits_130()
 {
    let path = "/loom-test/bin/notes";
    let controller = CancellationToken::new();
    let cancel = controller.clone();
    // The child cancels the run once it has started, and runs until it is ended.
    let result = refresh_on_mock(
        SKILLS,
        path,
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
        [
            json!({ "fields": { "code": 143, "path": path }, "level": "warn", "message": SKILLS.warning })
        ]
    );
}

// host-facts.test.ts

#[tokio::test]
async fn a_refresh_writes_the_new_binary_output_to_the_host_streams_and_gives_it_no_input() {
    let path = "/opt/notes/bin/notes";
    let process: Arc<MockProcess> = mock_process(
        MockFields::new()
            .stdin("piped input")
            .script(path, |_| async {
                Ok(ProgramAnswer::new().stdout("refreshed"))
            }),
    );
    let app = Application::new("notes").action(move |ctx: Context| async move {
        refresh_by_running(
            RefreshContext {
                path: Path::new(path),
                host: &ctx.host,
                signal: &ctx.signal,
                log: &ctx.log,
            },
            &Refresh {
                words: &["skills", "update"],
                warning: "The refresh failed.",
                not_started: |_, _| "not started\n".to_owned(),
            },
        )
        .await;
        Ok::<(), Error>(())
    });
    app.run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    let calls = process.calls();
    let [call] = calls.as_slice() else {
        panic!("not one call: {calls:?}");
    };
    assert_eq!(call.cwd, Path::new("/loom-test"));
    assert_eq!(call.input, "");
    assert_eq!(process.stdout_text(), "refreshed");
}

// The application folders the installing plugins share

/// Runs an action that reads the record directory or the home folder on the mock, with `home`
/// and `XDG_STATE_HOME`, and answers its exit code, stdout, and stderr.
async fn folders_on_mock(
    home: &str,
    state: Option<&str>,
    read: fn(&loomcli_core::Host) -> Result<String, loomcli_core::FatalError>,
) -> (u8, String, String) {
    let mut fields = MockFields::new().home(home).platform("linux");
    if let Some(state) = state {
        fields = fields.env("XDG_STATE_HOME", state);
    }
    let process = mock_process(fields);
    let app = Application::new("notes").action(move |ctx: Context| async move {
        let text = read(&ctx.host)?;
        ctx.out.print(&text).await
    });
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[tokio::test]
async fn the_record_directory_follows_an_absolute_xdg_state_home_and_needs_no_home() {
    let (code, stdout, stderr) = folders_on_mock("relative", Some("/state"), |host| {
        Ok(record_directory("notes", host)?.display().to_string())
    })
    .await;
    assert_eq!(
        (code, stdout.as_str(), stderr.as_str()),
        (0, "/state/notes/installation\n", "")
    );
}

#[tokio::test]
async fn a_record_directory_that_needs_a_home_that_is_not_absolute_refuses_naming_home() {
    let (code, stdout, stderr) = folders_on_mock("relative", Some("state"), |host| {
        Ok(record_directory("notes", host)?.display().to_string())
    })
    .await;
    assert_eq!(code, 1);
    assert_eq!(stdout, "");
    assert_eq!(
        stderr,
        "notes cannot find its installation record because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.\n"
    );
}

#[tokio::test]
async fn a_home_that_is_not_absolute_refuses_with_the_home_refusal() {
    let (code, stdout, stderr) = folders_on_mock("relative", None, |host| {
        Ok(required_home("notes", host)?.display().to_string())
    })
    .await;
    assert_eq!(code, 1);
    assert_eq!(stdout, "");
    assert_eq!(
        stderr,
        "notes cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.\n"
    );
    let (code, stdout, _) = folders_on_mock("/home/me", None, |host| {
        Ok(required_home("notes", host)?.display().to_string())
    })
    .await;
    assert_eq!((code, stdout.as_str()), (0, "/home/me\n"));
}

#[tokio::test]
async fn an_absolute_variable_and_an_absolute_home_are_read_as_paths_and_nothing_else_is() {
    let (code, stdout, _) = folders_on_mock("/home/me", Some("state"), |host| {
        Ok(format!(
            "{:?} {:?} {:?}",
            absolute_variable(host, "XDG_STATE_HOME"),
            absolute_variable(host, "UNSET"),
            home_of(Path::new("relative")),
        ))
    })
    .await;
    assert_eq!((code, stdout.as_str()), (0, "None None None\n"));
}
