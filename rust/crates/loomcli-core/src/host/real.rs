//! The real process's handle: the one place core reads `std::env`, the real streams, the real
//! signals, and termios, and starts a real child program.

use std::collections::HashSet;
use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::watch;

use super::messages;
use super::{
    Child, ChildExit, ChildOutput, ChildProcess, ChildStream, CwdField, Env, InputStream,
    InputTerminal, KillSignal, Libc, OutputStream, OutputTerminal, ProcessFields, ProcessHandle,
    ProcessSignal, ProcessTerminal, SignalEvent, SignalListener, SignalSource, SpawnOptions,
    SpawnRequest, resolved, same_stream,
};
use crate::failures::ExitCode;
use crate::shipping::{DirectoryFacts, ReleaseFacts, absolute_variable, read_small_file};
use crate::support::BoxFuture;

/// `SIGKILL`'s number, the same on every Unix.
pub(crate) const KILL_NUMBER: i32 = 9;

/// The largest source file the real reader reads, 1 MiB.
const SOURCE_LIMIT: u64 = 1024 * 1024;

/// The folder for temporary files when the environment names none, on Linux and macOS alike.
const DEFAULT_TMPDIR: &str = "/tmp";

/// A lock that a panic elsewhere left poisoned still guards plain data, so it is taken as it is.
fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A process signal's number on this platform.
pub(crate) fn signal_number(signal: ProcessSignal) -> i32 {
    #[cfg(unix)]
    {
        use signal_hook::consts::signal::{SIGCONT, SIGHUP, SIGINT, SIGQUIT, SIGTERM, SIGTSTP};
        match signal {
            ProcessSignal::Hup => SIGHUP,
            ProcessSignal::Int => SIGINT,
            ProcessSignal::Quit => SIGQUIT,
            ProcessSignal::Term => SIGTERM,
            ProcessSignal::Tstp => SIGTSTP,
            ProcessSignal::Cont => SIGCONT,
        }
    }
    #[cfg(not(unix))]
    {
        match signal {
            ProcessSignal::Hup => 1,
            ProcessSignal::Int => 2,
            ProcessSignal::Quit => 3,
            ProcessSignal::Term => 15,
            ProcessSignal::Tstp => 20,
            ProcessSignal::Cont => 18,
        }
    }
}

/// The real process's handle, with the fields that replace its own.
struct RealProcess {
    fields: ProcessFields,
}

/// The real process's handle, each supplied field replacing its own.
pub(super) fn process_handle(fields: ProcessFields) -> Arc<dyn ProcessHandle> {
    Arc::new(RealProcess { fields })
}

impl ProcessHandle for RealProcess {
    fn argv(&self) -> Vec<String> {
        match &self.fields.argv {
            Some(argv) => argv.clone(),
            None => std::env::args_os()
                .skip(1)
                .map(|word| word.to_string_lossy().into_owned())
                .collect(),
        }
    }

    fn program(&self) -> Vec<String> {
        match &self.fields.program {
            Some(program) => program.clone(),
            None => vec![executable().to_string_lossy().into_owned()],
        }
    }

    fn env(&self) -> Env {
        match &self.fields.env {
            Some(env) => env.clone(),
            None => process_env(),
        }
    }

    fn cwd(&self) -> io::Result<PathBuf> {
        match &self.fields.cwd {
            Some(CwdField::Read(read)) => read(),
            Some(CwdField::Path(path)) if path.is_absolute() => Ok(path.clone()),
            Some(CwdField::Path(path)) => Ok(resolved(&std::env::current_dir()?, path)),
            None => std::env::current_dir(),
        }
    }

    fn home(&self) -> PathBuf {
        if let Some(home) = &self.fields.home {
            return home.clone();
        }
        match absolute_variable(&self.env(), "HOME") {
            Some(home) => PathBuf::from(home),
            None => database_home(),
        }
    }

    fn tmpdir(&self) -> PathBuf {
        if let Some(tmpdir) = &self.fields.tmpdir {
            return tmpdir.clone();
        }
        PathBuf::from(absolute_variable(&self.env(), "TMPDIR").unwrap_or(DEFAULT_TMPDIR))
    }

    fn platform(&self) -> String {
        match &self.fields.platform {
            Some(platform) => platform.clone(),
            None => process_platform().to_owned(),
        }
    }

    fn arch(&self) -> String {
        match &self.fields.arch {
            Some(arch) => arch.clone(),
            None => process_arch().to_owned(),
        }
    }

    fn libc(&self) -> Option<Libc> {
        match self.fields.libc {
            Some(libc) => libc,
            None => process_libc(),
        }
    }

    fn uid(&self) -> Option<u32> {
        match self.fields.uid {
            Some(uid) => uid,
            None => process_uid(),
        }
    }

