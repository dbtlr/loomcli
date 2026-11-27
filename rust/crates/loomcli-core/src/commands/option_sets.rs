//! Reusable local options, admitted and applied through the Command's declaration rules.

use std::sync::Arc;

use crate::failures::DeclarationError;
use crate::inputs::{OptionDecl, groups::requirement_members, table::OptionOrigin};
use crate::inspection::OptionGroupKind;

use super::declaration::{CommandDeclaration, GlobalTable, raise};

/// A reusable collection of local options and groups. Apply it to each Command or root that
/// shares it with `options(&set)`. Each builder call consumes the set, and a clone can be
/// extended independently.
///
/// ```
/// use loomcli_core::{Command, Opt, OptionSet};
///
/// let output = OptionSet::new()
///     .option("json", Opt::boolean())
///     .option("yaml", Opt::boolean())
///     .exclusive(&["json", "yaml"]);
/// let _list = Command::new("list").options(&output);
/// let _show = Command::new("show").options(&output);
/// ```
///
/// `action()` closes the set application call.
///
/// ```compile_fail
/// use loomcli_core::{Command, OptionSet};
///
/// let _command = Command::new("list")
///     .action(|_| async {})
///     .options(&OptionSet::new());
/// ```
#[derive(Clone, Default)]
#[must_use]
pub struct OptionSet {
    declaration: Arc<CommandDeclaration>,
}

impl OptionSet {
    /// Starts with no options or groups.
    pub fn new() -> Self {
        Self::default()
    }

    /// Declares a local option, subject to the ordinary local option rules within the set.
    #[track_caller]
    pub fn option(mut self, name: &str, option: impl Into<OptionDecl>) -> Self {
        raise(Arc::make_mut(&mut self.declaration).declare_option_in(
            name,
            option.into(),
            &GlobalTable::default(),
            OptionOrigin::Set,
        ));
        self
    }

    /// Allows at most one of the named set members to claim the group.
    #[track_caller]
    pub fn exclusive(self, names: &[&str]) -> Self {
        self.group(OptionGroupKind::Exclusive, names)
    }

    /// Requires at least one of the named set members to be supplied.
    #[track_caller]
    pub fn one_required(self, names: &[&str]) -> Self {
        self.group(OptionGroupKind::OneRequired, names)
    }

    /// Requires the named set members to be supplied together.
    #[track_caller]
    pub fn required_together(self, names: &[&str]) -> Self {
        self.group(OptionGroupKind::RequiredTogether, names)
    }

    /// Requires each member named in `needed` when `option` is supplied.
    #[track_caller]
    pub fn requires(self, option: &str, needed: &[&str]) -> Self {
        let names = requirement_members(option, needed);
        self.group(OptionGroupKind::Requires, &names)
    }

    #[track_caller]
    fn group(mut self, kind: OptionGroupKind, names: &[&str]) -> Self {
        raise(Arc::make_mut(&mut self.declaration).declare_group_in(kind, names, true));
        self
    }

    /// Applies the entries and then the groups, each in order, to one consuming builder.
    pub(crate) fn apply(
        &self,
        command: &mut CommandDeclaration,
        globals: &GlobalTable,
    ) -> Result<(), DeclarationError> {
        for option in self.declaration.options() {
            command.declare_option_in(
                &option.name,
                option.decl.clone(),
                globals,
                OptionOrigin::AppliedSet,
            )?;
        }
        for group in &self.declaration.groups {
            let names: Vec<&str> = group.members().collect();
            command.declare_group(group.kind(), &names)?;
        }
        Ok(())
    }
}
