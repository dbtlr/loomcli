//! Run-owned semantic messages and the text each has yet to write.

use std::any::Any;
use std::borrow::Cow;
use std::collections::{BTreeMap, VecDeque};
use std::future::poll_fn;
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};

use loomcli_style::{
    LineCarry, Renderer, controls_after_last_line, resolved_row_suffix, split_lines,
    unfinished_sequence,
};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use crate::failures::Error;
use crate::support::BoxFuture;

use super::carry::Carry;
use super::emit::{Channel, Lane, Output, Stream, locked};
use super::messages;
use super::screen::{Frame, ends_line, visible};
use super::{View, ViewContext};

type Chunks = Pin<Box<dyn crate::Stream<Item = Result<String, Error>> + Send>>;

/// The marked text of one semantic message as it arrives. The method's lane view renders it.
///
/// Each successful item holds a complete Rust string. Escape raw text with [`crate::escape`]
/// before yielding it. An error ends the message and leaves the text already received in place.
///
/// A streamed message uses its lane view. A whole message's per-call view builder is unavailable.
///
/// ```compile_fail
/// use loomcli_core::{StreamedMessage, lanes};
///
/// fn with_view(message: StreamedMessage) {
///     let _ = message.view(&lanes::warn());
/// }
/// ```
#[must_use]
pub struct StreamedMessage(Chunks);

impl StreamedMessage {
    /// Takes an owned stream of marked text. The semantic call starts reading it and owns it
    /// through completion, independently of the returned future.
    pub fn new(chunks: impl crate::Stream<Item = Result<String, Error>> + Send + 'static) -> Self {
        Self(Box::pin(chunks))
    }
}

#[derive(Default)]
pub(super) struct OpenMessages {
    state: Mutex<Messages>,
    changed: Notify,
}

#[derive(Default)]
struct Messages {
    open: BTreeMap<u64, Arc<OpenMessage>>,
    failed: BTreeMap<u64, Arc<Completion>>,
}

impl OpenMessages {
    pub(super) fn has_rows(&self) -> bool {
        locked(&self.state)
            .open
            .values()
            .any(|message| message.rows)
    }

    pub(super) fn insert(&self, id: u64, message: Arc<OpenMessage>) {
        locked(&self.state).open.insert(id, message);
    }

    fn finish(&self, id: u64, completion: &Arc<Completion>, result: MessageResult) {
        let mut state = locked(&self.state);
        if result.is_err() {
            state.failed.insert(id, Arc::clone(completion));
        }
        completion.set(result);
        state.open.remove(&id);
        self.changed.notify_waiters();
    }

    /// Stops each affected source and queues its closing writes before regions start closing.
    pub(super) fn stop(&self, output: &Output, channel: Option<&Channel>) {
        for message in self.targets(channel) {
            message.stop(output);
        }
    }

    pub(super) fn targets(&self, channel: Option<&Channel>) -> Vec<Arc<OpenMessage>> {
        locked(&self.state)
            .open
            .values()
            .filter(|message| {
                channel.is_none_or(|channel| std::ptr::eq(channel, message.channel.as_ref()))
            })
            .cloned()
            .collect()
    }

    pub(super) async fn wait_channel(&self, channel: &Channel) {
        loop {
            let changed = self.changed.notified();
            if !locked(&self.state)
                .open
                .values()
                .any(|message| std::ptr::eq(channel, message.channel.as_ref()))
            {
                return;
            }
            changed.await;
        }
    }

    pub(super) async fn settle(&self) -> Vec<Error> {
        let failed = loop {
            let changed = self.changed.notified();
            {
                let mut state = locked(&self.state);
                if state.open.is_empty() {
                    break std::mem::take(&mut state.failed);
                }
            }
            changed.await;
        };
        failed
            .into_values()
            .filter_map(|completion| completion.report())
            .filter_map(|fault| resumed(Err(fault)).err())
            .collect()
    }
}

type Panic = Box<dyn Any + Send + 'static>;
type MessageResult = Result<(), MessageFault>;

enum MessageFault {
    Error(Error),
    Panic(Panic),
}

fn resumed(result: MessageResult) -> Result<(), Error> {
    match result {
        Ok(()) => Ok(()),
        Err(MessageFault::Error(error)) => Err(error),
        Err(MessageFault::Panic(payload)) => resume_unwind(payload),
    }
}