    fn time_zone(&self) -> String {
        match &self.fields.time_zone {
            Some(zone) => zone.clone(),
            None => process_time_zone(),
        }
    }

    fn release(&self) -> ReleaseFacts {
        match &self.fields.release {
            Some(release) => release.clone(),
            None => ReleaseFacts::baked(),
        }
    }

    fn release_for(&self, application: &str, directories: &DirectoryFacts) -> ReleaseFacts {
        match &self.fields.release {
            Some(release) => release.clone(),
            None => {
                ReleaseFacts::baked().with_installation(application, directories, &executable())
            }
        }
    }

    fn read_source(&self, path: &str, cwd: &str) -> Option<String> {
        match &self.fields.read_source {
            Some(read) => read(path, cwd),
            None => read_source_file(path, cwd),
        }
    }

    fn stdin(&self) -> Arc<dyn InputStream> {
        match &self.fields.stdin {
            Some(stdin) => Arc::clone(stdin),
            None => real_stdin(),
        }
    }

    fn stdout(&self) -> Arc<dyn OutputStream> {
        match &self.fields.stdout {
            Some(stdout) => Arc::clone(stdout),
            None => real_stdout(),
        }
    }

    fn stderr(&self) -> Arc<dyn OutputStream> {
        match &self.fields.stderr {
            Some(stderr) => Arc::clone(stderr),
            None => real_stderr(),
        }
    }

    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        match &self.fields.terminal {
            Some(terminal) => Arc::clone(terminal),
            None => Arc::new(RealTerminal),
        }
    }

    fn signals(&self) -> Arc<dyn SignalSource> {
        real_signals()
    }

    fn spawn(&self, request: SpawnRequest) -> Child {
        start_child(
            request,
            &HandleStreams {
                stdin: self.stdin(),
                stdout: self.stdout(),
                stderr: self.stderr(),
            },
        )
    }

    /// Writes nothing: a Rust process has no exit code a library can set, so the process exits with
    /// the code its `main` returns, which is the `ExitCode` `run` resolves.
    fn set_exit_code(&self, _code: ExitCode) {}

    fn publish_env(&self, name: &str, value: &str) {
        if self.fields.env.is_none() && self.fields.cwd.is_none() {
            publish(name, value);
        }
    }
}

/// The running executable's path, or the first word the process started with when the platform
/// cannot name it.
fn executable() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| {
        std::env::args_os()
            .next()
            .map(PathBuf::from)
            .unwrap_or_default()
    })
}

/// The variables environment preparation published to the real process. Rust 2024 makes writing
/// the process environment `unsafe`, so the real handle keeps them here and every real handle's
/// `env` reads them beside the process's own.
fn published() -> &'static Mutex<Env> {
    static PUBLISHED: OnceLock<Mutex<Env>> = OnceLock::new();
    PUBLISHED.get_or_init(|| Mutex::new(Env::new()))
}

/// Publishes one environment addition, unless the process already holds the variable, an empty one
/// included, or an earlier addition published it.
fn publish(name: &str, value: &str) {
    if std::env::var_os(name).is_none() {
        locked(published())
            .entry(name.to_owned())
            .or_insert_with(|| value.to_owned());
    }
}

/// The process's environment, each name and value decoded as UTF-8 with replacement characters,
/// with what environment preparation published beside it.
fn process_env() -> Env {
    let mut env: Env = std::env::vars_os()
        .map(|(name, value)| {
            (
                name.to_string_lossy().into_owned(),
                value.to_string_lossy().into_owned(),
            )
        })
        .collect();
    for (name, value) in locked(published()).iter() {
        env.entry(name.clone()).or_insert_with(|| value.clone());
    }
    env
}

/// The process's platform in the reference's spelling.
fn process_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        "solaris" | "illumos" => "sunos",
        other => other,
    }
}

/// The process's architecture in the reference's spelling.
fn process_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        "powerpc" => "ppc",
        "powerpc64" => "ppc64",
        "loongarch64" => "loong64",
        other => other,
    }
}

/// The C library this binary links on Linux: glibc for a GNU target, musl for any other, and none
/// off Linux. A Rust binary's C library is fixed when it compiles, so no report is read.
fn process_libc() -> Option<Libc> {
    if cfg!(target_os = "linux") {
        Some(if cfg!(target_env = "gnu") {
            Libc::Glibc
        } else {
            Libc::Musl
        })
    } else {
        None
    }
}

/// The process's user id, on Unix.
fn process_uid() -> Option<u32> {
    #[cfg(unix)]
    {
        Some(rustix::process::getuid().as_raw())
    }
    #[cfg(not(unix))]
    {
        None
    }
}

