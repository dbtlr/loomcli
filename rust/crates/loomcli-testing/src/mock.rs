//! The mock process: a process handle with recording streams and no machine facts.

use std::collections::{BTreeMap, VecDeque};
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::pin::pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::Poll;
use std::time::Duration;

use loomcli_core::{
    Background, BoxFuture, Build, Child, ChildExit, ChildOutput, ChildProcess, ChildStream, Env,
    ExitCode, InputStream, InputTerminal, KillSignal, Libc, OutputStream, OutputTerminal,
    ProcessHandle, ProcessSignal, ProcessTerminal, ReleaseFacts, SignalEvent, SignalListener,
    SignalSource, SpawnRequest,
};
use tokio::sync::{Notify, watch};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

/// The default working directory, a path that does not exist, so no file is found by accident.
const DEFAULT_CWD: &str = "/loom-test";
/// The default home folder, a path that does not exist.
pub(crate) const DEFAULT_HOME: &str = "/loom-test/home";
/// The platform the default mock describes.
pub(crate) const DEFAULT_PLATFORM: &str = "linux";
/// The Cargo target triple the default mock describes.
const DEFAULT_RUNTIME: &str = "x86_64-unknown-linux-gnu";
/// The default temporary folder, a path that does not exist.
const DEFAULT_TMPDIR: &str = "/loom-test/tmp";
/// The default `program` words: a runtime and a script that do not exist.
const DEFAULT_PROGRAM: [&str; 2] = ["/loom-test/runtime", "/loom-test/app.js"];
/// The default user id, an ordinary account's.
const DEFAULT_UID: u32 = 1000;

/// The opening of core's background query, OSC 11 asking for the background color.
const BACKGROUND_QUERY: &str = "\u{1b}]11;?";
/// A Primary Device Attributes reply with no background before it, as a terminal that reports none
/// sends.
const ATTRIBUTES_ALONE: &str = "\u{1b}[?1;2c";
/// The time between an array entry's reads, twice the prompts reader's lone-Escape window.
const LATER_READ: Duration = Duration::from_millis(100);
/// The sentence a raw-mode switch with no entry left fails the keyboard's read with.
const NO_KEYS_LEFT: &str =
    "mockProcess has no keys left for this read. Add an entry to terminal.keys.";

/// A lock a panic elsewhere left poisoned still guards plain data, so it is taken as it is.
fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A child program call the mock process received, as the script for its command receives it.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct ProgramCall {
    /// The program, as the run's spawn named it.
    pub command: String,
    /// Its arguments.
    pub args: Vec<String>,
    /// Its working directory, as core filled it.
    pub cwd: PathBuf,
    /// Its environment, as core filled it.
    pub env: Env,
    /// What the spawn wrote to the child's stdin, or the mock's piped stdin under an inherited
    /// stdin, decoded as UTF-8; empty for a keyboard and for a detached child.
    pub input: String,
    /// Whether the child was started detached.
    pub detached: bool,
    /// Cancelled when the child is ended, by the spawn's signal or a kill of an ending signal.
    pub signal: CancellationToken,
}

/// What a fake program answers: its exit code, 0 by default, and its output, empty by default.
#[derive(Clone, Debug, Default)]
#[must_use]
pub struct ProgramAnswer {
    pub(crate) code: i32,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

impl ProgramAnswer {
    /// Exit 0 with no output.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the exit status.
    pub fn code(self, code: i32) -> Self {
        Self { code, ..self }
    }

    /// Sets its stdout, text or bytes.
    pub fn stdout(self, bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            stdout: bytes.into(),
            ..self
        }
    }

    /// Sets its stderr, text or bytes.
    pub fn stderr(self, bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            stderr: bytes.into(),
            ..self
        }
    }
}

/// A fake program the mock process runs in place of a real child: an `Err` stands for a program
/// that could not start. The mock wraps it in its own [`ChildProcess`]: the script runs after
/// `spawn` returns, `exited` resolves after it answers, and an ending signal ends the child at once
/// with code 128 plus that signal's number and no output, whatever the script answers later.
pub type Program =
    Arc<dyn Fn(ProgramCall) -> BoxFuture<'static, io::Result<ProgramAnswer>> + Send + Sync>;

/// The output streams a mock terminal can hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamName {
    /// Stdout.
    Stdout,
    /// Stderr.
    Stderr,
}

/// One entry of a keyboard's keys: what the operator types while one reader holds the keyboard,
/// as one read or several. A string is one read; [`KeyEntry::reads`] makes several, each handed
/// over 100 milliseconds after stdin emitted the one before it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyEntry(Vec<String>);

impl KeyEntry {
    /// An entry of several reads, in order.
    pub fn reads(reads: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self(reads.into_iter().map(Into::into).collect())
    }
}

impl From<&str> for KeyEntry {
    fn from(read: &str) -> Self {
        Self(vec![read.to_owned()])
    }
}

impl From<String> for KeyEntry {
    fn from(read: String) -> Self {
        Self(vec![read])
    }
}

impl<const N: usize> From<[&str; N]> for KeyEntry {
    fn from(reads: [&str; N]) -> Self {
        Self::reads(reads)
    }
}

