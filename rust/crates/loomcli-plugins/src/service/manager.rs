//! The service managers' programs, run as child programs through the run's `host.spawn`, with no
//! shell. A call runs until it exits, and the run signal ends it with `SIGTERM`; only a read that
//! status makes has a time limit. Each call's output is captured and never printed.

use std::future::{Future, poll_fn};
use std::io;
use std::pin::pin;
use std::sync::Arc;
use std::task::Poll;
use std::time::Duration;

use loomcli_core::{
    Child, ChildExit, ChildStream, Env, Error, FatalError, Host, KillSignal, Registration,
    RunSignal, ShutdownEvent, SpawnOptions,
};

use super::messages;

/// The registration of a run-scoped shutdown handler, as the run's context makes it.
pub(super) type OnShutdown<'a> =
    &'a (dyn Fn(Box<dyn FnOnce(ShutdownEvent) + Send>) -> Registration + Send + Sync);

/// What one call answered: the code it exited with and its standard output, or that it never
/// started.
pub(super) enum Answer {
    Exited { code: i32, stdout: String },
    Missing(Arc<io::Error>),
}

/// What one read answered: as a call does, or that the plugin's own limit ended it.
pub(super) enum Read {
    Answered(Answer),
    TimedOut,
}

/// One call: the program and its words, and the command whose report a failure points at.
pub(super) struct Call {
    pub(super) program: &'static str,
    pub(super) args: Vec<String>,
    pub(super) report: String,
}

impl Call {
    /// The words of a call as a sentence repeats them.
    fn text(&self) -> String {
        std::iter::once(self.program)
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Where the calls run: the application's name, their environment, and the run's host, signal, and
/// shutdown registration.
pub(super) struct Manager<'a> {
    pub(super) name: &'a str,
    pub(super) env: Env,
    pub(super) host: &'a Host,
    pub(super) signal: &'a RunSignal,
    pub(super) on_shutdown: OnShutdown<'a>,
}

/// The code of a call that succeeded.
pub(super) const SUCCEEDED: i32 = 0;

/// The status of an abandoned call without a reported exit code.
const FAILED: i32 = 1;

/// How many seconds one read that status makes may run before the plugin ends it.
pub(super) const READ_LIMIT_SECONDS: u64 = 5;

/// The read limit, which no setting changes.
pub(super) const READ_LIMIT: Duration = Duration::from_secs(READ_LIMIT_SECONDS);

/// What a call that ended answered.
fn answer_of(exit: ChildExit) -> Answer {
    match exit {
        ChildExit::Exited { code, stdout, .. } => Answer::Exited {
            code,
            stdout: stdout.text,
        },
        ChildExit::Unstarted { error } => Answer::Missing(error),
        ChildExit::Abandoned { stdout, .. } => Answer::Exited {
            code: FAILED,
            stdout: stdout.text,
        },
        // A way of ending that core adds later started nothing the plugin can read.
        _ => Answer::Missing(Arc::new(io::Error::other("the call did not end normally"))),
    }
}

impl Manager<'_> {
    /// Starts one call from the run's working directory, its standard output captured and its
    /// standard error discarded, and ended with `SIGTERM` by the run signal.
    fn start(&self, call: &Call) -> Child {
        self.host.spawn(
            call.program,
            call.args.iter().cloned(),
            SpawnOptions::new()
                .env(self.env.clone())
                .signal(self.signal.token())
                .stderr(ChildStream::Ignore),
        )
    }

    /// Runs one call until it exits, or until the run signal ends it, whose cancellation it then
    /// returns.
    pub(super) async fn run(&self, call: &Call) -> Result<Answer, Error> {
        self.signal.throw_if_cancelled()?;
        let exit = self.start(call).exited().await;
        self.signal.throw_if_cancelled()?;
        Ok(answer_of(exit))
    }

    /// Runs one read as `run` does, and ends it with `SIGKILL`, which a manager cannot ignore, once
    /// `limit` passes. The limit is the plugin's own timer, read here and never inferred from the
    /// exit code, because a manager that exits 143 on its own is no read that ran out. A run
    /// cancelled during the read returns its cancellation, and a shutdown that ends while it runs
    /// kills it.
    pub(super) async fn read(&self, call: &Call, limit: Duration) -> Result<Read, Error> {
        self.signal.throw_if_cancelled()?;
        let child = Arc::new(self.start(call));
        let killer = Arc::clone(&child);
        let registration = (self.on_shutdown)(Box::new(move |_| killer.kill(KillSignal::Kill)));
        let (exit, ran_out) = wait_within(&child, limit).await;
        registration.remove();
        self.signal.throw_if_cancelled()?;
        Ok(if ran_out {
            Read::TimedOut
        } else {
            Read::Answered(answer_of(exit))
        })
    }

    /// Runs one call and answers its code and output when it exits with one of the accepted
    /// codes. A program that cannot be started, and any other code, fail with exit 1.
    pub(super) async fn expect(
        &self,
        call: &Call,
        accepted: &[i32],
    ) -> Result<(i32, String), Error> {
        match self.run(call).await? {
            Answer::Missing(error) => Err(FatalError::with_cause(
                messages::missing_sentence(self.name, call.program),
                Error::from(error),
            )
            .into()),
            Answer::Exited { code, stdout } => {
                if accepted.contains(&code) {
                    Ok((code, stdout))
                } else {
                    Err(FatalError::new(messages::exited(&call.text(), code, &call.report)).into())
                }
            }
        }
    }

    /// Waits `duration`, or until the run signal is cancelled, whose cancellation it then returns.
    pub(super) async fn pause(&self, duration: Duration) -> Result<(), Error> {
        let mut sleep = pin!(tokio::time::sleep(duration));
        let mut cancelled = pin!(self.signal.cancelled());
        poll_fn(|context| {
            if cancelled.as_mut().poll(context).is_ready()
                || sleep.as_mut().poll(context).is_ready()
            {
                Poll::Ready(())
            } else {
                Poll::Pending
            }
        })
        .await;
        self.signal.throw_if_cancelled()
    }
}

/// Waits for the child to exit, ending it with `SIGKILL` once `limit` passes, and answers its exit
/// and whether the limit ended it.
async fn wait_within(child: &Child, limit: Duration) -> (ChildExit, bool) {
    let mut exited = pin!(child.exited());
    let mut timer = Some(Box::pin(tokio::time::sleep(limit)));
    let mut ran_out = false;
    let exit = poll_fn(|context| {
        if let Poll::Ready(exit) = exited.as_mut().poll(context) {
            return Poll::Ready(exit);
        }
        if let Some(sleep) = timer.as_mut() {
            if sleep.as_mut().poll(context).is_ready() {
                ran_out = true;
                timer = None;
                child.kill(KillSignal::Kill);
                // The exit follows the kill; poll for it again at once.
                context.waker().wake_by_ref();
            }
        }
        Poll::Pending
    })
    .await;
    (exit, ran_out)
}
