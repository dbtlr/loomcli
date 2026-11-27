//! The logging file fact and host-aware resolver from `extension-facts.test.ts` and
//! `logging.test.ts`.

#![cfg(feature = "logging-extension")]
#![allow(clippy::unwrap_used)]

use std::path::Path;

use loomcli_core::{DirectoryFacts, Env, LogLevel};
use loomcli_plugins::logging::extension::{
    DeclaredLogFile, LogVariable, LoggingFilesFacts, resolve_logging_files,
};
use serde_json::json;

#[test]
fn the_fact_keeps_every_file_and_both_variable_names() {
    let facts = LoggingFilesFacts::new([
        DeclaredLogFile::new(LogLevel::Debug).file("collector.jsonl"),
        DeclaredLogFile::new(LogLevel::Info),
        DeclaredLogFile::new(LogLevel::Fatal),
    ])
    .file_env(LogVariable::Disabled)
    .level_env(LogVariable::Named("DETAIL".into()));
    let encoded = serde_json::to_value(&facts).unwrap();
    assert_eq!(
        serde_json::to_string(&facts).unwrap(),
        r#"{"fileEnv":false,"files":[{"file":"collector.jsonl","level":"debug"},{"level":"info"},{"level":"fatal"}],"levelEnv":"DETAIL"}"#
    );
    assert_eq!(
        encoded,
        json!({
            "fileEnv": false,
            "files": [
                {"file": "collector.jsonl", "level": "debug"},
                {"level": "info"},
                {"level": "fatal"}
            ],
            "levelEnv": "DETAIL"
        })
    );
    assert_eq!(
        serde_json::from_value::<LoggingFilesFacts>(encoded).unwrap(),
        facts
    );
}

#[test]
fn the_resolver_reports_rejected_values_and_a_missing_home() {
    let facts = LoggingFilesFacts::new([DeclaredLogFile::new(LogLevel::Info)]);
    let env = Env::from([
        ("HEIMDALL_LOG_FILE".into(), "/var/log/heimdall/".into()),
        ("HEIMDALL_LOG_LEVEL".into(), "loud".into()),
    ]);
    let host = DirectoryFacts::new(env, "relative", "linux");
    let resolved = resolve_logging_files(&facts, "heimdall", &host);
    let file = resolved.rejected.file.unwrap();
    let level = resolved.rejected.level.unwrap();
    assert_eq!(file.variable, "HEIMDALL_LOG_FILE");
    assert_eq!(file.value, "/var/log/heimdall/");
    assert_eq!(level.variable, "HEIMDALL_LOG_LEVEL");
    assert_eq!(level.value, "loud");
    assert_eq!(
        resolved.files[0]
            .path
            .as_ref()
            .unwrap_err()
            .variable
            .as_deref(),
        Some("HOME")
    );
}

#[test]
fn an_unresolvable_override_leaves_an_absolute_declared_file_in_effect() {
    let facts = LoggingFilesFacts::new([
        DeclaredLogFile::new(LogLevel::Warn).file("/loom-test/author.jsonl")
    ]);
    for value in ["~/other.jsonl", "other.jsonl"] {
        let env = Env::from([("HEIMDALL_LOG_FILE".into(), value.into())]);
        let host = DirectoryFacts::new(env, "relative", "linux");
        let resolved = resolve_logging_files(&facts, "heimdall", &host);
        assert_eq!(resolved.rejected.file.unwrap().value, value);
        assert_eq!(
            resolved.files[0].path.as_ref().unwrap(),
            Path::new("/loom-test/author.jsonl")
        );
    }
}

#[test]
fn the_resolver_counts_an_empty_or_blank_file_variable_as_unset() {
    let facts = LoggingFilesFacts::new([DeclaredLogFile::new(LogLevel::Info)]);
    for value in ["", "   "] {
        let host = DirectoryFacts::new(
            Env::from([("HEIMDALL_LOG_FILE".into(), value.into())]),
            "/loom-test/home",
            "linux",
        );
        let resolved = resolve_logging_files(&facts, "heimdall", &host);
        assert!(resolved.rejected.file.is_none());
        assert_eq!(
            resolved.files[0].path.as_ref().unwrap(),
            Path::new("/loom-test/home/.local/state/heimdall/heimdall.jsonl")
        );
    }
}

#[test]
fn fatal_can_be_declared_but_is_rejected_as_an_operator_level() {
    let facts = LoggingFilesFacts::new([DeclaredLogFile::new(LogLevel::Fatal)]);
    let host = DirectoryFacts::new(
        Env::from([("HEIMDALL_LOG_LEVEL".into(), "fatal".into())]),
        "/loom-test/home",
        "linux",
    );
    let resolved = resolve_logging_files(&facts, "heimdall", &host);
    assert_eq!(resolved.rejected.level.unwrap().value, "fatal");
    assert_eq!(resolved.files[0].level, LogLevel::Fatal);
}
