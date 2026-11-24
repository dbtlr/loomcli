//! The MCP plugin's extension descriptors: declarations alone.
//!
//! A Command opts in as a tool by carrying an [`MCP_COMMAND`] value, and an input's [`MCP_INPUT`]
//! or [`MCP_ARGUMENT`] value words its property for an agent. They compile apart from the plugin
//! (the `mcp-extension` feature), so a Command library opts in without compiling the server, and
//! they name no protocol type. Each descriptor carries the rules its fields' types cannot state, so
//! the call that carries a value that breaks one rejects it under
//! `@loomcli/core/invalid-extension-value`:
//!
//! - **Prose.** An [`McpCommandFacts`] description holds a character other than whitespace on every
//!   line, and keeps its line breaks.
//! - **One of two.** An [`McpInputFacts`] value holds a description or `exclude: true`, never both
//!   and never neither, because an excluded option has no property to describe.

use loomcli_core::{ArgumentTarget, CommandTarget, Extension, Issue, OptionTarget};
use serde::{Deserialize, Serialize};

/// The hints a tool carries about its effects. The author owns them and Loom never verifies or
/// infers one, so an unset hint stays unset and the protocol's own default applies. The plugin
/// projects each as the protocol's `readOnlyHint`, `destructiveHint`, `idempotentHint`, and
/// `openWorldHint`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct McpAnnotations {
    /// The tool may destroy data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destructive: Option<bool>,
    /// A repeated call with the same arguments has no further effect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotent: Option<bool>,
    /// The tool reaches outside the application's own data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_world: Option<bool>,
    /// The tool reads and changes nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
}

impl McpAnnotations {
    /// No hint set.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `destructive`.
    #[must_use]
    pub fn destructive(self, value: bool) -> Self {
        Self {
            destructive: Some(value),
            ..self
        }
    }

    /// Sets `idempotent`.
    #[must_use]
    pub fn idempotent(self, value: bool) -> Self {
        Self {
            idempotent: Some(value),
            ..self
        }
    }

    /// Sets `openWorld`.
    #[must_use]
    pub fn open_world(self, value: bool) -> Self {
        Self {
            open_world: Some(value),
            ..self
        }
    }

    /// Sets `readOnly`.
    #[must_use]
    pub fn read_only(self, value: bool) -> Self {
        Self {
            read_only: Some(value),
            ..self
        }
    }
}

/// The MCP plugin's facts on a Command that opts in as a tool: its effect hints, and its
/// description for an agent in place of the Command's, prose whose every line holds a character
/// other than whitespace.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct McpCommandFacts {
    /// The tool's effect hints.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotations: Option<McpAnnotations>,
    /// The tool's description, in place of the Command's core description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl McpCommandFacts {
    /// Facts with no hint and no description: the opt-in alone.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Facts with these effect hints.
    #[must_use]
    pub fn annotations(annotations: McpAnnotations) -> Self {
        Self {
            annotations: Some(annotations),
            description: None,
        }
    }

    /// The same facts with the tool's description for an agent.
    #[must_use]
    pub fn description(self, description: impl Into<String>) -> Self {
        Self {
            description: Some(description.into()),
            ..self
        }
    }

    /// The same facts with these effect hints.
    #[must_use]
    pub fn with_annotations(self, annotations: McpAnnotations) -> Self {
        Self {
            annotations: Some(annotations),
            ..self
        }
    }
}

/// An option's facts for an agent: a description in place of its core description, or its
/// exclusion from every tool, never both. Build one with [`McpInputFacts::described`] or
/// [`McpInputFacts::excluded`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct McpInputFacts {
    /// The option's description for an agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `true` leaves the option off every tool and out of every call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude: Option<bool>,
}

impl McpInputFacts {
    /// The option's description for an agent, in place of its core description.
    #[must_use]
    pub fn described(description: impl Into<String>) -> Self {
        Self {
            description: Some(description.into()),
            exclude: None,
        }
    }

