//! The ANSI scanner: it classifies the decoded character stream into text, SGR, hyperlink, and
//! control units, folding embedded SGR into Loom's scoped attributes.

use std::collections::HashMap;
use std::rc::Rc;

use crate::color::{Ansi16Color, Ansi256Fallbacks, Color, ColorFallbacks};
use crate::rendering::Capabilities;
use crate::state::{Attributes, apply_operations};
use crate::style::Modifier;
use crate::wire::{Boundary, ParsedView, ROOT, ScopeId};

/// What a unit of resolved output is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnitKind {
    Text,
    Control,
    Hyperlink,
    Sgr,
}

/// One unit of output: its kind, its characters, and the attributes it is written with.
#[derive(Debug, Clone)]
pub(crate) struct TextUnit {
    pub(crate) kind: UnitKind,
    pub(crate) text: Rc<[char]>,
    pub(crate) attributes: Rc<Attributes>,
}

/// A unit or a padding boundary, in stream order.
#[derive(Debug, Clone)]
pub(crate) enum Unit {
    Text(TextUnit),
    Boundary(Boundary),
}

/// What an ANSI command is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommandKind {
    Sgr,
    Osc,
    Control,
    Incomplete,
}

/// One ANSI command: where it ends, what it is, and the span of its body.
#[derive(Debug, Clone, Copy)]
pub(crate) struct AnsiCommand {
    pub(crate) end: usize,
    pub(crate) kind: CommandKind,
    pub(crate) body: (usize, usize),
}

fn code(text: &[char], at: usize) -> Option<u32> {
    text.get(at).map(|character| u32::from(*character))
}

/// A control string, opaque through its terminator; its payload is never rescanned.
fn control_string(text: &[char], start: usize, osc: bool) -> AnsiCommand {
    let kind = if osc {
        CommandKind::Osc
    } else {
        CommandKind::Control
    };
    let mut cursor = start;
    while let Some(character) = code(text, cursor) {
        if (osc && character == 7) || character == 156 {
            return AnsiCommand {
                end: cursor + 1,
                kind,
                body: (start, cursor),
            };
        }
        if character == 27 && text.get(cursor + 1) == Some(&'\\') {
            return AnsiCommand {
                end: cursor + 2,
                kind,
                body: (start, cursor),
            };
        }
        cursor += 1;
    }
    AnsiCommand {
        end: text.len(),
        kind: CommandKind::Incomplete,
        body: (0, 0),
    }
}

fn csi(text: &[char], start: usize) -> AnsiCommand {
    let mut cursor = start;
    while let Some(character) = code(text, cursor) {
        if (64..=126).contains(&character) {
            return AnsiCommand {
                end: cursor + 1,
                kind: if character == 109 {
                    CommandKind::Sgr
                } else {
                    CommandKind::Control
                },
                body: (start, cursor),
            };
        }
        if !(32..=63).contains(&character) {
            return AnsiCommand {
                end: cursor,
                kind: CommandKind::Incomplete,
                body: (0, 0),
            };
        }
        cursor += 1;
    }
    AnsiCommand {
        end: text.len(),
        kind: CommandKind::Incomplete,
        body: (0, 0),
    }
}

/// Whether a character is a C0 control, DEL, or a C1 control: the set the scanner reads as
/// commands.
pub(crate) fn is_control(character: char) -> bool {
    let code = u32::from(character);
    code < 32 || (127..=159).contains(&code)
}

/// Controls other than the characters line layout treats as separators.
pub(crate) fn is_control_except_layout(character: char) -> bool {
    !matches!(character, '\n' | '\r' | '\t') && is_control(character)
}

