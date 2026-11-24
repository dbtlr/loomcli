//! The key reader: the bytes a terminal sends read as keys, and one run's hold on stdin while any of
//! its questions is open.
//!
//! A run's keys belong to the run, not to a question: what one question leaves queued, a later one
//! reads. The hold is raw mode with bracketed paste, the run-scoped handlers that restore the
//! terminal at a shutdown or a suspend, and the queue. A question pulls keys from the queue and
//! reads stdin only when the queue is empty, so a key no question asked for stays in the terminal.

use std::collections::VecDeque;
use std::future::Future;
use std::pin::pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError, Weak};
use std::task::Poll;
use std::time::Duration;

use loomcli_core::{
    Context, Error, Host, InputStream, InterruptRaised, Registration, raise_interrupt_keys,
};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::controls::{HIDE_CURSOR, PASTE_OFF, PASTE_ON, SHOW_CURSOR, controls, poll_once};

/// One key a question reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Key {
    Text(String),
    Paste(String),
    Escape,
    Previous,
    Next,
    Enter,
    Backspace,
    Up,
    Down,
    Eof,
    Left,
    Right,
    Home,
    End,
    Delete,
    WordLeft,
    WordRight,
    KillWord,
    KillWhitespace,
    KillStart,
    KillEnd,
    Tab,
}

/// How long an ESC that ends a read waits for the read that may continue it.
const ESCAPE_WINDOW: Duration = Duration::from_millis(50);
const ESC: char = '\u{1b}';
const PASTE_END: [char; 6] = [ESC, '[', '2', '0', '1', '~'];

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The key a CSI or SS3 sequence's body names.
fn sequence(body: &str) -> Option<Key> {
    Some(match body {
        "1;3C" | "1;5C" | "c" => Key::WordRight,
        "1;3D" | "1;5D" | "d" => Key::WordLeft,
        "1~" | "7~" | "H" => Key::Home,
        "27u" => Key::Escape,
        "3~" => Key::Delete,
        "4~" | "8~" | "F" => Key::End,
        "A" => Key::Up,
        "B" => Key::Down,
        "C" => Key::Right,
        "D" => Key::Left,
        _ => return None,
    })
}

/// The key a control byte names.
fn control_key(character: char) -> Option<Key> {
    Some(match character {
        '\u{1}' => Key::Home,
        '\u{2}' => Key::Left,
        '\u{4}' => Key::Eof,
        '\u{5}' => Key::End,
        '\u{6}' => Key::Right,
        '\u{8}' | '\u{7f}' => Key::Backspace,
        '\t' => Key::Tab,
        '\n' | '\r' => Key::Enter,
        '\u{b}' => Key::KillEnd,
        '\u{e}' => Key::Next,
        '\u{10}' => Key::Previous,
        '\u{15}' => Key::KillStart,
        '\u{17}' => Key::KillWhitespace,
        _ => return None,
    })
}

/// The run's keys and the reader's place in the bytes.
#[derive(Default)]
pub(crate) struct InputQueue {
    /// Each key with the read it came from.
    keys: VecDeque<(Key, u64)>,
    /// Bytes not yet decoded: the start of a UTF-8 sequence a read split.
    undecoded: Vec<u8>,
    pending: Vec<char>,
    carriage: bool,
    paste: Option<String>,
    read: u64,
    pending_read: u64,
    /// When the ESC that ends `pending` was held.
    held: Option<Instant>,
    /// The read an accepted secret discarded.
    discarded: Option<u64>,
    /// The latest read a question has taken a key from.
    taken: u64,
}

impl InputQueue {
    fn enqueue(&mut self, key: Key, origin: u64) {
        if Some(origin) == self.discarded {
            return;
        }
        self.keys.push_back((key, origin));
    }

    /// Clears what a raised interrupt or a lend leaves unread, as a cooked terminal flushes input.
    fn flush(&mut self) {
        self.keys.clear();
        self.pending.clear();
        self.carriage = false;
        self.paste = None;
        self.held = None;
        self.undecoded.clear();
    }

