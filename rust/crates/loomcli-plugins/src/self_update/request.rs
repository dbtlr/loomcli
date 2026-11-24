//! Requests over a [`Transport`]: each starts at an HTTPS URL, follows every redirect itself, only
//! to an HTTPS URL and at most 20 times, and reads the run signal, so a cancelled run drops the
//! request and propagates the cancellation as it is.

use std::future::Future;
use std::io;
use std::pin::pin;
use std::sync::Arc;
use std::task::Poll;

use loomcli_core::{Error, RunSignal};
use url::Url;

use super::transport::{Transport, TransportResponse};

/// The most redirects one request follows; one more fails it.
const MAX_REDIRECTS: usize = 20;

/// The statuses that redirect to another URL.
const REDIRECT_STATUSES: [u16; 5] = [301, 302, 303, 307, 308];

/// The status of a response that has what was asked for.
pub(crate) const OK: u16 = 200;

/// The status of a release or tag that does not exist.
pub(crate) const NOT_FOUND: u16 = 404;

/// The origin every request starts on, and the one a renamed repository's redirect names.
pub(crate) const GITHUB: &str = "https://github.com";

/// Why a request failed before the Command could read what it asked for, named by the URL it
/// started at.
#[derive(Debug)]
pub(crate) enum RequestError {
    /// A redirect led to a scheme other than `https:`.
    Insecure { url: String },
    /// A 21st redirect.
    TooMany { url: String },
    /// A status other than `200` at the end of the redirects, or a redirect the request stopped at
    /// where it wanted a response.
    Status { url: String, status: Option<u16> },
    /// No response arrived, or the body ended before it was whole; the runtime's error is kept.
    NoResponse { url: String, cause: io::Error },
}

impl RequestError {
    /// The URL the failed request started at.
    pub(crate) fn url(&self) -> &str {
        match self {
            RequestError::Insecure { url }
            | RequestError::TooMany { url }
            | RequestError::Status { url, .. }
            | RequestError::NoResponse { url, .. } => url,
        }
    }

    /// The status the request ended with, when one did.
    pub(crate) fn status(&self) -> Option<u16> {
        match self {
            RequestError::Status { status, .. } => *status,
            _ => None,
        }
    }
}

/// Why a step of a run stopped: a request that failed, or any other failure, a cancellation's echo
/// included, which propagates as it is.
#[derive(Debug)]
pub(crate) enum Stop {
    Request(RequestError),
    Failed(Error),
}

impl From<RequestError> for Stop {
    fn from(error: RequestError) -> Self {
        Stop::Request(error)
    }
}

impl From<Error> for Stop {
    fn from(error: Error) -> Self {
        Stop::Failed(error)
    }
}

impl From<loomcli_core::FatalError> for Stop {
    fn from(error: loomcli_core::FatalError) -> Self {
        Stop::Failed(error.into())
    }
}

impl From<io::Error> for Stop {
    fn from(error: io::Error) -> Self {
        Stop::Failed(error.into())
    }
}

/// The run's transport and signal, which every request reads.
#[derive(Clone)]
pub(crate) struct Client {
    pub(crate) transport: Arc<dyn Transport>,
    pub(crate) signal: RunSignal,
}

/// Where a request ended: a response, or a redirect the caller asked to stop at, which was not
/// requested. A response's `github` is the last github.com URL the request reached or a redirect
/// named.
pub(crate) enum Followed {
    Response {
        response: TransportResponse,
        github: Url,
    },
    Stopped {
        stopped: Url,
    },
}

/// The cancellation's echo, once the run has been cancelled.
fn cancellation(signal: &RunSignal) -> Stop {
    match signal.throw_if_cancelled() {
        Err(echo) => Stop::Failed(echo),
        // The signal resolved `cancelled`, so it reads cancelled; this arm is unreachable.
        Ok(()) => Stop::Failed(Error::from(io::Error::other("The run was cancelled."))),
    }
}

/// `work`'s answer, or the cancellation's echo once the run is cancelled first; a run already
/// cancelled never polls `work`.
pub(crate) async fn until_cancelled<T>(
    signal: &RunSignal,
    work: impl Future<Output = T>,
) -> Result<T, Stop> {
    if signal.is_cancelled() {
        return Err(cancellation(signal));
    }
    let mut cancelled = pin!(signal.cancelled());
    let mut work = pin!(work);
    let answer = std::future::poll_fn(|context| {
        if cancelled.as_mut().poll(context).is_ready() {
            return Poll::Ready(None);
        }
        work.as_mut().poll(context).map(Some)
    })
    .await;
    answer.ok_or_else(|| cancellation(signal))
}

