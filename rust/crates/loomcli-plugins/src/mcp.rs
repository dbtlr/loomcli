//! The MCP plugin: serves the application's opted-in Commands as tools of a Model Context Protocol
//! server, over stdio or, with `mcp --http <address>`, over the protocol's streamable HTTP
//! transport, and registers that server with coding agents.
//!
//! [`mcp()`] contributes the `mcp` Command, whose action serves every Command carrying an
//! [`MCP_COMMAND`](extension::MCP_COMMAND) value as one tool, each call run through `invoke`; its
//! three children, `install` and `uninstall`, which register the server with Claude Code and Codex
//! through each agent's own CLI and record each registration in the installation record, and
//! `config`, which prints a client configuration; the three extensions; and an `on_graph_built`
//! hook that rejects a graph whose tools cannot be served:
//!
//! - **Names.** A tool's name is the Command's path joined by `_`, each `-` written as `_`, and
//!   the application name at the root.
//! - **Schemas.** A tool's input schema lists the routed Command's arguments, then its local
//!   options, then every global option, minus hidden, control, and excluded options, each the
//!   input's published schema or one derived from its kind.
//! - **Calls.** A call runs `invoke` with the options the tool excludes, the first
//!   `application/json` view, the call's own cancellation, and a progress observer when the client
//!   sent a progress token. Its output and messages answer as text, a JSON view's output also as
//!   structured content, and a failure as `{ exitCode, failure }` with its failure form.
//!
//! The protocol itself lives in `loomcli-mcp`, which knows nothing of core; this plugin supplies
//! its tool source.

#[cfg(feature = "mcp-extension")]
pub mod extension;

#[cfg(feature = "mcp")]
mod address;
#[cfg(feature = "mcp")]
mod faults;
#[cfg(feature = "mcp")]
mod install;
#[cfg(feature = "mcp")]
mod messages;
#[cfg(feature = "mcp")]
mod progress;
#[cfg(feature = "mcp")]
mod registration;
#[cfg(feature = "mcp")]
mod serve;
#[cfg(feature = "mcp")]
mod serve_http;
#[cfg(feature = "mcp")]
mod settings;
#[cfg(feature = "mcp")]
mod tools;
#[cfg(feature = "mcp")]
mod uninstall;

#[cfg(feature = "mcp")]
pub use plugin::mcp;
#[cfg(feature = "mcp")]
pub use settings::{IntoAuthorization, Mcp, McpHttpRequest, RequestHeaders};

#[cfg(feature = "mcp")]
mod plugin {
    use loomcli_core::{AnyPlugin, Command, Context, Inputs, Plugin, View};
    use loomcli_validators::one_of;

    use super::address::{HttpAddress, HttpAddressInput};
    use super::extension::{MCP_ARGUMENT, MCP_COMMAND, MCP_INPUT};
    use super::faults::judge_tools;
    use super::install::{InstallRequest, install_registrations};
    use super::registration::{AGENT_NAMES, Agent, ChildRun, command_line, registration_name};
    use super::serve::serve;
    use super::settings::{Mcp, McpSettings};
    use super::uninstall::uninstall_registrations;
    use crate::PACKAGE_NAME;

    /// The options of `mcp install`.
    #[derive(Inputs)]
    struct InstallInputs {
        /// The agent to register with: claude or codex. Every agent that starts when left out.
        #[option(validate = one_of(AGENT_NAMES))]
        agent: Option<String>,
        /// Replace a registration of this name that mcp install did not make.
        #[option]
        force: bool,
    }

    /// The options of `mcp uninstall`.
    #[derive(Inputs)]
    struct UninstallInputs {
        /// The agent to remove it from: claude or codex. Every agent it is registered with when
        /// left out.
        #[option(validate = one_of(AGENT_NAMES))]
        agent: Option<String>,
    }

    /// The options of `mcp`.
    #[derive(Inputs)]
    pub(in crate::mcp) struct ServeInputs {
        /// Serve over HTTP at this address instead of stdin and stdout: a port, or host:port. A
        /// port alone listens on 127.0.0.1, and port 0 takes any free port.
        #[option(control, validate = HttpAddressInput)]
        pub(in crate::mcp) http: Option<HttpAddress>,
    }

