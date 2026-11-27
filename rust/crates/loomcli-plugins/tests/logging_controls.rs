//! The operator overrides and failure hints from `logging.test.ts`.

#![cfg(feature = "logging")]
#![allow(clippy::panic, clippy::unwrap_used)]

mod logging_support;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Barrier, Mutex};

use logging_support::{Sandbox, logging_application};
use loomcli_core::{
    Application, Command, Context, DirectoryFacts, Env, FatalError, InvocationOutcome,
    InvocationValues, InvokeOptions, LogLevel, Plugin, RunOptions, read_extension,
};
use loomcli_plugins::logging::extension::{LOGGING_FILES, resolve_logging_files};
use loomcli_plugins::logging::{
    ConsoleDestination, FailureHint, FileDestination, LogTarget, LogVariable, LoggingDestination,
    OpenTelemetryDestination, logging,
};
use loomcli_testing::{MockFields, MockProcess, mock_process};
use serde_json::{Value, json};

fn sandbox_mock(sandbox: &Sandbox, argv: &[&str], variables: &[(&str, &str)]) -> Arc<MockProcess> {
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .cwd(sandbox.work.clone())
        .home(sandbox.home.clone())
        .platform("linux")
        .env("HOME", sandbox.home.to_str().unwrap())
        .env("XDG_STATE_HOME", sandbox.state.to_str().unwrap());
    for &(name, value) in variables {
        fields = fields.env(name, value);
    }
    mock_process(fields)
}

