//! The process handle, the host a run reads, child programs, and interrupt keys.
//!
//! Everything a run reads from or writes to the process goes through one [`ProcessHandle`]. Core
//! captures the [`Host`] from it once per run; `loomcli-testing` supplies a mock handle, so a test
//! never reads the real environment, terminal, clock, or home folder.

mod background;
pub(crate) mod capture;
mod keys;
pub(crate) mod real;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use crate::failures::ExitCode;
use crate::marks::Background;
use crate::shipping::{DirectoryFacts, ReleaseFacts};
use crate::support::BoxFuture;

// The run lifecycle captures the host, asks the terminal its background, and dispatches the exit
// event through these.
#[allow(unused_imports)]
pub(crate) use background::{QueryRun, ask_terminal};
#[allow(unused_imports)]
pub(crate) use capture::{HostCapture, OwnStreams, RunStreams, capture_host, capture_parts};
pub use keys::raise_interrupt_keys;
#[allow(unused_imports)]
pub(crate) use real::process_exiting;

/// The environment: variable names and their values.
pub type Env = BTreeMap<String, String>;

/// A stream a run writes to: stdout, stderr, or a captured child stream.
pub trait OutputStream: Send + Sync + 'static {
    /// Writes all of `bytes`. A closed reader reports `BrokenPipe`.
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>>;
}

/// A stream a run reads: stdin.
///
/// A terminal stdin also switches raw mode, the reference's `setRawMode` and `isRaw`. Every raw-mode
/// switch in core and in `loomcli-prompts` goes through these methods, the background query, a
/// question, and the resume after Ctrl-Z included, so a mock keyboard sees each switch.
pub trait InputStream: Send + Sync + 'static {
    /// Reads into `buffer`, returning how many bytes it filled; 0 at the end of the stream.
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>>;

    /// Switches raw mode on or off. A stream that has no raw mode, such as a pipe, answers
    /// `ErrorKind::Unsupported`, which skips the background query and fails a question.
    #[allow(unused_variables)]
    fn set_raw_mode(&self, on: bool) -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::Unsupported))
    }

    /// Whether a reader holds the stream in raw mode; `false` for a stream with no raw mode.
    fn is_raw(&self) -> bool {
        false
    }

    /// Whether the process is a background job of the terminal this stream reads, which a raw-mode
    /// switch or a read would stop with `SIGTTOU` or `SIGTTIN`. The real process's terminal stdin
    /// compares the process group with the terminal's foreground group, and a check that cannot
    /// tell answers `true`. Any other stream, such as a pipe or a test's scripted keyboard, is under
    /// no job control and answers `false`, so the background query skips the check for it.
    fn in_background_job(&self) -> bool {
        false
    }

    /// Pushes `bytes` back onto the front of the stream, ahead of anything not yet read, so the
    /// next read answers them first: the reference's `unshift`. The background query pushes back
    /// the keys typed during its wait, so the action's own read gets them. A stream with no raw
    /// mode, which the query never reads, may keep this default, which drops the bytes.
    fn unshift(&self, bytes: &[u8]) {
        let _ = bytes;
    }
}

/// Facts about an input terminal.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct InputTerminal {
    /// Whether the stream is a terminal.
    pub is_tty: bool,
}

impl InputTerminal {
    /// The facts of a stream that is, or is not, a terminal, for a process handle to report.
    #[must_use]
    pub const fn new(is_tty: bool) -> Self {
        Self { is_tty }
    }
}

/// Facts about an output terminal, read at the moment they are asked for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct OutputTerminal {
    /// Whether the stream is a terminal.
    pub is_tty: bool,
    /// The width in columns, when the stream is a terminal that reports one.
    pub columns: Option<u16>,
    /// The height in rows, when the stream is a terminal that reports one.
    pub rows: Option<u16>,
}

impl OutputTerminal {
    /// The facts of a stream, for a process handle to report. A zero width or height reads as
    /// `None`, as the reference reads a missing or zero reading.
    #[must_use]
    pub const fn new(is_tty: bool, columns: Option<u16>, rows: Option<u16>) -> Self {
        Self {
            is_tty,
            columns: nonzero(columns),
            rows: nonzero(rows),
        }
    }
}

/// A terminal dimension as a stream reports it: a zero reading is unavailable.
const fn nonzero(reading: Option<u16>) -> Option<u16> {
    match reading {
        Some(0) => None,
        other => other,
    }
}

/// The terminal facts a process handle reports. Widths are read live, at each call.
pub trait ProcessTerminal: Send + Sync + 'static {
    /// Stdin's terminal facts.
    fn stdin(&self) -> InputTerminal;
    /// Stdout's terminal facts, read now.
    fn stdout(&self) -> OutputTerminal;
    /// Stderr's terminal facts, read now.
    fn stderr(&self) -> OutputTerminal;
    /// A background the handle states, which settles the run's background with no query.
    fn background(&self) -> Option<Background> {
        None
    }
}

