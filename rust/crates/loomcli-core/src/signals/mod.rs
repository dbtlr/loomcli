//! Signal lanes, cancellation, and shutdown.
//!
//! Every run has one [`RunSignal`]. The first cause that aborts it fixes the
//! [`CancellationReason`] and the exit code the run resolves (129, 130, 131, 141, or 143). An ending
//! signal starts a shutdown bounded by the Application's shutdown budget, and the synchronous
//! handlers registered with [`on_shutdown`] run at its end even when the budget runs out.

use std::sync::{Arc, Mutex};

use tokio_util::sync::CancellationToken;

pub(crate) mod lane;
mod messages;

/// A signal that ends the process.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndingSignal {
    /// `SIGHUP`, exit 129.
    Hup,
    /// `SIGINT`, exit 130.
    Int,
    /// `SIGQUIT`, exit 131.
    Quit,
    /// `SIGTERM`, exit 143.
    Term,
}

/// What aborted a run's signal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum CancellationSource {
    /// An ending signal reached the process.
    Signal(EndingSignal),
    /// The caller's own signal, handed to `run` or `invoke`, aborted.
    Caller,
    /// The action called `cancel()`.
    Action,
    /// The reader of stdout closed the pipe; the run exits 141.
    ClosedPipe,
}

/// Why a run was cancelled. The first cause fixes it for the rest of the run.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct CancellationReason {
    /// What aborted the signal.
    pub source: CancellationSource,
    /// The value the caller aborted with, when one was given.
    pub cause: Option<Arc<str>>,
}

/// The run signal: a cancellation token that records the first cause that aborted it.
///
/// Pass [`RunSignal::token`] to any tokio-aware library; await [`RunSignal::cancelled`] to stop work.
#[derive(Clone)]
pub struct RunSignal {
    token: CancellationToken,
    reason: Arc<std::sync::OnceLock<CancellationReason>>,
    /// The run an action's call belongs to, whose reason a cancellation it passed down reads.
    parent: Option<Box<RunSignal>>,
    /// An action's call's own caller signal. The call's token is its run's child, so this one
    /// cannot be its parent too: the call reads it whenever it reads its own state, and cancels
    /// itself with `Caller` once it finds it cancelled, for the whole life of the call.
    caller: Option<CancellationToken>,
    /// What core runs synchronously as the run is aborted: its live regions closing.
    listeners: Arc<Mutex<AbortListeners>>,
}

/// The synchronous listeners of one run's abort, which run once.
#[derive(Default)]
struct AbortListeners {
    fired: bool,
    held: Vec<Box<dyn FnOnce() + Send>>,
}

impl std::fmt::Debug for RunSignal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RunSignal")
            .field("cancelled", &self.is_cancelled())
            .field("reason", &self.reason.get())
            .finish_non_exhaustive()
    }
}

impl RunSignal {
    /// A run signal over `token`, with no reason recorded yet.
    pub(crate) fn new(token: CancellationToken) -> Self {
        Self {
            token,
            reason: Arc::new(std::sync::OnceLock::new()),
            parent: None,
            caller: None,
            listeners: Arc::new(Mutex::new(AbortListeners::default())),
        }
    }

    /// The signal of an action's call: cancelled with its run, whose reason it then reads, by
    /// `caller`, the call's own signal, and on its own by the call's own causes.
    pub(crate) fn nested(parent: &RunSignal, caller: Option<CancellationToken>) -> Self {
        Self {
            parent: Some(Box::new(parent.clone())),
            caller,
            ..Self::new(parent.token.child_token())
        }
    }

    /// Cancels the call with `Caller` when its caller's signal was cancelled before any other cause
    /// reached it. The abort listeners run where core polls the call, not here, as they do for a
    /// token its parent cancelled.
    fn follow_caller(&self) {
        if let Some(caller) = &self.caller
            && caller.is_cancelled()
            && !self.token.is_cancelled()
        {
            let _ = self.reason.set(CancellationReason {
                source: CancellationSource::Caller,
                cause: None,
            });
            self.token.cancel();
        }
    }

