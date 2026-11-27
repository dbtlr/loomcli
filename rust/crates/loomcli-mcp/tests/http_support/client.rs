//! An HTTP/1.1 client over a raw TCP socket, the port of the reference's `tests/http.ts` client
//! half: one request per connection, a whole answer or a response read as it arrives, an event
//! stream, and a raw socket a test writes bytes to. The MCP plugin's HTTP tests include this file
//! by path, as the reference's plugin tests import the protocol package's helper.

#![allow(
    dead_code,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::net::tcp::OwnedWriteHalf;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

/// How long a wait may take, in real time, before the test fails.
pub const PATIENCE: Duration = Duration::from_secs(10);

/// The `_meta` every request of the pinned revision carries.
pub fn meta() -> Value {
    json!({
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    })
}

/// A request's body: JSON, or a raw string.
#[derive(Clone, Debug)]
pub enum Body {
    Json(Value),
    Raw(String),
}

/// One HTTP request a test sends.
#[derive(Clone, Debug)]
pub struct Sent {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Body>,
}

impl Default for Sent {
    fn default() -> Self {
        Self {
            method: "POST".into(),
            path: "/mcp".into(),
            headers: Vec::new(),
            body: None,
        }
    }
}

impl Sent {
    /// A POST of a JSON body.
    pub fn json(body: Value) -> Self {
        Self {
            body: Some(Body::Json(body)),
            ..Self::default()
        }
    }

    /// A POST of a raw body.
    pub fn raw(body: &str) -> Self {
        Self {
            body: Some(Body::Raw(body.to_owned())),
            ..Self::default()
        }
    }

    /// The same request with these headers in place of its own.
    pub fn headers(mut self, headers: &[(&str, &str)]) -> Self {
        self.headers = headers
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect();
        self
    }

    /// The same request with one more header, replacing one of the same name.
    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers
            .retain(|(each, _)| !each.eq_ignore_ascii_case(name));
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }

    pub fn method(mut self, method: &str) -> Self {
        method.clone_into(&mut self.method);
        self
    }

    pub fn path(mut self, path: &str) -> Self {
        path.clone_into(&mut self.path);
        self
    }

    fn body_text(&self) -> Option<String> {
        match &self.body {
            None => None,
            Some(Body::Json(value)) => Some(value.to_string()),
            Some(Body::Raw(text)) => Some(text.clone()),
        }
    }

    /// The request's bytes: a Content-Type of `application/json` when it has a body, unless its
    /// headers name one, then its headers, then a length or chunked body.
    pub fn bytes(&self) -> Vec<u8> {
        let text = self.body_text();
        let mut head = format!(
            "{} {} HTTP/1.1\r\nHost: 127.0.0.1\r\n",
            self.method, self.path
        );
        let named = |name: &str| {
            self.headers
                .iter()
                .any(|(each, _)| each.eq_ignore_ascii_case(name))
        };
        if text.is_some() && !named("content-type") {
            head.push_str("Content-Type: application/json\r\n");
        }
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        let chunked = self.headers.iter().any(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding") && value.eq_ignore_ascii_case("chunked")
        });
        let mut bytes;
        match text {
            Some(text) if chunked => {
                head.push_str("\r\n");
                bytes = head.into_bytes();
                bytes.extend_from_slice(format!("{:x}\r\n", text.len()).as_bytes());
                bytes.extend_from_slice(text.as_bytes());
                bytes.extend_from_slice(b"\r\n0\r\n\r\n");
            }
            Some(text) => {
                head.push_str(&format!("Content-Length: {}\r\n\r\n", text.len()));
                bytes = head.into_bytes();
                bytes.extend_from_slice(text.as_bytes());
            }
            None => {
                if self.method == "POST" || self.method == "PUT" {
                    head.push_str("Content-Length: 0\r\n");
                }
                head.push_str("\r\n");
                bytes = head.into_bytes();
            }
        }
        bytes
    }
}

/// The headers a per-request message mirrors: its version, its method, and a call's tool name.
pub fn mirrored(method: &str, name: Option<&str>) -> Vec<(String, String)> {
    let mut headers = vec![
        ("MCP-Protocol-Version".to_owned(), "2026-07-28".to_owned()),
        ("Mcp-Method".to_owned(), method.to_owned()),
    ];
    if let Some(name) = name {
        headers.push(("Mcp-Name".to_owned(), name.to_owned()));
    }
    headers
}

/// A per-request message with its headers mirrored.
pub fn per_request(id: impl Into<Value>, method: &str, params: Value) -> Sent {
    let mut params = params.as_object().cloned().unwrap_or_default();
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_owned);
    params.insert("_meta".into(), meta());
    Sent {
        headers: mirrored(method, name.as_deref()),
        ..Sent::json(
            json!({ "id": id.into(), "jsonrpc": "2.0", "method": method, "params": params }),
        )
    }
}

