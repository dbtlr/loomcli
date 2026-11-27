//! The notice middleware's exact lines and event fields, with a fixed cache clock.

#![allow(clippy::unwrap_used)]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Activation, Application, Build, Child, Command, Context, Env, ExitCode, FatalError,
    InputStream, Installation, Libc, LogEvent, LogLevel, OutputStream, Plugin, ProcessHandle,
    ProcessTerminal, Release, ReleaseFacts, RunOptions, SignalSource, SpawnRequest,
};
use loomcli_testing::{
    MockFields, MockProcess, MockTerminal, ProgramAnswer, StreamName, mock_process,
};

use super::notice_middleware;
use crate::verbose::verbose;

const ADDED: &str = "✔ Added note 12.\n";
const NOTICE: &str = "ℹ notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.\n";
const NOW: i64 = 1_787_054_400_000;
const HOUR: i64 = 3_600_000;

struct Sandbox {
    root: PathBuf,
    file: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.scratch/notice-lines")
            .join(format!(
                "{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed),
            ));
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let file = root.join("notes/update.json");
        Self { root, file }
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn cache_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn cache_line(hours: i64, channel: &str) -> String {
    let checked = super::super::cache::iso_time(NOW - hours * HOUR).unwrap();
    format!(
        r#"{{"format":1,"checked":"{checked}","repository":"acme/notes","channel":"{channel}","latest":"1.5.1"}}"#
    )
}

fn release(method: Option<&str>) -> ReleaseFacts {
    let facts = ReleaseFacts::new(Build::Distributed)
        .release(Release::new("1.5.0", "acme/notes").asset("notes-linux-x64"));
    match method {
        Some(method) => facts.installation(Installation::new(
            method,
            "/fixture/notes",
            "sha256:fixture",
        )),
        None => facts,
    }
}

fn fields(box_: &Sandbox, argv: &[&str]) -> MockFields {
    MockFields::new()
        .argv(argv.iter().copied())
        .cwd(&box_.root)
        .home(&box_.root)
        .platform("linux")
        .env("XDG_CACHE_HOME", box_.root.to_str().unwrap())
        .env("NO_COLOR", "1")
        .terminal(MockTerminal::new(400, 24))
        .program(["notice-refresh"])
        .release(release(Some("script")))
        .script("notice-refresh", |_| async { Ok(ProgramAnswer::new()) })
}

struct Ran {
    code: u8,
    stderr: String,
    events: Vec<LogEvent>,
}

async fn run(fields: MockFields, unstarted: bool) -> Ran {
    let mock = mock_process(fields);
    let handle: Arc<dyn ProcessHandle> = if unstarted {
        Arc::new(NoChild(Arc::clone(&mock)))
    } else {
        mock.clone()
    };
    let events = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/observer").on_log({
        let events = Arc::clone(&events);
        move |event, _| events.lock().unwrap().push(event.clone())
    });
    let notices = Plugin::new("@loomcli/plugins/self-update").middleware(
        Activation::Always,
        notice_middleware(Some("NOTES_NO_UPDATE_NOTICE".to_owned()), || NOW),
    );
    let app = Application::new("notes")
        .plugins((notices, verbose(), observer))
        .command(
            Command::new("add")
                .action(|ctx: Context| async move { ctx.out.success("Added note 12.").await }),
        )
        .command(Command::new("fail").action(|_: Context| async {
            Err(FatalError::new("The note could not be added.").into())
        }))
        .command(Command::new("self-update").action(|_: Context| async { Ok(()) }));
    let code = app.run(RunOptions::new().process(handle)).await.get();
    let events = events.lock().unwrap().clone();
    Ran {
        code,
        stderr: mock.stderr_text(),
        events,
    }
}

async fn stderr(box_: &Sandbox, argv: &[&str]) -> String {
    let ran = run(fields(box_, argv), false).await;
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    ran.stderr
}

fn read(path: &Path) -> String {
    format!("› Read the update check from {}.\n", path.display())
}

fn written(path: &Path) -> String {
    format!("› File written. path={}\n", path.display())
}

fn refreshed(path: &Path) -> String {
    written(path) + "› Started a refresh of the update check.\n"
}

fn trace(text: &str) -> String {
    format!("  \x1b[2m┆\x1b[22m \x1b[2m{text}\x1b[22m\n")
}

