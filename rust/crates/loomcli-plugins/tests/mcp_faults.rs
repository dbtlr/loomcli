//! The MCP plugin's build faults, ported from the reference's `mcp.test.ts` (`build faults`, and
//! the `both-keys` case of `excluded options`) with the fault scenarios of its fixture
//! application and `invalid-mcp-input.mjs`.

#![cfg(feature = "mcp")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Build, Command, Context, DeclarationError, Done, FailureFacts, NoInputs,
    NoResult, Opt, ProcessHandle, ReleaseFacts, RunOptions, StringOpt,
};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, MCP_INPUT, McpCommandFacts, McpInputFacts};
use loomcli_plugins::mcp::mcp;
use loomcli_testing::{MockFields, mock_process};
use serde_json::json;

type App = Application<NoInputs, NoResult, Done>;

async fn dispatch(context: Context) -> Result<(), loomcli_core::Error> {
    context.out.print("dispatched").await
}

fn opted() -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    MCP_COMMAND.value(McpCommandFacts::new())
}

fn excluding() -> loomcli_core::ExtensionValue<loomcli_core::OptionTarget> {
    MCP_INPUT.value(McpInputFacts::excluded())
}

fn plain() -> Command<NoInputs, NoResult, Done> {
    Command::new("plain").description("Plain.").action(dispatch)
}

/// The application every fault scenario shares: a description and the plugin.
fn faulty() -> Application<NoInputs, NoResult, loomcli_core::Fresh> {
    Application::new("app")
        .plugins([mcp()])
        .description("A faulty fixture.")
}

/// A tool whose `file` option the author excluded, declared as `presence` says.
fn required_excluded(presence: fn(StringOpt) -> StringOpt) -> App {
    let file = presence(Opt::string().description("The file.").extend([excluding()]));
    faulty()
        .command(
            Command::new("get")
                .description("Get.")
                .extend([opted()])
                .option("file", file)
                .action(dispatch),
        )
        .command(plain())
        .action(dispatch)
}

/// A tool whose `message` and `file` options form one group of the given kind, with the named
/// members excluded.
fn group_excluded(one_required: bool, outside: &[&str]) -> App {
    let declare = |name: &str| {
        let option = Opt::string().description(format!("The {name}."));
        if outside.contains(&name) {
            option.extend([excluding()])
        } else {
            option
        }
    };
    let get = Command::new("get")
        .description("Get.")
        .extend([opted()])
        .option("message", declare("message"))
        .option("file", declare("file"));
    let grouped = if one_required {
        get.one_required(&["message", "file"])
    } else {
        get.required_together(&["message", "file"])
    };
    faulty()
        .command(grouped.action(dispatch))
        .command(plain())
        .action(dispatch)
}

