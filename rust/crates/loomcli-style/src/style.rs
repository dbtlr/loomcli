//! The style builder and the helpers that produce marked strings: style spans, padding, no-wrap
//! frames, adaptive theme entries, and the literal escape.

use std::fmt;

use crate::color::{Ansi16Color, Ansi256Fallbacks, Color, ColorFallbacks};
use crate::json;

/// Begins a frame header.
pub(crate) const OPEN: char = '\u{E000}';
/// Ends a frame header and begins its body.
pub(crate) const HEADER_END: char = '\u{E001}';
/// Closes the innermost active frame.
pub(crate) const CLOSE: char = '\u{E002}';
/// Introduces one escaped delimiter.
pub(crate) const ESCAPE: char = '\u{E003}';
/// The first UTF-8 byte of every delimiter, and of no character outside U+E000 through U+EFFF, so
/// text without this byte holds no delimiter.
pub(crate) const DELIMITER_LEAD_BYTE: u8 = 0xee;

/// The largest integer a JavaScript number holds exactly, the bound on a padding width.
pub(crate) const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// The core semantic token names. They are names, not appearances: a theme maps them.
pub const CORE_TOKENS: [&str; 7] = [
    "dim",
    "primary",
    "highlight",
    "success",
    "warning",
    "error",
    "info",
];

/// A terminal modifier. There is no blink modifier; `dim` is a semantic token, `faint` the
/// modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Modifier {
    /// SGR 1, reset by 22.
    Bold,
    /// SGR 2, reset by 22.
    Faint,
    /// SGR 3, reset by 23.
    Italic,
    /// SGR 4, reset by 24.
    Underline,
    /// SGR 7, reset by 27.
    Inverse,
    /// SGR 8, reset by 28.
    Hidden,
    /// SGR 9, reset by 29.
    Strikethrough,
    /// SGR 53, reset by 55.
    Overline,
}

impl Modifier {
    /// Every modifier, in catalog order.
    pub const ALL: [Modifier; 8] = [
        Modifier::Bold,
        Modifier::Faint,
        Modifier::Italic,
        Modifier::Underline,
        Modifier::Inverse,
        Modifier::Hidden,
        Modifier::Strikethrough,
        Modifier::Overline,
    ];

    /// The modifier's name as the wire spells it, such as `strikethrough`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Modifier::Bold => "bold",
            Modifier::Faint => "faint",
            Modifier::Italic => "italic",
            Modifier::Underline => "underline",
            Modifier::Inverse => "inverse",
            Modifier::Hidden => "hidden",
            Modifier::Strikethrough => "strikethrough",
            Modifier::Overline => "overline",
        }
    }

    /// The modifier a name spells, case-sensitively.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Modifier> {
        Modifier::ALL
            .into_iter()
            .find(|modifier| modifier.name() == name)
    }

    /// The SGR parameter that turns the modifier on.
    pub(crate) const fn on(self) -> u8 {
        match self {
            Modifier::Bold => 1,
            Modifier::Faint => 2,
            Modifier::Italic => 3,
            Modifier::Underline => 4,
            Modifier::Inverse => 7,
            Modifier::Hidden => 8,
            Modifier::Strikethrough => 9,
            Modifier::Overline => 53,
        }
    }

    /// The SGR parameter that turns the modifier off; bold and faint share 22.
    pub(crate) const fn off(self) -> u8 {
        match self {
            Modifier::Bold | Modifier::Faint => 22,
            Modifier::Italic => 23,
            Modifier::Underline => 24,
            Modifier::Inverse => 27,
            Modifier::Hidden => 28,
            Modifier::Strikethrough => 29,
            Modifier::Overline => 55,
        }
    }
}

/// One operation of a style chain, applied in order to the enclosing attributes.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Operation {
    /// Apply the installed theme's mapping for a semantic name; no mapping applies nothing.
    Token(String),
    /// Set the foreground.
    Foreground(Color),
    /// Set the background.
    Background(Color),
    /// Enable one modifier.
    Modifier(Modifier),
    /// Clear colors and modifiers.
    Reset,
    /// Restore the terminal's foreground default.
    ResetForeground,
    /// Restore the terminal's background default.
    ResetBackground,
}

