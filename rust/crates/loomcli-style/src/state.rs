//! The attribute set a span of text carries, how operations change it, and the SGR bytes that move
//! a terminal from one set to another.

use crate::color::{Color, color_code};
use crate::rendering::Capabilities;
use crate::style::{Modifier, Operation};
use crate::theme::Palette;

/// The modifiers in effect, kept in the order they were first enabled, as a JavaScript `Set` keeps
/// them, because the order decides the order of the SGR parameters written.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Modifiers(Vec<Modifier>);

impl Modifiers {
    pub(crate) fn contains(&self, modifier: Modifier) -> bool {
        self.0.contains(&modifier)
    }

    pub(crate) fn insert(&mut self, modifier: Modifier) {
        if !self.contains(modifier) {
            self.0.push(modifier);
        }
    }

    pub(crate) fn remove(&mut self, modifier: Modifier) {
        self.0.retain(|present| *present != modifier);
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = Modifier> + '_ {
        self.0.iter().copied()
    }
}

/// The attributes of a span: foreground, background, and modifiers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Attributes {
    pub(crate) foreground: Option<Color>,
    pub(crate) background: Option<Color>,
    pub(crate) modifiers: Modifiers,
}

/// The attributes after `operations` apply to `base`, each token expanded to its palette entry.
pub(crate) fn apply_operations(
    base: &Attributes,
    operations: &[Operation],
    palette: &Palette,
) -> Attributes {
    let mut next = base.clone();
    for operation in operations {
        match operation {
            Operation::Token(name) => {
                for expanded in palette.get(name).unwrap_or_default() {
                    apply_one(&mut next, expanded);
                }
            }
            other => apply_one(&mut next, other),
        }
    }
    next
}

fn apply_one(attributes: &mut Attributes, operation: &Operation) {
    match operation {
        Operation::Foreground(color) => attributes.foreground = Some(*color),
        Operation::Background(color) => attributes.background = Some(*color),
        Operation::Modifier(modifier) => attributes.modifiers.insert(*modifier),
        Operation::Reset => *attributes = Attributes::default(),
        Operation::ResetForeground => attributes.foreground = None,
        Operation::ResetBackground => attributes.background = None,
        Operation::Token(_) => {}
    }
}

/// The SGR sequence that moves a terminal from `previous` to `next` under the destination's
/// capabilities, or nothing when no written attribute changes. Bold and faint share their reset,
/// so removing one re-enables the other.
pub(crate) fn transition(previous: &Attributes, next: &Attributes, caps: &Capabilities) -> String {
    let mut codes: Vec<String> = Vec::new();
    if caps.color {
        for background in [false, true] {
            let field = |attributes: &Attributes| {
                if background {
                    attributes.background
                } else {
                    attributes.foreground
                }
            };
            let before = color_code(field(previous).as_ref(), background, caps.depth);
            let after = color_code(field(next).as_ref(), background, caps.depth);
            if before != after {
                codes.push(after);
            }
        }
    }
    if caps.modifiers {
        let mut removed: Vec<u8> = Vec::new();
        for modifier in previous.modifiers.iter() {
            if !next.modifiers.contains(modifier) && !removed.contains(&modifier.off()) {
                removed.push(modifier.off());
            }
        }
        codes.extend(removed.iter().map(u8::to_string));
        for modifier in next.modifiers.iter() {
            if !previous.modifiers.contains(modifier) || removed.contains(&modifier.off()) {
                codes.push(modifier.on().to_string());
            }
        }
    }
    if codes.is_empty() {
        String::new()
    } else {
        format!("\u{1b}[{}m", codes.join(";"))
    }
}
