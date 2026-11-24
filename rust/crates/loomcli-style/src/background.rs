//! The run's terminal background, as pure decisions over facts the caller supplies: the order its
//! sources settle in, the replies to the background query, and `COLORFGBG`.

use crate::environment::Environment;
use crate::rendering::{BackgroundPolicy, under_ci};

/// The run's background: the terminal's background color read as dark or light.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Background {
    /// A dark background, which an unknown one also resolves adaptive entries as.
    Dark,
    /// A light background.
    Light,
}

impl Background {
    /// The background's name, `dark` or `light`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Background::Dark => "dark",
            Background::Light => "light",
        }
    }

    /// The background a name spells, `dark` or `light`.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Background> {
        match name {
            "dark" => Some(Background::Dark),
            "light" => Some(Background::Light),
            _ => None,
        }
    }
}

/// Where each source of the run's background stands when core settles it.
#[derive(Debug)]
#[non_exhaustive]
pub struct BackgroundSources<'a, E: Environment + ?Sized> {
    /// The operator's background choice from argv.
    pub choice: Option<Background>,
    /// The author's merged `rendering.background`.
    pub policy: Option<BackgroundPolicy>,
    /// A background the process handle's terminal states.
    pub stated: Option<Background>,
    /// Whether the installed theme holds an adaptive entry or an option carries the background mark.
    pub detects: bool,
    /// Whether stdin, stdout, and stderr are all terminals.
    pub terminals: bool,
    /// Whether the run's color is on for stdout or stderr after the color choice.
    pub colored: bool,
    /// The captured environment.
    pub env: &'a E,
}

impl<E: Environment + ?Sized> Clone for BackgroundSources<'_, E> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<E: Environment + ?Sized> Copy for BackgroundSources<'_, E> {}

impl<'a, E: Environment + ?Sized> BackgroundSources<'a, E> {
    /// Sources with no choice, policy, or stated background, nothing that detects, and no terminal
    /// or color, over the captured environment.
    #[must_use]
    pub fn new(env: &'a E) -> BackgroundSources<'a, E> {
        BackgroundSources {
            choice: None,
            policy: None,
            stated: None,
            detects: false,
            terminals: false,
            colored: false,
            env,
        }
    }
}

/// Where settlement stands before the terminal is asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackgroundStep {
    /// A source before the query settled the background, possibly as unknown.
    Settled(Option<Background>),
    /// Only the terminal's answer, then `COLORFGBG`, can settle it:
    /// [`background_after_query`] finishes.
    Query,
}

/// The first steps of settlement: the operator's choice, the author's policy, a stated background,
/// and, only when something reads it, unknown when a stream is not a terminal or color is off, and
/// dark on the Linux console.
#[must_use]
pub fn background_before_query<E: Environment + ?Sized>(
    sources: &BackgroundSources<'_, E>,
) -> BackgroundStep {
    let policy = match sources.policy {
        Some(BackgroundPolicy::Dark) => Some(Background::Dark),
        Some(BackgroundPolicy::Light) => Some(Background::Light),
        Some(BackgroundPolicy::Auto) | None => None,
    };
    let named = sources.choice.or(policy).or(sources.stated);
    if named.is_some() || !sources.detects || !sources.terminals || !sources.colored {
        return BackgroundStep::Settled(named);
    }
    if sources.env.var("TERM") == Some("linux") {
        return BackgroundStep::Settled(Some(Background::Dark));
    }
    BackgroundStep::Query
}

/// The last steps of settlement: the terminal's answer, then `COLORFGBG`, then unknown.
#[must_use]
pub fn background_after_query<E: Environment + ?Sized>(
    answer: Option<Background>,
    env: &E,
) -> Option<Background> {
    answer.or_else(|| color_fg_bg(env.var("COLORFGBG")))
}

/// The run's background from the first source that answers, asking `query` only when every source
/// before the terminal's answer leaves it open.
pub fn settle_background<E: Environment + ?Sized>(
    sources: &BackgroundSources<'_, E>,
    query: impl FnOnce() -> Option<Background>,
) -> Option<Background> {
    match background_before_query(sources) {
        BackgroundStep::Settled(settled) => settled,
        BackgroundStep::Query => background_after_query(query(), sources.env),
    }
}

/// The three queries in the order core writes them in one write: OSC 11, the color-scheme query,
/// and DA1, the sentinel.
pub const BACKGROUND_QUERY: &str = "\u{1b}]11;?\u{1b}\\\u{1b}[?996n\u{1b}[c";

/// What the bytes read so far say.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Replies {
    /// The answer the replies give: an OSC 11 color first, then a color-scheme reply.
    pub answer: Option<Background>,
    /// Whether the DA1 reply, the sentinel, has arrived, which ends the read.
    pub ended: bool,
    /// Every byte that is not a reply, interrupt keys included, in arrival order.
    pub typeahead: Vec<u8>,
}

/// The background a relative luminance answers: light above 0.5, and dark otherwise.
#[must_use]
pub fn background_of_luminance(luminance: f64) -> Background {
    if luminance > 0.5 {
        Background::Light
    } else {
        Background::Dark
    }
}

/// One sRGB channel, from 0 through 1, made linear.
fn linear(channel: f64) -> f64 {
    if channel <= 0.04045 {
        channel / 12.92
    } else {
        ((channel + 0.055) / 1.055).powf(2.4)
    }
}

