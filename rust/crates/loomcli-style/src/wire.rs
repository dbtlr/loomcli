//! The frame parser: it decodes a marked string once, with an explicit stack, into its characters,
//! the style scope of each, and the padding boundaries between them.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::color::{Ansi16Color, Ansi256Fallbacks, Color, ColorFallbacks};
use crate::glyph::Glyph;
use crate::json::{self, Json};
use crate::state::{Attributes, apply_operations};
use crate::style::{
    Alignment, CLOSE, CORE_TOKENS, ESCAPE, HEADER_END, MAX_SAFE_INTEGER, Modifier, OPEN, Operation,
};
use crate::theme::Palette;

/// An index into a parsed text's scope arena.
pub(crate) type ScopeId = usize;

/// The root scope of every parsed text: no operation, empty attributes.
pub(crate) const ROOT: ScopeId = 0;

/// One style scope: the attributes its frame resolves to, its parent, and its own operations.
#[derive(Debug, Clone)]
pub(crate) struct StyleScope {
    pub(crate) attributes: Rc<Attributes>,
    pub(crate) parent: Option<ScopeId>,
    pub(crate) operations: Rc<[Operation]>,
}

/// A padding frame's request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Padding {
    pub(crate) width: usize,
    pub(crate) align: Alignment,
}

/// A padding frame opening or closing between decoded characters.
#[derive(Debug, Clone)]
pub(crate) enum Boundary {
    Open {
        padding: Padding,
        attributes: Rc<Attributes>,
        scope: ScopeId,
    },
    Close,
}

/// The boundaries of a text, placed before the decoded character at each key.
pub(crate) type Boundaries = BTreeMap<usize, Vec<Boundary>>;

/// A decoded marked string.
#[derive(Debug)]
pub(crate) struct ParsedText<'p> {
    pub(crate) text: Vec<char>,
    pub(crate) scopes: Vec<ScopeId>,
    pub(crate) arena: Vec<StyleScope>,
    pub(crate) palette: &'p Palette,
    pub(crate) boundaries: Boundaries,
}

/// A view of decoded text, the whole of a parsed text or one span of it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ParsedView<'a> {
    pub(crate) text: &'a [char],
    pub(crate) scopes: &'a [ScopeId],
    pub(crate) arena: &'a [StyleScope],
    pub(crate) palette: &'a Palette,
    pub(crate) boundaries: &'a Boundaries,
}

impl ParsedText<'_> {
    pub(crate) fn view(&self) -> ParsedView<'_> {
        ParsedView {
            text: &self.text,
            scopes: &self.scopes,
            arena: &self.arena,
            palette: self.palette,
            boundaries: &self.boundaries,
        }
    }
}

/// A style, padding, or no-wrap frame opening or closing in the input, placed before the decoded
/// character at `at`. An open keeps its header as written, and whether it starts a style scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FrameMark {
    Open {
        at: usize,
        header: Vec<char>,
        scoped: bool,
    },
    Close {
        at: usize,
    },
}

impl FrameMark {
    pub(crate) fn at(&self) -> usize {
        match self {
            FrameMark::Open { at, .. } | FrameMark::Close { at } => *at,
        }
    }
}

/// Where each decoded character came from, which line breaking reads: its offset in the input,
/// and whether it is whole, inside a padding or no-wrap frame, or a glyph form or rejected header.
/// When `frames` is supplied, it records each frame the input opens and each close it holds.
#[derive(Debug, Default)]
pub(crate) struct WireTrace {
    pub(crate) origins: Vec<usize>,
    pub(crate) whole: Vec<bool>,
    pub(crate) frames: Option<Vec<FrameMark>>,
}

/// How a parse reads its input.
pub(crate) struct ParseOptions<'t> {
    /// Whether a style header may name any token, so the framing reads the same whatever palette
    /// resolves it later.
    pub(crate) any_token: bool,
    /// Whether glyphs select their main forms.
    pub(crate) main_glyphs: bool,
    /// Where to record each decoded character's origin, when line breaking reads the text.
    pub(crate) trace: Option<&'t mut WireTrace>,
}

