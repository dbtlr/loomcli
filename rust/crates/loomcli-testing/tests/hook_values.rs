//! Unit fixtures for the reference's `environment-context.test.ts` and `hook-values.test.ts`.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::path::Path;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Context, Env, EnvironmentAdditions, EnvironmentContext, InputError,
    InvocationOutcome, InvocationValues, InvokeOptions, LogDestination, LogEvent, LogFields,
    LogLevel, Outcome, ProcessHandle, ProgressEvent, ProgressState,
};
use loomcli_testing::{
    EnvironmentValues, LogDestinationValues, LogEventValues, MockFields, ProgressEventValues,
    environment_context, log_destination, log_event, mock_process, progress_event,
};
use serde_json::json;

async fn region_default(context: EnvironmentContext) -> EnvironmentAdditions {
    match context.env.get("REGION") {
        None => {
            context.log.debug("REGION defaulted.", ());
            EnvironmentAdditions::from([("REGION".to_owned(), "us-east-1".to_owned())])
        }
        Some(region) => {
            if !region.starts_with("us-") {
                context
                    .warn(&format!("REGION {region} is outside the US."))
                    .await
                    .unwrap();
            }
            EnvironmentAdditions::new()
        }
    }
}

#[tokio::test]
async fn an_environment_hook_reads_the_provided_environment_and_returns_additions() {
    let mock = mock_process(MockFields::new());
    let context = environment_context(EnvironmentValues::new().process(mock));
    assert_eq!(
        region_default(context)
            .await
            .get("REGION")
            .map(String::as_str),
        Some("us-east-1")
    );
}

#[tokio::test]
async fn the_test_can_observe_environment_warnings_and_log_events() {
    let mock = mock_process(MockFields::new().env("REGION", "eu-west-1"));
    let context = environment_context(EnvironmentValues::new().process(mock.clone()));
    assert!(region_default(context).await.is_empty());
    assert_eq!(
        mock.stderr_text(),
        "⚠ REGION eu-west-1 is outside the US.\n"
    );

    let heard = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&heard);
    let context = environment_context(EnvironmentValues::new().on_log(move |event, _| {
        recorded
            .lock()
            .unwrap()
            .push((event.level, event.message.clone()));
    }));
    assert_eq!(
        region_default(context)
            .await
            .get("REGION")
            .map(String::as_str),
        Some("us-east-1")
    );
    assert_eq!(
        *heard.lock().unwrap(),
        [(LogLevel::Debug, "REGION defaulted.".to_owned())]
    );
}

#[tokio::test]
async fn an_unobserved_warning_and_log_call_complete() {
    let context = environment_context(EnvironmentValues::new());
    context.warn("a warning").await.unwrap();
    context.log.info("a log", ());
}

#[test]
fn the_environment_context_reads_the_mocks_cwd_and_environment() {
    let mock = mock_process(
        MockFields::new()
            .cwd("/loom-test/work")
            .env("REGION", "us-west-2"),
    );
    let context = environment_context(EnvironmentValues::new().process(mock));
    assert_eq!(context.cwd, Path::new("/loom-test/work"));
    assert_eq!(
        context.env.get("REGION").map(String::as_str),
        Some("us-west-2")
    );
}

#[test]
fn the_unstated_cwd_and_environment_have_sealed_defaults() {
    let context = environment_context(EnvironmentValues::new());
    assert_eq!(context.cwd, Path::new("/loom-test"));
    assert!(context.env.is_empty());
}

#[test]
fn a_log_event_uses_fixed_defaults() {
    let event: LogEvent = log_event(LogEventValues::new());
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({
            "application": {"name": "app", "version": "0.0.0"}, "fields": {}, "level": "info",
            "message": "", "path": [], "plugin": null, "run": "00000000000000000000000000000000",
            "time": "2026-01-01T00:00:00.000Z"
        })
    );
}

async fn bad_flag(_ctx: Context) -> Outcome {
    Err(InputError::new("Bad flag.", Vec::new()).into())
}

#[tokio::test]
async fn stated_event_members_replace_the_defaults() {
    let app = Application::new("probe").action(bad_flag);
    let mock = mock_process(MockFields::new());
    let InvocationOutcome::Failed { form, .. } = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock),
        )
        .await
    else {
        panic!("bad_flag fails with a form");
    };
    let event = log_event(
        LogEventValues::new()
            .application("notes", "1.2.0")
            .failure(form.clone())
            .fields(LogFields::new().field("attempt", 2))
            .level(LogLevel::Error)
            .message("Sync failed.")
            .path(["sync"])
            .plugin("@acme/sync")
            .run("other")
            .time("2026-01-02T00:00:00.000Z"),
    );
    assert_eq!(event.failure.as_ref(), Some(&form));
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({
            "application": {"name": "notes", "version": "1.2.0"}, "fields": {"attempt": 2},
            "failure": form, "level": "error", "message": "Sync failed.", "path": ["sync"],
            "plugin": "@acme/sync", "run": "other", "time": "2026-01-02T00:00:00.000Z"
        })
    );
}

#[test]
fn a_hook_can_serialize_the_whole_event() {
    let event = log_event(LogEventValues::new().message("Started."));
    assert_eq!(
        serde_json::to_string(&event).unwrap(),
        concat!(
            r#"{"time":"2026-01-01T00:00:00.000Z","level":"info","message":"Started.","fields":{},"#,
            r#""application":{"name":"app","version":"0.0.0"},"run":"00000000000000000000000000000000","path":[],"plugin":null}"#
        )
    );
}

