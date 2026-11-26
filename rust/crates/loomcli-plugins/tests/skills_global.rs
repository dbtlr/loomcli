//! Ports the global-scope cases of `skills.test.ts`: installing, refusing, forcing, updating,
//! uninstalling, and one folder for both targets. Each case runs the skills Commands on the mock
//! process against a sandbox of a home, a state directory, and a repository.

#![cfg(feature = "skills")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod skills_support;

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::Path;

use skills_support::{
    AGENTS, CLAUDE, Sandbox, Scenario, entry, file, folder_of, holding, lines, loaded, notes,
    notes_files, pinned, project_folder, record_path, record_state, recorded, run, sandbox,
    throwing, tree, write_state, written,
};

const INSTALLED_BOTH: [&str; 2] = [
    "Installed notes for claude in HOME/.claude/skills/notes.",
    "Installed notes for agents in HOME/.agents/skills/notes.",
];

fn strings(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|line| (*line).to_owned()).collect()
}

fn written_tree() -> std::collections::BTreeMap<String, String> {
    holding(&written())
}

// installing globally

#[tokio::test]
async fn installs_both_folders_records_each_target_apart_and_writes_the_pinned_modes() {
    let box_ = sandbox();
    let result = run(&box_, &["skills", "install"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(result.stdout, "");
    assert_eq!(pinned(&box_, &result.stderr), strings(&INSTALLED_BOTH));
    for target in [CLAUDE, AGENTS] {
        let folder = folder_of(&box_, target, "notes");
        assert_eq!(tree(&folder), written_tree());
        assert_eq!(
            skills_support::mode_of(&folder.join("scripts/run.sh")),
            0o755
        );
        assert_eq!(skills_support::mode_of(&folder.join("SKILL.md")), 0o644);
        let record = recorded(&box_, target);
        assert_eq!(record.state, "committed");
        assert_eq!(record.folders, [folder.to_string_lossy().into_owned()]);
        assert!(record.files.is_empty());
        assert_eq!(
            record.directories,
            [
                box_.home.join(format!(".{target}")),
                box_.home.join(format!(".{target}")).join("skills"),
            ]
            .map(|path| path.to_string_lossy().into_owned())
        );
    }
}

#[tokio::test]
async fn writes_bytes_as_given() {
    let box_ = sandbox();
    let mut files = notes_files();
    files.push(skills_support::FileSpec {
        path: "assets/blob.bin".to_owned(),
        content: vec![0, 255, 10, 128],
        executable: false,
    });
    let scenario = Scenario::default().skills(vec![entry("notes", files)]);
    let result = run(&box_, &["skills", "install"], &scenario).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        fs::read(folder_of(&box_, CLAUDE, "notes").join("assets/blob.bin")).unwrap(),
        [0, 255, 10, 128]
    );
}

#[tokio::test]
async fn keeps_an_installed_folder_whose_path_holds_spaces_on_one_line_at_a_narrow_width() {
    let box_ = sandbox();
    let home = box_.root.join("Application Support").join("home");
    fs::create_dir_all(&home).unwrap();
    let folder = home.join(".claude").join("skills").join("notes");
    let home_text = home.to_string_lossy().into_owned();
    let narrow = run(
        &box_,
        &["skills", "install"],
        &Scenario::default().env("HOME", &home_text).columns(40),
    )
    .await;
    assert_eq!(narrow.status, 0);
    let stderr: Vec<&str> = narrow.stderr.split('\n').collect();
    assert!(
        stderr.contains(&format!("  {}.", folder.display()).as_str()),
        "{}",
        narrow.stderr
    );
    assert!(lines(&narrow.stderr).contains(&"Installed notes for claude in".to_owned()));
    fs::remove_dir_all(home.join(".claude")).unwrap();
    fs::remove_dir_all(home.join(".agents")).unwrap();
    fs::remove_dir_all(box_.state.join("notes")).unwrap();
    let piped = run(
        &box_,
        &["skills", "install"],
        &Scenario::default().env("HOME", &home_text),
    )
    .await;
    assert!(lines(&piped.stderr).contains(&format!(
        "Installed notes for claude in {}.",
        folder.display()
    )));
}

#[tokio::test]
async fn agent_claude_writes_only_the_claude_folder_and_leaves_the_agents_record_and_folders_alone()
{
    let box_ = sandbox();
    assert_eq!(
        run(&box_, &["skills", "install"], &Scenario::default())
            .await
            .status,
        0
    );
    let folder = tree(&folder_of(&box_, AGENTS, "notes"));
    let record = fs::read_to_string(record_path(&box_, AGENTS)).unwrap();
    let next = Scenario::default().skills(vec![entry("notes", vec![file("SKILL.md", "v2\n")])]);
    let result = run(&box_, &["skills", "install", "--agent", "claude"], &next).await;
    assert_eq!(result.status, 0);
    assert_eq!(pinned(&box_, &result.stderr), strings(&INSTALLED_BOTH[..1]));
    assert_eq!(
        tree(&folder_of(&box_, CLAUDE, "notes")),
        holding(&[("SKILL.md", "file 644 v2\n")])
    );
    assert_eq!(tree(&folder_of(&box_, AGENTS, "notes")), folder);
    assert_eq!(
        fs::read_to_string(record_path(&box_, AGENTS)).unwrap(),
        record
    );
}

#[tokio::test]
async fn agent_agents_leaves_the_claude_record_and_folder_alone() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["skills", "install", "--agent", "agents"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(pinned(&box_, &result.stderr), strings(&INSTALLED_BOTH[1..]));
    assert!(!box_.home.join(".claude").exists());
    assert!(!record_path(&box_, CLAUDE).exists());
    assert!(record_path(&box_, AGENTS).exists());
}

#[tokio::test]
async fn prints_the_unchanged_lines_on_a_second_install_and_writes_nothing() {
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    let before = write_state(&box_);
    let result = run(&box_, &["skills", "install"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "HOME/.claude/skills/notes is unchanged.",
            "HOME/.agents/skills/notes is unchanged.",
        ])
    );
    assert_eq!(write_state(&box_), before);
}

