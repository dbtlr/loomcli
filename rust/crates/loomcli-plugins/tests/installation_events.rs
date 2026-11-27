//! Change events emitted by the installing Commands.

#![cfg(all(
    feature = "completion",
    feature = "manpage",
    feature = "skills",
    feature = "verbose"
))]
#![allow(clippy::unwrap_used)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Build, Command, Context, LogLevel, Plugin, ReleaseFacts, RunOptions,
};
use loomcli_plugins::{
    completion::completion,
    manpage::manpage,
    skills::{Skill, SkillFile, skills},
    verbose::verbose,
};
use loomcli_testing::{MockFields, mock_process};

struct Sandbox {
    root: PathBuf,
    home: PathBuf,
    data: PathBuf,
    state: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
            "loom-installation-events-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        Self {
            data: root.join("data"),
            state: root.join("state"),
            root,
            home,
        }
    }
    fn record(&self, file: &str) -> PathBuf {
        self.state.join("notes/installation").join(file)
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct Ran {
    status: u8,
    stderr: String,
    changes: Vec<(String, PathBuf)>,
}

async fn run(sandbox: &Sandbox, argv: &[&str], names: &[&str]) -> Ran {
    let changes = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/observer").on_log({
        let changes = Arc::clone(&changes);
        move |event, _| {
            if matches!(event.message.as_str(), "File written." | "File removed.") {
                assert_eq!(event.level, LogLevel::Info);
                assert!(matches!(
                    event.plugin.as_deref(),
                    Some(
                        "@loomcli/plugins/completion"
                            | "@loomcli/plugins/manpage"
                            | "@loomcli/plugins/skills"
                    )
                ));
                changes.lock().unwrap().push((
                    event.message.clone(),
                    PathBuf::from(event.fields["path"].as_str().unwrap()),
                ));
            }
        }
    });
    let listed = names
        .iter()
        .map(|name| Skill::loaded(*name, || Ok(vec![SkillFile::new("SKILL.md", "# Notes\n")])))
        .collect();
    let app = Application::new("notes")
        .description("Keep notes.")
        .plugins((
            completion(),
            manpage(),
            skills(listed).plugin(),
            verbose(),
            observer,
        ))
        .command(
            Command::new("ping")
                .description("Answer.")
                .action(|_: Context| async { Ok(()) }),
        );
    let mock = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .cwd(&sandbox.root)
            .home(&sandbox.home)
            .env("HOME", &sandbox.home.to_string_lossy())
            .env("XDG_DATA_HOME", &sandbox.data.to_string_lossy())
            .env("XDG_STATE_HOME", &sandbox.state.to_string_lossy())
            .platform("linux")
            .uid(Some(rustix::process::geteuid().as_raw()))
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let status = app.run(RunOptions::new().process(mock.clone())).await.get();
    let changes = changes.lock().unwrap().clone();
    Ran {
        status,
        stderr: mock.stderr_text(),
        changes,
    }
}

fn wrote(path: &Path) -> (String, PathBuf) {
    ("File written.".to_owned(), path.to_path_buf())
}

fn removed(path: &Path) -> (String, PathBuf) {
    ("File removed.".to_owned(), path.to_path_buf())
}

#[tokio::test]
async fn completion_records_its_script_startup_file_and_record_writes_and_removals() {
    let sandbox = Sandbox::new();
    let record = sandbox.record("completion.bash.json");
    let script = sandbox.data.join("notes/completion/notes.bash");
    let startup = sandbox.home.join(".bashrc");
    let first = run(&sandbox, &["completion", "install", "bash"], &[]).await;
    assert_eq!(first.status, 0, "{}", first.stderr);
    assert_eq!(
        first.changes,
        [
            wrote(&record),
            wrote(&script),
            wrote(&startup),
            wrote(&record)
        ]
    );
    let again = run(&sandbox, &["-vv", "completion", "install", "bash"], &[]).await;
    assert_eq!(again.status, 0, "{}", again.stderr);
    assert_eq!(again.changes, []);
    assert!(!again.stderr.contains(['›', '┆']));
    let uninstall = run(&sandbox, &["completion", "uninstall", "bash"], &[]).await;
    assert_eq!(uninstall.status, 0, "{}", uninstall.stderr);
    assert_eq!(
        uninstall.changes,
        [removed(&script), wrote(&startup), removed(&record)]
    );
}

