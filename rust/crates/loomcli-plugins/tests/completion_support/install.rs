//! The installation fixtures of `completion-install.test.ts`: the `jsonkit` application, a sandbox
//! of temporary folders, a scenario of host facts, and the fixture `pwsh`.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use loomcli_core::{
    Application, Command, Context, Group, NoInputs, NoResult, ProcessHandle, RunOptions,
};
use loomcli_plugins::completion::completion;
use loomcli_plugins::installation_test_support::digest_of;
use loomcli_testing::{MockFields, MockTerminal, ProgramAnswer, mock_process};
use serde_json::{Value, json};

use super::{Ran, TempDir};

/// One application for isolated installation runs: the reference's `jsonkit`.
pub fn jsonkit() -> Application<NoInputs, NoResult, Group> {
    Application::new("jsonkit")
        .description("Read JSON.")
        .plugins((completion(),))
        .command(
            Command::new("ping")
                .description("Answer.")
                .action(|context: Context| async move { context.out.print("pong").await }),
        )
}

/// A sandbox: a home, data, configuration, and state folders, and a working directory.
pub struct Sandbox {
    dir: TempDir,
    pub root: PathBuf,
    pub config: PathBuf,
    pub data: PathBuf,
    pub home: PathBuf,
    pub state: PathBuf,
    pub work: PathBuf,
}

impl Sandbox {
    pub fn new() -> Self {
        let dir = TempDir::new("loom-completion");
        let root = dir.path.clone();
        let sandbox = Self {
            config: root.join("config"),
            data: root.join("data"),
            home: root.join("home"),
            state: root.join("state"),
            work: root.join("work"),
            root,
            dir,
        };
        for folder in [
            &sandbox.home,
            &sandbox.data,
            &sandbox.config,
            &sandbox.state,
            &sandbox.work,
        ] {
            fs::create_dir_all(folder).unwrap();
        }
        sandbox
    }

    pub fn script(&self, shell: &str) -> PathBuf {
        match shell {
            "bash" => self.data.join("jsonkit/completion/jsonkit.bash"),
            "fish" => self.config.join("fish/completions/jsonkit.fish"),
            "pwsh" => self.data.join("jsonkit/completion/jsonkit.pwsh.ps1"),
            "zsh" => self.data.join("jsonkit/completion/zsh/_loom_jsonkit"),
            other => panic!("no script for {other}"),
        }
    }

    pub fn record_path(&self, shell: &str) -> PathBuf {
        self.state
            .join(format!("jsonkit/installation/completion.{shell}.json"))
    }

    /// What a shell's plugin's file records, with `lines` an empty list when it records none.
    pub fn recorded(&self, shell: &str) -> Value {
        let mut file: Value =
            serde_json::from_str(&fs::read_to_string(self.record_path(shell)).unwrap()).unwrap();
        if file.get("lines").is_none() {
            file["lines"] = json!([]);
        }
        file
    }

    /// Rewrites a shell's plugin's file with the change applied.
    pub fn edit_record(&self, shell: &str, change: impl FnOnce(&mut Value)) {
        let mut file: Value =
            serde_json::from_str(&fs::read_to_string(self.record_path(shell)).unwrap()).unwrap();
        change(&mut file);
        fs::write(self.record_path(shell), format!("{file}\n")).unwrap();
    }

    /// The tree of the home, data, and state folders.
    pub fn trees(&self) -> BTreeMap<String, String> {
        let mut all = tree(&self.home);
        all.extend(tree(&self.data));
        all.extend(tree(&self.state));
        all
    }

    /// The sandbox keeps its folder alive until it drops.
    pub fn keep(&self) -> &TempDir {
        &self.dir
    }
}

/// The scripts of the fixture `pwsh`: how each one answers.
#[derive(Clone)]
pub struct FakePwsh {
    pub program: String,
    pub answer: String,
    pub code: i32,
    pub crlf: bool,
    /// End the answer with a carriage return and no line feed.
    pub bare_cr: bool,
    pub abort_marker: Option<PathBuf>,
}

/// The host facts and environment a run adds to the sandbox's.
#[derive(Clone, Default)]
pub struct Scenario {
    pub columns: Option<u16>,
    pub env: Vec<(String, Option<String>)>,
    pub platform: Option<String>,
    pub cwd: Option<PathBuf>,
    pub abort_marker: Option<PathBuf>,
    pub programs: Vec<FakePwsh>,
}

impl Scenario {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn env(mut self, name: &str, value: &str) -> Self {
        self.env.push((name.to_owned(), Some(value.to_owned())));
        self
    }

    pub fn unset(mut self, name: &str) -> Self {
        self.env.push((name.to_owned(), None));
        self
    }

    pub fn platform(mut self, platform: &str) -> Self {
        self.platform = Some(platform.to_owned());
        self
    }

    pub fn columns(mut self, columns: u16) -> Self {
        self.columns = Some(columns);
        self
    }

    pub fn cwd(mut self, cwd: &Path) -> Self {
        self.cwd = Some(cwd.to_path_buf());
        self
    }

