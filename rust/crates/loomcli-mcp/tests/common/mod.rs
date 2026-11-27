//! A session harness: the reference's `session.ts` and `fixtures/server.mjs`, in process.
//!
//! A fixture tool source runs under a server over two in-memory pipes. The fixture reports what a
//! handler saw in a shared log, as the reference fixture reports it on stderr.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_mcp::{
    McpServer, ProgressUpdate, ProtocolError, ServerInfo, Tool, ToolCall, ToolResult, ToolSource,
    error_codes,
};
use serde_json::{Map, Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader, DuplexStream, duplex};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

/// How long a session may wait for a message before the test fails.
const DEADLINE: Duration = Duration::from_secs(10);

/// The `_meta` every request of the pinned revision carries.
pub fn meta() -> Value {
    json!({
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    })
}

/// The identity the fixture server declares, as every result's `_meta` carries it.
pub fn server_info() -> Value {
    json!({ "description": "A conformance fixture.", "name": "fixture", "version": "1.2.3" })
}

/// A request of the pinned revision: params carry the required `_meta`.
pub fn request(id: impl Into<Value>, method: &str, params: Value) -> Value {
    let mut params = params.as_object().cloned().unwrap_or_default();
    params.insert("_meta".into(), meta());
    json!({ "id": id.into(), "jsonrpc": "2.0", "method": method, "params": params })
}

/// A request of the pinned revision with no other params.
pub fn bare(id: impl Into<Value>, method: &str) -> Value {
    request(id, method, json!({}))
}

/// The handshake that opens a connection on an initialize-era revision.
pub fn initialize(id: impl Into<Value>, protocol_version: impl Into<Value>) -> Value {
    json!({
        "id": id.into(),
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "capabilities": {},
            "clientInfo": { "name": "handshake-client", "version": "0.1.0" },
            "protocolVersion": protocol_version.into(),
        },
    })
}

/// An `initialize` with the params given as they are.
pub fn initialize_with(id: impl Into<Value>, params: Value) -> Value {
    json!({ "id": id.into(), "jsonrpc": "2.0", "method": "initialize", "params": params })
}

/// A request of an initialize-era revision: no per-request `_meta`.
pub fn handshake_request(id: impl Into<Value>, method: &str, params: Option<Value>) -> Value {
    let mut message = json!({ "id": id.into(), "jsonrpc": "2.0", "method": method });
    if let Some(params) = params {
        message["params"] = params;
    }
    message
}

/// A `notifications/cancelled` for one request.
pub fn cancel(request_id: impl Into<Value>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "notifications/cancelled",
        "params": { "reason": "test", "requestId": request_id.into() },
    })
}

/// Asserts that `actual` holds everything `expected` does: objects by subset, arrays by length
/// and element, everything else by equality.
pub fn assert_matches(actual: &Value, expected: &Value) {
    assert!(
        subset(actual, expected),
        "expected {actual} to match {expected}"
    );
}

/// Asserts that `actual` is an error response with exactly the members the reference writes: the
/// message holds `jsonrpc`, `id`, and `error`, and the error holds `code` and `message` alone.
pub fn assert_plain_error(actual: &Value, id: &Value, code: i64) {
    let keys = |value: &Value| -> Vec<String> {
        let mut keys: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    };
    assert_eq!(keys(actual), ["error", "id", "jsonrpc"], "{actual}");
    assert_eq!(keys(&actual["error"]), ["code", "message"], "{actual}");
    assert_eq!(&actual["id"], id, "{actual}");
    assert_eq!(actual["error"]["code"], code, "{actual}");
    assert!(actual["error"]["message"].is_string(), "{actual}");
}

fn subset(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => expected
            .iter()
            .all(|(key, want)| actual.get(key).is_some_and(|got| subset(got, want))),
        (Value::Array(actual), Value::Array(expected)) => {
            actual.len() == expected.len()
                && actual
                    .iter()
                    .zip(expected)
                    .all(|(got, want)| subset(got, want))
        }
        _ => actual == expected,
    }
}

/// The tools the fixture lists.
fn listed_tools() -> Vec<Tool> {
    let echo_schema = json!({ "properties": { "text": { "type": "string" } }, "type": "object" });
    let wait_schema = json!({ "type": "object" });
    vec![
        Tool::new("echo", echo_schema.as_object().cloned().unwrap_or_default())
            .with_description("Answers the call it received."),
        Tool::new("wait", wait_schema.as_object().cloned().unwrap_or_default()),
    ]
}

