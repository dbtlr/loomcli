//! The fixture of the skills tests, ported from the reference's `fixtures/skills-run-app.ts`: an
//! application that installs `skills()` with fixture skills whose loaders log their calls, run on
//! a mock process in a temporary sandbox of a home, a state directory, and a repository.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use loomcli_core::{
    Application, Build, Command, Context, Group, NoInputs, NoResult, ProcessHandle, ReleaseFacts,
    RunOptions,
};
use loomcli_plugins::skills::{Skill, SkillFile, Skills, skills};
use loomcli_testing::{MockFields, MockTerminal, mock_process};

pub type App = Application<NoInputs, NoResult, Group>;

/// What one run left.
#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

/// A temporary sandbox: a home, a state directory, a repository, a place elsewhere, and the
/// loader log. It is removed when it drops.
pub struct Sandbox {
    pub root: PathBuf,
    pub home: PathBuf,
    pub state: PathBuf,
    pub repo: PathBuf,
    pub elsewhere: PathBuf,
    pub loaded: PathBuf,
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
    let root = temporary_root("loom-skills");
    let sandbox = Sandbox {
        home: root.join("home"),
        state: root.join("state"),
        repo: root.join("repo"),
        elsewhere: root.join("elsewhere"),
        loaded: root.join("loaded.log"),
        root,
    };
    for directory in [
        &sandbox.home,
        &sandbox.state,
        &sandbox.repo,
        &sandbox.elsewhere,
    ] {
        fs::create_dir_all(directory).unwrap();
    }
    sandbox
}

/// One file a fixture loader answers.
#[derive(Clone, Debug)]
pub struct FileSpec {
    pub path: String,
    pub content: Vec<u8>,
    pub executable: bool,
}

pub fn file(path: &str, content: &str) -> FileSpec {
    FileSpec {
        path: path.to_owned(),
        content: content.as_bytes().to_vec(),
        executable: false,
    }
}

pub fn script(path: &str, content: &str) -> FileSpec {
    FileSpec {
        executable: true,
        ..file(path, content)
    }
}

/// One skill of the fixture application, and how its loader answers.
#[derive(Clone, Debug)]
pub struct Entry {
    pub name: String,
    pub files: Vec<FileSpec>,
    pub throws: bool,
}

pub fn entry(name: &str, files: Vec<FileSpec>) -> Entry {
    Entry {
        name: name.to_owned(),
        files,
        throws: false,
    }
}

pub fn throwing(name: &str) -> Entry {
    Entry {
        throws: true,
        ..entry(name, Vec::new())
    }
}

pub fn notes_files() -> Vec<FileSpec> {
    vec![
        file("SKILL.md", "# Notes\n"),
        file("references/commands.md", "commands v1\n"),
        script("scripts/run.sh", "#!/bin/sh\n"),
    ]
}

pub fn notes() -> Entry {
    entry("notes", notes_files())
}

/// A skill whose loader appends its name to the log file, then answers or fails.
pub fn skill_of(entry: &Entry, log: &Path) -> Skill {
    let entry = entry.clone();
    let log = log.to_owned();
    Skill::loaded(entry.name.clone(), move || {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log)?;
        writeln!(file, "{}", entry.name)?;
        if entry.throws {
            return Err(std::io::Error::other(format!("The {} loader failed.", entry.name)).into());
        }
        Ok(entry
            .files
            .iter()
            .map(|spec| {
                let file = SkillFile::new(spec.path.clone(), spec.content.clone());
                if spec.executable {
                    file.executable()
                } else {
                    file
                }
            })
            .collect())
    })
}

/// What a run needs besides the argument words.
#[derive(Clone, Debug)]
pub struct Scenario {
    pub skills: Vec<Entry>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<PathBuf>,
    pub build: Build,
    pub columns: Option<u16>,
}

impl Default for Scenario {
    fn default() -> Self {
        Self {
            skills: vec![notes()],
            env: Vec::new(),
            cwd: None,
            build: Build::Distributed,
            columns: None,
        }
    }
}

impl Scenario {
    pub fn skills(self, skills: Vec<Entry>) -> Self {
        Self { skills, ..self }
    }