    pub fn abort_marker(mut self, marker: &Path) -> Self {
        self.abort_marker = Some(marker.to_path_buf());
        self
    }

    pub fn program(mut self, program: FakePwsh) -> Self {
        self.programs.push(program);
        self
    }

    /// The `pwsh` environment of a case: the fixture's folder alone on `PATH`, so a real pwsh on the
    /// runner is never found, and its log.
    pub fn pwsh_env(self, sandbox: &Sandbox, bin: &Path) -> Self {
        self.env("PATH", &bin.to_string_lossy())
            .env("PWSH_LOG", &sandbox.root.join("pwsh.log").to_string_lossy())
    }
}

/// The user the tests run as, which the fixture host reports so a file the test made is its own.
pub fn current_uid() -> u32 {
    rustix::process::getuid().as_raw()
}

/// The mock fields of a run in the sandbox.
pub fn fields(sandbox: &Sandbox, argv: &[&str], scenario: &Scenario) -> MockFields {
    let mut env: BTreeMap<String, Option<String>> = BTreeMap::new();
    for (name, value) in [
        ("HOME", sandbox.home.to_string_lossy().into_owned()),
        (
            "XDG_CONFIG_HOME",
            sandbox.config.to_string_lossy().into_owned(),
        ),
        ("XDG_DATA_HOME", sandbox.data.to_string_lossy().into_owned()),
        (
            "XDG_STATE_HOME",
            sandbox.state.to_string_lossy().into_owned(),
        ),
    ] {
        env.insert(name.to_owned(), Some(value));
    }
    for (name, value) in &scenario.env {
        env.insert(name.clone(), value.clone());
    }
    let home = env.get("HOME").cloned().flatten().unwrap_or_default();
    let mut mock = MockFields::new()
        .argv(argv.iter().map(|word| (*word).to_owned()))
        .cwd(scenario.cwd.clone().unwrap_or_else(|| sandbox.work.clone()))
        .home(home)
        .platform(
            scenario
                .platform
                .clone()
                .unwrap_or_else(|| "linux".to_owned()),
        )
        .uid(Some(current_uid()));
    for (name, value) in env {
        if let Some(value) = value {
            mock = mock.env(&name, &value);
        }
    }
    if let Some(columns) = scenario.columns {
        mock = mock.terminal(MockTerminal::new(columns, 24));
    }
    for fake in &scenario.programs {
        let fake = fake.clone();
        mock = mock.script(&fake.program.clone(), move |call| {
            let fake = fake.clone();
            async move {
                let log = call
                    .env
                    .get("PWSH_LOG")
                    .cloned()
                    .ok_or_else(|| io::Error::other("The fixture requires PWSH_LOG."))?;
                let cwd = fs::canonicalize(&call.cwd)?;
                fs::write(
                    &log,
                    format!("{}\n{}\n", cwd.display(), call.args.join("\n")),
                )?;
                if let Some(marker) = &fake.abort_marker {
                    fs::write(marker, "")?;
                    call.signal.cancelled().await;
                    return Ok(ProgramAnswer::new());
                }
                let stdout = if fake.code == 1 {
                    String::new()
                } else {
                    format!(
                        "{}{}",
                        fake.answer,
                        if fake.bare_cr {
                            "\r"
                        } else if fake.crlf {
                            "\r\n"
                        } else {
                            "\n"
                        }
                    )
                };
                Ok(ProgramAnswer::new().code(fake.code).stdout(stdout))
            }
        });
    }
    mock
}

