//! The fixture the logging tests share: the reference's `logging-app.ts` and its sandbox.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    AnyPlugin, Application, Arg, Command, Context, Done, FatalError, InvocationOutcome,
    InvocationValues, InvokeOptions, NoInputs, NoResult, ProcessHandle, RunOptions,
};
use loomcli_plugins::logging::{Logging, LoggingError, logging};
use loomcli_testing::{MockFields, mock_process};

pub type App = Application<NoInputs, NoResult, Done>;

/// A temporary home, state directory, and working directory, removed after the test.
pub struct Sandbox {
    pub root: PathBuf,
    pub home: PathBuf,
    pub state: PathBuf,
    pub work: PathBuf,
    /// The default log file of the fixture application: `<state>/heimdall/heimdall.jsonl`.
    pub file: PathBuf,
}

impl Sandbox {
    pub fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let number = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let scratch = crate_root
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(".scratch");
        let root = scratch.join(format!("loomcli-logging-{}-{number}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let home = root.join("home");
        let state = root.join("state");
        let work = root.join("work");
        for directory in [&home, &state, &work] {
            fs::create_dir_all(directory).unwrap();
        }
        Sandbox {
            file: state.join("heimdall").join("heimdall.jsonl"),
            root,
            home,
            state,
            work,
        }
    }

    /// The directory the fixture application logs into by default.
    pub fn directory(&self) -> PathBuf {
        self.state.join("heimdall")
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        // A test that made a directory read-only leaves it so; make it removable first.
        make_writable(&self.root);
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[cfg(unix)]
fn make_writable(root: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let _ = fs::set_permissions(root, fs::Permissions::from_mode(0o755));
    for entry in entries.flatten() {
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            make_writable(&entry.path());
        }
    }
}

#[cfg(not(unix))]
fn make_writable(_: &Path) {}

/// A directory that exists and cannot be written to.
#[cfg(unix)]
pub fn read_only(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(path).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o555)).unwrap();
}

/// Whether the process can write into a read-only directory, as root can.
#[cfg(unix)]
pub fn unprivileged() -> bool {
    rustix::process::getuid().as_raw() != 0
}

/// What the fixture's `on_error` does.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum OnError {
    /// Records one line per failure.
    Print,
    /// Fails from the callback.
    Throw,
}

/// The host facts a case replaces, and the `on_error` it picks.
#[derive(Default)]
pub struct Facts {
    /// The run's whole environment; `HOME` and `XDG_STATE_HOME` in the sandbox when `None`.
    pub env: Option<Vec<(String, String)>>,
    /// Pinned so a test reads the same row on every machine.
    pub platform: Option<&'static str>,
    pub on_error: Option<OnError>,
}

impl Facts {
    pub fn env(env: &[(&str, &str)]) -> Self {
        Facts {
            env: Some(
                env.iter()
                    .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                    .collect(),
            ),
            ..Facts::default()
        }
    }

    pub fn platform(mut self, platform: &'static str) -> Self {
        self.platform = Some(platform);
        self
    }

    pub fn on_error(mut self, on_error: OnError) -> Self {
        self.on_error = Some(on_error);
        self
    }
}

/// What one run wrote and what its `on_error` saw.
#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub status: u8,
    pub stderr: String,
    pub stdout: String,
    /// One line per failure the fixture's `on_error` printed.
    pub reports: Vec<String>,
}

#[derive(Debug)]
struct CallbackBroke;

impl std::fmt::Display for CallbackBroke {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("The callback broke.")
    }
}

impl std::error::Error for CallbackBroke {}

#[derive(Debug)]
struct ActionFailed;

impl std::fmt::Display for ActionFailed {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("The action failed.")
    }
}

impl std::error::Error for ActionFailed {}

/// One line naming a failure's cause code, kind, path, and variable, as the fixture prints it.
fn failure_line(error: &LoggingError) -> String {
    let cause = error.cause.as_ref().map(|cause| match cause.kind() {
        std::io::ErrorKind::PermissionDenied => "EACCES",
        std::io::ErrorKind::NotFound => "ENOENT",
        _ => "OTHER",
    });
    format!(
        "onError:{}",
        serde_json::json!({
            "cause": cause,
            "kind": error.kind.as_str(),
            "path": error.path,
            "variable": error.variable,
        })
    )
}

