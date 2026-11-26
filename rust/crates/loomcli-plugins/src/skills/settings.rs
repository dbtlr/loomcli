//! The settings the skills plugin judges at its builder calls: skill names and the folder setting.

use std::collections::BTreeSet;
use std::path::Path;

use loomcli_core::{
    DeclarationError, DiagnosticParts, DiagnosticRule, FailureFacts, Finding, Literal,
    diagnostic_rule, escape_control_characters,
};

use super::Skill;
use crate::PACKAGE_NAME;

/// `@loomcli/plugins/skills/settings`.
const SETTINGS_RULE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/skills/settings",
    "Invalid skills setting",
    "The skills plugin installs each skill as one folder, named by the skill's name, where an agent reads skills, so the settings name a folder of skills, a file URL or a nonempty path, or a list of skills, each name follows the Agent Skills grammar, lowercase letters and digits joined by single hyphens, 64 characters at most, and no two skills hold one name.",
);

/// The longest skill name, the Agent Skills grammar's limit.
const LONGEST_NAME: usize = 64;

/// Whether a value is a skill name: runs of lowercase ASCII letters and digits joined by single
/// hyphens, 64 characters at most, safe as one path segment.
pub(super) fn is_skill_name(name: &str) -> bool {
    name.len() <= LONGEST_NAME
        && name.split('-').all(|run| {
            !run.is_empty()
                && run
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

/// Panics with the Developer Diagnostic of a settings fault, marked on the argument at fault.
#[track_caller]
fn settings_fault(call: &str, argument: Literal, mark: &str, sentence: String, correction: &str) {
    let fault = DeclarationError::new(
        SETTINGS_RULE,
        DiagnosticParts::new(format!("Plugin \"{PACKAGE_NAME}/skills\" {sentence}"))
            .finding(Finding::new(call, vec![argument]).mark(mark))
            .correction(correction),
    );
    panic!("{}", FailureFacts::message(&fault));
}

/// Judges a list of skills' names, in order: each a skill name, and none an earlier skill's.
/// `setting` names the list in the sentence, and `call` the builder call a finding rebuilds.
#[track_caller]
pub(super) fn judge_names(call: &str, setting: &str, skills: &[Skill]) {
    let names = || {
        Literal::List(
            skills
                .iter()
                .map(|skill| Literal::String(skill.name().to_owned()))
                .collect(),
        )
    };
    let mut seen = BTreeSet::new();
    for (index, skill) in skills.iter().enumerate() {
        let name = skill.name();
        if !is_skill_name(name) {
            settings_fault(
                call,
                names(),
                &format!("0.{index}"),
                format!(
                    "setting \"{setting}\" holds a name that is not a skill name: {}.",
                    escape_control_characters(name)
                ),
                "Use lowercase letters, digits, and single hyphens, 64 characters at most, such as notes.",
            );
        }
        if !seen.insert(name) {
            settings_fault(
                call,
                names(),
                &format!("0.{index}"),
                format!("setting \"{setting}\" holds the skill name {name} twice."),
                "Give each skill its own name.",
            );
        }
    }
}

/// Judges the `folder` setting: a path that is not empty.
#[track_caller]
pub(super) fn judge_folder(folder: &Path) {
    if folder.as_os_str().is_empty() {
        settings_fault(
            "Skills::folder",
            Literal::String(String::new()),
            "0",
            "setting \"folder\" is an empty string.".to_owned(),
            "Name the folder with an absolute path, such as Path::new(env!(\"CARGO_MANIFEST_DIR\")).join(\"skills\").",
        );
    }
}

/// Panics with the settings diagnostic of an embedded copy whose setting names no folder.
#[track_caller]
pub(super) fn embedded_without_folder(skills: &[Skill]) {
    settings_fault(
        "Skills::embedded_folder",
        Literal::List(
            skills
                .iter()
                .map(|skill| Literal::String(skill.name().to_owned()))
                .collect(),
        ),
        "0",
        "setting \"embedded_folder\" gives the skills of a folder, and the settings name no \"folder\".".to_owned(),
        "Name the folder with Skills::folder, such as Path::new(env!(\"CARGO_MANIFEST_DIR\")).join(\"skills\").",
    );
}

/// Checks the skill name accepted by the selection builder.
#[track_caller]
pub(super) fn judge_selection_name(name: &str) {
    if !is_skill_name(name) {
        settings_fault(
            "Skills::select_commands",
            Literal::String(name.to_owned()),
            "0",
            format!(
                "setting \"skills\" holds a name that is not a skill name: {}.",
                escape_control_characters(name)
            ),
            "Use lowercase letters, digits, and single hyphens, 64 characters at most, such as notes.",
        );
    }
}
