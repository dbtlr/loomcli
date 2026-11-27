//! The fixture of the service tests, ported from the reference's `fixtures/service-run-app.ts`,
//! `service-programs.ts`, `service-graph.ts`, and the sandbox of `service.test.ts`: an application
//! named `notes` that installs `service()` (and `format()` when the feature is on) and answers a few Commands, run on a mock
//! process whose `systemctl`, `loginctl`, and `launchctl` programs answer from a scenario and
//! record each call.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use loomcli_core::{
    AnyPlugin, Application, Build, Command, Context, Env, Group, KillSignal, LogEvent, NoInputs,
    NoResult, Opt, Plugin, ProcessHandle, ProcessSignal, ReleaseFacts, RunOptions,
};
#[cfg(feature = "format")]
use loomcli_plugins::format::format;
#[cfg(feature = "logging")]
use loomcli_plugins::logging::{FileDestination, LogTarget, LoggingDestination, logging};
use loomcli_plugins::service::{ServiceDetail, service};
use loomcli_testing::{
    MockFields, MockProcess, MockTerminal, ProgramAnswer, StreamName, mock_process,
};
use serde_json::json;

pub mod deaf;

pub type App = Application<NoInputs, NoResult, Group>;

/// The user id the mock process reports.
pub const UID: u32 = 1000;

/// What one run left.
#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

/// One call a fake manager received: its words and the `XDG_RUNTIME_DIR` it saw.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub words: String,
    pub runtime: Option<String>,
}

/// One answer of a fake manager.
#[derive(Clone, Debug, Default)]
pub struct Answer {
    pub exit: i32,
    pub stdout: Option<String>,
    pub abort: bool,
    pub hang: bool,
}

impl Answer {
    pub fn exit(exit: i32) -> Self {
        Self {
            exit,
            ..Self::default()
        }
    }

    pub fn stdout(text: &str) -> Self {
        Self {
            stdout: Some(text.to_owned()),
            ..Self::default()
        }
    }

    pub fn hang() -> Self {
        Self {
            hang: true,
            ..Self::default()
        }
    }

    pub fn abort(self) -> Self {
        Self {
            abort: true,
            ..self
        }
    }
}

/// Answers keyed by a call's exact words, taken in turn with the last repeating.
pub type Answers = Vec<(String, Vec<Answer>)>;

/// One rule with a single answer.
pub fn one(call: impl Into<String>, answer: Answer) -> Answers {
    vec![(call.into(), vec![answer])]
}

/// One rule with several answers, taken in turn.
pub fn turns(call: impl Into<String>, answers: Vec<Answer>) -> Answers {
    vec![(call.into(), answers)]
}

/// Two sets of rules as one, where a call both name takes the second's answers.
pub fn both(first: Answers, mut second: Answers) -> Answers {
    second.extend(first);
    second
}

/// What the probe of a scenario does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Probe {
    None,
    Rows,
    Throw,
    Debug,
}

#[cfg(feature = "logging")]
#[derive(Clone)]
pub enum Logging {
    Console,
    Files(Vec<PathBuf>),
}

/// Observations of a configured output folder during install.
#[derive(Clone)]
pub struct OutputFolderWatch {
    pub path: PathBuf,
    pub at_manager_calls: Arc<Mutex<Vec<bool>>>,
    pub log_events: Arc<Mutex<Vec<LogEvent>>>,
}

impl OutputFolderWatch {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            at_manager_calls: Arc::default(),
            log_events: Arc::default(),
        }
    }
}

/// What the probe received, recorded for the test.
#[derive(Clone, Debug, PartialEq)]
pub struct ProbeLog {
    pub aborted: bool,
    pub platform: String,
    pub state: serde_json::Value,
}

/// The calls the fake managers received and how often each rule answered.
#[derive(Default)]
struct Calls {
    records: Vec<Record>,
    counts: HashMap<String, usize>,
}

