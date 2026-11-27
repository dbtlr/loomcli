//! `mcp --http`, ported from the reference's `mcp-http.test.ts`. A fixture application installs
//! `mcp()` with the settings a test names and the verbose plugin, runs `served mcp --http
//! <address>` on the mock process, reads the URL line from its stdout, and drives the server from
//! the test on 127.0.0.1. The address forms, the warnings, and the URL host of an unspecified
//! address are proven on the functions that choose them, in the plugin's unit tests, because a
//! test binds nothing but 127.0.0.1.

// The fixture installs the verbose plugin, so the file compiles with its feature.
#![cfg(all(feature = "mcp", feature = "verbose"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

#[path = "../../loomcli-mcp/tests/http_support/client.rs"]
mod http_client;
mod mcp_support;

use std::fmt;

use http_client::{
    EventStream, Sent, in_session, initialize, meta, mirrored, open, per_request, send, status_of,
};
use loomcli_core::{
    Application, Arg, Build, Command, Context, Error, NoInputs, NoResult, Opt, ProcessSignal,
    State, Validator,
};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpCommandFacts};
use loomcli_plugins::mcp::{Mcp, McpHttpRequest, mcp};
use loomcli_plugins::verbose::verbose;
use loomcli_prompts::{ProgressSettings, ProgressUpdate, progress};
use loomcli_validators::{DateTime, date_time};
use mcp_support::{Launch, Observed, Session, launch};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, loomcli_core::Group>;

fn opted() -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    MCP_COMMAND.value(McpCommandFacts::new())
}

/// The error the fixture's failing hook returns, as the reference's hook throws a `TypeError`.
#[derive(Debug)]
struct TypeError;

impl fmt::Display for TypeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("token.trim is not a function")
    }
}

impl std::error::Error for TypeError {}

/// The authorize hook a test names: one that wants the bearer token `sesame`, or one that fails.
#[derive(Clone, Copy)]
enum Hook {
    None,
    Token,
    Fail,
}

fn settings(hook: Hook, max_body: Option<u64>) -> Mcp {
    let plugin = match hook {
        Hook::None => mcp(),
        Hook::Token => mcp().authorize(|request: McpHttpRequest| async move {
            request.headers.get("authorization").as_deref() == Some("Bearer sesame")
        }),
        Hook::Fail => {
            mcp().authorize(|_: McpHttpRequest| async move { Err::<bool, Error>(TypeError.into()) })
        }
    };
    match max_body {
        Some(limit) => plugin.max_body_bytes(limit),
        None => plugin,
    }
}

/// Tools served over HTTP: one that echoes, one that waits for its signal, and one with a
/// progress line, beside a Command that needs a terminal and never opts in, with the verbose
/// plugin for -v.
fn served(observed: &Observed, plugin: Mcp, described: bool) -> App {
    let echo = Command::new("echo")
        .description("Echo the word.")
        .extend([opted()])
        .argument("word", Arg::string().description("A word.").required())
        .action(|ctx: Context| async move {
            let word: Option<String> = ctx.argument("word")?;
            ctx.out.print(&word.unwrap_or_default()).await
        });
    let observed = observed.clone();
    let wait = Command::new("wait")
        .description("Wait for the abort.")
        .extend([opted()])
        .argument(
            "label",
            Arg::string().description("The label to report.").required(),
        )
        .action(move |ctx: Context| {
            let observed = observed.clone();
            async move {
                let label: Option<String> = ctx.argument("label")?;
                let label = label.unwrap_or_default();
                observed.report(format!("started {label}"));
                ctx.signal.cancelled().await;
                observed.report(format!("aborted {label}"));
                Ok(())
            }
        });
    let counted = Command::new("counted")
        .description("Count two records.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            let line = progress(&ctx, ProgressSettings::new("Fetching records").total(2.0));
            line.update(ProgressUpdate::new().completed(1.0));
            line.end().await
        });
    let top = Command::new("top")
        .description("A live view.")
        .needs_terminal()
        .action(|_: Context| async move { Ok(()) });
    let app = Application::new("served")
        .plugins((plugin, verbose()))
        .version("3.0.0");
    let app = if described {
        app.description("Serve over HTTP.")
    } else {
        app
    };
    app.command(echo)
        .command(wait)
        .command(counted)
        .command(top)
}

fn words(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| (*word).to_owned()).collect()
}

/// A served process, its caller's signal, and the port its URL line names.
struct Launched {
    session: Session,
    caller: CancellationToken,
}

