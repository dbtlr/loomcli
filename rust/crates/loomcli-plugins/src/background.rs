//! The background plugin: `--background` states the terminal's light or dark background.

use loomcli_core::{
    InputSchema, Inputs, Issue, Plugin, ValidationContext, Validator, with_schema_dialect,
};
use serde_json::{Map, json};

use crate::PACKAGE_NAME;

/// Accepts `dark` or `light` and publishes the closed set as its input schema. Anything else is
/// rejected with the sentence that names both.
pub struct BackgroundInput;

impl Validator for BackgroundInput {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        match input {
            "dark" | "light" => Ok(input.to_owned()),
            _ => Err(vec![Issue::new("Supply dark or light.")]),
        }
    }

    fn input_schema(&self) -> InputSchema {
        let mut schema = Map::new();
        schema.insert("type".to_owned(), json!("string"));
        schema.insert("enum".to_owned(), json!(["dark", "light"]));
        Some(with_schema_dialect(schema))
    }
}

/// The background plugin's options.
#[derive(Inputs)]
pub struct BackgroundOptions {
    /// Pick colors for this terminal background instead of detecting it.
    #[option(control, background, validate = BackgroundInput)]
    pub background: Option<String>,
}

/// The background plugin: `--background=dark|light`, which core reads as the run's background
/// choice right after host capture. Its mark also makes core detect the background when no theme
/// entry adapts, so an application whose own code reads the background installs it. It takes no
/// settings.
pub fn background() -> Plugin<BackgroundOptions> {
    Plugin::new(format!("{PACKAGE_NAME}/background")).options::<BackgroundOptions>()
}
