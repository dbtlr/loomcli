//! Streams and output fixtures shared by the streamed message tests.

use std::pin::Pin;
use std::task::{Context, Poll};

use loomcli_core::{
    Application, DeclaredView, Error, MessageArguments, Out, RenderingPolicy, RunOptions, Stream,
    StreamedMessage, View, lanes, override_view,
};
use loomcli_testing::{MockFields, MockTerminal, StreamName, Write, mock_process};

pub struct PollStream<F>(pub F);

impl<F, T> Stream for PollStream<F>
where
    F: FnMut(&mut Context<'_>) -> Poll<Option<T>> + Unpin,
{
    type Item = T;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<T>> {
        (self.0)(cx)
    }
}

pub fn chunks<I, T>(parts: I) -> StreamedMessage
where
    I: IntoIterator<Item = T>,
    I::IntoIter: Send + Unpin + 'static,
    T: Into<String>,
{
    let mut parts = parts.into_iter();
    StreamedMessage::new(PollStream(move |_: &mut Context<'_>| {
        Poll::Ready(parts.next().map(|part| Ok(part.into())))
    }))
}

#[derive(Clone, Copy, Debug)]
pub enum Lane {
    Print,
    Info,
    Success,
    Warn,
    Error,
}

pub const LANES: [Lane; 5] = [
    Lane::Print,
    Lane::Info,
    Lane::Success,
    Lane::Warn,
    Lane::Error,
];

impl Lane {
    pub fn view(self) -> DeclaredView<str> {
        match self {
            Self::Print => lanes::print(),
            Self::Info => lanes::info(),
            Self::Success => lanes::success(),
            Self::Warn => lanes::warn(),
            Self::Error => lanes::error(),
        }
    }

    pub async fn write<'a>(
        self,
        out: &'a Out,
        message: impl Into<MessageArguments<'a>>,
    ) -> Result<(), Error> {
        let message = message.into();
        match self {
            Self::Print => out.print(message).await,
            Self::Info => out.info(message).await,
            Self::Success => out.success(message).await,
            Self::Warn => out.warn(message).await,
            Self::Error => out.error(message).await,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Destination {
    pub columns: Option<u16>,
    pub term: &'static str,
    pub policy: RenderingPolicy,
}

impl Destination {
    pub fn fields(self) -> MockFields {
        let mut fields = MockFields::new().env("TERM", self.term);
        if let Some(columns) = self.columns {
            fields = fields.terminal(
                MockTerminal::new(columns, 24).streams([StreamName::Stdout, StreamName::Stderr]),
            );
        }
        fields
    }

    pub async fn writes(
        self,
        lane: Lane,
        parts: Vec<String>,
        streamed: bool,
        with_override: bool,
    ) -> Vec<Write> {
        let mut app = Application::new("streamed");
        if with_override {
            let lane = lane.view();
            let original = lane.clone();
            app = app.overrides([override_view(
                lane,
                View::new(move |text, context| original.render(text, context)),
            )]);
        }
        let app = app.action(move |ctx: loomcli_core::Context| {
            let parts = parts.clone();
            async move {
                if streamed {
                    lane.write(&ctx.out, chunks(parts)).await
                } else {
                    lane.write(&ctx.out, &parts.concat()).await
                }
            }
        });
        let mock = mock_process(self.fields());
        let code = app
            .run(
                RunOptions::new()
                    .rendering(self.policy)
                    .process(mock.clone()),
            )
            .await;
        assert_eq!(code.get(), 0);
        mock.transcript()
    }
}

pub fn bytes(writes: &[Write]) -> String {
    writes
        .iter()
        .filter_map(|write| match write {
            Write::Stdout(text) | Write::Stderr(text) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}
