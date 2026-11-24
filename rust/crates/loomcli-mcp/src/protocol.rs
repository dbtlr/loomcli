//! The types a tool source and the server exchange: identity, tools, calls, results, progress.

use std::future::Future;

use serde::Serialize;
use serde_json::{Map, Value};
use tokio::sync::mpsc::UnboundedSender;
use tokio_util::sync::CancellationToken;

use crate::json_rpc::{ProtocolError, RequestId};
use crate::server::Event;

/// Who the server is. Every per-request result carries it in `_meta` under
/// `io.modelcontextprotocol/serverInfo`, and an `initialize` result carries it as `serverInfo`,
/// without its description on the earliest initialize-era revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ServerInfo {
    /// The server's name.
    pub name: String,
    /// The server's version.
    pub version: String,
    /// What the server does, when it says.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl ServerInfo {
    /// An identity with a name and a version and no description.
    #[must_use]
    pub fn new(name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            version: version.into(),
            description: None,
        }
    }

    /// The same identity with a description.
    #[must_use]
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }
}

/// The hints a tool may carry about its effects. A client treats them as untrusted.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnnotations {
    /// A human-readable title for the tool.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Whether the tool changes nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only_hint: Option<bool>,
    /// Whether the tool may destroy data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive_hint: Option<bool>,
    /// Whether calling the tool again with the same arguments changes nothing more.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotent_hint: Option<bool>,
    /// Whether the tool reaches beyond the closed world of its own application.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_world_hint: Option<bool>,
}

/// One tool as `tools/list` lists it. Its input schema describes the object `arguments` holds.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    /// The tool's name, which `tools/call` names.
    pub name: String,
    /// A display title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// What the tool does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The JSON Schema of the arguments object. The caller includes `"type": "object"`.
    pub input_schema: Map<String, Value>,
    /// The JSON Schema of the structured content, when the tool declares one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Map<String, Value>>,
    /// Effect hints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<ToolAnnotations>,
}

impl Tool {
    /// A tool with a name and an input schema and nothing else.
    #[must_use]
    pub fn new(name: impl Into<String>, input_schema: Map<String, Value>) -> Self {
        Self {
            name: name.into(),
            title: None,
            description: None,
            input_schema,
            output_schema: None,
            annotations: None,
        }
    }

    /// The same tool with a description.
    #[must_use]
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// The same tool with effect hints.
    #[must_use]
    pub fn with_annotations(mut self, annotations: ToolAnnotations) -> Self {
        self.annotations = Some(annotations);
        self
    }
}

/// What a tool call answers. The server builds the result's `content` from `output` and
/// `messages`: a completed call lists `output`, then `messages`, and a failed call lists
/// `messages`, then `output`, each only when it is not empty, or one empty text item when both
/// are.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ToolResult {
    /// The call's output text.
    pub output: String,
    /// The call's messages text.
    pub messages: String,
    /// Structured content, any JSON value. A connection on an initialize-era revision carries it
    /// only when it is an object.
    pub structured_content: Option<Value>,
    /// Whether this is a tool execution error, which a model reads and can correct, as opposed to
    /// a protocol error.
    pub is_error: bool,
}

/// One progress update a tool sends on its call's progress token. The protocol asks that
/// `progress` increase with each update, which the tool keeps, because the server passes each one
/// on as given.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProgressUpdate {
    /// How far the call has come.
    pub progress: f64,
    /// The total, when known.
    pub total: Option<f64>,
    /// A message describing the step.
    pub message: Option<String>,
}

/// Where a tool sends progress. Each [`ProgressSink::send`] writes one `notifications/progress`
/// on the call's progress token, until the call is answered, cancelled, or aborted. The sink is
/// cheap to clone.
#[derive(Debug, Clone)]
pub struct ProgressSink {
    events: UnboundedSender<Event>,
    id: RequestId,
    generation: u64,
    token: Value,
}

impl ProgressSink {
    pub(crate) fn new(
        events: UnboundedSender<Event>,
        id: RequestId,
        generation: u64,
        token: Value,
    ) -> Self {
        Self {
            events,
            id,
            generation,
            token,
        }
    }

    /// Sends one update. An update sent after the call ended is dropped.
    pub fn send(&self, update: ProgressUpdate) {
        // A closed channel means the run ended, and then there is no client to tell.
        let _ = self.events.send(Event::Progress {
            id: self.id.clone(),
            generation: self.generation,
            token: self.token.clone(),
            update,
        });
    }
}

/// One `tools/call` request as a tool source receives it.
#[derive(Debug, Clone)]
pub struct ToolCall {
    /// The tool's name.
    pub name: String,
    /// The `arguments` the client sent, as sent: absent, an object, or any other JSON value, so
    /// the tool source judges its shape.
    pub arguments: Option<Value>,
    /// Cancelled when the client cancels the request or the server shuts down.
    pub cancel: CancellationToken,
    /// Present when the request's `params._meta` carries a `progressToken`.
    pub progress: Option<ProgressSink>,
}

/// The tools a server serves. The caller implements it; the server knows nothing else about the
/// tools. Calls may overlap, so methods take `&self`. A panic in either method is answered with
/// an internal error and the server keeps serving.
pub trait ToolSource: Send + Sync + 'static {
    /// The tool listing, one page.
    fn list_tools(&self) -> impl Future<Output = Result<Vec<Tool>, ProtocolError>> + Send;

    /// Runs one tool call. An `Err` answers the request with that JSON-RPC error. A call whose
    /// token is cancelled sends no response whatever it returns.
    fn call_tool(
        &self,
        call: ToolCall,
    ) -> impl Future<Output = Result<ToolResult, ProtocolError>> + Send;
}