/// A signal the process can receive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProcessSignal {
    /// `SIGHUP`.
    Hup,
    /// `SIGINT`.
    Int,
    /// `SIGQUIT`.
    Quit,
    /// `SIGTERM`.
    Term,
    /// `SIGTSTP`.
    Tstp,
    /// `SIGCONT`.
    Cont,
}

/// What a signal listener listens for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignalEvent {
    /// A process signal.
    Signal(ProcessSignal),
    /// The process exiting, with its status.
    Exit,
}

/// A signal listener. It receives the exit status for [`SignalEvent::Exit`] and `None` otherwise.
pub type SignalListener = Arc<dyn Fn(Option<i32>) + Send + Sync>;

/// Where a run's process signals come from, injectable for tests.
pub trait SignalSource: Send + Sync + 'static {
    /// Adds a listener and returns its id.
    fn on(&self, event: SignalEvent, listener: SignalListener) -> u64;
    /// Removes the listener with this id.
    fn off(&self, id: u64);
    /// Delivers `signal` to this source's process.
    fn raise(&self, signal: ProcessSignal);
    /// The stdin of the terminal this process is attached to, for raw-mode readers; it switches raw
    /// mode through [`InputStream::set_raw_mode`].
    fn terminal(&self) -> Option<Arc<dyn InputStream>>;
}

/// The C library a Linux process links, when the platform has one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Libc {
    /// glibc.
    Glibc,
    /// musl.
    Musl,
}

/// Where a child program's output stream goes.
#[derive(Clone)]
#[non_exhaustive]
pub enum ChildStream {
    /// Captured into the [`ChildExit`].
    Capture,
    /// Discarded.
    Ignore,
    /// Shared with this process.
    Inherit,
    /// Written to a stream.
    Stream(Arc<dyn OutputStream>),
}

/// How to start a child program that stays attached to the run.
#[derive(Clone)]
#[must_use]
pub struct SpawnOptions {
    pub(crate) cwd: Option<PathBuf>,
    pub(crate) env: Option<Env>,
    pub(crate) stdout: ChildStream,
    pub(crate) stderr: ChildStream,
    pub(crate) signal: Option<CancellationToken>,
    pub(crate) input: Option<Vec<u8>>,
    pub(crate) inherit_stdin: bool,
}

impl SpawnOptions {
    /// Attached options: the run's working directory and environment, output captured, no input.
    pub fn new() -> Self {
        Self {
            cwd: None,
            env: None,
            stdout: ChildStream::Capture,
            stderr: ChildStream::Capture,
            signal: None,
            input: None,
            inherit_stdin: false,
        }
    }

    /// Sets the working directory; a relative one resolves against the run's.
    pub fn cwd(self, cwd: impl Into<PathBuf>) -> Self {
        Self {
            cwd: Some(cwd.into()),
            ..self
        }
    }

    /// Sets the environment the child sees, replacing the run's whole.
    pub fn env(self, env: Env) -> Self {
        Self {
            env: Some(env),
            ..self
        }
    }

    /// Sets where the child's stdout goes.
    pub fn stdout(self, stream: ChildStream) -> Self {
        Self {
            stdout: stream,
            ..self
        }
    }

    /// Sets where the child's stderr goes.
    pub fn stderr(self, stream: ChildStream) -> Self {
        Self {
            stderr: stream,
            ..self
        }
    }

    /// Ends the child with `SIGTERM` when `signal` is cancelled, at once when it already is.
    pub fn signal(self, signal: CancellationToken) -> Self {
        Self {
            signal: Some(signal),
            ..self
        }
    }

    /// Writes `input` to the child's stdin and closes it. Replaces [`SpawnOptions::inherit_stdin`].
    pub fn input(self, input: impl Into<Vec<u8>>) -> Self {
        Self {
            input: Some(input.into()),
            inherit_stdin: false,
            ..self
        }
    }

    /// Shares the run's stdin with the child. Replaces [`SpawnOptions::input`].
    pub fn inherit_stdin(self) -> Self {
        Self {
            input: None,
            inherit_stdin: true,
            ..self
        }
    }

    /// Starts the child detached from the run instead: no streams, no signal, and it outlives the run.
    pub fn detached(self) -> DetachedSpawnOptions {
        DetachedSpawnOptions {
            cwd: self.cwd,
            env: self.env,
        }
    }

    /// Where the child's stdout goes.
    #[must_use]
    pub fn stdout_stream(&self) -> &ChildStream {
        &self.stdout
    }

