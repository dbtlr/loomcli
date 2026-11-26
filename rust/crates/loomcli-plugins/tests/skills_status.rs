//! The skills status command through the mock process and a sandbox of real installation files.

#![cfg(all(feature = "skills", feature = "format"))]
#![allow(clippy::unwrap_used)]

mod skills_support;

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::PathBuf;

use loomcli_core::{Application, Build, Command, Context};
use loomcli_plugins::format::format;
use loomcli_plugins::skills::{Skill, SkillFile, Skills, skills};
use serde_json::{Value, json};
use skills_support::{
    App, Ran, Sandbox, Scenario, folder_of, record_path, run_application, sandbox,
};

const INDEX: &str = "references/commands/index.md";
const REFERENCE: &str = "references/commands/notes-list.md";
const CLAUDE: &[&str] = &["install", "--agent", "claude"];
const STALE_NOTE: &str =
    "Run notes skills update to bring it up to date, once no skill reads modified or unmanaged.";
const MODIFIED_NOTE: &str = "Its command references changed since notes skills install wrote them, so notes skills update will not replace it. Copy the changed files elsewhere to keep them, then run notes skills install --agent claude --force to replace the folder.";

fn notes(extra: &[&str]) -> Skill {
    let files = std::iter::once(SkillFile::new("SKILL.md", "# Notes"))
        .chain(extra.iter().map(|path| SkillFile::new(*path, "new")));
    Skill::new("notes", files)
}

fn application_with(settings: Skills, description: &str) -> App {
    Application::new("notes")
        .plugins((format(), settings))
        .command(
            Command::new("list")
                .description(description)
                .action(|_: Context| async { Ok(()) }),
        )
}

fn version(description: &str, extras: &[&str]) -> App {
    application_with(
        skills(vec![notes(extras)]).select_commands("notes", [["list"]]),
        description,
    )
}

fn application() -> App {
    version("List notes.", &[])
}

struct Fixture {
    sandbox: Sandbox,
    app: App,
    folder: PathBuf,
    record: PathBuf,
    scenario: Scenario,
}

impl Fixture {
    fn new() -> Self {
        let sandbox = sandbox();
        fs::create_dir(sandbox.repo.join(".git")).unwrap();
        let folder = folder_of(&sandbox, "claude", "notes");
        let record = record_path(&sandbox, "claude");
        Self {
            sandbox,
            app: application(),
            folder,
            record,
            scenario: Scenario::default().build(Build::Source),
        }
    }

    async fn run_with(&self, app: &App, words: &[&str]) -> Ran {
        let argv = ["skills"]
            .into_iter()
            .chain(words.iter().copied())
            .collect::<Vec<_>>();
        run_application(app, &self.sandbox, &argv, &self.scenario).await
    }

    async fn run(&self, words: &[&str]) -> Ran {
        self.run_with(&self.app, words).await
    }

    async fn succeed_with(&self, app: &App, words: &[&str]) -> Ran {
        let ran = self.run_with(app, words).await;
        assert_eq!(ran.status, 0, "{words:?}: {}", ran.stderr);
        ran
    }

    async fn succeed(&self, words: &[&str]) -> Ran {
        self.succeed_with(&self.app, words).await
    }

    async fn row_with(&self, app: &App, words: &[&str]) -> Value {
        let argv = ["status", "--agent", "claude", "--format", "json"]
            .into_iter()
            .chain(words.iter().copied())
            .collect::<Vec<_>>();
        let ran = self.succeed_with(app, &argv).await;
        let [row]: [Value; 1] = serde_json::from_str(&ran.stdout).unwrap();
        row
    }

    async fn row(&self, words: &[&str]) -> Value {
        self.row_with(&self.app, words).await
    }

    fn recorded(&self) -> Value {
        serde_json::from_str(&fs::read_to_string(&self.record).unwrap()).unwrap()
    }

    fn files(&self) -> Value {
        self.recorded()["folders"][0]["files"].clone()
    }

    fn write_record(&self, record: &Value) {
        fs::write(&self.record, record.to_string()).unwrap();
    }

    fn pending(&self, prior: Value, intended: Value) {
        let mut record = self.recorded();
        record["state"] = json!("pending");
        record["folders"] = json!([{ "path": self.folder, "prior": prior, "intended": intended }]);
        self.write_record(&record);
    }

    fn format_one(&self) {
        let mut record = self.recorded();
        record["format"] = json!(1);
        record["folders"] = json!([{ "path": self.folder }]);
        self.write_record(&record);
    }

    fn changed(&self, file: &str) {
        fs::write(self.folder.join(file), "edited").unwrap();
    }

    fn unreadable_record(&self) -> Ran {
        let path = self.record.display();
        Ran { status: 1, stdout: String::new(), stderr: format!(
            "{path} cannot be read, so notes cannot tell which skills it installed. Remove it and the folders it lists, then run notes skills install again.
",
        ) }
    }

