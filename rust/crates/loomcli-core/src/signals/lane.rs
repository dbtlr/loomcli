//! The lane of one signal source: the runs live on it, the shutdown, suspend, and resume handlers
//! registered on it, and the one shutdown an ending signal starts, under `signals.md`.
//!
//! This is the reference's `signal-lane.ts`. A lane listens for the ending signals and the exit
//! event only while a run that listens is live or a handler that listens is registered, and for
//! `SIGTSTP` and `SIGCONT` only while a suspend or resume handler is. An ending signal starts one
//! shutdown: every live run is cancelled, and the shutdown ends at the first of every run resolved,
//! the budget, or a second ending signal. At its end the lane flushes each run's pending output, calls
//! every pending shutdown handler newest first, removes its listeners, and re-raises the first
//! signal on the source, whose default action ends the process.
//!
//! The lane never holds its lock while it calls out: a listener the source calls, a run's cancel or
//! flush, a handler, and the source's `raise` all run outside it, because a mock's source calls its
//! listeners inside `raise`, and the real source on a thread of its own.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use super::messages;
use super::{EndingSignal, Registration, ShutdownCause, ShutdownEvent};
use crate::host::{ProcessSignal, SignalEvent, SignalListener, SignalSource};

/// What receives a handler's panic message: a run's `error` log event, or nothing for a handler
/// scoped to the process.
pub(crate) type Failed = Arc<dyn Fn(String) + Send + Sync>;

/// A shutdown handler as the lane holds it.
type ShutdownHandler = Box<dyn FnOnce(ShutdownEvent) + Send>;

/// A suspend or resume handler as the lane holds it.
type HeldHandler = Arc<dyn Fn() + Send + Sync>;

/// What a lane reads from one live run.
pub(crate) struct LaneRun {
    /// Cancels the run with the signal as its source. A run already cancelled keeps its reason.
    pub(crate) cancel: Box<dyn Fn(EndingSignal) + Send + Sync>,
    /// Sends pending output to the run's streams and restores the terminal cursor.
    pub(crate) flush: Box<dyn Fn() + Send + Sync>,
    /// Whether the run keeps its lane listening: a `run()`, or a call whose outermost run is one.
    pub(crate) listens: bool,
    /// The Application's shutdown budget, in milliseconds.
    pub(crate) timeout: u32,
}

/// One live run as its lane holds it.
struct PlaceEntry {
    id: u64,
    run: Arc<LaneRun>,
    /// Whether a shutdown ended while the run was still live, after which it keeps no listener.
    cut_off: bool,
    /// Whether the run's terminal was flushed, which happens once, at a shutdown's end or the exit.
    flushed: bool,
}

impl PlaceEntry {
    /// Whether the run keeps its lane listening: a run that listens, until a shutdown cut it off.
    fn listens(&self) -> bool {
        self.run.listens && !self.cut_off
    }
}

/// One pending shutdown handler, the run it belongs to, and whether it keeps the lane listening.
struct PendingShutdown {
    id: u64,
    handler: ShutdownHandler,
    failed: Option<Failed>,
    listens: bool,
    place: Option<u64>,
}

/// One suspend or resume handler, the run it belongs to, and whether it keeps the lane listening.
struct Held {
    id: u64,
    handler: HeldHandler,
    failed: Option<Failed>,
    listens: bool,
    place: Option<u64>,
}

/// The shutdown under way: its first signal, the runs that resolved during it, and its number, which
/// a budget timer checks so a timer of an earlier shutdown ends nothing.
struct Shutdown {
    signal: EndingSignal,
    unwound: Vec<PlaceEntry>,
    ending: bool,
    generation: u64,
}

/// The listener ids the lane holds on its source.
#[derive(Default)]
struct Listening {
    ending: Option<Vec<u64>>,
    suspend: Option<u64>,
    resume: Option<u64>,
}

#[derive(Default)]
struct LaneState {
    next: u64,
    places: Vec<PlaceEntry>,
    shutdown_handlers: Vec<PendingShutdown>,
    suspend: Vec<Held>,
    resume: Vec<Held>,
    shutdown: Option<Shutdown>,
    listening: Listening,
    suspended: bool,
    generation: u64,
}

