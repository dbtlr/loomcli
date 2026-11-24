//! The fixture of the man page tests, ported from the reference's `fixtures/manpage-app.ts` and
//! the sandbox of `manpage.test.ts`: an application named `notes` that installs `help()` and
//! `manpage()` and answers a few Commands, run on a mock process in a temporary sandbox of two
//! homes, a state directory, and a working directory.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use loomcli_core::{
    Application, Command, Context, Group, NoInputs, NoResult, ProcessHandle, ReleaseFacts,
    RunOptions,
};
use loomcli_plugins::help::help;
use loomcli_plugins::manpage::manpage;
use loomcli_testing::{MockFields, mock_process};

pub type App = Application<NoInputs, NoResult, Group>;

/// What one run left.
#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

/// A temporary sandbox, removed when it drops.
pub struct Sandbox {
    pub root: PathBuf,
    pub cwd: PathBuf,
    pub home: PathBuf,
    pub other: PathBuf,
    pub state: PathBuf,
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A fresh, empty directory under the system's temporary folder, named through no link.
pub fn temporary_root(prefix: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "{prefix}-{}-{}-{nanos}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).unwrap();
    fs::canonicalize(root).unwrap()
}

pub fn sandbox() -> Sandbox {
    let root = temporary_root("loom-manpage");
    let sandbox = Sandbox {
        cwd: root.join("work"),
        home: root.join("home"),
        other: root.join("other"),
        state: root.join("state"),
        root,
    };
    for directory in [&sandbox.cwd, &sandbox.home, &sandbox.other, &sandbox.state] {
        fs::create_dir_all(directory).unwrap();
    }
    sandbox
}

/// What a run needs besides the argument words. `MANPATH` and `SHELL` are absent and `PATH` holds
/// the home's `.local/bin`, unless the scenario sets them.
#[derive(Clone, Debug)]
pub struct Scenario {
    pub commands: Vec<String>,
    pub env: Vec<(String, Option<String>)>,
    pub home: Option<PathBuf>,
    pub version: String,
}

impl Default for Scenario {
    fn default() -> Self {
        Self {
            commands: vec!["ping".to_owned(), "sync".to_owned()],
            env: Vec::new(),
            home: None,
            version: "1.0.0".to_owned(),
        }
    }
}

impl Scenario {
    pub fn commands(self, commands: &[&str]) -> Self {
        Self {
            commands: commands.iter().map(|name| (*name).to_owned()).collect(),
            ..self
        }
    }

    pub fn env(mut self, name: &str, value: impl AsRef<str>) -> Self {
        self.env
            .push((name.to_owned(), Some(value.as_ref().to_owned())));
        self
    }

    pub fn home(self, home: impl Into<PathBuf>) -> Self {
        Self {
            home: Some(home.into()),
            ..self
        }
    }

