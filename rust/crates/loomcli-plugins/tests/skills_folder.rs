//! Ports `skills-folder.test.ts`: the skills folder an unbuilt run reads, its faults, what reads it,
//! and the embedded copy a distributed run installs. The reference's carried-value cases that read
//! `loom build`'s define and its `loom-skills/index.json` have no counterpart: a Rust application
//! carries its skills as embedded data (see docs/deviations.md).

#![cfg(feature = "skills")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod skills_support;

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};

use loomcli_core::Build;
use loomcli_plugins::skills::{Skill, SkillFile, Skills, skills};
use skills_support::{
    DISTRIBUTED_FAULT, Sandbox, Scenario, application_with, entry, file, holding, lines,
    notes_files, rule_parts, run_application, sandbox, skill_of, tree,
};

/// A sandbox with the folder's place: `<root>/app/skills`.
struct Folder {
    sandbox: Sandbox,
    folder: PathBuf,
}

fn folder() -> Folder {
    let sandbox = sandbox();
    let folder = sandbox.root.join("app").join("skills");
    Folder { sandbox, folder }
}

/// Writes a file under a directory, creating its parents, executable when asked.
fn put(directory: &Path, path: &str, body: &str, executable: bool) {
    let target = directory.join(path);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(&target, body).unwrap();
    fs::set_permissions(
        &target,
        fs::Permissions::from_mode(if executable { 0o755 } else { 0o644 }),
    )
    .unwrap();
}

/// The skill `notes` in a folder: its SKILL.md, a reference, and an executable script.
fn notes_skill(folder: &Path) {
    put(folder, "notes/SKILL.md", "# Notes\n", false);
    put(folder, "notes/references/commands.md", "commands\n", false);
    put(folder, "notes/scripts/run.sh", "#!/bin/sh\n", true);
}

fn notes_tree() -> std::collections::BTreeMap<String, String> {
    holding(&[
        ("SKILL.md", "file 644 # Notes\n"),
        ("references/commands.md", "file 644 commands\n"),
        ("scripts/run.sh", "file 755 #!/bin/sh\n"),
    ])
}

fn installed(sandbox: &Sandbox, name: &str, target: &str) -> PathBuf {
    skills_support::folder_of(sandbox, target, name)
}

fn listed(name: &str, body: &str) -> Skill {
    Skill::new(name, [SkillFile::new("SKILL.md", body)])
}

/// Runs `notes ...argv` for an application whose skills plugin takes the settings.
async fn run_with(
    sandbox: &Sandbox,
    settings: Skills,
    argv: &[&str],
    build: Build,
) -> skills_support::Ran {
    run_application(
        &application_with(settings),
        sandbox,
        argv,
        &Scenario::default().build(build),
    )
    .await
}

// an unbuilt run

#[tokio::test]
async fn installs_each_skill_directory_of_the_folder_its_files_at_their_paths_and_modes() {
    let f = folder();
    let (box_, dir) = (&f.sandbox, &f.folder);
    notes_skill(dir);
    put(dir, "README.md", "Not a skill.\n", false);
    put(dir, ".drafts/SKILL.md", "Not a skill.\n", false);
    put(&box_.root, "shared/review/SKILL.md", "# Review\n", false);
    put(&box_.root, "shared/review-tool.sh", "#!/bin/sh\n", true);
    symlink(box_.root.join("shared/review"), dir.join("review")).unwrap();
    symlink(
        box_.root.join("shared/review-tool.sh"),
        dir.join("notes/scripts/tool.sh"),
    )
    .unwrap();
    symlink(dir.join("README.md"), dir.join("readme-link.md")).unwrap();
    let result = run_with(
        box_,
        skills(Vec::new()).folder(dir),
        &["skills", "install", "--agent", "claude"],
        Build::Source,
    )
    .await;
    assert!(!result.stderr.contains("--"), "{}", result.stderr);
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed notes for claude in {}.",
                installed(box_, "notes", "claude").display()
            ),
            format!(
                "Installed review for claude in {}.",
                installed(box_, "review", "claude").display()
            ),
        ]
    );
    let mut expected = notes_tree();
    expected.insert(
        "./scripts/tool.sh".to_owned(),
        "file 755 #!/bin/sh\n".to_owned(),
    );
    assert_eq!(tree(&installed(box_, "notes", "claude")), expected);
    assert_eq!(
        tree(&installed(box_, "review", "claude")),
        holding(&[("SKILL.md", "file 644 # Review\n")])
    );
    let mut names: Vec<_> = fs::read_dir(box_.home.join(".claude/skills"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["notes", "review"]);
}

