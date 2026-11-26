//! The sentences of the MCP plugin.

use loomcli_core::{escape_control_characters, nowrap};

/// Every path, name, agent, and line of agent output a sentence repeats, escaped as a failure
/// quotes text.
pub(super) fn shown(text: &str) -> String {
    escape_control_characters(text)
}

/// A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps.
fn shown_path(path: &str) -> String {
    nowrap(&shown(path))
}

/// A command line as its words joined by single spaces, each escaped.
fn shown_command(command: &[String]) -> String {
    command
        .iter()
        .map(|word| shown(word))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The two names a sentence uses: the application's, which starts its own commands, and the
/// registration's, which an agent knows the server by.
pub(super) struct Names<'a> {
    pub(super) app: &'a str,
    pub(super) registration: &'a str,
}

/// Which child a sentence names.
#[derive(Clone, Copy)]
pub(super) enum Child {
    Install,
    Uninstall,
}

impl Child {
    fn word(self) -> &'static str {
        match self {
            Child::Install => "install",
            Child::Uninstall => "uninstall",
        }
    }
}

/// The sentences of one failure, read as one message.
fn joined(sentences: &[String]) -> String {
    sentences.join(" ")
}

/// The call that failed, such as `claude mcp add`, and how it ended.
fn call_ended(agent: &str, verb: &str, code: Option<i32>) -> String {
    match code {
        None => format!("{agent} mcp {verb} could not start"),
        Some(code) => format!("{agent} mcp {verb} exited with code {code}"),
    }
}

/// An `add` that exited with a code or could not start.
pub(super) fn add_failed(names: &Names<'_>, agent: &str, code: Option<i32>) -> String {
    let app = shown(names.app);
    let registration = shown(names.registration);
    let correction = if agent == "claude" {
        format!(
            "If claude already has a server named {registration}, remove it with claude mcp remove {registration} -s user, or run {app} mcp install --force to replace it."
        )
    } else {
        format!("Fix what {agent} reported, then run {app} mcp install again.")
    };
    joined(&[
        format!(
            "{app} could not register with {agent}, because {}.",
            call_ended(agent, "add", code)
        ),
        correction,
    ])
}

/// An `--agent` that cannot start.
pub(super) fn agent_missing(name: &str, agent: &str) -> String {
    joined(&[
        format!(
            "{} mcp install cannot register with {agent}, because {agent} could not start.",
            shown(name)
        ),
        format!("Install {agent}, or leave out --agent."),
    ])
}

/// A name check that answered neither 0 nor 1, or could not start.
pub(super) fn cannot_tell(names: &Names<'_>, agent: &str, code: Option<i32>) -> String {
    let app = shown(names.app);
    joined(&[
        format!(
            "{app} cannot tell whether {agent} already has a server named {}, because {}.",
            shown(names.registration),
            call_ended(agent, "get", code)
        ),
        format!("Fix what {agent} reported, then run {app} mcp install again."),
    ])
}

/// A command line word that holds a control character.
pub(super) fn control_character(name: &str) -> String {
    let name = shown(name);
    joined(&[
        format!(
            "{name} cannot register its MCP server because its path holds a control character."
        ),
        format!("Install {name} where its path has none."),
    ])
}

/// A registration the record does not list, in the way without `--force`.
pub(super) fn in_the_way(names: &Names<'_>) -> String {
    let app = shown(names.app);
    joined(&[
        format!(
            "{app} mcp install changed nothing, because a registration it did not make is in the way."
        ),
        format!(
            "Remove it with codex mcp remove {}, or run {app} mcp install --force to replace it.",
            shown(names.registration)
        ),
    ])
}

/// No agent that starts.
pub(super) fn no_agent(name: &str) -> String {
    let name = shown(name);
    joined(&[
        format!(
            "{name} mcp install found no agent to register with, because neither claude nor codex could start."
        ),
        format!("Install one of them, then run {name} mcp install again."),
    ])
}

/// A child on `win32`.
pub(super) fn not_on_windows(name: &str, child: Child) -> String {
    let name = shown(name);
    joined(&[
        format!(
            "{name} mcp {} registers with claude and codex on Linux and macOS.",
            child.word()
        ),
        format!(
            "Print a client configuration with {name} mcp config and add it to your agent yourself."
        ),
    ])
}

/// A plugin's file the child cannot read.
pub(super) fn record(name: &str, record: &str, child: Child) -> String {
    let name = shown(name);
    joined(&[
        format!(
            "{} cannot be read, so {name} will not change the registration it lists.",
            shown_path(record)
        ),
        format!("Remove it, then run {name} mcp {} again.", child.word()),
    ])
}

