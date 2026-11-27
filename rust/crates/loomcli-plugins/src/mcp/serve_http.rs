//! The `mcp --http` server. It listens at the address the operator named, warns when that address
//! is not loopback, writes the URL line, and hands each socket to the protocol crate's transport
//! until the run's signal is cancelled.

use std::future::Future;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::pin::pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use loomcli_core::{
    DiagnosticParts, DiagnosticRule, Error, FatalError, InternalError, Log, LogFields, Out,
    RunSignal, View, diagnostic_rule,
};
use loomcli_mcp::{Authorization, HttpOptions, HttpTransport, ToolSource};
use tokio::net::{TcpListener, TcpStream};

use super::address::HttpAddress;
use super::messages;
use super::settings::{Authorize, McpHttpRequest, McpSettings};

/// An `authorize` hook given to `mcp()` that failed while it judged an HTTP request.
const BROKEN_AUTHORIZE_HOOK: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/mcp/broken-authorize-hook",
    "Broken MCP authorize hook",
    "The MCP plugin's HTTP server calls the authorize hook with each request's headers, and the hook answers true to serve the request or false to refuse it, without failing. A failure is a defect in the hook: the server answered that request with 500 and kept serving, and it reports the first failure once, when it stops.",
);

/// The Developer Diagnostic's sentence for a failure of the authorize hook, which stays English.
const BROKEN_AUTHORIZE_HOOK_SENTENCE: &str = "The authorize hook given to mcp() threw while it judged a request, so the server answered that request with 500.";

/// The Developer Diagnostic's correction for a failure of the authorize hook.
const BROKEN_AUTHORIZE_HOOK_CORRECTION: &str =
    "Return true or false from authorize for every request, and throw from it for none.";

/// How long the listener waits after an accept error before it accepts again, so a process out of
/// descriptors does not spin.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(10);

/// What the HTTP server reads of the run: the application's name, `log`, `out`, and the signal.
pub(super) struct HttpContext<R> {
    pub(super) name: String,
    pub(super) log: Log,
    pub(super) out: Out<R>,
    pub(super) signal: RunSignal,
}

/// The listener the server accepts sockets from. A test supplies one that fails.
pub(super) trait Listening: Send {
    /// The address it bound.
    fn bound(&self) -> io::Result<SocketAddr>;
    /// The next socket it accepted.
    fn accept(&mut self) -> impl Future<Output = io::Result<TcpStream>> + Send;
}

impl Listening for TcpListener {
    fn bound(&self) -> io::Result<SocketAddr> {
        self.local_addr()
    }

    async fn accept(&mut self) -> io::Result<TcpStream> {
        TcpListener::accept(self).await.map(|(socket, _)| socket)
    }
}

/// The name of an I/O error's system error, as the reference's sentences name a code, or
/// `unknown` when it carries none Loom names.
fn code_of(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::AddrInUse => return "EADDRINUSE",
        io::ErrorKind::PermissionDenied => return "EACCES",
        io::ErrorKind::AddrNotAvailable => return "EADDRNOTAVAIL",
        io::ErrorKind::OutOfMemory => return "ENOMEM",
        io::ErrorKind::InvalidInput => return "EINVAL",
        _ => {}
    }
    match error.raw_os_error() {
        // The descriptor limits share their numbers on Linux and macOS.
        #[cfg(unix)]
        Some(24) => "EMFILE",
        #[cfg(unix)]
        Some(23) => "ENFILE",
        #[cfg(target_os = "linux")]
        Some(105) => "ENOBUFS",
        #[cfg(target_os = "macos")]
        Some(55) => "ENOBUFS",
        _ => "unknown",
    }
}

/// Binds the address, a name to the first address it resolves to, or fails with the sentence
/// that names the address and why not.
pub(super) async fn bind(name: &str, address: &HttpAddress) -> Result<TcpListener, Error> {
    let fail = |code: &str| -> Error {
        FatalError::new(messages::bind_failed(name, &address.written, code)).into()
    };
    let resolved = match address.host.parse::<IpAddr>() {
        Ok(ip) => SocketAddr::new(ip, address.port),
        Err(_) => tokio::net::lookup_host((address.host.as_str(), address.port))
            .await
            .ok()
            .and_then(|mut addresses| addresses.next())
            .ok_or_else(|| fail("ENOTFOUND"))?,
    };
    TcpListener::bind(resolved)
        .await
        .map_err(|error| fail(code_of(&error)))
}

