//! The `mcp` Command's server: it serves every opted-in Command as a tool over the host's stdin and
//! stdout, each call run through `invoke`.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context as TaskContext, Poll};

use loomcli_core::{
    CommandGraph, CommandNode, Context, Error, InputStream, InvocationOutcome, InvocationValues,
    InvokeOptions, OutputStream,
};
use loomcli_mcp::{
    McpServer, ProtocolError, ServerInfo, Tool, ToolCall, ToolResult, ToolSource, error_codes,
};
use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufRead, AsyncRead, AsyncWrite, ReadBuf};

use super::messages;
use super::progress::progress_relay;
use super::tools::{
    Property, ToolEntry, excluded_names, listed_tool, properties_of, single_line, tool_entries,
};

/// The media type whose view a call selects and whose output it sends as structured content.
const JSON_MEDIA_TYPE: &str = "application/json";

/// How many bytes one read of the host's stdin asks for.
const READ_CHUNK: usize = 8192;

/// The server's identity: the application's name, version, and description where it declares
/// one, on one line, a line break the author wrote read as a space.
fn identity_of(graph: &CommandGraph) -> ServerInfo {
    let info = ServerInfo::new(graph.name.clone(), graph.version.clone());
    match &graph.description {
        Some(description) => info.with_description(single_line(description)),
        None => info,
    }
}

/// The first view, in record order, that declares `application/json`, if the Command has one.
fn json_view(command: &CommandNode) -> Option<String> {
    let result = command.result.as_ref()?;
    result
        .views
        .iter()
        .find(|name| {
            result
                .media_types
                .get(name.as_str())
                .and_then(Value::as_str)
                == Some(JSON_MEDIA_TYPE)
        })
        .cloned()
}

/// What one tool serves a call from: the Command's path, the names its inputs are listed under,
/// the options it leaves out of a call, and the view whose output is structured content.
struct Served {
    entry: ToolEntry,
    listed: HashSet<String>,
    arguments: HashSet<String>,
    exclude: Vec<String>,
    view: Option<String>,
}

impl Served {
    fn of(graph: &CommandGraph, entry: ToolEntry) -> Result<Self, Error> {
        let properties = properties_of(graph, &entry.command)?;
        let listed = properties
            .iter()
            .map(|property| property.name().to_owned())
            .collect();
        let arguments = properties
            .iter()
            .filter(|property| matches!(property, Property::Argument(_)))
            .map(|property| property.name().to_owned())
            .collect();
        Ok(Self {
            exclude: excluded_names(graph, &entry.command)?,
            view: json_view(&entry.command),
            entry,
            listed,
            arguments,
        })
    }
}

/// What a failed call's mapper keeps, which the call answers as its structured content.
struct FailedCall {
    exit_code: u8,
    failure: Value,
}

/// The tools of one run: its context, through which each call runs `invoke`, and the tool table
/// derived from its graph.
struct Tools {
    context: Context,
    listing: Vec<Tool>,
    served: HashMap<String, Served>,
}

/// The tool execution error for a key the tool's input schema does not list, if any.
fn unlisted_key(served: &Served, received: &Map<String, Value>) -> Option<ToolResult> {
    let unlisted = received.keys().find(|key| !served.listed.contains(*key))?;
    Some(ToolResult {
        messages: messages::unlisted_argument(&served.entry.name, unlisted),
        is_error: true,
        ..ToolResult::default()
    })
}

/// A client's named values, split by whether each names an argument. A value is passed as the
/// client sent it, because `invoke` judges every value and reports one it cannot lower by name.
fn invocation_values(served: &Served, received: Map<String, Value>) -> InvocationValues {
    received
        .into_iter()
        .fold(InvocationValues::new(), |values, (key, value)| {
            if served.arguments.contains(&key) {
                values.arg(&key, value)
            } else {
                values.option(&key, value)
            }
        })
}

/// The result a settled call answers. A cancelled call answers nothing, so its result is dropped.
fn call_result(outcome: InvocationOutcome<FailedCall>, view: Option<&str>) -> ToolResult {
    match outcome {
        InvocationOutcome::Failed {
            failure,
            output,
            messages,
            ..
        } => ToolResult {
            output,
            messages,
            structured_content: Some(json!({
                "exitCode": failure.exit_code,
                "failure": failure.failure,
            })),
            is_error: true,
        },
        InvocationOutcome::Completed { output, messages } => {
            // The output parsed as JSON, or nothing when it does not parse: a media type is a
            // promise core never checks.
            let structured_content = view.and_then(|_| serde_json::from_str(&output).ok());
            ToolResult {
                output,
                messages,
                structured_content,
                is_error: false,
            }
        }
        _ => ToolResult::default(),
    }
}

impl Tools {
    /// Runs one tool call through `invoke`, as the Command's own run, and answers its result. A
    /// key the input schema does not list answers a tool execution error, and no run starts. A
    /// call that carries a progress token receives each progress event of the run as a
    /// notification.
    async fn call(&self, served: &Served, call: ToolCall) -> Result<ToolResult, ProtocolError> {
        let received = match call.arguments {
            None => Map::new(),
            Some(Value::Object(map)) => map,
            Some(_) => {
                return Err(ProtocolError::new(
                    error_codes::INVALID_PARAMS,
                    messages::arguments_not_object(&served.entry.name),
                ));
            }
        };
        if let Some(refused) = unlisted_key(served, &received) {
            return Ok(refused);
        }
        let mut options = InvokeOptions::new()
            .failure(|_failure, context| FailedCall {
                exit_code: context.exit_code.get(),
                failure: serde_json::to_value(&context.form).unwrap_or(Value::Null),
            })
            .signal(call.cancel.clone());
        if !served.exclude.is_empty() {
            options = options.exclude(served.exclude.iter().cloned());
        }
        if let Some(view) = &served.view {
            options = options.view(view.clone());
        }
        if let Some(progress) = call.progress {
            options = options.on_progress(progress_relay(progress));
        }
        let path: Vec<&str> = served
            .entry
            .command
            .path
            .iter()
            .map(String::as_str)
            .collect();
        let outcome = self
            .context
            .invoke(&path, invocation_values(served, received), options)
            .await;
        Ok(call_result(outcome, served.view.as_deref()))
    }
}

