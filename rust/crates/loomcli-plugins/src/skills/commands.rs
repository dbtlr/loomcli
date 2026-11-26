//! The `skills` Command group and the plugin that attaches it.

use std::sync::Arc;

use loomcli_core::{Command, Context, Error, Inputs, Plugin, RowView, RowViews, RowsResult};
use loomcli_validators::one_of;

use super::Declared;
use super::global::{ChildRun, InstallRequestFacts, install_global, uninstall_global};
use super::messages::WritingVerb;
use super::project::{ProjectRequest, directory_needs_project, install_project};
use super::status::{self, SkillStatus};
use super::targets::Target;
use crate::PACKAGE_NAME;
use crate::format::views::json;

/// The options of `skills install`.
#[derive(Inputs)]
struct InstallInputs {
    /// The agents to install for: claude, or agents for Codex and others. Both when left out.
    #[option(validate = one_of(["claude", "agents"]))]
    agent: Option<String>,
    /// Install into the current repository instead of your home folder.
    #[option]
    project: bool,
    /// Find the repository from this directory instead of the current one.
    #[option(short = 'C')]
    directory: Option<String>,
    /// Replace skill files that something else wrote or that you changed.
    #[option]
    force: bool,
}

/// The options of `skills uninstall`.
#[derive(Inputs)]
struct UninstallInputs {
    /// The agents to remove the skills from: claude or agents. Both when left out.
    #[option(validate = one_of(["claude", "agents"]))]
    agent: Option<String>,
}

/// The target `--agent` named; the validator already limited the value to the two names.
fn target_of(agent: Option<&str>) -> Option<Target> {
    agent.and_then(Target::named)
}

/// The run a child acts on, read from its action context.
fn child_run<'a, I, R>(context: &'a Context<I, R>, name: &'a str) -> ChildRun<'a, R> {
    ChildRun {
        name,
        graph: &context.graph,
        log: &context.log,
        host: &context.host,
        signal: &context.signal,
        out: &context.out,
    }
}

/// `install`: global folders recorded in the installation record, or `--project` copies at the
/// repository root.
fn install_command(declared: &Arc<Declared>) -> Command<InstallInputs> {
    let declared = Arc::clone(declared);
    Command::new("install")
        .description("Install the skills for your coding agents.")
        .inputs::<InstallInputs>()
        .action(move |context: Context<InstallInputs>| {
            let declared = Arc::clone(&declared);
            async move {
                let name = context.graph.name.clone();
                let run = child_run(&context, &name);
                let inputs = &context.inputs;
                let agent = target_of(inputs.agent.as_deref());
                if inputs.project {
                    let request = ProjectRequest {
                        agent,
                        directory: inputs.directory.as_deref(),
                    };
                    return install_project(&run, &declared, &request).await;
                }
                if inputs.directory.is_some() {
                    return Err(Error::from(directory_needs_project()));
                }
                let facts = InstallRequestFacts {
                    verb: WritingVerb::Install,
                    agent,
                    force: inputs.force,
                };
                install_global(&run, &declared, &facts).await
            }
        })
}

/// `update`: the skills of each target whose record lists folders, brought up to date.
fn update_command(declared: &Arc<Declared>) -> Command {
    let declared = Arc::clone(declared);
    Command::new("update")
        .description("Bring installed skills up to date with this version.")
        .action(move |context: Context| {
            let declared = Arc::clone(&declared);
            async move {
                let name = context.graph.name.clone();
                let run = child_run(&context, &name);
                let facts = InstallRequestFacts {
                    verb: WritingVerb::Update,
                    agent: None,
                    force: false,
                };
                install_global(&run, &declared, &facts).await
            }
        })
}

/// `uninstall`: every recorded folder of the selected targets, removed whole. It calls no loader.
fn uninstall_command() -> Command<UninstallInputs> {
    Command::new("uninstall")
        .description("Remove the skills from your coding agents.")
        .inputs::<UninstallInputs>()
        .action(|context: Context<UninstallInputs>| async move {
            let name = context.graph.name.clone();
            let run = child_run(&context, &name);
            uninstall_global(&run, target_of(context.inputs.agent.as_deref())).await
        })
}

#[derive(Inputs)]
struct StatusInputs {
    /// The agents to report on: claude or agents. Both when left out.
    #[option(validate = one_of(["claude", "agents"]))]
    agent: Option<String>,
    /// Report on the current repository's skills instead of your home folder's.
    #[option]
    project: bool,
    /// Find the repository from this directory instead of the current one.
    #[option(short = 'C')]
    directory: Option<String>,
}

fn status_command(declared: &Arc<Declared>) -> Command<StatusInputs, RowsResult<SkillStatus>> {
    let declared = Arc::clone(declared);
    Command::new("status")
        .description("Report whether each skill is installed and up to date.")
        .inputs::<StatusInputs>()
        .rows(
            RowViews::new()
                .view("text", RowView::new(status::text))
                .view("json", json::<[SkillStatus]>()),
        )
        .action(
            move |context: Context<StatusInputs, RowsResult<SkillStatus>>| {
                let declared = Arc::clone(&declared);
                async move {
                    let run = child_run(&context, &context.graph.name);
                    let request = ProjectRequest {
                        agent: target_of(context.inputs.agent.as_deref()),
                        directory: context.inputs.directory.as_deref(),
                    };
                    let report =
                        status::report(&run, &declared, context.inputs.project, &request).await?;
                    context.out.results(report.rows).await?;
                    for notice in report.notices {
                        context.out.info(&notice).await?;
                    }
                    Ok(())
                }
            },
        )
}

/// The plugin: the `skills` group and its four children.
pub(super) fn plugin(declared: Declared) -> Plugin {
    let declared = Arc::new(declared);
    let selections = Arc::clone(&declared);
    Plugin::new(format!("{PACKAGE_NAME}/skills"))
        .extensions([super::extension::SKILL_COMMAND])
        .on_graph_built(move |graph| {
            for selection in &selections.selections {
                super::selection::selected_commands(
                    graph,
                    &selection.paths,
                    Some(&selection.skill),
                )?;
            }
            Ok(())
        })
        .commands([Command::new("skills")
            .description("Install this application's agent skills.")
            .command(install_command(&declared))
            .command(update_command(&declared))
            .command(uninstall_command())
            .command(status_command(&declared))])
}