/// Whether a bound address is loopback: in 127.0.0.0/8, `::1`, or an IPv4-mapped loopback
/// address.
fn is_loopback(bound: IpAddr) -> bool {
    bound.to_canonical().is_loopback()
}

/// The URL line: the endpoint at the host the URL names and the port the server bound. An
/// unspecified address is no address to connect to, so its line names the loopback address that
/// reaches it from this machine.
pub(super) fn endpoint_line(bound: SocketAddr, address: &HttpAddress) -> String {
    let host = match bound.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => "127.0.0.1".to_owned(),
        IpAddr::V6(ip) if ip.is_unspecified() => "[::1]".to_owned(),
        _ => address.url_host.clone(),
    };
    format!("http://{host}:{}/mcp\n", bound.port())
}

/// The warning a bind writes: none on a loopback address, and otherwise open access without an
/// authorize hook, or credentials in the clear with one.
pub(super) fn warning(bound: IpAddr, address: &HttpAddress, hooked: bool) -> Option<String> {
    if is_loopback(bound) {
        None
    } else if hooked {
        Some(messages::cleartext_warning(&address.written))
    } else {
        Some(messages::open_network_warning(&address.written))
    }
}

/// The first failure of the authorize hook in the run, which the server reports once it stops.
type FirstFailure = Arc<Mutex<Option<Error>>>;

/// The author's hook as the transport calls it: each refusal is a `debug` line, and each failure
/// an `error` event that carries it, the first kept for the report when the server stops.
fn authorizer(
    options: HttpOptions,
    log: &Log,
    authorize: Option<Authorize>,
    first: &FirstFailure,
) -> HttpOptions {
    let Some(authorize) = authorize else {
        return options;
    };
    let (log, first) = (log.clone(), Arc::clone(first));
    options.authorize(move |headers| {
        let (authorize, log, first) = (Arc::clone(&authorize), log.clone(), Arc::clone(&first));
        async move {
            match authorize(McpHttpRequest { headers }).await {
                Ok(true) => Authorization::Allowed,
                Ok(false) => {
                    log.debug(messages::UNAUTHORIZED_LINE, ());
                    Authorization::Refused
                }
                Err(error) => {
                    log.error(
                        messages::HOOK_THREW_LINE,
                        LogFields::new().error_field("error", &error),
                    );
                    first
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .get_or_insert(error);
                    Authorization::Failed
                }
            }
        }
    })
}

/// The transport's options: `base`, which holds the token that stops it, with the wrapped hook,
/// the settings' limits, and the `Origin` line.
fn transport_options<R>(
    base: HttpOptions,
    context: &HttpContext<R>,
    settings: &McpSettings,
    first: &FirstFailure,
) -> HttpOptions {
    let log = context.log.clone();
    let options = base
        .max_body_bytes(settings.max_body_bytes)
        .session_idle(settings.session_idle)
        .on_origin_refused(move |origin| {
            log.debug(
                messages::ORIGIN_REFUSED_LINE,
                LogFields::new().field("origin", origin),
            );
        });
    authorizer(options, &context.log, settings.authorize.clone(), first)
}

/// Warns when the bound address is not loopback, then writes the URL line, stdout's one line.
/// A signal cancelled meanwhile writes nothing more.
async fn announce<R: Send + Sync + 'static>(
    context: &HttpContext<R>,
    view: &View<String>,
    bound: SocketAddr,
    address: &HttpAddress,
    hooked: bool,
) -> Result<(), Error> {
    if context.signal.is_cancelled() {
        return Ok(());
    }
    if let Some(warning) = warning(bound.ip(), address, hooked) {
        context.out.warn(warning.as_str()).await?;
    }
    if context.signal.is_cancelled() {
        return Ok(());
    }
    context
        .out
        .render(&endpoint_line(bound, address), view)
        .await
}

