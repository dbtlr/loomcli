//! The server: one run over one pair of streams, with the requests in flight, the open
//! subscriptions, and the dispatch of each method.

use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll, Waker};

use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio_util::sync::CancellationToken;

use crate::json_rpc::{
    Incoming, LineSplitter, ProtocolError, RequestId, classify, error_codes, error_message, frame,
    js_number, notification_message, result_message,
};
use crate::messages;
use crate::protocol::{ProgressSink, ProgressUpdate, ServerInfo, ToolCall, ToolResult, ToolSource};
use crate::revision::{
    HANDSHAKE_REVISIONS, LATEST_HANDSHAKE_REVISION, PROTOCOL_REVISION,
    UNDESCRIBED_HANDSHAKE_REVISION, supported_revisions,
};

const META_CLIENT_CAPABILITIES: &str = "io.modelcontextprotocol/clientCapabilities";
const META_PROTOCOL_VERSION: &str = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO: &str = "io.modelcontextprotocol/serverInfo";
const META_SUBSCRIPTION_ID: &str = "io.modelcontextprotocol/subscriptionId";

/// Every method a per-request one may call. Any other, `ping` included, is not found.
const PER_REQUEST_METHODS: [&str; 4] = [
    "server/discover",
    "subscriptions/listen",
    "tools/call",
    "tools/list",
];

/// Every method an initialized connection serves beside `initialize`.
const HANDSHAKE_METHODS: [&str; 3] = ["ping", "tools/call", "tools/list"];

/// How a request is served. A request whose `params._meta` carries a protocol version is served on
/// the per-request revision, relying on no earlier request. Any other request is served on the
/// initialize-era revision its connection negotiated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Era {
    Handshake,
    PerRequest,
}

/// A message from a task to the run loop.
#[derive(Debug)]
pub(crate) enum Event {
    /// A tool sent progress on its call.
    Progress {
        id: RequestId,
        generation: u64,
        token: Value,
        update: ProgressUpdate,
    },
    /// A request's handler settled.
    Done {
        id: RequestId,
        generation: u64,
        outcome: Result<Map<String, Value>, ProtocolError>,
    },
}

/// A request in flight: the token that aborts it, and whether it is a `tools/call`, the only
/// request whose handler sees that token.
#[derive(Debug)]
struct Pending {
    generation: u64,
    token: CancellationToken,
    call: bool,
}

/// A request's handler, started but not yet settled.
type Work = Pin<Box<dyn Future<Output = Result<Map<String, Value>, ProtocolError>> + Send>>;

/// What the tasks serving requests share.
struct Shared<S> {
    info: ServerInfo,
    source: S,
}

/// An MCP server over a stdio-style pair of streams, of both eras. A request carrying per-request
/// `_meta` is served on the per-request revision, which serves `server/discover`, `tools/list`,
/// `tools/call`, and `subscriptions/listen`. A connection that opens with `initialize` is served
/// on the initialize-era revision it negotiates, which serves `ping`, `tools/list`, and
/// `tools/call`. Every other method is not found.
///
/// The server speaks newline-delimited JSON-RPC 2.0: each message it writes is one compact JSON
/// document and a line feed. It knows nothing of the tools but what its [`ToolSource`] says.
pub struct McpServer<S> {
    shared: Arc<Shared<S>>,
}

impl<S: ToolSource> McpServer<S> {
    /// A server with an identity and the tools it serves.
    #[must_use]
    pub fn new(info: ServerInfo, source: S) -> Self {
        Self {
            shared: Arc::new(Shared { info, source }),
        }
    }