/// A terminal the mock's streams sit on: `columns` wide and `rows` high, holding stdout and stderr
/// unless [`MockTerminal::streams`] names others, stating a background or not, and with a keyboard
/// for stdin when [`MockTerminal::keys`] gives one.
#[derive(Clone, Debug)]
#[must_use]
pub struct MockTerminal {
    pub(crate) columns: u16,
    pub(crate) rows: u16,
    pub(crate) background: Option<Background>,
    pub(crate) streams: Vec<StreamName>,
    pub(crate) keys: Option<Vec<KeyEntry>>,
}

impl MockTerminal {
    /// A terminal of this size holding stdout and stderr, with no stated background and no keyboard.
    pub fn new(columns: u16, rows: u16) -> Self {
        Self {
            columns,
            rows,
            background: None,
            streams: vec![StreamName::Stdout, StreamName::Stderr],
            keys: None,
        }
    }

    /// Puts only these output streams on the terminal; a stream left out reads as piped.
    pub fn streams(self, streams: impl IntoIterator<Item = StreamName>) -> Self {
        Self {
            streams: streams.into_iter().collect(),
            ..self
        }
    }

    /// States the background, which settles the run's, so no query runs.
    pub fn background(self, background: Background) -> Self {
        Self {
            background: Some(background),
            ..self
        }
    }

    /// Puts stdin on the terminal as its keyboard, the mock signal source's own terminal. It hands
    /// over one entry each time a reader switches it into raw mode through
    /// [`InputStream::set_raw_mode`], at that reader's first read, unless the reader wrote core's
    /// background query to the terminal first, which the keyboard answers with the device
    /// attributes reply alone and no entry. A switch with no entry left fails the read with
    /// `mockProcess has no keys left for this read. Add an entry to terminal.keys.` An empty list is
    /// a keyboard with nothing typed.
    pub fn keys(self, keys: impl IntoIterator<Item = impl Into<KeyEntry>>) -> Self {
        Self {
            keys: Some(keys.into_iter().map(Into::into).collect()),
            ..self
        }
    }
}

/// A supplied working directory: a path, or a read that answers it.
#[derive(Clone)]
enum MockCwd {
    Path(PathBuf),
    Read(Arc<dyn Fn() -> io::Result<PathBuf> + Send + Sync>),
}

/// The facts a mock process reports. Every fact has a fixed default, so a test reads nothing from
/// the machine: argv empty, env empty, cwd `/loom-test`, home `/loom-test/home` and tmpdir
/// `/loom-test/tmp` unless an absolute `HOME` or `TMPDIR` in env names others, platform `linux`,
/// arch `x64`, runtime `x86_64-unknown-linux-gnu`, libc glibc on Linux, uid 1000, time zone `UTC`,
/// program `/loom-test/runtime /loom-test/app.js`, a `source` build, no source reader, empty piped
/// stdin, no terminal, and no programs. A supplied field replaces its default whole.
#[derive(Clone, Default)]
#[must_use]
pub struct MockFields {
    pub(crate) argv: Vec<String>,
    pub(crate) env: Env,
    cwd: Option<MockCwd>,
    ceiling: Option<PathBuf>,
    pub(crate) home: Option<PathBuf>,
    pub(crate) tmpdir: Option<PathBuf>,
    pub(crate) platform: Option<String>,
    pub(crate) arch: Option<String>,
    runtime: Option<Option<String>>,
    pub(crate) libc: Option<Option<Libc>>,
    pub(crate) uid: Option<Option<u32>>,
    pub(crate) time_zone: Option<String>,
    pub(crate) program: Option<Vec<String>>,
    pub(crate) read_source: Option<loomcli_core::ReadSource>,
    pub(crate) stdin: Option<Vec<u8>>,
    pub(crate) terminal: Option<MockTerminal>,
    pub(crate) release: Option<ReleaseFacts>,
    pub(crate) programs: BTreeMap<String, Program>,
}

