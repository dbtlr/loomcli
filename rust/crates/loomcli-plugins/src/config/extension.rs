//! The configuration plugin's extension descriptors: declarations alone.

use loomcli_core::{Extension, Issue, OptionTarget};
use serde::{Deserialize, Serialize};

/// The configuration facts of an option: the dotted path of object keys whose value fills it.
///
/// The path splits on `.`, and each segment is one object key. A segment is nonempty, and there is
/// no escaping and no array indexing, so a key that holds a dot is not reachable. A path that
/// breaks the rule is rejected at the call that carries the value, under
/// `invalid-extension-value`, with the issue `Supply a dotted path of nonempty keys.`
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct ConfigInputFacts {
    /// The dotted path in the configuration file, such as `limits.bytes`.
    pub path: String,
}

impl ConfigInputFacts {
    /// Facts binding the option to the dotted `path`.
    pub fn path(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }
}

/// Whether a path is dotted keys, each nonempty.
fn is_dotted_path(path: &str) -> bool {
    path.split('.').all(|segment| !segment.is_empty())
}

/// The value rule the type cannot state: a dotted path of nonempty keys.
fn check_path(facts: &ConfigInputFacts) -> Result<(), Vec<Issue>> {
    if is_dotted_path(&facts.path) {
        Ok(())
    } else {
        Err(vec![Issue::new("Supply a dotted path of nonempty keys.")])
    }
}

/// `@loomcli/plugins/config/input`, the configuration source's binding. A local option, a global
/// option, and another plugin's option may carry it, and an option that carries it is
/// configuration-bound: core asks the configuration plugin about it when argv and the environment
/// leave it unfilled. Help prints its path as the option's `config: <path>` fact.
pub const CONFIG_INPUT: Extension<OptionTarget, ConfigInputFacts> =
    Extension::new("@loomcli/plugins/config/input").check(check_path);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dotted_path_of_nonempty_keys_passes_and_any_other_fails() {
        for path in ["a", "limits.bytes", "a.b.c", "__proto__.x"] {
            assert!(check_path(&ConfigInputFacts::path(path)).is_ok(), "{path}");
        }
        for path in ["", "a..b", ".a", "a.", "."] {
            assert!(check_path(&ConfigInputFacts::path(path)).is_err(), "{path}");
        }
    }
}