    /// Serves one client until the input ends. When the input ends, the server cancels every call
    /// in flight, answers none of them, waits for each to settle, closes each open subscription,
    /// and returns.
    ///
    /// # Errors
    ///
    /// Returns the error that ended the reading of `input`, after the same wind-down. A write
    /// the client can no longer read is dropped and is not an error.
    pub async fn run<R, W>(&self, input: R, output: W) -> io::Result<()>
    where
        R: AsyncBufRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        self.run_until(input, output, CancellationToken::new())
            .await
    }

    /// Serves one client until the input ends or `shutdown` is cancelled. When `shutdown` is
    /// cancelled, before or after the input ends, the server stops reading, cancels every call,
    /// writes nothing more, and returns once every call has settled. A token already cancelled
    /// reads and writes nothing.
    ///
    /// # Errors
    ///
    /// Returns the error that ended the reading of `input`, after the same wind-down.
    pub async fn run_until<R, W>(
        &self,
        mut input: R,
        output: W,
        shutdown: CancellationToken,
    ) -> io::Result<()>
    where
        R: AsyncBufRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        let (events_tx, inbox) = unbounded_channel();
        let (lines_tx, lines_rx) = unbounded_channel();
        let serve = async {
            let mut session = Session {
                shared: Arc::clone(&self.shared),
                out: lines_tx,
                events: events_tx,
                inbox,
                in_flight: HashMap::new(),
                subscriptions: Vec::new(),
                splitter: LineSplitter::default(),
                handshake: None,
                silenced: false,
                running: 0,
                next_generation: 0,
            };
            let read = if shutdown.is_cancelled() {
                session.silence();
                Ok(())
            } else {
                session.read_loop(&mut input, &shutdown).await
            };
            session.end(&shutdown).await;
            read
        };
        // The writer runs beside the session, so a client that is slow to read never stops the
        // server from reading. It ends once the session has dropped its end of the queue.
        let (read, ()) = tokio::join!(serve, write_lines(output, lines_rx, &shutdown));
        read
    }
}

/// Writes each queued line in order. The caller's token abandons any write still pending, and a
/// write the client can no longer read has no one to report to.
async fn write_lines<W: AsyncWrite + Unpin>(
    mut output: W,
    mut lines: UnboundedReceiver<String>,
    shutdown: &CancellationToken,
) {
    while let Some(line) = lines.recv().await {
        let write = async {
            let _ = output.write_all(line.as_bytes()).await;
            let _ = output.flush().await;
        };
        tokio::select! {
            biased;
            () = shutdown.cancelled() => return,
            () = write => {}
        }
    }
}

/// The next chunk of the input, empty at its end. Cancel safe: nothing is taken from the input
/// before the chunk is returned.
async fn next_chunk<R: AsyncBufRead + Unpin>(input: &mut R) -> io::Result<Vec<u8>> {
    let chunk = input.fill_buf().await?.to_vec();
    input.consume(chunk.len());
    Ok(chunk)
}

/// One run of a server over one pair of streams.
struct Session<S> {
    shared: Arc<Shared<S>>,
    /// The framed lines waiting for the writer.
    out: UnboundedSender<String>,
    events: UnboundedSender<Event>,
    inbox: UnboundedReceiver<Event>,
    /// Each request in flight by id. A cancelled request leaves the map, so its answer is dropped.
    in_flight: HashMap<RequestId, Pending>,
    subscriptions: Vec<RequestId>,
    splitter: LineSplitter,
    /// The revision `initialize` negotiated for the connection, once it has.
    handshake: Option<&'static str>,
    silenced: bool,
    /// How many request tasks have not yet reported they settled.
    running: usize,
    next_generation: u64,
}

impl<S: ToolSource> Session<S> {
    /// Reads and serves until the input ends or the shutdown token is cancelled.
    async fn read_loop<R: AsyncBufRead + Unpin>(
        &mut self,
        input: &mut R,
        shutdown: &CancellationToken,
    ) -> io::Result<()> {
        loop {
            tokio::select! {
                biased;
                () = shutdown.cancelled() => {
                    self.silence();
                    return Ok(());
                }
                event = self.inbox.recv() => {
                    if let Some(event) = event {
                        self.handle_event(event);
                    }
                }
                chunk = next_chunk(input) => {
                    let chunk = chunk?;
                    if chunk.is_empty() {
                        return Ok(());
                    }
                    for line in self.splitter.push(&chunk) {
                        self.receive(&line);
                    }
                }
            }
        }
    }

