//! One HTTP connection: the socket the caller handed the transport, served by hyper's HTTP/1.1
//! connection, its receipt deadlines, and how it closes.
//!
//! The transport keeps a second handle on the socket beside the one hyper reads and writes, so it
//! can still write a raw 408 once hyper's header deadline has ended the connection, and so, once
//! hyper hands the socket back after an answer that closes the connection, it can end its own
//! side and discard the unread body before it closes. The handle hyper reads through tells the
//! socket's state when a byte arrives, so the transport knows a socket that awaits a request from
//! one that has begun sending it.

use std::future::{Future, poll_fn};
use std::io;
use std::pin::{Pin, pin};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, ready};
use std::time::Duration;

use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use tokio::time::{Instant, Sleep, sleep_until};

use super::Transport;
use super::body::{Abort, ResponseBody};
use crate::connection::locked;
use crate::protocol::ToolSource;

/// How long the headers of a request may take to arrive, Node's default.
const HEADERS_DEADLINE: Duration = Duration::from_secs(60);
/// How long a whole request may take to arrive, its body included, Node's default.
const REQUEST_DEADLINE: Duration = Duration::from_secs(300);
/// How long a refused request may keep sending before its HTTP connection closes.
const LINGER: Duration = Duration::from_secs(2);
/// How long a kept-alive socket waits for the first byte of its next request before it closes:
/// the 5 seconds a response advertises in `Keep-Alive: timeout=5`, Node's default keep-alive
/// timeout, and the 1 second Node adds so a client that reuses the socket at the advertised limit
/// does not race its close.
const KEEP_ALIVE_IDLE: Duration = Duration::from_secs(6);
/// The most bytes a request's line and headers may take, and the most headers it may carry:
/// Node's defaults. hyper answers either with 431 before the transport sees the request.
const MAX_HEADER_BYTES: usize = 16_384;
const MAX_HEADERS: usize = 2_000;

/// The answer a request gets when its headers miss their deadline.
const RAW_TIMEOUT: &[u8] =
    b"HTTP/1.1 408 Request Timeout\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

/// What happens to the socket once hyper hands it back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum After {
    /// It closes.
    Close,
    /// It ends its own side, then discards what the client still sends for up to 2 seconds.
    Linger,
}

/// Where a socket is between its requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// It was accepted and has sent nothing.
    Fresh,
    /// It has sent part of a request that the transport has not begun to answer.
    Head,
    /// The transport is answering a request.
    Serving,
    /// A response finished and the socket awaits the first byte of its next request.
    KeptAlive,
}

/// One socket's receipt state: since when it has awaited its next request, where it is between
/// requests, and how it closes.
pub(super) struct SocketState {
    idle_since: Mutex<Instant>,
    phase: Mutex<Phase>,
    after: Mutex<After>,
}

impl SocketState {
    fn new() -> Self {
        Self {
            idle_since: Mutex::new(Instant::now()),
            phase: Mutex::new(Phase::Fresh),
            after: Mutex::new(After::Close),
        }
    }

    /// The transport began to answer a request.
    pub(super) fn started(&self) {
        *locked(&self.phase) = Phase::Serving;
    }

    /// Bytes arrived: a socket that awaited a request has begun one.
    fn heard(&self) {
        let mut phase = locked(&self.phase);
        if matches!(*phase, Phase::Fresh | Phase::KeptAlive) {
            *phase = Phase::Head;
        }
    }

    /// Whether no response is in flight and none has just finished, so closing the socket at once
    /// loses nothing: it has sent nothing, or only part of a request.
    fn awaits_answer(&self) -> bool {
        matches!(*locked(&self.phase), Phase::Fresh | Phase::Head)
    }

    /// When a kept-alive socket that has sent nothing since its last response closes.
    fn idle_deadline(&self) -> Option<Instant> {
        (*locked(&self.phase) == Phase::KeptAlive)
            .then(|| *locked(&self.idle_since) + KEEP_ALIVE_IDLE)
    }

    /// The deadline by which the request whose headers just arrived must arrive whole: 300
    /// seconds after the socket began to await it.
    pub(super) fn request_deadline(&self) -> Instant {
        *locked(&self.idle_since) + REQUEST_DEADLINE
    }

    /// A response finished, so the socket awaits its next request from now.
    pub(super) fn finished(&self) {
        *locked(&self.idle_since) = Instant::now();
        *locked(&self.phase) = Phase::KeptAlive;
    }

    /// The answer closes the HTTP connection before its body was consumed: the socket lingers.
    pub(super) fn linger(&self) {
        *locked(&self.after) = After::Linger;
    }
}

