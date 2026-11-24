//! The manifest plugin's extension descriptors: declarations alone.

use loomcli_core::{
    Collecting, CommandTarget, Extension, Failure, Issue, escape_control_characters,
    is_failure_code,
};
use serde::{Deserialize, Serialize};

/// A failure a Command declares to the manifest, by its class's failure code.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DeclaredFailure {
    /// The class's failure code.
    pub code: String,
    /// The class's exit code.
    pub exit_code: u8,
    /// One line of meaning.
    pub meaning: String,
}

impl DeclaredFailure {
    /// A declared failure written out: its failure code, exit code, and meaning. A code outside
    /// the failure-code grammar or an exit code outside 1 through 125 is rejected when the value
    /// is built into a Command, under `invalid-extension-value`. Use
    /// [`DeclaredFailure::of`] to read the code and exit code from a failure class instead.
    pub fn new(code: impl Into<String>, exit_code: u8, meaning: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            exit_code,
            meaning: meaning.into(),
        }
    }

    /// The failure class `F`, with its meaning.
    pub fn of<F: Failure>(meaning: impl Into<String>) -> Self {
        let class = F::failure_class();
        Self {
            code: class.code().to_owned(),
            exit_code: class.exit_code().get(),
            meaning: meaning.into(),
        }
    }
}

/// One example invocation: the tokens after the application name as one line, and an optional note
/// of one line. Help prints it under EXAMPLES and the manifest lists it in the Command's entry.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct CommandExample {
    /// The command line after the application name.
    pub command: String,
    /// What it does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl CommandExample {
    /// An example command line.
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            note: None,
        }
    }

    /// Adds its note.
    #[must_use]
    pub fn note(self, note: impl Into<String>) -> Self {
        Self {
            note: Some(note.into()),
            ..self
        }
    }
}

/// The manifest facts of a Command.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct ManifestCommandFacts {
    /// An instruction an agent needs beyond what the help page says.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// Example invocations.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub examples: Vec<CommandExample>,
    /// The failures the Command can raise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<DeclaredFailure>,
}

impl ManifestCommandFacts {
    /// No facts.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the details.
    #[must_use]
    pub fn details(self, details: impl Into<String>) -> Self {
        Self {
            details: Some(details.into()),
            ..self
        }
    }

    /// Sets the example invocations.
    #[must_use]
    pub fn examples(self, examples: impl IntoIterator<Item = CommandExample>) -> Self {
        Self {
            examples: examples.into_iter().collect(),
            ..self
        }
    }

    /// Sets the declared failures.
    #[must_use]
    pub fn failures(self, failures: impl IntoIterator<Item = DeclaredFailure>) -> Self {
        Self {
            failures: failures.into_iter().collect(),
            ..self
        }
    }
}

/// One line that holds a character other than whitespace and no line terminator.
const LINE_MESSAGE: &str = "Supply one line that holds a character other than whitespace.";

/// A failure code outside the failure-code grammar.
const CODE_MESSAGE: &str =
    "Declare a kebab-case code of lowercase letters and digits, such as \"registry-down\".";

/// An exit code outside 1 through 125.
const EXIT_CODE_MESSAGE: &str = "Declare an exit code from 1 to 125.";

/// Markdown may hold blank lines and a final terminator, but is never whitespace alone.
const MARKDOWN_MESSAGE: &str = "Supply Markdown that holds a character other than whitespace.";

/// JavaScript's `\s`: tab, line feed, vertical tab, form feed, carriage return, space, U+00A0,
/// U+1680, U+2000 through U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, and U+FEFF. Rust's
/// `char::is_whitespace` differs (it holds U+0085 and lacks U+FEFF).
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn has_content(text: &str) -> bool {
    text.chars().any(|c| !is_js_space(c))
}

fn is_line(text: &str) -> bool {
    has_content(text)
        && !text.contains([
            '\n', '\u{b}', '\u{c}', '\r', '\u{85}', '\u{2028}', '\u{2029}',
        ])
}

/// The value rules a type cannot state: details are Markdown, and an example's command and note and
/// a failure's meaning are each one line.
fn check_facts(facts: &ManifestCommandFacts) -> Result<(), Vec<Issue>> {
    let mut issues = Vec::new();
    if facts.details.as_deref().is_some_and(|d| !has_content(d)) {
        issues.push(Issue::new(MARKDOWN_MESSAGE));
    }
    for example in &facts.examples {
        if !is_line(&example.command) || example.note.as_deref().is_some_and(|n| !is_line(n)) {
            issues.push(Issue::new(LINE_MESSAGE));
        }
    }
    for failure in &facts.failures {
        if !is_failure_code(&failure.code) {
            issues.push(Issue::new(format!(
                "Failure declares failure code \"{}\". {CODE_MESSAGE}",
                escape_control_characters(&failure.code)
            )));
        }
        if !(1..=125).contains(&failure.exit_code) {
            issues.push(Issue::new(format!(
                "Failure \"{}\" declares exit code {}. {EXIT_CODE_MESSAGE}",
                escape_control_characters(&failure.code),
                failure.exit_code
            )));
        }
        if !is_line(&failure.meaning) {
            issues.push(Issue::new(LINE_MESSAGE));
        }
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

/// `@loomcli/plugins/manifest/command`, collecting. The author and any plugin supply Markdown,
/// example invocations, and the failures a Command can raise for its manifest entry through it, and
/// every value is kept in collection order.
pub const MANIFEST_COMMAND: Extension<CommandTarget, ManifestCommandFacts, Collecting> =
    Extension::collecting("@loomcli/plugins/manifest/command").check(check_facts);
