//! The self-update Command's exact verbose lines and structured change events.

#![cfg(all(feature = "self-update", feature = "verbose"))]
#![allow(clippy::unwrap_used)]

mod self_update_support;

use std::fs;
use std::sync::{Arc, Mutex};

use loomcli_core::{LogEvent, LogFields, LogLevel, RunOptions};
use self_update_support::*;
use serde_json::{Value, json};

const GITHUB: &str = "https://github.com/acme/notes";
const VERIFIED: &str = "› Verified notes-linux-x64 against SHA256SUMS.\n";
const RESOLVED: &str = "› Resolved v1.5.0 on the stable channel.\n";

fn fixture(version: &str) -> Fixture {
    let mut github = default_github();
    github.feed = ["v1.6.0-next.2", "v1.6.0-next.1", "v1.5.0"]
        .map(str::to_owned)
        .to_vec();
    let (tag, release) = github_release("1.6.0-next.1");
    github.releases.insert(tag, release);
    Fixture {
        github,
        rules: Vec::new(),
        hook: Hook::None,
        notices: Some(false),
        notice_env: None,
        help: None,
        restyle: false,
        version: version.to_owned(),
        records: Records::default(),
        controller: Default::default(),
        locked: None,
        after_replace: None,
        verbose: true,
    }
}

async fn run(sandbox: &Sandbox, argv: &[&str], fixture: &Fixture) -> (String, Vec<LogEvent>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let app = loomcli_core::__private::install_log_hook(fixture.application("run"), {
        let events = Arc::clone(&events);
        move |event, _| events.lock().unwrap().push(event.clone())
    });
    let mock = mock_for(
        &RunFacts {
            argv: argv.iter().map(|arg| (*arg).to_owned()).collect(),
            env: vec![
                (
                    "XDG_CACHE_HOME".to_owned(),
                    sandbox.cache_home.to_string_lossy().into_owned(),
                ),
                (
                    "XDG_STATE_HOME".to_owned(),
                    sandbox.state.to_string_lossy().into_owned(),
                ),
            ],
            home: sandbox.home.clone(),
            cwd: Some(sandbox.root.clone()),
            release: script_facts(sandbox, &fixture.version, OLD_BYTES),
            program: None,
            tty: None,
        },
        |fields| fields,
    );
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0,
        "{}",
        mock.stderr_text()
    );
    let events = events.lock().unwrap().clone();
    (mock.stderr_text(), events)
}

fn downloading(to: &str) -> String {
    format!("ℹ Downloading {ASSET} from v{to} of acme/notes.\n")
}

fn updated(from: &str, to: &str) -> String {
    format!("✔ Updated notes from {from} to {to}.\n")
}

fn changed(box_: &Sandbox, from: &str, to: &str) -> String {
    format!(
        "› Binary replaced. from={from} path={} to={to}\n› File written. path={}\n",
        box_.binary.display(),
        box_.record.display(),
    )
}

fn requested(url: &str) -> String {
    format!("  ┆ Requested {url}.\n")
}

fn asset_requests(version: &str, asset: &str) -> String {
    requested(&format!("{GITHUB}/releases/download/v{version}/{asset}"))
        + &requested(&format!("{ASSET_HOST}/v{version}/{asset}"))
}

fn stable_trace(box_: &Sandbox) -> String {
    requested(&format!("{GITHUB}/releases/latest"))
        + RESOLVED
        + &asset_requests("1.5.0", "SHA256SUMS")
        + &downloading("1.5.0")
        + &asset_requests("1.5.0", ASSET)
        + VERIFIED
        + &changed(box_, "1.4.2", "1.5.0")
        + &updated("1.4.2", "1.5.0")
}

fn change_events(events: &[LogEvent]) -> Vec<(&str, Value)> {
    events
        .iter()
        .filter(|event| event.level == LogLevel::Info)
        .map(|event| {
            assert_eq!(
                event.plugin.as_deref(),
                Some("@loomcli/plugins/self-update")
            );
            (event.message.as_str(), Value::Object(event.fields.clone()))
        })
        .collect()
}

#[tokio::test]
async fn default_verbosity_writes_the_existing_command_lines() {
    let sandbox = sandbox_with(OLD_BYTES);
    assert_eq!(
        run(&sandbox, &["self-update"], &fixture("1.4.2")).await.0,
        downloading("1.5.0") + &updated("1.4.2", "1.5.0"),
    );
}

#[tokio::test]
async fn verbose_names_the_release_verification_and_changes() {
    let sandbox = sandbox_with(OLD_BYTES);
    assert_eq!(
        run(&sandbox, &["-v", "self-update"], &fixture("1.4.2"))
            .await
            .0,
        RESOLVED.to_owned()
            + &downloading("1.5.0")
            + VERIFIED
            + &changed(&sandbox, "1.4.2", "1.5.0")
            + &updated("1.4.2", "1.5.0"),
    );
}