impl LaneState {
    fn next_id(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    fn place(&self, id: u64) -> Option<&PlaceEntry> {
        self.places.iter().find(|place| place.id == id)
    }
}

/// The lane of one signal source, which it holds: a run listens and re-raises on its handle's
/// source for as long as its place holds the lane, whatever else holds the source.
pub(crate) struct Lane {
    source: Arc<dyn SignalSource>,
    state: Mutex<LaneState>,
    this: Weak<Lane>,
}

/// The signals whose default effect ends a process, in the order the lane listens for them.
const ENDING: [EndingSignal; 4] = [
    EndingSignal::Int,
    EndingSignal::Term,
    EndingSignal::Hup,
    EndingSignal::Quit,
];

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl EndingSignal {
    /// The process signal of this name.
    pub(crate) fn process(self) -> ProcessSignal {
        match self {
            EndingSignal::Hup => ProcessSignal::Hup,
            EndingSignal::Int => ProcessSignal::Int,
            EndingSignal::Quit => ProcessSignal::Quit,
            EndingSignal::Term => ProcessSignal::Term,
        }
    }

    /// 128 plus the signal's number: the status a shell reports for a process the signal ended.
    pub(crate) fn code(self) -> i32 {
        match self {
            EndingSignal::Hup => 129,
            EndingSignal::Int => 130,
            EndingSignal::Quit => 131,
            EndingSignal::Term => 143,
        }
    }
}

/// The message a handler's panic carried, which its `error` log event reads.
pub(crate) fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|text| (*text).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| messages::HANDLER_PANICKED.to_owned())
}

/// Calls one handler, catching a panic so the rest still run, and hands its message to `failed`.
fn call_caught(call: impl FnOnce(), failed: Option<&Failed>) {
    if let Err(payload) = catch_unwind(AssertUnwindSafe(call)) {
        if let Some(failed) = failed {
            let message = panic_message(payload.as_ref());
            // The process may be ending, so a failure to report the panic has nowhere to go.
            let _ = catch_unwind(AssertUnwindSafe(|| failed(message)));
        }
    }
}

/// Every lane in the process.
type Lanes = Mutex<Vec<Arc<Lane>>>;

/// The lanes of every signal source in the process, by the source's address, which stays unique
/// while the lane holds the source. A lane nothing else holds and that holds nothing on its source
/// goes at the next lookup, so a mock's lane and the mock go once its runs and handlers have.
fn lanes() -> &'static Lanes {
    static LANES: std::sync::OnceLock<Lanes> = std::sync::OnceLock::new();
    LANES.get_or_init(|| Mutex::new(Vec::new()))
}

/// The one lane of `source`: every run whose process handle shares the source shares it.
pub(crate) fn lane_of(source: &Arc<dyn SignalSource>) -> Arc<Lane> {
    let address = Arc::as_ptr(source).cast::<()>();
    let mut lanes = locked(lanes());
    lanes.retain(|lane| Arc::strong_count(lane) > 1 || !lane.idle());
    if let Some(lane) = lanes
        .iter()
        .find(|lane| Arc::as_ptr(&lane.source).cast::<()>() == address)
    {
        return Arc::clone(lane);
    }
    let lane = Arc::new_cyclic(|this| Lane {
        source: Arc::clone(source),
        state: Mutex::new(LaneState::default()),
        this: this.clone(),
    });
    lanes.push(Arc::clone(&lane));
    lane
}

/// One live run's place in its lane, which it registers its own handlers through and leaves by.
#[derive(Clone)]
pub(crate) struct Place {
    lane: Arc<Lane>,
    id: u64,
}

impl Place {
    /// A place in `lane` that no run entered, which a context built outside a run holds: a handler
    /// registered on it holds nothing and is never called, and leaving it changes nothing.
    pub(crate) fn unentered(lane: Arc<Lane>) -> Place {
        Place { lane, id: u64::MAX }
    }

    /// Registers a shutdown handler scoped to the run. One registered after the run left holds
    /// nothing and is never called.
    pub(crate) fn on_shutdown(
        &self,
        handler: ShutdownHandler,
        failed: Option<Failed>,
    ) -> Registration {
        self.lane.register(handler, failed, Some(self.id))
    }

    /// Registers a suspend handler scoped to the run, which goes when the run leaves.
    pub(crate) fn on_suspend(&self, handler: HeldHandler, failed: Option<Failed>) -> Registration {
        self.lane
            .hold(Kind::Suspend, handler, failed, Some(self.id))
    }

    /// Registers a resume handler scoped to the run, which goes when the run leaves.
    pub(crate) fn on_resume(&self, handler: HeldHandler, failed: Option<Failed>) -> Registration {
        self.lane.hold(Kind::Resume, handler, failed, Some(self.id))
    }

