//! Help's facts on content inputs and option groups, and the facts its descriptors keep, ported
//! from the reference's `content-help.test.ts` (the help page half; the man page half belongs to
//! the manpage package), the help sentences of `option-groups.test.ts`, and the help case of
//! `extension-facts.test.ts`.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use std::sync::Arc;

use help_support::{dispatch, noop, run};
use loomcli_core::{
    Application, Arg, InvocationOutcome, InvocationValues, InvokeOptions, Opt, Polarity,
    ProcessHandle, read_extension,
};
use loomcli_plugins::help::extension::{
    CommandExample, HELP_ARGUMENT, HELP_COMMAND, HELP_INPUT, HelpArgumentFacts, HelpCommandFacts,
    HelpInputFacts,
};
use loomcli_plugins::help::help;
use loomcli_testing::{MockFields, mock_process};

#[tokio::test]
async fn help_names_a_content_bound_with_the_right_source_noun() {
    for (bound, facts) in [
        (0, "min: 0 sources, max: 0 sources"),
        (1, "min: 1 source, max: 1 source"),
        (2, "min: 2 sources, max: 2 sources"),
    ] {
        let application = Application::new("count")
            .plugins((help(),))
            .description("Count sources.")
            .argument(
                "files",
                Arg::content()
                    .description("The files.")
                    .max(bound)
                    .min(bound)
                    .variadic(),
            )
            .option(
                "extra",
                Opt::content()
                    .description("The additional files.")
                    .max(bound)
                    .min(bound)
                    .multiple(),
            )
            .action(noop);
        let outcome = application
            .invoke(
                &[],
                InvocationValues::new().option("help", true),
                InvokeOptions::new(),
                Some(mock_process(MockFields::new()) as Arc<dyn ProcessHandle>),
            )
            .await;
        let InvocationOutcome::Completed { output, .. } = outcome else {
            panic!("the help takeover completes");
        };
        assert!(
            output.contains(&format!("The files.  (file path, {facts})")),
            "{output}"
        );
        assert!(
            output.contains(&format!("The additional files.  (file path, {facts},")),
            "{output}"
        );
    }
}

#[tokio::test]
async fn help_states_visible_groups_and_never_a_group_with_a_hidden_member() {
    let application = Application::new("groups")
        .plugins((help(),))
        .description("Export documents.")
        .option(
            "json",
            Opt::boolean()
                .aliases(["js"])
                .description("JSON output.")
                .polarity(Polarity::Both),
        )
        .option(
            "yaml",
            Opt::boolean()
                .description("YAML output.")
                .polarity(Polarity::Both),
        )
        .option("user", Opt::string().description("User name."))
        .option("password", Opt::string().description("Password."))
        .option(
            "secret",
            Opt::boolean().description("Hidden setting.").hidden(),
        )
        .option("other", Opt::boolean().description("Other setting."))
        .exclusive(&["json", "yaml"])
        .one_required(&["json", "yaml"])
        .required_together(&["user", "password"])
        .exclusive(&["secret", "other"])
        .action(dispatch);
    let outcome = run(&application, &["--help"]).await;
    assert_eq!(outcome.status, 0);
    assert!(
        outcome
            .stdout
            .contains("Use at most one of --json and --yaml.")
    );
    assert!(
        outcome
            .stdout
            .contains("Supply at least one of --json and --yaml.")
    );
    assert!(
        outcome
            .stdout
            .contains("Use --user and --password together.")
    );
    assert!(!outcome.stdout.contains("--secret"));
}

#[test]
fn help_keeps_every_field_its_facts_name() {
    let command = HelpCommandFacts::new()
        .command_sections(&[&["Work"], &["Work", "Read"]])
        .details("Read **one** value.")
        .epilog("Report a bug at the tracker.")
        .examples(vec![
            CommandExample::new("get name").note("A top-level key."),
        ])
        .option_sections(&[&["Output"]])
        .section(&["Work", "Read"]);
    let input = HelpInputFacts::placeholder("path")
        .accepts("A dotted path.")
        .hide_bindings()
        .section(&["Output"]);
    let argument = HelpArgumentFacts::accepts("A dotted path.");
    let application = Application::new("app")
        .extend([HELP_COMMAND.value(command.clone())])
        .argument(
            "path",
            Arg::string().extend([HELP_ARGUMENT.value(argument.clone())]),
        )
        .option(
            "file",
            Opt::string().extend([HELP_INPUT.value(input.clone())]),
        )
        .action(noop);
    let graph = application.inspect().unwrap();
    assert_eq!(
        read_extension(&graph.root, &HELP_COMMAND).unwrap(),
        Some(command)
    );
    assert_eq!(
        read_extension(&*graph.root.options[0], &HELP_INPUT).unwrap(),
        Some(input)
    );
    assert_eq!(
        read_extension(&*graph.root.arguments[0], &HELP_ARGUMENT).unwrap(),
        Some(argument)
    );
    let published = serde_json::to_value(&graph.root.extensions).unwrap();
    assert_eq!(
        published["@loomcli/plugins/help/command"],
        serde_json::json!({
            "commandSections": [["Work"], ["Work", "Read"]],
            "details": "Read **one** value.",
            "epilog": "Report a bug at the tracker.",
            "examples": [{ "command": "get name", "note": "A top-level key." }],
            "optionSections": [["Output"]],
            "section": ["Work", "Read"],
        })
    );
}
