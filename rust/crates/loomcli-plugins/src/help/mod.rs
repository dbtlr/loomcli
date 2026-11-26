//! The help plugin: `-h` and `--help` render compact or extended help for the routed Command.
//!
//! `help()` declares one Boolean option, `help`, spelled `-h` and `--help`, with the description
//! `Show this help.` and the control mark; a middleware activated by it that renders the routed
//! Command's page through the declared [`views::help_page`] view and takes the invocation over, so
//! the exit code is 0 (or the cancellation code while a pager is open); the three descriptors in
//! [`extension`]; an attach hook that supplies each Command's details and examples to the
//! manifest's collecting extension; and a failure hook that points every usage failure of an argv
//! run at the page, `Run "<app> <path> --help" to see the usage.` With `.command(true)` it also
//! attaches the `help` Command, and with `.paging(true)` a page that outgrows the terminal goes to
//! the operator's pager.

#[cfg(feature = "help-views")]
pub(crate) mod accepted;
#[cfg(feature = "help-views")]
pub(crate) mod cells;
#[cfg(feature = "help-views")]
mod details;
#[cfg(feature = "help-extension")]
pub mod extension;
#[cfg(feature = "help-views")]
mod layout;
#[cfg(feature = "help")]
mod messages;
#[cfg(feature = "help-views")]
pub(crate) mod page;
#[cfg(feature = "help")]
mod pager;
#[cfg(feature = "help-views")]
pub(crate) mod sections;
#[cfg(feature = "help-views")]
pub mod views;

#[cfg(feature = "help")]
mod plugin {
    use std::sync::Arc;

    use loomcli_core::{
        Activation, AnyPlugin, Arg, Command, CommandNode, Context, Error, Failure,
        FailureHookContext, Inputs, InvokedBy, MiddlewareContext, Next, Outcome, Plugin,
        UnknownCommandError, UsageError, read_extension,
    };

