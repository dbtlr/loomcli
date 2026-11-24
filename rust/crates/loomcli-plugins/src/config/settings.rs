//! The judgments of the configuration plugin's settings: the file pattern, the variable name, and
//! the root markers, each at the setter that receives it. A fault panics at the author's line with
//! the whole Developer Diagnostic, as every declaration fault of a builder does.

use loomcli_core::{
    DeclarationError, DiagnosticParts, DiagnosticRule, FailureFacts, Finding, diagnostic_rule,
};

use super::IDENTITY;
use super::reading::split_extension;

/// A configuration plugin `file` setting that is not a relative path.
pub(crate) const FILE_PATH: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/file-path",
    "Invalid configuration file path",
    "The configuration plugin looks for its file in the start directory, each of its ancestors, and the home directory, so file is a relative path whose segments each name a directory or a file.",
);

/// A configuration plugin `file` setting whose glob syntax is not a whole extension it can read.
pub(crate) const FILE_PATTERN: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/file-pattern",
    "Invalid configuration file pattern",
    "The configuration plugin chooses a file's parser by its extension, so file holds glob syntax only as the whole extension of its name: * for any format the plugin reads, or a brace list of json, jsonc, toml, yaml, and yml, tried in the order listed.",
);

/// A configuration plugin `env` setting that is not an environment variable name.
pub(crate) const VARIABLE_NAME: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/variable-name",
    "Invalid configuration variable name",
    "The configuration plugin reads the variable that env names from the run's environment, and an environment variable's name is a letter or underscore followed by letters, digits, or underscores, so a name of another form can never hold a value.",
);

/// A configuration plugin root marker that is not one path segment.
pub(crate) const ROOT_NAME: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/root-name",
    "Invalid configuration root marker",
    "The configuration plugin's project walk checks each directory it looks in for an entry of each root marker's name, so a marker names one entry: it is nonempty, holds no slash or backslash, and is neither . nor ..",
);

/// The extensions a pattern may name, in the order `*` tries them.
const READABLE: [&str; 5] = ["toml", "yaml", "yml", "json", "jsonc"];

/// Whether a character is glob syntax, which `file` holds only as the whole extension of its name.
fn is_glob(character: char) -> bool {
    matches!(character, '*' | '?' | '[' | ']' | '{' | '}')
}

/// One fault of the `file` setting: its rule, sentence, and correction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FileFault {
    NotRelative,
    StrayGlob,
    UnreadableExtension,
}

impl FileFault {
    fn parts(self) -> (DiagnosticRule, String, &'static str) {
        match self {
            FileFault::NotRelative => (
                FILE_PATH,
                format!("Plugin \"{IDENTITY}\" file is not a relative path."),
                "Supply a relative path such as .textstat.toml, with no empty, ., or .. segment.",
            ),
            FileFault::StrayGlob => (
                FILE_PATTERN,
                format!(
                    "Plugin \"{IDENTITY}\" file holds glob syntax other than an extension of * or a brace list."
                ),
                "Write the name literally, and use * or a brace list only as the whole text after its last dot.",
            ),
            FileFault::UnreadableExtension => (
                FILE_PATTERN,
                format!("Plugin \"{IDENTITY}\" file lists an extension the plugin cannot read."),
                "List only json, jsonc, toml, yaml, or yml in the braces, or use * for any of them.",
            ),
        }
    }
}

/// Whether a path is relative and well formed: nonempty, not rooted at `/`, `\`, or a drive letter
/// and a colon, and with every segment, split on `/` and `\`, nonempty and neither `.` nor `..`.
fn is_relative_path(path: &str) -> bool {
    let mut characters = path.chars();
    let rooted = match (characters.next(), characters.next()) {
        (None, _) => return false,
        (Some('/' | '\\'), _) => true,
        (Some(letter), Some(':')) => letter.is_ascii_alphabetic(),
        _ => false,
    };
    !rooted
        && path
            .split(['/', '\\'])
            .all(|segment| !matches!(segment, "" | "." | ".."))
}

/// The candidates a glob extension names after a stem: `*` names every readable extension, and a
/// brace list the extensions it lists, each at its first position.
fn extension_candidates(stem: &str, extension: &str) -> Result<Vec<String>, FileFault> {
    if extension == "*" {
        return Ok(READABLE
            .iter()
            .map(|name| format!("{stem}.{name}"))
            .collect());
    }
    let items = extension
        .strip_prefix('{')
        .and_then(|rest| rest.strip_suffix('}'))
        .filter(|items| !items.chars().any(is_glob))
        .ok_or(FileFault::StrayGlob)?;
    let mut listed: Vec<&str> = Vec::new();
    for name in items.split(',') {
        if !READABLE.contains(&name) {
            return Err(FileFault::UnreadableExtension);
        }
        if !listed.contains(&name) {
            listed.push(name);
        }
    }
    Ok(listed.iter().map(|name| format!("{stem}.{name}")).collect())
}

/// The candidates a file pattern names, in the order the lookup tries them, or the fault it
/// raises. The path rule comes first, then the pattern rule. A path with no glob syntax is its own
/// one candidate; otherwise the glob syntax is the whole extension of the last segment.
pub(crate) fn file_candidates(file: &str) -> Result<Vec<String>, FileFault> {
    if !is_relative_path(file) {
        return Err(FileFault::NotRelative);
    }
    if !file.chars().any(is_glob) {
        return Ok(vec![file.to_owned()]);
    }
    match split_extension(file) {
        Some((stem, extension)) if !stem.chars().any(is_glob) => {
            extension_candidates(stem, extension)
        }
        _ => Err(FileFault::StrayGlob),
    }
}