    /// Ends the run's place: its suspend and resume handlers go with it, and its shutdown handlers
    /// too unless a shutdown is under way. The last run to leave a shutdown ends it.
    pub(crate) fn leave(&self) {
        self.lane.leave(self.id);
    }

    /// The lane the place is in, which a call the run's action makes enters too.
    pub(crate) fn lane(&self) -> &Arc<Lane> {
        &self.lane
    }

    /// Whether the run keeps its lane listening.
    pub(crate) fn listens(&self) -> bool {
        locked(&self.lane.state)
            .place(self.id)
            .is_some_and(|place| place.run.listens)
    }
}

#[derive(Clone, Copy)]
enum Kind {
    Suspend,
    Resume,
}

impl Lane {
    /// Whether the lane holds nothing: no run, no handler, no shutdown, and no listener.
    fn idle(&self) -> bool {
        let state = locked(&self.state);
        state.places.is_empty()
            && state.shutdown_handlers.is_empty()
            && state.suspend.is_empty()
            && state.resume.is_empty()
            && state.shutdown.is_none()
            && state.listening.ending.is_none()
            && state.listening.suspend.is_none()
            && state.listening.resume.is_none()
    }

    fn this(&self) -> Arc<Lane> {
        // A lane is only reached through an `Arc`, so its own weak handle upgrades.
        self.this
            .upgrade()
            .unwrap_or_else(|| unreachable!("a lane outlives its calls"))
    }

    /// Enters one run. A run that enters during a shutdown starts cancelled with the shutdown's
    /// signal, and does not extend its budget.
    pub(crate) fn enter(&self, run: LaneRun) -> Place {
        let run = Arc::new(run);
        let (id, under_way) = {
            let mut state = locked(&self.state);
            let id = state.next_id();
            state.places.push(PlaceEntry {
                id,
                run: Arc::clone(&run),
                cut_off: false,
                flushed: false,
            });
            self.refresh(&mut state);
            (id, state.shutdown.as_ref().map(|shutdown| shutdown.signal))
        };
        if let Some(signal) = under_way {
            call_caught(|| (run.cancel)(signal), None);
        }
        Place {
            lane: self.this(),
            id,
        }
    }

    /// Registers a shutdown handler scoped to the process, which runs at a shutdown's end or the
    /// process's own end. A panic is dropped.
    pub(crate) fn on_shutdown(&self, handler: ShutdownHandler) -> Registration {
        self.register(handler, None, None)
    }

    /// Registers a suspend handler scoped to the process.
    pub(crate) fn on_suspend(&self, handler: HeldHandler) -> Registration {
        self.hold(Kind::Suspend, handler, None, None)
    }

    /// Registers a resume handler scoped to the process.
    pub(crate) fn on_resume(&self, handler: HeldHandler) -> Registration {
        self.hold(Kind::Resume, handler, None, None)
    }

    fn register(
        &self,
        handler: ShutdownHandler,
        failed: Option<Failed>,
        place: Option<u64>,
    ) -> Registration {
        let id = {
            let mut state = locked(&self.state);
            let listens = match place {
                None => true,
                Some(place) => match state.place(place) {
                    // A handler registered after its run left is never called.
                    None => return Registration::none(),
                    Some(entry) => entry.listens(),
                },
            };
            let id = state.next_id();
            state.shutdown_handlers.push(PendingShutdown {
                id,
                handler,
                failed,
                listens,
                place,
            });
            self.refresh(&mut state);
            id
        };
        let lane = self.this();
        Registration::new(move || {
            let mut state = locked(&lane.state);
            state.shutdown_handlers.retain(|pending| pending.id != id);
            lane.refresh(&mut state);
        })
    }

    fn hold(
        &self,
        kind: Kind,
        handler: HeldHandler,
        failed: Option<Failed>,
        place: Option<u64>,
    ) -> Registration {
        let id = {
            let mut state = locked(&self.state);
            let listens = match place {
                None => true,
                Some(place) => match state.place(place) {
                    None => return Registration::none(),
                    Some(entry) => entry.listens(),
                },
            };
            let id = state.next_id();
            let held = Held {
                id,
                handler,
                failed,
                listens,
                place,
            };
            match kind {
                Kind::Suspend => state.suspend.push(held),
                Kind::Resume => state.resume.push(held),
            }
            self.refresh(&mut state);
            id
        };
        let lane = self.this();
        Registration::new(move || {
            let mut state = locked(&lane.state);
            state.suspend.retain(|held| held.id != id);
            state.resume.retain(|held| held.id != id);
            lane.refresh(&mut state);
        })
    }

