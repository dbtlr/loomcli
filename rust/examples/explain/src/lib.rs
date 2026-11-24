//! A private example plugin: `--explain` explains the routed Command instead of running it, and an
//! unknown option's report points at that explanation.
//!
//! It is the proof that a crate outside the pack writes a plugin against the same contract: an
//! extension, a middleware with declared activation, and a failure hint.

pub mod extension;
mod hint;
mod middleware;

use loomcli_core::{Activation, Inputs, Plugin};

use extension::EXPLAIN_COMMAND;

/// The plugin's package name: its identity, and the prefix of every extension it declares.
pub const PACKAGE_NAME: &str = "@loom/explain";

/// The plugin's options.
#[derive(Inputs)]
pub struct ExplainOptions {
    /// Explain the selected command and exit.
    #[option(short = 'e', control)]
    pub explain: bool,
}

/// The explain plugin.
pub fn explain() -> Plugin<ExplainOptions> {
    Plugin::new(PACKAGE_NAME)
        .options::<ExplainOptions>()
        .extensions([EXPLAIN_COMMAND])
        .middleware(
            Activation::options(["explain"]),
            middleware::explain_command,
        )
        .on_failure(hint::explain_hint)
}