/// The IANA time zone the process resolves, which honours `TZ`: a `TZ` that names a zone in the
/// time zone database reads that zone, and an empty one or one the database does not hold, such as
/// a POSIX rule like `UTC0`, reads `UTC`. With no `TZ`, the system's zone, else `UTC`.
fn process_time_zone() -> String {
    zone_of(std::env::var_os("TZ").map(|zone| zone.to_string_lossy().into_owned()))
}

/// The IANA time zone a `TZ` value reads, or the system's when it is unset.
fn zone_of(tz: Option<String>) -> String {
    let utc = || "UTC".to_owned();
    match tz {
        Some(zone) => {
            let name = zone.strip_prefix(':').unwrap_or(&zone);
            if name.is_empty() {
                return utc();
            }
            jiff::tz::db()
                .get(name)
                .ok()
                .and_then(|zone| zone.iana_name().map(str::to_owned))
                .unwrap_or_else(utc)
        }
        None => jiff::tz::TimeZone::try_system()
            .ok()
            .and_then(|zone| zone.iana_name().map(str::to_owned))
            .unwrap_or_else(utc),
    }
}

/// The home `/etc/passwd` lists for the process's user when it is absolute, else empty.
fn database_home() -> PathBuf {
    let Some(uid) = process_uid() else {
        return PathBuf::new();
    };
    let Ok(passwd) = std::fs::read_to_string("/etc/passwd") else {
        return PathBuf::new();
    };
    passwd_home(&passwd, uid).unwrap_or_default()
}

/// The absolute home a `passwd` file lists for `uid`.
fn passwd_home(passwd: &str, uid: u32) -> Option<PathBuf> {
    let uid = uid.to_string();
    passwd
        .lines()
        .map(|line| line.split(':').collect::<Vec<_>>())
        .find(|fields| fields.get(2) == Some(&uid.as_str()))
        .and_then(|fields| fields.get(5).map(PathBuf::from))
        .filter(|home| home.is_absolute())
}

/// The reader the real handle supplies: one UTF-8 file whose path lies under the working directory
/// once both resolve through symbolic links, a regular file of at most 1 MiB. Any other path and
/// any failure answer `None`.
fn read_source_file(path: &str, cwd: &str) -> Option<String> {
    let file = std::fs::canonicalize(path).ok()?;
    let root = std::fs::canonicalize(cwd).ok()?;
    let within = file.strip_prefix(&root).ok()?;
    if within.as_os_str().is_empty() {
        return None;
    }
    read_small_file(&file, SOURCE_LIMIT)
}

// The real streams.

/// The real process's stdout or stderr. A write is synchronous, as a Rust program's own writes
/// are, and flushed at once; a closed reader answers `BrokenPipe`, because Rust ignores `SIGPIPE`.
struct RealOutput {
    stderr: bool,
}

impl OutputStream for RealOutput {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        Box::pin(async move {
            if self.stderr {
                let mut stream = io::stderr().lock();
                stream.write_all(bytes)?;
                stream.flush()
            } else {
                let mut stream = io::stdout().lock();
                stream.write_all(bytes)?;
                stream.flush()
            }
        })
    }
}

/// The real stdout, one value for the process, so a handle can tell it is the process's own.
fn real_stdout_value() -> &'static Arc<RealOutput> {
    static STDOUT: OnceLock<Arc<RealOutput>> = OnceLock::new();
    STDOUT.get_or_init(|| Arc::new(RealOutput { stderr: false }))
}

/// The real stderr, one value for the process.
fn real_stderr_value() -> &'static Arc<RealOutput> {
    static STDERR: OnceLock<Arc<RealOutput>> = OnceLock::new();
    STDERR.get_or_init(|| Arc::new(RealOutput { stderr: true }))
}

/// The real stdin, one value for the process, which the signal source's terminal also answers.
fn real_stdin_value() -> &'static Arc<RealStdin> {
    static STDIN: OnceLock<Arc<RealStdin>> = OnceLock::new();
    STDIN.get_or_init(|| Arc::new(RealStdin::default()))
}

fn real_stdout() -> Arc<dyn OutputStream> {
    Arc::clone(real_stdout_value()) as Arc<dyn OutputStream>
}

fn real_stderr() -> Arc<dyn OutputStream> {
    Arc::clone(real_stderr_value()) as Arc<dyn OutputStream>
}

fn real_stdin() -> Arc<dyn InputStream> {
    Arc::clone(real_stdin_value()) as Arc<dyn InputStream>
}

/// Whether `stream` is the real process's stdout.
fn is_process_stdout(stream: &Arc<dyn OutputStream>) -> bool {
    same_stream(stream, &real_stdout())
}

/// Whether `stream` is the real process's stderr.
fn is_process_stderr(stream: &Arc<dyn OutputStream>) -> bool {
    same_stream(stream, &real_stderr())
}

