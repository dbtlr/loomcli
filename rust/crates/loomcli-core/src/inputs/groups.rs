//! Option groups at run time: which members an exclusive group withdraws by input tier, and the
//! problems a group reports after every input has validated.

use crate::inspection::{OptionGroup, OptionGroupKind};
use crate::invocation::parse::OptionValues;

use super::messages;
use super::{InputIdentity, InputKind, InputProblem};

/// The trigger and the needed options, in the order a group call judges them.
pub(crate) fn requirement_members<'a>(option: &'a str, needed: &[&'a str]) -> Vec<&'a str> {
    std::iter::once(option)
        .chain(needed.iter().copied())
        .collect()
}

/// The input tier that supplied an option's value, argv highest.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Tier {
    Argv,
    Environment,
    Configuration,
}

impl Tier {
    fn rank(self) -> u8 {
        match self {
            Tier::Argv => 3,
            Tier::Environment => 2,
            Tier::Configuration => 1,
        }
    }
}

/// Whether one member claims its exclusive group: a tier supplied it, and it is not a Boolean at
/// its absent value. Such a Boolean neither wins the group nor conflicts, and stays supplied.
pub(crate) fn claims(values: &OptionValues, name: &str, absent: &[(String, bool)]) -> bool {
    let absent_value = absent
        .iter()
        .find(|(known, _)| known == name)
        .map(|(_, value)| *value);
    values.is_supplied(name)
        && match values.boolean(name) {
            Some(value) => Some(value) != absent_value,
            None => true,
        }
}

/// The members that lose their exclusive group: those a lower tier claimed beside a sibling a
/// higher tier claimed, and those whose variable is outside its grammar beside a sibling argv
/// claimed. Every group reads the tiers as the input-source stage left them, so a member of two
/// groups loses when either holds a higher tier. A group of another kind has no loser.
pub(crate) fn losing_members(
    groups: &[OptionGroup],
    rejected: &[String],
    tier_of: &dyn Fn(&str) -> Option<Tier>,
) -> Vec<String> {
    let mut losers: Vec<String> = Vec::new();
    for group in groups
        .iter()
        .filter(|group| group.kind() == OptionGroupKind::Exclusive)
    {
        let ranked: Vec<(&str, u8)> = group
            .members()
            .map(|name| (name, tier_of(name).map_or(0, Tier::rank)))
            .collect();
        let top = ranked.iter().map(|(_, rank)| *rank).max().unwrap_or(0);
        for (name, rank) in ranked {
            let loses = if rank > 0 {
                rank < top
            } else {
                rejected.iter().any(|known| known == name) && top == Tier::Argv.rank()
            };
            if loses && !losers.iter().any(|known| known == name) {
                losers.push(name.to_owned());
            }
        }
    }
    losers
}

/// What the group checks read after validation.
pub(crate) struct GroupContext<'a> {
    /// Each local Boolean option's absent value, at which a member claims no exclusive group.
    pub(crate) absent: &'a [(String, bool)],
    pub(crate) groups: &'a [OptionGroup],
    /// The members withdrawn as the losers of an exclusive group. `oneRequired` counts each, and a
    /// `requiredTogether` group or requirement that holds one is not checked.
    pub(crate) withdrawn: &'a [String],
    pub(crate) values: &'a OptionValues,
    /// The spelling a problem names each option by.
    pub(crate) spelling: &'a dyn Fn(&str) -> String,
    pub(crate) labels: &'a [(String, String)],
    /// The members a skipped configuration source would have been asked about.
    pub(crate) unanswered: &'a [String],
}

/// Whether one member counts toward its group's report.
fn counts_for(kind: OptionGroupKind, name: &str, context: &GroupContext<'_>) -> bool {
    match kind {
        OptionGroupKind::Exclusive => claims(context.values, name, context.absent),
        OptionGroupKind::OneRequired => {
            context.values.is_supplied(name) || context.withdrawn.iter().any(|known| known == name)
        }
        OptionGroupKind::RequiredTogether | OptionGroupKind::Requires => {
            context.values.is_supplied(name)
        }
    }
}

/// The members a broken group's sentence names. A skipped configuration answer suppresses only
/// the part of a failure that depends on that answer.
fn sentence_members<'a>(
    group: &'a OptionGroup,
    context: &GroupContext<'_>,
) -> Option<Vec<&'a str>> {
    let kind = group.kind();
    let withdrawn = |name: &str| context.withdrawn.iter().any(|known| known == name);
    let unanswered = |name: &str| context.unanswered.iter().any(|known| known == name);
    let supplied = |name: &str| counts_for(kind, name, context);
    let lacking = |name: &str| !supplied(name) && !unanswered(name);
    let broken = match group {
        OptionGroup::Exclusive { .. } => {
            group
                .members()
                .filter(|name| supplied(name))
                .take(2)
                .count()
                == 2
        }
        OptionGroup::OneRequired { .. } => !group
            .members()
            .any(|name| supplied(name) || unanswered(name)),
        OptionGroup::RequiredTogether { .. } => {
            group.members().any(supplied)
                && !group.members().any(withdrawn)
                && group.members().any(lacking)
        }
        OptionGroup::Requires { option, requires } => {
            if !claims(context.values, option, context.absent) || group.members().any(withdrawn) {
                return None;
            }
            let mut needed = requires
                .iter()
                .map(String::as_str)
                .filter(|name| lacking(name))
                .peekable();
            needed.peek()?;
            return Some(std::iter::once(option.as_str()).chain(needed).collect());
        }
    };
    broken.then(|| group.members().collect())
}

/// The reports of every broken group, each its default text's line and its problem.
pub(crate) fn group_reports(context: &GroupContext<'_>) -> Vec<(Vec<String>, InputProblem)> {
    context
        .groups
        .iter()
        .filter_map(|group| {
            let kind = group.kind();
            let described = sentence_members(group, context)?;
            let members: Vec<(String, Option<&str>)> = described
                .into_iter()
                .map(|name| {
                    let label = context
                        .labels
                        .iter()
                        .find(|(known, _)| known == name)
                        .map(|(_, label)| label.as_str());
                    ((context.spelling)(name), label)
                })
                .collect();
            let spellings: Vec<String> = group.members().map(context.spelling).collect();
            let supplied = group
                .members()
                .zip(&spellings)
                .filter(|(name, _)| counts_for(kind, name, context))
                .map(|(_, spelling)| spelling.clone())
                .collect();
            Some((
                vec![messages::group_sentence(kind, &members)],
                InputProblem::Group {
                    reason: kind,
                    inputs: group
                        .members()
                        .map(|name| InputIdentity {
                            global: false,
                            kind: InputKind::Option,
                            name: name.to_owned(),
                        })
                        .collect(),
                    spellings,
                    supplied,
                },
            ))
        })
        .collect()
}
