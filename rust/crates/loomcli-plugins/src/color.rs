//! The color plugin: `--color` and `--no-color` carry the operator's color choice.

use loomcli_core::{Inputs, Plugin};

use crate::PACKAGE_NAME;

/// The color plugin's options.
#[derive(Inputs)]
pub struct ColorOptions {
    /// Turn color on or off, overriding NO_COLOR.
    #[option(control, color, polarity = "both")]
    pub color: bool,
}

/// The color plugin: the standard `--color` and `--no-color` pair, which core reads as the run's
/// color choice right after host capture. The spellings are the standard's, so it takes no
/// settings.
pub fn color() -> Plugin<ColorOptions> {
    Plugin::new(format!("{PACKAGE_NAME}/color")).options::<ColorOptions>()
}