fn records(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn levels(path: &Path) -> Vec<String> {
    records(path)
        .into_iter()
        .map(|event| event["level"].as_str().unwrap().to_owned())
        .collect()
}

fn hint(path: &Path, run: &str) -> String {
    format!(
        "Read the log of this run in {} (run {run}).",
        path.display()
    )
}

fn reported_id(stderr: &str) -> &str {
    let start = stderr.find("(run ").unwrap() + "(run ".len();
    let id = stderr[start..].split(')').next().unwrap();
    assert_eq!(id.len(), 32);
    assert!(id.bytes().all(|byte| byte.is_ascii_hexdigit()));
    id
}

#[tokio::test]
async fn the_operator_level_is_applied_before_filtering_and_accepts_case_and_padding() {
    for (value, expected) in [
        ("debug", &["debug", "info", "warn", "error"][..]),
        ("DEBUG", &["debug", "info", "warn", "error"]),
        (" debug ", &["debug", "info", "warn", "error"]),
        ("", &["info", "warn", "error"]),
        ("   ", &["info", "warn", "error"]),
    ] {
        let sandbox = Sandbox::new();
        let mock = sandbox_mock(&sandbox, &["log"], &[("HEIMDALL_LOG_LEVEL", value)]);
        let code = logging_application(logging())
            .run(RunOptions::new().process(mock.clone()))
            .await;
        assert_eq!(code.get(), 0);
        assert_eq!(mock.stderr_text(), "");
        assert_eq!(levels(&sandbox.file), expected);
    }
}

#[tokio::test]
async fn the_file_variable_redirects_only_the_first_file() {
    let sandbox = Sandbox::new();
    let redirected = sandbox.root.join("report.jsonl");
    let second = sandbox.root.join("audit.jsonl");
    let mock = sandbox_mock(
        &sandbox,
        &["log"],
        &[("HEIMDALL_LOG_FILE", redirected.to_str().unwrap())],
    );
    let app = logging_application(logging().destinations([
        FileDestination::new(),
        FileDestination::new().file(second.to_string_lossy()),
    ]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(levels(&redirected), ["info", "warn", "error"]);
    assert_eq!(fs::read(&second).unwrap(), fs::read(&redirected).unwrap());
    assert!(!sandbox.file.exists());
}

#[tokio::test]
async fn an_invalid_level_identifies_the_escaped_value_once_and_uses_the_declared_floor() {
    let sandbox = Sandbox::new();
    let mock = sandbox_mock(
        &sandbox,
        &["log"],
        &[("HEIMDALL_LOG_LEVEL", "verbose\nforged")],
    );
    let app = logging_application(logging().level(LogLevel::Warn));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        "⚠ Cannot use HEIMDALL_LOG_LEVEL=verbose\\u000aforged as a log level. Use trace, debug, info, warn, or error; using the application's log levels for this run.\n"
    );
    assert_eq!(levels(&sandbox.file), ["warn", "error"]);
}

#[tokio::test]
async fn directories_as_file_overrides_warn_and_leave_the_declared_file() {
    for nonexistent in [false, true] {
        let sandbox = Sandbox::new();
        let missing = sandbox.root.join("newdir");
        let value = if nonexistent {
            format!("{}/", missing.display())
        } else {
            sandbox.home.display().to_string()
        };
        let mock = sandbox_mock(&sandbox, &["log"], &[("HEIMDALL_LOG_FILE", &value)]);
        let app = logging_application(logging());
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(
            mock.stderr_text(),
            format!(
                "⚠ Cannot append to the log file {value} named by HEIMDALL_LOG_FILE. Set it to a writable file path; using the application's log file for this run.\n"
            )
        );
        assert_eq!(levels(&sandbox.file), ["info", "warn", "error"]);
        assert!(!missing.exists());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn the_file_variable_accepts_a_writable_device_without_warning_or_fallback() {
    let device = Path::new("/dev/null");
    if !device.exists() {
        return;
    }
    let sandbox = Sandbox::new();
    // The reference writes the null device itself. A sandbox symlink lets this test exercise
    // the nonregular-file path even if the writer tries to rename its destination.
    let path = sandbox.root.join("null");
    std::os::unix::fs::symlink(device, &path).unwrap();
    let mock = sandbox_mock(
        &sandbox,
        &["log"],
        &[("HEIMDALL_LOG_FILE", path.to_str().unwrap())],
    );
    let app = logging_application(logging().max_bytes(1));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "");
    assert!(fs::symlink_metadata(path).unwrap().file_type().is_symlink());
    assert!(!sandbox.file.exists());
}

#[tokio::test]
async fn authors_can_rename_or_disable_both_variables() {
    let sandbox = Sandbox::new();
    let path = sandbox.root.join("named.jsonl");
    let variables = [
        ("DETAIL", "debug"),
        ("RECORD", path.to_str().unwrap()),
        ("HEIMDALL_LOG_LEVEL", "trace"),
        ("HEIMDALL_LOG_FILE", sandbox.work.to_str().unwrap()),
    ];
    let named = logging_application(
        logging()
            .level_env(LogVariable::Named("DETAIL".into()))
            .file_env(LogVariable::Named("RECORD".into())),
    );
    let mock = sandbox_mock(&sandbox, &["log"], &variables);
    assert_eq!(
        named
            .run(RunOptions::new().process(mock.clone()))
            .await
            .get(),
        0
    );
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(levels(&path), ["debug", "info", "warn", "error"]);
    let disabled = logging_application(
        logging()
            .level_env(LogVariable::Disabled)
            .file_env(LogVariable::Disabled),
    );
    let mock = sandbox_mock(&sandbox, &["log"], &variables);
    assert_eq!(
        disabled
            .run(RunOptions::new().process(mock.clone()))
            .await
            .get(),
        0
    );
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(levels(&sandbox.file), ["info", "warn", "error"]);
}

#[tokio::test]
async fn runtime_failures_name_this_run_and_its_successfully_appended_file() {
    let sandbox = Sandbox::new();
    let mock = sandbox_mock(&sandbox, &["fail"], &[]);
    let app = logging_application(logging());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        1
    );
    let records = records(&sandbox.file);
    assert_eq!(records.len(), 2);
    let run = records[0]["run"].as_str().unwrap();
    assert_eq!(records[1]["run"], run);
    assert_eq!(records[1]["failure"]["hints"], json!([]));
    assert_eq!(
        mock.stderr_text(),
        format!("The run failed.\n{}\n", hint(&sandbox.file, run))
    );
}

#[tokio::test]
async fn hint_modes_select_runtime_failures_and_defects() {
    for (mode, runtime_hint, defect_hint) in [
        (FailureHint::Runtime, true, true),
        (FailureHint::Always, true, true),
        (FailureHint::Defects, false, true),
        (FailureHint::Disabled, false, false),
    ] {
        let sandbox = Sandbox::new();
        let app = logging_application(logging().failure_hint(mode));
        for (command, expected) in [("fail", runtime_hint), ("defect", defect_hint)] {
            let mock = sandbox_mock(&sandbox, &[command], &[]);
            assert_eq!(
                app.run(RunOptions::new().process(mock.clone())).await.get(),
                1
            );
            assert_eq!(
                mock.stderr_text().contains("Read the log of this run"),
                expected,
                "{mode:?} {command}"
            );
        }
    }
}

#[tokio::test]
async fn usage_and_console_only_failures_show_no_default_file_hint() {
    let sandbox = Sandbox::new();
    let mock = sandbox_mock(&sandbox, &["missing"], &[]);
    assert_eq!(
        logging_application(logging())
            .run(RunOptions::new().process(mock.clone()))
            .await
            .get(),
        2
    );
    assert!(!mock.stderr_text().contains("Read the log of this run"));
    let mock = sandbox_mock(&sandbox, &["fail"], &[]);
    let app = logging_application(logging().target(LogTarget::Stderr));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        1
    );
    assert!(!mock.stderr_text().contains("Read the log of this run"));
}

#[tokio::test]
async fn always_hints_for_a_usage_failure_whose_event_is_the_first_append() {
    let sandbox = Sandbox::new();
    let mock = sandbox_mock(&sandbox, &["missing"], &[]);
    let app = logging_application(logging().failure_hint(FailureHint::Always));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        2
    );
    let records = records(&sandbox.file);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["failure"]["code"], "unknown-command");
    let run = records[0]["run"].as_str().unwrap();
    assert!(mock.stderr_text().contains(&hint(&sandbox.file, run)));
}

