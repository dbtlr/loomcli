//! Terminal colors: the sixteen named colors, RGB and 256-color values with their explicit
//! fallbacks, the color depth a destination renders, and the SGR codes each color writes there.

use crate::json;

/// One of the sixteen terminal colors. Each keeps its terminal palette index, so the terminal's
/// own palette decides how it looks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Ansi16Color {
    /// Palette index 0.
    Black,
    /// Palette index 1.
    Red,
    /// Palette index 2.
    Green,
    /// Palette index 3.
    Yellow,
    /// Palette index 4.
    Blue,
    /// Palette index 5.
    Magenta,
    /// Palette index 6.
    Cyan,
    /// Palette index 7.
    White,
    /// Palette index 8.
    BrightBlack,
    /// Palette index 9.
    BrightRed,
    /// Palette index 10.
    BrightGreen,
    /// Palette index 11.
    BrightYellow,
    /// Palette index 12.
    BrightBlue,
    /// Palette index 13.
    BrightMagenta,
    /// Palette index 14.
    BrightCyan,
    /// Palette index 15.
    BrightWhite,
}

impl Ansi16Color {
    /// Every named color, in palette order.
    pub const ALL: [Ansi16Color; 16] = [
        Ansi16Color::Black,
        Ansi16Color::Red,
        Ansi16Color::Green,
        Ansi16Color::Yellow,
        Ansi16Color::Blue,
        Ansi16Color::Magenta,
        Ansi16Color::Cyan,
        Ansi16Color::White,
        Ansi16Color::BrightBlack,
        Ansi16Color::BrightRed,
        Ansi16Color::BrightGreen,
        Ansi16Color::BrightYellow,
        Ansi16Color::BrightBlue,
        Ansi16Color::BrightMagenta,
        Ansi16Color::BrightCyan,
        Ansi16Color::BrightWhite,
    ];

    /// The color's name as the reference and the wire spell it, such as `brightBlack`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Ansi16Color::Black => "black",
            Ansi16Color::Red => "red",
            Ansi16Color::Green => "green",
            Ansi16Color::Yellow => "yellow",
            Ansi16Color::Blue => "blue",
            Ansi16Color::Magenta => "magenta",
            Ansi16Color::Cyan => "cyan",
            Ansi16Color::White => "white",
            Ansi16Color::BrightBlack => "brightBlack",
            Ansi16Color::BrightRed => "brightRed",
            Ansi16Color::BrightGreen => "brightGreen",
            Ansi16Color::BrightYellow => "brightYellow",
            Ansi16Color::BrightBlue => "brightBlue",
            Ansi16Color::BrightMagenta => "brightMagenta",
            Ansi16Color::BrightCyan => "brightCyan",
            Ansi16Color::BrightWhite => "brightWhite",
        }
    }

    /// The color's terminal palette index, 0 through 15.
    #[must_use]
    pub const fn index(self) -> u8 {
        self as u8
    }

    /// The color a name spells, case-sensitively, or `None` for any other text.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Ansi16Color> {
        Ansi16Color::ALL
            .into_iter()
            .find(|color| color.name() == name)
    }

    /// The color at a palette index, 0 through 15.
    pub(crate) fn from_index(index: usize) -> Option<Ansi16Color> {
        Ansi16Color::ALL.get(index).copied()
    }
}

/// The explicit fallbacks of an RGB or hex color: the 256-color index and the named color it uses
/// at those depths instead of the nearest approximation. Build it with [`ColorFallbacks::new`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct ColorFallbacks {
    ansi256: Option<u8>,
    ansi16: Option<Ansi16Color>,
}

impl ColorFallbacks {
    /// No fallback at either depth, the same as passing none.
    #[must_use]
    pub const fn new() -> ColorFallbacks {
        ColorFallbacks {
            ansi256: None,
            ansi16: None,
        }
    }

    /// The palette index the color uses at 256-color depth.
    #[must_use]
    pub const fn ansi256(mut self, index: u8) -> ColorFallbacks {
        self.ansi256 = Some(index);
        self
    }

    /// The named color the color uses at 16-color depth.
    #[must_use]
    pub const fn ansi16(mut self, color: Ansi16Color) -> ColorFallbacks {
        self.ansi16 = Some(color);
        self
    }

    /// The 256-color fallback, if one was given.
    #[must_use]
    pub const fn ansi256_index(&self) -> Option<u8> {
        self.ansi256
    }

    /// The 16-color fallback, if one was given.
    #[must_use]
    pub const fn ansi16_color(&self) -> Option<Ansi16Color> {
        self.ansi16
    }

    fn is_empty(&self) -> bool {
        self.ansi256.is_none() && self.ansi16.is_none()
    }
}

/// The explicit fallback of a 256-color value: the named color it uses at 16-color depth. Build it
/// with [`Ansi256Fallbacks::new`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Ansi256Fallbacks {
    ansi16: Option<Ansi16Color>,
}

impl Ansi256Fallbacks {
    /// No fallback, the same as passing none.
    #[must_use]
    pub const fn new() -> Ansi256Fallbacks {
        Ansi256Fallbacks { ansi16: None }
    }

    /// The named color the value uses at 16-color depth.
    #[must_use]
    pub const fn ansi16(mut self, color: Ansi16Color) -> Ansi256Fallbacks {
        self.ansi16 = Some(color);
        self
    }

    /// The 16-color fallback, if one was given.
    #[must_use]
    pub const fn ansi16_color(&self) -> Option<Ansi16Color> {
        self.ansi16
    }
}

