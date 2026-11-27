//! The responses the transport writes: one `application/json` answer, an answer with no body, or
//! an event stream, and the channels a request's messages reach them through.

use std::convert::Infallible;
use std::fmt;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use hyper::body::{Body, Bytes, Frame, SizeHint};
use hyper::header::{HeaderName, HeaderValue};
use hyper::{Response, StatusCode};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Interval, MissedTickBehavior, interval_at};

use super::socket::SocketState;
use crate::connection::{Channel, locked};
use crate::json_rpc::json_text;

/// How often an open event stream carries a comment line.
const KEEP_ALIVE: Duration = Duration::from_secs(15);

/// The comment line an idle event stream carries.
const KEEP_ALIVE_LINE: &[u8] = b": keep-alive\n\n";

/// Ends the HTTP connection with no response, as a destroyed `node:http` response does: hyper
/// closes the connection when its service fails.
#[derive(Debug)]
pub(super) struct Abort;

impl fmt::Display for Abort {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the response was abandoned")
    }
}

impl std::error::Error for Abort {}

/// A response's body: whole, or an event stream.
pub(super) enum ResponseBody {
    Whole(Option<Bytes>),
    Stream(StreamBody),
}

impl Body for ResponseBody {
    type Data = Bytes;
    type Error = Infallible;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
        match self.get_mut() {
            Self::Whole(bytes) => Poll::Ready(bytes.take().map(|bytes| Ok(Frame::data(bytes)))),
            Self::Stream(stream) => stream.poll_event(cx).map(|event| event.map(Ok)),
        }
    }

    fn is_end_stream(&self) -> bool {
        matches!(self, Self::Whole(None))
    }

    fn size_hint(&self) -> SizeHint {
        match self {
            Self::Whole(bytes) => {
                SizeHint::with_exact(bytes.as_ref().map_or(0, |bytes| bytes.len() as u64))
            }
            Self::Stream(_) => SizeHint::default(),
        }
    }
}

/// What a response does around its request: `cancel` when its client closes it before it ends,
/// and `ended` once it has ended, either way.
#[derive(Default)]
pub(super) struct Hooks {
    pub(super) cancel: Option<Box<dyn FnOnce() + Send>>,
    pub(super) ended: Option<Box<dyn FnOnce() + Send>>,
}

impl Hooks {
    /// The response ended as it should.
    fn ended(&mut self) {
        self.cancel = None;
        if let Some(ended) = self.ended.take() {
            ended();
        }
    }
}

impl Drop for Hooks {
    /// The response closed before it ended: its client left.
    fn drop(&mut self) {
        if let Some(cancel) = self.cancel.take() {
            cancel();
        }
        if let Some(ended) = self.ended.take() {
            ended();
        }
    }
}