    pub fn env(mut self, name: &str, value: &str) -> Self {
        self.env.push((name.to_owned(), value.to_owned()));
        self
    }

    pub fn cwd(self, cwd: impl Into<PathBuf>) -> Self {
        Self {
            cwd: Some(cwd.into()),
            ..self
        }
    }

    pub fn build(self, build: Build) -> Self {
        Self { build, ..self }
    }

    pub fn columns(self, columns: u16) -> Self {
        Self {
            columns: Some(columns),
            ..self
        }
    }
}

/// The application `notes` that installs the skills plugin and answers `ping`.
pub fn application_with(settings: Skills) -> App {
    Application::new("notes")
        .description("Keep notes in sync.")
        .plugins((settings.plugin(),))
        .command(
            Command::new("ping")
                .description("Answer.")
                .action(|ctx: Context| async move { ctx.out.print("pong").await }),
        )
}

/// The fixture application: the scenario's skills as listed skills.
pub fn application(sandbox: &Sandbox, scenario: &Scenario) -> App {
    let listed = scenario
        .skills
        .iter()
        .map(|entry| skill_of(entry, &sandbox.loaded))
        .collect();
    application_with(skills(listed))
}

/// Runs an application on a mock process in the sandbox.
pub async fn run_application(
    application: &App,
    sandbox: &Sandbox,
    argv: &[&str],
    scenario: &Scenario,
) -> Ran {
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .cwd(scenario.cwd.clone().unwrap_or_else(|| sandbox.repo.clone()))
        .platform("linux")
        .release(ReleaseFacts::new(scenario.build))
        .env("HOME", &sandbox.home.to_string_lossy())
        .env("XDG_STATE_HOME", &sandbox.state.to_string_lossy());
    let home = scenario
        .env
        .iter()
        .rev()
        .find(|(name, _)| name == "HOME")
        .map_or_else(|| sandbox.home.clone(), |(_, value)| PathBuf::from(value));
    fields = fields.home(home);
    for (name, value) in &scenario.env {
        fields = fields.env(name, value);
    }
    if let Some(columns) = scenario.columns {
        fields = fields.terminal(MockTerminal::new(columns, 24));
    }
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

/// Runs `notes ...argv` in the sandbox, its fixture skills and environment from the scenario.
pub async fn run(sandbox: &Sandbox, argv: &[&str], scenario: &Scenario) -> Ran {
    run_application(&application(sandbox, scenario), sandbox, argv, scenario).await
}

/// The skill names the loaders were called for, in order.
pub fn loaded(sandbox: &Sandbox) -> Vec<String> {
    fs::read_to_string(&sandbox.loaded)
        .map(|text| text.trim().lines().map(str::to_owned).collect())
        .unwrap_or_default()
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

/// Lines with the sandbox's home replaced by the word HOME.
pub fn pinned(sandbox: &Sandbox, stderr: &str) -> Vec<String> {
    lines(stderr)
        .into_iter()
        .map(|line| line.replace(&*sandbox.home.to_string_lossy(), "HOME"))
        .collect()
}

pub const CLAUDE: &str = "claude";
pub const AGENTS: &str = "agents";

pub fn folder_of(sandbox: &Sandbox, target: &str, name: &str) -> PathBuf {
    sandbox
        .home
        .join(format!(".{target}"))
        .join("skills")
        .join(name)
}

pub fn project_folder(root: &Path, target: &str) -> PathBuf {
    root.join(format!(".{target}")).join("skills").join("notes")
}

pub fn record_path(sandbox: &Sandbox, target: &str) -> PathBuf {
    sandbox
        .state
        .join("notes")
        .join("installation")
        .join(format!("skills.{target}.json"))
}

/// What the plugin's file for the target records: its state, directories, files, and folders.
pub struct Recorded {
    pub state: String,
    pub directories: Vec<String>,
    pub files: Vec<serde_json::Value>,
    pub folders: Vec<String>,
}

pub fn recorded(sandbox: &Sandbox, target: &str) -> Recorded {
    let file: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(record_path(sandbox, target)).unwrap()).unwrap();
    let strings = |key: &str| -> Vec<String> {
        file[key]
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|item| item.as_str().unwrap().to_owned())
                    .collect()
            })
            .unwrap_or_default()
    };
    Recorded {
        state: file["state"].as_str().unwrap().to_owned(),
        directories: strings("directories"),
        files: file["files"].as_array().cloned().unwrap_or_default(),
        folders: file["folders"]
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|folder| folder["path"].as_str().unwrap().to_owned())
                    .collect()
            })
            .unwrap_or_default(),
    }
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
            entries.insert(key.to_owned(), "directory".to_owned());
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