    fn global_row(&self, state: &str, files: &[&str]) -> Value {
        let notes = match state {
            "missing" => vec![
                "Run notes skills install --agent claude to install it, once no skill reads modified or unmanaged.",
            ],
            "modified" => vec![MODIFIED_NOTE],
            "stale" => vec![STALE_NOTE],
            "unmanaged" => vec![
                "The installation record does not list what is at this path. Remove it, or run notes skills install --agent claude --force to replace it.",
            ],
            _ => Vec::new(),
        };
        json!({ "skill": "notes", "target": "claude", "scope": "global", "state": state,
            "folder": self.folder, "files": files, "notes": notes })
    }
}

#[tokio::test]
async fn missing_skills_are_reported_in_target_order_without_writing() {
    let box_ = sandbox();
    let ran = run_application(
        &application(),
        &box_,
        &["skills", "status", "--format", "json"],
        &Scenario::default().build(Build::Source),
    )
    .await;
    let rows = ["claude", "agents"].map(|target| json!({
        "skill": "notes",
        "target": target,
        "scope": "global",
        "state": "missing",
        "folder": folder_of(&box_, target, "notes"),
        "files": [],
        "notes": [format!("Run notes skills install --agent {target} to install it, once no skill reads modified or unmanaged.")],
    }));
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert_eq!(
        ran.stdout,
        format!("{}\n", serde_json::to_string_pretty(&rows).unwrap())
    );
    assert_eq!(ran.stderr, "");
    assert_eq!(std::fs::read_dir(&box_.home).unwrap().count(), 0);
    assert_eq!(std::fs::read_dir(&box_.state).unwrap().count(), 0);
}

#[tokio::test]
async fn status_names_the_recorded_path_below_a_blocking_file() {
    let box_ = sandbox();
    let app = application();
    let scenario = Scenario::default().build(Build::Source);
    let installed = run_application(
        &app,
        &box_,
        &["skills", "install", "--agent", "claude"],
        &scenario,
    )
    .await;
    assert_eq!(installed.status, 0, "{}", installed.stderr);
    let folder = folder_of(&box_, "claude", "notes");
    let skills_dir = folder.parent().unwrap();
    std::fs::remove_dir_all(skills_dir).unwrap();
    std::fs::write(skills_dir, "blocking file").unwrap();
    let record = skills_support::record_path(&box_, "claude");
    let before = std::fs::read(&record).unwrap();
    for words in [
        ["skills", "status"],
        ["skills", "install"],
        ["skills", "uninstall"],
    ] {
        let ran = run_application(&app, &box_, &words, &scenario).await;
        assert_eq!(
            ran,
            skills_support::Ran {
                status: 1,
                stdout: String::new(),
                stderr: format!(
                    "Cannot reach {} because a file sits where one of its folders is needed. Remove or rename that file, then run the command again.\n",
                    folder.display()
                ),
            }
        );
        assert_eq!(std::fs::read(&record).unwrap(), before);
        assert_eq!(
            std::fs::read_to_string(skills_dir).unwrap(),
            "blocking file"
        );
    }
}

