//! A mock process with its own destinations: a stream that refuses writes from a position on, a
//! stream that reports each completed write, and terminal facts the mock's one screen cannot state.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::VecDeque;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_core::{
    Background, BoxFuture, Child, DirectoryFacts, Env, ExitCode, InputStream, InputTerminal, Libc,
    OutputStream, OutputTerminal, ProcessHandle, ProcessSignal, ProcessTerminal, ReleaseFacts,
    SignalEvent, SignalListener, SignalSource, SpawnRequest,
};
use loomcli_testing::MockProcess;

/// One write a scripted stream saw: delivered, or refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Seen {
    Wrote(String),
    Refused(String),
}

/// A stream that delivers its first `accepted` writes and refuses every later one with `kind`,
/// recording each, in order, into a shared log the test reads.
pub struct Scripted {
    accepted: Option<usize>,
    kind: io::ErrorKind,
    delay: Option<Duration>,
    log: Arc<Mutex<Vec<Seen>>>,
    writes: Mutex<usize>,
}

impl Scripted {
    /// A stream that refuses from write `accepted + 1` on with `kind`.
    pub fn refusing(accepted: usize, kind: io::ErrorKind, log: Arc<Mutex<Vec<Seen>>>) -> Arc<Self> {
        Arc::new(Self {
            accepted: Some(accepted),
            kind,
            delay: None,
            log,
            writes: Mutex::new(0),
        })
    }

    /// A stream that accepts every write after `delay`, logging it as it completes.
    pub fn slow(delay: Duration, log: Arc<Mutex<Vec<Seen>>>) -> Arc<Self> {
        Arc::new(Self {
            accepted: None,
            kind: io::ErrorKind::Other,
            delay: Some(delay),
            log,
            writes: Mutex::new(0),
        })
    }
}

impl OutputStream for Scripted {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        Box::pin(async move {
            if let Some(delay) = self.delay {
                tokio::time::sleep(delay).await;
            }
            let text = String::from_utf8_lossy(bytes).into_owned();
            let position = {
                let mut writes = self.writes.lock().unwrap();
                *writes += 1;
                *writes
            };
            if self.accepted.is_some_and(|accepted| position > accepted) {
                self.log.lock().unwrap().push(Seen::Refused(text));
                return Err(io::Error::new(self.kind, format!("write {:?}", self.kind)));
            }
            self.log.lock().unwrap().push(Seen::Wrote(text));
            Ok(())
        })
    }
}

/// Fixed terminal facts for each stream.
pub struct Facts {
    pub stdin: bool,
    pub stdout: OutputTerminal,
    pub stderr: OutputTerminal,
    pub stated: Option<Background>,
}

impl ProcessTerminal for Facts {
    fn stdin(&self) -> InputTerminal {
        InputTerminal::new(self.stdin)
    }
    fn stdout(&self) -> OutputTerminal {
        self.stdout
    }
    fn stderr(&self) -> OutputTerminal {
        self.stderr
    }
    fn background(&self) -> Option<Background> {
        self.stated
    }
}

/// The mock with some of its parts replaced.
pub struct Swapped {
    pub mock: Arc<MockProcess>,
    pub stdout: Option<Arc<dyn OutputStream>>,
    pub stderr: Option<Arc<dyn OutputStream>>,
    pub stdin: Option<Arc<dyn InputStream>>,
    pub terminal: Option<Arc<dyn ProcessTerminal>>,
    pub signals: Option<Arc<dyn SignalSource>>,
    /// Whether `signals` answers a new `Arc` around the source on each call, which nothing but the
    /// caller holds.
    pub fresh_signals: bool,
}

impl Swapped {
    pub fn new(mock: Arc<MockProcess>) -> Self {
        Self {
            mock,
            stdout: None,
            stderr: None,
            stdin: None,
            terminal: None,
            signals: None,
            fresh_signals: false,
        }
    }
}

/// A signal source that forwards every call to another, as a wrapper a handle builds per call.
struct Forwarding(Arc<dyn SignalSource>);