impl Launched {
    fn start<S: State>(
        app: &Application<NoInputs, NoResult, S>,
        argv: &[&str],
        build: Build,
    ) -> Self {
        let caller = CancellationToken::new();
        let session = launch(
            app,
            Launch {
                argv: words(argv),
                build,
                signal: Some(caller.clone()),
                ..Launch::default()
            },
        );
        Self { session, caller }
    }

    /// The port the URL line names, once the server wrote it.
    async fn port(&mut self) -> u16 {
        let line = self.session.next_line().await;
        let port = line
            .strip_prefix("http://")
            .and_then(|rest| rest.strip_suffix("/mcp"))
            .and_then(|host_port| host_port.rsplit_once(':'))
            .and_then(|(_, port)| port.parse().ok());
        port.unwrap_or_else(|| panic!("The server wrote no URL line. It wrote: {line:?}"))
    }

    /// Stops the server through its caller's signal and answers how it ended.
    async fn stop(self) -> mcp_support::Ending {
        self.caller.cancel();
        self.session.finish().await
    }
}

fn app(hook: Hook) -> App {
    served(&Observed::default(), settings(hook, None), false)
}

// Starting the server.

#[tokio::test]
async fn writes_the_url_line_with_the_port_it_took_as_stdouts_one_line_and_no_warning_on_loopback()
{
    let mut server = Launched::start(
        &app(Hook::None),
        &["mcp", "--http", "0"],
        Build::Distributed,
    );
    let port = server.port().await;
    assert!(port > 0);
    assert_eq!(
        status_of(port, &per_request(1, "tools/list", json!({}))).await,
        200
    );
    let ending = server.stop().await;
    assert!(ending.messages.is_empty());
    assert_eq!((ending.status, ending.stderr.as_str()), (130, ""));
}

#[tokio::test]
async fn binds_the_host_the_operator_names_and_the_end_of_stdin_does_not_stop_it() {
    let mut server = Launched::start(
        &app(Hook::None),
        &["mcp", "--http", "127.0.0.1:0"],
        Build::Distributed,
    );
    let port = server.port().await;
    server.session.end_stdin();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(
        status_of(port, &per_request(1, "server/discover", json!({}))).await,
        200
    );
    assert_eq!(server.stop().await.status, 130);
}

#[tokio::test]
async fn refuses_each_value_outside_the_accepted_forms_with_the_usage_error() {
    for value in [
        ":8080",
        "::1:8080",
        "70000",
        "http://127.0.0.1:8080",
        "127.0.0.1:8080/mcp",
        "[127.0.0.1]:80",
        "host:",
    ] {
        let server = Launched::start(
            &app(Hook::None),
            &["mcp", "--http", value],
            Build::Distributed,
        );
        let ending = server.session.finish().await;
        assert_eq!(ending.status, 2, "{value}");
        assert!(
            ending.stderr.contains(
                "Supply a port, such as 8080, or host:port, such as 127.0.0.1:8080 or [::1]:8080."
            ),
            "{value}: {}",
            ending.stderr
        );
        assert!(ending.messages.is_empty(), "{value}");
    }
}

#[tokio::test]
async fn fails_with_exit_1_and_names_the_address_and_the_step_when_another_program_holds_the_port()
{
    let holder = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = holder.local_addr().unwrap().port();
    let address = format!("127.0.0.1:{port}");
    let server = Launched::start(
        &app(Hook::None),
        &["mcp", "--http", &address],
        Build::Distributed,
    );
    let ending = server.session.finish().await;
    assert_eq!(ending.status, 1);
    assert_eq!(
        ending.stderr,
        format!(
            "served mcp cannot serve at 127.0.0.1:{port}, because another program is using that port. Run it with another port, or with 0 to take any free port.\n"
        )
    );
    assert!(ending.messages.is_empty());
}

/// A global option named `http` collides with `mcp --http`. The reference fails the graph build;
/// Rust raises the same rule, `@loomcli/core/option-declared-twice`, at the declaration, under
/// the declaration-fault deviation; the authoring order installs plugins before globals.
#[test]
#[should_panic(
    expected = "Option \"http\" is declared as a global option and as a local option on Command \"mcp\"."
)]
fn a_global_option_named_http_fails_the_graph() {
    let _ = Application::new("served")
        .plugins([mcp()])
        .version("3.0.0")
        .global_option("http", Opt::string().description("An HTTP proxy."));
}

// Requests.