    /// Where the child's stderr goes.
    #[must_use]
    pub fn stderr_stream(&self) -> &ChildStream {
        &self.stderr
    }

    /// The signal whose cancellation ends the child, if any.
    #[must_use]
    pub fn cancellation(&self) -> Option<&CancellationToken> {
        self.signal.as_ref()
    }

    /// What the child reads on stdin, when the options give it input.
    #[must_use]
    pub fn stdin_input(&self) -> Option<&[u8]> {
        self.input.as_deref()
    }

    /// Whether the child reads the run's own stdin.
    #[must_use]
    pub fn inherits_stdin(&self) -> bool {
        self.inherit_stdin
    }
}

impl Default for SpawnOptions {
    fn default() -> Self {
        Self::new()
    }
}

/// How to start a child program detached from the run. Only the working directory and the
/// environment apply, so the type offers no stream or signal setter.
#[derive(Clone)]
#[must_use]
pub struct DetachedSpawnOptions {
    pub(crate) cwd: Option<PathBuf>,
    pub(crate) env: Option<Env>,
}

impl DetachedSpawnOptions {
    /// Detached options: the run's working directory and environment.
    pub fn new() -> Self {
        SpawnOptions::new().detached()
    }

    /// Sets the working directory; a relative one resolves against the run's.
    pub fn cwd(self, cwd: impl Into<PathBuf>) -> Self {
        Self {
            cwd: Some(cwd.into()),
            ..self
        }
    }

    /// Sets the environment the child sees, replacing the run's whole.
    pub fn env(self, env: Env) -> Self {
        Self {
            env: Some(env),
            ..self
        }
    }
}

impl Default for DetachedSpawnOptions {
    fn default() -> Self {
        Self::new()
    }
}

/// A spawn request as the process handle receives it: core has filled the working directory and
/// the environment from the run when the caller left them out.
#[derive(Clone)]
#[non_exhaustive]
pub struct SpawnRequest {
    /// The program.
    pub command: String,
    /// Its arguments.
    pub args: Vec<String>,
    /// The working directory.
    pub cwd: PathBuf,
    /// The environment.
    pub env: Env,
    /// The attached options, or `None` for a detached child.
    pub attached: Option<SpawnOptions>,
}

impl SpawnRequest {
    /// A request for an attached child, as core sends it: the place filled and the options mapped.
    pub fn attached(
        command: impl Into<String>,
        args: impl IntoIterator<Item = impl Into<String>>,
        cwd: impl Into<PathBuf>,
        env: Env,
        options: SpawnOptions,
    ) -> Self {
        Self {
            command: command.into(),
            args: args.into_iter().map(Into::into).collect(),
            cwd: cwd.into(),
            env,
            attached: Some(options),
        }
    }

    /// A request for a detached child: its place, and no streams, input, or signal.
    pub fn detached(
        command: impl Into<String>,
        args: impl IntoIterator<Item = impl Into<String>>,
        cwd: impl Into<PathBuf>,
        env: Env,
    ) -> Self {
        Self {
            command: command.into(),
            args: args.into_iter().map(Into::into).collect(),
            cwd: cwd.into(),
            env,
            attached: None,
        }
    }
}

/// A child program's captured output.
#[derive(Clone, Debug, Default)]
#[non_exhaustive]
pub struct ChildOutput {
    /// The bytes it wrote.
    pub bytes: Vec<u8>,
    /// The bytes decoded as UTF-8, with replacement characters for invalid sequences.
    pub text: String,
}

impl ChildOutput {
    /// The output of these bytes, with `text` decoded from them, for a process handle to report.
    #[must_use]
    pub fn new(bytes: Vec<u8>) -> Self {
        let text = String::from_utf8_lossy(&bytes).into_owned();
        Self { bytes, text }
    }
}

/// How a child program ended.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub enum ChildExit {
    /// It started and exited with a status.
    Exited {
        /// The exit status.
        code: i32,
        /// Its stdout, when captured.
        stdout: ChildOutput,
        /// Its stderr, when captured.
        stderr: ChildOutput,
    },
    /// It never started.
    Unstarted {
        /// Why it did not start.
        error: Arc<io::Error>,
    },
}

/// A signal a run can send to its child.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KillSignal {
    /// A process signal.
    Signal(ProcessSignal),
    /// `SIGKILL`.
    Kill,
}

/// A child program as a process handle runs it: the real handle's wraps a `tokio::process::Child`,
/// and a mock's runs a script. A handle implements it and returns it from
/// [`ProcessHandle::spawn`] inside a [`Child`].
pub trait ChildProcess: Send + Sync + 'static {
    /// Resolves when the child exits, or at once when it never started. Called once.
    fn exited(&self) -> BoxFuture<'_, ChildExit>;

    /// Sends `signal` to the child. An ending signal on a child that already exited does nothing.
    fn kill(&self, signal: KillSignal);
}

