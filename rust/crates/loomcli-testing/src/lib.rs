//! Testing support for Loom CLI applications: the assembly check, the mock process, and the
//! context and value builders a unit test hands to one function.
//!
//! A test runs an application through its public surface on a [`MockProcess`] and asserts the exact
//! stdout, stderr, and exit code, reading nothing from the real environment, terminal, clock, or
//! home folder.

mod contexts;
mod hook_values;
pub mod key;
mod mock;

pub use contexts::{
    ActionValues, EnvironmentValues, FailureHookValues, MiddlewareValues, ProviderValues,
    ViewValues, action_context, environment_context, failure_hook_context, file_content,
    middleware_context, piped_content, provider_context, view_context,
};
pub use hook_values::{
    LogDestinationValues, LogEventValues, ProgressEventValues, log_destination, log_event,
    progress_event,
};
pub use mock::{
    KeyEntry, MockFields, MockProcess, MockTerminal, Program, ProgramAnswer, ProgramCall,
    StreamName, Write, mock_process,
};

use loomcli_core::{
    Application, CommandGraph, CommandNode, DeclarationError, FailureFacts, OptionNode, State,
};

/// Panics naming each Command, option, argument, and stdin declaration that has no description: the
/// reference's `undescribed` lint, as a test the author installs. It reads the graph
/// `Application::inspect` builds, so it covers what every plugin and hook declared too: the
/// Application's own description, each global option, and each Command with its options, arguments,
/// and stdin, depth first. An application that does not assemble panics as [`assert_assembles`]
/// does.
///
/// ```should_panic
/// use loomcli_core::{Application, Arg, Command, Context};
/// use loomcli_testing::assert_described;
///
/// let app = Application::new("store").command(
///     Command::new("get")
///         .argument("path", Arg::string().required())
///         .action(|ctx: Context| async move { ctx.out.print("got").await }),
/// );
/// assert_described(&app);
/// ```
#[track_caller]
pub fn assert_described<I, R, S: State>(application: &Application<I, R, S>) {
    // `inspect` stops at the first fault; `check` collects every one, as `assert_assembles` reports.
    let faults = application.check();
    if !faults.is_empty() {
        panic!("{}", assembly_report(&faults));
    }
    let graph = match application.inspect() {
        Ok(graph) => graph,
        Err(fault) => panic!("{}", assembly_report(&[fault])),
    };
    let undescribed = undescribed(&graph);
    if undescribed.is_empty() {
        return;
    }
    let noun = if undescribed.len() == 1 {
        "declaration"
    } else {
        "declarations"
    };
    let lines: Vec<String> = undescribed
        .iter()
        .map(|subject| format!("{subject} has no description."))
        .collect();
    panic!(
        "The application has {} {noun} with no description.\n\n{}\n\nGive each a description of one line, which help, agents, MCP tools, and the manifest read.",
        undescribed.len(),
        lines.join("\n")
    );
}

/// Each declaration of `graph` with no description, named as its sentence names it.
fn undescribed(graph: &CommandGraph) -> Vec<String> {
    let mut found = Vec::new();
    let application = format!("Application \"{}\"", graph.name);
    if graph.description.is_none() {
        found.push(application.clone());
    }
    for option in &graph.globals {
        if option_description(option).is_none() {
            found.push(format!("Global option \"{}\"", option.name()));
        }
    }
    command_undescribed(&graph.root, &application, &mut found);
    found
}

fn command_undescribed(command: &CommandNode, application: &str, found: &mut Vec<String>) {
    let owner = if command.path.is_empty() {
        application.to_owned()
    } else {
        let subject = format!("Command \"{}\"", command.path.join(" "));
        if command.description.is_none() {
            found.push(subject.clone());
        }
        subject
    };
    for option in &command.options {
        if option_description(option).is_none() {
            found.push(format!("Option \"{}\" of {owner}", option.name()));
        }
    }
    for argument in &command.arguments {
        if argument.description.is_none() {
            found.push(format!("Argument \"{}\" of {owner}", argument.name));
        }
    }
    if let Some(stdin) = &command.stdin {
        if stdin.description.is_none() {
            found.push(format!("Stdin of {owner}"));
        }
    }
    for child in &command.children {
        command_undescribed(child, application, found);
    }
}

fn option_description(option: &OptionNode) -> Option<&str> {
    match option {
        OptionNode::String(node) => node.description.as_deref(),
        OptionNode::Content(node) => node.description.as_deref(),
        OptionNode::Boolean(node) => node.description.as_deref(),
        OptionNode::Count(node) => node.description.as_deref(),
        _ => None,
    }
}

/// The message a failed assembly panics with: a lead line that counts the faults, then each fault's
/// Developer Diagnostic in the order `check()` returned them, each after a blank line.
fn assembly_report(faults: &[DeclarationError]) -> String {
    let noun = if faults.len() == 1 { "fault" } else { "faults" };
    let mut sections = vec![format!(
        "The application does not assemble: {} {noun}.",
        faults.len()
    )];
    sections.extend(faults.iter().map(|fault| fault.message().to_owned()));
    sections.join("\n\n")
}

/// Builds a fresh graph and panics with each declaration
/// fault's Developer Diagnostic, so one test proves the application assembles. It reads
/// `Application::check`, so a declared default its validator would reject on some machine is not
/// judged here; `run` reports it.
///
/// The message opens with one line that counts the faults, `The application does not assemble: 2
/// faults.`, then holds each fault's Developer Diagnostic in the order `check()` returns them, each
/// after a blank line.
///
/// ```
/// use loomcli_core::{Application, Context};
/// use loomcli_testing::assert_assembles;
///
/// let app = Application::new("probe")
///     .description("Assemble the probe.")
///     .action(|ctx: Context| async move { ctx.out.print("ran").await });
/// assert_assembles(&app);
/// ```
#[track_caller]
pub fn assert_assembles<I, R, S: State>(application: &Application<I, R, S>) {
    let faults = application.check();
    if !faults.is_empty() {
        panic!("{}", assembly_report(&faults));
    }
}