    /// The text of `bytes` once the bytes a previous read left are prepended; a sequence split at
    /// the end stays for the next read, and a byte that cannot start one reads as U+FFFD.
    fn decode(&mut self, bytes: &[u8]) -> String {
        let mut input = std::mem::take(&mut self.undecoded);
        input.extend_from_slice(bytes);
        let mut text = String::new();
        let mut rest: &[u8] = &input;
        loop {
            match std::str::from_utf8(rest) {
                Ok(valid) => {
                    text.push_str(valid);
                    break;
                }
                Err(error) => {
                    let (valid, after) = rest.split_at(error.valid_up_to());
                    text.push_str(std::str::from_utf8(valid).unwrap_or_default());
                    match error.error_len() {
                        Some(length) => {
                            text.push('\u{fffd}');
                            rest = &after[length..];
                        }
                        None => {
                            self.undecoded = after.to_vec();
                            break;
                        }
                    }
                }
            }
        }
        text
    }

    /// Releases held Escape keys with the read they came from.
    fn release_escapes(&mut self) {
        if Some(self.pending_read) != self.discarded {
            let escapes = self.pending.iter().filter(|c| **c == ESC).count();
            for _ in 0..escapes {
                self.keys.push_back((Key::Escape, self.pending_read));
            }
        }
        self.pending.clear();
    }

    fn holds_escape(&self) -> bool {
        self.paste.is_none() && (self.pending == [ESC] || self.pending == [ESC, ESC])
    }

    /// Reads complete keys out of `text`, keeping a sequence a read split for the next read.
    #[allow(clippy::too_many_lines)]
    pub(crate) fn feed(&mut self, text: &str) {
        self.read += 1;
        if self.pending.is_empty() && self.paste.is_none() {
            self.pending_read = self.read;
        }
        self.pending.extend(text.chars());
        while !self.pending.is_empty() {
            if let Some(paste) = self.paste.as_mut() {
                let end = self
                    .pending
                    .windows(PASTE_END.len())
                    .position(|window| window == PASTE_END);
                if let Some(end) = end {
                    let mut whole = paste.clone();
                    whole.extend(&self.pending[..end]);
                    let first = whole.split(['\r', '\n']).next().unwrap_or_default();
                    let value: String = first
                        .chars()
                        .map(|c| if c == '\t' { ' ' } else { c })
                        .filter(|c| {
                            let code = u32::from(*c);
                            !(code <= 0x1f || (0x7f..=0x9f).contains(&code))
                        })
                        .collect();
                    self.paste = None;
                    let origin = self.pending_read;
                    self.enqueue(Key::Paste(value), origin);
                    self.pending.drain(..end + PASTE_END.len());
                    self.pending_read = self.read;
                    continue;
                }
                let mut keep = 0;
                for count in 1..PASTE_END.len() {
                    if self.pending.ends_with(&PASTE_END[..count]) {
                        keep = count;
                    }
                }
                let take = self.pending.len() - keep;
                paste.extend(self.pending[..take].iter().filter(|c| **c != ESC));
                self.pending.drain(..take);
                return;
            }
            if self.pending[0] == ESC {
                self.carriage = false;
                if self.pending == [ESC] || self.pending == [ESC, ESC] {
                    return;
                }
                let alt = self.pending.len() > 2
                    && self.pending[1] == ESC
                    && (self.pending[2] == '[' || self.pending[2] == 'O');
                let offset = usize::from(alt);
                let intro = self.pending.get(offset + 1).copied();
                if intro == Some('[') || intro == Some('O') {
                    let mut index = offset + 2;
                    let mut complete = false;
                    if intro == Some('[') && self.pending.get(index) == Some(&'[') {
                        if self.pending.len() == index + 1 {
                            return;
                        }
                        let next = u32::from(self.pending[index + 1]);
                        if (64..=126).contains(&next) {
                            index += 1;
                        }
                    }
                    while index < self.pending.len() {
                        let code = u32::from(self.pending[index]);
                        if !(32..=126).contains(&code) {
                            break;
                        }
                        if code >= 64 {
                            let body: String = self.pending[offset + 2..=index].iter().collect();
                            let mut kind = sequence(&body);
                            if intro == Some('O')
                                && !["A", "B", "C", "D", "H", "F", "c", "d"]
                                    .contains(&body.as_str())
                            {
                                kind = None;
                            }
                            if intro == Some('[') && (body == "c" || body == "d") {
                                kind = None;
                            }
                            if alt {
                                kind = match body.as_str() {
                                    "D" => Some(Key::WordLeft),
                                    "C" => Some(Key::WordRight),
                                    _ => None,
                                };
                            }
                            if !alt && intro == Some('[') && body == "200~" {
                                self.paste = Some(String::new());
                            } else if let Some(kind) = kind {
                                let origin = self.pending_read;
                                self.enqueue(kind, origin);
                            }
                            index += 1;
                            complete = true;
                            break;
                        }
                        index += 1;
                    }
                    if index == self.pending.len() && !complete {
                        return;
                    }
                    self.pending.drain(..index);
                    if self.paste.is_none() {
                        self.pending_read = self.read;
                    }
                    self.carriage = false;
                    continue;
                }
                if let Some(intro) = intro
                    && "]P_^".contains(intro)
                {
                    let mut index = 2;
                    let mut complete = false;
                    while index < self.pending.len() {
                        let code = u32::from(self.pending[index]);
                        if code == 7 {
                            index += 1;
                            complete = true;
                            break;
                        }
                        if code == 27 {
                            if index + 1 == self.pending.len() {
                                return;
                            }
                            if self.pending[index + 1] == '\\' {
                                index += 2;
                                complete = true;
                            }
                            break;
                        }
                        if code < 32 || code == 127 {
                            break;
                        }
                        index += 1;
                    }
                    if !complete && index == self.pending.len() {
                        return;
                    }
                    self.pending.drain(..index);
                    self.pending_read = self.read;
                    continue;
                }
                self.pending.remove(0);
                let origin = self.pending_read;
                if self.pending.first() == Some(&ESC) {
                    self.enqueue(Key::Escape, origin);
                    self.carriage = false;
                    continue;
                }
                let next = self.pending.first().copied();
                if let Some(next) = next
                    && next < ' '
                    && next != '\u{8}'
                {
                    self.enqueue(Key::Escape, origin);
                }
                if next == Some('\u{7f}') || next == Some('\u{8}') {
                    self.enqueue(Key::KillWord, origin);
                    self.pending.remove(0);
                } else if let Some(next) = next
                    && next >= ' '
                {
                    if next == 'b' {
                        self.enqueue(Key::WordLeft, origin);
                    }
                    if next == 'f' {
                        self.enqueue(Key::WordRight, origin);
                    }
                    self.pending.remove(0);
                }
                continue;
            }
            let character = self.pending.remove(0);
            self.pending_read = self.read;
            if character == '\n' && self.carriage {
                self.carriage = false;
                continue;
            }
            self.carriage = character == '\r';
            let read = self.read;
            if let Some(kind) = control_key(character) {
                self.enqueue(kind, read);
            } else {
                let code = u32::from(character);
                if code >= 32 && !(127..=159).contains(&code) {
                    self.enqueue(Key::Text(character.to_string()), read);
                }
            }
        }
    }
}