fn skipped(reason: &str) -> String {
    trace(&format!("Skipped the update check: {reason}"))
}

#[tokio::test]
async fn default_verbosity_only_adds_the_notice() {
    let box_ = Sandbox::new();
    cache_file(&box_.file, &cache_line(1, "stable"));
    assert_eq!(stderr(&box_, &["add"]).await, ADDED.to_owned() + NOTICE);
}

#[tokio::test]
async fn verbose_orders_the_read_notice_and_started_refresh() {
    let box_ = Sandbox::new();
    cache_file(&box_.file, &cache_line(1, "stable"));
    let before = ADDED.to_owned() + &read(&box_.file) + NOTICE;
    assert_eq!(stderr(&box_, &["-v", "add"]).await, before);
    cache_file(&box_.file, &cache_line(25, "stable"));
    assert_eq!(
        stderr(&box_, &["-v", "add"]).await,
        before + &refreshed(&box_.file)
    );
}

#[tokio::test]
async fn a_format_one_cache_for_another_channel_is_read_and_refreshed() {
    let box_ = Sandbox::new();
    cache_file(&box_.file, &cache_line(1, "next"));
    assert_eq!(
        stderr(&box_, &["-vv", "add"]).await,
        ADDED.to_owned() + &read(&box_.file) + &refreshed(&box_.file)
    );
}

#[tokio::test]
async fn trace_names_an_ignored_cache_but_no_missing_cache() {
    for content in ["{", "{\"format\":2}\n", "[]\n"] {
        let box_ = Sandbox::new();
        cache_file(&box_.file, content);
        assert_eq!(
            stderr(&box_, &["-vv", "add"]).await,
            ADDED.to_owned()
                + &trace(&format!(
                    "Ignored {}: it is not an update cache this version reads.",
                    box_.file.display()
                ))
                + &refreshed(&box_.file)
        );
    }
    let directory = Sandbox::new();
    fs::create_dir_all(&directory.file).unwrap();
    assert_eq!(
        stderr(&directory, &["-vv", "add"]).await,
        ADDED.to_owned()
            + &trace(&format!(
                "Ignored {}: it is not an update cache this version reads.",
                directory.file.display()
            ))
    );
    let missing = Sandbox::new();
    assert_eq!(
        stderr(&missing, &["-vv", "add"]).await,
        ADDED.to_owned() + &refreshed(&missing.file)
    );
}

#[tokio::test]
async fn skipped_runs_name_the_first_reason_in_contract_order() {
    let box_ = Sandbox::new();
    let fields = || fields(&box_, &["-vv", "add"]);
    for (fields, reason) in [
        (
            fields()
                .env("NOTES_NO_UPDATE_NOTICE", "1")
                .env("NO_UPDATE_NOTIFIER", "1"),
            "NO_UPDATE_NOTIFIER is set.",
        ),
        (
            fields().env("NOTES_NO_UPDATE_NOTICE", "1"),
            "NOTES_NO_UPDATE_NOTICE is set.",
        ),
        (
            fields()
                .env("CI", "1")
                .terminal(MockTerminal::new(400, 24).streams([StreamName::Stderr])),
            "stdout is not a terminal.",
        ),
        (
            fields()
                .env("CI", "1")
                .terminal(MockTerminal::new(400, 24).streams([StreamName::Stdout])),
            "stderr is not a terminal.",
        ),
        (fields().env("CI", "1"), "CI is set."),
        (
            fields().release(ReleaseFacts::new(Build::Source)),
            "notes is not a release build.",
        ),
        (
            fields().release(release(Some("npm"))),
            "notes was not installed by install.sh.",
        ),
        (
            fields().env("XDG_CACHE_HOME", "").home("relative"),
            "HOME is not an absolute path.",
        ),
    ] {
        let ran = run(fields, false).await;
        assert_eq!(ran.code, 0);
        let expected = if matches!(
            reason,
            "stdout is not a terminal." | "stderr is not a terminal." | "CI is set."
        ) {
            format!("  ┆ Skipped the update check: {reason}\n")
        } else {
            skipped(reason)
        };
        assert_eq!(ran.stderr, ADDED.to_owned() + &expected);
    }
    assert_eq!(
        stderr(&box_, &["-vv", "self-update"]).await,
        skipped("self-update is running.")
    );
}