#[tokio::test]
async fn installs_the_folder_skills_in_name_order_before_the_listed_skills() {
    let f = folder();
    notes_skill(&f.folder);
    put(&f.folder, "alpha/SKILL.md", "# Alpha\n", false);
    let result = run_with(
        &f.sandbox,
        skills(vec![listed("listed", "# Listed\n")]).folder(&f.folder),
        &["skills", "install", "--agent", "claude"],
        Build::Source,
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        ["alpha", "notes", "listed"].map(|name| format!(
            "Installed {name} for claude in {}.",
            installed(&f.sandbox, name, "claude").display()
        ))
    );
}

#[tokio::test]
async fn skips_every_entry_whose_name_starts_with_a_dot_in_the_folder_or_a_skill_at_any_depth() {
    let f = folder();
    let (box_, dir) = (&f.sandbox, &f.folder);
    notes_skill(dir);
    put(dir, "notes/.DS_Store", "Finder.\n", false);
    put(dir, "notes/references/.DS_Store", "Finder.\n", false);
    put(dir, "notes/.hidden/draft.md", "Draft.\n", false);
    put(&box_.root, "shared/cache/entry", "Cached.\n", false);
    symlink("agent@host.1234", dir.join("notes/.#SKILL.md")).unwrap();
    symlink(
        box_.root.join("shared/cache"),
        dir.join("notes/scripts/.cache"),
    )
    .unwrap();
    symlink("agent@host.1234", dir.join(".#README.md")).unwrap();
    let result = run_with(
        box_,
        skills(Vec::new()).folder(dir),
        &["skills", "install"],
        Build::Source,
    )
    .await;
    assert!(!result.stderr.contains("--"), "{}", result.stderr);
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(tree(&installed(box_, "notes", "agents")), notes_tree());
}