/// A child program a run started.
pub struct Child {
    pub(crate) process: Box<dyn ChildProcess>,
}

impl Child {
    /// A child backed by a handle's own [`ChildProcess`].
    pub fn new(process: impl ChildProcess) -> Self {
        Self {
            process: Box::new(process),
        }
    }

    /// A child that never started, for `error`: `exited` answers [`ChildExit::Unstarted`] at once.
    #[must_use]
    pub fn unstarted(error: io::Error) -> Self {
        Self::new(Unstarted(Arc::new(error)))
    }

    /// Resolves once the child has ended and its streams have closed, or at once when it never
    /// started. It never fails.
    pub async fn exited(&self) -> ChildExit {
        self.process.exited().await
    }

    /// Sends `signal` to the child, such as one the run forwards, or [`KillSignal::Kill`], which no
    /// child can handle. It does nothing once the child has exited.
    pub fn kill(&self, signal: KillSignal) {
        self.process.kill(signal);
    }
}

/// The child process of a child that never started.
struct Unstarted(Arc<io::Error>);

impl ChildProcess for Unstarted {
    fn exited(&self) -> BoxFuture<'_, ChildExit> {
        let error = Arc::clone(&self.0);
        Box::pin(async move { ChildExit::Unstarted { error } })
    }

    fn kill(&self, _signal: KillSignal) {}
}

impl ProcessSignal {
    /// The signal's number on this platform.
    #[must_use]
    pub fn number(self) -> i32 {
        real::signal_number(self)
    }
}

impl KillSignal {
    /// The status a shell reports for a process this signal ended: 128 plus its number, such as
    /// 143 for `SIGTERM` and 137 for `SIGKILL`.
    #[must_use]
    pub fn ended_code(self) -> i32 {
        match self {
            KillSignal::Signal(signal) => 128 + signal.number(),
            KillSignal::Kill => 128 + real::KILL_NUMBER,
        }
    }

    /// Whether the signal's default action ends a process: every signal but `SIGTSTP` and
    /// `SIGCONT`.
    #[must_use]
    pub fn ends(self) -> bool {
        !matches!(
            self,
            KillSignal::Signal(ProcessSignal::Tstp | ProcessSignal::Cont)
        )
    }
}

/// Everything a run reads from or writes to its process. The real process's handle comes from
/// [`process_handle`]; `loomcli-testing` supplies a mock.
pub trait ProcessHandle: Send + Sync + 'static {
    /// The words after the program, as the operator typed them.
    fn argv(&self) -> Vec<String>;
    /// The program words argv omits.
    fn program(&self) -> Vec<String>;
    /// The environment.
    fn env(&self) -> Env;
    /// The working directory; an error when it cannot be read.
    fn cwd(&self) -> io::Result<PathBuf>;
    /// The operator's home folder.
    fn home(&self) -> PathBuf;
    /// The folder for temporary files.
    fn tmpdir(&self) -> PathBuf;
    /// The platform, in the reference's spelling (`linux`, `darwin`, `win32`).
    fn platform(&self) -> String;
    /// The CPU architecture, in the reference's spelling (`x64`, `arm64`).
    fn arch(&self) -> String;
    /// The C library, on Linux.
    fn libc(&self) -> Option<Libc>;
    /// The user id, on Unix.
    fn uid(&self) -> Option<u32>;
    /// The IANA time zone name.
    fn time_zone(&self) -> String;
    /// How this copy was built.
    fn release(&self) -> ReleaseFacts;
    /// How this copy was built, as a run of `application` captures it: `release()`, with the
    /// installation the record holds where the handle reads one. The real process's handle, given
    /// no `release`, reads the record under `directories` for a compiled binary's release; any
    /// other handle's facts are taken as given.
    #[allow(unused_variables)]
    fn release_for(&self, application: &str, directories: &DirectoryFacts) -> ReleaseFacts {
        self.release()
    }
    /// Reads an author source file for a development build's defect excerpt.
    #[allow(unused_variables)]
    fn read_source(&self, path: &str, cwd: &str) -> Option<String> {
        None
    }
    /// Stdin.
    fn stdin(&self) -> Arc<dyn InputStream>;
    /// Stdout.
    fn stdout(&self) -> Arc<dyn OutputStream>;
    /// Stderr.
    fn stderr(&self) -> Arc<dyn OutputStream>;
    /// The terminal facts.
    fn terminal(&self) -> Arc<dyn ProcessTerminal>;
    /// The signal source. Runs share one lane, and so one shutdown, when their handles answer the
    /// same `Arc`; a handle that builds a new source on each call gives each run a lane of its own.
    /// A run holds the source it read until it resolves, so its listeners go and its re-raise
    /// reaches the source however briefly the handle kept it.
    fn signals(&self) -> Arc<dyn SignalSource>;
    /// Starts a child program, answering with the handle's own [`ChildProcess`] wrapped in
    /// [`Child::new`]. A child that cannot start answers [`ChildExit::Unstarted`] from `exited`.
    fn spawn(&self, request: SpawnRequest) -> Child;
    /// Records the exit code the run resolved: the one member core writes. A mock records it for
    /// the test to read; the real process's handle writes nothing, because the process exits with
    /// the code `main` returns, the one `run` resolves.
    fn set_exit_code(&self, code: ExitCode);
    /// Publishes an environment variable an environment hook added, where the handle allows it.
    #[allow(unused_variables)]
    fn publish_env(&self, name: &str, value: &str) {}
}