/// Leaves what a process killed after the swap leaves for a target: the new folder in place, a
/// stale full copy retired beside it, and a plugin's file still `pending`.
fn killed_after_swap(box_: &Sandbox) -> Vec<std::path::PathBuf> {
    let mut retired = Vec::new();
    for target in [CLAUDE, AGENTS] {
        let leftover = folder_of(box_, target, "notes")
            .parent()
            .unwrap()
            .join(".notes.0123456789abcdef.loom-retired");
        fs::create_dir(&leftover).unwrap();
        fs::write(leftover.join("SKILL.md"), "stale\n").unwrap();
        retired.push(leftover);
        let mut record: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(record_path(box_, target)).unwrap()).unwrap();
        record["state"] = "pending".into();
        let folder = &mut record["folders"][0];
        *folder = serde_json::json!({
            "path": folder["path"], "prior": folder["files"], "intended": folder["files"]
        });
        fs::write(record_path(box_, target), format!("{record}\n")).unwrap();
    }
    retired
}

#[tokio::test]
async fn install_and_update_resolve_a_pending_record_whose_folder_already_matches_and_remove_the_retired_copy()
 {
    for child in ["install", "update"] {
        let box_ = sandbox();
        run(&box_, &["skills", "install"], &Scenario::default()).await;
        let retired = killed_after_swap(&box_);
        assert_eq!(recorded(&box_, CLAUDE).state, "pending");
        let result = run(&box_, &["skills", child], &Scenario::default()).await;
        assert_eq!(result.status, 0, "{child}: {}", result.stderr);
        for target in [CLAUDE, AGENTS] {
            let folder = folder_of(&box_, target, "notes");
            assert_eq!(recorded(&box_, target).state, "committed");
            assert_eq!(
                recorded(&box_, target).folders,
                [folder.to_string_lossy().into_owned()]
            );
            assert_eq!(tree(&folder), written_tree());
            let names: Vec<_> = fs::read_dir(folder.parent().unwrap())
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect();
            assert_eq!(names, ["notes"]);
        }
        assert!(!retired.iter().any(|path| path.exists()));
    }
}

