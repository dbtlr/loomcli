//! One connection's state, apart from its transport: the revision `initialize` negotiated, the
//! requests and subscriptions in flight by id, and the request-id rule.
//!
//! One stdio run is one connection, as is one initialize-era session over HTTP, and one
//! per-request POST is a connection of one request. Every message a request sends goes to the
//! [`Channel`] it began on: over stdio every request shares the output, and over HTTP each has its
//! own response.

use std::collections::HashMap;
use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::pin::{Pin, pin};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::task::{Context, Poll, Waker};

use serde_json::{Map, Value, json};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use crate::json_rpc::{
    ProtocolError, RequestId, error_codes, error_message, js_number, notification_message,
    result_message,
};
use crate::messages;
use crate::protocol::{ProgressSink, ProgressUpdate, ServerInfo, ToolCall, ToolResult, ToolSource};
use crate::revision::{
    HANDSHAKE_REVISIONS, LATEST_HANDSHAKE_REVISION, PROTOCOL_REVISION,
    UNDESCRIBED_HANDSHAKE_REVISION, supported_revisions,
};

pub(crate) const META_CLIENT_CAPABILITIES: &str = "io.modelcontextprotocol/clientCapabilities";
pub(crate) const META_PROTOCOL_VERSION: &str = "io.modelcontextprotocol/protocolVersion";
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

/// The methods whose handler answers on a stream over HTTP: a call, and a subscription.
const STREAMED_METHODS: [&str; 2] = ["subscriptions/listen", "tools/call"];

/// Takes a lock whether or not a holder panicked: the state stays consistent at every unlock, so
/// a panic elsewhere never stops the server.
pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// How a request is served. A request whose `params._meta` carries a protocol version is served on
/// the per-request revision, relying on no earlier request. Any other request is served on the
/// initialize-era revision its connection negotiated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Era {
    Handshake,
    PerRequest,
}

/// Where the messages of one request go: its progress, its answer, and, for a subscription, its
/// teardown. `end` says the request will send nothing more, answered or not, and may be called
/// more than once. Neither call waits, and neither calls back into the connection.
pub(crate) trait Channel: Send + Sync {
    fn send(&self, message: &Value);
    fn end(&self);
}

/// A channel the connection holds.
pub(crate) type ChannelRef = Arc<dyn Channel>;

/// Why a request was refused before its handler: its per-request `_meta` envelope, an unsupported
/// version included, or any other check, such as the method or the request id. The HTTP transport
/// maps an envelope refusal to its own status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RefusalStage {
    Envelope,
    Other,
}

/// A refusal before the handler, and the check that made it.
#[derive(Debug)]
pub(crate) struct Refusal {
    pub(crate) error: ProtocolError,
    pub(crate) stage: RefusalStage,
}

impl Refusal {
    fn other(error: ProtocolError) -> Self {
        Self {
            error,
            stage: RefusalStage::Other,
        }
    }
}

/// A request the connection admitted, which starts once its channel is ready. `streams` says its
/// handler answers on a stream over HTTP.
#[derive(Debug)]
pub(crate) struct Admitted {
    pub(crate) streams: bool,
    id: RequestId,
    method: String,
    params: Option<Value>,
}

/// What the connection does with one request: refuses it before any handler runs, or admits it.
#[derive(Debug)]
pub(crate) enum Admission {
    Refused(Refusal),
    Admitted(Admitted),
}

/// Why a request did not begin: the session holding its connection ended after the transport found
/// it, so the request has no session to begin on, and its channel was left untouched.
#[derive(Debug)]
pub(crate) struct Ended;

/// What the tasks serving requests share.
pub(crate) struct Shared<S> {
    pub(crate) info: ServerInfo,
    pub(crate) source: S,
}

/// A request in flight: the token that aborts it, the channel its messages go to, and whether it
/// is a `tools/call`, the only request whose handler sees that token.
struct Pending {
    generation: u64,
    token: CancellationToken,
    call: bool,
    channel: ChannelRef,
}