/// The run and the completion future share one fault. Receiving it takes it out of the run's
/// failures, even when the caller handles it and continues. A completion future that asks only after
/// the run reported the fault still fails: with a panic when the fault was one, and otherwise with
/// [`ReportedFailure`].
#[derive(Default)]
struct Completion {
    result: Mutex<CompletionResult>,
    done: Notify,
}

#[derive(Default)]
enum CompletionResult {
    #[default]
    Pending,
    Ready(MessageResult),
    /// The completion future took the result.
    Received,
    /// The run took the fault and reported it, a panic when `true`.
    Reported(bool),
}

/// What a completion future awaited after the run reported its message's failure returns.
#[derive(Debug)]
struct ReportedFailure;

impl std::fmt::Display for ReportedFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(messages::STREAMED_FAILURE_REPORTED)
    }
}

impl std::error::Error for ReportedFailure {}

impl Completion {
    fn set(&self, result: MessageResult) {
        *locked(&self.result) = CompletionResult::Ready(result);
        self.done.notify_waiters();
    }

    /// The fault for the run to report, unless the completion future received it first.
    fn report(&self) -> Option<MessageFault> {
        let mut result = locked(&self.result);
        let CompletionResult::Ready(Err(fault)) = &*result else {
            return None;
        };
        let panicked = matches!(fault, MessageFault::Panic(_));
        match std::mem::replace(&mut *result, CompletionResult::Reported(panicked)) {
            CompletionResult::Ready(Err(fault)) => Some(fault),
            _ => None,
        }
    }

    /// The result for the completion future, once there is one.
    fn received(&self) -> Option<MessageResult> {
        let mut result = locked(&self.result);
        match std::mem::replace(&mut *result, CompletionResult::Received) {
            CompletionResult::Pending => {
                *result = CompletionResult::Pending;
                None
            }
            CompletionResult::Ready(ready) => Some(ready),
            // One completion future receives once, so a second ask finds nothing left to fail with.
            CompletionResult::Received => Some(Ok(())),
            CompletionResult::Reported(panicked) => {
                *result = CompletionResult::Reported(panicked);
                Some(Err(if panicked {
                    MessageFault::Panic(Box::new(messages::STREAMED_PANIC_RESUMED))
                } else {
                    MessageFault::Error(Error::from_foreign(Box::new(ReportedFailure)))
                }))
            }
        }
    }

    async fn receive(&self) -> Result<(), Error> {
        loop {
            let done = self.done.notified();
            if let Some(result) = self.received() {
                return resumed(result);
            }
            done.await;
        }
    }
}

pub(super) struct OpenMessage {
    pub(super) id: u64,
    channel: Arc<Channel>,
    stop: CancellationToken,
    rows: bool,
    built_in: bool,
    stream: Stream,
    layout: Mutex<MessageOutput>,
    state: Mutex<Reading>,
}

struct Reading {
    pending: VecDeque<Piece>,
    /// What the last completed layout left to close.
    tail: Option<Piece>,
    ending: bool,
    /// Place of the most recent write, or of the call before its first write.
    place: u64,
    /// The place a print line holds until its closing write.
    line: Option<u64>,
    detached: bool,
    /// What the final layout raised, which the reader resumes or returns once every lock is free.
    fault: Option<MessageFault>,
}