/// The `on_error` a case picks, added to the settings; recorded lines go to `reports`.
fn with_on_error(
    settings: Logging,
    on_error: Option<OnError>,
    reports: &Arc<Mutex<Vec<String>>>,
) -> Logging {
    match on_error {
        None => settings,
        Some(OnError::Throw) => settings.on_error(|_: &LoggingError| Err::<(), _>(CallbackBroke)),
        Some(OnError::Print) => {
            let reports = Arc::clone(reports);
            settings.on_error(move |error: &LoggingError| {
                reports.lock().unwrap().push(failure_line(error));
            })
        }
    }
}

/// The application the logging cases run.
pub fn logging_application(settings: impl Into<AnyPlugin>) -> App {
    let log = Command::new("log")
        .description("Log one event at each level.")
        .action(|ctx: Context| async move {
            ctx.log.trace("At trace.", fields("trace"));
            ctx.log.debug("At debug.", fields("debug"));
            ctx.log.info("At info.", fields("info"));
            ctx.log.warn("At warn.", fields("warn"));
            ctx.log.error("At error.", fields("error"));
            Ok(())
        });
    let burst = Command::new("burst")
        .description("Log numbered records.")
        .argument("count", Arg::string().required())
        .argument("size", Arg::string().required())
        .argument("label", Arg::string().required())
        .action(|ctx: Context| async move {
            let count: usize = ctx
                .argument::<Option<String>>("count")?
                .unwrap()
                .parse()
                .unwrap();
            let size: usize = ctx
                .argument::<Option<String>>("size")?
                .unwrap()
                .parse()
                .unwrap();
            let label = ctx.argument::<Option<String>>("label")?.unwrap();
            for number in 1..=count {
                ctx.log.info(
                    &format!("{label}{number}"),
                    loomcli_core::LogFields::new().field("payload", "x".repeat(size)),
                );
            }
            Ok(())
        });
    let odd = Command::new("odd")
        .description("Log one record whose fields need escaping.")
        .action(|ctx: Context| async move {
            ctx.log.info(
                "Odd \u{e9} \u{1}",
                loomcli_core::LogFields::new()
                    .field("text", "caf\u{e9} \u{2028}\"\\\n\u{7f}")
                    .field("ratio", 1.5),
            );
            Ok(())
        });
    let defect = Command::new("defect")
        .description("Log, then fail with a defect.")
        .action(|ctx: Context| async move {
            ctx.log.info("Before the defect.", ());
            Err(ActionFailed.into())
        });
    let fail = Command::new("fail")
        .description("Log, then fail the run.")
        .action(|ctx: Context| async move {
            ctx.log.info("Before the failure.", ());
            Err(FatalError::new("The run failed.").into())
        });
    let heal = Command::new("heal")
        .description("Log before and after a directory heals.")
        .argument("directory", Arg::string().required())
        .action(|ctx: Context| async move {
            ctx.log.info("Before healing.", ());
            let directory = ctx.argument::<Option<String>>("directory")?.unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755))
                    .unwrap();
            }
            ctx.log.info("After healing.", ());
            Ok(())
        });
    let plugin: AnyPlugin = settings.into();
    Application::new("heimdall")
        .description("A fixture application.")
        .version("1.2.0")
        .plugins([plugin])
        .command(log)
        .command(burst)
        .command(defect)
        .command(odd)
        .command(fail)
        .command(heal)
        .action(|_: Context| async { Ok(()) })
}

fn fields(level: &str) -> loomcli_core::LogFields {
    loomcli_core::LogFields::new().field("level", level)
}

/// A mock on the default facts, for a test that builds its own application.
pub fn mock_for(sandbox: &Sandbox, argv: &[&str]) -> Arc<loomcli_testing::MockProcess> {
    mock(sandbox, argv, &Facts::default())
}