/// An initialize-era request, with the session id when one is given.
pub fn in_session(
    session: Option<&str>,
    id: impl Into<Value>,
    method: &str,
    params: Option<Value>,
) -> Sent {
    let mut body = json!({ "id": id.into(), "jsonrpc": "2.0", "method": method });
    if let Some(params) = params {
        body["params"] = params;
    }
    let mut sent = Sent::json(body);
    if let Some(session) = session {
        sent = sent.header("MCP-Session-Id", session);
    }
    sent
}

/// An `initialize` request for a revision, with the capabilities a handshake carries.
pub fn initialize(protocol_version: &str) -> Sent {
    in_session(
        None,
        0,
        "initialize",
        Some(json!({
            "capabilities": {},
            "clientInfo": { "name": "http-client", "version": "0.1.0" },
            "protocolVersion": protocol_version,
        })),
    )
}

/// A whole answer: its status, its headers with lowercase names, and its body as text.
#[derive(Clone, Debug)]
pub struct Answer {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub text: String,
}

impl Answer {
    /// A header's value, its repeats joined by `, `.
    pub fn header(&self, name: &str) -> Option<String> {
        header_in(&self.headers, name)
    }

    /// The parsed JSON body.
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.text)
            .unwrap_or_else(|_| panic!("the body is not JSON: {:?}", self.text))
    }
}