#[test]
fn an_event_keeps_its_own_nested_data() {
    let mut fields = json!({"nested": {"count": 1}, "tags": ["a"]});
    let event = log_event(
        LogEventValues::new()
            .fields(LogFields::new().field("input", &fields))
            .defect("TypeError", "Boom.", Some("trace".to_owned())),
    );
    fields["nested"]["count"] = json!(2);
    assert_eq!(
        event.fields["input"],
        json!({"nested": {"count": 1}, "tags": ["a"]})
    );
    assert_eq!(fields["nested"]["count"], 2);
    assert_eq!(
        serde_json::to_value(event.defect).unwrap(),
        json!({"name": "TypeError", "message": "Boom.", "stack": "trace"})
    );
}

#[test]
fn a_log_destination_uses_the_mock_facts_and_an_absent_stream() {
    let mut destination: LogDestination = log_destination(LogDestinationValues::new());
    assert!(destination.env.is_empty());
    assert_eq!(destination.home, Path::new("/loom-test/home"));
    assert_eq!(destination.platform, "linux");
    assert!(destination.stderr.is_none());
    destination.warn("Discarded.");
    destination
        .env
        .insert("XDG_STATE_HOME".to_owned(), "/state".to_owned());
    assert!(log_destination(LogDestinationValues::new()).env.is_empty());
}

#[test]
fn a_destination_fixture_captures_warning_text() {
    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let destination = log_destination(LogDestinationValues::new().warn({
        let captured = Arc::clone(&captured);
        move |text| captured.lock().unwrap().push(text.to_owned())
    }));
    destination.warn("Using the declared level.");
    assert_eq!(*captured.lock().unwrap(), ["Using the declared level."]);
}

#[tokio::test]
async fn the_destination_uses_the_stream_a_test_supplied() {
    let mock = mock_process(MockFields::new());
    let stream = mock.stderr();
    let destination = log_destination(LogDestinationValues::new().stderr(stream.clone()));
    let stderr = destination.stderr.unwrap();
    assert!(Arc::ptr_eq(&stream, &stderr));
    let event = log_event(
        LogEventValues::new()
            .level(LogLevel::Error)
            .message("Sync failed."),
    );
    let hook = |event: &LogEvent| {
        (event.level == LogLevel::Error).then(|| format!("error: {}\n", event.message))
    };
    stderr
        .write(hook(&event).unwrap().as_bytes())
        .await
        .unwrap();
    assert_eq!(mock.stderr_text(), "error: Sync failed.\n");
}

#[test]
fn stated_destination_members_replace_the_defaults() {
    let env = Env::from([("XDG_STATE_HOME".to_owned(), "/state".to_owned())]);
    let destination = log_destination(
        LogDestinationValues::new()
            .env(env.clone())
            .home("/home/ada")
            .platform("darwin"),
    );
    assert_eq!(destination.home, Path::new("/home/ada"));
    assert_eq!(destination.env, env);
    assert_eq!(destination.platform, "darwin");
    assert!(destination.stderr.is_none());
}

#[test]
fn a_progress_event_uses_fixed_defaults() {
    let event: ProgressEvent = progress_event(ProgressEventValues::new());
    assert_eq!(
        (
            event.id,
            event.label.as_str(),
            event.state,
            event.completed,
            event.total
        ),
        (1, "", ProgressState::Updated, None, None)
    );
}

#[test]
fn a_progress_observer_reads_the_stated_counts_and_state() {
    let percent = |event: &ProgressEvent| -> Option<f64> {
        (event.state == ProgressState::Ended).then_some(())?;
        Some((event.completed? / event.total? * 100.0).round())
    };
    let counts = ProgressEventValues::new().completed(3.0).total(4.0);
    let ended = progress_event(counts.clone().state(ProgressState::Ended));
    assert_eq!(percent(&ended), Some(75.0));
    assert_eq!(percent(&progress_event(counts)), None);
}

#[test]
fn other_stated_progress_members_replace_the_defaults() {
    let event = progress_event(
        ProgressEventValues::new()
            .id(7)
            .label("Fetching")
            .state(ProgressState::Started),
    );
    assert_eq!(
        (
            event.id,
            event.label.as_str(),
            event.state,
            event.completed,
            event.total
        ),
        (7, "Fetching", ProgressState::Started, None, None)
    );
}

#[test]
fn a_log_line_value_can_be_given_to_a_declared_view() {
    let line = loomcli_testing::log_line(
        loomcli_testing::LogLineValues::new()
            .level(loomcli_core::LogLineLevel::Debug)
            .text("Read the ledger.")
            .field("rows", "12"),
    );
    let context = loomcli_testing::view_context(loomcli_testing::ViewValues::new());
    let marked = loomcli_core::log_line().render(&line, &context).unwrap();
    assert_eq!(context.plain(&marked), "› Read the ledger. rows=12");
    assert_eq!(line.event.application.name, "app");
}

#[test]
fn a_destination_fixture_supplies_a_log_that_can_bind_fields() {
    let heard = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let context =
        loomcli_testing::environment_context(loomcli_testing::EnvironmentValues::new().on_log({
            let heard = heard.clone();
            move |event, _| heard.lock().unwrap().push(event.clone())
        }));
    let destination = loomcli_testing::log_destination(
        loomcli_testing::LogDestinationValues::new().log(context.log),
    );
    destination
        .log
        .with(loomcli_core::LogFields::new().field("path", "/x"))
        .debug("Logging to {path}.", ());
    let seen = heard.lock().unwrap();
    assert_eq!(seen[0].message, "Logging to {path}.");
    assert_eq!(seen[0].fields["path"], "/x");
}
