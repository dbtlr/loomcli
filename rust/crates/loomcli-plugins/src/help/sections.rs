//! Ordered help sections: members grouped under one or two uppercase headings, in the order the
//! routed Command's section list names, then by each heading's first visible member.

use loomcli_core::ViewContext;

use super::cells::{ROW_INDENT, Row, column};

/// One member a section lists: its default heading, its authored section, and what it shows.
pub(crate) struct SectionMember<Shown> {
    pub(crate) fallback: &'static str,
    pub(crate) path: Option<Vec<String>>,
    pub(crate) row: Shown,
}

/// One outer section as members join it: its direct rows and its subsections in first-seen order.
struct Section<Shown> {
    rows: Vec<Shown>,
    subsections: Vec<(String, Vec<Shown>)>,
}

/// One outer section in page order: its heading, its direct rows, and its ordered subsections.
pub(crate) struct OrderedSection<Shown> {
    pub(crate) heading: String,
    pub(crate) rows: Vec<Shown>,
    pub(crate) subsections: Vec<(String, Vec<Shown>)>,
}

/// A path's headings in the uppercase form matching and printing use; stored values stay as
/// authored.
fn headings(path: &[String]) -> (Option<String>, Option<String>) {
    (
        path.first().map(|outer| outer.to_uppercase()),
        path.get(1).map(|inner| inner.to_uppercase()),
    )
}

/// The members grouped by the uppercase headings the reader sees, without changing their order.
fn collect<Shown>(members: Vec<SectionMember<Shown>>) -> Vec<(String, Section<Shown>)> {
    let mut sections: Vec<(String, Section<Shown>)> = Vec::new();
    for member in members {
        let (outer, inner) = headings(member.path.as_deref().unwrap_or(&[]));
        let heading = outer.unwrap_or_else(|| member.fallback.to_owned());
        let index = match sections.iter().position(|(name, _)| *name == heading) {
            Some(index) => index,
            None => {
                sections.push((
                    heading,
                    Section {
                        rows: Vec::new(),
                        subsections: Vec::new(),
                    },
                ));
                sections.len() - 1
            }
        };
        let section = &mut sections[index].1;
        match inner {
            None => section.rows.push(member.row),
            Some(inner) => match section
                .subsections
                .iter_mut()
                .find(|(name, _)| *name == inner)
            {
                Some((_, rows)) => rows.push(member.row),
                None => section.subsections.push((inner, vec![member.row])),
            },
        }
    }
    sections
}

/// The priorities an order list gives: the outer headings in first listed order, and each outer
/// heading's inner headings. A listed path counts only when its section exists, and a two-entry
/// path only when that inner section does.
struct Order {
    outer: Vec<String>,
    inner: Vec<(String, Vec<String>)>,
}

fn push_once(list: &mut Vec<String>, value: String) {
    if !list.contains(&value) {
        list.push(value);
    }
}

fn ordering<Shown>(sections: &[(String, Section<Shown>)], paths: &[Vec<String>]) -> Order {
    let mut order = Order {
        outer: Vec::new(),
        inner: Vec::new(),
    };
    for path in paths {
        let (Some(outer), inner) = headings(path) else {
            continue;
        };
        let Some((_, section)) = sections.iter().find(|(name, _)| *name == outer) else {
            continue;
        };
        let inner_missing = inner
            .as_ref()
            .is_some_and(|inner| !section.subsections.iter().any(|(name, _)| name == inner));
        if inner_missing {
            continue;
        }
        push_once(&mut order.outer, outer.clone());
        if let Some(inner) = inner {
            match order.inner.iter_mut().find(|(name, _)| *name == outer) {
                Some((_, listed)) => push_once(listed, inner),
                None => order.inner.push((outer, vec![inner])),
            }
        }
    }
    order
}

/// The members grouped into outer sections in page order, listed headings before the remaining
/// visible headings, each with its direct rows and its subsections in the same order rule.
pub(crate) fn ordered_sections<Shown>(
    order: Option<&[Vec<String>]>,
    members: Vec<SectionMember<Shown>>,
) -> Vec<OrderedSection<Shown>> {
    let mut sections = collect(members);
    let priorities = ordering(&sections, order.unwrap_or(&[]));
    let mut names = priorities.outer.clone();
    for (name, _) in &sections {
        push_once(&mut names, name.clone());
    }
    let mut ordered = Vec::new();
    for heading in names {
        let Some(index) = sections.iter().position(|(name, _)| *name == heading) else {
            continue;
        };
        let (_, section) = sections.remove(index);
        let listed = priorities
            .inner
            .iter()
            .find(|(name, _)| *name == heading)
            .map(|(_, listed)| listed.clone())
            .unwrap_or_default();
        let mut subsections = section.subsections;
        let mut inner_names = listed;
        for (name, _) in &subsections {
            push_once(&mut inner_names, name.clone());
        }
        let mut arranged = Vec::new();
        for name in inner_names {
            if let Some(position) = subsections.iter().position(|(each, _)| *each == name) {
                arranged.push(subsections.remove(position));
            }
        }
        ordered.push(OrderedSection {
            heading,
            rows: section.rows,
            subsections: arranged,
        });
    }
    ordered
}

/// The indent of the rows under an inner heading, two spaces past the heading itself.
const INNER_INDENT: &str = "    ";

/// One outer section as one block. Direct members and each subsection measure their own columns,
/// and each is a row set of its own, which wraps or stacks on its own.
fn block(section: &OrderedSection<Row>, context: &ViewContext) -> Vec<String> {
    let style = &context.style;
    let mut lines = vec![style.dim().apply(&style.escape(&section.heading))];
    if !section.rows.is_empty() {
        lines.extend(column(&section.rows, context, ROW_INDENT));
    }
    for (heading, rows) in &section.subsections {
        lines.push(format!("  {}", style.dim().apply(&style.escape(heading))));
        lines.extend(column(rows, context, INNER_INDENT));
    }
    lines
}

/// Each outer section as one block, listed headings before the remaining visible headings.
pub(super) fn section_blocks(
    order: Option<&[Vec<String>]>,
    members: Vec<SectionMember<Row>>,
    context: &ViewContext,
) -> Vec<Vec<String>> {
    ordered_sections(order, members)
        .iter()
        .map(|section| block(section, context))
        .collect()
}
