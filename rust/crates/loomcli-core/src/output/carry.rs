//! Moving past finished lines without laying them out again.

use std::borrow::Cow;

use loomcli_style::{Carried, LineCarry, Renderer};

pub(super) struct Carry {
    state: LineCarry,
    prior: Option<String>,
    enabled: bool,
}

impl Carry {
    pub(super) fn new(built_in: bool) -> Self {
        Self {
            state: LineCarry::default(),
            prior: None,
            enabled: built_in,
        }
    }

    /// The first line reestablishes the state the omitted lines left open.
    pub(super) fn layout<'a>(&self, tail: &'a str) -> Cow<'a, str> {
        match &self.prior {
            Some(before) => Cow::Owned(format!("{before}\n{tail}")),
            None => Cow::Borrowed(tail),
        }
    }

    /// The carry past `finished`, or none when the split cannot move there. A carry that can never
    /// split again stops here; a ready one takes effect only through [`Carry::commit`], once the
    /// layout that moves the split has succeeded.
    pub(super) fn next(&mut self, finished: &str, renderer: &Renderer) -> Option<LineCarry> {
        if !self.enabled {
            return None;
        }
        match self.state.through(finished, renderer) {
            Carried::Ready(carry) => Some(carry),
            Carried::Wait => None,
            Carried::Stop => {
                self.enabled = false;
                None
            }
        }
    }

    pub(super) fn commit(&mut self, carry: LineCarry) {
        self.prior = Some(carry.opening());
        self.state = carry;
    }
}