/// Whether `stream` is the real process's stdin.
fn is_process_stdin(stream: &Arc<dyn InputStream>) -> bool {
    same_stream(stream, &real_stdin())
}

/// The real process's stdin.
///
/// A read is served by one reader thread, started at the first read, that reads descriptor 0 only
/// when a read asks, so stdin is never read ahead of a reader and a child that inherits it sees
/// every key no reader asked for. A read a caller abandons leaves its bytes for the next read.
#[derive(Default)]
struct RealStdin {
    /// Bytes pushed back onto the front of the stream, which the next reads answer first.
    pushed: Mutex<Vec<u8>>,
    reader: tokio::sync::Mutex<StdinReader>,
    /// The terminal's settings before raw mode, held while a reader holds it in raw mode.
    #[cfg(unix)]
    raw: Mutex<Option<rustix::termios::Termios>>,
    #[cfg(not(unix))]
    raw: Mutex<Option<()>>,
}

/// The reader thread's two channels and what it read that no read has taken yet.
#[derive(Default)]
struct StdinReader {
    demand: Option<std::sync::mpsc::Sender<usize>>,
    results: Option<tokio::sync::mpsc::UnboundedReceiver<io::Result<Vec<u8>>>>,
    outstanding: bool,
    leftover: Vec<u8>,
    ended: bool,
}

impl StdinReader {
    /// Moves what fits of the bytes read into `buffer`, keeping the rest for the next read.
    fn take_into(&mut self, buffer: &mut [u8]) -> usize {
        let count = buffer.len().min(self.leftover.len());
        buffer[..count].copy_from_slice(&self.leftover[..count]);
        self.leftover.drain(..count);
        count
    }

    /// Starts the reader thread.
    fn start(&mut self) -> io::Result<()> {
        let (demand, requests) = std::sync::mpsc::channel::<usize>();
        let (answers, results) = tokio::sync::mpsc::unbounded_channel();
        std::thread::Builder::new()
            .name("loomcli-stdin".to_owned())
            .spawn(move || {
                while let Ok(size) = requests.recv() {
                    let mut bytes = vec![0; size.clamp(1, 64 * 1024)];
                    let read = loop {
                        match read_descriptor(&mut bytes) {
                            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                            other => break other,
                        }
                    };
                    let answer = read.map(|count| {
                        bytes.truncate(count);
                        bytes
                    });
                    if answers.send(answer).is_err() {
                        break;
                    }
                }
            })?;
        self.demand = Some(demand);
        self.results = Some(results);
        Ok(())
    }
}

/// One read of descriptor 0, past any buffer of the standard library's.
fn read_descriptor(bytes: &mut [u8]) -> io::Result<usize> {
    #[cfg(unix)]
    {
        use std::os::fd::AsFd;
        let stdin = io::stdin();
        rustix::io::read(stdin.as_fd(), bytes).map_err(io::Error::from)
    }
    #[cfg(not(unix))]
    {
        use std::io::Read;
        io::stdin().read(bytes)
    }
}