/// A tool source whose tools exercise each path a handler can take.
pub struct Fixture {
    log: Arc<Mutex<Vec<String>>>,
    stop: CancellationToken,
    list_throws: bool,
}

impl Fixture {
    fn report(&self, line: impl Into<String>) {
        self.log.lock().unwrap().push(line.into());
    }
}

fn text_result(text: &str) -> ToolResult {
    ToolResult {
        output: text.to_owned(),
        ..ToolResult::default()
    }
}

fn label_of(call: &ToolCall) -> String {
    call.arguments
        .as_ref()
        .and_then(|arguments| arguments.get("label"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

impl ToolSource for Fixture {
    async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
        if self.list_throws {
            panic!("The fixture listing failed.");
        }
        Ok(listed_tools())
    }

    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, ProtocolError> {
        match call.name.as_str() {
            "echo" => {
                let mut structured = Map::new();
                if let Some(arguments) = &call.arguments {
                    structured.insert("arguments".into(), arguments.clone());
                }
                structured.insert("name".into(), json!(call.name));
                Ok(ToolResult {
                    output: "first line\nsecond line".into(),
                    structured_content: Some(Value::Object(structured)),
                    ..ToolResult::default()
                })
            }
            "late" => {
                let log = Arc::clone(&self.log);
                let progress = call.progress.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    if let Some(progress) = progress {
                        progress.send(ProgressUpdate {
                            progress: 1.0,
                            ..ProgressUpdate::default()
                        });
                    }
                    log.lock().unwrap().push("sent late".into());
                });
                Ok(text_result("answered"))
            }
            "progress" => {
                self.report(if call.progress.is_some() {
                    "progress received"
                } else {
                    "progress absent"
                });
                let updates = call
                    .arguments
                    .as_ref()
                    .and_then(|arguments| arguments.get("updates"))
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for update in updates {
                    if let Some(progress) = &call.progress {
                        progress.send(ProgressUpdate {
                            progress: update["progress"].as_f64().unwrap_or_default(),
                            total: update.get("total").and_then(Value::as_f64),
                            message: update
                                .get("message")
                                .and_then(Value::as_str)
                                .map(str::to_owned),
                        });
                    }
                }
                Ok(text_result("reported"))
            }
            "refuse" => Err(ProtocolError::new(error_codes::INVALID_PARAMS, "Refused.")
                .with_data(json!({ "reason": "fixture" }))),
            // The run's token, cancelled from outside the call as the reference's caller signal
            // is: the call waits for the abort it starts, so it answers nothing.
            "stop" => {
                self.stop.cancel();
                call.cancel.cancelled().await;
                Ok(text_result("stopped"))
            }
            "structured" => {
                let value = call
                    .arguments
                    .as_ref()
                    .and_then(|arguments| arguments.get("value"))
                    .cloned()
                    .unwrap_or(Value::Null);
                Ok(ToolResult {
                    output: value.to_string(),
                    structured_content: Some(value),
                    ..ToolResult::default()
                })
            }
            "throw" => panic!("The fixture tool failed."),
            "wait" => {
                let label = label_of(&call);
                self.report(format!("started {label}"));
                call.cancel.cancelled().await;
                self.report(format!("aborted {label}"));
                Ok(ToolResult {
                    output: format!("aborted {label}"),
                    is_error: true,
                    ..ToolResult::default()
                })
            }
            "wait-progress" => {
                self.report("started");
                call.cancel.cancelled().await;
                if let Some(progress) = &call.progress {
                    progress.send(ProgressUpdate {
                        progress: 1.0,
                        total: None,
                        message: Some("after the abort".into()),
                    });
                }
                self.report("aborted");
                Ok(ToolResult {
                    output: "aborted".into(),
                    is_error: true,
                    ..ToolResult::default()
                })
            }
            _ => panic!("The fixture has no such tool."),
        }
    }
}

/// How the server run ended, with everything it wrote.
pub struct Ending {
    /// Whether the run returned `Ok`, which the reference reports as exit status 0.
    pub status: i32,
    /// Every message the server wrote, parsed.
    pub messages: Vec<Value>,
    /// Every line the server wrote.
    pub lines: Vec<String>,
    /// What the fixture's handlers reported, one line each, with the run's own `resolved` last.
    pub stderr: String,
}