impl Operation {
    fn write_json(&self, out: &mut String) {
        match self {
            Operation::Token(name) => {
                out.push_str("[\"token\",");
                json::write_string(out, name);
                out.push(']');
            }
            Operation::Foreground(color) => {
                out.push_str("[\"foreground\",");
                color.write_json(out);
                out.push(']');
            }
            Operation::Background(color) => {
                out.push_str("[\"background\",");
                color.write_json(out);
                out.push(']');
            }
            Operation::Modifier(modifier) => {
                out.push_str(&format!("[\"modifier\",\"{}\"]", modifier.name()));
            }
            Operation::Reset => out.push_str("[\"reset\"]"),
            Operation::ResetForeground => out.push_str("[\"resetForeground\"]"),
            Operation::ResetBackground => out.push_str("[\"resetBackground\"]"),
        }
    }
}

/// A failure of a style helper's arguments, raised when the helper is called, before any marked
/// string exists.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum StyleError {
    /// A hex color that is not `#RGB` or `#RRGGBB`.
    InvalidHex,
    /// A padding width above the largest safe integer.
    PaddingWidth,
    /// A wrap width that is zero or above the largest safe integer.
    WrapWidth,
    /// An adaptive style side that holds a semantic token.
    AdaptiveSide,
    /// A theme entry that holds a semantic token, with the entry's name.
    ThemeEntry(String),
}

impl fmt::Display for StyleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StyleError::InvalidHex => formatter.write_str("Hex colors must use #RGB or #RRGGBB."),
            StyleError::PaddingWidth => {
                formatter.write_str("Padding width must be a nonnegative safe integer.")
            }
            StyleError::WrapWidth => {
                formatter.write_str("Wrap width must be a positive safe integer.")
            }
            StyleError::AdaptiveSide => formatter.write_str(
                "Adaptive styles take an unapplied concrete style chain for dark and for light.",
            ),
            StyleError::ThemeEntry(name) => write!(
                formatter,
                "Theme entry \"{name}\" is not an unapplied concrete style chain."
            ),
        }
    }
}

impl std::error::Error for StyleError {}

/// A frame: the open delimiter, the compact JSON header with any delimiter it holds written as a
/// `\u` escape, the header end, the body, and the close.
pub(crate) fn frame(header: &str, body: &str) -> String {
    let mut out = String::with_capacity(header.len() + body.len() + 12);
    out.push(OPEN);
    for character in header.chars() {
        if (OPEN..=ESCAPE).contains(&character) {
            out.push_str(&format!("\\u{:x}", u32::from(character)));
        } else {
            out.push(character);
        }
    }
    out.push(HEADER_END);
    out.push_str(body);
    out.push(CLOSE);
    out
}

/// The text with each of the four delimiters replaced by the escape delimiter and its four
/// uppercase hexadecimal digits, so it displays literally. It keeps every other character, ANSI
/// sequences included, and it is not idempotent: escaping twice displays the first escape.
#[must_use]
pub fn escape(text: &str) -> String {
    // Every delimiter encodes with the lead byte 0xEE, so text without that byte holds none.
    if !text.as_bytes().contains(&DELIMITER_LEAD_BYTE) {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        if (OPEN..=ESCAPE).contains(&character) {
            out.push(ESCAPE);
            out.push_str(&format!("{:X}", u32::from(character)));
        } else {
            out.push(character);
        }
    }
    out
}

/// Where padding places its text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Alignment {
    /// Spaces after the text.
    #[default]
    Left,
    /// Spaces before the text.
    Right,
    /// Spaces on both sides, the odd one on the right.
    Center,
}

impl Alignment {
    /// The alignment's name as the wire spells it.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Alignment::Left => "left",
            Alignment::Right => "right",
            Alignment::Center => "center",
        }
    }
}