impl InputStream for RealStdin {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            if buffer.is_empty() {
                return Ok(0);
            }
            {
                let mut pushed = locked(&self.pushed);
                if !pushed.is_empty() {
                    let count = buffer.len().min(pushed.len());
                    buffer[..count].copy_from_slice(&pushed[..count]);
                    pushed.drain(..count);
                    return Ok(count);
                }
            }
            let mut reader = self.reader.lock().await;
            if !reader.leftover.is_empty() {
                return Ok(reader.take_into(buffer));
            }
            if reader.ended {
                return Ok(0);
            }
            if reader.demand.is_none() {
                reader.start()?;
            }
            if !reader.outstanding {
                let asked = reader
                    .demand
                    .as_ref()
                    .is_some_and(|demand| demand.send(buffer.len()).is_ok());
                if !asked {
                    reader.ended = true;
                    return Ok(0);
                }
                reader.outstanding = true;
            }
            let answer = match reader.results.as_mut() {
                Some(results) => results.recv().await,
                None => None,
            };
            reader.outstanding = false;
            match answer {
                Some(Ok(bytes)) if !bytes.is_empty() => {
                    reader.leftover = bytes;
                    Ok(reader.take_into(buffer))
                }
                Some(Err(error)) => Err(error),
                Some(Ok(_)) | None => {
                    reader.ended = true;
                    Ok(0)
                }
            }
        })
    }

    fn set_raw_mode(&self, on: bool) -> io::Result<()> {
        #[cfg(unix)]
        {
            use rustix::termios::{
                ControlModes, InputModes, LocalModes, OptionalActions, OutputModes,
                SpecialCodeIndex, isatty, tcgetattr, tcsetattr,
            };
            use std::os::fd::AsFd;

            let stdin = io::stdin();
            let descriptor = stdin.as_fd();
            if !isatty(descriptor) {
                return Err(io::Error::from(io::ErrorKind::Unsupported));
            }
            let mut held = locked(&self.raw);
            if on {
                if held.is_none() {
                    let found = tcgetattr(descriptor)?;
                    // The raw mode Node's terminal stream sets, libuv's: no input processing, no
                    // echo, no canonical lines, no signal keys, one byte per read, and the output
                    // translation kept, so a line feed still returns the carriage.
                    let mut raw = found.clone();
                    raw.input_modes.remove(
                        InputModes::BRKINT
                            | InputModes::ICRNL
                            | InputModes::INPCK
                            | InputModes::ISTRIP
                            | InputModes::IXON,
                    );
                    raw.output_modes.insert(OutputModes::ONLCR);
                    raw.control_modes.insert(ControlModes::CS8);
                    raw.local_modes.remove(
                        LocalModes::ECHO
                            | LocalModes::ICANON
                            | LocalModes::IEXTEN
                            | LocalModes::ISIG,
                    );
                    raw.special_codes[SpecialCodeIndex::VMIN] = 1;
                    raw.special_codes[SpecialCodeIndex::VTIME] = 0;
                    tcsetattr(descriptor, OptionalActions::Drain, &raw)?;
                    *held = Some(found);
                }
            } else if let Some(found) = held.take() {
                if let Err(error) = tcsetattr(descriptor, OptionalActions::Drain, &found) {
                    *held = Some(found);
                    return Err(error.into());
                }
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let _ = on;
            Err(io::Error::from(io::ErrorKind::Unsupported))
        }
    }

    fn is_raw(&self) -> bool {
        locked(&self.raw).is_some()
    }

    fn unshift(&self, bytes: &[u8]) {
        let mut pushed = locked(&self.pushed);
        pushed.splice(0..0, bytes.iter().copied());
    }

    fn in_background_job(&self) -> bool {
        #[cfg(unix)]
        {
            use std::os::fd::AsFd;
            let stdin = io::stdin();
            let descriptor = stdin.as_fd();
            if !rustix::termios::isatty(descriptor) {
                return false;
            }
            match rustix::termios::tcgetpgrp(descriptor) {
                Ok(foreground) => foreground != rustix::process::getpgrp(),
                Err(_) => true,
            }
        }
        #[cfg(not(unix))]
        {
            false
        }
    }
}

/// The real process's terminal facts, read when they are asked for.
struct RealTerminal;

impl ProcessTerminal for RealTerminal {
    fn stdin(&self) -> InputTerminal {
        InputTerminal::new(io::stdin().is_terminal())
    }

    fn stdout(&self) -> OutputTerminal {
        #[cfg(unix)]
        {
            use std::os::fd::AsFd;
            output_terminal(io::stdout().as_fd())
        }
        #[cfg(not(unix))]
        {
            OutputTerminal::new(io::stdout().is_terminal(), None, None)
        }
    }

    fn stderr(&self) -> OutputTerminal {
        #[cfg(unix)]
        {
            use std::os::fd::AsFd;
            output_terminal(io::stderr().as_fd())
        }
        #[cfg(not(unix))]
        {
            OutputTerminal::new(io::stderr().is_terminal(), None, None)
        }
    }
}

/// One output descriptor's terminal facts: its kind, and the window's size read now.
#[cfg(unix)]
fn output_terminal(descriptor: std::os::fd::BorrowedFd<'_>) -> OutputTerminal {
    if !rustix::termios::isatty(descriptor) {
        return OutputTerminal::new(false, None, None);
    }
    match rustix::termios::tcgetwinsize(descriptor) {
        Ok(size) => OutputTerminal::new(true, Some(size.ws_col), Some(size.ws_row)),
        Err(_) => OutputTerminal::new(true, None, None),
    }
}

// The real signals.

/// The real process's one signal source, which every handle `process_handle` builds shares.
fn real_signals_value() -> &'static Arc<RealSignals> {
    static SIGNALS: OnceLock<Arc<RealSignals>> = OnceLock::new();
    SIGNALS.get_or_init(|| Arc::new(RealSignals::default()))
}

pub(crate) fn real_signals() -> Arc<dyn SignalSource> {
    Arc::clone(real_signals_value()) as Arc<dyn SignalSource>
}

/// Calls the real process's `exit` listeners with its status. The process has no exit event of its
/// own in Rust, so core's `main` calls this as the run returns.
pub(crate) fn process_exiting(code: i32) {
    real_signals_value().dispatch(SignalEvent::Exit, Some(code));
}