/// The mock a case runs on, in the sandbox's working directory.
fn mock(sandbox: &Sandbox, argv: &[&str], facts: &Facts) -> Arc<loomcli_testing::MockProcess> {
    let env = facts.env.clone().unwrap_or_else(|| {
        vec![
            ("HOME".to_owned(), sandbox.home.display().to_string()),
            (
                "XDG_STATE_HOME".to_owned(),
                sandbox.state.display().to_string(),
            ),
        ]
    });
    let home = env
        .iter()
        .find(|(name, _)| name == "HOME")
        .map(|(_, value)| value.clone())
        .unwrap_or_default();
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .cwd(sandbox.work.clone())
        .home(home)
        .platform(facts.platform.unwrap_or("linux"));
    for (name, value) in &env {
        fields = fields.env(name, value);
    }
    mock_process(fields)
}

/// One run of the fixture application in the sandbox, its environment pointing into it.
pub async fn run(sandbox: &Sandbox, argv: &[&str], facts: Facts, settings: Logging) -> Outcome {
    let reports = Arc::new(Mutex::new(Vec::new()));
    let process = mock(sandbox, argv, &facts);
    let app = logging_application(with_on_error(settings, facts.on_error, &reports));
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    let reports = reports.lock().unwrap().clone();
    Outcome {
        status: code.get(),
        stderr: process.stderr_text(),
        stdout: process.stdout_text(),
        reports,
    }
}

/// `run` with the default settings.
pub async fn run_default(sandbox: &Sandbox, argv: &[&str]) -> Outcome {
    run(sandbox, argv, Facts::default(), logging()).await
}

/// One `app.invoke(argv)` on the same facts: the outcome's streams beside the mock's.
pub async fn invoke_by_name(
    sandbox: &Sandbox,
    path: &[&str],
    facts: Facts,
    settings: Logging,
) -> (String, String, String) {
    let reports = Arc::new(Mutex::new(Vec::new()));
    let process = mock(sandbox, &[], &facts);
    let app = logging_application(with_on_error(settings, facts.on_error, &reports));
    let outcome = app
        .invoke(
            path,
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(Arc::clone(&process) as Arc<dyn ProcessHandle>),
        )
        .await;
    let status = match outcome {
        InvocationOutcome::Completed { .. } => "completed",
        InvocationOutcome::Failed { .. } => "failed",
        _ => "cancelled",
    };
    (
        status.to_owned(),
        process.stderr_text(),
        process.stdout_text(),
    )
}

/// A record's text as written, with the two values that differ between runs, the time and the run
/// id, replaced in the raw line. Nothing else is parsed or re-spelled, so the bytes compare exactly.
pub fn pinned(line: &str) -> String {
    let after_time = line.find("\"time\":\"").expect("a time") + "\"time\":\"".len();
    let time_end = after_time + line[after_time..].find('"').expect("a closed time");
    let line = format!("{}T{}", &line[..after_time], &line[time_end..]);
    let after_run = line.find("\"run\":\"").expect("a run") + "\"run\":\"".len();
    let run = &line[after_run..after_run + 32];
    assert!(
        run.bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            && line[after_run + 32..].starts_with('"'),
        "{line}"
    );
    format!("{}R{}", &line[..after_run], &line[after_run + 32..])
}

/// The lines of a log file, pinned, with the closing newline of the last one checked.
pub fn lines(path: &Path) -> Vec<String> {
    let text = fs::read_to_string(path).unwrap();
    assert!(text.ends_with('\n'), "{text:?}");
    text[..text.len() - 1].split('\n').map(pinned).collect()
}

/// The pinned record of a call at `level` under `path`, as the plugin writes it.
pub fn record(level: &str, message: &str, fields: serde_json::Value, path: &[&str]) -> String {
    format!(
        "{{\"time\":\"T\",\"level\":\"{level}\",\"message\":\"{message}\",\"fields\":{fields},\"application\":{{\"name\":\"heimdall\",\"version\":\"1.2.0\"}},\"run\":\"R\",\"path\":{},\"plugin\":null}}",
        serde_json::json!(path)
    )
}

/// The pinned record of one of the `log` Command's five calls.
pub fn logged(level: &str) -> String {
    record(
        level,
        &format!("At {level}."),
        serde_json::json!({ "level": level }),
        &["log"],
    )
}

/// The message of the record in a single-record file.
pub fn message_in(path: &Path) -> String {
    let text = fs::read_to_string(path).unwrap();
    let value: serde_json::Value = serde_json::from_str(text.trim_end()).unwrap();
    value["message"].as_str().unwrap().to_owned()
}

/// The file names in a directory, sorted.
pub fn names(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}