#[test]
fn inspect_publishes_the_file_fact_at_the_root_and_the_resolver_applies_the_host() {
    let sandbox = Sandbox::new();
    let app = logging_application(
        logging()
            .file_env(LogVariable::Named("RECORD".into()))
            .destinations((
                FileDestination::new(),
                ConsoleDestination::new(),
                FileDestination::new()
                    .file("audit.jsonl")
                    .level(LogLevel::Warn),
            )),
    );
    let graph = app.inspect().unwrap();
    let facts = read_extension(&graph.root, &LOGGING_FILES)
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(&facts).unwrap(),
        json!({
            "fileEnv": "RECORD",
            "files": [{"level": "info"}, {"file": "audit.jsonl", "level": "warn"}]
        })
    );
    assert!(
        read_extension(&graph.root.children[0], &LOGGING_FILES)
            .unwrap()
            .is_none()
    );
    let audit = sandbox.directory().join("audit.jsonl");
    let mut env = Env::from([("XDG_STATE_HOME".into(), sandbox.state.display().to_string())]);
    let host = DirectoryFacts::new(env.clone(), &sandbox.home, "linux");
    let resolved = resolve_logging_files(&facts, "heimdall", &host);
    assert_eq!(resolved.files[0].level, LogLevel::Info);
    assert_eq!(resolved.files[0].path.as_ref().unwrap(), &sandbox.file);
    assert_eq!(resolved.files[1].level, LogLevel::Warn);
    assert_eq!(resolved.files[1].path.as_ref().unwrap(), &audit);
    assert!(resolved.rejected.file.is_none() && resolved.rejected.level.is_none());

    let redirected = sandbox.root.join("report.jsonl");
    env.insert("HEIMDALL_LOG_LEVEL".into(), "debug".into());
    env.insert("RECORD".into(), redirected.display().to_string());
    let host = DirectoryFacts::new(env, &sandbox.home, "linux");
    let resolved = resolve_logging_files(&facts, "heimdall", &host);
    assert_eq!(resolved.files[0].level, LogLevel::Debug);
    assert_eq!(resolved.files[0].path.as_ref().unwrap(), &redirected);
    assert_eq!(resolved.files[1].level, LogLevel::Debug);
    assert_eq!(resolved.files[1].path.as_ref().unwrap(), &audit);
    assert!(!redirected.exists());
    assert!(!sandbox.directory().exists());
}