/// A temporary sandbox with its fake managers' call log, removed when it drops.
pub struct Sandbox {
    pub root: PathBuf,
    pub cwd: PathBuf,
    pub config: PathBuf,
    pub home: PathBuf,
    pub state: PathBuf,
    calls: Arc<Mutex<Calls>>,
    pub probe_log: Arc<Mutex<Option<ProbeLog>>>,
    /// The signals a deaf call's child received.
    pub kills: Arc<Mutex<Vec<KillSignal>>>,
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A fresh, empty directory under the workspace's scratch folder, named through no link.
fn temporary_root() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.scratch/service-tests");
    fs::create_dir_all(&scratch).unwrap();
    loop {
        let root = scratch.join(format!(
            "{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        match fs::create_dir(&root) {
            Ok(()) => return fs::canonicalize(root).unwrap(),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => panic!("cannot make a service test sandbox: {error}"),
        }
    }
}

pub fn sandbox() -> Sandbox {
    let root = temporary_root();
    let sandbox = Sandbox {
        cwd: root.clone(),
        config: root.join("config"),
        home: root.join("home"),
        state: root.join("state"),
        root,
        calls: Arc::default(),
        probe_log: Arc::default(),
        kills: Arc::default(),
    };
    for directory in [&sandbox.config, &sandbox.home, &sandbox.state] {
        fs::create_dir_all(directory).unwrap();
    }
    sandbox
}

impl Sandbox {
    /// Every call the fake managers received, as their words.
    pub fn calls(&self) -> Vec<String> {
        self.records().into_iter().map(|call| call.words).collect()
    }

    pub fn records(&self) -> Vec<Record> {
        self.calls.lock().unwrap().records.clone()
    }

    /// Forgets the calls so far and every rule's count.
    pub fn clear_calls(&self) {
        let mut calls = self.calls.lock().unwrap();
        calls.records.clear();
        calls.counts.clear();
    }

    pub fn systemd_path(&self, label: &str) -> PathBuf {
        self.config
            .join("systemd")
            .join("user")
            .join(format!("{label}.service"))
    }

    pub fn launchd_path(&self, label: &str) -> PathBuf {
        self.home
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{label}.plist"))
    }

    pub fn linux_record(&self) -> PathBuf {
        self.state
            .join("notes")
            .join("installation")
            .join("service.json")
    }

    pub fn darwin_record(&self) -> PathBuf {
        self.home
            .join("Library")
            .join("Application Support")
            .join("notes")
            .join("installation")
            .join("service.json")
    }

    /// The path of the unit for a platform with the default label.
    pub fn unit_path(&self, platform: &str) -> PathBuf {
        if platform == "linux" {
            self.systemd_path("com.acme.notes")
        } else {
            self.launchd_path("com.acme.notes")
        }
    }

    pub fn record_path(&self, platform: &str) -> PathBuf {
        if platform == "linux" {
            self.linux_record()
        } else {
            self.darwin_record()
        }
    }

    /// The pinned systemd unit for the default settings in the sandbox.
    pub fn pinned_unit(&self) -> String {
        format!(
            "[Unit]\nDescription=Keep notes in sync.\nStartLimitIntervalSec=0\n\n[Service]\nExecStart=\"/opt/notes/bin/notes\" \"serve\" \"--port\" \"8080\"\nWorkingDirectory={}\nRestart=always\nRestartSec=10\nSuccessExitStatus=130 143\n\n[Install]\nWantedBy=default.target\n",
            self.home.display()
        )
    }

    /// The pinned launchd plist for the default settings in the sandbox.
    pub fn pinned_plist(&self) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key>\n  <string>com.acme.notes</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>/opt/notes/bin/notes</string>\n    <string>serve</string>\n    <string>--port</string>\n    <string>8080</string>\n  </array>\n  <key>WorkingDirectory</key>\n  <string>{}</string>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <true/>\n  <key>ThrottleInterval</key>\n  <integer>10</integer>\n</dict>\n</plist>\n",
            self.home.display()
        )
    }

    /// The unit text a platform's default settings render.
    pub fn pinned(&self, platform: &str) -> String {
        if platform == "linux" {
            self.pinned_unit()
        } else {
            self.pinned_plist()
        }
    }
}

