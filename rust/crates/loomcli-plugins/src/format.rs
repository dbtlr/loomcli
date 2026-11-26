//! The formatter selects a result view and projects the requested fields.
//!
//! The `format` feature is the plugin. The `format-views` feature is the machine views alone,
//! which install nothing and render as ordinary views.

#[cfg(feature = "format")]
mod fields;
#[cfg(feature = "format")]
mod messages;
#[cfg(feature = "format")]
mod name;
#[cfg(feature = "format-views")]
pub mod views;

#[cfg(feature = "format")]
mod plugin {
    use loomcli_core::{
        Activation, AnyPlugin, AttachedCommand, AttachedViews, Error, FailureForm,
        MiddlewareContext, Next, NoOptions, Opt, Outcome, Plugin, ResultKindName, encode_failure,
    };
    use serde::Serialize;

    use super::fields::{FieldList, PROVIDED_VIEWS, select_fields};
    use super::messages;
    use super::name::FormatName;
    use super::views::{json, jsonl, jsonl_rows};
    use crate::PACKAGE_NAME;
    use crate::encode::{escape_controls, stringify};

    /// The formatter's settings builder.
    #[must_use]
    pub struct Format {
        short: Option<char>,
    }

    /// The formatter contributes `--format` and `--fields` on Commands with results and as
    /// hidden options on groups. It adds missing `json` and `jsonl` views and their failure
    /// encoders.
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

        /// The plugin, with the chosen short spelling for `--format`.
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

    /// Adds missing machine views and remembers their names for field selection.
    fn attach(command: &mut AttachedCommand, short: Option<char>) -> Result<(), Error> {
        let Some(result) = command.result() else {
            if !command.has_action() {
                let names = ["json", "jsonl"].map(str::to_owned).to_vec();
                declare_options(
                    command,
                    names,
                    messages::GROUP_FORMAT_DESCRIPTION,
                    short,
                    true,
                )?;
            }
            return Ok(());
        };
        let mut names = result.views;
        let mut provided = Vec::new();
        let mut added = AttachedViews::new();
        if !names.iter().any(|name| name == "json") {
            added = added.view("json", json::<serde_json::Value>());
            provided.push("json".to_owned());
        }
        if !names.iter().any(|name| name == "jsonl") {
            added = if result.kind == ResultKindName::Rows {
                added.view("jsonl", jsonl_rows::<serde_json::Value>())
            } else {
                added.view("jsonl", jsonl::<serde_json::Value>())
            };
            provided.push("jsonl".to_owned());
        }
        if !provided.is_empty() {
            command.views(added)?;
        }
        names.extend(provided.iter().cloned());
        command.extend([PROVIDED_VIEWS.value(provided)])?;
        declare_options(
            command,
            names,
            &messages::format_description(&result.default),
            short,
            false,
        )
    }

    fn declare_options(
        command: &mut AttachedCommand,
        names: Vec<String>,
        description: &str,
        short: Option<char>,
        hidden: bool,
    ) -> Result<(), Error> {
        let mut option = Opt::string()
            .control()
            .description(description)
            .validate(FormatName::over(names));
        let mut fields = Opt::string()
            .control()
            .multiple()
            .description(messages::FIELDS_DESCRIPTION)
            .validate(FieldList);
        if let Some(letter) = short {
            option = option.short(letter);
        }
        if hidden {
            option = option.hidden();
            fields = fields.hidden();
        }
        command.option("format", option)?;
        command.option("fields", fields)?;
        Ok(())
    }

    /// Copies a supplied `--format` into the run's view. The option is hook-declared and
    /// `own_options` holds it whenever it validated, a held fault on another input included, so the
    /// selection stands for the failure too.
    async fn select_view(context: MiddlewareContext<NoOptions>, next: Next) -> Outcome {
        if context.own_options.validated("format")
            && let Some(name) = context.own_options.option::<Option<String>>("format")?
        {
            if context.view().is_some() {
                context.select_view(&name);
            } else if let Some(media_type) = match name.as_str() {
                "json" => Some("application/json"),
                "jsonl" => Some("application/jsonl"),
                _ => None,
            } {
                context.set_media_type(media_type);
            }
        }
        select_fields(&context)?;
        next.run().await?;
        Ok(())
    }
}

#[cfg(feature = "format")]
pub use plugin::{Format, format};
#[cfg(feature = "format-views")]
pub use views::{json, json_mapped, jsonl, jsonl_mapped, jsonl_rows, jsonl_rows_mapped};