/// The mutable half of a connection.
#[derive(Default)]
struct State {
    /// Each request in flight by id. A cancelled request leaves the map, so its answer is dropped.
    in_flight: HashMap<RequestId, Pending>,
    /// Each open subscription by id, in the order they opened, with the channel its teardown goes
    /// to.
    subscriptions: Vec<(RequestId, ChannelRef)>,
    /// The revision `initialize` negotiated for the connection, once it has.
    handshake: Option<&'static str>,
    silenced: bool,
    /// Whether the session holding the connection ended, after which no request starts on it.
    ended: bool,
    /// How many started requests have not yet settled.
    running: usize,
    next_generation: u64,
}

struct Inner<S> {
    shared: Arc<Shared<S>>,
    state: Mutex<State>,
    settled: Notify,
    /// Called once the last request in flight settled, outside every lock.
    on_settled: Option<Box<dyn Fn() + Send + Sync>>,
}

/// A request's handler, started but not yet settled.
type Work = Pin<Box<dyn Future<Output = Result<Map<String, Value>, ProtocolError>> + Send>>;

/// One connection. Cloning it shares the connection.
pub(crate) struct Connection<S> {
    inner: Arc<Inner<S>>,
}

impl<S> Clone for Connection<S> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<S: ToolSource> Connection<S> {
    /// A connection with nothing in flight. `on_settled` hears each time its last request in
    /// flight settles.
    pub(crate) fn new(
        shared: Arc<Shared<S>>,
        on_settled: Option<Box<dyn Fn() + Send + Sync>>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                shared,
                state: Mutex::new(State::default()),
                settled: Notify::new(),
                on_settled,
            }),
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        locked(&self.inner.state)
    }

    /// Whether both handles are one connection.
    pub(crate) fn same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }

    /// The revision `initialize` negotiated, once it has.
    pub(crate) fn handshake(&self) -> Option<&'static str> {
        self.state().handshake
    }

    /// Whether a request is still in flight, which keeps a session from going idle.
    pub(crate) fn busy(&self) -> bool {
        !self.state().in_flight.is_empty()
    }

    /// Whether the run's signal ended the connection, after which it answers nothing.
    pub(crate) fn silenced(&self) -> bool {
        self.state().silenced
    }

    /// Judges one request before any handler runs. An `initialize` without per-request `_meta` is
    /// judged when it begins, because its answer is the connection's own.
    pub(crate) fn admit(&self, id: RequestId, method: String, params: Option<Value>) -> Admission {
        let state = self.state();
        if in_use(&state, &id) {
            return Admission::Refused(Refusal::other(id_in_use()));
        }
        let initialized = state.handshake.is_some();
        drop(state);
        let fault = if method == "initialize" && era_of(params.as_ref()) != Era::PerRequest {
            None
        } else {
            request_fault(&method, params.as_ref(), initialized)
        };
        match fault {
            Some(refusal) => Admission::Refused(refusal),
            None => Admission::Admitted(Admitted {
                streams: STREAMED_METHODS.contains(&method.as_str()),
                id,
                method,
                params,
            }),
        }
    }

    /// Starts an admitted request on its channel: `initialize` and `ping` are answered at once,
    /// `subscriptions/listen` opens a subscription, and every other request runs its handler.
    /// [`Ended`] when the connection's session ended since the request was admitted.
    pub(crate) fn begin(&self, admitted: Admitted, channel: ChannelRef) -> Result<(), Ended> {
        let Admitted {
            id, method, params, ..
        } = admitted;
        // An ended connection begins no request, whether or not the request runs a handler.
        // `start` checks again under the lock that counts its handler.
        if self.state().ended {
            return Err(Ended);
        }
        match method.as_str() {
            "initialize" => self.initialize(&id, params.as_ref(), &channel),
            "ping" => {
                let state = self.state();
                reply(&state, &channel, &result_message(&id, Map::new()));
            }
            "subscriptions/listen" => self.listen(id, channel),
            _ => return self.start(id, method, params, channel),
        }
        Ok(())
    }

    /// `notifications/cancelled` ends the request it names. Every other notification is ignored.
    pub(crate) fn notify(&self, method: &str, params: Option<&Value>) {
        if method != "notifications/cancelled" {
            return;
        }
        if let Some(id) = params
            .and_then(Value::as_object)
            .and_then(|params| params.get("requestId"))
            .and_then(RequestId::from_value)
        {
            self.cancel(&id);
        }
    }

    /// Cancels one request as its client asks: a subscription ends with no message, and a request
    /// in flight aborts and answers nothing. Its channel ends at once. An unknown or settled id is
    /// ignored.
    pub(crate) fn cancel(&self, id: &RequestId) {
        let mut state = self.state();
        if let Some(position) = state.subscriptions.iter().position(|(each, _)| each == id) {
            let (_, channel) = state.subscriptions.remove(position);
            channel.end();
        }
        if let Some(pending) = state.in_flight.remove(id) {
            pending.token.cancel();
            pending.channel.end();
        }
    }

    /// Aborts every request in flight. A call answers nothing and its channel ends at once; any
    /// other request is still answered when it settles, unless the connection was silenced.
    pub(crate) fn abort_all(&self) {
        let state = self.state();
        for pending in state.in_flight.values() {
            pending.token.cancel();
            if pending.call {
                pending.channel.end();
            }
        }
    }

    /// Ends the connection on the run's signal: every request aborts and answers nothing, and no
    /// request starts after it. An open subscription's teardown is still sent, by
    /// [`Self::close_subscriptions`].
    pub(crate) fn silence(&self) {
        self.state().silenced = true;
        self.abort_all();
    }

    /// Ends the connection with its session: every request in flight aborts, as
    /// [`Self::abort_all`] does, and a request that begins after it gets [`Ended`].
    pub(crate) fn end(&self) {
        self.state().ended = true;
        self.abort_all();
    }

    /// Resolves once every request started on the connection has settled.
    pub(crate) async fn settled(&self) {
        loop {
            let mut notified = pin!(self.inner.settled.notified());
            notified.as_mut().enable();
            if self.state().running == 0 {
                return;
            }
            notified.await;
        }
    }

    /// Cancels each open subscription and answers it with its closing result, on its own channel,
    /// which then ends. A silenced connection still sends this teardown, because the revision
    /// requires the notification of a server that tears down a subscription.
    pub(crate) fn close_subscriptions(&self) {
        let mut state = self.state();
        for (id, channel) in std::mem::take(&mut state.subscriptions) {
            channel.send(&notification_message(
                "notifications/cancelled",
                json!({ "requestId": id.to_value() }),
            ));
            let result = stamp(&self.inner.shared.info, Map::new(), Some(&id));
            channel.send(&result_message(&id, result));
            channel.end();
        }
    }

    /// Opens the connection on an initialize-era revision, once. The negotiated revision then
    /// serves every request that carries no per-request `_meta`.
    fn initialize(&self, id: &RequestId, params: Option<&Value>, channel: &ChannelRef) {
        let mut state = self.state();
        if let Some(negotiated) = state.handshake {
            let error = ProtocolError::new(
                error_codes::INVALID_REQUEST,
                messages::already_initialized(negotiated),
            );
            reply(&state, channel, &error_message(Some(id), &error));
            return;
        }
        let version = match negotiate(params) {
            Ok(version) => version,
            Err(error) => {
                reply(&state, channel, &error_message(Some(id), &error));
                return;
            }
        };
        state.handshake = Some(version);
        let mut result = Map::new();
        result.insert("protocolVersion".into(), json!(version));
        result.insert("capabilities".into(), json!({ "tools": {} }));
        result.insert(
            "serverInfo".into(),
            implementation_info(&self.inner.shared.info, version),
        );
        reply(&state, channel, &result_message(id, result));
    }

    /// Opens a subscription. The server offers no notification type, so it sends nothing more on
    /// it.
    fn listen(&self, id: RequestId, channel: ChannelRef) {
        let mut state = self.state();
        if state.silenced {
            channel.end();
            return;
        }
        if in_use(&state, &id) {
            refuse_in_use(&state, &channel, &id);
            return;
        }
        channel.send(&notification_message(
            "notifications/subscriptions/acknowledged",
            json!({
                "notifications": {},
                "_meta": { META_SUBSCRIPTION_ID: id.to_value() },
            }),
        ));
        state.subscriptions.push((id, channel));
    }

    /// Starts the handler of a request. Admitting and starting take the lock apart, so the checks
    /// that decide whether the handler runs are made again here, under the lock that counts it:
    /// a silenced connection ends the channel, an ended one gives [`Ended`], and an id another
    /// request took meanwhile is refused on the new channel, leaving that request untouched.
    fn start(
        &self,
        id: RequestId,
        method: String,
        params: Option<Value>,
        channel: ChannelRef,
    ) -> Result<(), Ended> {
        let call = method == "tools/call";
        let era = era_of(params.as_ref());
        let params = match params {
            Some(Value::Object(map)) => map,
            _ => Map::new(),
        };
        let token = CancellationToken::new();
        let generation = {
            let mut state = self.state();
            if state.silenced {
                channel.end();
                return Ok(());
            }
            if state.ended {
                return Err(Ended);
            }
            if in_use(&state, &id) {
                refuse_in_use(&state, &channel, &id);
                return Ok(());
            }
            let generation = state.next_generation;
            state.next_generation += 1;
            state.running += 1;
            state.in_flight.insert(
                id.clone(),
                Pending {
                    generation,
                    token: token.clone(),
                    call,
                    channel,
                },
            );
            generation
        };
        let progress = if call {
            progress_token(&params).map(|token| self.progress_sink(id.clone(), generation, token))
        } else {
            None
        };
        let work: Work = Box::pin(outcome(
            Arc::clone(&self.inner.shared),
            method.clone(),
            params,
            Handling {
                era,
                cancel: token,
                progress,
            },
        ));
        self.run_work(id, generation, method, work);
        Ok(())
    }

    /// The sink a call sends progress through: each update writes one `notifications/progress`
    /// on the call's channel, until the call is answered, cancelled, or aborted.
    fn progress_sink(&self, id: RequestId, generation: u64, token: Value) -> ProgressSink {
        let connection: Weak<Inner<S>> = Arc::downgrade(&self.inner);
        ProgressSink::new(move |update: ProgressUpdate| {
            let Some(inner) = connection.upgrade() else {
                return;
            };
            let state = locked(&inner.state);
            let Some(pending) = state.in_flight.get(&id) else {
                return;
            };
            if state.silenced || pending.generation != generation || pending.token.is_cancelled() {
                return;
            }
            pending
                .channel
                .send(&progress_message(token.clone(), update));
        })
    }

    /// Runs a handler until its first wait, as an async function in the reference does, so a
    /// handler that needs no I/O answers before the input's end can cancel it. A handler that
    /// waits moves to its own task.
    fn run_work(&self, id: RequestId, generation: u64, name: String, mut work: Work) {
        let mut cx = Context::from_waker(Waker::noop());
        let polled = catch_unwind(AssertUnwindSafe(|| work.as_mut().poll(&mut cx)));
        let outcome = match polled {
            Ok(Poll::Pending) => {
                let connection = self.clone();
                tokio::spawn(async move {
                    // The inner task keeps a panic in the handler from taking this one down.
                    let outcome = tokio::spawn(work)
                        .await
                        .unwrap_or_else(|_| Err(ProtocolError::internal(&name)));
                    connection.finish(&id, generation, outcome);
                });
                return;
            }
            Ok(Poll::Ready(outcome)) => outcome,
            Err(_) => Err(ProtocolError::internal(&name)),
        };
        self.finish(&id, generation, outcome);
    }

    /// Writes a request's answer once it settles, unless the client cancelled it meanwhile, and
    /// counts it settled. A call whose token is cancelled, which only shutdown or the run's signal
    /// does to a call still in the map, answers nothing either.
    fn finish(
        &self,
        id: &RequestId,
        generation: u64,
        outcome: Result<Map<String, Value>, ProtocolError>,
    ) {
        let idle = {
            let mut state = self.state();
            if state
                .in_flight
                .get(id)
                .is_some_and(|pending| pending.generation == generation)
                && let Some(pending) = state.in_flight.remove(id)
            {
                if pending.call && pending.token.is_cancelled() {
                    pending.channel.end();
                } else {
                    let message = match outcome {
                        Ok(result) => result_message(id, result),
                        Err(error) => error_message(Some(id), &error),
                    };
                    reply(&state, &pending.channel, &message);
                }
            }
            state.running = state.running.saturating_sub(1);
            state.in_flight.is_empty()
        };
        self.inner.settled.notify_waiters();
        if idle && let Some(on_settled) = &self.inner.on_settled {
            on_settled();
        }
    }
}