/// One server run driven over in-memory pipes.
pub struct Session {
    input: Option<DuplexStream>,
    written: Arc<Mutex<Vec<u8>>>,
    reader: Option<JoinHandle<()>>,
    run: JoinHandle<io::Result<()>>,
    log: Arc<Mutex<Vec<String>>>,
    read: usize,
}

/// A session over the fixture.
pub fn open() -> Session {
    open_with("default")
}

/// A session over the fixture under a scenario: `list-throws` makes the listing panic.
pub fn open_with(scenario: &str) -> Session {
    let log = Arc::new(Mutex::new(Vec::new()));
    let stop = CancellationToken::new();
    let fixture = Fixture {
        log: Arc::clone(&log),
        stop: stop.clone(),
        list_throws: scenario == "list-throws",
    };
    let (client_out, server_in) = duplex(1 << 16);
    let (server_out, mut client_in) = duplex(1 << 16);
    let server = McpServer::new(
        ServerInfo::new("fixture", "1.2.3").with_description("A conformance fixture."),
        fixture,
    );
    let run_log = Arc::clone(&log);
    let run = tokio::spawn(async move {
        let result = server
            .run_until(BufReader::new(server_in), server_out, stop)
            .await;
        run_log.lock().unwrap().push("resolved".into());
        result
    });
    let written = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&written);
    let reader = tokio::spawn(async move {
        let mut buffer = [0_u8; 4096];
        while let Ok(count) = client_in.read(&mut buffer).await {
            if count == 0 {
                break;
            }
            sink.lock().unwrap().extend_from_slice(&buffer[..count]);
        }
    });
    Session {
        input: Some(client_out),
        written,
        reader: Some(reader),
        run,
        log,
        read: 0,
    }
}

impl Session {
    /// Writes one message as a line.
    pub async fn send(&mut self, message: &Value) {
        self.send_raw(&format!("{message}\n")).await;
    }

    /// Writes a raw string as it is.
    pub async fn send_raw(&mut self, text: &str) {
        if let Some(input) = self.input.as_mut() {
            input.write_all(text.as_bytes()).await.unwrap();
            input.flush().await.unwrap();
        }
    }

    fn lines(&self) -> Vec<String> {
        let text = String::from_utf8_lossy(&self.written.lock().unwrap()).into_owned();
        let mut lines: Vec<String> = text.split('\n').map(str::to_owned).collect();
        lines.pop();
        lines
    }

    /// The next message the server wrote, in order.
    pub async fn next(&mut self) -> Value {
        let start = tokio::time::Instant::now();
        loop {
            let lines = self.lines();
            if let Some(line) = lines.get(self.read) {
                self.read += 1;
                let value: Value = serde_json::from_str(line).unwrap();
                assert!(value.is_object(), "not a JSON object: {line}");
                return value;
            }
            assert!(
                start.elapsed() < DEADLINE,
                "The server wrote no further message. It wrote:\n{lines:?}"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    /// Waits until a handler has reported the line.
    pub async fn observed(&self, line: &str) {
        let start = tokio::time::Instant::now();
        while !self.log.lock().unwrap().iter().any(|each| each == line) {
            assert!(
                start.elapsed() < DEADLINE,
                "The fixture never reported {line:?}. It reported {:?}",
                self.log.lock().unwrap()
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    /// Ends the input and waits for the run to end.
    pub async fn close(mut self) -> Ending {
        self.input = None;
        self.finish().await
    }

    /// Stops reading the output, as a client that exits does, then ends the input.
    pub async fn hang_up(mut self) -> Ending {
        if let Some(reader) = self.reader.take() {
            reader.abort();
            let _ = reader.await;
        }
        self.close().await
    }

    /// Waits for the run to end on its own, with the input left open.
    pub async fn finish(mut self) -> Ending {
        let result = tokio::time::timeout(DEADLINE, &mut self.run)
            .await
            .expect("the run did not end")
            .expect("the run panicked");
        if let Some(reader) = self.reader.take() {
            let _ = tokio::time::timeout(DEADLINE, reader).await;
        }
        let lines = self.lines();
        let messages = lines
            .iter()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let stderr = self
            .log
            .lock()
            .unwrap()
            .iter()
            .map(|line| format!("{line}\n"))
            .collect();
        Ending {
            status: i32::from(result.is_err()),
            messages,
            lines,
            stderr,
        }
    }
}

/// The ids of the messages, `null` where a message has none.
pub fn ids(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| message.get("id").cloned().unwrap_or(Value::Null))
        .collect()
}