/// Runs `jsonkit ...argv` in the sandbox.
pub async fn run(sandbox: &Sandbox, argv: &[&str], scenario: Scenario) -> Ran {
    let process = mock_process(fields(sandbox, argv, &scenario));
    let token = tokio_util::sync::CancellationToken::new();
    let watcher = scenario.abort_marker.clone().map(|marker| {
        let token = token.clone();
        tokio::spawn(async move {
            loop {
                if marker.exists() {
                    token.cancel();
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
    });
    let code = jsonkit()
        .run(
            RunOptions::new()
                .process(Arc::clone(&process) as Arc<dyn ProcessHandle>)
                .signal(token),
        )
        .await;
    if let Some(watcher) = watcher {
        watcher.abort();
    }
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// Runs `completion ...words` in the sandbox with the default scenario.
pub async fn completion_run(sandbox: &Sandbox, words: &[&str]) -> Ran {
    let mut argv = vec!["completion"];
    argv.extend_from_slice(words);
    run(sandbox, &argv, Scenario::new()).await
}

/// The lines a run wrote to stderr, each with any lane glyph and the space after it removed.
pub fn lines(stderr: &str) -> Vec<String> {
    stderr
        .trim()
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut characters = line.chars();
            match (characters.next(), characters.next()) {
                (Some(first), Some(' ')) if !first.is_ascii() => characters.as_str().to_owned(),
                _ => line.to_owned(),
            }
        })
        .collect()
}

/// The printed script of a shell, read from the print child.
pub async fn printed(sandbox: &Sandbox, shell: &str) -> String {
    completion_run(sandbox, &[shell]).await.stdout
}

pub const MARKER: &str = "# added by jsonkit completion install";

pub fn bash_line(script: &Path) -> String {
    format!(
        "if [ -n \"${{BASH_VERSION-}}\" ] && [ -f '{0}' ]; then . '{0}'; fi {MARKER}",
        script.display()
    )
}

pub fn zsh_line(script: &Path) -> String {
    format!(
        "fpath=('{}' $fpath); if [ -f '{1}' ]; then . '{1}'; fi {MARKER}",
        script.parent().unwrap().display(),
        script.display()
    )
}

pub fn powershell_line(script: &Path) -> String {
    format!(
        "if (Test-Path -LiteralPath '{0}') {{ . '{0}' }} {MARKER}",
        script.display()
    )
}

pub fn digest(text: &str) -> String {
    digest_of(text.as_bytes())
}

/// The permission bits of a path.
pub fn mode_of(path: &Path) -> u32 {
    fs::symlink_metadata(path).unwrap().permissions().mode() & 0o777
}

/// The inode of a path.
pub fn inode_of(path: &Path) -> u64 {
    fs::symlink_metadata(path).unwrap().ino()
}

/// Every entry under a path with its kind, permission bits, and content, without following a link.
pub fn tree(path: &Path) -> BTreeMap<String, String> {
    fn walk(current: &Path, key: String, entries: &mut BTreeMap<String, String>) {
        match fs::symlink_metadata(current) {
            Err(_) => {
                entries.insert(key, "absent".to_owned());
            }
            Ok(metadata) if metadata.file_type().is_symlink() => {
                entries.insert(
                    key,
                    format!("link {}", fs::read_link(current).unwrap().display()),
                );
            }
            Ok(metadata) if metadata.is_dir() => {
                entries.insert(
                    key.clone(),
                    format!("directory {:o}", metadata.permissions().mode() & 0o777),
                );
                let mut names: Vec<_> = fs::read_dir(current)
                    .unwrap()
                    .map(|entry| entry.unwrap().file_name())
                    .collect();
                names.sort();
                for name in names {
                    walk(
                        &current.join(&name),
                        format!("{key}/{}", name.to_string_lossy()),
                        entries,
                    );
                }
            }
            Ok(metadata) => {
                let content: String = fs::read(current)
                    .map(|bytes| bytes.iter().map(|byte| char::from(*byte)).collect())
                    .unwrap_or_default();
                entries.insert(
                    key,
                    format!("file {:o} {content}", metadata.permissions().mode() & 0o777),
                );
            }
        }
    }
    let mut entries = BTreeMap::new();
    walk(path, ".".to_owned(), &mut entries);
    entries
}

/// The sorted names directly in a folder.
pub fn names_in(path: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(path)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// A fixture `pwsh` in `folder`: a shell script that records how it ran and answers the given
/// text, and the scenario entry that stands for running it.
pub fn fake_pwsh(folder: &Path, answer: &str, code: i32, crlf: bool) -> (PathBuf, FakePwsh) {
    fs::create_dir_all(folder).unwrap();
    let program = folder.join("pwsh");
    fs::write(
        &program,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$PWD\" \"$@\" > \"$PWSH_LOG\"\nprintf '%s\\n' '{answer}'\n"
        ),
    )
    .unwrap();
    fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
    let fake = FakePwsh {
        program: program.to_string_lossy().into_owned(),
        answer: answer.to_owned(),
        code,
        crlf,
        bare_cr: false,
        abort_marker: None,
    };
    (program, fake)
}

/// The answer PowerShell gives: its profile's path in Base64 of its UTF-8 bytes.
pub fn answer_of(profile: &str) -> String {
    base64(profile.as_bytes())
}

/// Standard Base64 with padding.
pub fn base64(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut text = String::new();
    for chunk in bytes.chunks(3) {
        let mut block = u32::from(chunk[0]) << 16;
        if let Some(second) = chunk.get(1) {
            block |= u32::from(*second) << 8;
        }
        if let Some(third) = chunk.get(2) {
            block |= u32::from(*third);
        }
        for index in 0..4 {
            if index <= chunk.len() {
                text.push(char::from(
                    DIGITS[((block >> (18 - 6 * index)) & 63) as usize],
                ));
            } else {
                text.push('=');
            }
        }
    }
    text
}

/// Asserts that every key and element `expected` states is in `actual`, as Jest's `toMatchObject`
/// reads them: objects by key, arrays by length and position.
pub fn assert_subset(actual: &Value, expected: &Value) {
    fn subset(actual: &Value, expected: &Value) -> bool {
        match (actual, expected) {
            (Value::Object(actual), Value::Object(expected)) => expected
                .iter()
                .all(|(key, value)| actual.get(key).is_some_and(|found| subset(found, value))),
            (Value::Array(actual), Value::Array(expected)) => {
                actual.len() == expected.len()
                    && actual.iter().zip(expected).all(|(a, e)| subset(a, e))
            }
            _ => actual == expected,
        }
    }
    assert!(
        subset(actual, expected),
        "{actual} does not match {expected}"
    );
}
