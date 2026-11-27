//! One initialize-era session: its connection, and the clock that ends it once it has had no
//! request or notification and no call in flight for the idle interval.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Notify;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::connection::{Connection, Shared, locked};
use crate::protocol::ToolSource;

/// The furthest a deadline is set, for an idle interval no clock reaches: thirty years.
const FURTHEST: Duration = Duration::from_secs(30 * 365 * 24 * 60 * 60);

/// A session's idle clock.
struct Clock {
    idle: Duration,
    deadline: Mutex<Instant>,
    touched: Notify,
    ended: CancellationToken,
}

impl Clock {
    /// Restarts the clock, unless the session ended.
    fn touch(&self) {
        if self.ended.is_cancelled() {
            return;
        }
        let now = Instant::now();
        *locked(&self.deadline) = now.checked_add(self.idle).unwrap_or_else(|| now + FURTHEST);
        self.touched.notify_one();
    }

    fn deadline(&self) -> Instant {
        *locked(&self.deadline)
    }
}

/// One initialize-era session.
pub(super) struct HttpSession<S> {
    pub(super) connection: Connection<S>,
    clock: Arc<Clock>,
}

impl<S: ToolSource> HttpSession<S> {
    /// A session whose clock has not started: it runs from [`Self::watch_idle`], once the session
    /// is registered, so an expiry always finds it.
    pub(super) fn new(shared: Arc<Shared<S>>, idle: Duration) -> Self {
        let clock = Arc::new(Clock {
            idle,
            deadline: Mutex::new(Instant::now()),
            touched: Notify::new(),
            ended: CancellationToken::new(),
        });
        let settled = Arc::clone(&clock);
        let connection = Connection::new(shared, Some(Box::new(move || settled.touch())));
        Self { connection, clock }
    }

    /// Starts the idle clock from now. `expire` runs once the session idles out; a session that
    /// ends first never calls it.
    pub(super) fn watch_idle(&self, expire: impl FnOnce() + Send + 'static) {
        self.clock.touch();
        tokio::spawn(run_clock(
            Arc::clone(&self.clock),
            self.connection.clone(),
            expire,
        ));
    }

    /// Restarts the idle clock.
    pub(super) fn touch(&self) {
        self.clock.touch();
    }

    /// Ends the session: its clock stops, its calls abort, answering nothing, and no request
    /// starts on it after.
    pub(super) fn end(&self) {
        self.clock.ended.cancel();
        self.connection.end();
    }
}

/// Runs a session's clock: at its deadline, a session with no call in flight expires, and one
/// with a call waits for the touch its last call's settling gives.
async fn run_clock<S: ToolSource>(
    clock: Arc<Clock>,
    connection: Connection<S>,
    expire: impl FnOnce() + Send + 'static,
) {
    loop {
        tokio::select! {
            () = clock.ended.cancelled() => return,
            () = clock.touched.notified() => continue,
            () = tokio::time::sleep_until(clock.deadline()) => {}
        }
        if Instant::now() < clock.deadline() {
            continue;
        }
        if !connection.busy() {
            expire();
            return;
        }
        tokio::select! {
            () = clock.ended.cancelled() => return,
            () = clock.touched.notified() => {}
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    /// The reference's `a call settling after session deletion leaves its idle timer stopped`
    /// counts the fake timers before and after the settling; tokio exposes no count of its
    /// timers, so this reads the clock the settling touches: an ended session's clock keeps its
    /// deadline.
    #[tokio::test(start_paused = true)]
    async fn a_touch_after_the_session_ends_leaves_its_clock_stopped() {
        let clock = Clock {
            idle: Duration::from_secs(1),
            deadline: Mutex::new(Instant::now()),
            touched: Notify::new(),
            ended: CancellationToken::new(),
        };
        clock.touch();
        let deadline = clock.deadline();
        clock.ended.cancel();
        tokio::time::advance(Duration::from_secs(5)).await;
        clock.touch();
        assert_eq!(clock.deadline(), deadline);
    }

    struct NoTools;

    impl ToolSource for NoTools {
        async fn list_tools(&self) -> Result<Vec<crate::protocol::Tool>, crate::ProtocolError> {
            Ok(Vec::new())
        }

        async fn call_tool(
            &self,
            _: crate::protocol::ToolCall,
        ) -> Result<crate::protocol::ToolResult, crate::ProtocolError> {
            Ok(crate::protocol::ToolResult::default())
        }
    }

    /// A session whose idle time has already passed by the time it is registered still idles
    /// out: its clock starts at registration, so the expiry never runs before the transport can
    /// find the session to end it.
    #[tokio::test(start_paused = true)]
    async fn a_session_idles_out_from_its_registration_even_when_its_idle_time_passed_before_it() {
        let session = HttpSession::new(
            Arc::new(Shared {
                info: crate::protocol::ServerInfo::new("fixture", "1.0.0"),
                source: NoTools,
            }),
            Duration::from_millis(1),
        );
        tokio::time::advance(Duration::from_secs(5)).await;
        let (expired, expiry) = tokio::sync::oneshot::channel();
        session.watch_idle(move || {
            let _ = expired.send(());
        });
        tokio::time::timeout(Duration::from_secs(1), expiry)
            .await
            .expect("the session never idled out")
            .unwrap();
    }
}