/// Fields that replace the real process's own in [`process_handle`]: every member of the handle but
/// the signal source, `spawn`, the exit code, and `publish_env`, as the reference's `ProcessFields`
/// allows.
#[derive(Clone, Default)]
#[must_use]
pub struct ProcessFields {
    pub(crate) argv: Option<Vec<String>>,
    pub(crate) program: Option<Vec<String>>,
    pub(crate) env: Option<Env>,
    pub(crate) cwd: Option<CwdField>,
    pub(crate) home: Option<PathBuf>,
    pub(crate) tmpdir: Option<PathBuf>,
    pub(crate) platform: Option<String>,
    pub(crate) arch: Option<String>,
    pub(crate) libc: Option<Option<Libc>>,
    pub(crate) uid: Option<Option<u32>>,
    pub(crate) time_zone: Option<String>,
    pub(crate) read_source: Option<ReadSource>,
    pub(crate) stdout: Option<Arc<dyn OutputStream>>,
    pub(crate) stderr: Option<Arc<dyn OutputStream>>,
    pub(crate) stdin: Option<Arc<dyn InputStream>>,
    pub(crate) terminal: Option<Arc<dyn ProcessTerminal>>,
    pub(crate) release: Option<ReleaseFacts>,
}

/// A replacement for [`ProcessHandle::read_source`]: `(path, cwd)` to the file's text.
pub type ReadSource = Arc<dyn Fn(&str, &str) -> Option<String> + Send + Sync>;

/// A replacement for the working directory read: `Ok` with the directory, or the error the read
/// raises, such as the one a removed directory raises.
pub type ReadCwd = Arc<dyn Fn() -> io::Result<PathBuf> + Send + Sync>;

/// A supplied working directory: a path, or a read that answers it.
#[derive(Clone)]
pub(crate) enum CwdField {
    /// An absolute path is the directory; a relative one resolves against the process's at each read.
    Path(PathBuf),
    /// A read that stands in for the process's, and may fail as it chooses.
    Read(ReadCwd),
}

