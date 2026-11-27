//! Ports the event mapping, independent filtering, and failing emitter in `logging-otel.test.ts`.

#![cfg(feature = "logging")]
#![allow(clippy::panic, clippy::unwrap_used)]

use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use loomcli_core::{
    Application, Build, Command, Context, InternalError, InvocationOutcome, InvocationValues,
    InvokeOptions, LogEvent, LogFields, LogLevel, Plugin, ReleaseFacts,
};
use loomcli_plugins::logging::{OpenTelemetryDestination, OpenTelemetryLogRecord, logging};
use loomcli_testing::{MockFields, mock_process};
use serde_json::json;

#[derive(Default)]
struct Captures {
    events: Arc<Mutex<Vec<LogEvent>>>,
    records: Arc<Mutex<Vec<OpenTelemetryLogRecord>>>,
}

impl Captures {
    fn events(&self) -> Plugin {
        let events = Arc::clone(&self.events);
        Plugin::new("capture").on_log(move |event, _| events.lock().unwrap().push(event.clone()))
    }

    fn records(&self) -> OpenTelemetryDestination {
        let records = Arc::clone(&self.records);
        OpenTelemetryDestination::new(move |record| records.lock().unwrap().push(record))
    }
}

#[tokio::test]
async fn an_otel_destination_emits_the_template_redacted_fields_and_run_facts() {
    let capture = Captures::default();
    let app = Application::new("notes")
        .plugins((
            capture.events(),
            logging().destinations((capture.records(),)),
        ))
        .version("1.2.3")
        .log_redact(&["session.token"])
        .command(Command::new("index").action(|ctx: Context| async move {
            ctx.log.debug("Below the default floor.", ());
            ctx.log.info(
                "Indexed {count} sessions.",
                LogFields::new()
                    .field("count", 3)
                    .field("items", json!([null, {"name": "one"}]))
                    .field("service.name", "field name stays distinct")
                    .field("session", json!({"active": true, "token": "secret"})),
            );
            Ok(())
        }));
    let mock = mock_process(MockFields::new());
    let result = app
        .invoke(
            &["index"],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock),
        )
        .await;
    assert!(matches!(result, InvocationOutcome::Completed { .. }));

    let records = capture.records.lock().unwrap();
    let events = capture.events.lock().unwrap();
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert_eq!(record.body, "Indexed {count} sessions.");
    assert_eq!((record.severity_number, record.severity_text), (9, "info"));
    assert_eq!(
        record.timestamp,
        SystemTime::from(events[1].time.parse::<jiff::Timestamp>().unwrap())
    );
    assert_eq!(
        json!(record.attributes),
        json!({
            "loom.fields": {"count": 3, "items": [null, {"name": "one"}], "service.name": "field name stays distinct",
                            "session": {"active": true, "token": "[Redacted]"}},
            "loom.path": ["index"], "loom.plugin": null, "loom.run": events[1].run,
            "service.name": "notes", "service.version": "1.2.3"
        })
    );
    assert_eq!(events[1].run.len(), 32);
}

#[tokio::test]
async fn an_otel_failure_record_carries_the_form_and_exception_attributes() {
    let capture = Captures::default();
    let app = Application::new("notes")
        .plugins((
            capture.events(),
            logging().destinations((capture.records().level(LogLevel::Error),)),
        ))
        .command(Command::new("fail").action(|_: Context| async {
            Err(std::io::Error::other("The action failed.").into())
        }));
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Development)));
    let result = app
        .invoke(
            &["fail"],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock),
        )
        .await;
    assert!(matches!(result, InvocationOutcome::Failed { .. }));
    let records = capture.records.lock().unwrap();
    let events = capture.events.lock().unwrap();
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert_eq!(
        (record.severity_number, record.severity_text),
        (21, "fatal")
    );
    assert_eq!(record.body, "The action failed.");
    assert_eq!(
        record.timestamp,
        SystemTime::from(events[0].time.parse::<jiff::Timestamp>().unwrap())
    );
    let mut expected = json!({
        "exception.type": std::any::type_name::<std::io::Error>(),
        "exception.message": "The action failed.",
        "loom.failure": {"code": "internal", "exitCode": 1, "hints": [], "message": "The action failed."},
        "loom.fields": {}, "loom.path": ["fail"], "loom.plugin": null,
        "loom.run": events[0].run, "service.name": "notes", "service.version": "0.0.0"
    });
    if let Some(stack) = &events[0].defect.as_ref().unwrap().stack {
        expected["exception.stacktrace"] = json!(stack);
    }
    assert_eq!(json!(record.attributes), expected);
}

#[tokio::test]
async fn otel_destinations_filter_independently_in_declaration_order() {
    let order = Arc::new(Mutex::new(Vec::new()));
    let emitter = |label| {
        let order = Arc::clone(&order);
        OpenTelemetryDestination::new(move |record| {
            order
                .lock()
                .unwrap()
                .push((label, record.severity_number, record.severity_text));
        })
    };
    let app = Application::new("notes")
        .plugins((logging().destinations((
            emitter("all").level(LogLevel::Trace),
            emitter("warn").level(LogLevel::Warn),
        )),))
        .action(|ctx: Context| async move {
            ctx.log.trace("Trace.", ());
            ctx.log.debug("Debug.", ());
            ctx.log.info("Info.", ());
            ctx.log.warn("Warn.", ());
            ctx.log.error("Error.", ());
            Ok(())
        });
    let mock = mock_process(MockFields::new());
    assert!(matches!(
        app.invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock)
        )
        .await,
        InvocationOutcome::Completed { .. }
    ));
    assert_eq!(
        *order.lock().unwrap(),
        [
            ("all", 1, "trace"),
            ("all", 5, "debug"),
            ("all", 9, "info"),
            ("all", 13, "warn"),
            ("warn", 13, "warn"),
            ("all", 17, "error"),
            ("warn", 17, "error")
        ]
    );
}

#[tokio::test]
async fn an_emitter_error_stops_later_destinations_and_follows_the_hook_failure_path() {
    let capture = Captures::default();
    let app = Application::new("notes")
        .plugins((logging().destinations((
            OpenTelemetryDestination::new(|_| {
                Err::<(), _>(std::io::Error::other("The logger broke."))
            }),
            capture.records(),
        )),))
        .action(|ctx: Context| async move {
            ctx.log.info("Before the error.", ());
            Ok(())
        });
    let mock = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Development)));
    let InvocationOutcome::Failed {
        failure, exit_code, ..
    } = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock),
        )
        .await
    else {
        panic!("the emitter error fails the invocation");
    };
    assert_eq!(exit_code.get(), 1);
    let internal = failure.downcast_failure::<InternalError>().unwrap();
    assert_eq!(
        internal.rule().unwrap().identity(),
        "@loomcli/core/foreign-throw"
    );
    assert!(capture.records.lock().unwrap().is_empty());
}