#[tokio::test]
async fn the_record_marks_generated_references_and_status_protects_edits() {
    let box_ = sandbox();
    let app = application();
    let scenario = Scenario::default().build(Build::Source);
    let run = |words| run_application(&app, &box_, words, &scenario);
    let installed = run(&["skills", "install", "--agent", "claude"]).await;
    assert_eq!(installed.status, 0, "{}", installed.stderr);
    let folder = folder_of(&box_, "claude", "notes");
    let record = skills_support::record_path(&box_, "claude");
    let original_record = std::fs::read_to_string(&record).unwrap();
    let held: serde_json::Value = serde_json::from_str(&original_record).unwrap();
    assert_eq!(held["format"], 2);
    let files = held["folders"][0]["files"].as_array().unwrap();
    assert_eq!(
        files
            .iter()
            .map(|file| file["path"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "SKILL.md",
            "references/commands/index.md",
            "references/commands/notes-list.md"
        ]
    );
    assert!(files[0].get("generated").is_none());
    for file in &files[1..] {
        assert_eq!(file["generated"], true);
        assert_eq!(
            file.as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["path", "digest", "generated"]
        );
    }
    // The digests of the three declared file bodies, in record order.
    let digests = [
        "sha256:360aa5ebfa18efd19f60eb2432c11d53e21586ff3a392ca246980970de15f0c4",
        "sha256:bc4ddd5a8070146e44fe095c0feb8fa9b45fc357dce5f6b749f434c429cbf9cf",
        "sha256:a431e305d02c0d97454ffad9d24ff923489e8020db47479414fc7fbe9cc22a0b",
    ];
    for (file, digest) in files.iter().zip(digests) {
        assert_eq!(file["digest"], digest);
    }
    let reference = folder.join(REFERENCE);
    std::fs::write(folder.join(".DS_Store"), "extra").unwrap();
    let report = run(&["skills", "status", "--agent", "claude", "--format", "json"]).await;
    assert!(report.stdout.contains("\"state\": \"current\""));
    std::fs::write(folder.join("SKILL.md"), "edited").unwrap();
    let report = run(&["skills", "status", "--agent", "claude", "--format", "json"]).await;
    assert!(report.stdout.contains("\"state\": \"stale\""));
    assert_eq!(run(&["skills", "update"]).await.status, 0);
    assert_eq!(
        std::fs::read_to_string(folder.join("SKILL.md")).unwrap(),
        "# Notes"
    );
    assert_eq!(
        std::fs::read_to_string(&reference).unwrap(),
        "# notes list\n\nList notes.\n\n## Usage\n\n```text\nnotes list [options]\n```\n"
    );
    std::fs::write(&reference, "keep me").unwrap();
    let status = run(&["skills", "status", "--agent", "claude", "--format", "json"]).await;
    assert_eq!(status.status, 0, "{}", status.stderr);
    let rows: serde_json::Value = serde_json::from_str(&status.stdout).unwrap();
    assert_eq!(rows[0]["state"], "modified");
    assert_eq!(
        rows[0]["files"],
        json!(["references/commands/notes-list.md"])
    );
    assert_eq!(std::fs::read_to_string(&record).unwrap(), original_record);
    let update = run(&["skills", "update"]).await;
    assert_eq!(update.status, 1);
    assert!(
        update
            .stderr
            .contains("changed since notes skills install wrote it.")
    );
    assert_eq!(std::fs::read_to_string(&reference).unwrap(), "keep me");
    std::fs::write(folder.join(INDEX), "edited").unwrap();
    let forced = run(&["skills", "install", "--agent", "claude", "--force"]).await;
    assert_eq!(forced.status, 0, "{}", forced.stderr);
    assert_eq!(
        forced
            .stderr
            .matches("whose command references changed since notes skills install wrote them.")
            .count(),
        1
    );
    assert_eq!(std::fs::read_to_string(&record).unwrap(), original_record);
    std::fs::write(&reference, "keep me").unwrap();
    let removed = run(&["skills", "uninstall", "--agent", "claude"]).await;
    assert_eq!(removed.status, 0, "{}", removed.stderr);
    assert!(removed.stderr.contains("was left in place"));
    assert_eq!(std::fs::read_to_string(&reference).unwrap(), "keep me");
    assert!(!record.exists());
    let report = run(&["skills", "status", "--agent", "claude", "--format", "json"]).await;
    assert!(report.stdout.contains("\"state\": \"unmanaged\""));
}

#[tokio::test]
async fn status_uses_its_own_json_view_and_the_appended_jsonl_view() {
    let f = Fixture::new();
    let row = f.global_row("missing", &[]);
    let json = f
        .succeed(&["status", "--agent", "claude", "--format", "json"])
        .await;
    assert_eq!(
        json.stdout,
        format!("{}\n", serde_json::to_string_pretty(&[&row]).unwrap())
    );
    let jsonl = f
        .succeed(&["status", "--agent", "claude", "--format", "jsonl"])
        .await;
    assert_eq!(jsonl.stdout, format!("{row}\n"));
}

#[tokio::test]
async fn status_refuses_fields_under_its_own_json_view_and_names_only_the_appended_jsonl_view() {
    let f = Fixture::new();
    let ran = f
        .run(&["status", "--format", "json", "--fields", "skill,state"])
        .await;
    assert_eq!(ran.status, 2);
    assert_eq!(ran.stdout, "");
    assert_eq!(
        ran.stderr,
        format!(
            "{{\"error\":{{\"code\":\"invalid-input\",\"exitCode\":2,\"message\":{},\"hints\":[]}}}}\n",
            serde_json::to_string(
                "Option \"--fields\" applies only to the jsonl output the formatter provides. Remove the option, or select jsonl with \"--format\"."
            )
            .unwrap()
        )
    );
}

#[tokio::test]
async fn graph_changes_missing_files_and_executable_changes_read_stale() {
    let f = Fixture::new();
    f.succeed(&["install"]).await;
    f.succeed(&["install", "--project"]).await;
    let next = version("A new description.", &[]);
    for args in [&[] as &[&str], &["--project"]] {
        let row = f.row_with(&next, args).await;
        assert_eq!(row["state"], "stale");
        assert_eq!(row["files"], json!([INDEX, REFERENCE]));
    }
    assert_eq!(f.row(&["--project"]).await["state"], "current");
    let entry = f.folder.join("SKILL.md");
    fs::set_permissions(&entry, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
    fs::set_permissions(&entry, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("stale", &["SKILL.md"]));
    fs::remove_file(f.folder.join(REFERENCE)).unwrap();
    assert_eq!(
        f.row(&[]).await,
        f.global_row("stale", &["SKILL.md", REFERENCE])
    );
    f.succeed(&["update"]).await;
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
}

#[tokio::test]
async fn status_leaves_format_one_and_pending_records_alone_and_update_rolls_them_forward() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.format_one();
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
    assert_eq!(f.recorded()["format"], 1);
    f.succeed(&["update"]).await;
    assert_eq!(f.recorded()["format"], 2);
    f.pending(json!("path"), f.files());
    fs::write(f.folder.join(".DS_Store"), "extra").unwrap();
    let bytes = fs::read(&f.record).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
    assert_eq!(fs::read(&f.record).unwrap(), bytes);
    f.changed("SKILL.md");
    assert_eq!(f.row(&[]).await, f.global_row("stale", &["SKILL.md"]));
    f.succeed(&["update"]).await;
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
}

#[tokio::test]
async fn project_status_reports_missing_and_unmanaged_and_global_status_repairs_a_link() {
    let f = Fixture::new();
    assert_eq!(f.row(&["--project"]).await["state"], "missing");
    f.succeed(&["install", "--project", "--agent", "claude"])
        .await;
    let project = f.sandbox.repo.join(".claude/skills/notes");
    fs::remove_dir_all(&project).unwrap();
    symlink(&f.sandbox.home, project).unwrap();
    assert_eq!(f.row(&["--project"]).await["state"], "unmanaged");
    f.succeed(CLAUDE).await;
    fs::remove_dir_all(&f.folder).unwrap();
    symlink(&f.sandbox.home, &f.folder).unwrap();
    assert_eq!(
        f.row(&[]).await,
        f.global_row("stale", &["SKILL.md", INDEX, REFERENCE])
    );
    f.succeed(&["update"]).await;
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
}

#[tokio::test]
async fn text_blocks_and_refusal_leave_both_targets_unchanged() {
    let f = Fixture::new();
    f.succeed(&["install"]).await;
    let agents = folder_of(&f.sandbox, "agents", "notes");
    assert_eq!(
        f.succeed(&["status"]).await.stdout,
        format!(
            "notes for claude: current\n  folder  {}\n\nnotes for agents: current\n  folder  {}\n",
            f.folder.display(),
            agents.display(),
        )
    );
    fs::write(agents.join(REFERENCE), "changed").unwrap();
    let before = fs::read(f.folder.join(INDEX)).unwrap();
    let ran = f
        .run_with(&version("A new description.", &[]), &["update"])
        .await;
    assert_eq!(ran.status, 1);
    assert_eq!(fs::read(f.folder.join(INDEX)).unwrap(), before);
    assert_eq!(
        fs::read_to_string(agents.join(REFERENCE)).unwrap(),
        "changed"
    );
    assert_eq!(
        f.succeed(&["status", "--agent", "agents"]).await.stdout,
        format!(
            "notes for agents: modified\n  folder   {}\n  changed  {REFERENCE}\n  note     {}\n",
            agents.display(),
            MODIFIED_NOTE.replace("--agent claude", "--agent agents"),
        )
    );
}

#[tokio::test]
async fn force_leaves_a_modified_obsolete_skill_without_ownership() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.changed(REFERENCE);
    let other = application_with(
        skills(vec![Skill::new(
            "other",
            [SkillFile::new("SKILL.md", "# Other")],
        )]),
        "List notes.",
    );
    let report = f
        .succeed_with(&other, &["status", "--agent", "claude"])
        .await;
    assert!(
        report.stderr.contains(
            "a skill this version no longer declares, and command references in it changed",
        )
    );
    let ran = f
        .succeed_with(&other, &["install", "--force", "--agent", "claude"])
        .await;
    assert!(ran.stderr.contains(&format!(
        "{} was left in place, because command references in it changed since notes skills install wrote them.",
        f.folder.display(),
    )));
    assert_eq!(
        fs::read_to_string(f.folder.join(REFERENCE)).unwrap(),
        "edited"
    );
    assert_eq!(f.row(&[]).await, f.global_row("unmanaged", &[]));
}

