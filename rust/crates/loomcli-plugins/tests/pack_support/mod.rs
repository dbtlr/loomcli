//! What the pack-view tests share: the run a view renders in on the mock process, as the
//! reference's `fixtures/view-run.ts`, `fit-render.ts`, and `pack-render.ts` give it, and the
//! readings of a render that `view-measures.ts` gives, over core's own measures.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::future::Future;
use std::sync::Arc;

use loomcli_core::style::{ThemeMapping, style};
use loomcli_core::{
    Application, Build, Context, InvocationOutcome, InvocationValues, InvokeOptions, NoInputs, Out,
    Plugin, ReleaseFacts, RenderingPolicy, ResultViews, RowSource, RowView, RowViews, RunOptions,
    Switch, ValueResult, View, ViewContext, ViewOverride,
};
use loomcli_testing::{
    MockFields, MockProcess, MockTerminal, StreamName, ViewValues, mock_process, view_context,
};
use serde::Serialize;

/// The run a view case renders in.
#[derive(Clone)]
pub struct ViewRun {
    /// One render per entry: a number is a terminal that wide, `Some(0)` a terminal that reports
    /// no width, and `None` a pipe.
    pub widths: Vec<Option<u16>>,
    pub env: Vec<(String, String)>,
    pub color: bool,
    pub modifiers: bool,
    pub hyperlinks: bool,
    pub build: Build,
    /// Installs a theme with `primary` in cyan and `dim` in bright black, as the Loom theme
    /// with `primary: style.cyan` resolves on a 16-color terminal.
    pub theme: bool,
    /// Renders through an invocation by name, which has no terminal, and answers its output.
    pub invoke: bool,
    pub overrides: Vec<ViewOverride>,
}

impl ViewRun {
    /// One render per width, color and modifiers off.
    pub fn new(widths: &[Option<u16>]) -> Self {
        Self {
            widths: widths.to_vec(),
            env: Vec::new(),
            color: false,
            modifiers: false,
            hyperlinks: false,
            build: Build::Distributed,
            theme: false,
            invoke: false,
            overrides: Vec::new(),
        }
    }

    pub fn env(mut self, name: &str, value: &str) -> Self {
        self.env.push((name.to_owned(), value.to_owned()));
        self
    }

    /// `{ color: 'always', modifiers }`.
    pub fn color(mut self, modifiers: bool) -> Self {
        self.color = true;
        self.modifiers = modifiers;
        self
    }

    /// `{ color: 'never', hyperlinks: 'always', modifiers: 'never' }`.
    pub fn hyperlinks(mut self) -> Self {
        self.hyperlinks = true;
        self
    }

    pub fn theme(mut self) -> Self {
        self.theme = true;
        self
    }

    pub fn invoke(mut self) -> Self {
        self.invoke = true;
        self
    }

    pub fn overrides(mut self, overrides: Vec<ViewOverride>) -> Self {
        self.overrides = overrides;
        self
    }

    fn policy(&self) -> RenderingPolicy {
        let switch = |on: bool| if on { Switch::Always } else { Switch::Never };
        let policy = RenderingPolicy::new()
            .color(switch(self.color))
            .modifiers(switch(self.modifiers));
        if self.hyperlinks {
            policy.hyperlinks(Switch::Always)
        } else {
            policy
        }
    }

    /// A mock whose stdout alone is on a terminal as wide as `first`, or a pipe for `None`.
    fn mock(&self, first: Option<u16>) -> Arc<MockProcess> {
        let mut fields = MockFields::new()
            .platform("linux")
            .release(ReleaseFacts::new(self.build));
        for (name, value) in &self.env {
            fields = fields.env(name, value);
        }
        if let Some(columns) = first {
            fields = fields.terminal(MockTerminal::new(columns, 24).streams([StreamName::Stdout]));
        }
        mock_process(fields)
    }

    /// The application every view case renders in, with the theme when the run names it.
    fn application(&self) -> Application<NoInputs, loomcli_core::NoResult, loomcli_core::Fresh> {
        let mut plugins: Vec<loomcli_core::AnyPlugin> = Vec::new();
        if self.theme {
            plugins.push(
                Plugin::new("@fixture/theme")
                    .theme(
                        ThemeMapping::new()
                            .entry("primary", style().cyan())
                            .entry("dim", style().bright_black()),
                    )
                    .into(),
            );
        }
        Application::new("pack-views")
            .description("Render a pack view at a live width.")
            .overrides(self.overrides.clone())
            .plugins(plugins)
    }
}

/// Splits the widths into runs of one kind, terminal or pipe, in order.
fn destinations(widths: &[Option<u16>]) -> Vec<Vec<Option<u16>>> {
    let mut groups: Vec<Vec<Option<u16>>> = Vec::new();
    for width in widths {
        match groups.last_mut() {
            Some(last) if last[0].is_none() == width.is_none() => last.push(*width),
            _ => groups.push(vec![*width]),
        }
    }
    groups
}

/// Runs the application on the mock and answers its stdout, after the run exited 0 and wrote
/// nothing to stderr.
async fn rendered<R, S: loomcli_core::State>(
    app: &Application<NoInputs, R, S>,
    mock: &Arc<MockProcess>,
    run: &ViewRun,
) -> String {
    let code = app
        .run(
            RunOptions::new()
                .process(Arc::clone(mock) as _)
                .rendering(run.policy()),
        )
        .await;
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(code.get(), 0);
    mock.stdout_text()
}