/// Accepts each socket and hands it to the transport until `stopped` resolves, then closes the
/// listener. An accept error is an `error` event, and the listener keeps serving.
async fn accept_until_stopped<S: ToolSource, L: Listening>(
    mut listener: L,
    transport: &HttpTransport<S>,
    context_log: &Log,
    stopped: impl Future<Output = ()>,
) {
    let mut stopped = pin!(stopped);
    loop {
        tokio::select! {
            biased;
            () = &mut stopped => return,
            accepted = listener.accept() => match accepted {
                Ok(socket) => transport.watch(socket),
                Err(error) => {
                    context_log.error(
                        messages::SERVER_ERROR_LINE,
                        LogFields::new().field("code", code_of(&error)),
                    );
                    tokio::select! {
                        () = &mut stopped => return,
                        () = tokio::time::sleep(ACCEPT_BACKOFF) => {}
                    }
                }
            },
        }
    }
}

/// Serves the tools over HTTP on a bound listener until the run's signal is cancelled, and
/// returns once every call has settled. A failed announcement stops the server at once, without
/// the signal, and the run fails with it once every call has settled. When the authorize hook
/// failed during the run, the server reports its first failure once it stops, as a defect.
pub(super) async fn serve_on<S, L, R>(
    context: &HttpContext<R>,
    serving: Serving<'_, S>,
    listener: L,
) -> Result<(), Error>
where
    S: ToolSource,
    L: Listening,
    R: Send + Sync + 'static,
{
    let bound = listener.bound().map_err(|error| -> Error {
        FatalError::new(messages::bind_failed(
            &context.name,
            &serving.address.written,
            code_of(&error),
        ))
        .into()
    })?;
    let first = FirstFailure::default();
    // The server stops on the run's signal, or on its own when the announcement fails.
    let stop = context.signal.token().child_token();
    let options = transport_options(
        HttpOptions::new(stop.clone()),
        context,
        serving.settings,
        &first,
    );
    let transport = serving.server(options);
    let announced = async {
        let announced = announce(
            context,
            serving.view,
            bound,
            serving.address,
            serving.settings.authorize.is_some(),
        )
        .await;
        if announced.is_err() {
            stop.cancel();
        }
        announced
    };
    let accepting = accept_until_stopped(listener, &transport, &context.log, stop.cancelled());
    let (announced, ()) = tokio::join!(announced, accepting);
    transport.closed().await;
    let failure = first.lock().unwrap_or_else(PoisonError::into_inner).take();
    if let Some(failure) = failure {
        return Err(InternalError::new(
            BROKEN_AUTHORIZE_HOOK,
            DiagnosticParts::new(BROKEN_AUTHORIZE_HOOK_SENTENCE)
                .correction(BROKEN_AUTHORIZE_HOOK_CORRECTION),
            failure,
        )
        .into());
    }
    announced
}

/// What `mcp --http` serves: the address, the plugin's settings, the view the URL line renders
/// through, and the server's transport.
pub(super) struct Serving<'a, S> {
    pub(super) address: &'a HttpAddress,
    pub(super) settings: &'a McpSettings,
    pub(super) view: &'a View<String>,
    pub(super) server: &'a (dyn Fn(HttpOptions) -> HttpTransport<S> + Sync),
}