#[tokio::test]
async fn refuses_an_origin_with_403_and_writes_its_v_line() {
    let mut server = Launched::start(
        &app(Hook::None),
        &["-v", "mcp", "--http", "0"],
        Build::Distributed,
    );
    let port = server.port().await;
    let mut sent = per_request(1, "tools/list", json!({}));
    sent.headers
        .push(("Origin".into(), "https://evil.example".into()));
    assert_eq!(send(port, &sent).await.status, 403);
    let ending = server.stop().await;
    assert!(
        ending.stderr.contains(
            "Refused a request from origin https://evil.example, because this server answers no browser request."
        ),
        "{}",
        ending.stderr
    );
}

#[tokio::test]
async fn answers_the_hooks_false_with_401_and_its_v_line_and_serves_what_it_allows() {
    let mut server = Launched::start(
        &app(Hook::Token),
        &["-v", "mcp", "--http", "0"],
        Build::Distributed,
    );
    let port = server.port().await;
    let refused = send(port, &per_request(1, "tools/list", json!({}))).await;
    let mut allowed = per_request(2, "tools/list", json!({}));
    allowed
        .headers
        .push(("Authorization".into(), "Bearer sesame".into()));
    let allowed = send(port, &allowed).await;
    assert_eq!(
        (
            refused.status,
            refused.header("www-authenticate").as_deref(),
            allowed.status
        ),
        (401, Some("Bearer"), 200)
    );
    let ending = server.stop().await;
    assert!(
        ending
            .stderr
            .contains("Refused a request the authorize hook did not allow."),
        "{}",
        ending.stderr
    );
}

#[tokio::test]
async fn answers_each_failure_of_the_hook_with_500_keeps_serving_and_reports_the_first_once_when_it_stops()
 {
    let mut server = Launched::start(
        &app(Hook::Fail),
        &["-v", "mcp", "--http", "0"],
        Build::Distributed,
    );
    let port = server.port().await;
    let first = send(port, &per_request(1, "tools/list", json!({}))).await;
    let second = send(port, &per_request(2, "tools/list", json!({}))).await;
    assert_eq!(first.status, 500);
    assert_eq!(first.json()["error"]["code"], -32_603);
    assert_eq!(second.status, 500);
    let ending = server.stop().await;
    assert_eq!(ending.status, 130);
    let stderr = ending.stderr;
    let threw = "› The authorize hook threw, so the request was answered 500. error=mcp_http::TypeError: token.trim is not a function\n";
    assert_eq!(
        stderr,
        format!("{threw}{threw}served: Something went wrong.\n")
    );
    assert_eq!(
        stderr
            .matches("The authorize hook threw, so the request was answered 500.")
            .count(),
        2,
        "{stderr}"
    );
    assert!(stderr.contains("token.trim is not a function"), "{stderr}");
    assert_eq!(
        stderr.matches("Something went wrong.").count(),
        1,
        "{stderr}"
    );
}

#[tokio::test]
async fn reports_the_failure_as_its_developer_diagnostic_in_a_development_build() {
    let mut server = Launched::start(
        &app(Hook::Fail),
        &["mcp", "--http", "0"],
        Build::Development,
    );
    let port = server.port().await;
    assert_eq!(
        status_of(port, &per_request(1, "tools/list", json!({}))).await,
        500
    );
    let ending = server.stop().await;
    assert_eq!(ending.status, 130);
    assert!(
        ending
            .stderr
            .contains("@loomcli/plugins/mcp/broken-authorize-hook"),
        "{}",
        ending.stderr
    );
    assert!(
        ending.stderr.contains(
            "The authorize hook given to mcp() threw while it judged a request, so the server answered that request with 500."
        ),
        "{}",
        ending.stderr
    );
}

#[tokio::test]
async fn answers_a_body_past_max_body_bytes_with_413() {
    let app = served(&Observed::default(), settings(Hook::None, Some(64)), false);
    let mut server = Launched::start(&app, &["mcp", "--http", "0"], Build::Distributed);
    let port = server.port().await;
    let answer = send(
        port,
        &per_request(
            1,
            "tools/call",
            json!({ "arguments": { "word": "x".repeat(100) }, "name": "echo" }),
        ),
    )
    .await;
    assert_eq!(
        (answer.status, answer.json()["error"]["code"].clone()),
        (413, json!(-32_600))
    );
    server.stop().await;
}

// Tools over HTTP.

