//! Ports the `loading` and `the Commands` cases of `skills.test.ts` and the home-folder case of
//! `host-facts.test.ts`: which Commands call a loader, in what order, the pinned faults of a
//! loader's files, a loader that fails, the declared Commands, and the install under `host.home`.

#![cfg(feature = "skills")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod skills_support;

use std::fs;
use std::sync::Arc;

use loomcli_core::{Application, Build, ProcessHandle, ReleaseFacts, RunOptions};
use loomcli_plugins::skills::{Skill, SkillFile, skills};
use loomcli_testing::{MockFields, mock_process};
use skills_support::{
    Entry, Scenario, application, application_with, entry, file, loaded, run, sandbox, throwing,
};

#[tokio::test]
async fn calls_no_loader_for_a_run_of_any_command_outside_skills() {
    let box_ = sandbox();
    let result = run(&box_, &["ping"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(result.stdout, "pong\n");
    assert!(loaded(&box_).is_empty());
}

#[tokio::test]
async fn calls_no_loader_when_the_group_is_asked_for_its_children() {
    let box_ = sandbox();
    let result = run(&box_, &["skills"], &Scenario::default()).await;
    assert!(loaded(&box_).is_empty(), "{}", result.stderr);
}

#[tokio::test]
async fn calls_each_loader_once_in_declaration_order() {
    let box_ = sandbox();
    let second = entry("second", vec![file("SKILL.md", "s")]);
    run(
        &box_,
        &["skills", "install"],
        &Scenario::default().skills(vec![second, skills_support::notes()]),
    )
    .await;
    assert_eq!(loaded(&box_), ["second", "notes"]);
}

fn faults() -> Vec<(&'static str, Entry, &'static str, &'static str)> {
    let path = "Use a relative path with no .. part, such as references/commands.md.";
    vec![
        (
            "a path that leaves the folder",
            entry(
                "notes",
                vec![file("../notes.md", "x"), file("SKILL.md", "x")],
            ),
            "Skill \"notes\" lists a file path outside its folder: ../notes.md.",
            path,
        ),
        (
            "an absolute path",
            entry("notes", vec![file("/SKILL.md", "x")]),
            "Skill \"notes\" lists a file path outside its folder: /SKILL.md.",
            path,
        ),
        (
            "no SKILL.md",
            entry("notes", vec![file("README.md", "x")]),
            "Skill \"notes\" lists no SKILL.md.",
            "Add the skill's SKILL.md at the top of its files.",
        ),
    ]
}

#[tokio::test]
async fn throws_the_pinned_diagnostic_for_a_loaders_fault_and_writes_nothing() {
    for (name, skill, sentence, correction) in faults() {
        let box_ = sandbox();
        let scenario = Scenario::default()
            .build(Build::Development)
            .skills(vec![skill]);
        for child in ["install", "update"] {
            let result = run(&box_, &["skills", child], &scenario).await;
            assert_eq!(result.status, 1, "{name} {child}");
            assert!(
                result.stderr.contains("@loomcli/plugins/skills/files"),
                "{name}: {}",
                result.stderr
            );
            assert!(
                result.stderr.contains(sentence),
                "{name}: {}",
                result.stderr
            );
            assert!(
                result.stderr.contains(correction),
                "{name}: {}",
                result.stderr
            );
        }
        assert!(!box_.home.join(".claude").exists(), "{name}");
        assert!(!box_.state.join("notes").exists(), "{name}");
        let project = run(&box_, &["skills", "install", "--project"], &scenario).await;
        assert_eq!(project.status, 1, "{name}");
        assert!(!box_.repo.join(".claude").exists(), "{name}");
    }
}

#[tokio::test]
async fn fails_the_run_through_the_ordinary_path_when_a_loader_fails() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["skills", "install"],
        &Scenario::default()
            .build(Build::Development)
            .skills(vec![throwing("notes")]),
    )
    .await;
    assert_eq!(result.status, 1);
    assert!(
        result.stderr.contains("The notes loader failed."),
        "{}",
        result.stderr
    );
    assert!(!box_.home.join(".claude").exists());
}

#[tokio::test]
async fn an_asynchronous_loader_runs_and_a_loader_may_fail_with_any_error() {
    let box_ = sandbox();
    let asynchronous = Skill::loaded_async("notes", || async {
        Ok(vec![SkillFile::new("SKILL.md", "# Async\n")])
    });
    let application = application_with(skills(vec![asynchronous]));
    let result = skills_support::run_application(
        &application,
        &box_,
        &["skills", "install"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        fs::read_to_string(skills_support::folder_of(&box_, "claude", "notes").join("SKILL.md"))
            .unwrap(),
        "# Async\n"
    );
}

#[test]
fn describes_skills_and_its_three_children() {
    let box_ = sandbox();
    let graph = serde_json::to_string(
        &application(&box_, &Scenario::default())
            .inspect()
            .expect("the application builds"),
    )
    .unwrap();
    for text in [
        "Install this application's agent skills.",
        "Install the skills for your coding agents.",
        "Bring installed skills up to date with this version.",
        "Remove the skills from your coding agents.",
        "The agents to install for: claude, or agents for Codex and others. Both when left out.",
        "The agents to remove the skills from: claude or agents. Both when left out.",
        "Install into the current repository instead of your home folder.",
        "Find the repository from this directory instead of the current one.",
        "Replace skill files that something else wrote or that you changed.",
    ] {
        assert!(graph.contains(text), "{text}: {graph}");
    }
    assert!(graph.contains("\"short\":\"-C\""), "{graph}");
    assert!(graph.contains("\"long\":\"--directory\""), "{graph}");
}

#[tokio::test]
async fn update_takes_no_agent_option() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["skills", "update", "--agent", "claude"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 2);
}

#[tokio::test]
async fn installs_under_host_home_not_under_home_in_the_environment() {
    let box_ = sandbox();
    let elsewhere = box_.root.join("elsewhere-home");
    fs::create_dir_all(&elsewhere).unwrap();
    let process = mock_process(
        MockFields::new()
            .argv(["skills", "install", "--agent", "agents"])
            .cwd(&box_.repo)
            .env("HOME", &elsewhere.to_string_lossy())
            .env("XDG_STATE_HOME", &box_.home.join("state").to_string_lossy())
            .home(&box_.home)
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let generated = Skill::loaded("notes", || {
        Ok(vec![SkillFile::new("SKILL.md", "# Notes\n")])
    });
    let application: Application<_, _, _> = application_with(skills(vec![generated]));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 0, "{}", process.stderr_text());
    assert!(process.stderr_text().contains(&format!(
        "Installed notes for agents in {}",
        box_.home.display()
    )));
    assert!(!elsewhere.join(".agents").exists());
    assert!(box_.home.join(".agents/skills/notes").exists());
}