impl ProcessFields {
    /// No replaced fields: the real process.
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces argv.
    pub fn argv(self, argv: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            argv: Some(argv.into_iter().map(Into::into).collect()),
            ..self
        }
    }

    /// Replaces the program words argv omits.
    pub fn program(self, program: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            program: Some(program.into_iter().map(Into::into).collect()),
            ..self
        }
    }

    /// Replaces the home folder, which then wins over `HOME` in the environment.
    pub fn home(self, home: impl Into<PathBuf>) -> Self {
        Self {
            home: Some(home.into()),
            ..self
        }
    }

    /// Replaces the temporary folder, which then wins over `TMPDIR` in the environment.
    pub fn tmpdir(self, tmpdir: impl Into<PathBuf>) -> Self {
        Self {
            tmpdir: Some(tmpdir.into()),
            ..self
        }
    }

    /// Replaces the platform, in the reference's spelling.
    pub fn platform(self, platform: impl Into<String>) -> Self {
        Self {
            platform: Some(platform.into()),
            ..self
        }
    }

    /// Replaces the architecture, in the reference's spelling.
    pub fn arch(self, arch: impl Into<String>) -> Self {
        Self {
            arch: Some(arch.into()),
            ..self
        }
    }

    /// Replaces the C library.
    pub fn libc(self, libc: Option<Libc>) -> Self {
        Self {
            libc: Some(libc),
            ..self
        }
    }

    /// Replaces the user id.
    pub fn uid(self, uid: Option<u32>) -> Self {
        Self {
            uid: Some(uid),
            ..self
        }
    }

    /// Replaces the IANA time zone.
    pub fn time_zone(self, time_zone: impl Into<String>) -> Self {
        Self {
            time_zone: Some(time_zone.into()),
            ..self
        }
    }

    /// Replaces the source reader a development build's defect excerpt uses.
    pub fn read_source(
        self,
        read_source: impl Fn(&str, &str) -> Option<String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            read_source: Some(Arc::new(read_source)),
            ..self
        }
    }

    /// Replaces the terminal facts, such as an embedding host's panel's width. They stay independent
    /// of the supplied streams.
    pub fn terminal(self, terminal: Arc<dyn ProcessTerminal>) -> Self {
        Self {
            terminal: Some(terminal),
            ..self
        }
    }

    /// Replaces the environment whole: it does not merge into the process's, and the home and
    /// temporary folders follow it. A handle given an environment publishes nothing.
    pub fn env(self, env: Env) -> Self {
        Self {
            env: Some(env),
            ..self
        }
    }

    /// Replaces the working directory. An absolute path is read with no failure; a relative one
    /// resolves against the process's working directory at each read, so it fails as the process's
    /// own read does once that directory is removed. A handle given a working directory publishes
    /// nothing.
    pub fn cwd(self, cwd: impl Into<PathBuf>) -> Self {
        Self {
            cwd: Some(CwdField::Path(cwd.into())),
            ..self
        }
    }

    /// Replaces the working directory read with `read`, which answers the directory or fails as it
    /// chooses, so a test reaches the unreadable working directory in-process.
    pub fn cwd_with(self, read: impl Fn() -> io::Result<PathBuf> + Send + Sync + 'static) -> Self {
        Self {
            cwd: Some(CwdField::Read(Arc::new(read))),
            ..self
        }
    }

    /// Replaces stdout.
    pub fn stdout(self, stream: Arc<dyn OutputStream>) -> Self {
        Self {
            stdout: Some(stream),
            ..self
        }
    }

    /// Replaces stderr.
    pub fn stderr(self, stream: Arc<dyn OutputStream>) -> Self {
        Self {
            stderr: Some(stream),
            ..self
        }
    }

    /// Replaces stdin.
    pub fn stdin(self, stream: Arc<dyn InputStream>) -> Self {
        Self {
            stdin: Some(stream),
            ..self
        }
    }

    /// Replaces the release facts, taken as given: no baked value and no installation record is read.
    pub fn release(self, release: ReleaseFacts) -> Self {
        Self {
            release: Some(release),
            ..self
        }
    }
}

/// The real process's handle, each supplied field replacing its own. This is the one place core
/// reads `std::env`, the real streams, and the real signals.
///
/// Each fact it was not given reads the process when it is asked for, so one handle reused across
/// runs reads current facts. `home` is the environment's absolute `HOME`, else the home
/// `/etc/passwd` lists for the process's user, else empty; `tmpdir` is the environment's absolute
/// `TMPDIR`, else `/tmp`. Every handle shares the real process's one signal source, starts real
/// children, and publishes environment additions only when it was given neither `env` nor `cwd`.
#[must_use]
pub fn process_handle(fields: ProcessFields) -> Arc<dyn ProcessHandle> {
    real::process_handle(fields)
}

/// Whether two streams are one: the same value behind both handles.
pub(crate) fn same_stream<T: ?Sized>(left: &Arc<T>, right: &Arc<T>) -> bool {
    std::ptr::addr_eq(Arc::as_ptr(left), Arc::as_ptr(right))
}

/// `base` joined with `path` and normalized lexically, `.` and `..` resolved, as a path resolves
/// against a working directory. An absolute `path` stands alone.
pub(crate) fn resolved(base: &Path, path: &Path) -> PathBuf {
    normalized(&base.join(path))
}

/// `path` normalized lexically, as Node's `path.normalize` does: repeated and trailing separators
/// collapse, `.` goes, and `..` removes the name before it. A `..` above the root of an absolute
/// path stays at the root; one at the start of a relative path is kept.
pub(crate) fn normalized(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match out.components().next_back() {
                Some(Component::Normal(_)) => {
                    out.pop();
                }
                Some(Component::RootDir | Component::Prefix(_)) => {}
                Some(Component::ParentDir | Component::CurDir) | None => out.push(".."),
            },
            other => out.push(other),
        }
    }
    out
}

/// The terminal facts a run captured, with live widths.
#[derive(Clone)]
#[non_exhaustive]
pub struct HostTerminal {
    /// The settled background, when one was stated or detected; `None` until the run settles it.
    pub background: Option<Background>,
    pub(crate) terminal: Arc<dyn ProcessTerminal>,
    /// Each stream's kind, copied once at capture, because a stream does not change kind mid-run.
    pub(crate) stdin_tty: bool,
    pub(crate) stdout_tty: bool,
    pub(crate) stderr_tty: bool,
}

