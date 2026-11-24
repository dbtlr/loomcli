//! Theme plugins: the named Loom theme, and a theme from a mapping. Each claims the theme slot.

use loomcli_core::style::{Ansi16Color, ColorFallbacks, ThemeValue, adaptive, style};
use loomcli_core::{Plugin, ThemeMapping};

use crate::PACKAGE_NAME;

/// The identity both factories install under, so installing both fails the identity check.
fn identity() -> String {
    format!("{PACKAGE_NAME}/theme")
}

/// One adaptive entry: a hex color on each background with its 256-color and 16-color fallbacks.
/// The hex strings are constants of this module, so a malformed one is a defect of the module.
fn side(hex: &str, ansi256: u8, ansi16: Ansi16Color) -> loomcli_core::Style {
    let fallbacks = ColorFallbacks::new().ansi256(ansi256).ansi16(ansi16);
    match style().hex_with(hex, fallbacks) {
        Ok(chain) => chain,
        Err(error) => unreachable!("the Loom palette holds a malformed color: {error}"),
    }
}

fn pair(
    (dark_hex, dark_256): (&str, u8),
    (light_hex, light_256): (&str, u8),
    ansi16: Ansi16Color,
) -> ThemeValue {
    let dark = side(dark_hex, dark_256, ansi16);
    let light = side(light_hex, light_256, ansi16);
    match adaptive(&dark, &light) {
        Ok(entry) => ThemeValue::Adaptive(entry),
        Err(error) => unreachable!("the Loom palette holds a semantic side: {error}"),
    }
}

/// The seven tokens the Loom theme supplies, in the order the reference lists them. The six
/// colored tokens adapt to the run's background. Each light side holds at least 4.5:1 on a cream
/// background, and keeps the dark side's 16-color name, because a light terminal remaps its own
/// sixteen colors. `primary` follows the terminal's foreground on either background.
fn defaults() -> [(&'static str, ThemeValue); 7] {
    [
        (
            "dim",
            pair(("#8B93A3", 245), ("#5F6B7A", 243), Ansi16Color::BrightBlack),
        ),
        (
            "error",
            pair(("#C04532", 131), ("#C04532", 131), Ansi16Color::Red),
        ),
        (
            "highlight",
            pair(("#C97B36", 172), ("#9C5A1E", 130), Ansi16Color::Yellow),
        ),
        (
            "info",
            pair(("#5B7DA3", 67), ("#4A6B91", 60), Ansi16Color::Blue),
        ),
        ("primary", ThemeValue::Plain(style().reset_foreground())),
        (
            "success",
            pair(("#7A8F7B", 108), ("#4E6B50", 65), Ansi16Color::Green),
        ),
        (
            "warning",
            pair(("#E2B93D", 178), ("#8A6D0E", 94), Ansi16Color::BrightYellow),
        ),
    ]
}

/// The Loom theme, with `overrides` replacing its default styles by name.
///
/// The six colored tokens (`dim`, `error`, `highlight`, `info`, `success`, `warning`) adapt to the
/// run's background; `primary` resets the foreground. An override replaces a default whole, both
/// sides and their fallbacks, so a concrete override prints the same bytes on either background.
/// A core name the overrides only declare (`ThemeMapping::declare`) keeps its default, and a
/// custom name keeps whatever the overrides give it, a declaration with no style included.
///
/// # Panics
///
/// When an override is a chain that names a semantic token, with the style error, as
/// `Plugin::theme` does.
#[track_caller]
pub fn loom_theme(overrides: ThemeMapping) -> Plugin {
    let mut mapping = ThemeMapping::new();
    let defaults = defaults();
    for (name, value) in overrides.entries() {
        let kept = defaults.iter().find(|(core, _)| core == name);
        mapping = match (value, kept) {
            (Some(value), _) => mapping.entry(name, value.clone()),
            (None, Some((_, default))) => mapping.entry(name, default.clone()),
            (None, None) => mapping.declare(name),
        };
    }
    for (name, default) in defaults {
        if !overrides.entries().iter().any(|(given, _)| given == name) {
            mapping = mapping.entry(name, default);
        }
    }
    Plugin::new(identity()).theme(mapping)
}

/// A theme from `mapping`: the bare palette introduces its token names and supplies no defaults
/// and no middleware.
///
/// # Panics
///
/// When an entry is a chain that names a semantic token, as `Plugin::theme` does.
#[track_caller]
pub fn theme(mapping: ThemeMapping) -> Plugin {
    Plugin::new(identity()).theme(mapping)
}