    /// Ends the run once the input has ended: a last line with no line feed is handled, every call
    /// is cancelled and answers nothing, and once each has settled, each open subscription is
    /// cancelled and answered with its closing result. After the shutdown token, nothing is
    /// written.
    async fn end(&mut self, shutdown: &CancellationToken) {
        for line in self.splitter.end() {
            self.receive(&line);
        }
        self.abort_all();
        while self.running > 0 {
            tokio::select! {
                biased;
                () = shutdown.cancelled(), if !self.silenced => self.silence(),
                event = self.inbox.recv() => {
                    if let Some(event) = event {
                        self.handle_event(event);
                    }
                }
            }
        }
        self.close_subscriptions();
    }

    /// Cancels each open subscription and answers it with its closing result.
    fn close_subscriptions(&mut self) {
        for id in std::mem::take(&mut self.subscriptions) {
            self.send(notification_message(
                "notifications/cancelled",
                json!({ "requestId": id.to_value() }),
            ));
            let result = self.stamp(Map::new(), Some(&id));
            self.send(result_message(&id, result));
        }
    }

    /// Ends the run on the caller's token: every call is cancelled, and the server writes nothing
    /// more, an open subscription's closing result included.
    fn silence(&mut self) {
        self.silenced = true;
        self.subscriptions.clear();
        self.abort_all();
    }

    fn abort_all(&self) {
        for pending in self.in_flight.values() {
            pending.token.cancel();
        }
    }

    /// Handles one line the client wrote.
    fn receive(&mut self, line: &str) {
        if self.silenced {
            return;
        }
        match classify(line) {
            Incoming::Invalid { id, error } => {
                self.send(error_message(id.as_ref(), &error));
            }
            Incoming::Notification { method, params } => self.notify(&method, params.as_ref()),
            Incoming::Request { id, method, params } => {
                self.request(id, method, params);
            }
            Incoming::Response => {}
        }
    }

    /// `notifications/cancelled` ends the request it names. Every other notification is ignored.
    fn notify(&mut self, method: &str, params: Option<&Value>) {
        if method != "notifications/cancelled" {
            return;
        }
        let Some(id) = params
            .and_then(Value::as_object)
            .and_then(|params| params.get("requestId"))
            .and_then(RequestId::from_value)
        else {
            return;
        };
        if let Some(position) = self.subscriptions.iter().position(|each| *each == id) {
            self.subscriptions.remove(position);
            return;
        }
        if let Some(pending) = self.in_flight.remove(&id) {
            pending.token.cancel();
        }
    }

    fn request(&mut self, id: RequestId, method: String, params: Option<Value>) {
        let fault = self.id_in_use(&id).or_else(|| {
            if method == "initialize" {
                None
            } else {
                request_fault(&method, params.as_ref(), self.handshake.is_some())
            }
        });
        if let Some(fault) = fault {
            self.send(error_message(Some(&id), &fault));
        } else if method == "initialize" {
            self.initialize(&id, params.as_ref());
        } else if method == "ping" {
            self.send(result_message(&id, Map::new()));
        } else if method == "subscriptions/listen" {
            self.listen(id);
        } else {
            self.start(id, method, params);
        }
    }

    /// Opens the connection on an initialize-era revision, once. The negotiated revision then
    /// serves every request that carries no per-request `_meta`.
    fn initialize(&mut self, id: &RequestId, params: Option<&Value>) {
        if let Some(negotiated) = self.handshake {
            let error = ProtocolError::new(
                error_codes::INVALID_REQUEST,
                messages::already_initialized(negotiated),
            );
            self.send(error_message(Some(id), &error));
            return;
        }
        let version = match negotiate(params) {
            Ok(version) => version,
            Err(error) => {
                self.send(error_message(Some(id), &error));
                return;
            }
        };
        self.handshake = Some(version);
        let mut result = Map::new();
        result.insert("protocolVersion".into(), json!(version));
        result.insert("capabilities".into(), json!({ "tools": {} }));
        result.insert(
            "serverInfo".into(),
            implementation_info(&self.shared.info, version),
        );
        self.send(result_message(id, result));
    }