/// A parsed header.
#[derive(Debug, PartialEq)]
pub(crate) enum Header {
    Style(Vec<Operation>),
    Glyph(Glyph),
    Pad(Padding),
    Nowrap,
}

fn byte_of(value: &Json) -> Option<u8> {
    let number = value.as_number()?;
    if number.fract() != 0.0 || !(0.0..=255.0).contains(&number) {
        return None;
    }
    // The range check above proves the conversion exact.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Some(number as u8)
}

/// The fallback object of a wire color: only the listed members, each valid, and a later repeat
/// of a member replacing an earlier one, as `JSON.parse` keeps the last.
fn fallbacks_of(value: &Json, allow256: bool) -> Option<(Option<Ansi16Color>, Option<u8>)> {
    let Json::Object(members) = value else {
        return None;
    };
    let mut ansi16 = None;
    let mut ansi256 = None;
    for (key, member) in members {
        match key.as_str() {
            "ansi16" => ansi16 = Some(Ansi16Color::from_name(member.as_str()?)?),
            "ansi256" if allow256 => ansi256 = Some(byte_of(member)?),
            _ => return None,
        }
    }
    Some((ansi16, ansi256))
}

fn color_of(value: &Json) -> Option<Color> {
    if let Some(name) = value.as_str() {
        return Ansi16Color::from_name(name).map(Color::Named);
    }
    let items = value.as_array()?;
    match items {
        [kind, index] if kind.as_str() == Some("ansi256") => Some(Color::Ansi256 {
            index: byte_of(index)?,
            fallbacks: Ansi256Fallbacks::new(),
        }),
        [kind, index, fallbacks] if kind.as_str() == Some("ansi256") => {
            let index = byte_of(index)?;
            let (ansi16, _) = fallbacks_of(fallbacks, false)?;
            let mut copied = Ansi256Fallbacks::new();
            if let Some(color) = ansi16 {
                copied = copied.ansi16(color);
            }
            Some(Color::Ansi256 {
                index,
                fallbacks: copied,
            })
        }
        [kind, red, green, blue, rest @ ..] if kind.as_str() == Some("rgb") && rest.len() <= 1 => {
            let (red, green, blue) = (byte_of(red)?, byte_of(green)?, byte_of(blue)?);
            let mut copied = ColorFallbacks::new();
            if let Some(fallbacks) = rest.first() {
                let (ansi16, ansi256) = fallbacks_of(fallbacks, true)?;
                if let Some(color) = ansi16 {
                    copied = copied.ansi16(color);
                }
                if let Some(index) = ansi256 {
                    copied = copied.ansi256(index);
                }
            }
            Some(Color::Rgb {
                red,
                green,
                blue,
                fallbacks: copied,
            })
        }
        _ => None,
    }
}

fn operation_of(value: &Json, known: &dyn Fn(&str) -> bool) -> Option<Operation> {
    let items = value.as_array()?;
    match items {
        [kind] => match kind.as_str()? {
            "reset" => Some(Operation::Reset),
            "resetForeground" => Some(Operation::ResetForeground),
            "resetBackground" => Some(Operation::ResetBackground),
            _ => None,
        },
        [kind, operand] => match kind.as_str()? {
            "token" => {
                let name = operand.as_str()?;
                known(name).then(|| Operation::Token(name.to_owned()))
            }
            "modifier" => Modifier::from_name(operand.as_str()?).map(Operation::Modifier),
            "foreground" => color_of(operand).map(Operation::Foreground),
            "background" => color_of(operand).map(Operation::Background),
            _ => None,
        },
        _ => None,
    }
}

