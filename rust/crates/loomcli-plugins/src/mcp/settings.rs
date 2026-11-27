//! The settings `mcp()` takes, each of which shapes the HTTP server that `mcp --http` runs and none
//! of which changes a stdio server.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use loomcli_core::Error;
pub use loomcli_mcp::RequestHeaders;

/// The largest POST body the server reads by default: 4 MiB.
pub(super) const DEFAULT_MAX_BODY_BYTES: u64 = 4_194_304;
/// How long an initialize-era session may sit idle by default: 30 minutes.
pub(super) const DEFAULT_SESSION_IDLE: Duration = Duration::from_secs(1_800);

/// One HTTP request as the `authorize` hook reads it, before its body is read.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct McpHttpRequest {
    /// A fresh copy of the request's headers, so a hook that changes it changes nothing else.
    pub headers: RequestHeaders,
}

impl McpHttpRequest {
    /// A request carrying `headers`, as the server hands one to the hook, so a test can call an
    /// `authorize` hook directly.
    ///
    /// ```
    /// use loomcli_plugins::mcp::{McpHttpRequest, RequestHeaders};
    ///
    /// let headers: RequestHeaders = [("Authorization", "Bearer sesame")].into_iter().collect();
    /// let request = McpHttpRequest::new(headers);
    /// assert_eq!(
    ///     request.headers.get("authorization").as_deref(),
    ///     Some("Bearer sesame")
    /// );
    /// ```
    #[must_use]
    pub fn new(headers: RequestHeaders) -> Self {
        Self { headers }
    }
}

/// What an `authorize` hook's future answers: `true` serves the request and `false` answers it
/// 401, as a `bool` or an `Ok`; an `Err` is a defect in the hook, answered 500.
pub trait IntoAuthorization {
    /// The answer, or the hook's failure.
    fn into_authorization(self) -> Result<bool, Error>;
}

impl IntoAuthorization for bool {
    fn into_authorization(self) -> Result<bool, Error> {
        Ok(self)
    }
}

impl<E: Into<Error>> IntoAuthorization for Result<bool, E> {
    fn into_authorization(self) -> Result<bool, Error> {
        self.map_err(Into::into)
    }
}

/// The hook as the server calls it.
pub(super) type Authorize = Arc<
    dyn Fn(McpHttpRequest) -> Pin<Box<dyn Future<Output = Result<bool, Error>> + Send>>
        + Send
        + Sync,
>;

/// The settings a run reads.
#[derive(Clone)]
pub(super) struct McpSettings {
    pub(super) authorize: Option<Authorize>,
    pub(super) max_body_bytes: u64,
    pub(super) session_idle: Duration,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            authorize: None,
            max_body_bytes: DEFAULT_MAX_BODY_BYTES,
            session_idle: DEFAULT_SESSION_IDLE,
        }
    }
}

/// The MCP plugin and its HTTP settings, which [`mcp()`](super::mcp) returns. It installs as a
/// plugin wherever one is accepted.
#[must_use]
pub struct Mcp {
    pub(super) settings: McpSettings,
}

impl Mcp {
    /// Judges each HTTP request from its headers, after the `Origin` check and before the body
    /// is read: `true` serves it, and `false` answers 401 with `WWW-Authenticate: Bearer`. An
    /// `Err` answers 500, is logged at `error`, and the first one fails the run once the server
    /// stops. Never called over stdio.
    ///
    /// The comparison is the author's. It must take the same time whether or not the values
    /// match, and it must refuse when the expected secret is empty. This example compares SHA-256
    /// digests from the `sha2` crate, which have one length and so hide the token's length too,
    /// with the constant-time comparison of the `subtle` crate. A comparison written by hand,
    /// even one with no early exit, carries no promise about the code the compiler makes of it.
    ///
    /// ```
    /// use loomcli_plugins::mcp::{Mcp, McpHttpRequest, mcp};
    /// use sha2::{Digest, Sha256};
    /// use subtle::ConstantTimeEq;
    ///
    /// /// Whether an `Authorization` header carries the bearer token `expected` is the digest of.
    /// fn carries(header: &str, expected: Option<[u8; 32]>) -> bool {
    ///     // RFC 6750: the scheme name compares without regard to case.
    ///     let sent = header
    ///         .split_once(' ')
    ///         .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
    ///         .map(|(_, sent)| Sha256::digest(sent.trim_start_matches(' ')));
    ///     match (sent, expected) {
    ///         // Its time does not depend on where the two digests differ.
    ///         (Some(sent), Some(expected)) => sent.as_slice().ct_eq(&expected).into(),
    ///         _ => false,
    ///     }
    /// }
    ///
    /// /// The digest of the application's token, or `None` for an empty one, which refuses every
    /// /// request.
    /// fn expected_of(token: &str) -> Option<[u8; 32]> {
    ///     (!token.is_empty()).then(|| Sha256::digest(token).into())
    /// }
    ///
    /// /// Serves a request only when it carries `token`, which the application reads from its
    /// /// own source of secrets and never from its source code.
    /// fn guarded(token: &str) -> Mcp {
    ///     let expected = expected_of(token);
    ///     mcp().authorize(move |request: McpHttpRequest| {
    ///         let header = request.headers.get("authorization").unwrap_or_default();
    ///         let allowed = carries(&header, expected);
    ///         async move { allowed }
    ///     })
    /// }
    ///
    /// # let expected = expected_of("sesame");
    /// # assert!(expected_of("").is_none() && !carries("Bearer ", expected_of("")));
    /// # assert!(carries("Bearer sesame", expected) && carries("bearer   sesame", expected));
    /// # assert!(!carries("Bearer sesam", expected) && !carries("Basic sesame", expected));
    /// # assert!(!carries("", expected) && !carries("Bearer sesame", None));
    /// let _ = guarded("the token the application was given");
    /// ```
    pub fn authorize<F, Fut, T>(mut self, authorize: F) -> Self
    where
        F: Fn(McpHttpRequest) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = T> + Send + 'static,
        T: IntoAuthorization,
    {
        let authorize = Arc::new(authorize);
        self.settings.authorize = Some(Arc::new(move |request| {
            let answer = authorize(request);
            Box::pin(async move { answer.await.into_authorization() })
        }));
        self
    }

    /// The largest POST body the server reads, in bytes, 4,194,304 (4 MiB) by default.
    pub fn max_body_bytes(mut self, limit: u64) -> Self {
        self.settings.max_body_bytes = limit;
        self
    }

    /// How long an initialize-era session may sit idle before it ends, 30 minutes by default.
    pub fn session_idle(mut self, idle: Duration) -> Self {
        self.settings.session_idle = idle;
        self
    }
}