#[tokio::test]
async fn an_uninstall_with_nothing_installed_records_no_removal() {
    let sandbox = Sandbox::new();
    for argv in [
        &["manpage", "uninstall"][..],
        &["completion", "uninstall", "bash"],
        &["completion", "uninstall"],
        &["skills", "uninstall", "--agent", "agents"],
    ] {
        let seen = run(&sandbox, argv, &["notes"]).await;
        assert_eq!(seen.changes, [], "{argv:?}: {}", seen.stderr);
    }
}

#[tokio::test]
async fn a_leftover_staging_file_is_recorded_before_the_writes() {
    let sandbox = Sandbox::new();
    let staging = sandbox.record(".manpage.json.0123456789abcdef.loom-staging");
    fs::create_dir_all(staging.parent().unwrap()).unwrap();
    fs::write(&staging, "partial").unwrap();
    let installed = run(&sandbox, &["manpage", "install"], &[]).await;
    assert_eq!(installed.status, 0, "{}", installed.stderr);
    assert_eq!(installed.changes.first(), Some(&removed(&staging)));
    assert!(
        installed.changes[1..]
            .iter()
            .all(|(message, _)| message == "File written.")
    );
}

#[tokio::test]
async fn manpage_records_each_page_and_installation_record_write() {
    let sandbox = Sandbox::new();
    let record = sandbox.record("manpage.json");
    let page = sandbox.home.join(".local/share/man/man1/notes.1");
    let installed = run(&sandbox, &["manpage", "install"], &[]).await;
    assert_eq!(installed.status, 0, "{}", installed.stderr);
    assert_eq!(installed.changes.first(), Some(&wrote(&record)));
    assert!(installed.changes.contains(&wrote(&page)));
    assert_eq!(installed.changes.last(), Some(&wrote(&record)));
    let out = sandbox.root.join("build");
    let generated = run(
        &sandbox,
        &["manpage", "generate", "--out", out.to_str().unwrap()],
        &[],
    )
    .await;
    assert_eq!(generated.status, 0, "{}", generated.stderr);
    assert!(generated.changes.contains(&wrote(&out.join("notes.1"))));
    assert!(
        generated
            .changes
            .iter()
            .all(|(message, _)| message == "File written.")
    );
}

#[tokio::test]
async fn each_skill_folder_has_one_event_globally_and_in_the_project() {
    let sandbox = Sandbox::new();
    let folder = sandbox.home.join(".agents/skills/notes");
    let record = sandbox.record("skills.agents.json");
    let first = run(
        &sandbox,
        &["skills", "install", "--agent", "agents"],
        &["notes"],
    )
    .await;
    assert_eq!(first.status, 0, "{}", first.stderr);
    assert_eq!(
        first.changes,
        [wrote(&record), wrote(&folder), wrote(&record)]
    );
    let uninstall = run(
        &sandbox,
        &["skills", "uninstall", "--agent", "agents"],
        &["notes"],
    )
    .await;
    assert_eq!(uninstall.status, 0, "{}", uninstall.stderr);
    assert_eq!(uninstall.changes, [removed(&folder), removed(&record)]);

    fs::create_dir(sandbox.root.join(".git")).unwrap();
    let project = sandbox.root.join(".agents/skills/notes");
    let leftover = project.with_file_name(".notes.0123456789abcdef.loom-staging");
    fs::create_dir_all(&leftover).unwrap();
    let installed = run(
        &sandbox,
        &["skills", "install", "--project", "--agent", "agents"],
        &["notes"],
    )
    .await;
    assert_eq!(installed.status, 0, "{}", installed.stderr);
    assert_eq!(installed.changes, [removed(&leftover), wrote(&project)]);
}

#[tokio::test]
async fn an_uninstall_that_fails_partway_records_the_removal_that_succeeded() {
    use std::os::unix::fs::PermissionsExt;

    if rustix::process::geteuid().is_root() {
        return;
    }
    let sandbox = Sandbox::new();
    let names = &["notes", "other"];
    let first = sandbox.home.join(".agents/skills/notes");
    let second = sandbox.home.join(".agents/skills/other");
    let installed = run(&sandbox, &["skills", "install", "--agent", "agents"], names).await;
    assert_eq!(installed.status, 0, "{}", installed.stderr);
    fs::set_permissions(&second, fs::Permissions::from_mode(0o555)).unwrap();
    let result = run(
        &sandbox,
        &["skills", "uninstall", "--agent", "agents"],
        names,
    )
    .await;
    fs::set_permissions(&second, fs::Permissions::from_mode(0o755)).unwrap();
    assert_ne!(result.status, 0, "{}", result.stderr);
    assert_eq!(result.changes, [removed(&first)]);
}
