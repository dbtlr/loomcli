//! The interaction plugin: `--no-input` turns questions off for a run.

use loomcli_core::{AnyPlugin, Inputs, Plugin};

use crate::PACKAGE_NAME;

/// The interaction plugin's options: one global Boolean option, `input`, whose negative spelling
/// `--no-input` the operator types. It carries the interaction mark, so its value is the run's
/// interaction intent: `false` turns asking off.
#[derive(Inputs)]
pub struct InteractionOptions {
    /// Ask no questions, and take every answer from options.
    #[option(polarity = "negative", control, interaction)]
    pub input: bool,
}

/// The interaction plugin's settings builder.
#[must_use]
pub struct Interaction {
    env: Vec<String>,
}

/// The interaction plugin.
pub fn interaction() -> Interaction {
    Interaction { env: Vec::new() }
}

impl Interaction {
    /// Binds `input` to these environment variables, so `MIMIR_INPUT=false` turns interaction off.
    /// Core derives no name, and the plugin adds none.
    pub fn env(self, variables: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Interaction {
            env: variables.into_iter().map(Into::into).collect(),
        }
    }

    /// The plugin: `Plugin::new(..).options::<InteractionOptions>()`, then `.env("input", …)` when
    /// the setting names variables.
    pub fn plugin(self) -> Plugin<InteractionOptions> {
        let plugin =
            Plugin::new(format!("{PACKAGE_NAME}/interaction")).options::<InteractionOptions>();
        if self.env.is_empty() {
            plugin
        } else {
            plugin.env("input", self.env)
        }
    }
}

impl From<Interaction> for AnyPlugin {
    fn from(settings: Interaction) -> Self {
        settings.plugin().into()
    }
}
