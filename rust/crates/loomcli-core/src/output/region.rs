//! Live regions and progress events: an area at the bottom of stderr core redraws in place, and the
//! typed events a region's reports build.
//!
//! A region's calls decide what happens in call order: its frame, its close, and the progress
//! events its reports build. The run's [`Output`] owns the regions' registry and the screen model,
//! and the screen decides the bytes when each write reaches stderr.

use std::collections::VecDeque;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tokio_util::sync::CancellationToken;

use crate::failures::Error;

use super::WholeView;
use super::emit::Output;
use super::progress::{ProgressLedger, RegionReports};
use super::screen::Frame;

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// How a region opens.
#[derive(Clone, Copy, Debug, Default)]
#[must_use]
pub struct RegionOptions {
    pub(crate) input: bool,
    pub(crate) report_only: bool,
}

impl RegionOptions {
    /// A region that draws output alone.
    pub fn new() -> Self {
        Self::default()
    }

    /// A region that reads the operator's keys, as a question does. While it is open core draws no
    /// other region's frame, and one input region is open at a time: a second waits until the first
    /// closes. It draws at every verbosity and under `TERM=dumb`, so a question still asks.
    pub fn input(self) -> Self {
        Self {
            input: true,
            ..self
        }
    }

    /// Opens a region for progress events without a terminal frame.
    #[doc(hidden)]
    pub fn __report_only(self) -> Self {
        Self {
            report_only: true,
            ..self
        }
    }
}

/// What closed a region.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegionCloser {
    /// `end()`.
    End,
    /// What opened it finished with it still open.
    Completion,
    /// The run is about to report a failure.
    Failure,
    /// The run was cancelled.
    Cancellation,
}

/// A progress report a region builds an event from. A value left unset keeps the region's last
/// reported one.
#[derive(Clone, Debug, Default, PartialEq)]
#[must_use]
pub struct ProgressReport {
    pub(crate) completed: Option<f64>,
    pub(crate) total: Option<f64>,
    pub(crate) label: Option<String>,
}

impl ProgressReport {
    /// An empty report.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets how much is done. A negative or non-finite value is carried into the event as it is.
    pub fn completed(self, completed: f64) -> Self {
        Self {
            completed: Some(completed),
            ..self
        }
    }

    /// Sets the total. A negative or non-finite value is carried into the event as it is.
    pub fn total(self, total: f64) -> Self {
        Self {
            total: Some(total),
            ..self
        }
    }

    /// Sets the label, as marked text: the event carries its plain text.
    pub fn label(self, label: impl Into<String>) -> Self {
        Self {
            label: Some(label.into()),
            ..self
        }
    }
}

/// What a region runs as it closes: a handler [`Region::on_close`] registered.
type CloseHandler = Box<dyn FnOnce(&Region) + Send>;

type CoreCloseOrder =
    Arc<dyn Fn(RegionCloser) -> tokio::sync::oneshot::Receiver<Vec<Region>> + Send + Sync>;

/// What one region holds while the run lasts. Its registry entry lives in the run's output; the
/// handle and the registry share it.
pub(crate) struct RegionCell {
    pub(crate) id: u64,
    pub(crate) input: bool,
    pub(crate) live: bool,
    report_only: bool,
    token: CancellationToken,
    /// Turns true once the region has opened and its pending frame is written, or once it closed
    /// without opening; a waiting draw resolves then.
    opened_signal: tokio::sync::watch::Sender<bool>,
    state: Mutex<RegionState>,
}

/// What changes as a region draws, reports, and closes.
#[derive(Default)]
struct RegionState {
    /// Whether the region has opened; a terminal input region waits while another one is open.
    opened: bool,
    closed_by: Option<RegionCloser>,
    /// Whether the close has run its handlers, after which the region takes no frame.
    finished: bool,
    /// The latest frame a waiting region drew, which it draws once it opens.
    pending: Option<Frame>,
    /// The frame a close handler drew, which is the region's last frame.
    last: Option<Frame>,
    before_close: Vec<String>,
    after_close: Vec<String>,
    handlers: Vec<CloseHandler>,
    core_close_order: Option<CoreCloseOrder>,
    reports: RegionReports,
}