impl MockFields {
    /// The defaults.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets argv.
    pub fn argv(self, argv: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            argv: argv.into_iter().map(Into::into).collect(),
            ..self
        }
    }

    /// Sets one environment variable of the environment, which is empty by default.
    pub fn env(mut self, name: &str, value: &str) -> Self {
        self.env.insert(name.to_owned(), value.to_owned());
        self
    }

    /// Sets the working directory. Give an absolute path: a relative one reaches the file system
    /// relative to the test process's own working directory.
    pub fn cwd(self, cwd: impl Into<PathBuf>) -> Self {
        Self {
            cwd: Some(MockCwd::Path(cwd.into())),
            ..self
        }
    }

    /// Stands `read` in for the working directory read, which may fail, so a test reaches the
    /// unreadable working directory.
    pub fn cwd_with(self, read: impl Fn() -> io::Result<PathBuf> + Send + Sync + 'static) -> Self {
        Self {
            cwd: Some(MockCwd::Read(Arc::new(read))),
            ..self
        }
    }

    /// Sets the project configuration walk's ceiling. The default uses the working directory,
    /// calling a stated `cwd_with` reader again when the handle is asked for its ceiling.
    pub fn ceiling(mut self, path: impl Into<PathBuf>) -> Self {
        self.ceiling = Some(path.into());
        self
    }

    /// Sets the home folder, which wins over `HOME` in the environment.
    pub fn home(self, home: impl Into<PathBuf>) -> Self {
        Self {
            home: Some(home.into()),
            ..self
        }
    }

    /// Sets the temporary folder, which wins over `TMPDIR` in the environment.
    pub fn tmpdir(self, tmpdir: impl Into<PathBuf>) -> Self {
        Self {
            tmpdir: Some(tmpdir.into()),
            ..self
        }
    }

    /// Sets the platform, in the reference's spelling.
    pub fn platform(self, platform: impl Into<String>) -> Self {
        Self {
            platform: Some(platform.into()),
            ..self
        }
    }

    /// Sets the architecture, in the reference's spelling.
    pub fn arch(self, arch: impl Into<String>) -> Self {
        Self {
            arch: Some(arch.into()),
            ..self
        }
    }

    /// Sets the Cargo target triple. `None` reports no runtime fact.
    pub fn runtime(self, runtime: Option<String>) -> Self {
        Self {
            runtime: Some(runtime),
            ..self
        }
    }

    /// Sets the C library.
    pub fn libc(self, libc: Option<Libc>) -> Self {
        Self {
            libc: Some(libc),
            ..self
        }
    }

    /// Sets the user id.
    pub fn uid(self, uid: Option<u32>) -> Self {
        Self {
            uid: Some(uid),
            ..self
        }
    }

    /// Sets the IANA time zone.
    pub fn time_zone(self, time_zone: impl Into<String>) -> Self {
        Self {
            time_zone: Some(time_zone.into()),
            ..self
        }
    }

    /// Sets the program words argv omits.
    pub fn program(self, program: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            program: Some(program.into_iter().map(Into::into).collect()),
            ..self
        }
    }

    /// Sets the source reader a development build's defect excerpt uses.
    pub fn read_source(
        self,
        read_source: impl Fn(&str, &str) -> Option<String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            read_source: Some(Arc::new(read_source)),
            ..self
        }
    }

    /// Pipes `bytes` to stdin: the stream yields them once over the mock's life, unchanged, then
    /// ends. A mock takes piped stdin or a keyboard, never both.
    pub fn stdin(self, bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            stdin: Some(bytes.into()),
            ..self
        }
    }

    /// Puts the mock's streams on a terminal.
    pub fn terminal(self, terminal: MockTerminal) -> Self {
        Self {
            terminal: Some(terminal),
            ..self
        }
    }

    /// Sets the release facts, taken as given.
    pub fn release(self, release: ReleaseFacts) -> Self {
        Self {
            release: Some(release),
            ..self
        }
    }

    /// Answers spawns of exactly `command`, with no `PATH` lookup, with a fake program: the
    /// reference's `programs` entry. `git` and `/usr/bin/git` are two scripts.
    pub fn script<F, A>(mut self, command: &str, script: F) -> Self
    where
        F: Fn(ProgramCall) -> A + Send + Sync + 'static,
        A: Future<Output = io::Result<ProgramAnswer>> + Send + 'static,
    {
        let program: Program = Arc::new(move |call| Box::pin(script(call)));
        self.programs.insert(command.to_owned(), program);
        self
    }
}

/// One write the run made, tagged by stream, in the order of [`MockProcess::transcript`].
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Write {
    /// Bytes written to stdout, decoded as UTF-8.
    Stdout(String),
    /// Bytes written to stderr, decoded as UTF-8.
    Stderr(String),
}

/// What the mock recorded, shared by its streams, its signal source, and its exit code.
#[derive(Default)]
struct Record {
    ended: Option<ProcessSignal>,
    transcript: Vec<Write>,
    stdout: String,
    stderr: String,
    exit_code: Option<ExitCode>,
}

/// A mock process handle. After a run, its recorded output and exit code are read back.
///
/// The file system stays outside the handle, as the reference leaves it: a test that needs files
/// writes them to a temporary directory and points `cwd` there.
pub struct MockProcess {
    argv: Vec<String>,
    env: Env,
    cwd: MockCwd,
    ceiling: Option<PathBuf>,
    home: PathBuf,
    tmpdir: PathBuf,
    platform: String,
    arch: String,
    runtime: Option<String>,
    libc: Option<Libc>,
    uid: Option<u32>,
    time_zone: String,
    program: Vec<String>,
    read_source: Option<loomcli_core::ReadSource>,
    release: ReleaseFacts,
    programs: BTreeMap<String, Program>,
    record: Arc<Mutex<Record>>,
    stdin: Arc<dyn InputStream>,
    stdin_text: String,
    keyboard: Option<Arc<Keyboard>>,
    stdout: Arc<Recorder>,
    stderr: Arc<Recorder>,
    terminal: Arc<TerminalFacts>,
    signals: Arc<MockSignals>,
    calls: Mutex<Vec<ProgramCall>>,
}