#[test]
fn console_only_publishes_an_empty_file_fact_and_reads_neither_override() {
    let app = logging_application(logging().target(LogTarget::Stderr));
    let graph = app.inspect().unwrap();
    let facts = read_extension(&graph.root, &LOGGING_FILES)
        .unwrap()
        .unwrap();
    assert_eq!(serde_json::to_value(&facts).unwrap(), json!({"files": []}));
    let host = DirectoryFacts::new(
        Env::from([
            ("HEIMDALL_LOG_LEVEL".into(), "loud".into()),
            ("HEIMDALL_LOG_FILE".into(), "/".into()),
        ]),
        "/loom-test/home",
        "linux",
    );
    let resolved = resolve_logging_files(&facts, "heimdall", &host);
    assert!(resolved.files.is_empty());
    assert!(resolved.rejected.file.is_none() && resolved.rejected.level.is_none());
}

#[cfg(feature = "config")]
#[tokio::test]
async fn the_environment_override_reaches_configuration_source_debug_records() {
    use loomcli_core::Opt;
    use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
    use loomcli_plugins::config::{ConfigurationSettings, configuration};

    let sandbox = Sandbox::new();
    // The configuration source already logs rejected fills at Debug before input resolution.
    fs::write(sandbox.work.join(".heimdall.json"), r#"{"value":[true]}"#).unwrap();
    let config = configuration(ConfigurationSettings::<Value>::new(None));
    let app = Application::new("heimdall")
        .plugins((config.plugin, logging()))
        .option(
            "value",
            Opt::string().extend([CONFIG_INPUT.value(ConfigInputFacts::path("value"))]),
        )
        .action(|ctx: Context| async move {
            assert_eq!(ctx.option::<Option<String>>("value")?, None);
            Ok(())
        });
    let mock = sandbox_mock(&sandbox, &[], &[("HEIMDALL_LOG_LEVEL", "debug")]);
    assert_eq!(app.run(RunOptions::new().process(mock)).await.get(), 0);
    assert!(records(&sandbox.file).iter().any(|record| {
        record["plugin"] == "@loomcli/plugins/config" && record["level"] == "debug"
    }));
}

#[tokio::test]
async fn variable_names_uppercase_and_replace_punctuation() {
    let sandbox = Sandbox::new();
    let path = sandbox.root.join("report.jsonl");
    let app = Application::new("my-tool")
        .plugins((logging(),))
        .action(|ctx: Context| async move {
            ctx.log.debug("Detail.", ());
            Ok(())
        });
    let mock = sandbox_mock(
        &sandbox,
        &[],
        &[
            ("MY_TOOL_LOG_FILE", path.to_str().unwrap()),
            ("MY_TOOL_LOG_LEVEL", "debug"),
        ],
    );
    assert_eq!(app.run(RunOptions::new().process(mock)).await.get(), 0);
    assert_eq!(records(&path)[0]["message"], "Detail.");
}

#[test]
fn concurrent_runs_on_one_application_name_only_their_own_failure_record() {
    let sandbox = Sandbox::new();
    let barrier = Arc::new(Barrier::new(2));
    let synchronise = Plugin::new("fixture/synchronise").on_failure(move |_, _| {
        barrier.wait();
    });
    let app = Application::new("heimdall")
        .plugins((synchronise, logging()))
        .action(|ctx: Context| async move {
            ctx.log.info("Before failure.", ());
            Err(FatalError::new("Failed.").into())
        });
    let first_file = sandbox.root.join("first.jsonl");
    let second_file = sandbox.root.join("second.jsonl");
    let first = sandbox_mock(
        &sandbox,
        &[],
        &[("HEIMDALL_LOG_FILE", first_file.to_str().unwrap())],
    );
    let second = sandbox_mock(
        &sandbox,
        &[],
        &[("HEIMDALL_LOG_FILE", second_file.to_str().unwrap())],
    );
    let run = |mock: &Arc<MockProcess>| {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(async { app.run(RunOptions::new().process(mock.clone())).await })
    };
    std::thread::scope(|scope| {
        let first = scope.spawn(|| run(&first));
        let second = scope.spawn(|| run(&second));
        assert_eq!(first.join().unwrap().get(), 1);
        assert_eq!(second.join().unwrap().get(), 1);
    });
    let first_stderr = first.stderr_text();
    let second_stderr = second.stderr_text();
    let first_id = reported_id(&first_stderr);
    let second_id = reported_id(&second_stderr);
    assert_ne!(first_id, second_id);
    assert_eq!(records(&first_file)[1]["run"], first_id);
    assert_eq!(records(&second_file)[1]["run"], second_id);
    assert_eq!(
        first_stderr,
        format!("Failed.\n{}\n", hint(&first_file, first_id))
    );
    assert_eq!(
        second_stderr,
        format!("Failed.\n{}\n", hint(&second_file, second_id))
    );
}

#[tokio::test]
async fn a_nested_invocation_failure_names_its_own_record_in_the_outer_file() {
    let sandbox = Sandbox::new();
    let hints = Arc::new(Mutex::new(Vec::new()));
    let app = Application::new("heimdall")
        .plugins((logging(),))
        .command(
            Command::new("inner")
                .action(|_: Context| async { Err(FatalError::new("Failed inside.").into()) }),
        )
        .action({
            let hints = Arc::clone(&hints);
            move |ctx: Context| {
                let hints = Arc::clone(&hints);
                async move {
                    ctx.log.info("Outer.", ());
                    let InvocationOutcome::Failed { form, messages, .. } = ctx
                        .invoke(&["inner"], InvocationValues::new(), InvokeOptions::new())
                        .await
                    else {
                        panic!("the inner call fails");
                    };
                    assert!(messages.contains("Failed inside."));
                    *hints.lock().unwrap() = form.hints;
                    Ok(())
                }
            }
        });
    let mock = sandbox_mock(&sandbox, &[], &[]);
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "");
    let records = records(&sandbox.file);
    assert_eq!(records.len(), 2);
    assert_ne!(records[0]["run"], records[1]["run"]);
    let run = records[1]["run"].as_str().unwrap();
    assert_eq!(*hints.lock().unwrap(), [hint(&sandbox.file, run)]);
}