/// What one run's hold on stdin changes as questions open and close.
#[derive(Default)]
struct HoldState {
    queue: InputQueue,
    /// Questions open now.
    readers: usize,
    /// Whether raw mode holds.
    held: bool,
    /// Whether an editor has the terminal.
    paused: bool,
    /// Ctrl-C or Ctrl-\ raised its signal: every later key is dropped until the run's abort.
    interrupted: bool,
    /// The run-scoped handlers that restore the terminal while raw mode holds.
    registrations: Vec<Registration>,
    /// Whether the controls that hide the cursor and turn bracketed paste on are still to draw.
    controls: bool,
}

/// One run's keys and its hold on stdin.
pub(crate) struct Session {
    host: Weak<Host>,
    stdin: Arc<dyn InputStream>,
    state: Mutex<HoldState>,
    /// One read of stdin at a time.
    pump: tokio::sync::Mutex<()>,
}

/// Every run's session, by the run's host.
static SESSIONS: LazyLock<Mutex<Vec<Arc<Session>>>> = LazyLock::new(|| Mutex::new(Vec::new()));

impl Session {
    /// The session of the run `host` belongs to.
    fn of(host: &Arc<Host>) -> Arc<Session> {
        let mut sessions = locked(&SESSIONS);
        sessions.retain(|session| session.host.strong_count() > 0);
        if let Some(found) = sessions.iter().find(|session| {
            session
                .host
                .upgrade()
                .is_some_and(|own| Arc::ptr_eq(&own, host))
        }) {
            return Arc::clone(found);
        }
        let session = Arc::new(Session {
            host: Arc::downgrade(host),
            stdin: host.stdin(),
            state: Mutex::new(HoldState::default()),
            pump: tokio::sync::Mutex::new(()),
        });
        sessions.push(Arc::clone(&session));
        session
    }