#[tokio::test]
async fn a_reference_link_is_modified_and_a_link_above_it_is_stale() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    let reference = f.folder.join(REFERENCE);
    fs::remove_file(&reference).unwrap();
    symlink(f.folder.join("SKILL.md"), &reference).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("modified", &[REFERENCE]));
    f.succeed(&["install", "--force", "--agent", "claude"])
        .await;
    let commands = f.folder.join("references/commands");
    fs::remove_dir_all(&commands).unwrap();
    symlink(&f.sandbox.home, &commands).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("stale", &[INDEX, REFERENCE]));
    f.succeed(&["update"]).await;
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
}

#[tokio::test]
async fn malformed_records_refuse_without_writing() {
    for fault in ["missing prior", "false generated", "missing intended"] {
        let f = Fixture::new();
        f.succeed(CLAUDE).await;
        let mut malformed = f.recorded();
        match fault {
            "missing prior" => {
                malformed["state"] = json!("pending");
                malformed["folders"] = json!([{ "path": f.folder, "intended": f.files() }]);
            }
            "false generated" => malformed["folders"][0]["files"][1]["generated"] = json!(false),
            _ => {
                malformed["state"] = json!("pending");
                malformed["folders"] = json!([{ "path": f.folder, "prior": "path" }]);
            }
        }
        f.write_record(&malformed);
        assert_eq!(
            f.run(&["status", "--agent", "claude"]).await,
            f.unreadable_record(),
            "{fault}"
        );
        assert_eq!(
            fs::read_to_string(&f.record).unwrap(),
            malformed.to_string(),
            "{fault}"
        );
    }
}