    fn leave(&self, id: u64) {
        let ends = {
            let mut state = locked(&self.state);
            let Some(at) = state.places.iter().position(|place| place.id == id) else {
                return;
            };
            let entry = state.places.remove(at);
            state.suspend.retain(|held| held.place != Some(id));
            state.resume.retain(|held| held.place != Some(id));
            let alone = state.places.is_empty();
            let ends = match state.shutdown.as_mut() {
                None => {
                    state
                        .shutdown_handlers
                        .retain(|pending| pending.place != Some(id));
                    None
                }
                Some(shutdown) => {
                    shutdown.unwound.push(entry);
                    // The last run to resolve ends the shutdown.
                    (alone && !shutdown.ending).then_some(shutdown.signal)
                }
            };
            self.refresh(&mut state);
            ends
        };
        if let Some(signal) = ends {
            self.end(signal);
        }
    }

    /// One arrival of an ending signal: the first begins a shutdown, a second ends it at once, and
    /// `SIGQUIT` ends it by itself.
    fn received(&self, signal: EndingSignal) {
        let under_way = locked(&self.state)
            .shutdown
            .as_ref()
            .map(|shutdown| (shutdown.signal, shutdown.ending));
        match under_way {
            None => self.begin(signal),
            Some((_, true)) => {}
            Some((first, false)) => self.end(if signal == EndingSignal::Quit {
                signal
            } else {
                first
            }),
        }
    }

    /// Begins one shutdown: the budget is fixed now, the longest timeout among the runs live now,
    /// none for `SIGQUIT`, and every one of them is cancelled.
    fn begin(&self, signal: EndingSignal) {
        let (live, budget, generation) = {
            let mut state = locked(&self.state);
            let live: Vec<Arc<LaneRun>> = state
                .places
                .iter()
                .map(|place| Arc::clone(&place.run))
                .collect();
            let budget = if signal == EndingSignal::Quit {
                0
            } else {
                live.iter().map(|run| run.timeout).max().unwrap_or(0)
            };
            state.generation += 1;
            let generation = state.generation;
            state.shutdown = Some(Shutdown {
                signal,
                unwound: Vec::new(),
                ending: false,
                generation,
            });
            (live, budget, generation)
        };
        for run in &live {
            call_caught(|| (run.cancel)(signal), None);
        }
        let still = locked(&self.state)
            .shutdown
            .as_ref()
            .is_some_and(|shutdown| shutdown.generation == generation && !shutdown.ending);
        if !still {
            return;
        }
        if budget == 0 {
            self.end(signal);
            return;
        }
        let lane = Arc::downgrade(&self.this());
        let timer = std::thread::Builder::new()
            .name("loomcli-shutdown".to_owned())
            .spawn(move || {
                std::thread::sleep(Duration::from_millis(u64::from(budget)));
                if let Some(lane) = lane.upgrade() {
                    lane.end_generation(generation);
                }
            });
        // A budget with no timer would never end the shutdown, so it ends now.
        if timer.is_err() {
            self.end(signal);
        }
    }

    /// Ends the shutdown numbered `generation` when its budget runs out, unless it already ended.
    fn end_generation(&self, generation: u64) {
        let signal = locked(&self.state)
            .shutdown
            .as_ref()
            .filter(|shutdown| shutdown.generation == generation && !shutdown.ending)
            .map(|shutdown| shutdown.signal);
        if let Some(signal) = signal {
            self.end(signal);
        }
    }

    /// Ends the shutdown under way: every run's pending output reaches its streams, every
    /// pending handler is called, newest first, core's listeners go, and the signal is re-raised on
    /// the source, whose default action ends the process. Nothing is awaited.
    fn end(&self, signal: EndingSignal) {
        let flushes = {
            let mut state = locked(&self.state);
            let Some(shutdown) = state.shutdown.as_mut() else {
                return;
            };
            if shutdown.ending {
                return;
            }
            shutdown.ending = true;
            let flushes = Self::unflushed(&mut state);
            for place in &mut state.places {
                place.cut_off = true;
            }
            flushes
        };
        for run in flushes {
            call_caught(|| (run.flush)(), None);
        }
        self.call_shutdown_handlers(ShutdownEvent {
            cause: ShutdownCause::Signal(signal),
            code: signal.code(),
        });
        {
            let mut state = locked(&self.state);
            state.shutdown = None;
            self.stop_listening(&mut state);
        }
        self.source.raise(signal.process());
    }