#[tokio::test]
async fn lists_the_opted_in_commands_alone_with_no_needs_terminal_command_and_no_http_property() {
    let mut server = Launched::start(
        &app(Hook::None),
        &["mcp", "--http", "0"],
        Build::Distributed,
    );
    let port = server.port().await;
    let listed = send(port, &per_request(1, "tools/list", json!({})))
        .await
        .json();
    let tools = listed["result"]["tools"].as_array().unwrap().clone();
    let names: Vec<&str> = tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["echo", "wait", "counted"]);
    for tool in &tools {
        assert!(
            tool["inputSchema"]["properties"].get("http").is_none(),
            "{tool}"
        );
    }
    let top = send(
        port,
        &per_request(2, "tools/call", json!({ "arguments": {}, "name": "top" })),
    )
    .await;
    assert!(
        top.text
            .contains(r#"Unknown tool \"top\". Call tools/list for the tool names."#),
        "{}",
        top.text
    );
    server.stop().await;
}

#[tokio::test]
async fn streams_a_calls_progress_then_its_result() {
    let mut server = Launched::start(
        &app(Hook::None),
        &["mcp", "--http", "0"],
        Build::Distributed,
    );
    let port = server.port().await;
    let mut progress_meta = meta();
    progress_meta["progressToken"] = json!("t");
    let mut sent = Sent::json(json!({
        "id": 1, "jsonrpc": "2.0", "method": "tools/call",
        "params": { "_meta": progress_meta, "arguments": {}, "name": "counted" },
    }));
    sent.headers = mirrored("tools/call", Some("counted"));
    let stream = EventStream::new(open(port, &sent).await);
    stream.ended().await;
    let seen: Vec<Value> = stream
        .events()
        .iter()
        .map(|message| {
            message["params"]
                .get("message")
                .cloned()
                .unwrap_or_else(|| message["id"].clone())
        })
        .collect();
    assert_eq!(
        seen,
        [
            json!("Fetching records 0/2 (started)"),
            json!("Fetching records 1/2 (updated)"),
            json!("Fetching records 1/2 (ended)"),
            json!(1),
        ]
    );
    server.stop().await;
}

#[tokio::test]
async fn serves_an_initialize_era_client_within_its_session() {
    let mut server = Launched::start(
        &app(Hook::None),
        &["mcp", "--http", "0"],
        Build::Distributed,
    );
    let port = server.port().await;
    let opened = send(port, &initialize("2025-06-18")).await;
    let session = opened.header("mcp-session-id").unwrap();
    let called = send(
        port,
        &in_session(
            Some(&session),
            1,
            "tools/call",
            Some(json!({ "arguments": { "word": "hello" }, "name": "echo" })),
        ),
    )
    .await;
    assert!(
        called.text.contains(r#""text":"hello\n""#),
        "{}",
        called.text
    );
    server.stop().await;
}

// Shutdown.

#[tokio::test]
async fn the_runs_signal_aborts_each_call_and_tears_down_an_open_subscription_on_its_stream() {
    let observed = Observed::default();
    let app = served(&observed, settings(Hook::None, None), false);
    let mut server = Launched::start(&app, &["mcp", "--http", "0"], Build::Distributed);
    let port = server.port().await;
    let mut listen = EventStream::new(
        open(
            port,
            &per_request("listen", "subscriptions/listen", json!({})),
        )
        .await,
    );
    listen.next().await;
    let call = EventStream::new(
        open(
            port,
            &per_request(
                1,
                "tools/call",
                json!({ "arguments": { "label": "one" }, "name": "wait" }),
            ),
        )
        .await,
    );
    observed.wait_for("started one").await;
    let ending = server.stop().await;
    listen.ended().await;
    call.ended().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (130, ""));
    assert_eq!(observed.lines(), ["started one", "aborted one"]);
    assert_eq!(
        listen.events()[1..],
        [
            json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": "listen" } }),
            json!({
                "id": "listen",
                "jsonrpc": "2.0",
                "result": {
                    "_meta": {
                        "io.modelcontextprotocol/serverInfo": { "name": "served", "version": "3.0.0" },
                        "io.modelcontextprotocol/subscriptionId": "listen",
                    },
                    "resultType": "complete",
                },
            }),
        ]
    );
    assert!(call.events().is_empty());
}

#[tokio::test]
async fn a_process_signal_ends_the_server() {
    let mut server = Launched::start(
        &app(Hook::None),
        &["mcp", "--http", "0"],
        Build::Distributed,
    );
    let port = server.port().await;
    assert_eq!(
        status_of(port, &per_request(1, "tools/list", json!({}))).await,
        200
    );
    server.session.raise(ProcessSignal::Term);
    let ending = server.session.finish().await;
    assert_eq!(ending.status, 143);
}

// What a call runs on.

const TIME_ZONE_KEY: &str = "io.github.dbtlr.loomcli/timeZone";
const INVALID_TIME_ZONE: &str = "Metadata key \"io.github.dbtlr.loomcli/timeZone\" requires an IANA time zone name this runtime knows. Use a name such as \"Asia/Tokyo\".";