pub(crate) fn parse_header(text: &[char], known: &dyn Fn(&str) -> bool) -> Option<Header> {
    let value = json::parse(text)?;
    let items = value.as_array()?;
    match items {
        [kind] if kind.as_str() == Some("nowrap") => Some(Header::Nowrap),
        [kind, name] if kind.as_str() == Some("glyph") => {
            let name = name.as_str()?;
            Glyph::ALL
                .iter()
                .find(|glyph| glyph.name() == name)
                .map(|glyph| Header::Glyph(*glyph))
        }
        [kind, width, align] if kind.as_str() == Some("pad") => {
            let width = width.as_number()?;
            if width.fract() != 0.0 || !(0.0..=MAX_SAFE_INTEGER as f64).contains(&width) {
                return None;
            }
            let align = match align.as_str()? {
                "left" => Alignment::Left,
                "right" => Alignment::Right,
                "center" => Alignment::Center,
                _ => return None,
            };
            // The range check above proves the conversion exact on a 64-bit target.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let width = width as u64;
            Some(Header::Pad(Padding {
                width: usize::try_from(width).ok()?,
                align,
            }))
        }
        [kind, operations] if kind.as_str() == Some("style") => {
            let operations = operations
                .as_array()?
                .iter()
                .map(|operation| operation_of(operation, known))
                .collect::<Option<Vec<_>>>()?;
            Some(Header::Style(operations))
        }
        _ => None,
    }
}

/// A JSON string with no escape, its text, and what follows its closing quote.
fn plain_string(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix('"')?;
    let end = rest.find('"')?;
    let value = rest.get(..end)?;
    let simple = value
        .bytes()
        .all(|byte| (0x20..0x7f).contains(&byte) && byte != b'\\');
    simple.then_some((value, rest.get(end + 1..)?))
}

/// One operation in the spelling a style chain writes, with what follows it: `Some(None)` for an
/// operation `operation_of` rejects, and `None` for a spelling read only as JSON.
fn canonical_operation<'a>(
    text: &'a str,
    known: &dyn Fn(&str) -> bool,
) -> Option<(Option<Operation>, &'a str)> {
    for (spelled, operation) in [
        ("[\"reset\"]", Operation::Reset),
        ("[\"resetForeground\"]", Operation::ResetForeground),
        ("[\"resetBackground\"]", Operation::ResetBackground),
    ] {
        if let Some(rest) = text.strip_prefix(spelled) {
            return Some((Some(operation), rest));
        }
    }
    let (kind, rest) = plain_string(text.strip_prefix('[')?)?;
    let (name, rest) = plain_string(rest.strip_prefix(',')?)?;
    let rest = rest.strip_prefix(']')?;
    let operation = match kind {
        "token" => known(name).then(|| Operation::Token(name.to_owned())),
        "modifier" => Modifier::from_name(name).map(Operation::Modifier),
        "foreground" => {
            Ansi16Color::from_name(name).map(|color| Operation::Foreground(Color::Named(color)))
        }
        "background" => {
            Ansi16Color::from_name(name).map(|color| Operation::Background(Color::Named(color)))
        }
        _ => return None,
    };
    Some((operation, rest))
}

/// A header in the spelling the style helpers write, read without building JSON values: `Some`
/// with what [`parse_header`] answers for it, or `None` for any other spelling, which
/// [`parse_header`] then reads. It reads a strict subset of JSON, so whatever it reads, it reads as
/// `JSON.parse` does.
pub(crate) fn canonical_header(text: &str, known: &dyn Fn(&str) -> bool) -> Option<Option<Header>> {
    if text == "[\"nowrap\"]" {
        return Some(Some(Header::Nowrap));
    }
    if let Some(rest) = text.strip_prefix("[\"glyph\",") {
        let (name, rest) = plain_string(rest)?;
        return (rest == "]").then(|| {
            Glyph::ALL
                .iter()
                .find(|glyph| glyph.name() == name)
                .map(|glyph| Header::Glyph(*glyph))
        });
    }
    if let Some(rest) = text.strip_prefix("[\"pad\",") {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        // At most fifteen digits stays below 2^53, so every such width is a safe integer.
        if digits == 0 || digits > 15 || (digits > 1 && rest.starts_with('0')) {
            return None;
        }
        let width = rest.get(..digits)?.parse().ok()?;
        let align = match rest.get(digits..)? {
            ",\"left\"]" => Alignment::Left,
            ",\"right\"]" => Alignment::Right,
            ",\"center\"]" => Alignment::Center,
            _ => return None,
        };
        return Some(Some(Header::Pad(Padding { width, align })));
    }
    let mut rest = text.strip_prefix("[\"style\",[")?;
    let mut operations = Vec::new();
    if rest == "]]" {
        return Some(Some(Header::Style(operations)));
    }
    loop {
        let (operation, after) = canonical_operation(rest, known)?;
        // One rejected operation rejects the header, whatever follows it.
        let Some(operation) = operation else {
            return Some(None);
        };
        operations.push(operation);
        if after == "]]" {
            return Some(Some(Header::Style(operations)));
        }
        rest = after.strip_prefix(',')?;
    }
}