impl ToolSource for Tools {
    async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
        Ok(self.listing.clone())
    }

    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, ProtocolError> {
        let Some(served) = self.served.get(&call.name) else {
            return Err(ProtocolError::new(
                error_codes::INVALID_PARAMS,
                messages::unknown_tool(&call.name),
            ));
        };
        self.call(served, call).await
    }
}

/// Serves every opted-in Command as a tool over the host's stdin and stdout until stdin ends or
/// the run's signal is cancelled. The tool table is derived here from the run's graph, which the
/// build-fault hook already judged.
pub(super) async fn serve(context: Context) -> Result<(), Error> {
    let graph = Arc::clone(&context.graph);
    let entries = tool_entries(&graph)?;
    let mut listing = Vec::with_capacity(entries.len());
    let mut served = HashMap::with_capacity(entries.len());
    for entry in entries {
        listing.push(listed_tool(&graph, &entry)?);
        served.insert(entry.name.clone(), Served::of(&graph, entry)?);
    }
    let input = HostInput::new(context.host.stdin());
    let output = HostOutput::new(context.host.stdout());
    let shutdown = context.signal.token();
    let tools = Tools {
        context,
        listing,
        served,
    };
    let server = McpServer::new(identity_of(&graph), tools);
    server.run_until(input, output, shutdown).await?;
    Ok(())
}

/// A read of the host's stdin in flight: it owns its buffer, so a read the server stops waiting
/// for keeps its bytes for the next poll.
type PendingRead = Pin<Box<dyn Future<Output = (io::Result<usize>, Vec<u8>)> + Send>>;

/// The host's stdin as a buffered tokio reader. A read in flight stays with the reader when its
/// caller stops polling, so no byte is lost.
struct HostInput {
    stream: Arc<dyn InputStream>,
    buffer: Vec<u8>,
    position: usize,
    pending: Option<PendingRead>,
}

impl HostInput {
    fn new(stream: Arc<dyn InputStream>) -> Self {
        Self {
            stream,
            buffer: Vec::new(),
            position: 0,
            pending: None,
        }
    }
}

impl AsyncRead for HostInput {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let available = match self.as_mut().poll_fill_buf(cx) {
            Poll::Ready(Ok(available)) => available,
            Poll::Ready(Err(error)) => return Poll::Ready(Err(error)),
            Poll::Pending => return Poll::Pending,
        };
        let taken = available.len().min(buf.remaining());
        buf.put_slice(&available[..taken]);
        self.consume(taken);
        Poll::Ready(Ok(()))
    }
}

impl AsyncBufRead for HostInput {
    fn poll_fill_buf(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<&[u8]>> {
        let this = self.get_mut();
        if this.position >= this.buffer.len() {
            let stream = &this.stream;
            let pending = this.pending.get_or_insert_with(|| {
                let stream = Arc::clone(stream);
                Box::pin(async move {
                    let mut chunk = vec![0; READ_CHUNK];
                    let read = stream.read(&mut chunk).await;
                    (read, chunk)
                })
            });
            let (read, mut chunk) = match pending.as_mut().poll(cx) {
                Poll::Ready(done) => done,
                Poll::Pending => return Poll::Pending,
            };
            this.pending = None;
            let count = read?;
            chunk.truncate(count);
            this.buffer = chunk;
            this.position = 0;
        }
        Poll::Ready(Ok(&this.buffer[this.position..]))
    }

    fn consume(self: Pin<&mut Self>, amount: usize) {
        let this = self.get_mut();
        this.position = (this.position + amount).min(this.buffer.len());
    }
}

/// A write to the host's stdout in flight.
type PendingWrite = Pin<Box<dyn Future<Output = io::Result<()>> + Send>>;

/// The host's stdout as a tokio writer. Each write is handed to the stream whole and finishes
/// before the next starts, so messages keep their order, and a flush waits for the last.
struct HostOutput {
    stream: Arc<dyn OutputStream>,
    pending: Option<PendingWrite>,
}

impl HostOutput {
    fn new(stream: Arc<dyn OutputStream>) -> Self {
        Self {
            stream,
            pending: None,
        }
    }

    /// Drives the write in flight, if any, to its end.
    fn poll_pending(&mut self, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        let Some(pending) = self.pending.as_mut() else {
            return Poll::Ready(Ok(()));
        };
        let done = match pending.as_mut().poll(cx) {
            Poll::Ready(done) => done,
            Poll::Pending => return Poll::Pending,
        };
        self.pending = None;
        Poll::Ready(done)
    }
}

impl AsyncWrite for HostOutput {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        match this.poll_pending(cx) {
            Poll::Ready(Ok(())) => {}
            Poll::Ready(Err(error)) => return Poll::Ready(Err(error)),
            Poll::Pending => return Poll::Pending,
        }
        let stream = Arc::clone(&this.stream);
        let bytes = buf.to_vec();
        this.pending = Some(Box::pin(async move { stream.write(&bytes).await }));
        Poll::Ready(Ok(buf.len()))
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        self.get_mut().poll_pending(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        self.get_mut().poll_pending(cx)
    }
}