#[tokio::test]
async fn stale_paths_use_code_point_order() {
    let f = Fixture::new();
    let private = "\u{e000}.md";
    let emoji = "\u{1f600}.md";
    let app = application_with(skills(vec![notes(&[emoji, private])]), "List notes.");
    f.succeed_with(&app, CLAUDE).await;
    f.changed(emoji);
    f.changed(private);
    assert_eq!(
        f.row_with(&app, &[]).await,
        f.global_row("stale", &[private, emoji])
    );
}

#[tokio::test]
async fn force_names_a_modified_folder_with_either_graph() {
    for description in ["List notes.", "A changed graph."] {
        let f = Fixture::new();
        f.succeed(CLAUDE).await;
        f.changed(REFERENCE);
        let ran = f
            .succeed_with(
                &version(description, &[]),
                &["install", "--agent", "claude", "--force"],
            )
            .await;
        assert_eq!(ran.stdout, "");
        assert_eq!(
            ran.stderr,
            format!(
                "ℹ Replaced {path}, whose command references changed since notes skills install wrote them.\n✔ Installed notes for claude in {path}.\n",
                path = f.folder.display(),
            )
        );
    }
}

#[tokio::test]
async fn pending_prior_digests_protect_an_edited_reference() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.pending(
        f.files(),
        json!([{ "path": "SKILL.md", "digest": format!("sha256:{}", "0".repeat(64)) }]),
    );
    f.changed(REFERENCE);
    let before = fs::read(&f.record).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("modified", &[REFERENCE]));
    assert_eq!(fs::read(&f.record).unwrap(), before);
    let refused = f.run(&["update"]).await;
    assert_eq!(refused.status, 1);
    assert!(refused.stderr.contains("notes-list.md"));
    assert_eq!(fs::read(&f.record).unwrap(), before);
    assert_eq!(
        fs::read_to_string(f.folder.join(REFERENCE)).unwrap(),
        "edited"
    );
    let ran = f.succeed(&["uninstall", "--agent", "claude"]).await;
    assert_eq!(
        ran.stderr,
        format!(
            "⚠ {} was left in place, because command references in it changed since notes skills install wrote them. Copy what you want to keep, then remove the folder.\n",
            f.folder.display(),
        )
    );
    assert_eq!(
        fs::read_to_string(f.folder.join(REFERENCE)).unwrap(),
        "edited"
    );
}

#[tokio::test]
async fn an_interrupted_graph_update_keeps_the_prior_digests_and_reads_stale() {
    let f = Fixture::new();
    let next = version("Changed.", &[]);
    f.succeed(CLAUDE).await;
    let other = Fixture::new();
    other.succeed_with(&next, CLAUDE).await;
    f.pending(f.files(), other.files());
    assert_eq!(
        f.row_with(&next, &[]).await,
        f.global_row("stale", &[INDEX, REFERENCE])
    );
    let updated = f.succeed_with(&next, &["update"]).await;
    assert_eq!(
        updated.stderr,
        format!("✔ Updated notes for claude in {}.\n", f.folder.display())
    );
    assert_eq!(f.row_with(&next, &[]).await, f.global_row("current", &[]));
}

#[tokio::test]
async fn an_update_finishes_a_pending_install_when_nothing_is_at_its_path() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.pending(Value::Null, f.files());
    fs::remove_dir_all(&f.folder).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("missing", &[]));
    let updated = f.succeed(&["update"]).await;
    assert_eq!(
        updated.stderr,
        format!("✔ Updated notes for claude in {}.\n", f.folder.display())
    );
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
}

#[tokio::test]
async fn a_completed_swap_keeps_intended_files_despite_unlisted_entries_and_a_differing_prior() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.pending(
        json!([{
            "path": REFERENCE, "digest": format!("sha256:{}", "0".repeat(64)), "generated": true,
        }]),
        f.files(),
    );
    fs::write(f.folder.join(".DS_Store"), "extra").unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
}

#[tokio::test]
async fn a_completed_swap_keeps_even_an_intended_file_the_new_version_drops() {
    let f = Fixture::new();
    f.succeed_with(&version("List notes.", &["old.md"]), CLAUDE)
        .await;
    f.pending(Value::Null, f.files());
    assert_eq!(f.row(&[]).await, f.global_row("stale", &["old.md"]));
}