/// A frame on the parser's stack.
enum Frame {
    Style { previous: ScopeId },
    Pad,
    Nowrap,
}

/// How a run of decoded characters joins the text.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Form {
    /// A glyph form or a decoded escape: one whole unit at its origin.
    Atom,
    /// Literal input, one origin per character.
    Literal,
    /// A rejected header, kept whole, one origin per character.
    Rejected,
}

struct Parser<'p, 't> {
    palette: &'p Palette,
    text: Vec<char>,
    scopes: Vec<ScopeId>,
    arena: Vec<StyleScope>,
    boundaries: Boundaries,
    stack: Vec<Frame>,
    active: ScopeId,
    unbroken: usize,
    trace: Option<&'t mut WireTrace>,
}

impl Parser<'_, '_> {
    fn append(&mut self, piece: &[char], origin: usize, form: Form) {
        self.text.extend_from_slice(piece);
        let whole = form != Form::Literal || self.unbroken > 0;
        for index in 0..piece.len() {
            self.scopes.push(self.active);
            if let Some(trace) = self.trace.as_deref_mut() {
                trace.origins.push(if form == Form::Atom {
                    origin
                } else {
                    origin + index
                });
                trace.whole.push(whole);
            }
        }
    }

    fn boundary(&mut self, value: Boundary) {
        self.boundaries
            .entry(self.scopes.len())
            .or_default()
            .push(value);
    }

    fn mark(&mut self, mark: FrameMark) {
        if let Some(frames) = self
            .trace
            .as_deref_mut()
            .and_then(|trace| trace.frames.as_mut())
        {
            frames.push(mark);
        }
    }

    fn end_frame(&mut self, written: bool) {
        if written {
            self.mark(FrameMark::Close {
                at: self.scopes.len(),
            });
        }
        match self.stack.pop() {
            Some(Frame::Style { previous }) => self.active = previous,
            Some(Frame::Pad) => {
                self.unbroken = self.unbroken.saturating_sub(1);
                self.boundary(Boundary::Close);
            }
            Some(Frame::Nowrap) => self.unbroken = self.unbroken.saturating_sub(1),
            None => {}
        }
    }

    fn attributes(&self, scope: ScopeId) -> Rc<Attributes> {
        self.arena
            .get(scope)
            .map_or_else(Rc::default, |scope| Rc::clone(&scope.attributes))
    }
}

