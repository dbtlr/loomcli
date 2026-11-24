//! Translators and failure encoders.

use std::sync::Arc;

use crate::output::IntoRendered;

use super::{Error, Failure, FailureForm};

/// A translation: a foreign error type paired with the function that turns it into a failure.
/// `translate` builds it; an Application or a plugin lists it under `translators`.
#[derive(Clone)]
pub struct Translation {
    /// Answers a foreign error of the translation's type with the failure to report, or hands the
    /// error back unchanged.
    pub(crate) translate: Arc<dyn Fn(Error) -> Result<Error, Error> + Send + Sync>,
}

impl Translation {
    /// Offers `error` to this translation: the failure it returns, or the error handed back.
    pub(crate) fn offer(&self, error: Error) -> Result<Error, Error> {
        (self.translate)(error)
    }
}

/// Offers a foreign error to each translation in order, the application's first and then each
/// plugin's in installation order, and returns the first failure one returns, or the error itself
/// when none answers. A failure is never offered.
pub(crate) fn translated<'a>(
    error: Error,
    translations: impl IntoIterator<Item = &'a Translation>,
) -> Error {
    if error.failure().is_some() {
        return error;
    }
    let mut pending = error;
    for translation in translations {
        match translation.offer(pending) {
            Ok(failure) => return failure,
            Err(handed) => pending = handed,
        }
    }
    pending
}

/// Pairs the foreign error type `E` with a translator. The translator receives the error by value
/// and returns a failure, or hands the error back to pass it on to the next translation.
///
/// A translation matches a foreign error whose type is exactly `E`. Translators run synchronously,
/// the application's first, then each plugin's in installation order; the first failure wins.
pub fn translate<E, F, T>(translator: T) -> Translation
where
    E: std::error::Error + Send + Sync + 'static,
    F: Failure,
    T: Fn(E) -> Result<F, E> + Send + Sync + 'static,
{
    Translation {
        translate: Arc::new(move |error: Error| {
            error.answer_foreign(|foreign: E| translator(foreign).map(Error::from_failure))
        }),
    }
}

/// A function that encodes a failure form for a machine reader, such as one JSON line; an `Err` is
/// the encoder's failure.
pub type FailureEncoder = Arc<dyn Fn(&FailureForm) -> Result<String, Error> + Send + Sync>;

/// A failure encoder registered for one media type. A plugin lists it under `failure_encoders`.
#[derive(Clone)]
pub struct FailureEncoding {
    pub(crate) media_type: String,
    pub(crate) encoder: FailureEncoder,
}

/// Registers `encoder` for `media_type`: when the selected result view declares that media type,
/// core writes the encoded form to stderr in place of the failure view. The encoder returns the
/// text or a `Result` of it; one that fails is `broken-failure-encoder`, after core wrote the
/// failure's default text through the plain fallback path.
pub fn encode_failure<T: IntoRendered>(
    media_type: impl Into<String>,
    encoder: impl Fn(&FailureForm) -> T + Send + Sync + 'static,
) -> FailureEncoding {
    FailureEncoding {
        media_type: media_type.into(),
        encoder: Arc::new(move |form| encoder(form).into_rendered()),
    }
}

impl FailureEncoding {
    /// The media type this encoding answers.
    #[must_use]
    pub fn media_type(&self) -> &str {
        &self.media_type
    }

    /// Encodes one form: the text to write, or the encoder's failure.
    pub(crate) fn encode(&self, form: &FailureForm) -> Result<String, Error> {
        (self.encoder)(form)
    }
}