/// What a run needs besides the argument words.
#[derive(Clone)]
pub struct Scenario {
    #[cfg(feature = "logging")]
    pub logging: Option<Logging>,
    pub environment: Option<Env>,
    pub output: Option<String>,
    pub stop_timeout: Option<u64>,
    pub output_folder_watch: Option<OutputFolderWatch>,
    pub log_events: Option<Arc<Mutex<Vec<LogEvent>>>>,
    pub platform: String,
    pub program: Vec<String>,
    pub build: Build,
    pub label: String,
    pub run: Vec<String>,
    /// `None` is the default description, `Some(None)` no description.
    pub description: Option<Option<String>>,
    pub probe: Probe,
    pub answers: Answers,
    pub env: Vec<(String, Option<String>)>,
    pub home: Option<String>,
    pub missing: Vec<String>,
    pub narrow_terminal: bool,
    /// The words of a call whose child ignores `SIGTERM`, and whether the run is sent `SIGTERM`
    /// shortly after it starts.
    pub deaf: Option<(String, bool)>,
}

impl Default for Scenario {
    fn default() -> Self {
        Self {
            #[cfg(feature = "logging")]
            logging: None,
            environment: None,
            output: None,
            stop_timeout: None,
            output_folder_watch: None,
            log_events: None,
            platform: "linux".to_owned(),
            program: vec!["/opt/notes/bin/notes".to_owned()],
            build: Build::Distributed,
            label: "com.acme.notes".to_owned(),
            run: ["serve", "--port", "8080"]
                .iter()
                .map(|word| (*word).to_owned())
                .collect(),
            description: None,
            probe: Probe::None,
            answers: Vec::new(),
            env: Vec::new(),
            home: None,
            missing: Vec::new(),
            narrow_terminal: false,
            deaf: None,
        }
    }
}

impl Scenario {
    #[cfg(feature = "logging")]
    pub fn log_files(mut self, paths: impl IntoIterator<Item = impl Into<PathBuf>>) -> Self {
        self.logging = Some(Logging::Files(paths.into_iter().map(Into::into).collect()));
        self
    }

    #[cfg(feature = "logging")]
    pub fn log_to_console(mut self) -> Self {
        self.logging = Some(Logging::Console);
        self
    }

    pub fn environment(
        mut self,
        variables: impl IntoIterator<Item = (&'static str, &'static str)>,
    ) -> Self {
        self.environment = Some(
            variables
                .into_iter()
                .map(|(name, value)| (name.to_owned(), value.to_owned()))
                .collect(),
        );
        self
    }

    pub fn output(mut self, path: &str) -> Self {
        self.output = Some(path.to_owned());
        self
    }

    pub fn stop_timeout(mut self, milliseconds: u64) -> Self {
        self.stop_timeout = Some(milliseconds);
        self
    }

    pub fn platform(self, platform: &str) -> Self {
        Self {
            platform: platform.to_owned(),
            ..self
        }
    }

    pub fn darwin() -> Self {
        Self::default().platform("darwin")
    }

    pub fn program(self, words: &[&str]) -> Self {
        Self {
            program: words.iter().map(|word| (*word).to_owned()).collect(),
            ..self
        }
    }

    pub fn build(self, build: Build) -> Self {
        Self { build, ..self }
    }

    pub fn label(self, label: &str) -> Self {
        Self {
            label: label.to_owned(),
            ..self
        }
    }

    pub fn run(self, words: &[&str]) -> Self {
        Self {
            run: words.iter().map(|word| (*word).to_owned()).collect(),
            ..self
        }
    }

    pub fn description(self, description: Option<&str>) -> Self {
        Self {
            description: Some(description.map(str::to_owned)),
            ..self
        }
    }

    pub fn probe(self, probe: Probe) -> Self {
        Self { probe, ..self }
    }

    pub fn answers(self, answers: Answers) -> Self {
        Self { answers, ..self }
    }

    pub fn without_env(mut self, name: &str) -> Self {
        self.env.push((name.to_owned(), None));
        self
    }

    pub fn with_env(mut self, name: &str, value: &str) -> Self {
        self.env.push((name.to_owned(), Some(value.to_owned())));
        self
    }

    pub fn home(self, home: &str) -> Self {
        Self {
            home: Some(home.to_owned()),
            ..self
        }
    }

