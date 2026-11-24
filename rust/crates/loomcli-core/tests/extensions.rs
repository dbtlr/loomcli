//! Extension values on declarations, ported from the reference's `extensions.test.ts`,
//! `extended-command.test.ts`, and the author layers of `collecting-extensions.test.ts`. The values
//! a lifecycle hook adds are in `hooks.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};

use loomcli_core::{
    Application, Arg, ArgumentTarget, Collecting, Command, CommandTarget, Context, Extension,
    FailureFacts, Issue, Opt, OptionTarget, read_extension,
};
use serde::{Deserialize, Serialize};

async fn act(_context: Context) -> loomcli_core::Outcome {
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct CommandHelp {
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    examples: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Placeholder {
    placeholder: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Note {
    note: String,
}

fn nonempty_details(value: &CommandHelp) -> Result<(), Vec<Issue>> {
    match &value.details {
        Some(details) if details.is_empty() => Err(vec![Issue::new("Use a nonempty detail.")]),
        _ => Ok(()),
    }
}

const COMMAND_FACTS: Extension<CommandTarget, CommandHelp> =
    Extension::new("@fixture/facts/command").check(nonempty_details);
const OPTION_FACTS: Extension<OptionTarget, Placeholder> = Extension::new("@fixture/facts/option");
const ARGUMENT_FACTS: Extension<ArgumentTarget, Placeholder> =
    Extension::new("@fixture/facts/argument");
const NOTES: Extension<CommandTarget, Note, Collecting> = Extension::collecting("@fixture/notes");
/// A second descriptor under the first one's identity, as a second copy of its crate would define.
const OTHER_COPY: Extension<CommandTarget, Note> = Extension::new("@fixture/facts/command");

fn help(details: &str) -> CommandHelp {
    CommandHelp {
        details: Some(details.to_owned()),
        examples: None,
    }
}

fn facts() -> Application {
    let get = Command::new("get")
        .argument(
            "path",
            Arg::string()
                .required()
                .extend([ARGUMENT_FACTS.value(Placeholder {
                    placeholder: "PATH".to_owned(),
                })]),
        )
        .option(
            "field",
            Opt::string().extend([OPTION_FACTS.value(Placeholder {
                placeholder: "NAME".to_owned(),
            })]),
        )
        .extend([COMMAND_FACTS.value(CommandHelp {
            details: Some("Reads one value.".to_owned()),
            examples: Some(vec!["get user.name".to_owned()]),
        })])
        .action(act);
    let cache = Command::new("cache").command(Command::new("clear").action(act));
    Application::new("facts")
        .global_option(
            "file",
            Opt::string().extend([OPTION_FACTS.value(Placeholder {
                placeholder: "FILE".to_owned(),
            })]),
        )
        .extend([COMMAND_FACTS.value(help("The whole fixture."))])
        .command(get)
        .command(cache)
        .action(act)
}

fn panic_message(declare: impl FnOnce()) -> String {
    let payload = catch_unwind(AssertUnwindSafe(declare)).expect_err("the call faults");
    payload
        .downcast_ref::<String>()
        .cloned()
        .expect("the panic carries the diagnostic")
}

fn joined(message: &str) -> String {
    message.replace('\n', " ")
}

#[test]
fn inspect_reports_each_extension_value_keyed_by_its_identity_as_plain_data() {
    let graph = facts().inspect().expect("the graph builds");
    let json = |value: &serde_json::Map<String, serde_json::Value>| {
        serde_json::to_string(value).expect("serializes")
    };
    assert_eq!(
        json(&graph.root.extensions),
        r#"{"@fixture/facts/command":{"details":"The whole fixture."}}"#
    );
    let get = &graph.root.children[0];
    assert_eq!(
        json(&get.extensions),
        r#"{"@fixture/facts/command":{"details":"Reads one value.","examples":["get user.name"]}}"#
    );
    assert_eq!(
        json(&get.arguments[0].extensions),
        r#"{"@fixture/facts/argument":{"placeholder":"PATH"}}"#
    );
    assert_eq!(
        json(get.options[0].extensions()),
        r#"{"@fixture/facts/option":{"placeholder":"NAME"}}"#
    );
    assert_eq!(
        json(graph.globals[0].extensions()),
        r#"{"@fixture/facts/option":{"placeholder":"FILE"}}"#
    );
}

#[test]
fn a_declaration_that_carries_no_value_reports_an_empty_record() {
    let graph = facts().inspect().expect("the graph builds");
    let cache = &graph.root.children[1];
    assert_eq!(cache.name.as_deref(), Some("cache"));
    assert!(cache.extensions.is_empty());
    assert_eq!(
        serde_json::to_string(
            &serde_json::to_value(cache.as_ref()).expect("serializes")["extensions"]
        )
        .expect("serializes"),
        "{}"
    );
}

#[test]
fn read_extension_returns_the_stored_value_for_each_node_kind_and_none_for_none() {
    let graph = facts().inspect().expect("the graph builds");
    let get = &graph.root.children[0];
    assert_eq!(
        read_extension(&graph.root, &COMMAND_FACTS).expect("reads"),
        Some(help("The whole fixture."))
    );
    assert_eq!(
        read_extension(get, &COMMAND_FACTS)
            .expect("reads")
            .and_then(|value| value.examples),
        Some(vec!["get user.name".to_owned()])
    );
    assert_eq!(
        read_extension(get.arguments[0].as_ref(), &ARGUMENT_FACTS).expect("reads"),
        Some(Placeholder {
            placeholder: "PATH".to_owned()
        })
    );
    assert_eq!(
        read_extension(get.options[0].as_ref(), &OPTION_FACTS).expect("reads"),
        Some(Placeholder {
            placeholder: "NAME".to_owned()
        })
    );
    assert_eq!(
        read_extension(&graph.root.children[1], &COMMAND_FACTS).expect("reads"),
        None
    );
    assert_eq!(
        read_extension(&graph.root, &NOTES).expect("reads"),
        Vec::<Note>::new()
    );
}

#[test]
fn read_extension_through_another_descriptor_of_one_identity_returns_a_declaration_error() {
    let graph = facts().inspect().expect("the graph builds");
    let error = read_extension(&graph.root, &OTHER_COPY).expect_err("the descriptors differ");
    let fault = error
        .downcast_failure::<loomcli_core::DeclarationError>()
        .expect("a declaration fault");
    assert_eq!(
        fault.sentence(),
        "Extension \"@fixture/facts/command\" was read through a descriptor that did not define the stored value."
    );
    assert!(fault.message().contains("@loomcli/core/two-package-copies"));
    assert!(
        fault
            .message()
            .ends_with("\n\nInstall one copy of the package that defines it.")
    );
}

#[test]
fn a_fact_whose_plugin_is_not_installed_is_inert_and_still_reported() {
    let installed = Application::new("facts")
        .plugins([loomcli_core::Plugin::new("@fixture/facts")
            .extensions([
                loomcli_core::AnyExtension::from(COMMAND_FACTS),
                loomcli_core::AnyExtension::from(OPTION_FACTS),
                loomcli_core::AnyExtension::from(ARGUMENT_FACTS),
            ])
            .middleware(
                loomcli_core::Activation::Always,
                |_, next: loomcli_core::Next| async move { next.run().await.map(|_| ()) },
            )])
        .global_option(
            "file",
            Opt::string().extend([OPTION_FACTS.value(Placeholder {
                placeholder: "FILE".to_owned(),
            })]),
        )
        .extend([COMMAND_FACTS.value(help("The whole fixture."))])
        .command(
            Command::new("get")
                .extend([COMMAND_FACTS.value(CommandHelp {
                    details: Some("Reads one value.".to_owned()),
                    examples: Some(vec!["get user.name".to_owned()]),
                })])
                .action(act),
        )
        .action(act);
    let inert = Application::new("facts")
        .global_option(
            "file",
            Opt::string().extend([OPTION_FACTS.value(Placeholder {
                placeholder: "FILE".to_owned(),
            })]),
        )
        .extend([COMMAND_FACTS.value(help("The whole fixture."))])
        .command(
            Command::new("get")
                .extend([COMMAND_FACTS.value(CommandHelp {
                    details: Some("Reads one value.".to_owned()),
                    examples: Some(vec!["get user.name".to_owned()]),
                })])
                .action(act),
        )
        .action(act);
    let graph = |application: &Application| {
        serde_json::to_value(application.inspect().expect("the graph builds")).unwrap()
    };
    let inert = graph(&inert);
    assert_eq!(
        inert["root"]["children"][0]["extensions"],
        serde_json::json!({
            "@fixture/facts/command": { "details": "Reads one value.", "examples": ["get user.name"] }
        })
    );
    assert_eq!(inert, graph(&installed));
}

// extended-command.test.ts

#[tokio::test]
async fn an_extended_command_runs_through_its_alias_with_the_application_globals() {
    let original = Command::new("read")
        .description("Reads a value.")
        .extend([COMMAND_FACTS.value(CommandHelp {
            details: Some("Library help.".to_owned()),
            examples: Some(vec!["library".to_owned()]),
        })])
        .alias("r")
        .argument("path", Arg::string().required())
        .option("raw", Opt::boolean())
        .action(support::values);
    let enriched = original.extend([COMMAND_FACTS.value(help("Application help."))]);
    let application = Application::new("example")
        .global_option("quiet", Opt::boolean())
        .command(enriched)
        .extend([COMMAND_FACTS.value(help("root"))]);
    assert_eq!(
        support::run(&application, &["r", "document", "--raw", "--quiet"]).await,
        support::Ran {
            status: 0,
            stdout:
                "{\"args\":{\"path\":\"document\"},\"options\":{\"quiet\":true,\"raw\":true}}\n"
                    .to_owned(),
            stderr: String::new(),
        }
    );
}

#[test]
fn a_completed_command_accepts_whole_value_extension_replacement() {
    let library = Command::new("get")
        .description("Reads a value.")
        .extend([COMMAND_FACTS.value(CommandHelp {
            details: Some("Library help.".to_owned()),
            examples: Some(vec!["library".to_owned()]),
        })])
        .action(act);
    let before = Application::new("before")
        .command(library)
        .action(act)
        .inspect()
        .expect("the graph builds");
    let library = Command::new("get")
        .description("Reads a value.")
        .extend([COMMAND_FACTS.value(CommandHelp {
            details: Some("Library help.".to_owned()),
            examples: Some(vec!["library".to_owned()]),
        })])
        .action(act);
    let customized = library.extend([COMMAND_FACTS.value(help("Application help."))]);
    let after = Application::new("after")
        .command(customized)
        .action(act)
        .inspect()
        .expect("the graph builds");
    let read = |graph: &loomcli_core::CommandGraph| {
        read_extension(&graph.root.children[0], &COMMAND_FACTS).expect("reads")
    };
    assert_eq!(
        read(&before),
        Some(CommandHelp {
            details: Some("Library help.".to_owned()),
            examples: Some(vec!["library".to_owned()]),
        })
    );
    assert_eq!(read(&after), Some(help("Application help.")));
    assert_eq!(
        after.root.children[0].description.as_deref(),
        Some("Reads a value.")
    );
    assert!(after.root.children[0].has_action);
}

#[test]
fn a_second_value_of_one_extension_in_one_call_replaces_the_first_whole() {
    let graph = Application::new("app")
        .command(
            Command::new("get")
                .extend([
                    COMMAND_FACTS.value(CommandHelp {
                        details: Some("One.".to_owned()),
                        examples: Some(vec!["one".to_owned()]),
                    }),
                    COMMAND_FACTS.value(help("Two.")),
                ])
                .action(act),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    assert_eq!(
        serde_json::to_string(&graph.root.children[0].extensions).expect("serializes"),
        r#"{"@fixture/facts/command":{"details":"Two."}}"#
    );
}

#[test]
fn two_descriptors_under_one_identity_fault_where_both_first_reach_one_declaration() {
    let in_one_call = panic_message(|| {
        let _ = Command::new("get").extend((
            COMMAND_FACTS.value(help("One.")),
            OTHER_COPY.value(Note {
                note: "Two.".to_owned(),
            }),
        ));
    });
    assert!(in_one_call.contains("@loomcli/core/two-package-copies"));
    assert!(
        joined(&in_one_call).contains("Extension \"@fixture/facts/command\" is defined twice.")
    );
    assert!(in_one_call.ends_with("\n\nInstall one copy of the package that defines it."));
    let application = Application::new("app").extend([COMMAND_FACTS.value(help("Root."))]);
    let at_attach = panic_message(move || {
        let _ = application.command(
            Command::new("get")
                .extend([OTHER_COPY.value(Note {
                    note: "Two.".to_owned(),
                })])
                .action(act),
        );
    });
    assert!(at_attach.contains("@loomcli/core/two-package-copies"));
}

#[test]
fn a_value_its_descriptors_rules_reject_faults_at_the_call_that_carries_it() {
    let message = panic_message(|| {
        let _ = Command::new("get").extend([COMMAND_FACTS.value(help(""))]);
    });
    assert!(message.contains("@loomcli/core/invalid-extension-value"));
    assert!(joined(&message).contains(
        "Command \"get\" holds an invalid \"@fixture/facts/command\" value: Use a nonempty detail."
    ));
    assert!(message.ends_with("\n\nCorrect the value."));
    let on_option = panic_message(|| {
        let _ = Command::new("get")
            .option(
                "field",
                Opt::string().extend([OPTION_FACTS.value(Placeholder {
                    placeholder: "NAME".to_owned(),
                })]),
            )
            .extend([COMMAND_FACTS.value(help(""))]);
    });
    assert!(joined(&on_option).contains("Command \"get\" holds an invalid"));
}

#[test]
fn a_value_that_is_not_plain_data_faults_under_extension_output() {
    const PAIRS: Extension<CommandTarget, BTreeMap<(u8, u8), u8>> =
        Extension::new("@fixture/pairs");
    let message = panic_message(|| {
        let _ = Command::new("get").extend([PAIRS.value(BTreeMap::from([((1, 2), 3)]))]);
    });
    assert!(message.contains("@loomcli/core/extension-output"));
    assert!(joined(&message).contains(
        "Extension \"@fixture/pairs\" produced a value that is not plain data on Command \"get\"."
    ));
}

// collecting-extensions.test.ts, the author's layers.

#[test]
fn a_collecting_extension_keeps_each_layers_value_in_authoring_order() {
    let graph = Application::new("app")
        .command(
            Command::new("get")
                .extend([NOTES.value(Note {
                    note: "Read one value.".to_owned(),
                })])
                .action(act)
                .extend([NOTES.value(Note {
                    note: "Paths are dot-separated.".to_owned(),
                })]),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    let get = &graph.root.children[0];
    assert_eq!(
        serde_json::to_string(&get.extensions).expect("serializes"),
        r#"{"@fixture/notes":[{"note":"Read one value."},{"note":"Paths are dot-separated."}]}"#
    );
    let notes: Vec<String> = read_extension(get, &NOTES)
        .expect("reads")
        .into_iter()
        .map(|note| note.note)
        .collect();
    assert_eq!(notes, ["Read one value.", "Paths are dot-separated."]);
}

#[test]
fn a_collecting_extension_on_an_input_holds_one_value() {
    const INPUT_NOTES: Extension<OptionTarget, Note, Collecting> =
        Extension::collecting("@fixture/notes/option");
    let graph = Application::new("app")
        .option(
            "field",
            Opt::string().extend([INPUT_NOTES.value(Note {
                note: "A field.".to_owned(),
            })]),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    assert_eq!(
        read_extension(graph.root.options[0].as_ref(), &INPUT_NOTES)
            .expect("reads")
            .len(),
        1
    );
}

// The order the rules answer in when one call breaks two of them.

fn nonempty_placeholder(value: &Placeholder) -> Result<(), Vec<Issue>> {
    if value.placeholder.is_empty() {
        Err(vec![Issue::new("Use a nonempty placeholder.")])
    } else {
        Ok(())
    }
}

const STRICT_ARGUMENT: Extension<ArgumentTarget, Placeholder> =
    Extension::new("@fixture/strict/argument").check(nonempty_placeholder);

fn rejected() -> loomcli_core::ExtensionValue<ArgumentTarget> {
    STRICT_ARGUMENT.value(Placeholder {
        placeholder: String::new(),
    })
}

/// The rule identity a diagnostic's banner ends with, and the sentence below the banner.
fn rule_and_sentence(message: &str) -> (String, String) {
    let mut paragraphs = message.split("\n\n");
    let banner = paragraphs.next().unwrap_or_default();
    let identity = banner.rsplit(' ').next().unwrap_or_default().to_owned();
    (identity, joined(paragraphs.next().unwrap_or_default()))
}

#[test]
fn an_arguments_slot_order_and_stdin_claim_answer_before_its_extension_values() {
    let out_of_order = panic_message(|| {
        let _ = Command::new("get")
            .argument("a", Arg::string())
            .argument("b", Arg::string().required().extend([rejected()]));
    });
    assert_eq!(
        rule_and_sentence(&out_of_order),
        (
            "@loomcli/core/optional-argument-last".to_owned(),
            "Argument \"a\" is optional and precedes required argument \"b\" on Command \"get\"."
                .to_owned()
        )
    );
    let second_claim = panic_message(|| {
        let _ = Command::new("read")
            .option("input", Opt::content().stdin())
            .argument("file", Arg::content().stdin().extend([rejected()]));
    });
    assert_eq!(
        rule_and_sentence(&second_claim),
        (
            "@loomcli/core/stdin-claimed-twice".to_owned(),
            "A Command declares more than one stdin target.".to_owned()
        )
    );
}

#[test]
fn a_joining_command_admits_its_descriptors_before_its_options_meet_the_globals() {
    let application = Application::new("app")
        .global_option("g", Opt::boolean())
        .extend([COMMAND_FACTS.value(help("Root."))]);
    let both = application.clone();
    let message = panic_message(move || {
        let _ = both.command(
            Command::new("get")
                .option("g", Opt::string())
                .extend([OTHER_COPY.value(Note {
                    note: "Two.".to_owned(),
                })])
                .action(act),
        );
    });
    assert_eq!(
        rule_and_sentence(&message),
        (
            "@loomcli/core/two-package-copies".to_owned(),
            "Extension \"@fixture/facts/command\" is defined twice.".to_owned()
        )
    );
    // One node at a time: a collision on the child reports before a conflicting descriptor below it.
    let message = panic_message(move || {
        let _ = application.command(
            Command::new("cache")
                .option("g", Opt::string())
                .command(
                    Command::new("clear")
                        .extend([OTHER_COPY.value(Note {
                            note: "Two.".to_owned(),
                        })])
                        .action(act),
                )
                .action(act),
        );
    });
    assert_eq!(
        rule_and_sentence(&message),
        (
            "@loomcli/core/option-declared-twice".to_owned(),
            "Option \"g\" is declared as a global option and as a local option on Command \"cache\"."
                .to_owned()
        )
    );
}