impl RegionState {
    fn start_close(&mut self, closer: RegionCloser) -> Option<Vec<CloseHandler>> {
        if self.closed_by.is_some() {
            return None;
        }
        self.closed_by = Some(closer);
        self.core_close_order = None;
        Some(std::mem::take(&mut self.handlers))
    }
}

impl RegionCell {
    fn state(&self) -> MutexGuard<'_, RegionState> {
        locked(&self.state)
    }

    /// Marks a region that opens now, and answers whether it draws.
    fn start(&self) -> bool {
        self.state().opened = true;
        self.live
    }

    /// Resolves every draw that waits for the region to open.
    pub(crate) fn wake(&self) {
        self.opened_signal.send_replace(true);
    }
}

/// The screen operations one change of the regions asks for, composed in stderr's order.
pub(crate) enum ScreenOp {
    Open(u64, bool),
    Draw(u64, Frame),
    Close(u64),
    /// The resume after a suspend draws the open regions again.
    Resume,
}

/// The regions one run opened: the ones still open, or waiting to open, in the order they opened,
/// the one input region that is open, and the input regions waiting for it to close.
#[derive(Default)]
pub(crate) struct Regions {
    next: u64,
    open: Vec<Arc<RegionCell>>,
    waiting: VecDeque<u64>,
    input_owner: Option<u64>,
    ledger: ProgressLedger,
    last_close: Option<CancellationToken>,
}

impl Regions {
    /// Every region still open, or waiting to open, among `only` when it is given: a waiting one
    /// first, so the input region that closes after it promotes none.
    pub(crate) fn targets(&self, only: Option<&[u64]>) -> Vec<Arc<RegionCell>> {
        let mut targets: Vec<Arc<RegionCell>> = self
            .open
            .iter()
            .filter(|cell| only.is_none_or(|only| only.contains(&cell.id)))
            .cloned()
            .collect();
        targets.sort_by_key(|cell| cell.state().opened);
        targets
    }
}

/// What a close leaves to write: the screen operations, the regions whose draws resolve once they
/// are written, and whoever awaits what that write meets.
#[derive(Default)]
pub(crate) struct CloseWork {
    pub(crate) ops: Vec<ScreenOp>,
    pub(crate) before: Vec<String>,
    pub(crate) after: Vec<String>,
    /// How many live regions opened, less how many closed, which the suspend hold counts.
    pub(crate) live: isize,
    pub(crate) wake: Vec<Arc<RegionCell>>,
    pub(crate) written: Option<tokio::sync::oneshot::Sender<Result<(), Error>>>,
}

/// What a draw's call decided before its write.
enum DrawStep {
    Done(Result<(), Error>),
    Wait(tokio::sync::watch::Receiver<bool>),
    Write(u64, Frame),
}

/// A live region at the bottom of stderr. A clone is another handle to the same region.
#[derive(Clone)]
pub struct Region {
    pub(crate) output: Arc<Output>,
    pub(crate) cell: Arc<RegionCell>,
}

impl Region {
    /// Opens a region on the run's stderr stack, collected by `owner` when the opener closes the
    /// regions it left open. A region opened after the run's cancellation closes as it opens.
    pub(crate) fn open(
        output: &Arc<Output>,
        options: RegionOptions,
        owner: Option<&Mutex<Vec<u64>>>,
    ) -> Region {
        let input = options.input;
        let live = !options.report_only && output.region_live(input);
        let (opened_signal, _) = tokio::sync::watch::channel(false);
        let region = {
            let mut regions = output.regions();
            regions.next += 1;
            let cell = Arc::new(RegionCell {
                id: regions.next,
                input,
                live,
                report_only: options.report_only,
                token: CancellationToken::new(),
                opened_signal,
                state: Mutex::new(RegionState::default()),
            });
            regions.open.push(Arc::clone(&cell));
            let mut entered = false;
            let takes_turn = !options.report_only && input && output.terminal_input_regions();
            if takes_turn && regions.input_owner.is_some() {
                regions.waiting.push_back(cell.id);
            } else {
                if takes_turn {
                    regions.input_owner = Some(cell.id);
                }
                if cell.start() {
                    output.screen_open(cell.id, input);
                    entered = true;
                }
            }
            (
                Region {
                    output: Arc::clone(output),
                    cell,
                },
                entered,
            )
        };
        let (region, entered) = region;
        if entered {
            output.enter_live();
        }
        if let Some(owner) = owner {
            locked(owner).push(region.cell.id);
        }
        region.settle_cancellation();
        region
    }

