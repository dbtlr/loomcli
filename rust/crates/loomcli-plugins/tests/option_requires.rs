//! Help, man pages, manifests, completion, and MCP use the same one-way requirements.

#![cfg(all(
    feature = "help",
    feature = "manifest",
    feature = "manpage",
    feature = "completion",
    feature = "mcp"
))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;
mod mcp_support;

use help_support::{dispatch, run};
use loomcli_core::{
    Application, Command, CommandTarget, Done, Extension, ExtensionValue, FailureFacts, Group,
    NoInputs, NoResult, Opt, OptionTarget, Polarity,
};
use loomcli_plugins::completion::completion;
use loomcli_plugins::help::help;
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::manpage::test_support::man_pages;
use loomcli_plugins::mcp::extension::{MCP_COMMAND, MCP_INPUT, McpCommandFacts, McpInputFacts};
use loomcli_plugins::mcp::mcp;
use mcp_support::{tool_named, tools_of};
use serde_json::{Value, json};

// This identity is a completion hint in the reference. The Rust completion plugin has no
// public descriptor for these hints, so the fixture declares the reference's extension value.
const COMPLETION_INPUT: Extension<OptionTarget, Value> =
    Extension::new("@loomcli/plugins/completion/input");

fn opted() -> ExtensionValue<CommandTarget> {
    MCP_COMMAND.value(McpCommandFacts::new())
}

fn excluded() -> ExtensionValue<OptionTarget> {
    MCP_INPUT.value(McpInputFacts::excluded())
}

fn application() -> Application<NoInputs, NoResult, Group> {
    Application::new("app")
        .plugins((help(), manifest(), completion(), mcp()))
        .description("Sign in to servers.")
        .command(
            Command::new("login")
                .description("Sign in.")
                .option("user", Opt::string().description("The account name."))
                .option("password", Opt::string().description("The password."))
                .option(
                    "host",
                    Opt::string()
                        .description("The server.")
                        .extend([COMPLETION_INPUT.value(json!({"none": true}))]),
                )
                .option(
                    "pretty",
                    Opt::boolean()
                        .description("Pretty output.")
                        .polarity(Polarity::Both),
                )
                .option("format", Opt::string().description("The format."))
                .option(
                    "wide",
                    Opt::boolean()
                        .description("Wide output.")
                        .polarity(Polarity::Both),
                )
                .option("files", Opt::string().description("The files.").multiple())
                .option(
                    "secret",
                    Opt::string().description("A hidden setting.").hidden(),
                )
                .option(
                    "trace",
                    Opt::string()
                        .description("Trace the run.")
                        .extend([excluded()]),
                )
                .requires("password", &["user", "host"])
                .requires("pretty", &["format"])
                .requires("format", &["wide"])
                .requires("files", &["user"])
                .requires("secret", &["user"])
                .requires("trace", &["user"])
                .extend([opted()])
                .action(dispatch),
        )
}

const SENTENCES: [&str; 5] = [
    "Use --password only with --user and --host.",
    "Use --pretty only with --format.",
    "Use --format only with --wide.",
    "Use --files only with --user.",
    "Use --trace only with --user.",
];

#[tokio::test]
async fn help_prints_each_visible_requirement_in_declaration_order() {
    let page = run(&application(), &["login", "--help"]).await;
    assert_eq!((page.status, page.stderr.as_str()), (0, ""));
    assert_eq!(
        page.stdout
            .lines()
            .filter(|line| line.contains(" only with "))
            .collect::<Vec<_>>(),
        SENTENCES.map(|sentence| format!("  {sentence}"))
    );
    assert!(!page.stdout.contains("--secret"));
}

fn login_page<I, R, S: loomcli_core::State>(app: &Application<I, R, S>) -> String {
    man_pages(&app.inspect().unwrap())
        .unwrap()
        .into_iter()
        .find(|page| page.file == "app-login.1")
        .unwrap()
        .text
}