/// Builds a response with its status, its headers, and its body. Every caller names each header
/// with a lowercase literal, so `HeaderName::from_static`, which panics on a name that is not a
/// lowercase token, never panics here.
fn response(
    status: StatusCode,
    headers: &[(&'static str, String)],
    body: ResponseBody,
) -> Response<ResponseBody> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    for (name, value) in headers {
        if let Ok(value) = HeaderValue::from_str(value) {
            response
                .headers_mut()
                .append(HeaderName::from_static(name), value);
        }
    }
    response
}

/// One JSON-RPC message as the one `application/json` answer to a request.
pub(super) fn json(
    status: StatusCode,
    message: &Value,
    headers: &[(&'static str, String)],
) -> Response<ResponseBody> {
    let text = json_text(message);
    let mut all = headers.to_vec();
    all.push(("content-length", text.len().to_string()));
    all.push(("content-type", "application/json".to_owned()));
    response(status, &all, ResponseBody::Whole(Some(Bytes::from(text))))
}

/// An answer with no body.
pub(super) fn empty(
    status: StatusCode,
    headers: &[(&'static str, String)],
) -> Response<ResponseBody> {
    response(status, headers, ResponseBody::Whole(None))
}

/// A channel that holds a request's answer until its request ends, then hands it to the waiting
/// response: `Some` for an answer, `None` for a request that ended with none.
pub(super) struct SingleChannel {
    answer: Mutex<Option<Value>>,
    done: Mutex<Option<oneshot::Sender<Option<Value>>>>,
}

impl SingleChannel {
    pub(super) fn new() -> (Arc<Self>, oneshot::Receiver<Option<Value>>) {
        let (done, answered) = oneshot::channel();
        let channel = Arc::new(Self {
            answer: Mutex::new(None),
            done: Mutex::new(Some(done)),
        });
        (channel, answered)
    }
}

impl Channel for SingleChannel {
    fn send(&self, message: &Value) {
        *locked(&self.answer) = Some(message.clone());
    }

    fn end(&self) {
        if let Some(done) = locked(&self.done).take() {
            // A dropped receiver means the response closed, and then no one reads the answer.
            let _ = done.send(locked(&self.answer).take());
        }
    }
}

/// Waits for a single channel's answer, running the hooks: `cancel` and `ended` when the client
/// closes the response first, and `ended` alone otherwise. `None` when the request ended with no
/// answer.
pub(super) async fn single_answer(
    answered: oneshot::Receiver<Option<Value>>,
    mut hooks: Hooks,
) -> Option<Value> {
    let answer = answered.await.ok().flatten();
    hooks.ended();
    answer
}

/// A channel that answers on an event stream: each message is one event.
pub(super) struct StreamChannel {
    events: Mutex<Option<mpsc::UnboundedSender<Bytes>>>,
}

impl Channel for StreamChannel {
    fn send(&self, message: &Value) {
        if let Some(events) = locked(&self.events).as_ref() {
            let event = format!("data: {}\n\n", json_text(message));
            // A closed stream has no client to tell.
            let _ = events.send(Bytes::from(event));
        }
    }

    fn end(&self) {
        locked(&self.events).take();
    }
}

/// An event stream's body: each message its channel sends, then its end, and a comment line
/// every 15 seconds while it stays open. The hooks run when it ends or its client closes it.
pub(super) struct StreamBody {
    events: mpsc::UnboundedReceiver<Bytes>,
    beat: Interval,
    hooks: Option<Hooks>,
    socket: Arc<SocketState>,
}

impl StreamBody {
    fn poll_event(&mut self, cx: &mut Context<'_>) -> Poll<Option<Frame<Bytes>>> {
        match self.events.poll_recv(cx) {
            Poll::Ready(Some(event)) => return Poll::Ready(Some(Frame::data(event))),
            Poll::Ready(None) => {
                if let Some(mut hooks) = self.hooks.take() {
                    hooks.ended();
                }
                self.socket.finished();
                return Poll::Ready(None);
            }
            Poll::Pending => {}
        }
        if self.beat.poll_tick(cx).is_ready() {
            return Poll::Ready(Some(Frame::data(Bytes::from_static(KEEP_ALIVE_LINE))));
        }
        Poll::Pending
    }
}

/// An event stream's channel and the response it answers on: 200, `text/event-stream`, with
/// `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
pub(super) fn event_stream(
    socket: &Arc<SocketState>,
    hooks: Hooks,
) -> (Arc<StreamChannel>, Response<ResponseBody>) {
    let (sender, events) = mpsc::unbounded_channel();
    let mut beat = interval_at(tokio::time::Instant::now() + KEEP_ALIVE, KEEP_ALIVE);
    beat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let body = StreamBody {
        events,
        beat,
        hooks: Some(hooks),
        socket: Arc::clone(socket),
    };
    let channel = Arc::new(StreamChannel {
        events: Mutex::new(Some(sender)),
    });
    let headers = [
        ("cache-control", "no-cache".to_owned()),
        ("content-type", "text/event-stream".to_owned()),
        ("x-accel-buffering", "no".to_owned()),
    ];
    let answer = response(StatusCode::OK, &headers, ResponseBody::Stream(body));
    (channel, answer)
}
