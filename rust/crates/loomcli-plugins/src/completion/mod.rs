//! The completion plugin: shell completion scripts, the hidden protocol they call, and installing,
//! updating, and removing them.
//!
//! `completion()` contributes one Command, `completion`, with a child per shell that prints its
//! script (`bash`, `zsh`, `fish`, `powershell`), `install`, `update`, and `uninstall`, and the
//! hidden `__complete` the scripts call. The scripts are Cobra's, ported by the reference and
//! copied here as templates (`templates/`, under the Apache License, Version 2.0; see
//! `licenses/`). `__complete` reads the partial command line with core's `locate`, so a candidate
//! never disagrees with the parser, and writes one candidate per line then `:` and the directive.
//! Installing goes through the installed-files module, one plugin's file per shell,
//! `completion.<shell>.json`, in the application's installation record.
//!
//! An application that installs the plugin and a self-update passes [`refresh_completion`] as the
//! self-update's refresh step, so the new binary rewrites the recorded scripts.

mod answer;
mod closed_set;
mod install;
mod messages;
mod name;
mod paths;
mod profile;
mod run;
mod scripts;
mod shells;
mod startup;
mod uninstall;
mod update;

use std::sync::Arc;

use loomcli_core::{
    Arg, Command, Context, Error, Issue, Plugin, ValidationContext, Validator, View, locate,
};

use crate::PACKAGE_NAME;
use answer::answer;
use run::ChildRun;
use scripts::{bash_script, fish_script, powershell_script, zsh_script};
use shells::{SHELL_NAMES, Shell};

pub use crate::installation::RefreshContext;

/// The `afterReplace` refresh the self-update plugin runs: the new binary runs `completion update`,
/// because the replaced process holds the old version's scripts, and its output passes through. A
/// child that fails or cannot start adds a `warn` log event and returns, because the binary update
/// succeeded.
///
/// # Errors
///
/// None today: a refresh reports its failures as log events and the line it writes for the
/// operator. The result is for the self-update plugin's step, which accepts a failure.
pub async fn refresh_completion(context: RefreshContext<'_>) -> Result<(), Error> {
    crate::installation::refresh_by_running(context, &REFRESH).await;
    Ok(())
}

/// The words, warning, and sentence of this plugin's refresh.
const REFRESH: crate::installation::Refresh = crate::installation::Refresh {
    words: &["completion", "update"],
    warning: messages::COMPLETION_REFRESH_FAILED,
    not_started: messages::completion_not_refreshed,
};

/// The text as it is, with no markup resolved and no newline added, because another program reads
/// these bytes: a shell sources a completion script. It renders through `out`, so a reader that
/// closes stdout ends the run as it does any write.
fn exact_text() -> View<String> {
    View::new(|text: &String, context| context.style.escape(text))
}

/// The four shell names `install` and `uninstall` accept.
struct ShellInput;

impl Validator for ShellInput {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        if SHELL_NAMES.contains(&input) {
            return Ok(input.to_owned());
        }
        Err(vec![Issue::new(messages::shell_issue(&SHELL_NAMES)).code(
            "@loomcli/validators/one-of",
            serde_json::json!({ "values": SHELL_NAMES }),
        )])
    }

    fn input_schema(&self) -> loomcli_core::InputSchema {
        let mut schema = serde_json::Map::new();
        schema.insert("type".to_owned(), "string".into());
        schema.insert("enum".to_owned(), serde_json::json!(SHELL_NAMES));
        Some(loomcli_core::with_schema_dialect(schema))
    }
}

/// One child that prints the script its shell sources, for the application it is installed in.
fn shell_command(
    name: &str,
    shell: &str,
    script: fn(&str) -> String,
) -> Command<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Command::new(name)
        .description(format!("Print the {shell} completion script."))
        .action(move |context: Context| async move {
            let text = script(&context.graph.name);
            context.out.render(&text, &exact_text()).await
        })
}