    /// Settles cancellation at the call for ordinary regions. A tree's close goes through its
    /// queue, so an earlier report or end can finish before the cancellation does.
    fn settle_cancellation(&self) {
        if !self.output.cancelled() || self.cell.report_only {
            return;
        }
        let close = {
            let state = self.cell.state();
            state.core_close_order.is_none() && state.closed_by.is_none()
        };
        if close {
            drop(
                self.output
                    .close_region(self, RegionCloser::Cancellation, EndState::Ended, None),
            );
            self.output.wake_drainer();
        }
    }

    /// Whether core draws this region's frames. On a terminal stderr, an input region draws
    /// when the terminal moves its cursor. Other regions draw when the run is not quiet and the
    /// terminal redraws in place. This value is fixed at opening.
    #[must_use]
    pub fn live(&self) -> bool {
        self.cell.live
    }

    /// A token cancelled whenever the region closes, whatever closes it, so a timer animating it
    /// stops. Core sets [`Region::closed_by`] before it cancels the token.
    #[must_use]
    pub fn signal(&self) -> CancellationToken {
        self.settle_cancellation();
        self.cell.token.clone()
    }

    /// What closed the region, or `None` while it is open.
    #[must_use]
    pub fn closed_by(&self) -> Option<RegionCloser> {
        self.settle_cancellation();
        self.cell.state().closed_by
    }

    /// Registers `handler` to run as the region closes, whatever closes it: after `closed_by` is
    /// set and before the signal is cancelled. A frame the handler draws with [`Region::draw`] is
    /// the region's last frame, so a library draws its finished, failed, or cancelled line there;
    /// the handler need not await that draw. A handler registered after the region closed never
    /// runs.
    pub fn on_close(&self, handler: impl FnOnce(&Region) + Send + 'static) {
        let mut state = self.cell.state();
        if state.closed_by.is_none() {
            state.handlers.push(Box::new(handler));
        }
    }

    /// Lets a progress tree prepare its core close in order with the work it already accepted.
    /// The receiver also supplies its open task regions in case they opened during the sweep.
    #[doc(hidden)]
    pub fn __order_core_close(
        &self,
        prepare: impl Fn(RegionCloser) -> tokio::sync::oneshot::Receiver<Vec<Region>>
        + Send
        + Sync
        + 'static,
    ) -> bool {
        let mut state = self.cell.state();
        if state.closed_by.is_some() {
            return false;
        }
        state.core_close_order = Some(Arc::new(prepare));
        true
    }

    /// Whether cancellation has reached the run, even if the tree is still draining.
    #[doc(hidden)]
    #[must_use]
    pub fn __run_cancelled(&self) -> bool {
        self.output.cancelled()
    }