#[test]
fn man_page_puts_visible_requirements_after_the_option_entries() {
    let page = login_page(&application());
    let lines: Vec<_> = page.lines().collect();
    let first = lines
        .iter()
        .position(|line| *line == r"Use \-\-password only with \-\-user and \-\-host.")
        .unwrap();
    let expected: Vec<_> = SENTENCES
        .into_iter()
        .flat_map(|sentence| [".PP".to_owned(), sentence.replace('-', r"\-")])
        .collect();
    assert_eq!(lines[first - 1..first - 1 + expected.len()], expected);
    assert_eq!(
        lines[..first].iter().rfind(|line| line.starts_with(".SH")),
        Some(&r#".SH "OPTIONS""#)
    );
    assert!(!page.contains("secret"));
}

#[tokio::test]
async fn manifest_keeps_the_graph_shape_without_hidden_members() {
    let app = application();
    let graph = app.inspect().unwrap();
    let command = graph.command(&["login"]).unwrap();
    assert_eq!(
        serde_json::to_value(&command.option_groups[4]).unwrap(),
        json!({"kind":"requires","option":"secret","requires":["user"]})
    );
    let manifest = run(&app, &["login", "--manifest"]).await;
    assert_eq!((manifest.status, manifest.stderr.as_str()), (0, ""));
    let document: Value = serde_json::from_str(&manifest.stdout).unwrap();
    assert_eq!(
        document["command"]["optionGroups"],
        json!([
            {"kind":"requires","option":"password","requires":["user","host"]},
            {"kind":"requires","option":"pretty","requires":["format"]},
            {"kind":"requires","option":"format","requires":["wide"]},
            {"kind":"requires","option":"files","requires":["user"]},
            {"kind":"requires","option":"trace","requires":["user"]},
        ])
    );
}

#[tokio::test]
async fn completion_keeps_offering_needed_options() {
    let offered = run(
        &application(),
        &[
            "completion",
            "__complete",
            "--",
            "login",
            "--password",
            "secret",
            "--",
        ],
    )
    .await;
    assert_eq!((offered.status, offered.stderr.as_str()), (0, ""));
    for spelling in ["--user", "--host", "--pretty", "--format", "--wide"] {
        assert!(
            offered.stdout.contains(&format!("{spelling}\t")),
            "{}",
            offered.stdout
        );
    }
}

#[tokio::test]
async fn mcp_projects_requirements_with_sound_named_value_predicates() {
    let tools = tools_of(&application()).await;
    let schema = &tool_named(&tools, "login").unwrap()["inputSchema"];
    assert_eq!(
        schema["allOf"],
        json!([
            { "dependentRequired": { "password": ["user", "host"] } },
            { "anyOf": [
                { "not": { "properties": { "pretty": { "const": true } }, "required": ["pretty"] } },
                { "allOf": [{ "required": ["format"] }] },
            ] },
            { "dependentRequired": { "format": ["wide"] } },
            { "anyOf": [
                { "not": { "required": ["files"], "properties": { "files": { "minItems": 1 } } } },
                { "allOf": [{ "required": ["user"] }] },
            ] },
        ])
    );
}

type Tool = Command<NoInputs, NoResult, Done>;

fn tool(command: Command<NoInputs, NoResult, loomcli_core::Fresh>) -> Tool {
    command.extend([opted()]).action(dispatch)
}

fn login_tool(
    name: &str,
    trigger: impl Into<loomcli_core::OptionDecl>,
    needed: impl Into<loomcli_core::OptionDecl>,
) -> Tool {
    tool(
        Command::new(name)
            .option("password", trigger)
            .option("user", needed)
            .requires("password", &["user"]),
    )
}

#[test]
fn mcp_rejects_the_first_excluded_dependency_even_for_a_hidden_trigger() {
    for hidden in [false, true] {
        let trigger = if hidden {
            Opt::string().hidden()
        } else {
            Opt::string()
        };
        let broken = Application::new("app").plugins([mcp()]).command(tool(
            Command::new("login")
                .option("user", Opt::string().extend([excluded()]))
                .option("host", Opt::string().extend([excluded()]))
                .option("password", trigger)
                .requires("password", &["host", "user"]),
        ));
        let fault = broken.inspect().err().unwrap();
        let message = fault.message();
        assert!(
            message.contains("@loomcli/plugins/mcp/required-input-excluded"),
            "{message}"
        );
        assert!(message.contains("Command \"login\" makes option \"password\" require options \"host\" and \"user\" and excludes \"host\" from its MCP tool, so a call that supplies \"password\" always fails."), "{message}");
        assert!(message.contains("Exclude \"password\" from the tool as well, or remove exclude from the mcpInput value of \"host\"."), "{message}");
    }
}

#[tokio::test]
async fn mcp_uses_value_predicates_for_needed_boolean_list_and_count() {
    let app = Application::new("app")
        .plugins([mcp()])
        .command(login_tool("boolean", Opt::string(), Opt::boolean()))
        .command(login_tool(
            "multiple",
            Opt::string(),
            Opt::string().multiple(),
        ))
        .command(login_tool("counted", Opt::string(), Opt::count()));
    let tools = tools_of(&app).await;
    for (name, predicate) in [
        ("boolean", json!({"const":true})),
        ("multiple", json!({"minItems":1})),
        ("counted", json!({"minimum":1})),
    ] {
        assert_eq!(
            tool_named(&tools, name).unwrap()["inputSchema"]["allOf"],
            json!([
                { "anyOf": [
                    { "not": { "required": ["password"] } },
                    { "allOf": [{ "required": ["user"], "properties": { "user": predicate } }] },
                ] }
            ])
        );
    }
}

#[tokio::test]
async fn mcp_omits_requirements_with_an_environment_binding_on_either_side() {
    let app = Application::new("app")
        .plugins([mcp()])
        .command(login_tool(
            "envoption",
            Opt::string().env(["APP_PASSWORD"]),
            Opt::string(),
        ))
        .command(login_tool(
            "envneeded",
            Opt::string(),
            Opt::string().env(["APP_USER"]),
        ));
    let tools = tools_of(&app).await;
    for name in ["envoption", "envneeded"] {
        assert!(
            tool_named(&tools, name).unwrap()["inputSchema"]
                .get("allOf")
                .is_none()
        );
    }
}

#[tokio::test]
async fn mcp_leaves_a_requirement_with_a_hidden_needed_option_to_the_run() {
    let app = Application::new("app").plugins([mcp()]).command(login_tool(
        "hiddenneeded",
        Opt::string(),
        Opt::string().hidden(),
    ));
    let tools = tools_of(&app).await;
    assert!(
        tool_named(&tools, "hiddenneeded").unwrap()["inputSchema"]
            .get("allOf")
            .is_none()
    );
}

#[test]
fn mcp_allows_excluding_both_sides_of_a_requirement() {
    let app = Application::new("app").plugins([mcp()]).command(login_tool(
        "login",
        Opt::string().extend([excluded()]),
        Opt::string().extend([excluded()]),
    ));
    assert!(app.inspect().is_ok());
}

#[tokio::test]
async fn listings_omit_a_requirement_when_a_needed_option_is_hidden() {
    let app = Application::new("app")
        .plugins((help(), manifest()))
        .command(
            Command::new("login")
                .option("user", Opt::string())
                .option("password", Opt::string())
                .option("host", Opt::string())
                .option("secret", Opt::string().hidden())
                .requires("password", &["secret"])
                .requires("host", &["user"])
                .action(dispatch),
        );
    let help = run(&app, &["login", "--help"]).await;
    assert_eq!(
        help.stdout
            .lines()
            .filter(|line| line.contains(" only with "))
            .collect::<Vec<_>>(),
        ["  Use --host only with --user."]
    );
    assert_eq!(
        login_page(&app)
            .lines()
            .filter(|line| line.contains(" only with "))
            .collect::<Vec<_>>(),
        [r"Use \-\-host only with \-\-user."]
    );
    let manifest = run(&app, &["login", "--manifest"]).await;
    let document: Value = serde_json::from_str(&manifest.stdout).unwrap();
    assert_eq!(
        document["command"]["optionGroups"],
        json!([
            {"kind":"requires","option":"host","requires":["user"]}
        ])
    );
}
