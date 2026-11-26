//! The input region one question draws in, and the typed questions: text, secret, and confirm.

use crate::messages;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use loomcli_core::{
    Context, EndState, Error, Issue, Region, RegionCloser, RegionOptions, Registration, ValueLink,
    question_validation_context,
};
use tokio_util::sync::CancellationToken;

use crate::controls::{HIDE_CURSOR, PASTE_OFF, SHOW_CURSOR, controls, poll_once};
use crate::line::TypedLine;
use crate::reader::{Key, Reader, ReaderCloser, Stop};
use crate::views::{
    AnsweredLine, CancelledLine, QuestionFrame, QuestionKind, QuestionViews, TypedFrame,
};

/// The answer a question's last line shows: the display string, `None` for a secret, and an
/// editor answer's line count.
pub(crate) struct Shown {
    pub(crate) value: Option<String>,
    pub(crate) lines: Option<usize>,
}

/// The future that draws the controls a dropped question leaves: the shown cursor, and bracketed
/// paste off when the run holds stdin no longer.
type ControlsDraw = Box<dyn Fn(bool) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// One question's input region. Core opens one input region at a time, so the first frame resolves
/// once this question's turn has come. When core closes the region, for a cancellation, a failure,
/// or the return of what opened it, the question draws its cancelled line as the region's last
/// frame and its reading ends. A question dropped before it finished closes its region at once
/// with its cancelled line, so the next question asks.
pub(crate) struct Asking {
    region: Region,
    message: String,
    kind: QuestionKind,
    views: QuestionViews,
    hidden: bool,
    lent: Arc<Mutex<bool>>,
    unhide: Option<Registration>,
    /// Set as the question is dropped before it finished, so its own close draws the cancelled line.
    dropping: Arc<AtomicBool>,
    reading: ReaderCloser,
    draw_controls: ControlsDraw,
    finished: bool,
}

impl Drop for Asking {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        if let Some(unhide) = self.unhide.take() {
            unhide.remove();
        }
        let released = self.reading.close();
        self.dropping.store(true, Ordering::SeqCst);
        // The close runs at the first poll, before the end's first await: the region leaves the
        // stack at once with its cancelled line queued as its last frame, and the next input region
        // opens. The controls draw takes its place in stderr's order behind that close.
        let region = self.region.clone();
        let ended: Pin<Box<dyn Future<Output = ()> + Send>> = Box::pin(async move {
            let _ = region.end(EndState::Ended, None).await;
        });
        // A question still waiting for its turn hid no cursor; while another question holds
        // stdin, it leaves the terminal's controls to that one.
        let mut closing = vec![ended];
        if self.hidden || released {
            closing.push((self.draw_controls)(released));
        }
        for future in closing {
            if let Some(rest) = poll_first(future) {
                if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                    drop(runtime.spawn(rest));
                }
            }
        }
    }
}

/// Polls `future` once; answers it when it has more to do.
fn poll_first(
    mut future: Pin<Box<dyn Future<Output = ()> + Send>>,
) -> Option<Pin<Box<dyn Future<Output = ()> + Send>>> {
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    match future.as_mut().poll(&mut context) {
        std::task::Poll::Ready(()) => None,
        std::task::Poll::Pending => Some(future),
    }
}