#[tokio::test]
async fn a_rejected_level_warns_even_when_the_only_event_is_filtered_out() {
    let sandbox = Sandbox::new();
    let app =
        Application::new("heimdall")
            .plugins((logging(),))
            .action(|ctx: Context| async move {
                ctx.log.debug("Detail.", ());
                Ok(())
            });
    let mock = sandbox_mock(&sandbox, &[], &[("HEIMDALL_LOG_LEVEL", "verbose")]);
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        "⚠ Cannot use HEIMDALL_LOG_LEVEL=verbose as a log level. Use trace, debug, info, warn, or error; using the application's log levels for this run.\n"
    );
    assert!(!sandbox.file.exists());
}

#[tokio::test]
async fn overrides_change_only_files_beside_ordered_otel_and_console_entries() {
    let sandbox = Sandbox::new();
    let redirected = sandbox.root.join("operator.jsonl");
    let second = sandbox.root.join("second.jsonl");
    let emission = Arc::new(Mutex::new(Vec::new()));
    let app = Application::new("heimdall")
        .plugins((logging().destinations((
            FileDestination::new().level(LogLevel::Error),
            OpenTelemetryDestination::new({
                let redirected = redirected.clone();
                let second = second.clone();
                let emission = Arc::clone(&emission);
                move |record| {
                    assert!(
                        fs::read_to_string(&redirected)
                            .unwrap()
                            .contains(&record.body)
                    );
                    assert!(!fs::read_to_string(&second).unwrap().contains(&record.body));
                    emission.lock().unwrap().push(record.body);
                }
            })
            .level(LogLevel::Info),
            ConsoleDestination::new().level(LogLevel::Error),
            FileDestination::new()
                .file(second.to_string_lossy())
                .level(LogLevel::Error),
        )),))
        .action(|ctx: Context| async move {
            ctx.log.debug("Detail.", ());
            ctx.log.info("Ready.", ());
            Ok(())
        });
    let graph = app.inspect().unwrap();
    let facts = read_extension(&graph.root, &LOGGING_FILES)
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(facts).unwrap(),
        json!({
            "files": [{"level": "error"}, {"file": second, "level": "error"}]
        })
    );
    let mock = sandbox_mock(
        &sandbox,
        &[],
        &[
            ("HEIMDALL_LOG_LEVEL", "debug"),
            ("HEIMDALL_LOG_FILE", redirected.to_str().unwrap()),
        ],
    );
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(*emission.lock().unwrap(), ["Ready."]);
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(levels(&redirected), ["debug", "info"]);
    assert_eq!(fs::read(&second).unwrap(), fs::read(&redirected).unwrap());
    assert!(!sandbox.file.exists());
}