fn scenario(name: &str) -> App {
    match name {
        "tool-name-taken" => {
            let create = Command::new("create")
                .description("Create.")
                .extend([opted()])
                .action(dispatch);
            let scratch = Command::new("scratch")
                .description("Scratch work.")
                .command(create);
            let flat = Command::new("scratch_create")
                .description("Create flat.")
                .extend([opted()])
                .action(dispatch);
            faulty()
                .command(scratch)
                .command(flat)
                .command(plain())
                .action(dispatch)
        }
        "tool-name-taken-root" => faulty()
            .extend([opted()])
            .command(
                Command::new("app")
                    .description("Named like the application.")
                    .extend([opted()])
                    .action(dispatch),
            )
            .action(dispatch),
        "tool-without-action" => {
            let clear = Command::new("clear").description("Clear.").action(dispatch);
            let cache = Command::new("cache")
                .description("The cache.")
                .extend([opted()])
                .command(clear);
            faulty().command(cache).command(plain()).action(dispatch)
        }
        "property-name-taken" => faulty()
            .command(
                Command::new("get")
                    .description("Get.")
                    .extend([opted()])
                    .argument("path", Arg::string().description("A path.").required())
                    .option("path", Opt::string().description("Another path."))
                    .action(dispatch),
            )
            .command(plain())
            .action(dispatch),
        "property-name-taken-global" => faulty()
            .global_option("path", Opt::string().description("A global path."))
            .command(
                Command::new("get")
                    .description("Get.")
                    .extend([opted()])
                    .argument("path", Arg::string().description("A path.").required())
                    .action(dispatch),
            )
            .command(plain())
            .action(dispatch),
        "required-input-excluded" => required_excluded(StringOpt::required),
        "required-input-excluded-non-interactive" => {
            required_excluded(StringOpt::required_when_non_interactive)
        }
        "required-input-excluded-content" => faulty()
            .command(
                Command::new("get")
                    .description("Get.")
                    .extend([opted()])
                    .option(
                        "file",
                        Opt::content()
                            .description("The file.")
                            .extend([excluding()])
                            .multiple()
                            .min(1),
                    )
                    .action(dispatch),
            )
            .command(plain())
            .action(dispatch),
        "optional-input-excluded" => required_excluded(|option| option),
        "one-required-all-excluded" => group_excluded(true, &["message", "file"]),
        "one-required-some-excluded" => group_excluded(true, &["file"]),
        "together-all-excluded" => group_excluded(false, &["message", "file"]),
        "together-some-excluded" => group_excluded(false, &["file"]),
        other => panic!("Unknown fixture scenario: {other}"),
    }
}

/// The fault a scenario's build raises, as its rule, sentence, and correction.
fn inspected(name: &str) -> Result<(), DeclarationError> {
    scenario(name).inspect().map(|_| ())
}

/// What one run of a scenario wrote, in a build.
async fn run(application: &App, argv: &[&str], build: Build) -> (u8, String, String) {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build)),
    );
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

const FAULTS: [(&str, &str, &str, &str); 11] = [
    (
        "tool-name-taken",
        "tool-name-taken",
        "Commands \"scratch create\" and \"scratch_create\" both serve the MCP tool \"scratch_create\".",
        "Rename one Command, or remove mcpCommand from one of them.",
    ),
    (
        "tool-name-taken-root",
        "tool-name-taken",
        "The root Command and Command \"app\" both serve the MCP tool \"app\".",
        "Rename one Command, or remove mcpCommand from one of them.",
    ),
    (
        "tool-without-action",
        "tool-without-action",
        "Command \"cache\" carries mcpCommand and registers no action.",
        "Remove mcpCommand, or opt in the Commands under it.",
    ),
    (
        "property-name-taken",
        "property-name-taken",
        "Command \"get\" declares argument \"path\" and option \"path\", which one MCP tool lists under one name.",
        "Rename one of them, or remove mcpCommand.",
    ),
    (
        "property-name-taken-global",
        "property-name-taken",
        "Command \"get\" declares argument \"path\" and global option \"path\", which one MCP tool lists under one name.",
        "Rename one of them, or remove mcpCommand.",
    ),
    (
        "required-input-excluded",
        "required-input-excluded",
        "Command \"get\" requires option \"file\" and excludes it from its MCP tool, which leaves every call without a value.",
        "Make the option optional, or remove exclude from its mcpInput value.",
    ),
    (
        "required-input-excluded-non-interactive",
        "required-input-excluded",
        "Command \"get\" requires option \"file\" and excludes it from its MCP tool, which leaves every call without a value.",
        "Make the option optional, or remove exclude from its mcpInput value.",
    ),
    (
        "required-input-excluded-content",
        "required-input-excluded",
        "Command \"get\" requires option \"file\" and excludes it from its MCP tool, which leaves every call without a value.",
        "Make the option optional, or remove exclude from its mcpInput value.",
    ),
    (
        "one-required-all-excluded",
        "required-input-excluded",
        "Command \"get\" requires one of options \"message\" and \"file\" and excludes every one from its MCP tool, which leaves every call without a value.",
        "Remove exclude from the mcpInput value of one of them.",
    ),
    (
        "together-some-excluded",
        "required-input-excluded",
        "Command \"get\" requires options \"message\" and \"file\" together and excludes \"file\" from its MCP tool, so a call that supplies the rest always fails.",
        "Exclude every option of the group from the tool, or none.",
    ),
    (
        "tool-without-action-root",
        "tool-without-action",
        "The root Command carries mcpCommand and registers no action.",
        "Remove mcpCommand, or opt in the Commands under it.",
    ),
];