impl OpenMessage {
    pub(super) fn start(
        output: &Arc<Output>,
        id: u64,
        channel: &Arc<Channel>,
        lane: Lane,
        stream: Stream,
        source: StreamedMessage,
    ) -> BoxFuture<'static, Result<(), Error>> {
        let completion = Arc::new(Completion::default());
        let layout = MessageOutput::new(output, lane, stream);
        let rows = !layout.hidden && layout.layout == Layout::Rows;
        let task = MessageTask {
            id,
            output: Arc::clone(output),
            completion: Arc::clone(&completion),
            rows,
        };
        if rows {
            output.enter_live();
        }
        let target = Arc::new(Self {
            id,
            channel: Arc::clone(channel),
            stop: CancellationToken::new(),
            rows,
            built_in: layout.built_in,
            stream,
            layout: Mutex::new(layout),
            state: Mutex::new(Reading {
                pending: VecDeque::new(),
                tail: None,
                ending: false,
                place: id,
                line: None,
                detached: false,
                fault: None,
            }),
        });
        output.streamed.insert(id, Arc::clone(&target));
        if output.cancelled() {
            target.stop(output);
        }
        let writer_output = Arc::clone(output);
        let work = async move { target.read(&writer_output, source.0).await };
        if let Some(runtime) = output.runtime() {
            // The run owns the join even when the completion future is dropped.
            let reader = runtime.spawn(work);
            drop(runtime.spawn(async move {
                let result = match reader.await {
                    Ok(result) => result.map_err(MessageFault::Error),
                    // Core never aborts the reader. Its other outcome is an unwind.
                    Err(error) => Err(MessageFault::Panic(error.into_panic())),
                };
                task.finish(result);
            }));
            Box::pin(async move { completion.receive().await })
        } else {
            // A context built for a unit test can be driven without a Tokio task.
            Box::pin(async move {
                task.finish(work.await.map_err(MessageFault::Error));
                completion.receive().await
            })
        }
    }

    fn stop(&self, output: &Output) {
        // An override can synchronously cancel its run. If it is still rendering, its reader
        // finishes the message after the layout returns.
        let layout = if self.built_in {
            Some(locked(&self.layout))
        } else {
            self.layout.try_lock().ok()
        };
        if let Some(mut layout) = layout {
            let mut state = self.finish(output, &mut layout);
            if state.line.is_none()
                && output.lane(self.stream) == Stream::Stderr
                && state
                    .pending
                    .iter()
                    .all(|piece| !matches!(piece.change, Change::Print { open: true }))
            {
                for piece in std::mem::take(&mut state.pending) {
                    output.queue_message_end(self.id, piece);
                    state.detached = true;
                }
            }
        }
        self.stop.cancel();
    }

    /// Queues the final layout or, if the view faults, the tail from the previous layout. The
    /// queue is available to an exit drain throughout the lane view call.
    fn finish(&self, output: &Output, layout: &mut MessageOutput) -> MutexGuard<'_, Reading> {
        let state = locked(&self.state);
        if state.ending {
            return state;
        }
        drop(state);
        let closing = layout.close(output);
        let mut state = locked(&self.state);
        let pieces = match closing {
            Ok(pieces) => Some(pieces),
            Err(fault) => {
                state.fault = Some(fault);
                None
            }
        };
        if !state.ending {
            state.ending = true;
            let tail = state.tail.take();
            if let Some(pieces) = pieces {
                state.pending.extend(pieces);
            } else {
                let mut piece = tail.unwrap_or_else(|| layout.closing_piece(String::new()));
                piece.text.push('\n');
                state.pending.push_back(piece);
            }
        }
        state
    }

    /// The rest of this message for the exit drain, ordered behind its last write or at the
    /// place a terminal line still holds ahead of writes waiting for it.
    pub(super) fn at_end(&self, output: &Output) -> (u64, Stream, VecDeque<Piece>) {
        let mut state = if let Ok(mut layout) = self.layout.try_lock() {
            self.finish(output, &mut layout)
        } else {
            // A lane view is in flight. Finish with the last completed layout and prevent that
            // view from publishing its output after the drain has taken the queue.
            let mut state = locked(&self.state);
            state.ending = true;
            if let Some(mut tail) = state.tail.take() {
                if !tail.text.is_empty() || matches!(tail.change, Change::Print { .. }) {
                    tail.text.push('\n');
                }
                state.pending.push_back(tail);
            }
            state
        };
        self.stop.cancel();
        (
            state.line.unwrap_or(state.place),
            self.stream,
            std::mem::take(&mut state.pending),
        )
    }

    /// Moves a planned piece into the run's queue before an exit can claim the rest of the plan.
    pub(super) fn next<T>(&self, queue: impl FnOnce(Piece, Option<u64>) -> (u64, T)) -> Option<T> {
        let mut state = locked(&self.state);
        let piece = state.pending.pop_front()?;
        let opens = matches!(piece.change, Change::Print { open: true });
        let (number, queued) = queue(piece, state.line);
        state.place = number;
        if opens && state.line.is_none() {
            state.line = Some(number);
        }
        Some(queued)
    }

    pub(super) fn release_line(&self) {
        locked(&self.state).line = None;
    }

    async fn read(&self, output: &Output, mut source: Chunks) -> Result<(), Error> {
        let mut writer = output.stream_writer(self.id, self.stream);
        let fault = loop {
            let next = tokio::select! {
                biased;
                () = self.stop.cancelled() => break None,
                next = poll_fn(|cx| {
                    match catch_unwind(AssertUnwindSafe(|| source.as_mut().poll_next(cx))) {
                        Ok(next) => next.map(Ok),
                        Err(payload) => std::task::Poll::Ready(Err(payload)),
                    }
                }) => next,
            };
            let next = match next {
                Ok(next) => next,
                Err(payload) => break Some(MessageFault::Panic(payload)),
            };
            tokio::task::consume_budget().await;
            if self.stop.is_cancelled() {
                break None;
            }
            match next {
                Some(Ok(chunk)) => {
                    {
                        let mut layout = locked(&self.layout);
                        if locked(&self.state).ending {
                            break None;
                        }
                        let chunk = layout.chunk(output, &chunk);
                        let mut state = locked(&self.state);
                        match chunk {
                            Ok(_) if state.ending => break None,
                            Ok(Some(Plan { pieces, tail })) => {
                                state.tail = (!tail.is_empty()
                                    || layout.head > 0
                                    || layout.layout == Layout::Rows)
                                    .then(|| layout.closing_piece(tail));
                                state.pending.extend(pieces);
                            }
                            Ok(None) => {}
                            // The final layout below retries the whole received text.
                            Err(fault) => break Some(fault),
                        }
                    }
                    if let Err(error) = writer.write(self).await {
                        let closing = {
                            // A concurrent cancellation can be laying out the closing writes.
                            let _layout = locked(&self.layout);
                            let mut state = locked(&self.state);
                            state.ending = true;
                            state.pending.clear();
                            state.tail = None;
                            state.fault.take()
                        };
                        if let Some(MessageFault::Panic(payload)) = closing {
                            resume_unwind(payload);
                        }
                        return Err(error);
                    }
                }
                Some(Err(error)) => break Some(MessageFault::Error(error)),
                None => break None,
            }
        };
        let dropped = catch_unwind(AssertUnwindSafe(|| drop(source))).err();
        let closing = {
            let mut layout = locked(&self.layout);
            self.finish(output, &mut layout).fault.take()
        };
        // Complete these writes with the same writer so a print line keeps its turn until closed.
        let written = writer.write(self).await;
        if locked(&self.state).detached {
            output.flush().await;
        }
        // Every closing write has run and no lock is held, so a panic resumes now. A fault the
        // source or a chunk raised wins over the final layout's, which a stop does not report.
        let (error, panicked) = fault_parts(fault);
        let (closing_error, closing_panicked) = fault_parts(closing);
        if let Some(payload) = panicked.or(dropped).or(closing_panicked) {
            resume_unwind(payload);
        }
        if let Some(error) = error {
            return Err(error);
        }
        if self.stop.is_cancelled() {
            Ok(())
        } else {
            closing_error.map_or(written, Err)
        }
    }
}