impl HostTerminal {
    /// The facts over a handle's terminal, each stream's kind copied now and the background unsettled.
    pub(crate) fn captured(terminal: Arc<dyn ProcessTerminal>) -> Self {
        Self {
            background: None,
            stdin_tty: terminal.stdin().is_tty,
            stdout_tty: terminal.stdout().is_tty,
            stderr_tty: terminal.stderr().is_tty,
            terminal,
        }
    }

    /// Stdin's terminal facts.
    #[must_use]
    pub fn stdin(&self) -> InputTerminal {
        InputTerminal::new(self.stdin_tty)
    }

    /// Stdout's terminal facts: its kind as captured, its width and height read now.
    #[must_use]
    pub fn stdout(&self) -> OutputTerminal {
        let live = self.terminal.stdout();
        OutputTerminal::new(self.stdout_tty, live.columns, live.rows)
    }

    /// Stderr's terminal facts: its kind as captured, its width and height read now.
    #[must_use]
    pub fn stderr(&self) -> OutputTerminal {
        let live = self.terminal.stderr();
        OutputTerminal::new(self.stderr_tty, live.columns, live.rows)
    }

    /// The background the handle's terminal states, a source of the run's settled background.
    pub(crate) fn stated_background(&self) -> Option<Background> {
        self.terminal.background()
    }
}

/// An interrupt key a raw-mode reader raises as its signal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InterruptSignal {
    /// Ctrl-C.
    Int,
    /// Ctrl-\.
    Quit,
    /// Ctrl-Z.
    Tstp,
}

/// The host a run reads: what core captured from the process handle, once per run.
///
/// Core holds one `Arc<Host>` per run and hands that same `Arc` to the run's configuration source,
/// providers, middleware, and action, so `Arc::ptr_eq` tells two callbacks they serve one run.
#[derive(Clone)]
#[non_exhaustive]
pub struct Host {
    /// The words after the program.
    pub argv: Vec<String>,
    /// The program words argv omits.
    pub program: Vec<String>,
    /// The working directory.
    pub cwd: PathBuf,
    /// The environment, with environment hooks' additions merged.
    pub env: Env,
    /// The home folder.
    pub home: PathBuf,
    /// The temporary folder.
    pub tmpdir: PathBuf,
    /// The platform.
    pub platform: String,
    /// The architecture.
    pub arch: String,
    /// The C library, on Linux.
    pub libc: Option<Libc>,
    /// The user id, on Unix.
    pub uid: Option<u32>,
    /// The IANA time zone captured at the start of the run.
    pub time_zone: String,
    /// How this copy was built.
    pub release: ReleaseFacts,
    /// The terminal facts.
    pub terminal: HostTerminal,
    pub(crate) handle: Arc<dyn ProcessHandle>,
    pub(crate) signals: Arc<dyn SignalSource>,
    /// The run's streams: the handle's for an argv run, or the capture sinks under `invoke`.
    pub(crate) streams: RunStreams,
    /// The handle's own streams the run's may be, which `spawn` passes on as inherited.
    pub(crate) own: OwnStreams,
    /// Whether the capture read the working directory; `cwd` is empty when it could not.
    pub(crate) cwd_read: bool,
}

impl Host {
    /// Starts a child program through the run's process handle, with no shell, in the run's `cwd`
    /// and with its `env` unless the options name others; a relative `cwd` resolves against the
    /// run's. An inherited stream reaches the handle as inherited only when the run's stream is the
    /// handle's own, so under `invoke` the child writes to the capture sink, and a child that would
    /// inherit a stdin the run does not share reads an ended one. It returns the child at once.
    pub fn spawn(
        &self,
        command: &str,
        args: impl IntoIterator<Item = impl Into<String>>,
        options: SpawnOptions,
    ) -> Child {
        let Some(cwd) = self.child_directory(options.cwd.as_deref()) else {
            return Child::unstarted(unreadable_directory());
        };
        let env = options.env.clone().unwrap_or_else(|| self.env.clone());
        let stdout = self.mapped(
            options.stdout.clone(),
            &self.streams.stdout,
            self.own.stdout.as_ref(),
        );
        let stderr = self.mapped(
            options.stderr.clone(),
            &self.streams.stderr,
            self.own.stderr.as_ref(),
        );
        let shares_stdin = self
            .own
            .stdin
            .as_ref()
            .is_some_and(|own| same_stream(own, &self.streams.stdin));
        let attached = SpawnOptions {
            stdout,
            stderr,
            inherit_stdin: options.inherit_stdin && shares_stdin,
            ..options
        };
        self.handle.spawn(SpawnRequest {
            command: command.to_owned(),
            args: args.into_iter().map(Into::into).collect(),
            cwd,
            env,
            attached: Some(attached),
        })
    }