fn header_in(headers: &[(String, String)], name: &str) -> Option<String> {
    let values: Vec<&str> = headers
        .iter()
        .filter(|(each, _)| each.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
        .collect();
    (!values.is_empty()).then(|| values.join(", "))
}

/// What a response's reader has read so far.
#[derive(Default)]
struct Reading {
    /// The raw bytes, head included, as they arrived.
    raw: Vec<u8>,
    head: Option<(u16, Vec<(String, String)>)>,
    /// The decoded body.
    body: Vec<u8>,
    /// The body ended, or the connection closed.
    ended: bool,
}

/// A response as it arrives: its head once read, its decoded body so far, and its end.
#[derive(Clone)]
pub struct Response {
    reading: Arc<Mutex<Reading>>,
    changed: Arc<Notify>,
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
    writer: Arc<tokio::sync::Mutex<Option<OwnedWriteHalf>>>,
}

/// Where a body's framing stands.
enum Framing {
    Length(usize),
    Chunked,
    UntilClose,
}

/// Decodes as much of a chunked body as `pending` holds, appending it to `body`. Answers whether
/// the last chunk arrived.
fn decode_chunks(pending: &mut Vec<u8>, body: &mut Vec<u8>) -> bool {
    loop {
        let Some(line_end) = pending.windows(2).position(|pair| pair == b"\r\n") else {
            return false;
        };
        let size_text = String::from_utf8_lossy(&pending[..line_end]).into_owned();
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
            .unwrap_or_else(|_| panic!("a chunk size is not hexadecimal: {size_text:?}"));
        if size == 0 {
            return pending.len() >= line_end + 4;
        }
        if pending.len() < line_end + 2 + size + 2 {
            return false;
        }
        body.extend_from_slice(&pending[line_end + 2..line_end + 2 + size]);
        pending.drain(..line_end + 2 + size + 2);
    }
}

fn parse_head(raw: &[u8]) -> Option<(usize, u16, Vec<(String, String)>)> {
    let end = raw.windows(4).position(|window| window == b"\r\n\r\n")?;
    let text = String::from_utf8_lossy(&raw[..end]).into_owned();
    let mut lines = text.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let status = status_line
        .split(' ')
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or_else(|| panic!("not a status line: {status_line:?}"));
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect();
    Some((end + 4, status, headers))
}

/// Reads a response from the socket, as it arrives, until its body ends or the socket closes.
async fn read_response(
    mut reader: tokio::net::tcp::OwnedReadHalf,
    reading: Arc<Mutex<Reading>>,
    changed: Arc<Notify>,
    head_request: bool,
) {
    let mut pending: Vec<u8> = Vec::new();
    let mut framing: Option<Framing> = None;
    let mut buffer = vec![0_u8; 65_536];
    loop {
        let read = reader.read(&mut buffer).await.unwrap_or(0);
        if read == 0 {
            reading.lock().unwrap().ended = true;
            changed.notify_waiters();
            return;
        }
        {
            let mut state = reading.lock().unwrap();
            state.raw.extend_from_slice(&buffer[..read]);
            pending.extend_from_slice(&buffer[..read]);
            if framing.is_none()
                && let Some((length, status, headers)) = parse_head(&pending)
            {
                pending.drain(..length);
                framing = Some(if head_request || status == 204 || status == 304 {
                    Framing::Length(0)
                } else if header_in(&headers, "transfer-encoding")
                    .is_some_and(|value| value.eq_ignore_ascii_case("chunked"))
                {
                    Framing::Chunked
                } else if let Some(length) = header_in(&headers, "content-length") {
                    Framing::Length(length.parse().unwrap())
                } else {
                    Framing::UntilClose
                });
                state.head = Some((status, headers));
            }
            let done = match &framing {
                None => false,
                Some(Framing::Length(length)) => {
                    let take = pending.len().min(length - state.body.len().min(*length));
                    state.body.extend(pending.drain(..take));
                    state.body.len() >= *length
                }
                Some(Framing::Chunked) => decode_chunks(&mut pending, &mut state.body),
                Some(Framing::UntilClose) => {
                    state.body.append(&mut pending);
                    false
                }
            };
            if done {
                state.ended = true;
            }
        }
        changed.notify_waiters();
        if reading.lock().unwrap().ended {
            return;
        }
    }
}

impl Response {
    /// Waits for a condition on what has been read, failing after the patience runs out.
    async fn wait(&self, what: &str, condition: impl Fn(&Reading) -> bool) {
        let started = Instant::now();
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let reading = self.reading.lock().unwrap();
                if condition(&reading) {
                    return;
                }
                assert!(
                    started.elapsed() < PATIENCE,
                    "Timed out waiting for {what}. The response carried:\n{}",
                    String::from_utf8_lossy(&reading.raw)
                );
            }
            tokio::select! {
                () = notified => {}
                () = tokio::time::sleep(Duration::from_millis(5)) => {}
                () = real_pause() => {}
            }
        }
    }

    /// The status, once the head arrived.
    pub async fn status(&self) -> u16 {
        self.wait("the head", |reading| reading.head.is_some())
            .await;
        self.reading.lock().unwrap().head.as_ref().unwrap().0
    }

    /// A header's value, once the head arrived.
    pub async fn header(&self, name: &str) -> Option<String> {
        self.status().await;
        header_in(&self.reading.lock().unwrap().head.as_ref().unwrap().1, name)
    }

    /// The decoded body so far.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.reading.lock().unwrap().body).into_owned()
    }

    /// Whether the body ended or the connection closed.
    pub fn closed(&self) -> bool {
        self.reading.lock().unwrap().ended
    }

    /// Waits until the body ends or the connection closes.
    pub async fn ended(&self) {
        self.wait("the end", |reading| reading.ended).await;
    }

    /// Reads the whole answer.
    pub async fn read_all(&self) -> Answer {
        self.ended().await;
        let reading = self.reading.lock().unwrap();
        let (status, headers) = reading.head.clone().unwrap_or_else(|| {
            panic!(
                "the connection closed with no response: {:?}",
                String::from_utf8_lossy(&reading.raw)
            )
        });
        Answer {
            status,
            headers,
            text: String::from_utf8_lossy(&reading.body).into_owned(),
        }
    }

    /// Closes the connection, as a client that leaves does.
    pub async fn destroy(&self) {
        if let Some(task) = self.task.lock().unwrap().take() {
            task.abort();
        }
        self.writer.lock().await.take();
        self.reading.lock().unwrap().ended = true;
        self.changed.notify_waiters();
    }

    /// The events read so far, each event's message parsed.
    pub fn events(&self) -> Vec<Value> {
        let text = self.text();
        let mut blocks: Vec<&str> = text.split("\n\n").collect();
        blocks.pop();
        blocks
            .into_iter()
            .filter(|block| block.starts_with("data: "))
            .map(|block| serde_json::from_str(&block["data: ".len()..]).unwrap())
            .collect()
    }

    /// Waits until the text read so far holds `wanted`.
    pub async fn holds(&self, wanted: &str) {
        let wanted = wanted.to_owned();
        self.wait(&format!("{wanted:?}"), move |reading| {
            String::from_utf8_lossy(&reading.body).contains(&wanted)
        })
        .await;
    }
}

/// Yields to the runtime once, so a paused clock never stalls a wait.
async fn real_pause() {
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }
}

/// An event stream as a client reads it: `next` answers each event's message in order.
pub struct EventStream {
    pub response: Response,
    read: usize,
}

impl EventStream {
    pub fn new(response: Response) -> Self {
        Self { response, read: 0 }
    }

    /// The next event's message.
    pub async fn next(&mut self) -> Value {
        let read = self.read;
        let response = self.response.clone();
        let started = Instant::now();
        loop {
            let events = response.events();
            if let Some(event) = events.get(read) {
                self.read += 1;
                return event.clone();
            }
            assert!(
                !response.closed(),
                "The stream ended. It carried:\n{}",
                response.text()
            );
            assert!(
                started.elapsed() < PATIENCE,
                "No further event. The stream carried:\n{}",
                response.text()
            );
            tokio::select! {
                () = tokio::time::sleep(Duration::from_millis(5)) => {}
                () = real_pause() => {}
            }
        }
    }