fn flipped() -> Scenario {
    Scenario::default().skills(vec![entry(
        "notes",
        notes_files()
            .into_iter()
            .map(|file| skills_support::FileSpec {
                executable: !file.executable,
                ..file
            })
            .collect(),
    )])
}

#[tokio::test]
async fn replaces_the_folder_whole_after_a_change() {
    type Change = Box<dyn Fn(&Sandbox)>;
    let claude = |box_: &Sandbox| folder_of(box_, CLAUDE, "notes");
    let changes: Vec<(&str, Change, Option<Scenario>)> = vec![
        (
            "a file mode changed",
            Box::new(move |box_| {
                fs::set_permissions(
                    claude(box_).join("SKILL.md"),
                    fs::Permissions::from_mode(0o700),
                )
                .unwrap();
            }),
            None,
        ),
        (
            "a file was edited",
            Box::new(move |box_| fs::write(claude(box_).join("SKILL.md"), "x").unwrap()),
            None,
        ),
        (
            "the skill flips a file's executable",
            Box::new(|_| {}),
            Some(flipped()),
        ),
    ];
    for (reason, change, scenario) in changes {
        let box_ = sandbox();
        run(&box_, &["skills", "install"], &Scenario::default()).await;
        change(&box_);
        let result = run(
            &box_,
            &["skills", "install"],
            &scenario.clone().unwrap_or_default(),
        )
        .await;
        assert_eq!(result.status, 0, "{reason}");
        assert_eq!(
            pinned(&box_, &result.stderr),
            if scenario.is_none() {
                strings(&[INSTALLED_BOTH[0], "HOME/.agents/skills/notes is unchanged."])
            } else {
                strings(&INSTALLED_BOTH)
            },
            "{reason}"
        );
        let expected = if scenario.is_none() {
            written_tree()
        } else {
            holding(&[
                ("SKILL.md", "file 755 # Notes\n"),
                ("references/commands.md", "file 755 commands v1\n"),
                ("scripts/run.sh", "file 644 #!/bin/sh\n"),
            ])
        };
        assert_eq!(
            tree(&folder_of(&box_, CLAUDE, "notes")),
            expected,
            "{reason}"
        );
    }
}

#[tokio::test]
async fn moves_the_claude_folder_under_an_absolute_claude_config_dir_and_ignores_a_relative_one() {
    let box_ = sandbox();
    let config = box_.root.join("claude-config");
    run(
        &box_,
        &["skills", "install"],
        &Scenario::default().env("CLAUDE_CONFIG_DIR", &config.to_string_lossy()),
    )
    .await;
    assert_eq!(tree(&config.join("skills").join("notes")), written_tree());
    assert!(!box_.home.join(".claude").exists());
    assert_eq!(
        recorded(&box_, CLAUDE).folders,
        [config
            .join("skills")
            .join("notes")
            .to_string_lossy()
            .into_owned()]
    );
    let other = sandbox();
    run(
        &other,
        &["skills", "install"],
        &Scenario::default().env("CLAUDE_CONFIG_DIR", "relative/config"),
    )
    .await;
    assert_eq!(tree(&folder_of(&other, CLAUDE, "notes")), written_tree());
}

#[tokio::test]
async fn installs_agent_claude_under_an_absolute_claude_config_dir_with_a_relative_home() {
    let box_ = sandbox();
    let config = box_.root.join("claude-config");
    let result = run(
        &box_,
        &["skills", "install", "--agent", "claude"],
        &Scenario::default()
            .env("CLAUDE_CONFIG_DIR", &config.to_string_lossy())
            .env("HOME", "relative-home"),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "Installed notes for claude in {}.",
            config.join("skills").join("notes").display()
        )]
    );
}

#[tokio::test]
async fn exits_2_for_an_agent_value_outside_the_set() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["skills", "install", "--agent", "cursor"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 2);
    assert!(!box_.home.join(".claude").exists());
}

// refusing

type Obstruct = fn(&Sandbox, &Path);
type Replace = fn(&Path);

