//! The rendering policy and the capabilities one destination resolves it to, decided from facts
//! the caller supplies: the environment, the destination's TTY flag, and its reported width.

use crate::color::ColorDepth;
use crate::environment::Environment;
use crate::style::MAX_SAFE_INTEGER;

/// A three-way policy switch: detect, force on, or force off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Switch {
    /// Decide from the destination's facts.
    #[default]
    Auto,
    /// Always on.
    Always,
    /// Always off.
    Never,
}

/// What happens to general terminal controls: cursor movement, erasure, titles, the bell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum TerminalControls {
    /// Remove them, keeping ordinary text, tabs, and line breaks.
    #[default]
    Strip,
    /// Keep complete ones; styling and hyperlinks still follow their own policies.
    Preserve,
}

/// The author's background: `Auto` leaves it to detection, `Dark` and `Light` state it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum BackgroundPolicy {
    /// Leave the background to the sources after the author's.
    #[default]
    Auto,
    /// State a dark background.
    Dark,
    /// State a light background.
    Light,
}

/// The operator's color choice from `--color` or `--no-color`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ColorChoice {
    /// A positive spelling: the `color` field becomes `Always`.
    Always,
    /// A negative spelling: the `color` field becomes `Never`.
    Never,
}

/// One rendering policy for both streams. Each field left unset acts as omitted, so a later policy
/// merged over an earlier one keeps the earlier setting. Build it with [`RenderingPolicy::new`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct RenderingPolicy {
    color: Option<Switch>,
    modifiers: Option<Switch>,
    hyperlinks: Option<Switch>,
    terminal_controls: Option<TerminalControls>,
    background: Option<BackgroundPolicy>,
}

impl RenderingPolicy {
    /// A policy with every field omitted.
    #[must_use]
    pub const fn new() -> RenderingPolicy {
        RenderingPolicy {
            color: None,
            modifiers: None,
            hyperlinks: None,
            terminal_controls: None,
            background: None,
        }
    }

    /// The policy with its color field set.
    #[must_use]
    pub const fn color(mut self, value: Switch) -> RenderingPolicy {
        self.color = Some(value);
        self
    }

    /// The policy with its modifiers field set.
    #[must_use]
    pub const fn modifiers(mut self, value: Switch) -> RenderingPolicy {
        self.modifiers = Some(value);
        self
    }

    /// The policy with its hyperlinks field set.
    #[must_use]
    pub const fn hyperlinks(mut self, value: Switch) -> RenderingPolicy {
        self.hyperlinks = Some(value);
        self
    }

    /// The policy with its terminal controls field set.
    #[must_use]
    pub const fn terminal_controls(mut self, value: TerminalControls) -> RenderingPolicy {
        self.terminal_controls = Some(value);
        self
    }

    /// The policy with its background field set.
    #[must_use]
    pub const fn background(mut self, value: BackgroundPolicy) -> RenderingPolicy {
        self.background = Some(value);
        self
    }

    /// The color field, if set.
    #[must_use]
    pub const fn color_setting(&self) -> Option<Switch> {
        self.color
    }

    /// The modifiers field, if set.
    #[must_use]
    pub const fn modifiers_setting(&self) -> Option<Switch> {
        self.modifiers
    }

    /// The hyperlinks field, if set.
    #[must_use]
    pub const fn hyperlinks_setting(&self) -> Option<Switch> {
        self.hyperlinks
    }

    /// The terminal controls field, if set.
    #[must_use]
    pub const fn terminal_controls_setting(&self) -> Option<TerminalControls> {
        self.terminal_controls
    }

    /// The background field, if set.
    #[must_use]
    pub const fn background_setting(&self) -> Option<BackgroundPolicy> {
        self.background
    }

    /// This policy with each field `over` sets replacing this one's, as an invocation's policy
    /// merges over the Application's.
    #[must_use]
    pub fn merged(&self, over: &RenderingPolicy) -> RenderingPolicy {
        RenderingPolicy {
            color: over.color.or(self.color),
            modifiers: over.modifiers.or(self.modifiers),
            hyperlinks: over.hyperlinks.or(self.hyperlinks),
            terminal_controls: over.terminal_controls.or(self.terminal_controls),
            background: over.background.or(self.background),
        }
    }