    fn state(&self) -> MutexGuard<'_, HoldState> {
        locked(&self.state)
    }

    /// Whether raw mode holds for a question of the run.
    pub(crate) fn held(&self) -> bool {
        self.state().held
    }

    /// Leaves raw mode and removes the restoring handlers, once.
    pub(crate) fn release(&self) {
        let registrations = {
            let mut state = self.state();
            if !state.held {
                return;
            }
            state.held = false;
            state.paused = false;
            state.interrupted = false;
            std::mem::take(&mut state.registrations)
        };
        let _ = self.stdin.set_raw_mode(false);
        for registration in registrations {
            registration.remove();
        }
    }

    /// Enters raw mode and registers the run's handlers that restore the terminal.
    fn hold<I, R: 'static>(self: &Arc<Self>, context: &Context<I, R>) -> Result<(), Error> {
        if self.state().held {
            return Ok(());
        }
        if self.stdin.set_raw_mode(true).is_err() {
            return Err(Error::from_foreign(
                "Interactive stdin has no setRawMode method.".into(),
            ));
        }
        let registrations = {
            let session = Arc::clone(self);
            let host = Arc::clone(&context.host);
            let shutdown = context.on_shutdown(move |_| {
                if session.state().paused {
                    return;
                }
                let _ = session.stdin.set_raw_mode(false);
                let stderr = host.stderr();
                poll_once(stderr.write(PASTE_OFF.as_bytes()));
                if host.terminal.stderr().is_tty {
                    poll_once(stderr.write(SHOW_CURSOR.as_bytes()));
                }
            });
            let session = Arc::clone(self);
            let host = Arc::clone(&context.host);
            let suspend = context.on_suspend(move || {
                if session.state().paused {
                    return;
                }
                let _ = session.stdin.set_raw_mode(false);
                poll_once(host.stderr().write(PASTE_OFF.as_bytes()));
            });
            let session = Arc::clone(self);
            let host = Arc::clone(&context.host);
            let resume = context.on_resume(move || {
                if session.state().paused {
                    return;
                }
                let _ = session.stdin.set_raw_mode(true);
                poll_once(host.stderr().write(PASTE_ON.as_bytes()));
            });
            vec![shutdown, suspend, resume]
        };
        {
            let mut state = self.state();
            state.held = true;
            state.paused = false;
            state.interrupted = false;
            state.registrations = registrations;
            state.controls = true;
        }
        Ok(())
    }
}

/// Why a question stopped reading: the run's cancellation, a failure of stdin, or the close of its
/// region by something else.
pub(crate) enum Stop {
    Cancelled,
    Failed(Error),
    Abandoned,
}

/// One question's reading of the run's keys.
pub(crate) struct Reader {
    session: Arc<Session>,
    closed: Arc<AtomicBool>,
    abandoned: Arc<Mutex<bool>>,
    last_read: Option<u64>,
}