/// The real process's signals. A signal's handler is registered through `signal-hook` the first
/// time a listener listens for it, and stays registered: `signal-hook` cannot give a signal back its
/// default disposition. A handler writes to a socket a thread of the signal's own reads, which calls
/// the listeners, so a listener runs outside the handler and may do anything. A signal that arrives
/// while nothing listens for it, from the terminal, another process, or core's own `raise`, takes
/// its default action there, as it would had no handler ever been registered: an ending signal ends
/// the process, and `SIGTSTP` stops it.
#[derive(Default)]
struct RealSignals {
    state: Mutex<SignalState>,
}

#[derive(Default)]
struct SignalState {
    next: u64,
    listeners: Vec<(u64, SignalEvent, SignalListener)>,
    /// The signals whose handler is registered.
    registered: HashSet<i32>,
}

impl RealSignals {
    /// Calls each listener for `event`, in the order they were added, outside the lock, so a
    /// listener may add or remove listeners; one added during the call waits for the next event.
    /// It answers whether any listener heard the event.
    fn dispatch(&self, event: SignalEvent, status: Option<i32>) -> bool {
        let listeners: Vec<SignalListener> = locked(&self.state)
            .listeners
            .iter()
            .filter(|(_, listening, _)| *listening == event)
            .map(|(_, _, listener)| Arc::clone(listener))
            .collect();
        for listener in &listeners {
            listener(status);
        }
        !listeners.is_empty()
    }

    /// Delivers one arrival of `signal` that its handler heard: to the listeners, or, when none
    /// listens now, to the signal's default action.
    #[cfg(unix)]
    fn deliver(&self, signal: ProcessSignal) {
        if !self.dispatch(SignalEvent::Signal(signal), None) {
            let _ = signal_hook::low_level::emulate_default_handler(signal_number(signal));
        }
    }

    /// Registers the handler of `signal` and starts its thread, the first time only.
    #[cfg(unix)]
    fn register(state: &mut SignalState, signal: ProcessSignal) {
        let number = signal_number(signal);
        if state.registered.contains(&number) {
            return;
        }
        if let Ok(waker) = Self::listen(signal) {
            if signal_hook::low_level::pipe::register(number, waker).is_ok() {
                state.registered.insert(number);
            }
        }
    }

    /// Starts the thread that hears `signal` and answers the socket its handler writes to.
    #[cfg(unix)]
    fn listen(signal: ProcessSignal) -> io::Result<std::os::unix::net::UnixStream> {
        use std::io::Read;
        let (mut heard, waker) = std::os::unix::net::UnixStream::pair()?;
        std::thread::Builder::new()
            .name("loomcli-signal".to_owned())
            .spawn(move || {
                let mut bytes = [0_u8; 64];
                loop {
                    match heard.read(&mut bytes) {
                        Ok(0) => break,
                        Ok(count) => {
                            for _ in 0..count {
                                real_signals_value().deliver(signal);
                            }
                        }
                        Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                        Err(_) => break,
                    }
                }
            })?;
        Ok(waker)
    }
}

impl SignalSource for RealSignals {
    fn on(&self, event: SignalEvent, listener: SignalListener) -> u64 {
        let mut state = locked(&self.state);
        let id = state.next;
        state.next += 1;
        state.listeners.push((id, event, listener));
        #[cfg(unix)]
        if let SignalEvent::Signal(signal) = event {
            Self::register(&mut state, signal);
        }
        id
    }

    fn off(&self, id: u64) {
        let mut state = locked(&self.state);
        let Some(at) = state.listeners.iter().position(|(held, _, _)| *held == id) else {
            return;
        };
        // The handler stays registered; a signal nothing listens for takes its default action.
        state.listeners.remove(at);
    }

    fn raise(&self, signal: ProcessSignal) {
        #[cfg(unix)]
        {
            let number = signal_number(signal);
            let heard = locked(&self.state)
                .listeners
                .iter()
                .any(|(_, event, _)| *event == SignalEvent::Signal(signal));
            // A signal a listener hears is delivered to the process, so its handler wakes the
            // listeners. One nothing hears takes its default action at once, which ends the process
            // for an ending signal and stops it for `SIGTSTP`, even after a handler was registered.
            let _ = if heard {
                signal_hook::low_level::raise(number)
            } else {
                signal_hook::low_level::emulate_default_handler(number)
            };
        }
        #[cfg(not(unix))]
        let _ = signal;
    }

    fn terminal(&self) -> Option<Arc<dyn InputStream>> {
        io::stdin().is_terminal().then(real_stdin)
    }
}

// Real child programs.

/// The handle's own streams a child inherits.
struct HandleStreams {
    stdin: Arc<dyn InputStream>,
    stdout: Arc<dyn OutputStream>,
    stderr: Arc<dyn OutputStream>,
}

/// A started child's process: its id, whether it has ended, and its exit once it has.
struct RealChild {
    pid: Option<u32>,
    ended: Arc<AtomicBool>,
    exit: watch::Receiver<Option<ChildExit>>,
}