fn obstacles() -> Vec<(&'static str, Obstruct)> {
    vec![
        ("an unrecorded directory", |_, folder| {
            fs::create_dir_all(folder).unwrap();
        }),
        ("a regular file", |_, folder| {
            fs::create_dir_all(folder.parent().unwrap()).unwrap();
            fs::write(folder, "mine").unwrap();
        }),
        ("a symbolic link", |box_, folder| {
            fs::create_dir_all(folder.parent().unwrap()).unwrap();
            symlink(&box_.elsewhere, folder).unwrap();
        }),
    ]
}

#[tokio::test]
async fn install_refuses_an_obstacle_at_a_skill_folder_and_changes_nothing() {
    for (name, obstruct) in obstacles() {
        let box_ = sandbox();
        obstruct(&box_, &folder_of(&box_, AGENTS, "notes"));
        let agents = tree(&box_.home.join(".agents"));
        let claude = tree(&box_.home.join(".claude"));
        let written = write_state(&box_);
        let result = run(&box_, &["skills", "install"], &Scenario::default()).await;
        assert_eq!(result.status, 1, "{name}");
        assert_eq!(
            pinned(&box_, &result.stderr),
            strings(&[
                "HOME/.agents/skills/notes was not installed by notes skills install.",
                "notes skills install changed nothing, because folders it did not install, or whose command references changed since it installed them, are in the way. Copy any file you want to keep out of them, then remove them or run notes skills install --force to replace them.",
            ]),
            "{name}"
        );
        assert_eq!(tree(&box_.home.join(".agents")), agents, "{name}");
        assert_eq!(tree(&box_.home.join(".claude")), claude, "{name}");
        assert_eq!(write_state(&box_), written, "{name}");
        assert!(!record_path(&box_, CLAUDE).exists());
        assert!(!record_path(&box_, AGENTS).exists());
        assert_eq!(
            tree(&box_.elsewhere),
            holding(&[]),
            "{name}: the link's target is untouched"
        );
    }
}

#[tokio::test]
async fn update_refuses_an_obstacle_in_the_way_of_a_newly_declared_skill_and_writes_nothing() {
    for (name, obstruct) in obstacles() {
        let box_ = sandbox();
        run(&box_, &["skills", "install"], &Scenario::default()).await;
        let second = entry("second", vec![file("SKILL.md", "second\n")]);
        obstruct(&box_, &folder_of(&box_, AGENTS, "second"));
        let agents = tree(&box_.home.join(".agents"));
        let claude = tree(&box_.home.join(".claude"));
        let written = write_state(&box_);
        let result = run(
            &box_,
            &["skills", "update"],
            &Scenario::default().skills(vec![notes(), second]),
        )
        .await;
        assert_eq!(result.status, 1, "{name}");
        assert_eq!(
            pinned(&box_, &result.stderr),
            strings(&[
                "HOME/.agents/skills/second was not installed by notes skills install.",
                "notes skills update changed nothing, because folders it did not install, or whose command references changed since it installed them, are in the way. Copy any file you want to keep out of them, then remove them or run notes skills install --force to replace them.",
            ]),
            "{name}"
        );
        assert_eq!(tree(&box_.home.join(".agents")), agents, "{name}");
        assert_eq!(tree(&box_.home.join(".claude")), claude, "{name}");
        assert_eq!(write_state(&box_), written, "{name}");
    }
}

#[tokio::test]
async fn reports_each_refused_folder_across_both_targets() {
    let box_ = sandbox();
    fs::create_dir_all(folder_of(&box_, CLAUDE, "notes")).unwrap();
    fs::create_dir_all(folder_of(&box_, AGENTS, "notes")).unwrap();
    let result = run(&box_, &["skills", "install"], &Scenario::default()).await;
    assert_eq!(
        pinned(&box_, &result.stderr)[..2],
        strings(&[
            "HOME/.claude/skills/notes was not installed by notes skills install.",
            "HOME/.agents/skills/notes was not installed by notes skills install.",
        ])[..]
    );
}

