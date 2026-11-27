//! The bounded log of a progress line and its independent text feeds.

use std::collections::{BTreeMap, VecDeque};
use std::future::poll_fn;
use std::io;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    BoxFuture, ChildStream, Error, Glyph, OutputStream, Stream, View, ViewContext, escape,
    escape_control_characters,
};

use crate::messages;
use crate::progress::locked;

const LINE_LIMIT: usize = 4096;

#[derive(Default)]
struct PartialLine {
    text: String,
    points: usize,
    truncated: bool,
    carriage: bool,
    pending_utf8: Vec<u8>,
}

impl PartialLine {
    fn push(&mut self, character: char) {
        if self.carriage {
            self.text.clear();
            self.points = 0;
            self.truncated = false;
            self.carriage = false;
        }
        if self.points < LINE_LIMIT {
            self.text.push(character);
            self.points += 1;
        } else {
            self.truncated = true;
        }
    }

    fn shown(&self) -> String {
        if self.truncated {
            self.text.clone() + &Glyph::Ellipsis.to_string()
        } else {
            self.text.clone()
        }
    }

    fn append(&mut self, text: &str, mut line: impl FnMut(String)) {
        for character in text.chars() {
            match character {
                '\n' => {
                    line(self.shown());
                    self.text.clear();
                    self.points = 0;
                    self.truncated = false;
                    self.carriage = false;
                }
                '\r' => self.carriage = true,
                character => self.push(character),
            }
        }
    }

    /// Decode a pipe independently, so a UTF-8 scalar may span two writes to that pipe.
    fn decode(&mut self, bytes: &[u8]) -> String {
        let mut buffered = std::mem::take(&mut self.pending_utf8);
        let mut pending = bytes;
        if !buffered.is_empty() {
            buffered.extend_from_slice(bytes);
            pending = &buffered;
        }
        let mut text = String::new();
        loop {
            match std::str::from_utf8(pending) {
                Ok(valid) => {
                    text.push_str(valid);
                    break;
                }
                Err(error) => {
                    let (valid, rest) = pending.split_at(error.valid_up_to());
                    text.push_str(&String::from_utf8_lossy(valid));
                    if let Some(length) = error.error_len() {
                        text.push('\u{fffd}');
                        pending = &rest[length..];
                    } else {
                        self.pending_utf8.extend_from_slice(rest);
                        break;
                    }
                }
            }
        }
        escape(&text)
    }

    fn finish(mut self) -> Option<String> {
        if !self.pending_utf8.is_empty() {
            self.push('\u{fffd}');
        }
        (self.points > 0).then(|| self.shown())
    }
}

#[derive(Default)]
struct LogState {
    lines: VecDeque<String>,
    count: usize,
    sources: BTreeMap<usize, PartialLine>,
    next_source: usize,
    closed: bool,
}

impl LogState {
    fn retain(lines: &mut VecDeque<String>, count: &mut usize, capacity: usize, line: String) {
        *count = count.saturating_add(1);
        if capacity > 0 {
            if lines.len() == capacity {
                lines.pop_front();
            }
            lines.push_back(line);
        }
    }
}

pub(crate) struct ProgressLog {
    rows: usize,
    limit: usize,
    state: Mutex<LogState>,
}

impl ProgressLog {
    pub(crate) fn new(rows: usize, limit: usize) -> Arc<Self> {
        Arc::new(Self {
            rows,
            limit,
            state: Mutex::new(LogState::default()),
        })
    }

    fn capacity(&self) -> usize {
        self.rows.max(self.limit)
    }

    fn open(self: &Arc<Self>) -> Feed {
        let mut state = locked(&self.state);
        let id = if state.closed {
            None
        } else {
            let id = state.next_source;
            state.next_source += 1;
            state.sources.insert(id, PartialLine::default());
            Some(id)
        };
        Feed {
            log: self.clone(),
            id,
        }
    }

    pub(crate) fn add(&self, text: &str) {
        let mut state = locked(&self.state);
        if state.closed {
            return;
        }
        let LogState { lines, count, .. } = &mut *state;
        let mut source = PartialLine::default();
        source.append(text, |line| {
            LogState::retain(lines, count, self.capacity(), line)
        });
        if let Some(line) = source.finish() {
            LogState::retain(lines, count, self.capacity(), line);
        }
    }

    pub(crate) fn need(&self) -> usize {
        let state = locked(&self.state);
        let pending = state
            .sources
            .values()
            .filter(|source| source.points != 0)
            .count();
        self.rows.min(state.lines.len().saturating_add(pending))
    }

    pub(crate) fn rows(&self, count: usize) -> Vec<String> {
        let count = count.min(self.rows);
        let state = locked(&self.state);
        let pending = state
            .sources
            .values()
            .rev()
            .filter(|source| source.points != 0)
            .map(PartialLine::shown);
        let mut lines: Vec<_> = pending
            .chain(state.lines.iter().rev().cloned())
            .take(count)
            .collect();
        lines.reverse();
        lines
    }

