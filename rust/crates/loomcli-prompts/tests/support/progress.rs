//! Scenarios for progress on a mock terminal or pipe.

use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_core::{
    Application, Context, Error, Fresh, NoInputs, NoResult, Opt, RunOptions, View, ViewContext,
    ViewOverride, override_view,
};
use loomcli_prompts::views::{ProgressLine, ProgressState, progress_line};
use loomcli_prompts::{ProgressSettings, Spinner};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, StreamName, mock_process};

use super::App;

pub fn fields() -> MockFields {
    MockFields::new().env("NO_COLOR", "1").env("TERM", "xterm")
}

pub fn dim_and_warning_theme() -> loomcli_core::Plugin {
    use loomcli_core::{ThemeMapping, style};
    loomcli_core::Plugin::new("@fixture/progress-theme").theme(
        ThemeMapping::new()
            .entry("dim", style().faint())
            .entry("warning", style().yellow()),
    )
}

pub fn terminal(columns: u16, rows: u16) -> MockTerminal {
    MockTerminal::new(columns, rows).streams([StreamName::Stderr])
}

pub fn mock(columns: u16, rows: u16) -> Arc<MockProcess> {
    mock_process(fields().terminal(terminal(columns, rows)))
}

pub fn still(label: &str) -> ProgressSettings {
    ProgressSettings::new(label).spinner(Spinner::new(["◐"], 3_600_000))
}

pub fn app<F, Fut>(action: F) -> App
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    builder().action(action)
}

pub fn builder() -> Application<NoInputs, NoResult, Fresh> {
    Application::new("progress")
        .global_option("quiet", Opt::count().quiet().short('q'))
        .global_option("plain", Opt::boolean().plain())
}

pub async fn run(app: App, mock: &Arc<MockProcess>) -> u8 {
    app.run(RunOptions::new().process(mock.clone())).await.get()
}

#[derive(Clone)]
pub struct Frame {
    pub data: ProgressLine,
    pub text: String,
}

#[derive(Clone, Default)]
pub struct Frames(Arc<Mutex<Vec<Frame>>>);

impl Frames {
    pub fn view(&self) -> ViewOverride {
        self.render(|data, context| progress_line().render(data, context))
    }

    pub fn render(
        &self,
        render: impl Fn(&ProgressLine, &ViewContext) -> Result<String, Error> + Send + Sync + 'static,
    ) -> ViewOverride {
        let recording = self.clone();
        override_view(
            progress_line(),
            View::new(move |data: &ProgressLine, context: &ViewContext| {
                let text = render(data, context)?;
                recording.0.lock().unwrap().push(Frame {
                    data: data.clone(),
                    text: context.plain(&text),
                });
                Ok::<_, Error>(text)
            }),
        )
    }

    pub fn take(&self) -> Vec<Frame> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }

    pub fn last(&self) -> Frame {
        self.0.lock().unwrap().last().unwrap().clone()
    }

    pub fn lengths(&self, label: &str) -> Vec<usize> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|frame| frame.data.state == ProgressState::Running && frame.data.label == label)
            .map(|frame| frame.data.log.len())
            .collect()
    }
}

pub fn rows(label: &str, count: usize) -> String {
    (1..=count)
        .map(|n| format!("{label} {n}"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn advance(time: u64) {
    tokio::time::sleep(Duration::from_millis(time)).await;
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
}
