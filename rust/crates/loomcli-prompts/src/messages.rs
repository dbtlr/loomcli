//! The operator sentences of the questions, under the reference's ADR-0164. Each is a function of
//! the values it repeats, or a constant.

use loomcli_core::escape_control_characters;

/// The values a sentence quotes, each escaped and in double quotes, joined as a sentence lists them.
fn quoted_values(values: &[String]) -> String {
    values
        .iter()
        .map(|value| format!("\"{}\"", escape_control_characters(value)))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn interaction_unavailable(question: &str, command: &str) -> String {
    format!(
        "The question \"{}\" needs an interactive terminal, and this run is not interactive. Run \"{}\" at a terminal.",
        escape_control_characters(question),
        escape_control_characters(command)
    )
}

pub(crate) fn editor_file_unwritable(folder: &str, code: &str) -> String {
    format!(
        "Cannot write the editor's file in \"{}\" ({}). Set TMPDIR to a folder you can write to, then run the command again.",
        escape_control_characters(folder),
        escape_control_characters(code)
    )
}

pub(crate) fn editor_not_started(editor: &str) -> String {
    format!(
        "The editor \"{}\" could not start. Set VISUAL or EDITOR to an editor you have installed, then run the command again.",
        escape_control_characters(editor)
    )
}

pub(crate) fn editor_exited(editor: &str, status: i32) -> String {
    format!(
        "The editor \"{}\" exited with code {status}, so the question has no answer. To answer it, set VISUAL or EDITOR to another editor if you need one, then run the command again.",
        escape_control_characters(editor)
    )
}

pub(crate) const ANSWER_FILE_REMOVED: &str =
    "The editor removed the answer's file. Save the answer before you close the editor.";

pub(crate) fn answer_file_unreadable(code: &str) -> String {
    format!(
        "The question cannot read the answer's file ({}). Save the answer as a file before you close the editor.",
        escape_control_characters(code)
    )
}

pub(crate) const ANSWER_NOT_UTF8: &str = "The saved answer is not UTF-8 text. Save it as UTF-8.";

pub(crate) const INVALID_ANSWER: &str = "The answer is invalid.";

pub(crate) const YES_OR_NO: &str = "Type y or n.";

pub(crate) const NO_SELECTABLE_CHOICE: &str = "No choice can be selected. Change the search.";

pub(crate) fn choose_at_least(min: usize) -> String {
    format!("Choose at least {min}.")
}

pub(crate) fn choice_issue(label: &str, sentence: &str) -> String {
    format!("{}: {sentence}", escape_control_characters(label))
}

pub(crate) fn unselectable(values: &[String]) -> String {
    format!(
        "Cannot select {}. Choose from the list.",
        quoted_values(values)
    )
}

pub(crate) fn over_limit(values: &[String], max: usize) -> String {
    format!(
        "Cannot select {}: at most {max} can be selected. Deselect a choice to select {}.",
        quoted_values(values),
        if values.len() == 1 { "it" } else { "one" }
    )
}

pub(crate) fn choose_at_most(max: usize) -> String {
    format!("Choose at most {max}.")
}

pub(crate) fn type_one_number(highest: usize) -> String {
    format!("Type a number from 1 to {highest}.")
}

pub(crate) fn type_numbers(highest: usize) -> String {
    format!("Type numbers from 1 to {highest}, separated by commas.")
}

/// The kept log's notice when earlier lines no longer fit its retention limit.
pub(crate) fn dropped_log_lines(count: usize) -> String {
    if count == 1 {
        "1 earlier line was dropped.".to_owned()
    } else {
        format!("{count} earlier lines were dropped.")
    }
}