#[tokio::test]
async fn installs_the_listed_skills_from_an_empty_folder() {
    let f = folder();
    fs::create_dir_all(&f.folder).unwrap();
    let result = run_with(
        &f.sandbox,
        skills(vec![listed("listed", "# Listed\n")]).folder(&f.folder),
        &["skills", "install"],
        Build::Source,
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(installed(&f.sandbox, "listed", "claude").exists());
}

// faults

type Arrange = fn(&Folder);

struct Fault {
    name: &'static str,
    arrange: Arrange,
    listed: Option<Skill>,
    build: Build,
    rule: &'static str,
    sentence: fn(&Folder) -> String,
    correction: &'static str,
    relative: bool,
}

fn faults() -> Vec<Fault> {
    let base = |name, arrange: Arrange, rule, sentence: fn(&Folder) -> String, correction| Fault {
        name,
        arrange,
        listed: None,
        build: Build::Source,
        rule,
        sentence,
        correction,
        relative: false,
    };
    vec![
        base(
            "a broken link directly inside the folder",
            |f| {
                notes_skill(&f.folder);
                symlink(f.sandbox.root.join("gone"), f.folder.join("shared")).unwrap();
            },
            "folder",
            |f| {
                format!(
                    "The skills folder {} holds shared, a link that names nothing.",
                    f.folder.display()
                )
            },
            "Point the link at the skill's folder, or remove it.",
        ),
        base(
            "a folder that holds no skill",
            |f| put(&f.folder, "README.md", "No skills yet.\n", false),
            "folder",
            |f| format!("The skills folder {} holds no skill.", f.folder.display()),
            "Add a folder for each skill, holding its SKILL.md, such as skills/notes/SKILL.md.",
        ),
        base(
            "a link inside a skill that names a folder",
            |f| {
                notes_skill(&f.folder);
                fs::create_dir(f.sandbox.root.join("lib64")).unwrap();
                symlink(
                    f.sandbox.root.join("lib64"),
                    f.folder.join("notes/scripts/lib64"),
                )
                .unwrap();
            },
            "folder",
            |_| {
                "The skill notes holds scripts/lib64, a link to a folder, which a skill cannot hold."
                    .to_owned()
            },
            "Replace the link with the folder's files, or remove it.",
        ),
        base(
            "a link inside a skill that names nothing",
            |f| {
                notes_skill(&f.folder);
                symlink(f.sandbox.root.join("gone"), f.folder.join("notes/gone.md")).unwrap();
            },
            "folder",
            |_| "The skill notes holds gone.md, which is not a file or a folder.".to_owned(),
            "Replace it with the file it stands for, or remove it.",
        ),
        Fault {
            listed: Some(listed("notes", "# Listed\n")),
            ..base(
                "a listed skill that holds a folder skill name",
                notes_skill_of,
                "files",
                |f| {
                    format!(
                        "The skills setting lists the skill notes, which the skills folder {} holds too.",
                        f.folder.display()
                    )
                },
                "Give the listed skill another name, or remove it from the list or the folder.",
            )
        },
        base(
            "a missing folder",
            |_| {},
            "folder",
            |f| {
                format!(
                    "Plugin \"@loomcli/plugins/skills\" setting \"folder\" names {}, which is not a folder.",
                    f.folder.display()
                )
            },
            "Create the folder, or name the folder that holds the skills.",
        ),
        Fault {
            build: Build::Development,
            ..base(
                "a missing folder in a development run",
                |_| {},
                "folder",
                |f| {
                    format!(
                        "Plugin \"@loomcli/plugins/skills\" setting \"folder\" names {}, which is not a folder.",
                        f.folder.display()
                    )
                },
                "Create the folder, or name the folder that holds the skills.",
            )
        },
        Fault {
            build: Build::Distributed,
            ..base(
                "a missing folder in a distributed run that carried none",
                |_| {},
                "folder",
                |f| {
                    format!(
                        "The build carried no skills folder, and {} is not a folder.",
                        f.folder.display()
                    )
                },
                "Embed the folder's skills with Skills::embedded_folder, which a distributed build reads.",
            )
        },
        Fault {
            relative: true,
            ..base(
                "a relative path",
                notes_skill_of,
                "folder",
                |_| {
                    "Plugin \"@loomcli/plugins/skills\" setting \"folder\" is the relative path ../skills, which no run resolves."
                        .to_owned()
                },
                "Name the folder with an absolute path, such as Path::new(env!(\"CARGO_MANIFEST_DIR\")).join(\"skills\").",
            )
        },
        base(
            "a skill directory that is not a skill name",
            |f| {
                notes_skill(&f.folder);
                put(&f.folder, "My Notes/SKILL.md", "# Mine\n", false);
            },
            "folder",
            |f| {
                format!(
                    "The skills folder {} holds a folder that is not a skill name: My Notes.",
                    f.folder.display()
                )
            },
            "Name each skill's folder with lowercase letters, digits, and single hyphens, such as notes.",
        ),
        base(
            "a skill with no SKILL.md",
            |f| put(&f.folder, "notes/README.md", "# Notes\n", false),
            "files",
            |_| "Skill \"notes\" lists no SKILL.md.".to_owned(),
            "Add the skill's SKILL.md at the top of its files.",
        ),
    ]
}

fn notes_skill_of(f: &Folder) {
    notes_skill(&f.folder);
}

#[tokio::test]
async fn each_fault_fails_install_and_writes_nothing() {
    for fault in faults() {
        let f = folder();
        (fault.arrange)(&f);
        for argv in [
            &["skills", "install"][..],
            &["skills", "install", "--project"][..],
        ] {
            let mut settings = skills(fault.listed.clone().into_iter().collect());
            settings = settings.folder(if fault.relative {
                PathBuf::from("../skills")
            } else {
                f.folder.clone()
            });
            let result = run_with(&f.sandbox, settings, argv, fault.build).await;
            let name = fault.name;
            assert_eq!(result.status, 1, "{name}: {}", result.stderr);
            if fault.build == Build::Distributed {
                assert_eq!(lines(&result.stderr), [DISTRIBUTED_FAULT], "{name}");
                continue;
            }
            assert_eq!(
                rule_parts(&result.stderr),
                (
                    format!("@loomcli/plugins/skills/{}", fault.rule),
                    (fault.sentence)(&f),
                    fault.correction.to_owned()
                ),
                "{name}"
            );
        }
        assert!(!f.sandbox.home.join(".claude").exists(), "{}", fault.name);
        assert!(!f.sandbox.home.join(".agents").exists(), "{}", fault.name);
        assert!(!f.sandbox.state.join("notes").exists(), "{}", fault.name);
        assert_eq!(
            fs::read_dir(&f.sandbox.repo).unwrap().count(),
            0,
            "{}",
            fault.name
        );
    }
}

// what reads the folder

#[tokio::test]
async fn reads_no_folder_for_a_command_outside_skills_or_for_uninstall() {
    let f = folder();
    let settings = || skills(Vec::new()).folder(&f.folder);
    let ping = run_with(&f.sandbox, settings(), &["ping"], Build::Source).await;
    assert_eq!(ping.status, 0);
    assert_eq!(ping.stdout, "pong\n");
    let uninstall = run_with(
        &f.sandbox,
        settings(),
        &["skills", "uninstall"],
        Build::Source,
    )
    .await;
    assert_eq!(uninstall.status, 0);
    assert_eq!(
        lines(&uninstall.stderr),
        ["notes has no skills installed in your home folder, so there is nothing to remove."]
    );
}

// what a distributed build carries (the Rust form of `what the artifact carried`)

fn embedded_notes() -> Vec<Skill> {
    vec![Skill::new(
        "notes",
        [
            SkillFile::embedded("SKILL.md", b"# Embedded\n"),
            SkillFile::embedded("scripts/run.sh", b"#!/bin/sh\n").executable(),
        ],
    )]
}

#[tokio::test]
async fn a_distributed_run_installs_the_embedded_copy_and_never_reads_the_folder() {
    let f = folder();
    notes_skill(&f.folder);
    let result = run_with(
        &f.sandbox,
        skills(Vec::new())
            .folder(&f.folder)
            .embedded_folder(embedded_notes()),
        &["skills", "install", "--agent", "claude"],
        Build::Distributed,
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        tree(&installed(&f.sandbox, "notes", "claude")),
        holding(&[
            ("SKILL.md", "file 644 # Embedded\n"),
            ("scripts/run.sh", "file 755 #!/bin/sh\n"),
        ])
    );
}

#[tokio::test]
async fn a_development_run_reads_the_source_folder_where_it_stands() {
    let f = folder();
    notes_skill(&f.folder);
    let settings = || {
        skills(Vec::new())
            .folder(&f.folder)
            .embedded_folder(embedded_notes())
    };
    for build in [Build::Source, Build::Development] {
        let result = run_with(
            &f.sandbox,
            settings(),
            &["skills", "install", "--agent", "claude", "--force"],
            build,
        )
        .await;
        assert_eq!(result.status, 0, "{}", result.stderr);
        assert_eq!(
            tree(&installed(&f.sandbox, "notes", "claude")),
            notes_tree()
        );
        // An edit to the source folder installs without a rebuild.
        put(&f.folder, "notes/SKILL.md", "# Edited\n", false);
        let again = run_with(&f.sandbox, settings(), &["skills", "update"], build).await;
        assert_eq!(again.status, 0, "{}", again.stderr);
        assert_eq!(
            fs::read_to_string(installed(&f.sandbox, "notes", "claude").join("SKILL.md")).unwrap(),
            "# Edited\n"
        );
        put(&f.folder, "notes/SKILL.md", "# Notes\n", false);
    }
}

#[tokio::test]
async fn an_embedded_skill_is_judged_like_a_folder_skill() {
    let f = folder();
    let embedded = vec![Skill::new(
        "notes",
        [SkillFile::embedded("README.md", b"x")],
    )];
    let result = run_with(
        &f.sandbox,
        skills(Vec::new())
            .folder(&f.folder)
            .embedded_folder(embedded),
        &["skills", "install"],
        Build::Distributed,
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(lines(&result.stderr), [DISTRIBUTED_FAULT]);
    assert!(!f.sandbox.home.join(".claude").exists());
}

#[tokio::test]
async fn an_embedded_copy_holding_a_listed_skills_name_fails_the_install() {
    let f = folder();
    for argv in [
        &["skills", "install"][..],
        &["skills", "install", "--project"][..],
    ] {
        let result = run_with(
            &f.sandbox,
            skills(vec![listed("notes", "# Listed\n")])
                .folder(&f.folder)
                .embedded_folder(embedded_notes()),
            argv,
            Build::Distributed,
        )
        .await;
        assert_eq!(result.status, 1, "{}", result.stderr);
        assert_eq!(lines(&result.stderr), [DISTRIBUTED_FAULT]);
    }
    assert!(!f.sandbox.home.join(".claude").exists());
    assert_eq!(fs::read_dir(&f.sandbox.repo).unwrap().count(), 0);
}

#[tokio::test]
async fn an_empty_embedded_copy_with_no_listed_skill_fails_and_update_keeps_recorded_skills() {
    let f = folder();
    let installed_run = run_with(
        &f.sandbox,
        skills(Vec::new())
            .folder(&f.folder)
            .embedded_folder(embedded_notes()),
        &["skills", "install", "--agent", "claude"],
        Build::Distributed,
    )
    .await;
    assert_eq!(installed_run.status, 0, "{}", installed_run.stderr);
    for argv in [&["skills", "install"][..], &["skills", "update"][..]] {
        let result = run_with(
            &f.sandbox,
            skills(Vec::new())
                .folder(&f.folder)
                .embedded_folder(Vec::new()),
            argv,
            Build::Distributed,
        )
        .await;
        assert_eq!(result.status, 1, "{}", result.stderr);
        assert_eq!(lines(&result.stderr), [DISTRIBUTED_FAULT]);
    }
    assert!(
        installed(&f.sandbox, "notes", "claude")
            .join("SKILL.md")
            .exists()
    );
}

#[tokio::test]
async fn an_embedded_copy_skips_dot_entries_as_the_folder_read_does() {
    let f = folder();
    let embedded = vec![Skill::new(
        "notes",
        [
            SkillFile::embedded("SKILL.md", b"# Embedded\n"),
            SkillFile::embedded(".DS_Store", b"junk"),
            SkillFile::embedded("references/.hidden.md", b"junk"),
        ],
    )];
    let result = run_with(
        &f.sandbox,
        skills(Vec::new())
            .folder(&f.folder)
            .embedded_folder(embedded),
        &["skills", "install", "--agent", "claude"],
        Build::Distributed,
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        tree(&installed(&f.sandbox, "notes", "claude")),
        holding(&[("SKILL.md", "file 644 # Embedded\n")])
    );
}

#[tokio::test]
async fn a_folder_with_a_trailing_slash_or_dot_parts_is_named_normalized() {
    let f = folder();
    let root = f.sandbox.root.to_string_lossy().into_owned();
    for setting in [
        format!("{root}/app/skills/"),
        format!("{root}/x/../app/skills"),
    ] {
        let result = run_with(
            &f.sandbox,
            skills(Vec::new()).folder(PathBuf::from(setting)),
            &["skills", "install"],
            Build::Source,
        )
        .await;
        assert_eq!(result.status, 1);
        assert_eq!(
            rule_parts(&result.stderr).1,
            format!(
                "Plugin \"@loomcli/plugins/skills\" setting \"folder\" names {root}/app/skills, which is not a folder."
            )
        );
    }
    fs::create_dir_all(&f.folder).unwrap();
    let result = run_with(
        &f.sandbox,
        skills(Vec::new()).folder(PathBuf::from(format!("{root}/app/skills/"))),
        &["skills", "install"],
        Build::Source,
    )
    .await;
    assert_eq!(
        rule_parts(&result.stderr).1,
        format!("The skills folder {root}/app/skills holds no skill.")
    );
}

#[test]
fn an_embedded_copy_without_a_folder_setting_is_a_settings_fault() {
    let panic = std::panic::catch_unwind(|| {
        drop(
            skills(Vec::new())
                .embedded_folder(embedded_notes())
                .plugin(),
        );
    })
    .expect_err("the settings must panic");
    let message = panic.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(
        message.contains("@loomcli/plugins/skills/settings"),
        "{message}"
    );
    assert!(
        message.contains(
            "Plugin \"@loomcli/plugins/skills\" setting \"embedded_folder\" gives the skills of a folder, and the settings name no \"folder\"."
        ),
        "{message}"
    );
}

#[allow(dead_code)]
fn unused(sandbox: &Sandbox) {
    let _ = (
        entry("x", notes_files()),
        file("a", "b"),
        skill_of(&skills_support::notes(), &sandbox.loaded),
    );
}
