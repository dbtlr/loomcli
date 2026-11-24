//! The logging plugin's records, file locations, and console destination, ported from the reference's
//! `logging.test.ts`, end to end through `Application::run` on the mock process.

#![cfg(feature = "logging")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod logging_support;

use std::fs;

use logging_support::{
    Facts, Sandbox, invoke_by_name, lines, logged, names, pinned, record, run, run_default,
};
use loomcli_core::LogLevel;
use loomcli_plugins::logging::{LogTarget, logging};

fn clean() -> logging_support::Outcome {
    logging_support::Outcome {
        status: 0,
        stderr: String::new(),
        stdout: String::new(),
        reports: Vec::new(),
    }
}

// Records

#[tokio::test]
async fn an_application_that_installs_logging_appends_one_pinned_line_for_each_event_at_or_above_info()
 {
    let sandbox = Sandbox::new();
    assert_eq!(run_default(&sandbox, &["log"]).await, clean());
    assert_eq!(
        lines(&sandbox.file),
        [logged("info"), logged("warn"), logged("error")]
    );
}

#[tokio::test]
async fn level_trace_writes_all_five_levels_in_call_order() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().level(LogLevel::Trace),
    )
    .await;
    assert_eq!(
        lines(&sandbox.file),
        [
            logged("trace"),
            logged("debug"),
            logged("info"),
            logged("warn"),
            logged("error")
        ]
    );
}

#[tokio::test]
async fn a_record_holds_its_keys_in_the_pinned_order_and_omits_the_absent_ones() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["fail"],
        Facts::default(),
        logging().level(LogLevel::Error),
    )
    .await;
    let written = lines(&sandbox.file);
    assert_eq!(written.len(), 1);
    let value: serde_json::Value = serde_json::from_str(&written[0]).unwrap();
    let keys: Vec<&String> = value.as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "time",
            "level",
            "message",
            "fields",
            "application",
            "run",
            "path",
            "plugin",
            "failure"
        ]
    );
    assert_eq!(value["message"], "The run failed.");
    assert_eq!(value["level"], "error");
}

#[tokio::test]
async fn level_error_still_writes_the_fatal_record_of_a_defect_with_its_defect() {
    let sandbox = Sandbox::new();
    let ran = run(
        &sandbox,
        &["defect"],
        Facts::default(),
        logging().level(LogLevel::Error),
    )
    .await;
    assert_eq!(ran.status, 1);
    let written = lines(&sandbox.file);
    assert_eq!(written.len(), 1);
    let value: serde_json::Value = serde_json::from_str(&written[0]).unwrap();
    let keys: Vec<&String> = value.as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "time",
            "level",
            "message",
            "fields",
            "application",
            "run",
            "path",
            "plugin",
            "failure",
            "defect"
        ]
    );
    assert_eq!(value["level"], "fatal");
    assert_eq!(value["defect"]["message"], "The action failed.");
    assert_eq!(
        value["defect"]["name"],
        "logging_records::logging_support::ActionFailed"
    );
    assert!(value["defect"].get("stack").is_none(), "{value}");
}

#[tokio::test]
async fn a_record_is_written_as_json_stringify_writes_it_byte_for_byte() {
    let sandbox = Sandbox::new();
    assert_eq!(run_default(&sandbox, &["odd"]).await, clean());
    let text = fs::read_to_string(&sandbox.file).unwrap();
    assert_eq!(
        pinned(text.trim_end()),
        "{\"time\":\"T\",\"level\":\"info\",\"message\":\"Odd \u{e9} \\u0001\",\"fields\":{\"text\":\"caf\u{e9} \u{2028}\\\"\\\\\\n\u{7f}\",\"ratio\":1.5},\"application\":{\"name\":\"heimdall\",\"version\":\"1.2.0\"},\"run\":\"R\",\"path\":[\"odd\"],\"plugin\":null}"
    );
}

#[tokio::test]
async fn level_fatal_writes_the_fatal_events_alone() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["fail"],
        Facts::default(),
        logging().level(LogLevel::Fatal),
    )
    .await;
    assert!(!sandbox.file.exists());
    run(
        &sandbox,
        &["defect"],
        Facts::default(),
        logging().level(LogLevel::Fatal),
    )
    .await;
    assert_eq!(lines(&sandbox.file).len(), 1);
}

/// The reference starts a real process whose action ends it right after the call. Here the action
/// would read the file between the call and its return; the hook's write is synchronous, so the
/// record is there when the call returns.
#[tokio::test]
async fn a_record_is_in_the_file_when_the_call_returns() {
    use loomcli_core::{Application, Command, Context, ProcessHandle, RunOptions};
    use std::sync::Arc;
    let sandbox = Sandbox::new();
    let file = sandbox.file.clone();
    let seen = Arc::new(std::sync::Mutex::new(String::new()));
    let app = Application::new("heimdall")
        .version("1.2.0")
        .plugins((logging(),))
        .command(Command::new("leave").action({
            let seen = Arc::clone(&seen);
            move |ctx: Context| {
                let file = file.clone();
                let seen = Arc::clone(&seen);
                async move {
                    ctx.log.info("Before the exit.", ());
                    *seen.lock().unwrap() = fs::read_to_string(file).unwrap_or_default();
                    Ok(())
                }
            }
        }))
        .action(|_: Context| async { Ok(()) });
    let process = logging_support::mock_for(&sandbox, &["leave"]);
    app.run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    let seen = seen.lock().unwrap().clone();
    assert_eq!(
        pinned(seen.trim_end()),
        record(
            "info",
            "Before the exit.",
            serde_json::json!({}),
            &["leave"]
        )
    );
}