/// Whether a request in flight or an open subscription holds the id.
fn in_use(state: &State, id: &RequestId) -> bool {
    state.in_flight.contains_key(id) || state.subscriptions.iter().any(|(each, _)| each == id)
}

/// The refusal of a request whose id another request holds.
fn id_in_use() -> ProtocolError {
    ProtocolError::new(error_codes::INVALID_REQUEST, messages::ID_IN_USE)
}

/// Answers a request that lost its id to another between admission and start with the refusal
/// admission gives, on its own channel.
fn refuse_in_use(state: &State, channel: &ChannelRef, id: &RequestId) {
    reply(state, channel, &error_message(Some(id), &id_in_use()));
}

/// Sends one message on a channel, unless the connection was silenced, and ends it.
fn reply(state: &State, channel: &ChannelRef, message: &Value) {
    if !state.silenced {
        channel.send(message);
    }
    channel.end();
}

/// One `notifications/progress` on a call's token, passing the update on as given.
fn progress_message(token: Value, update: ProgressUpdate) -> Value {
    let mut params = Map::new();
    params.insert("progressToken".into(), token);
    params.insert("progress".into(), js_number(update.progress));
    if let Some(total) = update.total {
        params.insert("total".into(), js_number(total));
    }
    if let Some(message) = update.message {
        params.insert("message".into(), Value::String(message));
    }
    notification_message("notifications/progress", Value::Object(params))
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

/// One tool call, its result in the shape of its era. Admission already checked its name.
async fn call<S: ToolSource>(
    shared: &Shared<S>,
    params: &Map<String, Value>,
    handling: Handling,
) -> Result<Map<String, Value>, ProtocolError> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let result = shared
        .source
        .call_tool(ToolCall {
            name,
            arguments: params.get("arguments").cloned(),
            metadata: params.get("_meta").and_then(Value::as_object).cloned(),
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

/// A result as the per-request revision requires it: complete, with the server's identity in
/// `_meta`.
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

pub(crate) fn meta_of(params: Option<&Value>) -> Option<&Map<String, Value>> {
    params?.as_object()?.get("_meta")?.as_object()
}

/// The era a request selects: per-request when its `params._meta` names a protocol version.
pub(crate) fn era_of(params: Option<&Value>) -> Era {
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

/// The refusal of a request whose `_meta` lacks `key`, which names both ways in.
pub(crate) fn missing_meta(key: &str) -> ProtocolError {
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

/// The per-request check: every request carries the protocol version and the client's
/// capabilities in `params._meta`, and the version is the pinned revision.
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

/// The refusal a request other than `initialize` is answered with before any handler runs, if
/// any. Before `initialize`, a request for a method the server serves needs per-request `_meta`,
/// `ping` aside, which the initialize-era lifecycle allows at any time. A `tools/call` names its
/// tool with a string.
fn request_fault(method: &str, params: Option<&Value>, initialized: bool) -> Option<Refusal> {
    era_fault(method, params, initialized).or_else(|| {
        let named = params
            .and_then(Value::as_object)
            .and_then(|params| params.get("name"))
            .is_some_and(Value::is_string);
        (method == "tools/call" && !named).then(|| {
            Refusal::other(ProtocolError::new(
                error_codes::INVALID_PARAMS,
                messages::CALL_WITHOUT_TOOL,
            ))
        })
    })
}

/// The refusal of a method its era does not serve, or of a per-request envelope, if any.
fn era_fault(method: &str, params: Option<&Value>, initialized: bool) -> Option<Refusal> {
    if era_of(params) == Era::PerRequest {
        if !PER_REQUEST_METHODS.contains(&method) {
            return Some(Refusal::other(ProtocolError::new(
                error_codes::METHOD_NOT_FOUND,
                messages::method_not_served(PROTOCOL_REVISION),
            )));
        }
        return envelope_fault(params).map(|error| Refusal {
            error,
            stage: RefusalStage::Envelope,
        });
    }
    if !initialized && PER_REQUEST_METHODS.contains(&method) {
        return Some(Refusal::other(missing_meta(META_PROTOCOL_VERSION)));
    }
    (!HANDSHAKE_METHODS.contains(&method)).then(|| {
        Refusal::other(ProtocolError::new(
            error_codes::METHOD_NOT_FOUND,
            messages::METHOD_NOT_SERVED_INITIALIZED,
        ))
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use super::*;
    use crate::protocol::Tool;

    /// How long a wait that should end at once may take before the test fails.
    const PATIENCE: Duration = Duration::from_secs(10);

    /// A source whose call counts its start and keeps its token, then runs until the test releases
    /// it or its token is cancelled.
    #[derive(Clone, Default)]
    struct Waits {
        started: Arc<AtomicUsize>,
        tokens: Arc<Mutex<Vec<CancellationToken>>>,
        release: CancellationToken,
    }

    impl ToolSource for Waits {
        async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
            Ok(Vec::new())
        }

        async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, ProtocolError> {
            self.started.fetch_add(1, Ordering::SeqCst);
            locked(&self.tokens).push(call.cancel.clone());
            tokio::select! {
                () = self.release.cancelled() => {}
                () = call.cancel.cancelled() => {}
            }
            Ok(ToolResult::default())
        }
    }

    /// A channel that records each message and how often it ended.
    #[derive(Default)]
    struct Recorded {
        sent: Mutex<Vec<Value>>,
        ended: AtomicUsize,
    }

    impl Recorded {
        fn sent(&self) -> Vec<Value> {
            locked(&self.sent).clone()
        }

        fn ended(&self) -> bool {
            self.ended.load(Ordering::SeqCst) > 0
        }
    }

    impl Channel for Recorded {
        fn send(&self, message: &Value) {
            locked(&self.sent).push(message.clone());
        }

        fn end(&self) {
            self.ended.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn id(value: i64) -> RequestId {
        RequestId::from_value(&json!(value)).unwrap()
    }

    /// An initialized connection, so an initialize-era `tools/call` is served.
    fn initialized(source: Waits) -> Connection<Waits> {
        let connection = Connection::new(
            Arc::new(Shared {
                info: ServerInfo::new("fixture", "1.0.0"),
                source,
            }),
            None,
        );
        let Admission::Admitted(admitted) = connection.admit(
            id(0),
            "initialize".into(),
            Some(json!({ "protocolVersion": LATEST_HANDSHAKE_REVISION, "capabilities": {} })),
        ) else {
            panic!("initialize was refused");
        };
        connection
            .begin(admitted, Arc::new(Recorded::default()))
            .unwrap();
        connection
    }

    fn admitted_call(connection: &Connection<Waits>, request: i64) -> Admitted {
        match connection.admit(
            id(request),
            "tools/call".into(),
            Some(json!({ "name": "wait", "arguments": {} })),
        ) {
            Admission::Admitted(admitted) => admitted,
            Admission::Refused(refusal) => panic!("refused: {refusal:?}"),
        }
    }

    async fn settles(connection: &Connection<Waits>) {
        tokio::time::timeout(PATIENCE, connection.settled())
            .await
            .unwrap();
    }

    // Two requests with one id can both pass admission, as two POSTs of one session on two
    // worker threads do; the reference refuses the second with its id-in-use error.
    #[tokio::test]
    async fn refuses_a_second_request_that_begins_with_an_id_in_flight_and_leaves_the_first_running()
     {
        let source = Waits::default();
        let connection = initialized(source.clone());
        let first = admitted_call(&connection, 7);
        let second = admitted_call(&connection, 7);
        let (a, b) = (Arc::new(Recorded::default()), Arc::new(Recorded::default()));
        connection
            .begin(first, Arc::clone(&a) as ChannelRef)
            .unwrap();
        connection
            .begin(second, Arc::clone(&b) as ChannelRef)
            .unwrap();
        assert_eq!(source.started.load(Ordering::SeqCst), 1);
        assert_eq!(
            b.sent(),
            vec![json!({
                "jsonrpc": "2.0",
                "id": 7,
                "error": {
                    "code": -32600,
                    "message": "The request id is in use by a request still in flight. Send each request with an id no request in flight holds.",
                },
            })]
        );
        assert!(b.ended());
        assert!(a.sent().is_empty() && !a.ended());
        source.release.cancel();
        settles(&connection).await;
        let answered = a.sent();
        assert_eq!(answered.len(), 1);
        assert_eq!(answered[0]["id"], json!(7));
        assert!(answered[0].get("result").is_some(), "{answered:?}");
        assert!(a.ended());
    }

    #[tokio::test]
    async fn the_client_cancel_reaches_the_first_of_two_requests_with_one_id() {
        let source = Waits::default();
        let connection = initialized(source.clone());
        let first = admitted_call(&connection, 7);
        let second = admitted_call(&connection, 7);
        let a = Arc::new(Recorded::default());
        connection
            .begin(first, Arc::clone(&a) as ChannelRef)
            .unwrap();
        connection
            .begin(second, Arc::new(Recorded::default()))
            .unwrap();
        connection.cancel(&id(7));
        assert!(locked(&source.tokens)[0].is_cancelled());
        assert!(a.ended());
        settles(&connection).await;
    }

    // A session call can find its connection just before shutdown silences it, and begin after.
    #[tokio::test]
    async fn runs_no_handler_for_a_request_that_begins_after_the_connection_was_silenced() {
        let source = Waits::default();
        let connection = initialized(source.clone());
        let admitted = admitted_call(&connection, 8);
        connection.silence();
        let channel = Arc::new(Recorded::default());
        connection
            .begin(admitted, Arc::clone(&channel) as ChannelRef)
            .unwrap();
        assert_eq!(source.started.load(Ordering::SeqCst), 0);
        assert!(channel.sent().is_empty());
        assert!(channel.ended());
        settles(&connection).await;
    }

    // A session call can find its session just before a DELETE or its idle clock ends it, and
    // begin after.
    #[tokio::test]
    async fn runs_no_handler_and_leaves_the_channel_to_its_transport_once_the_connection_ended() {
        let source = Waits::default();
        let connection = initialized(source.clone());
        let admitted = admitted_call(&connection, 9);
        connection.end();
        let channel = Arc::new(Recorded::default());
        assert!(
            connection
                .begin(admitted, Arc::clone(&channel) as ChannelRef)
                .is_err()
        );
        assert_eq!(source.started.load(Ordering::SeqCst), 0);
        assert!(channel.sent().is_empty() && !channel.ended());
        settles(&connection).await;
    }

    // A ping runs no handler, and it too can find its session just before the session ends and
    // begin after: it is left to the transport, which answers as it does for an unknown session.
    #[tokio::test]
    async fn answers_no_ping_that_begins_once_the_connection_ended() {
        let connection = initialized(Waits::default());
        let Admission::Admitted(admitted) = connection.admit(id(10), "ping".into(), None) else {
            panic!("the ping was refused");
        };
        connection.end();
        let channel = Arc::new(Recorded::default());
        assert!(
            connection
                .begin(admitted, Arc::clone(&channel) as ChannelRef)
                .is_err()
        );
        assert!(channel.sent().is_empty() && !channel.ended());
    }
}