#[tokio::test]
async fn a_hint_names_successful_paths_once_in_order_and_escapes_the_path() {
    let sandbox = Sandbox::new();
    let first = sandbox.root.join("first\nlog.jsonl");
    let second = sandbox.root.join("second.jsonl");
    let blocked = sandbox.root.join("blocked");
    fs::write(&blocked, "").unwrap();
    let destination = |path: &Path| FileDestination::new().file(path.to_string_lossy());
    let app = logging_application(logging().destinations([
        destination(&first),
        destination(&blocked.join("missing.jsonl")),
        destination(&second),
        destination(&first),
    ]));
    let mock = sandbox_mock(&sandbox, &["fail"], &[]);
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        1
    );
    let stderr = mock.stderr_text();
    let run = reported_id(&stderr);
    let escaped_first = first.display().to_string().replace('\n', "\\u000a");
    assert_eq!(
        stderr,
        format!(
            "The run failed.\nRead the log of this run in {escaped_first} (run {run}).\n{}\n",
            hint(&second, run)
        )
    );
}

#[tokio::test]
async fn a_later_failure_never_uses_the_paths_of_an_interrupted_report() {
    let sandbox = Sandbox::new();
    let path = sandbox.root.join("file.jsonl");
    let interrupt = Plugin::new("fixture/interrupt").on_failure({
        let path = path.clone();
        move |failure, _| {
            if failure.is::<FatalError>() {
                fs::remove_file(&path)?;
                fs::create_dir(&path)?;
                return Err(std::io::Error::other("The first failure hook stopped."));
            }
            Ok(())
        }
    });
    let later = Arc::new(Mutex::new(0));
    let make_second_report = Plugin::new("fixture/second")
        .on_log(|event, _| {
            if event
                .failure
                .as_ref()
                .is_some_and(|form| form.code == "fatal")
            {
                return Err(std::io::Error::other("The log hook failed."));
            }
            Ok(())
        })
        .on_failure({
            let later = Arc::clone(&later);
            move |_, _| *later.lock().unwrap() += 1
        });
    let app = Application::new("heimdall")
        .plugins((
            interrupt,
            logging().file(path.to_string_lossy()),
            make_second_report,
        ))
        .action(|_: Context| async { Err(FatalError::new("Failed.").into()) });
    let mock = sandbox_mock(&sandbox, &[], &[]);
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        1
    );
    assert_eq!(*later.lock().unwrap(), 1);
    assert!(!mock.stderr_text().contains("Read the log of this run"));
}