/// The root opts in and declares no action: a separate type, so it is built apart.
fn root_without_action() -> Application<NoInputs, NoResult, loomcli_core::Group> {
    faulty().extend([opted()]).command(plain())
}

#[tokio::test]
async fn each_fault_fails_every_build_under_its_rule() {
    for (name, rule, sentence, correction) in FAULTS {
        let identity = format!("@loomcli/plugins/mcp/{rule}");
        let fault = if name == "tool-without-action-root" {
            root_without_action().inspect().map(|_| ())
        } else {
            inspected(name)
        }
        .expect_err(name);
        assert_eq!(
            fault.rule().map(|rule| rule.identity()),
            Some(identity.as_str()),
            "{name}"
        );
        assert_eq!(fault.sentence(), sentence, "{name}");
        assert_eq!(fault.correction(), [correction], "{name}");
        // A run that never serves a tool fails as the run that serves them does.
        for argv in [["plain"], ["mcp"]] {
            let (developed, distributed) = if name == "tool-without-action-root" {
                let application = root_without_action();
                (
                    run_group(&application, &argv, Build::Development).await,
                    run_group(&application, &argv, Build::Distributed).await,
                )
            } else {
                let application = scenario(name);
                (
                    run(&application, &argv, Build::Development).await,
                    run(&application, &argv, Build::Distributed).await,
                )
            };
            assert_eq!(
                developed,
                (1, String::new(), format!("{}\n", fault.message())),
                "{name} {argv:?}"
            );
            assert!(developed.2.contains(&identity), "{name}");
            assert!(developed.2.contains(sentence), "{name}");
            assert!(developed.2.contains(correction), "{name}");
            assert_eq!(
                distributed,
                (1, String::new(), "app: Something went wrong.\n".to_owned()),
                "{name} {argv:?}"
            );
        }
    }
}

/// The whole development-build diagnostic of one fault under each rule, headline and explanation
/// included, as the reference's rules render them.
#[tokio::test]
async fn each_rule_renders_its_headline_sentence_explanation_and_correction() {
    let expected = [
        (
            "tool-name-taken",
            "-- MCP TOOL NAME TAKEN -------------------- @loomcli/plugins/mcp/tool-name-taken\n\nCommands \"scratch create\" and \"scratch_create\" both serve the MCP tool \"scratch_create\".\n\nAn MCP client calls a tool by its name: the Command path joined with\nunderscores, or the application name for the root, with each hyphen written as\nan underscore. Two Commands that give one name leave the client no way to call\neither one.\n\nRename one Command, or remove mcpCommand from one of them.\n",
        ),
        (
            "property-name-taken",
            "-- MCP PROPERTY NAME TAKEN ------------ @loomcli/plugins/mcp/property-name-taken\n\nCommand \"get\" declares argument \"path\" and option \"path\", which one MCP tool lists under one name.\n\nAn MCP tool takes its arguments and options as one object keyed by declared\nname, so an argument and an option that share a name leave the client no way to\nsupply each one.\n\nRename one of them, or remove mcpCommand.\n",
        ),
        (
            "required-input-excluded-non-interactive",
            "-- REQUIRED MCP INPUT EXCLUDED ---- @loomcli/plugins/mcp/required-input-excluded\n\nCommand \"get\" requires option \"file\" and excludes it from its MCP tool, which leaves every call without a value.\n\nAn excluded option is off its Command's MCP tool, and a tool call reads no\nsource for it, so a required option that is excluded, a one-required group whose\nevery member is excluded, a required-together group that excludes some of its\nmembers, and a requirement that excludes an option it needs and not its option\nleave calls of the tool missing a value the Command needs.\n\nMake the option optional, or remove exclude from its mcpInput value.\n",
        ),
    ];
    for (name, stderr) in expected {
        assert_eq!(
            run(&scenario(name), &["mcp"], Build::Development).await,
            (1, String::new(), stderr.to_owned()),
            "{name}"
        );
    }
    assert_eq!(
        run_group(&root_without_action(), &["mcp"], Build::Development).await,
        (
            1,
            String::new(),
            "-- MCP TOOL WITHOUT AN ACTION --------- @loomcli/plugins/mcp/tool-without-action\n\nThe root Command carries mcpCommand and registers no action.\n\nAn MCP tool call runs the Command's action, so a Command with no action, such as\na group, has nothing to run when a client calls it.\n\nRemove mcpCommand, or opt in the Commands under it.\n".to_owned()
        )
    );
}