    /// Finishes every feed in opening order and takes the lines that an end keeps.
    pub(crate) fn close(&self, keep: bool) -> KeptLog {
        let mut state = locked(&self.state);
        state.closed = true;
        for source in std::mem::take(&mut state.sources).into_values() {
            if let Some(line) = source.finish() {
                let LogState { lines, count, .. } = &mut *state;
                LogState::retain(lines, count, self.capacity(), line);
            }
        }
        let lines = std::mem::take(&mut state.lines);
        if !keep || self.limit == 0 {
            return KeptLog::default();
        }
        let take = self.limit.min(lines.len());
        let skip = lines.len() - take;
        KeptLog {
            dropped: state.count - take,
            lines: lines.into_iter().skip(skip).collect(),
        }
    }

    pub(crate) fn output(self: &Arc<Self>) -> ProgressLogOutput {
        ProgressLogOutput(Arc::new(self.open()))
    }

    pub(crate) fn stream(
        self: &Arc<Self>,
        chunks: impl Stream<Item = Result<String, Error>> + Send + 'static,
        runtime: Option<&tokio::runtime::Handle>,
    ) -> BoxFuture<'static, Result<(), Error>> {
        let feed = TextFeed(self.open());
        let read = async move {
            let mut chunks = std::pin::pin!(chunks);
            while let Some(chunk) = poll_fn(|cx| chunks.as_mut().poll_next(cx)).await {
                feed.write(chunk?.as_str());
                tokio::task::consume_budget().await;
            }
            Ok(())
        };
        let Some(runtime) = runtime else {
            return Box::pin(read);
        };
        let _runtime = runtime.enter();
        let mut read: BoxFuture<'static, Result<(), Error>> = Box::pin(read);
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        if let std::task::Poll::Ready(result) = read.as_mut().poll(&mut context) {
            return Box::pin(std::future::ready(result));
        }
        let read = runtime.spawn(read);
        Box::pin(async move {
            match read.await {
                Ok(result) => result,
                Err(error) if error.is_panic() => std::panic::resume_unwind(error.into_panic()),
                Err(_) => Ok(()),
            }
        })
    }
}

struct Feed {
    log: Arc<ProgressLog>,
    id: Option<usize>,
}

impl Feed {
    fn append(&self, text: impl FnOnce(&mut PartialLine) -> String) {
        let mut state = locked(&self.log.state);
        let LogState {
            lines,
            count,
            sources,
            ..
        } = &mut *state;
        if let Some(source) = self.id.and_then(|id| sources.get_mut(&id)) {
            let text = text(source);
            source.append(&text, |line| {
                LogState::retain(lines, count, self.log.capacity(), line)
            });
        }
    }

    fn write(&self, text: &str) {
        self.append(|_| text.to_owned());
    }

    fn finish(&self) {
        let Some(id) = self.id else { return };
        let mut state = locked(&self.log.state);
        let LogState {
            lines,
            count,
            sources,
            ..
        } = &mut *state;
        if let Some(line) = sources.remove(&id).and_then(PartialLine::finish) {
            LogState::retain(lines, count, self.log.capacity(), line);
        }
    }
}

struct TextFeed(Feed);

impl TextFeed {
    fn write(&self, text: &str) {
        self.0.write(text);
    }
}

impl Drop for TextFeed {
    fn drop(&mut self) {
        self.0.finish();
    }
}

impl OutputStream for Feed {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        Box::pin(async move {
            self.append(|source| source.decode(bytes));
            Ok(())
        })
    }
}

/// A progress log destination for one child program pipe.
pub struct ProgressLogOutput(Arc<Feed>);

impl ProgressLogOutput {
    /// The destination to give to a child program. It accepts raw bytes and decodes UTF-8.
    #[must_use]
    pub fn child_stream(&self) -> ChildStream {
        ChildStream::Stream(self.0.clone())
    }

    /// Finishes the last line after the child exits. Later writes are accepted and discarded.
    pub fn finish(self) {
        self.0.finish();
    }
}

#[derive(Default)]
pub(crate) struct KeptLog {
    lines: Vec<String>,
    dropped: usize,
}

impl KeptLog {
    pub(crate) fn message(&self) -> Option<String> {
        if self.lines.is_empty() {
            return None;
        }
        let mut text = self.lines.join("\n");
        if self.dropped > 0 {
            text.insert(0, '\n');
            text.insert_str(0, &messages::dropped_log_lines(self.dropped));
        }
        Some(text)
    }
}

pub(crate) fn log_text(entry: &str, context: &ViewContext) -> String {
    let expanded = context.expand_tabs(&escape(&context.plain(entry)));
    escape_control_characters(&context.plain(&expanded))
}

pub(crate) fn kept_view(depth: usize) -> View<str> {
    let indent = "  ".repeat(depth.saturating_add(1));
    View::new(move |text: &str, context: &ViewContext| {
        text.split('\n')
            .map(|line| {
                context
                    .style
                    .dim()
                    .apply(&escape(&(indent.clone() + &log_text(line, context))))
            })
            .collect::<Vec<_>>()
            .join("\n")
    })
}