/// The agents an uninstall could not start.
pub(super) fn uninstall_incomplete(names: &Names<'_>, agents: &[&str]) -> String {
    let app = shown(names.app);
    let configurations = agents
        .iter()
        .map(|agent| format!("{agent}'s"))
        .collect::<Vec<_>>()
        .join(" and ");
    joined(&[
        format!("{app} mcp uninstall could not remove every registration."),
        format!(
            "Make {} available and run {app} mcp uninstall again, or remove {} from {configurations} MCP configuration yourself.",
            agents.join(" and "),
            shown(names.registration)
        ),
    ])
}

/// Which build a note describes.
#[derive(Clone, Copy)]
pub(super) enum BuildNote {
    Development,
    Source,
}

/// The note of a build that is not distributed.
pub(super) fn build_note(name: &str, build: BuildNote) -> String {
    let name = shown(name);
    let kind = match build {
        BuildNote::Source => "a source build",
        BuildNote::Development => "a development build",
    };
    format!(
        "{name} is {kind}, so the registration runs it from this checkout. Run mcp install from an installed {name} to register that one instead."
    )
}

/// An agent that holds a name the record does not list.
pub(super) fn held_name(names: &Names<'_>, agent: &str) -> String {
    format!(
        "{agent} already has an MCP server named {}, which {} mcp install did not register.",
        shown(names.registration),
        shown(names.app)
    )
}

/// A removal the agent refused, whose record is gone.
pub(super) fn no_longer_recorded(names: &Names<'_>, agent: &str) -> String {
    format!(
        "{} is no longer recorded as registered with {agent}.",
        shown(names.registration)
    )
}

/// Nothing recorded to remove.
pub(super) fn nothing_to_remove(names: &Names<'_>, agent: Option<&str>) -> String {
    format!(
        "{} is not registered with {} by {} mcp install, so there is nothing to remove.",
        shown(names.registration),
        agent.unwrap_or("any agent"),
        shown(names.app)
    )
}

/// One registration made.
pub(super) fn registered(names: &Names<'_>, agent: &str, command: &[String]) -> String {
    format!(
        "Registered {} with {agent} to run {}.",
        shown(names.registration),
        shown_command(command)
    )
}

/// One registration removed.
pub(super) fn removed(names: &Names<'_>, agent: &str) -> String {
    format!("Removed {} from {agent}.", shown(names.registration))
}

/// A registration the record did not list, replaced under `--force`.
pub(super) fn replaced(names: &Names<'_>, agent: &str) -> String {
    format!(
        "Replaced the {} server {agent} had, which {} mcp install did not register.",
        shown(names.registration),
        shown(names.app)
    )
}

/// An agent skipped because it cannot start.
pub(super) fn skipped(agent: &str) -> String {
    format!("Skipped {agent}, because {agent} could not start.")
}

/// A recorded agent an uninstall could not start.
pub(super) fn stays_registered(names: &Names<'_>, agent: &str) -> String {
    format!(
        "{agent} could not start, so {} stays registered with it.",
        shown(names.registration)
    )
}

/// A tool call whose arguments are not an object.
pub(super) fn arguments_not_object(tool: &str) -> String {
    format!(
        "Tool \"{}\" arguments must be an object. Supply a JSON object of named inputs.",
        shown(tool)
    )
}

/// A tool call that sends a key the tool's input schema does not list.
pub(super) fn unlisted_argument(tool: &str, key: &str) -> String {
    format!(
        "Tool \"{}\" takes no argument \"{}\". Use a property its input schema lists.",
        shown(tool),
        shown(key)
    )
}

/// A tool call whose time zone metadata gives no IANA name the runtime knows.
pub(super) const INVALID_TIME_ZONE: &str = "Metadata key \"io.github.dbtlr.loomcli/timeZone\" requires an IANA time zone name this runtime knows. Use a name such as \"Asia/Tokyo\".";

/// A tool call that names no tool the server serves.
pub(super) fn unknown_tool(tool: &str) -> String {
    format!(
        "Unknown tool \"{}\". Call tools/list for the tool names.",
        shown(tool)
    )
}

/// The build fault for a tool opt-in on a Command that needs a terminal.
pub(super) fn tool_needs_terminal(path: &[String]) -> String {
    let command = if path.is_empty() {
        "The root Command".to_owned()
    } else {
        format!("Command \"{}\"", shown_command(path))
    };
    format!("{command} carries mcpCommand and needs a terminal, which no tool call has.")
}