impl<S> Serving<'_, S> {
    fn server(&self, options: HttpOptions) -> HttpTransport<S> {
        (self.server)(options)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use std::future::pending;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use loomcli_core::{
        Application, BoxFuture, Child, Context, Env, ExitCode, InputStream, Libc, OutputStream,
        ProcessHandle, ProcessTerminal, ReleaseFacts, RunOptions, SignalSource, SpawnRequest,
    };
    use loomcli_mcp::{McpServer, ProtocolError, ServerInfo, Tool, ToolCall, ToolResult};
    use loomcli_testing::{MockFields, MockProcess, mock_process};
    use tokio_util::sync::CancellationToken;

    use super::*;
    use crate::mcp::address::address_of;
    use crate::mcp::plugin::exact_text;

    fn named(written: &str) -> HttpAddress {
        address_of(written).unwrap()
    }

    fn at(address: &str) -> SocketAddr {
        address.parse().unwrap()
    }

    // What a bind tells the operator, from the reference's `mcp-http.test.ts`.

    #[test]
    fn writes_no_warning_for_a_loopback_address_ipv4_mapped_included() {
        for bound in ["127.0.0.1", "127.0.0.5", "::1", "::ffff:127.0.0.1"] {
            assert_eq!(
                warning(bound.parse().unwrap(), &named("0"), false),
                None,
                "{bound}"
            );
        }
    }

    #[test]
    fn warns_about_open_access_without_a_hook_and_about_cleartext_credentials_with_one() {
        assert_eq!(
            warning("0.0.0.0".parse().unwrap(), &named("0.0.0.0:8080"), false).as_deref(),
            Some(
                "Serving at 0.0.0.0:8080, which other hosts can reach, with no authorize hook, so any host that reaches it can call the tools without credentials. Serve on 127.0.0.1, or put the server behind something that authenticates."
            )
        );
        assert_eq!(
            warning("10.1.2.3".parse().unwrap(), &named("10.1.2.3:8080"), true).as_deref(),
            Some(
                "Serving at 10.1.2.3:8080 over plain HTTP, so requests and their credentials cross the network unencrypted, where anyone on the path can read and replay them. Put TLS in front of the server, such as a reverse proxy that terminates it."
            )
        );
    }

    #[test]
    fn names_the_loopback_address_that_reaches_an_unspecified_address_in_the_url_line() {
        assert_eq!(
            endpoint_line(at("0.0.0.0:8080"), &named("0.0.0.0:8080")),
            "http://127.0.0.1:8080/mcp\n"
        );
        assert_eq!(
            endpoint_line(at("[::]:8080"), &named("[::]:8080")),
            "http://[::1]:8080/mcp\n"
        );
        assert_eq!(
            endpoint_line(at("[::1]:41000"), &named("[::1]:0")),
            "http://[::1]:41000/mcp\n"
        );
    }

    // The listener's lifecycle, from the reference's `mcp-http-lifecycle.test.ts`.

    struct NoTools;

    impl ToolSource for NoTools {
        async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
            Ok(Vec::new())
        }

        async fn call_tool(&self, _: ToolCall) -> Result<ToolResult, ProtocolError> {
            Ok(ToolResult::default())
        }
    }

    /// A listener that reports a bound address, cancels the run when it is asked for it if the
    /// test says so, and fails its first accept with EMFILE when the test says so.
    struct FakeListener {
        bound: SocketAddr,
        cancel_on_bound: Option<CancellationToken>,
        fail_first: bool,
        accepts: Arc<AtomicUsize>,
    }

    impl Listening for FakeListener {
        fn bound(&self) -> io::Result<SocketAddr> {
            if let Some(cancel) = &self.cancel_on_bound {
                cancel.cancel();
            }
            Ok(self.bound)
        }

        async fn accept(&mut self) -> io::Result<TcpStream> {
            let count = self.accepts.fetch_add(1, Ordering::SeqCst);
            if self.fail_first && count == 0 {
                return Err(io::Error::from_raw_os_error(24));
            }
            pending().await
        }
    }

    /// A stderr that cancels the run once it has written the network warning, as the reference's
    /// test aborts while the warning is written.
    struct CancellingStderr {
        inner: Arc<dyn OutputStream>,
        cancel: Option<CancellationToken>,
    }

    impl OutputStream for CancellingStderr {
        fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
            Box::pin(async move {
                let written = self.inner.write(bytes).await;
                if String::from_utf8_lossy(bytes).contains("can call")
                    && let Some(cancel) = &self.cancel
                {
                    cancel.cancel();
                }
                written
            })
        }
    }

    /// A stdout whose every write fails with ENOSPC, a write error other than a closed reader, so
    /// it leaves the run's signal alone.
    struct FullStdout;

    impl OutputStream for FullStdout {
        fn write<'a>(&'a self, _: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
            Box::pin(async { Err(io::Error::from_raw_os_error(28)) })
        }
    }

    /// The mock process with a stderr that may cancel the run, and a stdout the test may replace.
    struct Process {
        inner: Arc<MockProcess>,
        stderr: Arc<CancellingStderr>,
        stdout: Option<Arc<dyn OutputStream>>,
    }

    impl ProcessHandle for Process {
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
        fn stdin(&self) -> Arc<dyn InputStream> {
            self.inner.stdin()
        }
        fn stdout(&self) -> Arc<dyn OutputStream> {
            self.stdout.clone().unwrap_or_else(|| self.inner.stdout())
        }
        fn stderr(&self) -> Arc<dyn OutputStream> {
            Arc::clone(&self.stderr) as Arc<dyn OutputStream>
        }
        fn terminal(&self) -> Arc<dyn ProcessTerminal> {
            self.inner.terminal()
        }
        fn signals(&self) -> Arc<dyn SignalSource> {
            self.inner.signals()
        }
        fn spawn(&self, request: SpawnRequest) -> Child {
            self.inner.spawn(request)
        }
        fn set_exit_code(&self, code: ExitCode) {
            self.inner.set_exit_code(code);
        }
    }

    /// How one lifecycle run goes.
    struct Lifecycle {
        argv: Vec<&'static str>,
        bound: &'static str,
        cancel_on_bound: bool,
        cancel_on_warning: bool,
        fail_first: bool,
    }

    /// What a lifecycle run wrote, and how many accepts the listener saw.
    struct Ran {
        stdout: String,
        stderr: String,
        /// Read by the accept-error case alone, which needs the verbose feature.
        #[cfg_attr(not(feature = "verbose"), allow(dead_code))]
        accepts: usize,
    }

    /// Runs an application whose action serves on the fake listener until the run is cancelled.
    async fn lifecycle(run: Lifecycle) -> Ran {
        let signal = CancellationToken::new();
        let accepts = Arc::new(AtomicUsize::new(0));
        let listener = Mutex::new(Some(FakeListener {
            bound: at(&format!("{}:1", run.bound)),
            cancel_on_bound: run.cancel_on_bound.then(|| signal.clone()),
            fail_first: run.fail_first,
            accepts: Arc::clone(&accepts),
        }));
        let app = Application::new("fixture");
        // Only the accept-error run reads -v, and only it needs the verbose plugin.
        #[cfg(feature = "verbose")]
        let app = app.plugins([crate::verbose::verbose()]);
        let app = app.version("1.0.0").action(move |context: Context| {
            let listener = listener.lock().unwrap().take().unwrap();
            async move {
                let server = McpServer::new(ServerInfo::new("fixture", "1.0.0"), NoTools);
                let http = HttpContext {
                    name: "fixture".to_owned(),
                    log: context.log.clone(),
                    out: context.out.clone(),
                    signal: context.signal.clone(),
                };
                let address = named("0");
                let settings = McpSettings::default();
                let view = exact_text();
                let serving = Serving {
                    address: &address,
                    settings: &settings,
                    view: &view,
                    server: &|options| server.http(options),
                };
                serve_on(&http, serving, listener).await
            }
        });
        let inner = mock_process(MockFields::new().argv(run.argv));
        let process = Process {
            inner: Arc::clone(&inner),
            stderr: Arc::new(CancellingStderr {
                inner: inner.stderr(),
                cancel: run.cancel_on_warning.then(|| signal.clone()),
            }),
            stdout: None,
        };
        let running = tokio::spawn(
            app.run(
                RunOptions::new()
                    .process(Arc::new(process) as Arc<dyn ProcessHandle>)
                    .signal(signal.clone()),
            ),
        );
        if !run.cancel_on_bound && !run.cancel_on_warning {
            let started = std::time::Instant::now();
            while accepts.load(Ordering::SeqCst) < usize::from(run.fail_first) + 1 {
                assert!(
                    started.elapsed() < Duration::from_secs(10),
                    "the listener never accepted"
                );
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
            signal.cancel();
        }
        tokio::time::timeout(Duration::from_secs(10), running)
            .await
            .expect("the run did not end")
            .unwrap();
        Ran {
            stdout: inner.stdout_text(),
            stderr: inner.stderr_text(),
            accepts: accepts.load(Ordering::SeqCst),
        }
    }

    // The run installs the verbose plugin for -v, so the test compiles with its feature.
    #[cfg(feature = "verbose")]
    #[tokio::test]
    async fn logs_an_accept_error_and_continues_serving() {
        let ran = lifecycle(Lifecycle {
            argv: vec!["-v"],
            bound: "127.0.0.1",
            cancel_on_bound: false,
            cancel_on_warning: false,
            fail_first: true,
        })
        .await;
        assert_eq!(ran.accepts, 2);
        assert!(
            ran.stderr.contains(
                "The HTTP server could not accept a connection (EMFILE). It will keep serving; free system resources if this continues."
            ),
            "{}",
            ran.stderr
        );
    }

    #[tokio::test]
    async fn announces_nothing_when_aborted_during_listen() {
        let ran = lifecycle(Lifecycle {
            argv: vec![],
            bound: "127.0.0.1",
            cancel_on_bound: true,
            cancel_on_warning: false,
            fail_first: false,
        })
        .await;
        assert_eq!((ran.stdout.as_str(), ran.stderr.as_str()), ("", ""));
    }

    #[tokio::test]
    async fn does_not_announce_a_url_when_aborted_while_writing_the_network_warning() {
        let ran = lifecycle(Lifecycle {
            argv: vec![],
            bound: "192.0.2.1",
            cancel_on_bound: false,
            cancel_on_warning: true,
            fail_first: false,
        })
        .await;
        assert!(ran.stderr.contains("can call"), "{}", ran.stderr);
        assert_eq!(ran.stdout, "");
    }

    /// What the failed-announcement run saw when `serve_on` returned: its error, and whether the
    /// run's signal was cancelled.
    type Returned = Arc<Mutex<Option<(Option<String>, bool)>>>;

    // A closed reader cancels the run, and the server stops on that; any other write error leaves
    // the signal alone, and the server stops on its own, as the reference's awaited `announce`
    // rejects the run at once.
    #[tokio::test]
    async fn stops_serving_and_fails_at_once_when_the_url_line_fails_to_write() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let listener = Mutex::new(Some(listener));
        let returned = Returned::default();
        let seen = Arc::clone(&returned);
        let app = Application::new("fixture")
            .version("1.0.0")
            .action(move |context: Context| {
                let listener = listener.lock().unwrap().take().unwrap();
                let seen = Arc::clone(&seen);
                async move {
                    let server = McpServer::new(ServerInfo::new("fixture", "1.0.0"), NoTools);
                    let http = HttpContext {
                        name: "fixture".to_owned(),
                        log: context.log.clone(),
                        out: context.out.clone(),
                        signal: context.signal.clone(),
                    };
                    let (address, settings, view) =
                        (named("0"), McpSettings::default(), exact_text());
                    let serving = Serving {
                        address: &address,
                        settings: &settings,
                        view: &view,
                        server: &|options| server.http(options),
                    };
                    let served = serve_on(&http, serving, listener).await;
                    *seen.lock().unwrap() = Some((
                        served
                            .as_ref()
                            .err()
                            .and_then(Error::foreign)
                            .map(ToString::to_string),
                        context.signal.is_cancelled(),
                    ));
                    served
                }
            });
        let inner = mock_process(MockFields::new());
        let process = Process {
            inner: Arc::clone(&inner),
            stderr: Arc::new(CancellingStderr {
                inner: inner.stderr(),
                cancel: None,
            }),
            stdout: Some(Arc::new(FullStdout)),
        };
        let signal = CancellationToken::new();
        tokio::time::timeout(
            Duration::from_secs(10),
            app.run(
                RunOptions::new()
                    .process(Arc::new(process) as Arc<dyn ProcessHandle>)
                    .signal(signal.clone()),
            ),
        )
        .await
        .expect("the server kept serving after its URL line failed");
        let (error, cancelled) = returned.lock().unwrap().take().unwrap();
        let error = error.expect("serve_on returned no error");
        assert!(error.contains("os error 28"), "{error}");
        assert!(
            !cancelled && !signal.is_cancelled(),
            "the run's signal was cancelled"
        );
        assert!(
            TcpStream::connect(("127.0.0.1", port)).await.is_err(),
            "the listener is still open"
        );
    }
}
