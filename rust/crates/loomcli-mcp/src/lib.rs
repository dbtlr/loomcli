//! A Model Context Protocol server over stdio: JSON-RPC framing, protocol revisions, and tool
//! dispatch.
//!
//! The server speaks newline-delimited JSON-RPC 2.0 on any pair of tokio streams, in two eras: the
//! per-request revision, where every request carries its protocol version in `params._meta`, and
//! the initialize-era revisions, negotiated by `initialize`. It knows nothing of Loom's core: it
//! serves the tools a caller supplies as a [`ToolSource`].
//!
//! # Differences from the reference
//!
//! A Rust `String` and `serde_json` cannot hold some input that `JSON.parse` accepts, so the
//! server answers these lines with a parse error (-32700): a lone surrogate escape such as
//! `"\ud800"`, a number too large for an `f64` such as `1e400`, and nesting deeper than 128
//! levels. An integer request id above 2^53 is echoed exactly, where JavaScript rounds it.
//!
//! ```no_run
//! use loomcli_mcp::{McpServer, ProtocolError, ServerInfo, Tool, ToolCall, ToolResult, ToolSource};
//!
//! struct NoTools;
//!
//! impl ToolSource for NoTools {
//!     async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
//!         Ok(Vec::new())
//!     }
//!     async fn call_tool(&self, _call: ToolCall) -> Result<ToolResult, ProtocolError> {
//!         Ok(ToolResult::default())
//!     }
//! }
//!
//! # async fn serve(
//! #     input: impl tokio::io::AsyncBufRead + Unpin,
//! #     output: impl tokio::io::AsyncWrite + Unpin,
//! # ) -> std::io::Result<()> {
//! let server = McpServer::new(ServerInfo::new("example", "0.1.0"), NoTools);
//! server.run(input, output).await
//! # }
//! ```

mod json_rpc;
mod protocol;
mod revision;
mod server;

pub use json_rpc::{ProtocolError, RequestId, error_codes};
pub use protocol::{
    ProgressSink, ProgressUpdate, ServerInfo, Tool, ToolAnnotations, ToolCall, ToolResult,
    ToolSource,
};
pub use revision::{
    HANDSHAKE_REVISIONS, LATEST_HANDSHAKE_REVISION, PROTOCOL_REVISION,
    UNDESCRIBED_HANDSHAKE_REVISION,
};
pub use server::McpServer;