/// Serves one socket until its HTTP connection closes. The transport's shutdown closes a socket
/// with no response in flight at once, and asks hyper to close any other once its response has
/// ended. A kept-alive socket that sends nothing for 6 seconds after a response closes too,
/// writing nothing.
pub(super) async fn serve_socket<S: ToolSource>(transport: Arc<Transport<S>>, stream: TcpStream) {
    let socket = Arc::new(stream);
    let state = Arc::new(SocketState::new());
    let service = {
        let transport = Arc::clone(&transport);
        let state = Arc::clone(&state);
        service_fn(move |request: Request<Incoming>| {
            let transport = Arc::clone(&transport);
            let state = Arc::clone(&state);
            let responding: Pin<
                Box<dyn Future<Output = Result<Response<ResponseBody>, Abort>> + Send>,
            > = Box::pin(async move { transport.respond(&state, request).await });
            responding
        })
    };
    let mut connection = http1::Builder::new()
        .timer(TokioTimer::new())
        .header_read_timeout(HEADERS_DEADLINE)
        .max_header_size(MAX_HEADER_BYTES)
        .max_headers(MAX_HEADERS)
        .serve_connection(
            TokioIo::new(SharedSocket {
                socket: Arc::clone(&socket),
                state: Arc::clone(&state),
            }),
            service,
        );
    let shutdown = transport.shutdown().clone();
    let mut stopping = pin!(shutdown.cancelled_owned());
    let mut closing = false;
    let mut idle: Option<Pin<Box<Sleep>>> = None;
    let served = poll_fn(|cx| {
        loop {
            if !closing && stopping.as_mut().poll(cx).is_ready() {
                closing = true;
                Pin::new(&mut connection).graceful_shutdown();
            }
            if closing && state.awaits_answer() {
                return Poll::Ready(None);
            }
            if let Poll::Ready(served) = connection.poll_without_shutdown(cx) {
                return Poll::Ready(Some(served));
            }
            let Some(deadline) = state.idle_deadline().filter(|_| !closing) else {
                idle = None;
                return Poll::Pending;
            };
            let timer = idle.get_or_insert_with(|| Box::pin(sleep_until(deadline)));
            if timer.deadline() != deadline {
                timer.as_mut().reset(deadline);
            }
            ready!(timer.as_mut().poll(cx));
            // hyper closes a kept-alive connection at once, once what it writes has flushed.
            closing = true;
            Pin::new(&mut connection).graceful_shutdown();
        }
    })
    .await;
    match served {
        Some(Ok(())) => {
            drop(connection.into_parts());
            if *locked(&state.after) == After::Linger
                && let Ok(stream) = Arc::try_unwrap(socket)
            {
                linger(stream, &transport).await;
            }
        }
        Some(Err(error)) if error.is_timeout() && !transport.shutdown().is_cancelled() => {
            write_raw(&socket, RAW_TIMEOUT).await;
        }
        Some(Err(_)) | None => {}
    }
}

/// Ends the server's side of a refused request's HTTP connection, then reads and discards what the
/// client still sends for up to 2 seconds, until it ends its side, or until the server stops,
/// and then closes, so the client reads the answer rather than a reset.
async fn linger<S: ToolSource>(mut stream: TcpStream, transport: &Transport<S>) {
    let _ = stream.shutdown().await;
    let mut sink = vec![0_u8; 65_536];
    let discard = async {
        while let Ok(read) = stream.read(&mut sink).await {
            if read == 0 {
                break;
            }
        }
    };
    tokio::select! {
        () = discard => {}
        () = tokio::time::sleep(LINGER) => {}
        () = transport.shutdown().cancelled() => {}
    }
}

/// Writes raw bytes to a socket hyper no longer serves, giving up at the first refusal.
async fn write_raw(socket: &TcpStream, mut bytes: &[u8]) {
    while !bytes.is_empty() {
        if socket.writable().await.is_err() {
            return;
        }
        match socket.try_write(bytes) {
            Ok(written) => bytes = &bytes[written..],
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
            Err(_) => return,
        }
    }
}

/// The socket as hyper reads and writes it, through a handle the transport shares, and the state
/// each byte read reaches. Shutting it down is left to the transport, which owns how the
/// connection closes.
struct SharedSocket {
    socket: Arc<TcpStream>,
    state: Arc<SocketState>,
}

impl AsyncRead for SharedSocket {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        loop {
            ready!(self.socket.poll_read_ready(cx))?;
            match self.socket.try_read(buf.initialize_unfilled()) {
                Ok(read) => {
                    if read > 0 {
                        self.state.heard();
                    }
                    buf.advance(read);
                    return Poll::Ready(Ok(()));
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                Err(error) => return Poll::Ready(Err(error)),
            }
        }
    }
}

impl AsyncWrite for SharedSocket {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        loop {
            ready!(self.socket.poll_write_ready(cx))?;
            match self.socket.try_write(buf) {
                Ok(written) => return Poll::Ready(Ok(written)),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                Err(error) => return Poll::Ready(Err(error)),
            }
        }
    }

    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}
