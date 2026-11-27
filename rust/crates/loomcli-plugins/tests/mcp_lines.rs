//! The MCP registration Commands' lookup and change events.

#![cfg(all(feature = "mcp", feature = "verbose"))]
#![allow(clippy::unwrap_used)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{Application, Build, LogEvent, LogLevel, Plugin, ReleaseFacts, RunOptions};
use loomcli_plugins::{mcp::mcp, verbose::verbose};
use loomcli_testing::{MockFields, ProgramAnswer, mock_process};
use serde_json::{Value, json};

const PROGRAM: &str = "/home/me/.local/bin/jsonkit";
const SECRET: &str = "fixture-secret-0123456789";
const CLAUDE_ADD: &[&str] = &["mcp", "add", "-s", "user", "jsonkit", "--", PROGRAM, "mcp"];
const CLAUDE_REMOVE: &[&str] = &["mcp", "remove", "-s", "user", "jsonkit"];
const CODEX_ADD: &[&str] = &["mcp", "add", "jsonkit", "--", PROGRAM, "mcp"];

struct State(PathBuf);

impl State {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
            "loom-mcp-lines-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn record(&self, agent: &str) -> PathBuf {
        self.0
            .join("jsonkit/installation")
            .join(format!("mcp.{agent}.json"))
    }
}

impl Drop for State {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Ran {
    stderr: String,
    events: Vec<LogEvent>,
}

impl Ran {
    fn changes(&self) -> Vec<(&str, Value)> {
        self.events
            .iter()
            .filter(|event| event.level == LogLevel::Info)
            .map(|event| {
                assert_eq!(event.plugin.as_deref(), Some("@loomcli/plugins/mcp"));
                (event.message.as_str(), Value::Object(event.fields.clone()))
            })
            .collect()
    }
}

async fn run(state: &State, argv: &[&str], refused_remove: Option<&str>) -> Ran {
    let events = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/observer").on_log({
        let events = Arc::clone(&events);
        move |event, _| events.lock().unwrap().push(event.clone())
    });
    let app = Application::new("jsonkit")
        .description("Read JSON.")
        .plugins((observer, verbose(), mcp()));
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .env("API_TOKEN", SECRET)
        .env("XDG_STATE_HOME", &state.0.to_string_lossy())
        .home(&state.0)
        .program([PROGRAM])
        .release(ReleaseFacts::new(Build::Distributed));
    for agent in ["claude", "codex"] {
        let refuses = refused_remove == Some(agent);
        fields = fields.script(agent, move |call| async move {
            let verb = call.args.get(1).map(String::as_str);
            let code = i32::from(verb == Some("get") || (verb == Some("remove") && refuses));
            Ok(ProgramAnswer::new().code(code))
        });
    }
    let mock = mock_process(fields);
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0,
        "{}",
        mock.stderr_text()
    );
    let events = events.lock().unwrap().clone();
    Ran {
        stderr: mock.stderr_text(),
        events,
    }
}

fn written(path: &Path) -> (&'static str, Value) {
    ("File written.", json!({"path": path}))
}

fn removed(path: &Path) -> (&'static str, Value) {
    ("File removed.", json!({"path": path}))
}

fn called(agent: &str, arguments: &[&str]) -> (&'static str, Value) {
    (
        "Program run.",
        json!({"arguments": arguments, "code": 0, "program": agent}),
    )
}

fn checked(path: &Path) -> String {
    format!("  ┆ Checked {}.\n", path.display())
}

fn installed_lines(state: &State, agent: &str, calls: &[&[&str]]) -> String {
    let path = state.record(agent);
    let path = path.display();
    let calls: String = calls
        .iter()
        .map(|words| {
            format!(
                "› Program run. arguments={} code=0 program={agent}\n",
                serde_json::to_string(words).unwrap(),
            )
        })
        .collect();
    format!(
        "› File written. path={path}\n{calls}› File written. path={path}\n✔ Registered jsonkit with {agent} to run {PROGRAM} mcp.\n",
    )
}