impl Reader {
    /// Opens a question's reading: raw mode holds from here while any question of the run is open.
    pub(crate) fn open<I, R: 'static>(context: &Context<I, R>) -> Result<Reader, Error> {
        context.signal.throw_if_cancelled()?;
        let session = Session::of(&context.host);
        session.hold(context)?;
        session.state().readers += 1;
        Ok(Reader {
            session,
            closed: Arc::new(AtomicBool::new(false)),
            abandoned: Arc::new(Mutex::new(false)),
            last_read: None,
        })
    }

    /// Draws the controls raw mode began with, once for the hold: the hidden cursor and bracketed
    /// paste on.
    pub(crate) async fn start<I, R: 'static>(&self, context: &Context<I, R>) -> Result<(), Error> {
        let pending = std::mem::take(&mut self.session.state().controls);
        if !pending {
            return Ok(());
        }
        let drawn = context
            .out
            .draw(format!("{HIDE_CURSOR}{PASTE_ON}").as_str(), &controls())
            .await;
        if let Err(error) = drawn {
            self.session.release();
            let _ = context.out.draw(PASTE_OFF, &controls()).await;
            return Err(error);
        }
        Ok(())
    }

    /// The session, for a region's close handler to release raw mode at once.
    pub(crate) fn session(&self) -> Arc<Session> {
        Arc::clone(&self.session)
    }

    /// The flag a region's close handler sets to end this question's reading.
    pub(crate) fn abandon_flag(&self) -> Arc<Mutex<bool>> {
        Arc::clone(&self.abandoned)
    }

    /// Ends this question's reading; answers whether the run holds stdin no longer.
    pub(crate) fn close(&mut self) -> bool {
        self.closer().close()
    }

    /// A handle that ends this question's reading from outside it, for a question dropped before
    /// it finished.
    pub(crate) fn closer(&self) -> ReaderCloser {
        ReaderCloser {
            session: Arc::clone(&self.session),
            closed: Arc::clone(&self.closed),
        }
    }

    /// Discards every key queued from the read that held the last key read; a sequence or paste
    /// that read started yields no key when it ends.
    pub(crate) fn discard(&self) {
        let mut state = self.session.state();
        let last = self.last_read;
        state.queue.keys.retain(|(_, origin)| Some(*origin) != last);
        state.queue.discarded = last;
    }

    /// Discards every queued key from a read a question has already taken a key from.
    pub(crate) fn discard_taken(&self) {
        let mut state = self.session.state();
        let taken = state.queue.taken;
        state.queue.keys.retain(|(_, origin)| *origin > taken);
    }

    /// Discards queued input and leaves raw mode while a child owns the terminal.
    pub(crate) fn pause(&self) {
        let mut state = self.session.state();
        state.queue.flush();
        state.paused = true;
        drop(state);
        let _ = self.session.stdin.set_raw_mode(false);
    }

    /// Takes the terminal back after a child: raw mode, the hidden cursor, and bracketed paste.
    pub(crate) async fn resume<I, R: 'static>(&self, context: &Context<I, R>) {
        {
            let mut state = self.session.state();
            if !state.held || !state.paused {
                return;
            }
            state.paused = false;
        }
        let _ = self.session.stdin.set_raw_mode(true);
        let _ = context
            .out
            .draw(format!("{HIDE_CURSOR}{PASTE_ON}").as_str(), &controls())
            .await;
    }

    /// The next key, reading stdin when none is queued. A run's cancellation, the close of the
    /// question's region, the end of stdin, and its failure stop the read.
    pub(crate) async fn read<I, R: 'static>(
        &mut self,
        context: &Context<I, R>,
        region: &CancellationToken,
    ) -> Result<Key, Stop> {
        loop {
            if let Some(key) = self.next_queued() {
                return Ok(key);
            }
            self.fill(context, region).await?;
        }
    }

    /// Whether a key is queued.
    pub(crate) fn has_queued(&self) -> bool {
        !self.session.state().queue.keys.is_empty()
    }

    /// The next queued key, noting the read it came from.
    pub(crate) fn next_queued(&mut self) -> Option<Key> {
        let mut state = self.session.state();
        let (key, origin) = state.queue.keys.pop_front()?;
        self.last_read = Some(origin);
        state.queue.taken = state.queue.taken.max(origin);
        Some(key)
    }

    /// Waits for one read of stdin, or for a held Escape's window to pass, and queues what it
    /// yields. A run's cancellation, the close of the question's region, the end of stdin, and its
    /// failure stop the wait.
    pub(crate) async fn fill<I, R: 'static>(
        &self,
        context: &Context<I, R>,
        region: &CancellationToken,
    ) -> Result<(), Stop> {
        let mut buffer = [0_u8; 4096];
        if context.signal.is_cancelled() {
            return Err(Stop::Cancelled);
        }
        if *locked(&self.abandoned) {
            return Err(Stop::Abandoned);
        }
        let (interrupted, deadline) = {
            let state = self.session.state();
            if !state.queue.keys.is_empty() {
                return Ok(());
            }
            (
                state.interrupted,
                state.queue.held.map(|held| held + ESCAPE_WINDOW),
            )
        };
        let signal = context.signal.token();
        let mut cancelled = pin!(signal.cancelled());
        let mut closed = pin!(region.cancelled());
        if interrupted {
            std::future::poll_fn(|cx| {
                if cancelled.as_mut().poll(cx).is_ready() || closed.as_mut().poll(cx).is_ready() {
                    Poll::Ready(())
                } else {
                    Poll::Pending
                }
            })
            .await;
            return Ok(());
        }
        let pump = self.session.pump.lock().await;
        // Another question's read may have queued keys while this one waited for the pump.
        if !self.session.state().queue.keys.is_empty() {
            return Ok(());
        }
        let stdin = Arc::clone(&self.session.stdin);
        let mut timer = pin!(tokio::time::sleep_until(
            deadline.unwrap_or_else(|| Instant::now() + Duration::from_secs(86_400))
        ));
        let read = {
            let mut reading = stdin.read(&mut buffer);
            std::future::poll_fn(|cx| {
                if cancelled.as_mut().poll(cx).is_ready() || closed.as_mut().poll(cx).is_ready() {
                    return Poll::Ready(None);
                }
                if deadline.is_some() && timer.as_mut().poll(cx).is_ready() {
                    return Poll::Ready(Some(None));
                }
                reading.as_mut().poll(cx).map(|read| Some(Some(read)))
            })
            .await
        };
        drop(pump);
        match read {
            None => Ok(()),
            Some(None) => {
                let mut state = self.session.state();
                state.queue.release_escapes();
                state.queue.held = None;
                Ok(())
            }
            Some(Some(Ok(0))) => {
                context.cancel();
                Ok(())
            }
            Some(Some(Err(error))) => Err(Stop::Failed(Error::from_foreign(Box::new(error)))),
            Some(Some(Ok(count))) => {
                self.take(context, &buffer[..count]);
                Ok(())
            }
        }
    }

    /// Feeds one read into the run's queue, raising the interrupt keys it holds first.
    fn take<I, R: 'static>(&self, context: &Context<I, R>, bytes: &[u8]) {
        let text = self.session.state().queue.decode(bytes);
        let keys = raise_interrupt_keys(&context.host, &|| context.cancel(), &text);
        let mut state = self.session.state();
        if let Some(raised) = keys.raised {
            state.interrupted = raised == InterruptRaised::Ending;
            state.queue.flush();
            return;
        }
        if state
            .queue
            .held
            .is_some_and(|held| held.elapsed() >= ESCAPE_WINDOW)
        {
            state.queue.release_escapes();
        }
        state.queue.held = None;
        state.queue.feed(&keys.rest);
        if state.queue.holds_escape() {
            state.queue.held = Some(Instant::now());
        }
    }
}

