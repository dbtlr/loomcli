//! Ports `pack-fit.test.ts`: each pack view, rendered through `Application::run` on a mock
//! terminal 30 columns wide, fits it.

#![cfg(all(
    feature = "table",
    feature = "records",
    feature = "list",
    feature = "heading",
    feature = "rule",
    feature = "prose",
    feature = "box"
))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use std::future::Future;

use loomcli_core::Out;
use loomcli_plugins::boxed::{BoxConfig, boxed};
use loomcli_plugins::heading::{HeadingConfig, heading};
use loomcli_plugins::list::{ListConfig, list};
use loomcli_plugins::prose::prose;
use loomcli_plugins::records::{RecordsConfig, records};
use loomcli_plugins::rule::rule;
use loomcli_plugins::table::{TableConfig, table};
use pack_support::{ViewRun, render_each, width};
use serde_json::{Value, json};

/// The terminal width every case fits.
const COLUMNS: u16 = 30;

const SENTENCE: &str =
    "Three services rolled out to the staging cluster, and one health check is still warming up.";

fn tasks() -> Vec<Value> {
    vec![
        json!({ "name": "build", "note": "compiles every package and bundles the examples" }),
        json!({ "name": "check", "note": "runs the formatter, the linter, and the type checker" }),
    ]
}

/// Asserts that what `draw` wrote on a terminal `COLUMNS` wide is not empty and fits it.
async fn fits<F, Fut>(draw: F)
where
    F: Fn(Out) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = loomcli_core::Outcome> + Send + 'static,
{
    let output = render_each(&ViewRun::new(&[Some(COLUMNS)]), draw).await;
    assert_ne!(output, "");
    for line in output.split('\n') {
        assert!(width(line) <= usize::from(COLUMNS), "{line:?} is too wide");
    }
}

#[tokio::test]
async fn a_table_fits_a_narrow_terminal() {
    fits(|out| async move { out.render(&tasks(), &table(TableConfig::new())).await }).await;
}

#[tokio::test]
async fn records_fit_a_narrow_terminal() {
    fits(|out| async move {
        out.render(tasks(), &records(RecordsConfig::new("name")))
            .await
    })
    .await;
}

#[tokio::test]
async fn a_box_fits_a_narrow_terminal() {
    fits(|out| async move {
        out.render(SENTENCE, &boxed(BoxConfig::new().title("Summary")))
            .await
    })
    .await;
}

#[tokio::test]
async fn a_heading_fits_a_narrow_terminal() {
    fits(|out| async move { out.render(SENTENCE, &heading(HeadingConfig::new())).await }).await;
}

#[tokio::test]
async fn a_list_fits_a_narrow_terminal() {
    fits(|out| async move {
        out.render(
            &vec![SENTENCE, SENTENCE],
            &list(ListConfig::new().ordered(true)),
        )
        .await
    })
    .await;
}

#[tokio::test]
async fn prose_fits_a_narrow_terminal() {
    fits(|out| async move { out.render(SENTENCE, &prose()).await }).await;
}

#[tokio::test]
async fn a_rule_fits_a_narrow_terminal() {
    fits(|out| async move { out.render("Twenty-seven characters ok", &rule()).await }).await;
}