    /// The error for a request whose id a call or subscription still in flight holds. The request
    /// in flight keeps its id and runs untouched, so its answer stays the only one under that id.
    fn id_in_use(&self, id: &RequestId) -> Option<ProtocolError> {
        if self.in_flight.contains_key(id) || self.subscriptions.contains(id) {
            Some(ProtocolError::new(
                error_codes::INVALID_REQUEST,
                messages::ID_IN_USE,
            ))
        } else {
            None
        }
    }

    /// Opens a subscription. The server offers no notification type, so it sends nothing more on it.
    fn listen(&mut self, id: RequestId) {
        let acknowledged = notification_message(
            "notifications/subscriptions/acknowledged",
            json!({
                "notifications": {},
                "_meta": { META_SUBSCRIPTION_ID: id.to_value() },
            }),
        );
        self.subscriptions.push(id);
        self.send(acknowledged);
    }

    /// Starts the handler of a request on its own task.
    fn start(&mut self, id: RequestId, method: String, params: Option<Value>) {
        let generation = self.next_generation;
        self.next_generation += 1;
        let token = CancellationToken::new();
        let call = method == "tools/call";
        let era = era_of(params.as_ref());
        let params = match params {
            Some(Value::Object(map)) => map,
            _ => Map::new(),
        };
        let progress = if call {
            progress_token(&params)
                .map(|token| ProgressSink::new(self.events.clone(), id.clone(), generation, token))
        } else {
            None
        };
        self.in_flight.insert(
            id.clone(),
            Pending {
                generation,
                token: token.clone(),
                call,
            },
        );
        let name = method.clone();
        let work: Work = Box::pin(outcome(
            Arc::clone(&self.shared),
            method,
            params,
            Handling {
                era,
                cancel: token,
                progress,
            },
        ));
        self.run_work(id, generation, name, work);
    }

    /// Runs a handler until its first wait, as an async function in the reference does, so a
    /// handler that needs no I/O answers before the input's end can cancel it. A handler that
    /// waits moves to its own task.
    fn run_work(&mut self, id: RequestId, generation: u64, name: String, mut work: Work) {
        let mut cx = Context::from_waker(Waker::noop());
        let polled = catch_unwind(AssertUnwindSafe(|| work.as_mut().poll(&mut cx)));
        let outcome = match polled {
            Ok(Poll::Pending) => {
                self.running += 1;
                self.spawn_rest(id, generation, name, work);
                return;
            }
            Ok(Poll::Ready(outcome)) => outcome,
            Err(_) => Err(ProtocolError::internal(&name)),
        };
        // Progress the handler sent before it settled is written before its answer.
        self.drain_events();
        self.answer(id, generation, outcome);
    }

    /// Finishes a handler that waited, on a task of its own, and reports it to the run loop.
    /// The inner task keeps a panic in the handler from taking the outer one down.
    fn spawn_rest(&self, id: RequestId, generation: u64, name: String, work: Work) {
        let events = self.events.clone();
        tokio::spawn(async move {
            let outcome = tokio::spawn(work)
                .await
                .unwrap_or_else(|_| Err(ProtocolError::internal(&name)));
            // A closed channel means the run ended, and then there is no client to answer.
            let _ = events.send(Event::Done {
                id,
                generation,
                outcome,
            });
        });
    }

    /// Handles every event already queued.
    fn drain_events(&mut self) {
        while let Ok(event) = self.inbox.try_recv() {
            self.handle_event(event);
        }
    }

