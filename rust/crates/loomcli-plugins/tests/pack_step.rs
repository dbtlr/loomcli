//! Ports the step view through a mock process and core's view context.

#![cfg(feature = "step")]

mod pack_support;

use loomcli_core::{Message, nowrap, style};
use loomcli_plugins::step::step;
use pack_support::{ViewRun, measured, render_each};

const LONG: &str = "Running the test suite against the built packages, with coverage";

#[tokio::test]
async fn a_step_draws_the_pointer_and_ends_in_a_line_break_on_each_destination() {
    let bytes = render_each(&ViewRun::new(&[Some(80), None]), |out| async move {
        out.print(Message::new("Building 3 packages").view(&step()))
            .await
    })
    .await;
    assert_eq!(bytes, "❯ Building 3 packages\n--\n❯ Building 3 packages\n");
}

#[tokio::test]
async fn a_neutral_render_writes_the_same_step() {
    let bytes = render_each(&ViewRun::new(&[Some(80)]), |out| async move {
        out.render("Building 3 packages", &step()).await
    })
    .await;
    assert_eq!(bytes, "❯ Building 3 packages\n");
}

#[tokio::test]
async fn step_continuations_wrap_and_align_under_the_text() {
    let bytes = render_each(&ViewRun::new(&[Some(44)]), |out| async move {
        out.print(Message::new(LONG).view(&step())).await
    })
    .await;
    assert_eq!(
        bytes,
        "❯ Running the test suite against the built\n  packages, with coverage\n"
    );
}

#[tokio::test]
async fn the_step_gutter_counts_toward_the_terminal_width() {
    let bytes = render_each(&ViewRun::new(&[Some(12)]), |out| async move {
        out.print(Message::new("Build all pk").view(&step())).await
    })
    .await;
    assert_eq!(bytes, "❯ Build all\n  pk\n");
}

#[tokio::test]
async fn a_piped_step_keeps_authored_breaks_and_bare_blank_lines() {
    let bytes = render_each(
        &ViewRun::new(&[None]).env("COLUMNS", "20"),
        |out| async move {
            let text = format!("{LONG}\nsecond line\n\nafter a blank");
            out.print(Message::new(&text).view(&step())).await
        },
    )
    .await;
    assert_eq!(
        bytes,
        format!("❯ {LONG}\n  second line\n\n  after a blank\n")
    );
}

#[tokio::test]
async fn a_step_colors_its_pointer_and_wraps_author_styling_in_bold() {
    let bytes = render_each(
        &ViewRun::new(&[Some(80)]).color(true).theme(),
        |out| async move {
            let text = format!("Building {}", style().red().apply("core"));
            out.print(Message::new(&text).view(&step())).await
        },
    )
    .await;
    assert_eq!(
        bytes,
        "\u{1b}[36m❯\u{1b}[39m \u{1b}[1mBuilding \u{1b}[31mcore\u{1b}[39;22m\n"
    );
}

#[tokio::test]
async fn a_step_keeps_bold_and_author_styles_across_wrapped_lines() {
    let bytes = render_each(&ViewRun::new(&[Some(8)]).color(true), |out| async move {
        let text = format!("aa {} ee", style().red().apply("bb cc dd"));
        out.print(Message::new(&text).view(&step())).await
    })
    .await;
    assert_eq!(
        bytes,
        "❯ \u{1b}[1maa \u{1b}[31mbb\u{1b}[39;22m\n  \u{1b}[31;1mcc dd\u{1b}[39;22m\n  \u{1b}[1mee\u{1b}[22m\n"
    );
}

#[tokio::test]
async fn a_step_on_the_linux_console_uses_the_compatibility_pointer() {
    let bytes = render_each(
        &ViewRun::new(&[Some(12)]).env("TERM", "linux"),
        |out| async move {
            out.print(Message::new("Build all packages").view(&step()))
                .await
        },
    )
    .await;
    assert_eq!(bytes, "> Build all\n  packages\n");
}

#[test]
fn empty_step_text_draws_nothing() -> Result<(), loomcli_core::Error> {
    let view = step::<str>();
    for text in [String::new(), style().red().apply(""), nowrap("")] {
        assert_eq!(view.render(&text, &measured(Some(30)))?, "");
        assert_eq!(view.render(&text, &measured(None))?, "");
    }
    Ok(())
}
