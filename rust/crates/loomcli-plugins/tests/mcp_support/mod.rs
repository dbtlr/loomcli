//! The MCP tests' harness, ported from the reference's `packages/mcp/tests/session.ts` and
//! `fixtures/mcp-app.ts`: an application's `mcp` Command served on a mock process whose stdin a
//! test writes one line at a time and whose stdout it reads one message at a time.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::VecDeque;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_core::{
    Application, BoxFuture, Build, Child, Env, ExitCode, InputStream, Libc, OutputStream,
    ProcessHandle, ProcessTerminal, ReleaseFacts, RunOptions, SignalSource, SpawnRequest, State,
};
use loomcli_testing::{MockFields, MockProcess, mock_process};
use serde_json::{Value, json};
use tokio::sync::{Notify, mpsc};
use tokio_util::sync::CancellationToken;

/// The longest a test waits for one message before it fails.
const PATIENCE: Duration = Duration::from_secs(10);

/// The per-request revision's `_meta`.
pub fn meta() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
    })
}

/// A request on the per-request revision, its `params._meta` first.
pub fn request(id: impl Into<Value>, method: &str, params: Value) -> Value {
    let mut all = serde_json::Map::new();
    all.insert("_meta".into(), meta());
    if let Value::Object(params) = params {
        for (key, value) in params {
            all.insert(key, value);
        }
    }
    json!({ "jsonrpc": "2.0", "id": id.into(), "method": method, "params": all })
}

/// A request with no per-request `_meta`, served on the revision `initialize` negotiated.
pub fn handshake_request(id: impl Into<Value>, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.into(), "method": method, "params": params })
}

/// An `initialize` request for a revision.
pub fn initialize(id: impl Into<Value>, version: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.into(),
        "method": "initialize",
        "params": {
            "protocolVersion": version,
            "capabilities": {},
            "clientInfo": { "name": "test", "version": "0" },
        },
    })
}

/// A `tools/call` request on the per-request revision.
pub fn call(id: impl Into<Value>, name: &str, arguments: Option<Value>) -> Value {
    let mut params = json!({ "name": name });
    if let Some(arguments) = arguments {
        params["arguments"] = arguments;
    }
    request(id, "tools/call", params)
}

/// A `notifications/cancelled` for a request.
pub fn cancelled(id: impl Into<Value>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "notifications/cancelled",
        "params": { "_meta": meta(), "requestId": id.into() },
    })
}

/// What a test action reports outside the call's captured streams, as the reference's fixtures
/// write to the process's own stderr: one line per event, each awaited by name.
#[derive(Clone, Default)]
pub struct Observed {
    lines: Arc<Mutex<Vec<String>>>,
    changed: Arc<Notify>,
}

impl Observed {
    pub fn report(&self, line: impl Into<String>) {
        self.lines.lock().unwrap().push(line.into());
        self.changed.notify_waiters();
    }

    pub fn lines(&self) -> Vec<String> {
        self.lines.lock().unwrap().clone()
    }

    /// Waits until a line has been reported.
    pub async fn wait_for(&self, line: &str) {
        let wait = async {
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if self.lines().iter().any(|each| each == line) {
                    return;
                }
                changed.await;
            }
        };
        tokio::time::timeout(PATIENCE, wait)
            .await
            .unwrap_or_else(|_| panic!("never observed {line:?}; saw {:?}", self.lines()));
    }
}

/// Stdin a test writes to: each chunk is read once, in order, and the stream ends when the test
/// closes it.
struct StreamingStdin {
    chunks: tokio::sync::Mutex<(mpsc::UnboundedReceiver<Vec<u8>>, VecDeque<u8>)>,
}

impl InputStream for StreamingStdin {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            let mut state = self.chunks.lock().await;
            let (receiver, pending) = &mut *state;
            if pending.is_empty() {
                match receiver.recv().await {
                    Some(chunk) => pending.extend(chunk),
                    None => return Ok(0),
                }
            }
            let count = pending.len().min(buffer.len());
            for (slot, byte) in buffer.iter_mut().zip(pending.drain(..count)) {
                *slot = byte;
            }
            Ok(count)
        })
    }
}