    fn handle_event(&mut self, event: Event) {
        match event {
            Event::Progress {
                id,
                generation,
                token,
                update,
            } => self.progress(&id, generation, token, update),
            Event::Done {
                id,
                generation,
                outcome,
            } => {
                self.running = self.running.saturating_sub(1);
                self.answer(id, generation, outcome);
            }
        }
    }

    /// Writes a request's answer once it settles, unless the client cancelled it meanwhile. A call
    /// whose token is cancelled, which only shutdown does to a call still in the map, answers
    /// nothing either.
    fn answer(
        &mut self,
        id: RequestId,
        generation: u64,
        outcome: Result<Map<String, Value>, ProtocolError>,
    ) {
        match self.in_flight.get(&id) {
            Some(pending) if pending.generation == generation => {}
            _ => return,
        }
        let Some(pending) = self.in_flight.remove(&id) else {
            return;
        };
        if pending.call && pending.token.is_cancelled() {
            return;
        }
        let message = match outcome {
            Ok(result) => result_message(&id, result),
            Err(error) => error_message(Some(&id), &error),
        };
        self.send(message);
    }

    /// Writes one `notifications/progress` for a call that is still in flight and not aborted.
    fn progress(&mut self, id: &RequestId, generation: u64, token: Value, update: ProgressUpdate) {
        match self.in_flight.get(id) {
            Some(pending) if pending.generation == generation && !pending.token.is_cancelled() => {}
            _ => return,
        }
        let mut params = Map::new();
        params.insert("progressToken".into(), token);
        params.insert("progress".into(), js_number(update.progress));
        if let Some(total) = update.total {
            params.insert("total".into(), js_number(total));
        }
        if let Some(message) = update.message {
            params.insert("message".into(), Value::String(message));
        }
        self.send(notification_message(
            "notifications/progress",
            Value::Object(params),
        ));
    }

    /// A result as the revision requires it: complete, with the server's identity in `_meta`.
    fn stamp(
        &self,
        result: Map<String, Value>,
        subscription: Option<&RequestId>,
    ) -> Map<String, Value> {
        stamp(&self.shared.info, result, subscription)
    }

    /// Queues one message as one line, unless the run was ended by the caller's token. The call
    /// never waits for the client to read.
    fn send(&mut self, message: Value) {
        if self.silenced {
            return;
        }
        // A closed queue means the writer ended, and then there is no client to tell.
        let _ = self.out.send(frame(&message));
    }
}

/// What a request's handler receives beside its params.
struct Handling {
    era: Era,
    cancel: CancellationToken,
    progress: Option<ProgressSink>,
}

/// The request's result in the shape of its era, stamped on the per-request revision, or the
/// error to answer it with.
async fn outcome<S: ToolSource>(
    shared: Arc<Shared<S>>,
    method: String,
    params: Map<String, Value>,
    handling: Handling,
) -> Result<Map<String, Value>, ProtocolError> {
    let era = handling.era;
    let result = dispatch(&shared, &method, &params, handling).await?;
    Ok(if era == Era::PerRequest {
        stamp(&shared.info, result, None)
    } else {
        result
    })
}

async fn dispatch<S: ToolSource>(
    shared: &Shared<S>,
    method: &str,
    params: &Map<String, Value>,
    handling: Handling,
) -> Result<Map<String, Value>, ProtocolError> {
    match method {
        "server/discover" => {
            let mut result = Map::new();
            result.insert("supportedVersions".into(), json!(supported_revisions()));
            result.insert("capabilities".into(), json!({ "tools": {} }));
            result.insert("ttlMs".into(), json!(0));
            result.insert("cacheScope".into(), json!("private"));
            Ok(result)
        }
        "tools/list" => list(shared, params, handling.era).await,
        "tools/call" => call(shared, params, handling).await,
        _ => Err(ProtocolError::internal(method)),
    }
}