impl ChildProcess for RealChild {
    fn exited(&self) -> BoxFuture<'_, ChildExit> {
        let mut exit = self.exit.clone();
        Box::pin(async move {
            let settled = match exit.wait_for(Option::is_some).await {
                Ok(settled) => settled.clone(),
                Err(_) => None,
            };
            settled.unwrap_or_else(|| ChildExit::Unstarted {
                error: Arc::new(io::Error::other(messages::RUNTIME_SHUT_DOWN)),
            })
        })
    }

    fn kill(&self, signal: KillSignal) {
        if !self.ended.load(Ordering::SeqCst) {
            if let Some(pid) = self.pid {
                send_signal(pid, signal);
            }
        }
    }
}

/// Delivers `signal` to the process `pid`; a process that is already gone takes none.
fn send_signal(pid: u32, signal: KillSignal) {
    #[cfg(unix)]
    {
        use rustix::process::{Pid, Signal, kill_process};
        let Some(pid) = i32::try_from(pid).ok().and_then(Pid::from_raw) else {
            return;
        };
        let signal = match signal {
            KillSignal::Kill => Signal::KILL,
            KillSignal::Signal(ProcessSignal::Hup) => Signal::HUP,
            KillSignal::Signal(ProcessSignal::Int) => Signal::INT,
            KillSignal::Signal(ProcessSignal::Quit) => Signal::QUIT,
            KillSignal::Signal(ProcessSignal::Term) => Signal::TERM,
            KillSignal::Signal(ProcessSignal::Tstp) => Signal::TSTP,
            KillSignal::Signal(ProcessSignal::Cont) => Signal::CONT,
        };
        let _ = kill_process(pid, signal);
    }
    #[cfg(not(unix))]
    let _ = (pid, signal);
}

/// The code a child reports: its exit code, or 128 plus the number of the signal that ended it.
fn code_of(status: std::process::ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        128 + status.signal().unwrap_or(0)
    }
    #[cfg(not(unix))]
    {
        128
    }
}

/// The descriptor one output stream starts with: none for an ignored stream, the process's own for
/// an inherited stream that is the process's, and a pipe for any other.
fn output_stdio(choice: &ChildStream, process_own: bool) -> std::process::Stdio {
    match choice {
        ChildStream::Ignore => std::process::Stdio::null(),
        ChildStream::Inherit if process_own => std::process::Stdio::inherit(),
        _ => std::process::Stdio::piped(),
    }
}

/// Starts one real child program with no shell. A child the platform refuses arrives through
/// `exited` as unstarted, so it never fails at the call.
fn start_child(request: SpawnRequest, own: &HandleStreams) -> Child {
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        return Child::unstarted(io::Error::other(messages::NO_RUNTIME));
    };
    let mut command = tokio::process::Command::new(&request.command);
    command
        .args(&request.args)
        .current_dir(&request.cwd)
        .env_clear()
        .envs(&request.env)
        .kill_on_drop(false);
    let options = request.attached;
    match &options {
        None => {
            command
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            #[cfg(unix)]
            command.process_group(0);
        }
        Some(options) => {
            let stdin = if options.inherit_stdin {
                if is_process_stdin(&own.stdin) {
                    std::process::Stdio::inherit()
                } else {
                    std::process::Stdio::piped()
                }
            } else if options.input.is_some() {
                std::process::Stdio::piped()
            } else {
                std::process::Stdio::null()
            };
            command
                .stdin(stdin)
                .stdout(output_stdio(
                    &options.stdout,
                    is_process_stdout(&own.stdout),
                ))
                .stderr(output_stdio(
                    &options.stderr,
                    is_process_stderr(&own.stderr),
                ));
        }
    }
    let _entered = runtime.enter();
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return Child::unstarted(error),
    };
    let pid = child.id();
    let ended = Arc::new(AtomicBool::new(false));
    let (settle, exit) = watch::channel(None);
    let options = options.unwrap_or_default();
    let feeding = feed_input(&runtime, child.stdin.take(), &options, &own.stdin);
    let stdout = collect_output(&runtime, child.stdout.take(), &options.stdout, &own.stdout);
    let stderr = collect_output(&runtime, child.stderr.take(), &options.stderr, &own.stderr);
    let watching = options.signal.clone().map(|signal| {
        let ended = Arc::clone(&ended);
        runtime.spawn(async move {
            signal.cancelled().await;
            if !ended.load(Ordering::SeqCst) {
                if let Some(pid) = pid {
                    send_signal(pid, KillSignal::Signal(ProcessSignal::Term));
                }
            }
        })
    });
    let ending = Arc::clone(&ended);
    runtime.spawn(async move {
        let status = child.wait().await;
        ending.store(true, Ordering::SeqCst);
        if let Some(watching) = watching {
            watching.abort();
        }
        if let Some(feeding) = feeding {
            feeding.abort();
        }
        let stdout = ChildOutput::new(stdout.await.unwrap_or_default());
        let stderr = ChildOutput::new(stderr.await.unwrap_or_default());
        let settled = match status {
            Ok(status) => ChildExit::Exited {
                code: code_of(status),
                stdout,
                stderr,
            },
            Err(error) => ChildExit::Unstarted {
                error: Arc::new(error),
            },
        };
        settle.send_replace(Some(settled));
    });
    Child::new(RealChild { pid, ended, exit })
}