/// Decodes framing once. Rejected headers are opaque, nesting uses an explicit stack, and the
/// input's end closes every frame still open.
pub(crate) fn parse_text<'p>(
    input: &[char],
    palette: &'p Palette,
    options: ParseOptions<'_>,
) -> ParsedText<'p> {
    let any_token = options.any_token;
    let known = |name: &str| any_token || CORE_TOKENS.contains(&name) || palette.contains(name);
    let mut parser = Parser {
        palette,
        text: Vec::with_capacity(input.len()),
        scopes: Vec::with_capacity(input.len()),
        arena: vec![StyleScope {
            attributes: Rc::new(Attributes::default()),
            parent: None,
            operations: Rc::from(Vec::new()),
        }],
        boundaries: Boundaries::new(),
        stack: Vec::new(),
        active: ROOT,
        unbroken: 0,
        trace: options.trace,
    };
    let mut cursor = 0;
    while let Some(&character) = input.get(cursor) {
        if character == OPEN {
            let end = input
                .get(cursor + 1..)
                .and_then(|rest| rest.iter().position(|&c| c == HEADER_END))
                .map(|position| cursor + 1 + position);
            let candidate = end
                .and_then(|end| input.get(cursor + 1..end))
                .and_then(|header| parse_header(header, &known));
            let candidate = match (candidate, end) {
                (Some(Header::Glyph(_)), Some(end)) if input.get(end + 1) != Some(&CLOSE) => None,
                (candidate, _) => candidate,
            };
            let (Some(candidate), Some(end)) = (candidate, end) else {
                let until = end.map_or(input.len(), |end| end + 1);
                parser.append(
                    input.get(cursor..until).unwrap_or_default(),
                    cursor,
                    Form::Rejected,
                );
                cursor = until;
                continue;
            };
            let start = cursor;
            cursor = end + 1;
            if !matches!(candidate, Header::Glyph(_)) {
                let at = parser.scopes.len();
                parser.mark(FrameMark::Open {
                    at,
                    header: input.get(start..cursor).unwrap_or_default().to_vec(),
                    scoped: matches!(candidate, Header::Style(_)),
                });
            }
            match candidate {
                Header::Glyph(glyph) => {
                    let form = if options.main_glyphs {
                        glyph.main_form()
                    } else {
                        glyph.compatibility_form()
                    };
                    let form: Vec<char> = form.chars().collect();
                    parser.append(&form, start, Form::Atom);
                    cursor += 1;
                }
                Header::Nowrap => {
                    parser.stack.push(Frame::Nowrap);
                    parser.unbroken += 1;
                }
                Header::Style(operations) => {
                    parser.stack.push(Frame::Style {
                        previous: parser.active,
                    });
                    let attributes =
                        apply_operations(&parser.attributes(parser.active), &operations, palette);
                    parser.arena.push(StyleScope {
                        attributes: Rc::new(attributes),
                        parent: Some(parser.active),
                        operations: Rc::from(operations),
                    });
                    parser.active = parser.arena.len() - 1;
                }
                Header::Pad(padding) => {
                    parser.stack.push(Frame::Pad);
                    parser.unbroken += 1;
                    let attributes = parser.attributes(parser.active);
                    let scope = parser.active;
                    parser.boundary(Boundary::Open {
                        padding,
                        attributes,
                        scope,
                    });
                }
            }
            continue;
        }
        if character == CLOSE && !parser.stack.is_empty() {
            parser.end_frame(true);
            cursor += 1;
            continue;
        }
        if character == ESCAPE {
            let digits: Option<String> = input
                .get(cursor + 1..cursor + 5)
                .map(|d| d.iter().collect());
            let decoded = match digits.as_deref() {
                Some("E000") => Some(OPEN),
                Some("E001") => Some(HEADER_END),
                Some("E002") => Some(CLOSE),
                Some("E003") => Some(ESCAPE),
                _ => None,
            };
            if let Some(decoded) = decoded {
                parser.append(&[decoded], cursor, Form::Atom);
                cursor += 5;
                continue;
            }
        }
        // The literal characters that follow are literal too, up to the next one a frame may
        // start at.
        let mut end = cursor + 1;
        while input
            .get(end)
            .is_some_and(|&c| c != OPEN && c != CLOSE && c != ESCAPE)
        {
            end += 1;
        }
        parser.append(
            input.get(cursor..end).unwrap_or_default(),
            cursor,
            Form::Literal,
        );
        cursor = end;
    }
    while !parser.stack.is_empty() {
        parser.end_frame(false);
    }
    ParsedText {
        text: parser.text,
        scopes: parser.scopes,
        arena: parser.arena,
        palette: parser.palette,
        boundaries: parser.boundaries,
    }
}