/// The tool listing: one page, which no client caches on the per-request revision.
async fn list<S: ToolSource>(
    shared: &Shared<S>,
    params: &Map<String, Value>,
    era: Era,
) -> Result<Map<String, Value>, ProtocolError> {
    if params.contains_key("cursor") {
        return Err(ProtocolError::new(
            error_codes::INVALID_PARAMS,
            messages::UNKNOWN_CURSOR,
        ));
    }
    let tools = shared.source.list_tools().await?;
    let tools = serde_json::to_value(&tools).map_err(|_| ProtocolError::internal("tools/list"))?;
    let mut result = Map::new();
    result.insert("tools".into(), tools);
    if era == Era::PerRequest {
        result.insert("ttlMs".into(), json!(0));
        result.insert("cacheScope".into(), json!("private"));
    }
    Ok(result)
}

/// One tool call, its result in the shape of its era.
async fn call<S: ToolSource>(
    shared: &Shared<S>,
    params: &Map<String, Value>,
    handling: Handling,
) -> Result<Map<String, Value>, ProtocolError> {
    let Some(Value::String(name)) = params.get("name") else {
        return Err(ProtocolError::new(
            error_codes::INVALID_PARAMS,
            messages::CALL_WITHOUT_TOOL,
        ));
    };
    let result = shared
        .source
        .call_tool(ToolCall {
            name: name.clone(),
            arguments: params.get("arguments").cloned(),
            cancel: handling.cancel,
            progress: handling.progress,
        })
        .await?;
    Ok(call_result(result, handling.era))
}

/// The text items of a result: the nonempty texts in order, or one empty item when all are empty.
fn content_of(texts: [&str; 2]) -> Vec<Value> {
    let written: Vec<Value> = texts
        .iter()
        .filter(|text| !text.is_empty())
        .map(|text| json!({ "type": "text", "text": text }))
        .collect();
    if written.is_empty() {
        vec![json!({ "type": "text", "text": "" })]
    } else {
        written
    }
}

/// A call's result as an era holds it. An initialize-era revision holds structured content as a
/// JSON object alone; any other value is left to the text content, which already carries it.
fn call_result(result: ToolResult, era: Era) -> Map<String, Value> {
    let texts = if result.is_error {
        [result.messages.as_str(), result.output.as_str()]
    } else {
        [result.output.as_str(), result.messages.as_str()]
    };
    let mut map = Map::new();
    map.insert("content".into(), Value::Array(content_of(texts)));
    map.insert("isError".into(), Value::Bool(result.is_error));
    if let Some(structured) = result.structured_content
        && (era == Era::PerRequest || structured.is_object())
    {
        map.insert("structuredContent".into(), structured);
    }
    map
}

/// A result as the per-request revision requires it.
fn stamp(
    info: &ServerInfo,
    result: Map<String, Value>,
    subscription: Option<&RequestId>,
) -> Map<String, Value> {
    let mut meta = Map::new();
    if let Some(id) = subscription {
        meta.insert(META_SUBSCRIPTION_ID.into(), id.to_value());
    }
    meta.insert(
        META_SERVER_INFO.into(),
        serde_json::to_value(info).unwrap_or(Value::Null),
    );
    let mut stamped = Map::new();
    stamped.insert("resultType".into(), json!("complete"));
    stamped.extend(result);
    stamped.insert("_meta".into(), Value::Object(meta));
    stamped
}

/// A progress token is a string or a number, as a request id is.
fn progress_token(params: &Map<String, Value>) -> Option<Value> {
    let token = params.get("_meta")?.as_object()?.get("progressToken")?;
    RequestId::from_value(token).map(|token| token.to_value())
}

fn meta_of(params: Option<&Value>) -> Option<&Map<String, Value>> {
    params?.as_object()?.get("_meta")?.as_object()
}

/// The era a request selects: per-request when its `params._meta` names a protocol version.
fn era_of(params: Option<&Value>) -> Era {
    if meta_of(params).is_some_and(|meta| meta.contains_key(META_PROTOCOL_VERSION)) {
        Era::PerRequest
    } else {
        Era::Handshake
    }
}

