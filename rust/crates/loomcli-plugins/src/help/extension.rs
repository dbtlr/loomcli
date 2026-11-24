//! The help plugin's extension descriptors: declarations alone.
//!
//! A projection that wants help's prose reads these descriptors with `read_extension` and never
//! the help middleware, and an application that installs no help plugin still compiles against
//! them. Each descriptor carries the rules its fields' types cannot state, so the call that carries
//! a value that breaks one rejects it under `@loomcli/core/invalid-extension-value`, as any
//! extension value its rules reject:
//!
//! - **A line** holds a character other than whitespace and no line terminator: an `accepts`
//!   sentence, each heading of a section path, and an example's command and note.
//! - **Markdown** holds a character other than whitespace, and may hold blank lines and a final
//!   terminator: `details` and `epilog`.
//! - **A word** is one or more characters with no whitespace and no next-line character: a
//!   placeholder.
//! - **A section path** holds one or two headings.

use loomcli_core::{ArgumentTarget, CommandTarget, Extension, Issue, OptionTarget};
use serde::{Deserialize, Serialize};

/// One example command line and its note: the one type help and the manifest share, so a list of
/// examples written once serves both `HelpCommandFacts::examples` and
/// `ManifestCommandFacts::examples`.
pub use crate::manifest::extension::CommandExample;

/// A help section path: one heading, or a heading and its subsection's. Each heading is one line,
/// and a path holds one or two of them.
pub type HelpSectionPath = Vec<String>;

/// The help facts of a Command or the Application: its Markdown details, its Markdown epilog, its
/// examples, the section it sits in on its parent's page, and the order of the sections on its own
/// page. Every page on or under the Command ends with its epilog.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HelpCommandFacts {
    /// The order of the child Command sections on this Command's page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_sections: Option<Vec<HelpSectionPath>>,
    /// Markdown the extended page prints under the masthead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// Markdown both pages print after the hints, on this Command's page and every page under it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epilog: Option<String>,
    /// Example invocations the extended page prints under EXAMPLES.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<CommandExample>>,
    /// The order of the option sections on this Command's page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option_sections: Option<Vec<HelpSectionPath>>,
    /// The section this Command lists under on its parent's page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<HelpSectionPath>,
}

/// A section path from its headings.
fn path_of(path: &[&str]) -> HelpSectionPath {
    path.iter().map(|part| (*part).to_owned()).collect()
}

impl HelpCommandFacts {
    /// No facts.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the details, Markdown the extended page renders after the masthead.
    #[must_use]
    pub fn details(self, details: impl Into<String>) -> Self {
        Self {
            details: Some(details.into()),
            ..self
        }
    }

    /// Sets the epilog, Markdown both pages print last, on this page and every page under it.
    #[must_use]
    pub fn epilog(self, epilog: impl Into<String>) -> Self {
        Self {
            epilog: Some(epilog.into()),
            ..self
        }
    }

    /// Sets the examples.
    #[must_use]
    pub fn examples(self, examples: impl IntoIterator<Item = CommandExample>) -> Self {
        Self {
            examples: Some(examples.into_iter().collect()),
            ..self
        }
    }

    /// Sets the section this Command lists under on its parent's page.
    #[must_use]
    pub fn section(self, path: &[&str]) -> Self {
        Self {
            section: Some(path_of(path)),
            ..self
        }
    }

    /// Sets the order of the child Command sections on this Command's page.
    #[must_use]
    pub fn command_sections(self, sections: &[&[&str]]) -> Self {
        Self {
            command_sections: Some(sections.iter().map(|path| path_of(path)).collect()),
            ..self
        }
    }

    /// Sets the order of the option sections on this Command's page.
    #[must_use]
    pub fn option_sections(self, sections: &[&[&str]]) -> Self {
        Self {
            option_sections: Some(sections.iter().map(|path| path_of(path)).collect()),
            ..self
        }
    }
}

/// The help facts of an option: the line it prints as its accepted values, whether it hides its
/// bindings, the word for its value, and the section it sits in.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HelpInputFacts {
    /// The sentence the row prints as the values the option accepts, in place of a derived list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepts: Option<String>,
    /// `Some(true)` keeps the option's `env` and `config` facts off both pages. It holds `true`
    /// alone: `Some(false)` is rejected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hide_bindings: Option<bool>,
    /// The placeholder its value prints as, such as `path`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// The section the option lists under on every page that shows it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<HelpSectionPath>,
}

impl HelpInputFacts {
    /// No facts.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Facts holding a placeholder, the word the page shows for the option's value.
    pub fn placeholder(placeholder: impl Into<String>) -> Self {
        Self {
            placeholder: Some(placeholder.into()),
            ..Self::default()
        }
    }

    /// Sets the accepted-values sentence.
    #[must_use]
    pub fn accepts(self, accepts: impl Into<String>) -> Self {
        Self {
            accepts: Some(accepts.into()),
            ..self
        }
    }

    /// Keeps the option's bindings off both pages.
    #[must_use]
    pub fn hide_bindings(self) -> Self {
        Self {
            hide_bindings: Some(true),
            ..self
        }
    }

    /// Sets the section the option lists under.
    #[must_use]
    pub fn section(self, path: &[&str]) -> Self {
        Self {
            section: Some(path_of(path)),
            ..self
        }
    }
}

/// The help facts of an argument: the line its row prints as its accepted values. An argument's
/// placeholder is its declared name.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct HelpArgumentFacts {
    /// The sentence the row prints as the values the argument accepts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepts: Option<String>,
}