    use super::extension::{HELP_ARGUMENT, HELP_COMMAND, HELP_INPUT};
    use super::pager::{Show, show_page};
    use super::views::{HelpPage, HelpVariant, help_page};
    use crate::PACKAGE_NAME;
    use crate::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};

    /// The help plugin's options.
    #[derive(Inputs)]
    pub struct HelpOptions {
        /// Show this help.
        #[option(short = 'h', control)]
        pub help: bool,
    }

    /// The help plugin's settings builder.
    #[must_use]
    pub struct Help {
        command: bool,
        paging: bool,
    }

    /// The help plugin, with paging and the help Command off.
    pub fn help() -> Help {
        Help {
            command: false,
            paging: false,
        }
    }

    impl Help {
        /// Attaches the `help` Command, which prints the extended page of the Command its words
        /// name, the page `--help` after that path prints. Off by default.
        pub fn command(self, enabled: bool) -> Self {
            Help {
                command: enabled,
                ..self
            }
        }

        /// Pages a help page that outgrows the terminal through the operator's pager: at a
        /// terminal stdout with a `TERM` that draws, outside CI, unless `PAGER` turns paging off.
        /// Off by default.
        pub fn paging(self, enabled: bool) -> Self {
            Help {
                paging: enabled,
                ..self
            }
        }

        /// The plugin.
        pub fn plugin(self) -> Plugin<HelpOptions> {
            let paging = self.paging;
            let commands: Vec<loomcli_core::AnyCommand> = if self.command {
                vec![help_command(paging).into()]
            } else {
                Vec::new()
            };
            Plugin::new(format!("{PACKAGE_NAME}/help"))
                .options::<HelpOptions>()
                .commands(commands)
                .extensions((HELP_ARGUMENT, HELP_COMMAND, HELP_INPUT))
                .views([help_page()])
                .middleware(
                    Activation::options(["help"]),
                    move |context: MiddlewareContext<HelpOptions>, _next: Next| {
                        help_middleware(context, paging)
                    },
                )
                .on_command_attach(|command| {
                    let Some(value) = read_extension(&*command, &HELP_COMMAND)? else {
                        return Ok(());
                    };
                    if value.details.is_none() && value.examples.is_none() {
                        return Ok(());
                    }
                    let mut facts = ManifestCommandFacts::new();
                    if let Some(details) = value.details {
                        facts = facts.details(details);
                    }
                    if let Some(examples) = value.examples {
                        facts = facts.examples(examples);
                    }
                    command.extend([MANIFEST_COMMAND.value(facts)])?;
                    Ok(())
                })
                .on_failure(help_hint)
        }
    }

    impl From<Help> for AnyPlugin {
        fn from(settings: Help) -> Self {
            settings.plugin().into()
        }
    }

    /// Renders the routed Command's page and takes the invocation over by returning without
    /// running `next`. `-h` asks for the compact page; every other case, `--help` or a value no
    /// token supplied, asks for the extended one.
    async fn help_middleware(context: MiddlewareContext<HelpOptions>, paging: bool) -> Outcome {
        let variant = if context.spellings.get("help") == Some("-h") {
            HelpVariant::Compact
        } else {
            HelpVariant::Extended
        };
        let page = HelpPage::new(
            Arc::clone(&context.command),
            Arc::clone(&context.graph),
            variant,
        );
        let show = Show {
            host: &context.host,
            out: &context.out,
            signal: &context.signal,
            on_shutdown: |handler| context.on_shutdown(handler),
        };
        show_page(show, page, paging).await
    }

    /// Points every usage failure of an argv run at the extended page of the Command routing
    /// reached. The command line is the application name and the routed canonical names, so the
    /// hint repeats nothing the operator typed. An invocation by name gets no hint.
    fn help_hint(failure: &dyn Failure, context: &FailureHookContext) -> Option<String> {
        if !failure.is::<UsageError>() || context.invoked_by != InvokedBy::Argv {
            return None;
        }
        let command: Vec<&str> = std::iter::once(context.application.as_str())
            .chain(context.path.iter().map(String::as_str))
            .chain(std::iter::once("--help"))
            .collect();
        Some(super::messages::usage_hint(&command))
    }

    /// The canonical names of the children an operator may be pointed at, in authoring order.
    fn offered_names(command: &CommandNode) -> Vec<String> {
        command
            .children
            .iter()
            .filter(|child| !child.hidden && child.deprecated.is_none())
            .filter_map(|child| child.name.clone())
            .collect()
    }

    /// The Command the words name, taken child by child from the root, each word the canonical
    /// name or an alias of a child of the Command reached so far. Hidden and deprecated Commands
    /// resolve. A word that names no child is routing's unknown-command failure.
    fn command_at(root: &Arc<CommandNode>, words: &[String]) -> Result<Arc<CommandNode>, Error> {
        let mut reached = Arc::clone(root);
        for word in words {
            let child = reached
                .children
                .iter()
                .find(|child| {
                    child.name.as_deref() == Some(word.as_str()) || child.aliases.contains(word)
                })
                .cloned();
            match child {
                Some(child) => reached = child,
                None => return Err(UnknownCommandError::new(word, offered_names(&reached)).into()),
            }
        }
        Ok(reached)
    }

    /// The help Command: `help [command...]` prints the extended page of the Command its words
    /// name, paged under the same setting as `--help`.
    fn help_command(paging: bool) -> Command {
        Command::new("help")
            .description("Show help for a command.")
            .argument(
                "command",
                Arg::string()
                    .description(
                        "The command to show help for, as you would type it. The application itself when left out.",
                    )
                    .variadic(),
            )
            .action(move |context: Context| async move {
                let words: Vec<String> = context.argument("command")?;
                let command = command_at(&context.graph.root, &words)?;
                let page = HelpPage::new(command, Arc::clone(&context.graph), HelpVariant::Extended);
                let show = Show {
                    host: &context.host,
                    out: &context.out,
                    signal: &context.signal,
                    on_shutdown: |handler| context.on_shutdown(handler),
                };
                show_page(show, page, paging).await
            })
    }
}

#[cfg(feature = "help")]
pub use plugin::{Help, HelpOptions, help};