/// A fault as the error it returns or the panic it resumes.
fn fault_parts(fault: Option<MessageFault>) -> (Option<Error>, Option<Panic>) {
    match fault {
        None => (None, None),
        Some(MessageFault::Error(error)) => (Some(error), None),
        Some(MessageFault::Panic(payload)) => (None, Some(payload)),
    }
}

/// One layout, with a panic in the lane view caught as the layout's fault.
fn attempt<T>(layout: impl FnOnce() -> Result<T, Error>) -> Result<T, MessageFault> {
    match catch_unwind(AssertUnwindSafe(layout)) {
        Ok(Ok(laid)) => Ok(laid),
        Ok(Err(error)) => Err(MessageFault::Error(error)),
        Err(payload) => Err(MessageFault::Panic(payload)),
    }
}

/// Keeps a message registered until its reader has finished and the closing writes have run.
struct MessageTask {
    id: u64,
    output: Arc<Output>,
    completion: Arc<Completion>,
    rows: bool,
}

impl MessageTask {
    fn finish(&self, result: MessageResult) {
        self.output
            .streamed
            .finish(self.id, &self.completion, result);
    }
}

impl Drop for MessageTask {
    fn drop(&mut self) {
        if self.rows {
            self.output.leave_live();
        }
        let messages = &self.output.streamed;
        if locked(&messages.state).open.remove(&self.id).is_some() {
            self.completion.set(Ok(()));
            messages.changed.notify_waiters();
        }
    }
}

/// The destination operation one layout produced.
pub(super) struct Piece {
    pub(super) text: String,
    pub(super) change: Change,
}

pub(super) enum Change {
    Line,
    Row(Option<Frame>),
    DropRow,
    Print { open: bool },
}