    /// The text as it is, with no markup resolved and no newline added, because another program
    /// reads these bytes: an MCP client reads a configuration. It renders through `out`, so a
    /// reader that closes stdout ends the run as it does any write.
    pub(in crate::mcp) fn exact_text() -> View<String> {
        View::new(|text: &String, context| context.style.escape(text))
    }

    /// The configuration's bytes: an `mcpServers` object with this application's server, two
    /// spaces of indent, and a line feed.
    fn client_configuration(name: &str, command: &[String]) -> String {
        let (program, args) = command
            .split_first()
            .map_or(("", &[][..]), |(first, rest)| (first.as_str(), rest));
        let mut server = serde_json::Map::new();
        server.insert("command".into(), program.into());
        server.insert("args".into(), args.to_vec().into());
        let mut servers = serde_json::Map::new();
        servers.insert(registration_name(name), server.into());
        let mut configuration = serde_json::Map::new();
        configuration.insert("mcpServers".into(), servers.into());
        let text = serde_json::to_string_pretty(&serde_json::Value::Object(configuration))
            .unwrap_or_default();
        format!("{text}\n")
    }

    fn install_command() -> Command<InstallInputs> {
        Command::new("install")
            .description("Register this application's MCP server with your coding agents.")
            .inputs::<InstallInputs>()
            .action(|context: Context<InstallInputs>| async move {
                let name = context.graph.name.clone();
                let run = ChildRun::new(
                    &name,
                    &context.host,
                    &context.signal,
                    &context.out,
                    &context.log,
                );
                let request = InstallRequest {
                    agent: context.inputs.agent.as_deref().and_then(Agent::named),
                    force: context.inputs.force,
                };
                install_registrations(&run, &request).await
            })
    }

    fn uninstall_command() -> Command<UninstallInputs> {
        Command::new("uninstall")
            .description("Remove this application's MCP server from your coding agents.")
            .inputs::<UninstallInputs>()
            .action(|context: Context<UninstallInputs>| async move {
                let name = context.graph.name.clone();
                let run = ChildRun::new(
                    &name,
                    &context.host,
                    &context.signal,
                    &context.out,
                    &context.log,
                );
                let agent = context.inputs.agent.as_deref().and_then(Agent::named);
                uninstall_registrations(&run, agent).await
            })
    }

    fn config_command() -> Command {
        Command::new("config")
            .description("Print a client configuration that starts this application's MCP server.")
            .action(|context: Context| async move {
                let text = client_configuration(&context.graph.name, &command_line(&context.host));
                context.out.render(&text, &exact_text()).await
            })
    }

    /// The `mcp` Command: it serves the tools, over stdio or with `--http` over HTTP, and its
    /// children install, uninstall, and print a configuration.
    fn mcp_command(settings: McpSettings) -> Command<ServeInputs> {
        Command::new("mcp")
            .description(
                "Serve this application's tools to an MCP client, over stdin and stdout or, with --http, over HTTP.",
            )
            .inputs::<ServeInputs>()
            .command(install_command())
            .command(uninstall_command())
            .command(config_command())
            .action(move |context: Context<ServeInputs>| serve(context, settings.clone()))
    }

    /// A plugin that serves every Command carrying an `MCP_COMMAND` value as one tool of a Model
    /// Context Protocol server, over stdio or, with `mcp --http <address>`, over the protocol's
    /// streamable HTTP transport, each call run through `invoke`. It contributes the `mcp`
    /// Command and its three children, `install` and `uninstall`, which register the server with
    /// Claude Code and Codex and record each registration, and `config`; the three extensions;
    /// and a hook that rejects a graph whose tools cannot be served. Its identity is
    /// `@loomcli/plugins/mcp`. Its settings, set on the [`Mcp`] it returns, shape the HTTP server
    /// alone.
    ///
    /// A root that declares arguments cannot hold children, so such an application cannot install
    /// the plugin.
    pub fn mcp() -> Mcp {
        Mcp {
            settings: McpSettings::default(),
        }
    }

    impl Mcp {
        fn plugin(self) -> Plugin {
            Plugin::new(format!("{PACKAGE_NAME}/mcp"))
                .commands([mcp_command(self.settings)])
                .extensions((MCP_COMMAND, MCP_INPUT, MCP_ARGUMENT))
                .on_graph_built(judge_tools)
        }
    }

    impl From<Mcp> for AnyPlugin {
        fn from(settings: Mcp) -> Self {
            settings.plugin().into()
        }
    }
}