/// A marked string that pads each line of `text` to at least `minimum_width` columns with spaces,
/// once glyph forms are selected for the destination. It never truncates, expands tabs within each
/// line first, keeps line breaks, and adds no padded line after a trailing newline.
///
/// # Errors
///
/// [`StyleError::PaddingWidth`] when the width is above `2^53 - 1`, which no frame can hold.
pub fn pad(text: &str, minimum_width: usize, align: Alignment) -> Result<String, StyleError> {
    let width = u64::try_from(minimum_width).map_err(|_| StyleError::PaddingWidth)?;
    if width > MAX_SAFE_INTEGER {
        return Err(StyleError::PaddingWidth);
    }
    Ok(frame(
        &format!("[\"pad\",{width},\"{}\"]", align.name()),
        text,
    ))
}

/// A marked string that line breaking keeps whole, such as a path that holds spaces. It resolves
/// to its body exactly and measures as its body; only wrapping and line splitting read it.
#[must_use]
pub fn nowrap(text: &str) -> String {
    frame("[\"nowrap\"]", text)
}

/// The root style: a chain with no operation, from which every style is built.
#[must_use]
pub fn style() -> Style {
    Style::new()
}

macro_rules! named_colors {
    ($($foreground:ident $background:ident $color:ident;)*) => {
        $(
            #[doc = concat!("This chain with the `", stringify!($color), "` foreground.")]
            #[must_use]
            pub fn $foreground(&self) -> Style {
                self.then(Operation::Foreground(Color::Named(Ansi16Color::$color)))
            }

            #[doc = concat!("This chain with the `", stringify!($color), "` background.")]
            #[must_use]
            pub fn $background(&self) -> Style {
                self.then(Operation::Background(Color::Named(Ansi16Color::$color)))
            }
        )*
    };
}

macro_rules! modifiers {
    ($($method:ident $modifier:ident;)*) => {
        $(
            #[doc = concat!("This chain with the `", stringify!($method), "` modifier.")]
            #[must_use]
            pub fn $method(&self) -> Style {
                self.then(Operation::Modifier(Modifier::$modifier))
            }
        )*
    };
}

macro_rules! core_tokens {
    ($($method:ident;)*) => {
        $(
            #[doc = concat!("This chain with the `", stringify!($method), "` semantic token.")]
            #[must_use]
            pub fn $method(&self) -> Style {
                self.token(stringify!($method))
            }
        )*
    };
}

/// A style chain: an ordered list of operations that [`Style::apply`] wraps around text as a
/// marked string. Each method returns a new chain and never changes its receiver. Chains apply
/// left to right: a later color replaces only that attribute, and modifiers accumulate.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct Style {
    operations: Vec<Operation>,
}

impl Style {
    /// The root chain, with no operation.
    #[must_use]
    pub const fn new() -> Style {
        Style {
            operations: Vec::new(),
        }
    }

    /// The chain's operations, in order.
    #[must_use]
    pub fn operations(&self) -> &[Operation] {
        &self.operations
    }

    /// This chain with one more operation.
    #[must_use]
    pub fn then(&self, operation: Operation) -> Style {
        let mut operations = self.operations.clone();
        operations.push(operation);
        Style { operations }
    }

    /// The text inside a style frame of this chain's operations. Markup in the text is kept, so
    /// styles nest; escape raw data with [`escape`] first.
    #[must_use]
    pub fn apply(&self, text: &str) -> String {
        let mut header = String::from("[\"style\",[");
        for (index, operation) in self.operations.iter().enumerate() {
            if index > 0 {
                header.push(',');
            }
            operation.write_json(&mut header);
        }
        header.push_str("]]");
        frame(&header, text)
    }

    /// The text with Loom's delimiters escaped, as [`escape`] does.
    #[must_use]
    pub fn escape(&self, text: &str) -> String {
        escape(text)
    }

    /// This chain with a semantic token, a core name or one the installed theme declares. A name no
    /// theme declares makes the frame literal when it resolves; a declared name with no mapping
    /// leaves the surrounding style unchanged.
    #[must_use]
    pub fn token(&self, name: &str) -> Style {
        self.then(Operation::Token(name.to_owned()))
    }

    /// Whether the chain holds no semantic token, so it may be a theme entry.
    #[must_use]
    pub fn is_concrete(&self) -> bool {
        !self
            .operations
            .iter()
            .any(|operation| matches!(operation, Operation::Token(_)))
    }