#[tokio::test]
async fn install_update_and_uninstall_fail_on_a_damaged_or_unknown_format_file_with_the_record_sentence()
 {
    for text in ["{\"format\":1,", "{\"format\":3,\"state\":\"committed\"}\n"] {
        let box_ = sandbox();
        fs::create_dir_all(box_.state.join("notes").join("installation")).unwrap();
        let record = record_path(&box_, CLAUDE);
        fs::write(&record, text).unwrap();
        for child in ["install", "update", "uninstall"] {
            let result = run(&box_, &["skills", child], &Scenario::default()).await;
            assert_eq!(result.status, 1, "{child}");
            let word = if child == "uninstall" {
                "uninstall"
            } else {
                "install"
            };
            assert_eq!(
                lines(&result.stderr),
                [format!(
                    "{} cannot be read, so notes will not change the folders it lists. Remove it and the folders it lists, then run notes skills {word} again.",
                    record.display()
                )]
            );
        }
        assert!(!folder_of(&box_, AGENTS, "notes").exists());
    }
}

#[tokio::test]
async fn fails_every_global_child_on_a_relative_home() {
    let box_ = sandbox();
    for child in ["install", "update", "uninstall"] {
        let result = run(
            &box_,
            &["skills", child],
            &Scenario::default().env("HOME", "relative"),
        )
        .await;
        assert_eq!(result.status, 1, "{child}");
        assert_eq!(
            lines(&result.stderr),
            [
                "notes cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again."
            ]
        );
    }
    assert!(loaded(&box_).is_empty());
}

#[tokio::test]
async fn names_the_variable_the_record_lookup_answers_when_home_and_xdg_state_home_are_relative() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["skills", "install", "--agent", "claude"],
        &Scenario::default()
            .env(
                "CLAUDE_CONFIG_DIR",
                &box_.root.join("claude-config").to_string_lossy(),
            )
            .env("HOME", "relative-home")
            .env("XDG_STATE_HOME", "relative-state"),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [
            "notes cannot find its installation record because HOME is not an absolute path. Set HOME to an absolute path, then run the command again."
        ]
    );
    assert!(loaded(&box_).is_empty());
}

// forcing