    /// Replaces the region's frame. The view, the application's override when one applies, runs
    /// inside the call with stderr's view context and its live `columns`; its marked text resolves
    /// under stderr's rendering policy with its control sequences kept, and no newline is added.
    /// The returned future resolves once the frame is written. A region that is not live calls no
    /// view and writes nothing. A terminal input region still waits for its turn to open.
    /// Once the region has closed, the call does nothing. A view's `Err` is this call's.
    pub fn draw<D: ?Sized + Sync + 'static, V: WholeView<D>>(
        &self,
        data: &D,
        view: &V,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'static {
        let step = self.decide_draw(data, view);
        let output = Arc::clone(&self.output);
        async move {
            match step {
                DrawStep::Done(done) => done,
                DrawStep::Wait(mut opened) => {
                    let _ = opened.wait_for(|opened| *opened).await;
                    Ok(())
                }
                DrawStep::Write(id, frame) => output.draw_region(id, frame).await,
            }
        }
    }

    fn decide_draw<D: ?Sized + 'static, V: WholeView<D>>(&self, data: &D, view: &V) -> DrawStep {
        self.settle_cancellation();
        {
            let state = self.cell.state();
            if state.finished {
                return DrawStep::Done(Ok(()));
            }
            if !self.cell.live {
                return if state.opened {
                    DrawStep::Done(Ok(()))
                } else {
                    DrawStep::Wait(self.cell.opened_signal.subscribe())
                };
            }
        }
        let (identity, view) = view.whole();
        let frame = match self.output.frame(identity, view, data) {
            Ok(frame) => frame,
            Err(error) => return DrawStep::Done(Err(error)),
        };
        let mut state = self.cell.state();
        if state.finished {
            return DrawStep::Done(Ok(()));
        }
        if state.closed_by.is_some() {
            // A close handler's frame is the region's last.
            if state.opened {
                state.last = Some(frame);
            }
            return DrawStep::Done(Ok(()));
        }
        if !state.opened {
            state.pending = Some(frame);
            return DrawStep::Wait(self.cell.opened_signal.subscribe());
        }
        DrawStep::Write(self.cell.id, frame)
    }

    /// Closes the region; its last frame moves into scrollback, ending with a line break core adds
    /// when the frame lacks one, and the regions below close the gap. `state` is the end event's,
    /// `ended`, `failed`, `skipped`, or `warned`. `label` replaces the last reported label on that event alone and draws
    /// nothing. The returned future resolves once the close is written, and rejects with stderr's
    /// failure when stderr refused a write before it or refuses this one. A region that is not
    /// live writes nothing and resolves at once; once the region has closed, the call does nothing
    /// and resolves at once.
    pub async fn end(&self, state: EndState, label: Option<&str>) -> Result<(), Error> {
        self.queue_end(state, label).await
    }

    /// Stages stderr writes to queue contiguously with the region's closing screen operations.
    /// A tree that will be written into scrollback places its writes after its running frame clears.
    #[doc(hidden)]
    pub fn __close_writes(&self, mut writes: Vec<String>, after_frame: bool) {
        let mut state = self.cell.state();
        if !state.finished {
            let destination = if after_frame {
                &mut state.after_close
            } else {
                &mut state.before_close
            };
            destination.append(&mut writes);
        }
    }

    /// Renders the frame that moves into scrollback when this region closes.
    #[doc(hidden)]
    pub fn __last_frame<D: ?Sized + 'static, V: WholeView<D>>(
        &self,
        data: &D,
        view: &V,
    ) -> Result<(), Error> {
        if !self.cell.live {
            return Ok(());
        }
        let (identity, view) = view.whole();
        let frame = self.output.frame(identity, view, data)?;
        let mut state = self.cell.state();
        if state.opened && !state.finished {
            state.last = Some(frame);
        }
        Ok(())
    }

    /// Queues an explicit end the progress tree already accepted and waits for its writes.
    #[doc(hidden)]
    pub fn __queue_end(
        &self,
        state: EndState,
        label: Option<&str>,
    ) -> crate::BoxFuture<'static, Result<(), Error>> {
        let done = self.end_in_order(RegionCloser::End, state, label);
        self.output.wake_drainer();
        done
    }

    fn queue_end(
        &self,
        state: EndState,
        label: Option<&str>,
    ) -> crate::BoxFuture<'static, Result<(), Error>> {
        self.settle_cancellation();
        self.end_in_order(
            self.output.effective_closer(RegionCloser::End),
            state,
            label,
        )
    }

    fn end_in_order(
        &self,
        closer: RegionCloser,
        state: EndState,
        label: Option<&str>,
    ) -> crate::BoxFuture<'static, Result<(), Error>> {
        let Some(written) = self.output.close_region(self, closer, state, label) else {
            return Box::pin(std::future::ready(Ok(())));
        };
        let output = Arc::clone(&self.output);
        Box::pin(async move {
            output.flush().await;
            // The flush sent the close, whose sender answered before it was dropped.
            written.await.unwrap_or(Ok(()))
        })
    }

    /// Builds a progress event for whoever observes the run and draws nothing, whether or not the
    /// region is live. Once the region has closed, the call does nothing.
    pub fn report(&self, progress: ProgressReport) {
        self.settle_cancellation();
        let context = self.output.context(super::emit::Stream::Stderr);
        let plain = |text: &str| context.plain(text);
        let event = {
            let mut regions = self.output.regions();
            let mut state = self.cell.state();
            if state.closed_by.is_some() {
                return;
            }
            state.reports.report(&mut regions.ledger, &progress, &plain)
        };
        self.output.deliver_progress(&event);
    }
}

