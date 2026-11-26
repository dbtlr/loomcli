//! Host capture: the facts one run copies from its process handle at entry, each read once.

use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use super::{Host, HostTerminal, InputStream, OutputStream, ProcessHandle};
use crate::shipping::DirectoryFacts;

/// The streams a run reads and writes: the handle's for an argv run, or capture sinks for an
/// invocation by name.
#[derive(Clone)]
pub(crate) struct RunStreams {
    pub(crate) stdin: Arc<dyn InputStream>,
    pub(crate) stdout: Arc<dyn OutputStream>,
    pub(crate) stderr: Arc<dyn OutputStream>,
}

/// The handle's own streams a run's streams may be, which a child inherits only when the run's
/// stream is one of them: all three for an argv run, and none for an invocation by name.
#[derive(Clone, Default)]
pub(crate) struct OwnStreams {
    pub(crate) stdin: Option<Arc<dyn InputStream>>,
    pub(crate) stdout: Option<Arc<dyn OutputStream>>,
    pub(crate) stderr: Option<Arc<dyn OutputStream>>,
}

/// One host capture: the run's host, and the error its working directory or ceiling read raised.
/// A failed read leaves the host's `cwd` empty and `cwd_read` false, so the failure path writes
/// through this host and never captures again, and a child it starts never starts.
pub(crate) struct HostCapture {
    pub(crate) host: Host,
    pub(crate) unreadable_cwd: Option<io::Error>,
}

/// The host `run` captures for `application` from its process handle at entry: the facts every
/// run copies, and the argv, streams, and terminal facts of an argv run.
pub(crate) fn capture_host(application: &str, handle: Arc<dyn ProcessHandle>) -> HostCapture {
    let streams = RunStreams {
        stdin: handle.stdin(),
        stdout: handle.stdout(),
        stderr: handle.stderr(),
    };
    let own = OwnStreams {
        stdin: Some(Arc::clone(&streams.stdin)),
        stdout: Some(Arc::clone(&streams.stdout)),
        stderr: Some(Arc::clone(&streams.stderr)),
    };
    let argv = handle.argv();
    capture_parts(application, handle, argv, streams, own)
}

/// One host capture around the run's own argv and streams. The handle's facts are each read once,
/// the home and the temporary folder before environment preparation can add a `HOME`, and the
/// release facts with the installation the record holds for `application`.
pub(crate) fn capture_parts(
    application: &str,
    handle: Arc<dyn ProcessHandle>,
    argv: Vec<String>,
    streams: RunStreams,
    own: OwnStreams,
) -> HostCapture {
    let env = handle.env();
    let home = handle.home();
    let platform = handle.platform();
    let directory = handle
        .cwd()
        .and_then(|cwd| handle.ceiling().map(|ceiling| (cwd, ceiling)));
    let (cwd, ceiling, unreadable_cwd) = match directory {
        Ok((cwd, ceiling)) => (cwd, ceiling, None),
        Err(error) => (PathBuf::new(), None, Some(error)),
    };
    let directories = DirectoryFacts::new(env.clone(), home.clone(), platform.clone());
    let release = handle.release_for(application, &directories);
    let host = Host {
        argv,
        program: handle.program(),
        cwd_read: unreadable_cwd.is_none(),
        cwd,
        ceiling,
        env,
        home,
        tmpdir: handle.tmpdir(),
        platform,
        arch: handle.arch(),
        runtime: handle.runtime(),
        libc: handle.libc(),
        uid: handle.uid(),
        time_zone: handle.time_zone(),
        release,
        terminal: HostTerminal::captured(handle.terminal()),
        signals: handle.signals(),
        streams,
        own,
        handle,
    };
    HostCapture {
        host,
        unreadable_cwd,
    }
}