#[tokio::test]
async fn force_replaces_a_link_to_the_other_targets_folder_and_leaves_the_folder_it_pointed_at() {
    let box_ = sandbox();
    run(
        &box_,
        &["skills", "install", "--agent", "agents"],
        &Scenario::default(),
    )
    .await;
    let agents_before = tree(&folder_of(&box_, AGENTS, "notes"));
    fs::create_dir_all(box_.home.join(".claude").join("skills")).unwrap();
    symlink(
        folder_of(&box_, AGENTS, "notes"),
        folder_of(&box_, CLAUDE, "notes"),
    )
    .unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--force"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "Replaced HOME/.claude/skills/notes, which notes skills install did not install.",
            INSTALLED_BOTH[0],
            "HOME/.agents/skills/notes is unchanged.",
        ])
    );
    assert!(
        !fs::symlink_metadata(folder_of(&box_, CLAUDE, "notes"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(tree(&folder_of(&box_, CLAUDE, "notes")), written_tree());
    assert_eq!(tree(&folder_of(&box_, AGENTS, "notes")), agents_before);
    assert_eq!(
        recorded(&box_, CLAUDE).folders,
        [folder_of(&box_, CLAUDE, "notes")
            .to_string_lossy()
            .into_owned()]
    );
}

#[tokio::test]
async fn force_replaces_an_unrecorded_directory_or_a_regular_file_at_a_skill_folder() {
    let obstructions: [(&str, Replace); 2] = [
        ("an unrecorded directory", |folder| {
            fs::create_dir_all(folder.join("mine")).unwrap();
        }),
        ("a regular file", |folder| {
            fs::write(folder, "mine").unwrap()
        }),
    ];
    for (name, obstruct) in obstructions {
        let box_ = sandbox();
        fs::create_dir_all(box_.home.join(".claude").join("skills")).unwrap();
        obstruct(&folder_of(&box_, CLAUDE, "notes"));
        let result = run(
            &box_,
            &["skills", "install", "--force", "--agent", "claude"],
            &Scenario::default(),
        )
        .await;
        assert_eq!(result.status, 0, "{name}");
        assert_eq!(
            pinned(&box_, &result.stderr),
            strings(&[
                "Replaced HOME/.claude/skills/notes, which notes skills install did not install.",
                INSTALLED_BOTH[0],
            ]),
            "{name}"
        );
        assert_eq!(tree(&folder_of(&box_, CLAUDE, "notes")), written_tree());
        assert_eq!(
            recorded(&box_, CLAUDE).folders,
            [folder_of(&box_, CLAUDE, "notes")
                .to_string_lossy()
                .into_owned()]
        );
    }
}

#[tokio::test]
async fn force_removes_a_link_alone_and_leaves_its_target_byte_for_byte() {
    let box_ = sandbox();
    fs::create_dir_all(box_.elsewhere.join("sub")).unwrap();
    fs::write(box_.elsewhere.join("sub").join("keep.md"), "keep").unwrap();
    let before = tree(&box_.elsewhere);
    fs::create_dir_all(box_.home.join(".claude").join("skills")).unwrap();
    symlink(&box_.elsewhere, folder_of(&box_, CLAUDE, "notes")).unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--force", "--agent", "claude"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 0);
    assert_eq!(tree(&box_.elsewhere), before);
    assert_eq!(tree(&folder_of(&box_, CLAUDE, "notes")), written_tree());
}

#[tokio::test]
async fn force_with_project_installs_as_project_does() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    let forced = run(
        &box_,
        &["skills", "install", "--project", "--force"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(forced.status, 0);
    assert_eq!(
        lines(&forced.stderr),
        [
            format!(
                "Installed notes for claude in {}.",
                project_folder(&box_.repo, CLAUDE).display()
            ),
            format!(
                "Installed notes for agents in {}.",
                project_folder(&box_.repo, AGENTS).display()
            ),
        ]
    );
    assert!(!box_.state.join("notes").exists());
}

// updating

fn revised() -> Scenario {
    Scenario::default().skills(vec![entry(
        "notes",
        vec![
            file("SKILL.md", "# Notes v2\n"),
            file("references/guides/commands.md", "commands v1\n"),
            file("references/added.md", "new\n"),
        ],
    )])
}

#[tokio::test]
async fn update_leaves_exactly_the_new_files_including_over_a_folder_someone_edited() {
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    fs::write(folder_of(&box_, CLAUDE, "notes").join("SKILL.md"), "edited").unwrap();
    fs::write(folder_of(&box_, AGENTS, "notes").join("mine.md"), "mine").unwrap();
    let result = run(&box_, &["skills", "update"], &revised()).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "Updated notes for claude in HOME/.claude/skills/notes.",
            "Updated notes for agents in HOME/.agents/skills/notes.",
        ])
    );
    for target in [CLAUDE, AGENTS] {
        assert_eq!(
            tree(&folder_of(&box_, target, "notes")),
            holding(&[
                ("SKILL.md", "file 644 # Notes v2\n"),
                ("references/added.md", "file 644 new\n"),
                ("references/guides/commands.md", "file 644 commands v1\n"),
            ])
        );
    }
}

#[tokio::test]
async fn update_prints_the_unchanged_lines_when_nothing_changed() {
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    let before = write_state(&box_);
    let result = run(&box_, &["skills", "update"], &Scenario::default()).await;
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "HOME/.claude/skills/notes is unchanged.",
            "HOME/.agents/skills/notes is unchanged.",
        ])
    );
    assert_eq!(write_state(&box_), before);
}

#[tokio::test]
async fn update_acts_only_on_a_target_whose_plugin_file_lists_a_folder() {
    let box_ = sandbox();
    run(
        &box_,
        &["skills", "install", "--agent", "agents"],
        &Scenario::default(),
    )
    .await;
    let result = run(&box_, &["skills", "update"], &revised()).await;
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&["Updated notes for agents in HOME/.agents/skills/notes."])
    );
    assert!(!box_.home.join(".claude").exists());
}