impl Output {
    fn effective_closer(&self, closer: RegionCloser) -> RegionCloser {
        if self.cancelled() {
            RegionCloser::Cancellation
        } else {
            closer
        }
    }

    /// Closes `region` once, whatever closes it: `closed_by` is set, the close handlers run, a
    /// frame one of them draws is the last frame, the signal is cancelled, the end event is built,
    /// and the region leaves the stack, its screen work queued in stderr's order. A later close
    /// does nothing. Returns a receiver for the result of a close that has screen work to write.
    fn close_region(
        &self,
        region: &Region,
        closer: RegionCloser,
        state: EndState,
        label: Option<&str>,
    ) -> Option<tokio::sync::oneshot::Receiver<Result<(), Error>>> {
        let handlers = region.cell.state().start_close(closer)?;
        self.finish_region_close(region, closer, state, label, handlers)
    }

    fn finish_region_close(
        &self,
        region: &Region,
        closer: RegionCloser,
        state: EndState,
        label: Option<&str>,
        handlers: Vec<CloseHandler>,
    ) -> Option<tokio::sync::oneshot::Receiver<Result<(), Error>>> {
        for handler in handlers {
            handler(region);
        }
        region.cell.token.cancel();
        let context = self.context(super::emit::Stream::Stderr);
        let plain = |text: &str| context.plain(text);
        let (mut work, event) = {
            let mut regions = self.regions();
            let mut held = region.cell.state();
            held.finished = true;
            let event = held.reports.close(closer, state, label, &plain);
            drop(held);
            (release(&mut regions, &region.cell), event)
        };
        match work.live {
            1 => region.output.enter_live(),
            -1 => self.leave_live(),
            _ => {}
        }
        if let Some(event) = event {
            self.deliver_progress(&event);
        }
        let written = if work.ops.is_empty() && work.before.is_empty() && work.after.is_empty() {
            None
        } else {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            work.written = Some(sender);
            Some(receiver)
        };
        self.queue_screen(work);
        written
    }

    /// Requests a sweep at the call and waits for it to queue its writes. A later sweep joins
    /// the same order so it cannot close a task while the first sweep prepares its root.
    pub(crate) fn close_regions(
        self: &Arc<Self>,
        closer: RegionCloser,
        only: Option<Vec<u64>>,
    ) -> impl Future<Output = ()> + Send + 'static {
        let settled = CancellationToken::new();
        let previous = self.regions().last_close.replace(settled.clone());
        let settled = settled.drop_guard();
        let output = self.clone();
        async move {
            let _settled = settled;
            if let Some(previous) = previous {
                previous.cancelled().await;
            }
            let mut targets: VecDeque<_> = output
                .regions()
                .targets(only.as_deref())
                .into_iter()
                .map(|cell| (cell, None))
                .collect();
            while let Some((cell, tree_closer)) = targets.pop_front() {
                let closer = tree_closer.unwrap_or_else(|| output.effective_closer(closer));
                let region = Region {
                    output: output.clone(),
                    cell,
                };
                let handlers = {
                    let mut state = region.cell.state();
                    match &state.core_close_order {
                        Some(prepare) => Err(prepare.clone()),
                        None => Ok(state.start_close(closer)),
                    }
                };
                match handlers {
                    Err(prepare) => {
                        if let Ok(tasks) = prepare(closer).await {
                            // A progress root has opened, so the waiting regions have already
                            // been taken and the rest are in opening order. Include tasks that
                            // opened after the snapshot and give them their root's closer.
                            for task in tasks {
                                match targets
                                    .binary_search_by_key(&task.cell.id, |(cell, _)| cell.id)
                                {
                                    Ok(index) => targets[index].1 = Some(closer),
                                    Err(index) => targets.insert(index, (task.cell, Some(closer))),
                                }
                            }
                        }
                        drop(output.close_region(&region, closer, EndState::Ended, None));
                    }
                    Ok(Some(handlers)) => drop(output.finish_region_close(
                        &region,
                        closer,
                        EndState::Ended,
                        None,
                        handlers,
                    )),
                    Ok(None) => {}
                }
            }
            output.wake_drainer();
        }
    }

    /// Starts closing on the signal's caller. A signal raised by a view or observer can return
    /// while that tree still has work to drain. The run's final sweep waits for this one.
    pub(crate) fn cancel_regions(self: &Arc<Self>) {
        let mut close = Box::pin(self.close_regions(RegionCloser::Cancellation, None));
        if crate::support::poll_once(tokio::task::unconstrained(close.as_mut())).is_none()
            && let Some(runtime) = self.runtime()
        {
            drop(runtime.spawn(close));
        }
    }
}