struct Plan {
    pieces: Vec<Piece>,
    tail: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Layout {
    Lines,
    Rows,
    Print,
}

/// The lane view and the text this message has received but has yet to finish.
struct MessageOutput {
    stream: Stream,
    hidden: bool,
    view: View<str>,
    context: Option<ViewContext>,
    layout: Layout,
    carry: Carry,
    joined: String,
    written: usize,
    /// How many visible characters of the unfinished print line reached the cursor.
    head: usize,
    built_in: bool,
    /// A complete line may become ready when an unfinished control string ends.
    blocked_line: bool,
}

impl MessageOutput {
    fn new(output: &Output, lane: Lane, stream: Stream) -> Self {
        let (view, built_in) = output.lane_view(lane);
        let layout = match (output.stream_redraws(stream), lane) {
            (false, _) => Layout::Lines,
            (true, Lane::Print) => Layout::Print,
            (true, _) => Layout::Rows,
        };
        Self {
            stream,
            hidden: !output.shows_lane(lane),
            view,
            context: None,
            layout,
            carry: Carry::new(built_in),
            joined: String::new(),
            written: 0,
            head: 0,
            built_in,
            blocked_line: false,
        }
    }

    /// The writes one chunk makes. A failed layout changes nothing the message has written, so
    /// the final layout can lay out the whole received text in its place.
    fn chunk(&mut self, output: &Output, chunk: &str) -> Result<Option<Plan>, MessageFault> {
        if self.hidden {
            return Ok(None);
        }
        self.joined.push_str(chunk);
        if self.layout == Layout::Lines
            && self.built_in
            && self.context.is_some()
            && !self.blocked_line
            && !chunk.contains('\n')
        {
            return Ok(None);
        }
        attempt(|| self.advance(output, false))
    }

    /// The writes that end the message.
    fn close(&mut self, output: &Output) -> Result<Vec<Piece>, MessageFault> {
        if self.hidden {
            return Ok(Vec::new());
        }
        attempt(|| self.advance(output, true))
            .map(|plan| plan.map_or_else(Vec::new, |plan| plan.pieces))
    }

    fn closing_piece(&self, text: String) -> Piece {
        let change = match self.layout {
            Layout::Lines => Change::Line,
            Layout::Rows => Change::DropRow,
            Layout::Print => Change::Print { open: false },
        };
        Piece { text, change }
    }

    /// Lays out the text so far. Every view call comes before any change to what the message has
    /// written, so a layout that fails or panics leaves the message as the last one left it.
    fn advance(&mut self, output: &Output, end: bool) -> Result<Option<Plan>, Error> {
        let cut = if end {
            self.joined.len()
        } else {
            let input = self.carry.layout(&self.joined);
            let offset = input.len() - self.joined.len();
            unfinished_sequence(&input)
                .and_then(|origin| origin.checked_sub(offset))
                .unwrap_or(self.joined.len())
        };
        let blocked_line = self.joined[cut..].contains('\n');
        let text = &self.joined[..cut];
        let text = if end {
            Cow::Borrowed(text)
        } else {
            held_spaces(text)
        };
        if !end && text.is_empty() {
            self.blocked_line = blocked_line;
            return Ok(None);
        }

        let context = self
            .context
            .get_or_insert_with(|| output.context(self.stream));
        let marked = (self.view.render)(&self.carry.layout(&text), context)?;
        let renderer = output.renderer(self.stream);
        let split = (!end).then(|| text.rfind('\n')).flatten().map(|at| at + 1);
        let split = match split {
            Some(at) => self
                .split(at, &renderer)?
                .map(|(carry, rows)| (at, carry, rows)),
            None => None,
        };
        self.blocked_line = blocked_line;
        let plan = match self.layout {
            Layout::Lines => self.lines(renderer.resolve(&marked), end),
            Layout::Rows => self.rows(&marked, &renderer, end),
            Layout::Print => self.print(output, &marked, &renderer, end),
        };
        if let Some((at, carry, rows)) = split {
            self.carry.commit(carry);
            self.joined.drain(..at);
            self.written = (self.written + 1).saturating_sub(rows);
        }
        Ok(Some(plan))
    }