// The file

#[tokio::test]
async fn file_names_a_file_inside_the_default_directory() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().file("collector.jsonl"),
    )
    .await;
    assert_eq!(
        lines(&sandbox.directory().join("collector.jsonl")),
        [logged("info"), logged("warn"), logged("error")]
    );
    assert!(!sandbox.file.exists());
}

#[tokio::test]
async fn a_relative_file_resolves_inside_the_default_directory_and_never_in_the_working_directory()
{
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().file("logs/sub/collector.jsonl"),
    )
    .await;
    let written = sandbox
        .directory()
        .join("logs")
        .join("sub")
        .join("collector.jsonl");
    assert_eq!(lines(&written).len(), 3);
    assert_eq!(names(&sandbox.work), Vec::<String>::new());
}

#[tokio::test]
async fn an_absolute_file_writes_where_it_names_creating_the_missing_directories() {
    let sandbox = Sandbox::new();
    let file = sandbox.root.join("elsewhere").join("deep").join("x.jsonl");
    run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().file(file.display().to_string()),
    )
    .await;
    assert_eq!(lines(&file).len(), 3);
    assert!(!sandbox.directory().exists());
}

#[tokio::test]
async fn tilde_slash_resolves_from_the_home_directory_the_run_was_given() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().file("~/x.jsonl"),
    )
    .await;
    assert_eq!(lines(&sandbox.home.join("x.jsonl")).len(), 3);
}

#[tokio::test]
async fn tilde_with_repeated_slashes_stays_under_the_home_directory() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().file("~//logs//x.jsonl"),
    )
    .await;
    assert_eq!(lines(&sandbox.home.join("logs").join("x.jsonl")).len(), 3);
}

#[tokio::test]
async fn the_darwin_row_resolves_from_home_under_library_logs() {
    let sandbox = Sandbox::new();
    let home = sandbox.home.display().to_string();
    let state = sandbox.state.display().to_string();
    run(
        &sandbox,
        &["log"],
        Facts::env(&[("HOME", &home), ("XDG_STATE_HOME", &state)]).platform("darwin"),
        logging(),
    )
    .await;
    let written = sandbox
        .home
        .join("Library")
        .join("Logs")
        .join("heimdall")
        .join("heimdall.jsonl");
    assert_eq!(lines(&written).len(), 3);
    assert!(!sandbox.file.exists());
}

#[tokio::test]
async fn xdg_state_home_unset_or_not_absolute_falls_back_to_home_local_state() {
    for xdg in [None, Some("relative/state")] {
        let sandbox = Sandbox::new();
        let home = sandbox.home.display().to_string();
        let mut env = vec![("HOME", home.as_str())];
        if let Some(xdg) = xdg {
            env.push(("XDG_STATE_HOME", xdg));
        }
        run(&sandbox, &["log"], Facts::env(&env), logging()).await;
        let written = sandbox
            .home
            .join(".local")
            .join("state")
            .join("heimdall")
            .join("heimdall.jsonl");
        assert_eq!(lines(&written).len(), 3, "{xdg:?}");
    }
}

// The console

#[tokio::test]
async fn to_console_writes_the_same_bytes_to_stderr_as_the_file_and_none_to_stdout() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().level(LogLevel::Trace),
    )
    .await;
    let written = lines(&sandbox.file);
    let ran = run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().level(LogLevel::Trace).target(LogTarget::Stderr),
    )
    .await;
    assert_eq!(ran.status, 0);
    assert_eq!(ran.stdout, "");
    assert!(ran.stderr.ends_with('\n'));
    let console: Vec<String> = ran.stderr[..ran.stderr.len() - 1]
        .split('\n')
        .map(pinned)
        .collect();
    assert_eq!(console, written);
    assert_eq!(lines(&sandbox.file), written);
}

#[tokio::test]
async fn to_console_writes_no_file() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().target(LogTarget::Stderr),
    )
    .await;
    assert_eq!(names(&sandbox.state), Vec::<String>::new());
}

#[tokio::test]
async fn an_invoke_writes_nothing_to_stderr_with_to_console() {
    let sandbox = Sandbox::new();
    let result = invoke_by_name(
        &sandbox,
        &["log"],
        Facts::default(),
        logging().target(LogTarget::Stderr),
    )
    .await;
    assert_eq!(
        result,
        ("completed".to_owned(), String::new(), String::new())
    );
    assert_eq!(names(&sandbox.state), Vec::<String>::new());
}

#[tokio::test]
async fn an_invoke_still_writes_the_file_from_the_env_it_captured() {
    let sandbox = Sandbox::new();
    let result = invoke_by_name(&sandbox, &["log"], Facts::default(), logging()).await;
    assert_eq!(
        result,
        ("completed".to_owned(), String::new(), String::new())
    );
    assert_eq!(lines(&sandbox.file).len(), 3);
}

#[tokio::test]
async fn an_invoke_writes_the_file_from_the_env_its_process_replaced() {
    let sandbox = Sandbox::new();
    let replaced = sandbox.root.join("replaced");
    let result = invoke_by_name(
        &sandbox,
        &["log"],
        Facts::env(&[("XDG_STATE_HOME", &replaced.display().to_string())]),
        logging(),
    )
    .await;
    assert_eq!(
        result,
        ("completed".to_owned(), String::new(), String::new())
    );
    assert_eq!(
        lines(&replaced.join("heimdall").join("heimdall.jsonl")).len(),
        3
    );
    assert!(!sandbox.file.exists());
}