#[tokio::test]
async fn a_named_version_and_check_add_no_resolution_line() {
    let named = sandbox_with(OLD_BYTES);
    assert_eq!(
        run(&named, &["-v", "self-update", "1.4.0"], &fixture("1.4.2"))
            .await
            .0,
        downloading("1.4.0")
            + VERIFIED
            + &changed(&named, "1.4.2", "1.4.0")
            + &updated("1.4.2", "1.4.0"),
    );
    let checked = sandbox_with(OLD_BYTES);
    assert_eq!(
        run(
            &checked,
            &["-v", "self-update", "--check"],
            &fixture("1.4.2")
        )
        .await
        .0,
        "✔ notes can update from 1.4.2 to 1.5.0 on the stable channel.\n",
    );
}

#[tokio::test]
async fn trace_names_requests_including_redirects_in_order() {
    let sandbox = sandbox_with(OLD_BYTES);
    assert_eq!(
        run(&sandbox, &["-vv", "self-update"], &fixture("1.4.2"))
            .await
            .0,
        stable_trace(&sandbox)
    );
}

#[tokio::test]
async fn a_signed_redirect_logs_only_its_scheme_host_and_path() {
    let sandbox = sandbox_with(OLD_BYTES);
    let mut fixture = fixture("1.4.2");
    fixture
        .rules
        .push((format!("releases/download/v1.5.0/{ASSET}"), Rule::Signed));
    let (stderr, events) = run(&sandbox, &["-vv", "self-update"], &fixture).await;
    assert_eq!(stderr, stable_trace(&sandbox));
    let transport = fixture.records.requests();
    assert!(
        transport
            .iter()
            .any(|url| url.contains("user:pass@") && url.contains("token=def"))
    );
    let records = serde_json::to_string(&events).unwrap();
    for secret in ["user:pass@", "X-Amz-Signature", "token=def", "#frag"] {
        assert!(!records.contains(secret));
    }
}

#[tokio::test]
async fn a_prerelease_channel_requests_each_candidates_sums_before_resolution() {
    let sandbox = sandbox_with(OLD_BYTES);
    let from = "1.6.0-next.0";
    let to = "1.6.0-next.1";
    assert_eq!(
        run(
            &sandbox,
            &["-vv", "self-update", "--channel", "next"],
            &fixture(from)
        )
        .await
        .0,
        requested(&format!("{GITHUB}/releases.atom"))
            + &requested(&format!(
                "{GITHUB}/releases/download/v1.6.0-next.2/SHA256SUMS"
            ))
            + &asset_requests(to, "SHA256SUMS")
            + "› Resolved v1.6.0-next.1 on the next channel.\n"
            + &downloading(to)
            + &asset_requests(to, ASSET)
            + VERIFIED
            + &changed(&sandbox, from, to)
            + &updated(from, to),
    );
}

#[tokio::test]
async fn a_replacement_records_staging_removals_the_binary_and_the_record() {
    let sandbox = sandbox_with(OLD_BYTES);
    let binary_staging = sandbox
        .binary
        .with_file_name(".notes.0123456789abcdef.loom-staging");
    let record_staging = sandbox
        .record
        .with_file_name(".install.json.fedcba9876543210.loom-staging");
    fs::write(&binary_staging, "partial").unwrap();
    fs::write(&record_staging, "partial").unwrap();
    let (_, events) = run(&sandbox, &["self-update"], &fixture("1.4.2")).await;
    assert_eq!(
        change_events(&events),
        [
            ("File removed.", json!({"path": binary_staging})),
            (
                "Binary replaced.",
                json!({"from": "1.4.2", "path": sandbox.binary, "to": "1.5.0"})
            ),
            ("File removed.", json!({"path": record_staging})),
            ("File written.", json!({"path": sandbox.record})),
        ]
    );
}

#[tokio::test]
async fn refresh_notice_traces_its_request_and_records_its_cache_write() {
    let sandbox = sandbox_with(OLD_BYTES);
    let (stderr, events) = run(
        &sandbox,
        &["-vv", "self-update", "--refresh-notice"],
        &fixture("1.4.2"),
    )
    .await;
    assert_eq!(
        stderr,
        requested(&format!("{GITHUB}/releases/latest"))
            + &format!("› File written. path={}\n", sandbox.file.display())
    );
    assert_eq!(
        change_events(&events),
        [("File written.", json!({"path": sandbox.file}))]
    );
}

#[tokio::test]
async fn the_after_replace_hook_receives_the_application_name_and_action_log() {
    let sandbox = sandbox_with(OLD_BYTES);
    let mut fixture = fixture("1.4.2");
    fixture.after_replace = Some(Arc::new(|context| {
        Box::pin(async move {
            assert_eq!(context.refresh().name, Some("notes"));
            context.log.debug(
                "The hook ran for {name}.",
                LogFields::new().field("name", &context.name),
            );
            Ok(())
        })
    }));
    let (stderr, events) = run(&sandbox, &["-v", "self-update"], &fixture).await;
    assert_eq!(
        stderr,
        RESOLVED.to_owned()
            + &downloading("1.5.0")
            + VERIFIED
            + &changed(&sandbox, "1.4.2", "1.5.0")
            + &updated("1.4.2", "1.5.0")
            + "› The hook ran for notes.\n"
    );
    assert_eq!(
        events.last().unwrap().plugin.as_deref(),
        Some("@loomcli/plugins/self-update")
    );
}