/// One foreground or background color of a style operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Color {
    /// A named terminal color.
    Named(Ansi16Color),
    /// An RGB color, with its explicit fallbacks.
    Rgb {
        /// The red channel.
        red: u8,
        /// The green channel.
        green: u8,
        /// The blue channel.
        blue: u8,
        /// The fallbacks at lower depths.
        fallbacks: ColorFallbacks,
    },
    /// A 256-color palette index, with its explicit fallback.
    Ansi256 {
        /// The palette index.
        index: u8,
        /// The fallback at 16-color depth.
        fallbacks: Ansi256Fallbacks,
    },
}

impl Color {
    /// Appends the color as the wire spells it.
    pub(crate) fn write_json(&self, out: &mut String) {
        match self {
            Color::Named(color) => json::write_string(out, color.name()),
            Color::Rgb {
                red,
                green,
                blue,
                fallbacks,
            } => {
                out.push_str(&format!("[\"rgb\",{red},{green},{blue}"));
                if !fallbacks.is_empty() {
                    out.push_str(",{");
                    let mut members = Vec::new();
                    if let Some(color) = fallbacks.ansi16 {
                        members.push(format!("\"ansi16\":\"{}\"", color.name()));
                    }
                    if let Some(index) = fallbacks.ansi256 {
                        members.push(format!("\"ansi256\":{index}"));
                    }
                    out.push_str(&members.join(","));
                    out.push('}');
                }
                out.push(']');
            }
            Color::Ansi256 { index, fallbacks } => {
                out.push_str(&format!("[\"ansi256\",{index}"));
                if let Some(color) = fallbacks.ansi16 {
                    out.push_str(&format!(",{{\"ansi16\":\"{}\"}}", color.name()));
                }
                out.push(']');
            }
        }
    }
}

/// The color depth a destination renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ColorDepth {
    /// The sixteen named colors.
    Ansi16,
    /// The conventional xterm 256-color palette.
    Ansi256,
    /// 24-bit RGB.
    Truecolor,
}

/// The first sixteen entries of the xterm palette, the 16-color approximation target.
const BASIC_PALETTE: [[u8; 3]; 16] = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
];

/// One step of the xterm color cube.
fn cube_channel(value: usize) -> i64 {
    if value == 0 {
        0
    } else {
        55 + i64::try_from(value).unwrap_or(0) * 40
    }
}

/// The RGB value of one xterm palette index.
fn palette_rgb(index: usize) -> [i64; 3] {
    if let Some(basic) = BASIC_PALETTE.get(index) {
        return basic.map(i64::from);
    }
    if index >= 232 {
        let value = 8 + i64::try_from(index - 232).unwrap_or(0) * 10;
        return [value, value, value];
    }
    let cube = index - 16;
    [
        cube_channel(cube / 36),
        cube_channel((cube / 6) % 6),
        cube_channel(cube % 6),
    ]
}

/// The palette index below `limit` closest to an RGB value by squared distance, the lower index
/// breaking ties.
fn nearest(rgb: [i64; 3], limit: usize) -> usize {
    let mut closest = 0;
    let mut distance = i64::MAX;
    for index in 0..limit {
        let candidate = palette_rgb(index);
        let next = (rgb[0] - candidate[0]).pow(2)
            + (rgb[1] - candidate[1]).pow(2)
            + (rgb[2] - candidate[2]).pow(2);
        if next < distance {
            distance = next;
            closest = index;
        }
    }
    closest
}

/// The SGR parameters that set a color at a depth, or reset it to the terminal default when the
/// color is `None`.
pub(crate) fn color_code(color: Option<&Color>, background: bool, depth: ColorDepth) -> String {
    let offset = if background { 10 } else { 0 };
    let Some(color) = color else {
        return (39 + offset).to_string();
    };
    let index = match color {
        Color::Named(named) => usize::from(named.index()),
        Color::Rgb {
            red,
            green,
            blue,
            fallbacks,
        } => match (depth, fallbacks.ansi16, fallbacks.ansi256) {
            (ColorDepth::Truecolor, _, _) => {
                return format!("{};2;{red};{green};{blue}", 38 + offset);
            }
            (ColorDepth::Ansi16, Some(named), _) => usize::from(named.index()),
            (ColorDepth::Ansi256, _, Some(index)) => usize::from(index),
            (ColorDepth::Ansi16, None, _) => {
                nearest([red, green, blue].map(|channel| i64::from(*channel)), 16)
            }
            (ColorDepth::Ansi256, _, None) => {
                nearest([red, green, blue].map(|channel| i64::from(*channel)), 256)
            }
        },
        Color::Ansi256 { index, fallbacks } => match (depth, fallbacks.ansi16) {
            (ColorDepth::Ansi16, Some(named)) => usize::from(named.index()),
            (ColorDepth::Ansi16, None) => nearest(palette_rgb(usize::from(*index)), 16),
            _ => usize::from(*index),
        },
    };
    if index < 8 {
        (30 + index + offset).to_string()
    } else if index < 16 {
        (90 + index - 8 + offset).to_string()
    } else {
        format!("{};5;{index}", 38 + offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cube_and_gray_ramp_follow_xterm() {
        assert_eq!(palette_rgb(16), [0, 0, 0]);
        assert_eq!(palette_rgb(196), [255, 0, 0]);
        assert_eq!(palette_rgb(108), [135, 175, 135]);
        assert_eq!(palette_rgb(232), [8, 8, 8]);
        assert_eq!(palette_rgb(255), [238, 238, 238]);
    }

    #[test]
    fn rgb_approximates_to_the_nearest_lower_index() {
        assert_eq!(nearest([255, 0, 0], 16), 9);
        assert_eq!(nearest([255, 0, 0], 256), 9);
        assert_eq!(nearest([122, 143, 123], 16), 8);
    }
}
