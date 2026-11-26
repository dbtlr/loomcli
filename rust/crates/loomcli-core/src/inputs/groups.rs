//! Option groups at run time: which members an exclusive group withdraws by input tier, and the
//! problems a group reports after every input has validated.

use crate::inspection::{OptionGroup, OptionGroupKind};
use crate::invocation::parse::OptionValues;

use super::messages;
use super::{InputIdentity, InputKind, InputProblem};

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
        .filter(|group| group.kind == OptionGroupKind::Exclusive)
    {
        let ranked: Vec<(&String, u8)> = group
            .options
            .iter()
            .map(|name| (name, tier_of(name).map_or(0, Tier::rank)))
            .collect();
        let top = ranked.iter().map(|(_, rank)| *rank).max().unwrap_or(0);
        for (name, rank) in ranked {
            let loses = if rank > 0 {
                rank < top
            } else {
                rejected.contains(name) && top == Tier::Argv.rank()
            };
            if loses && !losers.contains(name) {
                losers.push(name.clone());
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
    /// `requiredTogether` group that holds one is not checked.
    pub(crate) withdrawn: &'a [String],
    pub(crate) values: &'a OptionValues,
    /// The spelling a problem names each option by.
    pub(crate) spelling: &'a dyn Fn(&str) -> String,
    pub(crate) labels: &'a [(String, String)],
    /// The members a skipped configuration source would have been asked about.
    pub(crate) unanswered: &'a [String],
}

/// Whether one member counts toward its group: for an exclusive group, a claim; for `oneRequired`,
/// a supplied or withdrawn member; for `requiredTogether`, a supplied one.
fn counts_for(kind: OptionGroupKind, name: &str, context: &GroupContext<'_>) -> bool {
    match kind {
        OptionGroupKind::Exclusive => claims(context.values, name, context.absent),
        OptionGroupKind::OneRequired => {
            context.values.is_supplied(name) || context.withdrawn.iter().any(|known| known == name)
        }
        OptionGroupKind::RequiredTogether => context.values.is_supplied(name),
    }
}

/// Whether a group is broken. An unanswered configuration member suppresses only a failure whose
/// proof depends on its answer.
fn broken(group: &OptionGroup, context: &GroupContext<'_>) -> bool {
    let counted: Vec<&String> = group
        .options
        .iter()
        .filter(|name| counts_for(group.kind, name, context))
        .collect();
    let unanswered = |name: &String| context.unanswered.contains(name);
    match group.kind {
        OptionGroupKind::Exclusive => counted.len() > 1,
        OptionGroupKind::OneRequired => counted.is_empty() && !group.options.iter().any(unanswered),
        OptionGroupKind::RequiredTogether => {
            !counted.is_empty()
                && !group
                    .options
                    .iter()
                    .any(|name| context.withdrawn.contains(name))
                && group
                    .options
                    .iter()
                    .any(|name| !counted.contains(&name) && !unanswered(name))
        }
    }
}

/// The reports of every broken group, each its default text's line and its problem.
pub(crate) fn group_reports(context: &GroupContext<'_>) -> Vec<(Vec<String>, InputProblem)> {
    context
        .groups
        .iter()
        .filter(|group| broken(group, context))
        .map(|group| {
            let spellings: Vec<String> = group
                .options
                .iter()
                .map(|name| (context.spelling)(name))
                .collect();
            let described: Vec<(&str, Option<&str>)> = group
                .options
                .iter()
                .zip(&spellings)
                .map(|(name, spelling)| {
                    let label = context
                        .labels
                        .iter()
                        .find(|(known, _)| known == name)
                        .map(|(_, label)| label.as_str());
                    (spelling.as_str(), label)
                })
                .collect();
            let supplied = group
                .options
                .iter()
                .zip(&spellings)
                .filter(|(name, _)| counts_for(group.kind, name, context))
                .map(|(_, spelling)| spelling.clone())
                .collect();
            (
                vec![messages::group_sentence(group.kind, &described)],
                InputProblem::Group {
                    reason: group.kind,
                    inputs: group
                        .options
                        .iter()
                        .map(|name| InputIdentity {
                            global: false,
                            kind: InputKind::Option,
                            name: name.clone(),
                        })
                        .collect(),
                    spellings,
                    supplied,
                },
            )
        })
        .collect()
}