impl Asking {
    pub(crate) fn open<I, R: 'static>(
        context: &Context<I, R>,
        message: &str,
        kind: QuestionKind,
        reader: &Reader,
    ) -> Asking {
        let views = QuestionViews::new();
        let region = context.out.region(RegionOptions::new().input());
        let cancelled = Arc::clone(&views.cancelled);
        let owned = message.to_owned();
        let abandoned = reader.abandon_flag();
        let session = reader.session();
        let dropping = Arc::new(AtomicBool::new(false));
        let gone = Arc::clone(&dropping);
        region.on_close(move |region| {
            let closer = region.closed_by();
            if closer == Some(RegionCloser::End) && !gone.load(Ordering::SeqCst) {
                return;
            }
            drop(region.draw(&CancelledLine::new(owned), &*cancelled));
            if closer == Some(RegionCloser::Cancellation) {
                // The terminal is cooked again at the moment of the abort.
                session.release();
            } else if closer != Some(RegionCloser::End) {
                *abandoned.lock().unwrap_or_else(PoisonError::into_inner) = true;
            }
        });
        let out = context.out.clone();
        let draw_controls: ControlsDraw = Box::new(move |released| {
            let out = out.clone();
            Box::pin(async move {
                let text = if released {
                    format!("{SHOW_CURSOR}{PASTE_OFF}")
                } else {
                    SHOW_CURSOR.to_owned()
                };
                let _ = out.draw(text.as_str(), &controls()).await;
            })
        });
        Asking {
            region,
            message: message.to_owned(),
            kind,
            views,
            hidden: false,
            lent: Arc::new(Mutex::new(false)),
            unhide: None,
            dropping,
            reading: reader.closer(),
            draw_controls,
            finished: false,
        }
    }

    /// The token cancelled when the region closes.
    pub(crate) fn signal(&self) -> CancellationToken {
        self.region.signal()
    }

    /// Draws a frame, hiding the cursor after the first.
    pub(crate) async fn frame<I, R: 'static>(
        &mut self,
        context: &Context<I, R>,
        data: QuestionFrame,
    ) -> Result<(), Error> {
        self.region.draw(&data, &*self.views.frame).await?;
        if !self.hidden {
            self.hidden = true;
            let lent = Arc::clone(&self.lent);
            let host = Arc::clone(&context.host);
            self.unhide = Some(context.on_resume(move || {
                if !*lent.lock().unwrap_or_else(PoisonError::into_inner) {
                    poll_once(host.stderr().write(HIDE_CURSOR.as_bytes()));
                }
            }));
            context.out.draw(HIDE_CURSOR, &controls()).await?;
        }
        Ok(())
    }

    /// Marks the terminal lent to a child, while which a resume hides no cursor.
    pub(crate) fn lend(&self, lent: bool) {
        *self.lent.lock().unwrap_or_else(PoisonError::into_inner) = lent;
    }

    /// The answered or cancelled line, the region's close, and the cursor shown again, with
    /// bracketed paste turned off when the run's last open question `released` stdin.
    pub(crate) async fn finish<I, R: 'static>(
        mut self,
        context: &Context<I, R>,
        answer: Option<Shown>,
        released: bool,
    ) -> Result<(), Error> {
        self.finished = true;
        if let Some(unhide) = self.unhide.take() {
            unhide.remove();
        }
        let mut result = Ok(());
        if self.region.closed_by().is_none() {
            let drawn = match answer {
                Some(shown) => {
                    let mut line =
                        AnsweredLine::new(self.message.clone(), shown.value).kind(self.kind);
                    line.lines = shown.lines;
                    self.region.draw(&line, &*self.views.answered).await
                }
                None => {
                    self.region
                        .draw(
                            &CancelledLine::new(self.message.clone()),
                            &*self.views.cancelled,
                        )
                        .await
                }
            };
            result = drawn.and(Ok(()));
            let ended = self.region.end(EndState::Ended, None).await;
            result = result.and(ended);
        }
        let controls_text = if released {
            format!("{SHOW_CURSOR}{PASTE_OFF}")
        } else {
            SHOW_CURSOR.to_owned()
        };
        let shown = context.out.draw(controls_text.as_str(), &controls()).await;
        result.and(shown.map(|_| ()))
    }
}

/// The error a stopped read leaves the question with: the cancellation echo, stdin's failure, or
/// the region's close.
pub(crate) fn stopped<I, R: 'static>(context: &Context<I, R>, stop: Stop) -> Error {
    match stop {
        Stop::Failed(error) => error,
        Stop::Cancelled => context
            .signal
            .throw_if_cancelled()
            .err()
            .unwrap_or_else(region_closed),
        Stop::Abandoned => context
            .signal
            .throw_if_cancelled()
            .err()
            .unwrap_or_else(region_closed),
    }
}

/// The error of a question whose region core closed for a failure or a return.
pub(crate) fn region_closed() -> Error {
    Error::from_foreign("The question's region closed before it was answered.".into())
}

/// The first issue's message, or the sentence for a rejection with none.
pub(crate) fn first_issue(issues: &[Issue]) -> String {
    issues.first().map_or_else(
        || messages::INVALID_ANSWER.to_owned(),
        |issue| issue.message.clone(),
    )
}

/// A question begun at its call: raw mode holds and its input region is open, as the reference's
/// questions open both before their first await.
pub(crate) struct Begun {
    pub(crate) reader: Reader,
    pub(crate) draw: Asking,
}

