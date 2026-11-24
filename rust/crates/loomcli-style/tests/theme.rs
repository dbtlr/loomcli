//! Themes and adaptive entries: the resolution `theme-preparation.test.ts` proves once a theme is
//! installed, and the adaptive-entry rules of `docs/core/background.md`.

mod common;

use common::Facts;
use loomcli_style::{
    AdaptiveStyle, Ansi16Color, Background, Capabilities, ColorDepth, ColorFallbacks, Renderer,
    RenderingPolicy, StyleError, Switch, Theme, ThemeMapping, adaptive, style,
};

#[test]
fn a_validated_theme_resolves_its_entry() {
    let facts = Facts::new()
        .rendering(RenderingPolicy::new().color(Switch::Always))
        .theme(ThemeMapping::new().entry("issue", style().cyan()));
    assert_eq!(
        facts.resolve(&format!("{}\n", style().token("issue").apply("invalid"))),
        "\u{1b}[36minvalid\u{1b}[39m\n"
    );
}

#[test]
fn a_theme_entry_cannot_reference_a_token() {
    let mapping = ThemeMapping::new().entry("highlight", style().info().bold());
    assert_eq!(
        Theme::build(&mapping),
        Err(StyleError::ThemeEntry("highlight".to_owned()))
    );
    assert_eq!(
        StyleError::ThemeEntry("highlight".to_owned()).to_string(),
        "Theme entry \"highlight\" is not an unapplied concrete style chain."
    );
}

#[test]
fn an_adaptive_style_takes_two_concrete_chains() -> Result<(), StyleError> {
    assert_eq!(
        adaptive(&style().info(), &style().red()),
        Err(StyleError::AdaptiveSide)
    );
    assert_eq!(
        StyleError::AdaptiveSide.to_string(),
        "Adaptive styles take an unapplied concrete style chain for dark and for light."
    );
    let sides = AdaptiveStyle::new(&style().red(), &style().blue())?;
    assert_eq!(sides.dark(), style().red().operations());
    assert_eq!(sides.light(), style().blue().operations());
    Ok(())
}

fn truecolor() -> Capabilities {
    Capabilities {
        color: true,
        modifiers: true,
        hyperlinks: false,
        terminal_controls: false,
        depth: ColorDepth::Truecolor,
        main_glyphs: true,
    }
}

#[test]
fn an_adaptive_entry_resolves_to_the_side_of_the_runs_background() -> Result<(), StyleError> {
    let highlight = adaptive(
        &style().hex_with(
            "#C97B36",
            ColorFallbacks::new()
                .ansi256(172)
                .ansi16(Ansi16Color::Yellow),
        )?,
        &style().hex_with(
            "#9C5A1E",
            ColorFallbacks::new()
                .ansi256(130)
                .ansi16(Ansi16Color::Yellow),
        )?,
    )?;
    let theme = Theme::build(
        &ThemeMapping::new()
            .entry("highlight", highlight)
            .entry("identifier", style().cyan()),
    )?;
    assert!(theme.adapts());
    assert_eq!(
        theme.names().collect::<Vec<_>>(),
        ["highlight", "identifier"]
    );
    let text = format!(
        "{} {}",
        style().highlight().apply("Saved"),
        style().token("identifier").apply("notes.md")
    );
    let dark = "\u{1b}[38;2;201;123;54mSaved\u{1b}[39m \u{1b}[36mnotes.md\u{1b}[39m";
    let light = "\u{1b}[38;2;156;90;30mSaved\u{1b}[39m \u{1b}[36mnotes.md\u{1b}[39m";
    for (background, written) in [
        (Some(Background::Light), light),
        (Some(Background::Dark), dark),
        (None, dark),
    ] {
        assert_eq!(
            Renderer::new(truecolor(), theme.palette(background)).resolve(&text),
            written,
            "{background:?}"
        );
    }
    Ok(())
}

#[test]
fn a_plain_theme_does_not_adapt_and_a_declared_name_maps_to_nothing() -> Result<(), StyleError> {
    let theme = Theme::build(
        &ThemeMapping::new()
            .entry("primary", style().reset_foreground())
            .declare("custom")
            .entry("primary", style().green()),
    )?;
    assert!(!theme.adapts());
    let palette = theme.palette(None);
    assert_eq!(palette.get("custom"), Some(&[][..]));
    assert_eq!(palette.get("primary"), Some(style().green().operations()));
    assert!(palette.contains("custom"));
    assert!(!palette.contains("missing"));
    // A declared custom name is recognized, so its frame resolves rather than staying literal.
    let renderer = Renderer::new(truecolor(), palette);
    assert_eq!(renderer.resolve(&style().token("custom").apply("x")), "x");
    let unknown = style().token("missing").apply("x");
    assert_eq!(renderer.resolve(&unknown), unknown);
    Ok(())
}
