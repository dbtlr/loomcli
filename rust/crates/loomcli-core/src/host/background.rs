//! The background query through the run's process handle: the terminal is asked its background
//! once, in raw mode, and every byte that is not a reply goes back onto stdin.
//!
//! Background settlement in the run calls [`ask_terminal`] when only the terminal's answer can
//! settle the background; until the run lifecycle lands, only the tests call it.
#![cfg_attr(not(test), allow(dead_code))]

use std::future::Future;
use std::pin::pin;
use std::sync::Arc;
use std::task::Poll;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use super::keys::has_interrupt_key;
use super::{Host, InputStream, raise_interrupt_keys};
use crate::marks::Background;
use crate::style::{BACKGROUND_QUERY, query_allowed, read_replies};

/// How long core waits for the DA1 reply: a backstop for a pseudo-terminal with no emulator behind
/// it, a stalled link, or a terminal without DA1.
const DEADLINE: Duration = Duration::from_millis(1000);

/// A shutdown handler's remover: called once, it unregisters the handler.
pub(crate) type ShutdownRemover = Box<dyn FnOnce() + Send>;

/// What the query needs from its run.
pub(crate) struct QueryRun<'a> {
    /// Cancels the run, for Ctrl-C or Ctrl-\ read from a stdin that is not the signal source's
    /// terminal.
    pub(crate) cancel: &'a (dyn Fn() + Sync),
    /// Registers a handler that runs once if a signal ends the process during the wait, and
    /// answers its remover. The query restores the raw mode it found through it.
    pub(crate) on_shutdown: &'a (dyn Fn(Box<dyn FnOnce() + Send>) -> ShutdownRemover + Sync),
    /// The run's signal: a run already cancelled is not asked, and a cancellation ends the wait.
    pub(crate) signal: &'a CancellationToken,
}

/// The terminal's answer to the background query, written to stderr, or `None` when a skip applies:
/// the run is already cancelled, the environment forbids the query, the process is a background job
/// of the real terminal, or stdin offers no raw mode. Settlement asks only when stdin, stdout, and
/// stderr are all terminals and color is on.
///
/// The wait ends at the DA1 reply, an interrupt key, one second, a cancellation of the run, or the
/// end of stdin. The raw mode found is restored before it answers. Every byte that is not a reply is
/// pushed back onto stdin in arrival order, so keys typed ahead reach the action's own read. Each
/// interrupt key raises its signal through [`raise_interrupt_keys`], and once a signal is raised
/// nothing is pushed back, as a cooked terminal discards the input still unread.
pub(crate) async fn ask_terminal(host: &Host, run: QueryRun<'_>) -> Option<Background> {
    let stdin = host.stdin();
    if run.signal.is_cancelled() || !query_allowed(&host.env) || stdin.in_background_job() {
        return None;
    }
    let found = stdin.is_raw();
    if stdin.set_raw_mode(true).is_err() {
        return None;
    }
    let restore = {
        let stdin = Arc::clone(&stdin);
        move || {
            let _ = stdin.set_raw_mode(found);
        }
    };
    let remove = (run.on_shutdown)(Box::new(restore.clone()));
    let deadline = tokio::time::sleep(DEADLINE);
    // The write's failure, like a closed stderr, leaves the wait to the deadline.
    let _ = host.stderr().write(BACKGROUND_QUERY.as_bytes()).await;
    let (received, ended) = wait_for_replies(&stdin, run.signal, deadline).await;
    remove();
    restore();
    let replies = read_replies(&received);
    let keys = raise_interrupt_keys(host, run.cancel, &latin1(&replies.typeahead));
    let rest: Vec<u8> = keys
        .rest
        .chars()
        .filter_map(|character| u8::try_from(character).ok())
        .collect();
    if !rest.is_empty() && !ended {
        stdin.unshift(&rest);
    }
    if keys.raised.is_some() {
        signals_delivered().await;
    }
    replies.answer
}

/// Reads stdin until the DA1 reply, an interrupt key, the deadline, a cancellation of `signal`, or
/// the end of stdin, answering every byte read and whether stdin ended. A read the wait abandons
/// leaves its bytes for the stream's next read.
async fn wait_for_replies(
    stdin: &Arc<dyn InputStream>,
    signal: &CancellationToken,
    deadline: tokio::time::Sleep,
) -> (Vec<u8>, bool) {
    let mut received = Vec::new();
    let mut buffer = [0_u8; 1024];
    let mut deadline = pin!(deadline);
    let mut cancelled = pin!(signal.cancelled());
    loop {
        let read = {
            let mut read = stdin.read(&mut buffer);
            std::future::poll_fn(|context| {
                if cancelled.as_mut().poll(context).is_ready()
                    || deadline.as_mut().poll(context).is_ready()
                {
                    return Poll::Ready(None);
                }
                read.as_mut().poll(context).map(Some)
            })
            .await
        };
        match read {
            None | Some(Err(_)) => return (received, false),
            Some(Ok(0)) => return (received, true),
            Some(Ok(count)) => {
                received.extend_from_slice(&buffer[..count]);
                let replies = read_replies(&received);
                if replies.ended || has_interrupt_key(&latin1(&replies.typeahead)) {
                    return (received, false);
                }
            }
        }
    }
}

/// Bytes as one character per byte, as the reference reads a raw-mode chunk as latin1.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().copied().map(char::from).collect()
}

/// Waits a moment for a signal raised on the process to reach its listeners, so the run does not
/// go on past the query before a shutdown the key started finds it: two turns of the runtime, as
/// the reference waits two turns of its event loop.
async fn signals_delivered() {
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
}