/// What `draw` printed once per width, the width changed live between renders and `--` printed
/// between them. Terminal and pipe renders run on separate mocks, joined by the separator.
pub async fn render_each<F, Fut>(run: &ViewRun, draw: F) -> String
where
    F: Fn(Out) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = loomcli_core::Outcome> + Send + 'static,
{
    let draw = Arc::new(draw);
    let mut outputs = Vec::new();
    for widths in destinations(&run.widths) {
        let mock = run.mock(widths[0]);
        let resizing = Arc::clone(&mock);
        let draw = Arc::clone(&draw);
        let app = run.application().action(move |ctx: Context| {
            let draw = Arc::clone(&draw);
            let resizing = Arc::clone(&resizing);
            let widths = widths.clone();
            async move {
                for (index, width) in widths.iter().enumerate() {
                    if let Some(width) = width {
                        resizing.resize(*width, 24);
                    }
                    if index > 0 {
                        ctx.out.print("--").await?;
                    }
                    draw(ctx.out.clone()).await?;
                }
                Ok(())
            }
        });
        if run.invoke {
            let outcome: InvocationOutcome = app
                .invoke(
                    &[],
                    InvocationValues::new(),
                    InvokeOptions::new(),
                    Some(Arc::clone(&mock) as _),
                )
                .await;
            assert_eq!(mock.stderr_text(), "");
            assert_eq!(mock.stdout_text(), "");
            match outcome {
                InvocationOutcome::Completed { output, .. } => outputs.push(output),
                _ => panic!("The invocation did not complete."),
            }
        } else {
            outputs.push(rendered(&app, &mock, run).await);
        }
    }
    outputs.join("--\n")
}

/// What a declared string result prints through `out.results`, its default view `view`.
pub async fn render_result(run: &ViewRun, data: &str, view: View<String>) -> String {
    let mock = run.mock(run.widths[0]);
    let data = data.to_owned();
    let app = run
        .application()
        .result(ResultViews::new().view("view", view))
        .action(move |ctx: Context<NoInputs, ValueResult<String>>| {
            let data = data.clone();
            async move { ctx.out.results(data).await }
        });
    rendered(&app, &mock, run).await
}

/// What a declared rows result prints through `out.results`, its views `views`.
pub async fn render_rows<R>(run: &ViewRun, rows: Vec<R>, views: RowViews<R>) -> String
where
    R: Serialize + Clone + Send + Sync + 'static,
{
    let mock = run.mock(run.widths[0]);
    let app = run.application().rows(views).action(
        move |ctx: Context<NoInputs, loomcli_core::RowsResult<R>>| {
            let rows = rows.clone();
            async move { ctx.out.results(rows).await }
        },
    );
    rendered(&app, &mock, run).await
}

/// What a row view prints over a source that yields one row per width, the terminal resized to
/// that width before the source yields the row.
pub async fn render_stream<R>(run: &ViewRun, rows: Vec<R>, view: RowView<R>) -> String
where
    R: Clone + Send + Sync + 'static,
{
    let mock = run.mock(run.widths[0]);
    let resizing = Arc::clone(&mock);
    let widths = run.widths.clone();
    let app = run.application().action(move |ctx: Context| {
        let resizing = Arc::clone(&resizing);
        let widths = widths.clone();
        let rows = rows.clone();
        let view = view.clone();
        async move {
            let source = rows.into_iter().enumerate().map(move |(index, row)| {
                if let Some(Some(width)) = widths.get(index) {
                    resizing.resize(*width, 24);
                }
                row
            });
            ctx.out
                .render(RowSource::Iter(Box::new(source)), &view)
                .await
        }
    });
    rendered(&app, &mock, run).await
}

/// The context a view renders with on a terminal `columns` wide, or on a pipe for `None`, with
/// core's own measures and color off.
pub fn measured(columns: Option<u16>) -> ViewContext {
    match columns {
        Some(columns) => view_context(ViewValues::new().columns(columns)),
        None => view_context(ViewValues::new()),
    }
}

/// The lines a render shows, its frames resolved, without the empty string after a final break.
pub fn lines_of(output: &str) -> Vec<String> {
    let shown = measured(None).plain(output);
    let mut lines: Vec<String> = shown.split('\n').map(str::to_owned).collect();
    if output.ends_with('\n') {
        lines.pop();
    }
    lines
}

/// The display width of a shown text's widest line.
pub fn width(text: &str) -> usize {
    measured(None).width(text)
}

/// The resolved text of marked text.
pub fn plain(text: &str) -> String {
    measured(None).plain(text)
}

/// The columns before a shown line's first character other than a space.
pub fn indent_of(shown: &str) -> usize {
    shown.len() - shown.trim_start_matches(' ').len()
}

/// The words a render shows, in order.
pub fn words_of(output: &str) -> Vec<String> {
    plain(output)
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

/// Lines joined as a view returns them, each ending with a newline.
pub fn lines(each: &[&str]) -> String {
    each.iter().map(|line| format!("{line}\n")).collect()
}

/// Text exactly `width` columns wide made of 4-letter words, with a final word of 4 or 5 letters.
pub fn filler(width: usize, letter: char) -> String {
    (0..width)
        .map(|index| {
            if index % 5 == 4 && index < width - 1 {
                ' '
            } else {
                letter
            }
        })
        .collect()
}

/// Whether `text` sits whole on one line.
pub fn on_one_line(each: &[String], text: &str) -> bool {
    each.iter().any(|line| line.contains(text))
}

/// Every line is at most `columns` wide.
pub fn assert_fits(each: &[String], columns: usize) {
    for line in each {
        assert!(width(line) <= columns, "{line:?} is wider than {columns}");
    }
}

/// The column, in characters, at which `fragment` starts in a shown line.
pub fn column_of(line: &str, fragment: &str) -> usize {
    line[..line.find(fragment).expect("the fragment is on the line")]
        .chars()
        .count()
}