/// The stdio time zone cases over HTTP, on one revision.
async fn time_zone_calls(revision: &str) {
    let app = Application::new("clock").plugins([mcp()]).command(
        Command::new("stamp")
            .description("Print the time zone and instant.")
            .extend([opted()])
            .option(
                "at",
                Opt::string()
                    .description("A local date and time.")
                    .default("2026-09-25T14:30:00")
                    .validate(date_time()),
            )
            .action(|ctx: Context| async move {
                let at = ctx
                    .option::<Option<<DateTime as Validator>::Output>>("at")?
                    .unwrap();
                ctx.out
                    .print(&format!("{} {at:.3}", ctx.host.time_zone()))
                    .await
            }),
    );
    let mut server = Launched::start(&app, &["mcp", "--http", "0"], Build::Distributed);
    let port = server.port().await;
    let per_request_revision = revision == "2026-07-28";
    let session = if per_request_revision {
        None
    } else {
        Some(
            send(port, &initialize(revision))
                .await
                .header("mcp-session-id")
                .unwrap(),
        )
    };
    let utc = "UTC 2026-09-25T14:30:00.000Z\n";
    let tokyo = "Asia/Tokyo 2026-09-25T05:30:00.000Z\n";
    let alias = loomcli_core::resolve_time_zone("US/Eastern").unwrap();
    let eastern = format!("{alias} 2026-09-25T18:30:00.000Z\n");
    let unlisted =
        "Tool \"stamp\" takes no argument \"extra\". Use a property its input schema lists.";
    for (index, (zone, arguments, text, is_error)) in [
        (None, json!({}), utc, false),
        (
            Some(json!("Asia/Tokyo")),
            json!({"at": "2026-09-25T14:30:00"}),
            tokyo,
            false,
        ),
        (Some(json!("Asia/Tokyo")), json!({}), tokyo, false),
        (
            Some(json!("US/Eastern")),
            json!({}),
            eastern.as_str(),
            false,
        ),
        (
            Some(json!("Mars/Olympus")),
            json!({}),
            INVALID_TIME_ZONE,
            true,
        ),
        (
            Some(json!("Mars/Olympus")),
            json!({"extra": "unused"}),
            unlisted,
            true,
        ),
        (Some(json!("+09:00")), json!({}), INVALID_TIME_ZONE, true),
        (
            Some(json!("\u{2212}09:00")),
            json!({}),
            INVALID_TIME_ZONE,
            true,
        ),
        (Some(Value::Null), json!({}), INVALID_TIME_ZONE, true),
        (Some(json!(false)), json!({}), INVALID_TIME_ZONE, true),
        (None, json!({}), utc, false),
    ]
    .into_iter()
    .enumerate()
    {
        let id = index + 1;
        let mut metadata = if per_request_revision {
            meta()
        } else {
            json!({})
        };
        if let Some(zone) = zone {
            metadata[TIME_ZONE_KEY] = zone;
        }
        let mut sent = Sent::json(json!({
            "id": id, "jsonrpc": "2.0", "method": "tools/call",
            "params": { "_meta": metadata, "arguments": arguments, "name": "stamp" },
        }));
        sent.headers = match &session {
            None => mirrored("tools/call", Some("stamp")),
            Some(session) => vec![
                (
                    "Accept".into(),
                    "application/json, text/event-stream".into(),
                ),
                ("MCP-Protocol-Version".into(), revision.into()),
                ("MCP-Session-Id".into(), session.clone()),
            ],
        };
        let mut stream = EventStream::new(open(port, &sent).await);
        let message = stream.next().await;
        stream.ended().await;
        assert_eq!(message["id"], id);
        let result = &message["result"];
        assert_eq!(
            result["content"],
            json!([{"type": "text", "text": text}]),
            "{message}"
        );
        assert_eq!(result["isError"], is_error);
        assert!(result.get("structuredContent").is_none(), "{result}");
    }
    let ending = server.stop().await;
    assert_eq!(ending.stderr, "");
}

#[tokio::test]
async fn http_serves_time_zone_calls_on_the_per_request_revision() {
    time_zone_calls("2026-07-28").await;
}

#[tokio::test]
async fn http_serves_time_zone_calls_on_the_2025_11_25_revision() {
    time_zone_calls("2025-11-25").await;
}

#[tokio::test]
async fn http_serves_time_zone_calls_on_the_2025_06_18_revision() {
    time_zone_calls("2025-06-18").await;
}