/// A mock process with these facts.
///
/// # Panics
///
/// When the fields give both piped stdin and a keyboard, because a run's stdin is one or the other.
#[must_use]
#[track_caller]
pub fn mock_process(fields: MockFields) -> Arc<MockProcess> {
    let keys = fields
        .terminal
        .as_ref()
        .and_then(|terminal| terminal.keys.clone());
    assert!(
        fields.stdin.is_none() || keys.is_none(),
        "mockProcess takes piped stdin or a terminal's keys, not both: a run's stdin is one or the other."
    );
    let record = Arc::new(Mutex::new(Record::default()));
    let keyboard = keys.map(|keys| Arc::new(Keyboard::new(keys)));
    let on_terminal = |name: StreamName| {
        fields
            .terminal
            .as_ref()
            .is_some_and(|terminal| terminal.streams.contains(&name))
    };
    let hearing = |name: StreamName| {
        keyboard
            .as_ref()
            .filter(|_| on_terminal(name))
            .map(Arc::clone)
    };
    let stdout = Arc::new(Recorder::new(
        StreamName::Stdout,
        Arc::clone(&record),
        hearing(StreamName::Stdout),
    ));
    let stderr = Arc::new(Recorder::new(
        StreamName::Stderr,
        Arc::clone(&record),
        hearing(StreamName::Stderr),
    ));
    let stdin_bytes = fields.stdin.clone().unwrap_or_default();
    let stdin: Arc<dyn InputStream> = match &keyboard {
        Some(keyboard) => Arc::clone(keyboard) as Arc<dyn InputStream>,
        None => Arc::new(Piped::new(stdin_bytes.clone())),
    };
    let terminal = Arc::new(TerminalFacts {
        size: Mutex::new(
            fields
                .terminal
                .as_ref()
                .map(|terminal| (terminal.columns, terminal.rows)),
        ),
        stdout: on_terminal(StreamName::Stdout),
        stderr: on_terminal(StreamName::Stderr),
        keyboard: keyboard.is_some(),
        background: fields
            .terminal
            .as_ref()
            .and_then(|terminal| terminal.background),
    });
    let signals = Arc::new(MockSignals {
        record: Arc::clone(&record),
        terminal: keyboard.is_some().then(|| Arc::clone(&stdin)),
        listeners: Mutex::new(Registry::default()),
    });
    let platform = fields
        .platform
        .unwrap_or_else(|| DEFAULT_PLATFORM.to_owned());
    let absolute = |name: &str| {
        fields
            .env
            .get(name)
            .filter(|value| Path::new(value).is_absolute())
            .map(PathBuf::from)
    };
    Arc::new(MockProcess {
        home: fields
            .home
            .or_else(|| absolute("HOME"))
            .unwrap_or_else(|| PathBuf::from(DEFAULT_HOME)),
        tmpdir: fields
            .tmpdir
            .or_else(|| absolute("TMPDIR"))
            .unwrap_or_else(|| PathBuf::from(DEFAULT_TMPDIR)),
        libc: fields
            .libc
            .unwrap_or_else(|| (platform == "linux").then_some(Libc::Glibc)),
        platform,
        argv: fields.argv,
        env: fields.env,
        ceiling: fields.ceiling,
        cwd: fields
            .cwd
            .unwrap_or_else(|| MockCwd::Path(PathBuf::from(DEFAULT_CWD))),
        arch: fields.arch.unwrap_or_else(|| "x64".to_owned()),
        runtime: fields
            .runtime
            .unwrap_or_else(|| Some(DEFAULT_RUNTIME.to_owned())),
        uid: fields.uid.unwrap_or(Some(DEFAULT_UID)),
        time_zone: fields.time_zone.unwrap_or_else(|| "UTC".to_owned()),
        program: fields
            .program
            .unwrap_or_else(|| DEFAULT_PROGRAM.map(str::to_owned).to_vec()),
        read_source: fields.read_source,
        release: fields
            .release
            .unwrap_or_else(|| ReleaseFacts::new(Build::Source)),
        programs: fields.programs,
        record,
        stdin,
        stdin_text: String::from_utf8_lossy(&stdin_bytes).into_owned(),
        keyboard,
        stdout,
        stderr,
        terminal,
        signals,
        calls: Mutex::new(Vec::new()),
    })
}

impl MockProcess {
    /// What the run wrote to stdout, decoded as UTF-8.
    #[must_use]
    pub fn stdout_text(&self) -> String {
        locked(&self.record).stdout.clone()
    }

    /// What the run wrote to stderr, decoded as UTF-8.
    #[must_use]
    pub fn stderr_text(&self) -> String {
        locked(&self.record).stderr.clone()
    }

    /// Every write the run made, in order, tagged by stream, for a test of interleaving.
    #[must_use]
    pub fn transcript(&self) -> Vec<Write> {
        locked(&self.record).transcript.clone()
    }

    /// The exit code the run recorded; `None` until a run writes one.
    #[must_use]
    pub fn exit_code(&self) -> Option<ExitCode> {
        locked(&self.record).exit_code
    }

    /// The ending signal that ended the mock's process: one raised while nothing listened, as the
    /// re-raise that ends a shutdown is. After it, the mock delivers no signal and records no write
    /// and no exit status.
    #[must_use]
    pub fn ended_by(&self) -> Option<ProcessSignal> {
        locked(&self.record).ended
    }

    /// Whether a reader holds the keyboard in raw mode; `false` for piped stdin.
    #[must_use]
    pub fn is_raw(&self) -> bool {
        self.keyboard
            .as_ref()
            .is_some_and(|keyboard| keyboard.is_raw())
    }

    /// Delivers a signal to the runs that hold the mock, as the terminal would.
    pub fn raise(&self, signal: ProcessSignal) {
        self.signals.raise(signal);
    }