#[tokio::test]
async fn an_executable_skill_file_is_stale_when_the_version_writes_it_plain() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    fs::set_permissions(f.folder.join("SKILL.md"), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("stale", &["SKILL.md"]));
}

#[tokio::test]
async fn a_failed_fresh_pending_install_drops_ownership_of_an_occupant() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.pending(Value::Null, f.files());
    f.changed("SKILL.md");
    assert_eq!(f.row(&[]).await, f.global_row("unmanaged", &[]));
}

#[tokio::test]
async fn folder_links_to_identical_files_are_still_stale() {
    for skill_folder in [true, false] {
        let f = Fixture::new();
        f.succeed(CLAUDE).await;
        let path = if skill_folder {
            f.folder.clone()
        } else {
            f.folder.join("references/commands")
        };
        let copy = f.sandbox.root.join("copy");
        fs::rename(&path, &copy).unwrap();
        symlink(&copy, &path).unwrap();
        let files: &[&str] = if skill_folder {
            &["SKILL.md", INDEX, REFERENCE]
        } else {
            &[INDEX, REFERENCE]
        };
        assert_eq!(f.row(&[]).await, f.global_row("stale", files));
    }
}

#[tokio::test]
async fn a_deleted_recorded_folder_is_missing() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    fs::remove_dir_all(&f.folder).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("missing", &[]));
}

#[tokio::test]
async fn a_dropped_author_file_is_stale_and_update_removes_it() {
    let f = Fixture::new();
    f.succeed_with(&version("List notes.", &["old.md"]), CLAUDE)
        .await;
    assert_eq!(f.row(&[]).await, f.global_row("stale", &["old.md"]));
    f.succeed(&["update"]).await;
    assert!(!f.folder.join("old.md").exists());
}

#[tokio::test]
async fn modified_excludes_author_files_and_sorts_references() {
    let f = Fixture::new();
    let app = Application::new("notes")
        .plugins((
            format(),
            skills(vec![notes(&[])]).select_commands("notes", [["zeta"], ["alpha"]]),
        ))
        .command(Command::new("zeta").action(|_: Context| async { Ok(()) }))
        .command(Command::new("alpha").action(|_: Context| async { Ok(()) }));
    f.succeed_with(&app, CLAUDE).await;
    let alpha = "references/commands/notes-alpha.md";
    let zeta = "references/commands/notes-zeta.md";
    for file in ["SKILL.md", zeta, alpha] {
        f.changed(file);
    }
    assert_eq!(
        f.row_with(&app, &[]).await,
        f.global_row("modified", &[alpha, zeta])
    );
}

#[tokio::test]
async fn an_edited_reference_in_format_one_is_stale_and_replaceable() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.format_one();
    f.changed(REFERENCE);
    assert_eq!(f.row(&[]).await, f.global_row("stale", &[REFERENCE]));
    let updated = f.succeed(&["update"]).await;
    assert_eq!(
        updated.stderr,
        format!("✔ Updated notes for claude in {}.\n", f.folder.display())
    );
    assert_eq!(f.row(&[]).await, f.global_row("current", &[]));
}

#[tokio::test]
async fn a_format_one_upgrade_interrupted_by_permissions_keeps_ownership() {
    if rustix::process::geteuid().is_root() {
        return;
    }
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.format_one();
    f.changed("SKILL.md");
    let parent = f.folder.parent().unwrap();
    fs::set_permissions(parent, fs::Permissions::from_mode(0o555)).unwrap();
    let interrupted = f.run(&["update"]).await;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        interrupted,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!(
                "Cannot write {} because you do not have permission to write there. Make the location writable, then run the command again.\n",
                f.folder.display(),
            ),
        }
    );
    assert_eq!(f.recorded()["folders"][0]["prior"], "path");
    assert_eq!(f.row(&[]).await, f.global_row("stale", &["SKILL.md"]));
    let updated = f.succeed(&["update"]).await;
    assert_eq!(
        updated.stderr,
        format!("✔ Updated notes for claude in {}.\n", f.folder.display())
    );
}

#[tokio::test]
async fn a_spaced_root_is_one_shell_word_in_project_notes() {
    let f = Fixture::new();
    let root = f.sandbox.root.join("my notes");
    fs::create_dir_all(root.join(".git")).unwrap();
    let row = f
        .row(&["--project", "--directory", root.to_str().unwrap()])
        .await;
    assert_eq!(
        row["notes"],
        json!([format!(
            "Run notes skills install --project --agent claude --directory '{}' to install it.",
            root.display(),
        )])
    );
}