/// Whether `url` is on github.com, as a URL's origin reads.
pub(crate) fn is_github(url: &Url) -> bool {
    url.origin().ascii_serialization() == GITHUB
}

impl Client {
    /// One request with no redirect followed, its failure before a response named for `start`.
    async fn request(&self, url: &Url, start: &Url) -> Result<TransportResponse, Stop> {
        until_cancelled(&self.signal, self.transport.get(url.as_str()))
            .await?
            .map_err(|cause| {
                Stop::Request(RequestError::NoResponse {
                    url: start.as_str().to_owned(),
                    cause,
                })
            })
    }

    /// Requests `start` and follows each redirect itself, only to an HTTPS URL and at most 20
    /// times, until a response that is not a redirect, or a redirect `stop` accepts.
    pub(crate) async fn follow(
        &self,
        start: &Url,
        stop: impl Fn(&Url) -> bool,
    ) -> Result<Followed, Stop> {
        let mut url = start.clone();
        let mut github = start.clone();
        let mut redirects = 0;
        loop {
            let response = self.request(&url, start).await?;
            let Some(next) = redirect_of(&response, &url, start)? else {
                return Ok(Followed::Response { response, github });
            };
            // The bound comes before the stop rule, so a 21st redirect fails wherever it leads.
            if redirects == MAX_REDIRECTS {
                return Err(RequestError::TooMany {
                    url: start.as_str().to_owned(),
                }
                .into());
            }
            if is_github(&next) {
                github = next.clone();
            }
            if stop(&next) {
                return Ok(Followed::Stopped { stopped: next });
            }
            redirects += 1;
            url = next;
        }
    }

    /// The response at the end of the redirects from `url`, when its status is `200`; any other
    /// fails.
    async fn ok_response(&self, url: &Url) -> Result<(TransportResponse, Url), Stop> {
        match self.follow(url, |_| false).await? {
            Followed::Stopped { .. } => Err(RequestError::Status {
                url: url.as_str().to_owned(),
                status: None,
            }
            .into()),
            Followed::Response { response, .. } if response.status != OK => {
                Err(RequestError::Status {
                    url: url.as_str().to_owned(),
                    status: Some(response.status),
                }
                .into())
            }
            Followed::Response { response, github } => Ok((response, github)),
        }
    }

    /// Reads a body whole. A connection that ends before the body does is no response, named for
    /// `url`; a cancellation propagates as it is.
    async fn read_body(&self, url: &Url, response: TransportResponse) -> Result<Vec<u8>, Stop> {
        until_cancelled(&self.signal, response.body)
            .await?
            .map_err(|cause| {
                Stop::Request(RequestError::NoResponse {
                    url: url.as_str().to_owned(),
                    cause,
                })
            })
    }

    /// The text at `url` after its redirects, decoded as UTF-8 as `fetch`'s `text()` decodes it,
    /// and the last github.com URL they visited.
    pub(crate) async fn fetch_text(&self, url: &Url) -> Result<(String, Url), Stop> {
        let (response, github) = self.ok_response(url).await?;
        let bytes = self.read_body(url, response).await?;
        let text = String::from_utf8_lossy(&bytes);
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned();
        Ok((text, github))
    }

    /// The bytes at `url` after its redirects.
    pub(crate) async fn fetch_bytes(&self, url: &Url) -> Result<Vec<u8>, Stop> {
        let (response, _) = self.ok_response(url).await?;
        self.read_body(url, response).await
    }
}

/// Where a response redirects to, `None` when it does not; a redirect away from HTTPS fails.
fn redirect_of(response: &TransportResponse, url: &Url, start: &Url) -> Result<Option<Url>, Stop> {
    let Some(location) = &response.location else {
        return Ok(None);
    };
    if !REDIRECT_STATUSES.contains(&response.status) {
        return Ok(None);
    }
    let next = url.join(location).map_err(|error| {
        Stop::Failed(Error::from(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Invalid URL: {error}"),
        )))
    })?;
    if next.scheme() != "https" {
        return Err(RequestError::Insecure {
            url: start.as_str().to_owned(),
        }
        .into());
    }
    Ok(Some(next))
}