/// Begins a question of `kind` with `message`.
pub(crate) fn begin<I, R: 'static>(
    context: &Context<I, R>,
    message: &str,
    kind: QuestionKind,
) -> Result<Begun, Error> {
    let reader = Reader::open(context)?;
    let draw = Asking::open(context, message, kind, &reader);
    Ok(Begun { reader, draw })
}

/// The typed question kinds.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TypedKind {
    Text,
    Secret,
    Confirm,
}

fn confirm_legend(hint: Option<&str>) -> String {
    match hint {
        Some("yes") => "[Y/n]",
        Some("no") => "[y/N]",
        _ => "[y/n]",
    }
    .to_owned()
}

/// What a typed question asks: its message, kind, hint, and link.
pub(crate) struct TypedQuestion<'a> {
    pub(crate) message: &'a str,
    pub(crate) kind: TypedKind,
    pub(crate) hint: Option<String>,
    pub(crate) link: Option<&'a ValueLink>,
}

/// Asks a text, secret, or confirm question: `judge` checks a submitted answer and returns its
/// output with the display string, or the issue to draw.
pub(crate) async fn ask_typed<I, R: 'static, T>(
    context: &Context<I, R>,
    question: TypedQuestion<'_>,
    begun: Begun,
    judge: impl Fn(&str, &loomcli_core::ValidationContext) -> Result<(T, Option<String>), String>,
) -> Result<T, Error> {
    let Begun {
        mut reader,
        mut draw,
    } = begun;
    let kind = match question.kind {
        TypedKind::Text => QuestionKind::Text,
        TypedKind::Secret => QuestionKind::Secret,
        TypedKind::Confirm => QuestionKind::Confirm,
    };
    let region = draw.signal();
    let mut line = TypedLine::default();
    let mut issue: Option<String> = None;
    let mut answered: Option<Shown> = None;
    let frame = |line: &TypedLine, issue: &Option<String>| {
        let secret = question.kind == TypedKind::Secret;
        let mut frame = TypedFrame::new(
            kind,
            question.message,
            if secret {
                String::new()
            } else {
                line.value.clone()
            },
        );
        frame.cursor = Some(if secret { 0 } else { line.cursor });
        frame.hint = if question.kind == TypedKind::Confirm {
            Some(confirm_legend(question.hint.as_deref()))
        } else {
            question.hint.clone()
        };
        frame.issue = issue.clone();
        QuestionFrame::Typed(frame)
    };
    let validation = question_validation_context(context, question.link, question.message);
    let outcome: Result<T, Error> = async {
        reader.start(context).await?;
        draw.frame(context, frame(&line, &issue)).await?;
        loop {
            let key = reader
                .read(context, &region)
                .await
                .map_err(|stop| stopped(context, stop))?;
            if key == Key::Eof && line.value.is_empty() {
                context.cancel();
                context.signal.throw_if_cancelled()?;
            }
            if key == Key::Enter {
                let raw = if line.value.is_empty() {
                    question.hint.clone().unwrap_or_default()
                } else {
                    line.value.clone()
                };
                let judged = judge(&raw, &validation);
                context.signal.throw_if_cancelled()?;
                match judged {
                    Ok((value, shown)) => {
                        if question.kind == TypedKind::Secret {
                            reader.discard();
                        }
                        answered = Some(Shown {
                            value: if question.kind == TypedKind::Secret {
                                None
                            } else {
                                Some(shown.unwrap_or(raw))
                            },
                            lines: None,
                        });
                        return Ok(value);
                    }
                    Err(message) => {
                        issue = Some(message);
                        draw.frame(context, frame(&line, &issue)).await?;
                    }
                }
                continue;
            }
            let copies_hint = question.kind == TypedKind::Text
                && line.value.is_empty()
                && matches!(key, Key::Tab | Key::Right);
            match (&question.hint, copies_hint) {
                (Some(hint), true) => line.set(hint),
                _ => line.edit(&key),
            }
            if question.kind != TypedKind::Secret {
                draw.frame(context, frame(&line, &issue)).await?;
            }
        }
    }
    .await;
    let released = reader.close();
    let finished = draw.finish(context, answered, released).await;
    let value = outcome?;
    finished?;
    Ok(value)
}
