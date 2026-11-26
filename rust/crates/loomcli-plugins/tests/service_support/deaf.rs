//! A process handle for the manager that ignores `SIGTERM`: it wraps the mock process and answers
//! the spawn of one call with a child that only an uncatchable kill ends, as the reference's
//! `deaf` answer does with a real manager program. The mock process ends a child at once on any
//! ending signal, so it cannot stand for such a manager.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_core::{
    BoxFuture, Child, ChildExit, ChildOutput, ChildProcess, DirectoryFacts, Env, ExitCode,
    InputStream, KillSignal, Libc, OutputStream, ProcessHandle, ProcessSignal, ProcessTerminal,
    ReleaseFacts, SignalSource, SpawnRequest,
};
use loomcli_testing::MockProcess;
use tokio::sync::watch;

/// What a deaf call is: its exact words, the signals it received, and whether the run is sent
/// `SIGTERM` shortly after it starts.
pub struct Deafness {
    pub words: String,
    pub term_after_start: bool,
    pub kills: Arc<Mutex<Vec<KillSignal>>>,
}

/// The mock process, with the spawn of one call answered by a child that ignores `SIGTERM`.
pub struct Deaf {
    pub inner: Arc<MockProcess>,
    pub deafness: Deafness,
}

/// A child that exits with 137 only when it is killed with `SIGKILL`.
struct DeafChild {
    exit: watch::Sender<Option<ChildExit>>,
    kills: Arc<Mutex<Vec<KillSignal>>>,
}

impl ChildProcess for DeafChild {
    fn exited(&self) -> BoxFuture<'_, ChildExit> {
        let mut exit = self.exit.subscribe();
        Box::pin(async move {
            exit.wait_for(Option::is_some)
                .await
                .unwrap()
                .clone()
                .unwrap()
        })
    }

    fn kill(&self, signal: KillSignal) {
        self.kills.lock().unwrap().push(signal);
        if signal == KillSignal::Kill {
            self.settle(ChildExit::Exited {
                code: 137,
                stdout: ChildOutput::default(),
                stderr: ChildOutput::default(),
            });
        }
    }

    fn abandon(&self) {
        self.settle(ChildExit::Abandoned {
            stdout: ChildOutput::default(),
            stderr: ChildOutput::default(),
        });
    }
}

impl DeafChild {
    fn settle(&self, answer: ChildExit) {
        self.exit.send_if_modified(|exit| {
            if exit.is_some() {
                return false;
            }
            *exit = Some(answer);
            true
        });
    }
}

impl ProcessHandle for Deaf {
    fn argv(&self) -> Vec<String> {
        self.inner.argv()
    }
    fn program(&self) -> Vec<String> {
        self.inner.program()
    }
    fn env(&self) -> Env {
        self.inner.env()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.inner.cwd()
    }
    fn home(&self) -> PathBuf {
        self.inner.home()
    }
    fn tmpdir(&self) -> PathBuf {
        self.inner.tmpdir()
    }
    fn platform(&self) -> String {
        self.inner.platform()
    }
    fn arch(&self) -> String {
        self.inner.arch()
    }
    fn libc(&self) -> Option<Libc> {
        self.inner.libc()
    }
    fn uid(&self) -> Option<u32> {
        self.inner.uid()
    }
    fn time_zone(&self) -> String {
        self.inner.time_zone()
    }
    fn release(&self) -> ReleaseFacts {
        self.inner.release()
    }
    fn release_for(&self, application: &str, directories: &DirectoryFacts) -> ReleaseFacts {
        self.inner.release_for(application, directories)
    }
    fn read_source(&self, path: &str, cwd: &str) -> Option<String> {
        self.inner.read_source(path, cwd)
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        self.inner.stdin()
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        self.inner.stdout()
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        self.inner.stderr()
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        self.inner.terminal()
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        self.inner.signals()
    }
    fn spawn(&self, request: SpawnRequest) -> Child {
        let words = std::iter::once(request.command.clone())
            .chain(request.args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ");
        if words != self.deafness.words {
            return self.inner.spawn(request);
        }
        if self.deafness.term_after_start {
            let inner = Arc::clone(&self.inner);
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(50)).await;
                inner.raise(ProcessSignal::Term);
            });
        }
        Child::new(DeafChild {
            exit: watch::Sender::new(None),
            kills: Arc::clone(&self.deafness.kills),
        })
    }
    fn set_exit_code(&self, code: ExitCode) {
        self.inner.set_exit_code(code);
    }
    fn publish_env(&self, name: &str, value: &str) {
        self.inner.publish_env(name, value);
    }
}