#[tokio::test]
async fn only_trace_names_the_record_files_and_follows_agent_order() {
    let state = State::new();
    let expected = format!(
        "✔ Registered jsonkit with claude to run {PROGRAM} mcp.\n✔ Registered jsonkit with codex to run {PROGRAM} mcp.\n",
    );
    assert_eq!(
        run(&state, &["mcp", "install"], None).await.stderr,
        expected
    );
    let fresh = State::new();
    assert_eq!(
        run(&fresh, &["-v", "mcp", "install"], None).await.stderr,
        installed_lines(&fresh, "claude", &[CLAUDE_ADD])
            + &installed_lines(&fresh, "codex", &[CODEX_ADD]),
    );
    assert_eq!(
        run(&state, &["-vv", "mcp", "install"], None).await.stderr,
        checked(&state.record("claude"))
            + &checked(&state.record("codex"))
            + &installed_lines(&state, "claude", &[CLAUDE_REMOVE, CLAUDE_ADD])
            + &installed_lines(&state, "codex", &[CODEX_ADD]),
    );
}

#[tokio::test]
async fn missing_files_are_checked_and_a_named_agent_limits_the_checks() {
    let state = State::new();
    assert_eq!(
        run(&state, &["-vv", "mcp", "uninstall"], None).await.stderr,
        checked(&state.record("claude"))
            + &checked(&state.record("codex"))
            + "✔ jsonkit is not registered with any agent by jsonkit mcp install, so there is nothing to remove.\n",
    );
    assert_eq!(
        run(&state, &["-vv", "mcp", "install", "--agent", "codex"], None)
            .await
            .stderr,
        checked(&state.record("codex")) + &installed_lines(&state, "codex", &[CODEX_ADD]),
    );
}

#[tokio::test]
async fn install_records_each_write_and_add_in_order() {
    let state = State::new();
    let (claude, codex) = (state.record("claude"), state.record("codex"));
    assert_eq!(
        run(&state, &["mcp", "install"], None).await.changes(),
        [
            written(&claude),
            called("claude", CLAUDE_ADD),
            written(&claude),
            written(&codex),
            called("codex", CODEX_ADD),
            written(&codex)
        ],
    );
}

#[tokio::test]
async fn claude_remove_before_add_only_records_a_success() {
    let state = State::new();
    let path = state.record("claude");
    let argv = &["mcp", "install", "--agent", "claude"];
    run(&state, argv, None).await;
    assert_eq!(
        run(&state, argv, None).await.changes(),
        [
            written(&path),
            called("claude", CLAUDE_REMOVE),
            called("claude", CLAUDE_ADD),
            written(&path)
        ],
    );
    assert_eq!(
        run(&state, argv, Some("claude")).await.changes(),
        [written(&path), called("claude", CLAUDE_ADD), written(&path)],
    );
}

#[tokio::test]
async fn uninstall_records_pending_writes_successful_removals_and_deletions() {
    let state = State::new();
    let (claude, codex) = (state.record("claude"), state.record("codex"));
    run(&state, &["mcp", "install"], None).await;
    assert_eq!(
        run(&state, &["mcp", "uninstall"], Some("codex"))
            .await
            .changes(),
        [
            written(&claude),
            called("claude", CLAUDE_REMOVE),
            removed(&claude),
            written(&codex),
            removed(&codex)
        ],
    );
}

#[tokio::test]
async fn a_leftover_staging_file_is_recorded_before_changes() {
    let state = State::new();
    let staging = state
        .record("claude")
        .with_file_name(".mcp.claude.json.0123456789abcdef.loom-staging");
    fs::create_dir_all(staging.parent().unwrap()).unwrap();
    fs::write(&staging, "partial").unwrap();
    let installed = run(&state, &["mcp", "install", "--agent", "claude"], None).await;
    assert_eq!(installed.changes().first(), Some(&removed(&staging)));
}

#[tokio::test]
async fn registration_events_contain_no_environment_values() {
    let state = State::new();
    let installed = run(&state, &["mcp", "install"], None).await;
    let removed = run(&state, &["mcp", "uninstall"], None).await;
    let recorded = serde_json::to_string(&[installed.events, removed.events]).unwrap();
    assert!(recorded.contains("Program run."));
    assert!(!recorded.contains(SECRET));
}