    /// How many listeners the mock's signal source holds for `event` now, which shows whether core
    /// listens for it.
    #[must_use]
    pub fn listeners(&self, event: SignalEvent) -> usize {
        locked(&self.signals.listeners)
            .held
            .iter()
            .filter(|(_, listening, _)| *listening == event)
            .count()
    }

    /// Changes the width and height the next terminal read returns, as a window resize does. A
    /// mock with no terminal still reports no size.
    pub fn resize(&self, columns: u16, rows: u16) {
        let mut size = locked(&self.terminal.size);
        if size.is_some() {
            *size = Some((columns, rows));
        }
    }

    /// Ends both recording streams, flushing a character the last write left incomplete as a
    /// replacement character, as a stream's end does.
    pub fn end_output(&self) {
        self.stdout.end();
        self.stderr.end();
    }

    /// The child programs the run started, in order.
    #[must_use]
    pub fn calls(&self) -> Vec<ProgramCall> {
        locked(&self.calls).clone()
    }
}

impl ProcessHandle for MockProcess {
    fn argv(&self) -> Vec<String> {
        self.argv.clone()
    }
    fn program(&self) -> Vec<String> {
        self.program.clone()
    }
    fn env(&self) -> Env {
        self.env.clone()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        match &self.cwd {
            MockCwd::Path(path) => Ok(path.clone()),
            MockCwd::Read(read) => read(),
        }
    }
    fn ceiling(&self) -> io::Result<Option<PathBuf>> {
        match &self.ceiling {
            Some(path) => Ok(Some(path.clone())),
            None => self.cwd().map(Some),
        }
    }
    fn home(&self) -> PathBuf {
        self.home.clone()
    }
    fn tmpdir(&self) -> PathBuf {
        self.tmpdir.clone()
    }
    fn platform(&self) -> String {
        self.platform.clone()
    }
    fn arch(&self) -> String {
        self.arch.clone()
    }
    fn runtime(&self) -> Option<String> {
        self.runtime.clone()
    }
    fn libc(&self) -> Option<Libc> {
        self.libc
    }
    fn uid(&self) -> Option<u32> {
        self.uid
    }
    fn time_zone(&self) -> String {
        self.time_zone.clone()
    }
    fn release(&self) -> ReleaseFacts {
        self.release.clone()
    }
    fn read_source(&self, path: &str, cwd: &str) -> Option<String> {
        self.read_source.as_ref().and_then(|read| read(path, cwd))
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        Arc::clone(&self.stdin)
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        Arc::clone(&self.stdout) as Arc<dyn OutputStream>
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        Arc::clone(&self.stderr) as Arc<dyn OutputStream>
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        Arc::clone(&self.terminal) as Arc<dyn ProcessTerminal>
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        Arc::clone(&self.signals) as Arc<dyn SignalSource>
    }

    /// Answers the spawn with the script `programs` holds under exactly `request.command`.
    ///
    /// # Panics
    ///
    /// For a command with no script, naming it, so a test learns of the missing script at once:
    /// `mockProcess has no program for "git". Add a "git" entry to programs.`
    fn spawn(&self, request: SpawnRequest) -> Child {
        let Some(program) = self.programs.get(&request.command).map(Arc::clone) else {
            panic!(
                "mockProcess has no program for \"{0}\". Add a \"{0}\" entry to programs.",
                request.command
            );
        };
        let end = Arc::new(ChildEnd::new());
        let input = match &request.attached {
            None => String::new(),
            Some(options) if options.inherits_stdin() => self.stdin_text.clone(),
            Some(options) => {
                String::from_utf8_lossy(options.stdin_input().unwrap_or_default()).into_owned()
            }
        };
        let call = ProgramCall {
            command: request.command.clone(),
            args: request.args.clone(),
            cwd: request.cwd.clone(),
            env: request.env.clone(),
            input,
            detached: request.attached.is_none(),
            signal: end.ending.clone(),
        };
        locked(&self.calls).push(call.clone());
        let runtime = tokio::runtime::Handle::try_current().unwrap_or_else(|_| {
            panic!("mockProcess runs a program script inside a tokio runtime.")
        });
        let outputs = request.attached.as_ref().map(|options| {
            (
                options.stdout_stream().clone(),
                options.stderr_stream().clone(),
            )
        });
        let cancellation = request
            .attached
            .as_ref()
            .and_then(|options| options.cancellation().cloned());
        // A signal already cancelled ends the child before its script runs, whatever it answers.
        if cancellation
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
        {
            end.end(KillSignal::Signal(ProcessSignal::Term));
        }
        if let Some(signal) = cancellation.clone() {
            let end = Arc::clone(&end);
            runtime.spawn(async move {
                if end
                    .finished
                    .run_until_cancelled(signal.cancelled())
                    .await
                    .is_some()
                {
                    end.end(KillSignal::Signal(ProcessSignal::Term));
                }
            });
        }
        let own = (Arc::clone(&self.stdout), Arc::clone(&self.stderr));
        let script = Arc::clone(&end);
        runtime.spawn(async move {
            let ending = script.ending.clone();
            let cancelled = async {
                match &cancellation {
                    Some(signal) => signal.cancelled().await,
                    None => std::future::pending().await,
                }
            };
            let mut cancelled = pin!(cancelled);
            // An abandoned script keeps running after the spawn's signal fires, so the signal is
            // polled only until it has fired once: a finished `async` block cannot be polled again.
            let mut cancel_seen = false;
            let mut answer = pin!(program(call));
            let mut ended = pin!(ending.cancelled());
            let answered = std::future::poll_fn(|context| {
                // The spawn's signal wins over an answer ready at the same moment, on any worker.
                if !cancel_seen && cancelled.as_mut().poll(context).is_ready() {
                    cancel_seen = true;
                    script.end(KillSignal::Signal(ProcessSignal::Term));
                    if !script.is_abandoned() {
                        return Poll::Ready(None);
                    }
                }
                if let Poll::Ready(answer) = answer.as_mut().poll(context) {
                    return Poll::Ready(Some(answer));
                }
                if ended.as_mut().poll(context).is_ready() && !script.is_abandoned() {
                    return Poll::Ready(None);
                }
                Poll::Pending
            })
            .await;
            script.finished.cancel();
            match answered {
                None => {}
                Some(Err(error)) => script.settle(ChildExit::Unstarted {
                    error: Arc::new(error),
                }),
                Some(Ok(answer)) => {
                    if script.is_settled() {
                        return;
                    }
                    let _ = script
                        .abandoned
                        .run_until_cancelled(async {
                            let (stdout, stderr) = match outputs {
                                None => (ChildOutput::default(), ChildOutput::default()),
                                Some((stdout, stderr)) => (
                                    deliver(&stdout, answer.stdout, &own.0).await,
                                    deliver(&stderr, answer.stderr, &own.1).await,
                                ),
                            };
                            script.settle(ChildExit::Exited {
                                code: answer.code,
                                stdout,
                                stderr,
                            });
                        })
                        .await;
                }
            }
        });
        Child::new(MockChild { end })
    }