#[tokio::test]
async fn a_project_note_names_the_root_only_when_directory_was_supplied() {
    let f = Fixture::new();
    f.succeed(&["install", "--project", "--agent", "claude"])
        .await;
    let folder = f.sandbox.repo.join(".claude/skills/notes");
    fs::write(folder.join("SKILL.md"), "old").unwrap();
    for explicit in [false, true] {
        let mut args = vec!["--project"];
        if explicit {
            args.extend(["--directory", f.sandbox.repo.to_str().unwrap()]);
        }
        let root = if explicit {
            format!(" --directory {}", f.sandbox.repo.display())
        } else {
            String::new()
        };
        let note = format!(
            "Run notes skills install --project --agent claude{root} to replace it with this version's."
        );
        let row = f.row(&args).await;
        assert_eq!(
            row,
            json!({
                "skill": "notes", "target": "claude", "scope": "project", "state": "stale",
                "folder": folder, "files": ["SKILL.md"], "notes": [note],
            })
        );
        let stdout = f
            .succeed(
                &["status", "--agent", "claude"]
                    .into_iter()
                    .chain(args)
                    .collect::<Vec<_>>(),
            )
            .await
            .stdout;
        assert_eq!(
            stdout,
            format!(
                "notes for claude: stale\n  folder  {}\n  note    {note}\n",
                folder.display()
            )
        );
    }
}

#[tokio::test]
async fn a_file_at_a_project_skill_path_is_unmanaged() {
    let f = Fixture::new();
    let folder = f.sandbox.repo.join(".claude/skills/notes");
    fs::create_dir_all(folder.parent().unwrap()).unwrap();
    fs::write(&folder, "file").unwrap();
    assert_eq!(
        f.row(&["--project"]).await,
        json!({
            "skill": "notes", "target": "claude", "scope": "project", "state": "unmanaged",
            "folder": folder, "files": [], "notes": [
                "notes skills install --project did not write this, because it is not a folder. Run notes skills install --project --agent claude to replace it."
            ],
        })
    );
}

#[tokio::test]
async fn global_stale_text_and_unmanaged_notes_are_complete() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.changed("SKILL.md");
    let ran = f.succeed(&["status", "--agent", "claude"]).await;
    assert_eq!(ran.stderr, "");
    assert_eq!(
        ran.stdout,
        format!(
            "notes for claude: stale\n  folder  {}\n  note    {STALE_NOTE}\n",
            f.folder.display(),
        )
    );
    fs::remove_file(&f.record).unwrap();
    assert_eq!(f.row(&[]).await, f.global_row("unmanaged", &[]));
}

#[tokio::test]
async fn shared_global_skills_read_once_with_the_status_sentence() {
    let f = Fixture::new();
    f.succeed(&["install", "--agent", "agents"]).await;
    fs::create_dir(f.sandbox.home.join(".claude")).unwrap();
    let first = f.folder.parent().unwrap();
    let second = f.sandbox.home.join(".agents/skills");
    symlink(&second, first).unwrap();
    let ran = f.succeed(&["status", "--format", "json"]).await;
    assert_eq!(
        ran.stderr,
        format!(
            "ℹ {} is the same folder as {}, so notes reports on it once, for claude.\n",
            second.display(),
            first.display(),
        )
    );
    assert_eq!(
        serde_json::from_str::<Value>(&ran.stdout).unwrap(),
        json!([f.global_row("unmanaged", &[])])
    );
}

#[tokio::test]
async fn changed_references_refuse_install_and_update_with_the_complete_correction() {
    let f = Fixture::new();
    f.succeed(CLAUDE).await;
    f.changed(REFERENCE);
    let path = f.folder.join(REFERENCE);
    for verb in ["install", "update"] {
        let ran = f.run(&[verb]).await;
        assert_eq!(
            ran,
            Ran {
                status: 1,
                stdout: String::new(),
                stderr: format!(
                    "⚠ {} changed since notes skills install wrote it.\nnotes skills {verb} changed nothing, because folders it did not install, or whose command references changed since it installed them, are in the way. Copy any file you want to keep out of them, then remove them or run notes skills install --force to replace them.\n",
                    path.display(),
                ),
            }
        );
    }
}

#[tokio::test]
async fn obsolete_skill_notices_follow_the_folder_state() {
    for state in ["gone", "current", "modified"] {
        let f = Fixture::new();
        f.succeed(CLAUDE).await;
        let empty = application_with(skills(Vec::new()), "List notes.");
        match state {
            "gone" => fs::remove_dir_all(&f.folder).unwrap(),
            "modified" => f.changed(REFERENCE),
            _ => {}
        }
        let path = f.folder.display();
        let (notice, update) = match state {
            "current" => (
                format!(
                    "ℹ notes skills install recorded {path}, a skill this version no longer declares. Run notes skills update to remove it, once no skill reads modified or unmanaged.\n"
                ),
                format!("ℹ Removed {path}.\n"),
            ),
            "modified" => (
                format!(
                    "ℹ notes skills install recorded {path}, a skill this version no longer declares, and command references in it changed, so notes skills update will leave it in place. Copy what you want to keep, then remove the folder.\n"
                ),
                format!(
                    "⚠ {path} was left in place, because command references in it changed since notes skills install wrote them. Copy what you want to keep, then remove the folder.\n"
                ),
            ),
            _ => (String::new(), String::new()),
        };
        let ran = f
            .succeed_with(&empty, &["status", "--agent", "claude", "--format", "json"])
            .await;
        assert_eq!(ran.stdout, "[]\n");
        assert_eq!(ran.stderr, notice);
        let ran = f.succeed_with(&empty, &["update"]).await;
        assert_eq!(ran.stdout, "");
        assert_eq!(ran.stderr, update);
        assert_eq!(f.folder.exists(), state == "modified");
    }
}

