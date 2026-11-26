//! Newline-delimited JSON-RPC 2.0: error codes, request ids, line splitting, and classification
//! of what the client wrote.

use std::io;

use serde::Serialize;
use serde_json::{Map, Number, Value, json};

use crate::messages;

/// The JSON-RPC error codes the server answers, and the protocol's unsupported-version code.
pub mod error_codes {
    /// The server failed while handling a request.
    pub const INTERNAL_ERROR: i64 = -32_603;
    /// The request's parameters are not ones the method accepts.
    pub const INVALID_PARAMS: i64 = -32_602;
    /// The message is not a JSON-RPC request the server reads.
    pub const INVALID_REQUEST: i64 = -32_600;
    /// The method is not one the server serves.
    pub const METHOD_NOT_FOUND: i64 = -32_601;
    /// The line is not JSON.
    pub const PARSE_ERROR: i64 = -32_700;
    /// The request names a protocol version the server does not serve.
    pub const UNSUPPORTED_PROTOCOL_VERSION: i64 = -32_022;
}

/// A request's id, which its response and any cancellation name. A number and a string with the
/// same digits are different ids.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum RequestId {
    /// A numeric id.
    Number(Number),
    /// A string id.
    String(String),
}

impl RequestId {
    /// Reads a request id from a JSON value, or `None` when it is neither a string nor a number.
    ///
    /// A number with no fraction reads as an integer, as `JSON.stringify` writes it back.
    #[must_use]
    pub fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::String(text) => Some(Self::String(text.clone())),
            Value::Number(number) => Some(Self::Number(normalized(number))),
            _ => None,
        }
    }

    /// The id as the JSON value a message carries.
    #[must_use]
    pub fn to_value(&self) -> Value {
        match self {
            Self::Number(number) => Value::Number(number.clone()),
            Self::String(text) => Value::String(text.clone()),
        }
    }
}

/// Writes a whole-valued float as an integer, as JavaScript writes it, so `1.0` and `1` are the
/// same number. A fractional float and a float beyond the 64-bit integer range stay floats.
fn normalized(number: &Number) -> Number {
    if !number.is_f64() {
        return number.clone();
    }
    number
        .as_f64()
        .and_then(whole_integer)
        .unwrap_or_else(|| number.clone())
}

/// The integer a whole-valued float equals, when it fits 64 bits.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn whole_integer(float: f64) -> Option<Number> {
    if !float.is_finite() || float.fract() != 0.0 {
        return None;
    }
    // 2^63 and 2^64 are exact in an f64, so these bounds are exact.
    if (0.0..18_446_744_073_709_551_616.0).contains(&float) {
        Some(Number::from(float as u64))
    } else if (-9_223_372_036_854_775_808.0..0.0).contains(&float) {
        Some(Number::from(float as i64))
    } else {
        None
    }
}

/// A number as JavaScript's `JSON.stringify` would write it: whole values without a fraction, and
/// a value JSON cannot hold as `null`.
#[must_use]
pub fn js_number(value: f64) -> Value {
    match Number::from_f64(value) {
        Some(number) => Value::Number(normalized(&number)),
        None => Value::Null,
    }
}

/// Writes floats as ECMAScript's `Number.prototype.toString` does, so a message matches
/// `JSON.stringify` byte for byte. Every other token is serde_json's, which already agrees.
struct JsFormatter;

impl serde_json::ser::Formatter for JsFormatter {
    fn write_f64<W>(&mut self, writer: &mut W, value: f64) -> io::Result<()>
    where
        W: ?Sized + io::Write,
    {
        writer.write_all(js_float_text(value).as_bytes())
    }

    fn write_f32<W>(&mut self, writer: &mut W, value: f32) -> io::Result<()>
    where
        W: ?Sized + io::Write,
    {
        writer.write_all(js_float_text(f64::from(value)).as_bytes())
    }
}

/// A finite float as ECMAScript writes it: plain decimal for magnitudes from 1e-6 up to (not
/// including) 1e21, and exponent form beyond that.
fn js_float_text(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    // The shortest round-trip digits, as `d.ddde<exp>`.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    // ECMAScript's `n`: the value is 0.digits * 10^n.
    let n = exponent + 1;
    let k = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let body = if k <= n && n <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(n - k).unwrap_or(0))
        )
    } else if 0 < n && n <= 21 {
        let (whole, fraction) = digits.split_at(usize::try_from(n).unwrap_or(0));
        format!("{whole}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat(usize::try_from(-n).unwrap_or(0)))
    } else {
        let power = n - 1;
        let sign_of_power = if power < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        let fraction = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        format!("{first}{fraction}e{sign_of_power}{}", power.abs())
    };
    format!("{sign}{body}")
}

/// A JSON value as `JSON.stringify` writes it, compact.
pub(crate) fn json_text(value: &Value) -> String {
    let mut bytes = Vec::new();
    let mut serializer = serde_json::Serializer::with_formatter(&mut bytes, JsFormatter);
    if value.serialize(&mut serializer).is_err() {
        return String::new();
    }
    String::from_utf8(bytes).unwrap_or_default()
}

/// A request answered with a JSON-RPC error rather than a result. A tool source returns one to
/// choose the error; any panic while handling a request is answered with `INTERNAL_ERROR`.
#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolError {
    /// The JSON-RPC error code, one of [`error_codes`] or a code the caller chooses.
    pub code: i64,
    /// The message the client reads.
    pub message: String,
    /// Optional structured data, written as the error's `data` member.
    pub data: Option<Value>,
}

