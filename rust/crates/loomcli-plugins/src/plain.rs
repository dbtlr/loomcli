//! The plain plugin: `--plain` turns off terminal redrawing.

use loomcli_core::{Inputs, Plugin};

use crate::PACKAGE_NAME;

/// The plain plugin's global control option.
#[derive(Inputs)]
#[non_exhaustive]
pub struct PlainOptions {
    /// Never redraw: print progress as plain lines and ask questions line by line.
    #[option(control, plain)]
    pub plain: bool,
}

/// Declares `--plain`, which turns the run's plain switch on. Core reads `ACCESSIBLE` even when
/// the application leaves this plugin out.
pub fn plain() -> Plugin<PlainOptions> {
    Plugin::new(format!("{PACKAGE_NAME}/plain")).options::<PlainOptions>()
}
