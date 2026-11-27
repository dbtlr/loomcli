//! A run's live progress rows, divided among its lines and task trees.

use std::collections::BTreeMap;
use std::sync::{Arc, Weak};

use crate::progress_log::ProgressLog;
use crate::tree::Tree;

#[derive(Default)]
pub(crate) struct Layout {
    next_tree: usize,
    seats: Vec<Seat>,
    trees: BTreeMap<usize, Place>,
}

struct Seat {
    tree: usize,
    line: usize,
    log: Arc<ProgressLog>,
    drawn: usize,
}

struct Place {
    tree: Weak<Tree>,
    finished: usize,
    drawn: usize,
}

impl Layout {
    pub(crate) fn reserve(&mut self) -> usize {
        let id = self.next_tree;
        self.next_tree += 1;
        id
    }

    pub(crate) fn join(&mut self, id: usize, tree: Weak<Tree>) {
        self.trees.insert(
            id,
            Place {
                tree,
                finished: 0,
                drawn: 0,
            },
        );
    }

    pub(crate) fn open(
        &mut self,
        tree: usize,
        line: usize,
        log: Arc<ProgressLog>,
        rows: Option<usize>,
    ) -> Vec<Arc<Tree>> {
        if !self.trees.contains_key(&tree) {
            return Vec::new();
        }
        self.seats.push(Seat {
            tree,
            line,
            log,
            drawn: 0,
        });
        let drawn = self.seats.len()
            + self.seats.iter().map(|seat| seat.drawn).sum::<usize>()
            + self.trees.values().map(|place| place.drawn).sum::<usize>();
        if rows.is_none_or(|rows| drawn <= rows) {
            return Vec::new();
        }
        self.trees
            .iter()
            .filter(|(id, place)| {
                **id != tree
                    && (place.drawn > 0
                        || self
                            .seats
                            .iter()
                            .any(|seat| seat.tree == **id && seat.drawn > 0))
            })
            .filter_map(|(_, place)| place.tree.upgrade())
            .collect()
    }

    pub(crate) fn leave(&mut self, tree: usize, line: usize) {
        self.seats
            .retain(|seat| (seat.tree, seat.line) != (tree, line));
    }

    pub(crate) fn finish(&mut self, tree: usize, finished: usize) {
        if let Some(place) = self.trees.get_mut(&tree) {
            place.finished = finished;
        }
    }

    pub(crate) fn remove(&mut self, tree: usize) {
        self.trees.remove(&tree);
        self.seats.retain(|seat| seat.tree != tree);
    }

    /// Fits the open lines' logs in drawing order, then fits the tree's finished rows.
    pub(crate) fn fit(
        &mut self,
        tree: usize,
        order: &[usize],
        rows: Option<usize>,
    ) -> (BTreeMap<usize, usize>, usize) {
        let needs: Vec<_> = self.seats.iter().map(|seat| seat.log.need()).collect();
        let finished_need = self.trees.get(&tree).map_or(0, |place| place.finished);
        let budget = rows.map(|rows| rows.saturating_sub(self.seats.len()));
        let shares = budget.map_or_else(|| needs.clone(), |budget| row_shares(budget, &needs));
        let others_finished: usize = self
            .trees
            .iter()
            .filter(|(id, _)| **id != tree)
            .map(|(_, place)| place.drawn)
            .sum();
        let mut logs: usize = self.seats.iter().map(|seat| seat.drawn).sum();
        let mut fitted = BTreeMap::new();
        for line in order {
            let Some(index) = self
                .seats
                .iter()
                .position(|seat| (seat.tree, seat.line) == (tree, *line))
            else {
                continue;
            };
            let seat = &mut self.seats[index];
            logs -= seat.drawn;
            let room = budget.map_or(usize::MAX, |budget| {
                budget.saturating_sub(logs + others_finished)
            });
            seat.drawn = shares[index].min(room);
            logs += seat.drawn;
            fitted.insert(*line, seat.drawn);
        }
        let finished = if let Some(budget) = budget {
            let reserved_logs: usize = shares.iter().sum();
            let needs: Vec<_> = self.trees.values().map(|place| place.finished).collect();
            let allowance = self
                .trees
                .keys()
                .position(|id| *id == tree)
                .map_or(0, |index| {
                    row_shares(budget.saturating_sub(reserved_logs), &needs)[index]
                });
            allowance.min(budget.saturating_sub(logs + others_finished))
        } else {
            finished_need
        };
        if let Some(place) = self.trees.get_mut(&tree) {
            place.drawn = finished;
        }
        (fitted, finished)
    }
}

/// Divides a budget evenly among lines that can use it, in opening order.
fn row_shares(mut budget: usize, needs: &[usize]) -> Vec<usize> {
    let mut shares = vec![0; needs.len()];
    let mut wanting: Vec<_> = (0..needs.len()).filter(|index| needs[*index] > 0).collect();
    while budget > 0 && !wanting.is_empty() {
        let each = budget / wanting.len();
        if each == 0 {
            for index in wanting.into_iter().take(budget) {
                shares[index] += 1;
            }
            break;
        }
        for index in &wanting {
            let given = each.min(needs[*index] - shares[*index]);
            shares[*index] += given;
            budget -= given;
        }
        wanting.retain(|index| shares[*index] < needs[*index]);
    }
    shares
}

#[cfg(test)]
mod tests {
    use super::row_shares;

    #[test]
    fn shares_cover_the_reference_budgets_and_needs() {
        for (budget, needs, expected) in [
            (8, &[5, 5][..], &[4, 4][..]),
            (19, &[5, 5, 5, 5, 5], &[4, 4, 4, 4, 3]),
            (4, &[1, 5], &[1, 3]),
            (7, &[5, 0, 5], &[4, 0, 3]),
            (6, &[0, 0, 2], &[0, 0, 2]),
            (20, &[2, 5, 1], &[2, 5, 1]),
            (0, &[5, 5, 5], &[0, 0, 0]),
            (0, &[5, 5], &[0, 0]),
            (8, &[5, 5, 5], &[3, 3, 2]),
            (8, &[5, 5, 1], &[4, 3, 1]),
            (5, &[], &[]),
        ] {
            assert_eq!(row_shares(budget, needs), expected);
        }
    }
}