    /// The carry past the lines that end at `at`, and the rows they take, when the split can move
    /// there. The caller moves it once the layout has succeeded.
    fn split(
        &mut self,
        at: usize,
        renderer: &Renderer,
    ) -> Result<Option<(LineCarry, usize)>, Error> {
        let finished = &self.joined[..at];
        let prior = self.carry.layout(finished);
        let Some(context) = &self.context else {
            return Ok(None);
        };
        // The synthetic line at the next layout takes the place of every omitted finished line.
        let Some(carry) = self.carry.next(finished, renderer) else {
            return Ok(None);
        };
        let marked = (self.view.render)(&prior, context)?;
        let rows = match self.layout {
            Layout::Lines => renderer
                .resolve(&marked)
                .bytes()
                .filter(|&byte| byte == b'\n')
                .count(),
            Layout::Rows | Layout::Print => split_lines(&marked).len(),
        };
        Ok(Some((carry, rows)))
    }

    fn lines(&mut self, mut resolved: String, end: bool) -> Plan {
        if end && !ends_line(&resolved) {
            resolved.push('\n');
        }
        let head = resolved.rfind('\n').map_or(0, |index| index + 1);
        let lines = resolved[..head].split_inclusive('\n');
        let count = lines.clone().count();
        let mut fresh: Vec<_> = lines
            .skip(self.written)
            .map(|line| Piece {
                text: line.to_owned(),
                change: Change::Line,
            })
            .collect();
        self.written = self.written.max(count);
        let mut tail = resolved[head..].to_owned();
        if end && !tail.is_empty() {
            if let Some(last) = fresh.last_mut() {
                last.text.push_str(&tail);
            } else {
                fresh.push(Piece {
                    text: std::mem::take(&mut tail),
                    change: Change::Line,
                });
            }
        }
        Plan {
            pieces: fresh,
            tail,
        }
    }

    fn rows(&mut self, marked: &str, renderer: &Renderer, end: bool) -> Plan {
        let mut rows = ResolvedRows::new(marked, renderer, end);
        let pending = rows.pending().unwrap_or_default();
        let mut text = self.finish_rows(&rows.finished);
        text.push_str(&rows.after);
        let change =
            if end {
                Change::DropRow
            } else {
                Change::Row((!pending.is_empty()).then(|| {
                    Frame::new(loomcli_style::escape(&visible(&pending)), pending.as_str())
                }))
            };
        Plan {
            pieces: vec![Piece { text, change }],
            tail: pending,
        }
    }

    fn print(&mut self, output: &Output, marked: &str, renderer: &Renderer, end: bool) -> Plan {
        let mut rows = ResolvedRows::new(marked, renderer, end);
        let pending = rows.pending().unwrap_or_default();
        let mut text = self.finish_rows(&rows.finished);
        text.push_str(&rows.after);
        let mut pieces = Vec::new();
        if !text.is_empty() {
            pieces.push(Piece {
                text,
                change: Change::Print { open: false },
            });
        }
        if !pending.is_empty() && (self.head > 0 || output.stream_appends(self.stream)) {
            let (text, shown) = resolved_row_suffix(&pending, self.head, true);
            if !text.is_empty() {
                self.head = shown;
                pieces.push(Piece {
                    text,
                    change: Change::Print { open: true },
                });
            }
        }
        // Only what the cursor has yet to receive, which a failed final layout writes.
        let tail = resolved_row_suffix(&pending, self.head, false).0;
        Plan { pieces, tail }
    }

    fn finish_rows(&mut self, rows: &[String]) -> String {
        if rows.len() <= self.written {
            return String::new();
        }
        let mut text = String::new();
        for (index, row) in rows[self.written..].iter().enumerate() {
            if index == 0 && self.head > 0 {
                text.push_str(&resolved_row_suffix(row, self.head, false).0);
            } else {
                text.push_str(row);
            }
            text.push('\n');
        }
        self.written = rows.len();
        self.head = 0;
        text
    }
}

struct ResolvedRows {
    finished: Vec<String>,
    closed: bool,
    after: String,
}

impl ResolvedRows {
    fn new(marked: &str, renderer: &Renderer, end: bool) -> Self {
        let resolved = renderer.resolve(marked);
        let ends = ends_line(&resolved);
        let mut after = if end {
            controls_after_last_line(&resolved)
        } else {
            String::new()
        };
        if !after.is_empty() && !ends {
            after.push('\n');
        }
        Self {
            finished: split_lines(marked)
                .iter()
                .map(|row| renderer.resolve(row))
                .collect(),
            closed: end || ends,
            after,
        }
    }

