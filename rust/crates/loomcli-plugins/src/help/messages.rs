//! The sentences of the help plugin: the hint under a usage error, and the option-group sentences
//! help and the man page share.

use loomcli_core::{OptionGroupKind, escape_control_characters};

/// The plain option-group sentence help, man pages, and command references share.
pub(super) fn option_group_sentence(
    kind: OptionGroupKind,
    spellings: &[String],
    accepts_stdin: bool,
) -> Option<String> {
    let names: Vec<String> = spellings
        .iter()
        .map(|name| escape_control_characters(name))
        .collect();
    let rule = match kind {
        OptionGroupKind::Exclusive => format!("Use at most one of {}", joined_names(&names)),
        OptionGroupKind::OneRequired => format!("Supply at least one of {}", joined_names(&names)),
        OptionGroupKind::RequiredTogether => format!("Use {} together", joined_names(&names)),
        OptionGroupKind::Requires => {
            let (option, needed) = names.split_first()?;
            format!("Use {option} only with {}", joined_names(needed))
        }
        _ => return None,
    };
    let caveat = if accepts_stdin {
        " (piped stdin does not count)"
    } else {
        ""
    };
    Some(format!("{rule}{caveat}."))
}

fn joined_names(names: &[String]) -> String {
    match names {
        [only] => only.clone(),
        [first, second] => format!("{first} and {second}"),
        [rest @ .., last] => format!("{}, and {last}", rest.join(", ")),
        [] => String::new(),
    }
}

#[cfg(feature = "help")]
pub(super) fn usage_hint(command: &[&str]) -> String {
    let shown: Vec<String> = command
        .iter()
        .map(|word| escape_control_characters(word))
        .collect();
    format!("Run \"{}\" to see the usage.", shown.join(" "))
}

/// The `--` row that explains the escape for a child name.
pub(crate) const CHILD_NAME_ESCAPE: &str =
    "Read every later word as an argument, even a command name.";

/// The label of the terminal requirement.
pub(crate) const TERMINAL_NEED_LABEL: &str = "Needs a terminal: ";
/// The terminal requirement shared by help, man pages, and command references.
pub(crate) const TERMINAL_NEED_TEXT: &str = "stdin and stderr, outside CI.";

pub(super) fn stdin_sentence(required: bool) -> &'static str {
    if required {
        "Required. Reads piped or redirected stdin. Terminal input is not accepted."
    } else {
        "Optional. Reads piped or redirected stdin. Terminal input is not accepted."
    }
}

pub(super) fn stdin_example(path: &str) -> String {
    format!("Example: <producer> | {}", escape_control_characters(path))
}