/// Feeds the child's piped stdin: the input and then its end, or the handle's own stdin until it
/// ends. A child that exits before it reads everything closes the pipe, which is no failure.
fn feed_input(
    runtime: &tokio::runtime::Handle,
    pipe: Option<tokio::process::ChildStdin>,
    options: &SpawnOptions,
    own: &Arc<dyn InputStream>,
) -> Option<tokio::task::JoinHandle<()>> {
    let mut pipe = pipe?;
    if let Some(input) = options.input.clone() {
        return Some(runtime.spawn(async move {
            let _ = pipe.write_all(&input).await;
        }));
    }
    let own = Arc::clone(own);
    Some(runtime.spawn(async move {
        let mut bytes = vec![0_u8; 8192];
        loop {
            match own.read(&mut bytes).await {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if pipe.write_all(&bytes[..count]).await.is_err() {
                        break;
                    }
                }
            }
        }
    }))
}

/// Connects one piped output stream: collected when captured, else written to its stream as the
/// child writes, never ended. The task answers the bytes it collected, none for a stream it copied.
fn collect_output<R>(
    runtime: &tokio::runtime::Handle,
    pipe: Option<R>,
    choice: &ChildStream,
    own: &Arc<dyn OutputStream>,
) -> tokio::task::JoinHandle<Vec<u8>>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let target = match choice {
        ChildStream::Capture | ChildStream::Ignore => None,
        ChildStream::Inherit => Some(Arc::clone(own)),
        ChildStream::Stream(stream) => Some(Arc::clone(stream)),
    };
    runtime.spawn(async move {
        let Some(mut pipe) = pipe else {
            return Vec::new();
        };
        let mut collected = Vec::new();
        let mut bytes = vec![0_u8; 8192];
        loop {
            match pipe.read(&mut bytes).await {
                Ok(0) | Err(_) => break,
                Ok(count) => match &target {
                    None => collected.extend_from_slice(&bytes[..count]),
                    Some(stream) => {
                        let _ = stream.write(&bytes[..count]).await;
                    }
                },
            }
        }
        collected
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bytes_pushed_back_onto_the_real_stdin_are_read_first_in_order() {
        // A stdin of its own, so the process's descriptor 0 is never read: the pushed bytes answer
        // every read here.
        let stdin = RealStdin::default();
        stdin.unshift(b"cd");
        stdin.unshift(b"ab");
        let mut buffer = [0_u8; 3];
        let first = stdin.read(&mut buffer).await.unwrap_or_default();
        assert_eq!(&buffer[..first], b"abc");
        let second = stdin.read(&mut buffer).await.unwrap_or_default();
        assert_eq!(&buffer[..second], b"d");
    }

    #[test]
    fn the_passwd_home_is_the_absolute_home_listed_for_the_uid() {
        let passwd = "root:x:0:0:root:/root:/bin/sh\nme:x:1000:1000::/home/me:/bin/sh\nodd:x:7:7::relative:/bin/sh\n";
        assert_eq!(passwd_home(passwd, 1000), Some(PathBuf::from("/home/me")));
        assert_eq!(passwd_home(passwd, 0), Some(PathBuf::from("/root")));
        assert_eq!(passwd_home(passwd, 7), None);
        assert_eq!(passwd_home(passwd, 42), None);
    }

    #[test]
    fn a_tz_naming_a_zone_reads_that_zone() {
        assert_eq!(zone_of(Some("Asia/Tokyo".to_owned())), "Asia/Tokyo");
        assert_eq!(
            zone_of(Some("America/New_York".to_owned())),
            "America/New_York"
        );
    }

    #[test]
    fn a_tz_that_is_empty_a_posix_rule_or_unknown_falls_back_to_utc() {
        for zone in ["", "UTC0", "Bogus/Zone"] {
            assert_eq!(zone_of(Some(zone.to_owned())), "UTC", "TZ={zone:?}");
        }
    }

    #[test]
    fn platform_and_arch_use_the_reference_spelling() {
        assert!(!process_platform().is_empty());
        assert_ne!(process_platform(), "macos");
        assert_ne!(process_arch(), "x86_64");
        assert_ne!(process_arch(), "aarch64");
    }
}