/// The ANSI command starting at `cursor`, or `None` when the character there is text.
pub(crate) fn command(text: &[char], cursor: usize) -> Option<AnsiCommand> {
    let character = code(text, cursor)?;
    if character == 27 {
        match text.get(cursor + 1) {
            Some('[') => return Some(csi(text, cursor + 2)),
            Some(']') => return Some(control_string(text, cursor + 2, true)),
            Some('P' | 'X' | '^' | '_') => return Some(control_string(text, cursor + 2, false)),
            _ => {}
        }
        let mut end = cursor + 1;
        while let Some(value) = code(text, end) {
            if (48..=126).contains(&value) {
                return Some(AnsiCommand {
                    end: end + 1,
                    kind: CommandKind::Control,
                    body: (0, 0),
                });
            }
            if !(32..=47).contains(&value) {
                return Some(AnsiCommand {
                    end,
                    kind: CommandKind::Incomplete,
                    body: (0, 0),
                });
            }
            end += 1;
        }
        return Some(AnsiCommand {
            end: text.len(),
            kind: CommandKind::Incomplete,
            body: (0, 0),
        });
    }
    match character {
        155 => return Some(csi(text, cursor + 1)),
        157 => return Some(control_string(text, cursor + 1, true)),
        144 | 152 | 158 | 159 => return Some(control_string(text, cursor + 1, false)),
        _ => {}
    }
    // Tab and line endings are text; every other control character is a command of one unit.
    let line_ending = character == 10 || (character == 13 && text.get(cursor + 1) == Some(&'\n'));
    if is_control(text.get(cursor).copied().unwrap_or('\0')) && character != 9 && !line_ending {
        return Some(AnsiCommand {
            end: cursor + 1,
            kind: CommandKind::Control,
            body: (0, 0),
        });
    }
    None
}

/// What an OSC 8 command does to the hyperlink state: `Some(true)` when it opens a link,
/// `Some(false)` when it closes one, and `None` when the command is not a hyperlink.
pub(crate) fn hyperlink_opens(text: &[char], found: &AnsiCommand) -> Option<bool> {
    if found.kind != CommandKind::Osc {
        return None;
    }
    let body = text.get(found.body.0..found.body.1)?;
    if !body.starts_with(&['8', ';']) {
        return None;
    }
    let separator = body.iter().skip(2).position(|&c| c == ';')? + 2;
    Some(separator + 1 < body.len())
}

/// The modifier an SGR parameter enables.
fn enabled_modifier(code: f64) -> Option<Modifier> {
    Modifier::ALL
        .into_iter()
        .find(|modifier| f64::from(modifier.on()) == code)
}

/// The modifiers an SGR parameter disables.
fn disabled_modifiers(code: f64) -> &'static [Modifier] {
    match code {
        22.0 => &[Modifier::Bold, Modifier::Faint],
        23.0 => &[Modifier::Italic],
        24.0 => &[Modifier::Underline],
        27.0 => &[Modifier::Inverse],
        28.0 => &[Modifier::Hidden],
        29.0 => &[Modifier::Strikethrough],
        55.0 => &[Modifier::Overline],
        _ => &[],
    }
}

/// A parameter read as JavaScript's `Number` reads a string of digits, where the empty string is
/// zero; a missing parameter is `None`, JavaScript's `NaN`.
fn number(text: Option<&str>) -> Option<f64> {
    let text = text?;
    if text.is_empty() {
        return Some(0.0);
    }
    text.parse().ok()
}

/// The modifiers raw ANSI set or cleared, in the order they were first set.
#[derive(Debug, Default, Clone)]
struct ModifierOverrides(Vec<(Modifier, bool)>);

impl ModifierOverrides {
    fn set(&mut self, modifier: Modifier, on: bool) {
        if let Some(entry) = self.0.iter_mut().find(|(name, _)| *name == modifier) {
            entry.1 = on;
        } else {
            self.0.push((modifier, on));
        }
    }

    fn delete(&mut self, modifier: Modifier) {
        self.0.retain(|(name, _)| *name != modifier);
    }
}

/// Raw ANSI overrides participating in Loom's scoped attributes, where resets restore their base.
struct AnsiState<'a> {
    base: Rc<Attributes>,
    foreground: Option<Color>,
    background: Option<Color>,
    modifiers: ModifierOverrides,
    scope: ScopeId,
    computed: Option<Rc<Attributes>>,
    saved: HashMap<ScopeId, Rc<Attributes>>,
    view: ParsedView<'a>,
}