    fn pending(&mut self) -> Option<String> {
        (!self.closed).then(|| self.finished.pop()).flatten()
    }
}

/// Holds spaces before any of the style-frame closes at the end of this chunk.
fn held_spaces(text: &str) -> Cow<'_, str> {
    let body = text.trim_end_matches('\u{e002}');
    let held = body.trim_end_matches([' ', '\t', '\r']);
    if held.len() == body.len() {
        Cow::Borrowed(text)
    } else if body.len() == text.len() {
        Cow::Borrowed(held)
    } else {
        Cow::Owned(format!("{held}{}", &text[body.len()..]))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::host::tests::output_host;
    use crate::output::registry::ViewRegistry;
    use crate::signals::RunSignal;
    use loomcli_style::{Alignment, Palette, RenderingPolicy, Switch, pad, style};

    use super::*;

    fn output(terminal: bool) -> Output {
        Output::new(
            Arc::new(output_host(terminal.then_some(100))),
            RunSignal::new(CancellationToken::new()),
            RenderingPolicy::new()
                .color(Switch::Always)
                .modifiers(Switch::Always),
            Palette::new(),
            ViewRegistry::default(),
            None,
            false,
        )
    }

    /// Counts characters submitted to the built-in lane, retaining the real carry and renderer.
    fn measured(parts: &[String], stream: Stream, terminal: bool) -> usize {
        let output = output(terminal);
        let lane = if stream == Stream::Stdout {
            Lane::Print
        } else {
            Lane::Info
        };
        let mut layout = MessageOutput::new(&output, lane, stream);
        let view = layout.view.clone();
        let size = Arc::new(AtomicUsize::new(0));
        let measured = Arc::clone(&size);
        layout.view = View::new(move |text: &str, context: &ViewContext| {
            measured.fetch_add(text.len(), Ordering::Relaxed);
            view.render(text, context)
        });
        for part in parts {
            assert!(layout.chunk(&output, part).is_ok());
        }
        assert!(layout.close(&output).is_ok());
        size.load(Ordering::Relaxed)
    }

    #[test]
    fn a_first_line_with_state_does_not_make_later_layouts_grow() {
        for first in [
            "first".to_owned(),
            "\x1b[31mfirst\x1b[0m".to_owned(),
            "\x1b[31mfirst".to_owned(),
            "\x1b]8;;https://example.com\x1b\\first\x1b]8;;\x1b\\".to_owned(),
            pad("first", 8, Alignment::Left).unwrap_or_default(),
            style().bold().apply("first"),
        ] {
            let parts = |lines| {
                std::iter::once(format!("{first}\n"))
                    .chain((0..lines).flat_map(|_| ["next ".to_owned(), "line\n".to_owned()]))
                    .collect::<Vec<_>>()
            };
            let first = measured(&parts(50), Stream::Stderr, true);
            let double = measured(&parts(100), Stream::Stderr, true);
            assert!(double <= first * 2 + first / 5, "{first} {double}");
        }
    }

    #[test]
    fn tracked_attributes_set_on_every_line_use_a_bounded_carry() {
        for (start, end) in [
            ("\x1b[38;5;100m", ""),
            ("\x1b[1m\x1b[24m", "\x1b[3m\x1b[4m"),
            ("\x1b[5m", "\x1b[25m"),
            ("\x1b[5m", "\x1b[0m"),
            ("\x1b[21m", "\x1b[24m"),
            ("\x1b[58;5;10m", "\x1b[59m"),
            ("\x1b[11m", "\x1b[10m"),
        ] {
            let lines = |count| {
                (0..count)
                    .flat_map(|_| [format!("{start}next "), format!("line{end}\n")])
                    .collect::<Vec<_>>()
            };
            let first = measured(&lines(50), Stream::Stderr, true);
            let double = measured(&lines(100), Stream::Stderr, true);
            assert!(
                double <= first * 2 + first / 5,
                "{start:?} {end:?}: {first} {double}"
            );
        }
    }

    #[test]
    fn the_partial_line_off_a_terminal_waits_without_relaying_the_growing_prefix() {
        for lane in [Stream::Stderr, Stream::Stdout] {
            for chunks in [100, 200, 400] {
                let parts = vec!["x".repeat(16_000 / chunks); chunks];
                let measured = measured(&parts, lane, false);
                assert!(measured < 17_000, "{lane:?} {chunks}: {measured}");
            }
        }
    }
}