#[cfg(test)]
mod tests {
    use super::{canonical_header, parse_header};
    use crate::color::{Ansi16Color, Ansi256Fallbacks, ColorFallbacks};
    use crate::glyph::Glyph;
    use crate::style::{Alignment, CORE_TOKENS, Modifier, Style, style};

    fn header_of(marked: &str) -> String {
        let start = marked
            .find('\u{e000}')
            .map_or(0, |at| at + '\u{e000}'.len_utf8());
        let end = marked.find('\u{e001}').unwrap_or(marked.len());
        marked.get(start..end).unwrap_or_default().to_owned()
    }

    /// Every header the style helpers write, and spellings beside them.
    fn headers() -> Vec<String> {
        let mut chains: Vec<Style> = vec![style()];
        for token in CORE_TOKENS
            .iter()
            .chain(&["declared", "unknown", "with space"])
        {
            chains.push(style().token(token));
        }
        for modifier in Modifier::ALL {
            chains.push(style().then(crate::style::Operation::Modifier(modifier)));
        }
        for color in Ansi16Color::ALL {
            chains.push(style().foreground(color).background(color));
        }
        chains.extend([
            style().reset().reset_foreground().reset_background(),
            style().token("dim").bold().red().token("highlight"),
            style().token("unknown").bold(),
            style().bold().token("unknown"),
            style().ansi256_with(9, Ansi256Fallbacks::new().ansi16(Ansi16Color::Red)),
            style().rgb_with(1, 2, 3, ColorFallbacks::new().ansi256(4)),
            style().bg_rgb(255, 0, 0).italic(),
        ]);
        let mut headers: Vec<String> = chains
            .iter()
            .map(|chain| header_of(&chain.apply("")))
            .collect();
        for glyph in Glyph::ALL {
            headers.push(header_of(&glyph.marked()));
        }
        for width in [
            0,
            1,
            9,
            10,
            4096,
            999_999_999_999_999,
            9_007_199_254_740_991,
        ] {
            for align in [Alignment::Left, Alignment::Right, Alignment::Center] {
                headers.push(header_of(
                    &crate::style::pad("", width, align).unwrap_or_default(),
                ));
            }
        }
        headers.extend(
            [
                "[\"nowrap\"]",
                "[\"nowrap\" ]",
                "[\"glyph\",\"nope\"]",
                "[\"glyph\",\"bullet\",1]",
                "[\"pad\",01,\"left\"]",
                "[\"pad\",1.0,\"left\"]",
                "[\"pad\",-1,\"left\"]",
                "[\"pad\",1,\"middle\"]",
                "[\"pad\",1e2,\"left\"]",
                "[\"style\",[]]",
                "[\"style\",[],1]",
                "[\"style\",[[\"token\",\"dim\"]],1]",
                "[\"style\",[[\"token\",\"dim\"],]]",
                "[\"style\",[[\"token\",\"di\\u006d\"]]]",
                "[\"style\",[[\"modifier\",\"blink\"]]]",
                "[\"style\",[[\"foreground\",\"purple\"]]]",
                "[\"style\",[[\"reset\",1]]]",
                "[\"style\",[[\"token\",\"dim\"]]] ",
                "[\"style\",[[\"token\",\"nope\"],{]]",
                "[\"style\",[[\"token\"]]]",
                "",
                "[",
            ]
            .map(str::to_owned),
        );
        headers
    }

    #[test]
    fn a_canonical_header_reads_as_the_json_reader_reads_it() {
        let known = |name: &str| CORE_TOKENS.contains(&name) || name == "declared";
        let mut read = 0;
        for header in headers() {
            if let Some(canonical) = canonical_header(&header, &known) {
                read += 1;
                let chars: Vec<char> = header.chars().collect();
                assert_eq!(canonical, parse_header(&chars, &known), "{header:?}");
            }
        }
        assert!(read > 60, "{read} headers read");
    }
}