    pub fn missing(mut self, program: &str) -> Self {
        self.missing.push(program.to_owned());
        self
    }

    pub fn deaf(self, words: &str, term_after_start: bool) -> Self {
        Self {
            deaf: Some((words.to_owned(), term_after_start)),
            ..self
        }
    }

    pub fn narrow_terminal(self) -> Self {
        Self {
            narrow_terminal: true,
            ..self
        }
    }
}

/// The application `notes`: `format()` and `service()` beside a Command with options, a Command the
/// probe calls, and a group.
pub fn application(sandbox: &Sandbox, scenario: &Scenario) -> App {
    let mut settings = service(&scenario.label, scenario.run.iter().map(String::as_str));
    if let Some(variables) = scenario.environment.clone() {
        settings = settings.environment(move |host| {
            let mut variables = variables.clone();
            variables.insert(
                "PATH".to_owned(),
                host.env.get("PATH").cloned().unwrap_or_default(),
            );
            Ok(variables)
        });
    }
    if let Some(output) = &scenario.output {
        settings = settings.output(output);
    }
    if let Some(timeout) = scenario.stop_timeout {
        settings = settings.stop_timeout(timeout);
    }
    if scenario.probe != Probe::None {
        let log = Arc::clone(&sandbox.probe_log);
        let behavior = scenario.probe;
        settings = settings.probe(move |probe| {
            let log = Arc::clone(&log);
            Box::pin(async move {
                *log.lock().unwrap() = Some(ProbeLog {
                    aborted: probe.signal.is_cancelled(),
                    platform: probe.host.platform.clone(),
                    state: serde_json::to_value(probe.state).unwrap(),
                });
                if behavior == Probe::Throw {
                    return Err(loomcli_core::FatalError::new("The probe failed.").into());
                }
                if behavior == Probe::Debug {
                    probe.log.debug("The status probe ran.", ());
                    return Ok(Vec::new());
                }
                match probe
                    .invoke(
                        &["health"],
                        loomcli_core::InvocationValues::new(),
                        loomcli_core::InvokeOptions::new(),
                    )
                    .await
                {
                    loomcli_core::InvocationOutcome::Completed { output, .. } => {
                        Ok(vec![ServiceDetail::new("health", output.trim())])
                    }
                    _ => Err(
                        loomcli_core::FatalError::new("The health probe did not complete.").into(),
                    ),
                }
            })
        });
    }
    let mut plugins: Vec<AnyPlugin> = Vec::new();
    let events = scenario.log_events.as_ref().or_else(|| {
        scenario
            .output_folder_watch
            .as_ref()
            .map(|watch| &watch.log_events)
    });
    if let Some(events) = events {
        let events = Arc::clone(events);
        plugins.push(
            Plugin::new("fixture/observer")
                .on_log(move |event, _| {
                    events.lock().unwrap().push(event.clone());
                })
                .into(),
        );
        #[cfg(feature = "verbose")]
        plugins.push(loomcli_plugins::verbose::verbose().into());
    }
    #[cfg(feature = "format")]
    plugins.push(format().into());
    #[cfg(feature = "logging")]
    match &scenario.logging {
        Some(Logging::Console) => plugins.push(logging().target(LogTarget::Stderr).into()),
        Some(Logging::Files(paths)) => {
            let files = paths
                .iter()
                .map(|path| {
                    FileDestination::new()
                        .file(path.to_string_lossy())
                        .level(loomcli_core::LogLevel::Error)
                        .into()
                })
                .collect::<Vec<LoggingDestination>>();
            plugins.push(logging().destinations(files).into());
        }
        None => {}
    }
    plugins.push(settings.into());
    let app = Application::new("notes").plugins(plugins);
    let app = match &scenario.description {
        Some(None) => app,
        Some(Some(description)) => app.description(description.clone()),
        None => app.description("Keep notes in sync."),
    };
    let serve = Command::new("serve")
        .description("Serve the notes.")
        .option("port", Opt::string().description("The port to serve on."));
    app.command(serve.action(|context: Context| async move { context.out.print("serving").await }))
        .command(
            Command::new("health")
                .description("Report the health.")
                .action(|context: Context| async move { context.out.print("ok, v1.5.0").await }),
        )
        .command(
            Command::new("cache")
                .description("Manage the cache.")
                .command(
                    Command::new("clear")
                        .description("Clear the cache.")
                        .action(
                            |context: Context| async move { context.out.print("cleared").await },
                        ),
                ),
        )
}