    /// The option's exclusion from every tool: no property lists it, a call that names it is
    /// refused, and every call leaves it to its declared default.
    #[must_use]
    pub fn excluded() -> Self {
        Self {
            description: None,
            exclude: Some(true),
        }
    }
}

/// An argument's facts for an agent: a description in place of its core description.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct McpArgumentFacts {
    /// The argument's description for an agent.
    pub description: String,
}

impl McpArgumentFacts {
    /// The argument's description for an agent.
    #[must_use]
    pub fn new(description: impl Into<String>) -> Self {
        Self {
            description: description.into(),
        }
    }
}

/// A description that breaks the prose rule.
const PROSE_MESSAGE: &str =
    "Supply prose whose every line holds a character other than whitespace.";

/// An option value that holds both keys, or neither.
const ONE_OF_TWO_MESSAGE: &str = "Supply a description or exclude: true, never both, because an excluded option has no property to describe.";

/// JavaScript's `\s`: Unicode White_Space without U+0085, plus U+FEFF.
fn is_js_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

/// The characters that end a line: LF, VT, FF, CR, NEL, LS, and PS.
fn is_terminator(character: char) -> bool {
    matches!(
        character,
        '\n' | '\u{b}' | '\u{c}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}'
    )
}

/// Prose whose every line, split at CRLF or one terminator, holds a character other than
/// whitespace.
fn is_prose(text: &str) -> bool {
    let mut line_has_content = false;
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if is_terminator(character) {
            if character == '\r' && characters.peek() == Some(&'\n') {
                characters.next();
            }
            if !line_has_content {
                return false;
            }
            line_has_content = false;
        } else if !is_js_space(character) {
            line_has_content = true;
        }
    }
    line_has_content
}

/// The rules of a Command's facts: a description is prose.
fn check_command(facts: &McpCommandFacts) -> Result<(), Vec<Issue>> {
    if facts
        .description
        .as_deref()
        .is_some_and(|text| !is_prose(text))
    {
        return Err(vec![Issue::new(PROSE_MESSAGE)]);
    }
    Ok(())
}

/// The rules of an option's facts: a description alone, or `exclude: true` alone.
fn check_input(facts: &McpInputFacts) -> Result<(), Vec<Issue>> {
    match (&facts.description, facts.exclude) {
        (Some(_), None) | (None, Some(true)) => Ok(()),
        _ => Err(vec![Issue::new(ONE_OF_TWO_MESSAGE)]),
    }
}

/// `@loomcli/plugins/mcp/command`: opts a Command in as a tool, with its description for an agent
/// and its effect hints. The root opts in through the Application's `extend`.
pub const MCP_COMMAND: Extension<CommandTarget, McpCommandFacts> =
    Extension::new("@loomcli/plugins/mcp/command").check(check_command);
/// `@loomcli/plugins/mcp/input`: an option's description for an agent, or its exclusion from every
/// tool.
pub const MCP_INPUT: Extension<OptionTarget, McpInputFacts> =
    Extension::new("@loomcli/plugins/mcp/input").check(check_input);
/// `@loomcli/plugins/mcp/argument`: an argument's description for an agent.
pub const MCP_ARGUMENT: Extension<ArgumentTarget, McpArgumentFacts> =
    Extension::new("@loomcli/plugins/mcp/argument");

#[cfg(test)]
mod tests {
    use super::is_prose;

    #[test]
    fn prose_holds_content_on_every_line() {
        assert!(is_prose("An agent description.\nIt keeps its line break."));
        assert!(is_prose("One line.\r\nTwo."));
        assert!(!is_prose(""));
        assert!(!is_prose("   "));
        assert!(!is_prose("One.\n\nThree."));
        assert!(!is_prose("Trailing.\n"));
        assert!(!is_prose("Trailing.\r\n"));
        assert!(!is_prose("A\u{2028} "));
    }
}