/// Whether a name is an environment variable name: a letter or underscore, then letters, digits,
/// or underscores, all ASCII.
pub(crate) fn is_variable_name(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

/// Whether a name is one path segment: nonempty, with no `/` or `\`, and neither `.` nor `..`.
pub(crate) fn is_entry_name(name: &str) -> bool {
    !matches!(name, "" | "." | "..") && !name.contains(['/', '\\'])
}

/// Panics with a settings fault's whole Developer Diagnostic, at the author's line.
#[track_caller]
fn raise(rule: DiagnosticRule, sentence: String, correction: &str, finding: Finding) -> ! {
    let fault = DeclarationError::new(
        rule,
        DiagnosticParts::new(sentence)
            .finding(finding)
            .correction(correction),
    );
    panic!("{}", FailureFacts::message(&fault));
}

/// The candidates of the `file` setting, or the panic of its fault.
#[track_caller]
pub(crate) fn judge_file(file: &str) -> Vec<String> {
    file_candidates(file).unwrap_or_else(|fault| {
        let (rule, sentence, correction) = fault.parts();
        raise(
            rule,
            sentence,
            correction,
            Finding::new("ConfigurationSettings::file", vec![file.into()]).mark("0"),
        )
    })
}

/// The `env` setting, or the panic of its fault.
#[track_caller]
pub(crate) fn judge_variable(name: &str) -> String {
    if !is_variable_name(name) {
        raise(
            VARIABLE_NAME,
            format!("Plugin \"{IDENTITY}\" env is not a variable name."),
            "Name a variable such as COLLECTOR_CONFIG: a letter or an underscore, then letters, digits, or underscores.",
            Finding::new("ConfigurationSettings::env", vec![name.into()]).mark("0"),
        );
    }
    name.to_owned()
}

/// The root markers of a project scope, or the panic of the first that is not one path segment.
#[track_caller]
pub(crate) fn judge_markers(markers: &[String]) {
    if let Some(index) = markers.iter().position(|name| !is_entry_name(name)) {
        raise(
            ROOT_NAME,
            format!("Plugin \"{IDENTITY}\" root is not a file name."),
            "Name an entry in the project's root directory, such as package.json or .git.",
            Finding::new(
                "Scope::Project",
                vec![loomcli_core::Literal::List(
                    markers.iter().map(|name| name.as_str().into()).collect(),
                )],
            )
            .mark(format!("0.{index}")),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // config.test.ts: the file-path, file-pattern, and returning cases of `configuration()`.
    #[test]
    fn a_file_that_is_not_a_relative_path_is_the_file_path_fault() {
        for file in [
            "",
            "/etc/textstat.json",
            "\\textstat.json",
            "C:textstat.json",
            "c:\\textstat.json",
            "a//b.json",
            "a/",
            "./.textstat.json",
            "a/../b.json",
            "a\\.\\b.json",
            "..",
            "/*.json",
            "a/../*.json",
        ] {
            assert_eq!(
                file_candidates(file),
                Err(FileFault::NotRelative),
                "{file:?}"
            );
        }
    }

    #[test]
    fn glob_syntax_outside_a_whole_extension_is_the_glob_fault() {
        for file in [
            "*.json",
            ".text*.json",
            "dir*/.textstat.json",
            "{a,b}/.textstat.json",
            ".textstat.t*",
            ".textstat.?",
            ".textstat.[jt]son",
            ".textstat.{toml,ya*ml}",
            ".textstat.{toml,yaml",
            ".textstat.{toml}x",
            "*",
            ".*",
            ".textstat.{toml,y.ml}",
        ] {
            assert_eq!(file_candidates(file), Err(FileFault::StrayGlob), "{file:?}");
        }
    }

    #[test]
    fn a_brace_list_of_an_unreadable_extension_is_the_list_fault() {
        for file in [
            ".textstat.{toml,ini}",
            ".textstat.{toml,}",
            ".textstat.{}",
            ".textstat.{TOML}",
        ] {
            assert_eq!(
                file_candidates(file),
                Err(FileFault::UnreadableExtension),
                "{file:?}"
            );
        }
    }

    #[test]
    fn a_well_formed_file_names_its_candidates() {
        assert_eq!(
            file_candidates(".textstat.json"),
            Ok(vec![".textstat.json".into()])
        );
        assert_eq!(
            file_candidates(".norn/config.toml"),
            Ok(vec![".norn/config.toml".into()])
        );
        assert_eq!(
            file_candidates("dir\\.textstat.*"),
            Ok(READABLE
                .iter()
                .map(|name| format!("dir\\.textstat.{name}"))
                .collect())
        );
        assert_eq!(
            file_candidates(".textstat.{json,toml,json}"),
            Ok(vec![".textstat.json".into(), ".textstat.toml".into()])
        );
        for file in [
            ".textstat.{toml,yaml,yml,json}",
            ".textstat.conf",
            ".textstatrc",
            ".text\u{2028}stat.json",
        ] {
            assert!(file_candidates(file).is_ok(), "{file:?}");
        }
    }

    #[test]
    fn a_variable_name_is_a_letter_or_underscore_then_letters_digits_or_underscores() {
        for name in ["APP_CONFIG", "_x9"] {
            assert!(is_variable_name(name), "{name}");
        }
        for name in ["", "1APP", "APP-CONFIG", "APP CONFIG", "APP=1", "É"] {
            assert!(!is_variable_name(name), "{name}");
        }
    }

    #[test]
    fn a_root_marker_is_one_path_segment() {
        assert!(is_entry_name("package.json"));
        for name in ["", "a/b", "a\\b", ".", "..", "/"] {
            assert!(!is_entry_name(name), "{name:?}");
        }
    }
}