    /// Starts a detached child program: in a process group of its own, with every stream ignored,
    /// and nothing in the run ends it, so it outlives the run. On the real handle the child stays
    /// in the run's session and keeps its controlling terminal, because starting a new session
    /// needs `setsid` in the child, which only `unsafe` code can call.
    pub fn spawn_detached(
        &self,
        command: &str,
        args: impl IntoIterator<Item = impl Into<String>>,
        options: DetachedSpawnOptions,
    ) -> Child {
        let Some(cwd) = self.child_directory(options.cwd.as_deref()) else {
            return Child::unstarted(unreadable_directory());
        };
        self.handle.spawn(SpawnRequest {
            command: command.to_owned(),
            args: args.into_iter().map(Into::into).collect(),
            cwd,
            env: options.env.unwrap_or_else(|| self.env.clone()),
            attached: None,
        })
    }

    /// Raises an interrupt key's signal on the run's signal source and answers `true` when the run's
    /// stdin is that source's own terminal; otherwise it raises nothing and answers `false`, and the
    /// reader cancels the run itself.
    #[must_use]
    pub fn raise(&self, signal: InterruptSignal) -> bool {
        let Some(terminal) = self.signals.terminal() else {
            return false;
        };
        if !same_stream(&terminal, &self.streams.stdin) {
            return false;
        }
        self.signals.raise(match signal {
            InterruptSignal::Int => ProcessSignal::Int,
            InterruptSignal::Quit => ProcessSignal::Quit,
            InterruptSignal::Tstp => ProcessSignal::Tstp,
        });
        true
    }

    /// Reads an author source file, for a development build's defect excerpt, through the handle's
    /// reader with the run's working directory.
    #[must_use]
    pub fn read_source(&self, path: &str) -> Option<String> {
        self.handle.read_source(path, &self.cwd.to_string_lossy())
    }

    /// Stdin, for a raw-mode reader. An action reads piped input through a content input instead.
    #[must_use]
    pub fn stdin(&self) -> Arc<dyn InputStream> {
        Arc::clone(&self.streams.stdin)
    }

    /// The run's stdout: the handle's own, or the capture sink under `invoke`. A write that the
    /// closed pipe refuses follows the closed-pipe rule `out` follows: the run cancels with
    /// `ClosedPipe` and exits 141. A protocol server, such as the MCP plugin's, writes its messages
    /// here, past the lane views.
    #[must_use]
    pub fn stdout(&self) -> Arc<dyn OutputStream> {
        Arc::clone(&self.streams.stdout)
    }

    /// The run's stderr: the handle's own, or the capture sink under `invoke`.
    #[must_use]
    pub fn stderr(&self) -> Arc<dyn OutputStream> {
        Arc::clone(&self.streams.stderr)
    }

    /// The working directory a child runs in: the option when absolute, else resolved against the
    /// run's, or `None` when the capture could not read the run's.
    fn child_directory(&self, option: Option<&Path>) -> Option<PathBuf> {
        match option {
            Some(path) if path.is_absolute() => Some(resolved(Path::new("/"), path)),
            _ if !self.cwd_read => None,
            Some(path) => Some(resolved(&self.cwd, path)),
            None => Some(self.cwd.clone()),
        }
    }

    /// One output stream's choice as the handle receives it: `Inherit` only when the run's stream is
    /// the handle's own, and otherwise the run's stream itself.
    fn mapped(
        &self,
        choice: ChildStream,
        run: &Arc<dyn OutputStream>,
        own: Option<&Arc<dyn OutputStream>>,
    ) -> ChildStream {
        match choice {
            ChildStream::Inherit if own.is_some_and(|own| same_stream(own, run)) => {
                ChildStream::Inherit
            }
            ChildStream::Inherit => ChildStream::Stream(Arc::clone(run)),
            other => other,
        }
    }
}

/// The error a child of a run whose working directory could not be read never started with.
fn unreadable_directory() -> io::Error {
    io::Error::new(
        io::ErrorKind::NotFound,
        "The current working directory cannot be read.",
    )
}

/// What [`raise_interrupt_keys`] found in a raw-mode read.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct InterruptKeys {
    /// Which kind of signal the read raised, if any.
    pub raised: Option<InterruptRaised>,
    /// The text that remains after the interrupt keys, or empty once a signal was raised.
    pub rest: String,
}

/// The kind of signal an interrupt key raised.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InterruptRaised {
    /// Ctrl-C or Ctrl-\, which end the run.
    Ending,
    /// Ctrl-Z, which suspends it.
    Suspending,
}