impl<'a> AnsiState<'a> {
    fn new(view: ParsedView<'a>) -> AnsiState<'a> {
        let empty = Rc::new(Attributes::default());
        let mut saved = HashMap::new();
        saved.insert(ROOT, Rc::clone(&empty));
        AnsiState {
            base: empty,
            foreground: None,
            background: None,
            modifiers: ModifierOverrides::default(),
            scope: ROOT,
            computed: None,
            saved,
            view,
        }
    }

    fn sync(&mut self, scope: ScopeId) {
        if scope == self.scope {
            return;
        }
        let current = self.attributes();
        self.saved.insert(self.scope, current);
        let mut entering = Vec::new();
        let mut ancestor = Some(scope);
        while let Some(id) = ancestor {
            if self.saved.contains_key(&id) {
                break;
            }
            entering.push(id);
            ancestor = self.view.arena.get(id).and_then(|entry| entry.parent);
        }
        let mut effective = ancestor
            .and_then(|id| self.saved.get(&id).cloned())
            .unwrap_or_default();
        for id in entering.into_iter().rev() {
            if let Some(entry) = self.view.arena.get(id) {
                effective = Rc::new(apply_operations(
                    &effective,
                    &entry.operations,
                    self.view.palette,
                ));
                self.saved.insert(id, Rc::clone(&effective));
            }
        }
        self.scope = scope;
        self.base = self
            .view
            .arena
            .get(scope)
            .map_or_else(Rc::default, |entry| Rc::clone(&entry.attributes));
        self.foreground = effective.foreground;
        self.background = effective.background;
        self.modifiers = ModifierOverrides::default();
        for modifier in self.base.modifiers.iter() {
            self.modifiers.set(modifier, false);
        }
        for modifier in effective.modifiers.iter() {
            self.modifiers.set(modifier, true);
        }
        self.computed = None;
    }

    fn attributes(&mut self) -> Rc<Attributes> {
        if let Some(computed) = &self.computed {
            return Rc::clone(computed);
        }
        if self.foreground.is_none() && self.background.is_none() && self.modifiers.0.is_empty() {
            return Rc::clone(&self.base);
        }
        let mut modifiers = self.base.modifiers.clone();
        for (modifier, on) in &self.modifiers.0 {
            if *on {
                modifiers.insert(*modifier);
            } else {
                modifiers.remove(*modifier);
            }
        }
        let computed = Rc::new(Attributes {
            foreground: self.foreground.or(self.base.foreground),
            background: self.background.or(self.base.background),
            modifiers,
        });
        self.computed = Some(Rc::clone(&computed));
        computed
    }

    fn set_color(&mut self, background: bool, color: Option<Color>) {
        if background {
            self.background = color;
        } else {
            self.foreground = color;
        }
    }

    /// Folds one SGR body into the state and returns the parameters it does not model, as an SGR
    /// sequence, or nothing.
    fn sgr(&mut self, body: &[char]) -> String {
        self.computed = None;
        if !body
            .iter()
            .all(|&c| c.is_ascii_digit() || c == ';' || c == ':')
        {
            return String::new();
        }
        let body: String = body.iter().collect();
        let parameters: Vec<&str> = body.split(';').collect();
        let mut unknown: Vec<&str> = Vec::new();
        let mut index = 0;
        while index < parameters.len() {
            let start = index;
            let raw = parameters.get(index).copied().unwrap_or_default();
            let colon: Vec<&str> = raw.split(':').collect();
            let code = number(colon.first().copied()).unwrap_or(f64::NAN);
            index += 1;
            if code == 0.0 {
                self.foreground = None;
                self.background = None;
                self.modifiers = ModifierOverrides::default();
                continue;
            }
            if code == 39.0 || code == 49.0 {
                self.set_color(code == 49.0, None);
                continue;
            }
            if code == 4.0
                && let [_, style] = colon.as_slice()
                && !style.is_empty()
                && number(Some(style)) == Some(0.0)
            {
                self.modifiers.delete(Modifier::Underline);
                continue;
            }
            if let Some(modifier) = enabled_modifier(code) {
                self.modifiers.set(modifier, true);
                continue;
            }
            let disabled = disabled_modifiers(code);
            if !disabled.is_empty() {
                for modifier in disabled {
                    self.modifiers.delete(*modifier);
                }
                continue;
            }
            let background =
                (40.0..=47.0).contains(&code) || (100.0..=107.0).contains(&code) || code == 48.0;
            let named = (30.0..=37.0).contains(&code)
                || (40.0..=47.0).contains(&code)
                || (90.0..=97.0).contains(&code)
                || (100.0..=107.0).contains(&code);
            if named && code.fract() == 0.0 {
                // The ranges above bound the value, so the conversion is exact.
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let whole = code as usize;
                let palette_index = if whole <= 47 {
                    whole - if background { 40 } else { 30 }
                } else {
                    whole - if background { 100 } else { 90 } + 8
                };
                if let Some(color) = Ansi16Color::from_index(palette_index) {
                    self.set_color(background, Some(Color::Named(color)));
                }
                continue;
            }
            if matches!(code, 38.0 | 48.0 | 58.0) {
                let mode = if colon.len() > 1 {
                    number(colon.get(1).copied())
                } else {
                    number(parameters.get(index).copied())
                };
                let count = match mode {
                    Some(2.0) => 3,
                    Some(5.0) => 1,
                    _ => 0,
                };
                if code == 58.0 {
                    // Underline color is unmodeled, but its parameters belong to one command.
                    if colon.len() == 1 {
                        index = (index + 1 + count).min(parameters.len());
                    }
                    unknown.extend_from_slice(parameters.get(start..index).unwrap_or_default());
                    continue;
                }
                let values: Vec<Option<f64>> = if colon.len() > 1 {
                    // The reference slices from `length - count`, and JavaScript's slice reads a
                    // negative start from the end.
                    let length = colon.len();
                    let from = if count <= length {
                        length - count
                    } else {
                        (2 * length).saturating_sub(count)
                    };
                    colon
                        .get(from..)
                        .unwrap_or_default()
                        .iter()
                        .map(|value| number(Some(value)))
                        .collect()
                } else {
                    parameters
                        .iter()
                        .skip(index + 1)
                        .take(count)
                        .map(|value| number(Some(value)))
                        .collect()
                };
                if colon.len() == 1 {
                    index += 1 + count;
                }
                let bytes: Option<Vec<u8>> = values
                    .iter()
                    .map(|value| {
                        value
                            .filter(|value| value.fract() == 0.0 && (0.0..=255.0).contains(value))
                            // The filter bounds the value, so the conversion is exact.
                            .map(|value| {
                                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                                let byte = value as u8;
                                byte
                            })
                    })
                    .collect();
                let Some(bytes) = bytes.filter(|bytes| bytes.len() == count) else {
                    continue;
                };
                let color = match (mode, bytes.as_slice()) {
                    (Some(5.0), [index]) => Some(Color::Ansi256 {
                        index: *index,
                        fallbacks: Ansi256Fallbacks::new(),
                    }),
                    (Some(2.0), [red, green, blue]) => Some(Color::Rgb {
                        red: *red,
                        green: *green,
                        blue: *blue,
                        fallbacks: ColorFallbacks::new(),
                    }),
                    _ => None,
                };
                if color.is_some() {
                    self.set_color(background, color);
                }
                continue;
            }
            unknown.push(raw);
        }
        if unknown.is_empty() {
            String::new()
        } else {
            format!("\u{1b}[{}m", unknown.join(";"))
        }
    }
}

/// Where the run of ordinary characters that starts at `start` ends: the characters after it that
/// no command, tab, or line ending interrupts, in its scope, up to the next padding boundary. One
/// unit carries the run, because every measure of a line sums the same over any split of it.
fn ordinary_run_end(view: ParsedView<'_>, start: usize) -> usize {
    let scope = view.scopes.get(start).copied().unwrap_or(ROOT);
    let limit = view
        .boundaries
        .range(start + 1..)
        .next()
        .map_or(view.text.len(), |(at, _)| (*at).min(view.text.len()));
    let mut end = start + 1;
    while end < limit
        && view.text.get(end).is_some_and(|&c| !is_control(c))
        && view.scopes.get(end).copied().unwrap_or(ROOT) == scope
    {
        end += 1;
    }
    end
}

/// The scanned stream of a decoded text: every unit and boundary, classified before any padding
/// or generated terminal byte is emitted, with an open hyperlink closed at the end.
pub(crate) fn scan_ansi(view: ParsedView<'_>, caps: &Capabilities) -> Vec<Unit> {
    let mut result = Vec::with_capacity(view.text.len());
    let mut state = AnsiState::new(view);
    let mut hyperlink_open = false;
    let scope_at = |at: usize| view.scopes.get(at).copied().unwrap_or(ROOT);
    let boundaries =
        |state: &mut AnsiState<'_>, result: &mut Vec<Unit>, start: usize, end: usize| {
            for (_, found) in view.boundaries.range(start..end) {
                for boundary in found {
                    match boundary {
                        Boundary::Open { padding, scope, .. } => {
                            state.sync(*scope);
                            result.push(Unit::Boundary(Boundary::Open {
                                padding: *padding,
                                attributes: state.attributes(),
                                scope: *scope,
                            }));
                        }
                        Boundary::Close => result.push(Unit::Boundary(Boundary::Close)),
                    }
                }
            }
        };
    let text = view.text;
    let mut cursor = 0;
    while cursor < text.len() {
        state.sync(scope_at(cursor));
        if let Some(found) = command(text, cursor) {
            boundaries(&mut state, &mut result, cursor, found.end);
            state.sync(scope_at(found.end.saturating_sub(1)));
            let raw: Rc<[char]> = Rc::from(text.get(cursor..found.end).unwrap_or_default());
            if found.kind == CommandKind::Sgr {
                let unknown = state.sgr(text.get(found.body.0..found.body.1).unwrap_or_default());
                if caps.terminal_controls && !unknown.is_empty() {
                    result.push(Unit::Text(TextUnit {
                        kind: UnitKind::Sgr,
                        text: unknown.chars().collect(),
                        attributes: state.attributes(),
                    }));
                }
            } else if let Some(opens) = hyperlink_opens(text, &found) {
                if caps.hyperlinks {
                    hyperlink_open = opens;
                    result.push(Unit::Text(TextUnit {
                        kind: UnitKind::Hyperlink,
                        text: raw,
                        attributes: state.attributes(),
                    }));
                }
            } else if found.kind != CommandKind::Incomplete && caps.terminal_controls {
                result.push(Unit::Text(TextUnit {
                    kind: UnitKind::Control,
                    text: raw,
                    attributes: state.attributes(),
                }));
            }
            cursor = found.end.max(cursor + 1);
            continue;
        }
        boundaries(&mut state, &mut result, cursor, cursor + 1);
        state.sync(scope_at(cursor));
        let character = text.get(cursor).copied().unwrap_or_default();
        // The LF owns the complete line-ending atom, so deferred spaces cannot split CRLF.
        if character == '\r' && text.get(cursor + 1) == Some(&'\n') {
            cursor += 1;
            continue;
        }
        let end = if character == '\n' || character == '\t' {
            cursor + 1
        } else {
            ordinary_run_end(view, cursor)
        };
        let unit: Rc<[char]> =
            if character == '\n' && cursor > 0 && text.get(cursor - 1) == Some(&'\r') {
                Rc::from(&['\r', '\n'][..])
            } else {
                Rc::from(text.get(cursor..end).unwrap_or_default())
            };
        result.push(Unit::Text(TextUnit {
            kind: UnitKind::Text,
            text: unit,
            attributes: state.attributes(),
        }));
        cursor = end;
    }
    boundaries(&mut state, &mut result, text.len(), text.len() + 1);
    if hyperlink_open {
        result.push(Unit::Text(TextUnit {
            kind: UnitKind::Hyperlink,
            text: "\u{1b}]8;;\u{1b}\\".chars().collect(),
            attributes: Rc::new(Attributes::default()),
        }));
    }
    result
}
