//! The server: its identity and tool source, and the stdio transport, one run over one pair of
//! streams that holds one [`Connection`].

use std::io;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio_util::sync::CancellationToken;

use crate::connection::{Admission, Channel, ChannelRef, Connection, Shared, locked};
use crate::http::{HttpOptions, HttpTransport};
use crate::json_rpc::{Incoming, LINE_WORDING, LineSplitter, classify, error_message, frame};
use crate::protocol::{ServerInfo, ToolSource};

/// An MCP server of both eras, over a stdio-style pair of streams or over streamable HTTP. A
/// request carrying per-request `_meta` is served on the per-request revision, which serves
/// `server/discover`, `tools/list`, `tools/call`, and `subscriptions/listen`. A connection that
/// opens with `initialize` is served on the initialize-era revision it negotiates, which serves
/// `ping`, `tools/list`, and `tools/call`. Every other method is not found.
///
/// Over stdio the server speaks newline-delimited JSON-RPC 2.0: each message it writes is one
/// compact JSON document and a line feed. It knows nothing of the tools but what its
/// [`ToolSource`] says.
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
    /// answers no call, and once every call has settled, sends each open subscription its
    /// teardown: `notifications/cancelled` naming it, then its closing result. A token already
    /// cancelled reads nothing and answers nothing.
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
        let (lines_tx, lines_rx) = unbounded_channel();
        let serve = async {
            let channel = Arc::new(StdioChannel {
                lines: Mutex::new(Some(lines_tx)),
            });
            let mut run = StdioRun {
                connection: Connection::new(Arc::clone(&self.shared), None),
                channel: Arc::clone(&channel) as ChannelRef,
                splitter: LineSplitter::default(),
            };
            let read = if shutdown.is_cancelled() {
                run.connection.silence();
                Ok(())
            } else {
                run.read_loop(&mut input, &shutdown).await
            };
            run.end(&shutdown).await;
            // The writer ends once every queued line is written.
            channel.close();
            read
        };
        // The writer runs beside the run, so a client that is slow to read never stops the server
        // from reading.
        let (read, ()) = tokio::join!(serve, write_lines(output, lines_rx));
        read
    }

    /// The server's streamable HTTP transport, which answers each socket its caller hands it
    /// until the options' shutdown token is cancelled. Call it inside a tokio runtime.
    #[must_use]
    pub fn http(&self, options: HttpOptions) -> HttpTransport<S> {
        HttpTransport::new(Arc::clone(&self.shared), options)
    }
}

/// Writes each queued line in order. A write the client can no longer read has no one to report
/// to.
async fn write_lines<W: AsyncWrite + Unpin>(mut output: W, mut lines: UnboundedReceiver<String>) {
    while let Some(line) = lines.recv().await {
        let _ = output.write_all(line.as_bytes()).await;
        let _ = output.flush().await;
    }
}

/// The next chunk of the input, empty at its end. Cancel safe: nothing is taken from the input
/// before the chunk is returned.
async fn next_chunk<R: AsyncBufRead + Unpin>(input: &mut R) -> io::Result<Vec<u8>> {
    let chunk = input.fill_buf().await?.to_vec();
    input.consume(chunk.len());
    Ok(chunk)
}

/// The one channel every request of a stdio run shares: the output, one line per message.
struct StdioChannel {
    lines: Mutex<Option<UnboundedSender<String>>>,
}

impl StdioChannel {
    /// Lets the writer end once it has written what is queued.
    fn close(&self) {
        locked(&self.lines).take();
    }
}

impl Channel for StdioChannel {
    fn send(&self, message: &Value) {
        if let Some(lines) = locked(&self.lines).as_ref() {
            // A closed queue means the writer ended, and then there is no client to tell.
            let _ = lines.send(frame(message));
        }
    }

    fn end(&self) {}
}

/// One run of a server over one pair of streams: its connection, which every line of the input
/// reaches, and the line splitter.
struct StdioRun<S> {
    connection: Connection<S>,
    channel: ChannelRef,
    splitter: LineSplitter,
}

impl<S: ToolSource> StdioRun<S> {
    /// Reads and serves until the input ends or the shutdown token is cancelled, which silences
    /// the connection.
    async fn read_loop<R: AsyncBufRead + Unpin>(
        &mut self,
        input: &mut R,
        shutdown: &CancellationToken,
    ) -> io::Result<()> {
        loop {
            tokio::select! {
                biased;
                () = shutdown.cancelled() => {
                    self.connection.silence();
                    return Ok(());
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

    /// Ends the run once the input has ended or the shutdown token was cancelled: a last line with
    /// no line feed is handled, every call aborts and answers nothing, and once each has settled,
    /// each open subscription is cancelled and answered with its closing result. A token cancelled
    /// meanwhile silences the connection.
    async fn end(&mut self, shutdown: &CancellationToken) {
        for line in self.splitter.end() {
            self.receive(&line);
        }
        self.connection.abort_all();
        tokio::select! {
            biased;
            () = self.connection.settled() => {}
            () = shutdown.cancelled(), if !self.connection.silenced() => {
                self.connection.silence();
                self.connection.settled().await;
            }
        }
        self.connection.close_subscriptions();
    }

    /// Handles one line the client wrote.
    fn receive(&mut self, line: &str) {
        if self.connection.silenced() {
            return;
        }
        match classify(line, &LINE_WORDING) {
            Incoming::Invalid { id, error } => {
                self.channel.send(&error_message(id.as_ref(), &error));
            }
            Incoming::Notification { method, params } => {
                self.connection.notify(&method, params.as_ref());
            }
            Incoming::Request { id, method, params } => {
                match self.connection.admit(id.clone(), method, params) {
                    Admission::Refused(refusal) => {
                        self.channel.send(&error_message(Some(&id), &refusal.error));
                    }
                    // A stdio run's connection has no session, so it never ends and every
                    // request begins.
                    Admission::Admitted(admitted) => {
                        let _ = self.connection.begin(admitted, Arc::clone(&self.channel));
                    }
                }
            }
            Incoming::Response => {}
        }
    }
}
