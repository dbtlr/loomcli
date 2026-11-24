//! The formatter: `--format` selects a result's view, and machine views encode failures.
//!
//! The `format` feature is the plugin. The `format-views` feature is the machine views alone,
//! [`json`] and [`jsonl`], which install nothing and render as ordinary views.

#[cfg(feature = "format")]
mod name;
#[cfg(feature = "format-views")]
pub mod views;

#[cfg(feature = "format")]
mod plugin {
    use loomcli_core::{
        Activation, AnyPlugin, AttachedCommand, AttachedViews, Error, FailureForm,
        MiddlewareContext, Next, NoOptions, Opt, Outcome, Plugin, encode_failure,
    };
    use serde::Serialize;

    use super::name::FormatName;
    use super::views::{json, jsonl};
    use crate::PACKAGE_NAME;
    use crate::encode::{escape_controls, stringify};

    /// The formatter's settings builder.
    #[must_use]
    pub struct Format {
        short: Option<char>,
    }

    /// The formatter: the `--format` option on every Command that declares a result, the `json`
    /// and `jsonl` views appended to each result that lacks them, and the failure encoders for
    /// `application/json` and `application/jsonl`.
    pub fn format() -> Format {
        Format { short: None }
    }

    impl Format {
        /// Gives `--format` a short spelling, one ASCII letter. Any other character is the
        /// `option-config` fault when the hook declares the option at graph build.
        pub fn short(self, letter: char) -> Self {
            Format {
                short: Some(letter),
            }
        }

        /// The plugin. Its `on_command_attach` hook declares `format` on each Command with a
        /// result, with the chosen short spelling.
        pub fn plugin(self) -> Plugin {
            let short = self.short;
            Plugin::new(format!("{PACKAGE_NAME}/format"))
                .failure_encoders([
                    encode_failure("application/json", error_line),
                    encode_failure("application/jsonl", error_line),
                ])
                .middleware(Activation::Always, select_view)
                .on_command_attach(move |command| attach(command, short))
        }
    }

    impl From<Format> for AnyPlugin {
        fn from(settings: Format) -> Self {
            settings.plugin().into()
        }
    }

    /// The failure line's shape: `{"error": <form>}`.
    #[derive(Serialize)]
    struct ErrorLine<'a> {
        error: &'a FailureForm,
    }

    /// One line on stderr: `{"error":{"code":..,"exitCode":..,"message":..,"hints":[..]}}` and a
    /// newline, with DEL and the C1 controls escaped as the views escape them.
    fn error_line(form: &FailureForm) -> Result<String, Error> {
        let text = stringify(&ErrorLine { error: form }, false)?;
        Ok(format!("{}\n", escape_controls(&text)))
    }

    /// Appends `json` and `jsonl` to a result's views where the record lacks the key, then
    /// declares `--format` over the resulting names. A Command with no result is unchanged.
    fn attach(command: &mut AttachedCommand, short: Option<char>) -> Result<(), Error> {
        let Some(result) = command.result() else {
            return Ok(());
        };
        let mut names = result.views.clone();
        let mut added = AttachedViews::new();
        if !names.iter().any(|name| name == "json") {
            added = added.view("json", json::<serde_json::Value>());
            names.push("json".to_owned());
        }
        if !names.iter().any(|name| name == "jsonl") {
            added = added.view("jsonl", jsonl::<serde_json::Value>());
            names.push("jsonl".to_owned());
        }
        if names.len() != result.views.len() {
            command.views(added)?;
        }
        // `--format` says how the run prints, not what the Command works on, so it is a control option.
        let mut option = Opt::string()
            .control()
            .description(format!(
                "Select the output format, {} by default.",
                result.default
            ))
            .validate(FormatName::over(names));
        if let Some(letter) = short {
            option = option.short(letter);
        }
        command.option("format", option)?;
        Ok(())
    }

    /// Copies a supplied `--format` into the run's view. The option is hook-declared and
    /// `own_options` holds it whenever it validated, a held fault on another input included, so the
    /// selection stands for the failure too.
    async fn select_view(context: MiddlewareContext<NoOptions>, next: Next) -> Outcome {
        if context.view().is_some()
            && let Some(name) = context.own_options.option::<Option<String>>("format")?
        {
            context.select_view(&name);
        }
        next.run().await?;
        Ok(())
    }
}

#[cfg(feature = "format")]
pub use plugin::{Format, format};
#[cfg(feature = "format-views")]
pub use views::{json, json_mapped, jsonl, jsonl_mapped};