/// A region that closed leaves the registry, and the next waiting input region opens. Answers the
/// screen work that leaves: the last frame a close handler drew, the close, and the opening of the
/// promoted region with the frame it drew while it waited.
fn release(regions: &mut Regions, cell: &Arc<RegionCell>) -> CloseWork {
    regions.open.retain(|open| open.id != cell.id);
    let mut work = CloseWork::default();
    let last = {
        let mut state = cell.state();
        if !state.opened {
            regions.waiting.retain(|id| *id != cell.id);
            drop(state);
            cell.wake();
            return work;
        }
        work.before = std::mem::take(&mut state.before_close);
        work.after = std::mem::take(&mut state.after_close);
        state.last.take()
    };
    if cell.live {
        if let Some(last) = last {
            work.ops.push(ScreenOp::Draw(cell.id, last));
        }
        work.ops.push(ScreenOp::Close(cell.id));
        work.live -= 1;
    }
    if regions.input_owner == Some(cell.id) {
        regions.input_owner = None;
        let next = regions.waiting.pop_front().and_then(|id| {
            regions
                .open
                .iter()
                .find(|open| open.id == id)
                .map(Arc::clone)
        });
        if let Some(next) = next {
            regions.input_owner = Some(next.id);
            if next.start() {
                work.live += 1;
                work.ops.push(ScreenOp::Open(next.id, next.input));
                if let Some(pending) = next.state().pending.take() {
                    work.ops.push(ScreenOp::Draw(next.id, pending));
                }
            }
            work.wake.push(next);
        }
    }
    work
}

/// The state [`Region::end`] gives the region's end event.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EndState {
    /// The region ended: its end event is `Ended`.
    #[default]
    Ended,
    /// The region ended in failure: its end event is `Failed`.
    Failed,
    /// The region was skipped.
    Skipped,
    /// The region ended with a warning.
    Warned,
}

/// A progress event's state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProgressState {
    /// The region's first report.
    Started,
    /// A later report.
    Updated,
    /// The region ended.
    Ended,
    /// The region ended in failure.
    Failed,
    /// The run was cancelled.
    Cancelled,
    /// The region was skipped.
    Skipped,
    /// The region ended with a warning.
    Warned,
}

impl ProgressState {
    /// The state name used in progress notifications.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Updated => "updated",
            Self::Ended => "ended",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Skipped => "skipped",
            Self::Warned => "warned",
        }
    }
}

/// A typed progress event, delivered to `invoke`'s `on_progress` observer, inside the report or
/// the close that built it. Under `run()` nothing observes them, and no progress event reaches an
/// `on_log` hook.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub struct ProgressEvent {
    /// The region's number in the run, from 1, in the order each region first reported.
    pub id: u64,
    /// The state.
    pub state: ProgressState,
    /// The plain text of the latest label, `""` until a report gives one; an end event built by
    /// `end(state, Some(label))` carries that label instead.
    pub label: String,
    /// The latest completed count, `None` when none was reported.
    pub completed: Option<f64>,
    /// The latest total, `None` when none was reported.
    pub total: Option<f64>,
}