#[tokio::test]
async fn status_directory_requires_project() {
    let f = Fixture::new();
    assert_eq!(f.run(&["status", "--directory", f.sandbox.repo.to_str().unwrap()]).await, Ran {
        status: 2,
        stdout: String::new(),
        stderr: "notes: Option \"--directory\" needs --project. Add --project, or leave out --directory.\n".to_owned(),
    });
}

#[tokio::test]
async fn status_project_refuses_a_global_folder_with_its_own_sentence() {
    let f = Fixture::new();
    let global = f.sandbox.home.join(".claude");
    fs::create_dir(&global).unwrap();
    symlink(&global, f.sandbox.repo.join(".claude")).unwrap();
    assert_eq!(
        f.run(&["status", "--project", "--agent", "claude"]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!(
                "notes skills status --project would read {}, the folder notes skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.\n",
                f.folder.display()
            ),
        }
    );
}

#[test]
fn status_describes_its_options_in_declaration_order() {
    let graph = application().inspect().unwrap();
    let node = graph.command(&["skills", "status"]).unwrap();
    assert_eq!(
        node.description.as_deref(),
        Some("Report whether each skill is installed and up to date.")
    );
    let options = node
        .options
        .iter()
        .take(3)
        .map(|option| match option.as_ref() {
            loomcli_core::OptionNode::String(option) => {
                (option.name.as_str(), option.description.as_deref())
            }
            loomcli_core::OptionNode::Boolean(option) => {
                (option.name.as_str(), option.description.as_deref())
            }
            other => (other.name(), None),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        options,
        [
            (
                "agent",
                Some("The agents to report on: claude or agents. Both when left out.")
            ),
            (
                "project",
                Some("Report on the current repository's skills instead of your home folder's.")
            ),
            (
                "directory",
                Some("Find the repository from this directory instead of the current one.")
            ),
        ]
    );
}

#[tokio::test]
async fn fresh_install_names_the_skill_folder_below_a_blocking_file() {
    let f = Fixture::new();
    let blocker = f.folder.parent().unwrap();
    fs::create_dir(blocker.parent().unwrap()).unwrap();
    fs::write(blocker, "").unwrap();
    let ran = f.run(&["install"]).await;
    assert_eq!(
        ran,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!(
                "Cannot reach {} because a file sits where one of its folders is needed. Remove or rename that file, then run the command again.\n",
                f.folder.display(),
            ),
        }
    );
    assert!(!f.record.exists());
    assert!(!f.sandbox.home.join(".agents").exists());
}

#[tokio::test]
async fn fresh_install_names_the_skill_folder_it_cannot_write() {
    if rustix::process::geteuid().is_root() {
        return;
    }
    let f = Fixture::new();
    let parent = f.folder.parent().unwrap();
    fs::create_dir_all(parent).unwrap();
    fs::set_permissions(parent, fs::Permissions::from_mode(0o555)).unwrap();
    let ran = f.run(CLAUDE).await;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        ran,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!(
                "Cannot write {} because you do not have permission to write there. Make the location writable, then run the command again.\n",
                f.folder.display(),
            ),
        }
    );
    assert_eq!(fs::read_dir(parent).unwrap().count(), 0);
}

#[tokio::test]
async fn global_children_name_the_settings_folder_they_cannot_search() {
    if rustix::process::geteuid().is_root() {
        return;
    }
    let f = Fixture::new();
    let skills = f.folder.parent().unwrap();
    fs::create_dir_all(skills).unwrap();
    let config = skills.parent().unwrap();
    fs::set_permissions(config, fs::Permissions::from_mode(0o600)).unwrap();
    let runs = [
        f.run(&["install"]).await,
        f.run(&["status"]).await,
        f.run(&["uninstall"]).await,
    ];
    fs::set_permissions(config, fs::Permissions::from_mode(0o755)).unwrap();
    for ran in runs {
        assert_eq!(
            ran,
            Ran {
                status: 1,
                stdout: String::new(),
                stderr: format!(
                    "Cannot read {} because you do not have permission to reach or read it. Make it readable, then run the command again.\n",
                    skills.display(),
                ),
            }
        );
    }
    assert!(!f.record.exists());
}
