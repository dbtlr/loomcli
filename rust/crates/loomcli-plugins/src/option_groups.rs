//! The option groups shared by the help, man page, and manifest projections.

use loomcli_core::{CommandNode, OptionGroup};

/// A listing omits a group that would reveal a hidden option.
pub(crate) fn visible_option_groups(command: &CommandNode) -> impl Iterator<Item = &OptionGroup> {
    command.option_groups.iter().filter(|group| {
        group.members().all(|name| {
            command
                .options
                .iter()
                .any(|option| option.name() == name && !option.hidden())
        })
    })
}