#[tokio::test]
async fn update_removes_the_folder_of_a_skill_the_application_stopped_declaring_whole() {
    let box_ = sandbox();
    let second = entry("second", vec![file("SKILL.md", "s\n")]);
    run(
        &box_,
        &["skills", "install"],
        &Scenario::default().skills(vec![notes(), second]),
    )
    .await;
    fs::write(folder_of(&box_, CLAUDE, "second").join("mine.md"), "mine").unwrap();
    let result = run(&box_, &["skills", "update"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "Updated notes for claude in HOME/.claude/skills/notes.",
            "Removed HOME/.claude/skills/second.",
            "Updated notes for agents in HOME/.agents/skills/notes.",
            "Removed HOME/.agents/skills/second.",
        ])
    );
    assert!(!folder_of(&box_, CLAUDE, "second").exists());
    assert!(!folder_of(&box_, AGENTS, "second").exists());
    assert_eq!(
        recorded(&box_, CLAUDE).folders,
        [folder_of(&box_, CLAUDE, "notes")
            .to_string_lossy()
            .into_owned()]
    );
}

#[tokio::test]
async fn update_says_there_is_nothing_to_update_and_exits_0_when_nothing_is_recorded() {
    let box_ = sandbox();
    let result = run(&box_, &["skills", "update"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        lines(&result.stderr),
        [
            "notes has no skills installed in your home folder, so there is nothing to update. Run notes skills install to install them."
        ]
    );
    assert_eq!(loaded(&box_), ["notes"]);
}

#[tokio::test]
async fn update_leaves_a_project_folder_byte_for_byte() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    run(
        &box_,
        &["skills", "install", "--project"],
        &Scenario::default(),
    )
    .await;
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    let before = tree(&box_.repo.join(".claude"));
    let result = run(&box_, &["skills", "update"], &revised()).await;
    assert_eq!(result.status, 0);
    assert_eq!(tree(&box_.repo.join(".claude")), before);
}

// uninstalling

#[tokio::test]
async fn uninstall_removes_every_recorded_folder_whole_the_directories_it_created_and_the_plugin_file()
 {
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    fs::write(folder_of(&box_, CLAUDE, "notes").join("SKILL.md"), "edited").unwrap();
    fs::write(folder_of(&box_, AGENTS, "notes").join("extra.md"), "extra").unwrap();
    let result = run(&box_, &["skills", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "Removed HOME/.claude/skills/notes.",
            "Removed HOME/.agents/skills/notes.",
        ])
    );
    assert!(!box_.home.join(".claude").exists());
    assert!(!box_.home.join(".agents").exists());
    assert!(!record_path(&box_, CLAUDE).exists());
    assert!(!record_path(&box_, AGENTS).exists());
}

#[tokio::test]
async fn uninstall_leaves_an_unrecorded_folder_in_place_and_says_there_is_nothing_to_remove_on_a_second_run()
 {
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    let mine = folder_of(&box_, CLAUDE, "mine");
    fs::create_dir_all(&mine).unwrap();
    fs::write(mine.join("SKILL.md"), "mine").unwrap();
    fs::set_permissions(mine.join("SKILL.md"), fs::Permissions::from_mode(0o644)).unwrap();
    run(&box_, &["skills", "uninstall"], &Scenario::default()).await;
    assert_eq!(tree(&mine), holding(&[("SKILL.md", "file 644 mine")]));
    assert!(!folder_of(&box_, CLAUDE, "notes").exists());
    let second = run(&box_, &["skills", "uninstall"], &Scenario::default()).await;
    assert_eq!(second.status, 0);
    assert_eq!(
        lines(&second.stderr),
        ["notes has no skills installed in your home folder, so there is nothing to remove."]
    );
}

#[tokio::test]
async fn uninstall_says_a_recorded_folder_that_is_already_gone_was_already_gone() {
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    fs::remove_dir_all(folder_of(&box_, AGENTS, "notes")).unwrap();
    let result = run(&box_, &["skills", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "Removed HOME/.claude/skills/notes.",
            "HOME/.agents/skills/notes was already gone.",
        ])
    );
    assert!(!record_path(&box_, AGENTS).exists());
}

