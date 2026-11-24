//! The one HTTPS exchange the plugin makes at a time: a `GET` that follows no redirect. The plugin
//! follows redirects itself, so a [`Transport`] answers each response as it came. The plugin's
//! default is [`HttpsTransport`]; a test substitutes a scripted transport through
//! [`SelfUpdate::transport`](super::SelfUpdate::transport).

use std::fmt;
use std::future::Future;
use std::io;
use std::sync::{Arc, OnceLock};

use loomcli_core::BoxFuture;

/// A response's body, read whole once the plugin asks for it.
pub type BodyFuture = BoxFuture<'static, io::Result<Vec<u8>>>;

/// One response, as a [`Transport`] answers it: the status, the `Location` header when there is
/// one, and the body, which the plugin reads only for a `200` at the end of the redirects.
#[must_use]
pub struct TransportResponse {
    pub(crate) status: u16,
    pub(crate) location: Option<String>,
    pub(crate) body: BodyFuture,
}

impl fmt::Debug for TransportResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TransportResponse")
            .field("status", &self.status)
            .field("location", &self.location)
            .finish_non_exhaustive()
    }
}

impl TransportResponse {
    /// A response with this status, no `Location`, and an empty body.
    pub fn new(status: u16) -> Self {
        Self {
            status,
            location: None,
            body: Box::pin(async { Ok(Vec::new()) }),
        }
    }

    /// A redirect: this status and the `Location` header's value, as the server sent it, which the
    /// plugin resolves against the URL it requested.
    pub fn redirect(status: u16, location: impl Into<String>) -> Self {
        Self {
            location: Some(location.into()),
            ..Self::new(status)
        }
    }

    /// Sets the `Location` header's value.
    pub fn location(self, location: impl Into<String>) -> Self {
        Self {
            location: Some(location.into()),
            ..self
        }
    }

    /// Sets the body to these bytes.
    pub fn body(self, bytes: impl Into<Vec<u8>>) -> Self {
        let bytes = bytes.into();
        self.body_with(async move { Ok(bytes) })
    }

    /// Sets the body to what `read` resolves: the whole body, or the error of a connection that
    /// ended before the body did.
    pub fn body_with(
        self,
        read: impl Future<Output = io::Result<Vec<u8>>> + Send + 'static,
    ) -> Self {
        Self {
            body: Box::pin(read),
            ..self
        }
    }
}

/// How the plugin makes one HTTPS request: a `GET` of `url` that follows no redirect, sends no
/// credential, and adds no time limit. It answers the response, or the error of a request that got
/// none. The plugin drops the returned future, or the body's, when the run is cancelled, so neither
/// needs to read the run's signal.
pub trait Transport: Send + Sync + 'static {
    /// Requests `url`, an absolute `https:` URL.
    fn get(&self, url: &str) -> BoxFuture<'static, io::Result<TransportResponse>>;
}

/// The plugin's default transport: `reqwest` over rustls, with the platform's certificate
/// verifier, no redirect followed, no proxy, and no time limit. The client is built on the first
/// request, so a run that makes none reads no certificate store.
#[derive(Default)]
pub struct HttpsTransport {
    client: OnceLock<Result<reqwest::Client, Arc<reqwest::Error>>>,
}

impl fmt::Debug for HttpsTransport {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HttpsTransport")
            .finish_non_exhaustive()
    }
}

impl HttpsTransport {
    /// The transport, with no client built yet.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The client, built once.
    fn client(&self) -> io::Result<reqwest::Client> {
        self.client
            .get_or_init(|| {
                reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .no_proxy()
                    .https_only(true)
                    .build()
                    .map_err(Arc::new)
            })
            .clone()
            .map_err(io::Error::other)
    }
}

impl Transport for HttpsTransport {
    fn get(&self, url: &str) -> BoxFuture<'static, io::Result<TransportResponse>> {
        let client = self.client();
        let url = url.to_owned();
        Box::pin(async move {
            let response = client?.get(url).send().await.map_err(io::Error::other)?;
            let status = response.status().as_u16();
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned());
            let body = async move {
                response
                    .bytes()
                    .await
                    .map(|bytes| bytes.to_vec())
                    .map_err(io::Error::other)
            };
            let answer = TransportResponse::new(status).body_with(body);
            Ok(match location {
                Some(location) => answer.location(location),
                None => answer,
            })
        })
    }
}
