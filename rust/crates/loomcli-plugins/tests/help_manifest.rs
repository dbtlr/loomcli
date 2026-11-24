//! Help in the manifest, ported from the reference's `help-manifest.test.ts`: help's attach hook
//! supplies each Command's details and examples to the manifest's collecting extension. The
//! `manifestCommand` rule cases belong to the manifest package.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::noop;
use loomcli_core::{AnyPlugin, Application, Command, CommandNode, Plugin, read_extension};
use loomcli_plugins::help::extension::{CommandExample, HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::help::help;
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};

/// The root's help: prose, one example, and section facts help does not supply.
fn root_help() -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    HELP_COMMAND.value(
        HelpCommandFacts::new()
            .command_sections(&[&["Work", "Read"]])
            .details("The whole fixture.\nIts second line.")
            .examples(vec![CommandExample::new("noted x").note("One example.")])
            .option_sections(&[&["Output"]])
            .section(&["Root"]),
    )
}

/// Four Commands: help examples with an author value, an empty help value, none, and details
/// alone.
fn commands(
    application: Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Fresh>,
) -> loomcli_core::GroupApplication<loomcli_core::NoInputs, loomcli_core::NoResult> {
    application
        .command(
            Command::new("noted")
                .extend((
                    MANIFEST_COMMAND
                        .value(ManifestCommandFacts::new().details("Only an agent needs this.")),
                    HELP_COMMAND.value(
                        HelpCommandFacts::new().examples(vec![CommandExample::new("noted y")]),
                    ),
                ))
                .action(noop),
        )
        .command(
            Command::new("empty")
                .extend([HELP_COMMAND.value(HelpCommandFacts::new())])
                .action(noop),
        )
        .command(Command::new("plain").action(noop))
        .command(
            Command::new("detailed")
                .extend([HELP_COMMAND.value(HelpCommandFacts::new().details("Details alone."))])
                .action(noop),
        )
}

fn manifest(node: &CommandNode) -> Vec<ManifestCommandFacts> {
    read_extension(node, &MANIFEST_COMMAND).unwrap()
}

fn by_name<'a>(
    graph: &'a loomcli_core::CommandGraph,
    name: &str,
) -> &'a std::sync::Arc<CommandNode> {
    graph.command(&[name]).unwrap()
}

fn details(text: &str) -> ManifestCommandFacts {
    ManifestCommandFacts::new().details(text)
}

fn examples(command: &str) -> ManifestCommandFacts {
    ManifestCommandFacts::new().examples([CommandExample::new(command)])
}

#[test]
fn help_supplies_its_details_and_examples_after_the_author_value_with_no_manifest_plugin() {
    let application = commands(
        Application::new("app")
            .plugins((help(),))
            .extend([root_help()]),
    );
    let graph = application.inspect().unwrap();
    assert_eq!(
        manifest(&graph.root),
        [ManifestCommandFacts::new()
            .details("The whole fixture.\nIts second line.")
            .examples([CommandExample::new("noted x").note("One example.")])]
    );
    assert_eq!(
        manifest(by_name(&graph, "noted")),
        [details("Only an agent needs this."), examples("noted y")]
    );
    assert_eq!(manifest(by_name(&graph, "empty")), []);
    assert_eq!(manifest(by_name(&graph, "plain")), []);
    assert_eq!(
        manifest(by_name(&graph, "detailed")),
        [details("Details alone.")]
    );
}

#[test]
fn help_supplies_what_it_read_at_its_own_turn_whatever_a_later_hook_does_to_its_value() {
    let replacing: AnyPlugin = Plugin::new("@fixture/replacing")
        .on_command_attach(|command| {
            if command.name() == Some("noted") {
                command.extend([
                    HELP_COMMAND.value(HelpCommandFacts::new().details("Replaced after help."))
                ])?;
            }
            Ok(())
        })
        .into();
    let application = commands(Application::new("app").plugins((help(), replacing)));
    let graph = application.inspect().unwrap();
    let noted = by_name(&graph, "noted");
    assert_eq!(
        manifest(noted),
        [details("Only an agent needs this."), examples("noted y")]
    );
    assert_eq!(
        read_extension(&**noted, &HELP_COMMAND).unwrap(),
        Some(HelpCommandFacts::new().details("Replaced after help."))
    );
}

#[test]
fn without_help_installed_the_manifest_holds_the_author_values_alone() {
    let application = commands(
        Application::new("app")
            .plugins(Vec::<AnyPlugin>::new())
            .extend([root_help()]),
    );
    let graph = application.inspect().unwrap();
    assert_eq!(manifest(&graph.root), []);
    assert_eq!(
        manifest(by_name(&graph, "noted")),
        [details("Only an agent needs this.")]
    );
    for name in ["empty", "plain", "detailed"] {
        assert_eq!(manifest(by_name(&graph, name)), [], "{name}");
    }
}

#[test]
fn help_and_the_manifest_take_one_example_type_so_one_list_serves_both() {
    let shared = vec![
        CommandExample::new("noted x").note("One example."),
        CommandExample::new("noted y"),
    ];
    let command = Command::new("noted")
        .extend((
            HELP_COMMAND.value(HelpCommandFacts::new().examples(shared.clone())),
            MANIFEST_COMMAND.value(ManifestCommandFacts::new().examples(shared.clone())),
        ))
        .action(noop);
    let application = Application::new("app")
        .plugins(Vec::<AnyPlugin>::new())
        .command(command);
    let graph = application.inspect().unwrap();
    let noted = by_name(&graph, "noted");
    assert_eq!(
        read_extension(&**noted, &HELP_COMMAND).unwrap(),
        Some(HelpCommandFacts::new().examples(shared.clone()))
    );
    assert_eq!(
        manifest(noted),
        [ManifestCommandFacts::new().examples(shared)]
    );
}