    /// Whether the run has been cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.follow_caller();
        self.token.is_cancelled()
    }

    /// Resolves when the run is cancelled.
    pub async fn cancelled(&self) {
        let Some(caller) = &self.caller else {
            return self.token.cancelled().await;
        };
        let mut own = std::pin::pin!(self.token.cancelled());
        let mut called = std::pin::pin!(caller.cancelled());
        std::future::poll_fn(|context| {
            if called.as_mut().poll(context).is_ready() {
                self.follow_caller();
                return std::task::Poll::Ready(());
            }
            own.as_mut().poll(context)
        })
        .await;
    }

    /// The reason the run was cancelled, or `None` while it runs. A run the caller's signal
    /// cancelled reads `Caller`, with no cause: a `CancellationToken` carries no value. An action's
    /// call its run's cancellation reached reads the run's reason.
    #[must_use]
    pub fn reason(&self) -> Option<&CancellationReason> {
        if !self.is_cancelled() {
            return None;
        }
        Some(self.reason.get_or_init(|| {
            self.parent
                .as_ref()
                .and_then(|parent| parent.reason().cloned())
                .unwrap_or(CancellationReason {
                    source: CancellationSource::Caller,
                    cause: None,
                })
        }))
    }

    /// `Err` with the cancellation echo once the run has been cancelled, which ends an action
    /// silently when it propagates, as the reference's `signal.throwIfAborted()` does: a library
    /// that stops for a cancellation, such as a question, returns it. `Ok` while the run goes on.
    pub fn throw_if_cancelled(&self) -> Result<(), crate::failures::Error> {
        if self.is_cancelled() {
            Err(crate::output::emit::CancellationEcho.into())
        } else {
            Ok(())
        }
    }

    /// The token underneath, for a library that takes a `CancellationToken`.
    #[must_use]
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }

    /// Cancels the run for `source`, unless an earlier cause already did: the first cause fixes the
    /// reason, and so the exit code, for the rest of the run. The run's abort listeners run once,
    /// synchronously, whichever cause came first.
    pub(crate) fn abort(&self, source: CancellationSource, cause: Option<Arc<str>>) {
        if !self.is_cancelled() {
            let _ = self.reason.set(CancellationReason { source, cause });
            self.token.cancel();
        }
        self.fire();
    }

    /// Runs `listener` once as the run is aborted, at once when it already was.
    pub(crate) fn on_abort(&self, listener: impl FnOnce() + Send + 'static) {
        {
            let mut listeners = self
                .listeners
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if !listeners.fired {
                listeners.held.push(Box::new(listener));
                return;
            }
        }
        listener();
    }

    /// Runs the abort listeners once the token is cancelled, whatever cancelled it.
    pub(crate) fn fire(&self) {
        if !self.is_cancelled() {
            return;
        }
        let held = {
            let mut listeners = self
                .listeners
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if listeners.fired {
                return;
            }
            listeners.fired = true;
            std::mem::take(&mut listeners.held)
        };
        for listener in held {
            listener();
        }
    }

    /// The exit code the run's cancellation resolves to, or `None` while it runs. A token cancelled
    /// from outside with no reason recorded reads as the caller's, or as its run's for a call.
    pub(crate) fn exit_code(&self) -> Option<crate::failures::ExitCode> {
        self.reason().map(|reason| reason.source.exit_code())
    }
}

impl CancellationSource {
    /// The code a run this source cancelled resolves: the signal's, 130 for the caller and the
    /// action, and 141 for a closed pipe.
    pub(crate) fn exit_code(self) -> crate::failures::ExitCode {
        use crate::failures::ExitCode;
        match self {
            CancellationSource::Signal(EndingSignal::Hup) => ExitCode::HANGUP,
            CancellationSource::Signal(EndingSignal::Int)
            | CancellationSource::Caller
            | CancellationSource::Action => ExitCode::INTERRUPT,
            CancellationSource::Signal(EndingSignal::Quit) => ExitCode::QUIT,
            CancellationSource::Signal(EndingSignal::Term) => ExitCode::TERMINATE,
            CancellationSource::ClosedPipe => ExitCode::CLOSED_PIPE,
        }
    }
}

/// What ended the process when the shutdown handlers run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShutdownCause {
    /// An ending signal.
    Signal(EndingSignal),
    /// The process ended on its own.
    Exit,
}

/// The event a shutdown handler receives.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub struct ShutdownEvent {
    /// The signal that ended the process, or `Exit`.
    pub cause: ShutdownCause,
    /// The status the shell sees: 128 plus the signal's number, or the exit status.
    pub code: i32,
}

/// A registered handler. [`Registration::remove`] unregisters it; dropping it keeps it registered.
#[must_use = "keep the registration to remove the handler when its work ends"]
pub struct Registration {
    remove: Option<Box<dyn FnOnce() + Send>>,
}

impl std::fmt::Debug for Registration {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Registration")
            .field("held", &self.remove.is_some())
            .finish()
    }
}

impl Registration {
    /// A registration whose removal runs `remove`.
    pub(crate) fn new(remove: impl FnOnce() + Send + 'static) -> Self {
        Self {
            remove: Some(Box::new(remove)),
        }
    }

    /// A registration that holds nothing: a handler registered after its run ended.
    pub(crate) fn none() -> Self {
        Self { remove: None }
    }

    /// Removes the handler, so it never runs.
    pub fn remove(mut self) {
        if let Some(remove) = self.remove.take() {
            remove();
        }
    }
}

/// The lane of the real process's signal source, where every handler scoped to the process lives.
fn process_lane() -> Arc<lane::Lane> {
    lane::lane_of(&crate::host::real::real_signals())
}

/// Registers a synchronous handler that runs once at the end of a shutdown, or at the process's own
/// end, even when the shutdown budget runs out. The process's own end is the return of
/// [`Application::main`](crate::Application::main) or
/// [`Application::main_async`](crate::Application::main_async); a program that awaits
/// [`Application::run`](crate::Application::run) itself, or leaves through `std::process::exit`,
/// has no end core sees, so the handler does not run then. It restores what a library changed, such as the
/// cursor or raw mode. It is scoped to the process: it stays until its registration is removed, and
/// while it is registered core listens for the ending signals on the real process. A handler that
/// panics is caught, and the rest still run.
///
/// The handler's type returns `()`, so it cannot hand back a future that would never finish.
pub fn on_shutdown(handler: impl FnOnce(ShutdownEvent) + Send + 'static) -> Registration {
    process_lane().on_shutdown(Box::new(handler))
}

/// Registers a synchronous handler that runs when the process is suspended (`SIGTSTP`), newest
/// first, before core stops the process. It is scoped to the process.
pub fn on_suspend(handler: impl Fn() + Send + Sync + 'static) -> Registration {
    process_lane().on_suspend(Arc::new(handler))
}

/// Registers a synchronous handler that runs when the process resumes (`SIGCONT`) after a suspend,
/// in registration order. It is scoped to the process.
pub fn on_resume(handler: impl Fn() + Send + Sync + 'static) -> Registration {
    process_lane().on_resume(Arc::new(handler))
}