    /// The runs whose terminal no flush reached yet, live and resolved during the shutdown under
    /// way, each marked flushed.
    fn unflushed(state: &mut LaneState) -> Vec<Arc<LaneRun>> {
        let mut flushes = Vec::new();
        let unwound = state
            .shutdown
            .as_mut()
            .map(|shutdown| shutdown.unwound.iter_mut())
            .into_iter()
            .flatten();
        for place in unwound.chain(state.places.iter_mut()) {
            if !place.flushed {
                place.flushed = true;
                flushes.push(Arc::clone(&place.run));
            }
        }
        flushes
    }

    /// The process's own end, which can come before a shutdown's: its terminals are restored as a
    /// shutdown's end would, then every pending handler runs with `Exit` and the status.
    fn exited(&self, code: i32) {
        let flushes = Self::unflushed(&mut locked(&self.state));
        for run in flushes {
            call_caught(|| (run.flush)(), None);
        }
        self.call_shutdown_handlers(ShutdownEvent {
            cause: ShutdownCause::Exit,
            code,
        });
    }

    /// Calls every handler pending now once, newest first, each removed before its call. One a
    /// handler registers while they run is not called.
    fn call_shutdown_handlers(&self, event: ShutdownEvent) {
        let pending = {
            let mut state = locked(&self.state);
            let mut pending = std::mem::take(&mut state.shutdown_handlers);
            pending.reverse();
            pending
        };
        for PendingShutdown {
            handler, failed, ..
        } in pending
        {
            call_caught(|| handler(event), failed.as_ref());
        }
    }

    /// `SIGTSTP`: the suspend handlers run newest first, then `SIGTSTP` is raised again with core's
    /// listener gone, so its default action stops the process. A raise to the process's own self
    /// returns once it continues, and at once where nothing stops it, so the resume path runs as
    /// soon as the raise returns.
    fn suspended(&self) {
        let handlers: Vec<(HeldHandler, Option<Failed>)> = locked(&self.state)
            .suspend
            .iter()
            .rev()
            .map(|held| (Arc::clone(&held.handler), held.failed.clone()))
            .collect();
        for (handler, failed) in handlers {
            call_caught(|| handler(), failed.as_ref());
        }
        {
            let mut state = locked(&self.state);
            state.suspended = true;
            self.refresh(&mut state);
        }
        self.source.raise(ProcessSignal::Tstp);
        self.resumed();
    }

    /// `SIGCONT` after a suspend: core listens for `SIGTSTP` again and the resume handlers run in
    /// registration order. One with no suspend before it calls none.
    fn resumed(&self) {
        let handlers: Vec<(HeldHandler, Option<Failed>)> = {
            let mut state = locked(&self.state);
            if !state.suspended {
                return;
            }
            state.suspended = false;
            self.refresh(&mut state);
            state
                .resume
                .iter()
                .map(|held| (Arc::clone(&held.handler), held.failed.clone()))
                .collect()
        };
        for (handler, failed) in handlers {
            call_caught(|| handler(), failed.as_ref());
        }
    }

    /// Adds listeners when the first reason appears and removes them when the last one ends. The
    /// source's `on` and `off` never call a listener, so they run under the lock.
    fn refresh(&self, state: &mut LaneState) {
        let wants = state.places.iter().any(PlaceEntry::listens)
            || state
                .shutdown_handlers
                .iter()
                .any(|pending| pending.listens);
        if wants {
            self.start_listening(state);
        } else if state.shutdown.is_none() {
            self.stop_listening(state);
        }
        let source = &self.source;
        let suspending = state
            .suspend
            .iter()
            .chain(state.resume.iter())
            .any(|held| held.listens);
        // While the process is stopped, core holds no `SIGTSTP` listener; it listens again on
        // `SIGCONT`.
        let stopping = suspending && !state.suspended;
        match (stopping, state.listening.suspend) {
            (true, None) => {
                let lane = Arc::downgrade(&self.this());
                state.listening.suspend = Some(source.on(
                    SignalEvent::Signal(ProcessSignal::Tstp),
                    Arc::new(move |_| {
                        if let Some(lane) = lane.upgrade() {
                            lane.suspended();
                        }
                    }),
                ));
            }
            (false, Some(id)) => {
                source.off(id);
                state.listening.suspend = None;
            }
            _ => {}
        }
        match (suspending, state.listening.resume) {
            (true, None) => {
                let lane = Arc::downgrade(&self.this());
                state.listening.resume = Some(source.on(
                    SignalEvent::Signal(ProcessSignal::Cont),
                    Arc::new(move |_| {
                        if let Some(lane) = lane.upgrade() {
                            lane.resumed();
                        }
                    }),
                ));
            }
            (false, Some(id)) => {
                source.off(id);
                state.listening.resume = None;
            }
            _ => {}
        }
    }

