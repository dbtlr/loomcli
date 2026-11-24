//! Ports the skills cases of `pack-diagnostics.test.ts`: each settings fault panics at its builder
//! call with the `@loomcli/plugins/skills/settings` Developer Diagnostic, and an empty list is
//! accepted. The reference's `neither` and `web folder` faults have no counterpart: a Rust list is
//! never absent, and a folder is a path, not a URL (see docs/deviations.md).

#![cfg(feature = "skills")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};

use loomcli_plugins::skills::{Skill, SkillFile, skills};

/// The message a call panics with, or none when it returns.
fn diagnostic(call: impl FnOnce()) -> Option<String> {
    catch_unwind(AssertUnwindSafe(call)).err().map(|payload| {
        payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| {
                payload
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
            })
            .unwrap_or_default()
    })
}

fn skill(name: &str) -> Skill {
    Skill::new(name, [SkillFile::new("SKILL.md", "# Skill\n")])
}

fn assert_fault(message: Option<String>, sentence: &str, correction: &str) {
    let message = message.expect("the call panics");
    assert!(
        message.contains("@loomcli/plugins/skills/settings"),
        "{message}"
    );
    assert!(
        message.contains(&format!("Plugin \"@loomcli/plugins/skills\" {sentence}")),
        "{message}"
    );
    assert!(message.contains(correction), "{message}");
}

const NAME_CORRECTION: &str =
    "Use lowercase letters, digits, and single hyphens, 64 characters at most, such as notes.";

#[test]
fn settings_that_hold_an_empty_list_and_no_folder_are_accepted() {
    assert_eq!(diagnostic(|| drop(skills(Vec::new()).plugin())), None);
}

#[test]
fn a_name_outside_the_grammar_panics_with_the_name_diagnostic() {
    assert_fault(
        diagnostic(|| drop(skills(vec![skill("Notes")]))),
        "setting \"skills\" holds a name that is not a skill name: Notes.",
        NAME_CORRECTION,
    );
}

#[test]
fn the_grammar_is_lowercase_letters_and_digits_joined_by_single_hyphens_64_at_most() {
    for good in ["notes", "n", "a-b", "a1-2b", &"a".repeat(64)] {
        assert_eq!(
            diagnostic(|| drop(skills(vec![skill(good)]))),
            None,
            "{good}"
        );
    }
    for bad in [
        "",
        "-a",
        "a-",
        "a--b",
        "A",
        "a_b",
        "a b",
        "a/b",
        "..",
        "é",
        &"a".repeat(65),
    ] {
        assert!(
            diagnostic(|| drop(skills(vec![skill(bad)]))).is_some(),
            "{bad:?}"
        );
    }
}

#[test]
fn a_name_listed_twice_panics_with_the_twice_diagnostic() {
    assert_fault(
        diagnostic(|| drop(skills(vec![skill("notes"), skill("notes")]))),
        "setting \"skills\" holds the skill name notes twice.",
        "Give each skill its own name.",
    );
}

#[test]
fn an_empty_folder_panics_with_the_folder_diagnostic() {
    assert_fault(
        diagnostic(|| drop(skills(Vec::new()).folder(""))),
        "setting \"folder\" is an empty string.",
        "Name the folder with an absolute path, such as Path::new(env!(\"CARGO_MANIFEST_DIR\")).join(\"skills\").",
    );
}

#[test]
fn a_bad_embedded_name_panics_with_the_embedded_diagnostic() {
    assert_fault(
        diagnostic(|| drop(skills(Vec::new()).embedded_folder(vec![skill("Notes")]))),
        "setting \"embedded_folder\" holds a name that is not a skill name: Notes.",
        NAME_CORRECTION,
    );
    assert_fault(
        diagnostic(|| {
            drop(skills(Vec::new()).embedded_folder(vec![skill("notes"), skill("notes")]));
        }),
        "setting \"embedded_folder\" holds the skill name notes twice.",
        "Give each skill its own name.",
    );
}

#[test]
fn a_name_the_diagnostic_repeats_passes_through_the_control_character_escape() {
    let message = diagnostic(|| drop(skills(vec![skill("no\u{7}tes")]))).unwrap();
    assert!(message.contains("no\\u0007tes."), "{message}");
}