    /// This policy with the operator's color choice over its color field alone; no choice keeps it.
    #[must_use]
    pub fn chosen(&self, choice: Option<ColorChoice>) -> RenderingPolicy {
        match choice {
            None => *self,
            Some(ColorChoice::Always) => self.color(Switch::Always),
            Some(ColorChoice::Never) => self.color(Switch::Never),
        }
    }

    /// The plain form of this policy: no color, modifier, or hyperlink, whatever this policy or
    /// `FORCE_COLOR` says, with this policy's terminal controls. An invocation by name resolves its
    /// output by it.
    #[must_use]
    pub fn plain(&self) -> RenderingPolicy {
        RenderingPolicy {
            color: Some(Switch::Never),
            modifiers: Some(Switch::Never),
            hyperlinks: Some(Switch::Never),
            terminal_controls: self.terminal_controls,
            background: None,
        }
    }

    /// The policy output follows when host capture failed before argv could be read: color off in
    /// an Application that marks a color option, and nothing set in one that marks none.
    #[must_use]
    pub fn uncaptured(marked: bool) -> RenderingPolicy {
        if marked {
            RenderingPolicy::new().color(Switch::Never)
        } else {
            RenderingPolicy::new()
        }
    }
}

/// What one destination renders under a policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Capabilities {
    /// Whether foreground and background colors are written.
    pub color: bool,
    /// Whether modifiers are written.
    pub modifiers: bool,
    /// Whether OSC 8 hyperlinks are kept.
    pub hyperlinks: bool,
    /// Whether general terminal controls are kept.
    pub terminal_controls: bool,
    /// The depth colors are written at.
    pub depth: ColorDepth,
    /// Whether glyphs select their main forms rather than their compatibility forms.
    pub main_glyphs: bool,
}

impl Capabilities {
    /// The capabilities plain text is measured under: nothing written but characters, main glyph
    /// forms, 16 colors.
    pub const PLAIN: Capabilities = Capabilities {
        color: false,
        modifiers: false,
        hyperlinks: false,
        terminal_controls: false,
        depth: ColorDepth::Ansi16,
        main_glyphs: true,
    };
}

/// Whether the environment is under CI: `CI` set, nonempty, and not `false`.
#[must_use]
pub fn under_ci<E: Environment + ?Sized>(env: &E) -> bool {
    env.var("CI")
        .is_some_and(|ci| !ci.is_empty() && ci != "false")
}

/// The depth a CI system's log viewer renders, as supports-color's CI block names them: truecolor
/// for GitHub Actions, Gitea Actions, and CircleCI; 16 colors for Travis CI, AppVeyor, GitLab CI,
/// Buildkite, Drone, and Codeship; `None` for any other CI.
#[must_use]
pub fn ci_depth<E: Environment + ?Sized>(env: &E) -> Option<ColorDepth> {
    let present = |names: &[&str]| names.iter().any(|name| env.var(name).is_some());
    if present(&["GITHUB_ACTIONS", "GITEA_ACTIONS", "CIRCLECI"]) {
        return Some(ColorDepth::Truecolor);
    }
    if present(&["TRAVIS", "APPVEYOR", "GITLAB_CI", "BUILDKITE", "DRONE"])
        || env.var("CI_NAME") == Some("codeship")
    {
        return Some(ColorDepth::Ansi16);
    }
    None
}

