//! Long spellings of visible option aliases, shared by listings and completion.

use loomcli_core::{OptionNode, Polarity};

/// The spellings one alias gains, in the order the option's polarity generates them.
pub(crate) fn alias_spellings(option: &OptionNode, alias: &str) -> impl Iterator<Item = String> {
    let polarity = match option {
        OptionNode::Boolean(node) => node.polarity,
        _ => Polarity::Positive,
    };
    [
        (polarity != Polarity::Negative).then(|| format!("--{alias}")),
        matches!(polarity, Polarity::Both | Polarity::Negative).then(|| format!("--no-{alias}")),
    ]
    .into_iter()
    .flatten()
}
