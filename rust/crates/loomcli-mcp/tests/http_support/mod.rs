//! The HTTP transport's fixture server, the port of the reference's `tests/http.ts` server half:
//! a tool source whose tools exercise each path a call takes, served on 127.0.0.1 on a free port.

#![allow(
    dead_code,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

pub mod client;

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_mcp::{
    Authorization, HttpOptions, McpServer, ProgressUpdate, ProtocolError, RequestHeaders,
    ServerInfo, Tool, ToolCall, ToolResult, ToolSource, error_codes,
};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

/// The identity the fixture server declares.
pub fn server_info() -> Value {
    json!({ "description": "An HTTP fixture.", "name": "fixture", "version": "1.2.3" })
}

/// What the fixture's tools saw, in order, such as `started one` and `aborted one`.
#[derive(Clone, Default)]
pub struct Events(Arc<Mutex<Vec<String>>>);

impl Events {
    fn push(&self, line: String) {
        self.0.lock().unwrap().push(line);
    }

    pub fn all(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }

    pub fn has(&self, line: &str) -> bool {
        self.all().iter().any(|each| each == line)
    }

    pub fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

type Releases = Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>;

/// The fixture's tools. `wait` runs until its token is cancelled or the test releases its label,
/// and its `settling` label, once aborted, still waits for its release; `progress` sends two
/// updates and answers; `refuse` returns a protocol error.
struct Fixture {
    events: Events,
    releases: Releases,
}

fn text(value: &str) -> ToolResult {
    ToolResult {
        output: value.to_owned(),
        ..ToolResult::default()
    }
}

impl ToolSource for Fixture {
    async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
        let object = json!({ "type": "object" }).as_object().cloned().unwrap();
        Ok(vec![
            Tool::new("echo", object.clone()),
            Tool::new("wait", object),
        ])
    }

    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, ProtocolError> {
        match call.name.as_str() {
            "echo" => Ok(text(
                &call.arguments.clone().unwrap_or(Value::Null).to_string(),
            )),
            "progress" => {
                if let Some(progress) = &call.progress {
                    progress.send(ProgressUpdate {
                        progress: 1.0,
                        total: None,
                        message: Some("first".into()),
                    });
                    progress.send(ProgressUpdate {
                        progress: 2.0,
                        total: Some(2.0),
                        message: None,
                    });
                }
                Ok(text("reported"))
            }
            "refuse" => Err(ProtocolError::new(error_codes::INVALID_PARAMS, "Refused.")),
            "wait" => {
                let label = call
                    .arguments
                    .as_ref()
                    .and_then(|arguments| arguments.get("label"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                self.events.push(format!("started {label}"));
                let (release, released) = oneshot::channel();
                self.releases.lock().unwrap().insert(label.clone(), release);
                let mut released = released;
                let how = tokio::select! {
                    _ = &mut released => "released",
                    () = call.cancel.cancelled() => "aborted",
                };
                if how == "aborted" && label == "settling" {
                    self.events.push(format!("aborted {label}"));
                    let _ = released.await;
                    return Ok(text(&format!("aborted {label}")));
                }
                self.events.push(format!("{how} {label}"));
                Ok(text(&format!("{how} {label}")))
            }
            _ => Err(ProtocolError::new(
                error_codes::INVALID_PARAMS,
                "Unknown tool.",
            )),
        }
    }
}

/// The transport's settings a test names.
#[derive(Default)]
pub struct Settings {
    pub authorize: Option<Arc<dyn Fn(RequestHeaders) -> Authorization + Send + Sync>>,
    pub on_origin_refused: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    pub max_body_bytes: Option<u64>,
    pub session_idle: Option<Duration>,
    /// An authorize hook whose answer the test gives later, through the receiver it returns.
    pub held_authorize: Option<Arc<dyn Fn() -> oneshot::Receiver<Authorization> + Send + Sync>>,
}

/// One fixture server's address, what its tools saw, and how to stop it.
pub struct Served {
    pub port: u16,
    pub events: Events,
    releases: Releases,
    /// How many requests' headers the server has received: the authorize hook counts them.
    requests: Arc<AtomicUsize>,
    /// How many sockets the server accepted.
    accepted: Arc<AtomicUsize>,
    shutdown: CancellationToken,
    closed: tokio::task::JoinHandle<()>,
}

impl Served {
    pub fn release(&self, label: &str) {
        if let Some(release) = self.releases.lock().unwrap().remove(label) {
            let _ = release.send(());
        }
    }

    /// A release function that outlives this handle.
    pub fn releaser(&self) -> impl Fn(&str) + use<> {
        let releases = Arc::clone(&self.releases);
        move |label| {
            if let Some(release) = releases.lock().unwrap().remove(label) {
                let _ = release.send(());
            }
        }
    }

    pub fn requests(&self) -> usize {
        self.requests.load(Ordering::SeqCst)
    }

    pub fn accepted(&self) -> usize {
        self.accepted.load(Ordering::SeqCst)
    }

    /// Cancels the shutdown token and resolves once the transport has closed.
    pub async fn stop(self) {
        self.shutdown.cancel();
        tokio::time::timeout(client::PATIENCE, self.closed)
            .await
            .expect("the transport did not close")
            .unwrap();
    }

    /// Cancels the shutdown token and answers the wait for the transport to close.
    pub fn stopping(self) -> tokio::task::JoinHandle<()> {
        self.shutdown.cancel();
        self.closed
    }
}

/// Starts a fixture server on 127.0.0.1, on a free port, with the given transport settings.
pub async fn serve(settings: Settings) -> Served {
    let events = Events::default();
    let releases: Releases = Arc::default();
    let server = McpServer::new(
        ServerInfo::new("fixture", "1.2.3").with_description("An HTTP fixture."),
        Fixture {
            events: events.clone(),
            releases: Arc::clone(&releases),
        },
    );
    let shutdown = CancellationToken::new();
    let requests = Arc::new(AtomicUsize::new(0));
    let mut options = HttpOptions::new(shutdown.clone());
    if let Some(limit) = settings.max_body_bytes {
        options = options.max_body_bytes(limit);
    }
    if let Some(idle) = settings.session_idle {
        options = options.session_idle(idle);
    }
    if let Some(heard) = settings.on_origin_refused {
        options = options.on_origin_refused(move |origin| heard(origin));
    }
    let counted = Arc::clone(&requests);
    let authorize = settings.authorize;
    let held = settings.held_authorize;
    options = options.authorize(move |headers| {
        counted.fetch_add(1, Ordering::SeqCst);
        let authorize = authorize.clone();
        let held = held.clone();
        async move {
            if let Some(held) = held {
                return held().await.unwrap_or(Authorization::Failed);
            }
            authorize.map_or(Authorization::Allowed, |authorize| authorize(headers))
        }
    });
    let transport = server.http(options);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let accepted = Arc::new(AtomicUsize::new(0));
    let counting = Arc::clone(&accepted);
    let listening = shutdown.clone();
    let closed = tokio::spawn(async move {
        loop {
            tokio::select! {
                () = listening.cancelled() => break,
                accepted = listener.accept() => {
                    if let Ok((socket, _)) = accepted {
                        counting.fetch_add(1, Ordering::SeqCst);
                        transport.watch(socket);
                    }
                }
            }
        }
        drop(listener);
        transport.closed().await;
    });
    Served {
        port,
        events,
        releases,
        requests,
        accepted,
        shutdown,
        closed,
    }
}

/// Pauses the runtime's clock, as the reference fakes its timers, and keeps it from advancing on
/// its own while the test waits for a socket: only [`FakeTimers::advance`] moves it. The clock
/// runs again on its own once the guard is dropped.
pub struct FakeTimers {
    release: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

/// Holds the paused clock still: a blocking task in flight keeps it from advancing on its own.
fn hold_clock() -> std::sync::mpsc::Sender<()> {
    let (release, released) = std::sync::mpsc::channel::<()>();
    drop(tokio::task::spawn_blocking(move || {
        let _ = released.recv();
    }));
    release
}

impl FakeTimers {
    /// Moves the paused clock forward by `by`, firing each timer due by then in deadline order, as
    /// the reference's `vi.advanceTimersByTime` does, then lets the runtime run what they woke.
    /// The runtime's own advance fires a timer at the deadline it rounds up to, so a sleep the
    /// test takes with the clock free to advance reaches exactly the deadlines a timer of the
    /// same span reaches.
    pub async fn advance(&self, by: Duration) {
        self.release.lock().unwrap().take();
        tokio::time::sleep(by).await;
        *self.release.lock().unwrap() = Some(hold_clock());
        for _ in 0..64 {
            tokio::task::yield_now().await;
        }
    }
}

impl Drop for FakeTimers {
    fn drop(&mut self) {
        self.release.lock().unwrap().take();
    }
}

/// Fakes the runtime's timers for the rest of the test.
pub fn fake_timers() -> FakeTimers {
    tokio::time::pause();
    FakeTimers {
        release: Mutex::new(Some(hold_clock())),
    }
}