/// The cell the scripts raise the run's interrupt through, filled once the process exists.
type ProcessCell = Arc<OnceLock<Arc<MockProcess>>>;

/// The fake program of one manager: it records the call, answers from the scenario's rules, and
/// raises an interrupt for an answer that aborts the run.
fn manager_program(
    name: &'static str,
    calls: Arc<Mutex<Calls>>,
    answers: Answers,
    missing: bool,
    cell: ProcessCell,
    output_folder_watch: Option<OutputFolderWatch>,
) -> impl Fn(
    loomcli_testing::ProgramCall,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = io::Result<ProgramAnswer>> + Send>>
+ Send
+ Sync
+ 'static {
    move |call| {
        let calls = Arc::clone(&calls);
        let answers = answers.clone();
        let cell = Arc::clone(&cell);
        let output_folder_watch = output_folder_watch.clone();
        Box::pin(async move {
            if missing {
                return Err(io::Error::new(io::ErrorKind::NotFound, "no such program"));
            }
            if let Some(watch) = output_folder_watch {
                watch
                    .at_manager_calls
                    .lock()
                    .unwrap()
                    .push(watch.path.is_dir());
            }
            let words = std::iter::once(name.to_owned())
                .chain(call.args.iter().cloned())
                .collect::<Vec<_>>()
                .join(" ");
            let answer = {
                let mut calls = calls.lock().unwrap();
                calls.records.push(Record {
                    words: words.clone(),
                    runtime: call.env.get("XDG_RUNTIME_DIR").cloned(),
                });
                let used = calls.counts.get(&words).copied().unwrap_or(0);
                calls.counts.insert(words.clone(), used + 1);
                answers
                    .iter()
                    .find(|(each, _)| *each == words)
                    .map(|(_, results)| results[used.min(results.len() - 1)].clone())
                    .unwrap_or_default()
            };
            if answer.abort {
                cell.get().unwrap().raise(ProcessSignal::Int);
            }
            if answer.hang {
                std::future::pending::<()>().await;
            }
            Ok(ProgramAnswer::new()
                .code(answer.exit)
                .stdout(
                    answer
                        .stdout
                        .unwrap_or_else(|| "manager output\n".to_owned()),
                )
                .stderr("manager diagnostics\n"))
        })
    }
}

/// The mock process facts of a run in the sandbox against the fake managers the scenario
/// describes.
fn fields_of(
    sandbox: &Sandbox,
    argv: &[&str],
    scenario: &Scenario,
    cell: &ProcessCell,
) -> MockFields {
    let home = scenario
        .home
        .clone()
        .unwrap_or_else(|| sandbox.home.to_string_lossy().into_owned());
    let mut env: BTreeMap<String, String> = [
        ("HOME", home.clone()),
        ("PATH", "/usr/bin".to_owned()),
        (
            "XDG_CONFIG_HOME",
            sandbox.config.to_string_lossy().into_owned(),
        ),
        ("XDG_RUNTIME_DIR", "/run/user/given".to_owned()),
        (
            "XDG_STATE_HOME",
            sandbox.state.to_string_lossy().into_owned(),
        ),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_owned(), value))
    .collect();
    for (name, value) in &scenario.env {
        match value {
            Some(value) => env.insert(name.clone(), value.clone()),
            None => env.remove(name),
        };
    }
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .cwd(sandbox.cwd.clone())
        .platform(scenario.platform.clone())
        .uid(Some(UID))
        .program(scenario.program.clone())
        .release(ReleaseFacts::new(scenario.build))
        .home(home);
    for (name, value) in &env {
        fields = fields.env(name, value);
    }
    if scenario.narrow_terminal {
        fields = fields
            .terminal(MockTerminal::new(20, 24).streams([StreamName::Stdout, StreamName::Stderr]));
    }
    for name in ["systemctl", "loginctl", "launchctl"] {
        fields = fields.script(
            name,
            manager_program(
                name,
                Arc::clone(&sandbox.calls),
                scenario.answers.clone(),
                scenario.missing.iter().any(|each| each == name),
                Arc::clone(cell),
                scenario.output_folder_watch.clone(),
            ),
        );
    }
    fields
}