impl ProtocolError {
    /// An error with a code and a message and no data.
    #[must_use]
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    /// The same error carrying `data`.
    #[must_use]
    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }

    /// The error answering a defect while handling `method`.
    pub(crate) fn internal(method: &str) -> Self {
        Self::new(
            error_codes::INTERNAL_ERROR,
            messages::handler_failed(method),
        )
    }
}

/// One line the client wrote, sorted by what the server does with it.
#[derive(Debug)]
pub(crate) enum Incoming {
    /// A request that expects a response.
    Request {
        id: RequestId,
        method: String,
        params: Option<Value>,
    },
    /// A notification, which expects none.
    Notification {
        method: String,
        params: Option<Value>,
    },
    /// A response from the client, which the server ignores.
    Response,
    /// A message to refuse with `error`, under `id` when it named one.
    Invalid {
        id: Option<RequestId>,
        error: ProtocolError,
    },
}

fn not_json() -> ProtocolError {
    ProtocolError::new(error_codes::PARSE_ERROR, messages::LINE_NOT_JSON)
}

fn batch() -> ProtocolError {
    ProtocolError::new(error_codes::INVALID_REQUEST, messages::BATCH_UNSUPPORTED)
}

fn not_request() -> ProtocolError {
    ProtocolError::new(error_codes::INVALID_REQUEST, messages::NOT_JSON_RPC_REQUEST)
}

/// Sorts one parsed object: a client's response, a notification, a request, or neither.
fn classify_object(mut message: Map<String, Value>) -> Incoming {
    if !message.contains_key("method")
        && (message.contains_key("result") || message.contains_key("error"))
    {
        return Incoming::Response;
    }
    let named = message.get("id").and_then(RequestId::from_value);
    let method = match message.get("method") {
        Some(Value::String(method)) if message.get("jsonrpc") == Some(&json!("2.0")) => {
            method.clone()
        }
        _ => {
            return Incoming::Invalid {
                id: named,
                error: not_request(),
            };
        }
    };
    let params = message.remove("params");
    if !message.contains_key("id") {
        return Incoming::Notification { method, params };
    }
    match named {
        Some(id) => Incoming::Request { id, method, params },
        None => Incoming::Invalid {
            id: None,
            error: not_request(),
        },
    }
}

/// Reads one line as a request, a notification, a client's response, or a message to refuse.
pub(crate) fn classify(line: &str) -> Incoming {
    match serde_json::from_str::<Value>(line) {
        Err(_) => Incoming::Invalid {
            id: None,
            error: not_json(),
        },
        Ok(Value::Array(_)) => Incoming::Invalid {
            id: None,
            error: batch(),
        },
        Ok(Value::Object(message)) => classify_object(message),
        Ok(_) => Incoming::Invalid {
            id: None,
            error: not_request(),
        },
    }
}

/// Whether a line holds nothing but JSON whitespace, which carries no message.
fn is_blank(line: &[u8]) -> bool {
    line.iter().all(|byte| matches!(byte, b'\t' | b'\r' | b' '))
}

/// Splits a stream of bytes into lines. A message split across two reads joins into one line, a
/// multibyte character split across two reads decodes once, and a blank line is dropped.
#[derive(Debug, Default)]
pub(crate) struct LineSplitter {
    pending: Vec<u8>,
    /// Whether the start of the stream has been checked for a byte-order mark.
    started: bool,
}

/// The UTF-8 byte-order mark, which a stream decoder drops at the start of a stream.
const BYTE_ORDER_MARK: [u8; 3] = [0xEF, 0xBB, 0xBF];

impl LineSplitter {
    /// The complete lines a chunk finishes, in order, blank ones left out.
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(chunk);
        self.skip_byte_order_mark();
        let mut lines = Vec::new();
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let body = &line[..line.len() - 1];
            if !is_blank(body) {
                lines.push(String::from_utf8_lossy(body).into_owned());
            }
        }
        lines
    }

    /// Drops a byte-order mark at the very start of the stream, waiting for more bytes when the
    /// mark may still be arriving.
    fn skip_byte_order_mark(&mut self) {
        if self.started {
            return;
        }
        let seen = self.pending.len().min(BYTE_ORDER_MARK.len());
        if self.pending[..seen] != BYTE_ORDER_MARK[..seen] {
            self.started = true;
        } else if seen == BYTE_ORDER_MARK.len() {
            self.pending.drain(..seen);
            self.started = true;
        }
    }

    /// The last line, when the input ended without a line feed after it and it is not blank.
    pub(crate) fn end(&mut self) -> Vec<String> {
        let rest = std::mem::take(&mut self.pending);
        if is_blank(&rest) {
            Vec::new()
        } else {
            vec![String::from_utf8_lossy(&rest).into_owned()]
        }
    }
}

/// One message as the stdio transport writes it: compact JSON and a line feed, so no message
/// holds a raw line break.
pub(crate) fn frame(message: &Value) -> String {
    let mut text = json_text(message);
    text.push('\n');
    text
}

/// A successful response to a request.
pub(crate) fn result_message(id: &RequestId, result: Map<String, Value>) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.to_value(), "result": result })
}

/// An error response. `id` is `None` when the message named no id the server could read.
pub(crate) fn error_message(id: Option<&RequestId>, error: &ProtocolError) -> Value {
    let mut body = Map::new();
    body.insert("code".into(), json!(error.code));
    body.insert("message".into(), json!(error.message));
    if let Some(data) = &error.data {
        body.insert("data".into(), data.clone());
    }
    json!({
        "jsonrpc": "2.0",
        "id": id.map_or(Value::Null, RequestId::to_value),
        "error": body,
    })
}

/// A notification the server sends.
pub(crate) fn notification_message(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}