async fn run_group(
    application: &Application<NoInputs, NoResult, loomcli_core::Group>,
    argv: &[&str],
    build: Build,
) -> (u8, String, String) {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build)),
    );
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[test]
fn a_scenario_a_call_can_still_satisfy_raises_no_fault() {
    for name in [
        "optional-input-excluded",
        "one-required-some-excluded",
        "together-all-excluded",
    ] {
        assert!(inspected(name).is_ok(), "{name}");
    }
}

/// The message a declaring call panicked with.
fn panic_message(work: impl FnOnce()) -> String {
    let payload = catch_unwind(AssertUnwindSafe(work)).expect_err("the call panics");
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_owned())
        })
        .unwrap_or_default()
}

#[test]
fn an_mcp_input_value_that_holds_a_description_and_exclude_is_the_invalid_extension_value_fault() {
    // Rust's constructors build one key or the other; a value read from data can hold both.
    let both: McpInputFacts =
        serde_json::from_value(json!({ "description": "A file.", "exclude": true })).unwrap();
    let message = panic_message(|| {
        let _ = faulty()
            .command(
                Command::new("get")
                    .description("Get.")
                    .extend([opted()])
                    .option(
                        "file",
                        Opt::string()
                            .description("The file.")
                            .extend([MCP_INPUT.value(both)]),
                    )
                    .action(dispatch),
            )
            .action(dispatch);
    });
    assert!(
        message.contains("@loomcli/core/invalid-extension-value"),
        "{message}"
    );
    assert!(
        message.contains(
            "\n\nCommand \"get\" option \"file\" holds an invalid \"@loomcli/plugins/mcp/input\" value: Supply a description or exclude: true, never both, because an excluded option has no property to describe.\n\n"
        ),
        "{message}"
    );
}

#[test]
fn an_mcp_command_description_that_is_not_prose_is_the_invalid_extension_value_fault() {
    let message = panic_message(|| {
        let _ = Command::new("get")
            .extend([MCP_COMMAND.value(McpCommandFacts::new().description("One.\n\nThree."))]);
    });
    assert!(
        message.contains("@loomcli/core/invalid-extension-value"),
        "{message}"
    );
    assert!(
        message.contains("Supply prose whose every line holds a character other than whitespace."),
        "{message}"
    );
}

#[test]
fn a_terminal_command_cannot_be_served_as_an_mcp_tool() {
    let app = faulty().command(
        Command::new("top")
            .needs_terminal()
            .extend([opted()])
            .action(dispatch),
    );
    let fault = app
        .check()
        .into_iter()
        .next()
        .expect("the tool must be refused");
    assert_eq!(
        fault.rule().unwrap().identity(),
        "@loomcli/plugins/mcp/tool-needs-terminal"
    );
    assert_eq!(
        fault.sentence(),
        "Command \"top\" carries mcpCommand and needs a terminal, which no tool call has."
    );
    assert!(
        fault
            .message()
            .contains("Remove mcpCommand, or remove needs_terminal() from the Command.")
    );
}

#[test]
fn a_callable_root_can_declare_arguments_with_the_mcp_plugin_installed() {
    let app = faulty()
        .argument("file", Arg::string())
        .extend([opted()])
        .action(dispatch);
    assert!(app.inspect().is_ok());
}