    pub fn version(self, version: &str) -> Self {
        Self {
            version: version.to_owned(),
            ..self
        }
    }
}

fn command(name: &str) -> Command<NoInputs, NoResult, loomcli_core::Done> {
    let printed = name.to_owned();
    Command::new(name)
        .description(format!("Run {name}."))
        .action(move |context: Context| {
            let printed = printed.clone();
            async move { context.out.print(&printed).await }
        })
}

/// The application `notes`, with the scenario's Commands in order.
pub fn application(scenario: &Scenario) -> App {
    let root = Application::new("notes")
        .plugins((help(), manpage()))
        .description("Keep notes in sync.")
        .version(scenario.version.clone());
    let (first, rest) = scenario.commands.split_first().unwrap();
    rest.iter().fold(root.command(command(first)), |app, name| {
        app.command(command(name))
    })
}

/// Runs an application on a mock process with the given facts.
pub async fn run_application(application: &App, fields: MockFields) -> Ran {
    let process = mock_process(fields);
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// Runs `notes ...argv` in the sandbox.
pub async fn run(sandbox: &Sandbox, argv: &[&str], scenario: &Scenario) -> Ran {
    let home = scenario
        .home
        .clone()
        .unwrap_or_else(|| sandbox.home.clone());
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .cwd(sandbox.cwd.clone())
        .platform("linux")
        .release(ReleaseFacts::new(loomcli_core::Build::Distributed))
        .env("HOME", &home.to_string_lossy())
        .env(
            "PATH",
            &format!("{}:/usr/bin", home.join(".local").join("bin").display()),
        )
        .env("XDG_STATE_HOME", &sandbox.state.to_string_lossy())
        .home(home);
    for (name, value) in &scenario.env {
        if let Some(value) = value {
            fields = fields.env(name, value);
        }
    }
    run_application(&application(scenario), fields).await
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

/// The lines a run wrote to stderr as written, each lane glyph included.
pub fn raw_lines(stderr: &str) -> Vec<String> {
    stderr.trim().split('\n').map(str::to_owned).collect()
}

/// A line as a lane writes it: the lane's glyph, a space, and the message.
pub fn laned(mark: &str, message: &str) -> String {
    let glyph = match mark {
        "info" => '\u{2139}',
        "success" => '\u{2714}',
        "warning" => '\u{26a0}',
        other => panic!("No lane {other}."),
    };
    format!("{glyph} {message}")
}

/// The folder `install` writes under a home.
pub fn folder_of(home: &Path) -> PathBuf {
    home.join(".local").join("share").join("man").join("man1")
}

/// The plugin's file in the installation record.
pub fn record_path(sandbox: &Sandbox) -> PathBuf {
    sandbox
        .state
        .join("notes")
        .join("installation")
        .join("manpage.json")
}

/// The page files of the default fixture, in graph order.
pub const DEFAULT_SET: [&str; 8] = [
    "notes.1",
    "notes-manpage.1",
    "notes-manpage-generate.1",
    "notes-manpage-install.1",
    "notes-manpage-update.1",
    "notes-manpage-uninstall.1",
    "notes-ping.1",
    "notes-sync.1",
];

/// The default set's files sorted by name.
pub fn sorted_set() -> Vec<String> {
    let mut set: Vec<String> = DEFAULT_SET.iter().map(|file| (*file).to_owned()).collect();
    set.sort();
    set
}

/// The names under a folder, sorted.
pub fn names_in(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// Every entry under a path with its kind, permission bits, and content, without following a link.
pub fn tree(path: &Path) -> BTreeMap<String, String> {
    fn walk(current: &Path, key: &str, entries: &mut BTreeMap<String, String>) {
        let Ok(metadata) = fs::symlink_metadata(current) else {
            entries.insert(key.to_owned(), "absent".to_owned());
            return;
        };
        if metadata.file_type().is_symlink() {
            entries.insert(
                key.to_owned(),
                format!("link {}", fs::read_link(current).unwrap().display()),
            );
        } else if metadata.is_dir() {
            entries.insert(
                key.to_owned(),
                format!("directory {:o}", metadata.permissions().mode() & 0o777),
            );
            for entry in fs::read_dir(current).unwrap() {
                let name = entry.unwrap().file_name();
                walk(
                    &current.join(&name),
                    &format!("{key}/{}", name.to_string_lossy()),
                    entries,
                );
            }
        } else {
            let content: String = fs::read(current)
                .unwrap()
                .into_iter()
                .map(char::from)
                .collect();
            entries.insert(
                key.to_owned(),
                format!("file {:o} {content}", metadata.permissions().mode() & 0o777),
            );
        }
    }
    let mut entries = BTreeMap::new();
    walk(path, ".", &mut entries);
    entries
}

/// The permission bits of a path, without following a link.
pub fn mode_of(path: &Path) -> u32 {
    fs::symlink_metadata(path).unwrap().permissions().mode() & 0o777
}

/// Everything a run that writes nothing must leave alone: both homes and the record.
#[derive(Debug, PartialEq, Eq)]
pub struct Snapshot {
    home: BTreeMap<String, String>,
    other: BTreeMap<String, String>,
    record: Option<(String, u64, i64, i64)>,
}

pub fn snapshot(sandbox: &Sandbox) -> Snapshot {
    use std::os::unix::fs::MetadataExt;
    let record = record_path(sandbox);
    Snapshot {
        home: tree(&sandbox.home),
        other: tree(&sandbox.other),
        record: fs::read_to_string(&record).ok().map(|text| {
            let metadata = fs::symlink_metadata(&record).unwrap();
            (
                text,
                metadata.ino(),
                metadata.mtime(),
                metadata.mtime_nsec(),
            )
        }),
    }
}

/// The paths the plugin's file records.
pub fn recorded_paths(sandbox: &Sandbox) -> Vec<String> {
    let file: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(record_path(sandbox)).unwrap()).unwrap();
    file["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["path"].as_str().unwrap().to_owned())
        .collect()
}

/// The digest of some text as the record spells it.
pub fn digest_of(text: &str) -> String {
    loomcli_plugins::installation_test_support::digest_of(text.as_bytes())
}