impl HelpArgumentFacts {
    /// No facts.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Facts holding the accepted-values sentence.
    pub fn accepts(accepts: impl Into<String>) -> Self {
        Self {
            accepts: Some(accepts.into()),
        }
    }
}

/// A line that breaks the line rule.
const LINE_MESSAGE: &str = "Supply one line that holds a character other than whitespace.";

/// Markdown that is whitespace alone.
const MARKDOWN_MESSAGE: &str = "Supply Markdown that holds a character other than whitespace.";

/// A placeholder that is not one word.
const WORD_MESSAGE: &str = "Supply one word with no whitespace.";

/// A section path of no heading or of more than two.
const PATH_MESSAGE: &str = "Supply a section path of one or two headings.";

/// A `hide_bindings` that holds `false`.
const HIDE_MESSAGE: &str = "Invalid type: Expected true but received false";

/// JavaScript's `\s`: Unicode White_Space without U+0085, plus U+FEFF.
fn is_js_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

/// The characters that end a line: LF, VT, FF, CR, NEL, LS, and PS.
pub(crate) fn is_terminator(character: char) -> bool {
    matches!(
        character,
        '\n' | '\u{b}' | '\u{c}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}'
    )
}

/// Whether a text holds a character other than whitespace.
fn has_content(text: &str) -> bool {
    text.chars().any(|character| !is_js_space(character))
}

/// One line that holds a character other than whitespace.
fn is_line(text: &str) -> bool {
    has_content(text) && !text.chars().any(is_terminator)
}

/// One or more characters, none of them whitespace or a next-line character.
fn is_word(text: &str) -> bool {
    !text.is_empty()
        && !text
            .chars()
            .any(|character| is_js_space(character) || character == '\u{85}')
}

/// The issue a section path raises, if any: its length first, then each heading's line rule.
fn path_issue(path: &[String]) -> Option<&'static str> {
    if path.is_empty() || path.len() > 2 {
        return Some(PATH_MESSAGE);
    }
    path.iter()
        .any(|heading| !is_line(heading))
        .then_some(LINE_MESSAGE)
}

/// The issues of the paths of an order list, in list order.
fn paths_issues(paths: Option<&Vec<HelpSectionPath>>, issues: &mut Vec<Issue>) {
    for path in paths.into_iter().flatten() {
        if let Some(message) = path_issue(path) {
            issues.push(Issue::new(message));
        }
    }
}

/// The verdict on a list of issues.
fn verdict(issues: Vec<Issue>) -> Result<(), Vec<Issue>> {
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

/// The rules of a Command's facts, judged field by field in the reference schema's key order.
fn check_command(facts: &HelpCommandFacts) -> Result<(), Vec<Issue>> {
    let mut issues = Vec::new();
    paths_issues(facts.command_sections.as_ref(), &mut issues);
    if facts
        .details
        .as_deref()
        .is_some_and(|text| !has_content(text))
    {
        issues.push(Issue::new(MARKDOWN_MESSAGE));
    }
    if facts
        .epilog
        .as_deref()
        .is_some_and(|text| !has_content(text))
    {
        issues.push(Issue::new(MARKDOWN_MESSAGE));
    }
    for example in facts.examples.iter().flatten() {
        if !is_line(&example.command) || example.note.as_deref().is_some_and(|note| !is_line(note))
        {
            issues.push(Issue::new(LINE_MESSAGE));
        }
    }
    paths_issues(facts.option_sections.as_ref(), &mut issues);
    if let Some(message) = facts.section.as_deref().and_then(path_issue) {
        issues.push(Issue::new(message));
    }
    verdict(issues)
}

/// The rules of an option's facts.
fn check_input(facts: &HelpInputFacts) -> Result<(), Vec<Issue>> {
    let mut issues = Vec::new();
    if facts.accepts.as_deref().is_some_and(|text| !is_line(text)) {
        issues.push(Issue::new(LINE_MESSAGE));
    }
    if facts.hide_bindings == Some(false) {
        issues.push(Issue::new(HIDE_MESSAGE));
    }
    if facts
        .placeholder
        .as_deref()
        .is_some_and(|text| !is_word(text))
    {
        issues.push(Issue::new(WORD_MESSAGE));
    }
    if let Some(message) = facts.section.as_deref().and_then(path_issue) {
        issues.push(Issue::new(message));
    }
    verdict(issues)
}

/// The rules of an argument's facts.
fn check_argument(facts: &HelpArgumentFacts) -> Result<(), Vec<Issue>> {
    if facts.accepts.as_deref().is_some_and(|text| !is_line(text)) {
        return Err(vec![Issue::new(LINE_MESSAGE)]);
    }
    Ok(())
}

/// `@loomcli/plugins/help/command`: help's facts on a Command or the Application.
pub const HELP_COMMAND: Extension<CommandTarget, HelpCommandFacts> =
    Extension::new("@loomcli/plugins/help/command").check(check_command);
/// `@loomcli/plugins/help/input`: help's facts on an option, local, global, or a plugin's.
pub const HELP_INPUT: Extension<OptionTarget, HelpInputFacts> =
    Extension::new("@loomcli/plugins/help/input").check(check_input);
/// `@loomcli/plugins/help/argument`: help's one fact on an argument.
pub const HELP_ARGUMENT: Extension<ArgumentTarget, HelpArgumentFacts> =
    Extension::new("@loomcli/plugins/help/argument").check(check_argument);