/// The permission bits of a file.
pub fn mode_of(path: &Path) -> u32 {
    fs::symlink_metadata(path).unwrap().permissions().mode() & 0o777
}

/// The files the notes fixture writes, each as `tree` spells it.
pub fn written() -> Vec<(&'static str, &'static str)> {
    vec![
        ("SKILL.md", "file 644 # Notes\n"),
        ("references/commands.md", "file 644 commands v1\n"),
        ("scripts/run.sh", "file 755 #!/bin/sh\n"),
    ]
}

/// The tree of a folder holding exactly these files, each as `tree` spells it.
pub fn holding(files: &[(&str, &str)]) -> BTreeMap<String, String> {
    let mut entries = BTreeMap::new();
    entries.insert(".".to_owned(), "directory".to_owned());
    for (path, spelled) in files {
        let parts: Vec<&str> = path.split('/').collect();
        for depth in 1..parts.len() {
            entries.insert(
                format!("./{}", parts[..depth].join("/")),
                "directory".to_owned(),
            );
        }
        entries.insert(format!("./{path}"), (*spelled).to_owned());
    }
    entries
}

/// A path's inode and modification time, or `absent`, without following a link.
pub fn identity(path: &Path) -> String {
    fs::symlink_metadata(path).map_or_else(
        |_| "absent".to_owned(),
        |metadata| {
            format!(
                "{} {} {}",
                metadata.ino(),
                metadata.mtime(),
                metadata.mtime_nsec()
            )
        },
    )
}

/// A record's content and identity, or `absent`.
pub fn record_state(path: &Path) -> String {
    fs::read_to_string(path).map_or_else(
        |_| "absent".to_owned(),
        |text| format!("{text} {}", identity(path)),
    )
}

/// What a run that writes nothing must leave alone: each target's folder identity and record.
pub fn write_state(sandbox: &Sandbox) -> Vec<String> {
    [CLAUDE, AGENTS]
        .iter()
        .flat_map(|target| {
            [
                identity(&folder_of(sandbox, target, "notes")),
                record_state(&record_path(sandbox, target)),
            ]
        })
        .collect()
}

/// A development run's `.git` ceiling: whether a `.git` entry sits above the sandbox, outside the
/// ceiling the reference's process fixture sets. A case that walks up from a directory with no
/// `.git` in the sandbox cannot be judged there.
pub fn git_above(sandbox: &Sandbox) -> bool {
    sandbox
        .root
        .parent()
        .into_iter()
        .flat_map(Path::ancestors)
        .any(|directory| fs::symlink_metadata(directory.join(".git")).is_ok())
}

/// The parts of the one diagnostic a run's stderr holds: the rule identity at the end of its
/// header, the sentence (its first paragraph), and the correction (its last paragraph), with each
/// paragraph's wrapped lines joined by one space.
pub fn rule_parts(stderr: &str) -> (String, String, String) {
    let text = stderr.trim();
    let header = text.lines().next().unwrap_or_default();
    let identity = header.rsplit(' ').next().unwrap_or_default().to_owned();
    let paragraphs: Vec<String> = text
        .split("\n\n")
        .skip(1)
        .map(|paragraph| paragraph.lines().collect::<Vec<_>>().join(" "))
        .filter(|paragraph| !paragraph.is_empty())
        .collect();
    let sentence = paragraphs.first().cloned().unwrap_or_default();
    let correction = paragraphs.last().cloned().unwrap_or_default();
    (identity, sentence, correction)
}

/// What an operator of a distributed build sees of any declaration fault: the developer
/// diagnostic is shown only to a source or development run.
pub const DISTRIBUTED_FAULT: &str = "notes: Something went wrong.";