    fn start_listening(&self, state: &mut LaneState) {
        if state.listening.ending.is_some() {
            return;
        }
        let source = &self.source;
        let mut ids = Vec::new();
        for signal in ENDING {
            let lane = Arc::downgrade(&self.this());
            let listener: SignalListener = Arc::new(move |_| {
                if let Some(lane) = lane.upgrade() {
                    lane.received(signal);
                }
            });
            ids.push(source.on(SignalEvent::Signal(signal.process()), listener));
        }
        let lane = Arc::downgrade(&self.this());
        ids.push(source.on(
            SignalEvent::Exit,
            Arc::new(move |code| {
                if let Some(lane) = lane.upgrade() {
                    lane.exited(code.unwrap_or(0));
                }
            }),
        ));
        state.listening.ending = Some(ids);
    }

    fn stop_listening(&self, state: &mut LaneState) {
        let Some(ids) = state.listening.ending.take() else {
            return;
        };
        for id in ids {
            self.source.off(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tests that read the real process's lane run one at a time.
    fn real_lane() -> MutexGuard<'static, ()> {
        static SERIAL: Mutex<()> = Mutex::new(());
        locked(&SERIAL)
    }

    fn listening_on_the_real_process() -> bool {
        let lane = lane_of(&crate::host::real::real_signals());
        locked(&lane.state).listening.ending.is_some()
    }

    /// A signal source a test drives: it calls its listeners for each raise and records the raise.
    #[derive(Default)]
    struct Driven {
        next: Mutex<u64>,
        listeners: Mutex<Vec<(u64, SignalEvent, SignalListener)>>,
        raised: Mutex<Vec<ProcessSignal>>,
    }

    impl SignalSource for Driven {
        fn on(&self, event: SignalEvent, listener: SignalListener) -> u64 {
            let mut next = locked(&self.next);
            *next += 1;
            locked(&self.listeners).push((*next, event, listener));
            *next
        }
        fn off(&self, id: u64) {
            locked(&self.listeners).retain(|(held, _, _)| *held != id);
        }
        fn raise(&self, signal: ProcessSignal) {
            locked(&self.raised).push(signal);
            let called: Vec<SignalListener> = locked(&self.listeners)
                .iter()
                .filter(|(_, event, _)| *event == SignalEvent::Signal(signal))
                .map(|(_, _, listener)| Arc::clone(listener))
                .collect();
            for listener in called {
                listener(None);
            }
        }
        fn terminal(&self) -> Option<Arc<dyn crate::host::InputStream>> {
            None
        }
    }

    #[test]
    fn the_exported_on_shutdown_is_scoped_to_the_process_and_listens_on_the_real_process() {
        let _serial = real_lane();
        let before = listening_on_the_real_process();
        let registration = crate::signals::on_shutdown(|_| {});
        let during = listening_on_the_real_process();
        registration.remove();
        assert_eq!(
            (before, during, listening_on_the_real_process()),
            (false, true, false)
        );
    }

    #[test]
    fn a_mock_runs_shutdown_never_touches_the_real_process() {
        let _serial = real_lane();
        let driven = Arc::new(Driven::default());
        let source: Arc<dyn SignalSource> = Arc::clone(&driven) as Arc<dyn SignalSource>;
        let place = lane_of(&source).enter(LaneRun {
            cancel: Box::new(|_| {}),
            flush: Box::new(|| {}),
            listens: true,
            timeout: 0,
        });
        let during = (
            locked(&driven.listeners).len(),
            listening_on_the_real_process(),
        );
        source.raise(ProcessSignal::Int);
        let after = (
            locked(&driven.listeners).len(),
            listening_on_the_real_process(),
        );
        place.leave();
        assert_eq!((during, after), ((5, false), (0, false)));
        // The first raise is the test's, the second core's re-raise once its listeners went.
        assert_eq!(
            *locked(&driven.raised),
            [ProcessSignal::Int, ProcessSignal::Int]
        );
    }

    #[test]
    fn every_handle_of_one_source_resolves_one_lane() {
        let real = crate::host::real::real_signals();
        assert!(Arc::ptr_eq(&lane_of(&real), &lane_of(&real)));
    }
}