#[tokio::test]
async fn uninstall_removes_a_claude_folder_that_became_a_link_to_the_agents_folder_as_a_link_alone()
{
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    fs::remove_dir_all(folder_of(&box_, CLAUDE, "notes")).unwrap();
    symlink(
        folder_of(&box_, AGENTS, "notes"),
        folder_of(&box_, CLAUDE, "notes"),
    )
    .unwrap();
    let agents = tree(&folder_of(&box_, AGENTS, "notes"));
    let result = run(
        &box_,
        &["skills", "uninstall", "--agent", "claude"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&["Removed HOME/.claude/skills/notes."])
    );
    assert!(fs::symlink_metadata(folder_of(&box_, CLAUDE, "notes")).is_err());
    assert_eq!(tree(&folder_of(&box_, AGENTS, "notes")), agents);
}

#[tokio::test]
async fn uninstall_with_agent_agents_leaves_the_claude_folder_and_its_record_alone() {
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    let claude = tree(&folder_of(&box_, CLAUDE, "notes"));
    let record = fs::read_to_string(record_path(&box_, CLAUDE)).unwrap();
    let result = run(
        &box_,
        &["skills", "uninstall", "--agent", "agents"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&["Removed HOME/.agents/skills/notes."])
    );
    assert_eq!(tree(&folder_of(&box_, CLAUDE, "notes")), claude);
    assert_eq!(
        fs::read_to_string(record_path(&box_, CLAUDE)).unwrap(),
        record
    );
    assert!(!record_path(&box_, AGENTS).exists());
}

#[tokio::test]
async fn uninstall_calls_no_loader_and_succeeds_when_a_loader_throws() {
    let box_ = sandbox();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    fs::remove_file(&box_.loaded).unwrap();
    let result = run(
        &box_,
        &["skills", "uninstall"],
        &Scenario::default().skills(vec![throwing("notes")]),
    )
    .await;
    assert_eq!(result.status, 0);
    assert!(loaded(&box_).is_empty());
}

// one folder for both targets

/// A home where `~/.claude/skills` links to `~/.agents/skills`, as operators who share skills arrange.
fn linked(box_: &Sandbox) {
    fs::create_dir_all(box_.home.join(".agents").join("skills")).unwrap();
    fs::create_dir_all(box_.home.join(".claude")).unwrap();
    symlink(
        box_.home.join(".agents").join("skills"),
        box_.home.join(".claude").join("skills"),
    )
    .unwrap();
}

#[tokio::test]
async fn writes_the_folder_once_records_it_for_claude_alone_and_prints_the_same_folder_line() {
    let box_ = sandbox();
    linked(&box_);
    let result = run(&box_, &["skills", "install"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "HOME/.agents/skills is the same folder as HOME/.claude/skills, so notes acts on it once, for claude.",
            INSTALLED_BOTH[0],
        ])
    );
    assert!(!record_path(&box_, AGENTS).exists());
    assert_eq!(
        recorded(&box_, CLAUDE).folders,
        [folder_of(&box_, CLAUDE, "notes")
            .to_string_lossy()
            .into_owned()]
    );
    assert_eq!(tree(&folder_of(&box_, AGENTS, "notes")), written_tree());
}

#[tokio::test]
async fn removes_the_folder_once_on_uninstall() {
    let box_ = sandbox();
    linked(&box_);
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    let result = run(&box_, &["skills", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        pinned(&box_, &result.stderr),
        strings(&[
            "HOME/.agents/skills is the same folder as HOME/.claude/skills, so notes acts on it once, for claude.",
            "Removed HOME/.claude/skills/notes.",
        ])
    );
    assert!(!folder_of(&box_, AGENTS, "notes").exists());
}

#[tokio::test]
async fn refuses_an_explicit_agent_agents_over_a_folder_the_claude_record_owns() {
    let box_ = sandbox();
    linked(&box_);
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    let result = run(
        &box_,
        &["skills", "install", "--agent", "agents"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(
        pinned(&box_, &result.stderr)[0],
        "HOME/.agents/skills/notes was not installed by notes skills install."
    );
}

#[allow(dead_code)]
fn unused(box_: &Sandbox) -> String {
    record_state(&record_path(box_, CLAUDE))
}