/// Stdout a test reads message by message. Once the client hangs up, every write fails as a
/// closed pipe does.
#[derive(Default)]
struct WatchedStdout {
    text: Mutex<String>,
    changed: Notify,
    hung_up: AtomicBool,
}

impl OutputStream for WatchedStdout {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        Box::pin(async move {
            if self.hung_up.load(Ordering::SeqCst) {
                return Err(io::Error::from(io::ErrorKind::BrokenPipe));
            }
            self.text
                .lock()
                .unwrap()
                .push_str(&String::from_utf8_lossy(bytes));
            self.changed.notify_waiters();
            Ok(())
        })
    }
}

/// The mock process with a streaming stdin and a watched stdout.
struct SessionProcess {
    inner: Arc<MockProcess>,
    stdin: Arc<StreamingStdin>,
    stdout: Arc<WatchedStdout>,
}

impl ProcessHandle for SessionProcess {
    fn argv(&self) -> Vec<String> {
        self.inner.argv()
    }
    fn program(&self) -> Vec<String> {
        self.inner.program()
    }
    fn env(&self) -> Env {
        self.inner.env()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.inner.cwd()
    }
    fn home(&self) -> PathBuf {
        self.inner.home()
    }
    fn tmpdir(&self) -> PathBuf {
        self.inner.tmpdir()
    }
    fn platform(&self) -> String {
        self.inner.platform()
    }
    fn arch(&self) -> String {
        self.inner.arch()
    }
    fn libc(&self) -> Option<Libc> {
        self.inner.libc()
    }
    fn uid(&self) -> Option<u32> {
        self.inner.uid()
    }
    fn time_zone(&self) -> String {
        self.inner.time_zone()
    }
    fn release(&self) -> ReleaseFacts {
        self.inner.release()
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        Arc::clone(&self.stdin) as Arc<dyn InputStream>
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        Arc::clone(&self.stdout) as Arc<dyn OutputStream>
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        self.inner.stderr()
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        self.inner.terminal()
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        self.inner.signals()
    }
    fn spawn(&self, request: SpawnRequest) -> Child {
        self.inner.spawn(request)
    }
    fn set_exit_code(&self, code: ExitCode) {
        self.inner.set_exit_code(code);
    }
}

/// How a session ended: the exit code, stderr, and every message the test had not read.
#[derive(Debug)]
pub struct Ending {
    pub status: u8,
    pub stderr: String,
    pub messages: Vec<Value>,
}

/// One served session.
pub struct Session {
    input: Option<mpsc::UnboundedSender<Vec<u8>>>,
    stdout: Arc<WatchedStdout>,
    process: Arc<MockProcess>,
    run: tokio::task::JoinHandle<ExitCode>,
    read: usize,
}

/// How a session's process is built.
pub struct Launch {
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
    pub build: Build,
    pub signal: Option<CancellationToken>,
    pub cwd: Option<PathBuf>,
}

impl Default for Launch {
    fn default() -> Self {
        Self {
            argv: vec!["mcp".into()],
            env: Vec::new(),
            build: Build::Distributed,
            signal: None,
            cwd: None,
        }
    }
}

/// Serves an application's `mcp` Command on a fresh session.
pub fn serve<I, R, S: State>(application: &Application<I, R, S>) -> Session {
    launch(application, Launch::default())
}

/// Starts an application's run on a session with these facts.
pub fn launch<I, R, S: State>(application: &Application<I, R, S>, launch: Launch) -> Session {
    let mut fields = MockFields::new()
        .argv(launch.argv)
        .release(ReleaseFacts::new(launch.build));
    for (name, value) in &launch.env {
        fields = fields.env(name, value);
    }
    if let Some(cwd) = launch.cwd {
        fields = fields.cwd(cwd);
    }
    let inner = mock_process(fields);
    let (sender, receiver) = mpsc::unbounded_channel();
    let stdout = Arc::new(WatchedStdout::default());
    let process = SessionProcess {
        inner: Arc::clone(&inner),
        stdin: Arc::new(StreamingStdin {
            chunks: tokio::sync::Mutex::new((receiver, VecDeque::new())),
        }),
        stdout: Arc::clone(&stdout),
    };
    let mut options = RunOptions::new().process(Arc::new(process) as Arc<dyn ProcessHandle>);
    if let Some(signal) = launch.signal {
        options = options.signal(signal);
    }
    let run = tokio::spawn(application.run(options));
    Session {
        input: Some(sender),
        stdout,
        process: inner,
        run,
        read: 0,
    }
}

