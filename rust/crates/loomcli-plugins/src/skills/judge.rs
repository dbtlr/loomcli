//! The judgment of a skill's files, a loader's or a folder's, before anything is written.

use loomcli_core::{
    DeclarationError, DiagnosticParts, DiagnosticRule, diagnostic_rule, escape_control_characters,
};

use super::SkillFile;

/// `@loomcli/plugins/skills/files`.
pub(super) const FILES_RULE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/skills/files",
    "Invalid skill files",
    "The skills plugin writes each skill as one folder in the operator's agent folders, so each file's path is relative to that folder, with no .. part that would write outside it, and the list holds the skill's SKILL.md, the file every agent reads first, and no listed skill holds a name the skills folder holds.",
);

/// The file every skill lists.
const ENTRY_FILE: &str = "SKILL.md";

/// A fault of a skill's files under the plugin's files rule.
pub(super) fn files_fault(sentence: String, correction: &str) -> DeclarationError {
    DeclarationError::new(
        FILES_RULE,
        DiagnosticParts::new(sentence).correction(correction),
    )
}

/// Whether a path leaves the skill's folder: it is absolute, or one of its parts is `..`.
fn leaves_folder(path: &str) -> bool {
    path.starts_with('/') || path.split('/').any(|part| part == "..")
}

/// A skill's files, or the first fault they hold, in the order the contract lists them: a path
/// outside the folder, then a missing `SKILL.md`. The name passed the skill-name grammar, so a
/// sentence repeats it as it is.
pub(super) fn judged(
    name: &str,
    files: Vec<SkillFile>,
) -> Result<Vec<SkillFile>, DeclarationError> {
    if let Some(outside) = files.iter().find(|file| leaves_folder(file.path())) {
        return Err(files_fault(
            format!(
                "Skill \"{name}\" lists a file path outside its folder: {}.",
                escape_control_characters(outside.path())
            ),
            "Use a relative path with no .. part, such as references/commands.md.",
        ));
    }
    if !files.iter().any(|file| file.path() == ENTRY_FILE) {
        return Err(files_fault(
            format!("Skill \"{name}\" lists no {ENTRY_FILE}."),
            "Add the skill's SKILL.md at the top of its files.",
        ));
    }
    Ok(files)
}