/// What every installing child reads from its action context.
fn child_run(context: &Context) -> ChildRun {
    ChildRun {
        name: context.graph.name.clone(),
        host: Arc::clone(&context.host),
        signal: context.signal.clone(),
        out: context.out.clone(),
    }
}

/// The shell an `install` or `uninstall` argument names, or none when it was left out.
fn shell_argument(context: &Context) -> Result<Option<Shell>, Error> {
    let name = context.argument::<Option<String>>("shell")?;
    Ok(name.as_deref().and_then(Shell::named))
}

/// The hidden Command the scripts call. The words arrive after a bare `--`, so the parser never
/// reads one of them as an option.
fn answer_command() -> Command<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Command::new("__complete")
        .description("Answer a completion script.")
        .hidden()
        .action(|context: Context| async move {
            let words: Vec<&str> = context.passthrough.iter().map(String::as_str).collect();
            let position = locate(&context.graph, &words);
            let text = answer(&context.graph, &position);
            context.out.render(&text, &exact_text()).await
        })
}

/// `install`: the script and startup line of the shell its argument names, or the login shell.
fn install_command() -> Command<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done>
{
    Command::new("install")
        .description("Install completion for your shell.")
        .argument(
            "shell",
            Arg::string()
                .description("The shell: bash, zsh, fish, or pwsh. Your login shell when left out.")
                .validate(ShellInput),
        )
        .action(|context: Context| async move {
            let shell = shell_argument(&context)?;
            install::install_shell(&child_run(&context), shell).await
        })
}

/// `update`: every recorded shell's script and line brought up to this version.
fn update_command() -> Command<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Command::new("update")
        .description("Bring installed completion up to date with this version.")
        .action(|context: Context| async move { update::update_shells(&child_run(&context)).await })
}

/// `uninstall`: the script and line of the shell its argument names, or of every installed shell.
fn uninstall_command() -> Command<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done>
{
    Command::new("uninstall")
        .description("Remove completion from your shell.")
        .argument(
            "shell",
            Arg::string()
                .description(
                    "The shell: bash, zsh, fish, or pwsh. Every installed shell when left out.",
                )
                .validate(ShellInput),
        )
        .action(|context: Context| async move {
            let shell = shell_argument(&context)?;
            uninstall::uninstall_shells(&child_run(&context), shell).await
        })
}

/// A plugin that prints Bash, Zsh, Fish, and PowerShell completion scripts, installs them into the
/// operator's shell on Linux and macOS, and answers them. Its whole contribution is the
/// `completion` Command; it declares no option, middleware, or extension.
pub fn completion() -> Plugin {
    let group = Command::new("completion")
        .description("Print or install a shell completion script.")
        .command(shell_command("bash", "Bash", bash_script))
        .command(shell_command("zsh", "Zsh", zsh_script))
        .command(shell_command("fish", "Fish", fish_script))
        .command(shell_command("powershell", "PowerShell", powershell_script))
        .command(install_command())
        .command(update_command())
        .command(uninstall_command())
        .command(answer_command());
    Plugin::new(format!("{PACKAGE_NAME}/completion")).commands([group])
}

/// The plugin's parts for the crate's integration tests, which cannot reach a private module. Not
/// part of any contract.
#[doc(hidden)]
pub mod test_support {
    pub use super::answer::answer;
    pub use super::name::{fish_quoted, identifier, posix_quoted, powershell_quoted};
    pub use super::scripts::{
        bash_script, fish_script, powershell_script, zsh_installed_script, zsh_script,
    };
    pub use super::shells::{Shell, startup_line};
    pub use super::startup::{denies_write, owned_by_another};
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::*;

    /// The published schema of the `shell` argument is the catalog `one_of`'s, `$schema` first.
    #[test]
    fn the_shell_argument_publishes_a_string_enum_of_the_four_shells() {
        let schema = ShellInput.input_schema().expect("a schema");
        assert_eq!(
            serde_json::to_string(&schema).expect("JSON"),
            r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["bash","zsh","fish","pwsh"]}"#
        );
    }
}