impl SignalSource for Forwarding {
    fn on(&self, event: SignalEvent, listener: SignalListener) -> u64 {
        self.0.on(event, listener)
    }
    fn off(&self, id: u64) {
        self.0.off(id);
    }
    fn raise(&self, signal: ProcessSignal) {
        self.0.raise(signal);
    }
    fn terminal(&self) -> Option<Arc<dyn InputStream>> {
        self.0.terminal()
    }
}

impl ProcessHandle for Swapped {
    fn argv(&self) -> Vec<String> {
        self.mock.argv()
    }
    fn program(&self) -> Vec<String> {
        self.mock.program()
    }
    fn env(&self) -> Env {
        self.mock.env()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.mock.cwd()
    }
    fn home(&self) -> PathBuf {
        self.mock.home()
    }
    fn tmpdir(&self) -> PathBuf {
        self.mock.tmpdir()
    }
    fn platform(&self) -> String {
        self.mock.platform()
    }
    fn arch(&self) -> String {
        self.mock.arch()
    }
    fn libc(&self) -> Option<Libc> {
        self.mock.libc()
    }
    fn uid(&self) -> Option<u32> {
        self.mock.uid()
    }
    fn time_zone(&self) -> String {
        self.mock.time_zone()
    }
    fn release(&self) -> ReleaseFacts {
        self.mock.release()
    }
    fn release_for(&self, application: &str, directories: &DirectoryFacts) -> ReleaseFacts {
        self.mock.release_for(application, directories)
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        self.stdin.clone().unwrap_or_else(|| self.mock.stdin())
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        self.stdout.clone().unwrap_or_else(|| self.mock.stdout())
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        self.stderr.clone().unwrap_or_else(|| self.mock.stderr())
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        self.terminal
            .clone()
            .unwrap_or_else(|| self.mock.terminal())
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        let source = self.signals.clone().unwrap_or_else(|| self.mock.signals());
        if self.fresh_signals {
            return Arc::new(Forwarding(source));
        }
        source
    }
    fn spawn(&self, request: SpawnRequest) -> Child {
        self.mock.spawn(request)
    }
    fn set_exit_code(&self, code: ExitCode) {
        self.mock.set_exit_code(code);
    }
}

/// A terminal stdin a test scripts: it answers its chunks in order and then waits, and records each
/// raw-mode switch and the bytes pushed back onto it.
#[derive(Default)]
pub struct Keys {
    pub raw: Mutex<bool>,
    pub switches: Mutex<Vec<bool>>,
    pub chunks: Mutex<VecDeque<Vec<u8>>>,
    pub pushed: Mutex<Vec<u8>>,
    pub refuses_raw: bool,
}

impl Keys {
    /// A stdin that answers these chunks, one per read.
    pub fn typing(chunks: &[&str]) -> Arc<Self> {
        Arc::new(Self {
            chunks: Mutex::new(
                chunks
                    .iter()
                    .map(|chunk| chunk.as_bytes().to_vec())
                    .collect(),
            ),
            ..Self::default()
        })
    }
}

impl InputStream for Keys {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            let chunk = self.chunks.lock().unwrap().pop_front();
            match chunk {
                Some(chunk) => {
                    buffer[..chunk.len()].copy_from_slice(&chunk);
                    Ok(chunk.len())
                }
                None => std::future::pending().await,
            }
        })
    }
    fn set_raw_mode(&self, on: bool) -> io::Result<()> {
        if self.refuses_raw {
            return Err(io::Error::from(io::ErrorKind::Unsupported));
        }
        *self.raw.lock().unwrap() = on;
        self.switches.lock().unwrap().push(on);
        Ok(())
    }
    fn is_raw(&self) -> bool {
        *self.raw.lock().unwrap()
    }
    fn unshift(&self, bytes: &[u8]) {
        self.pushed
            .lock()
            .unwrap()
            .splice(0..0, bytes.iter().copied());
    }
}