/// Runs `notes ...argv` in the sandbox against the fake managers the scenario describes.
pub async fn run(sandbox: &Sandbox, argv: &[&str], scenario: &Scenario) -> Ran {
    let cell: ProcessCell = Arc::default();
    let fields = fields_of(sandbox, argv, scenario, &cell);
    let process = mock_process(fields);
    let _ = cell.set(Arc::clone(&process));
    let application = application(sandbox, scenario);
    let handle: Arc<dyn ProcessHandle> = match &scenario.deaf {
        Some((words, term_after_start)) => Arc::new(deaf::Deaf {
            inner: Arc::clone(&process),
            deafness: deaf::Deafness {
                words: words.clone(),
                term_after_start: *term_after_start,
                kills: Arc::clone(&sandbox.kills),
            },
        }),
        None => Arc::clone(&process) as Arc<dyn ProcessHandle>,
    };
    let code = application.run(RunOptions::new().process(handle)).await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// What `argv` words would print through the result view `view`, selected without the formatter:
/// the Command at `path` invoked by name on the same mock process as `run`. `None` when it did
/// not complete.
pub async fn invoke_view(
    sandbox: &Sandbox,
    path: &[&str],
    view: &str,
    scenario: &Scenario,
) -> Option<String> {
    let cell: ProcessCell = Arc::default();
    let process = mock_process(fields_of(sandbox, &[], scenario, &cell));
    let _ = cell.set(Arc::clone(&process));
    let application = application(sandbox, scenario);
    match application
        .invoke(
            path,
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::new().view(view),
            Some(Arc::clone(&process) as Arc<dyn ProcessHandle>),
        )
        .await
    {
        loomcli_core::InvocationOutcome::Completed { output, .. } => Some(output),
        _ => None,
    }
}

/// The lines a run wrote to stderr, each with any lane glyph and the space after it removed.
pub fn lines(stderr: &str) -> Vec<String> {
    stderr
        .trim()
        .split('\n')
        .map(|line| {
            let mut characters = line.chars();
            match (characters.next(), characters.next()) {
                (Some(first), Some(' ')) if !first.is_ascii() => characters.as_str().to_owned(),
                _ => line.to_owned(),
            }
        })
        .collect()
}

/// A run's whole output as a `Ran`.
pub fn ran(status: u8, stdout: &str, stderr: &str) -> Ran {
    Ran {
        status,
        stdout: stdout.to_owned(),
        stderr: stderr.to_owned(),
    }
}

/// `sha256:` and the lowercase hexadecimal digest of some text.
pub fn digest_of(text: &str) -> String {
    loomcli_plugins::installation_test_support::digest_of(text.as_bytes())
}

/// The plugin's file as the installed-files module writes it once a unit is committed.
pub fn committed_record(directories: &[&Path], path: &Path, text: &str) -> String {
    let document = json!({
        "format": 1,
        "state": "committed",
        "directories": directories.iter().map(|each| each.to_string_lossy()).collect::<Vec<_>>(),
        "files": [{ "path": path.to_string_lossy(), "digest": digest_of(text) }],
    });
    format!("{document}\n")
}

/// The domain the fake managers' user owns.
pub fn domain() -> String {
    format!("gui/{UID}")
}

/// The launchd target of a label.
pub fn agent(label: &str) -> String {
    format!("{}/{label}", domain())
}

/// The answers that leave a launchd agent not loaded until it is bootstrapped.
pub fn not_loaded() -> Answers {
    one(
        format!("launchctl print {}", agent("com.acme.notes")),
        Answer::exit(113),
    )
}

/// The answers that report a loaded launchd agent.
pub fn loaded() -> Answers {
    one(
        format!("launchctl print {}", agent("com.acme.notes")),
        Answer::exit(0),
    )
}