/// Ends one question's reading once, whichever of its reader and its region gets there first.
pub(crate) struct ReaderCloser {
    session: Arc<Session>,
    closed: Arc<AtomicBool>,
}

impl ReaderCloser {
    /// Ends the reading, raw mode leaving with the run's last open question; answers whether the
    /// run holds stdin no longer.
    pub(crate) fn close(&self) -> bool {
        if !self.closed.swap(true, Ordering::SeqCst) {
            let last = {
                let mut state = self.session.state();
                state.readers = state.readers.saturating_sub(1);
                state.readers == 0
            };
            if last {
                self.session.release();
            }
        }
        !self.session.held()
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        self.close();
    }
}

/// Runs `future` unless `token` is cancelled first.
pub(crate) async fn unless<F: Future>(token: &CancellationToken, future: F) -> Option<F::Output> {
    let mut future = pin!(future);
    let mut cancelled = pin!(token.cancelled());
    std::future::poll_fn(|cx| {
        if let Poll::Ready(output) = future.as_mut().poll(cx) {
            return Poll::Ready(Some(output));
        }
        if cancelled.as_mut().poll(cx).is_ready() {
            return Poll::Ready(None);
        }
        Poll::Pending
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(text: &str) -> Vec<Key> {
        let mut queue = InputQueue::default();
        queue.feed(text);
        queue.keys.into_iter().map(|(key, _)| key).collect()
    }

    #[test]
    fn reads_a_crlf_as_one_enter() {
        assert_eq!(keys("\r\n"), [Key::Enter]);
    }

    #[test]
    fn reads_an_alt_prefixed_arrow_as_its_word_key() {
        assert_eq!(keys("\u{1b}\u{1b}[D"), [Key::WordLeft]);
    }
}
