//! The streamable HTTP transport: it answers each request of the sockets its caller hands it, for
//! both eras. A per-request message is a connection of one request, and an initialize-era client
//! gets a session, which holds one connection as one stdio run does. Listening, the address, and
//! every operator sentence stay with the caller.
//!
//! Each socket is served by hyper's HTTP/1.1 connection. The transport's rules are hand-written
//! over it, in order: the `Origin` check, the authorize hook, the path, the method, a POST's
//! content type and declared length, the body limit as the body arrives, then the message.

mod body;
mod messages;
mod session;
mod socket;

use std::collections::HashMap;
use std::fmt;
use std::future::{Future, poll_fn};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hyper::body::{Body, Incoming};
use hyper::header::{CONNECTION, HeaderMap, HeaderValue};
use hyper::{Method, Request, Response, StatusCode, Version};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

use self::body::{
    Abort, Hooks, ResponseBody, SingleChannel, empty, event_stream, json, single_answer,
};
use self::session::HttpSession;
use self::socket::{SocketState, serve_socket};
use crate::connection::{
    Admission, Admitted, Connection, Era, META_CLIENT_CAPABILITIES, META_PROTOCOL_VERSION, Refusal,
    RefusalStage, Shared, era_of, locked, meta_of, missing_meta,
};
use crate::json_rpc::{
    BODY_WORDING, Incoming as Message, ProtocolError, RequestId, classify, error_codes,
    error_message, result_message,
};
use crate::protocol::ToolSource;
use crate::revision::PROTOCOL_REVISION;

/// The largest POST body the transport reads by default: 4 MiB.
const DEFAULT_MAX_BODY_BYTES: u64 = 4_194_304;
/// How long an initialize-era session may sit idle by default: 30 minutes.
const DEFAULT_SESSION_IDLE: Duration = Duration::from_secs(1_800);
/// The one path the server answers.
const ENDPOINT: &str = "/mcp";

/// A copy of one HTTP request's headers, as the authorize hook reads them. Names compare without
/// regard to case, and each value is the header's bytes read one byte to a character, as the
/// platform's `Headers` reads them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RequestHeaders {
    /// Each header in the order hyper holds them, its name in lowercase.
    entries: Vec<(String, String)>,
}

impl RequestHeaders {
    fn of(headers: &HeaderMap) -> Self {
        Self {
            entries: headers
                .iter()
                .map(|(name, value)| (name.as_str().to_owned(), latin1(value.as_bytes())))
                .collect(),
        }
    }

    /// The value of a header, its repeats joined by `, `, or `None` when the request does not
    /// carry it.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<String> {
        let values: Vec<&str> = self
            .entries
            .iter()
            .filter(|(each, _)| each.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
            .collect();
        (!values.is_empty()).then(|| values.join(", "))
    }

    /// Each header as its name, in lowercase, and its value, one entry per line the request
    /// carried.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.entries
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
    }
}

/// Builds the headers an authorize hook reads from `(name, value)` pairs, one per header line in
/// order, so a test can call a hook as the transport does. Each name is kept in lowercase, as the
/// transport keeps a request's.
///
/// ```
/// use loomcli_mcp::RequestHeaders;
///
/// let headers: RequestHeaders = [("Authorization", "Bearer sesame"), ("X-Tag", "a"), ("x-tag", "b")]
///     .into_iter()
///     .collect();
/// assert_eq!(headers.get("authorization").as_deref(), Some("Bearer sesame"));
/// assert_eq!(headers.get("X-Tag").as_deref(), Some("a, b"));
/// ```
impl<N: Into<String>, V: Into<String>> FromIterator<(N, V)> for RequestHeaders {
    fn from_iter<I: IntoIterator<Item = (N, V)>>(pairs: I) -> Self {
        Self {
            entries: pairs
                .into_iter()
                .map(|(name, value)| (name.into().to_ascii_lowercase(), value.into()))
                .collect(),
        }
    }
}