#[tokio::test]
async fn an_empty_destination_list_records_nothing_and_reads_no_variables() {
    let sandbox = Sandbox::new();
    let app = logging_application(logging().destinations(Vec::<LoggingDestination>::new()));
    let mock = sandbox_mock(&sandbox, &["log"], &[("HEIMDALL_LOG_LEVEL", "loud")]);
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert!(!sandbox.directory().exists());
    assert_eq!(mock.stderr_text(), "");
}

fn bad_file(value: &str) -> String {
    format!(
        "⚠ Cannot append to the log file {value} named by HEIMDALL_LOG_FILE. Set it to a writable file path; using the application's log file for this run.\n"
    )
}

#[cfg(unix)]
#[tokio::test]
async fn a_file_variable_naming_a_file_the_process_cannot_append_to_warns_and_keeps_the_declared_file()
 {
    use std::os::unix::fs::PermissionsExt;
    if !logging_support::unprivileged() {
        return;
    }
    let sandbox = Sandbox::new();
    let locked = sandbox.root.join("locked.jsonl");
    fs::write(&locked, "").unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o444)).unwrap();
    let value = locked.to_str().unwrap();
    let mock = sandbox_mock(&sandbox, &["log"], &[("HEIMDALL_LOG_FILE", value)]);
    let code = logging_application(logging())
        .run(RunOptions::new().process(mock.clone()))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(mock.stderr_text(), bad_file(value));
    assert_eq!(levels(&sandbox.file), ["info", "warn", "error"]);
    assert_eq!(fs::read_to_string(&locked).unwrap(), "");
}

#[cfg(unix)]
#[tokio::test]
async fn a_file_variable_naming_a_missing_file_under_a_read_only_directory_warns() {
    use std::os::unix::fs::PermissionsExt;
    if !logging_support::unprivileged() {
        return;
    }
    let sandbox = Sandbox::new();
    let directory = sandbox.root.join("ro");
    logging_support::read_only(&directory);
    let target = directory.join("sub").join("x.jsonl");
    let value = target.to_str().unwrap();
    let mock = sandbox_mock(&sandbox, &["log"], &[("HEIMDALL_LOG_FILE", value)]);
    let code = logging_application(logging())
        .run(RunOptions::new().process(mock.clone()))
        .await;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(code.get(), 0);
    assert_eq!(mock.stderr_text(), bad_file(value));
    assert_eq!(levels(&sandbox.file), ["info", "warn", "error"]);
}

#[tokio::test]
async fn two_rejected_variables_warn_about_the_level_before_the_file() {
    let sandbox = Sandbox::new();
    let value = format!("{}/", sandbox.root.display());
    let mock = sandbox_mock(
        &sandbox,
        &["log"],
        &[
            ("HEIMDALL_LOG_LEVEL", "verbose"),
            ("HEIMDALL_LOG_FILE", &value),
        ],
    );
    let code = logging_application(logging())
        .run(RunOptions::new().process(mock.clone()))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        mock.stderr_text(),
        format!(
            "⚠ Cannot use HEIMDALL_LOG_LEVEL=verbose as a log level. Use trace, debug, info, warn, or error; using the application's log levels for this run.\n{}",
            bad_file(&value)
        )
    );
}

#[tokio::test]
async fn a_rejected_level_is_repeated_as_the_variable_holds_it_with_its_padding() {
    let sandbox = Sandbox::new();
    let mock = sandbox_mock(&sandbox, &["log"], &[("HEIMDALL_LOG_LEVEL", " loud\n")]);
    let code = logging_application(logging())
        .run(RunOptions::new().process(mock.clone()))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        mock.stderr_text(),
        "⚠ Cannot use HEIMDALL_LOG_LEVEL= loud\\u000a as a log level. Use trace, debug, info, warn, or error; using the application's log levels for this run.\n"
    );
}