/// The background an OSC 11 payload answers, `rgb:R/G/B` with 1 to 4 hex digits in each
/// component, each scaled by its own width.
fn color_answer(payload: &[u8]) -> Option<Background> {
    let parts = payload.strip_prefix(b"rgb:")?;
    let mut channels = Vec::new();
    for part in parts.split(|byte| *byte == b'/') {
        if part.is_empty() || part.len() > 4 || !part.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        let text = std::str::from_utf8(part).ok()?;
        let value = f64::from(u16::from_str_radix(text, 16).ok()?);
        let digits = i32::try_from(part.len()).ok()?;
        channels.push(linear(value / (16_f64.powi(digits) - 1.0)));
    }
    let [red, green, blue] = channels.as_slice() else {
        return None;
    };
    Some(background_of_luminance(
        0.2126 * red + 0.7152 * green + 0.0722 * blue,
    ))
}

/// The length of a DA1 reply `ESC [ ? <digits and semicolons> c` starting at `at`.
fn sentinel_at(received: &[u8], at: usize) -> Option<usize> {
    let rest = received.get(at..)?;
    if !rest.starts_with(b"\x1b[?") {
        return None;
    }
    let body = rest
        .iter()
        .skip(3)
        .take_while(|byte| byte.is_ascii_digit() || **byte == b';')
        .count();
    (rest.get(3 + body) == Some(&b'c')).then_some(4 + body)
}

/// The length and payload of an OSC 11 reply starting at `at`, ended by BEL or ST.
fn color_reply_at(received: &[u8], at: usize) -> Option<(usize, &[u8])> {
    let rest = received.get(at..)?;
    let after = rest.strip_prefix(b"\x1b]11;")?;
    let payload = after
        .iter()
        .take_while(|byte| **byte != 0x07 && **byte != 0x1b)
        .count();
    let end = 5 + payload;
    match rest.get(end) {
        Some(0x07) => Some((end + 1, after.get(..payload)?)),
        Some(0x1b) if rest.get(end + 1) == Some(&b'\\') => Some((end + 2, after.get(..payload)?)),
        _ => None,
    }
}

/// The length and mode of a color-scheme reply `ESC [ ? 997 ; <digits> n` starting at `at`.
fn scheme_reply_at(received: &[u8], at: usize) -> Option<(usize, &[u8])> {
    let rest = received.get(at..)?;
    let after = rest.strip_prefix(b"\x1b[?997;")?;
    let digits = after
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    (digits > 0 && after.get(digits) == Some(&b'n')).then(|| (7 + digits + 1, &after[..digits]))
}

/// What the bytes read so far say: the read ends at the first DA1 reply, the OSC 11 and
/// color-scheme replies before it are removed and answer, a parsed OSC 11 reply winning, and every
/// other byte, before, between, or after the replies, is typeahead. An interrupt key is typeahead
/// here, for the caller to raise.
#[must_use]
pub fn read_replies(received: &[u8]) -> Replies {
    let sentinel =
        (0..received.len()).find_map(|at| sentinel_at(received, at).map(|length| (at, length)));
    let (before, after) = match sentinel {
        Some((at, length)) => (
            received.get(..at).unwrap_or_default(),
            received.get(at + length..).unwrap_or_default(),
        ),
        None => (received, &[][..]),
    };
    let mut colors = Vec::new();
    let mut without_colors = Vec::new();
    let mut at = 0;
    while at < before.len() {
        if let Some((length, payload)) = color_reply_at(before, at) {
            colors.push(color_answer(payload));
            at += length;
        } else {
            without_colors.extend(before.get(at));
            at += 1;
        }
    }
    let mut modes = Vec::new();
    let mut typeahead = Vec::new();
    let mut at = 0;
    while at < without_colors.len() {
        if let Some((length, mode)) = scheme_reply_at(&without_colors, at) {
            modes.push(match mode {
                b"1" => Some(Background::Dark),
                b"2" => Some(Background::Light),
                _ => None,
            });
            at += length;
        } else {
            typeahead.extend(without_colors.get(at));
            at += 1;
        }
    }
    typeahead.extend_from_slice(after);
    let answer = colors
        .into_iter()
        .flatten()
        .next()
        .or_else(|| modes.into_iter().flatten().next());
    Replies {
        answer,
        ended: sentinel.is_some(),
        typeahead,
    }
}

/// The background `COLORFGBG` names: light when its last `;`-separated field is 7 or 15, the
/// palette's white, dark for any other field, and unknown when it is unset or empty.
#[must_use]
pub fn color_fg_bg(value: Option<&str>) -> Option<Background> {
    let value = value.filter(|value| !value.is_empty())?;
    match value.rsplit(';').next() {
        Some("7" | "15") => Some(Background::Light),
        _ => Some(Background::Dark),
    }
}

/// Whether the environment lets core query the terminal: a `TERM` that is set, nonempty, and not
/// `dumb`, no GNU screen (`STY`) or Emacs (`INSIDE_EMACS`), and no CI.
#[must_use]
pub fn query_allowed<E: Environment + ?Sized>(env: &E) -> bool {
    let term = env.var("TERM").unwrap_or_default();
    term != "dumb"
        && !term.is_empty()
        && env.var("STY").unwrap_or_default().is_empty()
        && env.var("INSIDE_EMACS").unwrap_or_default().is_empty()
        && !under_ci(env)
}