    named_colors! {
        black bg_black Black;
        red bg_red Red;
        green bg_green Green;
        yellow bg_yellow Yellow;
        blue bg_blue Blue;
        magenta bg_magenta Magenta;
        cyan bg_cyan Cyan;
        white bg_white White;
        bright_black bg_bright_black BrightBlack;
        bright_red bg_bright_red BrightRed;
        bright_green bg_bright_green BrightGreen;
        bright_yellow bg_bright_yellow BrightYellow;
        bright_blue bg_bright_blue BrightBlue;
        bright_magenta bg_bright_magenta BrightMagenta;
        bright_cyan bg_bright_cyan BrightCyan;
        bright_white bg_bright_white BrightWhite;
    }

    modifiers! {
        bold Bold;
        faint Faint;
        italic Italic;
        underline Underline;
        inverse Inverse;
        hidden Hidden;
        strikethrough Strikethrough;
        overline Overline;
    }

    core_tokens! {
        dim;
        primary;
        highlight;
        success;
        warning;
        error;
        info;
    }

    /// This chain with a named foreground color.
    #[must_use]
    pub fn foreground(&self, color: Ansi16Color) -> Style {
        self.then(Operation::Foreground(Color::Named(color)))
    }

    /// This chain with a named background color.
    #[must_use]
    pub fn background(&self, color: Ansi16Color) -> Style {
        self.then(Operation::Background(Color::Named(color)))
    }

    /// This chain cleared of inherited colors and modifiers inside its span.
    #[must_use]
    pub fn reset(&self) -> Style {
        self.then(Operation::Reset)
    }

    /// This chain with the terminal's default foreground inside its span.
    #[must_use]
    pub fn reset_foreground(&self) -> Style {
        self.then(Operation::ResetForeground)
    }

    /// This chain with the terminal's default background inside its span.
    #[must_use]
    pub fn reset_background(&self) -> Style {
        self.then(Operation::ResetBackground)
    }

    /// This chain with an RGB foreground, approximated at lower depths.
    #[must_use]
    pub fn rgb(&self, red: u8, green: u8, blue: u8) -> Style {
        self.rgb_with(red, green, blue, ColorFallbacks::new())
    }

    /// This chain with an RGB foreground and explicit fallbacks at lower depths.
    #[must_use]
    pub fn rgb_with(&self, red: u8, green: u8, blue: u8, fallbacks: ColorFallbacks) -> Style {
        self.then(Operation::Foreground(Color::Rgb {
            red,
            green,
            blue,
            fallbacks,
        }))
    }

    /// This chain with an RGB background, approximated at lower depths.
    #[must_use]
    pub fn bg_rgb(&self, red: u8, green: u8, blue: u8) -> Style {
        self.bg_rgb_with(red, green, blue, ColorFallbacks::new())
    }

    /// This chain with an RGB background and explicit fallbacks at lower depths.
    #[must_use]
    pub fn bg_rgb_with(&self, red: u8, green: u8, blue: u8, fallbacks: ColorFallbacks) -> Style {
        self.then(Operation::Background(Color::Rgb {
            red,
            green,
            blue,
            fallbacks,
        }))
    }

    /// This chain with a hex foreground, `#RGB` or `#RRGGBB` in either case.
    ///
    /// # Errors
    ///
    /// [`StyleError::InvalidHex`] for any other text.
    pub fn hex(&self, color: &str) -> Result<Style, StyleError> {
        self.hex_with(color, ColorFallbacks::new())
    }

    /// This chain with a hex foreground and explicit fallbacks at lower depths.
    ///
    /// # Errors
    ///
    /// [`StyleError::InvalidHex`] when the color is not `#RGB` or `#RRGGBB`.
    pub fn hex_with(&self, color: &str, fallbacks: ColorFallbacks) -> Result<Style, StyleError> {
        let [red, green, blue] = hex_channels(color)?;
        Ok(self.rgb_with(red, green, blue, fallbacks))
    }