    fn set_exit_code(&self, code: ExitCode) {
        let mut record = locked(&self.record);
        if record.ended.is_none() {
            record.exit_code = Some(code);
        }
    }
}

/// Delivers one stream of a script's answer where the spawn sent it: held in the exit when
/// captured, written to the mock's own stream when inherited, written to a stream, or dropped.
async fn deliver(choice: &ChildStream, bytes: Vec<u8>, own: &Arc<Recorder>) -> ChildOutput {
    match choice {
        ChildStream::Capture => ChildOutput::new(bytes),
        ChildStream::Inherit if !bytes.is_empty() => {
            let _ = own.write(&bytes).await;
            ChildOutput::default()
        }
        ChildStream::Stream(stream) if !bytes.is_empty() => {
            let _ = stream.write(&bytes).await;
            ChildOutput::default()
        }
        _ => ChildOutput::default(),
    }
}

/// The exit a scripted child reports and the signals its still-running script can observe.
struct ChildEnd {
    ending: CancellationToken,
    finished: CancellationToken,
    abandoned: CancellationToken,
    exit: watch::Sender<Option<ChildExit>>,
}

impl ChildEnd {
    fn new() -> Self {
        Self {
            ending: CancellationToken::new(),
            finished: CancellationToken::new(),
            abandoned: CancellationToken::new(),
            exit: watch::Sender::new(None),
        }
    }

    fn is_settled(&self) -> bool {
        self.exit.borrow().is_some()
    }

    fn is_abandoned(&self) -> bool {
        matches!(&*self.exit.borrow(), Some(ChildExit::Abandoned { .. }))
    }

    fn settle(&self, exit: ChildExit) {
        self.exit.send_if_modified(|held| {
            if held.is_some() {
                return false;
            }
            *held = Some(exit);
            true
        });
    }

    /// Ends the child for an ending signal; `SIGTSTP` and `SIGCONT` end nothing.
    fn end(&self, signal: KillSignal) {
        if !signal.ends() {
            return;
        }
        self.exit.send_if_modified(|exit| {
            if matches!(exit, Some(ChildExit::Abandoned { .. })) && !self.finished.is_cancelled() {
                self.ending.cancel();
            }
            if exit.is_some() {
                return false;
            }
            self.ending.cancel();
            *exit = Some(ChildExit::Exited {
                code: signal.ended_code(),
                stdout: ChildOutput::default(),
                stderr: ChildOutput::default(),
            });
            true
        });
    }

    fn abandon(&self) {
        self.exit.send_if_modified(|exit| {
            if exit.is_some() {
                return false;
            }
            self.abandoned.cancel();
            *exit = Some(ChildExit::Abandoned {
                stdout: ChildOutput::default(),
                stderr: ChildOutput::default(),
            });
            true
        });
    }
}

/// The child a script stands for.
struct MockChild {
    end: Arc<ChildEnd>,
}

impl ChildProcess for MockChild {
    fn exited(&self) -> BoxFuture<'_, ChildExit> {
        let mut exit = self.end.exit.subscribe();
        Box::pin(async move {
            let settled = match exit.wait_for(Option::is_some).await {
                Ok(settled) => settled.clone(),
                Err(_) => None,
            };
            settled.unwrap_or_else(|| ChildExit::Unstarted {
                error: Arc::new(io::Error::other("The mock's child ended without an exit.")),
            })
        })
    }

    fn kill(&self, signal: KillSignal) {
        self.end.end(signal);
    }

    fn abandon(&self) {
        self.end.abandon();
    }
}

