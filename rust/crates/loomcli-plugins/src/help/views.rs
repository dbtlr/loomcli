//! The help plugin's declared views.
//!
//! An application replaces the page while `help()` stays installed with
//! `override_view(help_page(), View::new(|page: &HelpPage, context| …))`. A replacement receives
//! the graph, the routed node, and the variant, and owns its own escaping, layout, and final
//! newline. It reads a Command's details and epilog through `read_extension` with the descriptors
//! in [`super::extension`]; the pack exports no page model, parser, or layout helper.

use std::sync::Arc;

use loomcli_core::{CommandGraph, CommandNode, DeclaredView, View, view};

use crate::PACKAGE_NAME;

/// Which help page a spelling asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HelpVariant {
    /// `-h`: orients a reader who needs the syntax. It omits Details and EXAMPLES.
    Compact,
    /// `--help`, and a help option no token supplied: teaches, with Details and EXAMPLES.
    Extended,
}

/// The data the help page renders: the whole graph, the Command the invocation routed to, and the
/// variant the operator's spelling selected.
#[derive(Clone)]
#[non_exhaustive]
pub struct HelpPage {
    /// The routed Command.
    pub command: Arc<CommandNode>,
    /// The graph.
    pub graph: Arc<CommandGraph>,
    /// The variant.
    pub variant: HelpVariant,
}

impl HelpPage {
    /// The page of `command` in `graph`, in `variant`.
    #[cfg(feature = "help")]
    pub(crate) fn new(
        command: Arc<CommandNode>,
        graph: Arc<CommandGraph>,
        variant: HelpVariant,
    ) -> Self {
        Self {
            command,
            graph,
            variant,
        }
    }
}

/// The help page, `@loomcli/plugins/help/page`. Its default derives the page from the graph, the
/// routed node, and the variant alone, escapes each raw fragment before styling and measuring it,
/// lays the page out against the context's `columns` on a terminal, and ends the page with exactly
/// one newline.
pub fn help_page() -> DeclaredView<HelpPage> {
    view(
        &format!("{PACKAGE_NAME}/help/page"),
        View::new(|page: &HelpPage, context| {
            super::page::render_page(page, context).map(|text| format!("{text}\n"))
        }),
    )
}
