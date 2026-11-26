//! The guidance a Command supplies to its generated command reference.

use loomcli_core::{CommandTarget, Extension, Issue};
use serde::{Deserialize, Serialize};

/// Markdown guidance for an agent that calls this Command from a skill.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct SkillCommandFacts {
    /// The author's guidance, carried as written.
    pub guidance: String,
}

impl SkillCommandFacts {
    /// Adds nonblank Markdown guidance to a Command's generated reference.
    pub fn new(guidance: impl Into<String>) -> Self {
        Self {
            guidance: guidance.into(),
        }
    }
}

/// Adds guidance to a Command's reference in every skill that selects it.
pub const SKILL_COMMAND: Extension<CommandTarget, SkillCommandFacts> =
    Extension::new("@loomcli/plugins/skills/command").check(check_guidance);

fn check_guidance(facts: &SkillCommandFacts) -> Result<(), Vec<Issue>> {
    if facts
        .guidance
        .chars()
        .any(|c| !(c == '\u{feff}' || (c != '\u{85}' && c.is_whitespace())))
    {
        Ok(())
    } else {
        Err(vec![Issue::new(
            "Supply Markdown that holds a character other than whitespace.",
        )])
    }
}