fn unsupported_version(requested: &str) -> ProtocolError {
    ProtocolError::new(
        error_codes::UNSUPPORTED_PROTOCOL_VERSION,
        messages::version_not_spoken(PROTOCOL_REVISION, &HANDSHAKE_REVISIONS.join(" or ")),
    )
    .with_data(json!({ "supported": supported_revisions(), "requested": requested }))
}

fn missing_meta(key: &str) -> ProtocolError {
    ProtocolError::new(
        error_codes::INVALID_PARAMS,
        messages::meta_key_missing(key, META_PROTOCOL_VERSION, META_CLIENT_CAPABILITIES),
    )
}

/// The version an `initialize` request negotiates: the one it asks for when the server serves it,
/// and otherwise the latest the server serves. A request with no version string or no
/// capabilities object is answered with the error.
fn negotiate(params: Option<&Value>) -> Result<&'static str, ProtocolError> {
    let params = params.and_then(Value::as_object);
    let requested = params
        .and_then(|params| params.get("protocolVersion"))
        .and_then(Value::as_str);
    let capabilities = params
        .and_then(|params| params.get("capabilities"))
        .filter(|capabilities| capabilities.is_object());
    match (requested, capabilities) {
        (Some(requested), Some(_)) => Ok(HANDSHAKE_REVISIONS
            .iter()
            .copied()
            .find(|revision| *revision == requested)
            .unwrap_or(LATEST_HANDSHAKE_REVISION)),
        _ => Err(ProtocolError::new(
            error_codes::INVALID_PARAMS,
            messages::INITIALIZE_INCOMPLETE,
        )),
    }
}

/// The server's identity as an initialize result carries it. The implementation info of the
/// earliest revision served has no description, which later revisions added.
fn implementation_info(info: &ServerInfo, version: &str) -> Value {
    let mut named = info.clone();
    if version == UNDESCRIBED_HANDSHAKE_REVISION {
        named.description = None;
    }
    serde_json::to_value(named).unwrap_or(Value::Null)
}

/// The per-request check: every request carries the protocol version and the client's capabilities
/// in `params._meta`, and the version is the pinned revision.
fn envelope_fault(params: Option<&Value>) -> Option<ProtocolError> {
    let meta = meta_of(params);
    let Some(version) = meta
        .and_then(|meta| meta.get(META_PROTOCOL_VERSION))
        .and_then(Value::as_str)
    else {
        return Some(missing_meta(META_PROTOCOL_VERSION));
    };
    if !meta
        .and_then(|meta| meta.get(META_CLIENT_CAPABILITIES))
        .is_some_and(Value::is_object)
    {
        return Some(missing_meta(META_CLIENT_CAPABILITIES));
    }
    (version != PROTOCOL_REVISION).then(|| unsupported_version(version))
}

/// The error a request other than `initialize` is answered with before any handler runs, if any.
/// Before `initialize`, a request for a method the server serves needs per-request `_meta`,
/// `ping` aside, which the initialize-era lifecycle allows at any time.
fn request_fault(method: &str, params: Option<&Value>, initialized: bool) -> Option<ProtocolError> {
    if era_of(params) == Era::PerRequest {
        return if PER_REQUEST_METHODS.contains(&method) {
            envelope_fault(params)
        } else {
            Some(ProtocolError::new(
                error_codes::METHOD_NOT_FOUND,
                messages::method_not_served(PROTOCOL_REVISION),
            ))
        };
    }
    if !initialized && PER_REQUEST_METHODS.contains(&method) {
        return Some(missing_meta(META_PROTOCOL_VERSION));
    }
    (!HANDSHAKE_METHODS.contains(&method)).then(|| {
        ProtocolError::new(
            error_codes::METHOD_NOT_FOUND,
            messages::METHOD_NOT_SERVED_INITIALIZED,
        )
    })
}