/// The color depth the environment's hints name, in the reference's order: `COLORTERM`, a
/// truecolor `TERM`, iTerm's version, Apple Terminal, a `-256color` `TERM`, and 16 otherwise.
#[must_use]
pub fn color_depth<E: Environment + ?Sized>(env: &E) -> ColorDepth {
    let term = env.var("TERM").unwrap_or_default();
    if matches!(env.var("COLORTERM"), Some("truecolor" | "24bit"))
        || matches!(term, "xterm-kitty" | "xterm-ghostty" | "wezterm")
    {
        return ColorDepth::Truecolor;
    }
    if env.var("TERM_PROGRAM") == Some("iTerm.app") {
        let version = env.var("TERM_PROGRAM_VERSION").unwrap_or_default();
        let major: String = version.chars().take_while(char::is_ascii_digit).collect();
        let at_least_three =
            !major.is_empty() && major.parse::<f64>().is_ok_and(|value| value >= 3.0);
        return if at_least_three {
            ColorDepth::Truecolor
        } else {
            ColorDepth::Ansi256
        };
    }
    let lower = term.to_ascii_lowercase();
    if env.var("TERM_PROGRAM") == Some("Apple_Terminal")
        || lower.ends_with("-256")
        || lower.ends_with("-256color")
    {
        ColorDepth::Ansi256
    } else {
        ColorDepth::Ansi16
    }
}

/// Whether glyphs select their main forms: everywhere but the Linux console, `TERM=linux`.
#[must_use]
pub fn main_glyphs<E: Environment + ?Sized>(env: &E) -> bool {
    env.var("TERM") != Some("linux")
}

fn enabled(policy: Option<Switch>, automatic: bool) -> bool {
    match policy {
        Some(Switch::Always) => true,
        Some(Switch::Never) => false,
        Some(Switch::Auto) | None => automatic,
    }
}

/// What one destination renders under a policy, from the captured environment and whether that
/// destination is a TTY. stdout and stderr each resolve the one policy separately.
#[must_use]
pub fn capabilities<E: Environment + ?Sized>(
    env: &E,
    is_tty: bool,
    policy: &RenderingPolicy,
) -> Capabilities {
    let ci = under_ci(env);
    let log_depth = if ci { ci_depth(env) } else { None };
    let capable = is_tty && env.var("TERM") != Some("dumb") && (!ci || log_depth.is_some());
    let forced = env
        .var("FORCE_COLOR")
        .is_some_and(|value| !value.is_empty());
    let no_color = env.var("NO_COLOR").is_some_and(|value| !value.is_empty());
    Capabilities {
        color: enabled(policy.color, forced || (!no_color && capable)),
        depth: (if capable { log_depth } else { None }).unwrap_or_else(|| color_depth(env)),
        hyperlinks: enabled(policy.hyperlinks, is_tty && !ci),
        main_glyphs: main_glyphs(env),
        modifiers: enabled(policy.modifiers, forced || capable),
        terminal_controls: policy.terminal_controls == Some(TerminalControls::Preserve),
    }
}

/// A valid POSIX `COLUMNS`: ASCII digits alone, leading zeros allowed, a safe integer above zero.
#[must_use]
pub fn columns_variable(value: Option<&str>) -> Option<u64> {
    let value = value?;
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let digits = value.trim_start_matches('0');
    if digits.len() > 16 {
        return None;
    }
    let parsed: u64 = if digits.is_empty() {
        0
    } else {
        digits.parse().ok()?
    };
    (parsed > 0 && parsed <= MAX_SAFE_INTEGER).then_some(parsed)
}

/// The effective width of one destination: `None` off a terminal, and otherwise the reported
/// width narrowed by a valid `COLUMNS`, or `COLUMNS` alone on a terminal that reports none.
/// `COLUMNS` only narrows. A reported width of zero counts as none.
#[must_use]
pub fn effective_columns<E: Environment + ?Sized>(
    env: &E,
    is_tty: bool,
    reported: Option<u64>,
) -> Option<u64> {
    if !is_tty {
        return None;
    }
    let real = reported.filter(|width| *width > 0 && *width <= MAX_SAFE_INTEGER);
    let narrowed = columns_variable(env.var("COLUMNS"));
    match (real, narrowed) {
        (Some(real), Some(narrowed)) => Some(real.min(narrowed)),
        (real, narrowed) => real.or(narrowed),
    }
}