#[tokio::test]
async fn the_first_reason_wins_when_two_hold() {
    let box_ = Sandbox::new();
    let ci = run(fields(&box_, &["-vv", "self-update"]).env("CI", "1"), false).await;
    assert_eq!(ci.stderr, "  ┆ Skipped the update check: CI is set.\n");
    let source = run(
        fields(&box_, &["-vv", "add"])
            .env("NO_UPDATE_NOTIFIER", "1")
            .release(ReleaseFacts::new(Build::Source)),
        false,
    )
    .await;
    assert_eq!(
        source.stderr,
        ADDED.to_owned() + &skipped("NO_UPDATE_NOTIFIER is set.")
    );
}

#[tokio::test]
async fn a_failed_action_writes_no_skip_line() {
    let box_ = Sandbox::new();
    let ran = run(fields(&box_, &["-vv", "fail"]).env("CI", "1"), false).await;
    assert_eq!(ran.code, 1);
    assert_eq!(ran.stderr, "The note could not be added.\n");
}

#[tokio::test]
async fn a_refresh_that_cannot_start_produces_no_started_line() {
    let box_ = Sandbox::new();
    let ran = run(fields(&box_, &["-v", "add"]), true).await;
    assert_eq!(ran.code, 0);
    assert_eq!(ran.stderr, ADDED.to_owned() + &written(&box_.file));
}

#[tokio::test]
async fn writing_checked_records_the_cache_path_and_plugin() {
    let box_ = Sandbox::new();
    let ran = run(fields(&box_, &["add"]), false).await;
    assert_eq!(ran.stderr, ADDED);
    let changes: Vec<_> = ran
        .events
        .iter()
        .filter(|event| event.level == LogLevel::Info)
        .collect();
    assert_eq!(changes.len(), 1);
    let event = changes[0];
    assert_eq!(event.message, "File written.");
    assert_eq!(event.fields["path"], box_.file.to_str().unwrap());
    assert_eq!(
        event.plugin.as_deref(),
        Some("@loomcli/plugins/self-update")
    );
}

#[tokio::test]
async fn offset_verbosity_keeps_the_lines_off_stderr() {
    let box_ = Sandbox::new();
    assert_eq!(stderr(&box_, &["-v", "-q", "add"]).await, ADDED);
}

#[tokio::test]
async fn a_control_character_in_the_cache_path_is_escaped() {
    let box_ = Sandbox::new();
    let home = box_.root.join("ca\u{7}che");
    cache_file(&home.join("notes/update.json"), &cache_line(1, "stable"));
    let ran = run(
        fields(&box_, &["-v", "add"]).env("XDG_CACHE_HOME", home.to_str().unwrap()),
        false,
    )
    .await;
    assert_eq!(
        ran.stderr,
        format!(
            "{ADDED}› Read the update check from {}/ca\\u0007che/notes/update.json.\n{NOTICE}",
            box_.root.display(),
        )
    );
}

/// A mock whose child fails synchronously at spawn, as a missing executable does on the host.
struct NoChild(Arc<MockProcess>);

impl ProcessHandle for NoChild {
    fn argv(&self) -> Vec<String> {
        self.0.argv()
    }
    fn program(&self) -> Vec<String> {
        self.0.program()
    }
    fn env(&self) -> Env {
        self.0.env()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.0.cwd()
    }
    fn home(&self) -> PathBuf {
        self.0.home()
    }
    fn tmpdir(&self) -> PathBuf {
        self.0.tmpdir()
    }
    fn platform(&self) -> String {
        self.0.platform()
    }
    fn arch(&self) -> String {
        self.0.arch()
    }
    fn libc(&self) -> Option<Libc> {
        self.0.libc()
    }
    fn uid(&self) -> Option<u32> {
        self.0.uid()
    }
    fn time_zone(&self) -> String {
        self.0.time_zone()
    }
    fn release(&self) -> ReleaseFacts {
        self.0.release()
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        self.0.stdin()
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        self.0.stdout()
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        self.0.stderr()
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        self.0.terminal()
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        self.0.signals()
    }
    fn spawn(&self, _: SpawnRequest) -> Child {
        Child::unstarted(io::Error::from(io::ErrorKind::NotFound))
    }
    fn set_exit_code(&self, code: ExitCode) {
        self.0.set_exit_code(code);
    }
}
