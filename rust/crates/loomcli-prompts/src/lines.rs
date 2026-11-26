//! One question's append-only output and line editing through the shared reader.

use std::sync::{Arc, Mutex, PoisonError};

use loomcli_core::style::width;
use loomcli_core::{BoxFuture, Context, Error, Out, Region, escape, escape_control_characters};

use crate::controls::controls;
use crate::line::TypedLine;
use crate::question::{background_draw, stopped};
use crate::reader::{Key, Reader};
use crate::views::{
    CancelledLine, QuestionFrame, QuestionLine, cancelled_line, question_frame, question_line,
};

#[derive(Clone)]
enum Row {
    Line(QuestionLine),
    Editor(Box<QuestionFrame>),
    Text(String),
    Cancelled(CancelledLine),
}

impl Row {
    async fn draw<R>(&self, out: &Out<R>) -> Result<(), Error> {
        match self {
            Self::Line(piece) => out.draw(piece, &question_line()).await?,
            Self::Editor(frame) => out.draw(&**frame, &question_frame()).await?,
            Self::Text(text) => out.draw(text.as_str(), &controls()).await?,
            Self::Cancelled(line) => out.draw(line, &cancelled_line()).await?,
        };
        Ok(())
    }
}

#[derive(Default)]
struct State {
    held: bool,
    leaving: bool,
    asking: Option<Row>,
    row_open: bool,
    reset: bool,
    lent: bool,
}

/// The line of input and the last row a question can ask again on resume.
#[derive(Clone)]
pub(crate) struct LineAsking {
    draw: Draw,
    message: String,
    state: Arc<Mutex<State>>,
    runtime: Option<tokio::runtime::Handle>,
}

type Draw = Arc<dyn Fn(Row) -> BoxFuture<'static, Result<(), Error>> + Send + Sync>;

impl LineAsking {
    pub(crate) fn new<R: 'static>(out: Out<R>, message: String) -> Self {
        Self {
            draw: Arc::new(move |row| {
                let out = out.clone();
                Box::pin(async move { row.draw(&out).await })
            }),
            message,
            state: Arc::new(Mutex::new(State::default())),
            runtime: tokio::runtime::Handle::try_current().ok(),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Waits for the terminal input region to open before the first piece can print.
    pub(crate) async fn start(&self, region: &Region) -> Result<(), Error> {
        region.draw("", &controls()).await?;
        if region.closed_by().is_some() {
            return Err(crate::question::region_closed());
        }
        self.state().held = true;
        Ok(())
    }

    /// Prints the row a suspended question was waiting for and discards the partial answer.
    pub(crate) fn resume(&self) {
        let row = {
            let mut state = self.state();
            if state.leaving || state.lent {
                return;
            }
            state.reset = true;
            let row = state.asking.clone();
            state.row_open |= row.is_some();
            row
        };
        if let Some(row) = row {
            self.draw_in_background(row);
        }
    }

    /// Marks the terminal lent to a child, such as the editor, while which a resume asks nothing
    /// again, as the reference's `reasking` skips its frame while lent.
    pub(crate) fn lend(&self, lent: bool) {
        self.state().lent = lent;
    }

    /// Prints the cancelled line once if this question had its turn.
    pub(crate) fn leave(&self) {
        let row_open = {
            let mut state = self.state();
            if !state.held || state.leaving {
                return;
            }
            state.leaving = true;
            state.row_open
        };
        if row_open {
            self.draw_in_background(Row::Text("\n".to_owned()));
        }
        self.draw_in_background(Row::Cancelled(CancelledLine::new(self.message.clone())));
    }

    fn draw_in_background(&self, row: Row) {
        // A real SIGCONT runs the resume handler on the signal thread. Enter this run's
        // runtime so a pending write can finish there after it takes its place in the queue.
        let _entered = self.runtime.as_ref().map(tokio::runtime::Handle::enter);
        let draw = Arc::clone(&self.draw);
        background_draw(async move {
            let _ = draw(row).await;
        });
    }

    /// Prints a piece once. An asking row stays open until Enter.
    pub(crate) async fn print(&self, piece: QuestionLine) -> Result<(), Error> {
        let opens_row = piece.opens_row();
        self.print_row(Row::Line(piece), opens_row).await
    }

    pub(crate) async fn reject(&self, issue: String) -> Result<(), Error> {
        self.print(QuestionLine::Issue(issue)).await
    }

    /// An editor's asking frame stays open. Its waiting frame ends before the child runs.
    pub(crate) async fn editor_frame(
        &self,
        frame: QuestionFrame,
        editing: bool,
    ) -> Result<(), Error> {
        self.print_row(Row::Editor(Box::new(frame)), !editing)
            .await?;
        if editing {
            (self.draw)(Row::Text("\n".to_owned())).await?;
        }
        Ok(())
    }

    async fn print_row(&self, row: Row, opens_row: bool) -> Result<(), Error> {
        {
            let mut state = self.state();
            state.row_open = opens_row;
            if opens_row {
                state.asking = Some(row.clone());
            }
        }
        (self.draw)(row).await
    }

    /// Reads and echoes an answer, editing at the end of the line. A secret echoes only Enter.
    pub(crate) async fn read<I, R: 'static>(
        &self,
        context: &Context<I, R>,
        reader: &mut Reader,
        region: &tokio_util::sync::CancellationToken,
        secret: bool,
    ) -> Result<String, Error> {
        let mut line = TypedLine::default();
        loop {
            let key = reader
                .read(context, region)
                .await
                .map_err(|stop| stopped(context, stop))?;
            context.signal.throw_if_cancelled()?;
            if region.is_cancelled() {
                return Err(crate::question::region_closed());
            }
            if std::mem::take(&mut self.state().reset) {
                line = TypedLine::default();
            }
            match key {
                Key::Enter => {
                    (self.draw)(Row::Text("\n".to_owned())).await?;
                    self.state().row_open = false;
                    return Ok(line.value);
                }
                Key::Eof if line.value.is_empty() => {
                    context.cancel();
                    context.signal.throw_if_cancelled()?;
                }
                Key::Text(_)
                | Key::Paste(_)
                | Key::Backspace
                | Key::KillStart
                | Key::KillWhitespace => {
                    let before = line.value.clone();
                    line.edit(&key);
                    if !secret {
                        self.echo(context, &before, &line.value).await?;
                    }
                }
                _ => {}
            }
        }
    }

    async fn echo<I, R: 'static>(
        &self,
        context: &Context<I, R>,
        before: &str,
        after: &str,
    ) -> Result<(), Error> {
        if let Some(added) = after.strip_prefix(before) {
            if !added.is_empty() {
                (self.draw)(Row::Text(escape(&escape_control_characters(added)))).await?;
            }
        } else if let Some(removed) = before.strip_prefix(after) {
            // Out drops backspaces when the terminal does not redraw. The preceding echo has
            // reached stderr before these bytes erase the cells it occupied.
            let cells = width(&escape(&escape_control_characters(removed)));
            if cells > 0 {
                context
                    .host
                    .stderr()
                    .write("\u{8} \u{8}".repeat(cells).as_bytes())
                    .await
                    .map_err(|error| Error::from_foreign(Box::new(error)))?;
            }
        }
        Ok(())
    }
}
