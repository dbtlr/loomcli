//! The man page plugin: one roff page for every Command an operator can find, written to a folder
//! or installed in the operator's home.
//!
//! [`manpage()`] contributes the `manpage` Command group and a graph hook. Its four children are
//! `generate --out <folder>`, which writes the pages and records nothing; `install`, which writes
//! the set to `<home>/.local/share/man/man1` and records it in the installation record's file
//! `manpage.json`; `update`, which brings the recorded pages up to date in the folder that holds
//! them; and `uninstall`, which removes them. The hook rejects a graph in which two findable
//! Commands give one page name, `foo-bar` beside `foo bar`.
//!
//! A page is ASCII roff for the `man` macro package, derived from the graph and from the help
//! facts (details, examples, epilogs, sections, placeholders) and the configuration paths its
//! Commands carry, and from no host fact, so one graph gives the same bytes on every host. Neither
//! the help plugin nor the configuration plugin need be installed: a page reads the values a node
//! carries and is shorter without them.
//!
//! Install it once. A root that declares arguments cannot hold children, so such an application
//! cannot install the plugin. Pass [`refresh_manpages`] to the self-update plugin so a replaced
//! binary rewrites the installed pages.
//!
//! ```
//! use loomcli_core::Application;
//! use loomcli_plugins::manpage::manpage;
//!
//! let application = Application::new("notes")
//!     .description("Keep notes in sync.")
//!     .plugins((manpage(),));
//! # let _ = application;
//! ```

mod advice;
mod children;
mod markdown;
mod messages;
mod page;
mod pages;
#[doc(hidden)]
pub mod roff;

use loomcli_core::{Command, Context, Error, FatalError, Opt, Plugin};

use self::children::{ChildRun, generate_pages, install_pages, uninstall_pages, update_pages};
use crate::PACKAGE_NAME;
use crate::help::extension::{HELP_INPUT, HelpInputFacts};
use crate::installation::{Refresh, refresh_by_running};

pub use crate::installation::RefreshContext;

/// The run a child acts on, read from its action context.
fn child_run(context: &Context) -> ChildRun<'_> {
    ChildRun {
        graph: &context.graph,
        host: &context.host,
        signal: &context.signal,
        out: &context.out,
    }
}

/// `generate`: the pages written to the folder `--out` names.
fn generate_command() -> Command {
    Command::new("generate")
        .description("Write the man pages to a folder.")
        .option(
            "out",
            Opt::string()
                .required()
                .description("The folder to write the man pages in. It is created when missing.")
                .extend([HELP_INPUT.value(HelpInputFacts::placeholder("folder"))]),
        )
        .action(|context: Context| async move {
            // `required` means validation rejected a run without it, so the action always has it.
            let out: Option<String> = context.option("out")?;
            let out = out.ok_or_else(|| FatalError::new("--out is required."))?;
            generate_pages(&child_run(&context), &out).await
        })
}

/// `install`: the set under the operator's home.
fn install_command() -> Command {
    Command::new("install")
        .description("Install the man pages in your home folder.")
        .action(|context: Context| async move { install_pages(&child_run(&context)).await })
}

/// `update`: the recorded set brought up to date with this version.
fn update_command() -> Command {
    Command::new("update")
        .description("Bring installed man pages up to date with this version.")
        .action(|context: Context| async move { update_pages(&child_run(&context)).await })
}

/// `uninstall`: the recorded pages removed.
fn uninstall_command() -> Command {
    Command::new("uninstall")
        .description("Remove the installed man pages.")
        .action(|context: Context| async move { uninstall_pages(&child_run(&context)).await })
}

/// The man page plugin. It writes one man page for each Command an operator can find, and
/// installs, refreshes, and removes the set in the operator's home folder. It contributes the
/// `manpage` group and a graph hook that rejects two page names one file would hold. Its identity
/// is `@loomcli/plugins/manpage`.
pub fn manpage() -> Plugin {
    let group = Command::new("manpage")
        .description("Write or install the man pages.")
        .command(generate_command())
        .command(install_command())
        .command(update_command())
        .command(uninstall_command());
    Plugin::new(format!("{PACKAGE_NAME}/manpage"))
        .commands([group])
        .on_graph_built(pages::judge_page_names)
}

/// What the man page refresh runs and says.
const REFRESH: Refresh = Refresh {
    words: &["manpage", "update"],
    warning: "Man pages were not refreshed after the update.",
    not_started: |path, name| {
        format!(
            "The man pages were not refreshed because {path} could not start. Run {name} manpage update.\n"
        )
    },
};

/// An `after_replace` function for the self-update plugin: a page is fixed text and the replaced
/// process holds the old version's graph, so it runs the new binary with `manpage update` and
/// passes the child's output through. A child that fails or cannot start adds a `warn` log event
/// and returns `Ok`, because the binary update succeeded; the cancellation of the run ends the
/// child.
///
/// An application that runs more after a replace calls it from its own function and awaits it.
///
/// # Errors
///
/// None today; the result keeps the shape an `after_replace` function has.
pub async fn refresh_manpages(context: RefreshContext<'_>) -> Result<(), Error> {
    refresh_by_running(context, &REFRESH).await;
    Ok(())
}

/// The page renderers for the crate's integration tests, which cannot reach the private modules.
/// Not part of any contract.
#[doc(hidden)]
pub mod test_support {
    pub use super::page::{ManPage, man_pages};

    /// The roff lines one Markdown source renders to, as DESCRIPTION opens with it. `preceded`
    /// says a paragraph already opens the section.
    #[must_use]
    pub fn details_lines(source: &str, preceded: bool) -> Vec<String> {
        super::markdown::details_lines(source, preceded)
    }
}
