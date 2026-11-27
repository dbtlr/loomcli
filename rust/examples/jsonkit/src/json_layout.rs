//! The local layout options shared by every Command that prints a JSON value.

use loomcli_core::Inputs;
use loomcli_plugins::help::extension::{HELP_INPUT, HelpInputFacts};
use loomcli_validators::integer;

use crate::json::format_with_indent;

const DEFAULT_INDENT: i64 = 2;

/// How to lay out a printed JSON value.
#[derive(Inputs)]
#[inputs(option_set, exclusive("compact", "indent"))]
pub struct JsonLayout {
    /// Print the JSON on one line.
    #[option]
    pub compact: bool,
    /// Indent nested JSON by this many spaces, from 0 to 8.
    #[option(
        default = DEFAULT_INDENT.to_string(),
        extensions = [HELP_INPUT.value(HelpInputFacts::placeholder("spaces"))],
        validate = integer().min(0).max(8)
    )]
    pub indent: i64,
}

impl Default for JsonLayout {
    fn default() -> Self {
        Self {
            compact: false,
            indent: DEFAULT_INDENT,
        }
    }
}

impl JsonLayout {
    /// Formats a value with the chosen indentation.
    #[must_use]
    pub fn format(&self, value: &serde_json::Value) -> String {
        let width = if self.compact {
            0
        } else {
            usize::try_from(self.indent).unwrap_or_default()
        };
        format_with_indent(value, width)
    }
}
