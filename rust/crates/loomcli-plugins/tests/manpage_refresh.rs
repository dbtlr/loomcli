//! `refresh_manpages` itself, the public `after_replace` function, ported from the reference's
//! `manpage-refresh.test.ts`. The shared refresh is also exercised with the man page words in
//! `installation_refresh.rs`; these cases call the function the plugin exports.

#![cfg(feature = "manpage")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Command, Context, Group, LogDestination, LogEvent, NoInputs, NoResult, Plugin,
    ProcessHandle, RunOptions,
};
use loomcli_plugins::manpage::{RefreshContext, refresh_manpages};
use loomcli_testing::{MockFields, ProgramAnswer, ProgramCall, mock_process};
use serde_json::{Value, json};

const WARNING: &str = "Man pages were not refreshed after the update.";

type App = Application<NoInputs, NoResult, Group>;

/// An application whose `refresh` Command calls `refresh_manpages` with the binary at `path` and
/// prints `resolved` once it returned.
fn refresh_application(path: &str, events: Arc<Mutex<Vec<Value>>>) -> App {
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
                    async move {
                        refresh_manpages(RefreshContext::new(
                            Path::new(&path),
                            &ctx.host,
                            &ctx.signal,
                            &ctx.log,
                        ))
                        .await?;
                        ctx.out.print("resolved").await
                    }
                }),
        )
}

async fn refresh<F, A>(path: &str, script: F) -> (u8, String, String, Vec<Value>)
where
    F: Fn(ProgramCall) -> A + Send + Sync + 'static,
    A: Future<Output = io::Result<ProgramAnswer>> + Send + 'static,
{
    let events = Arc::new(Mutex::new(Vec::new()));
    let app = refresh_application(path, Arc::clone(&events));
    let process = mock_process(
        MockFields::new()
            .argv(["refresh"])
            .cwd("/loom-test/work")
            .env("FROM_HOST", "yes")
            .script(path, script),
    );
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    let events = events.lock().unwrap().clone();
    (
        code.get(),
        process.stdout_text(),
        process.stderr_text(),
        events,
    )
}

#[tokio::test]
async fn it_runs_the_binary_with_manpage_update_host_env_and_host_cwd_pipes_its_output_and_resolves()
 {
    let (code, stdout, stderr, events) = refresh("/loom-test/bin/notes", |call| async move {
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
    assert_eq!(code, 0);
    let printed = stdout.lines().find(|line| line.starts_with('{')).unwrap();
    let printed: Value = serde_json::from_str(printed).unwrap();
    assert_eq!(printed["argv"], json!(["manpage", "update"]));
    assert_eq!(printed["from"], "yes");
    assert!(printed["cwd"].as_str().unwrap().ends_with("work"));
    assert!(stdout.ends_with("resolved\n"));
    assert!(stderr.contains("child says hello\n"));
    assert_eq!(
        events,
        [json!({
            "level": "info",
            "message": "Program run.",
            "fields": {"arguments": ["manpage", "update"], "code": 0, "program": "/loom-test/bin/notes"}
        })]
    );
}

#[tokio::test]
async fn it_adds_the_warn_event_with_the_exit_code_for_a_child_that_exits_1_and_resolves() {
    let path = "/loom-test/bin/notes";
    let (code, stdout, _, events) =
        refresh(path, |_| async { Ok(ProgramAnswer::new().code(1)) }).await;
    assert_eq!(code, 0);
    assert!(stdout.ends_with("resolved\n"));
    assert_eq!(
        events,
        [json!({ "fields": { "code": 1, "path": path }, "level": "warn", "message": WARNING })]
    );
}

#[tokio::test]
async fn it_adds_the_warn_event_and_writes_the_pinned_line_for_a_path_that_cannot_start() {
    let path = "/loom-test/missing/notes";
    let (code, stdout, stderr, events) = refresh(path, |call| async move {
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("spawn {} ENOENT", call.command),
        ))
    })
    .await;
    assert_eq!(code, 0);
    assert!(stdout.ends_with("resolved\n"));
    assert_eq!(
        stderr,
        format!(
            "The man pages were not refreshed because {path} could not start. Run notes manpage update.\n"
        )
    );
    let [event] = events.as_slice() else {
        panic!("not one event: {events:?}");
    };
    assert_eq!(event["level"], "warn");
    assert_eq!(event["message"], WARNING);
    assert_eq!(event["fields"]["path"], path);
    assert!(event["fields"]["error"].is_string());
}