/// A recording stream: decodes what it receives as UTF-8, a character split across writes
/// included, and records each write unless the mock ended. A stream on a keyboard's terminal lets
/// the keyboard hear what the run wrote.
struct Recorder {
    name: StreamName,
    record: Arc<Mutex<Record>>,
    pending: Mutex<Vec<u8>>,
    hearing: Option<Arc<Keyboard>>,
}

impl Recorder {
    fn new(name: StreamName, record: Arc<Mutex<Record>>, hearing: Option<Arc<Keyboard>>) -> Self {
        Self {
            name,
            record,
            pending: Mutex::new(Vec::new()),
            hearing,
        }
    }

    /// Records decoded text as one write of this stream, unless the mock ended.
    fn keep(&self, text: &str) -> bool {
        if text.is_empty() {
            return false;
        }
        let mut record = locked(&self.record);
        if record.ended.is_some() {
            return false;
        }
        match self.name {
            StreamName::Stdout => {
                record.stdout.push_str(text);
                record.transcript.push(Write::Stdout(text.to_owned()));
            }
            StreamName::Stderr => {
                record.stderr.push_str(text);
                record.transcript.push(Write::Stderr(text.to_owned()));
            }
        }
        true
    }

    /// Flushes a character the last write left incomplete.
    fn end(&self) {
        let pending = std::mem::take(&mut *locked(&self.pending));
        if !pending.is_empty() {
            self.keep("\u{fffd}");
        }
    }
}

impl OutputStream for Recorder {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        Box::pin(async move {
            if locked(&self.record).ended.is_some() {
                return Ok(());
            }
            let text = {
                let mut pending = locked(&self.pending);
                pending.extend_from_slice(bytes);
                decode_complete(&mut pending)
            };
            if self.keep(&text) {
                if let Some(keyboard) = &self.hearing {
                    keyboard.hear(&text);
                }
            }
            Ok(())
        })
    }
}

/// The text `pending` holds up to an incomplete character at its end, which stays pending; an
/// invalid sequence decodes as a replacement character.
fn decode_complete(pending: &mut Vec<u8>) -> String {
    let mut text = String::new();
    let mut at = 0;
    loop {
        match std::str::from_utf8(&pending[at..]) {
            Ok(valid) => {
                text.push_str(valid);
                at = pending.len();
                break;
            }
            Err(error) => {
                let valid = at + error.valid_up_to();
                text.push_str(&String::from_utf8_lossy(&pending[at..valid]));
                match error.error_len() {
                    Some(length) => {
                        text.push('\u{fffd}');
                        at = valid + length;
                    }
                    None => {
                        at = valid;
                        break;
                    }
                }
            }
        }
    }
    pending.drain(..at);
    text
}

/// The mock's piped stdin: the bytes once, unchanged, then the end. Never a terminal.
pub(crate) struct Piped {
    remaining: Mutex<VecDeque<u8>>,
}

impl Piped {
    pub(crate) fn new(bytes: Vec<u8>) -> Self {
        Self {
            remaining: Mutex::new(bytes.into()),
        }
    }
}

impl InputStream for Piped {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            let mut remaining = locked(&self.remaining);
            let count = buffer.len().min(remaining.len());
            for (slot, byte) in buffer.iter_mut().zip(remaining.drain(..count)) {
                *slot = byte;
            }
            Ok(count)
        })
    }

    fn unshift(&self, bytes: &[u8]) {
        let mut remaining = locked(&self.remaining);
        for byte in bytes.iter().rev() {
            remaining.push_front(*byte);
        }
    }
}

/// The terminal facts over the mock's streams: on the terminal reads the live size, off it none.
struct TerminalFacts {
    size: Mutex<Option<(u16, u16)>>,
    stdout: bool,
    stderr: bool,
    keyboard: bool,
    background: Option<Background>,
}

impl TerminalFacts {
    fn output(&self, on: bool) -> OutputTerminal {
        match *locked(&self.size) {
            Some((columns, rows)) if on => OutputTerminal::new(true, Some(columns), Some(rows)),
            _ => OutputTerminal::new(false, None, None),
        }
    }
}

impl ProcessTerminal for TerminalFacts {
    fn stdin(&self) -> InputTerminal {
        InputTerminal::new(self.keyboard)
    }
    fn stdout(&self) -> OutputTerminal {
        self.output(self.stdout)
    }
    fn stderr(&self) -> OutputTerminal {
        self.output(self.stderr)
    }
    fn background(&self) -> Option<Background> {
        self.background
    }
}

/// A signal source of the mock's own, which ends the mock on an ending signal nobody listens for.
/// Its terminal is the keyboard when the mock has one.
struct MockSignals {
    record: Arc<Mutex<Record>>,
    terminal: Option<Arc<dyn InputStream>>,
    listeners: Mutex<Registry>,
}

/// The listeners a signal source holds, each with its id and event, and the next id.
#[derive(Default)]
struct Registry {
    next: u64,
    held: Vec<(u64, SignalEvent, SignalListener)>,
}

impl SignalSource for MockSignals {
    fn on(&self, event: SignalEvent, listener: SignalListener) -> u64 {
        let mut listeners = locked(&self.listeners);
        let id = listeners.next;
        listeners.next += 1;
        listeners.held.push((id, event, listener));
        id
    }

    fn off(&self, id: u64) {
        locked(&self.listeners)
            .held
            .retain(|(held, _, _)| *held != id);
    }