/// The bytes read one to a character, as `node:http` reads a header.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| char::from(*byte)).collect()
}

/// What an authorize hook answers for one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Authorization {
    /// The request goes on.
    Allowed,
    /// The request is answered 401 with `WWW-Authenticate: Bearer` and no body.
    Refused,
    /// The hook failed: the request is answered 500 with `-32603`, and the server keeps serving.
    Failed,
}

/// What hears the `Origin` of each request refused for carrying one.
type OriginHeard = Arc<dyn Fn(&str) + Send + Sync>;

/// What chooses the headers of a JSON answer from the answer.
type ChooseHeaders = Box<dyn FnOnce(&Value) -> Vec<(&'static str, String)> + Send>;

/// The hook that judges a request from a copy of its headers.
type Authorizer = Arc<
    dyn Fn(RequestHeaders) -> Pin<Box<dyn Future<Output = Authorization> + Send>> + Send + Sync,
>;

/// How the transport serves: the hook that judges each request's headers, what it reports of a
/// request refused for its `Origin`, the body limit, the session idle interval, and the shutdown
/// token, which stops it.
#[must_use]
pub struct HttpOptions {
    authorize: Option<Authorizer>,
    on_origin_refused: Option<OriginHeard>,
    max_body_bytes: u64,
    session_idle: Duration,
    shutdown: CancellationToken,
}

impl fmt::Debug for HttpOptions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HttpOptions")
            .field("authorize", &self.authorize.is_some())
            .field("max_body_bytes", &self.max_body_bytes)
            .field("session_idle", &self.session_idle)
            .finish_non_exhaustive()
    }
}

impl HttpOptions {
    /// Serves until `shutdown` is cancelled, with no authorize hook, a body limit of 4 MiB, and a
    /// session idle interval of 30 minutes.
    pub fn new(shutdown: CancellationToken) -> Self {
        Self {
            authorize: None,
            on_origin_refused: None,
            max_body_bytes: DEFAULT_MAX_BODY_BYTES,
            session_idle: DEFAULT_SESSION_IDLE,
            shutdown,
        }
    }

    /// Judges every request from a copy of its headers, after the `Origin` check and before the
    /// body is read.
    pub fn authorize<F, Fut>(mut self, authorize: F) -> Self
    where
        F: Fn(RequestHeaders) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Authorization> + Send + 'static,
    {
        self.authorize = Some(Arc::new(move |headers| Box::pin(authorize(headers))));
        self
    }

    /// Hears the `Origin` of each request refused for carrying one.
    pub fn on_origin_refused(mut self, heard: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.on_origin_refused = Some(Arc::new(heard));
        self
    }

    /// The largest POST body the transport reads, in bytes.
    pub fn max_body_bytes(mut self, limit: u64) -> Self {
        self.max_body_bytes = limit;
        self
    }

    /// How long an initialize-era session may sit idle before it ends.
    pub fn session_idle(mut self, idle: Duration) -> Self {
        self.session_idle = idle;
        self
    }
}

/// The streamable HTTP transport of one server. The caller hands it each socket its listener
/// accepts and stops listening when the shutdown token is cancelled; the transport then aborts
/// every call, tears down each per-request subscription, ends every stream, and closes every
/// HTTP connection. [`HttpTransport::closed`] resolves once every call has settled.
pub struct HttpTransport<S> {
    inner: Arc<Transport<S>>,
}

impl<S> fmt::Debug for HttpTransport<S> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HttpTransport")
            .finish_non_exhaustive()
    }
}

impl<S: ToolSource> HttpTransport<S> {
    pub(crate) fn new(shared: Arc<Shared<S>>, options: HttpOptions) -> Self {
        let inner = Arc::new(Transport {
            shared,
            options,
            state: Mutex::new(TransportState::default()),
            closed: CancellationToken::new(),
        });
        tokio::spawn(Arc::clone(&inner).shut_down_on_signal());
        Self { inner }
    }