impl Session {
    /// Sends one message as one line of compact JSON.
    pub fn send(&self, message: &Value) {
        self.send_line(&serde_json::to_string(message).unwrap());
    }

    /// Sends one raw line.
    pub fn send_line(&self, line: &str) {
        if let Some(input) = &self.input {
            let _ = input.send(format!("{line}\n").into_bytes());
        }
    }

    /// The complete lines stdout holds so far.
    fn lines(&self) -> Vec<String> {
        let text = self.stdout.text.lock().unwrap();
        let mut lines: Vec<String> = text.split('\n').map(str::to_owned).collect();
        lines.pop();
        lines
    }

    /// The next line the server writes, as it wrote it.
    pub async fn next_line(&mut self) -> String {
        let wait = async {
            loop {
                let changed = self.stdout.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if let Some(line) = self.lines().get(self.read) {
                    return line.clone();
                }
                changed.await;
            }
        };
        let line = tokio::time::timeout(PATIENCE, wait)
            .await
            .unwrap_or_else(|_| panic!("no message after {:?}", self.lines()));
        self.read += 1;
        line
    }

    /// The next message the server writes.
    pub async fn next(&mut self) -> Value {
        let line = self.next_line().await;
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("not JSON: {line:?}"))
    }

    /// The messages up to and including the answer to `id`, split into those before it and it.
    pub async fn until_answer(&mut self, id: impl Into<Value>) -> (Vec<Value>, Value) {
        let id = id.into();
        let mut before = Vec::new();
        loop {
            let message = self.next().await;
            if message.get("id") == Some(&id) {
                return (before, message);
            }
            before.push(message);
        }
    }

    /// Closes stdin and waits for the run to end.
    pub async fn close(mut self) -> Ending {
        self.input = None;
        self.finish().await
    }

    /// Stops reading stdout, as a client that closes its end of the pipe, closes stdin, and waits
    /// for the run to end.
    pub async fn hang_up(mut self) -> Ending {
        self.stdout.hung_up.store(true, Ordering::SeqCst);
        self.input = None;
        self.finish().await
    }

    /// Waits for the run to end with stdin left open.
    pub async fn finish(mut self) -> Ending {
        let run = &mut self.run;
        let code = tokio::time::timeout(PATIENCE, run)
            .await
            .expect("the run did not end")
            .unwrap();
        let messages = self.lines()[self.read..]
            .iter()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        Ending {
            status: code.get(),
            stderr: self.process.stderr_text(),
            messages,
        }
    }
}

/// The tools one application lists, in the order it lists them.
pub async fn tools_of<I, R, S: State>(application: &Application<I, R, S>) -> Vec<Value> {
    let mut session = serve(application);
    session.send(&request(1, "tools/list", json!({})));
    let answer = session.next().await;
    let ending = session.close().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
    answer["result"]["tools"].as_array().unwrap().clone()
}

/// A tool listed by name.
pub fn tool_named<'a>(tools: &'a [Value], name: &str) -> Option<&'a Value> {
    tools.iter().find(|tool| tool["name"] == name)
}

/// One tool call's answer, from a fresh session of the application, which then exits 0 with
/// nothing on stderr.
pub async fn called<I, R, S: State>(
    application: &Application<I, R, S>,
    name: &str,
    arguments: Option<Value>,
) -> Value {
    let mut session = serve(application);
    session.send(&call(1, name, arguments));
    let answer = session.next().await;
    let ending = session.close().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (0, ""));
    answer
}

/// The result of one tool call, without the identity every result carries, after checking that
/// it is complete.
pub async fn result_of<I, R, S: State>(
    application: &Application<I, R, S>,
    name: &str,
    arguments: Option<Value>,
) -> Value {
    let answer = called(application, name, arguments).await;
    let mut result = answer["result"].as_object().cloned().unwrap_or_default();
    result.shift_remove("_meta");
    assert_eq!(result.shift_remove("resultType"), Some(json!("complete")));
    Value::Object(result)
}