    /// This chain with a hex background, `#RGB` or `#RRGGBB` in either case.
    ///
    /// # Errors
    ///
    /// [`StyleError::InvalidHex`] for any other text.
    pub fn bg_hex(&self, color: &str) -> Result<Style, StyleError> {
        self.bg_hex_with(color, ColorFallbacks::new())
    }

    /// This chain with a hex background and explicit fallbacks at lower depths.
    ///
    /// # Errors
    ///
    /// [`StyleError::InvalidHex`] when the color is not `#RGB` or `#RRGGBB`.
    pub fn bg_hex_with(&self, color: &str, fallbacks: ColorFallbacks) -> Result<Style, StyleError> {
        let [red, green, blue] = hex_channels(color)?;
        Ok(self.bg_rgb_with(red, green, blue, fallbacks))
    }

    /// This chain with a 256-color foreground, approximated at 16-color depth.
    #[must_use]
    pub fn ansi256(&self, index: u8) -> Style {
        self.ansi256_with(index, Ansi256Fallbacks::new())
    }

    /// This chain with a 256-color foreground and an explicit 16-color fallback.
    #[must_use]
    pub fn ansi256_with(&self, index: u8, fallbacks: Ansi256Fallbacks) -> Style {
        self.then(Operation::Foreground(Color::Ansi256 { index, fallbacks }))
    }

    /// This chain with a 256-color background, approximated at 16-color depth.
    #[must_use]
    pub fn bg_ansi256(&self, index: u8) -> Style {
        self.bg_ansi256_with(index, Ansi256Fallbacks::new())
    }

    /// This chain with a 256-color background and an explicit 16-color fallback.
    #[must_use]
    pub fn bg_ansi256_with(&self, index: u8, fallbacks: Ansi256Fallbacks) -> Style {
        self.then(Operation::Background(Color::Ansi256 { index, fallbacks }))
    }
}

/// The channels of `#RGB` or `#RRGGBB`, case-insensitively.
fn hex_channels(color: &str) -> Result<[u8; 3], StyleError> {
    let digits = color.strip_prefix('#').ok_or(StyleError::InvalidHex)?;
    if !digits.chars().all(|digit| digit.is_ascii_hexdigit()) {
        return Err(StyleError::InvalidHex);
    }
    let full: String = match digits.len() {
        3 => digits.chars().flat_map(|digit| [digit, digit]).collect(),
        6 => digits.to_owned(),
        _ => return Err(StyleError::InvalidHex),
    };
    let channel = |at: usize| {
        full.get(at..at + 2)
            .and_then(|pair| u8::from_str_radix(pair, 16).ok())
            .ok_or(StyleError::InvalidHex)
    };
    Ok([channel(0)?, channel(2)?, channel(4)?])
}

/// A theme entry that holds one concrete style for each background. Core resolves it to the side
/// that matches the run's background each time it emits the token: the light side on a light
/// background, the dark side on a dark or unknown one. It styles no text itself.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AdaptiveStyle {
    dark: Vec<Operation>,
    light: Vec<Operation>,
}

impl AdaptiveStyle {
    /// An adaptive style over two concrete chains, each checked now and copied.
    ///
    /// # Errors
    ///
    /// [`StyleError::AdaptiveSide`] when either side holds a semantic token.
    pub fn new(dark: &Style, light: &Style) -> Result<AdaptiveStyle, StyleError> {
        if !dark.is_concrete() || !light.is_concrete() {
            return Err(StyleError::AdaptiveSide);
        }
        Ok(AdaptiveStyle {
            dark: dark.operations.clone(),
            light: light.operations.clone(),
        })
    }

    /// The dark side's operations, which also serve an unknown background.
    #[must_use]
    pub fn dark(&self) -> &[Operation] {
        &self.dark
    }

    /// The light side's operations.
    #[must_use]
    pub fn light(&self) -> &[Operation] {
        &self.light
    }
}

/// An adaptive theme entry over a dark and a light concrete chain, as [`AdaptiveStyle::new`].
///
/// # Errors
///
/// [`StyleError::AdaptiveSide`] when either side holds a semantic token.
pub fn adaptive(dark: &Style, light: &Style) -> Result<AdaptiveStyle, StyleError> {
    AdaptiveStyle::new(dark, light)
}