    /// Serves one socket the caller's listener accepted, on a task of its own. A socket handed
    /// over after shutdown closes at once.
    pub fn watch(&self, socket: TcpStream) {
        if self.inner.options.shutdown.is_cancelled() {
            return;
        }
        tokio::spawn(serve_socket(Arc::clone(&self.inner), socket));
    }

    /// Resolves once the shutdown token is cancelled and every call has settled.
    pub async fn closed(&self) {
        self.inner.closed.cancelled().await;
    }
}

/// The transport's state: each session by id, and every connection with a request or
/// subscription open, the sessions' included.
struct TransportState<S> {
    sessions: HashMap<String, Arc<HttpSession<S>>>,
    connections: Vec<Connection<S>>,
    stopped: bool,
}

impl<S> Default for TransportState<S> {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
            connections: Vec::new(),
            stopped: false,
        }
    }
}

/// An answer the transport sends before it has consumed the body, which closes the connection.
struct Early {
    status: StatusCode,
    body: Option<Value>,
    headers: Vec<(&'static str, String)>,
}

impl Early {
    fn new(status: StatusCode) -> Self {
        Self {
            status,
            body: None,
            headers: Vec::new(),
        }
    }

    fn refusing(status: StatusCode, code: i64, sentence: impl Into<String>) -> Self {
        Self {
            body: Some(refusal(code, sentence)),
            ..Self::new(status)
        }
    }
}

/// What reading a request gave: an early answer, or the body read whole.
enum Received {
    Early(Early),
    Body(String),
}

/// A JSON-RPC error with no `id`, which a refusal before the body carries.
fn refusal(code: i64, sentence: impl Into<String>) -> Value {
    error_message(None, &ProtocolError::new(code, sentence))
}

/// A header's value, its repeats joined, or nothing when the request does not carry it.
fn header_of(headers: &HeaderMap, name: &str) -> Option<String> {
    let values: Vec<String> = headers
        .get_all(name)
        .iter()
        .map(|value| latin1(value.as_bytes()))
        .collect();
    (!values.is_empty()).then(|| values.join(", "))
}

/// Decodes a header value in the `=?base64?…?=` form, and returns any other value as it is.
fn decoded_name(value: Option<String>) -> Option<String> {
    let value = value?;
    let Some(encoded) = value
        .strip_prefix("=?base64?")
        .and_then(|rest| rest.strip_suffix("?="))
    else {
        return Some(value);
    };
    base64_text(encoded)
}

/// The text a base64 value encodes, decoded as UTF-8 with each invalid sequence replaced, as
/// `atob` and `TextDecoder` read it, or `None` when it is not base64.
fn base64_text(encoded: &str) -> Option<String> {
    let digits: Vec<u8> = encoded
        .bytes()
        .filter(|byte| !matches!(byte, b' ' | b'\t' | b'\n' | b'\x0c' | b'\r'))
        .collect();
    let digits = match digits.len() % 4 {
        0 => digits
            .strip_suffix(b"==")
            .or_else(|| digits.strip_suffix(b"="))
            .unwrap_or(&digits)
            .to_vec(),
        _ => digits,
    };
    if digits.len() % 4 == 1 {
        return None;
    }
    let mut bytes = Vec::with_capacity(digits.len() * 3 / 4);
    let mut buffer = 0_u32;
    let mut bits = 0;
    for digit in digits {
        let value = match digit {
            b'A'..=b'Z' => digit - b'A',
            b'a'..=b'z' => digit - b'a' + 26,
            b'0'..=b'9' => digit - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push(u8::try_from((buffer >> bits) & 0xff).unwrap_or_default());
        }
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The fault of a per-request message's metadata headers, which must be present and equal the
/// body: the protocol version, the method, and on `tools/call` the tool's name. A `_meta` whose
/// version is not a string is left to the envelope check, which answers it.
fn metadata_fault(
    headers: &HeaderMap,
    method: &str,
    params: Option<&Value>,
) -> Option<ProtocolError> {
    let version = meta_of(params)?.get(META_PROTOCOL_VERSION)?.as_str()?;
    let source = format!("params._meta[\"{META_PROTOCOL_VERSION}\"]");
    let mut checks = vec![
        (
            header_of(headers, "mcp-protocol-version"),
            version.to_owned(),
            "MCP-Protocol-Version",
            source.as_str(),
        ),
        (
            header_of(headers, "mcp-method"),
            method.to_owned(),
            "Mcp-Method",
            "method",
        ),
    ];
    if method == "tools/call"
        && let Some(name) = params
            .and_then(Value::as_object)
            .and_then(|params| params.get("name"))
            .and_then(Value::as_str)
    {
        checks.push((
            decoded_name(header_of(headers, "mcp-name")),
            name.to_owned(),
            "Mcp-Name",
            "params.name",
        ));
    }
    let (_, _, header, source) = checks
        .into_iter()
        .find(|(actual, expected, _, _)| actual.as_deref() != Some(expected.as_str()))?;
    Some(ProtocolError::new(
        error_codes::HEADER_MISMATCH,
        messages::header_mismatch(header, source),
    ))
}

/// The status of a per-request refusal before the handler: an envelope refusal, an unsupported
/// version included, is 400, a method not served is 404, and any other is 200.
fn per_request_status(refusal: &Refusal) -> StatusCode {
    if refusal.stage == RefusalStage::Envelope {
        StatusCode::BAD_REQUEST
    } else if refusal.error.code == error_codes::METHOD_NOT_FOUND {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::OK
    }
}

/// The response that answers a request with no answer of its own: none, so the HTTP connection
/// closes.
type Answered = Result<Response<ResponseBody>, Abort>;

/// The transport's shared half: the server, the options, and the state.
pub(crate) struct Transport<S> {
    shared: Arc<Shared<S>>,
    options: HttpOptions,
    state: Mutex<TransportState<S>>,
    closed: CancellationToken,
}

impl<S: ToolSource> Transport<S> {
    fn shutdown(&self) -> &CancellationToken {
        &self.options.shutdown
    }

    /// Stops serving once the shutdown token is cancelled: every call aborts and answers nothing,
    /// each per-request subscription still open is torn down on its stream, and every session
    /// ends. Each HTTP connection closes on its own task. Resolves `closed` once every call has
    /// settled.
    async fn shut_down_on_signal(self: Arc<Self>) {
        self.options.shutdown.cancelled().await;
        let (connections, sessions) = {
            let mut state = locked(&self.state);
            state.stopped = true;
            let sessions: Vec<_> = state.sessions.drain().map(|(_, session)| session).collect();
            (state.connections.clone(), sessions)
        };
        for connection in &connections {
            connection.silence();
            connection.close_subscriptions();
        }
        for session in &sessions {
            session.end();
        }
        for connection in &connections {
            connection.settled().await;
        }
        self.closed.cancel();
    }

    /// Holds a connection with a request open, so shutdown reaches it. A connection that arrives
    /// once shutdown began is silenced at once.
    fn hold(&self, connection: &Connection<S>) {
        let stopped = {
            let mut state = locked(&self.state);
            state.connections.push(connection.clone());
            state.stopped
        };
        if stopped {
            connection.silence();
        }
    }

    /// Forgets a connection once every request on it has settled.
    fn release(self: &Arc<Self>, connection: Connection<S>) {
        let transport = Arc::clone(self);
        tokio::spawn(async move {
            connection.settled().await;
            locked(&transport.state)
                .connections
                .retain(|each| !each.same(&connection));
        });
    }

    /// Answers one request: refused before its body, or read and served, under the request's
    /// receipt deadline until its body has arrived, and never past shutdown.
    async fn respond(
        self: Arc<Self>,
        socket: &Arc<SocketState>,
        request: Request<Incoming>,
    ) -> Answered {
        socket.started();
        let shutdown = self.options.shutdown.clone();
        // A server with no tunnel closes a `CONNECT` with no answer, as `node:http` does.
        if shutdown.is_cancelled() || request.method() == Method::CONNECT {
            return Err(Abort);
        }
        let deadline = socket.request_deadline();
        let (head, incoming) = request.into_parts();
        let received = tokio::select! {
            biased;
            () = shutdown.cancelled() => return Err(Abort),
            received = tokio::time::timeout_at(deadline, self.receive(&head, incoming, socket)) => received,
        };
        let mut answered = match received {
            Err(_late) => Ok(empty(
                StatusCode::REQUEST_TIMEOUT,
                &[
                    ("connection", "close".to_owned()),
                    ("content-length", "0".to_owned()),
                ],
            )),
            Ok(Err(Abort)) => Err(Abort),
            Ok(Ok(Received::Early(early))) => Ok(early_response(early)),
            Ok(Ok(Received::Body(text))) => {
                if head.method == Method::DELETE {
                    Ok(self.delete(&head.headers))
                } else {
                    tokio::select! {
                        biased;
                        () = shutdown.cancelled() => Err(Abort),
                        answered = Arc::clone(&self).message(socket, &head.headers, classify(&text, &BODY_WORDING)) => answered,
                    }
                }
            }
        };
        if let Ok(answer) = &mut answered {
            if keeps_alive(&head, answer) {
                answer
                    .headers_mut()
                    .insert("keep-alive", HeaderValue::from_static("timeout=5"));
            }
            if !matches!(answer.body(), ResponseBody::Stream(_)) {
                socket.finished();
            }
        }
        answered
    }

    /// Screens a request, then reads its body whole up to the limit. An early answer to a body
    /// not yet consumed makes the socket linger.
    async fn receive(
        &self,
        head: &hyper::http::request::Parts,
        mut incoming: Incoming,
        socket: &SocketState,
    ) -> Result<Received, Abort> {
        if let Some(early) = self.screen(head).await {
            if !incoming.is_end_stream() {
                socket.linger();
            }
            return Ok(Received::Early(early));
        }
        let limit = self.options.max_body_bytes;
        let mut body = Vec::new();
        while let Some(frame) = poll_fn(|cx| Pin::new(&mut incoming).poll_frame(cx)).await {
            let Ok(frame) = frame else {
                return Err(Abort);
            };
            if let Ok(data) = frame.into_data() {
                body.extend_from_slice(&data);
                if body.len() as u64 > limit {
                    socket.linger();
                    return Ok(Received::Early(self.too_large()));
                }
            }
        }
        Ok(Received::Body(String::from_utf8_lossy(&body).into_owned()))
    }

    /// The answer to a request refused before its body is read, checked in order: `Origin`,
    /// authorization, path, method, then a POST's content type and declared length.
    async fn screen(&self, head: &hyper::http::request::Parts) -> Option<Early> {
        if let Some(origin) = header_of(&head.headers, "origin") {
            if let Some(heard) = &self.options.on_origin_refused {
                heard(&origin);
            }
            return Some(Early::refusing(
                StatusCode::FORBIDDEN,
                error_codes::INVALID_REQUEST,
                messages::BROWSER_REFUSED,
            ));
        }
        if let Some(authorize) = &self.options.authorize {
            match authorize(RequestHeaders::of(&head.headers)).await {
                Authorization::Allowed => {}
                Authorization::Refused => {
                    let mut early = Early::new(StatusCode::UNAUTHORIZED);
                    early
                        .headers
                        .push(("www-authenticate", "Bearer".to_owned()));
                    return Some(early);
                }
                Authorization::Failed => {
                    return Some(Early::refusing(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        error_codes::INTERNAL_ERROR,
                        messages::AUTHORIZATION_FAILED,
                    ));
                }
            }
        }
        self.route(head)
    }

    /// The answer to a path, a method, or a POST's content type or length the server refuses.
    fn route(&self, head: &hyper::http::request::Parts) -> Option<Early> {
        if head.uri.scheme().is_some() || head.uri.path() != ENDPOINT {
            return Some(Early::new(StatusCode::NOT_FOUND));
        }
        if head.method != Method::POST && head.method != Method::DELETE {
            let mut early = Early::new(StatusCode::METHOD_NOT_ALLOWED);
            early.headers.push(("allow", "POST, DELETE".to_owned()));
            return Some(early);
        }
        let content_type = header_of(&head.headers, "content-type").unwrap_or_default();
        let media_type = content_type.split(';').next().unwrap_or_default();
        if head.method == Method::POST
            && !media_type.trim().eq_ignore_ascii_case("application/json")
        {
            return Some(Early::refusing(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                error_codes::INVALID_REQUEST,
                messages::BODY_NOT_JSON_TYPE,
            ));
        }
        let declared = header_of(&head.headers, "content-length")
            .and_then(|length| length.trim().parse::<u64>().ok());
        declared
            .is_some_and(|length| length > self.options.max_body_bytes)
            .then(|| self.too_large())
    }

    fn too_large(&self) -> Early {
        Early::refusing(
            StatusCode::PAYLOAD_TOO_LARGE,
            error_codes::INVALID_REQUEST,
            messages::body_too_large(self.options.max_body_bytes),
        )
    }

    /// Answers one message the body held.
    async fn message(
        self: Arc<Self>,
        socket: &Arc<SocketState>,
        headers: &HeaderMap,
        message: Message,
    ) -> Answered {
        match message {
            Message::Invalid { error, .. } => Ok(json(
                StatusCode::BAD_REQUEST,
                &error_message(None, &error),
                &[],
            )),
            Message::Response => Ok(empty(StatusCode::ACCEPTED, &[])),
            Message::Notification { method, params } => Ok(empty(
                self.notification(headers, &method, params.as_ref()),
                &[],
            )),
            Message::Request { id, method, params } => {
                let era = era_of(params.as_ref());
                let session_id = header_of(headers, "mcp-session-id");
                if session_id.is_none()
                    && header_of(headers, "mcp-protocol-version").as_deref()
                        == Some(PROTOCOL_REVISION)
                    && era != Era::PerRequest
                {
                    return Ok(json(
                        StatusCode::BAD_REQUEST,
                        &error_message(Some(&id), &missing_meta(META_PROTOCOL_VERSION)),
                        &[],
                    ));
                }
                if era == Era::PerRequest {
                    self.per_request(socket, headers, id, method, params).await
                } else {
                    self.session_request(socket, headers, session_id, id, method, params)
                        .await
                }
            }
        }
    }

    /// Hands a notification to its session, and answers its status: 202, or 404 for an unknown
    /// session. A per-request notification and one with no session id are ignored.
    fn notification(
        &self,
        headers: &HeaderMap,
        method: &str,
        params: Option<&Value>,
    ) -> StatusCode {
        let Some(id) = header_of(headers, "mcp-session-id") else {
            return StatusCode::ACCEPTED;
        };
        if era_of(params) == Era::PerRequest {
            return StatusCode::ACCEPTED;
        }
        let session = locked(&self.state).sessions.get(&id).cloned();
        match session {
            Some(session) => {
                session.touch();
                session.connection.notify(method, params);
                StatusCode::ACCEPTED
            }
            None => StatusCode::NOT_FOUND,
        }
    }

    /// Serves a per-request message statelessly, as a connection of one request.
    async fn per_request(
        self: Arc<Self>,
        socket: &Arc<SocketState>,
        headers: &HeaderMap,
        id: RequestId,
        method: String,
        params: Option<Value>,
    ) -> Answered {
        let connection = Connection::new(Arc::clone(&self.shared), None);
        let admission = match metadata_fault(headers, &method, params.as_ref()) {
            Some(error) => Admission::Refused(Refusal {
                error,
                stage: RefusalStage::Envelope,
            }),
            None => connection.admit(id.clone(), method, params),
        };
        let admitted = match admission {
            Admission::Refused(refusal) => {
                return Ok(json(
                    per_request_status(&refusal),
                    &error_message(Some(&id), &refusal.error),
                    &[],
                ));
            }
            Admission::Admitted(admitted) => admitted,
        };
        self.hold(&connection);
        let cancelling = connection.clone();
        let transport = Arc::clone(&self);
        let released = connection.clone();
        let hooks = Hooks {
            cancel: Some(Box::new(move || cancelling.cancel(&id))),
            ended: Some(Box::new(move || transport.release(released))),
        };
        self.answer(socket, &connection, admitted, hooks, None)
            .await
    }

    /// Serves an initialize-era request within its session, or opens one.
    async fn session_request(
        self: Arc<Self>,
        socket: &Arc<SocketState>,
        headers: &HeaderMap,
        session_id: Option<String>,
        id: RequestId,
        method: String,
        params: Option<Value>,
    ) -> Answered {
        let Some(session_id) = session_id else {
            return self.sessionless(socket, id, method, params).await;
        };
        let Some(session) = locked(&self.state).sessions.get(&session_id).cloned() else {
            return Ok(empty(StatusCode::NOT_FOUND, &[]));
        };
        session.touch();
        let revision = session.connection.handshake().unwrap_or_default();
        if let Some(version) = header_of(headers, "mcp-protocol-version")
            && version != revision
        {
            let error = ProtocolError::new(
                error_codes::INVALID_REQUEST,
                messages::version_not_session(revision),
            );
            return Ok(json(
                StatusCode::BAD_REQUEST,
                &error_message(Some(&id), &error),
                &[],
            ));
        }
        match session.connection.admit(id.clone(), method, params) {
            Admission::Refused(refusal) => Ok(json(
                StatusCode::OK,
                &error_message(Some(&id), &refusal.error),
                &[],
            )),
            // A closed stream does not cancel on the initialize-era revisions: the call runs to
            // its end.
            Admission::Admitted(admitted) => {
                self.answer(
                    socket,
                    &session.connection,
                    admitted,
                    Hooks::default(),
                    None,
                )
                .await
            }
        }
    }

    /// Serves an initialize-era request without a session id: `initialize` opens a session when
    /// it succeeds, `ping` is answered, and any other request is refused.
    async fn sessionless(
        self: Arc<Self>,
        socket: &Arc<SocketState>,
        id: RequestId,
        method: String,
        params: Option<Value>,
    ) -> Answered {
        match method.as_str() {
            "ping" => Ok(json(
                StatusCode::OK,
                &result_message(&id, serde_json::Map::new()),
                &[],
            )),
            "initialize" => self.initialize(socket, id, method, params).await,
            _ => {
                let error = ProtocolError::new(
                    error_codes::INVALID_PARAMS,
                    messages::no_session(META_PROTOCOL_VERSION, META_CLIENT_CAPABILITIES),
                );
                Ok(json(
                    StatusCode::BAD_REQUEST,
                    &error_message(Some(&id), &error),
                    &[],
                ))
            }
        }
    }

    /// Opens a session when the connection answers `initialize` with its result, and only then.
    async fn initialize(
        self: Arc<Self>,
        socket: &Arc<SocketState>,
        id: RequestId,
        method: String,
        params: Option<Value>,
    ) -> Answered {
        let session_id = uuid::Uuid::new_v4().hyphenated().to_string();
        let session = Arc::new(HttpSession::new(
            Arc::clone(&self.shared),
            self.options.session_idle,
        ));
        let admitted = match session.connection.admit(id.clone(), method, params) {
            Admission::Refused(refusal) => {
                session.end();
                return Ok(json(
                    StatusCode::OK,
                    &error_message(Some(&id), &refusal.error),
                    &[],
                ));
            }
            Admission::Admitted(admitted) => admitted,
        };
        let opened = Arc::clone(&session);
        let transport = Arc::clone(&self);
        let register = move |answer: &Value| {
            if answer.get("result").is_none() {
                opened.end();
                return Vec::new();
            }
            let stopped = {
                let mut state = locked(&transport.state);
                if !state.stopped {
                    state
                        .sessions
                        .insert(session_id.clone(), Arc::clone(&opened));
                }
                state.stopped
            };
            transport.hold(&opened.connection);
            if stopped {
                opened.end();
            } else {
                // The clock starts once the session is registered, so its expiry finds it.
                let expiring = Arc::downgrade(&transport);
                let expired = session_id.clone();
                opened.watch_idle(move || {
                    if let Some(transport) = expiring.upgrade() {
                        transport.end_session(&expired);
                    }
                });
            }
            vec![("mcp-session-id", session_id)]
        };
        let answered = self
            .answer(
                socket,
                &session.connection,
                admitted,
                Hooks::default(),
                Some(Box::new(register)),
            )
            .await;
        if answered.is_err() {
            session.end();
        }
        answered
    }

    /// Ends a session: it leaves the sessions, its calls abort, and its connection is forgotten
    /// once they settle.
    fn end_session(self: &Arc<Self>, id: &str) {
        let session = locked(&self.state).sessions.remove(id);
        if let Some(session) = session {
            session.end();
            self.release(session.connection.clone());
        }
    }

    /// DELETE ends the session it names: 204, 400 without a session id, and 404 for an unknown
    /// one.
    fn delete(self: &Arc<Self>, headers: &HeaderMap) -> Response<ResponseBody> {
        let Some(id) = header_of(headers, "mcp-session-id") else {
            return empty(StatusCode::BAD_REQUEST, &[]);
        };
        if locked(&self.state).sessions.contains_key(&id) {
            self.end_session(&id);
            empty(StatusCode::NO_CONTENT, &[])
        } else {
            empty(StatusCode::NOT_FOUND, &[])
        }
    }

    /// Answers an admitted request: on an event stream when its handler streams, and as one JSON
    /// answer otherwise, whose headers `headers` chooses from the answer. A request whose session
    /// ended after it was found is answered as one for an unknown session: 404.
    async fn answer(
        &self,
        socket: &Arc<SocketState>,
        connection: &Connection<S>,
        admitted: Admitted,
        hooks: Hooks,
        headers: Option<ChooseHeaders>,
    ) -> Answered {
        if admitted.streams {
            let (channel, response) = event_stream(socket, hooks);
            if connection.begin(admitted, channel).is_err() {
                return Ok(empty(StatusCode::NOT_FOUND, &[]));
            }
            return Ok(response);
        }
        let (channel, answered) = SingleChannel::new();
        if connection.begin(admitted, channel).is_err() {
            return Ok(empty(StatusCode::NOT_FOUND, &[]));
        }
        let Some(answer) = single_answer(answered, hooks).await else {
            return Err(Abort);
        };
        let extra = headers.map(|choose| choose(&answer)).unwrap_or_default();
        Ok(json(StatusCode::OK, &answer, &extra))
    }
}

/// Whether a response keeps its HTTP/1.1 connection open, and so advertises how long the socket
/// then waits for its next request, as `node:http` does: neither the request nor the response says
/// `Connection: close`.
fn keeps_alive(head: &hyper::http::request::Parts, answer: &Response<ResponseBody>) -> bool {
    let closes = |headers: &HeaderMap| {
        headers.get_all(CONNECTION).iter().any(|value| {
            value.to_str().is_ok_and(|value| {
                value
                    .split(',')
                    .any(|each| each.trim().eq_ignore_ascii_case("close"))
            })
        })
    };
    head.version == Version::HTTP_11 && !closes(&head.headers) && !closes(answer.headers())
}

/// An answer sent before the body is consumed: it closes the HTTP connection.
fn early_response(early: Early) -> Response<ResponseBody> {
    let mut headers = early.headers;
    headers.push(("connection", "close".to_owned()));
    match early.body {
        Some(body) => json(early.status, &body, &headers),
        None => {
            headers.push(("content-length", "0".to_owned()));
            empty(early.status, &headers)
        }
    }
}