    pub fn events(&self) -> Vec<Value> {
        self.response.events()
    }

    pub fn text(&self) -> String {
        self.response.text()
    }

    pub async fn ended(&self) {
        self.response.ended().await;
    }

    pub async fn holds(&self, wanted: &str) {
        self.response.holds(wanted).await;
    }
}

/// Sends one request on a fresh HTTP connection and answers its response as it arrives.
pub async fn open(port: u16, sent: &Sent) -> Response {
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let (reader, mut writer) = stream.into_split();
    let reading = Arc::new(Mutex::new(Reading::default()));
    let changed = Arc::new(Notify::new());
    let task = tokio::spawn(read_response(
        reader,
        Arc::clone(&reading),
        Arc::clone(&changed),
        sent.method == "HEAD",
    ));
    // A server that answers before the body may refuse the rest of it.
    let _ = writer.write_all(&sent.bytes()).await;
    Response {
        reading,
        changed,
        task: Arc::new(Mutex::new(Some(task))),
        writer: Arc::new(tokio::sync::Mutex::new(Some(writer))),
    }
}

/// Sends one request and reads its whole answer.
pub async fn send(port: u16, sent: &Sent) -> Answer {
    open(port, sent).await.read_all().await
}

/// Sends one request and answers its status alone.
pub async fn status_of(port: u16, sent: &Sent) -> u16 {
    send(port, sent).await.status
}

/// Opens a session and answers its id.
pub async fn open_session(port: u16, protocol_version: &str) -> String {
    let answer = send(port, &initialize(protocol_version)).await;
    answer
        .header("mcp-session-id")
        .unwrap_or_else(|| panic!("initialize issued no session id: {}", answer.text))
}

/// A raw TCP connection to the server, and everything it has read.
pub struct Raw {
    writer: Option<OwnedWriteHalf>,
    text: Arc<Mutex<String>>,
    ended: Arc<Mutex<bool>>,
    changed: Arc<Notify>,
    task: JoinHandle<()>,
}

impl Raw {
    pub async fn connect(port: u16) -> Self {
        let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let (mut reader, writer) = stream.into_split();
        let text = Arc::new(Mutex::new(String::new()));
        let ended = Arc::new(Mutex::new(false));
        let changed = Arc::new(Notify::new());
        let task = {
            let (text, ended, changed) =
                (Arc::clone(&text), Arc::clone(&ended), Arc::clone(&changed));
            tokio::spawn(async move {
                let mut buffer = vec![0_u8; 65_536];
                loop {
                    match reader.read(&mut buffer).await {
                        Ok(0) | Err(_) => break,
                        Ok(read) => {
                            text.lock()
                                .unwrap()
                                .push_str(&String::from_utf8_lossy(&buffer[..read]));
                            changed.notify_waiters();
                        }
                    }
                }
                *ended.lock().unwrap() = true;
                changed.notify_waiters();
            })
        };
        Self {
            writer: Some(writer),
            text,
            ended,
            changed,
            task,
        }
    }

    /// Writes bytes, answering whether the socket took them.
    pub async fn write(&mut self, bytes: &[u8]) -> bool {
        match self.writer.as_mut() {
            Some(writer) => writer.write_all(bytes).await.is_ok(),
            None => false,
        }
    }

    /// Ends the client's side of the connection.
    pub async fn end(&mut self, bytes: &[u8]) {
        if let Some(mut writer) = self.writer.take() {
            let _ = writer.write_all(bytes).await;
            // Dropping the half shuts down the client's side and leaves the socket open for
            // reading.
            drop(writer);
        }
    }

    /// Everything read so far.
    pub fn text(&self) -> String {
        self.text.lock().unwrap().clone()
    }

    /// Whether the server ended its side or the connection closed.
    pub fn is_ended(&self) -> bool {
        *self.ended.lock().unwrap()
    }

    /// Waits until the server ends its side or the connection closes.
    pub async fn ended(&self) {
        until("the server to end the connection", || self.is_ended()).await;
    }

    /// Waits until what was read holds `wanted`.
    pub async fn holds(&self, wanted: &str) {
        until(&format!("{wanted:?} in {:?}", self.text()), || {
            self.text().contains(wanted)
        })
        .await;
    }
}

impl Drop for Raw {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Resolves once the condition holds, checking at each turn of the runtime, or fails after the
/// patience runs out, in real time.
pub async fn until(what: &str, condition: impl Fn() -> bool) {
    let started = Instant::now();
    while !condition() {
        assert!(
            started.elapsed() < PATIENCE,
            "Timed out waiting for {what}."
        );
        tokio::select! {
            () = tokio::time::sleep(Duration::from_millis(2)) => {}
            () = real_pause() => {}
        }
    }
}
