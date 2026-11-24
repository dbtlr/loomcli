//! The verbose plugin: `-v` raises and `-q` lowers the run's verbosity.

use loomcli_core::{Inputs, Plugin};

use crate::PACKAGE_NAME;

/// The verbose plugin's options. `verbose` comes before `quiet`, the order help and the manifest
/// print them in.
#[derive(Inputs)]
pub struct VerboseOptions {
    /// Show more detail. Repeat it for more.
    #[option(short = 'v', control, count, verbose)]
    pub verbose: u8,
    /// Hide info and success messages.
    #[option(short = 'q', control, count, quiet)]
    pub quiet: u8,
}

/// The verbose plugin: the standard `-v`, `--verbose` and `-q`, `--quiet`, which core reads as the
/// run's verbosity right after graph build. The spellings are the standard's, so it takes no
/// settings.
pub fn verbose() -> Plugin<VerboseOptions> {
    Plugin::new(format!("{PACKAGE_NAME}/verbose")).options::<VerboseOptions>()
}