    fn raise(&self, signal: ProcessSignal) {
        if locked(&self.record).ended.is_some() {
            return;
        }
        // A copy, so a listener added during this raise waits for the next one.
        let heard: Vec<SignalListener> = locked(&self.listeners)
            .held
            .iter()
            .filter(|(_, event, _)| *event == SignalEvent::Signal(signal))
            .map(|(_, _, listener)| Arc::clone(listener))
            .collect();
        if heard.is_empty() {
            if KillSignal::Signal(signal).ends() {
                locked(&self.record).ended = Some(signal);
            }
            return;
        }
        for listener in heard {
            listener(None);
        }
    }

    fn terminal(&self) -> Option<Arc<dyn InputStream>> {
        self.terminal.clone()
    }
}

/// The terminal's keyboard.
///
/// Each switch into raw mode begins a hold, whose entry the keyboard hands over at the hold's first
/// read: the attributes reply alone when the reader wrote core's background query first, else the
/// next entry's first read, or the no-keys error when none is left. An entry's later reads follow,
/// each 100 milliseconds after stdin emitted the one before it. A switch out of raw mode, or into
/// it again, ends the entry in hand. The keyboard never ends.
struct Keyboard {
    state: Mutex<KeyState>,
    wake: Notify,
}

struct KeyState {
    entries: VecDeque<KeyEntry>,
    raw: bool,
    handed: bool,
    asked: bool,
    buffer: VecDeque<Vec<u8>>,
    later: VecDeque<String>,
    next_at: Option<Instant>,
}

/// What a keyboard read does next.
enum Step {
    Read(usize),
    Fail(io::Error),
    Again,
    Until(Instant),
    Wait,
}

impl Keyboard {
    fn new(keys: Vec<KeyEntry>) -> Self {
        Self {
            state: Mutex::new(KeyState {
                entries: keys.into(),
                raw: false,
                handed: true,
                asked: false,
                buffer: VecDeque::new(),
                later: VecDeque::new(),
                next_at: None,
            }),
            wake: Notify::new(),
        }
    }

    /// Hears text the run wrote to the terminal, and notes the background query.
    fn hear(&self, text: &str) {
        let mut state = locked(&self.state);
        if state.raw && text.contains(BACKGROUND_QUERY) {
            state.asked = true;
        }
    }

    /// One step of a read into `buffer`.
    fn step(&self, buffer: &mut [u8]) -> Step {
        let mut state = locked(&self.state);
        if let Some(chunk) = state.buffer.front_mut() {
            let count = buffer.len().min(chunk.len());
            buffer[..count].copy_from_slice(&chunk[..count]);
            chunk.drain(..count);
            if chunk.is_empty() {
                state.buffer.pop_front();
                if !state.later.is_empty() {
                    state.next_at = Some(Instant::now() + LATER_READ);
                }
            }
            return Step::Read(count);
        }
        if !state.raw {
            return Step::Wait;
        }
        if !state.handed {
            state.handed = true;
            if state.asked {
                state.buffer.push_back(ATTRIBUTES_ALONE.as_bytes().to_vec());
                return Step::Again;
            }
            let Some(KeyEntry(reads)) = state.entries.pop_front() else {
                return Step::Fail(io::Error::other(NO_KEYS_LEFT));
            };
            let mut reads: VecDeque<String> = reads.into();
            if let Some(first) = reads.pop_front() {
                state.buffer.push_back(first.into_bytes());
            }
            state.later = reads;
            return Step::Again;
        }
        if state.later.is_empty() {
            return Step::Wait;
        }
        match state.next_at {
            Some(due) if due > Instant::now() => Step::Until(due),
            _ => {
                if let Some(read) = state.later.pop_front() {
                    state.buffer.push_back(read.into_bytes());
                }
                Step::Again
            }
        }
    }
}

impl InputStream for Keyboard {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            if buffer.is_empty() {
                return Ok(0);
            }
            loop {
                let mut woken = pin!(self.wake.notified());
                woken.as_mut().enable();
                match self.step(buffer) {
                    Step::Read(count) => return Ok(count),
                    Step::Fail(error) => return Err(error),
                    Step::Again => {}
                    Step::Wait => woken.await,
                    Step::Until(due) => {
                        let mut due = pin!(tokio::time::sleep_until(due));
                        std::future::poll_fn(|context| {
                            if woken.as_mut().poll(context).is_ready()
                                || due.as_mut().poll(context).is_ready()
                            {
                                Poll::Ready(())
                            } else {
                                Poll::Pending
                            }
                        })
                        .await;
                    }
                }
            }
        })
    }

    fn set_raw_mode(&self, on: bool) -> io::Result<()> {
        let mut state = locked(&self.state);
        let switched = on && !state.raw;
        state.raw = on;
        if !on || switched {
            state.later.clear();
            state.next_at = None;
        }
        if switched {
            state.handed = false;
            state.asked = false;
        }
        drop(state);
        self.wake.notify_waiters();
        Ok(())
    }

    fn is_raw(&self) -> bool {
        locked(&self.state).raw
    }

    /// Pushes `bytes` back ahead of every byte not yet read, in or out of raw mode.
    fn unshift(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        locked(&self.state).buffer.push_front(bytes.to_vec());
        self.wake.notify_waiters();
    }
}
